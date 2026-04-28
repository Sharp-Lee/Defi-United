use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::str::FromStr;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use ethers::types::Address;
use ethers::utils::to_checksum;
use serde::{Deserialize, Serialize};

use crate::diagnostics::sanitize_diagnostic_message;
use crate::storage::{abi_registry_path, write_file_atomic};

const ABI_REGISTRY_SCHEMA_VERSION: u8 = 1;
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

#[tauri::command]
pub fn load_abi_registry_state() -> Result<AbiRegistryState, String> {
    read_abi_registry_state().map(into_read_state)
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

fn read_abi_registry_state() -> Result<StoredAbiRegistryState, String> {
    let path = abi_registry_path()?;
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
    let user_source_id = user_source_id.and_then(non_empty_string);
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
