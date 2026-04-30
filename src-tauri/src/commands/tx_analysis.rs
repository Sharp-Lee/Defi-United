use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::str::FromStr;

use ethers::abi::{decode, Abi, Event, Function, ParamType, RawLog, Token};
use ethers::providers::{Http, Middleware, Provider};
use ethers::types::{Address, H256, U256};
use ethers::utils::{keccak256, to_checksum};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::time::{timeout, Duration};

use crate::commands::abi_registry::{
    load_abi_registry_state_readonly, AbiCacheEntryRecord, AbiSelectorSummaryRecord,
};
use crate::diagnostics::sanitize_diagnostic_message;
use crate::storage::abi_artifact_path_readonly;
use crate::transactions::{
    DISPERSE_ETHER_METHOD, DISPERSE_ETHER_SELECTOR_HEX, DISPERSE_TOKEN_METHOD,
    DISPERSE_TOKEN_SELECTOR_HEX,
};

const CALLDATA_HASH_VERSION: &str = "keccak256-v1";
const CODE_HASH_VERSION: &str = "keccak256-v1";
const LOG_DATA_HASH_VERSION: &str = "keccak256-v1";
const REVERT_DATA_HASH_VERSION: &str = "keccak256-v1";
const LOG_SUMMARY_LIMIT: usize = 16;
const MAX_REVERT_DATA_BYTES: usize = 4096;
const MAX_DECODE_STRING_CHARS: usize = 128;
const MAX_DECODE_ITEMS: usize = 8;
#[cfg(not(test))]
const TX_ANALYSIS_RPC_TIMEOUT_SECONDS: u64 = 10;

const STATUS_OK: &str = "ok";
const STATUS_PARTIAL: &str = "partial";
const STATUS_VALIDATION_ERROR: &str = "validationError";
const STATUS_RPC_FAILURE: &str = "rpcFailure";
const STATUS_CHAIN_MISMATCH: &str = "chainMismatch";
const STATUS_MISSING_TX: &str = "missingTx";
const STATUS_PENDING: &str = "pending";
const STATUS_REVERTED: &str = "reverted";

const SOURCE_NOT_REQUESTED: &str = "notRequested";
const SOURCE_OK: &str = "ok";
const SOURCE_MISSING: &str = "missing";
const SOURCE_PENDING: &str = "pending";
const SOURCE_UNAVAILABLE: &str = "unavailable";
const SOURCE_CHAIN_MISMATCH: &str = "chainMismatch";
const SOURCE_ABSENT: &str = "absent";

const ERC20_TRANSFER_SELECTOR: &str = "0xa9059cbb";
const ERC20_APPROVE_SELECTOR: &str = "0x095ea7b3";
const ERC20_TRANSFER_SIGNATURE: &str = "transfer(address,uint256)";
const ERC20_APPROVE_SIGNATURE: &str = "approve(address,uint256)";
const ERC20_TRANSFER_EVENT_SIGNATURE: &str = "Transfer(address,address,uint256)";
const ERC20_APPROVAL_EVENT_SIGNATURE: &str = "Approval(address,address,uint256)";
const ERROR_STRING_SELECTOR: &str = "0x08c379a0";
const PANIC_UINT_SELECTOR: &str = "0x4e487b71";
const ERROR_STRING_SIGNATURE: &str = "Error(string)";
const PANIC_UINT_SIGNATURE: &str = "Panic(uint256)";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisFetchInput {
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "tx_hash")]
    pub tx_hash: String,
    #[serde(default, alias = "selected_rpc")]
    pub selected_rpc: Option<TxAnalysisSelectedRpcInput>,
    #[serde(default, alias = "bounded_revert_data")]
    pub bounded_revert_data: Option<TxAnalysisBoundedRevertDataInput>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisBoundedRevertDataInput {
    pub data: String,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisSelectedRpcInput {
    #[serde(default, alias = "chain_id")]
    pub chain_id: Option<u64>,
    #[serde(default, alias = "provider_config_id")]
    pub provider_config_id: Option<String>,
    #[serde(default, alias = "endpoint_id")]
    pub endpoint_id: Option<String>,
    #[serde(default, alias = "endpoint_name")]
    pub endpoint_name: Option<String>,
    #[serde(default, alias = "endpoint_summary")]
    pub endpoint_summary: Option<String>,
    #[serde(default, alias = "endpoint_fingerprint")]
    pub endpoint_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisFetchReadModel {
    pub status: String,
    pub reasons: Vec<String>,
    pub hash: String,
    pub chain_id: u64,
    pub rpc: TxAnalysisRpcSummary,
    pub transaction: Option<TxAnalysisTransactionSummary>,
    pub receipt: Option<TxAnalysisReceiptSummary>,
    pub block: Option<TxAnalysisBlockSummary>,
    pub address_codes: Vec<TxAnalysisAddressCodeSummary>,
    pub sources: TxAnalysisSourceStatuses,
    pub analysis: TxAnalysisDecodeReadModel,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisRpcSummary {
    pub endpoint: String,
    pub expected_chain_id: u64,
    pub actual_chain_id: Option<u64>,
    pub chain_status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisTransactionSummary {
    pub hash: String,
    pub from: String,
    pub to: Option<String>,
    pub contract_creation: bool,
    pub nonce: String,
    pub value_wei: String,
    pub selector: Option<String>,
    pub selector_status: String,
    pub calldata_byte_length: u64,
    pub calldata_hash_version: String,
    pub calldata_hash: String,
    pub block_number: Option<u64>,
    pub block_hash: Option<String>,
    pub transaction_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisReceiptSummary {
    pub status: Option<u64>,
    pub status_label: String,
    pub block_number: Option<u64>,
    pub block_hash: Option<String>,
    pub transaction_index: Option<u64>,
    pub gas_used: Option<String>,
    pub effective_gas_price: Option<String>,
    pub contract_address: Option<String>,
    pub logs_status: String,
    pub logs_count: Option<u64>,
    pub logs: Vec<TxAnalysisLogSummary>,
    pub omitted_logs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisLogSummary {
    pub address: String,
    pub log_index: Option<u64>,
    pub topic0: Option<String>,
    pub topics_count: u64,
    pub data_byte_length: u64,
    pub data_hash_version: String,
    pub data_hash: String,
    pub removed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisBlockSummary {
    pub number: Option<u64>,
    pub hash: Option<String>,
    pub timestamp: Option<String>,
    pub base_fee_per_gas: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisAddressCodeSummary {
    pub role: String,
    pub address: String,
    pub status: String,
    pub block_tag: String,
    pub byte_length: Option<u64>,
    pub code_hash_version: Option<String>,
    pub code_hash: Option<String>,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisSourceStatuses {
    pub chain_id: TxAnalysisSourceStatus,
    pub transaction: TxAnalysisSourceStatus,
    pub receipt: TxAnalysisSourceStatus,
    pub logs: TxAnalysisSourceStatus,
    pub block: TxAnalysisSourceStatus,
    pub code: TxAnalysisSourceStatus,
    pub explorer: TxAnalysisSourceStatus,
    pub indexer: TxAnalysisSourceStatus,
    pub local_history: TxAnalysisSourceStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisSourceStatus {
    pub status: String,
    pub reason: Option<String>,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisDecodeReadModel {
    pub status: String,
    pub reasons: Vec<String>,
    pub selector: TxAnalysisSelectorDecodeSummary,
    pub abi_sources: Vec<TxAnalysisAbiSourceSummary>,
    pub function_candidates: Vec<TxAnalysisFunctionDecodeCandidate>,
    pub event_candidates: Vec<TxAnalysisEventDecodeCandidate>,
    pub error_candidates: Vec<TxAnalysisErrorDecodeCandidate>,
    pub classification_candidates: Vec<TxAnalysisClassificationCandidate>,
    pub uncertainty_statuses: Vec<TxAnalysisUncertaintyStatus>,
    pub revert_data_status: String,
    pub revert_data: Option<TxAnalysisRevertDataSummary>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisSelectorDecodeSummary {
    pub selector: Option<String>,
    pub selector_status: String,
    pub selector_match_count: u64,
    pub unique_signature_count: u64,
    pub source_count: u64,
    pub conflict: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisAbiSourceSummary {
    pub contract_address: String,
    pub source_kind: String,
    pub provider_config_id: Option<String>,
    pub user_source_id: Option<String>,
    pub version_id: String,
    pub attempt_id: String,
    pub source_fingerprint: String,
    pub abi_hash: String,
    pub selected: bool,
    pub fetch_source_status: String,
    pub validation_status: String,
    pub cache_status: String,
    pub selection_status: String,
    pub selector_summary: Option<AbiSelectorSummaryRecord>,
    pub artifact_status: String,
    pub proxy_detected: bool,
    pub provider_proxy_hint: Option<String>,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisFunctionDecodeCandidate {
    pub selector: String,
    pub function_signature: String,
    pub source: Option<TxAnalysisAbiSourceSummary>,
    pub source_label: String,
    pub decode_status: String,
    pub confidence: String,
    pub argument_summary: Vec<TxAnalysisDecodedValueSummary>,
    pub statuses: Vec<String>,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisEventDecodeCandidate {
    pub address: String,
    pub log_index: Option<u64>,
    pub topic0: Option<String>,
    pub topics_count: u64,
    pub data_byte_length: u64,
    pub data_hash_version: String,
    pub data_hash: String,
    pub event_signature: String,
    pub source: Option<TxAnalysisAbiSourceSummary>,
    pub source_label: String,
    pub decode_status: String,
    pub confidence: String,
    pub argument_summary: Vec<TxAnalysisDecodedValueSummary>,
    pub statuses: Vec<String>,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisErrorDecodeCandidate {
    pub selector: String,
    pub error_signature: String,
    pub source: Option<TxAnalysisAbiSourceSummary>,
    pub source_label: String,
    pub decode_status: String,
    pub confidence: String,
    pub argument_summary: Vec<TxAnalysisDecodedValueSummary>,
    pub statuses: Vec<String>,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisClassificationCandidate {
    pub kind: String,
    pub label: String,
    pub confidence: String,
    pub source: String,
    pub selector: Option<String>,
    pub signature: Option<String>,
    pub argument_summary: Vec<TxAnalysisDecodedValueSummary>,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisUncertaintyStatus {
    pub code: String,
    pub severity: String,
    pub source: String,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisRevertDataSummary {
    pub source: String,
    pub status: String,
    pub selector: Option<String>,
    pub byte_length: Option<u64>,
    pub data_hash_version: Option<String>,
    pub data_hash: Option<String>,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisDecodedFieldSummary {
    pub name: Option<String>,
    pub value: TxAnalysisDecodedValueSummary,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxAnalysisDecodedValueSummary {
    pub name: Option<String>,
    pub kind: String,
    #[serde(rename = "type")]
    pub type_label: String,
    pub value: Option<String>,
    pub byte_length: Option<usize>,
    pub hash: Option<String>,
    pub items: Option<Vec<TxAnalysisDecodedValueSummary>>,
    pub fields: Option<Vec<TxAnalysisDecodedFieldSummary>>,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
struct NormalizedFetchInput {
    rpc_url: String,
    chain_id: u64,
    tx_hash: String,
    bounded_revert_data: Option<NormalizedRevertData>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedRevertData {
    source: String,
    status: String,
    bytes: Option<Vec<u8>>,
    error_summary: Option<String>,
}

#[derive(Debug, Clone)]
struct ParsedTransaction {
    summary: TxAnalysisTransactionSummary,
    to_address: Option<String>,
    block_number: Option<u64>,
    block_hash: Option<String>,
    calldata: Vec<u8>,
}

#[derive(Debug, Clone)]
struct ParsedReceipt {
    summary: TxAnalysisReceiptSummary,
    block_number: Option<u64>,
    block_hash: Option<String>,
    logs_missing: bool,
    logs: Vec<ParsedLog>,
}

#[derive(Debug, Clone)]
struct ParsedLog {
    summary: TxAnalysisLogSummary,
    topics: Vec<H256>,
    data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExpectedBlockContext {
    number: Option<u64>,
    hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TxAnalysisRpcError {
    Timeout,
    Provider(String),
}

#[derive(Debug, Clone, Default)]
struct AbiDecodeContext {
    sources_by_address: BTreeMap<String, Vec<AbiDecodeSource>>,
    load_error: Option<String>,
}

#[derive(Debug, Clone)]
struct AbiDecodeSource {
    summary: TxAnalysisAbiSourceSummary,
    raw_abi: Option<Value>,
}

#[tauri::command]
pub async fn fetch_tx_analysis(
    input: TxAnalysisFetchInput,
) -> Result<TxAnalysisFetchReadModel, String> {
    Ok(fetch_tx_analysis_impl(input).await)
}

pub async fn fetch_tx_analysis_impl(input: TxAnalysisFetchInput) -> TxAnalysisFetchReadModel {
    let endpoint = summarize_rpc_endpoint(&input.rpc_url);
    let normalized = match normalize_fetch_input(input) {
        Ok(input) => input,
        Err((chain_id, tx_hash, reason)) => {
            let mut model = TxAnalysisFetchReadModel::new(chain_id, tx_hash, endpoint);
            model.status = STATUS_VALIDATION_ERROR.to_string();
            model.push_reason(reason.clone());
            model.error_summary = Some(reason);
            return model;
        }
    };
    let mut model =
        TxAnalysisFetchReadModel::new(normalized.chain_id, normalized.tx_hash.clone(), endpoint);

    let provider = match Provider::<Http>::try_from(normalized.rpc_url.as_str()) {
        Ok(provider) => provider,
        Err(error) => {
            let message = sanitized_summary(format!("rpc provider invalid: {error}"));
            model.status = STATUS_VALIDATION_ERROR.to_string();
            model.push_reason("rpcProviderInvalid");
            model.sources.chain_id =
                TxAnalysisSourceStatus::unavailable("rpcProviderInvalid", Some(message.clone()));
            model.error_summary = Some(message);
            return model;
        }
    };

    let actual_chain_id = match rpc_chain_id_probe(&provider).await {
        Ok(value) => value,
        Err(error) => {
            let timeout = matches!(&error, TxAnalysisRpcError::Timeout);
            let reason = if timeout {
                "chainIdProbeTimeout"
            } else {
                "chainIdProbeFailed"
            };
            let message = error.sanitized_message("rpc chainId probe");
            model.status = STATUS_RPC_FAILURE.to_string();
            model.push_reason(reason);
            model.sources.chain_id =
                TxAnalysisSourceStatus::unavailable(reason, Some(message.clone()));
            model.error_summary = Some(message);
            return model;
        }
    };
    model.rpc.actual_chain_id = Some(actual_chain_id);
    model.rpc.chain_status = SOURCE_OK.to_string();
    model.sources.chain_id = TxAnalysisSourceStatus::ok();

    if actual_chain_id != normalized.chain_id {
        let message = format!(
            "chainId mismatch: expected {}, actual {}",
            normalized.chain_id, actual_chain_id
        );
        model.status = STATUS_CHAIN_MISMATCH.to_string();
        model.push_reason("chainMismatch");
        model.rpc.chain_status = SOURCE_CHAIN_MISMATCH.to_string();
        model.sources.chain_id =
            TxAnalysisSourceStatus::new(SOURCE_CHAIN_MISMATCH, Some("chainMismatch"), None);
        model.error_summary = Some(message);
        return model;
    }

    let tx_value = match rpc_value_request(
        &provider,
        "eth_getTransactionByHash",
        json!([normalized.tx_hash]),
    )
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => {
            model.status = STATUS_MISSING_TX.to_string();
            model.push_reason("transactionMissing");
            model.sources.transaction =
                TxAnalysisSourceStatus::new(SOURCE_MISSING, Some("transactionMissing"), None);
            return model;
        }
        Err(error) => {
            let timeout = matches!(&error, TxAnalysisRpcError::Timeout);
            let reason = if timeout {
                "transactionLookupTimeout"
            } else {
                "transactionLookupFailed"
            };
            let message = error.sanitized_message("transaction lookup");
            model.status = STATUS_RPC_FAILURE.to_string();
            model.push_reason(reason);
            model.sources.transaction =
                TxAnalysisSourceStatus::unavailable(reason, Some(message.clone()));
            model.error_summary = Some(message);
            return model;
        }
    };

    let parsed_transaction = match parse_transaction_summary(&tx_value, &model.hash) {
        Ok(summary) => summary,
        Err(error) => {
            let message = sanitized_summary(format!("transaction response invalid: {error}"));
            model.status = STATUS_RPC_FAILURE.to_string();
            model.push_reason("transactionResponseInvalid");
            model.sources.transaction = TxAnalysisSourceStatus::unavailable(
                "transactionResponseInvalid",
                Some(message.clone()),
            );
            model.error_summary = Some(message);
            return model;
        }
    };
    model.sources.transaction = TxAnalysisSourceStatus::ok();
    model.transaction = Some(parsed_transaction.summary.clone());

    let receipt_value = match rpc_value_request(
        &provider,
        "eth_getTransactionReceipt",
        json!([model.hash.clone()]),
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            let timeout = matches!(&error, TxAnalysisRpcError::Timeout);
            let reason = if timeout {
                "receiptLookupTimeout"
            } else {
                "receiptLookupFailed"
            };
            let message = error.sanitized_message("receipt lookup");
            model.mark_partial(reason);
            model.sources.receipt =
                TxAnalysisSourceStatus::unavailable(reason, Some(message.clone()));
            model.error_summary = Some(message);
            None
        }
    };

    let mut receipt_contract_address = None;
    let mut receipt_block_number = None;
    let mut receipt_block_hash = None;
    let mut parsed_receipt_for_analysis = None;
    if let Some(value) = receipt_value {
        match parse_receipt_summary(&value, &model.hash) {
            Ok(parsed_receipt) => {
                receipt_block_number = parsed_receipt.block_number;
                receipt_block_hash = parsed_receipt.block_hash.clone();
                receipt_contract_address = parsed_receipt.summary.contract_address.clone();
                if parsed_receipt.summary.status == Some(0) {
                    model.status = STATUS_REVERTED.to_string();
                    model.push_reason("receiptReverted");
                } else if model.status == STATUS_OK {
                    model.status = STATUS_OK.to_string();
                }
                model.sources.receipt = TxAnalysisSourceStatus::ok();
                if parsed_receipt.logs_missing {
                    model.mark_partial("missingLogs");
                    model.sources.logs = TxAnalysisSourceStatus::unavailable("missingLogs", None);
                } else {
                    model.sources.logs = TxAnalysisSourceStatus::ok();
                }
                model.receipt = Some(parsed_receipt.summary.clone());
                parsed_receipt_for_analysis = Some(parsed_receipt);
            }
            Err(error) => {
                let message = sanitized_summary(format!("receipt response invalid: {error}"));
                model.mark_partial("receiptResponseInvalid");
                model.sources.receipt = TxAnalysisSourceStatus::unavailable(
                    "receiptResponseInvalid",
                    Some(message.clone()),
                );
                model.error_summary = Some(message);
            }
        }
    } else if model.sources.receipt.status == SOURCE_NOT_REQUESTED {
        model.status = STATUS_PENDING.to_string();
        model.push_reason("receiptPending");
        model.sources.receipt =
            TxAnalysisSourceStatus::new(SOURCE_PENDING, Some("receiptPending"), None);
        model.sources.logs =
            TxAnalysisSourceStatus::new(SOURCE_NOT_REQUESTED, Some("receiptPending"), None);
    }

    let block_context = block_context(
        parsed_transaction.block_number,
        parsed_transaction.block_hash.as_deref(),
        receipt_block_number,
        receipt_block_hash.as_deref(),
    );
    let block_number = block_context
        .as_ref()
        .ok()
        .and_then(|context| context.number);
    match block_context {
        Ok(context) => {
            if let Some(block_number) = context.number {
                fetch_block_summary(&provider, block_number, context.hash.as_deref(), &mut model)
                    .await;
            } else {
                model.sources.block = TxAnalysisSourceStatus::new(
                    SOURCE_NOT_REQUESTED,
                    Some("blockNumberUnavailable"),
                    None,
                );
            }
        }
        Err(reason) => {
            model.mark_partial(reason);
            model.sources.block = TxAnalysisSourceStatus::unavailable(reason, None);
        }
    }

    let code_targets = code_targets(&parsed_transaction, receipt_contract_address.as_deref());
    if code_targets.is_empty() {
        model.sources.code =
            TxAnalysisSourceStatus::new(SOURCE_NOT_REQUESTED, Some("noAddressCodeTarget"), None);
    } else {
        fetch_code_summaries(&provider, &code_targets, block_number, &mut model).await;
    }

    let analysis_addresses = analysis_addresses(
        &parsed_transaction,
        receipt_contract_address.as_deref(),
        parsed_receipt_for_analysis.as_ref(),
    );
    let abi_context = load_abi_decode_context(model.chain_id, &analysis_addresses);
    model.analysis = build_decode_read_model(
        &model,
        &parsed_transaction,
        parsed_receipt_for_analysis.as_ref(),
        &abi_context,
        normalized.bounded_revert_data.as_ref(),
    );

    model
}

impl TxAnalysisFetchReadModel {
    fn new(chain_id: u64, hash: String, endpoint: String) -> Self {
        Self {
            status: STATUS_OK.to_string(),
            reasons: Vec::new(),
            hash,
            chain_id,
            rpc: TxAnalysisRpcSummary {
                endpoint,
                expected_chain_id: chain_id,
                actual_chain_id: None,
                chain_status: SOURCE_NOT_REQUESTED.to_string(),
            },
            transaction: None,
            receipt: None,
            block: None,
            address_codes: Vec::new(),
            sources: TxAnalysisSourceStatuses {
                chain_id: TxAnalysisSourceStatus::not_requested(),
                transaction: TxAnalysisSourceStatus::not_requested(),
                receipt: TxAnalysisSourceStatus::not_requested(),
                logs: TxAnalysisSourceStatus::not_requested(),
                block: TxAnalysisSourceStatus::not_requested(),
                code: TxAnalysisSourceStatus::not_requested(),
                explorer: TxAnalysisSourceStatus::new(
                    SOURCE_ABSENT,
                    Some("notImplementedInP6_1b"),
                    None,
                ),
                indexer: TxAnalysisSourceStatus::new(
                    SOURCE_ABSENT,
                    Some("notImplementedInP6_1b"),
                    None,
                ),
                local_history: TxAnalysisSourceStatus::new(
                    SOURCE_ABSENT,
                    Some("notLoadedInP6_1b"),
                    None,
                ),
            },
            analysis: TxAnalysisDecodeReadModel::new(None, "notRequested"),
            error_summary: None,
        }
    }

    fn push_reason(&mut self, reason: impl Into<String>) {
        let reason = reason.into();
        if !self.reasons.iter().any(|item| item == &reason) {
            self.reasons.push(reason);
        }
    }

    fn mark_partial(&mut self, reason: impl Into<String>) {
        self.push_reason(reason);
        if self.status == STATUS_OK {
            self.status = STATUS_PARTIAL.to_string();
        }
    }
}

impl TxAnalysisDecodeReadModel {
    fn new(selector: Option<String>, selector_status: &str) -> Self {
        Self {
            status: "notAvailable".to_string(),
            reasons: Vec::new(),
            selector: TxAnalysisSelectorDecodeSummary {
                selector,
                selector_status: selector_status.to_string(),
                selector_match_count: 0,
                unique_signature_count: 0,
                source_count: 0,
                conflict: false,
            },
            abi_sources: Vec::new(),
            function_candidates: Vec::new(),
            event_candidates: Vec::new(),
            error_candidates: Vec::new(),
            classification_candidates: Vec::new(),
            uncertainty_statuses: Vec::new(),
            revert_data_status: "notRequested".to_string(),
            revert_data: None,
        }
    }

    fn push_reason(&mut self, reason: impl Into<String>) {
        let reason = reason.into();
        if !self.reasons.iter().any(|item| item == &reason) {
            self.reasons.push(reason);
        }
    }

    fn push_uncertainty(
        &mut self,
        code: &str,
        severity: &str,
        source: &str,
        summary: Option<String>,
    ) {
        if self
            .uncertainty_statuses
            .iter()
            .any(|item| item.code == code && item.source == source)
        {
            return;
        }
        self.uncertainty_statuses.push(TxAnalysisUncertaintyStatus {
            code: code.to_string(),
            severity: severity.to_string(),
            source: source.to_string(),
            summary,
        });
        self.push_reason(code);
    }
}

impl TxAnalysisSourceStatus {
    fn new(status: &str, reason: Option<&str>, error_summary: Option<String>) -> Self {
        Self {
            status: status.to_string(),
            reason: reason.map(str::to_string),
            error_summary,
        }
    }

    fn not_requested() -> Self {
        Self::new(SOURCE_NOT_REQUESTED, None, None)
    }

    fn ok() -> Self {
        Self::new(SOURCE_OK, None, None)
    }

    fn unavailable(reason: &str, error_summary: Option<String>) -> Self {
        Self::new(SOURCE_UNAVAILABLE, Some(reason), error_summary)
    }
}

async fn rpc_value_request(
    provider: &Provider<Http>,
    method: &str,
    params: Value,
) -> Result<Option<Value>, TxAnalysisRpcError> {
    let value: Value = timeout(rpc_timeout_duration(), provider.request(method, params))
        .await
        .map_err(|_| TxAnalysisRpcError::Timeout)?
        .map_err(|error| TxAnalysisRpcError::Provider(error.to_string()))?;
    if value.is_null() {
        Ok(None)
    } else {
        Ok(Some(value))
    }
}

async fn rpc_chain_id_probe(provider: &Provider<Http>) -> Result<u64, TxAnalysisRpcError> {
    timeout(rpc_timeout_duration(), provider.get_chainid())
        .await
        .map_err(|_| TxAnalysisRpcError::Timeout)?
        .map(|value| value.as_u64())
        .map_err(|error| TxAnalysisRpcError::Provider(error.to_string()))
}

#[cfg(test)]
fn rpc_timeout_duration() -> Duration {
    Duration::from_millis(150)
}

#[cfg(not(test))]
fn rpc_timeout_duration() -> Duration {
    Duration::from_secs(TX_ANALYSIS_RPC_TIMEOUT_SECONDS)
}

impl TxAnalysisRpcError {
    fn sanitized_message(&self, stage: &str) -> String {
        match self {
            TxAnalysisRpcError::Timeout => format!("{stage} timed out"),
            TxAnalysisRpcError::Provider(error) => {
                sanitized_summary(format!("{stage} failed: {error}"))
            }
        }
    }
}

async fn fetch_block_summary(
    provider: &Provider<Http>,
    block_number: u64,
    expected_block_hash: Option<&str>,
    model: &mut TxAnalysisFetchReadModel,
) {
    let block_tag = format!("0x{block_number:x}");
    match rpc_value_request(provider, "eth_getBlockByNumber", json!([block_tag, false])).await {
        Ok(Some(value)) => match parse_block_summary(&value) {
            Ok(block) => {
                if block.number != Some(block_number) {
                    model.mark_partial("blockNumberMismatch");
                    model.sources.block =
                        TxAnalysisSourceStatus::unavailable("blockNumberMismatch", None);
                    return;
                }
                if let Some(expected_block_hash) = expected_block_hash {
                    if !block
                        .hash
                        .as_deref()
                        .is_some_and(|hash| hash.eq_ignore_ascii_case(expected_block_hash))
                    {
                        model.mark_partial("blockHashMismatch");
                        model.sources.block =
                            TxAnalysisSourceStatus::unavailable("blockHashMismatch", None);
                        return;
                    }
                }
                model.block = Some(block);
                model.sources.block = TxAnalysisSourceStatus::ok();
            }
            Err(error) => {
                let message = sanitized_summary(format!("block response invalid: {error}"));
                model.mark_partial("blockResponseInvalid");
                model.sources.block = TxAnalysisSourceStatus::unavailable(
                    "blockResponseInvalid",
                    Some(message.clone()),
                );
                if model.error_summary.is_none() {
                    model.error_summary = Some(message);
                }
            }
        },
        Ok(None) => {
            model.mark_partial("blockUnavailable");
            model.sources.block = TxAnalysisSourceStatus::unavailable("blockUnavailable", None);
        }
        Err(error) => {
            let timeout = matches!(&error, TxAnalysisRpcError::Timeout);
            let reason = if timeout {
                "blockLookupTimeout"
            } else {
                "blockLookupFailed"
            };
            let message = error.sanitized_message("block lookup");
            model.mark_partial(reason);
            model.sources.block =
                TxAnalysisSourceStatus::unavailable(reason, Some(message.clone()));
            if model.error_summary.is_none() {
                model.error_summary = Some(message);
            }
        }
    }
}

async fn fetch_code_summaries(
    provider: &Provider<Http>,
    targets: &[(String, String)],
    block_number: Option<u64>,
    model: &mut TxAnalysisFetchReadModel,
) {
    let block_tag = block_number
        .map(|value| format!("0x{value:x}"))
        .unwrap_or_else(|| "latest".to_string());
    let mut all_ok = true;
    let mut first_error_reason = None;
    let mut first_error_summary = None;

    for (role, address) in targets {
        match rpc_value_request(provider, "eth_getCode", json!([address, block_tag])).await {
            Ok(Some(value)) => {
                let Some(code) = value.as_str() else {
                    all_ok = false;
                    first_error_reason.get_or_insert("codeResponseInvalid");
                    let message = "code response must be a hex string".to_string();
                    first_error_summary.get_or_insert_with(|| message.clone());
                    model.mark_partial("codeResponseInvalid");
                    model.address_codes.push(TxAnalysisAddressCodeSummary {
                        role: role.clone(),
                        address: address.clone(),
                        status: SOURCE_UNAVAILABLE.to_string(),
                        block_tag: block_tag.clone(),
                        byte_length: None,
                        code_hash_version: None,
                        code_hash: None,
                        error_summary: Some(message),
                    });
                    continue;
                };
                match decode_hex_bytes(code, "code") {
                    Ok(bytes) => {
                        let code_hash = prefixed_hash(&bytes);
                        model.address_codes.push(TxAnalysisAddressCodeSummary {
                            role: role.clone(),
                            address: address.clone(),
                            status: if bytes.is_empty() {
                                "empty".to_string()
                            } else {
                                SOURCE_OK.to_string()
                            },
                            block_tag: block_tag.clone(),
                            byte_length: Some(bytes.len() as u64),
                            code_hash_version: Some(CODE_HASH_VERSION.to_string()),
                            code_hash: Some(code_hash),
                            error_summary: None,
                        });
                    }
                    Err(error) => {
                        all_ok = false;
                        first_error_reason.get_or_insert("codeResponseInvalid");
                        let message = sanitized_summary(format!("code response invalid: {error}"));
                        first_error_summary.get_or_insert_with(|| message.clone());
                        model.mark_partial("codeResponseInvalid");
                        model.address_codes.push(TxAnalysisAddressCodeSummary {
                            role: role.clone(),
                            address: address.clone(),
                            status: SOURCE_UNAVAILABLE.to_string(),
                            block_tag: block_tag.clone(),
                            byte_length: None,
                            code_hash_version: None,
                            code_hash: None,
                            error_summary: Some(message),
                        });
                    }
                }
            }
            Ok(None) => {
                all_ok = false;
                first_error_reason.get_or_insert("codeUnavailable");
                model.mark_partial("codeUnavailable");
                model.address_codes.push(TxAnalysisAddressCodeSummary {
                    role: role.clone(),
                    address: address.clone(),
                    status: SOURCE_UNAVAILABLE.to_string(),
                    block_tag: block_tag.clone(),
                    byte_length: None,
                    code_hash_version: None,
                    code_hash: None,
                    error_summary: None,
                });
            }
            Err(error) => {
                all_ok = false;
                let timeout = matches!(&error, TxAnalysisRpcError::Timeout);
                let reason = if timeout {
                    "codeLookupTimeout"
                } else {
                    "codeLookupFailed"
                };
                first_error_reason.get_or_insert(reason);
                let message = error.sanitized_message("code lookup");
                first_error_summary.get_or_insert_with(|| message.clone());
                model.mark_partial(reason);
                model.address_codes.push(TxAnalysisAddressCodeSummary {
                    role: role.clone(),
                    address: address.clone(),
                    status: SOURCE_UNAVAILABLE.to_string(),
                    block_tag: block_tag.clone(),
                    byte_length: None,
                    code_hash_version: None,
                    code_hash: None,
                    error_summary: Some(message),
                });
            }
        }
    }

    model.sources.code = if all_ok {
        TxAnalysisSourceStatus::ok()
    } else {
        TxAnalysisSourceStatus::unavailable(
            first_error_reason.unwrap_or("codeLookupFailed"),
            first_error_summary.clone(),
        )
    };
    if model.error_summary.is_none() {
        model.error_summary = first_error_summary;
    }
}

fn normalize_fetch_input(
    input: TxAnalysisFetchInput,
) -> Result<NormalizedFetchInput, (u64, String, String)> {
    let chain_id = input.chain_id;
    let tx_hash_seed = input.tx_hash.trim().to_string();
    if chain_id == 0 {
        return Err((
            chain_id,
            normalize_hash_like(&tx_hash_seed),
            "chainId must be greater than zero".to_string(),
        ));
    }
    let tx_hash = normalize_tx_hash(&tx_hash_seed)
        .map_err(|error| (chain_id, normalize_hash_like(&tx_hash_seed), error))?;
    let selected_rpc = input.selected_rpc.ok_or_else(|| {
        (
            chain_id,
            tx_hash.clone(),
            "selectedRpc is required for tx analysis fetch".to_string(),
        )
    })?;
    validate_selected_rpc(&selected_rpc, chain_id, &input.rpc_url)
        .map_err(|error| (chain_id, tx_hash.clone(), error))?;
    Ok(NormalizedFetchInput {
        rpc_url: input.rpc_url,
        chain_id,
        tx_hash,
        bounded_revert_data: input.bounded_revert_data.map(normalize_bounded_revert_data),
    })
}

fn normalize_bounded_revert_data(input: TxAnalysisBoundedRevertDataInput) -> NormalizedRevertData {
    let source = input
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sanitized_summary)
        .unwrap_or_else(|| "localBoundedInput".to_string());
    match bounded_hex_payload_len(&input.data, "boundedRevertData", MAX_REVERT_DATA_BYTES) {
        Ok(false) => NormalizedRevertData {
            source,
            status: "payloadTooLarge".to_string(),
            bytes: None,
            error_summary: Some(format!(
                "boundedRevertData exceeds {MAX_REVERT_DATA_BYTES} byte limit"
            )),
        },
        Err(error) => NormalizedRevertData {
            source,
            status: "malformed".to_string(),
            bytes: None,
            error_summary: Some(sanitized_summary(error)),
        },
        Ok(true) => match decode_hex_bytes(&input.data, "boundedRevertData") {
            Ok(bytes) if bytes.len() > MAX_REVERT_DATA_BYTES => NormalizedRevertData {
                source,
                status: "payloadTooLarge".to_string(),
                bytes: None,
                error_summary: Some(format!(
                    "boundedRevertData exceeds {MAX_REVERT_DATA_BYTES} byte limit"
                )),
            },
            Ok(bytes) => NormalizedRevertData {
                source,
                status: "present".to_string(),
                bytes: Some(bytes),
                error_summary: None,
            },
            Err(error) => NormalizedRevertData {
                source,
                status: "malformed".to_string(),
                bytes: None,
                error_summary: Some(sanitized_summary(error)),
            },
        },
    }
}

fn validate_selected_rpc(
    selected_rpc: &TxAnalysisSelectedRpcInput,
    chain_id: u64,
    rpc_url: &str,
) -> Result<(), String> {
    let selected_chain_id = selected_rpc
        .chain_id
        .ok_or_else(|| "selectedRpc.chainId is required for tx analysis fetch".to_string())?;
    if selected_chain_id != chain_id {
        return Err("selectedRpc.chainId does not match tx analysis chainId".to_string());
    }

    let endpoint_summary = selected_rpc
        .endpoint_summary
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "selectedRpc.endpointSummary is required for tx analysis fetch".to_string()
        })?;
    if endpoint_summary != summarize_rpc_endpoint(rpc_url) {
        return Err("submitted rpcUrl does not match selectedRpc endpointSummary".to_string());
    }

    let endpoint_fingerprint = selected_rpc
        .endpoint_fingerprint
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "selectedRpc.endpointFingerprint is required for tx analysis fetch".to_string()
        })?;
    if endpoint_fingerprint != rpc_endpoint_fingerprint(rpc_url) {
        return Err("submitted rpcUrl does not match selectedRpc endpointFingerprint".to_string());
    }

    Ok(())
}

fn block_context(
    transaction_block_number: Option<u64>,
    transaction_block_hash: Option<&str>,
    receipt_block_number: Option<u64>,
    receipt_block_hash: Option<&str>,
) -> Result<ExpectedBlockContext, &'static str> {
    if transaction_block_number.is_some()
        && receipt_block_number.is_some()
        && transaction_block_number != receipt_block_number
    {
        return Err("transactionReceiptBlockNumberMismatch");
    }
    if let (Some(transaction_block_hash), Some(receipt_block_hash)) =
        (transaction_block_hash, receipt_block_hash)
    {
        if !transaction_block_hash.eq_ignore_ascii_case(receipt_block_hash) {
            return Err("transactionReceiptBlockHashMismatch");
        }
    }

    Ok(ExpectedBlockContext {
        number: receipt_block_number.or(transaction_block_number),
        hash: receipt_block_hash
            .map(str::to_string)
            .or_else(|| transaction_block_hash.map(str::to_string)),
    })
}

fn parse_transaction_summary(
    value: &Value,
    expected_hash: &str,
) -> Result<ParsedTransaction, String> {
    let hash = required_hash(value, "hash")?;
    if !hash.eq_ignore_ascii_case(expected_hash) {
        return Err("transaction hash did not match requested hash".to_string());
    }
    let from = required_address(value, "from")?;
    let to = optional_address(value, "to")?;
    let nonce = required_quantity_string(value, "nonce")?;
    let value_wei = required_quantity_string(value, "value")?;
    let input = value
        .get("input")
        .or_else(|| value.get("data"))
        .and_then(Value::as_str)
        .unwrap_or("0x");
    let calldata = decode_hex_bytes(input, "input")?;
    let selector = calldata_selector(&calldata);
    let selector_status = calldata_selector_status(&calldata);
    let block_number = optional_quantity_u64(value, "blockNumber")?;
    let block_hash = optional_hash(value, "blockHash")?;
    let transaction_index = optional_quantity_u64(value, "transactionIndex")?;

    Ok(ParsedTransaction {
        summary: TxAnalysisTransactionSummary {
            hash,
            from,
            to: to.clone(),
            contract_creation: to.is_none(),
            nonce,
            value_wei,
            selector,
            selector_status,
            calldata_byte_length: calldata.len() as u64,
            calldata_hash_version: CALLDATA_HASH_VERSION.to_string(),
            calldata_hash: prefixed_hash(&calldata),
            block_number,
            block_hash: block_hash.clone(),
            transaction_index,
        },
        to_address: to,
        block_number,
        block_hash,
        calldata,
    })
}

fn parse_receipt_summary(value: &Value, expected_hash: &str) -> Result<ParsedReceipt, String> {
    let transaction_hash = required_hash(value, "transactionHash")?;
    if !transaction_hash.eq_ignore_ascii_case(expected_hash) {
        return Err("receipt transactionHash did not match requested hash".to_string());
    }
    let status = optional_quantity_u64(value, "status")?;
    let block_number = optional_quantity_u64(value, "blockNumber")?;
    let block_hash = optional_hash(value, "blockHash")?;
    let transaction_index = optional_quantity_u64(value, "transactionIndex")?;
    let gas_used = optional_quantity_string(value, "gasUsed")?;
    let effective_gas_price = optional_quantity_string(value, "effectiveGasPrice")?;
    let contract_address = optional_address(value, "contractAddress")?;
    let (logs_status, logs_count, parsed_logs, omitted_logs, logs_missing) = match value.get("logs")
    {
        Some(Value::Array(logs)) => {
            let logs_count = logs.len() as u64;
            let parsed_logs = logs
                .iter()
                .take(LOG_SUMMARY_LIMIT)
                .map(parse_log)
                .collect::<Result<Vec<_>, _>>()?;
            (
                SOURCE_OK.to_string(),
                Some(logs_count),
                parsed_logs,
                logs_count
                    .checked_sub(LOG_SUMMARY_LIMIT as u64)
                    .filter(|omitted| *omitted > 0),
                false,
            )
        }
        _ => ("missing".to_string(), None, Vec::new(), None, true),
    };

    Ok(ParsedReceipt {
        summary: TxAnalysisReceiptSummary {
            status,
            status_label: receipt_status_label(status).to_string(),
            block_number,
            block_hash: block_hash.clone(),
            transaction_index,
            gas_used,
            effective_gas_price,
            contract_address,
            logs_status,
            logs_count,
            logs: parsed_logs.iter().map(|log| log.summary.clone()).collect(),
            omitted_logs,
        },
        block_number,
        block_hash,
        logs_missing,
        logs: parsed_logs,
    })
}

fn parse_log(value: &Value) -> Result<ParsedLog, String> {
    let address = required_address(value, "address")?;
    let log_index = optional_quantity_u64(value, "logIndex")?;
    let topic_values = value
        .get("topics")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let topic0 = topic_values
        .first()
        .and_then(Value::as_str)
        .map(normalize_hash)
        .transpose()?;
    let topics = topic_values
        .iter()
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| "log topic must be a hash string".to_string())
                .and_then(|topic| {
                    H256::from_str(topic.trim())
                        .map_err(|_| "log topic must be a 32-byte hex hash".to_string())
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let data = value.get("data").and_then(Value::as_str).unwrap_or("0x");
    let data_bytes = decode_hex_bytes(data, "log data")?;
    let removed = value.get("removed").and_then(Value::as_bool);

    Ok(ParsedLog {
        summary: TxAnalysisLogSummary {
            address,
            log_index,
            topic0,
            topics_count: topics.len() as u64,
            data_byte_length: data_bytes.len() as u64,
            data_hash_version: LOG_DATA_HASH_VERSION.to_string(),
            data_hash: prefixed_hash(&data_bytes),
            removed,
        },
        topics,
        data: data_bytes,
    })
}

fn parse_block_summary(value: &Value) -> Result<TxAnalysisBlockSummary, String> {
    Ok(TxAnalysisBlockSummary {
        number: optional_quantity_u64(value, "number")?,
        hash: optional_hash(value, "hash")?,
        timestamp: optional_quantity_string(value, "timestamp")?,
        base_fee_per_gas: optional_quantity_string(value, "baseFeePerGas")?,
    })
}

fn code_targets(
    transaction: &ParsedTransaction,
    receipt_contract_address: Option<&str>,
) -> Vec<(String, String)> {
    if let Some(to) = &transaction.to_address {
        return vec![("to".to_string(), to.clone())];
    }
    receipt_contract_address
        .map(|address| vec![("createdContract".to_string(), address.to_string())])
        .unwrap_or_default()
}

fn analysis_addresses(
    transaction: &ParsedTransaction,
    receipt_contract_address: Option<&str>,
    receipt: Option<&ParsedReceipt>,
) -> BTreeSet<String> {
    let mut addresses = BTreeSet::new();
    if let Some(to) = &transaction.to_address {
        addresses.insert(normalize_address_key(to));
    } else if let Some(address) = receipt_contract_address {
        addresses.insert(normalize_address_key(address));
    }
    if let Some(receipt) = receipt {
        for log in &receipt.logs {
            addresses.insert(normalize_address_key(&log.summary.address));
        }
    }
    addresses
}

fn load_abi_decode_context(chain_id: u64, addresses: &BTreeSet<String>) -> AbiDecodeContext {
    if addresses.is_empty() {
        return AbiDecodeContext::default();
    }

    let state = match load_abi_registry_state_readonly() {
        Ok(state) => state,
        Err(error) => {
            return AbiDecodeContext {
                sources_by_address: BTreeMap::new(),
                load_error: Some(sanitized_summary(error)),
            };
        }
    };

    let mut context = AbiDecodeContext::default();
    for entry in state.cache_entries {
        let address_key = normalize_address_key(&entry.contract_address);
        if entry.chain_id != chain_id || !addresses.contains(&address_key) {
            continue;
        }
        context
            .sources_by_address
            .entry(address_key)
            .or_default()
            .push(load_abi_decode_source(entry));
    }
    for sources in context.sources_by_address.values_mut() {
        sources.sort_by(|left, right| {
            abi_source_sort_key(&left.summary).cmp(&abi_source_sort_key(&right.summary))
        });
    }
    context
}

fn load_abi_decode_source(entry: AbiCacheEntryRecord) -> AbiDecodeSource {
    let mut artifact_status = "ok".to_string();
    let mut error_summary = None;
    let mut raw_abi = None;

    match read_abi_artifact_text(&entry) {
        Ok(artifact) => {
            let actual_hash = hash_text(&artifact);
            if actual_hash != entry.abi_hash {
                artifact_status = "artifactHashDrift".to_string();
                error_summary = Some("ABI artifact hash does not match cache entry".to_string());
            } else {
                match serde_json::from_str::<Value>(&artifact) {
                    Ok(value @ Value::Array(_)) => raw_abi = Some(value),
                    Ok(_) | Err(_) => {
                        artifact_status = "malformedAbiArtifact".to_string();
                        error_summary = Some("ABI artifact could not be parsed".to_string());
                    }
                }
            }
        }
        Err(error) => {
            artifact_status = "artifactUnavailable".to_string();
            error_summary = Some(error);
        }
    }

    AbiDecodeSource {
        summary: abi_source_summary(&entry, artifact_status, error_summary),
        raw_abi,
    }
}

fn read_abi_artifact_text(entry: &AbiCacheEntryRecord) -> Result<String, String> {
    let path = abi_artifact_path_readonly(&entry.abi_hash)
        .map_err(|_| "ABI artifact storage is unavailable".to_string())?;
    fs::read_to_string(path).map_err(|error| artifact_read_error_summary(&error).to_string())
}

fn artifact_read_error_summary(error: &std::io::Error) -> &'static str {
    match error.kind() {
        std::io::ErrorKind::NotFound => "ABI artifact not found",
        std::io::ErrorKind::PermissionDenied => "ABI artifact is not readable",
        _ => "ABI artifact could not be read",
    }
}

fn abi_source_summary(
    entry: &AbiCacheEntryRecord,
    artifact_status: String,
    error_summary: Option<String>,
) -> TxAnalysisAbiSourceSummary {
    TxAnalysisAbiSourceSummary {
        contract_address: entry.contract_address.clone(),
        source_kind: entry.source_kind.clone(),
        provider_config_id: entry.provider_config_id.clone(),
        user_source_id: entry.user_source_id.clone(),
        version_id: entry.version_id.clone(),
        attempt_id: entry.attempt_id.clone(),
        source_fingerprint: entry.source_fingerprint.clone(),
        abi_hash: entry.abi_hash.clone(),
        selected: entry.selected,
        fetch_source_status: entry.fetch_source_status.clone(),
        validation_status: entry.validation_status.clone(),
        cache_status: entry.cache_status.clone(),
        selection_status: entry.selection_status.clone(),
        selector_summary: entry.selector_summary.clone(),
        artifact_status,
        proxy_detected: entry.proxy_detected,
        provider_proxy_hint: entry.provider_proxy_hint.clone(),
        error_summary: error_summary
            .or_else(|| entry.last_error_summary.as_deref().map(sanitized_summary)),
    }
}

fn abi_source_sort_key(
    source: &TxAnalysisAbiSourceSummary,
) -> (String, String, String, String, String) {
    (
        source.contract_address.to_ascii_lowercase(),
        source.source_kind.clone(),
        source.provider_config_id.clone().unwrap_or_default(),
        source.user_source_id.clone().unwrap_or_default(),
        source.version_id.clone(),
    )
}

fn build_decode_read_model(
    model: &TxAnalysisFetchReadModel,
    transaction: &ParsedTransaction,
    receipt: Option<&ParsedReceipt>,
    abi_context: &AbiDecodeContext,
    bounded_revert_data: Option<&NormalizedRevertData>,
) -> TxAnalysisDecodeReadModel {
    let mut analysis = TxAnalysisDecodeReadModel::new(
        transaction.summary.selector.clone(),
        &transaction.summary.selector_status,
    );
    analysis.status = "unknown".to_string();
    if let Some(error) = &abi_context.load_error {
        analysis.push_uncertainty(
            "abiRegistryUnavailable",
            "warning",
            "abiCache",
            Some(error.clone()),
        );
    }

    analysis.abi_sources = abi_context
        .sources_by_address
        .values()
        .flat_map(|sources| sources.iter().map(|source| source.summary.clone()))
        .collect();
    analysis
        .abi_sources
        .sort_by(|left, right| abi_source_sort_key(left).cmp(&abi_source_sort_key(right)));
    analysis
        .abi_sources
        .dedup_by(|left, right| abi_source_sort_key(left) == abi_source_sort_key(right));

    let source_summaries = analysis.abi_sources.clone();
    add_source_uncertainties(&mut analysis, &source_summaries);

    let target_sources = transaction
        .to_address
        .as_deref()
        .map(normalize_address_key)
        .and_then(|address| abi_context.sources_by_address.get(&address))
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    add_error_candidates(&mut analysis, bounded_revert_data, target_sources);

    if model.sources.logs.status == SOURCE_UNAVAILABLE {
        analysis.push_uncertainty("missingLogs", "warning", "rpcReceipt", None);
    }
    if receipt.and_then(|receipt| receipt.summary.status) == Some(0)
        && bounded_revert_data.is_none()
    {
        analysis.revert_data_status = "unavailable".to_string();
        analysis.push_uncertainty(
            "revertDataUnavailable",
            "warning",
            "rpcReceipt",
            Some("receipt is reverted but no bounded revert data source is available".to_string()),
        );
    }

    if transaction.summary.contract_creation {
        analysis
            .classification_candidates
            .push(classification_candidate(
                "contractCreation",
                "Contract creation",
                "high",
                "rpcTransaction",
                transaction.summary.selector.clone(),
                None,
                Vec::new(),
                vec!["transactionToIsNull"],
            ));
        analysis.push_uncertainty(
            "contractCreationUnknownInitCode",
            "warning",
            "rpcTransaction",
            Some("contract creation init code is not semantically decoded".to_string()),
        );
        add_event_candidates(&mut analysis, receipt, abi_context);
        finalize_decode_status(&mut analysis);
        return analysis;
    }

    if transaction.summary.selector_status == "short" {
        analysis.push_uncertainty(
            "malformedCalldata",
            "warning",
            "rpcTransaction",
            Some("calldata is shorter than a 4-byte selector".to_string()),
        );
        analysis
            .classification_candidates
            .push(classification_candidate(
                "rawCalldataUnknown",
                "Unknown raw calldata",
                "low",
                "rpcTransaction",
                None,
                None,
                Vec::new(),
                vec!["selectorTooShort"],
            ));
        add_event_candidates(&mut analysis, receipt, abi_context);
        finalize_decode_status(&mut analysis);
        return analysis;
    }

    if transaction.summary.selector.is_none() {
        if transaction.to_address.is_some() {
            analysis
                .classification_candidates
                .push(classification_candidate(
                    "nativeTransfer",
                    "Native transfer",
                    "high",
                    "rpcTransaction",
                    None,
                    None,
                    vec![scalar_summary(
                        Some("valueWei".to_string()),
                        "uint",
                        "uint256".to_string(),
                        Some(transaction.summary.value_wei.clone()),
                        false,
                    )],
                    vec!["emptyCalldata"],
                ));
        }
        add_event_candidates(&mut analysis, receipt, abi_context);
        finalize_decode_status(&mut analysis);
        return analysis;
    }

    let selector = transaction.summary.selector.clone().unwrap_or_default();
    analysis.selector.source_count = target_sources.len() as u64;
    analysis
        .function_candidates
        .extend(builtin_function_candidates(
            &selector,
            &transaction.calldata,
        ));
    analysis.function_candidates.extend(abi_function_candidates(
        &selector,
        &transaction.calldata,
        target_sources,
    ));

    apply_function_selector_conflicts(&mut analysis);
    if analysis.function_candidates.iter().any(|candidate| {
        candidate
            .statuses
            .iter()
            .any(|status| status == "malformedCalldata")
    }) {
        analysis.push_uncertainty(
            "malformedCalldata",
            "warning",
            "rpcTransaction",
            Some("calldata could not be decoded by at least one selector candidate".to_string()),
        );
    }

    add_function_classifications(&mut analysis, &transaction.summary);
    add_event_candidates(&mut analysis, receipt, abi_context);

    if !analysis
        .function_candidates
        .iter()
        .any(|candidate| candidate.decode_status == "decoded")
    {
        if analysis.function_candidates.is_empty() {
            analysis.push_uncertainty("unknownSelector", "warning", "abiCache", None);
        }
        analysis
            .classification_candidates
            .push(classification_candidate(
                "rawCalldataUnknown",
                "Unknown raw calldata",
                "low",
                "rpcTransaction",
                Some(selector),
                None,
                Vec::new(),
                vec!["noFunctionDecodeCandidate"],
            ));
    }

    finalize_decode_status(&mut analysis);
    analysis
}

fn add_source_uncertainties(
    analysis: &mut TxAnalysisDecodeReadModel,
    sources: &[TxAnalysisAbiSourceSummary],
) {
    for source in sources {
        if source.fetch_source_status == "notVerified" {
            analysis.push_uncertainty(
                "unverifiedAbi",
                "warning",
                "abiCache",
                Some(format!("ABI source version {}", source.version_id)),
            );
        } else if source.fetch_source_status != "ok" {
            analysis.push_uncertainty(
                &source.fetch_source_status,
                "warning",
                "abiCache",
                Some(format!("ABI source version {}", source.version_id)),
            );
        }
        if source.cache_status != "cacheFresh" {
            analysis.push_uncertainty(
                "staleAbi",
                "warning",
                "abiCache",
                Some(format!(
                    "ABI source version {} cache status {}",
                    source.version_id, source.cache_status
                )),
            );
        }
        if source.validation_status == "selectorConflict" {
            analysis.push_uncertainty(
                "selectorCollision",
                "warning",
                "abiCache",
                Some(format!("ABI source version {}", source.version_id)),
            );
            if source_has_event_topic_conflict(source) {
                analysis.push_uncertainty(
                    "eventDecodeConflict",
                    "warning",
                    "abiCache",
                    Some(format!("ABI source version {}", source.version_id)),
                );
            }
        } else if source.validation_status != "ok" {
            analysis.push_uncertainty(
                &source.validation_status,
                "warning",
                "abiCache",
                Some(format!("ABI source version {}", source.version_id)),
            );
        }
        if matches!(
            source.selection_status.as_str(),
            "sourceConflict" | "needsUserChoice"
        ) {
            analysis.push_uncertainty(
                &source.selection_status,
                "warning",
                "abiCache",
                Some(format!("ABI source version {}", source.version_id)),
            );
        }
        if source.proxy_detected {
            analysis.push_uncertainty(
                "proxyImplementationUncertainty",
                "warning",
                "abiCache",
                source.provider_proxy_hint.clone(),
            );
        }
        if source.artifact_status != "ok" {
            analysis.push_uncertainty(
                &source.artifact_status,
                "warning",
                "abiCache",
                source.error_summary.clone(),
            );
        }
    }
}

fn source_has_event_topic_conflict(source: &TxAnalysisAbiSourceSummary) -> bool {
    let Some(summary) = &source.selector_summary else {
        return false;
    };
    let has_conflict = summary.conflict_count.unwrap_or(0) > 0
        || summary.duplicate_selector_count.unwrap_or(0) > 0;
    if !has_conflict || summary.event_topic_count.unwrap_or(0) == 0 {
        return false;
    }
    let notes = summary.notes.as_deref().unwrap_or("").to_ascii_lowercase();
    notes.contains("event")
        || notes.contains("topic")
        || (summary.function_selector_count.unwrap_or(0) == 0
            && summary.error_selector_count.unwrap_or(0) == 0)
}

fn add_error_candidates(
    analysis: &mut TxAnalysisDecodeReadModel,
    revert_data: Option<&NormalizedRevertData>,
    sources: &[AbiDecodeSource],
) {
    let Some(revert_data) = revert_data else {
        return;
    };

    match &revert_data.bytes {
        Some(bytes) => {
            let selector = calldata_selector(bytes);
            let semantic_status = if bytes.len() < 4 {
                "malformed"
            } else {
                revert_data.status.as_str()
            };
            analysis.revert_data_status = semantic_status.to_string();
            analysis.revert_data = Some(TxAnalysisRevertDataSummary {
                source: revert_data.source.clone(),
                status: semantic_status.to_string(),
                selector: selector.clone(),
                byte_length: Some(bytes.len() as u64),
                data_hash_version: Some(REVERT_DATA_HASH_VERSION.to_string()),
                data_hash: Some(prefixed_hash(bytes)),
                error_summary: if bytes.len() < 4 {
                    Some("bounded revert data is shorter than a 4-byte selector".to_string())
                } else {
                    revert_data.error_summary.clone()
                },
            });
            if bytes.len() < 4 {
                analysis.push_uncertainty(
                    "malformedRevertData",
                    "warning",
                    "boundedRevertData",
                    Some("bounded revert data is shorter than a 4-byte selector".to_string()),
                );
                return;
            }

            let selector = selector.unwrap_or_default();
            analysis
                .error_candidates
                .extend(builtin_error_candidates(&selector, bytes));
            analysis
                .error_candidates
                .extend(abi_error_candidates(&selector, bytes, sources));
            apply_error_selector_conflicts(analysis);

            if analysis.error_candidates.iter().any(|candidate| {
                candidate
                    .statuses
                    .iter()
                    .any(|status| status == "malformedRevertData")
            }) {
                analysis.push_uncertainty(
                    "malformedRevertData",
                    "warning",
                    "boundedRevertData",
                    Some(
                        "bounded revert data could not be decoded by at least one candidate"
                            .to_string(),
                    ),
                );
            }
            if analysis.error_candidates.is_empty() {
                analysis.push_uncertainty(
                    "unknownErrorSelector",
                    "warning",
                    "boundedRevertData",
                    None,
                );
            }
        }
        None => {
            analysis.revert_data_status = revert_data.status.clone();
            analysis.revert_data = Some(TxAnalysisRevertDataSummary {
                source: revert_data.source.clone(),
                status: revert_data.status.clone(),
                selector: None,
                byte_length: None,
                data_hash_version: None,
                data_hash: None,
                error_summary: revert_data.error_summary.clone(),
            });
            let code = if revert_data.status == "payloadTooLarge" {
                "revertDataPayloadTooLarge"
            } else {
                "malformedRevertData"
            };
            analysis.push_uncertainty(
                code,
                "warning",
                "boundedRevertData",
                revert_data.error_summary.clone(),
            );
        }
    }
}

fn source_can_drive_decode(source: &TxAnalysisAbiSourceSummary) -> bool {
    source.selected
        && source.fetch_source_status == "ok"
        && source.validation_status == "ok"
        && source.cache_status == "cacheFresh"
        && source.selection_status == "selected"
        && source.artifact_status == "ok"
}

fn abi_function_candidates(
    selector: &str,
    calldata: &[u8],
    sources: &[AbiDecodeSource],
) -> Vec<TxAnalysisFunctionDecodeCandidate> {
    let mut candidates = Vec::new();
    for source in sources {
        if !source_can_drive_decode(&source.summary) {
            continue;
        }
        let Some(raw_abi) = &source.raw_abi else {
            continue;
        };
        let matches = raw_function_matches(raw_abi, selector);
        for item in matches {
            let signature =
                raw_item_signature(&item, "function").unwrap_or_else(|_| "unknown()".to_string());
            let mut statuses = abi_source_statuses(&source.summary);
            let (decode_status, argument_summary, error_summary) = match parse_function_item(item)
                .and_then(|function| {
                    decode_function_arguments(&function, calldata)
                        .map_err(|error| format!("ABI function decode failed: {error}"))
                }) {
                Ok(summary) => ("decoded".to_string(), summary, None),
                Err(error) => {
                    statuses.push("malformedCalldata".to_string());
                    (
                        "decodeError".to_string(),
                        Vec::new(),
                        Some(sanitized_summary(error)),
                    )
                }
            };
            candidates.push(TxAnalysisFunctionDecodeCandidate {
                selector: selector.to_string(),
                function_signature: signature,
                source: Some(source.summary.clone()),
                source_label: "abiCache".to_string(),
                decode_status,
                confidence: confidence_for_statuses(&statuses),
                argument_summary,
                statuses: dedupe_strings(statuses),
                error_summary,
            });
        }
    }
    candidates
}

fn builtin_error_candidates(selector: &str, bytes: &[u8]) -> Vec<TxAnalysisErrorDecodeCandidate> {
    let Some((signature, params)) = builtin_error_params(selector) else {
        return Vec::new();
    };
    let (decode_status, argument_summary, error_summary, statuses) =
        match decode_named_params(&params, bytes) {
            Ok(summary) => ("decoded".to_string(), summary, None, Vec::new()),
            Err(error) => (
                "decodeError".to_string(),
                Vec::new(),
                Some(sanitized_summary(error)),
                vec!["malformedRevertData".to_string()],
            ),
        };
    vec![TxAnalysisErrorDecodeCandidate {
        selector: selector.to_string(),
        error_signature: signature.to_string(),
        source: None,
        source_label: "knownError".to_string(),
        decode_status,
        confidence: if statuses.is_empty() { "medium" } else { "low" }.to_string(),
        argument_summary,
        statuses,
        error_summary,
    }]
}

fn abi_error_candidates(
    selector: &str,
    bytes: &[u8],
    sources: &[AbiDecodeSource],
) -> Vec<TxAnalysisErrorDecodeCandidate> {
    let mut candidates = Vec::new();
    for source in sources {
        if !source_can_drive_decode(&source.summary) {
            continue;
        }
        let Some(raw_abi) = &source.raw_abi else {
            continue;
        };
        for item in raw_error_matches(raw_abi, selector) {
            let signature =
                raw_item_signature(&item, "error").unwrap_or_else(|_| "unknown()".to_string());
            let mut statuses = abi_source_statuses(&source.summary);
            let (decode_status, argument_summary, error_summary) =
                match error_params_from_raw_item(&item).and_then(|params| {
                    decode_error_arguments(&params, bytes)
                        .map_err(|error| format!("ABI error decode failed: {error}"))
                }) {
                    Ok(summary) => ("decoded".to_string(), summary, None),
                    Err(error) => {
                        statuses.push("malformedRevertData".to_string());
                        (
                            "decodeError".to_string(),
                            Vec::new(),
                            Some(sanitized_summary(error)),
                        )
                    }
                };
            candidates.push(TxAnalysisErrorDecodeCandidate {
                selector: selector.to_string(),
                error_signature: signature,
                source: Some(source.summary.clone()),
                source_label: "abiCache".to_string(),
                decode_status,
                confidence: confidence_for_statuses(&statuses),
                argument_summary,
                statuses: dedupe_strings(statuses),
                error_summary,
            });
        }
    }
    candidates
}

fn builtin_function_candidates(
    selector: &str,
    calldata: &[u8],
) -> Vec<TxAnalysisFunctionDecodeCandidate> {
    let Some((signature, params)) = builtin_function_params(selector) else {
        return Vec::new();
    };
    let (decode_status, argument_summary, error_summary, statuses) =
        match decode_named_params(&params, calldata) {
            Ok(summary) => ("decoded".to_string(), summary, None, Vec::new()),
            Err(error) => (
                "decodeError".to_string(),
                Vec::new(),
                Some(sanitized_summary(error)),
                vec!["malformedCalldata".to_string()],
            ),
        };
    vec![TxAnalysisFunctionDecodeCandidate {
        selector: selector.to_string(),
        function_signature: signature.to_string(),
        source: None,
        source_label: "knownSelector".to_string(),
        decode_status,
        confidence: if statuses.is_empty() { "medium" } else { "low" }.to_string(),
        argument_summary,
        statuses,
        error_summary,
    }]
}

fn builtin_function_params(
    selector: &str,
) -> Option<(&'static str, Vec<(&'static str, ParamType)>)> {
    match selector {
        ERC20_TRANSFER_SELECTOR => Some((
            ERC20_TRANSFER_SIGNATURE,
            vec![("to", ParamType::Address), ("amount", ParamType::Uint(256))],
        )),
        ERC20_APPROVE_SELECTOR => Some((
            ERC20_APPROVE_SIGNATURE,
            vec![
                ("spender", ParamType::Address),
                ("amount", ParamType::Uint(256)),
            ],
        )),
        DISPERSE_ETHER_SELECTOR_HEX => Some((
            DISPERSE_ETHER_METHOD,
            vec![
                ("recipients", ParamType::Array(Box::new(ParamType::Address))),
                ("values", ParamType::Array(Box::new(ParamType::Uint(256)))),
            ],
        )),
        DISPERSE_TOKEN_SELECTOR_HEX => Some((
            DISPERSE_TOKEN_METHOD,
            vec![
                ("token", ParamType::Address),
                ("recipients", ParamType::Array(Box::new(ParamType::Address))),
                ("values", ParamType::Array(Box::new(ParamType::Uint(256)))),
            ],
        )),
        _ => None,
    }
}

fn builtin_error_params(selector: &str) -> Option<(&'static str, Vec<(&'static str, ParamType)>)> {
    match selector {
        ERROR_STRING_SELECTOR => {
            Some((ERROR_STRING_SIGNATURE, vec![("message", ParamType::String)]))
        }
        PANIC_UINT_SELECTOR => Some((PANIC_UINT_SIGNATURE, vec![("code", ParamType::Uint(256))])),
        _ => None,
    }
}

fn decode_named_params(
    params: &[(&str, ParamType)],
    calldata: &[u8],
) -> Result<Vec<TxAnalysisDecodedValueSummary>, String> {
    if calldata.len() < 4 {
        return Err("calldata is shorter than a 4-byte selector".to_string());
    }
    if (calldata.len() - 4) % 32 != 0 {
        return Err("ABI calldata body must be 32-byte aligned".to_string());
    }
    let kinds = params
        .iter()
        .map(|(_, kind)| kind.clone())
        .collect::<Vec<_>>();
    let tokens = decode_strict(&kinds, &calldata[4..], "ABI calldata body")?;
    Ok(params
        .iter()
        .zip(tokens.iter())
        .map(|((name, kind), token)| summarize_token(token, kind, Some(name)))
        .collect())
}

fn decode_function_arguments(
    function: &Function,
    calldata: &[u8],
) -> Result<Vec<TxAnalysisDecodedValueSummary>, String> {
    if calldata.len() < 4 {
        return Err("calldata is shorter than a 4-byte selector".to_string());
    }
    if (calldata.len() - 4) % 32 != 0 {
        return Err("ABI calldata body must be 32-byte aligned".to_string());
    }
    let kinds = function
        .inputs
        .iter()
        .map(|param| param.kind.clone())
        .collect::<Vec<_>>();
    let tokens = decode_strict(&kinds, &calldata[4..], "ABI calldata body")?;
    Ok(function
        .inputs
        .iter()
        .zip(tokens.iter())
        .map(|(param, token)| summarize_token(token, &param.kind, Some(&param.name)))
        .collect())
}

fn decode_error_arguments(
    params: &[(String, ParamType)],
    bytes: &[u8],
) -> Result<Vec<TxAnalysisDecodedValueSummary>, String> {
    if bytes.len() < 4 {
        return Err("bounded revert data is shorter than a 4-byte selector".to_string());
    }
    if (bytes.len() - 4) % 32 != 0 {
        return Err("ABI revert data body must be 32-byte aligned".to_string());
    }
    let kinds = params
        .iter()
        .map(|(_, kind)| kind.clone())
        .collect::<Vec<_>>();
    let tokens = decode_strict(&kinds, &bytes[4..], "ABI revert data body")?;
    Ok(params
        .iter()
        .zip(tokens.iter())
        .map(|((name, kind), token)| summarize_token(token, kind, Some(name)))
        .collect())
}

fn decode_strict(kinds: &[ParamType], body: &[u8], label: &str) -> Result<Vec<Token>, String> {
    let tokens = decode(kinds, body).map_err(|error| error.to_string())?;
    let encoded = ethers::abi::encode(&tokens);
    if encoded != body {
        return Err(format!(
            "{label} contains trailing or non-canonical ABI data"
        ));
    }
    Ok(tokens)
}

fn apply_function_selector_conflicts(analysis: &mut TxAnalysisDecodeReadModel) {
    let unique_signatures = analysis
        .function_candidates
        .iter()
        .map(|candidate| candidate.function_signature.clone())
        .collect::<BTreeSet<_>>();
    analysis.selector.selector_match_count = analysis.function_candidates.len() as u64;
    analysis.selector.unique_signature_count = unique_signatures.len() as u64;
    analysis.selector.conflict =
        unique_signatures.len() > 1 || function_source_has_selector_conflict(analysis);
    if !analysis.selector.conflict {
        return;
    }
    for candidate in &mut analysis.function_candidates {
        if !candidate
            .statuses
            .iter()
            .any(|status| status == "selectorCollision")
        {
            candidate.statuses.push("selectorCollision".to_string());
        }
        candidate.confidence = "low".to_string();
    }
    analysis.push_uncertainty(
        "selectorCollision",
        "warning",
        "abiCache",
        Some(
            "multiple function candidates or selector-conflict source metadata matched".to_string(),
        ),
    );
}

fn apply_error_selector_conflicts(analysis: &mut TxAnalysisDecodeReadModel) {
    let unique_signatures = analysis
        .error_candidates
        .iter()
        .map(|candidate| candidate.error_signature.clone())
        .collect::<BTreeSet<_>>();
    if unique_signatures.len() <= 1
        && !analysis.error_candidates.iter().any(|candidate| {
            candidate
                .statuses
                .iter()
                .any(|status| status == "selectorConflict")
        })
    {
        return;
    }
    for candidate in &mut analysis.error_candidates {
        if !candidate
            .statuses
            .iter()
            .any(|status| status == "selectorCollision")
        {
            candidate.statuses.push("selectorCollision".to_string());
        }
        candidate.confidence = "low".to_string();
    }
    analysis.push_uncertainty(
        "selectorCollision",
        "warning",
        "boundedRevertData",
        Some("multiple error candidates or selector-conflict source metadata matched".to_string()),
    );
}

fn add_function_classifications(
    analysis: &mut TxAnalysisDecodeReadModel,
    transaction: &TxAnalysisTransactionSummary,
) {
    for candidate in &analysis.function_candidates {
        if candidate.decode_status != "decoded" {
            continue;
        }
        match candidate.function_signature.as_str() {
            ERC20_TRANSFER_SIGNATURE if candidate.source.is_none() => {
                analysis
                    .classification_candidates
                    .push(classification_candidate(
                        "erc20Transfer",
                        "ERC-20 transfer",
                        candidate.confidence.as_str(),
                        "knownSelector",
                        transaction.selector.clone(),
                        Some(candidate.function_signature.clone()),
                        candidate.argument_summary.clone(),
                        vec!["knownErc20TransferSelector"],
                    ));
            }
            ERC20_APPROVE_SIGNATURE if candidate.source.is_none() => {
                analysis
                    .classification_candidates
                    .push(classification_candidate(
                        "erc20Approval",
                        "ERC-20 approval",
                        candidate.confidence.as_str(),
                        "knownSelector",
                        transaction.selector.clone(),
                        Some(candidate.function_signature.clone()),
                        candidate.argument_summary.clone(),
                        vec!["knownErc20ApproveSelector"],
                    ));
                if decoded_arg_value(&candidate.argument_summary, "amount").as_deref() == Some("0")
                {
                    analysis
                        .classification_candidates
                        .push(classification_candidate(
                            "erc20Revoke",
                            "ERC-20 revoke candidate",
                            "medium",
                            "knownSelector",
                            transaction.selector.clone(),
                            Some(candidate.function_signature.clone()),
                            candidate.argument_summary.clone(),
                            vec!["approveAmountZero"],
                        ));
                }
            }
            DISPERSE_ETHER_METHOD | DISPERSE_TOKEN_METHOD if candidate.source.is_none() => {
                analysis
                    .classification_candidates
                    .push(classification_candidate(
                        "batchDisperse",
                        "Batch disperse",
                        candidate.confidence.as_str(),
                        "knownSelector",
                        transaction.selector.clone(),
                        Some(candidate.function_signature.clone()),
                        candidate.argument_summary.clone(),
                        vec!["knownDisperseSelector"],
                    ));
            }
            _ if candidate.source.is_some() => {
                analysis
                    .classification_candidates
                    .push(classification_candidate(
                        "managedAbiCall",
                        "Managed ABI call",
                        candidate.confidence.as_str(),
                        "abiCache",
                        transaction.selector.clone(),
                        Some(candidate.function_signature.clone()),
                        candidate.argument_summary.clone(),
                        vec!["abiFunctionDecoded"],
                    ));
            }
            _ => {}
        }
    }
}

fn add_event_candidates(
    analysis: &mut TxAnalysisDecodeReadModel,
    receipt: Option<&ParsedReceipt>,
    abi_context: &AbiDecodeContext,
) {
    let Some(receipt) = receipt else {
        return;
    };
    let mut candidates = Vec::new();
    for log in &receipt.logs {
        candidates.extend(builtin_event_candidates(log));
        let sources = abi_context
            .sources_by_address
            .get(&normalize_address_key(&log.summary.address))
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        candidates.extend(abi_event_candidates(log, sources));
    }
    analysis.event_candidates = candidates;
    add_event_conflict_uncertainties(analysis);
}

fn builtin_event_candidates(log: &ParsedLog) -> Vec<TxAnalysisEventDecodeCandidate> {
    let Some(topic0) = log.summary.topic0.as_deref() else {
        return Vec::new();
    };
    let transfer_topic = topic_for_signature(ERC20_TRANSFER_EVENT_SIGNATURE);
    let approval_topic = topic_for_signature(ERC20_APPROVAL_EVENT_SIGNATURE);
    let signature = if topic0.eq_ignore_ascii_case(&transfer_topic) {
        ERC20_TRANSFER_EVENT_SIGNATURE
    } else if topic0.eq_ignore_ascii_case(&approval_topic) {
        ERC20_APPROVAL_EVENT_SIGNATURE
    } else {
        return Vec::new();
    };

    let (decode_status, argument_summary, error_summary, statuses) =
        match decode_erc20_event_log(signature, log) {
            Ok(summary) => ("decoded".to_string(), summary, None, Vec::new()),
            Err(error) => (
                "decodeError".to_string(),
                Vec::new(),
                Some(sanitized_summary(error)),
                vec!["malformedLog".to_string()],
            ),
        };

    vec![event_candidate_from_log(
        log,
        signature.to_string(),
        None,
        "knownEvent".to_string(),
        decode_status,
        if statuses.is_empty() { "medium" } else { "low" }.to_string(),
        argument_summary,
        statuses,
        error_summary,
    )]
}

fn decode_erc20_event_log(
    signature: &str,
    log: &ParsedLog,
) -> Result<Vec<TxAnalysisDecodedValueSummary>, String> {
    if log.topics.len() < 3 {
        return Err("ERC-20 event log must include indexed address topics".to_string());
    }
    if log.data.len() != 32 {
        return Err("ERC-20 event value data must be one uint256 word".to_string());
    }
    let value = decode(&[ParamType::Uint(256)], &log.data)
        .map_err(|error| error.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "ERC-20 event value missing".to_string())?;
    let (first_name, second_name) = if signature == ERC20_TRANSFER_EVENT_SIGNATURE {
        ("from", "to")
    } else {
        ("owner", "spender")
    };
    Ok(vec![
        summarize_token(
            &Token::Address(address_from_topic(&log.topics[1])),
            &ParamType::Address,
            Some(first_name),
        ),
        summarize_token(
            &Token::Address(address_from_topic(&log.topics[2])),
            &ParamType::Address,
            Some(second_name),
        ),
        summarize_token(&value, &ParamType::Uint(256), Some("value")),
    ])
}

fn abi_event_candidates(
    log: &ParsedLog,
    sources: &[AbiDecodeSource],
) -> Vec<TxAnalysisEventDecodeCandidate> {
    let Some(topic0) = log.summary.topic0.as_deref() else {
        return Vec::new();
    };
    let mut candidates = Vec::new();
    for source in sources {
        if !source_can_drive_decode(&source.summary) {
            continue;
        }
        let Some(raw_abi) = &source.raw_abi else {
            continue;
        };
        for item in raw_event_matches(raw_abi, topic0) {
            let signature =
                raw_item_signature(&item, "event").unwrap_or_else(|_| "unknown()".to_string());
            let mut statuses = abi_source_statuses(&source.summary);
            let (decode_status, argument_summary, error_summary) =
                match parse_event_item(item).and_then(|event| decode_event_log(&event, log)) {
                    Ok(summary) => ("decoded".to_string(), summary, None),
                    Err(error) => {
                        statuses.push("eventDecodeError".to_string());
                        (
                            "decodeError".to_string(),
                            Vec::new(),
                            Some(sanitized_summary(error)),
                        )
                    }
                };
            let confidence = confidence_for_statuses(&statuses);
            candidates.push(event_candidate_from_log(
                log,
                signature,
                Some(source.summary.clone()),
                "abiCache".to_string(),
                decode_status,
                confidence,
                argument_summary,
                dedupe_strings(statuses),
                error_summary,
            ));
        }
    }
    candidates
}

fn decode_event_log(
    event: &Event,
    log: &ParsedLog,
) -> Result<Vec<TxAnalysisDecodedValueSummary>, String> {
    let parsed = event
        .parse_log(RawLog {
            topics: log.topics.clone(),
            data: log.data.clone(),
        })
        .map_err(|error| error.to_string())?;
    Ok(event
        .inputs
        .iter()
        .zip(parsed.params.iter())
        .map(|(input, param)| summarize_token(&param.value, &input.kind, Some(&param.name)))
        .collect())
}

fn event_candidate_from_log(
    log: &ParsedLog,
    event_signature: String,
    source: Option<TxAnalysisAbiSourceSummary>,
    source_label: String,
    decode_status: String,
    confidence: String,
    argument_summary: Vec<TxAnalysisDecodedValueSummary>,
    statuses: Vec<String>,
    error_summary: Option<String>,
) -> TxAnalysisEventDecodeCandidate {
    TxAnalysisEventDecodeCandidate {
        address: log.summary.address.clone(),
        log_index: log.summary.log_index,
        topic0: log.summary.topic0.clone(),
        topics_count: log.summary.topics_count,
        data_byte_length: log.summary.data_byte_length,
        data_hash_version: log.summary.data_hash_version.clone(),
        data_hash: log.summary.data_hash.clone(),
        event_signature,
        source,
        source_label,
        decode_status,
        confidence,
        argument_summary,
        statuses,
        error_summary,
    }
}

fn add_event_conflict_uncertainties(analysis: &mut TxAnalysisDecodeReadModel) {
    let mut by_log: BTreeMap<
        (String, Option<u64>, Option<String>),
        Vec<&TxAnalysisEventDecodeCandidate>,
    > = BTreeMap::new();
    for candidate in &analysis.event_candidates {
        by_log
            .entry((
                normalize_address_key(&candidate.address),
                candidate.log_index,
                candidate.topic0.clone(),
            ))
            .or_default()
            .push(candidate);
    }
    let has_conflict = by_log.values().any(|candidates| {
        let unique_signatures = candidates
            .iter()
            .map(|candidate| candidate.event_signature.as_str())
            .collect::<BTreeSet<_>>();
        let source_conflict = candidates.iter().any(|candidate| {
            candidate
                .statuses
                .iter()
                .any(|status| status == "selectorConflict" || status == "eventDecodeConflict")
        });
        unique_signatures.len() > 1 || source_conflict
    });
    if has_conflict {
        analysis.push_uncertainty(
            "eventDecodeConflict",
            "warning",
            "abiCache",
            Some("one receipt log has multiple event decode candidates".to_string()),
        );
    }
}

fn function_source_has_selector_conflict(analysis: &TxAnalysisDecodeReadModel) -> bool {
    analysis.function_candidates.iter().any(|candidate| {
        candidate
            .statuses
            .iter()
            .any(|status| status == "selectorConflict")
    })
}

fn finalize_decode_status(analysis: &mut TxAnalysisDecodeReadModel) {
    if analysis.uncertainty_statuses.iter().any(|status| {
        matches!(
            status.code.as_str(),
            "selectorCollision" | "eventDecodeConflict"
        )
    }) {
        analysis.status = "conflict".to_string();
    } else if analysis
        .function_candidates
        .iter()
        .any(|candidate| candidate.decode_status == "decoded")
        || analysis
            .event_candidates
            .iter()
            .any(|candidate| candidate.decode_status == "decoded")
        || analysis
            .classification_candidates
            .iter()
            .any(|candidate| candidate.confidence == "high" || candidate.confidence == "medium")
    {
        analysis.status = if analysis.uncertainty_statuses.is_empty() {
            "matched".to_string()
        } else {
            "partial".to_string()
        };
    } else {
        analysis.status = "unknown".to_string();
    }
}

fn classification_candidate(
    kind: &str,
    label: &str,
    confidence: &str,
    source: &str,
    selector: Option<String>,
    signature: Option<String>,
    argument_summary: Vec<TxAnalysisDecodedValueSummary>,
    reasons: Vec<&str>,
) -> TxAnalysisClassificationCandidate {
    TxAnalysisClassificationCandidate {
        kind: kind.to_string(),
        label: label.to_string(),
        confidence: confidence.to_string(),
        source: source.to_string(),
        selector,
        signature,
        argument_summary,
        reasons: reasons.into_iter().map(str::to_string).collect(),
    }
}

fn decoded_arg_value(args: &[TxAnalysisDecodedValueSummary], name: &str) -> Option<String> {
    args.iter()
        .find(|arg| arg.name.as_deref() == Some(name))
        .and_then(|arg| arg.value.clone())
}

fn raw_function_matches(raw_abi: &Value, selector: &str) -> Vec<Value> {
    raw_items_matching_selector(raw_abi, "function", selector)
}

fn raw_event_matches(raw_abi: &Value, topic0: &str) -> Vec<Value> {
    raw_items_matching_selector(raw_abi, "event", topic0)
}

fn raw_error_matches(raw_abi: &Value, selector: &str) -> Vec<Value> {
    raw_items_matching_selector(raw_abi, "error", selector)
}

fn raw_items_matching_selector(raw_abi: &Value, kind: &str, selector: &str) -> Vec<Value> {
    let Value::Array(items) = raw_abi else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let item_type = object
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("function");
            if item_type != kind {
                return None;
            }
            let signature = raw_item_signature(item, kind).ok()?;
            let item_selector = if kind == "event" {
                topic_for_signature(&signature)
            } else {
                selector_for_signature(&signature)
            };
            item_selector
                .eq_ignore_ascii_case(selector)
                .then(|| item.clone())
        })
        .collect()
}

fn raw_item_signature(item: &Value, expected_type: &str) -> Result<String, String> {
    let object = item
        .as_object()
        .ok_or_else(|| "ABI item must be an object".to_string())?;
    let item_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("function");
    if item_type != expected_type {
        return Err("ABI item type mismatch".to_string());
    }
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "ABI item is missing a name".to_string())?;
    let inputs = raw_param_list(object.get("inputs"))?;
    Ok(format!("{name}({})", inputs.join(",")))
}

fn parse_function_item(item: Value) -> Result<Function, String> {
    let abi = serde_json::from_value::<Abi>(Value::Array(vec![item]))
        .map_err(|_| "ABI function item could not be parsed".to_string())?;
    let mut functions = abi.functions();
    let function = functions
        .next()
        .cloned()
        .ok_or_else(|| "ABI function item missing parsed function".to_string())?;
    if functions.next().is_some() {
        return Err("ABI function item parsed ambiguously".to_string());
    }
    Ok(function)
}

fn parse_event_item(item: Value) -> Result<Event, String> {
    let abi = serde_json::from_value::<Abi>(Value::Array(vec![item]))
        .map_err(|_| "ABI event item could not be parsed".to_string())?;
    let mut events = abi.events();
    let event = events
        .next()
        .cloned()
        .ok_or_else(|| "ABI event item missing parsed event".to_string())?;
    if events.next().is_some() {
        return Err("ABI event item parsed ambiguously".to_string());
    }
    Ok(event)
}

fn error_params_from_raw_item(item: &Value) -> Result<Vec<(String, ParamType)>, String> {
    let object = item
        .as_object()
        .ok_or_else(|| "ABI error item must be an object".to_string())?;
    if object.get("type").and_then(Value::as_str) != Some("error") {
        return Err("ABI item type mismatch".to_string());
    }
    let Some(inputs) = object.get("inputs") else {
        return Ok(Vec::new());
    };
    let Value::Array(items) = inputs else {
        return Err("ABI error inputs must be an array".to_string());
    };
    items
        .iter()
        .map(|item| {
            let object = item
                .as_object()
                .ok_or_else(|| "ABI error param must be an object".to_string())?;
            let name = object
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let type_label = raw_param_type(item)?;
            let kind = ethers::abi::ethabi::param_type::Reader::read(&type_label)
                .map_err(|_| format!("ABI error param type {type_label} is unsupported"))?;
            Ok((name, kind))
        })
        .collect()
}

fn raw_param_list(value: Option<&Value>) -> Result<Vec<String>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Value::Array(items) = value else {
        return Err("ABI params must be an array".to_string());
    };
    items.iter().map(raw_param_type).collect()
}

fn raw_param_type(value: &Value) -> Result<String, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "ABI param must be an object".to_string())?;
    let raw_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "ABI param is missing type".to_string())?;

    if let Some(tuple_suffix) = raw_type.strip_prefix("tuple") {
        let components = object
            .get("components")
            .ok_or_else(|| "tuple ABI param is missing components".to_string())?;
        let Value::Array(items) = components else {
            return Err("tuple ABI components must be an array".to_string());
        };
        let component_types = items
            .iter()
            .map(raw_param_type)
            .collect::<Result<Vec<_>, _>>()?;
        return Ok(format!("({}){tuple_suffix}", component_types.join(",")));
    }

    let suffix_start = raw_type.find('[').unwrap_or(raw_type.len());
    let base_type = &raw_type[..suffix_start];
    let array_suffix = &raw_type[suffix_start..];
    let canonical_base = match base_type {
        "uint" => "uint256",
        "int" => "int256",
        "fixed" => "fixed128x18",
        "ufixed" => "ufixed128x18",
        _ => base_type,
    };
    Ok(format!("{canonical_base}{array_suffix}"))
}

fn abi_source_statuses(source: &TxAnalysisAbiSourceSummary) -> Vec<String> {
    let mut statuses = Vec::new();
    if !source.selected {
        statuses.push("notSelected".to_string());
    }
    if source.fetch_source_status != "ok" {
        statuses.push(source.fetch_source_status.clone());
    }
    if source.validation_status != "ok" {
        statuses.push(source.validation_status.clone());
    }
    if source.cache_status != "cacheFresh" {
        statuses.push(source.cache_status.clone());
    }
    if source.selection_status != "selected" {
        statuses.push(source.selection_status.clone());
    }
    if source.artifact_status != "ok" {
        statuses.push(source.artifact_status.clone());
    }
    if source.proxy_detected {
        statuses.push("proxyImplementationUncertainty".to_string());
    }
    dedupe_strings(statuses)
}

fn confidence_for_statuses(statuses: &[String]) -> String {
    if statuses.iter().any(|status| {
        matches!(
            status.as_str(),
            "selectorConflict"
                | "sourceConflict"
                | "needsUserChoice"
                | "cacheStale"
                | "notVerified"
                | "artifactUnavailable"
                | "artifactHashDrift"
                | "malformedAbiArtifact"
                | "decodeError"
                | "malformedCalldata"
                | "malformedRevertData"
                | "selectorCollision"
                | "eventDecodeError"
                | "eventDecodeConflict"
        )
    }) {
        "low"
    } else if statuses.is_empty() {
        "high"
    } else {
        "medium"
    }
    .to_string()
}

fn summarize_token(
    token: &Token,
    kind: &ParamType,
    name: Option<&str>,
) -> TxAnalysisDecodedValueSummary {
    let type_label = canonical_param_type(kind);
    match (token, kind) {
        (Token::Address(address), ParamType::Address) => scalar_summary(
            clean_name(name),
            "address",
            type_label,
            Some(to_checksum(address, None)),
            false,
        ),
        (Token::Bool(value), ParamType::Bool) => scalar_summary(
            clean_name(name),
            "bool",
            type_label,
            Some(value.to_string()),
            false,
        ),
        (Token::String(value), ParamType::String) => {
            let (value, truncated) = truncate_chars(value, MAX_DECODE_STRING_CHARS);
            scalar_summary(
                clean_name(name),
                "string",
                type_label,
                Some(value),
                truncated,
            )
        }
        (Token::Uint(value), ParamType::Uint(_)) => scalar_summary(
            clean_name(name),
            "uint",
            type_label,
            Some(value.to_string()),
            false,
        ),
        (Token::Int(value), ParamType::Int(bits)) => scalar_summary(
            clean_name(name),
            "int",
            type_label,
            Some(format_signed_int(*value, *bits)),
            false,
        ),
        (Token::Bytes(bytes), ParamType::Bytes)
        | (Token::FixedBytes(bytes), ParamType::FixedBytes(_)) => {
            bytes_summary(clean_name(name), "bytes", type_label, bytes)
        }
        (Token::Array(items), ParamType::Array(inner)) => {
            array_summary(clean_name(name), "array", type_label, items, inner)
        }
        (Token::FixedArray(items), ParamType::FixedArray(inner, _)) => {
            array_summary(clean_name(name), "array", type_label, items, inner)
        }
        (Token::Tuple(items), ParamType::Tuple(kinds)) => {
            let fields = items
                .iter()
                .zip(kinds.iter())
                .take(MAX_DECODE_ITEMS)
                .enumerate()
                .map(|(index, (item, kind))| TxAnalysisDecodedFieldSummary {
                    name: Some(index.to_string()),
                    value: summarize_token(item, kind, None),
                })
                .collect::<Vec<_>>();
            TxAnalysisDecodedValueSummary {
                name: clean_name(name),
                kind: "tuple".to_string(),
                type_label,
                value: None,
                byte_length: None,
                hash: None,
                items: None,
                fields: Some(fields),
                truncated: items.len() > MAX_DECODE_ITEMS,
            }
        }
        _ => scalar_summary(
            clean_name(name),
            "unknown",
            type_label,
            Some("[unprintable]".to_string()),
            false,
        ),
    }
}

fn scalar_summary(
    name: Option<String>,
    kind: &str,
    type_label: String,
    value: Option<String>,
    truncated: bool,
) -> TxAnalysisDecodedValueSummary {
    TxAnalysisDecodedValueSummary {
        name,
        kind: kind.to_string(),
        type_label,
        value,
        byte_length: None,
        hash: None,
        items: None,
        fields: None,
        truncated,
    }
}

fn bytes_summary(
    name: Option<String>,
    kind: &str,
    type_label: String,
    bytes: &[u8],
) -> TxAnalysisDecodedValueSummary {
    TxAnalysisDecodedValueSummary {
        name,
        kind: kind.to_string(),
        type_label,
        value: None,
        byte_length: Some(bytes.len()),
        hash: Some(prefixed_hash(bytes)),
        items: None,
        fields: None,
        truncated: false,
    }
}

fn array_summary(
    name: Option<String>,
    kind: &str,
    type_label: String,
    items: &[Token],
    inner: &ParamType,
) -> TxAnalysisDecodedValueSummary {
    TxAnalysisDecodedValueSummary {
        name,
        kind: kind.to_string(),
        type_label,
        value: None,
        byte_length: None,
        hash: None,
        items: Some(
            items
                .iter()
                .take(MAX_DECODE_ITEMS)
                .map(|item| summarize_token(item, inner, None))
                .collect(),
        ),
        fields: None,
        truncated: items.len() > MAX_DECODE_ITEMS,
    }
}

fn canonical_param_type(kind: &ParamType) -> String {
    match kind {
        ParamType::Address => "address".to_string(),
        ParamType::Bytes => "bytes".to_string(),
        ParamType::Int(bits) => format!("int{bits}"),
        ParamType::Uint(bits) => format!("uint{bits}"),
        ParamType::Bool => "bool".to_string(),
        ParamType::String => "string".to_string(),
        ParamType::Array(inner) => format!("{}[]", canonical_param_type(inner)),
        ParamType::FixedBytes(size) => format!("bytes{size}"),
        ParamType::FixedArray(inner, size) => format!("{}[{size}]", canonical_param_type(inner)),
        ParamType::Tuple(items) => format!(
            "({})",
            items
                .iter()
                .map(canonical_param_type)
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

fn clean_name(name: Option<&str>) -> Option<String> {
    name.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn format_signed_int(raw: U256, bits: usize) -> String {
    if bits == 0 || bits > 256 {
        return raw.to_string();
    }
    let sign_bit = U256::one() << (bits - 1);
    if raw & sign_bit == U256::zero() {
        return raw.to_string();
    }
    let magnitude = (!raw) + U256::one();
    format!("-{magnitude}")
}

fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
    let mut iter = value.chars();
    let truncated = value.chars().count() > max_chars;
    let output = iter.by_ref().take(max_chars).collect::<String>();
    (output, truncated)
}

fn address_from_topic(topic: &H256) -> Address {
    Address::from_slice(&topic.as_bytes()[12..])
}

fn topic_for_signature(signature: &str) -> String {
    format!("0x{}", hex_lower(&keccak256(signature.as_bytes())))
}

fn selector_for_signature(signature: &str) -> String {
    format!("0x{}", hex_lower(&keccak256(signature.as_bytes())[..4]))
}

fn hash_text(value: &str) -> String {
    format!("0x{}", hex_lower(&keccak256(value.as_bytes())))
}

fn normalize_address_key(value: &str) -> String {
    value.to_ascii_lowercase()
}

fn dedupe_strings(values: Vec<String>) -> Vec<String> {
    let mut output = Vec::new();
    for value in values {
        if !output.iter().any(|item| item == &value) {
            output.push(value);
        }
    }
    output
}

fn receipt_status_label(status: Option<u64>) -> &'static str {
    match status {
        Some(1) => "success",
        Some(0) => "reverted",
        Some(_) => "unknown",
        None => "unknown",
    }
}

fn required_hash(value: &Value, field: &str) -> Result<String, String> {
    let raw = value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{field} must be a hash string"))?;
    normalize_hash(raw)
}

fn optional_hash(value: &Value, field: &str) -> Result<Option<String>, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(normalize_hash)
        .transpose()
}

fn normalize_hash(value: &str) -> Result<String, String> {
    H256::from_str(value.trim())
        .map(|hash| format!("{hash:#x}"))
        .map_err(|_| "value must be a 32-byte hex hash".to_string())
}

fn required_address(value: &Value, field: &str) -> Result<String, String> {
    let raw = value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{field} must be an address string"))?;
    normalize_address(raw)
}

fn optional_address(value: &Value, field: &str) -> Result<Option<String>, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(normalize_address)
        .transpose()
}

fn normalize_address(value: &str) -> Result<String, String> {
    Address::from_str(value.trim())
        .map(|address| to_checksum(&address, None))
        .map_err(|_| "value must be a valid EVM address".to_string())
}

fn required_quantity_string(value: &Value, field: &str) -> Result<String, String> {
    let raw = value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{field} must be a hex quantity string"))?;
    parse_hex_quantity_string(raw, field)
}

fn optional_quantity_string(value: &Value, field: &str) -> Result<Option<String>, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(|raw| parse_hex_quantity_string(raw, field))
        .transpose()
}

fn optional_quantity_u64(value: &Value, field: &str) -> Result<Option<u64>, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(|raw| parse_hex_quantity_u64(raw, field))
        .transpose()
}

fn parse_hex_quantity_string(value: &str, field: &str) -> Result<String, String> {
    let parsed = parse_hex_quantity_u256(value, field)?;
    Ok(parsed.to_string())
}

fn parse_hex_quantity_u64(value: &str, field: &str) -> Result<u64, String> {
    let parsed = parse_hex_quantity_u256(value, field)?;
    if parsed.bits() > 64 {
        return Err(format!("{field} does not fit in u64"));
    }
    Ok(parsed.as_u64())
}

fn parse_hex_quantity_u256(value: &str, field: &str) -> Result<U256, String> {
    let trimmed = value.trim();
    let Some(hex) = trimmed.strip_prefix("0x") else {
        return Err(format!("{field} must be a 0x-prefixed hex quantity"));
    };
    if hex.is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    let mut parsed = U256::zero();
    for ch in hex.chars() {
        let Some(digit) = ch.to_digit(16) else {
            return Err(format!("{field} contains non-hex characters"));
        };
        parsed = parsed
            .checked_mul(U256::from(16u8))
            .and_then(|value| value.checked_add(U256::from(digit)))
            .ok_or_else(|| format!("{field} overflows uint256"))?;
    }
    Ok(parsed)
}

fn normalize_tx_hash(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let Some(hex) = trimmed.strip_prefix("0x") else {
        return Err("txHash must be a 32-byte 0x-prefixed hex hash".to_string());
    };
    if hex.len() != 64 || !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err("txHash must be a 32-byte 0x-prefixed hex hash".to_string());
    }
    H256::from_str(trimmed)
        .map(|hash| format!("{hash:#x}"))
        .map_err(|_| "txHash must be a 32-byte 0x-prefixed hex hash".to_string())
}

fn normalize_hash_like(value: &str) -> String {
    normalize_tx_hash(value).unwrap_or_else(|_| "[invalid_tx_hash]".to_string())
}

fn calldata_selector(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 4 {
        return None;
    }
    Some(format!("0x{}", hex_lower(&bytes[..4])))
}

fn calldata_selector_status(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        "empty".to_string()
    } else if bytes.len() < 4 {
        "short".to_string()
    } else {
        SOURCE_OK.to_string()
    }
}

fn decode_hex_bytes(value: &str, field: &str) -> Result<Vec<u8>, String> {
    let trimmed = value.trim();
    let Some(hex) = trimmed.strip_prefix("0x") else {
        return Err(format!("{field} must start with 0x"));
    };
    if hex.len() % 2 != 0 {
        return Err(format!("{field} must have an even hex length"));
    }
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    let mut chars = hex.as_bytes().chunks_exact(2);
    for pair in &mut chars {
        let high = decode_hex_nibble(pair[0])
            .ok_or_else(|| format!("{field} contains a non-hex character"))?;
        let low = decode_hex_nibble(pair[1])
            .ok_or_else(|| format!("{field} contains a non-hex character"))?;
        bytes.push((high << 4) | low);
    }
    Ok(bytes)
}

fn bounded_hex_payload_len(value: &str, field: &str, max_bytes: usize) -> Result<bool, String> {
    let trimmed = value.trim();
    let Some(hex) = trimmed.strip_prefix("0x") else {
        return Err(format!("{field} must start with 0x"));
    };
    if hex.len() % 2 != 0 {
        return Err(format!("{field} must have an even hex length"));
    }
    Ok(hex.len() / 2 <= max_bytes)
}

fn decode_hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn prefixed_hash(bytes: &[u8]) -> String {
    format!("0x{}", hex_lower(&keccak256(bytes)))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn sanitized_summary(value: impl AsRef<str>) -> String {
    sanitize_diagnostic_message(value.as_ref())
}

fn rpc_endpoint_fingerprint(rpc_url: &str) -> String {
    compact_hash_key_with_prefix(
        "rpc-endpoint",
        &normalized_secret_safe_rpc_identity(rpc_url),
    )
}

fn normalized_secret_safe_rpc_identity(rpc_url: &str) -> String {
    let trimmed = rpc_url.trim();
    let Some((scheme, rest)) = trimmed.split_once("://") else {
        return "[redacted_url]".to_string();
    };
    let scheme = scheme.to_ascii_lowercase();
    let rest = rest.split('#').next().unwrap_or_default();
    let authority_end = rest.find(['/', '?']).unwrap_or(rest.len());
    let authority = rest[..authority_end]
        .rsplit('@')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if authority.is_empty() {
        return "[redacted_url]".to_string();
    }
    let authority = canonical_rpc_authority(&scheme, &authority);
    let remainder = &rest[authority_end..];
    let (path, query) = match remainder.split_once('?') {
        Some((path, query)) => (if path.is_empty() { "/" } else { path }, Some(query)),
        None => {
            let path = if remainder.is_empty() { "/" } else { remainder };
            (path, None)
        }
    };
    let query = query
        .filter(|query| !query.is_empty())
        .map(|query| {
            query
                .split('&')
                .filter(|part| !part.is_empty())
                .map(|part| {
                    let key = part.split_once('=').map(|(key, _)| key).unwrap_or(part);
                    let key = decode_rpc_query_key(key);
                    format!("{key}=[redacted]")
                })
                .collect::<Vec<_>>()
                .join("&")
        })
        .filter(|query| !query.is_empty())
        .map(|query| format!("?{query}"))
        .unwrap_or_default();
    format!("{scheme}://{authority}{path}{query}")
}

fn summarize_rpc_endpoint(rpc_url: &str) -> String {
    let trimmed = rpc_url.trim();
    let Some((scheme, rest)) = trimmed.split_once("://") else {
        return "[redacted_endpoint]".to_string();
    };
    let scheme = scheme.to_ascii_lowercase();
    if scheme.is_empty()
        || !scheme
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
    {
        return "[redacted_endpoint]".to_string();
    }

    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .rsplit('@')
        .next()
        .unwrap_or_default();
    if authority.is_empty() || authority.contains(char::is_whitespace) {
        return "[redacted_endpoint]".to_string();
    }

    format!("{scheme}://{}", canonical_rpc_authority(&scheme, authority))
}

fn canonical_rpc_authority(scheme: &str, authority: &str) -> String {
    let authority = authority.to_ascii_lowercase();
    if let Some(rest) = authority.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let bracketed_host = &authority[..=end + 1];
            let suffix = &authority[end + 2..];
            if let Some(port) = suffix.strip_prefix(':') {
                if is_default_rpc_port(scheme, port) {
                    return bracketed_host.to_string();
                }
            }
            return authority;
        }
    }
    if let Some((host, port)) = authority.rsplit_once(':') {
        if !host.contains(':') && is_default_rpc_port(scheme, port) {
            return host.to_string();
        }
    }
    authority
}

fn is_default_rpc_port(scheme: &str, port: &str) -> bool {
    matches!((scheme, port), ("https", "443") | ("http", "80"))
}

fn decode_rpc_query_key(value: &str) -> String {
    let mut bytes = Vec::with_capacity(value.len());
    let input = value.as_bytes();
    let mut index = 0;
    while index < input.len() {
        match input[index] {
            b'+' => {
                bytes.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < input.len() => {
                let high = input[index + 1];
                let low = input[index + 2];
                if let (Some(high), Some(low)) = (decode_hex_nibble(high), decode_hex_nibble(low)) {
                    bytes.push((high << 4) | low);
                    index += 3;
                } else {
                    bytes.push(input[index]);
                    index += 1;
                }
            }
            byte => {
                bytes.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn compact_hash_key_with_prefix(prefix: &str, value: &str) -> String {
    let mut hash = 0x811c9dc5u32;
    for code_unit in value.encode_utf16() {
        hash ^= code_unit as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{prefix}-{hash:08x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::ffi::OsString;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex, MutexGuard};
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use ethers::abi::encode;

    const HASH: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const OTHER_HASH: &str = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const BLOCK_HASH: &str = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const FROM: &str = "0x1111111111111111111111111111111111111111";
    const TO: &str = "0x2222222222222222222222222222222222222222";
    const CREATED: &str = "0x3333333333333333333333333333333333333333";
    const TOPIC0: &str = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const SECRET_RPC_PATH: &str = "/v1?apiKey=super-secret-token";
    const TEST_APP_DIR_ENV: &str = "EVM_WALLET_WORKBENCH_APP_DIR";

    #[derive(Debug, Clone)]
    enum RpcReply {
        Result(Value),
        Error(&'static str),
        NoResponse(Duration),
    }

    #[derive(Debug, Clone)]
    struct RpcStep {
        method: &'static str,
        reply: RpcReply,
    }

    fn step(method: &'static str, result: Value) -> RpcStep {
        RpcStep {
            method,
            reply: RpcReply::Result(result),
        }
    }

    fn error_step(method: &'static str, message: &'static str) -> RpcStep {
        RpcStep {
            method,
            reply: RpcReply::Error(message),
        }
    }

    fn no_response_step(method: &'static str, delay: Duration) -> RpcStep {
        RpcStep {
            method,
            reply: RpcReply::NoResponse(delay),
        }
    }

    fn start_rpc_server(
        steps: Vec<RpcStep>,
    ) -> (String, Arc<Mutex<Vec<Value>>>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind rpc server");
        let address = listener.local_addr().expect("local addr");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&requests);
        let handle = thread::spawn(move || {
            for step in steps {
                let (mut stream, _) = listener.accept().expect("accept rpc request");
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .expect("set read timeout");
                let request = read_rpc_http_request(&mut stream).expect("read rpc request");
                let body = request.split("\r\n\r\n").nth(1).expect("request body");
                let request_json: Value = serde_json::from_str(body).expect("parse request json");
                assert_eq!(
                    request_json
                        .get("method")
                        .and_then(Value::as_str)
                        .expect("request method"),
                    step.method
                );
                seen.lock()
                    .expect("request lock")
                    .push(request_json.clone());

                let id = request_json.get("id").cloned().unwrap_or_else(|| json!(1));
                let response_body = match step.reply {
                    RpcReply::Result(result) => {
                        json!({ "jsonrpc": "2.0", "id": id, "result": result })
                    }
                    RpcReply::Error(message) => json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32000,
                            "message": message
                        }
                    }),
                    RpcReply::NoResponse(delay) => {
                        thread::sleep(delay);
                        continue;
                    }
                };
                let response_body =
                    serde_json::to_string(&response_body).expect("serialize response");
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write rpc response");
            }
        });
        (
            format!("http://{address}{SECRET_RPC_PATH}"),
            requests,
            handle,
        )
    }

    fn read_rpc_http_request(stream: &mut impl Read) -> std::io::Result<String> {
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

    fn base_input(rpc_url: &str) -> TxAnalysisFetchInput {
        TxAnalysisFetchInput {
            rpc_url: rpc_url.to_string(),
            chain_id: 1,
            tx_hash: HASH.to_string(),
            selected_rpc: Some(selected_rpc(rpc_url)),
            bounded_revert_data: None,
        }
    }

    fn selected_rpc(rpc_url: &str) -> TxAnalysisSelectedRpcInput {
        TxAnalysisSelectedRpcInput {
            chain_id: Some(1),
            provider_config_id: Some("provider-mainnet".to_string()),
            endpoint_id: Some("endpoint-primary".to_string()),
            endpoint_name: Some("Primary".to_string()),
            endpoint_summary: Some(summarize_rpc_endpoint(rpc_url)),
            endpoint_fingerprint: Some(rpc_endpoint_fingerprint(rpc_url)),
        }
    }

    fn confirmed_tx(input: &str) -> Value {
        json!({
            "hash": HASH,
            "nonce": "0x2a",
            "blockHash": BLOCK_HASH,
            "blockNumber": "0x7b",
            "transactionIndex": "0x1",
            "from": FROM,
            "to": TO,
            "value": "0x10",
            "gas": "0x5208",
            "gasPrice": "0x3b9aca00",
            "input": input,
        })
    }

    fn pending_tx() -> Value {
        json!({
            "hash": HASH,
            "nonce": "0x2a",
            "blockHash": null,
            "blockNumber": null,
            "transactionIndex": null,
            "from": FROM,
            "to": TO,
            "value": "0x10",
            "gas": "0x5208",
            "gasPrice": "0x3b9aca00",
            "input": "0x12345678",
        })
    }

    fn contract_creation_tx() -> Value {
        json!({
            "hash": HASH,
            "nonce": "0x3",
            "blockHash": BLOCK_HASH,
            "blockNumber": "0x7b",
            "transactionIndex": "0x0",
            "from": FROM,
            "to": null,
            "value": "0x0",
            "gas": "0x100000",
            "gasPrice": "0x3b9aca00",
            "input": "0x6080604052",
        })
    }

    fn receipt(status: &str, contract_address: Option<&str>) -> Value {
        json!({
            "transactionHash": HASH,
            "transactionIndex": "0x1",
            "blockHash": BLOCK_HASH,
            "blockNumber": "0x7b",
            "from": FROM,
            "to": if contract_address.is_some() { Value::Null } else { json!(TO) },
            "cumulativeGasUsed": "0x5208",
            "gasUsed": "0x5208",
            "contractAddress": contract_address,
            "logs": [
                {
                    "address": TO,
                    "topics": [TOPIC0],
                    "data": "0xabcdef",
                    "blockHash": BLOCK_HASH,
                    "blockNumber": "0x7b",
                    "transactionHash": HASH,
                    "transactionIndex": "0x1",
                    "logIndex": "0x0",
                    "removed": false
                }
            ],
            "status": status,
            "effectiveGasPrice": "0x3b9aca00"
        })
    }

    fn receipt_without_logs() -> Value {
        json!({
            "transactionHash": HASH,
            "transactionIndex": "0x1",
            "blockHash": BLOCK_HASH,
            "blockNumber": "0x7b",
            "from": FROM,
            "to": TO,
            "cumulativeGasUsed": "0x5208",
            "gasUsed": "0x5208",
            "contractAddress": null,
            "status": "0x1",
            "effectiveGasPrice": "0x3b9aca00"
        })
    }

    fn receipt_with_transaction_hash(transaction_hash: &str) -> Value {
        json!({
            "transactionHash": transaction_hash,
            "transactionIndex": "0x1",
            "blockHash": BLOCK_HASH,
            "blockNumber": "0x7b",
            "from": FROM,
            "to": TO,
            "cumulativeGasUsed": "0x5208",
            "gasUsed": "0x5208",
            "contractAddress": null,
            "logs": [],
            "status": "0x1",
            "effectiveGasPrice": "0x3b9aca00"
        })
    }

    fn block() -> Value {
        json!({
            "number": "0x7b",
            "hash": BLOCK_HASH,
            "timestamp": "0x6502b4c0",
            "baseFeePerGas": "0x3b9aca00"
        })
    }

    fn block_with(number: &str, hash: &str) -> Value {
        json!({
            "number": number,
            "hash": hash,
            "timestamp": "0x6502b4c0",
            "baseFeePerGas": "0x3b9aca00"
        })
    }

    fn successful_confirmed_steps() -> Vec<RpcStep> {
        vec![
            step("eth_chainId", json!("0x1")),
            step(
                "eth_getTransactionByHash",
                confirmed_tx(
                    "0xa9059cbb0000000000000000000000003333333333333333333333333333333333333333",
                ),
            ),
            step("eth_getTransactionReceipt", receipt("0x1", None)),
            step("eth_getBlockByNumber", block()),
            step("eth_getCode", json!("0x6001600055")),
        ]
    }

    fn methods(requests: &Arc<Mutex<Vec<Value>>>) -> Vec<String> {
        requests
            .lock()
            .expect("request lock")
            .iter()
            .map(|value| {
                value
                    .get("method")
                    .and_then(Value::as_str)
                    .expect("request method")
                    .to_string()
            })
            .collect()
    }

    fn joined_json(value: &impl Serialize) -> String {
        serde_json::to_string(value).expect("serialize")
    }

    fn assert_no_sensitive_payloads(serialized: &str) {
        assert!(!serialized
            .contains("a9059cbb0000000000000000000000003333333333333333333333333333333333333333"));
        assert!(!serialized.contains("abcdef"));
        assert!(!serialized.contains("super-secret-token"));
        assert!(!serialized.contains("rawTx"));
        assert!(!serialized.contains("local history"));
        assert!(!serialized.contains("account label"));
    }

    fn calldata_with_tokens(selector: &str, tokens: &[Token]) -> Vec<u8> {
        let mut calldata =
            decode_hex_bytes(selector, "selector").expect("selector bytes for test calldata");
        calldata.extend_from_slice(&encode(tokens));
        calldata
    }

    fn test_address(value: &str) -> Address {
        Address::from_str(value).expect("test address")
    }

    fn parsed_tx_for_analysis(
        calldata: Vec<u8>,
        to: Option<&str>,
        value_wei: &str,
    ) -> ParsedTransaction {
        let selector = calldata_selector(&calldata);
        let selector_status = calldata_selector_status(&calldata);
        ParsedTransaction {
            summary: TxAnalysisTransactionSummary {
                hash: HASH.to_string(),
                from: normalize_address(FROM).expect("from address"),
                to: to.map(|address| normalize_address(address).expect("to address")),
                contract_creation: to.is_none(),
                nonce: "1".to_string(),
                value_wei: value_wei.to_string(),
                selector,
                selector_status,
                calldata_byte_length: calldata.len() as u64,
                calldata_hash_version: CALLDATA_HASH_VERSION.to_string(),
                calldata_hash: prefixed_hash(&calldata),
                block_number: Some(1),
                block_hash: Some(BLOCK_HASH.to_string()),
                transaction_index: Some(0),
            },
            to_address: to.map(|address| normalize_address(address).expect("to address")),
            block_number: Some(1),
            block_hash: Some(BLOCK_HASH.to_string()),
            calldata,
        }
    }

    fn parsed_receipt_for_analysis(status: u64, logs: Vec<ParsedLog>) -> ParsedReceipt {
        ParsedReceipt {
            summary: TxAnalysisReceiptSummary {
                status: Some(status),
                status_label: receipt_status_label(Some(status)).to_string(),
                block_number: Some(1),
                block_hash: Some(BLOCK_HASH.to_string()),
                transaction_index: Some(0),
                gas_used: Some("21000".to_string()),
                effective_gas_price: Some("1".to_string()),
                contract_address: None,
                logs_status: SOURCE_OK.to_string(),
                logs_count: Some(logs.len() as u64),
                logs: logs.iter().map(|log| log.summary.clone()).collect(),
                omitted_logs: None,
            },
            block_number: Some(1),
            block_hash: Some(BLOCK_HASH.to_string()),
            logs_missing: false,
            logs,
        }
    }

    fn parsed_log_for_analysis(address: &str, topics: Vec<H256>, data: Vec<u8>) -> ParsedLog {
        ParsedLog {
            summary: TxAnalysisLogSummary {
                address: normalize_address(address).expect("log address"),
                log_index: Some(0),
                topic0: topics.first().map(|topic| format!("{topic:#x}")),
                topics_count: topics.len() as u64,
                data_byte_length: data.len() as u64,
                data_hash_version: LOG_DATA_HASH_VERSION.to_string(),
                data_hash: prefixed_hash(&data),
                removed: Some(false),
            },
            topics,
            data,
        }
    }

    fn address_topic(address: &str) -> H256 {
        let address = test_address(address);
        let mut bytes = [0u8; 32];
        bytes[12..].copy_from_slice(address.as_bytes());
        H256::from(bytes)
    }

    fn context_with_sources(sources: Vec<AbiDecodeSource>) -> AbiDecodeContext {
        let mut context = AbiDecodeContext::default();
        for source in sources {
            context
                .sources_by_address
                .entry(normalize_address_key(&source.summary.contract_address))
                .or_default()
                .push(source);
        }
        context
    }

    fn cache_entry_for_analysis(address: &str) -> AbiCacheEntryRecord {
        AbiCacheEntryRecord {
            chain_id: 1,
            contract_address: normalize_address(address).expect("entry address"),
            source_kind: "userImported".to_string(),
            provider_config_id: None,
            user_source_id: Some("user-source".to_string()),
            version_id: "version-1".to_string(),
            attempt_id: "attempt-1".to_string(),
            source_fingerprint:
                "0x1111111111111111111111111111111111111111111111111111111111111111".to_string(),
            abi_hash: "0x2222222222222222222222222222222222222222222222222222222222222222"
                .to_string(),
            selected: true,
            fetch_source_status: "ok".to_string(),
            validation_status: "ok".to_string(),
            cache_status: "cacheFresh".to_string(),
            selection_status: "selected".to_string(),
            function_count: Some(1),
            event_count: Some(1),
            error_count: Some(1),
            selector_summary: None,
            fetched_at: None,
            imported_at: Some("1710000000".to_string()),
            last_validated_at: Some("1710000000".to_string()),
            stale_after: None,
            last_error_summary: None,
            provider_proxy_hint: None,
            proxy_detected: false,
            created_at: "1710000000".to_string(),
            updated_at: "1710000000".to_string(),
        }
    }

    fn source_for_analysis(
        address: &str,
        raw_abi: Value,
        overrides: impl FnOnce(&mut TxAnalysisAbiSourceSummary),
    ) -> AbiDecodeSource {
        let mut summary = TxAnalysisAbiSourceSummary {
            contract_address: normalize_address(address).expect("source address"),
            source_kind: "userImported".to_string(),
            provider_config_id: None,
            user_source_id: Some("user-source".to_string()),
            version_id: "version-1".to_string(),
            attempt_id: "attempt-1".to_string(),
            source_fingerprint:
                "0x1111111111111111111111111111111111111111111111111111111111111111".to_string(),
            abi_hash: "0x2222222222222222222222222222222222222222222222222222222222222222"
                .to_string(),
            selected: true,
            fetch_source_status: "ok".to_string(),
            validation_status: "ok".to_string(),
            cache_status: "cacheFresh".to_string(),
            selection_status: "selected".to_string(),
            selector_summary: None,
            artifact_status: "ok".to_string(),
            proxy_detected: false,
            provider_proxy_hint: None,
            error_summary: None,
        };
        overrides(&mut summary);
        AbiDecodeSource {
            summary,
            raw_abi: Some(raw_abi),
        }
    }

    fn analysis_for(
        tx: &ParsedTransaction,
        receipt: Option<&ParsedReceipt>,
        context: AbiDecodeContext,
    ) -> TxAnalysisDecodeReadModel {
        let mut model = TxAnalysisFetchReadModel::new(
            1,
            HASH.to_string(),
            "https://rpc.example.invalid".to_string(),
        );
        model.sources.logs = if receipt.is_some() {
            TxAnalysisSourceStatus::ok()
        } else {
            TxAnalysisSourceStatus::not_requested()
        };
        build_decode_read_model(&model, tx, receipt, &context, None)
    }

    fn analysis_for_with_revert(
        tx: &ParsedTransaction,
        receipt: Option<&ParsedReceipt>,
        context: AbiDecodeContext,
        revert_data: &NormalizedRevertData,
    ) -> TxAnalysisDecodeReadModel {
        let mut model = TxAnalysisFetchReadModel::new(
            1,
            HASH.to_string(),
            "https://rpc.example.invalid".to_string(),
        );
        model.sources.logs = if receipt.is_some() {
            TxAnalysisSourceStatus::ok()
        } else {
            TxAnalysisSourceStatus::not_requested()
        };
        build_decode_read_model(&model, tx, receipt, &context, Some(revert_data))
    }

    struct AppDirOverride {
        previous: Option<OsString>,
        _guard: MutexGuard<'static, ()>,
    }

    impl AppDirOverride {
        fn missing(test_name: &str) -> (Self, PathBuf) {
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
            let previous = std::env::var_os(TEST_APP_DIR_ENV);
            std::env::set_var(TEST_APP_DIR_ENV, &dir);
            (
                Self {
                    previous,
                    _guard: guard,
                },
                dir,
            )
        }
    }

    impl Drop for AppDirOverride {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.take() {
                std::env::set_var(TEST_APP_DIR_ENV, previous);
            } else {
                std::env::remove_var(TEST_APP_DIR_ENV);
            }
        }
    }

    fn assert_missing_dir(path: &Path) {
        assert!(
            !path.exists(),
            "read-only tx analysis path created {}",
            path.display()
        );
    }

    fn raw_param(name: &str, raw_type: &str) -> Value {
        json!({ "name": name, "type": raw_type })
    }

    fn raw_function(name: &str, inputs: Vec<Value>) -> Value {
        json!({
            "type": "function",
            "name": name,
            "inputs": inputs,
            "outputs": [],
            "stateMutability": "nonpayable"
        })
    }

    fn raw_event(name: &str, inputs: Vec<Value>) -> Value {
        json!({
            "type": "event",
            "name": name,
            "inputs": inputs,
            "anonymous": false
        })
    }

    fn raw_error(name: &str, inputs: Vec<Value>) -> Value {
        json!({
            "type": "error",
            "name": name,
            "inputs": inputs,
        })
    }

    fn raw_indexed_param(name: &str, raw_type: &str) -> Value {
        json!({ "name": name, "type": raw_type, "indexed": true })
    }

    fn normalized_revert_data(bytes: Vec<u8>) -> NormalizedRevertData {
        NormalizedRevertData {
            source: "testBoundedInput".to_string(),
            status: "present".to_string(),
            bytes: Some(bytes),
            error_summary: None,
        }
    }

    fn classification_kinds(analysis: &TxAnalysisDecodeReadModel) -> Vec<String> {
        analysis
            .classification_candidates
            .iter()
            .map(|candidate| candidate.kind.clone())
            .collect()
    }

    fn uncertainty_codes(analysis: &TxAnalysisDecodeReadModel) -> Vec<String> {
        analysis
            .uncertainty_statuses
            .iter()
            .map(|status| status.code.clone())
            .collect()
    }

    #[test]
    fn decode_classifies_erc20_transfer_approval_and_revoke_candidates() {
        let recipient = test_address(CREATED);
        let transfer = parsed_tx_for_analysis(
            calldata_with_tokens(
                ERC20_TRANSFER_SELECTOR,
                &[Token::Address(recipient), Token::Uint(U256::from(123u64))],
            ),
            Some(TO),
            "0",
        );
        let transfer_analysis = analysis_for(&transfer, None, AbiDecodeContext::default());
        assert!(classification_kinds(&transfer_analysis).contains(&"erc20Transfer".to_string()));
        assert_eq!(
            transfer_analysis.function_candidates[0].function_signature,
            ERC20_TRANSFER_SIGNATURE
        );
        assert_eq!(
            decoded_arg_value(
                &transfer_analysis.function_candidates[0].argument_summary,
                "amount"
            )
            .as_deref(),
            Some("123")
        );

        let approval = parsed_tx_for_analysis(
            calldata_with_tokens(
                ERC20_APPROVE_SELECTOR,
                &[Token::Address(recipient), Token::Uint(U256::from(5u64))],
            ),
            Some(TO),
            "0",
        );
        let approval_analysis = analysis_for(&approval, None, AbiDecodeContext::default());
        let approval_kinds = classification_kinds(&approval_analysis);
        assert!(approval_kinds.contains(&"erc20Approval".to_string()));
        assert!(!approval_kinds.contains(&"erc20Revoke".to_string()));

        let revoke = parsed_tx_for_analysis(
            calldata_with_tokens(
                ERC20_APPROVE_SELECTOR,
                &[Token::Address(recipient), Token::Uint(U256::zero())],
            ),
            Some(TO),
            "0",
        );
        let revoke_analysis = analysis_for(&revoke, None, AbiDecodeContext::default());
        let revoke_kinds = classification_kinds(&revoke_analysis);
        assert!(revoke_kinds.contains(&"erc20Approval".to_string()));
        assert!(revoke_kinds.contains(&"erc20Revoke".to_string()));
        assert!(!joined_json(&revoke_analysis)
            .contains("0000000000000000000000003333333333333333333333333333333333333333"));
    }

    #[test]
    fn decode_classifies_batch_disperse_and_unknown_raw_calldata() {
        let recipients = Token::Array(vec![Token::Address(test_address(CREATED))]);
        let values = Token::Array(vec![Token::Uint(U256::from(7u64))]);
        let disperse = parsed_tx_for_analysis(
            calldata_with_tokens(DISPERSE_ETHER_SELECTOR_HEX, &[recipients, values]),
            Some(TO),
            "7",
        );
        let disperse_analysis = analysis_for(&disperse, None, AbiDecodeContext::default());
        assert!(classification_kinds(&disperse_analysis).contains(&"batchDisperse".to_string()));
        assert_eq!(
            disperse_analysis.function_candidates[0].function_signature,
            DISPERSE_ETHER_METHOD
        );

        let unknown = parsed_tx_for_analysis(
            calldata_with_tokens("0x12345678", &[Token::Uint(U256::from(1u64))]),
            Some(TO),
            "0",
        );
        let unknown_analysis = analysis_for(&unknown, None, AbiDecodeContext::default());
        assert!(classification_kinds(&unknown_analysis).contains(&"rawCalldataUnknown".to_string()));
        assert!(uncertainty_codes(&unknown_analysis).contains(&"unknownSelector".to_string()));
    }

    #[test]
    fn decode_managed_abi_preserves_overloaded_function_signature() {
        let signature = "lookup(address)";
        let tx = parsed_tx_for_analysis(
            calldata_with_tokens(
                &selector_for_signature(signature),
                &[Token::Address(test_address(CREATED))],
            ),
            Some(TO),
            "0",
        );
        let source = source_for_analysis(
            TO,
            json!([
                raw_function("lookup", vec![raw_param("account", "address")]),
                raw_function("lookup", vec![raw_param("id", "uint256")]),
            ]),
            |_| {},
        );
        let analysis = analysis_for(&tx, None, context_with_sources(vec![source]));
        assert_eq!(analysis.selector.selector_match_count, 1);
        assert_eq!(analysis.selector.unique_signature_count, 1);
        assert!(analysis
            .function_candidates
            .iter()
            .any(|candidate| candidate.function_signature == signature
                && candidate.decode_status == "decoded"));
        assert!(classification_kinds(&analysis).contains(&"managedAbiCall".to_string()));
    }

    #[test]
    fn decode_surfaces_non_usable_abi_sources_without_candidates() {
        let tx = parsed_tx_for_analysis(
            calldata_with_tokens("0x42966c68", &[Token::Uint(U256::from(42u64))]),
            Some(TO),
            "0",
        );
        let raw_abi = json!([
            raw_function("burn", vec![raw_param("amount", "uint256")]),
            raw_function(
                "collate_propagate_storage",
                vec![raw_param("seed", "bytes16")]
            ),
        ]);
        let not_verified = source_for_analysis(TO, raw_abi.clone(), |source| {
            source.version_id = "not-verified-version".to_string();
            source.fetch_source_status = "notVerified".to_string();
        });
        let selector_conflict = source_for_analysis(TO, raw_abi, |source| {
            source.version_id = "selector-conflict-version".to_string();
            source.validation_status = "selectorConflict".to_string();
        });
        let stale_source = source_for_analysis(
            TO,
            json!([raw_function("burn", vec![raw_param("amount", "uint256")])]),
            |source| {
                source.version_id = "stale-version".to_string();
                source.cache_status = "cacheStale".to_string();
            },
        );
        let analysis = analysis_for(
            &tx,
            None,
            context_with_sources(vec![not_verified, selector_conflict, stale_source]),
        );
        let uncertainties = uncertainty_codes(&analysis);
        assert_eq!(analysis.selector.selector_match_count, 0);
        assert!(!analysis.selector.conflict);
        assert!(analysis.function_candidates.is_empty());
        assert!(!classification_kinds(&analysis).contains(&"managedAbiCall".to_string()));
        assert!(uncertainties.contains(&"selectorCollision".to_string()));
        assert!(uncertainties.contains(&"staleAbi".to_string()));
        assert!(uncertainties.contains(&"unverifiedAbi".to_string()));
        assert_eq!(analysis.status, "conflict");
    }

    #[test]
    fn non_usable_abi_sources_do_not_drive_function_event_or_error_decode() {
        let function_signature = "setOwner(address)";
        let event_signature = "OwnerChanged(address)";
        let error_signature = "Unauthorized(address)";
        let tx = parsed_tx_for_analysis(
            calldata_with_tokens(
                &selector_for_signature(function_signature),
                &[Token::Address(test_address(CREATED))],
            ),
            Some(TO),
            "0",
        );
        let log = parsed_log_for_analysis(
            TO,
            vec![H256::from_str(&topic_for_signature(event_signature)).expect("event topic")],
            encode(&[Token::Address(test_address(CREATED))]),
        );
        let receipt = parsed_receipt_for_analysis(0, vec![log]);
        let revert_data = normalized_revert_data(calldata_with_tokens(
            &selector_for_signature(error_signature),
            &[Token::Address(test_address(FROM))],
        ));
        let raw_abi = json!([
            raw_function("setOwner", vec![raw_param("owner", "address")]),
            raw_event("OwnerChanged", vec![raw_param("owner", "address")]),
            raw_error("Unauthorized", vec![raw_param("caller", "address")]),
        ]);
        let not_verified = source_for_analysis(TO, raw_abi.clone(), |source| {
            source.version_id = "not-verified-version".to_string();
            source.fetch_source_status = "notVerified".to_string();
        });
        let selector_conflict = source_for_analysis(TO, raw_abi, |source| {
            source.version_id = "selector-conflict-version".to_string();
            source.validation_status = "selectorConflict".to_string();
        });
        let analysis = analysis_for_with_revert(
            &tx,
            Some(&receipt),
            context_with_sources(vec![not_verified, selector_conflict]),
            &revert_data,
        );
        assert!(analysis.function_candidates.is_empty());
        assert!(analysis.event_candidates.is_empty());
        assert!(analysis.error_candidates.is_empty());
        assert!(!classification_kinds(&analysis).contains(&"managedAbiCall".to_string()));
        let uncertainties = uncertainty_codes(&analysis);
        assert!(uncertainties.contains(&"selectorCollision".to_string()));
        assert!(uncertainties.contains(&"unverifiedAbi".to_string()));
    }

    #[test]
    fn unusable_artifact_source_does_not_drive_decode() {
        let function_signature = "setOwner(address)";
        let tx = parsed_tx_for_analysis(
            calldata_with_tokens(
                &selector_for_signature(function_signature),
                &[Token::Address(test_address(CREATED))],
            ),
            Some(TO),
            "0",
        );
        let source = source_for_analysis(
            TO,
            json!([raw_function(
                "setOwner",
                vec![raw_param("owner", "address")]
            )]),
            |source| {
                source.version_id = "bad-artifact-version".to_string();
                source.artifact_status = "malformedAbiArtifact".to_string();
                source.error_summary = Some("ABI artifact could not be parsed".to_string());
            },
        );
        let analysis = analysis_for(&tx, None, context_with_sources(vec![source]));
        assert!(analysis.function_candidates.is_empty());
        assert!(!classification_kinds(&analysis).contains(&"managedAbiCall".to_string()));
        assert!(uncertainty_codes(&analysis).contains(&"malformedAbiArtifact".to_string()));
    }

    #[test]
    fn decode_surfaces_contract_creation_and_malformed_calldata() {
        let creation = parsed_tx_for_analysis(vec![0x60, 0x80, 0x60, 0x40], None, "0");
        let creation_analysis = analysis_for(&creation, None, AbiDecodeContext::default());
        assert!(classification_kinds(&creation_analysis).contains(&"contractCreation".to_string()));
        assert!(uncertainty_codes(&creation_analysis)
            .contains(&"contractCreationUnknownInitCode".to_string()));

        let malformed = parsed_tx_for_analysis(
            decode_hex_bytes(ERC20_TRANSFER_SELECTOR, "selector").expect("selector"),
            Some(TO),
            "0",
        );
        let malformed_analysis = analysis_for(&malformed, None, AbiDecodeContext::default());
        assert!(uncertainty_codes(&malformed_analysis).contains(&"malformedCalldata".to_string()));
        assert!(
            classification_kinds(&malformed_analysis).contains(&"rawCalldataUnknown".to_string())
        );
    }

    #[test]
    fn decode_rejects_trailing_calldata_for_builtin_and_managed_candidates() {
        let mut transfer_calldata = calldata_with_tokens(
            ERC20_TRANSFER_SELECTOR,
            &[
                Token::Address(test_address(CREATED)),
                Token::Uint(U256::from(123u64)),
            ],
        );
        transfer_calldata.extend(encode(&[Token::Uint(U256::from(999u64))]));
        let transfer = parsed_tx_for_analysis(transfer_calldata, Some(TO), "0");
        let transfer_analysis = analysis_for(&transfer, None, AbiDecodeContext::default());
        assert!(!classification_kinds(&transfer_analysis).contains(&"erc20Transfer".to_string()));
        assert!(uncertainty_codes(&transfer_analysis).contains(&"malformedCalldata".to_string()));
        assert!(transfer_analysis
            .function_candidates
            .iter()
            .any(|candidate| {
                candidate.function_signature == ERC20_TRANSFER_SIGNATURE
                    && candidate.decode_status == "decodeError"
            }));

        let signature = "setOwner(address)";
        let mut managed_calldata = calldata_with_tokens(
            &selector_for_signature(signature),
            &[Token::Address(test_address(CREATED))],
        );
        managed_calldata.extend(encode(&[Token::Uint(U256::from(1u64))]));
        let managed = parsed_tx_for_analysis(managed_calldata, Some(TO), "0");
        let source = source_for_analysis(
            TO,
            json!([raw_function(
                "setOwner",
                vec![raw_param("owner", "address")]
            )]),
            |_| {},
        );
        let managed_analysis = analysis_for(&managed, None, context_with_sources(vec![source]));
        assert!(!classification_kinds(&managed_analysis).contains(&"managedAbiCall".to_string()));
        assert!(managed_analysis
            .function_candidates
            .iter()
            .any(|candidate| {
                candidate.function_signature == signature
                    && candidate.decode_status == "decodeError"
            }));
    }

    #[test]
    fn decode_event_candidates_are_bounded_for_usable_abi_sources() {
        let topic0 = H256::from_str(&topic_for_signature(ERC20_TRANSFER_EVENT_SIGNATURE))
            .expect("transfer topic");
        let log = parsed_log_for_analysis(
            TO,
            vec![topic0, address_topic(FROM), address_topic(CREATED)],
            encode(&[Token::Uint(U256::from(9u64))]),
        );
        let receipt = parsed_receipt_for_analysis(1, vec![log]);
        let tx = parsed_tx_for_analysis(Vec::new(), Some(TO), "0");
        let source = source_for_analysis(
            TO,
            json!([raw_event(
                "Transfer",
                vec![
                    raw_indexed_param("from", "address"),
                    raw_indexed_param("to", "address"),
                    raw_param("value", "uint256"),
                ],
            )]),
            |_| {},
        );
        let analysis = analysis_for(&tx, Some(&receipt), context_with_sources(vec![source]));
        assert!(analysis.event_candidates.iter().any(|candidate| {
            candidate.event_signature == ERC20_TRANSFER_EVENT_SIGNATURE
                && candidate.source.is_some()
                && candidate.decode_status == "decoded"
        }));
        let serialized = joined_json(&analysis);
        assert!(!serialized
            .contains("0000000000000000000000001111111111111111111111111111111111111111"));
        assert!(!serialized
            .contains("0000000000000000000000003333333333333333333333333333333333333333"));
    }

    #[test]
    fn gated_event_topic_conflict_source_surfaces_event_uncertainty_without_candidates() {
        let event_signature = "VaultUpdated(address)";
        let topic0 = H256::from_str(&topic_for_signature(event_signature)).expect("event topic");
        let log = parsed_log_for_analysis(
            TO,
            vec![topic0],
            encode(&[Token::Address(test_address(CREATED))]),
        );
        let receipt = parsed_receipt_for_analysis(1, vec![log]);
        let tx = parsed_tx_for_analysis(Vec::new(), Some(TO), "0");
        let source = source_for_analysis(
            TO,
            json!([raw_event(
                "VaultUpdated",
                vec![raw_param("owner", "address")]
            )]),
            |source| {
                source.validation_status = "selectorConflict".to_string();
                source.selector_summary = Some(AbiSelectorSummaryRecord {
                    function_selector_count: Some(0),
                    event_topic_count: Some(1),
                    error_selector_count: Some(0),
                    duplicate_selector_count: Some(0),
                    conflict_count: Some(1),
                    notes: Some("event topic conflict".to_string()),
                });
            },
        );
        let analysis = analysis_for(&tx, Some(&receipt), context_with_sources(vec![source]));
        assert!(analysis.event_candidates.is_empty());
        assert!(uncertainty_codes(&analysis).contains(&"eventDecodeConflict".to_string()));
    }

    #[test]
    fn function_selector_conflict_source_does_not_invent_event_conflict() {
        let tx = parsed_tx_for_analysis(Vec::new(), Some(TO), "0");
        let source = source_for_analysis(
            TO,
            json!([
                raw_function("burn", vec![raw_param("amount", "uint256")]),
                raw_event("VaultUpdated", vec![raw_param("owner", "address")]),
            ]),
            |source| {
                source.validation_status = "selectorConflict".to_string();
                source.selector_summary = Some(AbiSelectorSummaryRecord {
                    function_selector_count: Some(2),
                    event_topic_count: Some(1),
                    error_selector_count: Some(0),
                    duplicate_selector_count: Some(0),
                    conflict_count: Some(1),
                    notes: Some("function selector conflict".to_string()),
                });
            },
        );
        let analysis = analysis_for(&tx, None, context_with_sources(vec![source]));
        let uncertainties = uncertainty_codes(&analysis);
        assert!(uncertainties.contains(&"selectorCollision".to_string()));
        assert!(!uncertainties.contains(&"eventDecodeConflict".to_string()));
    }

    #[test]
    fn decode_revert_data_generates_builtin_and_abi_error_candidates() {
        let tx = parsed_tx_for_analysis(
            calldata_with_tokens("0x12345678", &[Token::Uint(U256::from(1u64))]),
            Some(TO),
            "0",
        );
        let receipt = parsed_receipt_for_analysis(0, Vec::new());
        let builtin_revert = normalized_revert_data(calldata_with_tokens(
            ERROR_STRING_SELECTOR,
            &[Token::String("nope".to_string())],
        ));
        let builtin_analysis = analysis_for_with_revert(
            &tx,
            Some(&receipt),
            AbiDecodeContext::default(),
            &builtin_revert,
        );
        assert_eq!(builtin_analysis.revert_data_status, "present");
        assert!(builtin_analysis
            .error_candidates
            .iter()
            .any(
                |candidate| candidate.error_signature == ERROR_STRING_SIGNATURE
                    && candidate.decode_status == "decoded"
            ));
        assert_eq!(
            decoded_arg_value(
                &builtin_analysis.error_candidates[0].argument_summary,
                "message"
            )
            .as_deref(),
            Some("nope")
        );
        let serialized = joined_json(&builtin_analysis);
        assert!(!serialized
            .contains("08c379a00000000000000000000000000000000000000000000000000000000000000020"));

        let abi_error_signature = "Unauthorized(address)";
        let abi_revert = normalized_revert_data(calldata_with_tokens(
            &selector_for_signature(abi_error_signature),
            &[Token::Address(test_address(FROM))],
        ));
        let source = source_for_analysis(
            TO,
            json!([raw_error(
                "Unauthorized",
                vec![raw_param("caller", "address")]
            )]),
            |_| {},
        );
        let abi_analysis = analysis_for_with_revert(
            &tx,
            Some(&receipt),
            context_with_sources(vec![source]),
            &abi_revert,
        );
        assert!(abi_analysis
            .error_candidates
            .iter()
            .any(|candidate| candidate.error_signature == abi_error_signature
                && candidate.source.is_some()
                && candidate.decode_status == "decoded"));
    }

    #[test]
    fn decode_revert_data_surfaces_malformed_bounded_input() {
        let tx = parsed_tx_for_analysis(Vec::new(), Some(TO), "0");
        let malformed = NormalizedRevertData {
            source: "testBoundedInput".to_string(),
            status: "malformed".to_string(),
            bytes: None,
            error_summary: Some("boundedRevertData must have an even hex length".to_string()),
        };
        let analysis = analysis_for_with_revert(&tx, None, AbiDecodeContext::default(), &malformed);
        assert_eq!(analysis.revert_data_status, "malformed");
        assert!(analysis.error_candidates.is_empty());
        assert!(uncertainty_codes(&analysis).contains(&"malformedRevertData".to_string()));
        assert_eq!(
            analysis
                .revert_data
                .as_ref()
                .and_then(|summary| summary.data_hash.as_deref()),
            None
        );
    }

    #[test]
    fn decode_revert_data_rejects_trailing_and_oversized_payloads() {
        let tx = parsed_tx_for_analysis(Vec::new(), Some(TO), "0");
        let mut trailing =
            calldata_with_tokens(ERROR_STRING_SELECTOR, &[Token::String("nope".to_string())]);
        trailing.extend(encode(&[Token::Uint(U256::from(1u64))]));
        let trailing_revert = normalized_revert_data(trailing);
        let analysis =
            analysis_for_with_revert(&tx, None, AbiDecodeContext::default(), &trailing_revert);
        assert!(analysis.error_candidates.iter().any(|candidate| {
            candidate.error_signature == ERROR_STRING_SIGNATURE
                && candidate.decode_status == "decodeError"
        }));
        assert!(!analysis.error_candidates.iter().any(|candidate| {
            candidate.error_signature == ERROR_STRING_SIGNATURE
                && candidate.decode_status == "decoded"
        }));
        assert!(uncertainty_codes(&analysis).contains(&"malformedRevertData".to_string()));

        let oversized = format!("0x{}zz", "00".repeat(MAX_REVERT_DATA_BYTES + 1));
        let normalized = normalize_bounded_revert_data(TxAnalysisBoundedRevertDataInput {
            data: oversized,
            source: Some("test".to_string()),
        });
        assert_eq!(normalized.status, "payloadTooLarge");
        assert!(normalized.bytes.is_none());
    }

    #[test]
    fn unselected_invalid_and_stale_abi_sources_do_not_drive_decode() {
        let tx = parsed_tx_for_analysis(
            calldata_with_tokens(
                &selector_for_signature("setOwner(address)"),
                &[Token::Address(test_address(CREATED))],
            ),
            Some(TO),
            "0",
        );
        let raw_abi = json!([raw_function(
            "setOwner",
            vec![raw_param("owner", "address")]
        )]);
        let unselected = source_for_analysis(TO, raw_abi.clone(), |source| {
            source.selected = false;
            source.selection_status = "unselected".to_string();
            source.version_id = "unselected".to_string();
        });
        let invalid = source_for_analysis(TO, raw_abi.clone(), |source| {
            source.validation_status = "malformedAbi".to_string();
            source.version_id = "invalid".to_string();
        });
        let stale = source_for_analysis(TO, raw_abi, |source| {
            source.cache_status = "cacheStale".to_string();
            source.version_id = "stale".to_string();
        });
        let analysis = analysis_for(
            &tx,
            None,
            context_with_sources(vec![unselected, invalid, stale]),
        );
        assert!(analysis.function_candidates.is_empty());
        assert!(!classification_kinds(&analysis).contains(&"managedAbiCall".to_string()));
        let uncertainties = uncertainty_codes(&analysis);
        assert!(uncertainties.contains(&"malformedAbi".to_string()));
        assert!(uncertainties.contains(&"staleAbi".to_string()));
    }

    #[test]
    fn builtin_and_abi_signature_disagreement_is_selector_collision() {
        let tx = parsed_tx_for_analysis(
            calldata_with_tokens(
                ERC20_TRANSFER_SELECTOR,
                &[
                    Token::Address(test_address(CREATED)),
                    Token::Uint(U256::from(123u64)),
                ],
            ),
            Some(TO),
            "0",
        );
        let source = source_for_analysis(
            TO,
            json!([raw_function(
                "many_msg_babbage",
                vec![raw_param("payload", "bytes1")]
            )]),
            |_| {},
        );
        let analysis = analysis_for(&tx, None, context_with_sources(vec![source]));
        assert!(uncertainty_codes(&analysis).contains(&"selectorCollision".to_string()));
        assert!(analysis.selector.conflict);
        assert!(analysis
            .function_candidates
            .iter()
            .any(
                |candidate| candidate.function_signature == ERC20_TRANSFER_SIGNATURE
                    && candidate.confidence == "low"
            ));
        assert!(analysis.function_candidates.iter().any(|candidate| {
            candidate.function_signature == "many_msg_babbage(bytes1)"
                && candidate.confidence == "low"
        }));
    }

    #[test]
    fn abi_decode_context_missing_app_dir_is_read_only() {
        let (_override, dir) = AppDirOverride::missing("tx-analysis-missing-registry");
        let mut addresses = BTreeSet::new();
        addresses.insert(normalize_address_key(TO));

        let context = load_abi_decode_context(1, &addresses);

        assert!(context.sources_by_address.is_empty());
        assert_eq!(context.load_error, None);
        assert_missing_dir(&dir);
    }

    #[test]
    fn abi_artifact_read_missing_app_dir_is_read_only() {
        let (_override, dir) = AppDirOverride::missing("tx-analysis-missing-artifact");
        let entry = cache_entry_for_analysis(TO);

        let result = read_abi_artifact_text(&entry);

        assert!(result.is_err());
        assert_missing_dir(&dir);
    }

    #[tokio::test]
    async fn fetches_valid_confirmed_tx_summary_without_full_payloads() {
        let (rpc_url, requests, handle) = start_rpc_server(successful_confirmed_steps());
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");

        assert_eq!(result.status, STATUS_OK);
        assert_eq!(result.hash, HASH);
        assert_eq!(result.chain_id, 1);
        assert_eq!(result.rpc.actual_chain_id, Some(1));
        assert_eq!(
            result
                .transaction
                .as_ref()
                .and_then(|tx| tx.selector.as_deref()),
            Some("0xa9059cbb")
        );
        assert_eq!(
            result
                .transaction
                .as_ref()
                .map(|tx| tx.calldata_byte_length),
            Some(36)
        );
        assert_eq!(
            result.receipt.as_ref().map(|receipt| receipt.logs_count),
            Some(Some(1))
        );
        assert_eq!(
            result
                .receipt
                .as_ref()
                .and_then(|receipt| receipt.omitted_logs),
            None
        );
        assert_eq!(
            result.receipt.as_ref().and_then(|receipt| receipt.status),
            Some(1)
        );
        assert_eq!(
            result
                .block
                .as_ref()
                .and_then(|block| block.timestamp.as_deref()),
            Some("1694676160")
        );
        assert_eq!(result.address_codes.len(), 1);
        assert_eq!(result.address_codes[0].status, SOURCE_OK);
        assert_eq!(result.sources.explorer.status, SOURCE_ABSENT);
        assert_eq!(
            methods(&requests),
            vec![
                "eth_chainId",
                "eth_getTransactionByHash",
                "eth_getTransactionReceipt",
                "eth_getBlockByNumber",
                "eth_getCode"
            ]
        );
        assert_no_sensitive_payloads(&joined_json(&result));
    }

    #[tokio::test]
    async fn returns_missing_tx_without_extra_requests() {
        let (rpc_url, requests, handle) = start_rpc_server(vec![
            step("eth_chainId", json!("0x1")),
            step("eth_getTransactionByHash", Value::Null),
        ]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");

        assert_eq!(result.status, STATUS_MISSING_TX);
        assert_eq!(result.sources.transaction.status, SOURCE_MISSING);
        assert!(result.receipt.is_none());
        assert_eq!(
            methods(&requests),
            vec!["eth_chainId", "eth_getTransactionByHash"]
        );
    }

    #[tokio::test]
    async fn times_out_chain_id_probe() {
        let (rpc_url, requests, handle) = start_rpc_server(vec![no_response_step(
            "eth_chainId",
            Duration::from_millis(400),
        )]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");
        let serialized = joined_json(&result);

        assert_eq!(result.status, STATUS_RPC_FAILURE);
        assert!(result
            .reasons
            .iter()
            .any(|reason| reason == "chainIdProbeTimeout"));
        assert_eq!(result.sources.chain_id.status, SOURCE_UNAVAILABLE);
        assert_eq!(
            result.sources.chain_id.reason.as_deref(),
            Some("chainIdProbeTimeout")
        );
        assert_eq!(methods(&requests), vec!["eth_chainId"]);
        assert_no_sensitive_payloads(&serialized);
    }

    #[tokio::test]
    async fn rejects_missing_selected_rpc_before_rpc_lookup() {
        let result = fetch_tx_analysis_impl(TxAnalysisFetchInput {
            rpc_url: "http://127.0.0.1:9/v1?apiKey=super-secret-token".to_string(),
            chain_id: 1,
            tx_hash: HASH.to_string(),
            selected_rpc: None,
            bounded_revert_data: None,
        })
        .await;
        let serialized = joined_json(&result);

        assert_eq!(result.status, STATUS_VALIDATION_ERROR);
        assert!(result
            .reasons
            .iter()
            .any(|reason| reason == "selectedRpc is required for tx analysis fetch"));
        assert!(!serialized.contains("super-secret-token"));
        assert!(!serialized.contains("apiKey=super-secret-token"));
    }

    #[tokio::test]
    async fn rejects_selected_rpc_identity_mismatch_before_rpc_lookup() {
        let rpc_url = "http://127.0.0.1:9/v1?apiKey=super-secret-token";
        let result = fetch_tx_analysis_impl(TxAnalysisFetchInput {
            rpc_url: rpc_url.to_string(),
            chain_id: 1,
            tx_hash: HASH.to_string(),
            selected_rpc: Some(selected_rpc("https://other-rpc.example/v1?apiKey=other")),
            bounded_revert_data: None,
        })
        .await;
        let serialized = joined_json(&result);

        assert_eq!(result.status, STATUS_VALIDATION_ERROR);
        assert!(result
            .reasons
            .iter()
            .any(|reason| reason == "submitted rpcUrl does not match selectedRpc endpointSummary"));
        assert!(!serialized.contains("super-secret-token"));
        assert!(!serialized.contains("apiKey=super-secret-token"));
    }

    #[tokio::test]
    async fn rejects_selected_rpc_chain_mismatch_before_remote_chain_probe() {
        let rpc_url = "http://127.0.0.1:9/v1?apiKey=super-secret-token";
        let mut selected_rpc = selected_rpc(rpc_url);
        selected_rpc.chain_id = Some(5);
        let result = fetch_tx_analysis_impl(TxAnalysisFetchInput {
            rpc_url: rpc_url.to_string(),
            chain_id: 1,
            tx_hash: HASH.to_string(),
            selected_rpc: Some(selected_rpc),
            bounded_revert_data: None,
        })
        .await;

        assert_eq!(result.status, STATUS_VALIDATION_ERROR);
        assert!(result
            .reasons
            .iter()
            .any(|reason| reason == "selectedRpc.chainId does not match tx analysis chainId"));
    }

    #[tokio::test]
    async fn returns_pending_no_receipt() {
        let (rpc_url, requests, handle) = start_rpc_server(vec![
            step("eth_chainId", json!("0x1")),
            step("eth_getTransactionByHash", pending_tx()),
            step("eth_getTransactionReceipt", Value::Null),
            step("eth_getCode", json!("0x6001")),
        ]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");

        assert_eq!(result.status, STATUS_PENDING);
        assert_eq!(result.sources.receipt.status, SOURCE_PENDING);
        assert!(result.receipt.is_none());
        assert!(result.block.is_none());
        assert_eq!(
            methods(&requests),
            vec![
                "eth_chainId",
                "eth_getTransactionByHash",
                "eth_getTransactionReceipt",
                "eth_getCode"
            ]
        );
    }

    #[tokio::test]
    async fn returns_reverted_receipt() {
        let (rpc_url, _requests, handle) = start_rpc_server(vec![
            step("eth_chainId", json!("0x1")),
            step("eth_getTransactionByHash", confirmed_tx("0x12345678")),
            step("eth_getTransactionReceipt", receipt("0x0", None)),
            step("eth_getBlockByNumber", block()),
            step("eth_getCode", json!("0x6001")),
        ]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");

        assert_eq!(result.status, STATUS_REVERTED);
        assert_eq!(
            result
                .receipt
                .as_ref()
                .map(|receipt| receipt.status_label.as_str()),
            Some("reverted")
        );
        assert!(result
            .reasons
            .iter()
            .any(|reason| reason == "receiptReverted"));
    }

    #[tokio::test]
    async fn rejects_receipt_transaction_hash_mismatch() {
        let (rpc_url, _requests, handle) = start_rpc_server(vec![
            step("eth_chainId", json!("0x1")),
            step("eth_getTransactionByHash", confirmed_tx("0x12345678")),
            step(
                "eth_getTransactionReceipt",
                receipt_with_transaction_hash(OTHER_HASH),
            ),
            step("eth_getBlockByNumber", block()),
            step("eth_getCode", json!("0x6001")),
        ]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");

        assert_eq!(result.status, STATUS_PARTIAL);
        assert!(result
            .reasons
            .iter()
            .any(|reason| reason == "receiptResponseInvalid"));
        assert_eq!(result.sources.receipt.status, SOURCE_UNAVAILABLE);
        assert_eq!(
            result.sources.receipt.reason.as_deref(),
            Some("receiptResponseInvalid")
        );
        assert!(result.receipt.is_none());
    }

    #[tokio::test]
    async fn marks_missing_receipt_logs_without_inventing_zero_logs() {
        let (rpc_url, _requests, handle) = start_rpc_server(vec![
            step("eth_chainId", json!("0x1")),
            step("eth_getTransactionByHash", confirmed_tx("0x12345678")),
            step("eth_getTransactionReceipt", receipt_without_logs()),
            step("eth_getBlockByNumber", block()),
            step("eth_getCode", json!("0x6001")),
        ]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");

        assert_eq!(result.status, STATUS_PARTIAL);
        assert!(result.reasons.iter().any(|reason| reason == "missingLogs"));
        assert_eq!(result.sources.receipt.status, SOURCE_OK);
        assert_eq!(result.sources.logs.status, SOURCE_UNAVAILABLE);
        assert_eq!(result.sources.logs.reason.as_deref(), Some("missingLogs"));
        let receipt = result.receipt.as_ref().expect("receipt summary");
        assert_eq!(receipt.status_label, "success");
        assert_eq!(receipt.logs_status, "missing");
        assert_eq!(receipt.logs_count, None);
        assert_eq!(receipt.omitted_logs, None);
        assert!(receipt.logs.is_empty());
    }

    #[tokio::test]
    async fn rejects_wrong_chain_before_tx_lookup() {
        let (rpc_url, requests, handle) = start_rpc_server(vec![step("eth_chainId", json!("0x5"))]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");

        assert_eq!(result.status, STATUS_CHAIN_MISMATCH);
        assert_eq!(result.rpc.actual_chain_id, Some(5));
        assert_eq!(result.sources.chain_id.status, SOURCE_CHAIN_MISMATCH);
        assert_eq!(methods(&requests), vec!["eth_chainId"]);
    }

    #[tokio::test]
    async fn marks_block_unavailable() {
        let (rpc_url, _requests, handle) = start_rpc_server(vec![
            step("eth_chainId", json!("0x1")),
            step("eth_getTransactionByHash", confirmed_tx("0x12345678")),
            step("eth_getTransactionReceipt", receipt("0x1", None)),
            step("eth_getBlockByNumber", Value::Null),
            step("eth_getCode", json!("0x6001")),
        ]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");

        assert_eq!(result.status, STATUS_PARTIAL);
        assert_eq!(result.sources.block.status, SOURCE_UNAVAILABLE);
        assert!(result.block.is_none());
    }

    #[tokio::test]
    async fn rejects_block_number_mismatch() {
        let (rpc_url, _requests, handle) = start_rpc_server(vec![
            step("eth_chainId", json!("0x1")),
            step("eth_getTransactionByHash", confirmed_tx("0x12345678")),
            step("eth_getTransactionReceipt", receipt("0x1", None)),
            step("eth_getBlockByNumber", block_with("0x7c", BLOCK_HASH)),
            step("eth_getCode", json!("0x6001")),
        ]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");

        assert_eq!(result.status, STATUS_PARTIAL);
        assert!(result
            .reasons
            .iter()
            .any(|reason| reason == "blockNumberMismatch"));
        assert_eq!(result.sources.block.status, SOURCE_UNAVAILABLE);
        assert_eq!(
            result.sources.block.reason.as_deref(),
            Some("blockNumberMismatch")
        );
        assert!(result.block.is_none());
    }

    #[tokio::test]
    async fn rejects_block_hash_mismatch() {
        let (rpc_url, _requests, handle) = start_rpc_server(vec![
            step("eth_chainId", json!("0x1")),
            step("eth_getTransactionByHash", confirmed_tx("0x12345678")),
            step("eth_getTransactionReceipt", receipt("0x1", None)),
            step("eth_getBlockByNumber", block_with("0x7b", OTHER_HASH)),
            step("eth_getCode", json!("0x6001")),
        ]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");

        assert_eq!(result.status, STATUS_PARTIAL);
        assert!(result
            .reasons
            .iter()
            .any(|reason| reason == "blockHashMismatch"));
        assert_eq!(result.sources.block.status, SOURCE_UNAVAILABLE);
        assert_eq!(
            result.sources.block.reason.as_deref(),
            Some("blockHashMismatch")
        );
        assert!(result.block.is_none());
    }

    #[tokio::test]
    async fn marks_code_unavailable_and_redacts_provider_error() {
        let (rpc_url, _requests, handle) = start_rpc_server(vec![
            step("eth_chainId", json!("0x1")),
            step("eth_getTransactionByHash", confirmed_tx("0x12345678")),
            step("eth_getTransactionReceipt", receipt("0x1", None)),
            step("eth_getBlockByNumber", block()),
            error_step(
                "eth_getCode",
                "upstream failed apiKey=super-secret-token url=https://user:pass@example.invalid/rpc",
            ),
        ]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");
        let serialized = joined_json(&result);

        assert_eq!(result.status, STATUS_PARTIAL);
        assert_eq!(result.sources.code.status, SOURCE_UNAVAILABLE);
        assert_eq!(result.address_codes[0].status, SOURCE_UNAVAILABLE);
        assert!(serialized.contains("[redacted]") || serialized.contains("[redacted_url]"));
        assert_no_sensitive_payloads(&serialized);
    }

    #[tokio::test]
    async fn fetches_contract_creation_code_from_receipt_contract() {
        let (rpc_url, requests, handle) = start_rpc_server(vec![
            step("eth_chainId", json!("0x1")),
            step("eth_getTransactionByHash", contract_creation_tx()),
            step("eth_getTransactionReceipt", receipt("0x1", Some(CREATED))),
            step("eth_getBlockByNumber", block()),
            step("eth_getCode", json!("0x60806040")),
        ]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");

        assert_eq!(result.status, STATUS_OK);
        assert_eq!(
            result.transaction.as_ref().map(|tx| tx.contract_creation),
            Some(true)
        );
        assert_eq!(result.address_codes.len(), 1);
        assert_eq!(result.address_codes[0].role, "createdContract");
        assert_eq!(
            result.receipt.as_ref().and_then(|receipt| {
                receipt
                    .contract_address
                    .as_ref()
                    .map(|address| address.to_ascii_lowercase())
            }),
            Some(CREATED.to_string())
        );
        let requests = requests.lock().expect("request lock");
        let code_params = requests
            .iter()
            .find(|request| request.get("method").and_then(Value::as_str) == Some("eth_getCode"))
            .and_then(|request| request.get("params"))
            .and_then(Value::as_array)
            .cloned()
            .expect("code params");
        assert_eq!(
            code_params
                .first()
                .and_then(Value::as_str)
                .map(str::to_ascii_lowercase),
            Some(CREATED.to_string())
        );
    }

    #[tokio::test]
    async fn minimal_outbound_request_shape_excludes_local_context() {
        let (rpc_url, requests, handle) = start_rpc_server(successful_confirmed_steps());
        let _ = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");
        let serialized_requests = joined_json(&*requests.lock().expect("request lock"));

        assert!(serialized_requests.contains(HASH));
        assert!(serialized_requests.contains(TO));
        assert!(!serialized_requests.contains("accountLabel"));
        assert!(!serialized_requests.contains("notes"));
        assert!(!serialized_requests.contains("history"));
        assert!(!serialized_requests.contains("wallet"));
        assert!(!serialized_requests.contains("super-secret-token"));
        assert_eq!(
            methods(&requests),
            vec![
                "eth_chainId",
                "eth_getTransactionByHash",
                "eth_getTransactionReceipt",
                "eth_getBlockByNumber",
                "eth_getCode"
            ]
        );
    }

    #[tokio::test]
    async fn provider_failure_redacts_rpc_secrets() {
        let (rpc_url, _requests, handle) = start_rpc_server(vec![error_step(
            "eth_chainId",
            "backend unavailable token=secret-token Authorization=Bearer secret api_key=abc123 https://rpc.invalid/path?apiKey=secret",
        )]);
        let result = fetch_tx_analysis_impl(base_input(&rpc_url)).await;
        handle.join().expect("rpc server joins");
        let serialized = joined_json(&result);

        assert_eq!(result.status, STATUS_RPC_FAILURE);
        assert_no_sensitive_payloads(&serialized);
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("abc123"));
        assert!(!serialized.contains("Authorization=Bearer secret"));
        assert!(serialized.contains("[redacted]") || serialized.contains("[redacted_url]"));
    }

    #[tokio::test]
    async fn validates_tx_hash_shape() {
        let result = fetch_tx_analysis_impl(TxAnalysisFetchInput {
            rpc_url: "https://rpc.example.invalid?apiKey=secret".to_string(),
            chain_id: 1,
            tx_hash: OTHER_HASH[..20].to_string(),
            selected_rpc: None,
            bounded_revert_data: None,
        })
        .await;

        assert_eq!(result.status, STATUS_VALIDATION_ERROR);
        assert!(result
            .reasons
            .iter()
            .any(|reason| reason == "txHash must be a 32-byte 0x-prefixed hex hash"));
        assert!(!joined_json(&result).contains("apiKey=secret"));
    }
}
