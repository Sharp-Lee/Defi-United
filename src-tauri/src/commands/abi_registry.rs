use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ethers::types::Address;
use ethers::utils::{keccak256, to_checksum};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::diagnostics::sanitize_diagnostic_message;
use crate::storage::{
    abi_registry_path, abi_registry_path_readonly, ensure_app_dir, write_file_atomic,
};

const ABI_REGISTRY_SCHEMA_VERSION: u8 = 1;
pub const ABI_PAYLOAD_SIZE_LIMIT_BYTES: usize = 1_048_576;
const EXPLORER_ABI_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const EXPLORER_ABI_RESPONSE_SIZE_LIMIT_BYTES: usize = ABI_PAYLOAD_SIZE_LIMIT_BYTES;
const STALE_FETCH_PROVIDER_CONFIG_ERROR: &str = "fetchProviderConfigChanged";
const INVALID_ABI_REGISTRY_STATE_ERROR: &str =
    "abi-registry.json contains invalid ABI registry state; fix or remove it before loading ABI registry";

const SUPPORTED_PROVIDER_KINDS: &[&str] = &[
    "etherscanCompatible",
    "blockscoutCompatible",
    "customIndexer",
    "localOnly",
];

const SUPPORTED_SOURCE_KINDS: &[&str] = &["explorerFetched", "userImported", "userPasted"];

const FETCH_SOURCE_STATUSES: &[&str] = &[
    "ok",
    "notConfigured",
    "unsupportedChain",
    "fetchFailed",
    "rateLimited",
    "notVerified",
    "malformedResponse",
];

const VALIDATION_STATUSES: &[&str] = &[
    "notValidated",
    "parseFailed",
    "malformedAbi",
    "emptyAbiItems",
    "payloadTooLarge",
    "ok",
    "selectorConflict",
];

const CACHE_STATUSES: &[&str] = &[
    "cacheFresh",
    "cacheStale",
    "refreshing",
    "refreshFailed",
    "versionSuperseded",
];

const SELECTION_STATUSES: &[&str] = &[
    "selected",
    "unselected",
    "sourceConflict",
    "needsUserChoice",
];

const API_KEY_REF_ERROR: &str = "apiKeyRef must be an environment, keychain, or secret reference";

fn abi_registry_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn now_unix_seconds() -> Result<String, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiRegistryState {
    pub schema_version: u8,
    pub data_sources: Vec<AbiDataSourceConfigRecord>,
    pub cache_entries: Vec<AbiCacheEntryRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAbiRegistryState {
    #[serde(default = "default_schema_version", alias = "schema_version")]
    schema_version: u8,
    #[serde(default, alias = "data_sources")]
    data_sources: Vec<AbiDataSourceConfigRecord>,
    #[serde(default, alias = "cache_entries")]
    cache_entries: Vec<AbiCacheEntryRecord>,
}

impl Default for StoredAbiRegistryState {
    fn default() -> Self {
        Self {
            schema_version: ABI_REGISTRY_SCHEMA_VERSION,
            data_sources: Vec::new(),
            cache_entries: Vec::new(),
        }
    }
}

fn default_schema_version() -> u8 {
    ABI_REGISTRY_SCHEMA_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbiDataSourceConfigRecord {
    pub id: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "provider_kind")]
    pub provider_kind: String,
    #[serde(default, alias = "base_url")]
    pub base_url: Option<String>,
    #[serde(default, alias = "api_key_ref")]
    pub api_key_ref: Option<String>,
    pub enabled: bool,
    #[serde(default, alias = "last_success_at")]
    pub last_success_at: Option<String>,
    #[serde(default, alias = "last_failure_at")]
    pub last_failure_at: Option<String>,
    #[serde(default, alias = "failure_count")]
    pub failure_count: u32,
    #[serde(default, alias = "cooldown_until")]
    pub cooldown_until: Option<String>,
    #[serde(default, alias = "rate_limited")]
    pub rate_limited: bool,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbiCacheEntryRecord {
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
    #[serde(alias = "attempt_id")]
    pub attempt_id: String,
    #[serde(alias = "source_fingerprint")]
    pub source_fingerprint: String,
    #[serde(alias = "abi_hash")]
    pub abi_hash: String,
    pub selected: bool,
    #[serde(alias = "fetch_source_status")]
    pub fetch_source_status: String,
    #[serde(alias = "validation_status")]
    pub validation_status: String,
    #[serde(alias = "cache_status")]
    pub cache_status: String,
    #[serde(alias = "selection_status")]
    pub selection_status: String,
    #[serde(default, alias = "function_count")]
    pub function_count: Option<u32>,
    #[serde(default, alias = "event_count")]
    pub event_count: Option<u32>,
    #[serde(default, alias = "error_count")]
    pub error_count: Option<u32>,
    #[serde(default, alias = "selector_summary")]
    pub selector_summary: Option<AbiSelectorSummaryRecord>,
    #[serde(default, alias = "fetched_at")]
    pub fetched_at: Option<String>,
    #[serde(default, alias = "imported_at")]
    pub imported_at: Option<String>,
    #[serde(default, alias = "last_validated_at")]
    pub last_validated_at: Option<String>,
    #[serde(default, alias = "stale_after")]
    pub stale_after: Option<String>,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "provider_proxy_hint")]
    pub provider_proxy_hint: Option<String>,
    #[serde(default, alias = "proxy_detected")]
    pub proxy_detected: bool,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbiSelectorSummaryRecord {
    #[serde(default, alias = "function_selector_count")]
    pub function_selector_count: Option<u32>,
    #[serde(default, alias = "event_topic_count")]
    pub event_topic_count: Option<u32>,
    #[serde(default, alias = "error_selector_count")]
    pub error_selector_count: Option<u32>,
    #[serde(default, alias = "duplicate_selector_count")]
    pub duplicate_selector_count: Option<u32>,
    #[serde(default, alias = "conflict_count")]
    pub conflict_count: Option<u32>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAbiDataSourceConfigInput {
    pub id: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "provider_kind")]
    pub provider_kind: String,
    #[serde(default, alias = "base_url")]
    pub base_url: Option<String>,
    #[serde(default, alias = "api_key_ref")]
    pub api_key_ref: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default, alias = "last_success_at")]
    pub last_success_at: Option<String>,
    #[serde(default, alias = "clear_last_success_at")]
    pub clear_last_success_at: bool,
    #[serde(default, alias = "last_failure_at")]
    pub last_failure_at: Option<String>,
    #[serde(default, alias = "clear_last_failure_at")]
    pub clear_last_failure_at: bool,
    #[serde(default, alias = "failure_count")]
    pub failure_count: Option<u32>,
    #[serde(default, alias = "cooldown_until")]
    pub cooldown_until: Option<String>,
    #[serde(default, alias = "clear_cooldown_until")]
    pub clear_cooldown_until: bool,
    #[serde(default, alias = "rate_limited")]
    pub rate_limited: Option<bool>,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "clear_last_error_summary")]
    pub clear_last_error_summary: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveAbiDataSourceConfigInput {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAbiCacheEntryInput {
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
    #[serde(alias = "attempt_id")]
    pub attempt_id: String,
    #[serde(alias = "source_fingerprint")]
    pub source_fingerprint: String,
    #[serde(alias = "abi_hash")]
    pub abi_hash: String,
    pub selected: bool,
    #[serde(alias = "fetch_source_status")]
    pub fetch_source_status: String,
    #[serde(alias = "validation_status")]
    pub validation_status: String,
    #[serde(alias = "cache_status")]
    pub cache_status: String,
    #[serde(alias = "selection_status")]
    pub selection_status: String,
    #[serde(default, alias = "function_count")]
    pub function_count: Option<u32>,
    #[serde(default, alias = "event_count")]
    pub event_count: Option<u32>,
    #[serde(default, alias = "error_count")]
    pub error_count: Option<u32>,
    #[serde(default, alias = "selector_summary")]
    pub selector_summary: Option<AbiSelectorSummaryRecord>,
    #[serde(default, alias = "fetched_at")]
    pub fetched_at: Option<String>,
    #[serde(default, alias = "imported_at")]
    pub imported_at: Option<String>,
    #[serde(default, alias = "last_validated_at")]
    pub last_validated_at: Option<String>,
    #[serde(default, alias = "stale_after")]
    pub stale_after: Option<String>,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "provider_proxy_hint")]
    pub provider_proxy_hint: Option<String>,
    #[serde(default, alias = "proxy_detected")]
    pub proxy_detected: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiCacheEntryIdentityInput {
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
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateAbiPayloadInput {
    pub payload: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAbiPayloadInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "contract_address")]
    pub contract_address: String,
    pub payload: String,
    #[serde(default, alias = "user_source_id")]
    pub user_source_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchExplorerAbiInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "contract_address")]
    pub contract_address: String,
    #[serde(default, alias = "provider_config_id")]
    pub provider_config_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AbiProviderDiagnosticsRecord {
    pub provider_kind: Option<String>,
    pub chain_id: Option<u64>,
    pub provider_config_id: Option<String>,
    pub host: Option<String>,
    pub config_summary: Option<String>,
    pub failure_class: Option<String>,
    pub rate_limit_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbiPayloadValidationReadModel {
    pub fetch_source_status: String,
    pub validation_status: String,
    pub abi_hash: Option<String>,
    pub source_fingerprint: Option<String>,
    pub function_count: u32,
    pub event_count: u32,
    pub error_count: u32,
    pub selector_summary: AbiSelectorSummaryRecord,
    pub diagnostics: AbiProviderDiagnosticsRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbiRegistryMutationResult {
    pub state: AbiRegistryState,
    pub validation: AbiPayloadValidationReadModel,
    pub cache_entry: Option<AbiCacheEntryRecord>,
}

#[tauri::command]
pub fn load_abi_registry_state() -> Result<AbiRegistryState, String> {
    read_abi_registry_state().map(into_read_state)
}

pub fn load_abi_registry_state_readonly() -> Result<AbiRegistryState, String> {
    read_abi_registry_state_readonly().map(into_read_state)
}

#[tauri::command]
pub fn upsert_abi_data_source_config(
    input: UpsertAbiDataSourceConfigInput,
) -> Result<AbiRegistryState, String> {
    let _guard = abi_registry_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_abi_registry_state_for_update()?;
    let id = normalize_id(input.id, "data source id")?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let provider_kind = normalize_provider_kind(input.provider_kind)?;
    let base_url = normalize_base_url(input.base_url, &provider_kind)?;
    let api_key_ref = normalize_api_key_ref(input.api_key_ref)?;
    let now = now_unix_seconds()?;
    let existing_index = data_source_index(&state.data_sources, &id);
    let existing = existing_index.and_then(|index| state.data_sources.get(index).cloned());

    let record = AbiDataSourceConfigRecord {
        id,
        chain_id,
        provider_kind,
        base_url,
        api_key_ref,
        enabled: input
            .enabled
            .or_else(|| existing.as_ref().map(|record| record.enabled))
            .unwrap_or(true),
        last_success_at: merge_optional_string(
            input.last_success_at,
            existing
                .as_ref()
                .and_then(|record| record.last_success_at.clone()),
            input.clear_last_success_at,
        ),
        last_failure_at: merge_optional_string(
            input.last_failure_at,
            existing
                .as_ref()
                .and_then(|record| record.last_failure_at.clone()),
            input.clear_last_failure_at,
        ),
        failure_count: input
            .failure_count
            .or_else(|| existing.as_ref().map(|record| record.failure_count))
            .unwrap_or(0),
        cooldown_until: merge_optional_string(
            input.cooldown_until,
            existing
                .as_ref()
                .and_then(|record| record.cooldown_until.clone()),
            input.clear_cooldown_until,
        ),
        rate_limited: input
            .rate_limited
            .or_else(|| existing.as_ref().map(|record| record.rate_limited))
            .unwrap_or(false),
        last_error_summary: merge_optional_sanitized(
            input.last_error_summary,
            existing
                .as_ref()
                .and_then(|record| record.last_error_summary.clone()),
            input.clear_last_error_summary,
        ),
        created_at: existing
            .as_ref()
            .map(|record| record.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
    };
    upsert_by_index(&mut state.data_sources, existing_index, record);
    sort_state(&mut state);
    write_abi_registry_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn remove_abi_data_source_config(
    input: RemoveAbiDataSourceConfigInput,
) -> Result<AbiRegistryState, String> {
    let _guard = abi_registry_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_abi_registry_state_for_update()?;
    let id = normalize_id(input.id, "data source id")?;
    let before = state.data_sources.len();
    state.data_sources.retain(|record| record.id != id);
    if state.data_sources.len() == before {
        return Err("ABI data source config not found".to_string());
    }
    write_abi_registry_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn upsert_abi_cache_entry(input: UpsertAbiCacheEntryInput) -> Result<AbiRegistryState, String> {
    let _guard = abi_registry_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_abi_registry_state_for_update()?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let contract_address = normalize_evm_address(&input.contract_address, "contract address")?;
    let source_kind = normalize_source_kind(input.source_kind)?;
    let (provider_config_id, user_source_id) =
        normalize_source_ref(&source_kind, input.provider_config_id, input.user_source_id)?;
    let version_id = normalize_id(input.version_id, "versionId")?;
    let attempt_id = normalize_id(input.attempt_id, "attemptId")?;
    let source_fingerprint = normalize_id(input.source_fingerprint, "sourceFingerprint")?;
    let abi_hash = normalize_id(input.abi_hash, "abiHash")?;
    let fetch_source_status = normalize_status(
        input.fetch_source_status,
        FETCH_SOURCE_STATUSES,
        "fetchSourceStatus",
    )?;
    let validation_status = normalize_status(
        input.validation_status,
        VALIDATION_STATUSES,
        "validationStatus",
    )?;
    let cache_status = normalize_status(input.cache_status, CACHE_STATUSES, "cacheStatus")?;
    let selection_status = normalize_status(
        input.selection_status,
        SELECTION_STATUSES,
        "selectionStatus",
    )?;
    let now = now_unix_seconds()?;
    let existing_index = cache_entry_index(
        &state.cache_entries,
        chain_id,
        &contract_address,
        &source_kind,
        provider_config_id.as_deref(),
        user_source_id.as_deref(),
        &version_id,
    );
    let existing = existing_index.and_then(|index| state.cache_entries.get(index).cloned());

    let record = AbiCacheEntryRecord {
        chain_id,
        contract_address,
        source_kind,
        provider_config_id,
        user_source_id,
        version_id,
        attempt_id,
        source_fingerprint,
        abi_hash,
        selected: input.selected,
        fetch_source_status,
        validation_status,
        cache_status,
        selection_status,
        function_count: input.function_count,
        event_count: input.event_count,
        error_count: input.error_count,
        selector_summary: input.selector_summary.map(sanitize_selector_summary),
        fetched_at: input.fetched_at.and_then(non_empty_string),
        imported_at: input.imported_at.and_then(non_empty_string),
        last_validated_at: input.last_validated_at.and_then(non_empty_string),
        stale_after: input.stale_after.and_then(non_empty_string),
        last_error_summary: sanitize_optional(input.last_error_summary),
        provider_proxy_hint: sanitize_optional(input.provider_proxy_hint),
        proxy_detected: input.proxy_detected,
        created_at: existing
            .as_ref()
            .map(|record| record.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
    };
    upsert_by_index(&mut state.cache_entries, existing_index, record);
    sort_state(&mut state);
    write_abi_registry_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn mark_abi_cache_stale(input: AbiCacheEntryIdentityInput) -> Result<AbiRegistryState, String> {
    let _guard = abi_registry_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_abi_registry_state_for_update()?;
    let identity = normalize_cache_identity(input)?;
    let index = cache_entry_index_from_identity(&state.cache_entries, &identity)
        .ok_or_else(|| "ABI cache entry not found".to_string())?;
    state.cache_entries[index].cache_status = "cacheStale".to_string();
    state.cache_entries[index].updated_at = now_unix_seconds()?;
    sort_state(&mut state);
    write_abi_registry_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn delete_abi_cache_entry(
    input: AbiCacheEntryIdentityInput,
) -> Result<AbiRegistryState, String> {
    let _guard = abi_registry_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_abi_registry_state_for_update()?;
    let identity = normalize_cache_identity(input)?;
    let before = state.cache_entries.len();
    state
        .cache_entries
        .retain(|entry| !cache_entry_matches_identity(entry, &identity));
    if state.cache_entries.len() == before {
        return Err("ABI cache entry not found".to_string());
    }
    write_abi_registry_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn validate_abi_payload(
    input: ValidateAbiPayloadInput,
) -> Result<AbiPayloadValidationReadModel, String> {
    Ok(validate_abi_payload_read_model(&input.payload, None))
}

#[tauri::command]
pub fn import_abi_payload(input: UserAbiPayloadInput) -> Result<AbiRegistryMutationResult, String> {
    persist_user_abi_payload(input, "userImported")
}

#[tauri::command]
pub fn paste_abi_payload(input: UserAbiPayloadInput) -> Result<AbiRegistryMutationResult, String> {
    persist_user_abi_payload(input, "userPasted")
}

#[tauri::command]
pub async fn fetch_explorer_abi(
    input: FetchExplorerAbiInput,
) -> Result<AbiRegistryMutationResult, String> {
    let chain_id = normalize_chain_id(input.chain_id)?;
    let contract_address = normalize_evm_address(&input.contract_address, "contract address")?;
    let provider_config_id = input.provider_config_id.and_then(non_empty_string);

    let provider = {
        let _guard = abi_registry_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let state = read_abi_registry_state_for_update()?;
        select_fetch_provider(&state, chain_id, provider_config_id.as_deref())
    };

    let provider = match provider {
        Ok(provider) => provider,
        Err((status, diagnostics)) => {
            let state = load_abi_registry_state()?;
            return Ok(AbiRegistryMutationResult {
                state,
                validation: failure_validation(status, "notValidated", diagnostics, None),
                cache_entry: None,
            });
        }
    };

    let provider_config_fingerprint = fetch_provider_config_fingerprint(&provider);

    if provider.provider_kind == "localOnly" {
        let diagnostics = provider_diagnostics(&provider, Some("unsupportedProvider"), None);
        if !update_fetch_provider_failure(
            &provider.id,
            &provider_config_fingerprint,
            "unsupportedChain",
            false,
            None,
        )? {
            return stale_fetch_provider_config_result(&provider);
        }
        let state = load_abi_registry_state()?;
        return Ok(AbiRegistryMutationResult {
            state,
            validation: failure_validation("unsupportedChain", "notValidated", diagnostics, None),
            cache_entry: None,
        });
    }

    let api_key = match resolve_api_key_ref(provider.api_key_ref.as_deref()) {
        Ok(api_key) => api_key,
        Err(failure_class) => {
            let diagnostics = provider_diagnostics(&provider, Some(failure_class), None);
            if !update_fetch_provider_failure(
                &provider.id,
                &provider_config_fingerprint,
                "fetchFailed",
                false,
                None,
            )? {
                return stale_fetch_provider_config_result(&provider);
            }
            let state = load_abi_registry_state()?;
            return Ok(AbiRegistryMutationResult {
                state,
                validation: failure_validation("fetchFailed", "notValidated", diagnostics, None),
                cache_entry: None,
            });
        }
    };

    let response =
        fetch_explorer_abi_response(&provider, &contract_address, api_key.as_deref()).await;
    let response = match response {
        Ok(response) => response,
        Err(fetch_error) => {
            let rate_limited = fetch_error.status == "rateLimited";
            if !update_fetch_provider_failure(
                &provider.id,
                &provider_config_fingerprint,
                &fetch_error.status,
                rate_limited,
                fetch_error.rate_limit_hint.clone(),
            )? {
                return stale_fetch_provider_config_result(&provider);
            }
            let diagnostics = provider_diagnostics(
                &provider,
                Some(&fetch_error.failure_class),
                fetch_error.rate_limit_hint.as_deref(),
            );
            let state = load_abi_registry_state()?;
            return Ok(AbiRegistryMutationResult {
                state,
                validation: failure_validation(
                    &fetch_error.status,
                    fetch_error.validation_status(),
                    diagnostics,
                    None,
                ),
                cache_entry: None,
            });
        }
    };

    let diagnostics = provider_diagnostics(&provider, None, None);
    let validation = validate_abi_payload_read_model(&response.payload, Some(diagnostics));
    if validation.validation_status != "ok" && validation.validation_status != "selectorConflict" {
        if !update_fetch_provider_failure(
            &provider.id,
            &provider_config_fingerprint,
            "malformedResponse",
            false,
            None,
        )? {
            return stale_fetch_provider_config_result(&provider);
        }
        let state = load_abi_registry_state()?;
        return Ok(AbiRegistryMutationResult {
            state,
            validation: AbiPayloadValidationReadModel {
                fetch_source_status: "malformedResponse".to_string(),
                ..validation
            },
            cache_entry: None,
        });
    }

    let validated = validate_abi_payload_internal(&response.payload)
        .map_err(|_| "validated explorer ABI could not be re-read".to_string())?;
    let mut result = persist_validated_abi(
        chain_id,
        &contract_address,
        "explorerFetched",
        Some(provider.id.clone()),
        None,
        validated,
        Some("ok"),
        Some(provider_diagnostics(&provider, None, None)),
        Some(&provider_config_fingerprint),
    )?;
    result.state = load_abi_registry_state()?;
    Ok(result)
}

fn read_abi_registry_state() -> Result<StoredAbiRegistryState, String> {
    let path = abi_registry_path()?;
    read_abi_registry_state_from_path(&path)
}

fn read_abi_registry_state_readonly() -> Result<StoredAbiRegistryState, String> {
    let path = abi_registry_path_readonly()?;
    read_abi_registry_state_from_path(&path)
}

fn read_abi_registry_state_from_path(path: &Path) -> Result<StoredAbiRegistryState, String> {
    match fs::read_to_string(&path) {
        Ok(raw) => {
            let state = serde_json::from_str::<StoredAbiRegistryState>(&raw).map_err(|_| {
                "abi-registry.json is invalid; fix or remove it before saving ABI registry state"
                    .to_string()
            })?;
            normalize_loaded_state(state).map_err(|_| INVALID_ABI_REGISTRY_STATE_ERROR.to_string())
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(StoredAbiRegistryState::default()),
        Err(error) => Err(error.to_string()),
    }
}

fn read_abi_registry_state_for_update() -> Result<StoredAbiRegistryState, String> {
    read_abi_registry_state()
}

fn write_abi_registry_state(state: &StoredAbiRegistryState) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    write_file_atomic(&abi_registry_path()?, &raw)
}

fn persist_user_abi_payload(
    input: UserAbiPayloadInput,
    source_kind: &str,
) -> Result<AbiRegistryMutationResult, String> {
    let chain_id = normalize_chain_id(input.chain_id)?;
    let contract_address = normalize_evm_address(&input.contract_address, "contract address")?;
    let user_source_id = input
        .user_source_id
        .and_then(sanitize_user_source_id)
        .unwrap_or_else(|| match source_kind {
            "userImported" => "user-imported".to_string(),
            _ => "user-pasted".to_string(),
        });

    let validation = validate_abi_payload_read_model(&input.payload, None);
    if validation.validation_status != "ok" && validation.validation_status != "selectorConflict" {
        let state = load_abi_registry_state()?;
        return Ok(AbiRegistryMutationResult {
            state,
            validation,
            cache_entry: None,
        });
    }

    let validated = validate_abi_payload_internal(&input.payload)
        .map_err(|_| "validated ABI payload could not be re-read".to_string())?;
    persist_validated_abi(
        chain_id,
        &contract_address,
        source_kind,
        None,
        Some(user_source_id),
        validated,
        Some("ok"),
        None,
        None,
    )
}

fn validate_abi_payload_read_model(
    payload: &str,
    diagnostics: Option<AbiProviderDiagnosticsRecord>,
) -> AbiPayloadValidationReadModel {
    let diagnostics = diagnostics.unwrap_or_default();
    match validate_abi_payload_internal(payload) {
        Ok(validated) => validation_read_model_from_validated("ok", validated, diagnostics),
        Err(error) => failure_validation(
            "ok",
            error.validation_status,
            diagnostics,
            Some(error.summary),
        ),
    }
}

fn validation_read_model_from_validated(
    fetch_source_status: &str,
    validated: ValidatedAbiPayload,
    diagnostics: AbiProviderDiagnosticsRecord,
) -> AbiPayloadValidationReadModel {
    AbiPayloadValidationReadModel {
        fetch_source_status: fetch_source_status.to_string(),
        validation_status: validated.validation_status,
        abi_hash: Some(validated.abi_hash),
        source_fingerprint: None,
        function_count: validated.function_count,
        event_count: validated.event_count,
        error_count: validated.error_count,
        selector_summary: validated.selector_summary,
        diagnostics,
    }
}

fn failure_validation(
    fetch_source_status: &str,
    validation_status: &str,
    diagnostics: AbiProviderDiagnosticsRecord,
    selector_summary: Option<AbiSelectorSummaryRecord>,
) -> AbiPayloadValidationReadModel {
    AbiPayloadValidationReadModel {
        fetch_source_status: fetch_source_status.to_string(),
        validation_status: validation_status.to_string(),
        abi_hash: None,
        source_fingerprint: None,
        function_count: 0,
        event_count: 0,
        error_count: 0,
        selector_summary: selector_summary.unwrap_or_else(empty_selector_summary),
        diagnostics,
    }
}

#[derive(Debug, Clone)]
struct ValidationFailure {
    validation_status: &'static str,
    summary: AbiSelectorSummaryRecord,
}

#[derive(Debug, Clone)]
struct ValidatedAbiPayload {
    canonical_abi: String,
    abi_hash: String,
    validation_status: String,
    function_count: u32,
    event_count: u32,
    error_count: u32,
    selector_summary: AbiSelectorSummaryRecord,
}

fn validate_abi_payload_internal(payload: &str) -> Result<ValidatedAbiPayload, ValidationFailure> {
    if payload.as_bytes().len() > ABI_PAYLOAD_SIZE_LIMIT_BYTES {
        return Err(validation_failure(
            "payloadTooLarge",
            "ABI payload exceeds size limit",
        ));
    }

    let parsed = serde_json::from_str::<Value>(payload)
        .map_err(|_| validation_failure("parseFailed", "ABI payload is not valid JSON"))?;
    let abi = extract_abi_array(parsed)?;
    if abi.is_empty() {
        return Err(validation_failure("emptyAbiItems", "ABI array is empty"));
    }

    let mut signatures = Vec::new();
    let mut function_count = 0u32;
    let mut event_count = 0u32;
    let mut error_count = 0u32;
    let mut saw_callable_item = false;

    for item in &abi {
        let Value::Object(object) = item else {
            return Err(validation_failure(
                "malformedAbi",
                "ABI item must be an object",
            ));
        };
        let item_type = object
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| validation_failure("malformedAbi", "ABI item is missing type"))?;
        match item_type {
            "function" | "event" | "error" => {
                saw_callable_item = true;
                let name = object
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|value| is_valid_abi_name(value))
                    .ok_or_else(|| {
                        validation_failure("malformedAbi", "ABI item is missing a valid name")
                    })?;
                let inputs = canonical_param_list(object.get("inputs"))?;
                if item_type == "function" {
                    let _ = canonical_param_list(object.get("outputs"))?;
                    function_count += 1;
                } else if item_type == "event" {
                    event_count += 1;
                } else {
                    error_count += 1;
                }
                signatures.push(AbiSignature {
                    kind: item_type.to_string(),
                    selector_key: selector_key(item_type, &format!("{name}({})", inputs.join(","))),
                    signature: format!("{name}({})", inputs.join(",")),
                });
            }
            "constructor" | "fallback" | "receive" => {
                let _ = canonical_param_list(object.get("inputs"))?;
                let _ = canonical_param_list(object.get("outputs"))?;
            }
            _ => {
                return Err(validation_failure(
                    "malformedAbi",
                    "ABI item has unsupported type",
                ));
            }
        }
    }

    if !saw_callable_item {
        return Err(validation_failure(
            "emptyAbiItems",
            "ABI has no function, event, or error items",
        ));
    }

    let selector_summary = selector_summary(&signatures);
    let validation_status = if selector_summary.conflict_count.unwrap_or(0) > 0
        || selector_summary.duplicate_selector_count.unwrap_or(0) > 0
    {
        "selectorConflict"
    } else {
        "ok"
    }
    .to_string();
    let canonical_abi = canonical_json(&Value::Array(abi));
    let abi_hash = hash_text(&canonical_abi);

    Ok(ValidatedAbiPayload {
        canonical_abi,
        abi_hash,
        validation_status,
        function_count,
        event_count,
        error_count,
        selector_summary,
    })
}

fn extract_abi_array(value: Value) -> Result<Vec<Value>, ValidationFailure> {
    match value {
        Value::Array(items) => Ok(items),
        Value::String(raw_abi) => {
            if raw_abi.as_bytes().len() > ABI_PAYLOAD_SIZE_LIMIT_BYTES {
                return Err(validation_failure(
                    "payloadTooLarge",
                    "ABI payload exceeds size limit",
                ));
            }
            match serde_json::from_str::<Value>(&raw_abi) {
                Ok(Value::Array(items)) => Ok(items),
                Ok(_) => Err(validation_failure(
                    "malformedAbi",
                    "ABI JSON must be an array",
                )),
                Err(_) => Err(validation_failure(
                    "parseFailed",
                    "Explorer ABI string is not valid JSON",
                )),
            }
        }
        Value::Object(mut object) => {
            let Some(result) = object.remove("result") else {
                return Err(validation_failure(
                    "malformedAbi",
                    "Explorer response is missing result",
                ));
            };
            extract_abi_array(result)
        }
        _ => Err(validation_failure(
            "malformedAbi",
            "ABI JSON must be an array",
        )),
    }
}

fn validation_failure(status: &'static str, note: &str) -> ValidationFailure {
    ValidationFailure {
        validation_status: status,
        summary: AbiSelectorSummaryRecord {
            notes: Some(sanitize_diagnostic_message(note)),
            ..empty_selector_summary()
        },
    }
}

fn empty_selector_summary() -> AbiSelectorSummaryRecord {
    AbiSelectorSummaryRecord {
        function_selector_count: Some(0),
        event_topic_count: Some(0),
        error_selector_count: Some(0),
        duplicate_selector_count: Some(0),
        conflict_count: Some(0),
        notes: None,
    }
}

#[derive(Debug, Clone)]
struct AbiSignature {
    kind: String,
    selector_key: String,
    signature: String,
}

fn canonical_param_list(value: Option<&Value>) -> Result<Vec<String>, ValidationFailure> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Value::Array(items) = value else {
        return Err(validation_failure(
            "malformedAbi",
            "ABI inputs or outputs must be arrays",
        ));
    };
    items.iter().map(canonical_param_type).collect()
}

fn canonical_param_type(value: &Value) -> Result<String, ValidationFailure> {
    let Value::Object(object) = value else {
        return Err(validation_failure(
            "malformedAbi",
            "ABI parameter must be an object",
        ));
    };
    let raw_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| validation_failure("malformedAbi", "ABI parameter is missing type"))?;
    if !is_valid_abi_type(raw_type) {
        return Err(validation_failure(
            "malformedAbi",
            "ABI parameter has malformed type",
        ));
    }

    if let Some(tuple_suffix) = raw_type.strip_prefix("tuple") {
        if !is_valid_array_suffix(tuple_suffix) {
            return Err(validation_failure(
                "malformedAbi",
                "ABI tuple has malformed array suffix",
            ));
        }
        let components = object.get("components").ok_or_else(|| {
            validation_failure("malformedAbi", "ABI tuple parameter is missing components")
        })?;
        let Value::Array(component_items) = components else {
            return Err(validation_failure(
                "malformedAbi",
                "ABI tuple components must be an array",
            ));
        };
        if component_items.is_empty() {
            return Err(validation_failure(
                "malformedAbi",
                "ABI tuple components cannot be empty",
            ));
        }
        let component_types = component_items
            .iter()
            .map(canonical_param_type)
            .collect::<Result<Vec<_>, _>>()?;
        return Ok(format!("({}){tuple_suffix}", component_types.join(",")));
    }

    if object.contains_key("components") {
        return Err(validation_failure(
            "malformedAbi",
            "ABI non-tuple parameter cannot have components",
        ));
    }
    canonical_scalar_or_array_type(raw_type)
}

fn canonical_scalar_or_array_type(raw_type: &str) -> Result<String, ValidationFailure> {
    let suffix_start = array_suffix_start(raw_type).unwrap_or(raw_type.len());
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

fn is_valid_abi_name(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn is_valid_abi_type(value: &str) -> bool {
    if value.is_empty()
        || value.len() > 256
        || value
            .chars()
            .any(|ch| ch.is_whitespace() || matches!(ch, '(' | ')' | ','))
    {
        return false;
    }
    if let Some(suffix) = value.strip_prefix("tuple") {
        return is_valid_array_suffix(suffix);
    }

    let suffix_start = array_suffix_start(value).unwrap_or(value.len());
    let base_type = &value[..suffix_start];
    let array_suffix = &value[suffix_start..];
    !base_type.is_empty()
        && is_valid_abi_base_type(base_type)
        && is_valid_array_suffix(array_suffix)
}

fn array_suffix_start(value: &str) -> Option<usize> {
    value.find('[')
}

fn is_valid_abi_base_type(value: &str) -> bool {
    match value {
        "address" | "bool" | "string" | "bytes" | "function" | "int" | "uint" | "fixed"
        | "ufixed" => return true,
        _ => {}
    }

    if let Some(bits) = value.strip_prefix("uint") {
        return is_valid_int_bit_width(bits);
    }
    if let Some(bits) = value.strip_prefix("int") {
        return is_valid_int_bit_width(bits);
    }
    if let Some(size) = value.strip_prefix("bytes") {
        return parse_decimal_u16(size)
            .map(|size| (1..=32).contains(&size))
            .unwrap_or(false);
    }
    if let Some(size) = value.strip_prefix("fixed") {
        return is_valid_fixed_size(size);
    }
    if let Some(size) = value.strip_prefix("ufixed") {
        return is_valid_fixed_size(size);
    }
    false
}

fn is_valid_int_bit_width(value: &str) -> bool {
    parse_decimal_u16(value)
        .map(|bits| (8..=256).contains(&bits) && bits % 8 == 0)
        .unwrap_or(false)
}

fn is_valid_fixed_size(value: &str) -> bool {
    let Some((bits, scale)) = value.split_once('x') else {
        return false;
    };
    let Some(bits) = parse_decimal_u16(bits) else {
        return false;
    };
    let Some(scale) = parse_decimal_u16(scale) else {
        return false;
    };
    (8..=256).contains(&bits) && bits % 8 == 0 && (1..=80).contains(&scale)
}

fn parse_decimal_u16(value: &str) -> Option<u16> {
    if value.is_empty() || !value.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    value.parse::<u16>().ok()
}

fn is_valid_array_suffix(value: &str) -> bool {
    let mut remaining = value;
    while !remaining.is_empty() {
        let Some(after_open) = remaining.strip_prefix('[') else {
            return false;
        };
        let Some(close_index) = after_open.find(']') else {
            return false;
        };
        let len = &after_open[..close_index];
        if !len.chars().all(|ch| ch.is_ascii_digit()) {
            return false;
        }
        if !len.is_empty() && len.parse::<u64>().ok().filter(|len| *len > 0).is_none() {
            return false;
        }
        remaining = &after_open[close_index + 1..];
    }
    true
}

fn selector_key(kind: &str, signature: &str) -> String {
    let hash = keccak256(signature.as_bytes());
    match kind {
        "event" => format!("0x{}", hex_lower(&hash)),
        _ => format!("0x{}", hex_lower(&hash[..4])),
    }
}

fn selector_summary(signatures: &[AbiSignature]) -> AbiSelectorSummaryRecord {
    let mut function_selectors = HashSet::new();
    let mut event_topics = HashSet::new();
    let mut error_selectors = HashSet::new();
    let mut by_selector: HashMap<(&str, &str), Vec<&str>> = HashMap::new();
    let mut exact = HashSet::new();
    let mut duplicate_count = 0u32;

    for signature in signatures {
        match signature.kind.as_str() {
            "function" => {
                function_selectors.insert(signature.selector_key.as_str());
            }
            "event" => {
                event_topics.insert(signature.selector_key.as_str());
            }
            "error" => {
                error_selectors.insert(signature.selector_key.as_str());
            }
            _ => {}
        }
        if !exact.insert((
            signature.kind.as_str(),
            signature.selector_key.as_str(),
            signature.signature.as_str(),
        )) {
            duplicate_count += 1;
        }
        by_selector
            .entry((signature.kind.as_str(), signature.selector_key.as_str()))
            .or_default()
            .push(signature.signature.as_str());
    }

    let conflict_count = by_selector
        .values()
        .filter(|items| {
            let distinct = items.iter().copied().collect::<HashSet<_>>();
            distinct.len() > 1
        })
        .count() as u32;

    let notes = if conflict_count > 0 || duplicate_count > 0 {
        Some(sanitize_diagnostic_message(&format!(
            "duplicate selectors: {duplicate_count}; selector conflicts: {conflict_count}"
        )))
    } else {
        None
    };

    AbiSelectorSummaryRecord {
        function_selector_count: Some(function_selectors.len() as u32),
        event_topic_count: Some(event_topics.len() as u32),
        error_selector_count: Some(error_selectors.len() as u32),
        duplicate_selector_count: Some(duplicate_count),
        conflict_count: Some(conflict_count),
        notes,
    }
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string()),
        Value::Array(items) => {
            let parts = items.iter().map(canonical_json).collect::<Vec<_>>();
            format!("[{}]", parts.join(","))
        }
        Value::Object(object) => {
            let sorted = object.iter().collect::<BTreeMap<_, _>>();
            let parts = sorted
                .into_iter()
                .map(|(key, value)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_else(|_| "\"\"".to_string()),
                        canonical_json(value)
                    )
                })
                .collect::<Vec<_>>();
            format!("{{{}}}", parts.join(","))
        }
    }
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

fn persist_validated_abi(
    chain_id: u64,
    contract_address: &str,
    source_kind: &str,
    provider_config_id: Option<String>,
    user_source_id: Option<String>,
    validated: ValidatedAbiPayload,
    fetch_source_status: Option<&str>,
    diagnostics: Option<AbiProviderDiagnosticsRecord>,
    expected_fetch_provider_fingerprint: Option<&str>,
) -> Result<AbiRegistryMutationResult, String> {
    let _guard = abi_registry_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_abi_registry_state_for_update()?;
    if let Some(expected_fingerprint) = expected_fetch_provider_fingerprint {
        let Some(provider_id) = provider_config_id.as_deref() else {
            return Err("explorer ABI persistence requires providerConfigId".to_string());
        };
        if !has_current_fetch_provider_config(&state, provider_id, expected_fingerprint) {
            return Ok(stale_fetch_provider_config_result_from_state(
                state,
                diagnostics.unwrap_or_default(),
            ));
        }
    }
    write_abi_artifact(&validated.abi_hash, &validated.canonical_abi)?;

    let source_fingerprint = source_fingerprint(
        chain_id,
        contract_address,
        source_kind,
        provider_config_id.as_deref(),
        user_source_id.as_deref(),
        &validated.abi_hash,
    );
    let version_id = format!("abi-{}", validated.abi_hash.trim_start_matches("0x"));
    let attempt_id = format!(
        "attempt-{}-{}",
        now_unix_seconds()?,
        validated
            .abi_hash
            .trim_start_matches("0x")
            .chars()
            .take(12)
            .collect::<String>()
    );
    let now = now_unix_seconds()?;
    let logical_source = LogicalSourceRef {
        chain_id,
        contract_address,
        source_kind,
        provider_config_id: provider_config_id.as_deref(),
        user_source_id: user_source_id.as_deref(),
    };
    supersede_same_logical_source(&mut state, &logical_source, &version_id, &now);
    let (selected, selection_status) = selection_for_new_entry(&state, &logical_source, &validated);

    let record = AbiCacheEntryRecord {
        chain_id,
        contract_address: contract_address.to_string(),
        source_kind: source_kind.to_string(),
        provider_config_id,
        user_source_id,
        version_id: version_id.clone(),
        attempt_id,
        source_fingerprint: source_fingerprint.clone(),
        abi_hash: validated.abi_hash.clone(),
        selected,
        fetch_source_status: fetch_source_status.unwrap_or("ok").to_string(),
        validation_status: validated.validation_status.clone(),
        cache_status: "cacheFresh".to_string(),
        selection_status: selection_status.to_string(),
        function_count: Some(validated.function_count),
        event_count: Some(validated.event_count),
        error_count: Some(validated.error_count),
        selector_summary: Some(validated.selector_summary.clone()),
        fetched_at: if source_kind == "explorerFetched" {
            Some(now.clone())
        } else {
            None
        },
        imported_at: if source_kind == "explorerFetched" {
            None
        } else {
            Some(now.clone())
        },
        last_validated_at: Some(now.clone()),
        stale_after: None,
        last_error_summary: None,
        provider_proxy_hint: None,
        proxy_detected: false,
        created_at: now.clone(),
        updated_at: now,
    };

    let existing_index = cache_entry_index(
        &state.cache_entries,
        chain_id,
        contract_address,
        source_kind,
        record.provider_config_id.as_deref(),
        record.user_source_id.as_deref(),
        &version_id,
    );
    upsert_by_index(&mut state.cache_entries, existing_index, record.clone());
    if expected_fetch_provider_fingerprint.is_some() {
        if let Some(provider_id) = record.provider_config_id.as_deref() {
            update_fetch_provider_success_in_state(&mut state, provider_id)?;
        }
    }
    sort_state(&mut state);
    write_abi_registry_state(&state)?;

    let mut validation =
        validation_read_model_from_validated("ok", validated, diagnostics.unwrap_or_default());
    validation.source_fingerprint = Some(source_fingerprint);
    Ok(AbiRegistryMutationResult {
        state: into_read_state(state),
        validation,
        cache_entry: Some(record),
    })
}

fn write_abi_artifact(abi_hash: &str, canonical_abi: &str) -> Result<PathBuf, String> {
    let dir = ensure_app_dir()?.join("abi-artifacts");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = format!("{}.json", abi_hash.trim_start_matches("0x"));
    let path = dir.join(filename);
    write_file_atomic(&path, canonical_abi)?;
    Ok(path)
}

struct LogicalSourceRef<'a> {
    chain_id: u64,
    contract_address: &'a str,
    source_kind: &'a str,
    provider_config_id: Option<&'a str>,
    user_source_id: Option<&'a str>,
}

fn supersede_same_logical_source(
    state: &mut StoredAbiRegistryState,
    source: &LogicalSourceRef<'_>,
    new_version_id: &str,
    now: &str,
) {
    for entry in &mut state.cache_entries {
        if entry.chain_id == source.chain_id
            && entry.contract_address == source.contract_address
            && entry.source_kind == source.source_kind
            && entry.provider_config_id.as_deref() == source.provider_config_id
            && entry.user_source_id.as_deref() == source.user_source_id
            && entry.version_id != new_version_id
        {
            entry.selected = false;
            entry.cache_status = "versionSuperseded".to_string();
            entry.selection_status = "unselected".to_string();
            entry.updated_at = now.to_string();
        }
    }
}

fn selection_for_new_entry(
    state: &StoredAbiRegistryState,
    source: &LogicalSourceRef<'_>,
    validated: &ValidatedAbiPayload,
) -> (bool, &'static str) {
    if validated.validation_status == "selectorConflict" {
        return (false, "needsUserChoice");
    }

    let has_cross_source_selected_conflict = state.cache_entries.iter().any(|entry| {
        entry.chain_id == source.chain_id
            && entry.contract_address == source.contract_address
            && entry.selected
            && (entry.source_kind != source.source_kind
                || entry.provider_config_id.as_deref() != source.provider_config_id
                || entry.user_source_id.as_deref() != source.user_source_id)
            && entry.abi_hash != validated.abi_hash
    });

    if has_cross_source_selected_conflict {
        (false, "sourceConflict")
    } else {
        (true, "selected")
    }
}

fn source_fingerprint(
    chain_id: u64,
    contract_address: &str,
    source_kind: &str,
    provider_config_id: Option<&str>,
    user_source_id: Option<&str>,
    abi_hash: &str,
) -> String {
    hash_text(&format!(
        "{chain_id}:{contract_address}:{source_kind}:{}:{}:{abi_hash}",
        provider_config_id.unwrap_or(""),
        user_source_id.unwrap_or("")
    ))
}

fn select_fetch_provider(
    state: &StoredAbiRegistryState,
    chain_id: u64,
    provider_config_id: Option<&str>,
) -> Result<AbiDataSourceConfigRecord, (&'static str, AbiProviderDiagnosticsRecord)> {
    let candidate = if let Some(provider_config_id) = provider_config_id {
        state
            .data_sources
            .iter()
            .find(|source| source.id == provider_config_id && source.chain_id == chain_id)
    } else {
        state
            .data_sources
            .iter()
            .find(|source| source.chain_id == chain_id && source.enabled)
    };

    let Some(candidate) = candidate else {
        return Err((
            "notConfigured",
            AbiProviderDiagnosticsRecord {
                chain_id: Some(chain_id),
                failure_class: Some("notConfigured".to_string()),
                ..AbiProviderDiagnosticsRecord::default()
            },
        ));
    };
    if !candidate.enabled {
        return Err((
            "notConfigured",
            provider_diagnostics(candidate, Some("disabledProvider"), None),
        ));
    }
    Ok(candidate.clone())
}

fn fetch_provider_config_fingerprint(provider: &AbiDataSourceConfigRecord) -> String {
    hash_text(&format!(
        "{}:{}:{}:{}:{}:{}",
        provider.id,
        provider.chain_id,
        provider.provider_kind,
        provider.base_url.as_deref().unwrap_or_default(),
        provider.api_key_ref.as_deref().unwrap_or_default(),
        provider.enabled
    ))
}

fn has_current_fetch_provider_config(
    state: &StoredAbiRegistryState,
    provider_id: &str,
    expected_fingerprint: &str,
) -> bool {
    state
        .data_sources
        .iter()
        .find(|provider| provider.id == provider_id)
        .map(|provider| {
            provider.enabled && fetch_provider_config_fingerprint(provider) == expected_fingerprint
        })
        .unwrap_or(false)
}

fn stale_fetch_provider_config_result(
    provider: &AbiDataSourceConfigRecord,
) -> Result<AbiRegistryMutationResult, String> {
    let state = load_abi_registry_state()?;
    let diagnostics = provider_diagnostics(provider, Some(STALE_FETCH_PROVIDER_CONFIG_ERROR), None);
    Ok(AbiRegistryMutationResult {
        state,
        validation: failure_validation("fetchFailed", "notValidated", diagnostics, None),
        cache_entry: None,
    })
}

fn stale_fetch_provider_config_result_from_state(
    state: StoredAbiRegistryState,
    mut diagnostics: AbiProviderDiagnosticsRecord,
) -> AbiRegistryMutationResult {
    diagnostics.failure_class = Some(sanitize_diagnostic_message(
        STALE_FETCH_PROVIDER_CONFIG_ERROR,
    ));
    AbiRegistryMutationResult {
        state: into_read_state(state),
        validation: failure_validation("fetchFailed", "notValidated", diagnostics, None),
        cache_entry: None,
    }
}

#[derive(Debug, Clone)]
struct ExplorerFetchResponse {
    payload: String,
}

#[derive(Debug, Clone)]
struct ExplorerFetchError {
    status: String,
    failure_class: String,
    rate_limit_hint: Option<String>,
}

impl ExplorerFetchError {
    fn validation_status(&self) -> &'static str {
        if self.failure_class == "payloadTooLarge" {
            "payloadTooLarge"
        } else {
            "notValidated"
        }
    }
}

async fn fetch_explorer_abi_response(
    provider: &AbiDataSourceConfigRecord,
    contract_address: &str,
    api_key: Option<&str>,
) -> Result<ExplorerFetchResponse, ExplorerFetchError> {
    let base_url = provider
        .base_url
        .as_deref()
        .ok_or_else(|| ExplorerFetchError {
            status: "notConfigured".to_string(),
            failure_class: "missingBaseUrl".to_string(),
            rate_limit_hint: None,
        })?;
    let client = reqwest::Client::builder()
        .timeout(EXPLORER_ABI_REQUEST_TIMEOUT)
        .build()
        .map_err(|_| ExplorerFetchError {
            status: "fetchFailed".to_string(),
            failure_class: "clientBuildFailed".to_string(),
            rate_limit_hint: None,
        })?;
    // customIndexer providers use the same configured ABI endpoint contract here:
    // GET baseUrl?module=contract&action=getabi&address=<address>, accepting only
    // direct ABI arrays/strings or explorer-style JSON with a result field.
    let mut request = client.get(base_url).query(&[
        ("module", "contract"),
        ("action", "getabi"),
        ("address", contract_address),
    ]);
    if let Some(api_key) = api_key {
        request = request.query(&[("apikey", api_key)]);
    }
    let response = request.send().await.map_err(fetch_request_error)?;
    let status = response.status();
    if status.as_u16() == 429 {
        return Err(ExplorerFetchError {
            status: "rateLimited".to_string(),
            failure_class: "rateLimited".to_string(),
            rate_limit_hint: Some("HTTP 429".to_string()),
        });
    }
    if !status.is_success() {
        return Err(ExplorerFetchError {
            status: "fetchFailed".to_string(),
            failure_class: format!("http{}", status.as_u16()),
            rate_limit_hint: None,
        });
    }
    if response
        .content_length()
        .filter(|len| *len > EXPLORER_ABI_RESPONSE_SIZE_LIMIT_BYTES as u64)
        .is_some()
    {
        return Err(payload_too_large_fetch_error());
    }
    let text = read_response_text_limited(response, EXPLORER_ABI_RESPONSE_SIZE_LIMIT_BYTES).await?;
    classify_explorer_response_text(&text)
}

fn payload_too_large_fetch_error() -> ExplorerFetchError {
    ExplorerFetchError {
        status: "malformedResponse".to_string(),
        failure_class: "payloadTooLarge".to_string(),
        rate_limit_hint: None,
    }
}

fn fetch_request_error(error: reqwest::Error) -> ExplorerFetchError {
    ExplorerFetchError {
        status: "fetchFailed".to_string(),
        failure_class: if error.is_timeout() {
            "timeout".to_string()
        } else {
            "networkError".to_string()
        },
        rate_limit_hint: None,
    }
}

async fn read_response_text_limited(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<String, ExplorerFetchError> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| ExplorerFetchError {
        status: "fetchFailed".to_string(),
        failure_class: if error.is_timeout() {
            "timeout".to_string()
        } else {
            "responseReadFailed".to_string()
        },
        rate_limit_hint: None,
    })? {
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(payload_too_large_fetch_error());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| ExplorerFetchError {
        status: "malformedResponse".to_string(),
        failure_class: "invalidUtf8".to_string(),
        rate_limit_hint: None,
    })
}

fn classify_explorer_response_text(
    text: &str,
) -> Result<ExplorerFetchResponse, ExplorerFetchError> {
    let value = serde_json::from_str::<Value>(text).map_err(|_| ExplorerFetchError {
        status: "malformedResponse".to_string(),
        failure_class: "invalidJson".to_string(),
        rate_limit_hint: None,
    })?;
    match &value {
        Value::Array(_) | Value::String(_) => Ok(ExplorerFetchResponse {
            payload: text.to_string(),
        }),
        Value::Object(object) => {
            let message = object
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let status = object
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let result = object.get("result");
            let result_text = result.and_then(Value::as_str).unwrap_or_default();
            let combined = format!("{message} {result_text}").to_ascii_lowercase();
            if status == "0" || message.eq_ignore_ascii_case("NOTOK") {
                if combined.contains("rate") || combined.contains("limit") {
                    return Err(ExplorerFetchError {
                        status: "rateLimited".to_string(),
                        failure_class: "rateLimited".to_string(),
                        rate_limit_hint: Some("explorer rate limit".to_string()),
                    });
                }
                if combined.contains("not verified")
                    || combined.contains("source code not verified")
                    || combined.contains("contract source code")
                {
                    return Err(ExplorerFetchError {
                        status: "notVerified".to_string(),
                        failure_class: "notVerified".to_string(),
                        rate_limit_hint: None,
                    });
                }
            }
            if result.is_none() {
                return Err(ExplorerFetchError {
                    status: "malformedResponse".to_string(),
                    failure_class: "missingResult".to_string(),
                    rate_limit_hint: None,
                });
            }
            Ok(ExplorerFetchResponse {
                payload: text.to_string(),
            })
        }
        _ => Err(ExplorerFetchError {
            status: "malformedResponse".to_string(),
            failure_class: "unexpectedJsonShape".to_string(),
            rate_limit_hint: None,
        }),
    }
}

fn resolve_api_key_ref(api_key_ref: Option<&str>) -> Result<Option<String>, &'static str> {
    let Some(api_key_ref) = api_key_ref else {
        return Ok(None);
    };
    let env_name = if let Some(name) = api_key_ref.strip_prefix("env:") {
        Some(name)
    } else if let Some(name) = api_key_ref
        .strip_prefix("${")
        .and_then(|v| v.strip_suffix('}'))
    {
        Some(name)
    } else if let Some(name) = api_key_ref.strip_prefix('$') {
        Some(name)
    } else {
        None
    };
    let Some(env_name) = env_name else {
        return Err("secretStoreUnavailable");
    };
    std::env::var(env_name)
        .ok()
        .and_then(non_empty_string)
        .map(Some)
        .ok_or("missingApiKey")
}

fn update_fetch_provider_success_in_state(
    state: &mut StoredAbiRegistryState,
    provider_id: &str,
) -> Result<(), String> {
    if let Some(index) = data_source_index(&state.data_sources, provider_id) {
        let now = now_unix_seconds()?;
        let provider = &mut state.data_sources[index];
        provider.last_success_at = Some(now.clone());
        provider.last_failure_at = None;
        provider.failure_count = 0;
        provider.cooldown_until = None;
        provider.rate_limited = false;
        provider.last_error_summary = None;
        provider.updated_at = now;
    }
    Ok(())
}

fn update_fetch_provider_failure(
    provider_id: &str,
    expected_fingerprint: &str,
    status: &str,
    rate_limited: bool,
    rate_limit_hint: Option<String>,
) -> Result<bool, String> {
    let _guard = abi_registry_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_abi_registry_state_for_update()?;
    if !has_current_fetch_provider_config(&state, provider_id, expected_fingerprint) {
        return Ok(false);
    }
    if let Some(index) = data_source_index(&state.data_sources, provider_id) {
        let now = now_unix_seconds()?;
        let provider = &mut state.data_sources[index];
        provider.last_failure_at = Some(now.clone());
        provider.failure_count = provider.failure_count.saturating_add(1);
        provider.rate_limited = rate_limited;
        provider.last_error_summary = sanitize_optional(Some(match rate_limit_hint {
            Some(hint) => format!("{status}: {hint}"),
            None => status.to_string(),
        }));
        provider.updated_at = now;
        write_abi_registry_state(&state)?;
    }
    Ok(true)
}

fn provider_diagnostics(
    provider: &AbiDataSourceConfigRecord,
    failure_class: Option<&str>,
    rate_limit_hint: Option<&str>,
) -> AbiProviderDiagnosticsRecord {
    AbiProviderDiagnosticsRecord {
        provider_kind: Some(provider.provider_kind.clone()),
        chain_id: Some(provider.chain_id),
        provider_config_id: Some(provider.id.clone()),
        host: provider.base_url.as_deref().and_then(base_url_host),
        config_summary: Some(sanitize_diagnostic_message(&format!(
            "{} explorer source",
            provider.provider_kind
        ))),
        failure_class: failure_class.map(|value| sanitize_diagnostic_message(value)),
        rate_limit_hint: rate_limit_hint.map(sanitize_diagnostic_message),
    }
}

fn base_url_host(value: &str) -> Option<String> {
    let after_scheme = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))?;
    let host = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .split('@')
        .last()
        .unwrap_or_default();
    non_empty_string(host.to_string())
}

fn normalize_loaded_state(
    mut state: StoredAbiRegistryState,
) -> Result<StoredAbiRegistryState, String> {
    if state.schema_version != ABI_REGISTRY_SCHEMA_VERSION {
        return Err("unsupported ABI registry schemaVersion".to_string());
    }
    state.data_sources = state
        .data_sources
        .into_iter()
        .map(normalize_loaded_data_source)
        .collect::<Result<Vec<_>, _>>()?;
    state.cache_entries = state
        .cache_entries
        .into_iter()
        .map(normalize_loaded_cache_entry)
        .collect::<Result<Vec<_>, _>>()?;
    reject_duplicate_loaded_identities(&state)?;
    sort_state(&mut state);
    Ok(state)
}

fn into_read_state(state: StoredAbiRegistryState) -> AbiRegistryState {
    AbiRegistryState {
        schema_version: state.schema_version,
        data_sources: state.data_sources,
        cache_entries: state.cache_entries,
    }
}

fn normalize_loaded_data_source(
    record: AbiDataSourceConfigRecord,
) -> Result<AbiDataSourceConfigRecord, String> {
    let id = normalize_id(record.id, "data source id")?;
    let chain_id = normalize_chain_id(record.chain_id)?;
    let provider_kind = normalize_provider_kind(record.provider_kind)?;
    let base_url = normalize_base_url(record.base_url, &provider_kind)?;
    let api_key_ref = normalize_api_key_ref(record.api_key_ref)?;
    Ok(AbiDataSourceConfigRecord {
        id,
        chain_id,
        provider_kind,
        base_url,
        api_key_ref,
        enabled: record.enabled,
        last_success_at: record.last_success_at.and_then(non_empty_string),
        last_failure_at: record.last_failure_at.and_then(non_empty_string),
        failure_count: record.failure_count,
        cooldown_until: record.cooldown_until.and_then(non_empty_string),
        rate_limited: record.rate_limited,
        last_error_summary: sanitize_optional(record.last_error_summary),
        created_at: record.created_at.trim().to_string(),
        updated_at: record.updated_at.trim().to_string(),
    })
}

fn normalize_loaded_cache_entry(
    record: AbiCacheEntryRecord,
) -> Result<AbiCacheEntryRecord, String> {
    let chain_id = normalize_chain_id(record.chain_id)?;
    let contract_address = normalize_evm_address(&record.contract_address, "contract address")?;
    let source_kind = normalize_source_kind(record.source_kind)?;
    let (provider_config_id, user_source_id) = normalize_source_ref(
        &source_kind,
        record.provider_config_id,
        record.user_source_id,
    )?;
    let version_id = normalize_id(record.version_id, "versionId")?;
    let attempt_id = normalize_id(record.attempt_id, "attemptId")?;
    let source_fingerprint = normalize_id(record.source_fingerprint, "sourceFingerprint")?;
    let abi_hash = normalize_id(record.abi_hash, "abiHash")?;
    let fetch_source_status = normalize_status(
        record.fetch_source_status,
        FETCH_SOURCE_STATUSES,
        "fetchSourceStatus",
    )?;
    let validation_status = normalize_status(
        record.validation_status,
        VALIDATION_STATUSES,
        "validationStatus",
    )?;
    let cache_status = normalize_status(record.cache_status, CACHE_STATUSES, "cacheStatus")?;
    let selection_status = normalize_status(
        record.selection_status,
        SELECTION_STATUSES,
        "selectionStatus",
    )?;
    Ok(AbiCacheEntryRecord {
        chain_id,
        contract_address,
        source_kind,
        provider_config_id,
        user_source_id,
        version_id,
        attempt_id,
        source_fingerprint,
        abi_hash,
        selected: record.selected,
        fetch_source_status,
        validation_status,
        cache_status,
        selection_status,
        function_count: record.function_count,
        event_count: record.event_count,
        error_count: record.error_count,
        selector_summary: record.selector_summary.map(sanitize_selector_summary),
        fetched_at: record.fetched_at.and_then(non_empty_string),
        imported_at: record.imported_at.and_then(non_empty_string),
        last_validated_at: record.last_validated_at.and_then(non_empty_string),
        stale_after: record.stale_after.and_then(non_empty_string),
        last_error_summary: sanitize_optional(record.last_error_summary),
        provider_proxy_hint: sanitize_optional(record.provider_proxy_hint),
        proxy_detected: record.proxy_detected,
        created_at: record.created_at.trim().to_string(),
        updated_at: record.updated_at.trim().to_string(),
    })
}

#[derive(Debug, Clone)]
struct NormalizedCacheIdentity {
    chain_id: u64,
    contract_address: String,
    source_kind: String,
    provider_config_id: Option<String>,
    user_source_id: Option<String>,
    version_id: String,
}

fn normalize_cache_identity(
    input: AbiCacheEntryIdentityInput,
) -> Result<NormalizedCacheIdentity, String> {
    let chain_id = normalize_chain_id(input.chain_id)?;
    let contract_address = normalize_evm_address(&input.contract_address, "contract address")?;
    let source_kind = normalize_source_kind(input.source_kind)?;
    let (provider_config_id, user_source_id) =
        normalize_source_ref(&source_kind, input.provider_config_id, input.user_source_id)?;
    let version_id = normalize_id(input.version_id, "versionId")?;
    Ok(NormalizedCacheIdentity {
        chain_id,
        contract_address,
        source_kind,
        provider_config_id,
        user_source_id,
        version_id,
    })
}

fn normalize_chain_id(chain_id: u64) -> Result<u64, String> {
    if chain_id == 0 {
        return Err("chainId must be greater than zero".to_string());
    }
    Ok(chain_id)
}

fn normalize_evm_address(value: &str, label: &str) -> Result<String, String> {
    let address = Address::from_str(value.trim())
        .map_err(|_| format!("{label} must be a valid EVM address"))?;
    if address == Address::zero() {
        return Err(format!("{label} cannot be the zero address"));
    }
    Ok(to_checksum(&address, None))
}

fn normalize_id(value: String, label: &str) -> Result<String, String> {
    non_empty_string(value).ok_or_else(|| format!("{label} must be non-empty"))
}

fn normalize_provider_kind(value: String) -> Result<String, String> {
    let value = normalize_id(value, "providerKind")?;
    if SUPPORTED_PROVIDER_KINDS.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err("providerKind is unsupported for ABI data source config".to_string())
    }
}

fn normalize_source_kind(value: String) -> Result<String, String> {
    let value = normalize_id(value, "sourceKind")?;
    if SUPPORTED_SOURCE_KINDS.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err("sourceKind is unsupported for ABI cache entry".to_string())
    }
}

fn normalize_status(value: String, allowed: &[&str], label: &str) -> Result<String, String> {
    let value = normalize_id(value, label)?;
    if allowed.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(format!("{label} is unsupported"))
    }
}

fn normalize_source_ref(
    source_kind: &str,
    provider_config_id: Option<String>,
    user_source_id: Option<String>,
) -> Result<(Option<String>, Option<String>), String> {
    let provider_config_id = provider_config_id.and_then(non_empty_string);
    let user_source_id = user_source_id.and_then(sanitize_user_source_id);
    match source_kind {
        "explorerFetched" => {
            if provider_config_id.is_none() || user_source_id.is_some() {
                return Err(
                    "explorerFetched ABI cache entries require providerConfigId only".to_string(),
                );
            }
        }
        "userImported" | "userPasted" => {
            if user_source_id.is_none() || provider_config_id.is_some() {
                return Err("user ABI cache entries require userSourceId only".to_string());
            }
        }
        _ => return Err("sourceKind is unsupported for ABI cache entry".to_string()),
    }
    Ok((provider_config_id, user_source_id))
}

fn normalize_base_url(
    value: Option<String>,
    provider_kind: &str,
) -> Result<Option<String>, String> {
    let value = value.and_then(non_empty_string);
    if provider_kind == "localOnly" {
        if let Some(value) = value.as_deref() {
            validate_base_url(value)?;
        }
        return Ok(value);
    }
    let Some(value) = value else {
        return Err("baseUrl is required for ABI data source provider".to_string());
    };
    validate_base_url(&value)?;
    Ok(Some(value))
}

fn validate_base_url(value: &str) -> Result<(), String> {
    if value
        .chars()
        .any(|ch| ch.is_whitespace() || ch.is_control())
    {
        return Err("baseUrl cannot contain whitespace or control characters".to_string());
    }

    let lower = value.to_ascii_lowercase();
    let scheme_len = if lower.starts_with("https://") {
        "https://".len()
    } else if lower.starts_with("http://") {
        "http://".len()
    } else {
        return Err("baseUrl must start with http:// or https://".to_string());
    };
    let after_scheme = &value[scheme_len..];
    let authority_end = after_scheme
        .find(|ch| matches!(ch, '/' | '?' | '#'))
        .unwrap_or(after_scheme.len());
    let authority = &after_scheme[..authority_end];
    if authority.is_empty() {
        return Err("baseUrl must include a host".to_string());
    }
    if authority.contains('@') {
        return Err("baseUrl cannot contain username or password".to_string());
    }
    validate_base_url_authority(authority)?;
    let path_end = after_scheme
        .find(|ch| matches!(ch, '?' | '#'))
        .unwrap_or(after_scheme.len());
    let path = &after_scheme[authority_end..path_end];
    validate_base_url_path(path)?;
    if lower.contains('#') {
        return Err("baseUrl cannot contain a fragment".to_string());
    }
    if let Some(query_index) = lower.find('?') {
        let query = &lower[query_index + 1..];
        if query.contains("key")
            || query.contains("token")
            || query.contains("apikey")
            || query.contains("api_key")
            || query.contains("access_token")
            || query.contains("auth")
        {
            return Err("baseUrl cannot contain secret query parameters".to_string());
        }
        return Err("baseUrl cannot contain query parameters".to_string());
    }
    Ok(())
}

fn validate_base_url_authority(authority: &str) -> Result<(), String> {
    let (host, port) = if let Some(ipv6_tail) = authority.strip_prefix('[') {
        let Some(close_index) = ipv6_tail.find(']') else {
            return Err("baseUrl must include a valid host".to_string());
        };
        let host = &ipv6_tail[..close_index];
        let tail = &ipv6_tail[close_index + 1..];
        let port = if tail.is_empty() {
            None
        } else {
            Some(
                tail.strip_prefix(':')
                    .ok_or_else(|| "baseUrl must include a valid port".to_string())?,
            )
        };
        if host.is_empty()
            || !host
                .chars()
                .all(|ch| ch.is_ascii_hexdigit() || matches!(ch, ':' | '.'))
        {
            return Err("baseUrl must include a valid host".to_string());
        }
        (host, port)
    } else {
        if authority.contains('[') || authority.contains(']') {
            return Err("baseUrl must include a valid host".to_string());
        }
        let (host, port) = match authority.rsplit_once(':') {
            Some((host, port))
                if !port.is_empty() && port.chars().all(|ch| ch.is_ascii_digit()) =>
            {
                (host, Some(port))
            }
            Some(_) => return Err("baseUrl must include a valid port".to_string()),
            None => (authority, None),
        };
        if host.is_empty()
            || host.starts_with('.')
            || host.ends_with('.')
            || host.split('.').any(str::is_empty)
            || !host
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '.' | '_'))
        {
            return Err("baseUrl must include a valid host".to_string());
        }
        (host, port)
    };

    if host.is_empty() {
        return Err("baseUrl must include a host".to_string());
    }
    if let Some(port) = port {
        let port = port
            .parse::<u16>()
            .map_err(|_| "baseUrl must include a valid port".to_string())?;
        if port == 0 {
            return Err("baseUrl must include a valid port".to_string());
        }
    }
    Ok(())
}

fn validate_base_url_path(path: &str) -> Result<(), String> {
    for segment in path.split('/').filter(|segment| !segment.is_empty()) {
        let trimmed = segment.trim_matches(|ch: char| {
            !ch.is_ascii_alphanumeric() && ch != '_' && ch != '-' && ch != '='
        });
        if looks_like_secret_path_segment(trimmed) {
            return Err("baseUrl path cannot contain secret-like tokens".to_string());
        }
    }
    Ok(())
}

fn looks_like_secret_path_segment(segment: &str) -> bool {
    if segment.is_empty() {
        return false;
    }
    looks_like_secret_value(segment)
        || (segment.len() >= 32
            && segment
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'))
}

fn normalize_api_key_ref(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value.and_then(non_empty_string) else {
        return Ok(None);
    };
    validate_api_key_ref(&value)?;
    Ok(Some(value))
}

fn validate_api_key_ref(value: &str) -> Result<(), String> {
    if value
        .chars()
        .any(|ch| ch.is_whitespace() || ch.is_control())
    {
        return Err(API_KEY_REF_ERROR.to_string());
    }
    if is_shell_env_ref(value)
        || is_prefixed_secret_ref(value, "env:", true)
        || is_prefixed_secret_ref(value, "keychain:", false)
        || is_prefixed_secret_ref(value, "secret:", false)
        || is_prefixed_secret_ref(value, "keyring:", false)
        || is_prefixed_secret_ref(value, "vault:", false)
    {
        Ok(())
    } else {
        Err(API_KEY_REF_ERROR.to_string())
    }
}

fn is_shell_env_ref(value: &str) -> bool {
    if let Some(name) = value.strip_prefix('$') {
        if let Some(braced_name) = name
            .strip_prefix('{')
            .and_then(|name| name.strip_suffix('}'))
        {
            return is_env_var_name(braced_name);
        }
        return is_env_var_name(name);
    }
    false
}

fn is_prefixed_secret_ref(value: &str, prefix: &str, env_only: bool) -> bool {
    let Some(locator) = value.strip_prefix(prefix) else {
        return false;
    };
    if env_only {
        return is_env_var_name(locator);
    }
    is_secret_locator_ref(locator)
}

fn is_env_var_name(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    value.len() <= 128
        && matches!(first, 'A'..='Z' | 'a'..='z' | '_')
        && chars.all(|ch| matches!(ch, 'A'..='Z' | 'a'..='z' | '0'..='9' | '_'))
}

fn is_secret_locator_ref(value: &str) -> bool {
    if value.len() > 160 {
        return false;
    }
    let mut segment_count = 0;
    for segment in value.split('/') {
        segment_count += 1;
        if segment.is_empty()
            || segment.len() > 64
            || looks_like_secret_path_segment(segment)
            || !segment
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        {
            return false;
        }
    }
    segment_count >= 2
}

fn looks_like_secret_value(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || value.contains('=')
        || value.contains('?')
        || value.contains('&')
        || value.contains('/')
        || value.contains('\\')
        || (value.len() >= 40 && !value.chars().any(char::is_whitespace))
}

fn sanitize_selector_summary(mut value: AbiSelectorSummaryRecord) -> AbiSelectorSummaryRecord {
    value.notes = sanitize_optional(value.notes);
    value
}

fn sanitize_optional(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(sanitize_diagnostic_message)
        .and_then(non_empty_string)
}

fn sanitize_user_source_id(value: String) -> Option<String> {
    let value = non_empty_string(value)?;
    if is_safe_user_source_id(&value) {
        Some(value)
    } else {
        Some(format!(
            "user-source-{}",
            hash_text(&value)
                .trim_start_matches("0x")
                .chars()
                .take(16)
                .collect::<String>()
        ))
    }
}

fn is_safe_user_source_id(value: &str) -> bool {
    value.len() <= 96
        && !looks_like_secret_value(value)
        && !value.contains(['/', '\\', ':'])
        && !value.contains("..")
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}

fn merge_optional_string(
    incoming: Option<String>,
    existing: Option<String>,
    clear: bool,
) -> Option<String> {
    if clear {
        None
    } else if incoming.is_some() {
        incoming.and_then(non_empty_string)
    } else {
        existing
    }
}

fn merge_optional_sanitized(
    incoming: Option<String>,
    existing: Option<String>,
    clear: bool,
) -> Option<String> {
    if clear {
        None
    } else if incoming.is_some() {
        sanitize_optional(incoming)
    } else {
        existing
    }
}

fn non_empty_string(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn data_source_index(items: &[AbiDataSourceConfigRecord], id: &str) -> Option<usize> {
    items.iter().position(|item| item.id == id)
}

fn cache_entry_index(
    items: &[AbiCacheEntryRecord],
    chain_id: u64,
    contract_address: &str,
    source_kind: &str,
    provider_config_id: Option<&str>,
    user_source_id: Option<&str>,
    version_id: &str,
) -> Option<usize> {
    items.iter().position(|item| {
        item.chain_id == chain_id
            && item.contract_address == contract_address
            && item.source_kind == source_kind
            && item.provider_config_id.as_deref() == provider_config_id
            && item.user_source_id.as_deref() == user_source_id
            && item.version_id == version_id
    })
}

fn cache_entry_index_from_identity(
    items: &[AbiCacheEntryRecord],
    identity: &NormalizedCacheIdentity,
) -> Option<usize> {
    cache_entry_index(
        items,
        identity.chain_id,
        &identity.contract_address,
        &identity.source_kind,
        identity.provider_config_id.as_deref(),
        identity.user_source_id.as_deref(),
        &identity.version_id,
    )
}

fn cache_entry_matches_identity(
    entry: &AbiCacheEntryRecord,
    identity: &NormalizedCacheIdentity,
) -> bool {
    entry.chain_id == identity.chain_id
        && entry.contract_address == identity.contract_address
        && entry.source_kind == identity.source_kind
        && entry.provider_config_id == identity.provider_config_id
        && entry.user_source_id == identity.user_source_id
        && entry.version_id == identity.version_id
}

fn reject_duplicate_loaded_identities(state: &StoredAbiRegistryState) -> Result<(), String> {
    let mut data_source_ids = HashSet::new();
    for record in &state.data_sources {
        if !data_source_ids.insert(record.id.as_str()) {
            return Err("duplicate ABI data source config id".to_string());
        }
    }

    let mut cache_identities = HashSet::new();
    for record in &state.cache_entries {
        let key = (
            record.chain_id,
            record.contract_address.as_str(),
            record.source_kind.as_str(),
            record.provider_config_id.as_deref(),
            record.user_source_id.as_deref(),
            record.version_id.as_str(),
        );
        if !cache_identities.insert(key) {
            return Err("duplicate ABI cache entry identity".to_string());
        }
    }

    Ok(())
}

fn upsert_by_index<T>(items: &mut Vec<T>, index: Option<usize>, record: T) {
    if let Some(index) = index {
        items[index] = record;
    } else {
        items.push(record);
    }
}

fn sort_state(state: &mut StoredAbiRegistryState) {
    state
        .data_sources
        .sort_by(|left, right| data_source_sort_key(left).cmp(&data_source_sort_key(right)));
    state
        .cache_entries
        .sort_by(|left, right| cache_entry_sort_key(left).cmp(&cache_entry_sort_key(right)));
}

fn data_source_sort_key(record: &AbiDataSourceConfigRecord) -> (u64, &str) {
    (record.chain_id, record.id.as_str())
}

fn cache_entry_sort_key(record: &AbiCacheEntryRecord) -> (u64, &str, &str, &str, &str, &str) {
    (
        record.chain_id,
        record.contract_address.as_str(),
        record.source_kind.as_str(),
        record.provider_config_id.as_deref().unwrap_or(""),
        record.user_source_id.as_deref().unwrap_or(""),
        record.version_id.as_str(),
    )
}
