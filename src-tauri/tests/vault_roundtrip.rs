use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use wallet_workbench_lib::commands::vault::{create_vault, unlock_vault};
use wallet_workbench_lib::models::VaultBlob;
use wallet_workbench_lib::session::{clear_session_mnemonic, with_session_mnemonic};
use wallet_workbench_lib::storage::vault_path;
use wallet_workbench_lib::vault::{decrypt_mnemonic, encrypt_mnemonic};

const APP_DIR_ENV: &str = "EVM_WALLET_WORKBENCH_APP_DIR";

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

    f(&dir);

    clear_session_mnemonic();
    if let Some(value) = previous {
        std::env::set_var(APP_DIR_ENV, value);
    } else {
        std::env::remove_var(APP_DIR_ENV);
    }
    fs::remove_dir_all(&dir).expect("remove temp dir");
}

#[test]
fn encrypts_and_decrypts_a_mnemonic_roundtrip() {
    let phrase = "test test test test test test test test test test test junk";
    let password = "correct horse battery staple";

    let blob = encrypt_mnemonic(phrase, password).expect("encrypt");
    let roundtrip = decrypt_mnemonic(&blob, password).expect("decrypt");

    assert_eq!(roundtrip, phrase);
}

#[test]
fn creates_and_unlocks_a_vault() {
    with_test_app_dir("happy-path", |_| {
        let phrase = "test test test test test test test test test test test junk";
        let password = "correct horse battery staple";

        create_vault(phrase.to_string(), password.to_string()).expect("create");
        let summary = unlock_vault(password.to_string()).expect("unlock");

        assert_eq!(summary.status, "ready");
        assert!(vault_path().expect("vault path").exists());

        let restored =
            with_session_mnemonic(|mnemonic| Ok::<_, String>(mnemonic.to_string())).expect("read");
        assert_eq!(restored, phrase);
    });
}

#[test]
fn wrong_password_returns_an_error() {
    with_test_app_dir("wrong-password", |_| {
        let phrase = "test test test test test test test test test test test junk";

        create_vault(
            phrase.to_string(),
            "correct horse battery staple".to_string(),
        )
        .expect("create");
        let error = unlock_vault("bad password".to_string()).expect_err("unlock should fail");

        assert!(error.contains("invalid password or vault data"));
    });
}

#[test]
fn malformed_vault_blob_returns_an_error() {
    with_test_app_dir("malformed-blob", |_| {
        let malformed = VaultBlob {
            version: 1,
            salt_b64: "AAAAAAAAAAAAAAAAAAAA".to_string(),
            iv_b64: "AAAAAAAAAAAAAAA=".to_string(),
            ciphertext_b64: String::new(),
        };
        let raw = serde_json::to_string_pretty(&malformed).expect("serialize");

        fs::write(vault_path().expect("vault path"), raw).expect("write vault");

        let error = unlock_vault("correct horse battery staple".to_string())
            .expect_err("unlock should fail");

        assert!(!error.is_empty());
    });
}

#[test]
fn create_vault_rejects_duplicate_vaults() {
    with_test_app_dir("duplicate-create", |_| {
        let phrase = "test test test test test test test test test test test junk";
        let password = "correct horse battery staple";

        create_vault(phrase.to_string(), password.to_string()).expect("first create");
        let error = create_vault(phrase.to_string(), password.to_string())
            .expect_err("second create should fail");

        assert!(error.contains("already exists"));

        let summary = unlock_vault(password.to_string()).expect("unlock original");
        assert_eq!(summary.status, "ready");
    });
}
