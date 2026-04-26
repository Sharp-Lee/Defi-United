use std::sync::{Mutex, OnceLock};

static SESSION_MNEMONIC: OnceLock<Mutex<Option<String>>> = OnceLock::new();

pub fn write_session_mnemonic(mnemonic: String) {
    let slot = SESSION_MNEMONIC.get_or_init(|| Mutex::new(None));
    *slot.lock().expect("session lock") = Some(mnemonic);
}

pub fn clear_session_mnemonic() {
    let slot = SESSION_MNEMONIC.get_or_init(|| Mutex::new(None));
    *slot.lock().expect("session lock") = None;
}

pub fn with_session_mnemonic<T>(f: impl FnOnce(&str) -> Result<T, String>) -> Result<T, String> {
    let slot = SESSION_MNEMONIC.get_or_init(|| Mutex::new(None));
    let guard = slot.lock().expect("session lock");
    let mnemonic = guard
        .as_deref()
        .ok_or_else(|| "vault is locked".to_string())?;
    f(mnemonic)
}
