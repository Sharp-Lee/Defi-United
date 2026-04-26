use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use rand::Rng;

const APP_DIR_ENV: &str = "EVM_WALLET_WORKBENCH_APP_DIR";

pub fn app_dir() -> Result<PathBuf, String> {
    if let Some(override_dir) = std::env::var_os(APP_DIR_ENV) {
        return Ok(PathBuf::from(override_dir));
    }

    let base = dirs::home_dir().ok_or_else(|| "unable to resolve home directory".to_string())?;
    Ok(base.join("Library/Application Support/EVMWalletWorkbench"))
}

pub fn ensure_app_dir() -> Result<PathBuf, String> {
    let dir = app_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn vault_path() -> Result<PathBuf, String> {
    Ok(ensure_app_dir()?.join("vault.json"))
}

pub fn accounts_path() -> Result<PathBuf, String> {
    Ok(ensure_app_dir()?.join("accounts.json"))
}

pub fn history_path() -> Result<PathBuf, String> {
    Ok(ensure_app_dir()?.join("tx-history.json"))
}

pub fn write_new_file_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }

    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{} has an invalid file name", path.display()))?;
    let temp_path = parent.join(format!(
        ".{file_name}.tmp-{}-{:016x}",
        std::process::id(),
        rand::thread_rng().gen::<u64>()
    ));

    let write_result = (|| -> Result<(), String> {
        let mut temp_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|e| e.to_string())?;
        temp_file
            .write_all(contents.as_bytes())
            .map_err(|e| e.to_string())?;
        temp_file.sync_all().map_err(|e| e.to_string())?;

        if path.exists() {
            return Err(format!("{} already exists", path.display()));
        }

        rename_no_replace(&temp_path, path)
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    write_result
}

#[cfg(target_os = "macos")]
fn rename_no_replace(from: &Path, to: &Path) -> Result<(), String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let from_cstr = CString::new(from.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let to_cstr = CString::new(to.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let result =
        unsafe { libc::renamex_np(from_cstr.as_ptr(), to_cstr.as_ptr(), libc::RENAME_EXCL) };

    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error().to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn rename_no_replace(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|e| e.to_string())
}
