use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use wallet_workbench_lib::accounts::derive_account_address;
use wallet_workbench_lib::commands::accounts::{save_scanned_account, StoredAccountRecord};
use wallet_workbench_lib::session::{clear_session_mnemonic, write_session_mnemonic};
use wallet_workbench_lib::storage::accounts_path;

const APP_DIR_ENV: &str = "EVM_WALLET_WORKBENCH_APP_DIR";
const TEST_MNEMONIC: &str = "test test test test test test test test test test test junk";

fn test_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn unique_test_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "wallet-workbench-{label}-{}-{nanos}",
        std::process::id()
    ))
}

fn with_test_app_dir(test_name: &str, f: impl FnOnce(&Path)) {
    let _guard = test_lock().lock().expect("test lock");
    let dir = unique_test_dir(test_name);
    let previous = std::env::var_os(APP_DIR_ENV);

    if dir.exists() {
        fs::remove_dir_all(&dir).expect("clean temp dir");
    }

    fs::create_dir_all(&dir).expect("create temp dir");
    std::env::set_var(APP_DIR_ENV, &dir);
    clear_session_mnemonic();
    write_session_mnemonic(TEST_MNEMONIC.to_string());

    f(&dir);

    clear_session_mnemonic();
    if let Some(value) = previous {
        std::env::set_var(APP_DIR_ENV, value);
    } else {
        std::env::remove_var(APP_DIR_ENV);
    }
    fs::remove_dir_all(&dir).expect("remove temp dir");
}

fn read_registry() -> Vec<StoredAccountRecord> {
    let raw = fs::read_to_string(accounts_path().expect("accounts path")).expect("read registry");
    serde_json::from_str(&raw).expect("parse registry")
}

#[test]
fn derives_expected_first_child_address() {
    let address = derive_account_address(TEST_MNEMONIC, 1).expect("derive");

    assert_eq!(address, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
}

#[test]
fn first_save_creates_the_registry() {
    with_test_app_dir("first-save-creates-registry", |_| {
        let stored = save_scanned_account(1, 1, "123".to_string(), 7).expect("save");

        assert_eq!(stored.index, 1);
        assert_eq!(stored.address, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
        assert_eq!(stored.label, "Account 1");
        assert_eq!(stored.snapshots.len(), 1);

        let registry = read_registry();
        assert_eq!(registry.len(), 1);
        assert_eq!(registry[0].snapshots.len(), 1);
        assert_eq!(registry[0].snapshots[0].chain_id, 1);
        assert_eq!(registry[0].snapshots[0].native_balance_wei, "123");
        assert_eq!(registry[0].snapshots[0].nonce, 7);
    });
}

#[test]
fn second_save_same_account_same_chain_replaces_snapshot() {
    with_test_app_dir("same-account-same-chain-replaces", |_| {
        save_scanned_account(1, 1, "123".to_string(), 7).expect("first save");
        let stored = save_scanned_account(1, 1, "456".to_string(), 8).expect("second save");

        assert_eq!(stored.snapshots.len(), 1);
        assert_eq!(stored.snapshots[0].native_balance_wei, "456");
        assert_eq!(stored.snapshots[0].nonce, 8);

        let registry = read_registry();
        assert_eq!(registry.len(), 1);
        assert_eq!(registry[0].snapshots.len(), 1);
        assert_eq!(registry[0].snapshots[0].native_balance_wei, "456");
        assert_eq!(registry[0].snapshots[0].nonce, 8);
    });
}

#[test]
fn second_save_same_account_different_chain_appends_snapshot() {
    with_test_app_dir("same-account-different-chain-appends", |_| {
        save_scanned_account(1, 1, "123".to_string(), 7).expect("first save");
        let stored = save_scanned_account(1, 10, "999".to_string(), 2).expect("second save");

        assert_eq!(stored.snapshots.len(), 2);

        let registry = read_registry();
        assert_eq!(registry.len(), 1);
        assert_eq!(registry[0].snapshots.len(), 2);
        assert!(registry[0].snapshots.iter().any(|snapshot| {
            snapshot.chain_id == 1 && snapshot.native_balance_wei == "123" && snapshot.nonce == 7
        }));
        assert!(registry[0].snapshots.iter().any(|snapshot| {
            snapshot.chain_id == 10 && snapshot.native_balance_wei == "999" && snapshot.nonce == 2
        }));
    });
}

#[test]
fn malformed_existing_registry_surfaces_an_error() {
    with_test_app_dir("malformed-registry-errors", |_| {
        fs::write(
            accounts_path().expect("accounts path"),
            "{ this is not valid json",
        )
        .expect("write malformed registry");

        let error = save_scanned_account(1, 1, "123".to_string(), 7)
            .expect_err("save should fail for malformed registry");

        assert!(!error.is_empty());

        let raw = fs::read_to_string(accounts_path().expect("accounts path"))
            .expect("malformed registry should remain on disk");
        assert_eq!(raw, "{ this is not valid json");
    });
}
