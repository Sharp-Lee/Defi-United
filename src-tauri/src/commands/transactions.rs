use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use crate::diagnostics::{append_diagnostic_event, DiagnosticEventInput, DiagnosticLevel};
use crate::models::{
    NativeTransferIntent, SubmissionKind, SubmissionRecord, TypedTransactionFields,
};
use crate::transactions::{
    dismiss_history_recovery_intent, inspect_history_storage, load_history_records,
    load_history_recovery_intents, persist_pending_history, quarantine_history_storage,
    reconcile_pending_history, recover_broadcasted_history_record, review_dropped_history_record,
    submit_native_transfer, submit_native_transfer_with_history_kind,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingMutationRequest {
    pub tx_hash: String,
    pub rpc_url: String,
    pub account_index: u32,
    pub chain_id: u64,
    pub from: String,
    pub nonce: u64,
    pub gas_limit: String,
    pub max_fee_per_gas: String,
    pub max_priority_fee_per_gas: String,
    pub to: Option<String>,
    pub value_wei: Option<String>,
}

fn pending_mutation_set() -> &'static Mutex<HashSet<String>> {
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

pub struct PendingMutationGuard {
    key: String,
}

impl Drop for PendingMutationGuard {
    fn drop(&mut self) {
        let mut active = pending_mutation_set()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        active.remove(&self.key);
    }
}

pub fn acquire_pending_mutation_guard(key: &str) -> Result<PendingMutationGuard, String> {
    let mut active = pending_mutation_set()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !active.insert(key.to_string()) {
        return Err(format!(
            "pending mutation already in progress for key {key}"
        ));
    }
    Ok(PendingMutationGuard {
        key: key.to_string(),
    })
}

pub fn pending_mutation_guard_key(record: &crate::models::HistoryRecord) -> String {
    pending_mutation_guard_key_parts(
        record.submission.chain_id.unwrap_or(record.intent.chain_id),
        record
            .submission
            .account_index
            .unwrap_or(record.intent.account_index),
        record
            .submission
            .from
            .as_deref()
            .unwrap_or(&record.intent.from),
        record.submission.nonce.unwrap_or(record.intent.nonce),
    )
}

pub fn pending_mutation_guard_key_from_request(request: &PendingMutationRequest) -> String {
    pending_mutation_guard_key_parts(
        request.chain_id,
        request.account_index,
        &request.from,
        request.nonce,
    )
}

fn pending_mutation_guard_key_parts(
    chain_id: u64,
    account_index: u32,
    from: &str,
    nonce: u64,
) -> String {
    format!(
        "{}:{}:{}:{}",
        chain_id,
        account_index,
        from.to_lowercase(),
        nonce
    )
}

fn pending_record_for_mutation(
    request: &PendingMutationRequest,
) -> Result<crate::models::HistoryRecord, String> {
    let records = load_history_records()?;
    let Some(record) = records
        .into_iter()
        .find(|record| record.submission.tx_hash == request.tx_hash)
    else {
        return Err(format!(
            "pending history record not found for tx_hash {}",
            request.tx_hash
        ));
    };

    if record.outcome.state != crate::models::ChainOutcomeState::Pending {
        return Err(format!(
            "history record for tx_hash {} is not pending",
            request.tx_hash
        ));
    }
    validate_pending_request_against_submission(request, &record.submission)?;

    Ok(record)
}

fn require_submission_u64(value: Option<u64>, field: &str) -> Result<u64, String> {
    value.ok_or_else(|| format!("pending history submission missing frozen {field}"))
}

fn require_submission_u32(value: Option<u32>, field: &str) -> Result<u32, String> {
    value.ok_or_else(|| format!("pending history submission missing frozen {field}"))
}

fn require_submission_string(value: &Option<String>, field: &str) -> Result<String, String> {
    value
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| format!("pending history submission missing frozen {field}"))
}

fn frozen_submission_identity(
    submission: &SubmissionRecord,
) -> Result<(u64, u32, String, u64), String> {
    Ok((
        require_submission_u64(submission.chain_id, "chain_id")?,
        require_submission_u32(submission.account_index, "account_index")?,
        require_submission_string(&submission.from, "from")?,
        require_submission_u64(submission.nonce, "nonce")?,
    ))
}

fn validate_pending_request_against_submission(
    request: &PendingMutationRequest,
    submission: &SubmissionRecord,
) -> Result<(), String> {
    let (chain_id, account_index, from, nonce) = frozen_submission_identity(submission)?;
    let gas_limit = require_submission_string(&submission.gas_limit, "gas_limit")?;
    let max_fee_per_gas =
        require_submission_string(&submission.max_fee_per_gas, "max_fee_per_gas")?;
    let max_priority_fee_per_gas = require_submission_string(
        &submission.max_priority_fee_per_gas,
        "max_priority_fee_per_gas",
    )?;

    if submission.tx_hash != request.tx_hash {
        return Err("pending request tx_hash does not match frozen submission".to_string());
    }
    if chain_id != request.chain_id {
        return Err("pending request chain_id does not match frozen submission".to_string());
    }
    if account_index != request.account_index {
        return Err("pending request account_index does not match frozen submission".to_string());
    }
    if !from.eq_ignore_ascii_case(&request.from) {
        return Err("pending request from does not match frozen submission".to_string());
    }
    if nonce != request.nonce {
        return Err("pending request nonce does not match frozen submission".to_string());
    }
    if gas_limit != request.gas_limit {
        return Err("pending request gas_limit does not match frozen submission".to_string());
    }

    validate_fee_not_below_frozen(
        &request.max_fee_per_gas,
        &max_fee_per_gas,
        "max_fee_per_gas",
    )?;
    validate_fee_not_below_frozen(
        &request.max_priority_fee_per_gas,
        &max_priority_fee_per_gas,
        "max_priority_fee_per_gas",
    )?;

    Ok(())
}

fn validate_fee_not_below_frozen(
    request_value: &str,
    frozen_value: &str,
    field: &str,
) -> Result<(), String> {
    let request_fee = ethers::types::U256::from_dec_str(request_value)
        .map_err(|e| format!("pending request {field} is invalid: {e}"))?;
    let frozen_fee = ethers::types::U256::from_dec_str(frozen_value)
        .map_err(|e| format!("frozen submission {field} is invalid: {e}"))?;
    if request_fee < frozen_fee {
        return Err(format!(
            "pending request {field} is below frozen submission {field}"
        ));
    }
    Ok(())
}

pub fn build_replace_intent_from_pending_request(
    request: PendingMutationRequest,
) -> Result<NativeTransferIntent, String> {
    let record = pending_record_for_mutation(&request)?;
    build_replace_intent_from_record(request, record)
}

fn build_replace_intent_from_record(
    request: PendingMutationRequest,
    record: crate::models::HistoryRecord,
) -> Result<NativeTransferIntent, String> {
    let (chain_id, account_index, from, nonce) = frozen_submission_identity(&record.submission)?;
    let value_wei = request
        .value_wei
        .ok_or_else(|| "replace requires a value".to_string())?;
    Ok(NativeTransferIntent {
        typed_transaction: TypedTransactionFields::native_transfer(value_wei.clone()),
        rpc_url: request.rpc_url,
        account_index,
        chain_id,
        from,
        to: request
            .to
            .ok_or_else(|| "replace requires a destination".to_string())?,
        value_wei,
        nonce,
        gas_limit: request.gas_limit,
        max_fee_per_gas: request.max_fee_per_gas,
        max_priority_fee_per_gas: request.max_priority_fee_per_gas,
    })
}

pub fn build_cancel_intent_from_pending_request(
    request: PendingMutationRequest,
) -> Result<NativeTransferIntent, String> {
    let record = pending_record_for_mutation(&request)?;
    build_cancel_intent_from_record(request, record)
}

fn build_cancel_intent_from_record(
    request: PendingMutationRequest,
    record: crate::models::HistoryRecord,
) -> Result<NativeTransferIntent, String> {
    let (chain_id, account_index, from, nonce) = frozen_submission_identity(&record.submission)?;
    Ok(NativeTransferIntent {
        typed_transaction: TypedTransactionFields::native_transfer("0"),
        rpc_url: request.rpc_url,
        account_index,
        chain_id,
        from: from.clone(),
        to: from,
        value_wei: "0".to_string(),
        nonce,
        gas_limit: request.gas_limit,
        max_fee_per_gas: request.max_fee_per_gas,
        max_priority_fee_per_gas: request.max_priority_fee_per_gas,
    })
}

pub fn pending_mutation_mark_failure_error(
    record: &crate::models::HistoryRecord,
    mark_error: &str,
) -> String {
    let identity = crate::transactions::history_identity_for_record(record);
    let recovery_record = serde_json::to_string(&serde_json::json!({
        "schema_version": record.schema_version,
        "identity": {
            "source": identity.source,
            "chain_id": identity.chain_id,
            "account_index": identity.account_index,
            "from": identity.from,
            "nonce": identity.nonce,
        },
        "intent": {
            "chain_id": record.intent.chain_id,
            "account_index": record.intent.account_index,
            "from": &record.intent.from,
            "to": &record.intent.to,
            "value_wei": &record.intent.value_wei,
            "nonce": record.intent.nonce,
            "gas_limit": &record.intent.gas_limit,
            "max_fee_per_gas": &record.intent.max_fee_per_gas,
            "max_priority_fee_per_gas": &record.intent.max_priority_fee_per_gas,
        },
        "submission": &record.submission,
        "nonce_thread": &record.nonce_thread,
        "outcome": {
            "state": &record.outcome.state,
            "tx_hash": &record.outcome.tx_hash,
            "finalized_at": &record.outcome.finalized_at,
            "reconciled_at": &record.outcome.reconciled_at,
            "reconcile_summary": &record.outcome.reconcile_summary,
            "error_summary": &record.outcome.error_summary,
        },
    }))
    .unwrap_or_else(|_| "{\"error\":\"failed to serialize recovery summary\"}".to_string());
    format!(
        "pending mutation broadcast and persisted a new pending record, but failed to mark prior history state; recovery_record={recovery_record}; mark_error={mark_error}"
    )
}

#[tauri::command]
pub fn build_pending_history(
    intent: NativeTransferIntent,
    tx_hash: String,
) -> Result<String, String> {
    let record = persist_pending_history(intent, tx_hash)?;
    serde_json::to_string(&record).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_transaction_history() -> Result<String, String> {
    let records = load_history_records()?;
    serde_json::to_string(&records).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn inspect_transaction_history_storage() -> Result<String, String> {
    let inspection = inspect_history_storage()?;
    serde_json::to_string(&inspection).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn quarantine_transaction_history() -> Result<String, String> {
    let result = quarantine_history_storage()?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reconcile_pending_history_command(
    rpc_url: String,
    chain_id: u64,
) -> Result<String, String> {
    let records = reconcile_pending_history(rpc_url, chain_id).await?;
    serde_json::to_string(&records).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_dropped_history_record_command(
    tx_hash: String,
    rpc_url: String,
    chain_id: u64,
) -> Result<String, String> {
    let records = review_dropped_history_record(tx_hash, rpc_url, chain_id).await?;
    serde_json::to_string(&records).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_history_recovery_intents_command() -> Result<String, String> {
    let intents = load_history_recovery_intents()?;
    serde_json::to_string(&intents).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn recover_broadcasted_history_record_command(
    recovery_id: String,
    rpc_url: String,
    chain_id: u64,
) -> Result<String, String> {
    let result = recover_broadcasted_history_record(recovery_id, rpc_url, chain_id).await?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dismiss_history_recovery_intent_command(recovery_id: String) -> Result<String, String> {
    let intents = dismiss_history_recovery_intent(&recovery_id)?;
    serde_json::to_string(&intents).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn submit_native_transfer_command(
    intent: NativeTransferIntent,
) -> Result<String, String> {
    let record = submit_native_transfer(intent).await?;
    serde_json::to_string(&record).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn replace_pending_transfer(request: PendingMutationRequest) -> Result<String, String> {
    let tx_hash = request.tx_hash.clone();
    let mutation_key = pending_mutation_guard_key_from_request(&request);
    let _guard = acquire_pending_mutation_guard(&mutation_key)?;
    let record = pending_record_for_mutation(&request)?;
    let intent = build_replace_intent_from_record(request, record)?;

    let record = submit_native_transfer_with_history_kind(
        intent,
        SubmissionKind::Replacement,
        Some(tx_hash.clone()),
    )
    .await?;
    if let Err(error) = crate::transactions::mark_prior_history_state_with_replacement(
        &tx_hash,
        crate::models::ChainOutcomeState::Replaced,
        Some(record.submission.tx_hash.clone()),
    ) {
        append_diagnostic_event(DiagnosticEventInput {
            level: DiagnosticLevel::Error,
            category: "transaction",
            source: "transactions_command",
            event: "replacePriorHistoryMarkFailed",
            chain_id: record.submission.chain_id,
            account_index: record.submission.account_index,
            tx_hash: Some(tx_hash.clone()),
            message: Some(error.clone()),
            metadata: json!({ "replacementTxHash": record.submission.tx_hash }),
        });
        return Err(pending_mutation_mark_failure_error(&record, &error));
    }
    serde_json::to_string(&record).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_pending_transfer(request: PendingMutationRequest) -> Result<String, String> {
    let tx_hash = request.tx_hash.clone();
    let mutation_key = pending_mutation_guard_key_from_request(&request);
    let _guard = acquire_pending_mutation_guard(&mutation_key)?;
    let record = pending_record_for_mutation(&request)?;
    let intent = build_cancel_intent_from_record(request, record)?;

    let record = submit_native_transfer_with_history_kind(
        intent,
        SubmissionKind::Cancellation,
        Some(tx_hash.clone()),
    )
    .await?;
    if let Err(error) = crate::transactions::mark_prior_history_state_with_replacement(
        &tx_hash,
        crate::models::ChainOutcomeState::Cancelled,
        Some(record.submission.tx_hash.clone()),
    ) {
        append_diagnostic_event(DiagnosticEventInput {
            level: DiagnosticLevel::Error,
            category: "transaction",
            source: "transactions_command",
            event: "cancelPriorHistoryMarkFailed",
            chain_id: record.submission.chain_id,
            account_index: record.submission.account_index,
            tx_hash: Some(tx_hash.clone()),
            message: Some(error.clone()),
            metadata: json!({ "cancellationTxHash": record.submission.tx_hash }),
        });
        return Err(pending_mutation_mark_failure_error(&record, &error));
    }
    serde_json::to_string(&record).map_err(|e| e.to_string())
}
