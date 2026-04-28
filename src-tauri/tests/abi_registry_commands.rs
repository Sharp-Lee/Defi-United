use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use wallet_workbench_lib::commands::abi_registry::{
    delete_abi_cache_entry, fetch_explorer_abi, import_abi_payload, load_abi_registry_state,
    mark_abi_cache_stale, paste_abi_payload, remove_abi_data_source_config, upsert_abi_cache_entry,
    upsert_abi_data_source_config, validate_abi_payload, AbiCacheEntryIdentityInput,
    AbiSelectorSummaryRecord, FetchExplorerAbiInput, RemoveAbiDataSourceConfigInput,
    UpsertAbiCacheEntryInput, UpsertAbiDataSourceConfigInput, UserAbiPayloadInput,
    ValidateAbiPayloadInput, ABI_PAYLOAD_SIZE_LIMIT_BYTES,
};
use wallet_workbench_lib::storage::abi_registry_path;

const APP_DIR_ENV: &str = "EVM_WALLET_WORKBENCH_APP_DIR";
const USDC: &str = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const PATH_SECRET: &str = "abcdefghijklmnopqrstuvwxyz0123456789TOKEN";

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
    let _guard = test_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
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

fn data_source_input() -> UpsertAbiDataSourceConfigInput {
    UpsertAbiDataSourceConfigInput {
        id: " etherscan-mainnet ".to_string(),
        chain_id: 1,
        provider_kind: "etherscanCompatible".to_string(),
        base_url: Some(" https://api.etherscan.example/api ".to_string()),
        api_key_ref: Some(" env:ETHERSCAN_MAINNET_KEY ".to_string()),
        enabled: Some(true),
        last_success_at: Some("1700000000".to_string()),
        clear_last_success_at: false,
        last_failure_at: None,
        clear_last_failure_at: false,
        failure_count: Some(0),
        cooldown_until: None,
        clear_cooldown_until: false,
        rate_limited: Some(false),
        last_error_summary: None,
        clear_last_error_summary: false,
    }
}

fn cache_entry_input(address: &str, version_id: &str) -> UpsertAbiCacheEntryInput {
    UpsertAbiCacheEntryInput {
        chain_id: 1,
        contract_address: address.to_string(),
        source_kind: "explorerFetched".to_string(),
        provider_config_id: Some("etherscan-mainnet".to_string()),
        user_source_id: None,
        version_id: version_id.to_string(),
        attempt_id: "attempt-1".to_string(),
        source_fingerprint: "fingerprint-1".to_string(),
        abi_hash: "abi-hash-1".to_string(),
        selected: true,
        fetch_source_status: "ok".to_string(),
        validation_status: "selectorConflict".to_string(),
        cache_status: "cacheFresh".to_string(),
        selection_status: "selected".to_string(),
        function_count: Some(8),
        event_count: Some(2),
        error_count: Some(1),
        selector_summary: Some(AbiSelectorSummaryRecord {
            function_selector_count: Some(8),
            event_topic_count: Some(2),
            error_selector_count: Some(1),
            duplicate_selector_count: Some(1),
            conflict_count: Some(1),
            notes: Some(" authorization: Bearer secret-value ".to_string()),
        }),
        fetched_at: Some("1700000001".to_string()),
        imported_at: None,
        last_validated_at: Some("1700000002".to_string()),
        stale_after: Some("1700086400".to_string()),
        last_error_summary: Some("fetch failed api_key=secret-value".to_string()),
        provider_proxy_hint: Some("implementation 0x1234".to_string()),
        proxy_detected: true,
    }
}

fn cache_identity(version_id: &str) -> AbiCacheEntryIdentityInput {
    AbiCacheEntryIdentityInput {
        chain_id: 1,
        contract_address: USDC.to_string(),
        source_kind: "explorerFetched".to_string(),
        provider_config_id: Some("etherscan-mainnet".to_string()),
        user_source_id: None,
        version_id: version_id.to_string(),
    }
}

fn valid_stored_registry(contract_address: &str) -> Value {
    json!({
        "schemaVersion": 1,
        "dataSources": [
            {
                "id": "etherscan-mainnet",
                "chainId": 1,
                "providerKind": "etherscanCompatible",
                "baseUrl": "https://api.etherscan.example/api",
                "apiKeyRef": "env:ETHERSCAN_MAINNET_KEY",
                "enabled": true,
                "lastSuccessAt": null,
                "lastFailureAt": null,
                "failureCount": 0,
                "cooldownUntil": null,
                "rateLimited": false,
                "lastErrorSummary": null,
                "createdAt": "1700000000",
                "updatedAt": "1700000000"
            }
        ],
        "cacheEntries": [
            {
                "chainId": 1,
                "contractAddress": contract_address,
                "sourceKind": "explorerFetched",
                "providerConfigId": "etherscan-mainnet",
                "userSourceId": null,
                "versionId": "version-1",
                "attemptId": "attempt-1",
                "sourceFingerprint": "fingerprint-1",
                "abiHash": "abi-hash-1",
                "selected": true,
                "fetchSourceStatus": "ok",
                "validationStatus": "ok",
                "cacheStatus": "cacheFresh",
                "selectionStatus": "selected",
                "functionCount": 1,
                "eventCount": 0,
                "errorCount": 0,
                "selectorSummary": {
                    "functionSelectorCount": 1,
                    "eventTopicCount": 0,
                    "errorSelectorCount": 0,
                    "duplicateSelectorCount": 0,
                    "conflictCount": 0,
                    "notes": "api_key=secret-value"
                },
                "fetchedAt": "1700000001",
                "importedAt": null,
                "lastValidatedAt": "1700000002",
                "staleAfter": null,
                "lastErrorSummary": "token=secret-value",
                "providerProxyHint": "auth bearer secret-value",
                "proxyDetected": false,
                "createdAt": "1700000001",
                "updatedAt": "1700000002"
            }
        ]
    })
}

fn write_stored_registry(value: Value) {
    let path = abi_registry_path().expect("path");
    fs::write(
        path,
        serde_json::to_string_pretty(&value).expect("registry json"),
    )
    .expect("write registry");
}

fn transfer_abi() -> String {
    json!([
        {
            "type": "function",
            "name": "transfer",
            "inputs": [
                { "name": "to", "type": "address" },
                { "name": "amount", "type": "uint256" }
            ],
            "outputs": [{ "name": "", "type": "bool" }],
            "stateMutability": "nonpayable"
        },
        {
            "type": "event",
            "name": "Transfer",
            "inputs": [
                { "name": "from", "type": "address", "indexed": true },
                { "name": "to", "type": "address", "indexed": true },
                { "name": "amount", "type": "uint256", "indexed": false }
            ],
            "anonymous": false
        },
        {
            "type": "error",
            "name": "InsufficientBalance",
            "inputs": [{ "name": "available", "type": "uint256" }]
        }
    ])
    .to_string()
}

fn approve_abi() -> String {
    json!([
        {
            "type": "function",
            "name": "approve",
            "inputs": [
                { "name": "spender", "type": "address" },
                { "name": "amount", "type": "uint256" }
            ],
            "outputs": [{ "name": "", "type": "bool" }],
            "stateMutability": "nonpayable"
        }
    ])
    .to_string()
}

fn explorer_abi_response(abi: &str) -> String {
    json!({
        "status": "1",
        "message": "OK",
        "result": abi
    })
    .to_string()
}

struct TestHttpServer {
    url: String,
    request_rx: mpsc::Receiver<String>,
    join: thread::JoinHandle<()>,
}

fn serve_once(status: &str, body: String) -> TestHttpServer {
    serve_once_with_headers(status, body, Some(None))
}

fn serve_once_with_content_length(
    status: &str,
    body: String,
    content_length: u64,
) -> TestHttpServer {
    serve_once_with_headers(status, body, Some(Some(content_length)))
}

fn serve_once_without_content_length(status: &str, body: String) -> TestHttpServer {
    serve_once_with_headers(status, body, None)
}

fn serve_once_with_headers(
    status: &str,
    body: String,
    content_length: Option<Option<u64>>,
) -> TestHttpServer {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test HTTP server");
    let url = format!("http://{}/api", listener.local_addr().expect("local addr"));
    let (request_tx, request_rx) = mpsc::channel();
    let status = status.to_string();
    let join = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        let mut buffer = [0u8; 4096];
        let read = stream.read(&mut buffer).expect("read request");
        let request = String::from_utf8_lossy(&buffer[..read]).to_string();
        request_tx.send(request).expect("send request");
        let content_length_header = content_length
            .map(|value| {
                format!(
                    "Content-Length: {}\r\n",
                    value.unwrap_or(body.as_bytes().len() as u64)
                )
            })
            .unwrap_or_default();
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{content_length_header}Connection: close\r\n\r\n{body}",
        );
        stream
            .write_all(response.as_bytes())
            .expect("write response");
    });

    TestHttpServer {
        url,
        request_rx,
        join,
    }
}

struct ControlledTestHttpServer {
    url: String,
    request_rx: mpsc::Receiver<String>,
    release_tx: mpsc::Sender<()>,
    join: thread::JoinHandle<()>,
}

fn serve_once_after_release(status: &str, body: String) -> ControlledTestHttpServer {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test HTTP server");
    let url = format!("http://{}/api", listener.local_addr().expect("local addr"));
    let (request_tx, request_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let status = status.to_string();
    let join = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        let mut buffer = [0u8; 4096];
        let read = stream.read(&mut buffer).expect("read request");
        let request = String::from_utf8_lossy(&buffer[..read]).to_string();
        request_tx.send(request).expect("send request");
        release_rx.recv().expect("release response");
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.as_bytes().len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("write response");
    });

    ControlledTestHttpServer {
        url,
        request_rx,
        release_tx,
        join,
    }
}

fn expect_invalid_stored_registry(value: Value) -> String {
    write_stored_registry(value);
    let error = load_abi_registry_state().expect_err("invalid stored registry rejected");
    assert!(error.contains("invalid ABI registry state"));
    error
}

#[test]
fn missing_abi_registry_file_loads_empty_default() {
    with_test_app_dir("abi-registry-default", |_| {
        let state = load_abi_registry_state().expect("load default state");

        assert_eq!(state.schema_version, 1);
        assert!(state.data_sources.is_empty());
        assert!(state.cache_entries.is_empty());
        assert!(!abi_registry_path().expect("path").exists());
    });
}

#[test]
fn abi_registry_upsert_data_source_normalizes_and_rejects_secrets_or_unsupported_kind() {
    with_test_app_dir("abi-registry-data-source", |_| {
        let state =
            upsert_abi_data_source_config(data_source_input()).expect("upsert data source config");

        assert_eq!(state.data_sources.len(), 1);
        let record = &state.data_sources[0];
        assert_eq!(record.id, "etherscan-mainnet");
        assert_eq!(record.chain_id, 1);
        assert_eq!(record.provider_kind, "etherscanCompatible");
        assert_eq!(
            record.base_url.as_deref(),
            Some("https://api.etherscan.example/api")
        );
        assert_eq!(
            record.api_key_ref.as_deref(),
            Some("env:ETHERSCAN_MAINNET_KEY")
        );
        assert!(record.enabled);

        let mut normal_path = data_source_input();
        normal_path.id = "normal-path".to_string();
        normal_path.base_url = Some("https://api.example.test/api/v2".to_string());
        let state = upsert_abi_data_source_config(normal_path).expect("allow normal baseUrl path");
        assert!(state
            .data_sources
            .iter()
            .any(|record| record.base_url.as_deref() == Some("https://api.example.test/api/v2")));

        let mut secret_url = data_source_input();
        secret_url.id = "secret-url".to_string();
        secret_url.base_url = Some("https://api.example.test/api?apikey=abc123".to_string());
        let error = upsert_abi_data_source_config(secret_url).expect_err("reject secret URL");
        assert!(error.contains("baseUrl"));
        assert!(!error.contains("abc123"));

        let mut secret_path = data_source_input();
        secret_path.id = "secret-path".to_string();
        secret_path.base_url = Some(format!("https://api.example.test/v1/{PATH_SECRET}"));
        let error = upsert_abi_data_source_config(secret_path).expect_err("reject secret path URL");
        assert!(error.contains("baseUrl"));
        assert!(!error.contains(PATH_SECRET));

        let mut whitespace_url = data_source_input();
        whitespace_url.id = "whitespace-url".to_string();
        whitespace_url.base_url = Some("https://api.example.test /api".to_string());
        let error =
            upsert_abi_data_source_config(whitespace_url).expect_err("reject whitespace URL");
        assert!(error.contains("baseUrl"));

        let mut control_url = data_source_input();
        control_url.id = "control-url".to_string();
        control_url.base_url = Some("https://api.example.test/api\nv2".to_string());
        let error = upsert_abi_data_source_config(control_url).expect_err("reject control URL");
        assert!(error.contains("baseUrl"));

        let mut secret_ref = data_source_input();
        secret_ref.id = "secret-ref".to_string();
        secret_ref.api_key_ref = Some(PATH_SECRET.to_string());
        let error = upsert_abi_data_source_config(secret_ref).expect_err("reject secret ref");
        assert!(error.contains("apiKeyRef"));
        assert!(!error.contains("abcdefghijklmnopqrstuvwxyz"));

        let mut freeform_ref = data_source_input();
        freeform_ref.id = "freeform-ref".to_string();
        freeform_ref.api_key_ref = Some("etherscan mainnet key".to_string());
        let error = upsert_abi_data_source_config(freeform_ref).expect_err("reject freeform ref");
        assert!(error.contains("apiKeyRef"));
        assert!(!error.contains("etherscan mainnet key"));

        let mut generic_uppercase_ref = data_source_input();
        generic_uppercase_ref.id = "generic-uppercase-ref".to_string();
        generic_uppercase_ref.api_key_ref = Some("ETHERSCAN_MAINNET_REF".to_string());
        let error = upsert_abi_data_source_config(generic_uppercase_ref)
            .expect_err("reject non-secret env-shaped ref");
        assert!(error.contains("apiKeyRef"));
        assert!(!error.contains("ETHERSCAN_MAINNET_REF"));

        let mut bare_env_ref = data_source_input();
        bare_env_ref.id = "bare-env-ref".to_string();
        bare_env_ref.api_key_ref = Some("ETHERSCAN_MAINNET_KEY".to_string());
        let error =
            upsert_abi_data_source_config(bare_env_ref).expect_err("reject bare env-shaped ref");
        assert!(error.contains("apiKeyRef"));
        assert!(!error.contains("ETHERSCAN_MAINNET_KEY"));

        let mut bare_name_ref = data_source_input();
        bare_name_ref.id = "bare-name-ref".to_string();
        bare_name_ref.api_key_ref = Some("NAME".to_string());
        let error =
            upsert_abi_data_source_config(bare_name_ref).expect_err("reject bare env name ref");
        assert!(error.contains("apiKeyRef"));
        assert!(!error.contains("NAME"));

        for (id, api_key_ref) in [
            ("shell-name-ref", "$NAME"),
            ("braced-name-ref", "${NAME}"),
            ("prefixed-name-ref", "env:NAME"),
            ("shell-secret-ref", "$ETHERSCAN_MAINNET_KEY"),
            ("braced-secret-ref", "${ETHERSCAN_MAINNET_KEY}"),
            ("prefixed-secret-ref", "env:ETHERSCAN_MAINNET_KEY"),
        ] {
            let mut env_ref = data_source_input();
            env_ref.id = id.to_string();
            env_ref.api_key_ref = Some(api_key_ref.to_string());
            let state = upsert_abi_data_source_config(env_ref).expect("allow explicit env ref");
            assert!(state.data_sources.iter().any(|record| {
                record.id == id && record.api_key_ref.as_deref() == Some(api_key_ref)
            }));
        }

        let mut keychain_ref = data_source_input();
        keychain_ref.id = "keychain-ref".to_string();
        keychain_ref.api_key_ref = Some("keychain:wallet-workbench/etherscan-mainnet".to_string());
        let state = upsert_abi_data_source_config(keychain_ref).expect("allow keychain ref");
        assert!(state.data_sources.iter().any(|record| {
            record.id == "keychain-ref"
                && record.api_key_ref.as_deref()
                    == Some("keychain:wallet-workbench/etherscan-mainnet")
        }));

        let mut unsupported = data_source_input();
        unsupported.id = "unsupported".to_string();
        unsupported.provider_kind = "mysteryExplorer".to_string();
        let error = upsert_abi_data_source_config(unsupported).expect_err("reject provider kind");
        assert!(error.contains("providerKind"));
    });
}

#[test]
fn abi_registry_remove_data_source_removes_existing_and_rejects_missing() {
    with_test_app_dir("abi-registry-data-source-remove", |_| {
        upsert_abi_data_source_config(data_source_input()).expect("upsert first data source");

        let mut second = data_source_input();
        second.id = "blockscout-mainnet".to_string();
        second.provider_kind = "blockscoutCompatible".to_string();
        second.base_url = Some("https://blockscout.example/api".to_string());
        upsert_abi_data_source_config(second).expect("upsert second data source");

        let state = remove_abi_data_source_config(RemoveAbiDataSourceConfigInput {
            id: " etherscan-mainnet ".to_string(),
        })
        .expect("remove existing data source");
        assert_eq!(state.data_sources.len(), 1);
        assert_eq!(state.data_sources[0].id, "blockscout-mainnet");

        let error = remove_abi_data_source_config(RemoveAbiDataSourceConfigInput {
            id: "etherscan-mainnet".to_string(),
        })
        .expect_err("reject missing data source");
        assert!(error.contains("not found"));
    });
}

#[test]
fn abi_registry_upsert_data_source_clear_flags_reset_failure_metadata() {
    with_test_app_dir("abi-registry-data-source-clear", |_| {
        let mut failed = data_source_input();
        failed.last_success_at = Some("1700000000".to_string());
        failed.last_failure_at = Some("1700000010".to_string());
        failed.failure_count = Some(3);
        failed.cooldown_until = Some("1700000900".to_string());
        failed.rate_limited = Some(true);
        failed.last_error_summary = Some("fetch failed api_key=secret-value".to_string());
        let state = upsert_abi_data_source_config(failed).expect("write failure metadata");
        let record = &state.data_sources[0];
        assert_eq!(record.last_failure_at.as_deref(), Some("1700000010"));
        assert_eq!(record.cooldown_until.as_deref(), Some("1700000900"));
        assert_eq!(
            record.last_error_summary.as_deref(),
            Some("fetch failed api_key=[redacted]")
        );

        let mut success = data_source_input();
        success.last_success_at = Some("1700001000".to_string());
        success.clear_last_failure_at = true;
        success.failure_count = Some(0);
        success.clear_cooldown_until = true;
        success.rate_limited = Some(false);
        success.clear_last_error_summary = true;
        let state = upsert_abi_data_source_config(success).expect("clear failure metadata");
        let record = &state.data_sources[0];
        assert_eq!(record.last_success_at.as_deref(), Some("1700001000"));
        assert!(record.last_failure_at.is_none());
        assert_eq!(record.failure_count, 0);
        assert!(record.cooldown_until.is_none());
        assert!(!record.rate_limited);
        assert!(record.last_error_summary.is_none());
    });
}

#[test]
fn corrupted_abi_registry_json_returns_explicit_error() {
    with_test_app_dir("abi-registry-corrupt", |_| {
        let path = abi_registry_path().expect("path");
        fs::write(&path, "{ definitely not json").expect("write corrupt registry");

        let error = load_abi_registry_state().expect_err("corrupt registry rejected");
        assert!(error.contains("abi-registry.json is invalid"));
    });
}

#[test]
fn abi_registry_stored_schema_version_two_is_rejected() {
    with_test_app_dir("abi-registry-schema-version", |_| {
        let mut registry = valid_stored_registry(USDC);
        registry["schemaVersion"] = json!(2);

        let error = expect_invalid_stored_registry(registry);
        assert!(!error.contains("2"));
    });
}

#[test]
fn abi_registry_stored_duplicate_normalized_identities_are_rejected() {
    with_test_app_dir("abi-registry-stored-duplicates", |_| {
        let mut duplicate_sources = valid_stored_registry(USDC);
        let mut second_source = duplicate_sources["dataSources"][0].clone();
        second_source["id"] = json!(" etherscan-mainnet ");
        duplicate_sources["dataSources"]
            .as_array_mut()
            .expect("data sources")
            .push(second_source);
        expect_invalid_stored_registry(duplicate_sources);

        let mut duplicate_cache = valid_stored_registry(USDC);
        let mut second_entry = duplicate_cache["cacheEntries"][0].clone();
        second_entry["contractAddress"] = json!("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
        duplicate_cache["cacheEntries"]
            .as_array_mut()
            .expect("cache entries")
            .push(second_entry);
        expect_invalid_stored_registry(duplicate_cache);
    });
}

#[test]
fn abi_registry_stored_secret_base_url_or_api_key_ref_is_rejected_without_leak() {
    with_test_app_dir("abi-registry-stored-secrets", |_| {
        let mut secret_url = valid_stored_registry(USDC);
        secret_url["dataSources"][0]["baseUrl"] =
            json!("https://api.example.test/api?apikey=super-secret-value");
        let error = expect_invalid_stored_registry(secret_url);
        assert!(!error.contains("super-secret-value"));

        let mut secret_path = valid_stored_registry(USDC);
        secret_path["dataSources"][0]["baseUrl"] =
            json!(format!("https://api.example.test/v1/{PATH_SECRET}"));
        let error = expect_invalid_stored_registry(secret_path);
        assert!(!error.contains(PATH_SECRET));

        let mut secret_ref = valid_stored_registry(USDC);
        secret_ref["dataSources"][0]["apiKeyRef"] = json!(PATH_SECRET);
        let error = expect_invalid_stored_registry(secret_ref);
        assert!(!error.contains("abcdefghijklmnopqrstuvwxyz"));
    });
}

#[test]
fn abi_registry_stored_invalid_cache_identity_or_status_is_rejected() {
    with_test_app_dir("abi-registry-stored-cache-invalid", |_| {
        let mut zero_address = valid_stored_registry(USDC);
        zero_address["cacheEntries"][0]["contractAddress"] =
            json!("0x0000000000000000000000000000000000000000");
        expect_invalid_stored_registry(zero_address);

        let mut zero_chain = valid_stored_registry(USDC);
        zero_chain["cacheEntries"][0]["chainId"] = json!(0);
        expect_invalid_stored_registry(zero_chain);

        let mut unsupported_status = valid_stored_registry(USDC);
        unsupported_status["cacheEntries"][0]["cacheStatus"] = json!("mysteryCacheState");
        expect_invalid_stored_registry(unsupported_status);
    });
}

#[test]
fn abi_registry_stored_lowercase_valid_address_normalizes_to_checksum() {
    with_test_app_dir("abi-registry-stored-address-normalize", |_| {
        write_stored_registry(valid_stored_registry(USDC));

        let state = load_abi_registry_state().expect("load normalized registry");

        assert_eq!(state.cache_entries.len(), 1);
        assert_ne!(state.cache_entries[0].contract_address, USDC);
        assert_eq!(
            state.cache_entries[0].contract_address,
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
        );
        assert_eq!(
            state.cache_entries[0]
                .selector_summary
                .as_ref()
                .and_then(|summary| summary.notes.as_deref()),
            Some("api_key=[redacted]")
        );
        assert_eq!(
            state.cache_entries[0].last_error_summary.as_deref(),
            Some("token=[redacted]")
        );
        assert_eq!(
            state.cache_entries[0].provider_proxy_hint.as_deref(),
            Some("auth [redacted] [redacted]")
        );
    });
}

#[test]
fn abi_registry_cache_entry_normalizes_stale_marks_and_delete_removes_one_version() {
    with_test_app_dir("abi-registry-cache-entry", |_| {
        upsert_abi_data_source_config(data_source_input()).expect("upsert data source");

        let state = upsert_abi_cache_entry(cache_entry_input(USDC, "version-1"))
            .expect("upsert cache entry");
        assert_eq!(state.cache_entries.len(), 1);
        let entry = &state.cache_entries[0];
        assert_ne!(entry.contract_address, USDC);
        assert_eq!(entry.source_kind, "explorerFetched");
        assert_eq!(
            entry.provider_config_id.as_deref(),
            Some("etherscan-mainnet")
        );
        assert!(entry.user_source_id.is_none());
        assert_eq!(entry.version_id, "version-1");
        assert_eq!(entry.attempt_id, "attempt-1");
        assert_eq!(entry.source_fingerprint, "fingerprint-1");
        assert_eq!(entry.abi_hash, "abi-hash-1");
        assert_eq!(entry.validation_status, "selectorConflict");
        assert_eq!(entry.cache_status, "cacheFresh");
        assert_eq!(
            entry
                .selector_summary
                .as_ref()
                .and_then(|summary| summary.notes.as_deref()),
            Some("authorization: [redacted] [redacted]")
        );
        assert_eq!(
            entry.last_error_summary.as_deref(),
            Some("fetch failed api_key=[redacted]")
        );
        let created_at = entry.created_at.clone();

        let state = upsert_abi_cache_entry(UpsertAbiCacheEntryInput {
            attempt_id: "attempt-2".to_string(),
            abi_hash: "abi-hash-2".to_string(),
            ..cache_entry_input(USDC, "version-1")
        })
        .expect("replace same logical cache version");
        assert_eq!(state.cache_entries.len(), 1);
        assert_eq!(state.cache_entries[0].created_at, created_at);
        assert_eq!(state.cache_entries[0].attempt_id, "attempt-2");
        assert_eq!(state.cache_entries[0].abi_hash, "abi-hash-2");

        let state = upsert_abi_cache_entry(cache_entry_input(USDC, "version-2"))
            .expect("upsert second version");
        assert_eq!(state.cache_entries.len(), 2);

        let state = mark_abi_cache_stale(cache_identity("version-1")).expect("mark stale");
        assert_eq!(state.cache_entries.len(), 2);
        let stale = state
            .cache_entries
            .iter()
            .find(|entry| entry.version_id == "version-1")
            .expect("version 1 present");
        assert_eq!(stale.cache_status, "cacheStale");

        let state = delete_abi_cache_entry(cache_identity("version-1")).expect("delete version 1");
        assert_eq!(state.cache_entries.len(), 1);
        assert_eq!(state.cache_entries[0].version_id, "version-2");
    });
}

#[test]
fn abi_registry_secret_like_error_summary_is_sanitized_and_local_only_can_be_empty() {
    with_test_app_dir("abi-registry-sanitize", |_| {
        let state = upsert_abi_data_source_config(UpsertAbiDataSourceConfigInput {
            id: "local-only".to_string(),
            chain_id: 1,
            provider_kind: "localOnly".to_string(),
            base_url: Some("   ".to_string()),
            api_key_ref: Some("   ".to_string()),
            enabled: Some(true),
            last_success_at: None,
            clear_last_success_at: false,
            last_failure_at: Some("1700000003".to_string()),
            clear_last_failure_at: false,
            failure_count: Some(2),
            cooldown_until: None,
            clear_cooldown_until: false,
            rate_limited: Some(true),
            last_error_summary: Some(
                "GET https://api.example.test/api?apikey=real-secret token=also-secret".to_string(),
            ),
            clear_last_error_summary: false,
        })
        .expect("upsert local only");

        let record = &state.data_sources[0];
        assert!(record.base_url.is_none());
        assert!(record.api_key_ref.is_none());
        assert_eq!(
            record.last_error_summary.as_deref(),
            Some("GET [redacted_url] token=[redacted]")
        );
    });
}

#[test]
fn abi_registry_validate_payload_accepts_array_and_explorer_string_without_echoing_abi() {
    with_test_app_dir("abi-registry-validate-success", |_| {
        let abi = transfer_abi();
        let validation = validate_abi_payload(ValidateAbiPayloadInput {
            payload: abi.clone(),
        })
        .expect("validate standard ABI");

        assert_eq!(validation.fetch_source_status, "ok");
        assert_eq!(validation.validation_status, "ok");
        assert_eq!(validation.function_count, 1);
        assert_eq!(validation.event_count, 1);
        assert_eq!(validation.error_count, 1);
        assert!(validation
            .abi_hash
            .as_deref()
            .unwrap_or_default()
            .starts_with("0x"));
        let returned = serde_json::to_string(&validation).expect("validation json");
        assert!(!returned.contains("transfer"));
        assert!(!returned.contains("InsufficientBalance"));

        let explorer_validation = validate_abi_payload(ValidateAbiPayloadInput {
            payload: explorer_abi_response(&abi),
        })
        .expect("validate explorer ABI string");
        assert_eq!(explorer_validation.validation_status, "ok");
        assert_eq!(explorer_validation.abi_hash, validation.abi_hash);
    });
}

#[test]
fn abi_registry_validate_payload_rejects_malformed_non_array_empty_oversize_and_bad_items() {
    with_test_app_dir("abi-registry-validate-failures", |_| {
        let malformed = validate_abi_payload(ValidateAbiPayloadInput {
            payload: "{ nope".to_string(),
        })
        .expect("malformed json returns read model");
        assert_eq!(malformed.validation_status, "parseFailed");
        assert!(malformed.abi_hash.is_none());

        let non_array = validate_abi_payload(ValidateAbiPayloadInput {
            payload: json!({"abi": []}).to_string(),
        })
        .expect("non-array returns read model");
        assert_eq!(non_array.validation_status, "malformedAbi");

        let empty = validate_abi_payload(ValidateAbiPayloadInput {
            payload: "[]".to_string(),
        })
        .expect("empty returns read model");
        assert_eq!(empty.validation_status, "emptyAbiItems");

        let no_callable = validate_abi_payload(ValidateAbiPayloadInput {
            payload: json!([{ "type": "constructor", "inputs": [] }]).to_string(),
        })
        .expect("constructor-only returns read model");
        assert_eq!(no_callable.validation_status, "emptyAbiItems");

        let oversize = validate_abi_payload(ValidateAbiPayloadInput {
            payload: " ".repeat(ABI_PAYLOAD_SIZE_LIMIT_BYTES + 1),
        })
        .expect("oversize returns read model");
        assert_eq!(oversize.validation_status, "payloadTooLarge");

        let malformed_item = validate_abi_payload(ValidateAbiPayloadInput {
            payload:
                json!([{ "type": "function", "name": "bad", "inputs": [{ "type": "tuple" }] }])
                    .to_string(),
        })
        .expect("malformed item returns read model");
        assert_eq!(malformed_item.validation_status, "malformedAbi");
    });
}

#[test]
fn abi_registry_validate_payload_rejects_invalid_solidity_abi_types_without_caching() {
    with_test_app_dir("abi-registry-invalid-types", |_| {
        for invalid_type in [
            "notatype",
            "uint257",
            "bytes33",
            "uint256[abc]",
            "address[0]",
            "bool[][",
        ] {
            let validation = validate_abi_payload(ValidateAbiPayloadInput {
                payload: json!([
                    { "type": "function", "name": "bad", "inputs": [{ "type": invalid_type }] }
                ])
                .to_string(),
            })
            .expect("invalid type returns read model");

            assert_eq!(
                validation.validation_status, "malformedAbi",
                "{invalid_type} should be rejected"
            );
            assert!(validation.abi_hash.is_none());
        }

        let invalid_tuple = validate_abi_payload(ValidateAbiPayloadInput {
            payload: json!([
                {
                    "type": "function",
                    "name": "badTuple",
                    "inputs": [
                        {
                            "type": "tuple",
                            "components": [{ "name": "inner", "type": "notatype" }]
                        }
                    ]
                }
            ])
            .to_string(),
        })
        .expect("invalid tuple component returns read model");
        assert_eq!(invalid_tuple.validation_status, "malformedAbi");

        let import = import_abi_payload(UserAbiPayloadInput {
            chain_id: 1,
            contract_address: USDC.to_string(),
            payload: json!([
                { "type": "function", "name": "bad", "inputs": [{ "type": "bytes33" }] }
            ])
            .to_string(),
            user_source_id: Some("invalid-type-import".to_string()),
        })
        .expect("invalid import returns read model");
        assert_eq!(import.validation.validation_status, "malformedAbi");
        assert!(import.cache_entry.is_none());
        assert!(load_abi_registry_state()
            .expect("load state")
            .cache_entries
            .is_empty());
    });
}

#[test]
fn abi_registry_validate_payload_reports_duplicate_and_conflicting_selectors() {
    with_test_app_dir("abi-registry-selector-conflicts", |_| {
        let payload = json!([
            { "type": "function", "name": "burn", "inputs": [{ "type": "uint256" }] },
            { "type": "function", "name": "burn", "inputs": [{ "type": "uint256" }] },
            { "type": "function", "name": "collate_propagate_storage", "inputs": [{ "type": "bytes16" }] }
        ])
        .to_string();

        let validation = validate_abi_payload(ValidateAbiPayloadInput { payload })
            .expect("selector conflict validation");

        assert_eq!(validation.validation_status, "selectorConflict");
        let summary = validation.selector_summary;
        assert_eq!(summary.function_selector_count, Some(1));
        assert_eq!(summary.duplicate_selector_count, Some(1));
        assert_eq!(summary.conflict_count, Some(1));
        assert!(summary
            .notes
            .as_deref()
            .unwrap_or_default()
            .contains("selector conflicts"));
    });
}

#[test]
fn abi_registry_validate_payload_canonicalizes_selector_type_aliases() {
    with_test_app_dir("abi-registry-selector-aliases", |_| {
        let payload = json!([
            { "type": "function", "name": "takesUint", "inputs": [{ "type": "uint" }] },
            { "type": "function", "name": "takesUint", "inputs": [{ "type": "uint256" }] },
            { "type": "function", "name": "takesInt", "inputs": [{ "type": "int" }] },
            { "type": "function", "name": "takesInt", "inputs": [{ "type": "int256" }] },
            { "type": "function", "name": "takesFixed", "inputs": [{ "type": "fixed" }] },
            { "type": "function", "name": "takesFixed", "inputs": [{ "type": "fixed128x18" }] },
            { "type": "function", "name": "takesUfixed", "inputs": [{ "type": "ufixed" }] },
            { "type": "function", "name": "takesUfixed", "inputs": [{ "type": "ufixed128x18" }] },
            {
                "type": "function",
                "name": "takesTupleAliases",
                "inputs": [{
                    "type": "tuple[]",
                    "components": [
                        { "name": "amount", "type": "uint" },
                        { "name": "delta", "type": "int" }
                    ]
                }]
            },
            {
                "type": "function",
                "name": "takesTupleAliases",
                "inputs": [{
                    "type": "tuple[]",
                    "components": [
                        { "name": "amount", "type": "uint256" },
                        { "name": "delta", "type": "int256" }
                    ]
                }]
            }
        ])
        .to_string();

        let validation = validate_abi_payload(ValidateAbiPayloadInput { payload })
            .expect("selector aliases validate");

        assert_eq!(validation.validation_status, "selectorConflict");
        let summary = validation.selector_summary;
        assert_eq!(summary.function_selector_count, Some(5));
        assert_eq!(summary.duplicate_selector_count, Some(5));
        assert_eq!(summary.conflict_count, Some(0));
    });
}

#[test]
fn abi_registry_import_and_paste_preserve_source_kind_write_artifact_and_hide_payload() {
    with_test_app_dir("abi-registry-import-paste", |dir| {
        let import = import_abi_payload(UserAbiPayloadInput {
            chain_id: 1,
            contract_address: USDC.to_string(),
            payload: transfer_abi(),
            user_source_id: Some("manual-file".to_string()),
        })
        .expect("import ABI");
        let import_entry = import.cache_entry.as_ref().expect("import cache entry");
        assert_eq!(import_entry.source_kind, "userImported");
        assert_eq!(import_entry.user_source_id.as_deref(), Some("manual-file"));
        assert_eq!(import_entry.fetch_source_status, "ok");
        assert_eq!(import_entry.cache_status, "cacheFresh");

        let artifact = dir.join("abi-artifacts").join(format!(
            "{}.json",
            import_entry.abi_hash.trim_start_matches("0x")
        ));
        assert!(artifact.exists());

        let state_json = serde_json::to_string(&import.state).expect("state json");
        assert!(!state_json.contains("transfer"));
        assert!(!state_json.contains("inputs"));

        let paste = paste_abi_payload(UserAbiPayloadInput {
            chain_id: 1,
            contract_address: USDC.to_string(),
            payload: transfer_abi(),
            user_source_id: Some("manual-paste".to_string()),
        })
        .expect("paste ABI");
        let paste_entry = paste.cache_entry.as_ref().expect("paste cache entry");
        assert_eq!(paste_entry.source_kind, "userPasted");
        assert_eq!(paste_entry.user_source_id.as_deref(), Some("manual-paste"));
    });
}

#[test]
fn abi_registry_import_sanitizes_absolute_user_source_id_before_returning_or_persisting() {
    with_test_app_dir("abi-registry-user-source-sanitize", |dir| {
        let absolute_source = dir
            .join("private")
            .join("wallet-secret-source.abi.json")
            .to_string_lossy()
            .to_string();

        let result = import_abi_payload(UserAbiPayloadInput {
            chain_id: 1,
            contract_address: USDC.to_string(),
            payload: transfer_abi(),
            user_source_id: Some(absolute_source.clone()),
        })
        .expect("import ABI with local path source");

        let entry = result.cache_entry.as_ref().expect("cache entry");
        let sanitized_source = entry.user_source_id.as_deref().expect("source id");
        assert!(sanitized_source.starts_with("user-source-"));
        assert!(!sanitized_source.contains('/'));
        assert!(!sanitized_source.contains('\\'));
        assert!(!sanitized_source.contains("wallet-secret-source"));

        let returned = serde_json::to_string(&result).expect("result json");
        assert!(!returned.contains(&absolute_source));
        assert!(!returned.contains("wallet-secret-source"));

        let registry_raw =
            fs::read_to_string(abi_registry_path().expect("registry path")).expect("registry raw");
        assert!(!registry_raw.contains(&absolute_source));
        assert!(!registry_raw.contains("wallet-secret-source"));

        let artifact = dir
            .join("abi-artifacts")
            .join(format!("{}.json", entry.abi_hash.trim_start_matches("0x")));
        let artifact_raw = fs::read_to_string(artifact).expect("artifact raw");
        assert!(!artifact_raw.contains(&absolute_source));
        assert!(!artifact_raw.contains("wallet-secret-source"));

        let loaded = load_abi_registry_state().expect("load state");
        assert_eq!(
            loaded.cache_entries[0].user_source_id.as_deref(),
            Some(sanitized_source)
        );
    });
}

#[test]
fn abi_registry_valid_new_versions_supersede_same_source_and_block_cross_source_conflict() {
    with_test_app_dir("abi-registry-selection-conflicts", |_| {
        let first = import_abi_payload(UserAbiPayloadInput {
            chain_id: 1,
            contract_address: USDC.to_string(),
            payload: transfer_abi(),
            user_source_id: Some("manual-file".to_string()),
        })
        .expect("first import");
        assert_eq!(
            first
                .cache_entry
                .as_ref()
                .expect("first entry")
                .selection_status,
            "selected"
        );

        let second = import_abi_payload(UserAbiPayloadInput {
            chain_id: 1,
            contract_address: USDC.to_string(),
            payload: approve_abi(),
            user_source_id: Some("manual-file".to_string()),
        })
        .expect("second import");
        assert_eq!(second.state.cache_entries.len(), 2);
        assert!(second.state.cache_entries.iter().any(|entry| {
            entry.cache_status == "versionSuperseded" && entry.selection_status == "unselected"
        }));
        assert_eq!(
            second
                .cache_entry
                .as_ref()
                .expect("second entry")
                .selection_status,
            "selected"
        );

        let server = serve_once("200 OK", explorer_abi_response(&transfer_abi()));
        upsert_abi_data_source_config(UpsertAbiDataSourceConfigInput {
            id: "local-etherscan-conflict".to_string(),
            chain_id: 1,
            provider_kind: "etherscanCompatible".to_string(),
            base_url: Some(server.url.clone()),
            api_key_ref: None,
            enabled: Some(true),
            last_success_at: None,
            clear_last_success_at: false,
            last_failure_at: None,
            clear_last_failure_at: false,
            failure_count: None,
            cooldown_until: None,
            clear_cooldown_until: false,
            rate_limited: None,
            last_error_summary: None,
            clear_last_error_summary: false,
        })
        .expect("upsert explorer source");

        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        let fetched = runtime
            .block_on(fetch_explorer_abi(FetchExplorerAbiInput {
                chain_id: 1,
                contract_address: USDC.to_string(),
                provider_config_id: Some("local-etherscan-conflict".to_string()),
            }))
            .expect("fetch conflicting ABI");
        let _ = server.request_rx.recv().expect("captured request");
        server.join.join().expect("server joined");
        let fetched_entry = fetched.cache_entry.as_ref().expect("fetched entry");
        assert!(!fetched_entry.selected);
        assert_eq!(fetched_entry.selection_status, "sourceConflict");
    });
}

#[test]
fn abi_registry_fetch_returns_not_configured_and_local_only_unsupported_without_rpc_fallback() {
    with_test_app_dir("abi-registry-fetch-config-failures", |_| {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        let missing = runtime
            .block_on(fetch_explorer_abi(FetchExplorerAbiInput {
                chain_id: 1,
                contract_address: USDC.to_string(),
                provider_config_id: None,
            }))
            .expect("not configured read model");
        assert_eq!(missing.validation.fetch_source_status, "notConfigured");
        assert!(missing.cache_entry.is_none());

        upsert_abi_data_source_config(UpsertAbiDataSourceConfigInput {
            id: "local-only".to_string(),
            chain_id: 1,
            provider_kind: "localOnly".to_string(),
            base_url: None,
            api_key_ref: None,
            enabled: Some(true),
            last_success_at: None,
            clear_last_success_at: false,
            last_failure_at: None,
            clear_last_failure_at: false,
            failure_count: None,
            cooldown_until: None,
            clear_cooldown_until: false,
            rate_limited: None,
            last_error_summary: None,
            clear_last_error_summary: false,
        })
        .expect("upsert local source");

        let unsupported = runtime
            .block_on(fetch_explorer_abi(FetchExplorerAbiInput {
                chain_id: 1,
                contract_address: USDC.to_string(),
                provider_config_id: Some("local-only".to_string()),
            }))
            .expect("local only unsupported read model");
        assert_eq!(
            unsupported.validation.fetch_source_status,
            "unsupportedChain"
        );
        assert_eq!(
            unsupported.validation.diagnostics.failure_class.as_deref(),
            Some("unsupportedProvider")
        );
        assert!(unsupported.cache_entry.is_none());
    });
}

#[test]
fn abi_registry_fetch_etherscan_success_uses_env_key_sanitizes_and_writes_artifact() {
    with_test_app_dir("abi-registry-fetch-success", |dir| {
        let server = serve_once("200 OK", explorer_abi_response(&transfer_abi()));
        std::env::set_var("ABI_REGISTRY_TEST_KEY", "super-secret-test-key");
        upsert_abi_data_source_config(UpsertAbiDataSourceConfigInput {
            id: "local-etherscan".to_string(),
            chain_id: 1,
            provider_kind: "etherscanCompatible".to_string(),
            base_url: Some(server.url.clone()),
            api_key_ref: Some("env:ABI_REGISTRY_TEST_KEY".to_string()),
            enabled: Some(true),
            last_success_at: None,
            clear_last_success_at: false,
            last_failure_at: None,
            clear_last_failure_at: false,
            failure_count: None,
            cooldown_until: None,
            clear_cooldown_until: false,
            rate_limited: None,
            last_error_summary: None,
            clear_last_error_summary: false,
        })
        .expect("upsert etherscan source");

        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        let result = runtime
            .block_on(fetch_explorer_abi(FetchExplorerAbiInput {
                chain_id: 1,
                contract_address: USDC.to_string(),
                provider_config_id: Some("local-etherscan".to_string()),
            }))
            .expect("fetch ABI");
        let request = server.request_rx.recv().expect("captured request");
        server.join.join().expect("server joined");
        std::env::remove_var("ABI_REGISTRY_TEST_KEY");

        assert!(request.contains("module=contract"));
        assert!(request.contains("action=getabi"));
        assert!(request.contains("address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"));
        assert!(request.contains("apikey=super-secret-test-key"));

        assert_eq!(result.validation.fetch_source_status, "ok");
        assert_eq!(result.validation.validation_status, "ok");
        assert_eq!(
            result.validation.diagnostics.provider_kind.as_deref(),
            Some("etherscanCompatible")
        );
        assert_eq!(
            result.validation.diagnostics.host.as_deref(),
            Some(
                server
                    .url
                    .trim_start_matches("http://")
                    .trim_end_matches("/api")
            )
        );

        let entry = result.cache_entry.as_ref().expect("cache entry");
        assert_eq!(entry.source_kind, "explorerFetched");
        assert_eq!(entry.provider_config_id.as_deref(), Some("local-etherscan"));
        let artifact = dir
            .join("abi-artifacts")
            .join(format!("{}.json", entry.abi_hash.trim_start_matches("0x")));
        assert!(artifact.exists());

        let returned = serde_json::to_string(&result).expect("result json");
        assert!(!returned.contains("super-secret-test-key"));
        assert!(!returned.contains("transfer"));
    });
}

#[test]
fn abi_registry_fetch_custom_indexer_uses_configured_endpoint_and_safe_response_contract() {
    with_test_app_dir("abi-registry-fetch-custom-indexer", |_| {
        let server = serve_once("200 OK", transfer_abi());
        upsert_abi_data_source_config(UpsertAbiDataSourceConfigInput {
            id: "custom-indexer".to_string(),
            chain_id: 1,
            provider_kind: "customIndexer".to_string(),
            base_url: Some(server.url.clone()),
            api_key_ref: None,
            enabled: Some(true),
            last_success_at: None,
            clear_last_success_at: false,
            last_failure_at: None,
            clear_last_failure_at: false,
            failure_count: None,
            cooldown_until: None,
            clear_cooldown_until: false,
            rate_limited: None,
            last_error_summary: None,
            clear_last_error_summary: false,
        })
        .expect("upsert custom indexer source");

        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        let result = runtime
            .block_on(fetch_explorer_abi(FetchExplorerAbiInput {
                chain_id: 1,
                contract_address: USDC.to_string(),
                provider_config_id: Some("custom-indexer".to_string()),
            }))
            .expect("fetch custom indexer ABI");
        let request = server.request_rx.recv().expect("captured request");
        server.join.join().expect("server joined");

        assert!(request.contains("module=contract"));
        assert!(request.contains("action=getabi"));
        assert!(request.contains("address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"));
        assert_eq!(result.validation.fetch_source_status, "ok");
        assert_eq!(result.validation.validation_status, "ok");
        assert_eq!(
            result.validation.diagnostics.provider_kind.as_deref(),
            Some("customIndexer")
        );
        assert_eq!(
            result
                .cache_entry
                .as_ref()
                .and_then(|entry| entry.provider_config_id.as_deref()),
            Some("custom-indexer")
        );

        let malformed_server = serve_once("200 OK", json!({ "abi": [] }).to_string());
        upsert_abi_data_source_config(UpsertAbiDataSourceConfigInput {
            id: "custom-indexer-malformed".to_string(),
            chain_id: 1,
            provider_kind: "customIndexer".to_string(),
            base_url: Some(malformed_server.url.clone()),
            api_key_ref: None,
            enabled: Some(true),
            last_success_at: None,
            clear_last_success_at: false,
            last_failure_at: None,
            clear_last_failure_at: false,
            failure_count: None,
            cooldown_until: None,
            clear_cooldown_until: false,
            rate_limited: None,
            last_error_summary: None,
            clear_last_error_summary: false,
        })
        .expect("upsert malformed custom indexer source");

        let malformed = runtime
            .block_on(fetch_explorer_abi(FetchExplorerAbiInput {
                chain_id: 1,
                contract_address: USDC.to_string(),
                provider_config_id: Some("custom-indexer-malformed".to_string()),
            }))
            .expect("fetch malformed custom indexer response");
        let _ = malformed_server
            .request_rx
            .recv()
            .expect("captured malformed request");
        malformed_server.join.join().expect("server joined");
        assert_eq!(
            malformed.validation.fetch_source_status,
            "malformedResponse"
        );
        assert!(malformed.cache_entry.is_none());
    });
}

#[test]
fn abi_registry_fetch_rejects_oversized_explorer_responses_before_persisting() {
    with_test_app_dir("abi-registry-fetch-oversized-response", |_| {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");

        for (id, server) in [
            (
                "oversized-content-length",
                serve_once_with_content_length(
                    "200 OK",
                    "{}".to_string(),
                    ABI_PAYLOAD_SIZE_LIMIT_BYTES as u64 + 1,
                ),
            ),
            (
                "oversized-stream",
                serve_once_without_content_length(
                    "200 OK",
                    " ".repeat(ABI_PAYLOAD_SIZE_LIMIT_BYTES + 1),
                ),
            ),
        ] {
            upsert_abi_data_source_config(UpsertAbiDataSourceConfigInput {
                id: id.to_string(),
                chain_id: 1,
                provider_kind: "blockscoutCompatible".to_string(),
                base_url: Some(server.url.clone()),
                api_key_ref: None,
                enabled: Some(true),
                last_success_at: None,
                clear_last_success_at: false,
                last_failure_at: None,
                clear_last_failure_at: false,
                failure_count: None,
                cooldown_until: None,
                clear_cooldown_until: false,
                rate_limited: None,
                last_error_summary: None,
                clear_last_error_summary: false,
            })
            .expect("upsert oversized source");

            let result = runtime
                .block_on(fetch_explorer_abi(FetchExplorerAbiInput {
                    chain_id: 1,
                    contract_address: USDC.to_string(),
                    provider_config_id: Some(id.to_string()),
                }))
                .expect("oversized fetch returns read model");
            let _ = server.request_rx.recv().expect("captured request");
            server.join.join().expect("server joined");

            assert_eq!(result.validation.fetch_source_status, "malformedResponse");
            assert_eq!(result.validation.validation_status, "payloadTooLarge");
            assert_eq!(
                result.validation.diagnostics.failure_class.as_deref(),
                Some("payloadTooLarge")
            );
            assert!(result.cache_entry.is_none());
        }

        assert!(load_abi_registry_state()
            .expect("load state")
            .cache_entries
            .is_empty());
    });
}

#[test]
fn abi_registry_fetch_does_not_persist_when_provider_config_changes_during_request() {
    with_test_app_dir("abi-registry-fetch-stale-provider-config", |_| {
        let server = serve_once_after_release("200 OK", explorer_abi_response(&transfer_abi()));
        upsert_abi_data_source_config(UpsertAbiDataSourceConfigInput {
            id: "stale-provider".to_string(),
            chain_id: 1,
            provider_kind: "etherscanCompatible".to_string(),
            base_url: Some(server.url.clone()),
            api_key_ref: None,
            enabled: Some(true),
            last_success_at: None,
            clear_last_success_at: false,
            last_failure_at: None,
            clear_last_failure_at: false,
            failure_count: None,
            cooldown_until: None,
            clear_cooldown_until: false,
            rate_limited: None,
            last_error_summary: None,
            clear_last_error_summary: false,
        })
        .expect("upsert initial source");

        let fetch_handle = thread::spawn(|| {
            let runtime = tokio::runtime::Runtime::new().expect("runtime");
            runtime
                .block_on(fetch_explorer_abi(FetchExplorerAbiInput {
                    chain_id: 1,
                    contract_address: USDC.to_string(),
                    provider_config_id: Some("stale-provider".to_string()),
                }))
                .expect("fetch returns read model")
        });
        let _ = server.request_rx.recv().expect("captured request");

        upsert_abi_data_source_config(UpsertAbiDataSourceConfigInput {
            id: "stale-provider".to_string(),
            chain_id: 1,
            provider_kind: "etherscanCompatible".to_string(),
            base_url: Some("http://127.0.0.1:9/api".to_string()),
            api_key_ref: None,
            enabled: Some(true),
            last_success_at: None,
            clear_last_success_at: false,
            last_failure_at: None,
            clear_last_failure_at: false,
            failure_count: None,
            cooldown_until: None,
            clear_cooldown_until: false,
            rate_limited: None,
            last_error_summary: None,
            clear_last_error_summary: false,
        })
        .expect("change source while fetch is in flight");

        server.release_tx.send(()).expect("release response");
        server.join.join().expect("server joined");
        let result = fetch_handle.join().expect("fetch thread joined");

        assert_eq!(result.validation.fetch_source_status, "fetchFailed");
        assert_eq!(result.validation.validation_status, "notValidated");
        assert_eq!(
            result.validation.diagnostics.failure_class.as_deref(),
            Some("fetchProviderConfigChanged")
        );
        assert!(result.cache_entry.is_none());

        let state = load_abi_registry_state().expect("load state");
        assert!(state.cache_entries.is_empty());
        let provider = state
            .data_sources
            .iter()
            .find(|source| source.id == "stale-provider")
            .expect("provider remains");
        assert_eq!(provider.failure_count, 0);
        assert!(provider.last_failure_at.is_none());
        assert!(provider.last_success_at.is_none());
    });
}

#[test]
fn abi_registry_fetch_maps_rate_limit_not_verified_and_malformed_explorer_responses() {
    with_test_app_dir("abi-registry-fetch-response-failures", |_| {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");

        for (id, body, expected) in [
            (
                "rate-limited",
                json!({ "status": "0", "message": "NOTOK", "result": "Max rate limit reached" })
                    .to_string(),
                "rateLimited",
            ),
            (
                "not-verified",
                json!({ "status": "0", "message": "NOTOK", "result": "Contract source code not verified" })
                    .to_string(),
                "notVerified",
            ),
            ("malformed", "{ nope".to_string(), "malformedResponse"),
        ] {
            let server = serve_once("200 OK", body);
            upsert_abi_data_source_config(UpsertAbiDataSourceConfigInput {
                id: id.to_string(),
                chain_id: 1,
                provider_kind: "blockscoutCompatible".to_string(),
                base_url: Some(server.url.clone()),
                api_key_ref: None,
                enabled: Some(true),
                last_success_at: None,
                clear_last_success_at: false,
                last_failure_at: None,
                clear_last_failure_at: false,
                failure_count: None,
                cooldown_until: None,
                clear_cooldown_until: false,
                rate_limited: None,
                last_error_summary: None,
                clear_last_error_summary: false,
            })
            .expect("upsert failing source");

            let result = runtime
                .block_on(fetch_explorer_abi(FetchExplorerAbiInput {
                    chain_id: 1,
                    contract_address: USDC.to_string(),
                    provider_config_id: Some(id.to_string()),
                }))
                .expect("fetch failure read model");
            let _ = server.request_rx.recv().expect("captured request");
            server.join.join().expect("server joined");
            assert_eq!(result.validation.fetch_source_status, expected);
            assert!(result.cache_entry.is_none());
            let returned = serde_json::to_string(&result).expect("result json");
            assert!(!returned.contains("Contract source code not verified"));
            assert!(!returned.contains("Max rate limit reached"));
        }
    });
}
