use std::fs;
use std::io::ErrorKind;
use std::sync::{Mutex, OnceLock};

use ethers::middleware::SignerMiddleware;
use ethers::providers::{Http, Middleware, Provider};
use ethers::signers::Signer;
use ethers::types::{transaction::eip1559::Eip1559TransactionRequest, Address, H256, U256, U64};

use crate::accounts::derive_wallet;
use crate::models::{ChainOutcome, SubmissionRecord};
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

pub fn persist_pending_history(
    intent: NativeTransferIntent,
    tx_hash: String,
) -> Result<HistoryRecord, String> {
    let _guard = history_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let frozen_key = format!(
        "{}:{}:{}:{}:{}",
        intent.chain_id, intent.from, intent.to, intent.value_wei, intent.nonce
    );

    let record = HistoryRecord {
        intent,
        submission: SubmissionRecord {
            frozen_key,
            tx_hash: tx_hash.clone(),
        },
        outcome: ChainOutcome {
            state: ChainOutcomeState::Pending,
            tx_hash,
        },
    };

    let mut records = load_history_records()?;
    records.push(record.clone());
    write_history_records(&records)?;

    Ok(record)
}

pub fn mark_prior_history_state(
    tx_hash: &str,
    next_state: ChainOutcomeState,
) -> Result<(), String> {
    let _guard = history_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut records = load_history_records()?;

    let Some(record) = records
        .iter_mut()
        .find(|record| record.outcome.tx_hash == tx_hash)
    else {
        return Err(format!(
            "pending history record not found for tx_hash {tx_hash}"
        ));
    };

    if record.outcome.state != ChainOutcomeState::Pending {
        return Err(format!(
            "history record for tx_hash {tx_hash} is not pending"
        ));
    }

    record.outcome.state = next_state;
    write_history_records(&records)
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
    if record.outcome.state == ChainOutcomeState::Pending
        && record.intent.nonce < latest_confirmed_nonce
    {
        Some(ChainOutcomeState::Dropped)
    } else {
        None
    }
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
            record.outcome.state == ChainOutcomeState::Pending
                && record.intent.chain_id == chain_id
                && record.intent.account_index == account_index
                && record.intent.from.eq_ignore_ascii_case(from)
        })
        .fold(on_chain_nonce, |next_nonce, record| {
            next_nonce.max(record.intent.nonce.saturating_add(1))
        })
}

pub fn apply_pending_history_updates(
    chain_id: u64,
    updates: &[(String, ChainOutcomeState)],
) -> Result<Vec<HistoryRecord>, String> {
    if updates.is_empty() {
        return load_history_records();
    }

    let _guard = history_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut records = load_history_records()?;
    for record in &mut records {
        if record.intent.chain_id != chain_id || record.outcome.state != ChainOutcomeState::Pending
        {
            continue;
        }
        if let Some((_, next_state)) = updates
            .iter()
            .find(|(tx_hash, _)| tx_hash == &record.outcome.tx_hash)
        {
            record.outcome.state = next_state.clone();
        }
    }
    write_history_records(&records)?;
    Ok(records)
}

pub async fn reconcile_pending_history(
    rpc_url: String,
    chain_id: u64,
) -> Result<Vec<HistoryRecord>, String> {
    let provider = Provider::<Http>::try_from(rpc_url).map_err(|e| e.to_string())?;
    let remote_chain_id = provider.get_chainid().await.map_err(|e| e.to_string())?;
    if remote_chain_id.as_u64() != chain_id {
        return Err(format!(
            "remote chainId {} does not match requested chainId {}",
            remote_chain_id, chain_id
        ));
    }

    let records = load_history_records()?;
    let pending_records = records
        .iter()
        .filter(|record| {
            record.intent.chain_id == chain_id && record.outcome.state == ChainOutcomeState::Pending
        })
        .cloned()
        .collect::<Vec<_>>();

    let mut updates = Vec::new();
    for record in pending_records {
        let tx_hash = record.outcome.tx_hash.clone();
        let parsed_hash = tx_hash.parse::<H256>().map_err(|e| format!("{e}"))?;
        if let Some(receipt) = provider
            .get_transaction_receipt(parsed_hash)
            .await
            .map_err(|e| e.to_string())?
        {
            let next_state = chain_outcome_from_receipt_status(receipt.status);
            if next_state != ChainOutcomeState::Pending {
                updates.push((tx_hash, next_state));
            }
            continue;
        }

        let from = record
            .intent
            .from
            .parse::<Address>()
            .map_err(|e| format!("{e}"))?;
        let latest_confirmed_nonce = provider
            .get_transaction_count(from, None)
            .await
            .map_err(|e| e.to_string())?
            .as_u64();
        if let Some(next_state) = dropped_state_for_missing_receipt(&record, latest_confirmed_nonce)
        {
            updates.push((tx_hash, next_state));
        }
    }

    apply_pending_history_updates(chain_id, &updates)
}

async fn preflight_native_transfer(
    intent: &NativeTransferIntent,
    signer_address: Address,
    provider: &Provider<Http>,
) -> Result<(), String> {
    let remote_chain_id = provider.get_chainid().await.map_err(|e| e.to_string())?;
    if remote_chain_id.as_u64() != intent.chain_id {
        return Err(format!(
            "remote chainId {} does not match intent chainId {}",
            remote_chain_id, intent.chain_id
        ));
    }

    let expected_from: Address = intent.from.parse().map_err(|e| format!("{e}"))?;
    if signer_address != expected_from {
        return Err("derived wallet does not match intent.from".to_string());
    }

    let balance = provider
        .get_balance(signer_address, None)
        .await
        .map_err(|e| e.to_string())?;
    let value = U256::from_dec_str(&intent.value_wei).map_err(|e| e.to_string())?;
    let gas_limit = U256::from_dec_str(&intent.gas_limit).map_err(|e| e.to_string())?;
    let max_fee_per_gas = U256::from_dec_str(&intent.max_fee_per_gas).map_err(|e| e.to_string())?;
    let total_cost = value + gas_limit * max_fee_per_gas;
    if balance < total_cost {
        return Err("balance cannot cover value plus max gas cost".to_string());
    }

    let latest_nonce = provider
        .get_transaction_count(signer_address, None)
        .await
        .map_err(|e| e.to_string())?;
    if intent.nonce < latest_nonce.as_u64() {
        return Err(format!(
            "intent nonce {} is below latest on-chain nonce {}",
            intent.nonce, latest_nonce
        ));
    }

    Ok(())
}

pub async fn submit_native_transfer(intent: NativeTransferIntent) -> Result<HistoryRecord, String> {
    let wallet = with_session_mnemonic(|mnemonic| derive_wallet(mnemonic, intent.account_index))?
        .with_chain_id(intent.chain_id);
    let provider = Provider::<Http>::try_from(intent.rpc_url.clone()).map_err(|e| e.to_string())?;
    preflight_native_transfer(&intent, wallet.address(), &provider).await?;
    load_history_records()?;
    let signer = SignerMiddleware::new(provider, wallet);

    let tx = Eip1559TransactionRequest::new()
        .to(intent.to.parse::<Address>().map_err(|e| format!("{e}"))?)
        .from(intent.from.parse::<Address>().map_err(|e| format!("{e}"))?)
        .value(U256::from_dec_str(&intent.value_wei).map_err(|e| e.to_string())?)
        .nonce(U256::from(intent.nonce))
        .gas(U256::from_dec_str(&intent.gas_limit).map_err(|e| e.to_string())?)
        .max_fee_per_gas(U256::from_dec_str(&intent.max_fee_per_gas).map_err(|e| e.to_string())?)
        .max_priority_fee_per_gas(
            U256::from_dec_str(&intent.max_priority_fee_per_gas).map_err(|e| e.to_string())?,
        )
        .chain_id(intent.chain_id);

    let pending = signer
        .send_transaction(tx, None)
        .await
        .map_err(|e| e.to_string())?;
    let tx_hash = format!("{:#x}", pending.tx_hash());

    persist_pending_history(intent, tx_hash.clone())
        .map_err(|error| broadcast_history_write_error(&tx_hash, &error))
}
