use crate::models::{
    AbiCallSelectedRpcSummary, AbiCallStatusSummary, NativeTransferIntent,
    RawCalldataHistoryMetadata, RawCalldataInferenceSummary, RawCalldataPreviewSummary,
    TransactionType, TypedTransactionFields,
};
use ethers::types::{Address, Bytes, U256};
use ethers::utils::{keccak256, to_checksum};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::str::FromStr;

const RAW_CALLDATA_MAX_BYTES: usize = 128 * 1024;
const RAW_CALLDATA_HASH_VERSION: &str = "keccak256-v1";
const RAW_CALLDATA_PREVIEW_PREFIX_BYTES: usize = 32;
const RAW_CALLDATA_PREVIEW_SUFFIX_BYTES: usize = 32;
const RAW_CALLDATA_FROZEN_KEY_PREFIX: &str = "raw-calldata";
const RAW_CALLDATA_MAX_MULTIPLIER_FRACTION_DIGITS: usize = 18;
const RAW_CALLDATA_HUMAN_PREVIEW_MAX_ROWS: usize = 12;
const RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS: usize = 160;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCalldataSubmitInput {
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(default, alias = "draft_id")]
    pub draft_id: Option<String>,
    #[serde(default, alias = "frozen_key")]
    pub frozen_key: Option<String>,
    #[serde(default, alias = "created_at")]
    pub created_at: Option<String>,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(default, alias = "selected_rpc")]
    pub selected_rpc: Option<AbiCallSelectedRpcSummary>,
    pub from: String,
    #[serde(
        default,
        alias = "account_index",
        alias = "fromAccountIndex",
        alias = "from_account_index"
    )]
    pub account_index: Option<u32>,
    pub to: String,
    #[serde(alias = "value_wei")]
    pub value_wei: String,
    pub calldata: String,
    #[serde(alias = "calldata_hash_version")]
    pub calldata_hash_version: String,
    #[serde(alias = "calldata_hash")]
    pub calldata_hash: String,
    #[serde(alias = "calldata_byte_length")]
    pub calldata_byte_length: u64,
    #[serde(default)]
    pub selector: Option<String>,
    #[serde(alias = "selector_status")]
    pub selector_status: String,
    pub nonce: u64,
    #[serde(alias = "gas_limit")]
    pub gas_limit: String,
    #[serde(default, alias = "estimated_gas_limit")]
    pub estimated_gas_limit: Option<String>,
    #[serde(default, alias = "manual_gas")]
    pub manual_gas: bool,
    #[serde(default, alias = "latest_base_fee_per_gas")]
    pub latest_base_fee_per_gas: Option<String>,
    #[serde(alias = "base_fee_per_gas")]
    pub base_fee_per_gas: String,
    #[serde(default, alias = "base_fee_multiplier")]
    pub base_fee_multiplier: Option<String>,
    #[serde(alias = "max_fee_per_gas")]
    pub max_fee_per_gas: String,
    #[serde(default, alias = "max_fee_override_per_gas")]
    pub max_fee_override_per_gas: Option<String>,
    #[serde(alias = "max_priority_fee_per_gas")]
    pub max_priority_fee_per_gas: String,
    #[serde(default, alias = "live_max_fee_per_gas")]
    pub live_max_fee_per_gas: Option<String>,
    #[serde(default, alias = "live_max_priority_fee_per_gas")]
    pub live_max_priority_fee_per_gas: Option<String>,
    #[serde(default)]
    pub warnings: Vec<RawCalldataStatusSummary>,
    #[serde(default, alias = "warning_acknowledgements")]
    pub warning_acknowledgements: Vec<RawCalldataWarningAcknowledgement>,
    #[serde(default, alias = "blocking_statuses")]
    pub blocking_statuses: Vec<RawCalldataStatusSummary>,
    #[serde(default)]
    pub inference: RawCalldataInferenceInput,
    #[serde(default, alias = "human", alias = "human_preview")]
    pub human_preview: RawCalldataHumanPreview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCalldataStatusSummary {
    #[serde(default = "warning_string")]
    pub level: String,
    #[serde(default = "unknown_string")]
    pub code: String,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default, alias = "requires_acknowledgement")]
    pub requires_acknowledgement: bool,
    #[serde(default)]
    pub acknowledged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCalldataWarningAcknowledgement {
    #[serde(default = "unknown_string")]
    pub code: String,
    #[serde(default)]
    pub acknowledged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCalldataInferenceInput {
    #[serde(default = "unknown_string")]
    pub status: String,
    #[serde(default, alias = "matched_source")]
    pub matched_source: Option<RawCalldataInferenceMatchedSource>,
    #[serde(default, alias = "selector_match_count")]
    pub selector_match_count: Option<u64>,
    #[serde(default, alias = "conflict_summary")]
    pub conflict_summary: Option<String>,
    #[serde(default, alias = "stale_summary")]
    pub stale_summary: Option<String>,
    #[serde(default, alias = "source_status")]
    pub source_status: Option<String>,
}

impl Default for RawCalldataInferenceInput {
    fn default() -> Self {
        Self {
            status: "unknown".to_string(),
            matched_source: None,
            selector_match_count: None,
            conflict_summary: None,
            stale_summary: None,
            source_status: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCalldataInferenceMatchedSource {
    pub identity: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub fingerprint: Option<String>,
    #[serde(default, alias = "abi_hash")]
    pub abi_hash: Option<String>,
    #[serde(default, alias = "function_signature")]
    pub function_signature: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCalldataHumanPreview {
    #[serde(default)]
    pub rows: Vec<RawCalldataHumanPreviewRow>,
    #[serde(default, alias = "truncated_rows")]
    pub truncated_rows: bool,
    #[serde(default, alias = "omitted_rows")]
    pub omitted_rows: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCalldataHumanPreviewRow {
    pub label: String,
    pub value: String,
    #[serde(alias = "display_text")]
    pub display_text: String,
    pub truncated: bool,
    #[serde(alias = "original_char_length")]
    pub original_char_length: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedCalldata {
    canonical: String,
    bytes: Vec<u8>,
    byte_length: u64,
    hash: String,
    selector: Option<String>,
    selector_status: String,
    display: String,
    prefix: String,
    suffix: String,
    truncated: bool,
    omitted_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedBaseFeeMultiplier {
    numerator: U256,
    denominator: U256,
    text: String,
}

#[derive(Debug, Clone)]
struct ParsedFeeFields {
    gas_limit: U256,
    estimated_gas_limit: Option<U256>,
    latest_base_fee_per_gas: Option<U256>,
    base_fee_per_gas: U256,
    base_fee_multiplier: Option<ParsedBaseFeeMultiplier>,
    max_fee_per_gas: U256,
    max_fee_override_per_gas: Option<U256>,
    max_priority_fee_per_gas: U256,
    live_max_fee_per_gas: Option<U256>,
    live_max_priority_fee_per_gas: Option<U256>,
}

#[derive(Debug, Clone)]
struct ExpectedWarning {
    code: &'static str,
    message: &'static str,
    source: &'static str,
    acknowledged: bool,
}

pub fn validate_raw_calldata_submit_input(
    input: RawCalldataSubmitInput,
) -> Result<
    (
        NativeTransferIntent,
        Bytes,
        RawCalldataHistoryMetadata,
        String,
    ),
    String,
> {
    if !input.blocking_statuses.is_empty() {
        return Err(format!(
            "raw calldata draft has unresolved blocking statuses: {}",
            input
                .blocking_statuses
                .iter()
                .map(|status| status.code.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    let rpc_url = input.rpc_url.trim().to_string();
    if rpc_url.is_empty() {
        return Err("rpcUrl is required".to_string());
    }
    let selected_rpc = input
        .selected_rpc
        .as_ref()
        .ok_or_else(|| "selectedRpc is required for raw calldata submit".to_string())?;
    let selected_chain_id = selected_rpc
        .chain_id
        .ok_or_else(|| "selectedRpc.chainId is required for raw calldata submit".to_string())?;
    if selected_chain_id != input.chain_id {
        return Err(format!(
            "selected RPC chainId {} does not match draft chainId {}",
            selected_chain_id, input.chain_id
        ));
    }
    validate_selected_rpc_endpoint(selected_rpc, &rpc_url)?;

    let account_index = input
        .account_index
        .ok_or_else(|| "accountIndex is required for raw calldata submit".to_string())?;
    let from = checksum_address(&input.from, "from")?;
    let to = checksum_address(&input.to, "to")?;
    validate_human_preview(&input.human_preview)?;
    let calldata = normalize_raw_calldata(&input.calldata)?;
    validate_calldata_summary(&input, &calldata)?;

    let value_wei = parse_submit_u256("valueWei", &input.value_wei)?;
    let fees = parse_fee_fields(&input)?;
    validate_fee_fields(&input, &fees)?;

    let inference = effective_inference(sanitize_inference(input.inference.clone()), &calldata);
    let warning_acknowledgements = acknowledgement_map(&input);
    let expected_warnings =
        expected_warning_statuses(&calldata, value_wei, &fees, input.manual_gas, &inference);
    validate_warning_acknowledgements(
        &input.warnings,
        &warning_acknowledgements,
        &expected_warnings,
    )?;
    let acknowledged_warnings = expected_warnings
        .into_iter()
        .map(|warning| ExpectedWarning {
            acknowledged: warning_acknowledgements
                .get(warning.code)
                .copied()
                .unwrap_or(warning.acknowledged),
            ..warning
        })
        .collect::<Vec<_>>();

    let expected_frozen_key = raw_calldata_frozen_key(&RawCalldataFrozenPayloadParts {
        chain_id: input.chain_id,
        selected_rpc,
        account_index,
        from: &input.from,
        to: &input.to,
        value_wei: &value_wei.to_string(),
        calldata: &calldata,
        gas_limit: &fees.gas_limit.to_string(),
        estimated_gas_limit: fees.estimated_gas_limit.map(|value| value.to_string()),
        manual_gas: input.manual_gas,
        latest_base_fee_per_gas: fees.latest_base_fee_per_gas.map(|value| value.to_string()),
        base_fee_per_gas: &fees.base_fee_per_gas.to_string(),
        base_fee_multiplier: fees
            .base_fee_multiplier
            .as_ref()
            .map(|multiplier| multiplier.text.as_str()),
        max_fee_per_gas: &fees.max_fee_per_gas.to_string(),
        max_fee_override_per_gas: fees.max_fee_override_per_gas.map(|value| value.to_string()),
        max_priority_fee_per_gas: &fees.max_priority_fee_per_gas.to_string(),
        live_max_fee_per_gas: fees.live_max_fee_per_gas.map(|value| value.to_string()),
        live_max_priority_fee_per_gas: fees
            .live_max_priority_fee_per_gas
            .map(|value| value.to_string()),
        nonce: input.nonce,
        warnings: &acknowledged_warnings,
        inference: &inference,
        human_preview: &input.human_preview,
    });
    let frozen_key = input
        .frozen_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "frozenKey is required for raw calldata submit".to_string())?;
    if frozen_key != expected_frozen_key {
        return Err("frozenKey does not match raw calldata draft fields".to_string());
    }

    let warning_summaries = acknowledged_warnings
        .iter()
        .map(raw_warning_to_abi_status)
        .collect::<Vec<_>>();
    let metadata = RawCalldataHistoryMetadata {
        intent_kind: "rawCalldata".to_string(),
        draft_id: input.draft_id,
        created_at: input.created_at,
        chain_id: Some(input.chain_id),
        account_index: Some(account_index),
        from: Some(from.clone()),
        to: Some(to.clone()),
        value_wei: Some(value_wei.to_string()),
        gas_limit: Some(fees.gas_limit.to_string()),
        max_fee_per_gas: Some(fees.max_fee_per_gas.to_string()),
        max_priority_fee_per_gas: Some(fees.max_priority_fee_per_gas.to_string()),
        nonce: Some(input.nonce),
        calldata_hash_version: RAW_CALLDATA_HASH_VERSION.to_string(),
        calldata_hash: Some(calldata.hash.clone()),
        calldata_byte_length: Some(calldata.byte_length),
        selector: calldata.selector.clone(),
        selector_status: Some(calldata.selector_status.clone()),
        preview: Some(RawCalldataPreviewSummary {
            preview_prefix_bytes: Some(RAW_CALLDATA_PREVIEW_PREFIX_BYTES as u64),
            preview_suffix_bytes: Some(RAW_CALLDATA_PREVIEW_SUFFIX_BYTES as u64),
            truncated: calldata.truncated,
            omitted_bytes: Some(calldata.omitted_bytes),
            display: Some(calldata.display.clone()),
            prefix: Some(calldata.prefix.clone()),
            suffix: Some(calldata.suffix.clone()),
        }),
        warning_acknowledgements: warning_summaries.clone(),
        warning_summaries,
        blocking_statuses: Vec::new(),
        inference: Some(raw_inference_to_history(&inference)),
        frozen_key: Some(expected_frozen_key.clone()),
        future_submission: None,
        future_outcome: None,
        broadcast: None,
        recovery: None,
    };
    let intent = NativeTransferIntent {
        typed_transaction: TypedTransactionFields::raw_calldata(
            calldata.selector.clone(),
            value_wei.to_string(),
        ),
        rpc_url,
        account_index,
        chain_id: input.chain_id,
        from,
        to,
        value_wei: value_wei.to_string(),
        nonce: input.nonce,
        gas_limit: fees.gas_limit.to_string(),
        max_fee_per_gas: fees.max_fee_per_gas.to_string(),
        max_priority_fee_per_gas: fees.max_priority_fee_per_gas.to_string(),
    };
    debug_assert_eq!(
        intent.typed_transaction.transaction_type,
        TransactionType::RawCalldata
    );
    Ok((
        intent,
        Bytes::from(calldata.bytes),
        metadata,
        expected_frozen_key,
    ))
}

fn validate_calldata_summary(
    input: &RawCalldataSubmitInput,
    calldata: &NormalizedCalldata,
) -> Result<(), String> {
    if input.calldata_hash_version != RAW_CALLDATA_HASH_VERSION {
        return Err("calldataHashVersion must be keccak256-v1".to_string());
    }
    if !input.calldata_hash.eq_ignore_ascii_case(&calldata.hash) {
        return Err("calldata hash does not match actual calldata".to_string());
    }
    if input.calldata_byte_length != calldata.byte_length {
        return Err("calldata byte length does not match actual calldata".to_string());
    }
    if normalize_selector_option(input.selector.as_deref())? != calldata.selector {
        return Err("calldata selector does not match actual calldata".to_string());
    }
    if input.selector_status != calldata.selector_status {
        return Err("calldata selectorStatus does not match actual calldata".to_string());
    }
    Ok(())
}

fn normalize_raw_calldata(value: &str) -> Result<NormalizedCalldata, String> {
    let trimmed = value.trim();
    let Some(hex) = trimmed.strip_prefix("0x") else {
        return Err("raw calldata must start with 0x".to_string());
    };
    if hex.len() % 2 != 0 {
        return Err("raw calldata hex must contain complete bytes".to_string());
    }
    if !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err("raw calldata can only contain hexadecimal characters".to_string());
    }
    let byte_length = hex.len() / 2;
    if byte_length > RAW_CALLDATA_MAX_BYTES {
        return Err(format!(
            "raw calldata exceeds the {} byte limit",
            RAW_CALLDATA_MAX_BYTES
        ));
    }
    let lowercase_hex = hex.to_ascii_lowercase();
    let bytes = decode_hex(&lowercase_hex)?;
    let canonical = format!("0x{lowercase_hex}");
    let hash = format!("0x{}", hex_lower(&keccak256(&bytes)));
    let selector = if byte_length >= 4 {
        Some(format!("0x{}", &lowercase_hex[..8]))
    } else {
        None
    };
    let selector_status = if byte_length == 0 {
        "none"
    } else if byte_length < 4 {
        "short"
    } else {
        "present"
    }
    .to_string();
    let prefix_hex = lowercase_hex
        .chars()
        .take(RAW_CALLDATA_PREVIEW_PREFIX_BYTES * 2)
        .collect::<String>();
    let truncated =
        byte_length > RAW_CALLDATA_PREVIEW_PREFIX_BYTES + RAW_CALLDATA_PREVIEW_SUFFIX_BYTES;
    let suffix_hex = if truncated {
        lowercase_hex[lowercase_hex.len() - RAW_CALLDATA_PREVIEW_SUFFIX_BYTES * 2..].to_string()
    } else {
        String::new()
    };
    let omitted_bytes = if truncated {
        (byte_length - RAW_CALLDATA_PREVIEW_PREFIX_BYTES - RAW_CALLDATA_PREVIEW_SUFFIX_BYTES) as u64
    } else {
        0
    };
    let prefix = format!("0x{prefix_hex}");
    let suffix = if truncated {
        format!("0x{suffix_hex}")
    } else {
        String::new()
    };
    let display = if truncated {
        format!("{}...{}", prefix, suffix.trim_start_matches("0x"))
    } else {
        canonical.clone()
    };
    Ok(NormalizedCalldata {
        canonical,
        bytes,
        byte_length: byte_length as u64,
        hash,
        selector,
        selector_status,
        display,
        prefix,
        suffix,
        truncated,
        omitted_bytes,
    })
}

fn decode_hex(hex: &str) -> Result<Vec<u8>, String> {
    (0..hex.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&hex[index..index + 2], 16)
                .map_err(|_| "raw calldata contains invalid hex".to_string())
        })
        .collect()
}

fn normalize_selector_option(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim();
    let Some(hex) = trimmed.strip_prefix("0x") else {
        return Err("selector must be a 0x-prefixed 4-byte hex string".to_string());
    };
    if hex.len() != 8 || !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err("selector must be a 0x-prefixed 4-byte hex string".to_string());
    }
    Ok(Some(format!("0x{}", hex.to_ascii_lowercase())))
}

fn checksum_address(value: &str, label: &str) -> Result<String, String> {
    let address = Address::from_str(value.trim())
        .map_err(|_| format!("{label} must be a valid EVM address"))?;
    Ok(to_checksum(&address, None))
}

fn validate_selected_rpc_endpoint(
    selected_rpc: &AbiCallSelectedRpcSummary,
    rpc_url: &str,
) -> Result<(), String> {
    if let Some(endpoint_summary) = selected_rpc.endpoint_summary.as_deref() {
        if endpoint_summary != summarize_rpc_endpoint(rpc_url) {
            return Err(
                "submitted rpcUrl does not match frozen selectedRpc endpointSummary".to_string(),
            );
        }
    }
    if let Some(endpoint_fingerprint) = selected_rpc.endpoint_fingerprint.as_deref() {
        if endpoint_fingerprint != rpc_endpoint_fingerprint(rpc_url) {
            return Err(
                "submitted rpcUrl does not match frozen selectedRpc endpointFingerprint"
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn validate_human_preview(human: &RawCalldataHumanPreview) -> Result<(), String> {
    if human.rows.len() > RAW_CALLDATA_HUMAN_PREVIEW_MAX_ROWS {
        return Err("humanPreview rows exceed raw calldata preview bounds".to_string());
    }
    if !human.truncated_rows && human.omitted_rows != 0 {
        return Err("humanPreview omittedRows requires truncatedRows".to_string());
    }
    for row in &human.rows {
        validate_human_preview_text("humanPreview label", &row.label)?;
        validate_human_preview_text("humanPreview value", &row.value)?;
        validate_human_preview_text("humanPreview displayText", &row.display_text)?;
        let expected_display =
            bound_human_preview_text(&format_human_preview_display_text(&row.label, &row.value)).0;
        if row.display_text != expected_display {
            return Err(
                "humanPreview displayText must match bounded raw calldata preview text".to_string(),
            );
        }
    }
    Ok(())
}

fn validate_human_preview_text(label: &str, value: &str) -> Result<(), String> {
    if compact_human_preview_text(value) != value {
        return Err(format!("{label} must be compacted"));
    }
    if value.chars().count() > RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS {
        return Err(format!("{label} exceeds raw calldata preview bounds"));
    }
    Ok(())
}

fn format_human_preview_display_text(label: &str, value: &str) -> String {
    if label.is_empty() {
        return value.to_string();
    }
    if value.is_empty() {
        return label.to_string();
    }
    format!("{label}: {value}")
}

fn bound_human_preview_text(value: &str) -> (String, bool) {
    let compact = compact_human_preview_text(value);
    let truncated = compact.chars().count() > RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS;
    (
        compact
            .chars()
            .take(RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS)
            .collect(),
        truncated,
    )
}

fn compact_human_preview_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_fee_fields(input: &RawCalldataSubmitInput) -> Result<ParsedFeeFields, String> {
    Ok(ParsedFeeFields {
        gas_limit: parse_submit_u256("gasLimit", &input.gas_limit)?,
        estimated_gas_limit: parse_optional_submit_u256(
            "estimatedGasLimit",
            input.estimated_gas_limit.as_deref(),
        )?,
        latest_base_fee_per_gas: parse_optional_submit_u256(
            "latestBaseFeePerGas",
            input.latest_base_fee_per_gas.as_deref(),
        )?,
        base_fee_per_gas: parse_submit_u256("baseFeePerGas", &input.base_fee_per_gas)?,
        base_fee_multiplier: input
            .base_fee_multiplier
            .as_deref()
            .map(parse_base_fee_multiplier)
            .transpose()?,
        max_fee_per_gas: parse_submit_u256("maxFeePerGas", &input.max_fee_per_gas)?,
        max_fee_override_per_gas: parse_optional_submit_u256(
            "maxFeeOverridePerGas",
            input.max_fee_override_per_gas.as_deref(),
        )?,
        max_priority_fee_per_gas: parse_submit_u256(
            "maxPriorityFeePerGas",
            &input.max_priority_fee_per_gas,
        )?,
        live_max_fee_per_gas: parse_optional_submit_u256(
            "liveMaxFeePerGas",
            input.live_max_fee_per_gas.as_deref(),
        )?,
        live_max_priority_fee_per_gas: parse_optional_submit_u256(
            "liveMaxPriorityFeePerGas",
            input.live_max_priority_fee_per_gas.as_deref(),
        )?,
    })
}

fn validate_fee_fields(
    input: &RawCalldataSubmitInput,
    fees: &ParsedFeeFields,
) -> Result<(), String> {
    if fees.gas_limit.is_zero() {
        return Err("gasLimit must be greater than zero".to_string());
    }
    let expected_max_fee = match fees.max_fee_override_per_gas {
        Some(value) => value,
        None => {
            let multiplier = fees.base_fee_multiplier.as_ref().ok_or_else(|| {
                "baseFeeMultiplier is required when maxFeeOverridePerGas is not set".to_string()
            })?;
            checked_add_u256(
                ceil_multiply_u256(
                    fees.base_fee_per_gas,
                    multiplier.numerator,
                    multiplier.denominator,
                )?,
                fees.max_priority_fee_per_gas,
                "maxFeePerGas",
            )?
        }
    };
    if fees.max_fee_per_gas != expected_max_fee {
        return Err(format!(
            "maxFeePerGas does not match derived raw calldata fee draft: expected {expected_max_fee}, received {}",
            fees.max_fee_per_gas
        ));
    }
    if fees.max_priority_fee_per_gas > fees.max_fee_per_gas {
        return Err("maxPriorityFeePerGas cannot exceed maxFeePerGas".to_string());
    }
    if input.nonce > i64::MAX as u64 {
        return Err("nonce must be a non-negative safe integer".to_string());
    }
    Ok(())
}

fn parse_submit_u256(label: &str, value: &str) -> Result<U256, String> {
    if value.trim() != value || value.is_empty() {
        return Err(format!("{label} must be a decimal integer"));
    }
    U256::from_dec_str(value).map_err(|_| format!("{label} must be a decimal integer"))
}

fn parse_optional_submit_u256(label: &str, value: Option<&str>) -> Result<Option<U256>, String> {
    value
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .map(|value| parse_submit_u256(label, value))
        .transpose()
}

fn parse_base_fee_multiplier(value: &str) -> Result<ParsedBaseFeeMultiplier, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("baseFeeMultiplier must be a non-negative decimal".to_string());
    }
    let (whole, fraction) = match trimmed.split_once('.') {
        Some((whole, fraction)) => {
            if fraction.is_empty() {
                return Err("baseFeeMultiplier must be a non-negative decimal".to_string());
            }
            (whole, fraction)
        }
        None => (trimmed, ""),
    };
    if whole.is_empty()
        || !whole.chars().all(|ch| ch.is_ascii_digit())
        || !fraction.chars().all(|ch| ch.is_ascii_digit())
    {
        return Err("baseFeeMultiplier must be a non-negative decimal".to_string());
    }
    if fraction.len() > RAW_CALLDATA_MAX_MULTIPLIER_FRACTION_DIGITS {
        return Err(format!(
            "baseFeeMultiplier supports at most {RAW_CALLDATA_MAX_MULTIPLIER_FRACTION_DIGITS} decimal places"
        ));
    }
    let denominator = U256::exp10(fraction.len());
    let numerator_text = format!("{whole}{fraction}");
    let numerator = U256::from_dec_str(&numerator_text)
        .map_err(|_| "baseFeeMultiplier is out of range".to_string())?;
    Ok(ParsedBaseFeeMultiplier {
        numerator,
        denominator,
        text: trimmed.to_string(),
    })
}

fn checked_add_u256(left: U256, right: U256, label: &str) -> Result<U256, String> {
    let (value, overflowed) = left.overflowing_add(right);
    if overflowed {
        Err(format!("{label} overflows uint256"))
    } else {
        Ok(value)
    }
}

fn checked_mul_u256(left: U256, right: U256, label: &str) -> Result<U256, String> {
    let (value, overflowed) = left.overflowing_mul(right);
    if overflowed {
        Err(format!("{label} overflows uint256"))
    } else {
        Ok(value)
    }
}

fn ceil_multiply_u256(value: U256, numerator: U256, denominator: U256) -> Result<U256, String> {
    if denominator.is_zero() {
        return Err("baseFeeMultiplier denominator cannot be zero".to_string());
    }
    let product = checked_mul_u256(value, numerator, "baseFeeMultiplier product")?;
    let adjusted = checked_add_u256(
        product,
        denominator - U256::one(),
        "baseFeeMultiplier product",
    )?;
    Ok(adjusted / denominator)
}

fn sanitize_inference(input: RawCalldataInferenceInput) -> RawCalldataInferenceInput {
    RawCalldataInferenceInput {
        status: if input.status.trim().is_empty() {
            "unknown".to_string()
        } else {
            input.status
        },
        matched_source: input.matched_source,
        selector_match_count: input.selector_match_count,
        conflict_summary: input.conflict_summary,
        stale_summary: input.stale_summary,
        source_status: input.source_status,
    }
}

fn effective_inference(
    inference: RawCalldataInferenceInput,
    calldata: &NormalizedCalldata,
) -> RawCalldataInferenceInput {
    if calldata.selector_status == "present" {
        return inference;
    }
    RawCalldataInferenceInput {
        status: "unknown".to_string(),
        matched_source: None,
        selector_match_count: Some(0),
        conflict_summary: None,
        stale_summary: None,
        source_status: Some(if calldata.selector_status == "none" {
            "selectorMissing".to_string()
        } else {
            "selectorTooShort".to_string()
        }),
    }
}

fn acknowledgement_map(input: &RawCalldataSubmitInput) -> HashMap<&str, bool> {
    let mut acknowledgements = HashMap::new();
    for warning in &input.warnings {
        acknowledgements.insert(warning.code.as_str(), warning.acknowledged);
    }
    for acknowledgement in &input.warning_acknowledgements {
        acknowledgements.insert(acknowledgement.code.as_str(), acknowledgement.acknowledged);
    }
    acknowledgements
}

fn expected_warning_statuses(
    calldata: &NormalizedCalldata,
    value_wei: U256,
    fees: &ParsedFeeFields,
    manual_gas: bool,
    inference: &RawCalldataInferenceInput,
) -> Vec<ExpectedWarning> {
    let mut warnings = Vec::new();
    if calldata.byte_length == 0 {
        warnings.push(expected_warning(
            "emptyCalldata",
            "Raw calldata is empty.",
            "calldata",
        ));
    }
    if calldata.byte_length > (RAW_CALLDATA_MAX_BYTES / 2) as u64 {
        warnings.push(expected_warning(
            "largeCalldata",
            "Raw calldata is large; review the bounded preview carefully.",
            "calldata",
        ));
    }
    if !value_wei.is_zero() {
        warnings.push(expected_warning(
            "nonzeroValue",
            "This raw call sends native value.",
            "value",
        ));
    }
    if manual_gas
        || fees
            .estimated_gas_limit
            .is_some_and(|estimated| fees.gas_limit != estimated)
    {
        warnings.push(expected_warning(
            "manualGas",
            "Manual gas limit is set.",
            "fee",
        ));
    }
    if is_high_fee(fees) {
        warnings.push(expected_warning(
            "highFee",
            "Fee settings are high relative to live fee references.",
            "fee",
        ));
    }
    match inference.status.as_str() {
        "unknown" => warnings.push(expected_warning(
            "unknownSelector",
            "No ABI selector match is selected for this calldata.",
            "selector",
        )),
        "conflict" => warnings.push(expected_warning(
            "selectorConflict",
            "ABI selector inference has conflicts.",
            "selector",
        )),
        "stale" => warnings.push(expected_warning(
            "staleInference",
            "ABI selector inference is stale.",
            "selector",
        )),
        "unavailable" => warnings.push(expected_warning(
            "inferenceUnavailable",
            "ABI selector inference is unavailable.",
            "selector",
        )),
        _ => {}
    }
    warnings
}

fn expected_warning(
    code: &'static str,
    message: &'static str,
    source: &'static str,
) -> ExpectedWarning {
    ExpectedWarning {
        code,
        message,
        source,
        acknowledged: false,
    }
}

fn is_high_fee(fees: &ParsedFeeFields) -> bool {
    fees.live_max_fee_per_gas
        .is_some_and(|live| !live.is_zero() && fees.max_fee_per_gas > live * U256::from(3u64))
        || fees.latest_base_fee_per_gas.is_some_and(|latest| {
            !latest.is_zero() && fees.base_fee_per_gas > latest * U256::from(3u64)
        })
        || fees.live_max_priority_fee_per_gas.is_some_and(|live| {
            !live.is_zero() && fees.max_priority_fee_per_gas > live * U256::from(3u64)
        })
        || fees
            .estimated_gas_limit
            .is_some_and(|estimated| fees.gas_limit > estimated * U256::from(2u64))
}

fn validate_warning_acknowledgements(
    submitted_warnings: &[RawCalldataStatusSummary],
    acknowledgements: &HashMap<&str, bool>,
    expected_warnings: &[ExpectedWarning],
) -> Result<(), String> {
    for warning in submitted_warnings {
        if warning.requires_acknowledgement && !warning.acknowledged {
            return Err(format!(
                "raw calldata warning {} requires acknowledgement",
                warning.code
            ));
        }
    }
    for warning in expected_warnings {
        if !acknowledgements.get(warning.code).copied().unwrap_or(false) {
            return Err(format!(
                "raw calldata warning {} requires acknowledgement",
                warning.code
            ));
        }
    }
    Ok(())
}

struct RawCalldataFrozenPayloadParts<'a> {
    chain_id: u64,
    selected_rpc: &'a AbiCallSelectedRpcSummary,
    account_index: u32,
    from: &'a str,
    to: &'a str,
    value_wei: &'a str,
    calldata: &'a NormalizedCalldata,
    gas_limit: &'a str,
    estimated_gas_limit: Option<String>,
    manual_gas: bool,
    latest_base_fee_per_gas: Option<String>,
    base_fee_per_gas: &'a str,
    base_fee_multiplier: Option<&'a str>,
    max_fee_per_gas: &'a str,
    max_fee_override_per_gas: Option<String>,
    max_priority_fee_per_gas: &'a str,
    live_max_fee_per_gas: Option<String>,
    live_max_priority_fee_per_gas: Option<String>,
    nonce: u64,
    warnings: &'a [ExpectedWarning],
    inference: &'a RawCalldataInferenceInput,
    human_preview: &'a RawCalldataHumanPreview,
}

fn raw_calldata_frozen_key(parts: &RawCalldataFrozenPayloadParts<'_>) -> String {
    compact_raw_calldata_hash_key(&raw_calldata_frozen_payload(parts))
}

fn raw_calldata_frozen_payload(parts: &RawCalldataFrozenPayloadParts<'_>) -> Value {
    let acknowledgements = parts
        .warnings
        .iter()
        .map(|warning| {
            object_value([
                ("code", Value::String(warning.code.to_string())),
                ("acknowledged", Value::Bool(warning.acknowledged)),
            ])
        })
        .collect::<Vec<_>>();

    object_value([
        ("kind", Value::String("rawCalldataDraft".to_string())),
        ("version", number_value(1u64)),
        ("chainId", number_value(parts.chain_id)),
        ("rpc", rpc_identity_value(parts.selected_rpc)),
        ("fromAccountIndex", number_value(parts.account_index)),
        ("from", Value::String(parts.from.to_string())),
        ("to", Value::String(parts.to.to_string())),
        ("valueWei", Value::String(parts.value_wei.to_string())),
        (
            "calldata",
            object_value([
                (
                    "hashVersion",
                    Value::String(RAW_CALLDATA_HASH_VERSION.to_string()),
                ),
                ("hash", Value::String(parts.calldata.hash.clone())),
                ("byteLength", number_value(parts.calldata.byte_length)),
                (
                    "selector",
                    optional_string_value(parts.calldata.selector.as_deref()),
                ),
                (
                    "selectorStatus",
                    Value::String(parts.calldata.selector_status.clone()),
                ),
                ("display", Value::String(parts.calldata.display.clone())),
                ("prefix", Value::String(parts.calldata.prefix.clone())),
                ("suffix", Value::String(parts.calldata.suffix.clone())),
                ("truncated", Value::Bool(parts.calldata.truncated)),
                ("omittedBytes", number_value(parts.calldata.omitted_bytes)),
                ("human", human_preview_value(parts.human_preview)),
            ]),
        ),
        (
            "gas",
            object_value([
                ("gasLimit", Value::String(parts.gas_limit.to_string())),
                (
                    "estimatedGasLimit",
                    optional_string_value(parts.estimated_gas_limit.as_deref()),
                ),
                ("manualGas", Value::Bool(parts.manual_gas)),
                (
                    "latestBaseFeePerGas",
                    optional_string_value(parts.latest_base_fee_per_gas.as_deref()),
                ),
                (
                    "baseFeePerGas",
                    Value::String(parts.base_fee_per_gas.to_string()),
                ),
                (
                    "baseFeeMultiplier",
                    optional_string_value(parts.base_fee_multiplier),
                ),
                (
                    "maxFeePerGas",
                    Value::String(parts.max_fee_per_gas.to_string()),
                ),
                (
                    "maxFeeOverridePerGas",
                    optional_string_value(parts.max_fee_override_per_gas.as_deref()),
                ),
                (
                    "maxPriorityFeePerGas",
                    Value::String(parts.max_priority_fee_per_gas.to_string()),
                ),
                (
                    "liveMaxFeePerGas",
                    optional_string_value(parts.live_max_fee_per_gas.as_deref()),
                ),
                (
                    "liveMaxPriorityFeePerGas",
                    optional_string_value(parts.live_max_priority_fee_per_gas.as_deref()),
                ),
            ]),
        ),
        ("nonce", number_value(parts.nonce)),
        ("warningAcknowledgements", Value::Array(acknowledgements)),
        ("inference", inference_value(parts.inference)),
    ])
}

fn rpc_identity_value(rpc: &AbiCallSelectedRpcSummary) -> Value {
    object_value([
        (
            "chainId",
            rpc.chain_id.map(number_value).unwrap_or(Value::Null),
        ),
        (
            "providerConfigId",
            optional_string_value(rpc.provider_config_id.as_deref()),
        ),
        (
            "endpointId",
            optional_string_value(rpc.endpoint_id.as_deref()),
        ),
        (
            "endpointName",
            optional_string_value(rpc.endpoint_name.as_deref()),
        ),
        (
            "endpointSummary",
            optional_string_value(rpc.endpoint_summary.as_deref()),
        ),
        (
            "endpointFingerprint",
            optional_string_value(rpc.endpoint_fingerprint.as_deref()),
        ),
    ])
}

fn human_preview_value(human: &RawCalldataHumanPreview) -> Value {
    object_value([
        (
            "rows",
            Value::Array(
                human
                    .rows
                    .iter()
                    .map(|row| {
                        object_value([
                            ("label", Value::String(row.label.clone())),
                            ("value", Value::String(row.value.clone())),
                            ("displayText", Value::String(row.display_text.clone())),
                            ("truncated", Value::Bool(row.truncated)),
                            ("originalCharLength", number_value(row.original_char_length)),
                        ])
                    })
                    .collect(),
            ),
        ),
        ("truncatedRows", Value::Bool(human.truncated_rows)),
        ("omittedRows", number_value(human.omitted_rows)),
    ])
}

fn inference_value(inference: &RawCalldataInferenceInput) -> Value {
    object_value([
        ("status", Value::String(inference.status.clone())),
        (
            "matchedSource",
            inference
                .matched_source
                .as_ref()
                .map(|source| {
                    object_value([
                        ("identity", Value::String(source.identity.clone())),
                        ("version", optional_string_value(source.version.as_deref())),
                        (
                            "fingerprint",
                            optional_string_value(source.fingerprint.as_deref()),
                        ),
                        ("abiHash", optional_string_value(source.abi_hash.as_deref())),
                        (
                            "functionSignature",
                            optional_string_value(source.function_signature.as_deref()),
                        ),
                    ])
                })
                .unwrap_or(Value::Null),
        ),
        (
            "selectorMatchCount",
            inference
                .selector_match_count
                .map(number_value)
                .unwrap_or(Value::Null),
        ),
        (
            "conflictSummary",
            optional_string_value(inference.conflict_summary.as_deref()),
        ),
        (
            "staleSummary",
            optional_string_value(inference.stale_summary.as_deref()),
        ),
        (
            "sourceStatus",
            optional_string_value(inference.source_status.as_deref()),
        ),
    ])
}

fn object_value<const N: usize>(entries: [(&str, Value); N]) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect::<Map<String, Value>>(),
    )
}

fn optional_string_value(value: Option<&str>) -> Value {
    value
        .map(|value| Value::String(value.to_string()))
        .unwrap_or(Value::Null)
}

fn number_value(value: impl Into<u64>) -> Value {
    Value::Number(serde_json::Number::from(value.into()))
}

fn compact_raw_calldata_hash_key(value: &Value) -> String {
    let stable = stable_stringify(value);
    let hash = keccak256(stable.as_bytes());
    format!("{RAW_CALLDATA_FROZEN_KEY_PREFIX}-{}", hex_lower(&hash[..8]))
}

fn stable_stringify(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).expect("string serialization"),
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(stable_stringify)
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|key| format!(
                        "{}:{}",
                        serde_json::to_string(key).expect("key serialization"),
                        stable_stringify(&values[key])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

fn raw_warning_to_abi_status(warning: &ExpectedWarning) -> AbiCallStatusSummary {
    AbiCallStatusSummary {
        level: "warning".to_string(),
        code: warning.code.to_string(),
        message: Some(warning.message.to_string()),
        source: Some(warning.source.to_string()),
    }
}

fn raw_inference_to_history(inference: &RawCalldataInferenceInput) -> RawCalldataInferenceSummary {
    RawCalldataInferenceSummary {
        inference_status: inference.status.clone(),
        matched_source_kind: None,
        matched_source_id: inference
            .matched_source
            .as_ref()
            .map(|source| source.identity.clone()),
        matched_version_id: inference
            .matched_source
            .as_ref()
            .and_then(|source| source.version.clone()),
        matched_source_fingerprint: inference
            .matched_source
            .as_ref()
            .and_then(|source| source.fingerprint.clone()),
        matched_abi_hash: inference
            .matched_source
            .as_ref()
            .and_then(|source| source.abi_hash.clone()),
        selector_match_count: inference.selector_match_count,
        conflict_summary: inference.conflict_summary.clone(),
        stale_status: inference.stale_summary.clone(),
        source_status: inference.source_status.clone(),
    }
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
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
    let authority = canonical_rpc_authority(&scheme, authority);

    format!("{scheme}://{authority}")
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
                if let (Some(high), Some(low)) = (hex_value(high), hex_value(low)) {
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

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn compact_hash_key_with_prefix(prefix: &str, value: &str) -> String {
    let mut hash = 0x811c9dc5u32;
    for code_unit in value.encode_utf16() {
        hash ^= code_unit as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{prefix}-{hash:08x}")
}

fn unknown_string() -> String {
    "unknown".to_string()
}

fn warning_string() -> String {
    "warning".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_input() -> RawCalldataSubmitInput {
        let calldata = normalize_raw_calldata("0x12345678").unwrap();
        let mut input = RawCalldataSubmitInput {
            rpc_url: "https://rpc.example".to_string(),
            draft_id: Some("raw-calldata-draft".to_string()),
            frozen_key: None,
            created_at: Some("2026-04-29T00:00:00.000Z".to_string()),
            chain_id: 1,
            selected_rpc: Some(AbiCallSelectedRpcSummary {
                chain_id: Some(1),
                provider_config_id: Some("mainnet".to_string()),
                endpoint_id: Some("primary".to_string()),
                endpoint_name: Some("Primary".to_string()),
                endpoint_summary: Some("https://rpc.example".to_string()),
                endpoint_fingerprint: Some(rpc_endpoint_fingerprint("https://rpc.example")),
            }),
            from: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd".to_string(),
            account_index: Some(0),
            to: "0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed".to_string(),
            value_wei: "0".to_string(),
            calldata: calldata.canonical.clone(),
            calldata_hash_version: RAW_CALLDATA_HASH_VERSION.to_string(),
            calldata_hash: calldata.hash,
            calldata_byte_length: calldata.byte_length,
            selector: calldata.selector,
            selector_status: calldata.selector_status,
            nonce: 7,
            gas_limit: "21000".to_string(),
            estimated_gas_limit: Some("21000".to_string()),
            manual_gas: false,
            latest_base_fee_per_gas: Some("10".to_string()),
            base_fee_per_gas: "10".to_string(),
            base_fee_multiplier: Some("1".to_string()),
            max_fee_per_gas: "12".to_string(),
            max_fee_override_per_gas: None,
            max_priority_fee_per_gas: "2".to_string(),
            live_max_fee_per_gas: Some("12".to_string()),
            live_max_priority_fee_per_gas: Some("2".to_string()),
            warnings: Vec::new(),
            warning_acknowledgements: Vec::new(),
            blocking_statuses: Vec::new(),
            inference: RawCalldataInferenceInput {
                status: "matched".to_string(),
                matched_source: Some(RawCalldataInferenceMatchedSource {
                    identity: "verified-abi".to_string(),
                    version: Some("v1".to_string()),
                    fingerprint: Some("source-fp".to_string()),
                    abi_hash: Some("abi-hash".to_string()),
                    function_signature: Some("transfer(address,uint256)".to_string()),
                }),
                selector_match_count: Some(1),
                conflict_summary: None,
                stale_summary: None,
                source_status: Some("ok".to_string()),
            },
            human_preview: RawCalldataHumanPreview::default(),
        };
        refresh_frozen_key(&mut input);
        input
    }

    fn refresh_frozen_key(input: &mut RawCalldataSubmitInput) {
        let selected_rpc = input.selected_rpc.as_ref().unwrap();
        let calldata = normalize_raw_calldata(&input.calldata).unwrap();
        let value_wei = parse_submit_u256("valueWei", &input.value_wei).unwrap();
        let fees = parse_fee_fields(input).unwrap();
        let inference = effective_inference(input.inference.clone(), &calldata);
        let acknowledgements = acknowledgement_map(input);
        let warnings =
            expected_warning_statuses(&calldata, value_wei, &fees, input.manual_gas, &inference)
                .into_iter()
                .map(|warning| ExpectedWarning {
                    acknowledged: acknowledgements
                        .get(warning.code)
                        .copied()
                        .unwrap_or(warning.acknowledged),
                    ..warning
                })
                .collect::<Vec<_>>();
        input.frozen_key = Some(raw_calldata_frozen_key(&RawCalldataFrozenPayloadParts {
            chain_id: input.chain_id,
            selected_rpc,
            account_index: input.account_index.unwrap(),
            from: &input.from,
            to: &input.to,
            value_wei: &value_wei.to_string(),
            calldata: &calldata,
            gas_limit: &fees.gas_limit.to_string(),
            estimated_gas_limit: fees.estimated_gas_limit.map(|value| value.to_string()),
            manual_gas: input.manual_gas,
            latest_base_fee_per_gas: fees.latest_base_fee_per_gas.map(|value| value.to_string()),
            base_fee_per_gas: &fees.base_fee_per_gas.to_string(),
            base_fee_multiplier: fees
                .base_fee_multiplier
                .as_ref()
                .map(|multiplier| multiplier.text.as_str()),
            max_fee_per_gas: &fees.max_fee_per_gas.to_string(),
            max_fee_override_per_gas: fees.max_fee_override_per_gas.map(|value| value.to_string()),
            max_priority_fee_per_gas: &fees.max_priority_fee_per_gas.to_string(),
            live_max_fee_per_gas: fees.live_max_fee_per_gas.map(|value| value.to_string()),
            live_max_priority_fee_per_gas: fees
                .live_max_priority_fee_per_gas
                .map(|value| value.to_string()),
            nonce: input.nonce,
            warnings: &warnings,
            inference: &inference,
            human_preview: &input.human_preview,
        }));
    }

    fn warning_ack(code: &str) -> RawCalldataWarningAcknowledgement {
        RawCalldataWarningAcknowledgement {
            code: code.to_string(),
            acknowledged: true,
        }
    }

    #[test]
    fn raw_calldata_submit_valid_input_builds_typed_intent_bytes_metadata_and_frozen_key() {
        let mut input = base_input();
        let long_calldata = format!(
            "0x{}{}{}",
            "11".repeat(40),
            "22".repeat(10),
            "33".repeat(40)
        );
        let preview = normalize_raw_calldata(&long_calldata).unwrap();
        input.calldata = long_calldata.clone();
        input.calldata_hash = preview.hash.clone();
        input.calldata_byte_length = preview.byte_length;
        input.selector = preview.selector.clone();
        input.selector_status = preview.selector_status.clone();
        refresh_frozen_key(&mut input);

        let (intent, bytes, metadata, frozen_key) =
            validate_raw_calldata_submit_input(input).expect("valid raw calldata submit");

        assert_eq!(
            intent.typed_transaction.transaction_type,
            TransactionType::RawCalldata
        );
        assert_eq!(
            intent.typed_transaction.selector,
            Some("0x11111111".to_string())
        );
        assert_eq!(bytes.len(), 90);
        assert_eq!(metadata.intent_kind, "rawCalldata");
        assert_eq!(metadata.calldata_hash, Some(preview.hash));
        assert_eq!(metadata.calldata_byte_length, Some(90));
        assert_eq!(metadata.blocking_statuses.len(), 0);
        assert_eq!(metadata.frozen_key, Some(frozen_key));
        let serialized = serde_json::to_string(&metadata).unwrap();
        assert!(!serialized.contains(&long_calldata));
    }

    #[test]
    fn raw_calldata_submit_rejects_malformed_calldata() {
        for calldata in ["1234", "0x123", "0x12zz"] {
            let mut input = base_input();
            input.calldata = calldata.to_string();
            let error = validate_raw_calldata_submit_input(input).expect_err("malformed calldata");
            assert!(
                error.contains("raw calldata"),
                "{calldata} should be rejected: {error}"
            );
        }

        let mut input = base_input();
        input.calldata = format!("0x{}", "aa".repeat(RAW_CALLDATA_MAX_BYTES + 1));
        let error = validate_raw_calldata_submit_input(input).expect_err("oversized calldata");
        assert!(error.contains("byte limit"), "{error}");
    }

    #[test]
    fn raw_calldata_submit_rejects_summary_mismatches() {
        let mut input = base_input();
        input.calldata_hash =
            "0x0000000000000000000000000000000000000000000000000000000000000000".to_string();
        assert!(validate_raw_calldata_submit_input(input)
            .expect_err("hash mismatch")
            .contains("hash"));

        let mut input = base_input();
        input.calldata_byte_length = 99;
        assert!(validate_raw_calldata_submit_input(input)
            .expect_err("length mismatch")
            .contains("byte length"));

        let mut input = base_input();
        input.selector = Some("0x87654321".to_string());
        assert!(validate_raw_calldata_submit_input(input)
            .expect_err("selector mismatch")
            .contains("selector"));

        let mut input = base_input();
        input.selector_status = "short".to_string();
        assert!(validate_raw_calldata_submit_input(input)
            .expect_err("selector status mismatch")
            .contains("selectorStatus"));

        let mut input = base_input();
        input.calldata_hash_version = "sha256-v1".to_string();
        assert!(validate_raw_calldata_submit_input(input)
            .expect_err("hash version mismatch")
            .contains("keccak256-v1"));
    }

    #[test]
    fn raw_calldata_submit_rejects_selected_rpc_chain_mismatch_or_missing() {
        let mut input = base_input();
        input.selected_rpc.as_mut().unwrap().chain_id = Some(5);
        refresh_frozen_key(&mut input);
        assert!(validate_raw_calldata_submit_input(input)
            .expect_err("chain mismatch")
            .contains("does not match"));

        let mut input = base_input();
        input.selected_rpc.as_mut().unwrap().chain_id = None;
        assert!(validate_raw_calldata_submit_input(input)
            .expect_err("missing selected chain")
            .contains("selectedRpc.chainId"));
    }

    #[test]
    fn raw_calldata_submit_binds_rpc_url_to_selected_rpc_identity() {
        let input = base_input();
        validate_raw_calldata_submit_input(input).expect("matching rpc identity should pass");

        let mut input = base_input();
        input.rpc_url = "https://other-rpc.example".to_string();
        let error =
            validate_raw_calldata_submit_input(input).expect_err("swapped rpc summary rejected");
        assert!(error.contains("endpointSummary"), "{error}");
        assert!(!error.contains("other-rpc.example"), "{error}");

        let mut input = base_input();
        input.selected_rpc.as_mut().unwrap().endpoint_summary = None;
        input.rpc_url = "https://rpc.example/alternate?api_key=secret".to_string();
        let error = validate_raw_calldata_submit_input(input)
            .expect_err("swapped rpc fingerprint rejected");
        assert!(error.contains("endpointFingerprint"), "{error}");
        assert!(!error.contains("secret"), "{error}");
    }

    #[test]
    fn raw_calldata_submit_rejects_malformed_addresses_and_checksums_from() {
        let mut input = base_input();
        let expected_from = to_checksum(&Address::from_str(&input.from).unwrap(), None);
        refresh_frozen_key(&mut input);
        let (intent, _, _, _) =
            validate_raw_calldata_submit_input(input).expect("checksum drift should pass");
        assert_eq!(intent.from, expected_from);

        let mut input = base_input();
        input.from = "not-an-address".to_string();
        assert!(validate_raw_calldata_submit_input(input)
            .expect_err("bad from")
            .contains("from"));

        let mut input = base_input();
        input.to = "0x1234".to_string();
        assert!(validate_raw_calldata_submit_input(input)
            .expect_err("bad to")
            .contains("to"));
    }

    #[test]
    fn raw_calldata_submit_frozen_key_covers_draft_address_strings() {
        let mut input = base_input();
        let checksummed_from = to_checksum(&Address::from_str(&input.from).unwrap(), None);
        assert_ne!(input.from, checksummed_from);
        input.from = checksummed_from;

        let error = validate_raw_calldata_submit_input(input)
            .expect_err("changed address string should invalidate frozen key");
        assert!(error.contains("frozenKey"), "{error}");
    }

    #[test]
    fn raw_calldata_submit_rejects_unbounded_human_preview() {
        let mut valid = base_input();
        valid.human_preview = RawCalldataHumanPreview {
            rows: vec![RawCalldataHumanPreviewRow {
                label: "Method".to_string(),
                value: "transfer".to_string(),
                display_text: "Method: transfer".to_string(),
                truncated: false,
                original_char_length: 14,
            }],
            truncated_rows: false,
            omitted_rows: 0,
        };
        refresh_frozen_key(&mut valid);
        validate_raw_calldata_submit_input(valid).expect("bounded human preview should pass");

        let mut input = base_input();
        input.human_preview.rows = (0..=RAW_CALLDATA_HUMAN_PREVIEW_MAX_ROWS)
            .map(|index| RawCalldataHumanPreviewRow {
                label: format!("Row {index}"),
                value: "value".to_string(),
                display_text: format!("Row {index}: value"),
                truncated: false,
                original_char_length: 10,
            })
            .collect();
        refresh_frozen_key(&mut input);
        let error = validate_raw_calldata_submit_input(input).expect_err("too many rows rejected");
        assert!(error.contains("humanPreview"), "{error}");

        let mut input = base_input();
        let overlong = "x".repeat(RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS + 1);
        input.human_preview.rows = vec![RawCalldataHumanPreviewRow {
            label: "Label".to_string(),
            value: overlong.clone(),
            display_text: overlong,
            truncated: false,
            original_char_length: (RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS + 1) as u64,
        }];
        refresh_frozen_key(&mut input);
        let error =
            validate_raw_calldata_submit_input(input).expect_err("overlong preview rejected");
        assert!(error.contains("humanPreview"), "{error}");
    }

    #[test]
    fn raw_calldata_submit_rejects_fee_mismatch_and_priority_above_max() {
        let mut input = base_input();
        input.max_fee_per_gas = "13".to_string();
        refresh_frozen_key(&mut input);
        assert!(validate_raw_calldata_submit_input(input)
            .expect_err("fee mismatch")
            .contains("maxFeePerGas"));

        let mut input = base_input();
        input.base_fee_per_gas = "0".to_string();
        input.max_fee_per_gas = "1".to_string();
        input.max_fee_override_per_gas = Some("1".to_string());
        input.max_priority_fee_per_gas = "2".to_string();
        refresh_frozen_key(&mut input);
        assert!(validate_raw_calldata_submit_input(input)
            .expect_err("priority greater than max")
            .contains("maxPriorityFeePerGas"));
    }

    #[test]
    fn raw_calldata_submit_requires_high_risk_warning_acknowledgements_and_passes_when_acknowledged(
    ) {
        let cases = [("0x", "emptyCalldata"), ("0x12345678", "unknownSelector")];
        for (calldata, code) in cases {
            let mut input = base_input();
            let preview = normalize_raw_calldata(calldata).unwrap();
            input.calldata = calldata.to_string();
            input.calldata_hash = preview.hash;
            input.calldata_byte_length = preview.byte_length;
            input.selector = preview.selector;
            input.selector_status = preview.selector_status;
            input.inference = RawCalldataInferenceInput {
                status: "unknown".to_string(),
                selector_match_count: Some(0),
                ..RawCalldataInferenceInput::default()
            };
            refresh_frozen_key(&mut input);
            assert!(validate_raw_calldata_submit_input(input)
                .expect_err("missing acknowledgement")
                .contains(code));

            let mut input = base_input();
            let preview = normalize_raw_calldata(calldata).unwrap();
            input.calldata = calldata.to_string();
            input.calldata_hash = preview.hash;
            input.calldata_byte_length = preview.byte_length;
            input.selector = preview.selector;
            input.selector_status = preview.selector_status;
            input.inference = RawCalldataInferenceInput {
                status: "unknown".to_string(),
                selector_match_count: Some(0),
                ..RawCalldataInferenceInput::default()
            };
            input.warning_acknowledgements = vec![warning_ack(code)];
            if code == "emptyCalldata" {
                input
                    .warning_acknowledgements
                    .push(warning_ack("unknownSelector"));
            }
            refresh_frozen_key(&mut input);
            validate_raw_calldata_submit_input(input).expect("acknowledged warning should pass");
        }

        for (status, code) in [
            ("conflict", "selectorConflict"),
            ("stale", "staleInference"),
            ("unavailable", "inferenceUnavailable"),
        ] {
            let mut input = base_input();
            input.inference.status = status.to_string();
            refresh_frozen_key(&mut input);
            assert!(validate_raw_calldata_submit_input(input)
                .expect_err("missing inference acknowledgement")
                .contains(code));

            let mut input = base_input();
            input.inference.status = status.to_string();
            input.warning_acknowledgements = vec![warning_ack(code)];
            refresh_frozen_key(&mut input);
            validate_raw_calldata_submit_input(input).expect("acknowledged inference should pass");
        }

        for code in ["nonzeroValue", "manualGas", "highFee"] {
            let mut input = base_input();
            apply_warning_case(&mut input, code);
            if code == "highFee" {
                input.max_fee_override_per_gas = Some(input.max_fee_per_gas.clone());
            }
            refresh_frozen_key(&mut input);
            assert!(validate_raw_calldata_submit_input(input)
                .expect_err("missing high risk acknowledgement")
                .contains(code));

            let mut input = base_input();
            apply_warning_case(&mut input, code);
            if code == "highFee" {
                input.max_fee_override_per_gas = Some(input.max_fee_per_gas.clone());
            }
            input.warning_acknowledgements = vec![warning_ack(code)];
            refresh_frozen_key(&mut input);
            validate_raw_calldata_submit_input(input).expect("acknowledged high risk warning");
        }

        let mut input = base_input();
        input.calldata = format!("0x{}", "aa".repeat(RAW_CALLDATA_MAX_BYTES / 2 + 1));
        let preview = normalize_raw_calldata(&input.calldata).unwrap();
        input.calldata_hash = preview.hash;
        input.calldata_byte_length = preview.byte_length;
        input.selector = preview.selector;
        input.selector_status = preview.selector_status;
        input.warning_acknowledgements = vec![warning_ack("largeCalldata")];
        refresh_frozen_key(&mut input);
        validate_raw_calldata_submit_input(input).expect("acknowledged large calldata");
    }

    #[test]
    fn raw_calldata_submit_rejects_frozen_key_mismatch() {
        let mut input = base_input();
        input.frozen_key = Some("raw-calldata-0000000000000000".to_string());
        assert!(validate_raw_calldata_submit_input(input)
            .expect_err("frozen key mismatch")
            .contains("frozenKey"));
    }

    #[test]
    fn raw_calldata_submit_fixed_vector_matches_ts_compact_hash_key() {
        let input = base_input();
        assert_eq!(
            input.frozen_key.as_deref(),
            Some("raw-calldata-2418ac21f27bc662")
        );
    }

    #[test]
    fn raw_calldata_stable_stringify_sorts_object_keys_like_ts() {
        let value = object_value([
            ("b", number_value(1u64)),
            (
                "a",
                object_value([("d", Value::Bool(false)), ("c", Value::Null)]),
            ),
        ]);
        assert_eq!(
            stable_stringify(&value),
            r#"{"a":{"c":null,"d":false},"b":1}"#
        );
    }

    fn apply_warning_case(input: &mut RawCalldataSubmitInput, code: &str) {
        match code {
            "nonzeroValue" => input.value_wei = "1".to_string(),
            "manualGas" => input.manual_gas = true,
            "highFee" => input.max_fee_per_gas = "40".to_string(),
            _ => unreachable!("unknown warning case"),
        }
    }
}
