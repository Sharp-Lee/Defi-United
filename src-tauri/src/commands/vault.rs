use std::fs;

use crate::models::VaultBlob;
use crate::storage::{vault_path, write_new_file_atomic};
use crate::vault::{decrypt_mnemonic, encrypt_mnemonic};

fn generate_vault_mnemonic() -> Result<String, String> {
    Ok(bip39::Mnemonic::generate_in(bip39::Language::English, 12)
        .map_err(|e| e.to_string())?
        .to_string())
}

#[tauri::command]
pub fn create_vault(password: String) -> Result<(), String> {
    let path = vault_path()?;
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }

    let mnemonic = generate_vault_mnemonic()?;
    bip39::Mnemonic::parse_in_normalized(bip39::Language::English, &mnemonic)
        .map_err(|e| e.to_string())?;

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

#[tauri::command]
pub fn lock_vault() -> Result<(), String> {
    crate::session::clear_session_mnemonic();
    Ok(())
}
