use std::sync::{Mutex, OnceLock};

use secrecy::{ExposeSecret, SecretString};

static SESSION_MNEMONIC: OnceLock<Mutex<Option<SecretString>>> = OnceLock::new();

fn session_slot() -> &'static Mutex<Option<SecretString>> {
    SESSION_MNEMONIC.get_or_init(|| Mutex::new(None))
}

pub fn write_session_mnemonic(mnemonic: String) {
    let secret = SecretString::from(mnemonic);
    let slot = session_slot();
    *slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(secret);
}

pub fn clear_session_mnemonic() {
    let slot = session_slot();
    *slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
}

pub fn with_session_mnemonic<T>(f: impl FnOnce(&str) -> Result<T, String>) -> Result<T, String> {
    let mnemonic = {
        let slot = session_slot();
        let guard = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| "vault is locked".to_string())?
    };

    f(mnemonic.expose_secret())
}
