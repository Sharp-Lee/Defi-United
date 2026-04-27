use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use crate::models::NativeTransferIntent;
use crate::transactions::{
    load_history_records, persist_pending_history, reconcile_pending_history,
    submit_native_transfer,
};
use serde::{Deserialize, Serialize};

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
        record.intent.chain_id,
        record.intent.account_index,
        &record.intent.from,
        record.intent.nonce,
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
    if record.intent.chain_id != request.chain_id {
        return Err("pending request chain_id does not match local history".to_string());
    }
    if record.intent.account_index != request.account_index {
        return Err("pending request account_index does not match local history".to_string());
    }
    if !record.intent.from.eq_ignore_ascii_case(&request.from) {
        return Err("pending request from does not match local history".to_string());
    }
    if record.intent.nonce != request.nonce {
        return Err("pending request nonce does not match local history".to_string());
    }

    Ok(record)
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
    Ok(NativeTransferIntent {
        rpc_url: request.rpc_url,
        account_index: record.intent.account_index,
        chain_id: record.intent.chain_id,
        from: record.intent.from,
        to: request
            .to
            .ok_or_else(|| "replace requires a destination".to_string())?,
        value_wei: request
            .value_wei
            .ok_or_else(|| "replace requires a value".to_string())?,
        nonce: record.intent.nonce,
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
    Ok(NativeTransferIntent {
        rpc_url: request.rpc_url,
        account_index: record.intent.account_index,
        chain_id: record.intent.chain_id,
        from: record.intent.from.clone(),
        to: record.intent.from,
        value_wei: "0".to_string(),
        nonce: record.intent.nonce,
        gas_limit: request.gas_limit,
        max_fee_per_gas: request.max_fee_per_gas,
        max_priority_fee_per_gas: request.max_priority_fee_per_gas,
    })
}

pub fn pending_mutation_mark_failure_error(
    record: &crate::models::HistoryRecord,
    mark_error: &str,
) -> String {
    let recovery_record = serde_json::to_string(record)
        .unwrap_or_else(|_| "{\"error\":\"failed to serialize recovery record\"}".to_string());
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
pub async fn reconcile_pending_history_command(
    rpc_url: String,
    chain_id: u64,
) -> Result<String, String> {
    let records = reconcile_pending_history(rpc_url, chain_id).await?;
    serde_json::to_string(&records).map_err(|e| e.to_string())
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

    let record = submit_native_transfer(intent).await?;
    if let Err(error) = crate::transactions::mark_prior_history_state(
        &tx_hash,
        crate::models::ChainOutcomeState::Replaced,
    ) {
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

    let record = submit_native_transfer(intent).await?;
    if let Err(error) = crate::transactions::mark_prior_history_state(
        &tx_hash,
        crate::models::ChainOutcomeState::Cancelled,
    ) {
        return Err(pending_mutation_mark_failure_error(&record, &error));
    }
    serde_json::to_string(&record).map_err(|e| e.to_string())
}
