use std::fs;
use std::path::PathBuf;

pub fn app_dir() -> PathBuf {
    let base = dirs::home_dir().expect("home dir");
    base.join("Library/Application Support/EVMWalletWorkbench")
}

pub fn ensure_app_dir() -> PathBuf {
    let dir = app_dir();
    fs::create_dir_all(&dir).expect("create app dir");
    dir
}

pub fn vault_path() -> PathBuf {
    ensure_app_dir().join("vault.json")
}

pub fn accounts_path() -> PathBuf {
    ensure_app_dir().join("accounts.json")
}

pub fn history_path() -> PathBuf {
    ensure_app_dir().join("tx-history.json")
}
