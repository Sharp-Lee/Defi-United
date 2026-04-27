use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use wallet_workbench_lib::commands::config::{
    ensure_rpc_chain_id_matches, load_app_config, remember_validated_rpc,
    remember_validated_rpc_with_remote_chain_id, ValidatedRpcEndpointInput,
};
use wallet_workbench_lib::storage::config_path;

const APP_DIR_ENV: &str = "EVM_WALLET_WORKBENCH_APP_DIR";

fn test_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn unique_test_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "wallet-workbench-{label}-{}-{nanos}",
        std::process::id()
    ))
}

fn with_test_app_dir(test_name: &str, f: impl FnOnce(&Path)) {
    let _guard = test_lock().lock().expect("test lock");
    let dir = unique_test_dir(test_name);
    let previous = std::env::var_os(APP_DIR_ENV);

    if dir.exists() {
        fs::remove_dir_all(&dir).expect("clean temp dir");
    }

    fs::create_dir_all(&dir).expect("create temp dir");
    std::env::set_var(APP_DIR_ENV, &dir);

    f(&dir);

    if let Some(value) = previous {
        std::env::set_var(APP_DIR_ENV, value);
    } else {
        std::env::remove_var(APP_DIR_ENV);
    }
    fs::remove_dir_all(&dir).expect("remove temp dir");
}

fn endpoint(chain_id: u64, rpc_url: &str) -> ValidatedRpcEndpointInput {
    ValidatedRpcEndpointInput {
        chain_id,
        name: format!("Chain {chain_id}"),
        native_symbol: "ETH".to_string(),
        rpc_url: rpc_url.to_string(),
    }
}

#[test]
fn missing_config_returns_defaults() {
    with_test_app_dir("config-defaults", |_| {
        let config = load_app_config().expect("load default config");

        assert_eq!(config.default_chain_id, 1);
        assert_eq!(config.idle_lock_minutes, 15);
        assert!(config.rpc_endpoints.is_empty());
        assert!(!config_path().expect("config path").exists());
    });
}

#[test]
fn remembers_validated_rpc_and_reloads_chain_identity() {
    with_test_app_dir("config-remembers-rpc", |_| {
        let saved = remember_validated_rpc_with_remote_chain_id(
            endpoint(8453, "https://base.example"),
            8453,
        )
        .expect("save");

        assert_eq!(saved.default_chain_id, 8453);
        assert_eq!(saved.rpc_endpoints.len(), 1);
        assert_eq!(saved.rpc_endpoints[0].chain_id, 8453);
        assert_eq!(saved.rpc_endpoints[0].rpc_url, "https://base.example");
        assert!(!saved.rpc_endpoints[0].validated_at.is_empty());

        let reloaded = load_app_config().expect("reload config");
        assert_eq!(reloaded.default_chain_id, 8453);
        assert_eq!(reloaded.rpc_endpoints.len(), 1);
        assert_eq!(reloaded.rpc_endpoints[0].chain_id, 8453);
        assert_eq!(reloaded.rpc_endpoints[0].rpc_url, "https://base.example");
    });
}

#[test]
fn remembering_same_chain_replaces_existing_endpoint() {
    with_test_app_dir("config-replaces-rpc", |_| {
        remember_validated_rpc_with_remote_chain_id(endpoint(1, "https://first.example"), 1)
            .expect("first save");
        let saved =
            remember_validated_rpc_with_remote_chain_id(endpoint(1, "https://second.example"), 1)
                .expect("second save");

        assert_eq!(saved.rpc_endpoints.len(), 1);
        assert_eq!(saved.rpc_endpoints[0].chain_id, 1);
        assert_eq!(saved.rpc_endpoints[0].rpc_url, "https://second.example");

        let reloaded = load_app_config().expect("reload config");
        assert_eq!(reloaded.rpc_endpoints.len(), 1);
        assert_eq!(reloaded.rpc_endpoints[0].rpc_url, "https://second.example");
    });
}

#[test]
fn loads_legacy_snake_case_app_config() {
    with_test_app_dir("config-loads-legacy-snake-case", |_| {
        fs::write(
            config_path().expect("config path"),
            r#"{
  "default_chain_id": 8453,
  "idle_lock_minutes": 30,
  "enabled_builtin_chain_ids": [1, 8453],
  "rpc_endpoints": [
    {
      "chain_id": 8453,
      "name": "Base",
      "native_symbol": "ETH",
      "rpc_url": "https://base.example",
      "validated_at": "123"
    }
  ],
  "display_preferences": {
    "fiat_currency": "EUR"
  }
}"#,
        )
        .expect("write legacy config");

        let config = load_app_config().expect("load legacy config");

        assert_eq!(config.default_chain_id, 8453);
        assert_eq!(config.idle_lock_minutes, 30);
        assert_eq!(config.enabled_builtin_chain_ids, vec![1, 8453]);
        assert_eq!(config.rpc_endpoints.len(), 1);
        assert_eq!(config.rpc_endpoints[0].chain_id, 8453);
        assert_eq!(config.rpc_endpoints[0].native_symbol, "ETH");
        assert_eq!(config.rpc_endpoints[0].rpc_url, "https://base.example");
        assert_eq!(config.display_preferences.fiat_currency, "EUR");
    });
}

#[test]
fn remember_validated_rpc_rejects_malformed_config_without_overwriting() {
    with_test_app_dir("config-rejects-malformed", |_| {
        fs::write(
            config_path().expect("config path"),
            "{ this is not valid json",
        )
        .expect("write malformed config");

        let error = remember_validated_rpc_with_remote_chain_id(
            endpoint(42161, "https://arb.example"),
            42161,
        )
        .expect_err("malformed config should fail");

        assert_eq!(
            error,
            "app-config.json is invalid; fix or remove it before saving RPC settings"
        );
        assert_eq!(
            fs::read_to_string(config_path().expect("config path")).expect("read malformed"),
            "{ this is not valid json"
        );
    });
}

#[test]
fn concurrent_remember_validated_rpc_preserves_distinct_chain_endpoints() {
    with_test_app_dir("config-concurrent-rpc-save", |_| {
        std::thread::scope(|scope| {
            let first = scope.spawn(|| {
                remember_validated_rpc_with_remote_chain_id(
                    endpoint(1, "https://mainnet.example"),
                    1,
                )
                .expect("first save");
            });
            let second = scope.spawn(|| {
                remember_validated_rpc_with_remote_chain_id(
                    endpoint(8453, "https://base.example"),
                    8453,
                )
                .expect("second save");
            });

            first.join().expect("first thread");
            second.join().expect("second thread");
        });

        let reloaded = load_app_config().expect("reload config");
        let mut chains = reloaded
            .rpc_endpoints
            .iter()
            .map(|endpoint| (endpoint.chain_id, endpoint.rpc_url.as_str()))
            .collect::<Vec<_>>();
        chains.sort_by_key(|(chain_id, _)| *chain_id);

        assert_eq!(
            chains,
            vec![
                (1, "https://mainnet.example"),
                (8453, "https://base.example")
            ]
        );
    });
}

#[test]
fn chain_id_validation_rejects_remote_mismatch() {
    let error = ensure_rpc_chain_id_matches(1, 8453).expect_err("mismatch should fail");

    assert!(error.contains("remote chainId 8453 does not match expected chainId 1"));
}

#[test]
fn remember_validated_rpc_rejects_remote_mismatch_without_writing_config() {
    with_test_app_dir("config-rejects-mismatch", |_| {
        let error =
            remember_validated_rpc_with_remote_chain_id(endpoint(1, "https://base.example"), 8453)
                .expect_err("mismatch should fail");

        assert!(error.contains("remote chainId 8453 does not match expected chainId 1"));
        assert!(!config_path().expect("config path").exists());
    });
}

#[tokio::test]
async fn remember_validated_rpc_rejects_invalid_url_without_leaking_url() {
    let secret_url = "not a rpc url with super-secret-token";
    let error = remember_validated_rpc(endpoint(1, secret_url))
        .await
        .expect_err("invalid URL should fail");

    assert_eq!(error, "RPC URL is invalid");
    assert!(!error.contains(secret_url));
    assert!(!error.contains("super-secret-token"));
}
