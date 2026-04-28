use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use crate::diagnostics::{append_diagnostic_event, DiagnosticEventInput, DiagnosticLevel};
use crate::models::{
    BatchHistoryMetadata, Erc20TransferIntent, NativeBatchDistributionParent,
    NativeBatchSubmitChildResult, NativeBatchSubmitInput, NativeBatchSubmitParentResult,
    NativeBatchSubmitResult, NativeBatchSubmitSummary, NativeTransferIntent, SubmissionKind,
    SubmissionRecord, TransactionType, TypedTransactionFields,
};
use crate::transactions::{
    annotate_history_record_batch, build_disperse_ether_calldata, dismiss_history_recovery_intent,
    inspect_history_storage, load_history_records, load_history_recovery_intents,
    persist_pending_history, quarantine_history_storage, reconcile_pending_history,
    recover_broadcasted_history_record, review_dropped_history_record, submit_erc20_transfer,
    submit_native_contract_call, submit_native_transfer, submit_native_transfer_with_history_kind,
    DISPERSE_ETHER_METHOD, DISPERSE_ETHER_SELECTOR_HEX,
};
use ethers::types::{Address, U256};
use serde::{Deserialize, Serialize};
use serde_json::json;

const FIXED_NATIVE_DISPERSE_CONTRACT: &str = "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3";

pub fn validate_native_distribution_parent(
    input: &NativeBatchSubmitInput,
    parent: &NativeBatchDistributionParent,
) -> Result<(Vec<Address>, Vec<U256>), String> {
    if parent.selector != DISPERSE_ETHER_SELECTOR_HEX || parent.method_name != DISPERSE_ETHER_METHOD
    {
        return Err("native distribution parent must use disperseEther(address[],uint256[]) selector 0xe63d38ed".to_string());
    }
    if parent.intent.chain_id != input.chain_id {
        return Err("distribution parent chainId does not match parent batch chainId".to_string());
    }
    if !parent
        .contract_address
        .eq_ignore_ascii_case(FIXED_NATIVE_DISPERSE_CONTRACT)
    {
        return Err(format!(
            "native distribution contractAddress must be fixed Disperse contract {FIXED_NATIVE_DISPERSE_CONTRACT}"
        ));
    }
    if !parent
        .intent
        .to
        .eq_ignore_ascii_case(FIXED_NATIVE_DISPERSE_CONTRACT)
    {
        return Err(format!(
            "native distribution intent.to must be fixed Disperse contract {FIXED_NATIVE_DISPERSE_CONTRACT}"
        ));
    }
    if !parent
        .intent
        .to
        .eq_ignore_ascii_case(&parent.contract_address)
    {
        return Err("distribution parent intent.to must match contractAddress".to_string());
    }
    if parent.intent.value_wei != parent.total_value_wei {
        return Err("distribution parent value_wei must equal totalValueWei".to_string());
    }

    let typed = &parent.intent.typed_transaction;
    if typed.transaction_type != TransactionType::ContractCall {
        return Err("distribution parent intent must be transaction_type contractCall".to_string());
    }
    if typed.selector.as_deref() != Some(DISPERSE_ETHER_SELECTOR_HEX) {
        return Err("distribution parent typed selector must equal 0xe63d38ed".to_string());
    }
    if typed.method_name.as_deref() != Some(DISPERSE_ETHER_METHOD) {
        return Err(
            "distribution parent typed method_name must equal disperseEther(address[],uint256[])"
                .to_string(),
        );
    }
    if typed.native_value_wei.as_deref() != Some(parent.total_value_wei.as_str()) {
        return Err(
            "distribution parent typed native_value_wei must equal totalValueWei".to_string(),
        );
    }

    let expected_total = U256::from_dec_str(&parent.total_value_wei).map_err(|e| e.to_string())?;
    if expected_total.is_zero() {
        return Err("distribution totalValueWei must be greater than zero".to_string());
    }
    if parent.recipients.is_empty() {
        return Err("native distribution requires at least one recipient".to_string());
    }

    let mut seen_child_ids = HashSet::new();
    let mut seen_child_indexes = HashSet::new();
    let mut recipients = Vec::with_capacity(parent.recipients.len());
    let mut values = Vec::with_capacity(parent.recipients.len());

    for (index, recipient) in parent.recipients.iter().enumerate() {
        let child_id = recipient.child_id.trim();
        if child_id.is_empty() {
            return Err("distribution recipient childId must not be empty".to_string());
        }
        if !seen_child_ids.insert(child_id.to_string()) {
            return Err("distribution recipient childId values must be unique".to_string());
        }
        if !seen_child_indexes.insert(recipient.child_index) {
            return Err("distribution recipient childIndex values must be unique".to_string());
        }
        if recipient.child_index as usize != index {
            return Err("distribution recipient childIndex values must be contiguous from zero and match recipient order".to_string());
        }
        if recipient.target_kind != "localAccount" && recipient.target_kind != "externalAddress" {
            return Err(
                "distribution recipient targetKind must be localAccount or externalAddress"
                    .to_string(),
            );
        }
        if recipient.target_address.trim().is_empty() {
            return Err("distribution recipient targetAddress must not be empty".to_string());
        }
        let address = recipient
            .target_address
            .parse::<Address>()
            .map_err(|e| e.to_string())?;
        let value = U256::from_dec_str(&recipient.value_wei).map_err(|e| e.to_string())?;
        if value.is_zero() {
            return Err("distribution recipient valueWei must be greater than zero".to_string());
        }
        recipients.push(address);
        values.push(value);
    }

    let total = values
        .iter()
        .copied()
        .try_fold(U256::zero(), |acc, value| {
            let (next, overflowed) = acc.overflowing_add(value);
            if overflowed {
                Err("distribution recipient values overflow totalValueWei".to_string())
            } else {
                Ok(next)
            }
        })?;
    if total != expected_total {
        return Err("distribution recipient values do not sum to totalValueWei".to_string());
    }

    Ok((recipients, values))
}

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

fn validate_erc20_replacement_fee_increase(
    request: &PendingMutationRequest,
    submission: &SubmissionRecord,
) -> Result<(), String> {
    let frozen_max_fee_per_gas =
        require_submission_string(&submission.max_fee_per_gas, "max_fee_per_gas")?;
    let frozen_max_priority_fee_per_gas = require_submission_string(
        &submission.max_priority_fee_per_gas,
        "max_priority_fee_per_gas",
    )?;
    let request_max_fee = ethers::types::U256::from_dec_str(&request.max_fee_per_gas)
        .map_err(|e| format!("pending request max_fee_per_gas is invalid: {e}"))?;
    let request_priority_fee = ethers::types::U256::from_dec_str(&request.max_priority_fee_per_gas)
        .map_err(|e| format!("pending request max_priority_fee_per_gas is invalid: {e}"))?;
    let frozen_max_fee = ethers::types::U256::from_dec_str(&frozen_max_fee_per_gas)
        .map_err(|e| format!("frozen submission max_fee_per_gas is invalid: {e}"))?;
    let frozen_priority_fee =
        ethers::types::U256::from_dec_str(&frozen_max_priority_fee_per_gas)
            .map_err(|e| format!("frozen submission max_priority_fee_per_gas is invalid: {e}"))?;
    if request_max_fee == frozen_max_fee && request_priority_fee == frozen_priority_fee {
        return Err(
            "ERC-20 replacement must increase max_fee_per_gas or max_priority_fee_per_gas"
                .to_string(),
        );
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
    if record.submission.typed_transaction.transaction_type == TransactionType::Erc20Transfer {
        validate_erc20_replacement_fee_increase(&request, &record.submission)?;
        let token_contract = require_submission_string(
            &record.submission.typed_transaction.token_contract,
            "token_contract",
        )
        .or_else(|_| require_submission_string(&record.submission.to, "to"))?;
        let recipient =
            require_submission_string(&record.submission.typed_transaction.recipient, "recipient")?;
        let amount_raw = require_submission_string(
            &record.submission.typed_transaction.amount_raw,
            "amount_raw",
        )?;
        let decimals = record
            .submission
            .typed_transaction
            .decimals
            .ok_or_else(|| "pending history submission missing frozen decimals".to_string())?;
        if !request
            .to
            .as_deref()
            .is_some_and(|to| to.eq_ignore_ascii_case(&token_contract))
        {
            return Err(
                "ERC-20 replace must keep the frozen token contract transaction target".to_string(),
            );
        }
        if request.value_wei.as_deref().unwrap_or("0") != "0" {
            return Err("ERC-20 replace must keep native value at 0".to_string());
        }
        return Ok(NativeTransferIntent {
            typed_transaction: TypedTransactionFields::erc20_transfer(
                token_contract.clone(),
                recipient,
                amount_raw,
                decimals,
                record.submission.typed_transaction.token_symbol.clone(),
                record.submission.typed_transaction.token_name.clone(),
                record
                    .submission
                    .typed_transaction
                    .token_metadata_source
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
            ),
            rpc_url: request.rpc_url,
            account_index,
            chain_id,
            from,
            to: token_contract,
            value_wei: "0".to_string(),
            nonce,
            gas_limit: request.gas_limit,
            max_fee_per_gas: request.max_fee_per_gas,
            max_priority_fee_per_gas: request.max_priority_fee_per_gas,
        });
    }
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
pub async fn submit_native_batch_command(input: NativeBatchSubmitInput) -> Result<String, String> {
    if input.asset_kind != "native" {
        return Err("native batch submit only accepts assetKind native".to_string());
    }
    if input.batch_kind != "distribute" && input.batch_kind != "collect" {
        return Err("native batch submit only accepts distribute or collect batchKind".to_string());
    }

    if input.batch_kind == "distribute" {
        let parent = input.distribution_parent.clone().ok_or_else(|| {
            "native distribution requires a distributionParent contract call".to_string()
        })?;
        if !input.children.is_empty() {
            return Err("native distribution submits exactly one parent contract transaction; child transfer intents are not accepted".to_string());
        }
        let (recipients, values) = validate_native_distribution_parent(&input, &parent)?;
        let calldata = build_disperse_ether_calldata(&recipients, &values)?;
        let recipient_allocations = parent
            .recipients
            .iter()
            .map(|recipient| crate::models::BatchRecipientAllocation {
                child_id: recipient.child_id.clone(),
                child_index: recipient.child_index,
                target_kind: recipient.target_kind.clone(),
                target_address: recipient.target_address.clone(),
                value_wei: recipient.value_wei.clone(),
            })
            .collect::<Vec<_>>();
        let metadata = BatchHistoryMetadata {
            batch_id: input.batch_id.clone(),
            child_id: format!("{}:parent", input.batch_id),
            batch_kind: input.batch_kind.clone(),
            asset_kind: input.asset_kind.clone(),
            child_index: None,
            freeze_key: Some(input.freeze_key.clone()),
            child_count: Some(parent.recipients.len() as u32),
            contract_address: Some(parent.contract_address.clone()),
            selector: Some(parent.selector.clone()),
            method_name: Some(parent.method_name.clone()),
            total_value_wei: Some(parent.total_value_wei.clone()),
            recipients: recipient_allocations,
        };
        let recovery_hint = format!(
            "broadcast may have succeeded; fixedContract={}; freezeKey={}; selector={}; method={}; totalValueWei={}; childCount={}; recipients={}",
            FIXED_NATIVE_DISPERSE_CONTRACT,
            input.freeze_key,
            parent.selector,
            parent.method_name,
            parent.total_value_wei,
            parent.recipients.len(),
            serde_json::to_string(&metadata.recipients).unwrap_or_else(|_| "[]".to_string())
        );
        let parent_result =
            match submit_native_contract_call(parent.intent, calldata, Some(metadata)).await {
                Ok(record) => NativeBatchSubmitParentResult {
                    record: Some(record),
                    error: None,
                    recovery_hint: None,
                },
                Err(error) => {
                    let recovery_hint =
                        if error.contains("broadcasted") || error.contains("tx_hash") {
                            Some(recovery_hint)
                        } else {
                            None
                        };
                    NativeBatchSubmitParentResult {
                        record: None,
                        error: Some(error),
                        recovery_hint,
                    }
                }
            };
        let children = parent
            .recipients
            .into_iter()
            .map(|recipient| NativeBatchSubmitChildResult {
                child_id: recipient.child_id,
                child_index: recipient.child_index,
                target_address: Some(recipient.target_address),
                target_kind: Some(recipient.target_kind),
                amount_wei: Some(recipient.value_wei),
                record: None,
                error: parent_result.error.clone(),
                recovery_hint: parent_result.recovery_hint.clone(),
            })
            .collect::<Vec<_>>();
        let submitted_count = usize::from(parent_result.record.is_some());
        let failed_count = usize::from(parent_result.error.is_some());
        let result = NativeBatchSubmitResult {
            batch_id: input.batch_id,
            batch_kind: input.batch_kind,
            asset_kind: input.asset_kind,
            chain_id: input.chain_id,
            parent: Some(parent_result),
            summary: NativeBatchSubmitSummary {
                child_count: children.len(),
                submitted_count,
                failed_count,
            },
            children,
        };
        return serde_json::to_string(&result).map_err(|e| e.to_string());
    }

    let mut children = Vec::with_capacity(input.children.len());
    for child in input.children {
        let metadata = BatchHistoryMetadata {
            batch_id: input.batch_id.clone(),
            child_id: child.child_id.clone(),
            batch_kind: child.batch_kind.clone(),
            asset_kind: child.asset_kind.clone(),
            child_index: Some(child.child_index),
            freeze_key: Some(child.freeze_key.clone()),
            child_count: None,
            contract_address: None,
            selector: None,
            method_name: None,
            total_value_wei: None,
            recipients: Vec::new(),
        };
        if child.asset_kind != "native" || child.batch_kind != input.batch_kind {
            children.push(NativeBatchSubmitChildResult {
                child_id: child.child_id,
                child_index: child.child_index,
                target_address: None,
                target_kind: None,
                amount_wei: None,
                record: None,
                error: Some("child batch metadata does not match parent native batch".to_string()),
                recovery_hint: None,
            });
            continue;
        }
        if child.intent.chain_id != input.chain_id {
            children.push(NativeBatchSubmitChildResult {
                child_id: child.child_id,
                child_index: child.child_index,
                target_address: None,
                target_kind: None,
                amount_wei: None,
                record: None,
                error: Some("child chainId does not match parent batch chainId".to_string()),
                recovery_hint: None,
            });
            continue;
        }

        let child_id = child.child_id.clone();
        let child_index = child.child_index;
        match submit_native_transfer_with_history_kind(
            child.intent,
            SubmissionKind::NativeTransfer,
            None,
        )
        .await
        {
            Ok(record) => {
                let tx_hash = record.submission.tx_hash.clone();
                match annotate_history_record_batch(&tx_hash, metadata) {
                    Ok(annotated) => children.push(NativeBatchSubmitChildResult {
                        child_id,
                        child_index,
                        target_address: None,
                        target_kind: None,
                        amount_wei: None,
                        record: Some(annotated),
                        error: None,
                        recovery_hint: None,
                    }),
                    Err(error) => children.push(NativeBatchSubmitChildResult {
                        child_id,
                        child_index,
                        target_address: None,
                        target_kind: None,
                        amount_wei: None,
                        record: Some(record),
                        error: Some(format!(
                            "transaction was submitted, but batch history metadata was not written: {error}"
                        )),
                        recovery_hint: Some(
                            "tx hash is in the returned child record; retry history refresh before rebroadcasting"
                                .to_string(),
                        ),
                    }),
                }
            }
            Err(error) => {
                let recovery_hint = if error.contains("broadcasted") || error.contains("tx_hash") {
                    Some("broadcast may have succeeded; check recovery intents/history before retrying".to_string())
                } else {
                    None
                };
                children.push(NativeBatchSubmitChildResult {
                    child_id,
                    child_index,
                    target_address: None,
                    target_kind: None,
                    amount_wei: None,
                    record: None,
                    error: Some(error),
                    recovery_hint,
                });
            }
        }
    }
    let submitted_count = children
        .iter()
        .filter(|child| child.record.is_some())
        .count();
    let failed_count = children
        .iter()
        .filter(|child| child.error.is_some())
        .count();
    let result = NativeBatchSubmitResult {
        batch_id: input.batch_id,
        batch_kind: input.batch_kind,
        asset_kind: input.asset_kind,
        chain_id: input.chain_id,
        parent: None,
        summary: NativeBatchSubmitSummary {
            child_count: children.len(),
            submitted_count,
            failed_count,
        },
        children,
    };
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn submit_erc20_transfer_command(intent: Erc20TransferIntent) -> Result<String, String> {
    let record = submit_erc20_transfer(intent).await?;
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
