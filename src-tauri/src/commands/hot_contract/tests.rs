use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::MutexGuard;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use super::source::{FixtureHotContractSampleProvider, HotContractSampleProvider};
use super::{
    fetch_hot_contract_analysis_impl, fetch_hot_contract_analysis_with_sample_provider,
    normalize_fixture_source_samples, validate_source_outbound_request,
    HotContractAnalysisFetchInput, HotContractSelectedRpcInput, HotContractSourceFetchInput,
    HotContractSourceOutboundRequest, HotContractSourceSample,
};

const CONTRACT: &str = "0x1111111111111111111111111111111111111111";
const TEST_APP_DIR_ENV: &str = "EVM_WALLET_WORKBENCH_APP_DIR";

#[derive(Debug, Clone)]
struct FailingHotContractSampleProvider;

impl HotContractSampleProvider for FailingHotContractSampleProvider {
    fn fetch_samples(
        &self,
        _request: &HotContractSourceOutboundRequest,
    ) -> Result<Vec<HotContractSourceSample>, String> {
        Err("provider failed https://example.invalid?apiKey=secret-token token=abc123".to_string())
    }
}

#[test]
fn rpc_endpoint_fingerprint_matches_existing_frontend_selected_rpc_vector() {
    assert_eq!(
        super::summarize_rpc_endpoint(
            "https://RPC.EXAMPLE.invalid:443/v1?api%5Fkey=secret&token+name=other#frag"
        ),
        "https://rpc.example.invalid"
    );
    assert_eq!(
        super::rpc_endpoint_fingerprint(
            "https://RPC.EXAMPLE.invalid:443/v1?api%5Fkey=secret&token+name=other#frag"
        ),
        "rpc-endpoint-2d3c9403"
    );
    assert_eq!(
        super::rpc_endpoint_fingerprint(
            "https://rpc.example.invalid/v1?api_key=other&token%20name=other"
        ),
        "rpc-endpoint-2d3c9403"
    );
}

#[tokio::test]
async fn fetches_code_identity_without_full_payloads() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-code-identity",
        &[data_source(
            "missing-source",
            1,
            "customIndexer",
            true,
            None,
            false,
            None,
        )],
    );
    let (rpc_url, requests, handle) = start_rpc_server(vec![
        step("eth_chainId", json!("0x1")),
        step("eth_getCode", json!("0x6001600203")),
    ]);

    let result = fetch_hot_contract_analysis_impl(base_input(&rpc_url)).await;
    handle.join().expect("rpc server joins");
    let serialized = serde_json::to_string(&result).expect("serialize result");

    assert_eq!(result.status, "ok");
    assert_eq!(result.contract.address.to_ascii_lowercase(), CONTRACT);
    assert_eq!(result.rpc.actual_chain_id, Some(1));
    assert_eq!(result.code.status, "ok");
    assert_eq!(result.code.byte_length, Some(5));
    assert_eq!(
        result.code.code_hash_version.as_deref(),
        Some("keccak256-v1")
    );
    assert!(result
        .code
        .code_hash
        .as_deref()
        .unwrap_or_default()
        .starts_with("0x"));
    assert!(result.analysis.selectors.is_empty());
    assert!(result.analysis.topics.is_empty());
    assert!(result.decode.items.is_empty());
    assert_eq!(methods(&requests), vec!["eth_chainId", "eth_getCode"]);
    assert!(!serialized.contains("0x6001600203"));
    assert_no_sensitive_payloads(&serialized);
}

#[tokio::test]
async fn missing_source_config_returns_source_unavailable_with_code_identity() {
    let (_app_dir, _dir) = AppDirOverride::with_registry("hot-contract-missing-source", &[]);
    let (rpc_url, _requests, handle) = start_rpc_server(vec![
        step("eth_chainId", json!("0x1")),
        step("eth_getCode", json!("0x6001600203")),
    ]);

    let result = fetch_hot_contract_analysis_impl(base_input(&rpc_url)).await;
    handle.join().expect("rpc server joins");

    assert_eq!(result.status, "sourceUnavailable");
    assert_eq!(result.code.status, "ok");
    assert_eq!(result.code.byte_length, Some(5));
    assert_eq!(result.sources.source.status, "missing");
    assert_eq!(
        result.sources.source.reason.as_deref(),
        Some("sourceProviderMissing")
    );
}

#[tokio::test]
async fn configured_source_fetch_populates_sample_coverage() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-source-samples",
        &[data_source(
            "missing-source",
            1,
            "customIndexer",
            true,
            None,
            false,
            None,
        )],
    );
    let (rpc_url, _requests, handle) = start_rpc_server(vec![
        step("eth_chainId", json!("0x1")),
        step("eth_getCode", json!("0x6001600203")),
    ]);
    let provider = FixtureHotContractSampleProvider::new(vec![
        sample("0xabcdef01"),
        sample("0xabcdef02"),
        sample("0xabcdef03"),
    ]);

    let result = fetch_hot_contract_analysis_with_sample_provider(
        HotContractAnalysisFetchInput {
            source: Some(HotContractSourceFetchInput {
                provider_config_id: Some("missing-source".to_string()),
                limit: Some(2),
                window: Some("24h".to_string()),
                cursor: Some("cursor-1".to_string()),
            }),
            ..base_input(&rpc_url)
        },
        &provider,
    )
    .await;
    handle.join().expect("rpc server joins");

    assert_eq!(result.status, "ok");
    assert_eq!(result.sample_coverage.requested_limit, 2);
    assert_eq!(result.sample_coverage.returned_samples, 2);
    assert_eq!(result.sample_coverage.omitted_samples, 1);
    assert_eq!(result.sample_coverage.source_status, "ok");
}

#[tokio::test]
async fn configured_source_fetch_exposes_normalized_samples_without_calldata() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-source-read-model-samples",
        &[data_source(
            "missing-source",
            1,
            "customIndexer",
            true,
            None,
            false,
            None,
        )],
    );
    let (rpc_url, _requests, handle) = start_rpc_server(vec![
        step("eth_chainId", json!("0x1")),
        step("eth_getCode", json!("0x6001600203")),
    ]);
    let provider = FixtureHotContractSampleProvider::new(vec![sample("0xABCDEF012233")]);

    let result = fetch_hot_contract_analysis_with_sample_provider(
        HotContractAnalysisFetchInput {
            source: Some(HotContractSourceFetchInput {
                provider_config_id: Some("missing-source".to_string()),
                limit: Some(1),
                window: Some("24h".to_string()),
                cursor: None,
            }),
            ..base_input(&rpc_url)
        },
        &provider,
    )
    .await;
    handle.join().expect("rpc server joins");
    let serialized = serde_json::to_string(&result).expect("serialize result");
    let sample = result.samples.first().expect("read model sample");

    assert_eq!(result.status, "ok");
    assert_eq!(
        sample.tx_hash.as_deref(),
        Some(format!("0x{}", "22".repeat(32)).as_str())
    );
    assert_eq!(sample.block_number, Some(123));
    assert_eq!(sample.block_time.as_deref(), Some("2026-04-30T00:00:00Z"));
    assert_eq!(
        sample.from.as_deref(),
        Some("0x2222222222222222222222222222222222222222")
    );
    assert_eq!(sample.to.as_deref(), Some(CONTRACT));
    assert_eq!(sample.value.as_deref(), Some("0"));
    assert_eq!(sample.status.as_deref(), Some("success"));
    assert_eq!(sample.selector.as_deref(), Some("0xabcdef01"));
    assert_eq!(sample.calldata_length, Some(6));
    assert!(sample
        .calldata_hash
        .as_deref()
        .unwrap_or_default()
        .starts_with("0x"));
    assert_eq!(sample.log_topic0, vec![format!("0x{}", "33".repeat(32))]);
    assert_eq!(sample.provider_label.as_deref(), Some("fixture"));
    assert!(sample.calldata.is_none());
    assert!(!serialized.contains("ABCDEF012233"));
    assert!(!serialized.contains("abcdef012233"));
    assert!(!serialized.contains("\"calldata\""));
}

#[tokio::test]
async fn source_provider_errors_are_redacted_and_source_unavailable() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-source-provider-error",
        &[data_source(
            "missing-source",
            1,
            "customIndexer",
            true,
            None,
            false,
            None,
        )],
    );
    let (rpc_url, _requests, handle) = start_rpc_server(vec![
        step("eth_chainId", json!("0x1")),
        step("eth_getCode", json!("0x6001600203")),
    ]);

    let result = fetch_hot_contract_analysis_with_sample_provider(
        base_input(&rpc_url),
        &FailingHotContractSampleProvider,
    )
    .await;
    handle.join().expect("rpc server joins");
    let serialized = serde_json::to_string(&result).expect("serialize result");

    assert_eq!(result.status, "sourceUnavailable");
    assert_eq!(result.sources.source.status, "unavailable");
    assert_eq!(
        result.sources.source.reason.as_deref(),
        Some("sourceFetchFailed")
    );
    assert_eq!(result.sample_coverage.requested_limit, 25);
    assert_eq!(result.sample_coverage.source_status, "unavailable");
    assert!(!serialized.contains("secret-token"));
    assert!(!serialized.contains("abc123"));
}

#[tokio::test]
async fn rejects_invalid_contract_address_before_remote_lookup() {
    let result = fetch_hot_contract_analysis_impl(HotContractAnalysisFetchInput {
        contract_address: "not-an-address".to_string(),
        selected_rpc: None,
        ..base_input("http://127.0.0.1:9/rpc?apiKey=super-secret-token")
    })
    .await;
    let serialized = serde_json::to_string(&result).expect("serialize result");

    assert_eq!(result.status, "validationError");
    assert!(result
        .reasons
        .iter()
        .any(|reason| reason == "contractAddress must be a 20-byte 0x-prefixed hex address"));
    assert!(!serialized.contains("super-secret-token"));
}

#[tokio::test]
async fn rejects_missing_selected_rpc_before_remote_lookup() {
    let result = fetch_hot_contract_analysis_impl(HotContractAnalysisFetchInput {
        selected_rpc: None,
        ..base_input("http://127.0.0.1:9/rpc?apiKey=super-secret-token")
    })
    .await;
    let serialized = serde_json::to_string(&result).expect("serialize result");

    assert_eq!(result.status, "validationError");
    assert!(result
        .reasons
        .iter()
        .any(|reason| reason == "selectedRpc is required for hot contract analysis fetch"));
    assert!(!serialized.contains("super-secret-token"));
}

#[tokio::test]
async fn rejects_wrong_chain_before_code_lookup() {
    let (rpc_url, requests, handle) = start_rpc_server(vec![step("eth_chainId", json!("0x5"))]);

    let result = fetch_hot_contract_analysis_impl(base_input(&rpc_url)).await;
    handle.join().expect("rpc server joins");

    assert_eq!(result.status, "chainMismatch");
    assert_eq!(result.rpc.actual_chain_id, Some(5));
    assert_eq!(result.sources.chain_id.status, "chainMismatch");
    assert_eq!(methods(&requests), vec!["eth_chainId"]);
}

#[tokio::test]
async fn returns_code_absent_for_empty_code() {
    let (rpc_url, _requests, handle) = start_rpc_server(vec![
        step("eth_chainId", json!("0x1")),
        step("eth_getCode", json!("0x")),
    ]);

    let result = fetch_hot_contract_analysis_impl(base_input(&rpc_url)).await;
    handle.join().expect("rpc server joins");

    assert_eq!(result.status, "codeAbsent");
    assert_eq!(result.code.status, "empty");
    assert_eq!(result.code.byte_length, Some(0));
    assert_eq!(result.sources.code.status, "codeAbsent");
}

#[tokio::test]
async fn provider_failure_redacts_rpc_secrets() {
    let (rpc_url, _requests, handle) = start_rpc_server(vec![error_step(
        "eth_chainId",
        "backend unavailable token=secret-token api_key=abc123 https://rpc.invalid/path?apiKey=secret",
    )]);

    let result = fetch_hot_contract_analysis_impl(base_input(&rpc_url)).await;
    handle.join().expect("rpc server joins");
    let serialized = serde_json::to_string(&result).expect("serialize result");

    assert_eq!(result.status, "rpcFailure");
    assert_no_sensitive_payloads(&serialized);
    assert!(!serialized.contains("secret-token"));
    assert!(!serialized.contains("abc123"));
    assert!(serialized.contains("[redacted]") || serialized.contains("[redacted_url]"));
}

#[test]
fn validates_minimal_source_outbound_request_shape() {
    let request = validate_source_outbound_request(
        1,
        "etherscan-mainnet",
        CONTRACT,
        HotContractSourceFetchInput {
            provider_config_id: Some("etherscan-mainnet".to_string()),
            limit: Some(500),
            window: Some("24h".to_string()),
            cursor: Some("cursor-1".to_string()),
        },
    )
    .expect("valid request");
    let serialized = serde_json::to_string(&request).expect("serialize request");

    assert!(serialized.contains("etherscan-mainnet"));
    assert!(serialized.contains(CONTRACT));
    assert!(serialized.contains("500"));
    assert!(!serialized.contains("accountLabel"));
    assert!(!serialized.contains("notes"));
    assert!(!serialized.contains("wallet"));
    assert!(!serialized.contains("watchlist"));
    assert!(!serialized.contains("abiCatalog"));
}

#[test]
fn fixture_samples_are_bounded_and_omissions_counted() {
    let samples = vec![
        sample("0xabcdef01"),
        sample("0xabcdef02"),
        sample("0xabcdef03"),
        sample("0xabcdef04"),
    ];
    let provider = FixtureHotContractSampleProvider::new(samples.clone());
    let request = validate_source_outbound_request(
        1,
        "fixture",
        CONTRACT,
        HotContractSourceFetchInput {
            provider_config_id: Some("fixture".to_string()),
            limit: Some(2),
            window: None,
            cursor: None,
        },
    )
    .expect("valid request");

    let normalized = normalize_fixture_source_samples(
        provider.fetch_samples(&request).expect("fixture samples"),
        2,
    );

    assert_eq!(normalized.samples.len(), 2);
    assert_eq!(normalized.omitted_count, 2);
    assert!(normalized
        .samples
        .iter()
        .all(|sample| sample.calldata.is_none() && sample.calldata_hash.is_some()));
}

#[test]
fn fixture_sample_normalization_sanitizes_serialized_fields() {
    let normalized = normalize_fixture_source_samples(
        vec![HotContractSourceSample {
            chain_id: 1,
            contract_address: format!("  {CONTRACT}  "),
            tx_hash: Some(format!("  0x{}  ", "22".repeat(32))),
            block_time: Some(" 2026-04-30T00:00:00Z ".to_string()),
            from: Some(" 0x2222222222222222222222222222222222222222 ".to_string()),
            to: Some(format!(" {CONTRACT} ")),
            value: Some(" 123 ".to_string()),
            status: Some(" success ".to_string()),
            selector: None,
            calldata: Some(" 0xABCDEF012233 ".to_string()),
            calldata_length: None,
            calldata_hash: None,
            log_topic0: vec![
                format!("  0x{}  ", "33".repeat(32)),
                "token=secret-token https://example.invalid?apiKey=secret".to_string(),
            ],
            provider_label: Some(" fixture ".to_string()),
            block_number: Some(123),
        }],
        10,
    );
    let sample = normalized.samples.first().expect("normalized sample");
    let serialized = serde_json::to_string(sample).expect("serialize sample");

    assert_eq!(sample.contract_address, CONTRACT);
    assert_eq!(
        sample.tx_hash.as_deref(),
        Some(format!("0x{}", "22".repeat(32)).as_str())
    );
    assert_eq!(sample.block_time.as_deref(), Some("2026-04-30T00:00:00Z"));
    assert_eq!(
        sample.from.as_deref(),
        Some("0x2222222222222222222222222222222222222222")
    );
    assert_eq!(sample.to.as_deref(), Some(CONTRACT));
    assert_eq!(sample.value.as_deref(), Some("123"));
    assert_eq!(sample.status.as_deref(), Some("success"));
    assert_eq!(sample.selector.as_deref(), Some("0xabcdef01"));
    assert_eq!(sample.calldata_length, Some(6));
    assert!(sample
        .calldata_hash
        .as_deref()
        .unwrap_or_default()
        .starts_with("0x"));
    assert_eq!(sample.provider_label.as_deref(), Some("fixture"));
    assert_eq!(sample.block_number, Some(123));
    assert!(!serialized.contains("ABCDEF012233"));
    assert!(!serialized.contains("secret-token"));
    assert!(!serialized.contains("apiKey=secret"));
}

#[test]
fn loads_configured_sampling_sources_from_abi_registry_records() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-source-configured",
        &[
            data_source(
                "configured-mainnet",
                1,
                "customIndexer",
                true,
                None,
                false,
                None,
            ),
            data_source(
                "configured-goerli",
                5,
                "customIndexer",
                true,
                None,
                false,
                None,
            ),
        ],
    );

    let status = super::source::resolve_source_status(
        1,
        Some(&HotContractSourceFetchInput {
            provider_config_id: Some("configured-mainnet".to_string()),
            limit: Some(25),
            window: None,
            cursor: None,
        }),
        None,
    );

    assert_eq!(status.status, "ok");
}

#[test]
fn explorer_configured_abi_data_source_can_be_sampling_source() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-source-explorer-configured",
        &[data_source(
            "configured-explorer",
            1,
            "explorerConfigured",
            true,
            None,
            false,
            None,
        )],
    );

    let status = super::source::resolve_source_status(
        1,
        Some(&HotContractSourceFetchInput {
            provider_config_id: Some("configured-explorer".to_string()),
            limit: Some(25),
            window: None,
            cursor: None,
        }),
        None,
    );

    assert_eq!(status.status, "ok");
}

#[test]
fn unusable_abi_data_source_configs_cannot_be_sampling_sources() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-source-unusable",
        &[
            data_source("disabled", 1, "customIndexer", false, None, false, None),
            data_source("wrong-chain", 5, "customIndexer", true, None, false, None),
            data_source(
                "rate-limited",
                1,
                "customIndexer",
                true,
                None,
                true,
                Some("https://example.invalid?apiKey=secret-token"),
            ),
            data_source(
                "stale",
                1,
                "customIndexer",
                true,
                Some("2099-01-01T00:00:00Z"),
                false,
                None,
            ),
            data_source("unsupported", 1, "localOnly", true, None, false, None),
        ],
    );

    assert_source_status("disabled", "disabled", "sourceDisabled");
    assert_source_status("wrong-chain", "wrongChain", "sourceWrongChain");
    assert_source_status("rate-limited", "rateLimited", "sourceRateLimited");
    assert_source_status("stale", "stale", "sourceStale");
    assert_source_status("unsupported", "unsupported", "sourceUnsupported");
    assert_source_status("missing", "missing", "sourceProviderMissing");

    let rate_limited = source_status_for("rate-limited");
    let serialized = serde_json::to_string(&rate_limited).expect("serialize status");
    assert!(!serialized.contains("secret-token"));
}

fn base_input(rpc_url: &str) -> HotContractAnalysisFetchInput {
    HotContractAnalysisFetchInput {
        rpc_url: rpc_url.to_string(),
        chain_id: 1,
        contract_address: CONTRACT.to_string(),
        selected_rpc: Some(selected_rpc(rpc_url)),
        source: Some(HotContractSourceFetchInput {
            provider_config_id: Some("missing-source".to_string()),
            limit: Some(25),
            window: Some("24h".to_string()),
            cursor: None,
        }),
    }
}

fn selected_rpc(rpc_url: &str) -> HotContractSelectedRpcInput {
    HotContractSelectedRpcInput {
        chain_id: Some(1),
        provider_config_id: Some("provider-mainnet".to_string()),
        endpoint_id: Some("endpoint-primary".to_string()),
        endpoint_name: Some("Primary".to_string()),
        endpoint_summary: Some(super::summarize_rpc_endpoint(rpc_url)),
        endpoint_fingerprint: Some(super::rpc_endpoint_fingerprint(rpc_url)),
    }
}

fn sample(calldata: &str) -> HotContractSourceSample {
    HotContractSourceSample {
        chain_id: 1,
        contract_address: CONTRACT.to_string(),
        tx_hash: Some(format!("0x{}", "22".repeat(32))),
        block_time: Some("2026-04-30T00:00:00Z".to_string()),
        from: Some("0x2222222222222222222222222222222222222222".to_string()),
        to: Some(CONTRACT.to_string()),
        value: Some("0".to_string()),
        status: Some("success".to_string()),
        selector: None,
        calldata: Some(calldata.to_string()),
        calldata_length: None,
        calldata_hash: None,
        log_topic0: vec![format!("0x{}", "33".repeat(32))],
        provider_label: Some("fixture".to_string()),
        block_number: Some(123),
    }
}

fn source_status_for(provider_config_id: &str) -> super::HotContractSourceStatus {
    super::source::resolve_source_status(
        1,
        Some(&HotContractSourceFetchInput {
            provider_config_id: Some(provider_config_id.to_string()),
            limit: Some(25),
            window: None,
            cursor: None,
        }),
        None,
    )
}

fn assert_source_status(provider_config_id: &str, status: &str, reason: &str) {
    let source_status = source_status_for(provider_config_id);
    assert_eq!(source_status.status, status);
    assert_eq!(source_status.reason.as_deref(), Some(reason));
}

fn data_source(
    id: &str,
    chain_id: u64,
    provider_kind: &str,
    enabled: bool,
    cooldown_until: Option<&str>,
    rate_limited: bool,
    last_error_summary: Option<&str>,
) -> Value {
    json!({
        "id": id,
        "chainId": chain_id,
        "providerKind": provider_kind,
        "baseUrl": if provider_kind == "localOnly" { Value::Null } else { json!("https://example.invalid/api") },
        "apiKeyRef": Value::Null,
        "enabled": enabled,
        "lastSuccessAt": Value::Null,
        "lastFailureAt": Value::Null,
        "failureCount": 0,
        "cooldownUntil": cooldown_until,
        "rateLimited": rate_limited,
        "lastErrorSummary": last_error_summary,
        "createdAt": "2026-04-30T00:00:00Z",
        "updatedAt": "2026-04-30T00:00:00Z"
    })
}

struct AppDirOverride {
    previous: Option<OsString>,
    dir: PathBuf,
    _guard: MutexGuard<'static, ()>,
}

impl AppDirOverride {
    fn with_registry(test_name: &str, data_sources: &[Value]) -> (Self, PathBuf) {
        let guard = crate::storage::test_app_dir_env_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("test clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "evm-wallet-workbench-{test_name}-{}-{suffix}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create app dir");
        let previous = std::env::var_os(TEST_APP_DIR_ENV);
        std::env::set_var(TEST_APP_DIR_ENV, &dir);
        fs::write(
            dir.join("abi-registry.json"),
            json!({
                "schemaVersion": 1,
                "dataSources": data_sources,
                "cacheEntries": []
            })
            .to_string(),
        )
        .expect("write abi registry");
        (
            Self {
                previous,
                dir: dir.clone(),
                _guard: guard,
            },
            dir,
        )
    }
}

impl Drop for AppDirOverride {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
        if let Some(previous) = self.previous.take() {
            std::env::set_var(TEST_APP_DIR_ENV, previous);
        } else {
            std::env::remove_var(TEST_APP_DIR_ENV);
        }
    }
}

#[derive(Clone)]
struct RpcStep {
    method: &'static str,
    response: RpcResponse,
}

#[derive(Clone)]
enum RpcResponse {
    Result(Value),
    Error(&'static str),
}

fn step(method: &'static str, response: Value) -> RpcStep {
    RpcStep {
        method,
        response: RpcResponse::Result(response),
    }
}

fn error_step(method: &'static str, message: &'static str) -> RpcStep {
    RpcStep {
        method,
        response: RpcResponse::Error(message),
    }
}

fn start_rpc_server(
    steps: Vec<RpcStep>,
) -> (String, Arc<Mutex<Vec<Value>>>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind rpc server");
    let addr = listener.local_addr().expect("local addr");
    let requests = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&requests);
    let handle = thread::spawn(move || {
        for step in steps {
            let (mut stream, _) = listener.accept().expect("accept request");
            let request = read_http_request(&mut stream).expect("read request");
            let body = request
                .split("\r\n\r\n")
                .nth(1)
                .expect("request body")
                .to_string();
            let value: Value = serde_json::from_str(&body).expect("json rpc request");
            assert_eq!(
                value.get("method").and_then(Value::as_str),
                Some(step.method)
            );
            captured.lock().expect("request lock").push(value.clone());
            let id = value.get("id").cloned().unwrap_or_else(|| json!(1));
            let response = match step.response {
                RpcResponse::Result(result) => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": result,
                }),
                RpcResponse::Error(message) => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32000, "message": message },
                }),
            };
            write_http_response(&mut stream, &response.to_string()).expect("write response");
        }
    });
    (
        format!("http://{addr}/rpc?apiKey=super-secret-token"),
        requests,
        handle,
    )
}

fn read_http_request(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut bytes = Vec::new();
    let mut buffer = [0; 1024];
    let body_start = loop {
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            break http_body_start(&bytes).unwrap_or(bytes.len());
        }
        bytes.extend_from_slice(&buffer[..read]);
        if let Some(body_start) = http_body_start(&bytes) {
            break body_start;
        }
    };
    let headers = String::from_utf8_lossy(&bytes[..body_start]);
    if let Some(content_length) = http_content_length(&headers) {
        let expected_request_len = body_start + content_length;
        while bytes.len() < expected_request_len {
            let read = stream.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..read]);
        }
    }
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn write_http_response(stream: &mut TcpStream, body: &str) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

fn http_body_start(bytes: &[u8]) -> Option<usize> {
    bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
}

fn http_content_length(headers: &str) -> Option<usize> {
    headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("content-length") {
            value.trim().parse::<usize>().ok()
        } else {
            None
        }
    })
}

fn methods(requests: &Arc<Mutex<Vec<Value>>>) -> Vec<String> {
    requests
        .lock()
        .expect("request lock")
        .iter()
        .filter_map(|request| request.get("method").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

fn assert_no_sensitive_payloads(serialized: &str) {
    assert!(!serialized.contains("super-secret-token"));
    assert!(!serialized.contains("apiKey=super-secret-token"));
    assert!(!serialized.contains("0xabcdef01"));
    assert!(!serialized.contains("local label"));
    assert!(!serialized.contains("wallet inventory"));
}
