use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

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
    #[serde(default)]
    pub account_address: String,
    pub native_balance_wei: String,
    pub nonce: u64,
    #[serde(default)]
    pub last_synced_at: Option<String>,
    #[serde(default)]
    pub last_sync_error: Option<String>,
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

fn now_unix_seconds() -> Result<String, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string())
}

fn derive_current_account(index: u32) -> Result<AccountRecord, String> {
    crate::session::with_session_mnemonic(|mnemonic| {
        Ok::<_, String>(AccountRecord {
            index,
            address: derive_account_address(mnemonic, index)?,
            label: format!("Account {index}"),
        })
    })
}

fn snapshot_matches(
    snapshot: &AccountSnapshotRecord,
    chain_id: u64,
    account_address: &str,
) -> bool {
    snapshot.chain_id == chain_id
        && (snapshot.account_address.is_empty() || snapshot.account_address == account_address)
}

fn upsert_account_snapshot(
    accounts: &mut Vec<StoredAccountRecord>,
    account: &AccountRecord,
    snapshot: AccountSnapshotRecord,
) {
    if let Some(found) = accounts.iter_mut().find(|item| item.index == account.index) {
        found.address = account.address.clone();
        found.label = account.label.clone();
        if let Some(existing_snapshot) = found
            .snapshots
            .iter_mut()
            .find(|item| snapshot_matches(item, snapshot.chain_id, &snapshot.account_address))
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
}

fn write_accounts_registry(accounts: &[StoredAccountRecord]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(accounts).map_err(|e| e.to_string())?;
    write_file_atomic(&accounts_path()?, &raw)
}

#[tauri::command]
pub fn load_accounts() -> Result<Vec<StoredAccountRecord>, String> {
    read_accounts_registry()
}

#[tauri::command]
pub fn derive_account(index: u32) -> Result<AccountRecord, String> {
    derive_current_account(index)
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
    let account = derive_current_account(index)?;
    let mut accounts = read_accounts_registry()?;
    let snapshot = AccountSnapshotRecord {
        chain_id,
        account_address: account.address.clone(),
        native_balance_wei,
        nonce,
        last_synced_at: Some(now_unix_seconds()?),
        last_sync_error: None,
    };

    upsert_account_snapshot(&mut accounts, &account, snapshot);

    write_accounts_registry(&accounts)?;

    accounts
        .into_iter()
        .find(|item| item.index == account.index)
        .ok_or_else(|| "stored account missing after save".to_string())
}

#[tauri::command]
pub fn save_account_sync_error(
    index: u32,
    chain_id: u64,
    error: String,
) -> Result<StoredAccountRecord, String> {
    let _guard = account_registry_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let account = derive_current_account(index)?;
    let mut accounts = read_accounts_registry()?;
    let existing_snapshot = accounts
        .iter()
        .find(|item| item.index == account.index)
        .and_then(|item| {
            item.snapshots
                .iter()
                .find(|snapshot| snapshot_matches(snapshot, chain_id, &account.address))
        });
    let snapshot = AccountSnapshotRecord {
        chain_id,
        account_address: account.address.clone(),
        native_balance_wei: existing_snapshot
            .map(|snapshot| snapshot.native_balance_wei.clone())
            .unwrap_or_else(|| "0".to_string()),
        nonce: existing_snapshot
            .map(|snapshot| snapshot.nonce)
            .unwrap_or(0),
        last_synced_at: Some(now_unix_seconds()?),
        last_sync_error: Some(error),
    };

    upsert_account_snapshot(&mut accounts, &account, snapshot);

    write_accounts_registry(&accounts)?;

    accounts
        .into_iter()
        .find(|item| item.index == account.index)
        .ok_or_else(|| "stored account missing after save".to_string())
}
