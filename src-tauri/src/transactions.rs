use std::fs;
use std::io::ErrorKind;
use std::sync::{Mutex, OnceLock};

use ethers::middleware::SignerMiddleware;
use ethers::providers::{Http, Middleware, Provider};
use ethers::signers::Signer;
use ethers::types::{transaction::eip1559::Eip1559TransactionRequest, Address, U256};

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
    let raw = serde_json::to_string_pretty(&records).map_err(|e| e.to_string())?;
    write_file_atomic(&history_path()?, &raw)?;

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

    if let Some(record) = records
        .iter_mut()
        .find(|record| record.outcome.tx_hash == tx_hash)
    {
        record.outcome.state = next_state;
    }

    let raw = serde_json::to_string_pretty(&records).map_err(|e| e.to_string())?;
    write_file_atomic(&history_path()?, &raw)
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

    persist_pending_history(intent, tx_hash)
}
