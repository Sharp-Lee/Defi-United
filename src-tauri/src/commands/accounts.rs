use serde::{Deserialize, Serialize};
use std::fs;

use crate::accounts::derive_account_address;
use crate::storage::accounts_path;

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
    account: AccountRecord,
    chain_id: u64,
    native_balance_wei: String,
    nonce: u64,
) -> Result<StoredAccountRecord, String> {
    let path = accounts_path()?;
    let existing = match fs::read_to_string(&path) {
        Ok(raw) => {
            serde_json::from_str::<Vec<StoredAccountRecord>>(&raw).map_err(|e| e.to_string())?
        }
        Err(_) => Vec::new(),
    };

    let mut accounts = existing;
    let snapshot = AccountSnapshotRecord {
        chain_id,
        native_balance_wei,
        nonce,
    };

    if let Some(found) = accounts.iter_mut().find(|item| item.index == account.index) {
        found.address = account.address.clone();
        found.label = account.label.clone();
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

    fs::write(
        &path,
        serde_json::to_string_pretty(&accounts).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    accounts
        .into_iter()
        .find(|item| item.index == account.index)
        .ok_or_else(|| "stored account missing after save".to_string())
}
