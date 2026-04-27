use std::fs;
use std::io::ErrorKind;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use ethers::middleware::SignerMiddleware;
use ethers::providers::{Http, Middleware, Provider};
use ethers::signers::Signer;
use ethers::types::{
    transaction::{eip1559::Eip1559TransactionRequest, response::TransactionReceipt},
    Address, H256, U256, U64,
};
use serde_json::json;

use crate::accounts::derive_wallet;
use crate::diagnostics::{append_diagnostic_event, DiagnosticEventInput, DiagnosticLevel};
use crate::models::{
    ChainOutcome, HistoryErrorSummary, IntentSnapshotMetadata, NonceThread, ReceiptSummary,
    ReconcileSummary, SubmissionKind, SubmissionRecord,
};
use crate::session::with_session_mnemonic;
use crate::storage::{history_path, write_file_atomic};

pub use crate::models::{ChainOutcomeState, HistoryRecord, NativeTransferIntent};

fn history_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub fn load_history_records() -> Result<Vec<HistoryRecord>, String> {
    let path = history_path()?;
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn write_history_records(records: &[HistoryRecord]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    write_file_atomic(&history_path()?, &raw)
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
    let frozen_key = format!(
        "{}:{}:{}:{}:{}",
        intent.chain_id, intent.from, intent.to, intent.value_wei, intent.nonce
    );

    SubmissionRecord {
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
    let _guard = history_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let broadcasted_at = now_unix_seconds()?;
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

pub async fn submit_native_transfer(intent: NativeTransferIntent) -> Result<HistoryRecord, String> {
    submit_native_transfer_with_history_kind(intent, SubmissionKind::NativeTransfer, None).await
}

pub async fn submit_native_transfer_with_history_kind(
    intent: NativeTransferIntent,
    kind: SubmissionKind,
    replaces_tx_hash: Option<String>,
) -> Result<HistoryRecord, String> {
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
    persist_pending_history_with_kind(intent, tx_hash.clone(), kind, replaces_tx_hash).map_err(
        |error| {
            record_transaction_diagnostic(
                DiagnosticLevel::Error,
                "nativeTransferHistoryWriteAfterBroadcastFailed",
                None,
                None,
                Some(tx_hash.clone()),
                Some(error.clone()),
                json!({ "kind": history_kind }),
            );
            broadcast_history_write_error(&tx_hash, &error)
        },
    )
}
