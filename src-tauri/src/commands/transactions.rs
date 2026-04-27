use crate::models::NativeTransferIntent;
use crate::transactions::{persist_pending_history, submit_native_transfer};
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

#[tauri::command]
pub fn build_pending_history(
    intent: NativeTransferIntent,
    tx_hash: String,
) -> Result<String, String> {
    let record = persist_pending_history(intent, tx_hash)?;
    serde_json::to_string(&record).map_err(|e| e.to_string())
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
    let intent = NativeTransferIntent {
        rpc_url: request.rpc_url,
        account_index: request.account_index,
        chain_id: request.chain_id,
        from: request.from,
        to: request
            .to
            .ok_or_else(|| "replace requires a destination".to_string())?,
        value_wei: request
            .value_wei
            .ok_or_else(|| "replace requires a value".to_string())?,
        nonce: request.nonce,
        gas_limit: request.gas_limit,
        max_fee_per_gas: request.max_fee_per_gas,
        max_priority_fee_per_gas: request.max_priority_fee_per_gas,
    };

    let record = submit_native_transfer(intent).await?;
    crate::transactions::mark_prior_history_state(
        &tx_hash,
        crate::models::ChainOutcomeState::Replaced,
    )?;
    serde_json::to_string(&record).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_pending_transfer(request: PendingMutationRequest) -> Result<String, String> {
    let tx_hash = request.tx_hash.clone();
    let intent = NativeTransferIntent {
        rpc_url: request.rpc_url,
        account_index: request.account_index,
        chain_id: request.chain_id,
        from: request.from.clone(),
        to: request.from,
        value_wei: "0".to_string(),
        nonce: request.nonce,
        gas_limit: request.gas_limit,
        max_fee_per_gas: request.max_fee_per_gas,
        max_priority_fee_per_gas: request.max_priority_fee_per_gas,
    };

    let record = submit_native_transfer(intent).await?;
    crate::transactions::mark_prior_history_state(
        &tx_hash,
        crate::models::ChainOutcomeState::Cancelled,
    )?;
    serde_json::to_string(&record).map_err(|e| e.to_string())
}
