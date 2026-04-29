use serde::{Deserialize, Deserializer, Serialize, Serializer};

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
    AbiWriteCall,
    RawCalldata,
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
    RawCalldata,
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
    #[serde(
        default,
        deserialize_with = "deserialize_sanitized_raw_calldata_selector_option",
        serialize_with = "serialize_sanitized_raw_calldata_selector_option"
    )]
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

    pub fn contract_call(
        selector: impl Into<String>,
        method_name: impl Into<String>,
        native_value_wei: impl Into<String>,
    ) -> Self {
        Self {
            transaction_type: TransactionType::ContractCall,
            selector: Some(selector.into()),
            method_name: Some(method_name.into()),
            native_value_wei: Some(native_value_wei.into()),
            ..Self::default()
        }
    }

    pub fn raw_calldata(selector: Option<String>, native_value_wei: impl Into<String>) -> Self {
        Self {
            transaction_type: TransactionType::RawCalldata,
            selector,
            native_value_wei: Some(native_value_wei.into()),
            ..Self::default()
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchHistoryMetadata {
    pub batch_id: String,
    pub child_id: String,
    pub batch_kind: String,
    pub asset_kind: String,
    #[serde(default)]
    pub child_index: Option<u32>,
    #[serde(default)]
    pub freeze_key: Option<String>,
    #[serde(default)]
    pub child_count: Option<u32>,
    #[serde(default)]
    pub contract_address: Option<String>,
    #[serde(default)]
    pub selector: Option<String>,
    #[serde(default)]
    pub method_name: Option<String>,
    #[serde(default)]
    pub total_value_wei: Option<String>,
    #[serde(default)]
    pub token_contract: Option<String>,
    #[serde(default)]
    pub decimals: Option<u8>,
    #[serde(default)]
    pub token_symbol: Option<String>,
    #[serde(default)]
    pub token_name: Option<String>,
    #[serde(default)]
    pub token_metadata_source: Option<String>,
    #[serde(default)]
    pub total_amount_raw: Option<String>,
    #[serde(default)]
    pub recipients: Vec<BatchRecipientAllocation>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRecipientAllocation {
    pub child_id: String,
    pub child_index: u32,
    pub target_kind: String,
    pub target_address: String,
    pub value_wei: String,
    #[serde(default)]
    pub amount_raw: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiCallSelectedRpcSummary {
    #[serde(default, alias = "chain_id")]
    pub chain_id: Option<u64>,
    #[serde(default, alias = "provider_config_id")]
    pub provider_config_id: Option<String>,
    #[serde(default, alias = "endpoint_id")]
    pub endpoint_id: Option<String>,
    #[serde(
        default,
        alias = "endpoint_name",
        deserialize_with = "deserialize_sanitized_rpc_option_120",
        serialize_with = "serialize_sanitized_rpc_option_120"
    )]
    pub endpoint_name: Option<String>,
    #[serde(
        default,
        alias = "endpoint_summary",
        deserialize_with = "deserialize_sanitized_rpc_option_200",
        serialize_with = "serialize_sanitized_rpc_option_200"
    )]
    pub endpoint_summary: Option<String>,
    #[serde(default, alias = "endpoint_fingerprint")]
    pub endpoint_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiCallStatusSummary {
    #[serde(default = "unknown_string")]
    pub level: String,
    #[serde(default = "unknown_string")]
    pub code: String,
    #[serde(
        default,
        deserialize_with = "deserialize_sanitized_text_option_256",
        serialize_with = "serialize_sanitized_text_option_256"
    )]
    pub message: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiDecodedFieldHistorySummary {
    #[serde(
        default,
        deserialize_with = "deserialize_sanitized_text_option_96",
        serialize_with = "serialize_sanitized_text_option_96"
    )]
    pub name: Option<String>,
    #[serde(default)]
    pub value: AbiDecodedValueHistorySummary,
}

#[derive(Debug, Clone, Default)]
pub struct AbiDecodedValueHistorySummary {
    pub kind: String,
    pub type_label: String,
    pub value: Option<String>,
    pub byte_length: Option<u64>,
    pub hash: Option<String>,
    pub items: Vec<AbiDecodedValueHistorySummary>,
    pub fields: Vec<AbiDecodedFieldHistorySummary>,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AbiDecodedValueHistorySummaryWire<'a> {
    kind: &'a str,
    #[serde(rename = "type")]
    type_label: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    byte_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hash: Option<&'a str>,
    items: &'a [AbiDecodedValueHistorySummary],
    fields: &'a [AbiDecodedFieldHistorySummary],
    truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AbiDecodedValueHistorySummaryRaw {
    #[serde(default = "unknown_string")]
    kind: String,
    #[serde(rename = "type")]
    #[serde(default = "unknown_string")]
    type_label: String,
    #[serde(default)]
    value: Option<String>,
    #[serde(default, alias = "byte_length")]
    byte_length: Option<u64>,
    #[serde(default)]
    hash: Option<String>,
    #[serde(default)]
    items: Vec<AbiDecodedValueHistorySummary>,
    #[serde(default)]
    fields: Vec<AbiDecodedFieldHistorySummary>,
    #[serde(default)]
    truncated: bool,
}

impl Serialize for AbiDecodedValueHistorySummary {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let sanitized = sanitize_abi_decoded_value_summary(self.clone(), 0);
        AbiDecodedValueHistorySummaryWire {
            kind: &sanitized.kind,
            type_label: &sanitized.type_label,
            value: sanitized.value.as_deref(),
            byte_length: sanitized.byte_length,
            hash: sanitized.hash.as_deref(),
            items: &sanitized.items,
            fields: &sanitized.fields,
            truncated: sanitized.truncated,
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for AbiDecodedValueHistorySummary {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = AbiDecodedValueHistorySummaryRaw::deserialize(deserializer)?;
        Ok(sanitize_abi_decoded_value_summary(
            AbiDecodedValueHistorySummary {
                kind: raw.kind,
                type_label: raw.type_label,
                value: raw.value,
                byte_length: raw.byte_length,
                hash: raw.hash,
                items: raw.items,
                fields: raw.fields,
                truncated: raw.truncated,
            },
            0,
        ))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiCallCalldataSummary {
    #[serde(default)]
    pub selector: Option<String>,
    #[serde(default, alias = "byte_length")]
    pub byte_length: Option<u64>,
    #[serde(default)]
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiCallSubmissionPlaceholder {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, alias = "tx_hash")]
    pub tx_hash: Option<String>,
    #[serde(default, alias = "submitted_at")]
    pub submitted_at: Option<String>,
    #[serde(default, alias = "broadcasted_at")]
    pub broadcasted_at: Option<String>,
    #[serde(
        default,
        alias = "error_summary",
        deserialize_with = "deserialize_sanitized_text_option_256",
        serialize_with = "serialize_sanitized_text_option_256"
    )]
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AbiCallOutcomeState {
    #[serde(alias = "pending")]
    Pending,
    #[serde(alias = "confirmed")]
    Confirmed,
    #[serde(alias = "failed")]
    Failed,
    #[serde(alias = "replaced")]
    Replaced,
    #[serde(alias = "cancelled")]
    Cancelled,
    #[serde(alias = "dropped")]
    Dropped,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiCallOutcomePlaceholder {
    #[serde(default)]
    pub state: Option<AbiCallOutcomeState>,
    #[serde(default, alias = "checked_at")]
    pub checked_at: Option<String>,
    #[serde(default, alias = "receipt_status")]
    pub receipt_status: Option<u64>,
    #[serde(default, alias = "block_number")]
    pub block_number: Option<u64>,
    #[serde(default, alias = "gas_used")]
    pub gas_used: Option<String>,
    #[serde(
        default,
        alias = "error_summary",
        deserialize_with = "deserialize_sanitized_text_option_256",
        serialize_with = "serialize_sanitized_text_option_256"
    )]
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiCallBroadcastPlaceholder {
    #[serde(default, alias = "tx_hash")]
    pub tx_hash: Option<String>,
    #[serde(default, alias = "broadcasted_at")]
    pub broadcasted_at: Option<String>,
    #[serde(default, alias = "rpc_chain_id")]
    pub rpc_chain_id: Option<u64>,
    #[serde(
        default,
        alias = "rpc_endpoint_summary",
        deserialize_with = "deserialize_sanitized_rpc_option_200",
        serialize_with = "serialize_sanitized_rpc_option_200"
    )]
    pub rpc_endpoint_summary: Option<String>,
    #[serde(
        default,
        alias = "error_summary",
        deserialize_with = "deserialize_sanitized_text_option_256",
        serialize_with = "serialize_sanitized_text_option_256"
    )]
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiCallRecoveryPlaceholder {
    #[serde(default, alias = "recovery_id")]
    pub recovery_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, alias = "created_at")]
    pub created_at: Option<String>,
    #[serde(default, alias = "recovered_at")]
    pub recovered_at: Option<String>,
    #[serde(
        default,
        alias = "last_error",
        deserialize_with = "deserialize_sanitized_text_option_256",
        serialize_with = "serialize_sanitized_text_option_256"
    )]
    pub last_error: Option<String>,
    #[serde(default, alias = "replacement_tx_hash")]
    pub replacement_tx_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiCallHistoryMetadata {
    #[serde(default = "unknown_string", alias = "intent_kind")]
    pub intent_kind: String,
    #[serde(default, alias = "draft_id")]
    pub draft_id: Option<String>,
    #[serde(default, alias = "created_at")]
    pub created_at: Option<String>,
    #[serde(default, alias = "chain_id")]
    pub chain_id: Option<u64>,
    #[serde(default, alias = "account_index")]
    pub account_index: Option<u32>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default, alias = "contract_address")]
    pub contract_address: Option<String>,
    #[serde(default = "unknown_string", alias = "source_kind")]
    pub source_kind: String,
    #[serde(default, alias = "provider_config_id")]
    pub provider_config_id: Option<String>,
    #[serde(default, alias = "user_source_id")]
    pub user_source_id: Option<String>,
    #[serde(default, alias = "version_id")]
    pub version_id: Option<String>,
    #[serde(default, alias = "abi_hash")]
    pub abi_hash: Option<String>,
    #[serde(default, alias = "source_fingerprint")]
    pub source_fingerprint: Option<String>,
    #[serde(default, alias = "function_signature")]
    pub function_signature: Option<String>,
    #[serde(default)]
    pub selector: Option<String>,
    #[serde(
        default,
        alias = "argument_summary",
        deserialize_with = "deserialize_bounded_abi_value_summaries",
        serialize_with = "serialize_bounded_abi_value_summaries"
    )]
    pub argument_summary: Vec<AbiDecodedValueHistorySummary>,
    #[serde(default, alias = "argument_hash")]
    pub argument_hash: Option<String>,
    #[serde(default, alias = "native_value_wei")]
    pub native_value_wei: Option<String>,
    #[serde(default, alias = "gas_limit")]
    pub gas_limit: Option<String>,
    #[serde(default, alias = "max_fee_per_gas")]
    pub max_fee_per_gas: Option<String>,
    #[serde(default, alias = "max_priority_fee_per_gas")]
    pub max_priority_fee_per_gas: Option<String>,
    #[serde(default)]
    pub nonce: Option<u64>,
    #[serde(default, alias = "selected_rpc")]
    pub selected_rpc: Option<AbiCallSelectedRpcSummary>,
    #[serde(default)]
    pub warnings: Vec<AbiCallStatusSummary>,
    #[serde(default, alias = "blocking_statuses")]
    pub blocking_statuses: Vec<AbiCallStatusSummary>,
    #[serde(default)]
    pub calldata: Option<AbiCallCalldataSummary>,
    #[serde(default, alias = "future_submission")]
    pub future_submission: Option<AbiCallSubmissionPlaceholder>,
    #[serde(default, alias = "future_outcome")]
    pub future_outcome: Option<AbiCallOutcomePlaceholder>,
    #[serde(default)]
    pub broadcast: Option<AbiCallBroadcastPlaceholder>,
    #[serde(default)]
    pub recovery: Option<AbiCallRecoveryPlaceholder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCalldataPreviewSummary {
    #[serde(default, alias = "preview_prefix_bytes")]
    pub preview_prefix_bytes: Option<u64>,
    #[serde(default, alias = "preview_suffix_bytes")]
    pub preview_suffix_bytes: Option<u64>,
    #[serde(default)]
    pub truncated: bool,
    #[serde(default, alias = "omitted_bytes")]
    pub omitted_bytes: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_sanitized_raw_calldata_text_option_256",
        serialize_with = "serialize_sanitized_raw_calldata_text_option_256"
    )]
    pub display: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_sanitized_raw_calldata_text_option_80",
        serialize_with = "serialize_sanitized_raw_calldata_text_option_80"
    )]
    pub prefix: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_sanitized_raw_calldata_text_option_80",
        serialize_with = "serialize_sanitized_raw_calldata_text_option_80"
    )]
    pub suffix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCalldataInferenceSummary {
    #[serde(default = "unknown_string", alias = "inference_status")]
    pub inference_status: String,
    #[serde(default, alias = "matched_source_kind")]
    pub matched_source_kind: Option<String>,
    #[serde(default, alias = "matched_source_id")]
    pub matched_source_id: Option<String>,
    #[serde(default, alias = "matched_version_id")]
    pub matched_version_id: Option<String>,
    #[serde(
        default,
        alias = "matched_source_fingerprint",
        deserialize_with = "deserialize_sanitized_raw_calldata_hash_option",
        serialize_with = "serialize_sanitized_raw_calldata_hash_option"
    )]
    pub matched_source_fingerprint: Option<String>,
    #[serde(
        default,
        alias = "matched_abi_hash",
        deserialize_with = "deserialize_sanitized_raw_calldata_hash_option",
        serialize_with = "serialize_sanitized_raw_calldata_hash_option"
    )]
    pub matched_abi_hash: Option<String>,
    #[serde(default, alias = "selector_match_count")]
    pub selector_match_count: Option<u64>,
    #[serde(
        default,
        alias = "conflict_summary",
        deserialize_with = "deserialize_sanitized_raw_calldata_text_option_256",
        serialize_with = "serialize_sanitized_raw_calldata_text_option_256"
    )]
    pub conflict_summary: Option<String>,
    #[serde(default, alias = "stale_status")]
    pub stale_status: Option<String>,
    #[serde(default, alias = "source_status")]
    pub source_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCalldataHistoryMetadata {
    #[serde(default = "unknown_string", alias = "intent_kind")]
    pub intent_kind: String,
    #[serde(default, alias = "draft_id")]
    pub draft_id: Option<String>,
    #[serde(default, alias = "created_at")]
    pub created_at: Option<String>,
    #[serde(default, alias = "chain_id")]
    pub chain_id: Option<u64>,
    #[serde(default, alias = "account_index")]
    pub account_index: Option<u32>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default, alias = "value_wei")]
    pub value_wei: Option<String>,
    #[serde(default, alias = "gas_limit")]
    pub gas_limit: Option<String>,
    #[serde(default, alias = "max_fee_per_gas")]
    pub max_fee_per_gas: Option<String>,
    #[serde(default, alias = "max_priority_fee_per_gas")]
    pub max_priority_fee_per_gas: Option<String>,
    #[serde(default)]
    pub nonce: Option<u64>,
    #[serde(default = "unknown_string", alias = "calldata_hash_version")]
    pub calldata_hash_version: String,
    #[serde(
        default,
        alias = "calldata_hash",
        deserialize_with = "deserialize_sanitized_raw_calldata_hash_option",
        serialize_with = "serialize_sanitized_raw_calldata_hash_option"
    )]
    pub calldata_hash: Option<String>,
    #[serde(default, alias = "calldata_byte_length")]
    pub calldata_byte_length: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_sanitized_raw_calldata_selector_option",
        serialize_with = "serialize_sanitized_raw_calldata_selector_option"
    )]
    pub selector: Option<String>,
    #[serde(default, alias = "selector_status")]
    pub selector_status: Option<String>,
    #[serde(default)]
    pub preview: Option<RawCalldataPreviewSummary>,
    #[serde(default, alias = "warning_acknowledgements")]
    pub warning_acknowledgements: Vec<AbiCallStatusSummary>,
    #[serde(default, alias = "warning_summaries")]
    pub warning_summaries: Vec<AbiCallStatusSummary>,
    #[serde(default, alias = "blocking_statuses")]
    pub blocking_statuses: Vec<AbiCallStatusSummary>,
    #[serde(default)]
    pub inference: Option<RawCalldataInferenceSummary>,
    #[serde(default, alias = "frozen_key")]
    pub frozen_key: Option<String>,
    #[serde(default, alias = "future_submission")]
    pub future_submission: Option<AbiCallSubmissionPlaceholder>,
    #[serde(default, alias = "future_outcome")]
    pub future_outcome: Option<AbiCallOutcomePlaceholder>,
    #[serde(default)]
    pub broadcast: Option<AbiCallBroadcastPlaceholder>,
    #[serde(default)]
    pub recovery: Option<AbiCallRecoveryPlaceholder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBatchSubmitChild {
    pub child_id: String,
    pub child_index: u32,
    pub batch_kind: String,
    pub asset_kind: String,
    pub freeze_key: String,
    pub intent: NativeTransferIntent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBatchDistributionRecipient {
    pub child_id: String,
    pub child_index: u32,
    pub target_kind: String,
    pub target_address: String,
    pub value_wei: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBatchDistributionParent {
    pub contract_address: String,
    pub selector: String,
    pub method_name: String,
    pub recipients: Vec<NativeBatchDistributionRecipient>,
    pub total_value_wei: String,
    pub intent: NativeTransferIntent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBatchSubmitInput {
    pub batch_id: String,
    pub batch_kind: String,
    pub asset_kind: String,
    pub chain_id: u64,
    pub freeze_key: String,
    #[serde(default)]
    pub distribution_parent: Option<NativeBatchDistributionParent>,
    pub children: Vec<NativeBatchSubmitChild>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBatchSubmitChildResult {
    pub child_id: String,
    pub child_index: u32,
    #[serde(default)]
    pub target_address: Option<String>,
    #[serde(default)]
    pub target_kind: Option<String>,
    #[serde(default)]
    pub amount_wei: Option<String>,
    #[serde(default)]
    pub record: Option<HistoryRecord>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub recovery_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBatchSubmitParentResult {
    #[serde(default)]
    pub record: Option<HistoryRecord>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub recovery_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBatchSubmitSummary {
    pub child_count: usize,
    pub submitted_count: usize,
    pub failed_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBatchSubmitResult {
    pub batch_id: String,
    pub batch_kind: String,
    pub asset_kind: String,
    pub chain_id: u64,
    #[serde(default)]
    pub parent: Option<NativeBatchSubmitParentResult>,
    pub children: Vec<NativeBatchSubmitChildResult>,
    pub summary: NativeBatchSubmitSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erc20BatchSubmitChild {
    pub child_id: String,
    pub child_index: u32,
    pub batch_kind: String,
    pub asset_kind: String,
    pub freeze_key: String,
    #[serde(default)]
    pub target_kind: Option<String>,
    #[serde(default)]
    pub target_address: Option<String>,
    #[serde(default)]
    pub amount_raw: Option<String>,
    pub intent: Erc20TransferIntent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erc20BatchDistributionRecipient {
    pub child_id: String,
    pub child_index: u32,
    pub target_kind: String,
    pub target_address: String,
    pub amount_raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erc20BatchDistributionParent {
    pub contract_address: String,
    pub selector: String,
    pub method_name: String,
    pub token_contract: String,
    pub decimals: u8,
    #[serde(default)]
    pub token_symbol: Option<String>,
    #[serde(default)]
    pub token_name: Option<String>,
    pub token_metadata_source: String,
    pub recipients: Vec<Erc20BatchDistributionRecipient>,
    pub total_amount_raw: String,
    pub intent: NativeTransferIntent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erc20BatchSubmitInput {
    pub batch_id: String,
    pub batch_kind: String,
    pub asset_kind: String,
    pub chain_id: u64,
    pub freeze_key: String,
    #[serde(default)]
    pub distribution_parent: Option<Erc20BatchDistributionParent>,
    pub children: Vec<Erc20BatchSubmitChild>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erc20BatchSubmitChildResult {
    pub child_id: String,
    pub child_index: u32,
    #[serde(default)]
    pub target_address: Option<String>,
    #[serde(default)]
    pub target_kind: Option<String>,
    #[serde(default)]
    pub amount_raw: Option<String>,
    #[serde(default)]
    pub record: Option<HistoryRecord>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub recovery_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erc20BatchSubmitParentResult {
    #[serde(default)]
    pub record: Option<HistoryRecord>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub recovery_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erc20BatchSubmitSummary {
    pub child_count: usize,
    pub submitted_count: usize,
    pub failed_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erc20BatchSubmitResult {
    pub batch_id: String,
    pub batch_kind: String,
    pub asset_kind: String,
    pub chain_id: u64,
    #[serde(default)]
    pub parent: Option<Erc20BatchSubmitParentResult>,
    pub children: Vec<Erc20BatchSubmitChildResult>,
    pub summary: Erc20BatchSubmitSummary,
}

const ABI_HISTORY_VALUE_MAX_CHARS: usize = 256;
const ABI_HISTORY_LABEL_MAX_CHARS: usize = 96;
const RAW_CALLDATA_PREVIEW_PART_MAX_CHARS: usize = 80;
const ABI_HISTORY_RPC_NAME_MAX_CHARS: usize = 120;
const ABI_HISTORY_RPC_SUMMARY_MAX_CHARS: usize = 200;
const ABI_HISTORY_HASH_MAX_CHARS: usize = 128;
const ABI_HISTORY_MAX_ITEMS: usize = 16;
const ABI_HISTORY_MAX_FIELDS: usize = 16;
const ABI_HISTORY_MAX_ARGUMENTS: usize = 32;
const ABI_HISTORY_MAX_DEPTH: usize = 4;

fn unknown_string() -> String {
    "unknown".to_string()
}

fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
    let mut chars = value.chars();
    let truncated = value.chars().count() > max_chars;
    if !truncated {
        return (value.to_string(), false);
    }
    let mut bounded = chars.by_ref().take(max_chars).collect::<String>();
    bounded.push_str("...[truncated]");
    (bounded, true)
}

fn sanitize_abi_history_text(value: &str, max_chars: usize) -> (String, bool) {
    let sanitized =
        redact_abi_sensitive_key_labels(crate::diagnostics::sanitize_diagnostic_message(value));
    let redacted = sanitized != value;
    let (bounded, truncated) = truncate_chars(&sanitized, max_chars);
    (bounded, redacted || truncated)
}

fn redact_abi_sensitive_key_labels(mut value: String) -> String {
    for key in [
        "api_key",
        "apikey",
        "token",
        "auth",
        "authorization",
        "password",
        "secret",
        "private_key",
        "privateKey",
        "private key",
        "access_token",
        "raw_tx",
        "rawTx",
        "raw transaction",
        "signed_tx",
        "signedTx",
        "signed transaction",
        "signature",
        "mnemonic",
    ] {
        value = redact_abi_inline_secret_label(value, key);
        for separator in ["=", ": "] {
            let needle = format!("{key}{separator}[redacted]");
            value = value.replace(&needle, "[redacted_secret]");
            let uppercase_needle = format!("{}{separator}[redacted]", key.to_ascii_uppercase());
            value = value.replace(&uppercase_needle, "[redacted_secret]");
            let titlecase_needle = format!(
                "{}{}{separator}[redacted]",
                &key[..1].to_ascii_uppercase(),
                &key[1..]
            );
            value = value.replace(&titlecase_needle, "[redacted_secret]");
        }
    }
    value
}

fn redact_abi_inline_secret_label(mut value: String, key: &str) -> String {
    for separator in ["=", ": "] {
        let needle = format!("{}{separator}", key.to_ascii_lowercase());
        loop {
            let lower = value.to_ascii_lowercase();
            let Some(start) = lower.find(&needle) else {
                break;
            };
            let value_start = start + needle.len();
            let end = value[value_start..]
                .find(|ch: char| {
                    ch.is_whitespace() || matches!(ch, '"' | '\'' | '<' | '>' | ';' | ',')
                })
                .map(|offset| value_start + offset)
                .unwrap_or(value.len());
            value.replace_range(start..end, "[redacted_secret]");
        }
    }
    value
}

fn sanitize_abi_history_text_option(
    value: Option<String>,
    max_chars: usize,
) -> (Option<String>, bool) {
    let Some(value) = value else {
        return (None, false);
    };
    let (sanitized, changed) = sanitize_abi_history_text(&value, max_chars);
    (Some(sanitized), changed)
}

fn sanitize_abi_rpc_summary(value: &str, max_chars: usize) -> String {
    let (mut sanitized, _) = sanitize_abi_history_text(value, max_chars);
    sanitized = sanitized.replace("[redacted_url]", "[redacted_endpoint]");
    let lower = sanitized.to_ascii_lowercase();
    if lower.contains("api_key")
        || lower.contains("apikey")
        || lower.contains("token=")
        || lower.contains("token:")
        || lower.contains("authorization")
        || lower.contains("private_key")
        || lower.contains("password")
        || lower.contains("secret")
    {
        return "[redacted_endpoint]".to_string();
    }
    sanitized
}

fn deserialize_sanitized_text_option_96<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    Ok(sanitize_abi_history_text_option(value, ABI_HISTORY_LABEL_MAX_CHARS).0)
}

fn serialize_sanitized_text_option_96<S>(
    value: &Option<String>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let sanitized = value
        .as_deref()
        .map(|value| sanitize_abi_history_text(value, ABI_HISTORY_LABEL_MAX_CHARS).0);
    sanitized.serialize(serializer)
}

fn is_hex_payload(value: &str) -> bool {
    let Some(hex) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    else {
        return false;
    };
    !hex.is_empty() && hex.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn sanitize_raw_calldata_text(value: &str, max_chars: usize) -> String {
    let compact = value.trim();
    if (is_hex_payload(compact) && compact.len() > max_chars)
        || compact
            .split(|ch: char| {
                ch.is_whitespace() || matches!(ch, '"' | '\'' | '<' | '>' | ';' | ',')
            })
            .any(|token| token.len() > 130 && is_hex_payload(token))
    {
        return "[redacted_payload]".to_string();
    }
    sanitize_abi_history_text(compact, max_chars).0
}

fn sanitize_raw_calldata_hash(value: &str) -> String {
    let compact = value.trim();
    if is_hex_payload(compact) && compact.len() != 66 {
        return "[redacted_payload]".to_string();
    }
    sanitize_abi_history_text(compact, ABI_HISTORY_HASH_MAX_CHARS).0
}

fn sanitize_raw_calldata_selector(value: &str) -> String {
    let compact = value.trim();
    if is_hex_payload(compact) && compact.len() != 10 {
        return "[redacted_payload]".to_string();
    }
    sanitize_abi_history_text(compact, 32).0
}

fn deserialize_sanitized_raw_calldata_text_option<'de, D>(
    deserializer: D,
    max_chars: usize,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    Ok(value.map(|value| sanitize_raw_calldata_text(&value, max_chars)))
}

fn serialize_sanitized_raw_calldata_text_option<S>(
    value: &Option<String>,
    serializer: S,
    max_chars: usize,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let sanitized = value
        .as_deref()
        .map(|value| sanitize_raw_calldata_text(value, max_chars));
    sanitized.serialize(serializer)
}

fn deserialize_sanitized_raw_calldata_text_option_80<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_sanitized_raw_calldata_text_option(
        deserializer,
        RAW_CALLDATA_PREVIEW_PART_MAX_CHARS,
    )
}

fn serialize_sanitized_raw_calldata_text_option_80<S>(
    value: &Option<String>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serialize_sanitized_raw_calldata_text_option(
        value,
        serializer,
        RAW_CALLDATA_PREVIEW_PART_MAX_CHARS,
    )
}

fn deserialize_sanitized_raw_calldata_text_option_256<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_sanitized_raw_calldata_text_option(deserializer, ABI_HISTORY_VALUE_MAX_CHARS)
}

fn serialize_sanitized_raw_calldata_text_option_256<S>(
    value: &Option<String>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serialize_sanitized_raw_calldata_text_option(value, serializer, ABI_HISTORY_VALUE_MAX_CHARS)
}

fn deserialize_sanitized_raw_calldata_hash_option<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    Ok(value.map(|value| sanitize_raw_calldata_hash(&value)))
}

fn serialize_sanitized_raw_calldata_hash_option<S>(
    value: &Option<String>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let sanitized = value.as_deref().map(sanitize_raw_calldata_hash);
    sanitized.serialize(serializer)
}

fn deserialize_sanitized_raw_calldata_selector_option<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    Ok(value.map(|value| sanitize_raw_calldata_selector(&value)))
}

fn serialize_sanitized_raw_calldata_selector_option<S>(
    value: &Option<String>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let sanitized = value.as_deref().map(sanitize_raw_calldata_selector);
    sanitized.serialize(serializer)
}

fn deserialize_sanitized_text_option_256<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    Ok(sanitize_abi_history_text_option(value, ABI_HISTORY_VALUE_MAX_CHARS).0)
}

fn serialize_sanitized_text_option_256<S>(
    value: &Option<String>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let sanitized = value
        .as_deref()
        .map(|value| sanitize_abi_history_text(value, ABI_HISTORY_VALUE_MAX_CHARS).0);
    sanitized.serialize(serializer)
}

fn deserialize_sanitized_rpc_option<'de, D>(
    deserializer: D,
    max_chars: usize,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    Ok(value.map(|value| sanitize_abi_rpc_summary(&value, max_chars)))
}

fn serialize_sanitized_rpc_option<S>(
    value: &Option<String>,
    serializer: S,
    max_chars: usize,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let sanitized = value
        .as_deref()
        .map(|value| sanitize_abi_rpc_summary(value, max_chars));
    sanitized.serialize(serializer)
}

fn deserialize_sanitized_rpc_option_120<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_sanitized_rpc_option(deserializer, ABI_HISTORY_RPC_NAME_MAX_CHARS)
}

fn serialize_sanitized_rpc_option_120<S>(
    value: &Option<String>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serialize_sanitized_rpc_option(value, serializer, ABI_HISTORY_RPC_NAME_MAX_CHARS)
}

fn deserialize_sanitized_rpc_option_200<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_sanitized_rpc_option(deserializer, ABI_HISTORY_RPC_SUMMARY_MAX_CHARS)
}

fn serialize_sanitized_rpc_option_200<S>(
    value: &Option<String>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serialize_sanitized_rpc_option(value, serializer, ABI_HISTORY_RPC_SUMMARY_MAX_CHARS)
}

fn sanitize_abi_decoded_field_summary(
    mut field: AbiDecodedFieldHistorySummary,
    depth: usize,
) -> (AbiDecodedFieldHistorySummary, bool) {
    let (name, name_changed) =
        sanitize_abi_history_text_option(field.name, ABI_HISTORY_LABEL_MAX_CHARS);
    field.name = name;
    let value = sanitize_abi_decoded_value_summary(field.value, depth);
    let value_changed = value.truncated;
    field.value = value;
    (field, name_changed || value_changed)
}

fn sanitize_abi_decoded_value_summary(
    mut value: AbiDecodedValueHistorySummary,
    depth: usize,
) -> AbiDecodedValueHistorySummary {
    let (kind, kind_changed) = sanitize_abi_history_text(&value.kind, ABI_HISTORY_LABEL_MAX_CHARS);
    let (type_label, type_changed) =
        sanitize_abi_history_text(&value.type_label, ABI_HISTORY_LABEL_MAX_CHARS);
    let (summary_value, value_changed) =
        sanitize_abi_history_text_option(value.value, ABI_HISTORY_VALUE_MAX_CHARS);
    let (hash, hash_changed) =
        sanitize_abi_history_text_option(value.hash, ABI_HISTORY_HASH_MAX_CHARS);
    value.kind = kind;
    value.type_label = type_label;
    value.value = summary_value;
    value.hash = hash;
    value.truncated =
        value.truncated || kind_changed || type_changed || value_changed || hash_changed;

    if depth >= ABI_HISTORY_MAX_DEPTH {
        if !value.items.is_empty() || !value.fields.is_empty() {
            value.truncated = true;
        }
        value.items.clear();
        value.fields.clear();
        return value;
    }

    if value.items.len() > ABI_HISTORY_MAX_ITEMS {
        value.truncated = true;
    }
    value.items = value
        .items
        .into_iter()
        .take(ABI_HISTORY_MAX_ITEMS)
        .map(|item| sanitize_abi_decoded_value_summary(item, depth + 1))
        .collect();

    if value.fields.len() > ABI_HISTORY_MAX_FIELDS {
        value.truncated = true;
    }
    let mut field_changed = false;
    value.fields = value
        .fields
        .into_iter()
        .take(ABI_HISTORY_MAX_FIELDS)
        .map(|field| {
            let (field, changed) = sanitize_abi_decoded_field_summary(field, depth + 1);
            if changed {
                field_changed = true;
            }
            field
        })
        .collect();
    if field_changed {
        value.truncated = true;
    }

    value
}

fn deserialize_bounded_abi_value_summaries<'de, D>(
    deserializer: D,
) -> Result<Vec<AbiDecodedValueHistorySummary>, D::Error>
where
    D: Deserializer<'de>,
{
    let values = Vec::<AbiDecodedValueHistorySummary>::deserialize(deserializer)?;
    Ok(values
        .into_iter()
        .take(ABI_HISTORY_MAX_ARGUMENTS)
        .map(|value| sanitize_abi_decoded_value_summary(value, 0))
        .collect())
}

fn serialize_bounded_abi_value_summaries<S>(
    values: &Vec<AbiDecodedValueHistorySummary>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let sanitized = values
        .iter()
        .take(ABI_HISTORY_MAX_ARGUMENTS)
        .cloned()
        .map(|value| sanitize_abi_decoded_value_summary(value, 0))
        .collect::<Vec<_>>();
    sanitized.serialize(serializer)
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
    #[serde(default)]
    pub batch_metadata: Option<BatchHistoryMetadata>,
    #[serde(default)]
    pub abi_call_metadata: Option<AbiCallHistoryMetadata>,
    #[serde(
        default,
        alias = "rawCalldataMetadata",
        skip_serializing_if = "Option::is_none"
    )]
    pub raw_calldata_metadata: Option<RawCalldataHistoryMetadata>,
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
    #[serde(default)]
    pub batch_metadata: Option<BatchHistoryMetadata>,
    #[serde(default)]
    pub abi_call_metadata: Option<AbiCallHistoryMetadata>,
    #[serde(
        default,
        alias = "rawCalldataMetadata",
        skip_serializing_if = "Option::is_none"
    )]
    pub raw_calldata_metadata: Option<RawCalldataHistoryMetadata>,
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
