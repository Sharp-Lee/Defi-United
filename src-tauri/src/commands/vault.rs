use std::fs;

use crate::models::VaultBlob;
use crate::storage::vault_path;
use crate::vault::{decrypt_mnemonic, encrypt_mnemonic};

#[tauri::command]
pub fn create_vault(mnemonic: String, password: String) -> Result<(), String> {
    let blob = encrypt_mnemonic(&mnemonic, &password)?;
    let raw = serde_json::to_string_pretty(&blob).map_err(|e| e.to_string())?;
    fs::write(vault_path(), raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unlock_vault(password: String) -> Result<crate::models::SessionSummary, String> {
    let raw = fs::read_to_string(vault_path()).map_err(|e| e.to_string())?;
    let blob: VaultBlob = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let mnemonic = decrypt_mnemonic(&blob, &password)?;
    crate::session::write_session_mnemonic(mnemonic);
    Ok(crate::models::SessionSummary {
        status: "ready".to_string(),
    })
}
