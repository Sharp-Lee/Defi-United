use crate::models::NativeTransferIntent;
use crate::transactions::{persist_pending_history, submit_native_transfer};

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
