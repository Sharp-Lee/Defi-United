use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use ethers::middleware::SignerMiddleware;
use ethers::providers::{Http, Middleware, Provider};
use ethers::signers::Signer;
use ethers::types::{
    transaction::{
        eip1559::Eip1559TransactionRequest, eip2718::TypedTransaction, response::TransactionReceipt,
    },
    Address, Bytes, TransactionRequest, H256, U256, U64,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::accounts::derive_wallet;
use crate::diagnostics::{
    append_diagnostic_event, sanitize_diagnostic_message, DiagnosticEventInput, DiagnosticLevel,
};
use crate::models::{
    ChainOutcome, DroppedReviewSummary, Erc20TransferIntent, HistoryErrorSummary,
    HistoryRecoveryIntent, HistoryRecoveryIntentStatus, HistoryRecoveryResult,
    HistoryRecoveryResultStatus, IntentSnapshotMetadata, NonceThread, ReceiptSummary,
    ReconcileSummary, SubmissionKind, SubmissionRecord, TransactionType, TypedTransactionFields,
};
use crate::session::with_session_mnemonic;
use crate::storage::{
    history_path, history_recovery_intents_path, write_file_atomic, write_new_file_atomic,
};

pub use crate::models::{ChainOutcomeState, HistoryRecord, NativeTransferIntent};

const RECOVERED_HISTORY_RPC_URL: &str = "recovered://history-write-failed";
const ERC20_TRANSFER_SELECTOR: [u8; 4] = [0xa9, 0x05, 0x9c, 0xbb];
const ERC20_BALANCE_OF_SELECTOR: [u8; 4] = [0x70, 0xa0, 0x82, 0x31];
const ERC20_TRANSFER_SELECTOR_HEX: &str = "0xa9059cbb";
const ERC20_TRANSFER_METHOD: &str = "transfer(address,uint256)";

fn history_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HistoryStorageStatus {
    NotFound,
    Healthy,
    Corrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HistoryCorruptionType {
    PermissionDenied,
    IoError,
    JsonParseFailed,
    SchemaIncompatible,
    PartialRecordsInvalid,
}

impl HistoryCorruptionType {
    fn as_str(&self) -> &'static str {
        match self {
            Self::PermissionDenied => "permissionDenied",
            Self::IoError => "ioError",
            Self::JsonParseFailed => "jsonParseFailed",
            Self::SchemaIncompatible => "schemaIncompatible",
            Self::PartialRecordsInvalid => "partialRecordsInvalid",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStorageRawSummary {
    pub file_size_bytes: Option<u64>,
    pub modified_at: Option<String>,
    pub top_level: Option<String>,
    pub array_len: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStorageInspection {
    pub status: HistoryStorageStatus,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corruption_type: Option<HistoryCorruptionType>,
    pub readable: bool,
    pub record_count: usize,
    pub invalid_record_count: usize,
    pub invalid_record_indices: Vec<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_summary: Option<String>,
    pub raw_summary: HistoryStorageRawSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStorageQuarantineResult {
    pub quarantined_path: String,
    pub previous: HistoryStorageInspection,
    pub current: HistoryStorageInspection,
}

impl HistoryStorageInspection {
    fn healthy(path: &Path, records: usize, raw_summary: HistoryStorageRawSummary) -> Self {
        Self {
            status: HistoryStorageStatus::Healthy,
            path: path.display().to_string(),
            corruption_type: None,
            readable: true,
            record_count: records,
            invalid_record_count: 0,
            invalid_record_indices: Vec::new(),
            error_summary: None,
            raw_summary,
        }
    }

    fn not_found(path: &Path) -> Self {
        Self {
            status: HistoryStorageStatus::NotFound,
            path: path.display().to_string(),
            corruption_type: None,
            readable: false,
            record_count: 0,
            invalid_record_count: 0,
            invalid_record_indices: Vec::new(),
            error_summary: None,
            raw_summary: HistoryStorageRawSummary {
                file_size_bytes: None,
                modified_at: None,
                top_level: None,
                array_len: None,
            },
        }
    }

    fn corrupted(
        path: &Path,
        corruption_type: HistoryCorruptionType,
        readable: bool,
        error_summary: String,
        raw_summary: HistoryStorageRawSummary,
        record_count: usize,
        invalid_record_count: usize,
        invalid_record_indices: Vec<usize>,
    ) -> Self {
        Self {
            status: HistoryStorageStatus::Corrupted,
            path: path.display().to_string(),
            corruption_type: Some(corruption_type),
            readable,
            record_count,
            invalid_record_count,
            invalid_record_indices,
            error_summary: Some(error_summary),
            raw_summary,
        }
    }

    fn failure_message(&self) -> String {
        match &self.corruption_type {
            Some(kind) => format!(
                "transaction history storage is unreadable: type={}; records={}; invalidRecords={}; error={}",
                kind.as_str(),
                self.record_count,
                self.invalid_record_count,
                self.error_summary
                    .as_deref()
                    .unwrap_or("unknown history storage error")
            ),
            None => self
                .error_summary
                .clone()
                .unwrap_or_else(|| "transaction history storage is unreadable".to_string()),
        }
    }
}

fn raw_summary_for_path(path: &Path, value: Option<&Value>) -> HistoryStorageRawSummary {
    let metadata = fs::metadata(path).ok();
    let modified_at = metadata
        .as_ref()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs().to_string());
    let top_level = value.map(|value| match value {
        Value::Array(_) => "array",
        Value::Object(_) => "object",
        Value::String(_) => "string",
        Value::Number(_) => "number",
        Value::Bool(_) => "boolean",
        Value::Null => "null",
    });
    HistoryStorageRawSummary {
        file_size_bytes: metadata.map(|metadata| metadata.len()),
        modified_at,
        top_level: top_level.map(str::to_string),
        array_len: value.and_then(|value| value.as_array().map(Vec::len)),
    }
}

fn inspect_history_storage_at_path(path: &Path) -> HistoryStorageInspection {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return HistoryStorageInspection::not_found(path)
        }
        Err(error) => {
            let corruption_type = if error.kind() == ErrorKind::PermissionDenied {
                HistoryCorruptionType::PermissionDenied
            } else {
                HistoryCorruptionType::IoError
            };
            return HistoryStorageInspection::corrupted(
                path,
                corruption_type,
                false,
                error.to_string(),
                raw_summary_for_path(path, None),
                0,
                0,
                Vec::new(),
            );
        }
    };

    let value = match serde_json::from_str::<Value>(&raw) {
        Ok(value) => value,
        Err(error) => {
            return HistoryStorageInspection::corrupted(
                path,
                HistoryCorruptionType::JsonParseFailed,
                true,
                error.to_string(),
                raw_summary_for_path(path, None),
                0,
                0,
                Vec::new(),
            )
        }
    };

    let Some(array) = value.as_array() else {
        return HistoryStorageInspection::corrupted(
            path,
            HistoryCorruptionType::SchemaIncompatible,
            true,
            "transaction history root must be a JSON array".to_string(),
            raw_summary_for_path(path, Some(&value)),
            0,
            0,
            Vec::new(),
        );
    };

    let mut invalid_indices = Vec::new();
    for (index, item) in array.iter().enumerate() {
        if serde_json::from_value::<HistoryRecord>(item.clone()).is_err() {
            invalid_indices.push(index);
        }
    }

    let raw_summary = raw_summary_for_path(path, Some(&value));
    if !invalid_indices.is_empty() {
        let preview = invalid_indices.iter().take(8).copied().collect::<Vec<_>>();
        return HistoryStorageInspection::corrupted(
            path,
            HistoryCorruptionType::PartialRecordsInvalid,
            true,
            format!(
                "{} transaction history record(s) failed schema validation; first invalid indices: {:?}",
                invalid_indices.len(),
                preview
            ),
            raw_summary,
            array.len().saturating_sub(invalid_indices.len()),
            invalid_indices.len(),
            preview,
        );
    }

    HistoryStorageInspection::healthy(path, array.len(), raw_summary)
}

pub fn inspect_history_storage() -> Result<HistoryStorageInspection, String> {
    let path = history_path()?;
    let inspection = inspect_history_storage_at_path(&path);
    if inspection.status == HistoryStorageStatus::Corrupted {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "historyStorageCorruptionDetected",
            None,
            None,
            None,
            inspection.error_summary.clone(),
            json!({
                "corruptionType": inspection.corruption_type.as_ref().map(HistoryCorruptionType::as_str),
                "recordCount": inspection.record_count,
                "invalidRecordCount": inspection.invalid_record_count,
                "fileSizeBytes": inspection.raw_summary.file_size_bytes,
                "topLevel": inspection.raw_summary.top_level,
                "arrayLen": inspection.raw_summary.array_len,
            }),
        );
    }
    Ok(inspection)
}

fn unique_quarantine_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("{} has an invalid file name", path.display()))?;
    let timestamp = now_unix_seconds()?;
    for _ in 0..16 {
        let suffix = format!("{timestamp}-{:016x}", rand::thread_rng().gen::<u64>());
        let candidate = parent.join(format!("{file_name}.quarantine-{suffix}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("unable to allocate unique transaction history quarantine path".to_string())
}

fn unique_empty_history_replacement_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("{} has an invalid file name", path.display()))?;
    let timestamp = now_unix_seconds()?;
    for _ in 0..16 {
        let suffix = format!("{timestamp}-{:016x}", rand::thread_rng().gen::<u64>());
        let candidate = parent.join(format!(".{file_name}.empty-{suffix}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("unable to allocate unique transaction history replacement path".to_string())
}

pub fn quarantine_history_storage() -> Result<HistoryStorageQuarantineResult, String> {
    let _guard = history_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = history_path()?;
    let previous = inspect_history_storage_at_path(&path);
    if previous.status != HistoryStorageStatus::Corrupted {
        return Err(match previous.status {
            HistoryStorageStatus::NotFound => {
                "transaction history file is not present; nothing to quarantine".to_string()
            }
            HistoryStorageStatus::Healthy => {
                "transaction history is readable; quarantine is only available for damaged history"
                    .to_string()
            }
            HistoryStorageStatus::Corrupted => unreachable!(),
        });
    }

    let empty_history_path = unique_empty_history_replacement_path(&path)?;
    write_new_file_atomic(&empty_history_path, "[]").map_err(|error| {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "historyStorageQuarantineFailed",
            None,
            None,
            None,
            Some(error.clone()),
            json!({
                "corruptionType": previous.corruption_type.as_ref().map(HistoryCorruptionType::as_str),
                "action": "prepareEmptyHistory",
            }),
        );
        format!(
            "failed to prepare empty transaction history; original damaged history remains in place: {error}"
        )
    })?;

    let quarantined_path = unique_quarantine_path(&path)?;
    fs::rename(&path, &quarantined_path).map_err(|error| {
        let _ = fs::remove_file(&empty_history_path);
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "historyStorageQuarantineFailed",
            None,
            None,
            None,
            Some(error.to_string()),
            json!({
                "corruptionType": previous.corruption_type.as_ref().map(HistoryCorruptionType::as_str),
                "action": "renameOriginalToQuarantine",
            }),
        );
        error.to_string()
    })?;

    if let Err(error) = fs::rename(&empty_history_path, &path) {
        let rollback_result = fs::rename(&quarantined_path, &path);
        let rollback_succeeded = rollback_result.is_ok();
        let rollback_error = rollback_result.err().map(|error| error.to_string());
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "historyStorageQuarantineFailed",
            None,
            None,
            None,
            Some(error.to_string()),
            json!({
                "corruptionType": previous.corruption_type.as_ref().map(HistoryCorruptionType::as_str),
                "action": "installEmptyHistory",
                "rollbackSucceeded": rollback_succeeded,
                "rollbackError": rollback_error,
                "quarantineFileName": quarantined_path.file_name().and_then(|value| value.to_str()),
            }),
        );
        let _ = fs::remove_file(&empty_history_path);
        return Err(if rollback_succeeded {
            format!(
                "failed to install empty transaction history; original damaged history was restored: {error}"
            )
        } else {
            format!(
                "failed to install empty transaction history and could not restore original damaged history; quarantine path retained: {}; error={error}",
                quarantined_path.display()
            )
        });
    }

    let current = inspect_history_storage_at_path(&path);
    if current.status != HistoryStorageStatus::Healthy {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "historyStorageQuarantineFailed",
            None,
            None,
            None,
            current.error_summary.clone(),
            json!({
                "corruptionType": previous.corruption_type.as_ref().map(HistoryCorruptionType::as_str),
                "action": "verifyEmptyHistory",
                "quarantineFileName": quarantined_path.file_name().and_then(|value| value.to_str()),
            }),
        );
        return Err("failed to verify empty transaction history after quarantine".to_string());
    }

    record_transaction_diagnostic(
        DiagnosticLevel::Warn,
        "historyStorageQuarantined",
        None,
        None,
        None,
        previous.error_summary.clone(),
        json!({
            "corruptionType": previous.corruption_type.as_ref().map(HistoryCorruptionType::as_str),
            "action": "quarantineAndStartEmptyHistory",
            "quarantineFileName": quarantined_path.file_name().and_then(|value| value.to_str()),
            "previousRecordCount": previous.record_count,
            "previousInvalidRecordCount": previous.invalid_record_count,
        }),
    );

    Ok(HistoryStorageQuarantineResult {
        quarantined_path: quarantined_path.display().to_string(),
        previous,
        current,
    })
}

pub fn load_history_records() -> Result<Vec<HistoryRecord>, String> {
    let path = history_path()?;
    let inspection = inspect_history_storage_at_path(&path);
    match inspection.status {
        HistoryStorageStatus::NotFound => Ok(Vec::new()),
        HistoryStorageStatus::Healthy => {
            let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            serde_json::from_str(&raw).map_err(|e| e.to_string())
        }
        HistoryStorageStatus::Corrupted => Err(inspection.failure_message()),
    }
}

fn write_history_records(records: &[HistoryRecord]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    write_file_atomic(&history_path()?, &raw)
}

fn recovery_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn write_history_recovery_intents(intents: &[HistoryRecoveryIntent]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(intents).map_err(|e| e.to_string())?;
    write_file_atomic(&history_recovery_intents_path()?, &raw)
}

pub fn load_history_recovery_intents() -> Result<Vec<HistoryRecoveryIntent>, String> {
    let path = history_recovery_intents_path()?;
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<Vec<HistoryRecoveryIntent>>(&raw)
            .map(|intents| {
                intents
                    .into_iter()
                    .map(sanitize_loaded_history_recovery_intent)
                    .collect()
            })
            .map_err(|e| e.to_string()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn sanitize_loaded_history_recovery_intent(
    mut intent: HistoryRecoveryIntent,
) -> HistoryRecoveryIntent {
    intent.write_error = sanitize_recovery_error(&intent.write_error);
    intent.last_recovery_error = intent
        .last_recovery_error
        .as_deref()
        .map(sanitize_recovery_error);
    intent
}

fn history_recovery_intent_id(
    chain_id: Option<u64>,
    account_index: Option<u32>,
    from: Option<&str>,
    nonce: Option<u64>,
    tx_hash: &str,
) -> String {
    format!(
        "broadcast:{}:{}:{}:{}:{}",
        chain_id
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        account_index
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        from.map(str::to_ascii_lowercase)
            .unwrap_or_else(|| "unknown".to_string()),
        nonce
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        tx_hash.to_ascii_lowercase()
    )
}

fn history_recovery_intent_from_broadcast_failure(
    intent: &NativeTransferIntent,
    tx_hash: String,
    kind: SubmissionKind,
    replaces_tx_hash: Option<String>,
    broadcasted_at: String,
    write_error: String,
) -> Result<HistoryRecoveryIntent, String> {
    history_recovery_intent_from_broadcast_failure_with_frozen_key(
        intent,
        tx_hash,
        kind,
        replaces_tx_hash,
        broadcasted_at,
        write_error,
        None,
    )
}

fn history_recovery_intent_from_broadcast_failure_with_frozen_key(
    intent: &NativeTransferIntent,
    tx_hash: String,
    kind: SubmissionKind,
    replaces_tx_hash: Option<String>,
    broadcasted_at: String,
    write_error: String,
    frozen_key_override: Option<String>,
) -> Result<HistoryRecoveryIntent, String> {
    let created_at = now_unix_seconds()?;
    let id = history_recovery_intent_id(
        Some(intent.chain_id),
        Some(intent.account_index),
        Some(&intent.from),
        Some(intent.nonce),
        &tx_hash,
    );
    Ok(HistoryRecoveryIntent {
        schema_version: 1,
        id,
        status: HistoryRecoveryIntentStatus::Active,
        created_at,
        tx_hash: tx_hash.clone(),
        kind: kind.clone(),
        chain_id: Some(intent.chain_id),
        account_index: Some(intent.account_index),
        from: Some(intent.from.clone()),
        nonce: Some(intent.nonce),
        to: Some(intent.to.clone()),
        value_wei: Some(intent.value_wei.clone()),
        token_contract: intent.typed_transaction.token_contract.clone(),
        recipient: intent.typed_transaction.recipient.clone(),
        amount_raw: intent.typed_transaction.amount_raw.clone(),
        decimals: intent.typed_transaction.decimals,
        token_symbol: intent.typed_transaction.token_symbol.clone(),
        token_name: intent.typed_transaction.token_name.clone(),
        token_metadata_source: intent.typed_transaction.token_metadata_source.clone(),
        selector: intent.typed_transaction.selector.clone(),
        method_name: intent.typed_transaction.method_name.clone(),
        native_value_wei: intent.typed_transaction.native_value_wei.clone(),
        frozen_key: Some(frozen_key_override.unwrap_or_else(|| {
            submission_record_from_intent(
                intent,
                tx_hash.clone(),
                broadcasted_at.clone(),
                kind.clone(),
                replaces_tx_hash.clone(),
            )
            .frozen_key
        })),
        gas_limit: Some(intent.gas_limit.clone()),
        max_fee_per_gas: Some(intent.max_fee_per_gas.clone()),
        max_priority_fee_per_gas: Some(intent.max_priority_fee_per_gas.clone()),
        replaces_tx_hash,
        broadcasted_at,
        write_error: sanitize_recovery_error(&write_error),
        last_recovery_error: None,
        recovered_at: None,
        dismissed_at: None,
    })
}

fn sanitize_recovery_error(error: &str) -> String {
    sanitize_diagnostic_message(error)
}

pub fn record_history_recovery_intent(intent: HistoryRecoveryIntent) -> Result<(), String> {
    let _guard = recovery_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut intents = load_history_recovery_intents()?;
    if let Some(existing) = intents.iter_mut().find(|item| item.id == intent.id) {
        let recovered_at = existing.recovered_at.clone();
        let dismissed_at = existing.dismissed_at.clone();
        *existing = intent;
        existing.recovered_at = recovered_at;
        existing.dismissed_at = dismissed_at;
        if existing.recovered_at.is_some() {
            existing.status = HistoryRecoveryIntentStatus::Recovered;
        }
        if existing.dismissed_at.is_some() {
            existing.status = HistoryRecoveryIntentStatus::Dismissed;
        }
    } else {
        intents.push(intent);
    }
    write_history_recovery_intents(&intents)
}

fn update_history_recovery_intent(
    recovery_id: &str,
    updater: impl FnOnce(&mut HistoryRecoveryIntent),
) -> Result<HistoryRecoveryIntent, String> {
    let _guard = recovery_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut intents = load_history_recovery_intents()?;
    let Some(index) = intents.iter().position(|item| item.id == recovery_id) else {
        return Err(format!("history recovery intent not found: {recovery_id}"));
    };
    updater(&mut intents[index]);
    let updated = intents[index].clone();
    write_history_recovery_intents(&intents)?;
    Ok(updated)
}

pub fn dismiss_history_recovery_intent(
    recovery_id: &str,
) -> Result<Vec<HistoryRecoveryIntent>, String> {
    update_history_recovery_intent(recovery_id, |intent| {
        intent.status = HistoryRecoveryIntentStatus::Dismissed;
        intent.dismissed_at = now_unix_seconds().ok();
    })?;
    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "historyRecoveryIntentDismissed",
        None,
        None,
        None,
        None,
        json!({ "recoveryId": recovery_id }),
    );
    load_history_recovery_intents()
}

fn record_transaction_diagnostic(
    level: DiagnosticLevel,
    event: &'static str,
    chain_id: Option<u64>,
    account_index: Option<u32>,
    tx_hash: Option<String>,
    message: Option<String>,
    metadata: serde_json::Value,
) {
    append_diagnostic_event(DiagnosticEventInput {
        level,
        category: "transaction",
        source: "transactions",
        event,
        chain_id,
        account_index,
        tx_hash,
        message,
        metadata,
    });
}

fn record_native_transfer_error(
    intent: &NativeTransferIntent,
    event: &'static str,
    error: String,
    metadata: serde_json::Value,
) -> String {
    record_transaction_diagnostic(
        DiagnosticLevel::Error,
        event,
        Some(intent.chain_id),
        Some(intent.account_index),
        None,
        Some(error.clone()),
        metadata,
    );
    error
}

fn parse_native_transfer_address(
    intent: &NativeTransferIntent,
    field: &'static str,
    value: &str,
    event: &'static str,
) -> Result<Address, String> {
    value.parse::<Address>().map_err(|e| {
        record_native_transfer_error(
            intent,
            event,
            format!("{e}"),
            json!({ "field": field, "nonce": intent.nonce }),
        )
    })
}

fn parse_native_transfer_u256(
    intent: &NativeTransferIntent,
    field: &'static str,
    value: &str,
    event: &'static str,
) -> Result<U256, String> {
    U256::from_dec_str(value).map_err(|e| {
        record_native_transfer_error(
            intent,
            event,
            e.to_string(),
            json!({ "field": field, "nonce": intent.nonce }),
        )
    })
}

pub fn build_erc20_transfer_calldata(recipient: Address, amount: U256) -> Bytes {
    let mut data = Vec::with_capacity(68);
    data.extend_from_slice(&ERC20_TRANSFER_SELECTOR);
    data.extend_from_slice(&[0u8; 12]);
    data.extend_from_slice(recipient.as_bytes());
    let mut amount_word = [0u8; 32];
    amount.to_big_endian(&mut amount_word);
    data.extend_from_slice(&amount_word);
    Bytes::from(data)
}

fn build_erc20_balance_of_calldata(owner: Address) -> Bytes {
    let mut data = Vec::with_capacity(36);
    data.extend_from_slice(&ERC20_BALANCE_OF_SELECTOR);
    data.extend_from_slice(&[0u8; 12]);
    data.extend_from_slice(owner.as_bytes());
    Bytes::from(data)
}

fn native_intent_from_erc20_intent(intent: &Erc20TransferIntent) -> NativeTransferIntent {
    NativeTransferIntent {
        typed_transaction: TypedTransactionFields::erc20_transfer(
            intent.token_contract.clone(),
            intent.recipient.clone(),
            intent.amount_raw.clone(),
            intent.decimals,
            intent.token_symbol.clone(),
            intent.token_name.clone(),
            intent.token_metadata_source.clone(),
        ),
        rpc_url: summarize_rpc_endpoint(&intent.rpc_url),
        account_index: intent.account_index,
        chain_id: intent.chain_id,
        from: intent.from.clone(),
        to: intent.token_contract.clone(),
        value_wei: "0".to_string(),
        nonce: intent.nonce,
        gas_limit: intent.gas_limit.clone(),
        max_fee_per_gas: intent.max_fee_per_gas.clone(),
        max_priority_fee_per_gas: intent.max_priority_fee_per_gas.clone(),
    }
}

fn sanitized_erc20_history_intent(intent: &NativeTransferIntent) -> NativeTransferIntent {
    let mut sanitized = intent.clone();
    sanitized.rpc_url = summarize_rpc_endpoint(&intent.rpc_url);
    sanitized
}

fn erc20_frozen_key_from_submit_intent(intent: &Erc20TransferIntent) -> String {
    [
        format!("chainId={}", intent.chain_id),
        format!("from={}", intent.from),
        format!("tokenContract={}", intent.token_contract),
        format!("recipient={}", intent.recipient),
        format!("amountRaw={}", intent.amount_raw),
        format!("decimals={}", intent.decimals),
        format!("metadataSource={}", intent.token_metadata_source),
        format!("nonce={}", intent.nonce),
        format!("gasLimit={}", intent.gas_limit),
        format!(
            "latestBaseFee={}",
            intent
                .latest_base_fee_per_gas
                .as_deref()
                .unwrap_or("unavailable")
        ),
        format!("baseFee={}", intent.base_fee_per_gas),
        format!("baseFeeMultiplier={}", intent.base_fee_multiplier),
        format!("maxFee={}", intent.max_fee_per_gas),
        format!(
            "maxFeeOverride={}",
            intent.max_fee_override_per_gas.as_deref().unwrap_or("auto")
        ),
        format!("priorityFee={}", intent.max_priority_fee_per_gas),
        format!("selector={}", intent.selector),
        format!("method={}", intent.method),
        format!("nativeValueWei={}", intent.native_value_wei),
    ]
    .join("|")
}

fn erc20_submit_intent_from_native_intent(
    intent: &NativeTransferIntent,
    frozen_key: String,
) -> Result<Erc20TransferIntent, String> {
    let typed = &intent.typed_transaction;
    Ok(Erc20TransferIntent {
        rpc_url: intent.rpc_url.clone(),
        account_index: intent.account_index,
        chain_id: intent.chain_id,
        from: intent.from.clone(),
        token_contract: typed
            .token_contract
            .clone()
            .unwrap_or_else(|| intent.to.clone()),
        recipient: typed
            .recipient
            .clone()
            .ok_or_else(|| "ERC-20 intent missing recipient".to_string())?,
        amount_raw: typed
            .amount_raw
            .clone()
            .ok_or_else(|| "ERC-20 intent missing amount_raw".to_string())?,
        decimals: typed
            .decimals
            .ok_or_else(|| "ERC-20 intent missing decimals".to_string())?,
        token_symbol: typed.token_symbol.clone(),
        token_name: typed.token_name.clone(),
        token_metadata_source: typed
            .token_metadata_source
            .clone()
            .unwrap_or_else(|| "unknown".to_string()),
        nonce: intent.nonce,
        gas_limit: intent.gas_limit.clone(),
        max_fee_per_gas: intent.max_fee_per_gas.clone(),
        max_priority_fee_per_gas: intent.max_priority_fee_per_gas.clone(),
        latest_base_fee_per_gas: None,
        base_fee_per_gas: "0".to_string(),
        base_fee_multiplier: "unknown".to_string(),
        max_fee_override_per_gas: None,
        selector: typed
            .selector
            .clone()
            .unwrap_or_else(|| ERC20_TRANSFER_SELECTOR_HEX.to_string()),
        method: typed
            .method_name
            .clone()
            .unwrap_or_else(|| ERC20_TRANSFER_METHOD.to_string()),
        native_value_wei: typed
            .native_value_wei
            .clone()
            .unwrap_or_else(|| "0".to_string()),
        frozen_key,
    })
}

fn now_unix_seconds() -> Result<String, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string())
}

pub fn nonce_thread_key(chain_id: u64, account_index: u32, from: &str, nonce: u64) -> String {
    format!(
        "{}:{}:{}:{}",
        chain_id,
        account_index,
        from.to_lowercase(),
        nonce
    )
}

fn submission_record_from_intent(
    intent: &NativeTransferIntent,
    tx_hash: String,
    broadcasted_at: String,
    kind: SubmissionKind,
    replaces_tx_hash: Option<String>,
) -> SubmissionRecord {
    let frozen_key = if intent.typed_transaction.transaction_type == TransactionType::Erc20Transfer
    {
        format!(
            "{}:{}:{}:{}:{}:{}:{}:{}",
            intent.chain_id,
            intent.from,
            intent
                .typed_transaction
                .token_contract
                .as_deref()
                .unwrap_or(&intent.to),
            intent
                .typed_transaction
                .recipient
                .as_deref()
                .unwrap_or("unknown"),
            intent
                .typed_transaction
                .amount_raw
                .as_deref()
                .unwrap_or("unknown"),
            intent
                .typed_transaction
                .decimals
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            intent.nonce,
            ERC20_TRANSFER_SELECTOR_HEX
        )
    } else {
        format!(
            "{}:{}:{}:{}:{}",
            intent.chain_id, intent.from, intent.to, intent.value_wei, intent.nonce
        )
    };

    SubmissionRecord {
        typed_transaction: intent.typed_transaction.clone(),
        frozen_key,
        tx_hash,
        kind,
        source: "submission".to_string(),
        chain_id: Some(intent.chain_id),
        account_index: Some(intent.account_index),
        from: Some(intent.from.clone()),
        to: Some(intent.to.clone()),
        value_wei: Some(intent.value_wei.clone()),
        nonce: Some(intent.nonce),
        gas_limit: Some(intent.gas_limit.clone()),
        max_fee_per_gas: Some(intent.max_fee_per_gas.clone()),
        max_priority_fee_per_gas: Some(intent.max_priority_fee_per_gas.clone()),
        broadcasted_at: Some(broadcasted_at),
        replaces_tx_hash,
    }
}

fn nonce_thread_from_intent(
    intent: &NativeTransferIntent,
    replaces_tx_hash: Option<String>,
) -> NonceThread {
    NonceThread {
        source: "derived".to_string(),
        key: nonce_thread_key(
            intent.chain_id,
            intent.account_index,
            &intent.from,
            intent.nonce,
        ),
        chain_id: Some(intent.chain_id),
        account_index: Some(intent.account_index),
        from: Some(intent.from.clone()),
        nonce: Some(intent.nonce),
        replaces_tx_hash,
        replaced_by_tx_hash: None,
    }
}

pub fn persist_pending_history(
    intent: NativeTransferIntent,
    tx_hash: String,
) -> Result<HistoryRecord, String> {
    persist_pending_history_with_kind(intent, tx_hash, SubmissionKind::NativeTransfer, None)
}

pub fn persist_pending_history_with_kind(
    intent: NativeTransferIntent,
    tx_hash: String,
    kind: SubmissionKind,
    replaces_tx_hash: Option<String>,
) -> Result<HistoryRecord, String> {
    let broadcasted_at = now_unix_seconds()?;
    persist_pending_history_with_kind_at(intent, tx_hash, kind, replaces_tx_hash, broadcasted_at)
}

fn persist_pending_history_with_kind_at(
    intent: NativeTransferIntent,
    tx_hash: String,
    kind: SubmissionKind,
    replaces_tx_hash: Option<String>,
    broadcasted_at: String,
) -> Result<HistoryRecord, String> {
    let _guard = history_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let submission = submission_record_from_intent(
        &intent,
        tx_hash.clone(),
        broadcasted_at.clone(),
        kind,
        replaces_tx_hash.clone(),
    );
    let nonce_thread = nonce_thread_from_intent(&intent, replaces_tx_hash);

    let record = HistoryRecord {
        schema_version: 2,
        intent_snapshot: IntentSnapshotMetadata {
            source: "nativeTransferIntent".to_string(),
            captured_at: Some(broadcasted_at),
        },
        intent,
        submission,
        outcome: ChainOutcome {
            state: ChainOutcomeState::Pending,
            tx_hash,
            receipt: None,
            finalized_at: None,
            reconciled_at: None,
            reconcile_summary: None,
            error_summary: None,
            dropped_review_history: Vec::new(),
        },
        nonce_thread,
    };

    let mut records = load_history_records()?;
    records.push(record.clone());
    if let Err(error) = write_history_records(&records) {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "pendingHistoryWriteFailed",
            Some(record.intent.chain_id),
            Some(record.intent.account_index),
            Some(record.submission.tx_hash.clone()),
            Some(error.clone()),
            json!({ "kind": record.submission.kind }),
        );
        return Err(error);
    }
    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "pendingHistoryWriteSucceeded",
        Some(record.intent.chain_id),
        Some(record.intent.account_index),
        Some(record.submission.tx_hash.clone()),
        None,
        json!({ "kind": record.submission.kind }),
    );

    Ok(record)
}

pub fn mark_prior_history_state(
    tx_hash: &str,
    next_state: ChainOutcomeState,
) -> Result<(), String> {
    mark_prior_history_state_with_replacement(tx_hash, next_state, None)
}

pub fn mark_prior_history_state_with_replacement(
    tx_hash: &str,
    next_state: ChainOutcomeState,
    replaced_by_tx_hash: Option<String>,
) -> Result<(), String> {
    let _guard = history_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut records = load_history_records()?;

    let Some(record_index) = records
        .iter()
        .position(|record| record.outcome.tx_hash == tx_hash)
    else {
        return Err(format!(
            "pending history record not found for tx_hash {tx_hash}"
        ));
    };

    if records[record_index].outcome.state != ChainOutcomeState::Pending {
        return Err(format!(
            "history record for tx_hash {tx_hash} is not pending"
        ));
    }

    let marked_at = now_unix_seconds()?;
    let decision = match next_state {
        ChainOutcomeState::Replaced => "markedReplacedByLocalSubmission",
        ChainOutcomeState::Cancelled => "markedCancelledByLocalSubmission",
        _ => "markedByLocalHistoryMutation",
    };
    let diagnostic_chain_id;
    let diagnostic_account_index;
    let diagnostic_tx_hash;
    let diagnostic_state;
    let diagnostic_replaced_by_tx_hash;
    {
        let record = &mut records[record_index];
        record.outcome.state = next_state;
        record.outcome.reconcile_summary = Some(ReconcileSummary {
            source: "localHistoryMutation".to_string(),
            checked_at: Some(marked_at),
            rpc_chain_id: None,
            latest_confirmed_nonce: None,
            decision: decision.to_string(),
        });
        record.nonce_thread.replaced_by_tx_hash = replaced_by_tx_hash;
        diagnostic_chain_id = record.intent.chain_id;
        diagnostic_account_index = record.intent.account_index;
        diagnostic_tx_hash = record.outcome.tx_hash.clone();
        diagnostic_state = record.outcome.state.clone();
        diagnostic_replaced_by_tx_hash = record.nonce_thread.replaced_by_tx_hash.clone();
    }
    if let Err(error) = write_history_records(&records) {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "pendingHistoryMarkFailed",
            Some(diagnostic_chain_id),
            Some(diagnostic_account_index),
            Some(diagnostic_tx_hash.clone()),
            Some(error.clone()),
            json!({ "nextState": diagnostic_state, "replacedByTxHash": diagnostic_replaced_by_tx_hash }),
        );
        return Err(error);
    }
    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "pendingHistoryMarked",
        Some(diagnostic_chain_id),
        Some(diagnostic_account_index),
        Some(diagnostic_tx_hash),
        None,
        json!({ "nextState": diagnostic_state, "replacedByTxHash": diagnostic_replaced_by_tx_hash }),
    );
    Ok(())
}

pub fn broadcast_history_write_error(tx_hash: &str, error: &str) -> String {
    format!(
        "transaction broadcast but local history write failed; tx_hash={tx_hash}; error={error}"
    )
}

fn erc20_broadcast_history_write_error(
    tx_hash: &str,
    intent: &Erc20TransferIntent,
    error: &str,
) -> String {
    format!(
        "ERC-20 transaction broadcast but local history write failed; tx_hash={tx_hash}; chainId={}; accountIndex={}; from={}; nonce={}; tokenContract={}; recipient={}; amountRaw={}; decimals={}; selector={}; method={}; frozenKey={}; error={error}",
        intent.chain_id,
        intent.account_index,
        intent.from,
        intent.nonce,
        intent.token_contract,
        intent.recipient,
        intent.amount_raw,
        intent.decimals,
        intent.selector,
        intent.method,
        intent.frozen_key,
    )
}

fn erc20_history_intent_broadcast_history_write_error(
    tx_hash: &str,
    intent: &NativeTransferIntent,
    frozen_key: &str,
    error: &str,
) -> String {
    format!(
        "ERC-20 transaction broadcast but local history write failed; tx_hash={tx_hash}; chainId={}; accountIndex={}; from={}; nonce={}; tokenContract={}; recipient={}; amountRaw={}; decimals={}; selector={}; method={}; frozenKey={}; error={error}",
        intent.chain_id,
        intent.account_index,
        intent.from,
        intent.nonce,
        intent
            .typed_transaction
            .token_contract
            .as_deref()
            .unwrap_or(&intent.to),
        intent
            .typed_transaction
            .recipient
            .as_deref()
            .unwrap_or("unknown"),
        intent
            .typed_transaction
            .amount_raw
            .as_deref()
            .unwrap_or("unknown"),
        intent
            .typed_transaction
            .decimals
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        intent
            .typed_transaction
            .selector
            .as_deref()
            .unwrap_or(ERC20_TRANSFER_SELECTOR_HEX),
        intent
            .typed_transaction
            .method_name
            .as_deref()
            .unwrap_or(ERC20_TRANSFER_METHOD),
        frozen_key,
    )
}

pub fn chain_outcome_from_receipt_status(status: Option<U64>) -> ChainOutcomeState {
    match status.map(|value| value.as_u64()) {
        Some(1) => ChainOutcomeState::Confirmed,
        Some(_) => ChainOutcomeState::Failed,
        None => ChainOutcomeState::Pending,
    }
}

pub fn dropped_state_for_missing_receipt(
    record: &HistoryRecord,
    latest_confirmed_nonce: u64,
) -> Option<ChainOutcomeState> {
    let identity = history_identity_for_record(record);
    if record.outcome.state == ChainOutcomeState::Pending && identity.nonce < latest_confirmed_nonce
    {
        Some(ChainOutcomeState::Dropped)
    } else {
        None
    }
}

#[derive(Debug, Clone)]
pub(crate) struct HistoryIdentity {
    pub(crate) source: &'static str,
    pub(crate) chain_id: u64,
    pub(crate) account_index: u32,
    pub(crate) from: String,
    pub(crate) nonce: u64,
}

fn submission_identity(record: &HistoryRecord) -> Option<HistoryIdentity> {
    Some(HistoryIdentity {
        source: "submission",
        chain_id: record.submission.chain_id?,
        account_index: record.submission.account_index?,
        from: record.submission.from.clone()?,
        nonce: record.submission.nonce?,
    })
}

fn nonce_thread_identity(record: &HistoryRecord) -> Option<HistoryIdentity> {
    Some(HistoryIdentity {
        source: "nonce_thread",
        chain_id: record.nonce_thread.chain_id?,
        account_index: record.nonce_thread.account_index?,
        from: record.nonce_thread.from.clone()?,
        nonce: record.nonce_thread.nonce?,
    })
}

pub(crate) fn history_identity_for_record(record: &HistoryRecord) -> HistoryIdentity {
    submission_identity(record)
        .or_else(|| nonce_thread_identity(record))
        .unwrap_or_else(|| HistoryIdentity {
            source: "intent",
            chain_id: record.intent.chain_id,
            account_index: record.intent.account_index,
            from: record.intent.from.clone(),
            nonce: record.intent.nonce,
        })
}

pub fn next_nonce_with_pending_history(
    records: &[HistoryRecord],
    chain_id: u64,
    account_index: u32,
    from: &str,
    on_chain_nonce: u64,
) -> u64 {
    records
        .iter()
        .filter(|record| {
            let identity = history_identity_for_record(record);
            record.outcome.state == ChainOutcomeState::Pending
                && identity.chain_id == chain_id
                && identity.account_index == account_index
                && identity.from.eq_ignore_ascii_case(from)
        })
        .fold(on_chain_nonce, |next_nonce, record| {
            let identity = history_identity_for_record(record);
            next_nonce.max(identity.nonce.saturating_add(1))
        })
}

#[derive(Debug, Clone)]
pub struct HistoryUpdate {
    pub tx_hash: String,
    pub next_state: ChainOutcomeState,
    pub receipt: Option<ReceiptSummary>,
    pub finalized_at: Option<String>,
    pub reconciled_at: Option<String>,
    pub reconcile_summary: Option<ReconcileSummary>,
    pub error_summary: Option<HistoryErrorSummary>,
}

impl HistoryUpdate {
    pub fn state_only(tx_hash: String, next_state: ChainOutcomeState) -> Self {
        Self {
            tx_hash,
            next_state,
            receipt: None,
            finalized_at: None,
            reconciled_at: None,
            reconcile_summary: None,
            error_summary: None,
        }
    }
}

pub fn apply_pending_history_updates(
    chain_id: u64,
    updates: &[(String, ChainOutcomeState)],
) -> Result<Vec<HistoryRecord>, String> {
    let updates = updates
        .iter()
        .map(|(tx_hash, next_state)| HistoryUpdate::state_only(tx_hash.clone(), next_state.clone()))
        .collect::<Vec<_>>();
    apply_pending_history_update_details(chain_id, &updates)
}

pub fn apply_pending_history_update_details(
    chain_id: u64,
    updates: &[HistoryUpdate],
) -> Result<Vec<HistoryRecord>, String> {
    if updates.is_empty() {
        return load_history_records();
    }

    let _guard = history_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut records = load_history_records()?;
    for record in &mut records {
        let identity = history_identity_for_record(record);
        if identity.chain_id != chain_id || record.outcome.state != ChainOutcomeState::Pending {
            continue;
        }
        if let Some(update) = updates
            .iter()
            .find(|update| update.tx_hash == record.outcome.tx_hash)
        {
            record.outcome.state = update.next_state.clone();
            if update.receipt.is_some() {
                record.outcome.receipt = update.receipt.clone();
            }
            if update.finalized_at.is_some() {
                record.outcome.finalized_at = update.finalized_at.clone();
            }
            if update.reconciled_at.is_some() {
                record.outcome.reconciled_at = update.reconciled_at.clone();
            }
            if update.reconcile_summary.is_some() {
                record.outcome.reconcile_summary = update.reconcile_summary.clone();
            }
            if update.error_summary.is_some() {
                record.outcome.error_summary = update.error_summary.clone();
            }
        }
    }
    if let Err(error) = write_history_records(&records) {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "reconcileHistoryWriteFailed",
            Some(chain_id),
            None,
            None,
            Some(error.clone()),
            json!({ "updateCount": updates.len() }),
        );
        return Err(error);
    }
    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "reconcileHistoryWriteSucceeded",
        Some(chain_id),
        None,
        None,
        None,
        json!({ "updateCount": updates.len() }),
    );
    Ok(records)
}

fn receipt_summary(receipt: &TransactionReceipt) -> ReceiptSummary {
    ReceiptSummary {
        status: receipt.status.map(|value| value.as_u64()),
        block_number: receipt.block_number.map(|value| value.as_u64()),
        block_hash: receipt.block_hash.map(|value| format!("{value:#x}")),
        transaction_index: Some(receipt.transaction_index.as_u64()),
        gas_used: receipt.gas_used.map(|value| value.to_string()),
        effective_gas_price: receipt.effective_gas_price.map(|value| value.to_string()),
    }
}

fn history_record_matches_tx_hash(record: &HistoryRecord, tx_hash: &str) -> bool {
    record.outcome.tx_hash.eq_ignore_ascii_case(tx_hash)
        || record.submission.tx_hash.eq_ignore_ascii_case(tx_hash)
}

fn require_dropped_review_identity(record: &HistoryRecord) -> Result<HistoryIdentity, String> {
    let tx_hash = record.submission.tx_hash.trim();
    if tx_hash.is_empty() || tx_hash == "unknown" {
        return Err("dropped review requires frozen submission tx_hash".to_string());
    }
    Ok(HistoryIdentity {
        source: "submission",
        chain_id: record
            .submission
            .chain_id
            .ok_or_else(|| "dropped review requires frozen submission chain_id".to_string())?,
        account_index: record
            .submission
            .account_index
            .ok_or_else(|| "dropped review requires frozen submission account_index".to_string())?,
        from: record
            .submission
            .from
            .as_ref()
            .filter(|value| !value.trim().is_empty())
            .cloned()
            .ok_or_else(|| "dropped review requires frozen submission from".to_string())?,
        nonce: record
            .submission
            .nonce
            .ok_or_else(|| "dropped review requires frozen submission nonce".to_string())?,
    })
}

fn history_error_summary(source: &str, category: &str, message: &str) -> HistoryErrorSummary {
    HistoryErrorSummary {
        source: source.to_string(),
        category: category.to_string(),
        message: sanitize_diagnostic_message(message),
    }
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

fn dropped_review_summary(
    record: &HistoryRecord,
    reviewed_at: String,
    rpc_endpoint_summary: String,
    requested_chain_id: Option<u64>,
    rpc_chain_id: Option<u64>,
    latest_confirmed_nonce: Option<u64>,
    transaction_found: Option<bool>,
    local_same_nonce_tx_hash: Option<String>,
    local_same_nonce_state: Option<ChainOutcomeState>,
    result_state: ChainOutcomeState,
    receipt: Option<ReceiptSummary>,
    decision: &str,
    recommendation: &str,
    error_summary: Option<HistoryErrorSummary>,
) -> DroppedReviewSummary {
    DroppedReviewSummary {
        reviewed_at,
        source: "droppedManualReview".to_string(),
        tx_hash: record.submission.tx_hash.clone(),
        rpc_endpoint_summary,
        requested_chain_id,
        rpc_chain_id,
        latest_confirmed_nonce,
        transaction_found,
        local_same_nonce_tx_hash,
        local_same_nonce_state,
        original_state: record.outcome.state.clone(),
        original_finalized_at: record.outcome.finalized_at.clone(),
        original_reconciled_at: record.outcome.reconciled_at.clone(),
        original_reconcile_summary: record.outcome.reconcile_summary.clone(),
        result_state,
        receipt,
        decision: decision.to_string(),
        recommendation: recommendation.to_string(),
        error_summary,
    }
}

fn local_same_nonce_review_result(
    record: &HistoryRecord,
    records: &[HistoryRecord],
) -> Option<(ChainOutcomeState, String, String)> {
    let identity = require_dropped_review_identity(record).ok()?;
    let target_hash = &record.submission.tx_hash;
    let explicit_replacement = record
        .nonce_thread
        .replaced_by_tx_hash
        .as_ref()
        .filter(|value| !value.trim().is_empty());

    records.iter().find_map(|candidate| {
        if history_record_matches_tx_hash(candidate, target_hash) {
            return None;
        }
        let candidate_identity =
            submission_identity(candidate).or_else(|| nonce_thread_identity(candidate))?;
        if candidate_identity.chain_id != identity.chain_id
            || candidate_identity.account_index != identity.account_index
            || !candidate_identity.from.eq_ignore_ascii_case(&identity.from)
            || candidate_identity.nonce != identity.nonce
        {
            return None;
        }

        let candidate_hash = candidate.submission.tx_hash.clone();
        let is_explicit = explicit_replacement
            .is_some_and(|replacement| replacement.eq_ignore_ascii_case(&candidate_hash))
            || candidate
                .submission
                .replaces_tx_hash
                .as_ref()
                .is_some_and(|replaces| replaces.eq_ignore_ascii_case(target_hash))
            || candidate
                .nonce_thread
                .replaces_tx_hash
                .as_ref()
                .is_some_and(|replaces| replaces.eq_ignore_ascii_case(target_hash));
        if !is_explicit {
            return None;
        }

        match candidate.submission.kind {
            SubmissionKind::Cancellation => Some((
                ChainOutcomeState::Cancelled,
                candidate_hash,
                "localCancellationSameNonce".to_string(),
            )),
            SubmissionKind::Replacement
            | SubmissionKind::NativeTransfer
            | SubmissionKind::Erc20Transfer => Some((
                ChainOutcomeState::Replaced,
                candidate_hash,
                "localReplacementSameNonce".to_string(),
            )),
            SubmissionKind::Legacy | SubmissionKind::Unsupported => None,
        }
    })
}

fn apply_dropped_review_result(
    tx_hash: &str,
    identity: &HistoryIdentity,
    mut review: DroppedReviewSummary,
) -> Result<Vec<HistoryRecord>, String> {
    let _guard = history_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut records = load_history_records()?;
    let Some(record_index) = records
        .iter()
        .position(|record| history_record_matches_tx_hash(record, tx_hash))
    else {
        return Err(format!(
            "dropped history record not found for tx_hash {tx_hash}"
        ));
    };

    if records[record_index].outcome.state != ChainOutcomeState::Dropped {
        return Err(format!(
            "history record for tx_hash {tx_hash} is no longer dropped"
        ));
    }
    let locked_identity = require_dropped_review_identity(&records[record_index])?;
    if locked_identity.chain_id != identity.chain_id
        || locked_identity.account_index != identity.account_index
        || !locked_identity.from.eq_ignore_ascii_case(&identity.from)
        || locked_identity.nonce != identity.nonce
    {
        return Err("dropped review frozen submission identity changed before write".to_string());
    }

    if matches!(
        review.result_state,
        ChainOutcomeState::Replaced | ChainOutcomeState::Cancelled
    ) {
        match local_same_nonce_review_result(&records[record_index], &records) {
            Some((fresh_state, fresh_hash, fresh_decision)) => {
                review.result_state = fresh_state.clone();
                review.local_same_nonce_tx_hash = Some(fresh_hash);
                review.local_same_nonce_state = Some(fresh_state);
                review.decision = fresh_decision;
                review.recommendation = "Fresh local same-nonce transaction history still identifies the dropped record as superseded; no mempool inference was used.".to_string();
            }
            None => {
                review.result_state = ChainOutcomeState::Dropped;
                review.local_same_nonce_tx_hash = None;
                review.local_same_nonce_state = None;
                review.decision = "staleLocalSameNonceRelation".to_string();
                review.recommendation = "Local same-nonce relation changed before the review write; outcome remains uncertain/still dropped.".to_string();
            }
        }
    }

    let record = &mut records[record_index];
    review.original_state = record.outcome.state.clone();
    review.original_finalized_at = record.outcome.finalized_at.clone();
    review.original_reconciled_at = record.outcome.reconciled_at.clone();
    review.original_reconcile_summary = record.outcome.reconcile_summary.clone();
    record.outcome.dropped_review_history.push(review.clone());

    if review.result_state != ChainOutcomeState::Dropped {
        record.outcome.state = review.result_state.clone();
        if review.receipt.is_some() {
            record.outcome.receipt = review.receipt.clone();
        }
        record.outcome.finalized_at = Some(review.reviewed_at.clone());
        record.outcome.reconciled_at = Some(review.reviewed_at.clone());
        record.outcome.reconcile_summary = Some(ReconcileSummary {
            source: review.source.clone(),
            checked_at: Some(review.reviewed_at.clone()),
            rpc_chain_id: review.rpc_chain_id,
            latest_confirmed_nonce: review.latest_confirmed_nonce,
            decision: review.decision.clone(),
        });
        record.outcome.error_summary = None;
    }

    write_history_records(&records)?;
    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "droppedReviewHistoryWriteSucceeded",
        Some(identity.chain_id),
        Some(identity.account_index),
        Some(tx_hash.to_string()),
        None,
        json!({
            "decision": review.decision,
            "resultState": format!("{:?}", review.result_state),
            "rpcChainId": review.rpc_chain_id,
        }),
    );
    Ok(records)
}

pub async fn review_dropped_history_record(
    tx_hash: String,
    rpc_url: String,
    requested_chain_id: u64,
) -> Result<Vec<HistoryRecord>, String> {
    let (record, records_snapshot) = {
        let _guard = history_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let records = load_history_records()?;
        let Some(record) = records
            .iter()
            .find(|record| history_record_matches_tx_hash(record, &tx_hash))
            .cloned()
        else {
            return Err(format!(
                "dropped history record not found for tx_hash {tx_hash}"
            ));
        };
        (record, records)
    };

    if record.outcome.state != ChainOutcomeState::Dropped {
        return Err(format!(
            "history record for tx_hash {tx_hash} is not dropped"
        ));
    }
    let identity = require_dropped_review_identity(&record)?;
    let checked_at = now_unix_seconds()?;
    let rpc_endpoint_summary = summarize_rpc_endpoint(&rpc_url);

    if requested_chain_id != identity.chain_id {
        let error = format!(
            "requested chainId {requested_chain_id} does not match frozen submission chainId {}",
            identity.chain_id
        );
        record_transaction_diagnostic(
            DiagnosticLevel::Warn,
            "droppedReviewRequestedChainIdMismatch",
            Some(identity.chain_id),
            Some(identity.account_index),
            Some(record.submission.tx_hash.clone()),
            Some(error.clone()),
            json!({ "requestedChainId": requested_chain_id }),
        );
        let review = dropped_review_summary(
            &record,
            checked_at,
            rpc_endpoint_summary.clone(),
            Some(requested_chain_id),
            None,
            None,
            None,
            None,
            None,
            ChainOutcomeState::Dropped,
            None,
            "requestedChainIdMismatch",
            "Select an RPC for the frozen submission chainId and run dropped review again.",
            Some(history_error_summary(
                "droppedManualReview",
                "chainIdMismatch",
                &error,
            )),
        );
        return apply_dropped_review_result(&tx_hash, &identity, review);
    }

    let provider = match Provider::<Http>::try_from(rpc_url) {
        Ok(provider) => provider,
        Err(error) => {
            let message = sanitize_diagnostic_message(&error.to_string());
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "droppedReviewProviderInvalid",
                Some(identity.chain_id),
                Some(identity.account_index),
                Some(record.submission.tx_hash.clone()),
                Some(message.clone()),
                json!({}),
            );
            let review = dropped_review_summary(
                &record,
                checked_at,
                rpc_endpoint_summary.clone(),
                Some(requested_chain_id),
                None,
                None,
                None,
                None,
                None,
                ChainOutcomeState::Dropped,
                None,
                "rpcProviderInvalid",
                "RPC was unavailable before review could verify chain state; fix the endpoint and review again.",
                Some(history_error_summary(
                    "droppedManualReview",
                    "rpcUnavailable",
                    &message,
                )),
            );
            return apply_dropped_review_result(&tx_hash, &identity, review);
        }
    };

    let remote_chain_id = match provider.get_chainid().await {
        Ok(chain_id) => chain_id.as_u64(),
        Err(error) => {
            let message = sanitize_diagnostic_message(&error.to_string());
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "droppedReviewChainIdProbeFailed",
                Some(identity.chain_id),
                Some(identity.account_index),
                Some(record.submission.tx_hash.clone()),
                Some(message.clone()),
                json!({}),
            );
            let review = dropped_review_summary(
                &record,
                checked_at,
                rpc_endpoint_summary.clone(),
                Some(requested_chain_id),
                None,
                None,
                None,
                None,
                None,
                ChainOutcomeState::Dropped,
                None,
                "rpcChainIdProbeFailed",
                "RPC chainId could not be verified; no outcome was changed.",
                Some(history_error_summary(
                    "droppedManualReview",
                    "rpcUnavailable",
                    &message,
                )),
            );
            return apply_dropped_review_result(&tx_hash, &identity, review);
        }
    };

    if remote_chain_id != identity.chain_id {
        let error = format!(
            "remote chainId {remote_chain_id} does not match frozen submission chainId {}",
            identity.chain_id
        );
        record_transaction_diagnostic(
            DiagnosticLevel::Warn,
            "droppedReviewChainIdMismatch",
            Some(identity.chain_id),
            Some(identity.account_index),
            Some(record.submission.tx_hash.clone()),
            Some(error.clone()),
            json!({ "remoteChainId": remote_chain_id }),
        );
        let review = dropped_review_summary(
            &record,
            checked_at,
            rpc_endpoint_summary.clone(),
            Some(requested_chain_id),
            Some(remote_chain_id),
            None,
            None,
            None,
            None,
            ChainOutcomeState::Dropped,
            None,
            "rpcChainIdMismatch",
            "Use an RPC endpoint for the frozen submission chainId; no outcome was changed.",
            Some(history_error_summary(
                "droppedManualReview",
                "chainIdMismatch",
                &error,
            )),
        );
        return apply_dropped_review_result(&tx_hash, &identity, review);
    }

    let parsed_hash = match record.submission.tx_hash.parse::<H256>() {
        Ok(hash) => hash,
        Err(error) => {
            let message = sanitize_diagnostic_message(&error.to_string());
            let review = dropped_review_summary(
                &record,
                checked_at,
                rpc_endpoint_summary.clone(),
                Some(requested_chain_id),
                Some(remote_chain_id),
                None,
                None,
                None,
                None,
                ChainOutcomeState::Dropped,
                None,
                "txHashInvalid",
                "The frozen transaction hash is invalid, so this dropped record cannot be reviewed safely.",
                Some(history_error_summary(
                    "droppedManualReview",
                    "invalidIdentity",
                    &message,
                )),
            );
            return apply_dropped_review_result(&tx_hash, &identity, review);
        }
    };

    let receipt = match provider.get_transaction_receipt(parsed_hash).await {
        Ok(receipt) => receipt,
        Err(error) => {
            let message = sanitize_diagnostic_message(&error.to_string());
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "droppedReviewReceiptLookupFailed",
                Some(identity.chain_id),
                Some(identity.account_index),
                Some(record.submission.tx_hash.clone()),
                Some(message.clone()),
                json!({}),
            );
            let review = dropped_review_summary(
                &record,
                checked_at,
                rpc_endpoint_summary.clone(),
                Some(requested_chain_id),
                Some(remote_chain_id),
                None,
                None,
                None,
                None,
                ChainOutcomeState::Dropped,
                None,
                "receiptLookupFailed",
                "Receipt lookup failed; no outcome was changed.",
                Some(history_error_summary(
                    "droppedManualReview",
                    "rpcUnavailable",
                    &message,
                )),
            );
            return apply_dropped_review_result(&tx_hash, &identity, review);
        }
    };

    if let Some(receipt) = receipt {
        let next_state = match receipt.status.map(|value| value.as_u64()) {
            Some(1) => ChainOutcomeState::Confirmed,
            Some(_) => ChainOutcomeState::Failed,
            None => ChainOutcomeState::Dropped,
        };
        let receipt = receipt_summary(&receipt);
        let decision = format!(
            "receiptStatus{}",
            receipt
                .status
                .map(|value| value.to_string())
                .unwrap_or_else(|| "Unknown".to_string())
        );
        let recommendation = match next_state {
            ChainOutcomeState::Confirmed => {
                "Receipt is confirmed; ChainOutcome was updated while retaining the original dropped audit."
            }
            ChainOutcomeState::Failed => {
                "Receipt is failed on chain; ChainOutcome was updated while retaining the original dropped audit."
            }
            _ => {
                "Receipt was found, but its status is unknown; outcome remains uncertain/still dropped."
            }
        };
        let review = dropped_review_summary(
            &record,
            checked_at,
            rpc_endpoint_summary.clone(),
            Some(requested_chain_id),
            Some(remote_chain_id),
            None,
            None,
            None,
            None,
            next_state,
            Some(receipt),
            &decision,
            recommendation,
            None,
        );
        return apply_dropped_review_result(&tx_hash, &identity, review);
    }

    let transaction_found = match provider.get_transaction(parsed_hash).await {
        Ok(transaction) => Some(transaction.is_some()),
        Err(error) => {
            let message = sanitize_diagnostic_message(&error.to_string());
            record_transaction_diagnostic(
                DiagnosticLevel::Warn,
                "droppedReviewTransactionLookupFailed",
                Some(identity.chain_id),
                Some(identity.account_index),
                Some(record.submission.tx_hash.clone()),
                Some(message.clone()),
                json!({}),
            );
            None
        }
    };

    let latest_confirmed_nonce = match identity.from.parse::<Address>() {
        Ok(from) => match provider.get_transaction_count(from, None).await {
            Ok(nonce) => Some(nonce.as_u64()),
            Err(error) => {
                let message = sanitize_diagnostic_message(&error.to_string());
                record_transaction_diagnostic(
                    DiagnosticLevel::Warn,
                    "droppedReviewNonceLookupFailed",
                    Some(identity.chain_id),
                    Some(identity.account_index),
                    Some(record.submission.tx_hash.clone()),
                    Some(message),
                    json!({}),
                );
                None
            }
        },
        Err(error) => {
            let message = sanitize_diagnostic_message(&error.to_string());
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "droppedReviewFromAddressInvalid",
                Some(identity.chain_id),
                Some(identity.account_index),
                Some(record.submission.tx_hash.clone()),
                Some(message),
                json!({}),
            );
            None
        }
    };

    if let Some((state, local_hash, decision)) =
        local_same_nonce_review_result(&record, &records_snapshot)
    {
        let review = dropped_review_summary(
            &record,
            checked_at,
            rpc_endpoint_summary.clone(),
            Some(requested_chain_id),
            Some(remote_chain_id),
            latest_confirmed_nonce,
            transaction_found,
            Some(local_hash),
            Some(state.clone()),
            state,
            None,
            &decision,
            "Local same-nonce transaction history identifies the dropped record as superseded; no mempool inference was used.",
            None,
        );
        return apply_dropped_review_result(&tx_hash, &identity, review);
    }

    let (decision, recommendation) = match (transaction_found, latest_confirmed_nonce) {
        (Some(true), _) => (
            "transactionFoundReceiptMissing",
            "Transaction is visible by hash but has no receipt yet; outcome remains uncertain/still dropped.",
        ),
        (Some(false), Some(nonce)) if identity.nonce < nonce => (
            "stillMissingReceiptNonceAdvanced",
            "Receipt is still missing and account nonce has advanced; outcome remains uncertain/still dropped, not failed.",
        ),
        (Some(false), Some(_)) => (
            "stillMissingReceiptNonceNotAdvanced",
            "Receipt is still missing and account nonce has not advanced past this nonce; outcome remains uncertain/still dropped.",
        ),
        (Some(false), None) => (
            "stillMissingReceiptNonceUnknown",
            "Receipt and transaction are missing, but nonce lookup failed; outcome remains uncertain/still dropped.",
        ),
        (None, Some(_)) => (
            "transactionLookupUnknown",
            "Transaction lookup failed, but nonce was checked; outcome remains uncertain/still dropped.",
        ),
        (None, None) => (
            "rpcLookupsIncomplete",
            "Transaction and nonce lookups were incomplete; outcome remains uncertain/still dropped.",
        ),
    };
    let review = dropped_review_summary(
        &record,
        checked_at,
        rpc_endpoint_summary.clone(),
        Some(requested_chain_id),
        Some(remote_chain_id),
        latest_confirmed_nonce,
        transaction_found,
        None,
        None,
        ChainOutcomeState::Dropped,
        None,
        decision,
        recommendation,
        None,
    );
    apply_dropped_review_result(&tx_hash, &identity, review)
}

pub async fn reconcile_pending_history(
    rpc_url: String,
    chain_id: u64,
) -> Result<Vec<HistoryRecord>, String> {
    let provider = Provider::<Http>::try_from(rpc_url).map_err(|e| {
        let error = e.to_string();
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "reconcileProviderInvalid",
            Some(chain_id),
            None,
            None,
            Some(error.clone()),
            json!({ "stage": "provider" }),
        );
        error
    })?;
    let remote_chain_id = provider.get_chainid().await.map_err(|e| {
        let error = e.to_string();
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "reconcileChainIdProbeFailed",
            Some(chain_id),
            None,
            None,
            Some(error.clone()),
            json!({}),
        );
        error
    })?;
    if remote_chain_id.as_u64() != chain_id {
        let error = format!(
            "remote chainId {} does not match requested chainId {}",
            remote_chain_id, chain_id
        );
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "reconcileChainIdMismatch",
            Some(chain_id),
            None,
            None,
            Some(error.clone()),
            json!({ "remoteChainId": remote_chain_id.as_u64() }),
        );
        return Err(error);
    }

    let records = load_history_records()?;
    let pending_records = records
        .iter()
        .filter(|record| {
            let identity = history_identity_for_record(record);
            identity.chain_id == chain_id && record.outcome.state == ChainOutcomeState::Pending
        })
        .cloned()
        .collect::<Vec<_>>();

    let pending_count = pending_records.len();
    let checked_at = now_unix_seconds()?;
    let mut updates = Vec::new();
    for record in pending_records {
        let tx_hash = record.outcome.tx_hash.clone();
        let parsed_hash = tx_hash.parse::<H256>().map_err(|e| {
            let error = format!("{e}");
            let identity = history_identity_for_record(&record);
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "reconcileTxHashInvalid",
                Some(identity.chain_id),
                Some(identity.account_index),
                Some(tx_hash.clone()),
                Some(error.clone()),
                json!({}),
            );
            error
        })?;
        if let Some(receipt) = provider
            .get_transaction_receipt(parsed_hash)
            .await
            .map_err(|e| {
                let error = e.to_string();
                let identity = history_identity_for_record(&record);
                record_transaction_diagnostic(
                    DiagnosticLevel::Error,
                    "reconcileReceiptLookupFailed",
                    Some(identity.chain_id),
                    Some(identity.account_index),
                    Some(tx_hash.clone()),
                    Some(error.clone()),
                    json!({}),
                );
                error
            })?
        {
            let next_state = chain_outcome_from_receipt_status(receipt.status);
            if next_state != ChainOutcomeState::Pending {
                let decision = format!(
                    "receiptStatus{}",
                    receipt
                        .status
                        .map(|value| value.as_u64().to_string())
                        .unwrap_or_else(|| "unknown".to_string())
                );
                updates.push(HistoryUpdate {
                    tx_hash,
                    next_state,
                    receipt: Some(receipt_summary(&receipt)),
                    finalized_at: Some(checked_at.clone()),
                    reconciled_at: Some(checked_at.clone()),
                    reconcile_summary: Some(ReconcileSummary {
                        source: "rpcReceipt".to_string(),
                        checked_at: Some(checked_at.clone()),
                        rpc_chain_id: Some(chain_id),
                        latest_confirmed_nonce: None,
                        decision,
                    }),
                    error_summary: None,
                });
            }
            continue;
        }

        let identity = history_identity_for_record(&record);
        let from = identity.from.parse::<Address>().map_err(|e| {
            let error = format!("{e}");
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "reconcileFromAddressInvalid",
                Some(identity.chain_id),
                Some(identity.account_index),
                Some(tx_hash.clone()),
                Some(error.clone()),
                json!({ "identitySource": identity.source }),
            );
            error
        })?;
        let latest_confirmed_nonce = provider
            .get_transaction_count(from, None)
            .await
            .map_err(|e| {
                let error = e.to_string();
                record_transaction_diagnostic(
                    DiagnosticLevel::Error,
                    "reconcileNonceLookupFailed",
                    Some(identity.chain_id),
                    Some(identity.account_index),
                    Some(tx_hash.clone()),
                    Some(error.clone()),
                    json!({}),
                );
                error
            })?
            .as_u64();
        if let Some(next_state) = dropped_state_for_missing_receipt(&record, latest_confirmed_nonce)
        {
            updates.push(HistoryUpdate {
                tx_hash,
                next_state,
                receipt: None,
                finalized_at: Some(checked_at.clone()),
                reconciled_at: Some(checked_at.clone()),
                reconcile_summary: Some(ReconcileSummary {
                    source: "rpcNonce".to_string(),
                    checked_at: Some(checked_at.clone()),
                    rpc_chain_id: Some(chain_id),
                    latest_confirmed_nonce: Some(latest_confirmed_nonce),
                    decision: "missingReceiptNonceAdvanced".to_string(),
                }),
                error_summary: None,
            });
        }
    }

    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "reconcilePendingHistoryChecked",
        Some(chain_id),
        None,
        None,
        None,
        json!({ "pendingCount": pending_count, "updateCount": updates.len() }),
    );
    apply_pending_history_update_details(chain_id, &updates)
}

fn require_recovery_u64(value: Option<u64>, field: &str) -> Result<u64, String> {
    value.ok_or_else(|| format!("history recovery intent missing {field}"))
}

fn require_recovery_u32(value: Option<u32>, field: &str) -> Result<u32, String> {
    value.ok_or_else(|| format!("history recovery intent missing {field}"))
}

fn require_recovery_string(value: &Option<String>, field: &str) -> Result<String, String> {
    value
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| format!("history recovery intent missing {field}"))
}

fn history_record_matches_recovery_intent(
    record: &HistoryRecord,
    intent: &HistoryRecoveryIntent,
) -> bool {
    let identity = history_identity_for_record(record);
    Some(identity.chain_id) == intent.chain_id
        && Some(identity.account_index) == intent.account_index
        && intent
            .from
            .as_deref()
            .is_some_and(|from| identity.from.eq_ignore_ascii_case(from))
        && Some(identity.nonce) == intent.nonce
        && record.outcome.tx_hash.eq_ignore_ascii_case(&intent.tx_hash)
}

fn history_record_from_recovery_intent(
    intent: &HistoryRecoveryIntent,
    outcome_state: ChainOutcomeState,
    receipt: Option<ReceiptSummary>,
    checked_at: String,
    decision: String,
) -> Result<HistoryRecord, String> {
    let chain_id = require_recovery_u64(intent.chain_id, "chainId")?;
    let account_index = require_recovery_u32(intent.account_index, "account/from")?;
    let from = require_recovery_string(&intent.from, "account/from")?;
    let nonce = require_recovery_u64(intent.nonce, "nonce")?;
    let to = intent.to.clone().unwrap_or_else(|| "unknown".to_string());
    let value_wei = intent
        .value_wei
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let gas_limit = intent
        .gas_limit
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let max_fee_per_gas = intent
        .max_fee_per_gas
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let max_priority_fee_per_gas = intent
        .max_priority_fee_per_gas
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let is_erc20 = intent.kind == SubmissionKind::Erc20Transfer
        || intent.token_contract.is_some()
        || intent.amount_raw.is_some();
    let typed_transaction = if is_erc20 {
        TypedTransactionFields {
            transaction_type: TransactionType::Erc20Transfer,
            token_contract: intent.token_contract.clone().or_else(|| Some(to.clone())),
            recipient: intent.recipient.clone(),
            amount_raw: intent.amount_raw.clone(),
            decimals: intent.decimals,
            token_symbol: intent.token_symbol.clone(),
            token_name: intent.token_name.clone(),
            token_metadata_source: intent.token_metadata_source.clone(),
            selector: intent
                .selector
                .clone()
                .or_else(|| Some(ERC20_TRANSFER_SELECTOR_HEX.to_string())),
            method_name: intent
                .method_name
                .clone()
                .or_else(|| Some(ERC20_TRANSFER_METHOD.to_string())),
            native_value_wei: intent
                .native_value_wei
                .clone()
                .or_else(|| Some("0".to_string())),
        }
    } else {
        TypedTransactionFields::native_transfer(value_wei.clone())
    };
    let frozen_key = intent.frozen_key.clone().unwrap_or_else(|| {
        if is_erc20 {
            format!(
                "{}:{}:{}:{}:{}:{}:{}:{}",
                chain_id,
                from,
                typed_transaction.token_contract.as_deref().unwrap_or(&to),
                typed_transaction.recipient.as_deref().unwrap_or("unknown"),
                typed_transaction.amount_raw.as_deref().unwrap_or("unknown"),
                typed_transaction
                    .decimals
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "unknown".to_string()),
                nonce,
                typed_transaction
                    .selector
                    .as_deref()
                    .unwrap_or(ERC20_TRANSFER_SELECTOR_HEX)
            )
        } else {
            format!("{chain_id}:{from}:{to}:{value_wei}:{nonce}")
        }
    });
    let finalized_at = match outcome_state {
        ChainOutcomeState::Confirmed | ChainOutcomeState::Failed => Some(checked_at.clone()),
        _ => None,
    };
    let intent_snapshot = IntentSnapshotMetadata {
        source: "historyRecoveryIntent".to_string(),
        captured_at: Some(intent.created_at.clone()),
    };
    let native_intent = NativeTransferIntent {
        typed_transaction: typed_transaction.clone(),
        rpc_url: RECOVERED_HISTORY_RPC_URL.to_string(),
        account_index,
        chain_id,
        from: from.clone(),
        to: to.clone(),
        value_wei: value_wei.clone(),
        nonce,
        gas_limit: gas_limit.clone(),
        max_fee_per_gas: max_fee_per_gas.clone(),
        max_priority_fee_per_gas: max_priority_fee_per_gas.clone(),
    };
    Ok(HistoryRecord {
        schema_version: 2,
        intent: native_intent,
        intent_snapshot,
        submission: SubmissionRecord {
            typed_transaction,
            frozen_key,
            tx_hash: intent.tx_hash.clone(),
            kind: intent.kind.clone(),
            source: "historyRecoveryIntent".to_string(),
            chain_id: Some(chain_id),
            account_index: Some(account_index),
            from: Some(from.clone()),
            to: intent.to.clone(),
            value_wei: intent.value_wei.clone(),
            nonce: Some(nonce),
            gas_limit: intent.gas_limit.clone(),
            max_fee_per_gas: intent.max_fee_per_gas.clone(),
            max_priority_fee_per_gas: intent.max_priority_fee_per_gas.clone(),
            broadcasted_at: Some(intent.broadcasted_at.clone()),
            replaces_tx_hash: intent.replaces_tx_hash.clone(),
        },
        outcome: ChainOutcome {
            state: outcome_state,
            tx_hash: intent.tx_hash.clone(),
            receipt,
            finalized_at,
            reconciled_at: Some(checked_at.clone()),
            reconcile_summary: Some(ReconcileSummary {
                source: "historyRecovery".to_string(),
                checked_at: Some(checked_at),
                rpc_chain_id: Some(chain_id),
                latest_confirmed_nonce: None,
                decision,
            }),
            error_summary: None,
            dropped_review_history: Vec::new(),
        },
        nonce_thread: NonceThread {
            source: "historyRecoveryIntent".to_string(),
            key: nonce_thread_key(chain_id, account_index, &from, nonce),
            chain_id: Some(chain_id),
            account_index: Some(account_index),
            from: Some(from),
            nonce: Some(nonce),
            replaces_tx_hash: intent.replaces_tx_hash.clone(),
            replaced_by_tx_hash: None,
        },
    })
}

fn mark_history_recovery_intent_recovered(
    recovery_id: &str,
) -> Result<HistoryRecoveryIntent, String> {
    update_history_recovery_intent(recovery_id, |intent| {
        intent.status = HistoryRecoveryIntentStatus::Recovered;
        intent.recovered_at = now_unix_seconds().ok();
        intent.last_recovery_error = None;
    })
}

fn mark_history_recovery_intent_error(recovery_id: &str, error: String) {
    let sanitized = sanitize_recovery_error(&error);
    let _ = update_history_recovery_intent(recovery_id, |intent| {
        intent.last_recovery_error = Some(sanitized);
    });
}

fn mark_recovery_intent_recovered_or_error(
    recovery_id: &str,
    tx_hash: &str,
) -> Result<HistoryRecoveryIntent, String> {
    mark_history_recovery_intent_recovered(recovery_id).map_err(|error| {
        let error = sanitize_recovery_error(&error);
        let message = format!(
            "local history record for tx_hash {tx_hash} was written or already existed, but recovery intent could not be marked recovered; no duplicate history record will be written on retry: {error}"
        );
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "historyRecoveryIntentMarkRecoveredFailed",
            None,
            None,
            Some(tx_hash.to_string()),
            Some(message.clone()),
            json!({ "recoveryId": recovery_id }),
        );
        message
    })
}

fn finalize_recovered_history_record(
    intent: &HistoryRecoveryIntent,
    recovered_record: HistoryRecord,
) -> Result<
    (
        HistoryRecoveryResultStatus,
        HistoryRecord,
        Vec<HistoryRecord>,
        String,
    ),
    String,
> {
    let _guard = history_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut records = load_history_records()?;
    if let Some(existing) = records
        .iter()
        .find(|record| history_record_matches_recovery_intent(record, intent))
        .cloned()
    {
        return Ok((
            HistoryRecoveryResultStatus::AlreadyRecovered,
            existing,
            records,
            "Matching local history record already exists; no duplicate was written.".to_string(),
        ));
    }

    records.push(recovered_record.clone());
    if let Err(error) = write_history_records(&records) {
        return Err(sanitize_recovery_error(&error));
    }
    Ok((
        HistoryRecoveryResultStatus::Recovered,
        recovered_record,
        records,
        "Recovered local history from the transaction receipt.".to_string(),
    ))
}

pub async fn recover_broadcasted_history_record(
    recovery_id: String,
    rpc_url: String,
    chain_id: u64,
) -> Result<HistoryRecoveryResult, String> {
    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "historyRecoveryStarted",
        Some(chain_id),
        None,
        None,
        None,
        json!({ "recoveryId": recovery_id }),
    );
    let intent = load_history_recovery_intents()?
        .into_iter()
        .find(|intent| intent.id == recovery_id)
        .ok_or_else(|| format!("history recovery intent not found: {recovery_id}"))?;
    let frozen_chain_id = require_recovery_u64(intent.chain_id, "chainId")?;
    let account_index = require_recovery_u32(intent.account_index, "account/from")?;
    require_recovery_string(&intent.from, "account/from")?;
    require_recovery_u64(intent.nonce, "nonce")?;
    if intent.tx_hash.trim().is_empty() {
        return Err("history recovery intent missing tx hash".to_string());
    }
    if frozen_chain_id != chain_id {
        let error = sanitize_recovery_error(&format!(
            "history recovery chainId {} does not match requested chainId {}",
            frozen_chain_id, chain_id
        ));
        mark_history_recovery_intent_error(&recovery_id, error.clone());
        return Err(error);
    }
    if intent.status == HistoryRecoveryIntentStatus::Dismissed {
        return Err("history recovery intent has been dismissed".to_string());
    }

    if let Some(existing) = load_history_records()?
        .iter()
        .find(|record| history_record_matches_recovery_intent(record, &intent))
        .cloned()
    {
        let updated_intent =
            mark_recovery_intent_recovered_or_error(&recovery_id, &intent.tx_hash)?;
        let history = load_history_records()?;
        record_transaction_diagnostic(
            DiagnosticLevel::Info,
            "historyRecoveryAlreadyRecovered",
            Some(chain_id),
            Some(account_index),
            Some(intent.tx_hash.clone()),
            None,
            json!({ "recoveryId": recovery_id }),
        );
        return Ok(HistoryRecoveryResult {
            status: HistoryRecoveryResultStatus::AlreadyRecovered,
            intent: updated_intent,
            record: existing,
            history,
            message: "Matching local history record already exists; no duplicate was written."
                .to_string(),
        });
    }

    let provider = Provider::<Http>::try_from(rpc_url.clone()).map_err(|e| {
        let error = sanitize_recovery_error(&e.to_string());
        mark_history_recovery_intent_error(&recovery_id, error.clone());
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "historyRecoveryProviderInvalid",
            Some(chain_id),
            Some(account_index),
            Some(intent.tx_hash.clone()),
            Some(error.clone()),
            json!({ "recoveryId": recovery_id }),
        );
        error
    })?;
    let remote_chain_id = provider.get_chainid().await.map_err(|e| {
        let error = sanitize_recovery_error(&e.to_string());
        mark_history_recovery_intent_error(&recovery_id, error.clone());
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "historyRecoveryChainIdProbeFailed",
            Some(chain_id),
            Some(account_index),
            Some(intent.tx_hash.clone()),
            Some(error.clone()),
            json!({ "recoveryId": recovery_id }),
        );
        error
    })?;
    if remote_chain_id.as_u64() != chain_id {
        let error = sanitize_recovery_error(&format!(
            "remote chainId {} does not match requested chainId {}",
            remote_chain_id, chain_id
        ));
        mark_history_recovery_intent_error(&recovery_id, error.clone());
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "historyRecoveryChainIdMismatch",
            Some(chain_id),
            Some(account_index),
            Some(intent.tx_hash.clone()),
            Some(error.clone()),
            json!({ "remoteChainId": remote_chain_id.as_u64(), "recoveryId": recovery_id }),
        );
        return Err(error);
    }

    let parsed_hash = intent.tx_hash.parse::<H256>().map_err(|e| {
        let error = sanitize_recovery_error(&format!("{e}"));
        mark_history_recovery_intent_error(&recovery_id, error.clone());
        error
    })?;
    let checked_at = now_unix_seconds()?;
    let receipt = provider
        .get_transaction_receipt(parsed_hash)
        .await
        .map_err(|e| {
            let error = sanitize_recovery_error(&e.to_string());
            mark_history_recovery_intent_error(&recovery_id, error.clone());
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "historyRecoveryReceiptLookupFailed",
                Some(chain_id),
                Some(account_index),
                Some(intent.tx_hash.clone()),
                Some(error.clone()),
                json!({ "recoveryId": recovery_id }),
            );
            error
        })?;
    let (outcome_state, receipt_summary_value, decision, result_status, message) = if let Some(
        receipt,
    ) = receipt
    {
        let next_state = chain_outcome_from_receipt_status(receipt.status);
        let decision = format!(
            "receiptStatus{}",
            receipt
                .status
                .map(|value| value.as_u64().to_string())
                .unwrap_or_else(|| "unknown".to_string())
        );
        (
            next_state,
            Some(receipt_summary(&receipt)),
            decision,
            HistoryRecoveryResultStatus::Recovered,
            "Recovered local history from the transaction receipt.".to_string(),
        )
    } else {
        let transaction = provider.get_transaction(parsed_hash).await.map_err(|e| {
            let error = sanitize_recovery_error(&e.to_string());
            mark_history_recovery_intent_error(&recovery_id, error.clone());
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "historyRecoveryTransactionLookupFailed",
                Some(chain_id),
                Some(account_index),
                Some(intent.tx_hash.clone()),
                Some(error.clone()),
                json!({ "recoveryId": recovery_id }),
            );
            error
        })?;
        if transaction.is_none() {
            let error = sanitize_recovery_error(
                "transaction was not found by tx hash; no local history record was written",
            );
            mark_history_recovery_intent_error(&recovery_id, error.clone());
            record_transaction_diagnostic(
                DiagnosticLevel::Warn,
                "historyRecoveryTransactionNotFound",
                Some(chain_id),
                Some(account_index),
                Some(intent.tx_hash.clone()),
                Some(error.clone()),
                json!({ "recoveryId": recovery_id }),
            );
            return Err(error);
        }
        (
            ChainOutcomeState::Pending,
            None,
            "transactionFoundReceiptPending".to_string(),
            HistoryRecoveryResultStatus::PendingRecovered,
            "Recovered local history as pending because the transaction exists but no receipt is available.".to_string(),
        )
    };

    let recovered_record = history_record_from_recovery_intent(
        &intent,
        outcome_state,
        receipt_summary_value,
        checked_at,
        decision,
    )?;
    let (final_status, final_record, records, final_message) =
        match finalize_recovered_history_record(&intent, recovered_record) {
            Ok((status, record, records, locked_message)) => {
                let status = if status == HistoryRecoveryResultStatus::Recovered {
                    result_status
                } else {
                    status
                };
                let message = if status == HistoryRecoveryResultStatus::AlreadyRecovered {
                    locked_message
                } else {
                    message
                };
                (status, record, records, message)
            }
            Err(error) => {
                mark_history_recovery_intent_error(&recovery_id, error.clone());
                record_transaction_diagnostic(
                    DiagnosticLevel::Error,
                    "historyRecoveryHistoryWriteFailed",
                    Some(chain_id),
                    Some(account_index),
                    Some(intent.tx_hash.clone()),
                    Some(error.clone()),
                    json!({ "recoveryId": recovery_id }),
                );
                return Err(error);
            }
        };
    let updated_intent =
        match mark_recovery_intent_recovered_or_error(&recovery_id, &intent.tx_hash) {
            Ok(intent) => intent,
            Err(error) => return Err(error),
        };
    if final_status == HistoryRecoveryResultStatus::AlreadyRecovered {
        record_transaction_diagnostic(
            DiagnosticLevel::Info,
            "historyRecoveryAlreadyRecovered",
            Some(chain_id),
            Some(account_index),
            Some(intent.tx_hash.clone()),
            None,
            json!({ "recoveryId": recovery_id }),
        );
    } else {
        record_transaction_diagnostic(
            DiagnosticLevel::Info,
            "historyRecoveryHistoryWriteSucceeded",
            Some(chain_id),
            Some(account_index),
            Some(intent.tx_hash.clone()),
            None,
            json!({ "recoveryId": recovery_id, "result": final_status }),
        );
    }
    Ok(HistoryRecoveryResult {
        status: final_status,
        intent: updated_intent,
        record: final_record,
        history: records,
        message: final_message,
    })
}

async fn preflight_native_transfer(
    intent: &NativeTransferIntent,
    signer_address: Address,
    provider: &Provider<Http>,
) -> Result<(), String> {
    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "nativeTransferPreflightStarted",
        Some(intent.chain_id),
        Some(intent.account_index),
        None,
        None,
        json!({ "nonce": intent.nonce }),
    );
    let remote_chain_id = provider.get_chainid().await.map_err(|e| {
        let error = e.to_string();
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "nativeTransferPreflightChainIdFailed",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "nonce": intent.nonce }),
        );
        error
    })?;
    if remote_chain_id.as_u64() != intent.chain_id {
        let error = format!(
            "remote chainId {} does not match intent chainId {}",
            remote_chain_id, intent.chain_id
        );
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "nativeTransferPreflightChainIdMismatch",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "remoteChainId": remote_chain_id.as_u64(), "nonce": intent.nonce }),
        );
        return Err(error);
    }

    let expected_from = parse_native_transfer_address(
        intent,
        "from",
        &intent.from,
        "nativeTransferPreflightAddressInvalid",
    )?;
    if signer_address != expected_from {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "nativeTransferPreflightSignerMismatch",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some("derived wallet does not match intent.from".to_string()),
            json!({ "nonce": intent.nonce }),
        );
        return Err("derived wallet does not match intent.from".to_string());
    }

    let balance = provider
        .get_balance(signer_address, None)
        .await
        .map_err(|e| {
            record_native_transfer_error(
                intent,
                "nativeTransferPreflightBalanceFailed",
                e.to_string(),
                json!({ "nonce": intent.nonce }),
            )
        })?;
    let value = parse_native_transfer_u256(
        intent,
        "value_wei",
        &intent.value_wei,
        "nativeTransferPreflightNumericFieldInvalid",
    )?;
    let gas_limit = parse_native_transfer_u256(
        intent,
        "gas_limit",
        &intent.gas_limit,
        "nativeTransferPreflightNumericFieldInvalid",
    )?;
    let max_fee_per_gas = parse_native_transfer_u256(
        intent,
        "max_fee_per_gas",
        &intent.max_fee_per_gas,
        "nativeTransferPreflightNumericFieldInvalid",
    )?;
    let total_cost = value + gas_limit * max_fee_per_gas;
    if balance < total_cost {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "nativeTransferPreflightInsufficientFunds",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some("balance cannot cover value plus max gas cost".to_string()),
            json!({ "nonce": intent.nonce }),
        );
        return Err("balance cannot cover value plus max gas cost".to_string());
    }

    let latest_nonce = provider
        .get_transaction_count(signer_address, None)
        .await
        .map_err(|e| {
            record_native_transfer_error(
                intent,
                "nativeTransferPreflightNonceLookupFailed",
                e.to_string(),
                json!({ "nonce": intent.nonce }),
            )
        })?;
    if intent.nonce < latest_nonce.as_u64() {
        let error = format!(
            "intent nonce {} is below latest on-chain nonce {}",
            intent.nonce, latest_nonce
        );
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "nativeTransferPreflightNonceTooLow",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "nonce": intent.nonce, "latestNonce": latest_nonce.as_u64() }),
        );
        return Err(error);
    }

    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "nativeTransferPreflightSucceeded",
        Some(intent.chain_id),
        Some(intent.account_index),
        None,
        None,
        json!({ "nonce": intent.nonce }),
    );
    Ok(())
}

async fn preflight_erc20_transfer(
    intent: &Erc20TransferIntent,
    signer_address: Address,
    provider: &Provider<Http>,
    verify_frozen_key: bool,
) -> Result<(NativeTransferIntent, Address, Address, Bytes), String> {
    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "erc20TransferPreflightStarted",
        Some(intent.chain_id),
        Some(intent.account_index),
        None,
        None,
        json!({ "nonce": intent.nonce }),
    );

    let remote_chain_id = provider.get_chainid().await.map_err(|e| {
        let error = e.to_string();
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightChainIdFailed",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "nonce": intent.nonce }),
        );
        error
    })?;
    if remote_chain_id.as_u64() != intent.chain_id {
        let error = format!(
            "remote chainId {} does not match intent chainId {}",
            remote_chain_id, intent.chain_id
        );
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightChainIdMismatch",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "remoteChainId": remote_chain_id.as_u64(), "nonce": intent.nonce }),
        );
        return Err(error);
    }

    let expected_from = intent.from.parse::<Address>().map_err(|e| {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightAddressInvalid",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(format!("{e}")),
            json!({ "field": "from", "nonce": intent.nonce }),
        );
        format!("{e}")
    })?;
    if signer_address != expected_from {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightSignerMismatch",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some("derived wallet does not match intent.from".to_string()),
            json!({ "nonce": intent.nonce }),
        );
        return Err("derived wallet does not match intent.from".to_string());
    }

    if intent.selector != ERC20_TRANSFER_SELECTOR_HEX {
        return Err("ERC-20 selector does not match transfer(address,uint256)".to_string());
    }
    if intent.method != ERC20_TRANSFER_METHOD {
        return Err("ERC-20 method does not match transfer(address,uint256)".to_string());
    }
    if intent.native_value_wei != "0" {
        return Err("ERC-20 transfer native value must be 0".to_string());
    }
    let computed_frozen_key = erc20_frozen_key_from_submit_intent(intent);
    if verify_frozen_key && computed_frozen_key != intent.frozen_key {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightFrozenKeyMismatch",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some("ERC-20 frozen draft key does not match submitted fields".to_string()),
            json!({ "nonce": intent.nonce }),
        );
        return Err("ERC-20 frozen draft key does not match submitted fields".to_string());
    }

    let token_contract = intent.token_contract.parse::<Address>().map_err(|e| {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightAddressInvalid",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(format!("{e}")),
            json!({ "field": "token_contract", "nonce": intent.nonce }),
        );
        format!("{e}")
    })?;
    let recipient = intent.recipient.parse::<Address>().map_err(|e| {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightAddressInvalid",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(format!("{e}")),
            json!({ "field": "recipient", "nonce": intent.nonce }),
        );
        format!("{e}")
    })?;
    let amount_raw = U256::from_dec_str(&intent.amount_raw).map_err(|e| {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightNumericFieldInvalid",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(e.to_string()),
            json!({ "field": "amount_raw", "nonce": intent.nonce }),
        );
        e.to_string()
    })?;
    if amount_raw.is_zero() {
        return Err("ERC-20 amount_raw must be greater than zero".to_string());
    }
    let gas_limit = U256::from_dec_str(&intent.gas_limit).map_err(|e| e.to_string())?;
    let max_fee_per_gas = U256::from_dec_str(&intent.max_fee_per_gas).map_err(|e| e.to_string())?;
    let max_priority_fee_per_gas =
        U256::from_dec_str(&intent.max_priority_fee_per_gas).map_err(|e| e.to_string())?;
    if max_priority_fee_per_gas > max_fee_per_gas {
        return Err("max priority fee cannot exceed max fee".to_string());
    }

    let native_balance = provider
        .get_balance(signer_address, None)
        .await
        .map_err(|e| {
            let error = e.to_string();
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "erc20TransferPreflightNativeBalanceFailed",
                Some(intent.chain_id),
                Some(intent.account_index),
                None,
                Some(error.clone()),
                json!({ "nonce": intent.nonce }),
            );
            error
        })?;
    let max_gas_cost = gas_limit * max_fee_per_gas;
    if native_balance < max_gas_cost {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightNativeGasInsufficient",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some("native balance cannot cover max gas cost".to_string()),
            json!({ "nonce": intent.nonce }),
        );
        return Err(
            "native gas balance insufficient: native balance cannot cover max gas cost".to_string(),
        );
    }

    let balance_call: TypedTransaction = TransactionRequest::new()
        .to(token_contract)
        .from(signer_address)
        .data(build_erc20_balance_of_calldata(signer_address))
        .into();
    let token_balance_raw = provider.call(&balance_call, None).await.map_err(|e| {
        let error = e.to_string();
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightTokenBalanceFailed",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "nonce": intent.nonce }),
        );
        error
    })?;
    if token_balance_raw.as_ref().len() != 32 {
        let error = format!(
            "ERC-20 balanceOf returned {} bytes; expected 32-byte uint256 ABI payload",
            token_balance_raw.as_ref().len()
        );
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightTokenBalanceFailed",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "nonce": intent.nonce, "returnBytes": token_balance_raw.as_ref().len() }),
        );
        return Err(error);
    }
    let token_balance = U256::from_big_endian(token_balance_raw.as_ref());
    if token_balance < amount_raw {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightTokenBalanceInsufficient",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some("token balance cannot cover amount_raw".to_string()),
            json!({ "nonce": intent.nonce }),
        );
        return Err(
            "token balance insufficient: token balance cannot cover amount_raw".to_string(),
        );
    }

    let latest_nonce = provider
        .get_transaction_count(signer_address, None)
        .await
        .map_err(|e| {
            let error = e.to_string();
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "erc20TransferPreflightNonceLookupFailed",
                Some(intent.chain_id),
                Some(intent.account_index),
                None,
                Some(error.clone()),
                json!({ "nonce": intent.nonce }),
            );
            error
        })?;
    if intent.nonce < latest_nonce.as_u64() {
        let error = format!(
            "intent nonce {} is below latest on-chain nonce {}",
            intent.nonce, latest_nonce
        );
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferPreflightNonceTooLow",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "nonce": intent.nonce, "latestNonce": latest_nonce.as_u64() }),
        );
        return Err(error);
    }

    let native_intent = native_intent_from_erc20_intent(intent);
    let calldata = build_erc20_transfer_calldata(recipient, amount_raw);
    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "erc20TransferPreflightSucceeded",
        Some(intent.chain_id),
        Some(intent.account_index),
        None,
        None,
        json!({ "nonce": intent.nonce }),
    );
    Ok((native_intent, token_contract, recipient, calldata))
}

async fn preflight_erc20_replacement_intent(
    intent: &Erc20TransferIntent,
    signer_address: Address,
    provider: &Provider<Http>,
) -> Result<(NativeTransferIntent, Address, Address, Bytes), String> {
    preflight_erc20_transfer(intent, signer_address, provider, false).await
}

pub async fn submit_native_transfer(intent: NativeTransferIntent) -> Result<HistoryRecord, String> {
    submit_native_transfer_with_history_kind(intent, SubmissionKind::NativeTransfer, None).await
}

pub async fn submit_erc20_transfer(intent: Erc20TransferIntent) -> Result<HistoryRecord, String> {
    let wallet = with_session_mnemonic(|mnemonic| derive_wallet(mnemonic, intent.account_index))?
        .with_chain_id(intent.chain_id);
    let provider = Provider::<Http>::try_from(intent.rpc_url.clone()).map_err(|e| {
        let error = e.to_string();
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferProviderInvalid",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "kind": SubmissionKind::Erc20Transfer }),
        );
        error
    })?;
    let (history_intent, token_contract, _recipient, calldata) =
        preflight_erc20_transfer(&intent, wallet.address(), &provider, true).await?;
    if let Err(error) = load_history_records() {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferHistoryPreloadFailed",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "kind": SubmissionKind::Erc20Transfer }),
        );
        return Err(error);
    }

    let signer = SignerMiddleware::new(provider, wallet);
    let tx = Eip1559TransactionRequest::new()
        .to(token_contract)
        .from(intent.from.parse::<Address>().map_err(|e| format!("{e}"))?)
        .value(U256::zero())
        .data(calldata)
        .nonce(U256::from(intent.nonce))
        .gas(U256::from_dec_str(&intent.gas_limit).map_err(|e| e.to_string())?)
        .max_fee_per_gas(U256::from_dec_str(&intent.max_fee_per_gas).map_err(|e| e.to_string())?)
        .max_priority_fee_per_gas(
            U256::from_dec_str(&intent.max_priority_fee_per_gas).map_err(|e| e.to_string())?,
        )
        .chain_id(intent.chain_id);

    let pending = signer.send_transaction(tx, None).await.map_err(|e| {
        let error = e.to_string();
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferBroadcastFailed",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "kind": SubmissionKind::Erc20Transfer, "nonce": intent.nonce }),
        );
        error
    })?;
    let tx_hash = format!("{:#x}", pending.tx_hash());
    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "erc20TransferBroadcastSucceeded",
        Some(intent.chain_id),
        Some(intent.account_index),
        Some(tx_hash.clone()),
        None,
        json!({ "kind": SubmissionKind::Erc20Transfer, "nonce": intent.nonce }),
    );

    let recovery_intent = history_intent.clone();
    let broadcasted_at = now_unix_seconds()?;
    persist_pending_history_with_kind_at(
        history_intent,
        tx_hash.clone(),
        SubmissionKind::Erc20Transfer,
        None,
        broadcasted_at.clone(),
    )
    .map_err(|error| {
        let recovery_result = history_recovery_intent_from_broadcast_failure_with_frozen_key(
            &recovery_intent,
            tx_hash.clone(),
            SubmissionKind::Erc20Transfer,
            None,
            broadcasted_at,
            error.clone(),
            Some(intent.frozen_key.clone()),
        )
        .and_then(record_history_recovery_intent);
        let recovery_recorded = recovery_result.is_ok();
        if let Some(recovery_error) = recovery_result.err() {
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "erc20TransferHistoryRecoveryIntentWriteFailed",
                Some(recovery_intent.chain_id),
                Some(recovery_intent.account_index),
                Some(tx_hash.clone()),
                Some(recovery_error),
                json!({ "kind": SubmissionKind::Erc20Transfer, "nonce": recovery_intent.nonce }),
            );
        }
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferHistoryWriteAfterBroadcastFailed",
            Some(recovery_intent.chain_id),
            Some(recovery_intent.account_index),
            Some(tx_hash.clone()),
            Some(error.clone()),
            json!({
                "kind": SubmissionKind::Erc20Transfer,
                "nonce": recovery_intent.nonce,
                "recoveryRecorded": recovery_recorded,
            }),
        );
        erc20_broadcast_history_write_error(&tx_hash, &intent, &error)
    })
}

async fn submit_erc20_history_intent_with_kind(
    intent: NativeTransferIntent,
    kind: SubmissionKind,
    replaces_tx_hash: Option<String>,
) -> Result<HistoryRecord, String> {
    let submit_intent = erc20_submit_intent_from_native_intent(
        &intent,
        submission_record_from_intent(
            &intent,
            "0xpending".to_string(),
            "0".to_string(),
            kind.clone(),
            replaces_tx_hash.clone(),
        )
        .frozen_key,
    )?;
    let wallet = with_session_mnemonic(|mnemonic| derive_wallet(mnemonic, intent.account_index))?
        .with_chain_id(intent.chain_id);
    let provider = Provider::<Http>::try_from(intent.rpc_url.clone()).map_err(|e| e.to_string())?;
    let (_, token_contract, _recipient, calldata) =
        preflight_erc20_replacement_intent(&submit_intent, wallet.address(), &provider).await?;
    if let Err(error) = load_history_records() {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferHistoryPreloadFailed",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "kind": kind }),
        );
        return Err(error);
    }
    let signer = SignerMiddleware::new(provider, wallet);
    let tx = Eip1559TransactionRequest::new()
        .to(token_contract)
        .from(intent.from.parse::<Address>().map_err(|e| format!("{e}"))?)
        .value(U256::zero())
        .data(calldata)
        .nonce(U256::from(intent.nonce))
        .gas(U256::from_dec_str(&intent.gas_limit).map_err(|e| e.to_string())?)
        .max_fee_per_gas(U256::from_dec_str(&intent.max_fee_per_gas).map_err(|e| e.to_string())?)
        .max_priority_fee_per_gas(
            U256::from_dec_str(&intent.max_priority_fee_per_gas).map_err(|e| e.to_string())?,
        )
        .chain_id(intent.chain_id);
    let pending = signer.send_transaction(tx, None).await.map_err(|e| {
        let error = e.to_string();
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "erc20TransferBroadcastFailed",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "kind": kind, "nonce": intent.nonce }),
        );
        error
    })?;
    let tx_hash = format!("{:#x}", pending.tx_hash());
    let recovery_intent = intent.clone();
    let recovery_kind = kind.clone();
    let recovery_replaces_tx_hash = replaces_tx_hash.clone();
    let broadcasted_at = now_unix_seconds()?;
    let history_intent = sanitized_erc20_history_intent(&intent);
    let recovery_frozen_key = submission_record_from_intent(
        &history_intent,
        tx_hash.clone(),
        broadcasted_at.clone(),
        kind.clone(),
        replaces_tx_hash.clone(),
    )
    .frozen_key;
    persist_pending_history_with_kind_at(
        history_intent,
        tx_hash.clone(),
        kind,
        replaces_tx_hash,
        broadcasted_at.clone(),
    )
    .map_err(|error| {
        let _ = history_recovery_intent_from_broadcast_failure_with_frozen_key(
            &recovery_intent,
            tx_hash.clone(),
            recovery_kind,
            recovery_replaces_tx_hash,
            broadcasted_at,
            error.clone(),
            Some(recovery_frozen_key.clone()),
        )
        .and_then(record_history_recovery_intent);
        erc20_history_intent_broadcast_history_write_error(
            &tx_hash,
            &recovery_intent,
            &recovery_frozen_key,
            &error,
        )
    })
}

pub async fn submit_native_transfer_with_history_kind(
    intent: NativeTransferIntent,
    kind: SubmissionKind,
    replaces_tx_hash: Option<String>,
) -> Result<HistoryRecord, String> {
    if intent.typed_transaction.transaction_type == TransactionType::Erc20Transfer {
        return submit_erc20_history_intent_with_kind(intent, kind, replaces_tx_hash).await;
    }
    let wallet = with_session_mnemonic(|mnemonic| derive_wallet(mnemonic, intent.account_index))?
        .with_chain_id(intent.chain_id);
    let provider = Provider::<Http>::try_from(intent.rpc_url.clone()).map_err(|e| {
        let error = e.to_string();
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "nativeTransferProviderInvalid",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "kind": kind }),
        );
        error
    })?;
    preflight_native_transfer(&intent, wallet.address(), &provider).await?;
    if let Err(error) = load_history_records() {
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "nativeTransferHistoryPreloadFailed",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "kind": kind }),
        );
        return Err(error);
    }
    let signer = SignerMiddleware::new(provider, wallet);

    let tx = Eip1559TransactionRequest::new()
        .to(parse_native_transfer_address(
            &intent,
            "to",
            &intent.to,
            "nativeTransferTransactionFieldInvalid",
        )?)
        .from(parse_native_transfer_address(
            &intent,
            "from",
            &intent.from,
            "nativeTransferTransactionFieldInvalid",
        )?)
        .value(parse_native_transfer_u256(
            &intent,
            "value_wei",
            &intent.value_wei,
            "nativeTransferTransactionFieldInvalid",
        )?)
        .nonce(U256::from(intent.nonce))
        .gas(parse_native_transfer_u256(
            &intent,
            "gas_limit",
            &intent.gas_limit,
            "nativeTransferTransactionFieldInvalid",
        )?)
        .max_fee_per_gas(parse_native_transfer_u256(
            &intent,
            "max_fee_per_gas",
            &intent.max_fee_per_gas,
            "nativeTransferTransactionFieldInvalid",
        )?)
        .max_priority_fee_per_gas(parse_native_transfer_u256(
            &intent,
            "max_priority_fee_per_gas",
            &intent.max_priority_fee_per_gas,
            "nativeTransferTransactionFieldInvalid",
        )?)
        .chain_id(intent.chain_id);

    let pending = signer.send_transaction(tx, None).await.map_err(|e| {
        let error = e.to_string();
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "nativeTransferBroadcastFailed",
            Some(intent.chain_id),
            Some(intent.account_index),
            None,
            Some(error.clone()),
            json!({ "kind": kind, "nonce": intent.nonce }),
        );
        error
    })?;
    let tx_hash = format!("{:#x}", pending.tx_hash());
    record_transaction_diagnostic(
        DiagnosticLevel::Info,
        "nativeTransferBroadcastSucceeded",
        Some(intent.chain_id),
        Some(intent.account_index),
        Some(tx_hash.clone()),
        None,
        json!({ "kind": kind, "nonce": intent.nonce }),
    );

    let history_kind = kind.clone();
    let recovery_intent = intent.clone();
    let recovery_kind = kind.clone();
    let recovery_replaces_tx_hash = replaces_tx_hash.clone();
    let broadcasted_at = now_unix_seconds()?;
    persist_pending_history_with_kind_at(
        intent,
        tx_hash.clone(),
        kind,
        replaces_tx_hash,
        broadcasted_at.clone(),
    )
    .map_err(|error| {
        let recovery_result = history_recovery_intent_from_broadcast_failure(
            &recovery_intent,
            tx_hash.clone(),
            recovery_kind,
            recovery_replaces_tx_hash,
            broadcasted_at,
            error.clone(),
        )
        .and_then(record_history_recovery_intent);
        let recovery_recorded = recovery_result.is_ok();
        let recovery_error = recovery_result.err();
        if let Some(recovery_error) = recovery_error.clone() {
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "nativeTransferHistoryRecoveryIntentWriteFailed",
                Some(recovery_intent.chain_id),
                Some(recovery_intent.account_index),
                Some(tx_hash.clone()),
                Some(recovery_error),
                json!({ "kind": history_kind, "nonce": recovery_intent.nonce }),
            );
        }
        record_transaction_diagnostic(
            DiagnosticLevel::Error,
            "nativeTransferHistoryWriteAfterBroadcastFailed",
            Some(recovery_intent.chain_id),
            Some(recovery_intent.account_index),
            Some(tx_hash.clone()),
            Some(error.clone()),
            json!({
                "kind": history_kind,
                "nonce": recovery_intent.nonce,
                "recoveryRecorded": recovery_recorded,
            }),
        );
        broadcast_history_write_error(&tx_hash, &error)
    })
}
