use std::fs;
use std::io::ErrorKind;
use std::str::FromStr;

use ethers::abi::{Abi, Function, Param, ParamType, StateMutability, Token};
use ethers::providers::{Http, JsonRpcError, Middleware, Provider, ProviderError, RpcError};
use ethers::types::transaction::eip2718::TypedTransaction;
use ethers::types::{Address, Bytes, TransactionRequest, U256};
use ethers::utils::{keccak256, to_checksum};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::{timeout, Duration};

use crate::commands::abi_registry::{load_abi_registry_state, AbiCacheEntryRecord};
use crate::diagnostics::sanitize_diagnostic_message;
use crate::storage::ensure_app_dir;

const FETCH_SOURCE_OK: &str = "ok";
const VALIDATION_OK: &str = "ok";
const CACHE_FRESH: &str = "cacheFresh";
const SELECTION_SELECTED: &str = "selected";
const MAX_SUMMARY_STRING_CHARS: usize = 256;
const MAX_SUMMARY_ITEMS: usize = 16;
const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;
const ABI_READ_RPC_TIMEOUT_SECONDS: u64 = 10;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiReadCallInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(alias = "contract_address")]
    pub contract_address: String,
    #[serde(alias = "source_kind")]
    pub source_kind: String,
    #[serde(default, alias = "provider_config_id")]
    pub provider_config_id: Option<String>,
    #[serde(default, alias = "user_source_id")]
    pub user_source_id: Option<String>,
    #[serde(alias = "version_id")]
    pub version_id: String,
    #[serde(alias = "abi_hash")]
    pub abi_hash: String,
    #[serde(alias = "source_fingerprint")]
    pub source_fingerprint: String,
    #[serde(alias = "function_signature")]
    pub function_signature: String,
    #[serde(default, alias = "canonical_params")]
    pub canonical_params: Vec<Value>,
    #[serde(default)]
    pub from: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiManagedEntryInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "contract_address")]
    pub contract_address: String,
    #[serde(alias = "source_kind")]
    pub source_kind: String,
    #[serde(default, alias = "provider_config_id")]
    pub provider_config_id: Option<String>,
    #[serde(default, alias = "user_source_id")]
    pub user_source_id: Option<String>,
    #[serde(alias = "version_id")]
    pub version_id: String,
    #[serde(alias = "abi_hash")]
    pub abi_hash: String,
    #[serde(alias = "source_fingerprint")]
    pub source_fingerprint: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiCalldataPreviewInput {
    #[serde(flatten)]
    pub entry: AbiManagedEntryInput,
    #[serde(alias = "function_signature")]
    pub function_signature: String,
    #[serde(default, alias = "canonical_params")]
    pub canonical_params: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbiReadCallResult {
    pub status: String,
    pub reasons: Vec<String>,
    pub function_signature: String,
    pub selector: Option<String>,
    pub contract_address: Option<String>,
    pub from: Option<String>,
    pub source_kind: String,
    pub provider_config_id: Option<String>,
    pub user_source_id: Option<String>,
    pub version_id: String,
    pub abi_hash: String,
    pub source_fingerprint: String,
    pub calldata: Option<AbiCallDataSummary>,
    pub outputs: Vec<AbiDecodedValueSummary>,
    pub rpc: AbiReadRpcSummary,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbiFunctionCatalogResult {
    pub status: String,
    pub reasons: Vec<String>,
    pub contract_address: Option<String>,
    pub source_kind: String,
    pub provider_config_id: Option<String>,
    pub user_source_id: Option<String>,
    pub version_id: String,
    pub abi_hash: String,
    pub source_fingerprint: String,
    pub functions: Vec<AbiFunctionSchema>,
    pub unsupported_item_count: usize,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbiFunctionSchema {
    pub name: String,
    pub signature: String,
    pub selector: Option<String>,
    pub state_mutability: String,
    pub call_kind: String,
    pub supported: bool,
    pub unsupported_reason: Option<String>,
    pub inputs: Vec<AbiParamSchema>,
    pub outputs: Vec<AbiParamSchema>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbiParamSchema {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub type_label: String,
    pub kind: String,
    pub array_length: Option<usize>,
    pub components: Option<Vec<AbiParamSchema>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbiCalldataPreviewResult {
    pub status: String,
    pub reasons: Vec<String>,
    pub function_signature: String,
    pub selector: Option<String>,
    pub contract_address: Option<String>,
    pub source_kind: String,
    pub provider_config_id: Option<String>,
    pub user_source_id: Option<String>,
    pub version_id: String,
    pub abi_hash: String,
    pub source_fingerprint: String,
    pub parameter_summary: Vec<AbiDecodedValueSummary>,
    pub calldata: Option<AbiCallDataSummary>,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbiCallDataSummary {
    pub byte_length: usize,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AbiReadRpcSummary {
    pub endpoint: String,
    pub expected_chain_id: Option<u64>,
    pub actual_chain_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbiDecodedFieldSummary {
    pub name: Option<String>,
    pub value: AbiDecodedValueSummary,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbiDecodedValueSummary {
    pub kind: String,
    #[serde(rename = "type")]
    pub type_label: String,
    pub value: Option<String>,
    pub byte_length: Option<usize>,
    pub hash: Option<String>,
    pub items: Option<Vec<AbiDecodedValueSummary>>,
    pub fields: Option<Vec<AbiDecodedFieldSummary>>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn list_managed_abi_functions(
    input: AbiManagedEntryInput,
) -> Result<AbiFunctionCatalogResult, String> {
    let normalized = match normalize_managed_entry_input(input) {
        Ok(normalized) => normalized,
        Err(result) => return Ok(result),
    };
    let entry = match selected_cache_entry_for_managed(&normalized) {
        Ok(entry) => entry,
        Err(result) => return Ok(result),
    };
    if let Some(blocked) = non_callable_catalog_result(&normalized, &entry) {
        return Ok(blocked);
    }
    let artifact = match read_abi_artifact_for_managed(&normalized) {
        Ok(artifact) => artifact,
        Err(result) => return Ok(result),
    };
    if hash_text(&artifact) != normalized.abi_hash {
        return Ok(catalog_result(&normalized)
            .status("artifactDrift")
            .reason("artifactHashDrift")
            .error("ABI artifact hash does not match selected ABI hash")
            .finish());
    }
    let raw_abi = match serde_json::from_str::<Value>(&artifact) {
        Ok(raw_abi) => raw_abi,
        Err(_) => {
            return Ok(catalog_result(&normalized)
                .status("artifactDrift")
                .reason("malformedAbiArtifact")
                .error("ABI artifact could not be parsed")
                .finish());
        }
    };
    match function_catalog_from_raw_abi(&raw_abi) {
        Ok((functions, unsupported_item_count)) => Ok(catalog_result(&normalized)
            .status("success")
            .functions(functions)
            .unsupported_item_count(unsupported_item_count)
            .finish()),
        Err(RawFunctionSelectionError::Malformed) => Ok(catalog_result(&normalized)
            .status("artifactDrift")
            .reason("malformedAbiArtifact")
            .error("ABI artifact could not be parsed")
            .finish()),
        Err(_) => Ok(catalog_result(&normalized)
            .status("artifactDrift")
            .reason("malformedAbiArtifact")
            .finish()),
    }
}

#[tauri::command]
pub async fn preview_managed_abi_calldata(
    input: AbiCalldataPreviewInput,
) -> Result<AbiCalldataPreviewResult, String> {
    let normalized = match normalize_preview_input(input) {
        Ok(normalized) => normalized,
        Err(result) => return Ok(result),
    };
    let entry = match selected_cache_entry_for_managed(&normalized.entry) {
        Ok(entry) => entry,
        Err(result) => return Ok(preview_from_catalog_block(&normalized, result)),
    };
    if let Some(blocked) = non_callable_catalog_result(&normalized.entry, &entry) {
        return Ok(preview_from_catalog_block(&normalized, blocked));
    }
    let artifact = match read_abi_artifact_for_managed(&normalized.entry) {
        Ok(artifact) => artifact,
        Err(result) => return Ok(preview_from_catalog_block(&normalized, result)),
    };
    if hash_text(&artifact) != normalized.entry.abi_hash {
        return Ok(preview_result(&normalized)
            .status("artifactDrift")
            .reason("artifactHashDrift")
            .error("ABI artifact hash does not match selected ABI hash")
            .finish());
    }
    let raw_abi = match serde_json::from_str::<Value>(&artifact) {
        Ok(raw_abi) => raw_abi,
        Err(_) => {
            return Ok(preview_result(&normalized)
                .status("artifactDrift")
                .reason("malformedAbiArtifact")
                .error("ABI artifact could not be parsed")
                .finish());
        }
    };
    let function = match select_raw_function_by_signature(&raw_abi, &normalized.function_signature)
    {
        Ok(RawFunctionSelection::Callable(function)) => function,
        Ok(RawFunctionSelection::UnsupportedFunctionType) => {
            return Ok(preview_result(&normalized)
                .selector(selector_for_signature(&normalized.function_signature))
                .status("functionNotCallable")
                .reason("unsupportedFunctionType")
                .finish());
        }
        Err(RawFunctionSelectionError::Unknown) => {
            return Ok(preview_result(&normalized)
                .status("functionNotFound")
                .reason("functionSignatureUnknown")
                .finish());
        }
        Err(RawFunctionSelectionError::Ambiguous) => {
            return Ok(preview_result(&normalized)
                .status("functionNotFound")
                .reason("functionSignatureAmbiguous")
                .finish());
        }
        Err(RawFunctionSelectionError::Malformed) => {
            return Ok(preview_result(&normalized)
                .status("artifactDrift")
                .reason("malformedAbiArtifact")
                .error("ABI artifact could not be parsed")
                .finish());
        }
    };
    let signature = function_signature(&function);
    let selector = selector_for_signature(&signature);
    let tokens = match encode_tokens(&function.inputs, &normalized.canonical_params) {
        Ok(tokens) => tokens,
        Err(error) => {
            return Ok(preview_result(&normalized)
                .selector(selector)
                .status("validationError")
                .reason("invalidParams")
                .error(error)
                .finish());
        }
    };
    let calldata = match function.encode_input(&tokens) {
        Ok(calldata) => calldata,
        Err(error) => {
            return Ok(preview_result(&normalized)
                .selector(selector)
                .status("validationError")
                .reason("calldataEncodeFailed")
                .error(error.to_string())
                .finish());
        }
    };
    let parameter_summary = function
        .inputs
        .iter()
        .zip(tokens.iter())
        .map(|(param, token)| summarize_token(token, &param.kind, Some(&param.name)))
        .collect();
    Ok(preview_result(&normalized)
        .selector(selector)
        .calldata(calldata_summary(&calldata))
        .parameter_summary(parameter_summary)
        .status("success")
        .finish())
}

#[tauri::command]
pub async fn call_read_only_abi_function(
    input: AbiReadCallInput,
) -> Result<AbiReadCallResult, String> {
    let normalized = normalize_input(input);
    let normalized = match normalized {
        Ok(normalized) => normalized,
        Err(result) => return Ok(result),
    };

    let rpc_identity = summarize_rpc_endpoint(&normalized.rpc_url);
    let provider = match Provider::<Http>::try_from(normalized.rpc_url.as_str()) {
        Ok(provider) => provider,
        Err(error) => {
            return Ok(base_result(&normalized, rpc_identity)
                .status("validationError")
                .reason("rpcProviderInvalid")
                .error(format!("rpc provider invalid: {error}"))
                .finish());
        }
    };

    let entry = match selected_cache_entry(&normalized) {
        Ok(entry) => entry,
        Err(result) => return Ok(result.with_rpc(rpc_identity, Some(normalized.chain_id), None)),
    };
    if let Some(blocked) = non_callable_entry_result(&normalized, &entry) {
        return Ok(blocked.with_rpc(rpc_identity, Some(normalized.chain_id), None));
    }

    let artifact = match read_abi_artifact(&normalized) {
        Ok(artifact) => artifact,
        Err(result) => return Ok(result.with_rpc(rpc_identity, Some(normalized.chain_id), None)),
    };
    if hash_text(&artifact) != normalized.abi_hash {
        return Ok(base_result(&normalized, rpc_identity)
            .status("artifactDrift")
            .reason("artifactHashDrift")
            .error("ABI artifact hash does not match selected ABI hash")
            .finish());
    }

    let raw_abi = match serde_json::from_str::<Value>(&artifact) {
        Ok(raw_abi) => raw_abi,
        Err(_) => {
            return Ok(base_result(&normalized, rpc_identity)
                .status("artifactDrift")
                .reason("malformedAbiArtifact")
                .error("ABI artifact could not be parsed")
                .finish());
        }
    };
    let function = match select_raw_function_by_signature(&raw_abi, &normalized.function_signature)
    {
        Ok(RawFunctionSelection::Callable(function)) => function,
        Ok(RawFunctionSelection::UnsupportedFunctionType) => {
            return Ok(base_result(&normalized, rpc_identity)
                .selector(selector_for_signature(&normalized.function_signature))
                .status("functionNotCallable")
                .reason("unsupportedFunctionType")
                .finish());
        }
        Err(RawFunctionSelectionError::Unknown) => {
            return Ok(base_result(&normalized, rpc_identity)
                .status("functionNotFound")
                .reason("functionSignatureUnknown")
                .finish());
        }
        Err(RawFunctionSelectionError::Ambiguous) => {
            return Ok(base_result(&normalized, rpc_identity)
                .status("functionNotFound")
                .reason("functionSignatureAmbiguous")
                .finish());
        }
        Err(RawFunctionSelectionError::Malformed) => {
            return Ok(base_result(&normalized, rpc_identity)
                .status("artifactDrift")
                .reason("malformedAbiArtifact")
                .error("ABI artifact could not be parsed")
                .finish());
        }
    };
    let signature = function_signature(&function);
    let selector = selector_for_signature(&signature);
    if !is_read_only_function(&function) {
        return Ok(base_result(&normalized, rpc_identity)
            .selector(selector)
            .status("functionNotCallable")
            .reason("nonReadOnlyFunction")
            .finish());
    }

    let tokens = match encode_tokens(&function.inputs, &normalized.canonical_params) {
        Ok(tokens) => tokens,
        Err(error) => {
            return Ok(base_result(&normalized, rpc_identity)
                .selector(selector)
                .status("validationError")
                .reason("invalidParams")
                .error(error)
                .finish());
        }
    };
    let calldata = match function.encode_input(&tokens) {
        Ok(calldata) => calldata,
        Err(error) => {
            return Ok(base_result(&normalized, rpc_identity)
                .selector(selector)
                .status("validationError")
                .reason("calldataEncodeFailed")
                .error(error.to_string())
                .finish());
        }
    };
    let calldata_summary = calldata_summary(&calldata);

    let actual_chain_id = match timeout(
        Duration::from_secs(ABI_READ_RPC_TIMEOUT_SECONDS),
        provider.get_chainid(),
    )
    .await
    {
        Err(_) => {
            return Ok(timeout_result(
                &normalized,
                rpc_identity,
                Some(selector),
                Some(calldata_summary),
                None,
                RpcTimeoutStage::ChainIdProbe,
            ));
        }
        Ok(Ok(value)) => value.as_u64(),
        Ok(Err(error)) => {
            return Ok(base_result(&normalized, rpc_identity)
                .selector(selector)
                .calldata(calldata_summary)
                .status("rpcFailure")
                .reason("chainIdProbeFailed")
                .error(format!("rpc chainId probe failed: {error}"))
                .finish());
        }
    };
    if actual_chain_id != normalized.chain_id {
        return Ok(base_result(&normalized, rpc_identity)
            .actual_chain_id(actual_chain_id)
            .selector(selector)
            .calldata(calldata_summary)
            .status("chainMismatch")
            .reason("chainMismatch")
            .error(format!(
                "chainId mismatch: expected {}, actual {}",
                normalized.chain_id, actual_chain_id
            ))
            .finish());
    }

    let mut tx = TransactionRequest::new()
        .to(normalized.contract)
        .data(Bytes::from(calldata));
    if let Some(from) = normalized.from_address {
        tx = tx.from(from);
    }
    let tx: TypedTransaction = tx.into();
    let bytes = match timeout(
        Duration::from_secs(ABI_READ_RPC_TIMEOUT_SECONDS),
        provider.call(&tx, None),
    )
    .await
    {
        Err(_) => {
            return Ok(timeout_result(
                &normalized,
                rpc_identity,
                Some(selector),
                Some(calldata_summary),
                Some(actual_chain_id),
                RpcTimeoutStage::EthCall,
            ));
        }
        Ok(Ok(bytes)) => bytes,
        Ok(Err(error)) => {
            let (status, reason) = classify_rpc_call_error(&error);
            return Ok(base_result(&normalized, rpc_identity)
                .actual_chain_id(actual_chain_id)
                .selector(selector)
                .calldata(calldata_summary)
                .status(status)
                .reason(reason)
                .error(format!("eth_call failed: {error}"))
                .finish());
        }
    };

    let decoded = decode_outputs(&function, bytes.as_ref());
    match decoded {
        Ok(outputs) => Ok(base_result(&normalized, rpc_identity)
            .actual_chain_id(actual_chain_id)
            .selector(selector)
            .calldata(calldata_summary)
            .outputs(outputs)
            .status("success")
            .finish()),
        Err(error) => Ok(base_result(&normalized, rpc_identity)
            .actual_chain_id(actual_chain_id)
            .selector(selector)
            .calldata(calldata_summary)
            .status(error.status)
            .reason(error.reason)
            .error(error.message)
            .finish()),
    }
}

#[derive(Debug, Clone)]
struct NormalizedInput {
    chain_id: u64,
    rpc_url: String,
    contract_address: String,
    contract: Address,
    source_kind: String,
    provider_config_id: Option<String>,
    user_source_id: Option<String>,
    version_id: String,
    abi_hash: String,
    source_fingerprint: String,
    function_signature: String,
    canonical_params: Vec<Value>,
    from: Option<String>,
    from_address: Option<Address>,
}

#[derive(Debug, Clone)]
struct NormalizedManagedEntry {
    chain_id: u64,
    contract_address: String,
    contract: Address,
    source_kind: String,
    provider_config_id: Option<String>,
    user_source_id: Option<String>,
    version_id: String,
    abi_hash: String,
    source_fingerprint: String,
}

#[derive(Debug, Clone)]
struct NormalizedPreviewInput {
    entry: NormalizedManagedEntry,
    function_signature: String,
    canonical_params: Vec<Value>,
}

fn normalize_input(input: AbiReadCallInput) -> Result<NormalizedInput, AbiReadCallResult> {
    let mut seed = NormalizedInput {
        chain_id: input.chain_id,
        rpc_url: input.rpc_url.trim().to_string(),
        contract_address: input.contract_address.trim().to_string(),
        contract: Address::zero(),
        source_kind: input.source_kind.trim().to_string(),
        provider_config_id: normalize_optional_string(input.provider_config_id),
        user_source_id: normalize_optional_string(input.user_source_id),
        version_id: input.version_id.trim().to_string(),
        abi_hash: normalize_hash_like(&input.abi_hash),
        source_fingerprint: normalize_hash_like(&input.source_fingerprint),
        function_signature: input.function_signature.trim().to_string(),
        canonical_params: input.canonical_params,
        from: input
            .from
            .as_ref()
            .and_then(|value| normalize_optional_string(Some(value.clone()))),
        from_address: None,
    };
    let rpc_identity = summarize_rpc_endpoint(&seed.rpc_url);

    if seed.chain_id == 0 {
        return Err(base_result(&seed, rpc_identity)
            .status("validationError")
            .reason("invalidChainId")
            .error("chainId must be greater than zero")
            .finish());
    }
    if !matches!(
        seed.source_kind.as_str(),
        "explorerFetched" | "userImported" | "userPasted"
    ) {
        return Err(base_result(&seed, rpc_identity)
            .status("validationError")
            .reason("invalidSourceKind")
            .error("sourceKind is not supported")
            .finish());
    }
    let contract = match parse_address(&seed.contract_address, "contract address") {
        Ok(address) if address != Address::zero() => address,
        Ok(_) => {
            return Err(base_result(&seed, rpc_identity)
                .status("validationError")
                .reason("invalidContractAddress")
                .error("contract address cannot be the zero address")
                .finish());
        }
        Err(error) => {
            return Err(base_result(&seed, rpc_identity)
                .status("validationError")
                .reason("invalidContractAddress")
                .error(error)
                .finish());
        }
    };
    seed.contract = contract;
    seed.contract_address = to_checksum(&contract, None);

    if let Some(from) = seed.from.as_deref() {
        match parse_address(from, "from") {
            Ok(address) => {
                seed.from_address = Some(address);
                seed.from = Some(to_checksum(&address, None));
            }
            Err(error) => {
                return Err(base_result(&seed, rpc_identity)
                    .status("validationError")
                    .reason("invalidFromAddress")
                    .error(error)
                    .finish());
            }
        }
    }
    if seed.version_id.is_empty() {
        return Err(base_result(&seed, rpc_identity)
            .status("validationError")
            .reason("invalidVersionId")
            .error("versionId is required")
            .finish());
    }
    if !is_hash_like(&seed.abi_hash) {
        return Err(base_result(&seed, rpc_identity)
            .status("validationError")
            .reason("invalidAbiHash")
            .error("abiHash must be a 0x-prefixed 32-byte hash")
            .finish());
    }
    if !is_hash_like(&seed.source_fingerprint) {
        return Err(base_result(&seed, rpc_identity)
            .status("validationError")
            .reason("invalidSourceFingerprint")
            .error("sourceFingerprint must be a 0x-prefixed 32-byte hash")
            .finish());
    }
    if seed.function_signature.is_empty() || !seed.function_signature.contains('(') {
        return Err(base_result(&seed, rpc_identity)
            .status("validationError")
            .reason("invalidFunctionSignature")
            .error("functionSignature must be a full ABI function signature")
            .finish());
    }
    Ok(seed)
}

fn normalize_managed_entry_seed(input: AbiManagedEntryInput) -> NormalizedManagedEntry {
    NormalizedManagedEntry {
        chain_id: input.chain_id,
        contract_address: input.contract_address.trim().to_string(),
        contract: Address::zero(),
        source_kind: input.source_kind.trim().to_string(),
        provider_config_id: normalize_optional_string(input.provider_config_id),
        user_source_id: normalize_optional_string(input.user_source_id),
        version_id: input.version_id.trim().to_string(),
        abi_hash: normalize_hash_like(&input.abi_hash),
        source_fingerprint: normalize_hash_like(&input.source_fingerprint),
    }
}

fn validate_managed_entry_seed(
    seed: &mut NormalizedManagedEntry,
) -> Option<(&'static str, String)> {
    if seed.chain_id == 0 {
        return Some((
            "invalidChainId",
            "chainId must be greater than zero".to_string(),
        ));
    }
    if !matches!(
        seed.source_kind.as_str(),
        "explorerFetched" | "userImported" | "userPasted"
    ) {
        return Some((
            "invalidSourceKind",
            "sourceKind is not supported".to_string(),
        ));
    }
    let contract = match parse_address(&seed.contract_address, "contract address") {
        Ok(address) if address != Address::zero() => address,
        Ok(_) => {
            return Some((
                "invalidContractAddress",
                "contract address cannot be the zero address".to_string(),
            ));
        }
        Err(error) => return Some(("invalidContractAddress", error)),
    };
    seed.contract = contract;
    seed.contract_address = to_checksum(&contract, None);
    if seed.version_id.is_empty() {
        return Some(("invalidVersionId", "versionId is required".to_string()));
    }
    if !is_hash_like(&seed.abi_hash) {
        return Some((
            "invalidAbiHash",
            "abiHash must be a 0x-prefixed 32-byte hash".to_string(),
        ));
    }
    if !is_hash_like(&seed.source_fingerprint) {
        return Some((
            "invalidSourceFingerprint",
            "sourceFingerprint must be a 0x-prefixed 32-byte hash".to_string(),
        ));
    }
    None
}

fn normalize_managed_entry_input(
    input: AbiManagedEntryInput,
) -> Result<NormalizedManagedEntry, AbiFunctionCatalogResult> {
    let mut seed = normalize_managed_entry_seed(input);
    if let Some((reason, error)) = validate_managed_entry_seed(&mut seed) {
        return Err(catalog_result(&seed)
            .status("validationError")
            .reason(reason)
            .error(error)
            .finish());
    }
    Ok(seed)
}

fn normalize_preview_input(
    input: AbiCalldataPreviewInput,
) -> Result<NormalizedPreviewInput, AbiCalldataPreviewResult> {
    let mut seed = normalize_managed_entry_seed(input.entry);
    let function_signature = input.function_signature.trim().to_string();
    if let Some((reason, error)) = validate_managed_entry_seed(&mut seed) {
        return Err(preview_result(&NormalizedPreviewInput {
            entry: seed,
            function_signature,
            canonical_params: input.canonical_params,
        })
        .status("validationError")
        .reason(reason)
        .error(error)
        .finish());
    }
    if function_signature.is_empty() || !function_signature.contains('(') {
        return Err(preview_result(&NormalizedPreviewInput {
            entry: seed,
            function_signature,
            canonical_params: input.canonical_params,
        })
        .status("validationError")
        .reason("invalidFunctionSignature")
        .error("functionSignature must be a full ABI function signature")
        .finish());
    }
    Ok(NormalizedPreviewInput {
        entry: seed,
        function_signature,
        canonical_params: input.canonical_params,
    })
}

fn selected_cache_entry(input: &NormalizedInput) -> Result<AbiCacheEntryRecord, AbiReadCallResult> {
    let state = match load_abi_registry_state() {
        Ok(state) => state,
        Err(error) => {
            return Err(base_result(input, summarize_rpc_endpoint(&input.rpc_url))
                .status("blocked")
                .reason("selectedAbiUnknown")
                .error(error)
                .finish());
        }
    };
    let Some(entry) = state.cache_entries.into_iter().find(|entry| {
        entry.chain_id == input.chain_id
            && normalize_address_key(&entry.contract_address)
                == normalize_address_key(&input.contract_address)
            && entry.source_kind == input.source_kind
            && optional_eq(
                entry.provider_config_id.as_deref(),
                input.provider_config_id.as_deref(),
            )
            && optional_eq(
                entry.user_source_id.as_deref(),
                input.user_source_id.as_deref(),
            )
            && entry.version_id == input.version_id
    }) else {
        return Err(base_result(input, summarize_rpc_endpoint(&input.rpc_url))
            .status("blocked")
            .reason("selectedAbiMissing")
            .finish());
    };

    if entry.abi_hash != input.abi_hash {
        return Err(base_result(input, summarize_rpc_endpoint(&input.rpc_url))
            .status("artifactDrift")
            .reason("abiHashDrift")
            .finish());
    }
    if entry.source_fingerprint != input.source_fingerprint {
        return Err(base_result(input, summarize_rpc_endpoint(&input.rpc_url))
            .status("artifactDrift")
            .reason("sourceFingerprintDrift")
            .finish());
    }
    Ok(entry)
}

fn selected_cache_entry_for_managed(
    input: &NormalizedManagedEntry,
) -> Result<AbiCacheEntryRecord, AbiFunctionCatalogResult> {
    let state = match load_abi_registry_state() {
        Ok(state) => state,
        Err(error) => {
            return Err(catalog_result(input)
                .status("blocked")
                .reason("selectedAbiUnknown")
                .error(error)
                .finish());
        }
    };
    let Some(entry) = state.cache_entries.into_iter().find(|entry| {
        entry.chain_id == input.chain_id
            && normalize_address_key(&entry.contract_address)
                == normalize_address_key(&input.contract_address)
            && entry.source_kind == input.source_kind
            && optional_eq(
                entry.provider_config_id.as_deref(),
                input.provider_config_id.as_deref(),
            )
            && optional_eq(
                entry.user_source_id.as_deref(),
                input.user_source_id.as_deref(),
            )
            && entry.version_id == input.version_id
    }) else {
        return Err(catalog_result(input)
            .status("blocked")
            .reason("selectedAbiMissing")
            .finish());
    };

    if entry.abi_hash != input.abi_hash {
        return Err(catalog_result(input)
            .status("artifactDrift")
            .reason("abiHashDrift")
            .finish());
    }
    if entry.source_fingerprint != input.source_fingerprint {
        return Err(catalog_result(input)
            .status("artifactDrift")
            .reason("sourceFingerprintDrift")
            .finish());
    }
    Ok(entry)
}

fn non_callable_entry_result(
    input: &NormalizedInput,
    entry: &AbiCacheEntryRecord,
) -> Option<AbiReadCallResult> {
    let reasons = non_callable_entry_reasons(entry);
    if reasons.is_empty() {
        return None;
    }
    let status = blocked_status_for_reasons(&reasons);
    let mut builder = base_result(input, summarize_rpc_endpoint(&input.rpc_url)).status(status);
    for reason in reasons {
        builder = builder.reason(reason);
    }
    Some(builder.finish())
}

fn non_callable_catalog_result(
    input: &NormalizedManagedEntry,
    entry: &AbiCacheEntryRecord,
) -> Option<AbiFunctionCatalogResult> {
    let reasons = non_callable_entry_reasons(entry);
    if reasons.is_empty() {
        return None;
    }
    let status = blocked_status_for_reasons(&reasons);
    let mut builder = catalog_result(input).status(status);
    for reason in reasons {
        builder = builder.reason(reason);
    }
    Some(builder.finish())
}

fn non_callable_entry_reasons(entry: &AbiCacheEntryRecord) -> Vec<String> {
    let mut reasons = Vec::new();
    if !entry.selected {
        reasons.push("notSelected".to_string());
    }
    if entry.fetch_source_status != FETCH_SOURCE_OK {
        reasons.push(entry.fetch_source_status.clone());
    }
    if entry.validation_status != VALIDATION_OK {
        reasons.push(entry.validation_status.clone());
    }
    if entry.cache_status != CACHE_FRESH {
        reasons.push(entry.cache_status.clone());
    }
    if entry.selection_status != SELECTION_SELECTED {
        reasons.push(entry.selection_status.clone());
    }
    dedupe(reasons)
}

fn blocked_status_for_reasons(reasons: &[String]) -> &'static str {
    if reasons.iter().any(|reason| reason == "refreshing") {
        "loading"
    } else if reasons.iter().any(|reason| reason == "refreshFailed") {
        "recoverableBlocked"
    } else {
        "blocked"
    }
}

fn read_abi_artifact(input: &NormalizedInput) -> Result<String, AbiReadCallResult> {
    let path = ensure_app_dir()
        .map_err(|_| {
            base_result(input, summarize_rpc_endpoint(&input.rpc_url))
                .status("blocked")
                .reason("artifactUnavailable")
                .error("ABI artifact storage is unavailable")
                .finish()
        })?
        .join("abi-artifacts")
        .join(format!("{}.json", input.abi_hash.trim_start_matches("0x")));
    fs::read_to_string(path).map_err(|error| {
        base_result(input, summarize_rpc_endpoint(&input.rpc_url))
            .status("blocked")
            .reason("artifactUnavailable")
            .error(artifact_read_error_summary(&error))
            .finish()
    })
}

fn read_abi_artifact_for_managed(
    input: &NormalizedManagedEntry,
) -> Result<String, AbiFunctionCatalogResult> {
    let path = ensure_app_dir()
        .map_err(|_| {
            catalog_result(input)
                .status("blocked")
                .reason("artifactUnavailable")
                .error("ABI artifact storage is unavailable")
                .finish()
        })?
        .join("abi-artifacts")
        .join(format!("{}.json", input.abi_hash.trim_start_matches("0x")));
    fs::read_to_string(path).map_err(|error| {
        catalog_result(input)
            .status("blocked")
            .reason("artifactUnavailable")
            .error(artifact_read_error_summary(&error))
            .finish()
    })
}

fn artifact_read_error_summary(error: &std::io::Error) -> &'static str {
    match error.kind() {
        ErrorKind::NotFound => "ABI artifact not found",
        ErrorKind::PermissionDenied => "ABI artifact is not readable",
        _ => "ABI artifact could not be read",
    }
}

#[derive(Debug)]
enum RawFunctionSelection {
    Callable(Function),
    UnsupportedFunctionType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RawFunctionSelectionError {
    Unknown,
    Ambiguous,
    Malformed,
}

fn select_raw_function_by_signature(
    abi: &Value,
    signature: &str,
) -> Result<RawFunctionSelection, RawFunctionSelectionError> {
    let Value::Array(items) = abi else {
        return Err(RawFunctionSelectionError::Malformed);
    };

    let mut matches = Vec::new();
    for item in items {
        let Value::Object(object) = item else {
            return Err(RawFunctionSelectionError::Malformed);
        };
        if object.get("type").and_then(Value::as_str) != Some("function") {
            continue;
        }
        let name = object
            .get("name")
            .and_then(Value::as_str)
            .ok_or(RawFunctionSelectionError::Malformed)?;
        let inputs = raw_param_list(object.get("inputs"))?;
        let raw_signature = format!("{name}({})", inputs.join(","));
        if raw_signature == signature {
            matches.push(Value::Object(object.clone()));
        }
    }

    let selected = match matches.as_slice() {
        [] => return Err(RawFunctionSelectionError::Unknown),
        [selected] => selected.clone(),
        _ => return Err(RawFunctionSelectionError::Ambiguous),
    };
    let Value::Object(object) = &selected else {
        return Err(RawFunctionSelectionError::Malformed);
    };

    if raw_params_use_unsupported_type(object.get("inputs"))?
        || raw_params_use_unsupported_type(object.get("outputs"))?
    {
        return Ok(RawFunctionSelection::UnsupportedFunctionType);
    }

    let abi = serde_json::from_value::<Abi>(Value::Array(vec![selected]))
        .map_err(|_| RawFunctionSelectionError::Malformed)?;
    let mut functions = abi.functions();
    let Some(function) = functions.next().cloned() else {
        return Err(RawFunctionSelectionError::Malformed);
    };
    if functions.next().is_some() {
        return Err(RawFunctionSelectionError::Ambiguous);
    }
    Ok(RawFunctionSelection::Callable(function))
}

fn function_catalog_from_raw_abi(
    abi: &Value,
) -> Result<(Vec<AbiFunctionSchema>, usize), RawFunctionSelectionError> {
    let Value::Array(items) = abi else {
        return Err(RawFunctionSelectionError::Malformed);
    };
    let mut functions = Vec::new();
    let mut unsupported_item_count = 0;
    for item in items {
        let Value::Object(object) = item else {
            return Err(RawFunctionSelectionError::Malformed);
        };
        let item_type = object
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("function");
        if item_type != "function" {
            if matches!(item_type, "constructor" | "fallback" | "receive") {
                unsupported_item_count += 1;
            }
            continue;
        }
        match function_schema_from_raw_object(object) {
            Ok(schema) => {
                if !schema.supported {
                    unsupported_item_count += 1;
                }
                functions.push(schema);
            }
            Err(error) => return Err(error),
        }
    }
    functions.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.signature.cmp(&right.signature))
    });
    Ok((functions, unsupported_item_count))
}

fn function_schema_from_raw_object(
    object: &serde_json::Map<String, Value>,
) -> Result<AbiFunctionSchema, RawFunctionSelectionError> {
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .ok_or(RawFunctionSelectionError::Malformed)?
        .to_string();
    let input_types = raw_param_list(object.get("inputs"))?;
    let signature = format!("{name}({})", input_types.join(","));
    let selector = Some(selector_for_signature(&signature));
    if raw_params_use_unsupported_type(object.get("inputs"))?
        || raw_params_use_unsupported_type(object.get("outputs"))?
    {
        return Ok(AbiFunctionSchema {
            name,
            signature,
            selector,
            state_mutability: raw_state_mutability(object),
            call_kind: "unsupported".to_string(),
            supported: false,
            unsupported_reason: Some("unsupportedFunctionType".to_string()),
            inputs: raw_param_schema_list(object.get("inputs"))?,
            outputs: raw_param_schema_list(object.get("outputs"))?,
        });
    }

    let abi = serde_json::from_value::<Abi>(Value::Array(vec![Value::Object(object.clone())]))
        .map_err(|_| RawFunctionSelectionError::Malformed)?;
    let mut parsed = abi.functions();
    let Some(function) = parsed.next().cloned() else {
        return Err(RawFunctionSelectionError::Malformed);
    };
    if parsed.next().is_some() {
        return Err(RawFunctionSelectionError::Ambiguous);
    }
    let call_kind = if is_read_only_function(&function) {
        "read"
    } else {
        "writeDraft"
    };
    Ok(AbiFunctionSchema {
        name,
        signature: function_signature(&function),
        selector,
        state_mutability: state_mutability_label(&function),
        call_kind: call_kind.to_string(),
        supported: true,
        unsupported_reason: None,
        inputs: function.inputs.iter().map(param_schema).collect(),
        outputs: function.outputs.iter().map(param_schema).collect(),
    })
}

fn param_schema(param: &Param) -> AbiParamSchema {
    param_type_schema(
        &param.kind,
        normalize_optional_string(Some(param.name.clone())),
    )
}

fn param_type_schema(kind: &ParamType, name: Option<String>) -> AbiParamSchema {
    match kind {
        ParamType::Address => leaf_param_schema(name, "address", "address"),
        ParamType::Bytes => leaf_param_schema(name, "bytes", "bytes"),
        ParamType::FixedBytes(size) => {
            leaf_param_schema(name, &format!("bytes{size}"), "fixedBytes")
        }
        ParamType::Int(bits) => leaf_param_schema(name, &format!("int{bits}"), "int"),
        ParamType::Uint(bits) => leaf_param_schema(name, &format!("uint{bits}"), "uint"),
        ParamType::Bool => leaf_param_schema(name, "bool", "bool"),
        ParamType::String => leaf_param_schema(name, "string", "string"),
        ParamType::Array(inner) => AbiParamSchema {
            name,
            type_label: canonical_param_type(kind),
            kind: "array".to_string(),
            array_length: None,
            components: Some(vec![param_type_schema(inner, None)]),
        },
        ParamType::FixedArray(inner, size) => AbiParamSchema {
            name,
            type_label: canonical_param_type(kind),
            kind: "array".to_string(),
            array_length: Some(*size),
            components: Some(vec![param_type_schema(inner, None)]),
        },
        ParamType::Tuple(items) => AbiParamSchema {
            name,
            type_label: canonical_param_type(kind),
            kind: "tuple".to_string(),
            array_length: None,
            components: Some(
                items
                    .iter()
                    .enumerate()
                    .map(|(index, item)| param_type_schema(item, Some(index.to_string())))
                    .collect(),
            ),
        },
    }
}

fn leaf_param_schema(name: Option<String>, type_label: &str, kind: &str) -> AbiParamSchema {
    AbiParamSchema {
        name,
        type_label: type_label.to_string(),
        kind: kind.to_string(),
        array_length: None,
        components: None,
    }
}

fn raw_param_schema_list(
    value: Option<&Value>,
) -> Result<Vec<AbiParamSchema>, RawFunctionSelectionError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Value::Array(items) = value else {
        return Err(RawFunctionSelectionError::Malformed);
    };
    items.iter().map(raw_param_schema).collect()
}

fn raw_param_schema(value: &Value) -> Result<AbiParamSchema, RawFunctionSelectionError> {
    let Value::Object(object) = value else {
        return Err(RawFunctionSelectionError::Malformed);
    };
    let type_label = raw_param_type(value)?;
    let raw_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or(RawFunctionSelectionError::Malformed)?;
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .and_then(|value| normalize_optional_string(Some(value.to_string())));
    let suffix_start = raw_type.find('[').unwrap_or(raw_type.len());
    let base_type = &raw_type[..suffix_start];
    let kind = match base_type {
        "tuple" => "tuple",
        "function" => "unsupported",
        "fixed" | "ufixed" => "unsupported",
        "bytes" if raw_type.len() > suffix_start => "array",
        "bytes" => "bytes",
        value if value.starts_with("fixed") => "unsupported",
        value if value.starts_with("ufixed") => "unsupported",
        value if value.starts_with("bytes") => "fixedBytes",
        value if value.starts_with("uint") => "uint",
        value if value.starts_with("int") => "int",
        other => other,
    };
    let components = if base_type == "tuple" {
        let Value::Array(items) = object
            .get("components")
            .ok_or(RawFunctionSelectionError::Malformed)?
        else {
            return Err(RawFunctionSelectionError::Malformed);
        };
        Some(
            items
                .iter()
                .map(raw_param_schema)
                .collect::<Result<Vec<_>, _>>()?,
        )
    } else {
        None
    };
    Ok(AbiParamSchema {
        name,
        type_label,
        kind: kind.to_string(),
        array_length: None,
        components,
    })
}

fn raw_state_mutability(object: &serde_json::Map<String, Value>) -> String {
    object
        .get("stateMutability")
        .and_then(Value::as_str)
        .unwrap_or("nonpayable")
        .to_string()
}

fn state_mutability_label(function: &Function) -> String {
    match function.state_mutability {
        StateMutability::Pure => "pure",
        StateMutability::View => "view",
        StateMutability::NonPayable => "nonpayable",
        StateMutability::Payable => "payable",
    }
    .to_string()
}

fn raw_param_list(value: Option<&Value>) -> Result<Vec<String>, RawFunctionSelectionError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Value::Array(items) = value else {
        return Err(RawFunctionSelectionError::Malformed);
    };
    items.iter().map(raw_param_type).collect()
}

fn raw_param_type(value: &Value) -> Result<String, RawFunctionSelectionError> {
    let Value::Object(object) = value else {
        return Err(RawFunctionSelectionError::Malformed);
    };
    let raw_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or(RawFunctionSelectionError::Malformed)?;

    if let Some(tuple_suffix) = raw_type.strip_prefix("tuple") {
        let components = object
            .get("components")
            .ok_or(RawFunctionSelectionError::Malformed)?;
        let Value::Array(items) = components else {
            return Err(RawFunctionSelectionError::Malformed);
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

fn raw_params_use_unsupported_type(
    value: Option<&Value>,
) -> Result<bool, RawFunctionSelectionError> {
    let Some(value) = value else {
        return Ok(false);
    };
    let Value::Array(items) = value else {
        return Err(RawFunctionSelectionError::Malformed);
    };
    items.iter().try_fold(false, |found, item| {
        Ok(found || raw_param_uses_unsupported_type(item)?)
    })
}

fn raw_param_uses_unsupported_type(value: &Value) -> Result<bool, RawFunctionSelectionError> {
    let Value::Object(object) = value else {
        return Err(RawFunctionSelectionError::Malformed);
    };
    let raw_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or(RawFunctionSelectionError::Malformed)?;
    let suffix_start = raw_type.find('[').unwrap_or(raw_type.len());
    let base_type = &raw_type[..suffix_start];
    if is_unsupported_raw_base_type(base_type) {
        return Ok(true);
    }
    if base_type != "tuple" {
        return Ok(false);
    }
    let components = object
        .get("components")
        .ok_or(RawFunctionSelectionError::Malformed)?;
    let Value::Array(items) = components else {
        return Err(RawFunctionSelectionError::Malformed);
    };
    items.iter().try_fold(false, |found, item| {
        Ok(found || raw_param_uses_unsupported_type(item)?)
    })
}

fn is_unsupported_raw_base_type(base_type: &str) -> bool {
    base_type == "function"
        || base_type == "fixed"
        || base_type == "ufixed"
        || is_fixed_point_raw_base_type(base_type)
}

fn is_fixed_point_raw_base_type(base_type: &str) -> bool {
    let Some(rest) = base_type
        .strip_prefix("fixed")
        .or_else(|| base_type.strip_prefix("ufixed"))
    else {
        return false;
    };
    let Some((bits, precision)) = rest.split_once('x') else {
        return false;
    };
    !bits.is_empty()
        && !precision.is_empty()
        && bits.chars().all(|ch| ch.is_ascii_digit())
        && precision.chars().all(|ch| ch.is_ascii_digit())
}

#[cfg(test)]
fn select_function_by_signature<'a>(
    abi: &'a Abi,
    signature: &str,
) -> Result<&'a Function, &'static str> {
    let matches = abi
        .functions()
        .filter(|function| function_signature(function) == signature)
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [function] => Ok(*function),
        [] => Err("functionSignatureUnknown"),
        _ => Err("functionSignatureAmbiguous"),
    }
}

#[allow(deprecated)]
fn is_read_only_function(function: &Function) -> bool {
    matches!(
        function.state_mutability,
        StateMutability::View | StateMutability::Pure
    ) || (function.state_mutability == StateMutability::NonPayable
        && function.constant == Some(true))
}

fn function_signature(function: &Function) -> String {
    let inputs = function
        .inputs
        .iter()
        .map(|input| canonical_param_type(&input.kind))
        .collect::<Vec<_>>()
        .join(",");
    format!("{}({inputs})", function.name)
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

fn selector_for_signature(signature: &str) -> String {
    format!("0x{}", hex_lower(&keccak256(signature.as_bytes())[..4]))
}

fn encode_tokens(params: &[Param], values: &[Value]) -> Result<Vec<Token>, String> {
    if params.len() != values.len() {
        return Err(format!(
            "expected {} canonical params, received {}",
            params.len(),
            values.len()
        ));
    }
    params
        .iter()
        .zip(values)
        .map(|(param, value)| token_from_json(value, &param.kind, &param.name))
        .collect()
}

fn token_from_json(value: &Value, kind: &ParamType, label: &str) -> Result<Token, String> {
    match kind {
        ParamType::Address => {
            let raw = strict_scalar_string_value(value, label)?;
            Address::from_str(raw)
                .map(Token::Address)
                .map_err(|_| format!("{label} must be a valid EVM address"))
        }
        ParamType::Bytes => parse_hex_value(value, label).map(Token::Bytes),
        ParamType::FixedBytes(size) => {
            let bytes = parse_hex_value(value, label)?;
            if bytes.len() != *size {
                return Err(format!("{label} must be exactly {size} bytes"));
            }
            Ok(Token::FixedBytes(bytes))
        }
        ParamType::Int(bits) => parse_int_token(value, *bits, label).map(Token::Int),
        ParamType::Uint(bits) => parse_uint_token(value, *bits, label).map(Token::Uint),
        ParamType::Bool => value
            .as_bool()
            .map(Token::Bool)
            .ok_or_else(|| format!("{label} must be a boolean")),
        ParamType::String => {
            string_value(value, label).map(|value| Token::String(value.to_string()))
        }
        ParamType::Array(inner) => {
            let items = array_value(value, label)?;
            items
                .iter()
                .enumerate()
                .map(|(index, item)| token_from_json(item, inner, &format!("{label}[{index}]")))
                .collect::<Result<Vec<_>, _>>()
                .map(Token::Array)
        }
        ParamType::FixedArray(inner, size) => {
            let items = array_value(value, label)?;
            if items.len() != *size {
                return Err(format!("{label} must contain exactly {size} items"));
            }
            items
                .iter()
                .enumerate()
                .map(|(index, item)| token_from_json(item, inner, &format!("{label}[{index}]")))
                .collect::<Result<Vec<_>, _>>()
                .map(Token::FixedArray)
        }
        ParamType::Tuple(items) => {
            let tuple_values = array_value(value, label)?;
            if tuple_values.len() < items.len() {
                return Err(format!(
                    "{label}.{} tuple field missing",
                    tuple_values.len()
                ));
            }
            if tuple_values.len() != items.len() {
                return Err(format!(
                    "{label} must contain exactly {} tuple items",
                    items.len()
                ));
            }
            items
                .iter()
                .zip(tuple_values)
                .enumerate()
                .map(|(index, (kind, item))| {
                    token_from_json(item, kind, &format!("{label}.{index}"))
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Token::Tuple)
        }
    }
}

fn decode_outputs(
    function: &Function,
    bytes: &[u8],
) -> Result<Vec<AbiDecodedValueSummary>, DecodeFailure> {
    if bytes.is_empty() && function.outputs.is_empty() {
        return Ok(Vec::new());
    }
    if bytes.is_empty() {
        return Err(DecodeFailure::new(
            "emptyReturn",
            "emptyReturn",
            "eth_call returned empty data for a function with outputs",
        ));
    }
    if bytes.len() % 32 != 0 {
        return Err(DecodeFailure::new(
            "malformedReturn",
            "malformedReturn",
            format!(
                "eth_call returned {} bytes; ABI data must be 32-byte aligned",
                bytes.len()
            ),
        ));
    }
    let tokens = function.decode_output(bytes).map_err(|error| {
        DecodeFailure::new("abiDecodeError", "abiDecodeError", error.to_string())
    })?;
    Ok(function
        .outputs
        .iter()
        .zip(tokens.iter())
        .map(|(param, token)| summarize_token(token, &param.kind, Some(&param.name)))
        .collect())
}

#[derive(Debug, Clone)]
struct DecodeFailure {
    status: &'static str,
    reason: &'static str,
    message: String,
}

impl DecodeFailure {
    fn new(
        status: &'static str,
        reason: &'static str,
        message: impl Into<String>,
    ) -> DecodeFailure {
        DecodeFailure {
            status,
            reason,
            message: message.into(),
        }
    }
}

fn summarize_token(token: &Token, kind: &ParamType, name: Option<&str>) -> AbiDecodedValueSummary {
    let type_label = canonical_param_type(kind);
    match (token, kind) {
        (Token::Address(address), ParamType::Address) => scalar_summary(
            "address",
            type_label,
            Some(to_checksum(address, None)),
            false,
        ),
        (Token::Bool(value), ParamType::Bool) => {
            scalar_summary("bool", type_label, Some(value.to_string()), false)
        }
        (Token::String(value), ParamType::String) => {
            let (value, truncated) = truncate_chars(value, MAX_SUMMARY_STRING_CHARS);
            scalar_summary("string", type_label, Some(value), truncated)
        }
        (Token::Uint(value), ParamType::Uint(_)) => {
            scalar_summary("uint", type_label, Some(value.to_string()), false)
        }
        (Token::Int(value), ParamType::Int(bits)) => scalar_summary(
            "int",
            type_label,
            Some(format_signed_int(*value, *bits)),
            false,
        ),
        (Token::Bytes(bytes), ParamType::Bytes)
        | (Token::FixedBytes(bytes), ParamType::FixedBytes(_)) => {
            bytes_summary("bytes", type_label, bytes)
        }
        (Token::Array(items), ParamType::Array(inner)) => {
            array_summary("array", type_label, items, inner)
        }
        (Token::FixedArray(items), ParamType::FixedArray(inner, _)) => {
            array_summary("array", type_label, items, inner)
        }
        (Token::Tuple(items), ParamType::Tuple(kinds)) => {
            let fields = items
                .iter()
                .zip(kinds.iter())
                .take(MAX_SUMMARY_ITEMS)
                .enumerate()
                .map(|(index, (item, kind))| AbiDecodedFieldSummary {
                    name: Some(format!(
                        "{}{}",
                        name.filter(|value| !value.is_empty()).unwrap_or("item"),
                        if kinds.len() == 1 {
                            "".to_string()
                        } else {
                            format!("[{index}]")
                        }
                    )),
                    value: summarize_token(item, kind, None),
                })
                .collect::<Vec<_>>();
            AbiDecodedValueSummary {
                kind: "tuple".to_string(),
                type_label,
                value: None,
                byte_length: None,
                hash: None,
                items: None,
                fields: Some(fields),
                truncated: items.len() > MAX_SUMMARY_ITEMS,
            }
        }
        _ => scalar_summary(
            "unknown",
            type_label,
            Some("[unprintable]".to_string()),
            false,
        ),
    }
}

fn scalar_summary(
    kind: &str,
    type_label: String,
    value: Option<String>,
    truncated: bool,
) -> AbiDecodedValueSummary {
    AbiDecodedValueSummary {
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

fn bytes_summary(kind: &str, type_label: String, bytes: &[u8]) -> AbiDecodedValueSummary {
    AbiDecodedValueSummary {
        kind: kind.to_string(),
        type_label,
        value: None,
        byte_length: Some(bytes.len()),
        hash: Some(format!("0x{}", hex_lower(&keccak256(bytes)))),
        items: None,
        fields: None,
        truncated: false,
    }
}

fn array_summary(
    kind: &str,
    type_label: String,
    items: &[Token],
    inner: &ParamType,
) -> AbiDecodedValueSummary {
    AbiDecodedValueSummary {
        kind: kind.to_string(),
        type_label,
        value: None,
        byte_length: None,
        hash: None,
        items: Some(
            items
                .iter()
                .take(MAX_SUMMARY_ITEMS)
                .map(|item| summarize_token(item, inner, None))
                .collect(),
        ),
        fields: None,
        truncated: items.len() > MAX_SUMMARY_ITEMS,
    }
}

fn parse_uint_token(value: &Value, bits: usize, label: &str) -> Result<U256, String> {
    if bits == 0 || bits > 256 {
        return Err(format!("{label} has unsupported uint bit width"));
    }
    let parsed = parse_u256_value(value, label)?;
    if bits < 256 && parsed >= (U256::one() << bits) {
        return Err(format!("{label} exceeds uint{bits} range"));
    }
    Ok(parsed)
}

fn parse_int_token(value: &Value, bits: usize, label: &str) -> Result<U256, String> {
    if bits == 0 || bits > 256 {
        return Err(format!("{label} has unsupported int bit width"));
    }
    let raw = match value {
        Value::String(value) => strict_scalar_string_text(value, label)?.to_string(),
        Value::Number(number) if number.is_i64() => {
            let value = number.as_i64().unwrap_or_default();
            if value.unsigned_abs() > MAX_SAFE_JSON_INTEGER {
                return Err(format!("{label} JSON integer exceeds safe integer range"));
            }
            number.to_string()
        }
        Value::Number(number) if number.is_u64() => {
            let value = number.as_u64().unwrap_or_default();
            if value > MAX_SAFE_JSON_INTEGER {
                return Err(format!("{label} JSON integer exceeds safe integer range"));
            }
            number.to_string()
        }
        _ => {
            return Err(format!(
                "{label} must be an integer string or safe JSON integer"
            ))
        }
    };
    let negative = raw.starts_with('-');
    let digits = raw.strip_prefix('-').unwrap_or(raw.as_str());
    if digits.is_empty() || digits.starts_with('+') {
        return Err(format!("{label} must be a decimal integer"));
    }
    let magnitude = parse_u256_decimal_or_hex(digits, label)?;
    let max_positive = (U256::one() << (bits - 1)) - U256::one();
    let max_negative_magnitude = U256::one() << (bits - 1);
    if negative {
        if magnitude > max_negative_magnitude {
            return Err(format!("{label} is below int{bits} range"));
        }
        if magnitude.is_zero() {
            return Ok(U256::zero());
        }
        Ok(!magnitude + U256::one())
    } else {
        if magnitude > max_positive {
            return Err(format!("{label} exceeds int{bits} range"));
        }
        Ok(magnitude)
    }
}

fn parse_u256_value(value: &Value, label: &str) -> Result<U256, String> {
    match value {
        Value::String(value) => {
            parse_u256_decimal_or_hex(strict_scalar_string_text(value, label)?, label)
        }
        Value::Number(number) if number.is_u64() => {
            let value = number.as_u64().unwrap_or_default();
            if value > MAX_SAFE_JSON_INTEGER {
                return Err(format!("{label} JSON integer exceeds safe integer range"));
            }
            U256::from_dec_str(&number.to_string()).map_err(|_| format!("{label} is invalid"))
        }
        _ => Err(format!(
            "{label} must be an unsigned integer string or safe JSON integer"
        )),
    }
}

fn parse_u256_decimal_or_hex(value: &str, label: &str) -> Result<U256, String> {
    if value.is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    if let Some(hex) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        if hex.is_empty() || !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
            return Err(format!("{label} must be valid hex"));
        }
        U256::from_str_radix(hex, 16).map_err(|_| format!("{label} is out of range"))
    } else {
        if !value.chars().all(|ch| ch.is_ascii_digit()) {
            return Err(format!("{label} must be a decimal integer"));
        }
        U256::from_dec_str(value).map_err(|_| format!("{label} is out of range"))
    }
}

fn parse_hex_value(value: &Value, label: &str) -> Result<Vec<u8>, String> {
    let raw = strict_scalar_string_value(value, label)?;
    let Some(hex) = raw.strip_prefix("0x").or_else(|| raw.strip_prefix("0X")) else {
        return Err(format!("{label} must be a 0x-prefixed hex string"));
    };
    if hex.len() % 2 != 0 || !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(format!(
            "{label} must contain an even number of hex characters"
        ));
    }
    (0..hex.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&hex[index..index + 2], 16)
                .map_err(|_| format!("{label} contains invalid hex"))
        })
        .collect()
}

fn string_value<'a>(value: &'a Value, label: &str) -> Result<&'a str, String> {
    value
        .as_str()
        .ok_or_else(|| format!("{label} must be a string"))
}

fn strict_scalar_string_value<'a>(value: &'a Value, label: &str) -> Result<&'a str, String> {
    strict_scalar_string_text(string_value(value, label)?, label)
}

fn strict_scalar_string_text<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    if value.trim() != value {
        return Err(format!(
            "{label} must not include leading or trailing whitespace"
        ));
    }
    Ok(value)
}

fn array_value<'a>(value: &'a Value, label: &str) -> Result<&'a [Value], String> {
    value
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| format!("{label} must be an array"))
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

fn calldata_summary(calldata: &[u8]) -> AbiCallDataSummary {
    AbiCallDataSummary {
        byte_length: calldata.len(),
        hash: format!("0x{}", hex_lower(&keccak256(calldata))),
    }
}

fn classify_rpc_call_error(error: &ProviderError) -> (&'static str, &'static str) {
    if let Some(error) = RpcError::as_error_response(error) {
        return classify_json_rpc_call_error(error);
    }
    ("rpcFailure", "ethCallFailed")
}

fn classify_json_rpc_call_error(error: &JsonRpcError) -> (&'static str, &'static str) {
    if json_rpc_error_has_revert_data(error) || has_concrete_revert_message(&error.message) {
        ("reverted", "revertData")
    } else {
        ("rpcFailure", "ethCallFailed")
    }
}

fn json_rpc_error_has_revert_data(error: &JsonRpcError) -> bool {
    error
        .data
        .as_ref()
        .map(json_value_has_revert_data)
        .unwrap_or(false)
}

fn json_value_has_revert_data(value: &Value) -> bool {
    match value {
        Value::String(value) => is_hex_revert_data(value),
        Value::Array(items) => items.iter().any(json_value_has_revert_data),
        Value::Object(object) => object.values().any(json_value_has_revert_data),
        _ => false,
    }
}

fn is_hex_revert_data(value: &str) -> bool {
    let Some(hex) = value
        .trim()
        .strip_prefix("0x")
        .or_else(|| value.trim().strip_prefix("0X"))
    else {
        return false;
    };
    hex.len() >= 8 && hex.len() % 2 == 0 && hex.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn has_concrete_revert_message(message: &str) -> bool {
    let lower = message.trim().to_ascii_lowercase();
    lower.starts_with("execution reverted")
        || lower.starts_with("reverted")
        || lower.starts_with("vm execution error")
}

#[derive(Debug, Clone, Copy)]
enum RpcTimeoutStage {
    ChainIdProbe,
    EthCall,
}

fn timeout_result(
    input: &NormalizedInput,
    rpc_identity: String,
    selector: Option<String>,
    calldata: Option<AbiCallDataSummary>,
    actual_chain_id: Option<u64>,
    stage: RpcTimeoutStage,
) -> AbiReadCallResult {
    let (reason, message) = match stage {
        RpcTimeoutStage::ChainIdProbe => (
            "chainIdProbeTimedOut",
            "RPC chainId probe timed out before read call",
        ),
        RpcTimeoutStage::EthCall => ("ethCallTimedOut", "eth_call timed out"),
    };
    let mut builder = base_result(input, rpc_identity)
        .status("timeout")
        .reason(reason)
        .error(message);
    if let Some(selector) = selector {
        builder = builder.selector(selector);
    }
    if let Some(calldata) = calldata {
        builder = builder.calldata(calldata);
    }
    if let Some(actual_chain_id) = actual_chain_id {
        builder = builder.actual_chain_id(actual_chain_id);
    }
    builder.finish()
}

#[derive(Debug, Clone)]
struct ResultBuilder {
    result: AbiReadCallResult,
}

impl ResultBuilder {
    fn status(mut self, status: &str) -> Self {
        self.result.status = status.to_string();
        self
    }

    fn reason(mut self, reason: impl Into<String>) -> Self {
        self.result.reasons.push(reason.into());
        self.result.reasons = dedupe(self.result.reasons);
        self
    }

    fn error(mut self, error: impl AsRef<str>) -> Self {
        self.result.error_summary = Some(sanitize_diagnostic_message(error.as_ref()));
        self
    }

    fn selector(mut self, selector: String) -> Self {
        self.result.selector = Some(selector);
        self
    }

    fn calldata(mut self, calldata: AbiCallDataSummary) -> Self {
        self.result.calldata = Some(calldata);
        self
    }

    fn outputs(mut self, outputs: Vec<AbiDecodedValueSummary>) -> Self {
        self.result.outputs = outputs;
        self
    }

    fn actual_chain_id(mut self, actual_chain_id: u64) -> Self {
        self.result.rpc.actual_chain_id = Some(actual_chain_id);
        self
    }

    fn finish(mut self) -> AbiReadCallResult {
        self.result.reasons = dedupe(self.result.reasons);
        self.result
    }
}

#[derive(Debug, Clone)]
struct CatalogResultBuilder {
    result: AbiFunctionCatalogResult,
}

impl CatalogResultBuilder {
    fn status(mut self, status: &str) -> Self {
        self.result.status = status.to_string();
        self
    }

    fn reason(mut self, reason: impl Into<String>) -> Self {
        self.result.reasons.push(reason.into());
        self.result.reasons = dedupe(self.result.reasons);
        self
    }

    fn error(mut self, error: impl AsRef<str>) -> Self {
        self.result.error_summary = Some(sanitize_diagnostic_message(error.as_ref()));
        self
    }

    fn functions(mut self, functions: Vec<AbiFunctionSchema>) -> Self {
        self.result.functions = functions;
        self
    }

    fn unsupported_item_count(mut self, count: usize) -> Self {
        self.result.unsupported_item_count = count;
        self
    }

    fn finish(mut self) -> AbiFunctionCatalogResult {
        self.result.reasons = dedupe(self.result.reasons);
        self.result
    }
}

#[derive(Debug, Clone)]
struct PreviewResultBuilder {
    result: AbiCalldataPreviewResult,
}

impl PreviewResultBuilder {
    fn status(mut self, status: &str) -> Self {
        self.result.status = status.to_string();
        self
    }

    fn reason(mut self, reason: impl Into<String>) -> Self {
        self.result.reasons.push(reason.into());
        self.result.reasons = dedupe(self.result.reasons);
        self
    }

    fn error(mut self, error: impl AsRef<str>) -> Self {
        self.result.error_summary = Some(sanitize_diagnostic_message(error.as_ref()));
        self
    }

    fn selector(mut self, selector: String) -> Self {
        self.result.selector = Some(selector);
        self
    }

    fn calldata(mut self, calldata: AbiCallDataSummary) -> Self {
        self.result.calldata = Some(calldata);
        self
    }

    fn parameter_summary(mut self, summary: Vec<AbiDecodedValueSummary>) -> Self {
        self.result.parameter_summary = summary;
        self
    }

    fn finish(mut self) -> AbiCalldataPreviewResult {
        self.result.reasons = dedupe(self.result.reasons);
        self.result
    }
}

fn base_result(input: &NormalizedInput, rpc_identity: String) -> ResultBuilder {
    ResultBuilder {
        result: AbiReadCallResult {
            status: "blocked".to_string(),
            reasons: Vec::new(),
            function_signature: input.function_signature.clone(),
            selector: None,
            contract_address: if input.contract == Address::zero() {
                normalize_optional_string(Some(input.contract_address.clone()))
            } else {
                Some(to_checksum(&input.contract, None))
            },
            from: input.from.clone(),
            source_kind: input.source_kind.clone(),
            provider_config_id: input.provider_config_id.clone(),
            user_source_id: input.user_source_id.clone(),
            version_id: input.version_id.clone(),
            abi_hash: input.abi_hash.clone(),
            source_fingerprint: input.source_fingerprint.clone(),
            calldata: None,
            outputs: Vec::new(),
            rpc: AbiReadRpcSummary {
                endpoint: rpc_identity,
                expected_chain_id: if input.chain_id == 0 {
                    None
                } else {
                    Some(input.chain_id)
                },
                actual_chain_id: None,
            },
            error_summary: None,
        },
    }
}

fn catalog_result(input: &NormalizedManagedEntry) -> CatalogResultBuilder {
    CatalogResultBuilder {
        result: AbiFunctionCatalogResult {
            status: "blocked".to_string(),
            reasons: Vec::new(),
            contract_address: if input.contract == Address::zero() {
                normalize_optional_string(Some(input.contract_address.clone()))
            } else {
                Some(to_checksum(&input.contract, None))
            },
            source_kind: input.source_kind.clone(),
            provider_config_id: input.provider_config_id.clone(),
            user_source_id: input.user_source_id.clone(),
            version_id: input.version_id.clone(),
            abi_hash: input.abi_hash.clone(),
            source_fingerprint: input.source_fingerprint.clone(),
            functions: Vec::new(),
            unsupported_item_count: 0,
            error_summary: None,
        },
    }
}

fn preview_result(input: &NormalizedPreviewInput) -> PreviewResultBuilder {
    PreviewResultBuilder {
        result: AbiCalldataPreviewResult {
            status: "blocked".to_string(),
            reasons: Vec::new(),
            function_signature: input.function_signature.clone(),
            selector: None,
            contract_address: if input.entry.contract == Address::zero() {
                normalize_optional_string(Some(input.entry.contract_address.clone()))
            } else {
                Some(to_checksum(&input.entry.contract, None))
            },
            source_kind: input.entry.source_kind.clone(),
            provider_config_id: input.entry.provider_config_id.clone(),
            user_source_id: input.entry.user_source_id.clone(),
            version_id: input.entry.version_id.clone(),
            abi_hash: input.entry.abi_hash.clone(),
            source_fingerprint: input.entry.source_fingerprint.clone(),
            parameter_summary: Vec::new(),
            calldata: None,
            error_summary: None,
        },
    }
}

fn preview_from_catalog_block(
    input: &NormalizedPreviewInput,
    catalog: AbiFunctionCatalogResult,
) -> AbiCalldataPreviewResult {
    let mut builder = preview_result(input).status(&catalog.status);
    for reason in catalog.reasons {
        builder = builder.reason(reason);
    }
    if let Some(error) = catalog.error_summary {
        builder = builder.error(error);
    }
    builder.finish()
}

trait WithRpcSummary {
    fn with_rpc(
        self,
        endpoint: String,
        expected_chain_id: Option<u64>,
        actual_chain_id: Option<u64>,
    ) -> Self;
}

impl WithRpcSummary for AbiReadCallResult {
    fn with_rpc(
        mut self,
        endpoint: String,
        expected_chain_id: Option<u64>,
        actual_chain_id: Option<u64>,
    ) -> Self {
        self.rpc.endpoint = endpoint;
        self.rpc.expected_chain_id = expected_chain_id;
        self.rpc.actual_chain_id = actual_chain_id;
        self
    }
}

fn parse_address(value: &str, label: &str) -> Result<Address, String> {
    Address::from_str(value.trim()).map_err(|_| format!("{label} must be a valid EVM address"))
}

fn optional_eq(left: Option<&str>, right: Option<&str>) -> bool {
    left.unwrap_or_default() == right.unwrap_or_default()
}

fn normalize_address_key(address: &str) -> String {
    address.trim().to_ascii_lowercase()
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_hash_like(value: &str) -> String {
    let trimmed = value.trim();
    if let Some(rest) = trimmed.strip_prefix("0X") {
        format!("0x{}", rest.to_ascii_lowercase())
    } else {
        trimmed.to_ascii_lowercase()
    }
}

fn is_hash_like(value: &str) -> bool {
    let Some(hex) = value.strip_prefix("0x") else {
        return false;
    };
    hex.len() == 64 && hex.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn hash_text(value: &str) -> String {
    format!("0x{}", hex_lower(&keccak256(value.as_bytes())))
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

    format!("{scheme}://{authority}")
}

fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
    let mut iter = value.chars();
    let truncated = value.chars().count() > max_chars;
    let output = iter.by_ref().take(max_chars).collect::<String>();
    (output, truncated)
}

fn dedupe(values: Vec<String>) -> Vec<String> {
    let mut output = Vec::new();
    for value in values {
        if !output.iter().any(|item| item == &value) {
            output.push(value);
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    use ethers::abi::encode;
    use serde_json::json;
    use serde_json::Map;

    fn abi_with_functions(functions: Vec<Function>) -> Abi {
        let mut by_name = BTreeMap::new();
        for function in functions {
            by_name
                .entry(function.name.clone())
                .or_insert_with(Vec::new)
                .push(function);
        }
        Abi {
            functions: by_name,
            ..Abi::default()
        }
    }

    #[allow(deprecated)]
    fn abi_function(
        name: &str,
        inputs: Vec<Param>,
        outputs: Vec<Param>,
        state_mutability: StateMutability,
        constant: Option<bool>,
    ) -> Function {
        Function {
            name: name.to_string(),
            inputs,
            outputs,
            constant,
            state_mutability,
        }
    }

    fn view_function(name: &str, inputs: Vec<Param>, outputs: Vec<Param>) -> Function {
        abi_function(name, inputs, outputs, StateMutability::View, None)
    }

    fn param(name: &str, kind: ParamType) -> Param {
        Param {
            name: name.to_string(),
            kind,
            internal_type: None,
        }
    }

    fn object_value(fields: Vec<(&str, Value)>) -> Value {
        let mut object = Map::new();
        for (key, value) in fields {
            object.insert(key.to_string(), value);
        }
        Value::Object(object)
    }

    fn raw_abi(functions: Vec<Value>) -> Value {
        Value::Array(functions)
    }

    fn raw_function_item(name: &str, inputs: Vec<Value>, outputs: Vec<Value>) -> Value {
        object_value(vec![
            ("type", Value::String("function".to_string())),
            ("name", Value::String(name.to_string())),
            ("inputs", Value::Array(inputs)),
            ("outputs", Value::Array(outputs)),
        ])
    }

    fn raw_param_item(raw_type: &str) -> Value {
        object_value(vec![
            ("name", Value::String(String::new())),
            ("type", Value::String(raw_type.to_string())),
        ])
    }

    fn raw_named_param_item(name: &str, raw_type: &str) -> Value {
        object_value(vec![
            ("name", Value::String(name.to_string())),
            ("type", Value::String(raw_type.to_string())),
        ])
    }

    fn raw_tuple_param(components: Vec<Value>) -> Value {
        object_value(vec![
            ("name", Value::String(String::new())),
            ("type", Value::String("tuple".to_string())),
            ("components", Value::Array(components)),
        ])
    }

    fn normalized_test_input() -> NormalizedInput {
        NormalizedInput {
            chain_id: 1,
            rpc_url: "https://rpc.example.invalid/path".to_string(),
            contract_address: "0x1111111111111111111111111111111111111111".to_string(),
            contract: Address::from_str("0x1111111111111111111111111111111111111111").unwrap(),
            source_kind: "explorerFetched".to_string(),
            provider_config_id: Some("provider".to_string()),
            user_source_id: None,
            version_id: "version".to_string(),
            abi_hash: "0x2222222222222222222222222222222222222222222222222222222222222222"
                .to_string(),
            source_fingerprint:
                "0x3333333333333333333333333333333333333333333333333333333333333333".to_string(),
            function_signature: "balanceOf(address)".to_string(),
            canonical_params: Vec::new(),
            from: None,
            from_address: None,
        }
    }

    fn selected_entry(overrides: impl FnOnce(&mut AbiCacheEntryRecord)) -> AbiCacheEntryRecord {
        let mut entry = AbiCacheEntryRecord {
            chain_id: 1,
            contract_address: "0x1111111111111111111111111111111111111111".to_string(),
            source_kind: "explorerFetched".to_string(),
            provider_config_id: Some("etherscan-mainnet".to_string()),
            user_source_id: None,
            version_id: "abi-version".to_string(),
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
            event_count: Some(0),
            error_count: Some(0),
            selector_summary: None,
            fetched_at: None,
            imported_at: None,
            last_validated_at: None,
            stale_after: None,
            last_error_summary: None,
            provider_proxy_hint: None,
            proxy_detected: false,
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
        };
        overrides(&mut entry);
        entry
    }

    #[test]
    fn selects_overloaded_functions_by_full_signature() {
        let abi = abi_with_functions(vec![
            view_function(
                "lookup",
                vec![param("id", ParamType::Uint(256))],
                vec![param("", ParamType::Uint(256))],
            ),
            view_function(
                "lookup",
                vec![param("owner", ParamType::Address)],
                vec![param("", ParamType::Address)],
            ),
        ]);

        let uint_function = select_function_by_signature(&abi, "lookup(uint256)").unwrap();
        let address_function = select_function_by_signature(&abi, "lookup(address)").unwrap();

        assert_eq!(function_signature(uint_function), "lookup(uint256)");
        assert_eq!(function_signature(address_function), "lookup(address)");
        assert_eq!(selector_for_signature("lookup(uint256)").len(), 10);
        assert_eq!(
            select_function_by_signature(&abi, "lookup").unwrap_err(),
            "functionSignatureUnknown"
        );
    }

    #[test]
    fn function_catalog_preserves_overload_signatures_and_blocks_unsupported_items() {
        let abi = raw_abi(vec![
            raw_function_item(
                "lookup",
                vec![raw_named_param_item("id", "uint256")],
                Vec::new(),
            ),
            raw_function_item(
                "lookup",
                vec![raw_named_param_item("owner", "address")],
                Vec::new(),
            ),
            raw_function_item("callback", vec![raw_param_item("function")], Vec::new()),
            object_value(vec![("type", Value::String("constructor".to_string()))]),
            object_value(vec![("type", Value::String("fallback".to_string()))]),
        ]);

        let (functions, unsupported_count) = function_catalog_from_raw_abi(&abi).unwrap();

        assert_eq!(unsupported_count, 3);
        assert!(functions
            .iter()
            .any(|function| function.signature == "lookup(uint256)"));
        assert!(functions
            .iter()
            .any(|function| function.signature == "lookup(address)"));
        let callback = functions
            .iter()
            .find(|function| function.signature == "callback(function)")
            .unwrap();
        assert!(!callback.supported);
        assert_eq!(
            callback.unsupported_reason.as_deref(),
            Some("unsupportedFunctionType")
        );
    }

    #[test]
    fn fixed_point_function_params_are_explicitly_unsupported_not_malformed() {
        let abi = raw_abi(vec![
            raw_function_item("legacyFixed", vec![raw_param_item("fixed")], Vec::new()),
            raw_function_item(
                "preciseFixed",
                vec![raw_param_item("fixed128x18")],
                Vec::new(),
            ),
            raw_function_item(
                "preciseUfixed",
                vec![raw_param_item("ufixed64x10")],
                Vec::new(),
            ),
            raw_function_item("fixedArray", vec![raw_param_item("ufixed[2]")], Vec::new()),
            raw_function_item(
                "nestedFixed",
                vec![raw_tuple_param(vec![raw_param_item("fixed32x4")])],
                Vec::new(),
            ),
            raw_function_item(
                "returnsFixed",
                Vec::new(),
                vec![raw_param_item("ufixed128x18")],
            ),
        ]);

        for signature in [
            "legacyFixed(fixed128x18)",
            "preciseFixed(fixed128x18)",
            "preciseUfixed(ufixed64x10)",
            "fixedArray(ufixed128x18[2])",
            "nestedFixed((fixed32x4))",
            "returnsFixed()",
        ] {
            assert!(
                matches!(
                    select_raw_function_by_signature(&abi, signature).unwrap(),
                    RawFunctionSelection::UnsupportedFunctionType
                ),
                "{signature} should be explicitly unsupported"
            );
        }

        let (functions, unsupported_count) = function_catalog_from_raw_abi(&abi).unwrap();

        assert_eq!(unsupported_count, 6);
        assert!(functions.iter().all(|function| {
            !function.supported
                && function.unsupported_reason.as_deref() == Some("unsupportedFunctionType")
        }));
        assert!(functions
            .iter()
            .any(|function| function.signature == "legacyFixed(fixed128x18)"));
        assert!(functions
            .iter()
            .any(|function| function.signature == "nestedFixed((fixed32x4))"));
    }

    #[test]
    fn legacy_constant_functions_are_read_only_conservatively() {
        let legacy_constant = abi_function(
            "legacy",
            Vec::new(),
            vec![param("", ParamType::Uint(256))],
            StateMutability::NonPayable,
            Some(true),
        );
        let mutable_default = abi_function(
            "mutableDefault",
            Vec::new(),
            Vec::new(),
            StateMutability::NonPayable,
            None,
        );
        let contradictory_payable = abi_function(
            "payableLegacy",
            Vec::new(),
            Vec::new(),
            StateMutability::Payable,
            Some(true),
        );

        assert!(is_read_only_function(&legacy_constant));
        assert!(!is_read_only_function(&mutable_default));
        assert!(!is_read_only_function(&contradictory_payable));
    }

    #[test]
    fn raw_function_abi_type_is_blocked_before_ethabi_fallback_selection() {
        let abi = raw_abi(vec![
            raw_function_item("callback", vec![raw_param_item("function")], Vec::new()),
            raw_function_item("safeUint", vec![raw_param_item("uint8")], Vec::new()),
            raw_function_item(
                "returnsCallback",
                Vec::new(),
                vec![raw_param_item("function")],
            ),
            raw_function_item(
                "nested",
                vec![raw_tuple_param(vec![raw_param_item("function")])],
                Vec::new(),
            ),
        ]);

        assert!(matches!(
            select_raw_function_by_signature(&abi, "callback(function)").unwrap(),
            RawFunctionSelection::UnsupportedFunctionType
        ));
        assert!(matches!(
            select_raw_function_by_signature(&abi, "returnsCallback()").unwrap(),
            RawFunctionSelection::UnsupportedFunctionType
        ));
        assert!(matches!(
            select_raw_function_by_signature(&abi, "nested((function))").unwrap(),
            RawFunctionSelection::UnsupportedFunctionType
        ));
        assert!(matches!(
            select_raw_function_by_signature(&abi, "callback(uint8)").unwrap_err(),
            RawFunctionSelectionError::Unknown
        ));

        let safe_uint = select_raw_function_by_signature(&abi, "safeUint(uint8)").unwrap();
        let RawFunctionSelection::Callable(function) = safe_uint else {
            panic!("safe uint8 overload should remain callable");
        };
        assert_eq!(function_signature(&function), "safeUint(uint8)");
    }

    #[test]
    fn function_type_overload_does_not_poison_exact_uint8_overload() {
        let abi = raw_abi(vec![
            raw_function_item("foo", vec![raw_param_item("function")], Vec::new()),
            raw_function_item("foo", vec![raw_param_item("uint8")], Vec::new()),
        ]);

        let selected = select_raw_function_by_signature(&abi, "foo(uint8)").unwrap();
        let RawFunctionSelection::Callable(function) = selected else {
            panic!("exact uint8 overload should remain callable");
        };

        assert_eq!(function_signature(&function), "foo(uint8)");
        assert!(matches!(
            select_raw_function_by_signature(&abi, "foo(function)").unwrap(),
            RawFunctionSelection::UnsupportedFunctionType
        ));
    }

    #[test]
    fn artifact_read_error_summaries_are_path_neutral() {
        let not_found =
            std::io::Error::new(ErrorKind::NotFound, "/tmp/app/abi-artifacts/hash.json");
        let denied = std::io::Error::new(ErrorKind::PermissionDenied, "/tmp/private/hash.json");

        assert_eq!(
            artifact_read_error_summary(&not_found),
            "ABI artifact not found"
        );
        assert_eq!(
            artifact_read_error_summary(&denied),
            "ABI artifact is not readable"
        );
    }

    #[test]
    fn selector_conflict_blocks_read_calls() {
        let entry = selected_entry(|entry| {
            entry.selected = false;
            entry.validation_status = "selectorConflict".to_string();
            entry.selection_status = "needsUserChoice".to_string();
        });

        let reasons = non_callable_entry_reasons(&entry);

        assert_eq!(
            reasons,
            vec![
                "notSelected".to_string(),
                "selectorConflict".to_string(),
                "needsUserChoice".to_string()
            ]
        );
        assert_eq!(blocked_status_for_reasons(&reasons), "blocked");
    }

    #[test]
    fn cache_refresh_states_map_to_loading_or_recoverable_blocked() {
        let refreshing = non_callable_entry_reasons(&selected_entry(|entry| {
            entry.cache_status = "refreshing".to_string();
        }));
        assert_eq!(blocked_status_for_reasons(&refreshing), "loading");

        let refresh_failed = non_callable_entry_reasons(&selected_entry(|entry| {
            entry.cache_status = "refreshFailed".to_string();
        }));
        assert_eq!(
            blocked_status_for_reasons(&refresh_failed),
            "recoverableBlocked"
        );
    }

    #[test]
    fn encodes_tuple_arrays_and_summarizes_nested_tuple_outputs() {
        let position_key = ParamType::Tuple(vec![
            ParamType::Address,
            ParamType::Array(Box::new(ParamType::Uint(256))),
        ]);
        let position_item = ParamType::Tuple(vec![
            ParamType::Address,
            ParamType::Tuple(vec![ParamType::Bool, ParamType::String]),
        ]);
        let abi = abi_with_functions(vec![view_function(
            "positions",
            vec![param("keys", ParamType::Array(Box::new(position_key)))],
            vec![param("items", ParamType::Array(Box::new(position_item)))],
        )]);
        let function =
            select_function_by_signature(&abi, "positions((address,uint256[])[])").unwrap();
        let tokens = encode_tokens(
            &function.inputs,
            &[json!([[
                "0x1111111111111111111111111111111111111111",
                ["1", "2"]
            ]])],
        )
        .unwrap();
        assert!(function.encode_input(&tokens).unwrap().len() > 4);

        let output_token = Token::Array(vec![Token::Tuple(vec![
            Token::Address(
                Address::from_str("0x1111111111111111111111111111111111111111").unwrap(),
            ),
            Token::Tuple(vec![Token::Bool(true), Token::String("ready".to_string())]),
        ])]);
        let encoded = encode(&[output_token]);
        let summaries = decode_outputs(function, &encoded).unwrap();

        assert_eq!(summaries[0].kind, "array");
        let first = summaries[0].items.as_ref().unwrap()[0].clone();
        assert_eq!(first.kind, "tuple");
        let fields = first.fields.unwrap();
        assert_eq!(fields[0].value.kind, "address");
        assert_eq!(fields[1].value.kind, "tuple");
    }

    #[test]
    fn param_validation_errors_are_explicit_and_field_scoped() {
        let params = vec![
            param("owner", ParamType::Address),
            param("amount", ParamType::Uint(8)),
            param("tag", ParamType::FixedBytes(4)),
            param(
                "ids",
                ParamType::FixedArray(Box::new(ParamType::Uint(256)), 2),
            ),
            param(
                "config",
                ParamType::Tuple(vec![ParamType::Address, ParamType::Bool]),
            ),
        ];

        let malformed_address =
            encode_tokens(&[params[0].clone()], &[json!("0xnot-an-address")]).unwrap_err();
        assert_eq!(malformed_address, "owner must be a valid EVM address");

        let out_of_bounds = encode_tokens(&[params[1].clone()], &[json!("256")]).unwrap_err();
        assert_eq!(out_of_bounds, "amount exceeds uint8 range");

        let bytes_mismatch = encode_tokens(&[params[2].clone()], &[json!("0x010203")]).unwrap_err();
        assert_eq!(bytes_mismatch, "tag must be exactly 4 bytes");

        let array_mismatch = encode_tokens(&[params[3].clone()], &[json!(["1"])]).unwrap_err();
        assert_eq!(array_mismatch, "ids must contain exactly 2 items");

        let tuple_missing = encode_tokens(
            &[params[4].clone()],
            &[json!(["0x1111111111111111111111111111111111111111"])],
        )
        .unwrap_err();
        assert_eq!(tuple_missing, "config.1 tuple field missing");
    }

    #[test]
    fn strict_scalar_params_reject_padding_but_string_preserves_whitespace() {
        let address_error = encode_tokens(
            &[param("owner", ParamType::Address)],
            &[json!(" 0x1111111111111111111111111111111111111111 ")],
        )
        .unwrap_err();
        assert_eq!(
            address_error,
            "owner must not include leading or trailing whitespace"
        );

        let uint_error =
            encode_tokens(&[param("amount", ParamType::Uint(256))], &[json!(" 1 ")]).unwrap_err();
        assert_eq!(
            uint_error,
            "amount must not include leading or trailing whitespace"
        );

        let bytes_error =
            encode_tokens(&[param("data", ParamType::Bytes)], &[json!(" 0x0102 ")]).unwrap_err();
        assert_eq!(
            bytes_error,
            "data must not include leading or trailing whitespace"
        );

        let tokens =
            encode_tokens(&[param("memo", ParamType::String)], &[json!("  keep me  ")]).unwrap();
        assert_eq!(tokens, vec![Token::String("  keep me  ".to_string())]);
    }

    #[test]
    fn summaries_bound_large_payloads_without_raw_bytes() {
        let long_string = "x".repeat(MAX_SUMMARY_STRING_CHARS + 20);
        let string_summary = summarize_token(
            &Token::String(long_string.clone()),
            &ParamType::String,
            Some("memo"),
        );
        assert!(string_summary.truncated);
        assert_eq!(
            string_summary.value.as_ref().unwrap().chars().count(),
            MAX_SUMMARY_STRING_CHARS
        );

        let bytes = vec![0xab; 512];
        let bytes_summary = summarize_token(&Token::Bytes(bytes), &ParamType::Bytes, Some("blob"));
        assert_eq!(bytes_summary.byte_length, Some(512));
        assert!(bytes_summary.hash.as_ref().unwrap().starts_with("0x"));
        assert!(bytes_summary.value.is_none());

        let items = (0..(MAX_SUMMARY_ITEMS + 4))
            .map(|index| Token::Uint(U256::from(index)))
            .collect::<Vec<_>>();
        let array_summary = summarize_token(
            &Token::Array(items),
            &ParamType::Array(Box::new(ParamType::Uint(256))),
            Some("values"),
        );
        assert!(array_summary.truncated);
        assert_eq!(
            array_summary.items.as_ref().unwrap().len(),
            MAX_SUMMARY_ITEMS
        );
        assert!(!serde_json::to_string(&bytes_summary)
            .unwrap()
            .contains("abababababababab"));
        assert_ne!(string_summary.value.as_deref(), Some(long_string.as_str()));
    }

    #[test]
    fn chain_mismatch_result_is_sanitized() {
        let input = normalized_test_input();

        let result = base_result(&input, summarize_rpc_endpoint(&input.rpc_url))
            .actual_chain_id(5)
            .status("chainMismatch")
            .reason("chainMismatch")
            .error("chainId mismatch: expected 1, actual 5")
            .finish();

        assert_eq!(result.status, "chainMismatch");
        assert_eq!(result.rpc.endpoint, "https://rpc.example.invalid");
        assert_eq!(result.rpc.actual_chain_id, Some(5));
        assert!(!serde_json::to_string(&result).unwrap().contains("/path"));
    }

    #[test]
    fn timeout_results_are_bounded_and_sanitized() {
        let input = normalized_test_input();

        let chain_probe = timeout_result(
            &input,
            summarize_rpc_endpoint(&input.rpc_url),
            Some("0x70a08231".to_string()),
            None,
            None,
            RpcTimeoutStage::ChainIdProbe,
        );
        assert_eq!(chain_probe.status, "timeout");
        assert_eq!(chain_probe.reasons, vec!["chainIdProbeTimedOut"]);

        let eth_call = timeout_result(
            &input,
            summarize_rpc_endpoint(&input.rpc_url),
            Some("0x70a08231".to_string()),
            Some(AbiCallDataSummary {
                byte_length: 36,
                hash: "0x4444444444444444444444444444444444444444444444444444444444444444"
                    .to_string(),
            }),
            Some(1),
            RpcTimeoutStage::EthCall,
        );
        assert_eq!(eth_call.status, "timeout");
        assert_eq!(eth_call.reasons, vec!["ethCallTimedOut"]);
        assert_eq!(eth_call.rpc.actual_chain_id, Some(1));
        assert_eq!(eth_call.rpc.endpoint, "https://rpc.example.invalid");
        assert!(!serde_json::to_string(&eth_call).unwrap().contains("/path"));
    }

    #[test]
    fn revert_and_decode_failures_are_visible() {
        let revert_with_data = JsonRpcError {
            code: 3,
            message: "execution reverted".to_string(),
            data: Some(object_value(vec![(
                "data",
                Value::String("0x08c379a0".to_string()),
            )])),
        };
        let noisy_rpc_failure = JsonRpcError {
            code: -32000,
            message: "upstream proxy could not revert socket state".to_string(),
            data: None,
        };
        assert_eq!(
            classify_json_rpc_call_error(&revert_with_data),
            ("reverted", "revertData")
        );
        assert_eq!(
            classify_json_rpc_call_error(&noisy_rpc_failure),
            ("rpcFailure", "ethCallFailed")
        );

        let abi = abi_with_functions(vec![view_function(
            "value",
            Vec::new(),
            vec![param("", ParamType::Uint(256))],
        )]);
        let function = select_function_by_signature(&abi, "value()").unwrap();
        let empty = decode_outputs(function, &[]).unwrap_err();
        assert_eq!(empty.status, "emptyReturn");
        let malformed = decode_outputs(function, &[0xab, 0xcd]).unwrap_err();
        assert_eq!(malformed.status, "malformedReturn");
        let bad_dynamic = abi_with_functions(vec![view_function(
            "name",
            Vec::new(),
            vec![param("", ParamType::String)],
        )]);
        let function = select_function_by_signature(&bad_dynamic, "name()").unwrap();
        let decode = decode_outputs(function, &[0xff; 32]).unwrap_err();
        assert_eq!(decode.status, "abiDecodeError");
    }
}
