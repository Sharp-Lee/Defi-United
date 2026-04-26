use std::fs;

use crate::models::VaultBlob;
use crate::storage::{vault_path, write_new_file_atomic};
use crate::vault::{decrypt_mnemonic, encrypt_mnemonic};

#[tauri::command]
pub fn create_vault(mnemonic: String, password: String) -> Result<(), String> {
    let path = vault_path()?;
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }

    let blob = encrypt_mnemonic(&mnemonic, &password)?;
    let raw = serde_json::to_string_pretty(&blob).map_err(|e| e.to_string())?;
    write_new_file_atomic(&path, &raw)
}

#[tauri::command]
pub fn unlock_vault(password: String) -> Result<crate::models::SessionSummary, String> {
    let raw = fs::read_to_string(vault_path()?).map_err(|e| e.to_string())?;
    let blob: VaultBlob = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let mnemonic = decrypt_mnemonic(&blob, &password)?;
    crate::session::write_session_mnemonic(mnemonic);
    Ok(crate::models::SessionSummary {
        status: "ready".to_string(),
    })
}
