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

#[derive(Debug, Clone, Default)]
struct CapturingHotContractSampleProvider {
    request: Arc<Mutex<Option<HotContractSourceOutboundRequest>>>,
}

impl HotContractSampleProvider for CapturingHotContractSampleProvider {
    fn fetch_samples(
        &self,
        request: &HotContractSourceOutboundRequest,
    ) -> Result<Vec<HotContractSourceSample>, String> {
        *self.request.lock().expect("capture request") = Some(request.clone());
        Ok(vec![sample("0xa9059cbb")])
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
async fn valid_seed_tx_hash_round_trips_as_read_model_provenance_without_source_outbound() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-seed-provenance",
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
    let seed = format!("0x{}", "A".repeat(64));
    let normalized_seed = seed.to_ascii_lowercase();
    let provider = CapturingHotContractSampleProvider::default();
    let captured = provider.request.clone();

    let result = fetch_hot_contract_analysis_with_sample_provider(
        HotContractAnalysisFetchInput {
            seed_tx_hash: Some(seed),
            ..base_input(&rpc_url)
        },
        &provider,
    )
    .await;
    handle.join().expect("rpc server joins");

    assert_eq!(result.status, "ok");
    assert_eq!(
        result.seed_tx_hash.as_deref(),
        Some(normalized_seed.as_str())
    );
    let outbound = captured
        .lock()
        .expect("captured request lock")
        .clone()
        .expect("source outbound request captured");
    let outbound_json = serde_json::to_string(&outbound).expect("serialize outbound");
    assert_eq!(outbound.provider_config_id, "missing-source");
    assert!(!outbound_json.contains("seed"));
    assert!(!outbound_json.contains(&normalized_seed));
}

#[tokio::test]
async fn selected_rpc_provider_config_id_is_not_source_fallback() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-selected-rpc-not-source",
        &[data_source(
            "provider-mainnet",
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
    let provider = CapturingHotContractSampleProvider::default();
    let captured = provider.request.clone();

    let result = fetch_hot_contract_analysis_with_sample_provider(
        HotContractAnalysisFetchInput {
            source: Some(HotContractSourceFetchInput {
                provider_config_id: None,
                limit: Some(25),
                window: Some("24h".to_string()),
                cursor: None,
            }),
            ..base_input(&rpc_url)
        },
        &provider,
    )
    .await;
    handle.join().expect("rpc server joins");

    assert_ne!(result.sources.source.status, "ok");
    assert_eq!(
        result.sources.source.reason.as_deref(),
        Some("sourceProviderMissing")
    );
    assert!(captured.lock().expect("captured request lock").is_none());
}

#[tokio::test]
async fn invalid_seed_tx_hash_returns_validation_error() {
    let result = fetch_hot_contract_analysis_impl(HotContractAnalysisFetchInput {
        seed_tx_hash: Some("0x1234".to_string()),
        ..base_input("http://127.0.0.1:9/rpc")
    })
    .await;

    assert_eq!(result.status, "validationError");
    assert_eq!(result.seed_tx_hash, None);
    assert_eq!(
        result.error_summary.as_deref(),
        Some("seedTxHash must be a 32-byte 0x-prefixed hex transaction hash")
    );
}

#[tokio::test]
async fn aggregates_selector_rows_with_advisory_classifications() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-selector-aggregation",
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
        sample_with(
            "0xa9059cbb",
            "success",
            "0",
            "0x1111",
            100,
            "2026-04-30T00:00:00Z",
        ),
        sample_with(
            "0xa9059cbb",
            "reverted",
            "5",
            "0x2222",
            110,
            "2026-04-30T00:05:00Z",
        ),
        sample_with(
            &approve_calldata("01"),
            "success",
            "0",
            "0x3333",
            120,
            "2026-04-30T00:10:00Z",
        ),
        sample_with(
            &approve_calldata("00"),
            "success",
            "0",
            "0x4444",
            130,
            "2026-04-30T00:15:00Z",
        ),
        sample_with(
            "0xe63d38ed",
            "unknown",
            "10",
            "0x5555",
            140,
            "2026-04-30T00:20:00Z",
        ),
        contract_creation_sample("0x6666", 150),
        sample_with(
            "0x12345678",
            "success",
            "0",
            "0x7777",
            160,
            "2026-04-30T00:30:00Z",
        ),
    ]);

    let result =
        fetch_hot_contract_analysis_with_sample_provider(base_input(&rpc_url), &provider).await;
    handle.join().expect("rpc server joins");
    let serialized = serde_json::to_string(&result).expect("serialize result");

    let transfer = selector_row(&result, "0xa9059cbb");
    assert_eq!(transfer.sampled_call_count, 2);
    assert_eq!(transfer.sample_share_bps, 2857);
    assert_eq!(transfer.unique_sender_count, Some(1));
    assert_eq!(transfer.success_count, 1);
    assert_eq!(transfer.revert_count, 1);
    assert_eq!(transfer.unknown_status_count, 0);
    assert_eq!(transfer.first_block, Some(100));
    assert_eq!(transfer.last_block, Some(110));
    assert_eq!(
        transfer.native_value,
        super::HotContractNativeValueAggregate {
            sample_count: 2,
            non_zero_count: 1,
            zero_count: 1,
            total_wei: Some("5".to_string()),
        }
    );
    assert_eq!(transfer.example_tx_hashes.len(), 2);
    assert_eq!(transfer.source, "sampledTransactions");
    assert_eq!(transfer.confidence, "medium");
    assert!(transfer
        .advisory_labels
        .contains(&"erc20Transfer".to_string()));

    let approve = selector_row(&result, "0x095ea7b3");
    assert!(approve
        .advisory_labels
        .contains(&"erc20Approval".to_string()));
    assert!(approve
        .advisory_labels
        .contains(&"erc20RevokeCandidate".to_string()));
    let disperse = selector_row(&result, "0xe63d38ed");
    assert!(disperse
        .advisory_labels
        .contains(&"batchDisperse".to_string()));
    let creation = selector_row(&result, "contractCreation");
    assert!(creation
        .advisory_labels
        .contains(&"contractCreation".to_string()));
    let unknown = selector_row(&result, "0x12345678");
    assert!(unknown
        .advisory_labels
        .contains(&"rawCalldataUnknown".to_string()));

    let kinds = classification_kinds(&result);
    assert!(kinds.contains(&"erc20Transfer".to_string()));
    assert!(kinds.contains(&"erc20Approval".to_string()));
    assert!(kinds.contains(&"erc20RevokeCandidate".to_string()));
    assert!(kinds.contains(&"batchDisperse".to_string()));
    assert!(kinds.contains(&"contractCreation".to_string()));
    assert!(kinds.contains(&"rawCalldataUnknown".to_string()));
    assert!(!serialized.contains("11112222"));
    assert_no_sensitive_payloads(&serialized);
}

#[tokio::test]
async fn approve_revoke_candidate_requires_zero_amount_calldata_hint() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-approve-revoke-hint",
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
        sample_with(
            &approve_calldata("01"),
            "success",
            "0",
            "0xaaaa",
            100,
            "2026-04-30T00:00:00Z",
        ),
        sample_with(
            &approve_calldata("00"),
            "success",
            "0",
            "0xbbbb",
            101,
            "2026-04-30T00:01:00Z",
        ),
    ]);

    let result =
        fetch_hot_contract_analysis_with_sample_provider(base_input(&rpc_url), &provider).await;
    handle.join().expect("rpc server joins");
    let serialized = serde_json::to_string(&result).expect("serialize result");

    let approve = selector_row(&result, "0x095ea7b3");
    assert!(approve
        .advisory_labels
        .contains(&"erc20Approval".to_string()));
    assert!(approve
        .advisory_labels
        .contains(&"erc20RevokeCandidate".to_string()));
    assert!(result.samples.iter().any(|sample| {
        sample.selector.as_deref() == Some("0x095ea7b3")
            && sample.approve_amount_is_zero == Some(false)
    }));
    assert!(result.samples.iter().any(|sample| {
        sample.selector.as_deref() == Some("0x095ea7b3")
            && sample.approve_amount_is_zero == Some(true)
    }));
    assert!(!serialized.contains(&"00".repeat(32)));
}

#[tokio::test]
async fn nonzero_approve_gets_approval_label_without_revoke_candidate() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-approve-nonzero",
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
    let provider = FixtureHotContractSampleProvider::new(vec![sample_with(
        &approve_calldata("01"),
        "success",
        "0",
        "0xaaaa",
        100,
        "2026-04-30T00:00:00Z",
    )]);

    let result =
        fetch_hot_contract_analysis_with_sample_provider(base_input(&rpc_url), &provider).await;
    handle.join().expect("rpc server joins");

    let approve = selector_row(&result, "0x095ea7b3");
    assert_eq!(approve.advisory_labels, vec!["erc20Approval".to_string()]);
    let kinds = classification_kinds(&result);
    assert!(kinds.contains(&"erc20Approval".to_string()));
    assert!(!kinds.contains(&"erc20RevokeCandidate".to_string()));
}

#[tokio::test]
async fn aggregates_event_topic_summaries() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-topic-aggregation",
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
        sample_with_topic("0xa9059cbb", ERC20_TRANSFER_TOPIC, "0xaaaa", 100),
        sample_with_topic("0x095ea7b3", ERC20_APPROVAL_TOPIC, "0xbbbb", 105),
        sample_with_topic("0x095ea7b3", ERC20_APPROVAL_TOPIC, "0xcccc", 106),
        sample_with_topic("0x12345678", UNKNOWN_TOPIC, "0xdddd", 107),
    ]);

    let result =
        fetch_hot_contract_analysis_with_sample_provider(base_input(&rpc_url), &provider).await;
    handle.join().expect("rpc server joins");

    let approval = topic_row(&result, ERC20_APPROVAL_TOPIC);
    assert_eq!(approval.log_count, 2);
    assert_eq!(approval.sample_share_bps, 5000);
    assert_eq!(approval.first_block, Some(105));
    assert_eq!(approval.last_block, Some(106));
    assert_eq!(approval.source, "sampledLogs");
    assert_eq!(approval.confidence, "medium");
    assert!(approval
        .advisory_labels
        .contains(&"erc20ApprovalEvent".to_string()));
    assert!(topic_row(&result, ERC20_TRANSFER_TOPIC)
        .advisory_labels
        .contains(&"erc20TransferEvent".to_string()));
    assert!(topic_row(&result, UNKNOWN_TOPIC)
        .advisory_labels
        .contains(&"unknownEventTopic".to_string()));
}

#[tokio::test]
async fn topic_share_uses_log_topic_denominator_not_sample_count() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-topic-share-denominator",
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
    let mut sample = sample("0xa9059cbb");
    sample.log_topic0 = vec![
        ERC20_TRANSFER_TOPIC.to_string(),
        ERC20_TRANSFER_TOPIC.to_string(),
        UNKNOWN_TOPIC.to_string(),
    ];
    let provider = FixtureHotContractSampleProvider::new(vec![sample]);

    let result =
        fetch_hot_contract_analysis_with_sample_provider(base_input(&rpc_url), &provider).await;
    handle.join().expect("rpc server joins");

    let transfer = topic_row(&result, ERC20_TRANSFER_TOPIC);
    assert_eq!(transfer.log_count, 2);
    assert_eq!(transfer.sample_share_bps, 6666);
    assert!(result
        .analysis
        .topics
        .iter()
        .all(|topic| topic.sample_share_bps <= 10_000));
}

#[tokio::test]
async fn abi_cache_artifacts_populate_advisory_decode_items() {
    let abi = json!([
        raw_function("approve", &[("spender", "address"), ("amount", "uint256")]),
        raw_event(
            "Approval",
            &[
                ("owner", "address", true),
                ("spender", "address", true),
                ("value", "uint256", false)
            ]
        )
    ]);
    let (_app_dir, dir) = AppDirOverride::with_registry_and_cache(
        "hot-contract-abi-decode-items",
        &[data_source(
            "missing-source",
            1,
            "customIndexer",
            true,
            None,
            false,
            None,
        )],
        vec![cache_entry("fresh", &abi, |_| {})],
    );
    write_abi_artifact(&dir, &abi);
    let (rpc_url, _requests, handle) = start_rpc_server(vec![
        step("eth_chainId", json!("0x1")),
        step("eth_getCode", json!("0x6001600203")),
    ]);
    let provider = FixtureHotContractSampleProvider::new(vec![sample_with_topic(
        &approve_calldata("00"),
        ERC20_APPROVAL_TOPIC,
        "0xaaaa",
        100,
    )]);

    let result =
        fetch_hot_contract_analysis_with_sample_provider(base_input(&rpc_url), &provider).await;
    handle.join().expect("rpc server joins");

    assert!(result.decode.items.iter().any(|item| {
        item.kind == "function"
            && item.status == "candidate"
            && item.selector.as_deref() == Some("0x095ea7b3")
            && item.signature.as_deref() == Some("approve(address,uint256)")
            && item.source == "abiCache"
            && item.confidence == "advisory"
            && item.abi_version_id.as_deref() == Some("fresh")
            && item.abi_selected == Some(true)
            && item
                .reasons
                .contains(&"abiFunctionSelectorMatch".to_string())
    }));
    assert!(result.decode.items.iter().any(|item| {
        item.kind == "event"
            && item.status == "candidate"
            && item.topic.as_deref() == Some(ERC20_APPROVAL_TOPIC)
            && item.signature.as_deref() == Some("Approval(address,address,uint256)")
            && item.source == "abiCache"
            && item.confidence == "advisory"
            && item.abi_version_id.as_deref() == Some("fresh")
            && item.abi_selected == Some(true)
            && item.reasons.contains(&"abiEventTopicMatch".to_string())
    }));
    assert!(result
        .decode
        .items
        .iter()
        .all(|item| item.confidence == "advisory" && item.source != "truth"));
    assert!(result
        .decode
        .classification_candidates
        .iter()
        .all(|candidate| candidate.confidence != "truth" && candidate.source != "truth"));
}

#[tokio::test]
async fn abi_decoded_custom_selector_removes_unknown_no_decode_candidate() {
    let abi = json!([raw_function("customDoThing", &[("amount", "uint256")])]);
    let (_app_dir, dir) = AppDirOverride::with_registry_and_cache(
        "hot-contract-custom-selector-decode",
        &[data_source(
            "missing-source",
            1,
            "customIndexer",
            true,
            None,
            false,
            None,
        )],
        vec![cache_entry("custom", &abi, |_| {})],
    );
    write_abi_artifact(&dir, &abi);
    let (rpc_url, _requests, handle) = start_rpc_server(vec![
        step("eth_chainId", json!("0x1")),
        step("eth_getCode", json!("0x6001600203")),
    ]);
    let provider = FixtureHotContractSampleProvider::new(vec![sample(&format!(
        "0xdafa4d41{}",
        "00".repeat(32)
    ))]);

    let result =
        fetch_hot_contract_analysis_with_sample_provider(base_input(&rpc_url), &provider).await;
    handle.join().expect("rpc server joins");

    assert!(result.decode.items.iter().any(|item| {
        item.kind == "function"
            && item.selector.as_deref() == Some("0xdafa4d41")
            && item.signature.as_deref() == Some("customDoThing(uint256)")
    }));
    assert!(!result
        .decode
        .classification_candidates
        .iter()
        .any(|candidate| {
            candidate.kind == "rawCalldataUnknown"
                && candidate.selector.as_deref() == Some("0xdafa4d41")
                && candidate
                    .reasons
                    .contains(&"noFunctionDecodeCandidate".to_string())
        }));
}

#[tokio::test]
async fn reports_abi_cache_uncertainties_without_treating_labels_as_truth() {
    let abi = json!([
        raw_function("transfer", &[("to", "address"), ("amount", "uint256")]),
        raw_function("transfer", &[("memo", "bytes32")]),
        raw_event(
            "Transfer",
            &[
                ("from", "address", true),
                ("to", "address", true),
                ("value", "uint256", false)
            ]
        ),
        raw_event(
            "Transfer",
            &[
                ("src", "address", true),
                ("dst", "address", true),
                ("wad", "uint256", false)
            ]
        )
    ]);
    let (_app_dir, dir) = AppDirOverride::with_registry_and_cache(
        "hot-contract-abi-uncertainty",
        &[data_source(
            "missing-source",
            1,
            "customIndexer",
            true,
            None,
            false,
            None,
        )],
        vec![
            cache_entry("fresh", &abi, |entry| {
                entry["validationStatus"] = json!("selectorConflict");
                entry["selectorSummary"] = json!({
                    "functionSelectorCount": 1,
                    "eventTopicCount": 1,
                    "duplicateSelectorCount": 1,
                    "conflictCount": 1,
                    "notes": "duplicate selectors: 1; selector conflicts: 1"
                });
            }),
            cache_entry("stale", &abi, |entry| {
                entry["cacheStatus"] = json!("cacheStale");
            }),
            cache_entry("unverified", &abi, |entry| {
                entry["fetchSourceStatus"] = json!("notVerified");
            }),
            cache_entry("proxy", &abi, |entry| {
                entry["proxyDetected"] = json!(true);
                entry["providerProxyHint"] = json!("implementation may differ");
            }),
        ],
    );
    write_abi_artifact(&dir, &abi);
    let (rpc_url, _requests, handle) = start_rpc_server(vec![
        step("eth_chainId", json!("0x1")),
        step("eth_getCode", json!("0x6001600203")),
    ]);
    let provider = FixtureHotContractSampleProvider::new(vec![
        sample_with(
            "0xa9059cbb",
            "success",
            "0",
            "0xaaaa",
            100,
            "2026-04-30T00:00:00Z",
        ),
        sample_with_topic("0x12345678", ERC20_TRANSFER_TOPIC, "0xbbbb", 101),
    ]);

    let result =
        fetch_hot_contract_analysis_with_sample_provider(base_input(&rpc_url), &provider).await;
    handle.join().expect("rpc server joins");

    let codes = uncertainty_codes(&result);
    assert!(codes.contains(&"selectorCollision".to_string()));
    assert!(codes.contains(&"overloadedSignatures".to_string()));
    assert!(codes.contains(&"staleAbi".to_string()));
    assert!(codes.contains(&"unverifiedAbi".to_string()));
    assert!(codes.contains(&"proxyImplementationUncertainty".to_string()));
    assert!(codes.contains(&"eventDecodeConflict".to_string()));
    assert!(result
        .decode
        .classification_candidates
        .iter()
        .all(|candidate| candidate.confidence != "truth"));
    assert!(result
        .decode
        .classification_candidates
        .iter()
        .all(|candidate| candidate.source != "truth"));
}

#[tokio::test]
async fn reports_sample_quality_uncertainties_for_malformed_missing_partial_and_unknown_data() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-sample-quality-uncertainty",
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
        malformed_calldata_sample(),
        malformed_topic_sample(),
        no_logs_sample("0xa9059cbb"),
        sample_with(
            "0x12345678",
            "success",
            "0",
            "0xaaaa",
            100,
            "2026-04-30T00:00:00Z",
        ),
        sample_with(
            "0xa9059cbb",
            "success",
            "0",
            "0xbbbb",
            101,
            "2026-04-30T00:01:00Z",
        ),
    ]);

    let result = fetch_hot_contract_analysis_with_sample_provider(
        HotContractAnalysisFetchInput {
            source: Some(HotContractSourceFetchInput {
                provider_config_id: Some("missing-source".to_string()),
                limit: Some(4),
                window: Some("24h".to_string()),
                cursor: None,
            }),
            ..base_input(&rpc_url)
        },
        &provider,
    )
    .await;
    handle.join().expect("rpc server joins");

    let codes = uncertainty_codes(&result);
    assert!(codes.contains(&"malformedCalldata".to_string()));
    assert!(codes.contains(&"malformedLog".to_string()));
    assert!(codes.contains(&"missingLogs".to_string()));
    assert!(codes.contains(&"providerPartialSample".to_string()));
    assert!(codes.contains(&"unknownSelector".to_string()));
}

#[tokio::test]
async fn serialized_hot_contract_read_model_excludes_bounded_payloads_and_secrets() {
    let (_app_dir, _dir) = AppDirOverride::with_registry(
        "hot-contract-secret-safety",
        &[data_source(
            "missing-source",
            1,
            "customIndexer",
            true,
            None,
            false,
            Some("provider raw response body api_key=leaked queryToken=hidden privateKey=secret mnemonic=seed rawSignedTx=0xf86c secretUrl=https://secret.invalid/path?token=abc"),
        )],
    );
    let (rpc_url, _requests, handle) = start_rpc_server(vec![
        step("eth_chainId", json!("0x1")),
        step("eth_getCode", json!("0x6001600203")),
    ]);
    let provider = FixtureHotContractSampleProvider::new(vec![HotContractSourceSample {
        calldata: Some("0xa9059cbb1111222233334444".to_string()),
        log_topic0: vec![
            ERC20_TRANSFER_TOPIC.to_string(),
            "full logs apiKey=log-secret".to_string(),
        ],
        provider_label: Some("provider raw response body queryToken=hidden".to_string()),
        ..sample("0xa9059cbb")
    }]);

    let result =
        fetch_hot_contract_analysis_with_sample_provider(base_input(&rpc_url), &provider).await;
    handle.join().expect("rpc server joins");
    let serialized = serde_json::to_string(&result).expect("serialize result");

    for forbidden in [
        "1111222233334444",
        "full logs",
        "full revert data",
        "provider raw response body",
        "api_key=leaked",
        "queryToken=hidden",
        "privateKey=secret",
        "mnemonic=seed",
        "rawSignedTx=0xf86c",
        "secretUrl=",
        "log-secret",
        "super-secret-token",
    ] {
        assert!(
            !serialized.contains(forbidden),
            "serialized read model leaked {forbidden}: {serialized}"
        );
    }
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
            window: Some("24H".to_string()),
            cursor: Some("cursor-1".to_string()),
        },
    )
    .expect("valid request");
    let serialized = serde_json::to_string(&request).expect("serialize request");

    assert_eq!(request.window.as_deref(), Some("24h"));
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
fn rejects_unbounded_or_invalid_source_windows() {
    for window in [
        "all-history apiKey=secret",
        "https://example.invalid?apiKey=secret",
        "cursor-1",
        "0h",
        "31d",
        "721h",
    ] {
        let result = validate_source_outbound_request(
            1,
            "etherscan-mainnet",
            CONTRACT,
            HotContractSourceFetchInput {
                provider_config_id: Some("etherscan-mainnet".to_string()),
                limit: Some(25),
                window: Some(window.to_string()),
                cursor: None,
            },
        );

        assert!(result.is_err(), "window should be rejected: {window}");
        assert_eq!(
            result.err().as_deref(),
            Some("source window must be 1h..720h or 1d..30d")
        );
    }
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
            approve_amount_is_zero: None,
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
        seed_tx_hash: None,
        selected_rpc: Some(selected_rpc(rpc_url)),
        source: Some(HotContractSourceFetchInput {
            provider_config_id: Some("missing-source".to_string()),
            limit: Some(25),
            window: Some("24h".to_string()),
            cursor: None,
        }),
    }
}

const ERC20_TRANSFER_TOPIC: &str =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ERC20_APPROVAL_TOPIC: &str =
    "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const UNKNOWN_TOPIC: &str = "0x9999999999999999999999999999999999999999999999999999999999999999";

fn selector_row<'a>(
    result: &'a super::HotContractAnalysisReadModel,
    selector: &str,
) -> &'a super::HotContractSelectorAggregate {
    result
        .analysis
        .selectors
        .iter()
        .find(|row| row.selector == selector)
        .expect("selector aggregate row")
}

fn topic_row<'a>(
    result: &'a super::HotContractAnalysisReadModel,
    topic: &str,
) -> &'a super::HotContractTopicAggregate {
    result
        .analysis
        .topics
        .iter()
        .find(|row| row.topic == topic)
        .expect("topic aggregate row")
}

fn classification_kinds(result: &super::HotContractAnalysisReadModel) -> Vec<String> {
    result
        .decode
        .classification_candidates
        .iter()
        .map(|candidate| candidate.kind.clone())
        .collect()
}

fn uncertainty_codes(result: &super::HotContractAnalysisReadModel) -> Vec<String> {
    result
        .decode
        .uncertainty_statuses
        .iter()
        .map(|status| status.code.clone())
        .collect()
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

fn sample_with(
    selector: &str,
    status: &str,
    value: &str,
    hash_seed: &str,
    block_number: u64,
    block_time: &str,
) -> HotContractSourceSample {
    let mut sample = sample(selector);
    sample.tx_hash = Some(tx_hash_from_seed(hash_seed));
    sample.status = Some(status.to_string());
    sample.value = Some(value.to_string());
    sample.block_number = Some(block_number);
    sample.block_time = Some(block_time.to_string());
    sample
}

fn sample_with_topic(
    selector: &str,
    topic: &str,
    hash_seed: &str,
    block_number: u64,
) -> HotContractSourceSample {
    let mut sample = sample_with(
        selector,
        "success",
        "0",
        hash_seed,
        block_number,
        "2026-04-30T00:00:00Z",
    );
    sample.log_topic0 = vec![topic.to_string()];
    sample
}

fn contract_creation_sample(hash_seed: &str, block_number: u64) -> HotContractSourceSample {
    let mut sample = sample_with(
        "0x60016002",
        "success",
        "0",
        hash_seed,
        block_number,
        "2026-04-30T00:25:00Z",
    );
    sample.to = None;
    sample
}

fn malformed_calldata_sample() -> HotContractSourceSample {
    let mut sample = sample("0xabc");
    sample.calldata = Some("0xabc".to_string());
    sample.selector = None;
    sample
}

fn malformed_topic_sample() -> HotContractSourceSample {
    let mut sample = sample("0x095ea7b3");
    sample.log_topic0 = vec!["0xabc".to_string()];
    sample
}

fn no_logs_sample(selector: &str) -> HotContractSourceSample {
    let mut sample = sample(selector);
    sample.log_topic0 = Vec::new();
    sample
}

fn tx_hash_from_seed(seed: &str) -> String {
    let clean = seed.trim_start_matches("0x");
    format!("0x{:0<64}", clean)
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
        approve_amount_is_zero: None,
        calldata_length: None,
        calldata_hash: None,
        log_topic0: vec![format!("0x{}", "33".repeat(32))],
        provider_label: Some("fixture".to_string()),
        block_number: Some(123),
    }
}

fn approve_calldata(amount_suffix: &str) -> String {
    format!(
        "0x095ea7b3{}{:0>64}",
        "00".repeat(12) + "3333333333333333333333333333333333333333",
        amount_suffix
    )
}

fn raw_function(name: &str, inputs: &[(&str, &str)]) -> Value {
    json!({
        "type": "function",
        "name": name,
        "inputs": inputs.iter().map(|(name, kind)| json!({
            "name": name,
            "type": kind,
        })).collect::<Vec<_>>(),
        "outputs": [],
        "stateMutability": "nonpayable",
    })
}

fn raw_event(name: &str, inputs: &[(&str, &str, bool)]) -> Value {
    json!({
        "type": "event",
        "name": name,
        "anonymous": false,
        "inputs": inputs.iter().map(|(name, kind, indexed)| json!({
            "name": name,
            "type": kind,
            "indexed": indexed,
        })).collect::<Vec<_>>(),
    })
}

fn cache_entry(version_id: &str, abi: &Value, overrides: impl FnOnce(&mut Value)) -> Value {
    let artifact = serde_json::to_string(abi).expect("serialize abi");
    let abi_hash = test_hash_text(&artifact);
    let mut entry = json!({
        "chainId": 1,
        "contractAddress": CONTRACT,
        "sourceKind": "explorerFetched",
        "providerConfigId": "missing-source",
        "userSourceId": Value::Null,
        "versionId": version_id,
        "attemptId": format!("attempt-{version_id}"),
        "sourceFingerprint": format!("fingerprint-{version_id}"),
        "abiHash": abi_hash,
        "selected": true,
        "fetchSourceStatus": "ok",
        "validationStatus": "ok",
        "cacheStatus": "cacheFresh",
        "selectionStatus": "selected",
        "functionCount": 2,
        "eventCount": 1,
        "errorCount": 0,
        "selectorSummary": Value::Null,
        "fetchedAt": "2026-04-30T00:00:00Z",
        "importedAt": Value::Null,
        "lastValidatedAt": "2026-04-30T00:00:00Z",
        "staleAfter": Value::Null,
        "lastErrorSummary": Value::Null,
        "providerProxyHint": Value::Null,
        "proxyDetected": false,
        "createdAt": "2026-04-30T00:00:00Z",
        "updatedAt": "2026-04-30T00:00:00Z"
    });
    overrides(&mut entry);
    entry
}

fn write_abi_artifact(dir: &std::path::Path, abi: &Value) {
    let artifact = serde_json::to_string(abi).expect("serialize abi");
    let abi_hash = test_hash_text(&artifact);
    let artifact_dir = dir.join("abi-artifacts");
    fs::create_dir_all(&artifact_dir).expect("create artifact dir");
    fs::write(
        artifact_dir.join(format!("{}.json", abi_hash.trim_start_matches("0x"))),
        artifact,
    )
    .expect("write artifact");
}

fn test_hash_text(value: &str) -> String {
    use ethers::utils::keccak256;
    format!("0x{}", test_hex_lower(&keccak256(value.as_bytes())))
}

fn test_hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
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
        Self::with_registry_and_cache(test_name, data_sources, Vec::new())
    }

    fn with_registry_and_cache(
        test_name: &str,
        data_sources: &[Value],
        cache_entries: Vec<Value>,
    ) -> (Self, PathBuf) {
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
                "cacheEntries": cache_entries
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
