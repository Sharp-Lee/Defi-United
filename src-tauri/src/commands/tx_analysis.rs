use std::str::FromStr;

use ethers::providers::{Http, Middleware, Provider};
use ethers::types::{Address, H256, U256};
use ethers::utils::{keccak256, to_checksum};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::time::{timeout, Duration};

use crate::diagnostics::sanitize_diagnostic_message;

const CALLDATA_HASH_VERSION: &str = "keccak256-v1";
const CODE_HASH_VERSION: &str = "keccak256-v1";
const LOG_DATA_HASH_VERSION: &str = "keccak256-v1";
const LOG_SUMMARY_LIMIT: usize = 16;
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

#[derive(Debug, Clone)]
struct NormalizedFetchInput {
    rpc_url: String,
    chain_id: u64,
    tx_hash: String,
}

#[derive(Debug, Clone)]
struct ParsedTransaction {
    summary: TxAnalysisTransactionSummary,
    to_address: Option<String>,
    block_number: Option<u64>,
    block_hash: Option<String>,
}

#[derive(Debug, Clone)]
struct ParsedReceipt {
    summary: TxAnalysisReceiptSummary,
    block_number: Option<u64>,
    block_hash: Option<String>,
    logs_missing: bool,
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
                model.receipt = Some(parsed_receipt.summary);
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
    })
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
    let (logs_status, logs_count, log_summaries, omitted_logs, logs_missing) =
        match value.get("logs") {
            Some(Value::Array(logs)) => {
                let logs_count = logs.len() as u64;
                let log_summaries = logs
                    .iter()
                    .take(LOG_SUMMARY_LIMIT)
                    .map(parse_log_summary)
                    .collect::<Result<Vec<_>, _>>()?;
                (
                    SOURCE_OK.to_string(),
                    Some(logs_count),
                    log_summaries,
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
            logs: log_summaries,
            omitted_logs,
        },
        block_number,
        block_hash,
        logs_missing,
    })
}

fn parse_log_summary(value: &Value) -> Result<TxAnalysisLogSummary, String> {
    let address = required_address(value, "address")?;
    let log_index = optional_quantity_u64(value, "logIndex")?;
    let topics = value
        .get("topics")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let topic0 = topics
        .first()
        .and_then(Value::as_str)
        .map(normalize_hash)
        .transpose()?;
    let data = value.get("data").and_then(Value::as_str).unwrap_or("0x");
    let data_bytes = decode_hex_bytes(data, "log data")?;
    let removed = value.get("removed").and_then(Value::as_bool);

    Ok(TxAnalysisLogSummary {
        address,
        log_index,
        topic0,
        topics_count: topics.len() as u64,
        data_byte_length: data_bytes.len() as u64,
        data_hash_version: LOG_DATA_HASH_VERSION.to_string(),
        data_hash: prefixed_hash(&data_bytes),
        removed,
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

    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    const HASH: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const OTHER_HASH: &str = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const BLOCK_HASH: &str = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const FROM: &str = "0x1111111111111111111111111111111111111111";
    const TO: &str = "0x2222222222222222222222222222222222222222";
    const CREATED: &str = "0x3333333333333333333333333333333333333333";
    const TOPIC0: &str = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const SECRET_RPC_PATH: &str = "/v1?apiKey=super-secret-token";

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
