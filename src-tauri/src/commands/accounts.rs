use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::sync::{Mutex, OnceLock};

use crate::accounts::derive_account_address;
use crate::storage::{accounts_path, write_file_atomic};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountRecord {
    pub index: u32,
    pub address: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSnapshotRecord {
    pub chain_id: u64,
    pub native_balance_wei: String,
    pub nonce: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccountRecord {
    pub index: u32,
    pub address: String,
    pub label: String,
    pub snapshots: Vec<AccountSnapshotRecord>,
}

fn account_registry_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn read_accounts_registry() -> Result<Vec<StoredAccountRecord>, String> {
    let path = accounts_path()?;
    match fs::read_to_string(&path) {
        Ok(raw) => {
            serde_json::from_str::<Vec<StoredAccountRecord>>(&raw).map_err(|e| e.to_string())
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn derive_account(index: u32) -> Result<AccountRecord, String> {
    let address =
        crate::session::with_session_mnemonic(|mnemonic| derive_account_address(mnemonic, index))?;
    Ok(AccountRecord {
        index,
        address,
        label: format!("Account {index}"),
    })
}

#[tauri::command]
pub fn save_scanned_account(
    index: u32,
    chain_id: u64,
    native_balance_wei: String,
    nonce: u64,
) -> Result<StoredAccountRecord, String> {
    let _guard = account_registry_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let account = crate::session::with_session_mnemonic(|mnemonic| {
        Ok::<_, String>(AccountRecord {
            index,
            address: derive_account_address(mnemonic, index)?,
            label: format!("Account {index}"),
        })
    })?;
    let mut accounts = read_accounts_registry()?;
    let snapshot = AccountSnapshotRecord {
        chain_id,
        native_balance_wei,
        nonce,
    };

    if let Some(found) = accounts.iter_mut().find(|item| item.index == account.index) {
        found.address = account.address;
        found.label = account.label;
        if let Some(existing_snapshot) = found
            .snapshots
            .iter_mut()
            .find(|item| item.chain_id == chain_id)
        {
            *existing_snapshot = snapshot;
        } else {
            found.snapshots.push(snapshot);
        }
    } else {
        accounts.push(StoredAccountRecord {
            index: account.index,
            address: account.address.clone(),
            label: account.label.clone(),
            snapshots: vec![snapshot],
        });
    }

    let raw = serde_json::to_string_pretty(&accounts).map_err(|e| e.to_string())?;
    write_file_atomic(&accounts_path()?, &raw)?;

    accounts
        .into_iter()
        .find(|item| item.index == account.index)
        .ok_or_else(|| "stored account missing after save".to_string())
}
