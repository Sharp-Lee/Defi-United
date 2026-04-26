use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use base64::Engine;
use rand::RngCore;

use crate::models::VaultBlob;

pub fn encrypt_mnemonic(phrase: &str, password: &str) -> Result<VaultBlob, String> {
    let mut salt = [0u8; 16];
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut iv);

    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|e| e.to_string())?;

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&iv), phrase.as_bytes())
        .map_err(|e| e.to_string())?;

    Ok(VaultBlob {
        version: 1,
        salt_b64: base64::engine::general_purpose::STANDARD.encode(salt),
        iv_b64: base64::engine::general_purpose::STANDARD.encode(iv),
        ciphertext_b64: base64::engine::general_purpose::STANDARD.encode(ciphertext),
    })
}

pub fn decrypt_mnemonic(blob: &VaultBlob, password: &str) -> Result<String, String> {
    let salt = base64::engine::general_purpose::STANDARD
        .decode(&blob.salt_b64)
        .map_err(|e| e.to_string())?;
    let iv = base64::engine::general_purpose::STANDARD
        .decode(&blob.iv_b64)
        .map_err(|e| e.to_string())?;
    let ciphertext = base64::engine::general_purpose::STANDARD
        .decode(&blob.ciphertext_b64)
        .map_err(|e| e.to_string())?;

    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|e| e.to_string())?;

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&iv), ciphertext.as_ref())
        .map_err(|_| "invalid password or vault data".to_string())?;

    String::from_utf8(plaintext).map_err(|e| e.to_string())
}
