use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultBlob {
    pub version: u8,
    pub salt_b64: String,
    pub iv_b64: String,
    pub ciphertext_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_chain_id", alias = "default_chain_id")]
    pub default_chain_id: u64,
    #[serde(default = "default_idle_lock_minutes", alias = "idle_lock_minutes")]
    pub idle_lock_minutes: u32,
    #[serde(
        default = "default_enabled_builtin_chain_ids",
        alias = "enabled_builtin_chain_ids"
    )]
    pub enabled_builtin_chain_ids: Vec<u64>,
    #[serde(default, alias = "rpc_endpoints")]
    pub rpc_endpoints: Vec<RpcEndpointConfig>,
    #[serde(default, alias = "display_preferences")]
    pub display_preferences: DisplayPreferences,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            default_chain_id: default_chain_id(),
            idle_lock_minutes: default_idle_lock_minutes(),
            enabled_builtin_chain_ids: default_enabled_builtin_chain_ids(),
            rpc_endpoints: Vec::new(),
            display_preferences: DisplayPreferences::default(),
        }
    }
}

fn default_chain_id() -> u64 {
    1
}

fn default_idle_lock_minutes() -> u32 {
    15
}

fn default_enabled_builtin_chain_ids() -> Vec<u64> {
    vec![1, 8453, 42161, 10, 56, 137]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RpcEndpointConfig {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub name: String,
    #[serde(alias = "native_symbol")]
    pub native_symbol: String,
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(alias = "validated_at")]
    pub validated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DisplayPreferences {
    #[serde(alias = "fiat_currency")]
    pub fiat_currency: String,
}

impl Default for DisplayPreferences {
    fn default() -> Self {
        Self {
            fiat_currency: "USD".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ChainOutcomeState {
    Pending,
    Confirmed,
    Failed,
    Replaced,
    Cancelled,
    Dropped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SubmissionKind {
    Legacy,
    NativeTransfer,
    Erc20Transfer,
    Replacement,
    Cancellation,
    #[serde(other)]
    Unsupported,
}

impl Default for SubmissionKind {
    fn default() -> Self {
        Self::Legacy
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransactionType {
    Legacy,
    NativeTransfer,
    Erc20Transfer,
    ContractCall,
    #[serde(other)]
    Unknown,
}

impl Default for TransactionType {
    fn default() -> Self {
        Self::NativeTransfer
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TypedTransactionFields {
    #[serde(default)]
    pub transaction_type: TransactionType,
    #[serde(default)]
    pub token_contract: Option<String>,
    #[serde(default)]
    pub recipient: Option<String>,
    #[serde(default)]
    pub amount_raw: Option<String>,
    #[serde(default)]
    pub decimals: Option<u8>,
    #[serde(default)]
    pub token_symbol: Option<String>,
    #[serde(default)]
    pub token_name: Option<String>,
    #[serde(default)]
    pub token_metadata_source: Option<String>,
    #[serde(default)]
    pub selector: Option<String>,
    #[serde(default)]
    pub method_name: Option<String>,
    #[serde(default)]
    pub native_value_wei: Option<String>,
}

impl TypedTransactionFields {
    pub fn native_transfer(value_wei: impl Into<String>) -> Self {
        Self {
            transaction_type: TransactionType::NativeTransfer,
            native_value_wei: Some(value_wei.into()),
            ..Self::default()
        }
    }

    pub fn erc20_transfer(
        token_contract: impl Into<String>,
        recipient: impl Into<String>,
        amount_raw: impl Into<String>,
        decimals: u8,
        token_symbol: Option<String>,
        token_name: Option<String>,
        token_metadata_source: impl Into<String>,
    ) -> Self {
        Self {
            transaction_type: TransactionType::Erc20Transfer,
            token_contract: Some(token_contract.into()),
            recipient: Some(recipient.into()),
            amount_raw: Some(amount_raw.into()),
            decimals: Some(decimals),
            token_symbol,
            token_name,
            token_metadata_source: Some(token_metadata_source.into()),
            selector: Some("0xa9059cbb".to_string()),
            method_name: Some("transfer(address,uint256)".to_string()),
            native_value_wei: Some("0".to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeTransferIntent {
    #[serde(flatten)]
    pub typed_transaction: TypedTransactionFields,
    pub rpc_url: String,
    pub account_index: u32,
    pub chain_id: u64,
    pub from: String,
    pub to: String,
    pub value_wei: String,
    pub nonce: u64,
    pub gas_limit: String,
    pub max_fee_per_gas: String,
    pub max_priority_fee_per_gas: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Erc20TransferIntent {
    pub rpc_url: String,
    pub account_index: u32,
    pub chain_id: u64,
    pub from: String,
    pub token_contract: String,
    pub recipient: String,
    pub amount_raw: String,
    pub decimals: u8,
    #[serde(default)]
    pub token_symbol: Option<String>,
    #[serde(default)]
    pub token_name: Option<String>,
    pub token_metadata_source: String,
    pub nonce: u64,
    pub gas_limit: String,
    pub max_fee_per_gas: String,
    pub max_priority_fee_per_gas: String,
    #[serde(default)]
    pub latest_base_fee_per_gas: Option<String>,
    pub base_fee_per_gas: String,
    pub base_fee_multiplier: String,
    #[serde(default)]
    pub max_fee_override_per_gas: Option<String>,
    pub selector: String,
    pub method: String,
    pub native_value_wei: String,
    pub frozen_key: String,
}

fn unknown_string() -> String {
    "unknown".to_string()
}

fn legacy_string() -> String {
    "legacy".to_string()
}

fn history_schema_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntentSnapshotMetadata {
    #[serde(default = "legacy_string")]
    pub source: String,
    #[serde(default)]
    pub captured_at: Option<String>,
}

impl Default for IntentSnapshotMetadata {
    fn default() -> Self {
        Self {
            source: legacy_string(),
            captured_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmissionRecord {
    #[serde(flatten)]
    pub typed_transaction: TypedTransactionFields,
    pub frozen_key: String,
    pub tx_hash: String,
    #[serde(default)]
    pub kind: SubmissionKind,
    #[serde(default = "legacy_string")]
    pub source: String,
    #[serde(default)]
    pub chain_id: Option<u64>,
    #[serde(default)]
    pub account_index: Option<u32>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub value_wei: Option<String>,
    #[serde(default)]
    pub nonce: Option<u64>,
    #[serde(default)]
    pub gas_limit: Option<String>,
    #[serde(default)]
    pub max_fee_per_gas: Option<String>,
    #[serde(default)]
    pub max_priority_fee_per_gas: Option<String>,
    #[serde(default)]
    pub broadcasted_at: Option<String>,
    #[serde(default)]
    pub replaces_tx_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptSummary {
    #[serde(default)]
    pub status: Option<u64>,
    #[serde(default)]
    pub block_number: Option<u64>,
    #[serde(default)]
    pub block_hash: Option<String>,
    #[serde(default)]
    pub transaction_index: Option<u64>,
    #[serde(default)]
    pub gas_used: Option<String>,
    #[serde(default)]
    pub effective_gas_price: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcileSummary {
    #[serde(default = "legacy_string")]
    pub source: String,
    #[serde(default)]
    pub checked_at: Option<String>,
    #[serde(default)]
    pub rpc_chain_id: Option<u64>,
    #[serde(default)]
    pub latest_confirmed_nonce: Option<u64>,
    #[serde(default = "unknown_string")]
    pub decision: String,
}

impl Default for ReconcileSummary {
    fn default() -> Self {
        Self {
            source: legacy_string(),
            checked_at: None,
            rpc_chain_id: None,
            latest_confirmed_nonce: None,
            decision: unknown_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DroppedReviewSummary {
    pub reviewed_at: String,
    #[serde(default = "legacy_string")]
    pub source: String,
    pub tx_hash: String,
    #[serde(default = "unknown_string")]
    pub rpc_endpoint_summary: String,
    #[serde(default)]
    pub requested_chain_id: Option<u64>,
    #[serde(default)]
    pub rpc_chain_id: Option<u64>,
    #[serde(default)]
    pub latest_confirmed_nonce: Option<u64>,
    #[serde(default)]
    pub transaction_found: Option<bool>,
    #[serde(default)]
    pub local_same_nonce_tx_hash: Option<String>,
    #[serde(default)]
    pub local_same_nonce_state: Option<ChainOutcomeState>,
    pub original_state: ChainOutcomeState,
    #[serde(default)]
    pub original_finalized_at: Option<String>,
    #[serde(default)]
    pub original_reconciled_at: Option<String>,
    #[serde(default)]
    pub original_reconcile_summary: Option<ReconcileSummary>,
    pub result_state: ChainOutcomeState,
    #[serde(default)]
    pub receipt: Option<ReceiptSummary>,
    #[serde(default = "unknown_string")]
    pub decision: String,
    #[serde(default = "unknown_string")]
    pub recommendation: String,
    #[serde(default)]
    pub error_summary: Option<HistoryErrorSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryErrorSummary {
    #[serde(default = "legacy_string")]
    pub source: String,
    #[serde(default = "unknown_string")]
    pub category: String,
    #[serde(default = "unknown_string")]
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainOutcome {
    pub state: ChainOutcomeState,
    pub tx_hash: String,
    #[serde(default)]
    pub receipt: Option<ReceiptSummary>,
    #[serde(default)]
    pub finalized_at: Option<String>,
    #[serde(default)]
    pub reconciled_at: Option<String>,
    #[serde(default)]
    pub reconcile_summary: Option<ReconcileSummary>,
    #[serde(default)]
    pub error_summary: Option<HistoryErrorSummary>,
    #[serde(default)]
    pub dropped_review_history: Vec<DroppedReviewSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NonceThread {
    #[serde(default = "legacy_string")]
    pub source: String,
    #[serde(default = "unknown_string")]
    pub key: String,
    #[serde(default)]
    pub chain_id: Option<u64>,
    #[serde(default)]
    pub account_index: Option<u32>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub nonce: Option<u64>,
    #[serde(default)]
    pub replaces_tx_hash: Option<String>,
    #[serde(default)]
    pub replaced_by_tx_hash: Option<String>,
}

impl Default for NonceThread {
    fn default() -> Self {
        Self {
            source: legacy_string(),
            key: unknown_string(),
            chain_id: None,
            account_index: None,
            from: None,
            nonce: None,
            replaces_tx_hash: None,
            replaced_by_tx_hash: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryRecord {
    #[serde(default = "history_schema_version")]
    pub schema_version: u32,
    pub intent: NativeTransferIntent,
    #[serde(default)]
    pub intent_snapshot: IntentSnapshotMetadata,
    pub submission: SubmissionRecord,
    pub outcome: ChainOutcome,
    #[serde(default)]
    pub nonce_thread: NonceThread,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HistoryRecoveryIntentStatus {
    Active,
    Recovered,
    Dismissed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecoveryIntent {
    pub schema_version: u32,
    pub id: String,
    pub status: HistoryRecoveryIntentStatus,
    pub created_at: String,
    pub tx_hash: String,
    #[serde(default)]
    pub kind: SubmissionKind,
    #[serde(default)]
    pub chain_id: Option<u64>,
    #[serde(default)]
    pub account_index: Option<u32>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub nonce: Option<u64>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub value_wei: Option<String>,
    #[serde(default)]
    pub token_contract: Option<String>,
    #[serde(default)]
    pub recipient: Option<String>,
    #[serde(default)]
    pub amount_raw: Option<String>,
    #[serde(default)]
    pub decimals: Option<u8>,
    #[serde(default)]
    pub token_symbol: Option<String>,
    #[serde(default)]
    pub token_name: Option<String>,
    #[serde(default)]
    pub token_metadata_source: Option<String>,
    #[serde(default)]
    pub selector: Option<String>,
    #[serde(default)]
    pub method_name: Option<String>,
    #[serde(default)]
    pub native_value_wei: Option<String>,
    #[serde(default)]
    pub frozen_key: Option<String>,
    #[serde(default)]
    pub gas_limit: Option<String>,
    #[serde(default)]
    pub max_fee_per_gas: Option<String>,
    #[serde(default)]
    pub max_priority_fee_per_gas: Option<String>,
    #[serde(default)]
    pub replaces_tx_hash: Option<String>,
    pub broadcasted_at: String,
    pub write_error: String,
    #[serde(default)]
    pub last_recovery_error: Option<String>,
    #[serde(default)]
    pub recovered_at: Option<String>,
    #[serde(default)]
    pub dismissed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HistoryRecoveryResultStatus {
    Recovered,
    PendingRecovered,
    AlreadyRecovered,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecoveryResult {
    pub status: HistoryRecoveryResultStatus,
    pub intent: HistoryRecoveryIntent,
    pub record: HistoryRecord,
    pub history: Vec<HistoryRecord>,
    pub message: String,
}
