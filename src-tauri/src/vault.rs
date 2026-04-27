use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use base64::Engine;
use rand::RngCore;
use zeroize::Zeroize;

use crate::models::VaultBlob;

const SALT_LEN: usize = 16;
const IV_LEN: usize = 12;

fn decode_fixed<const N: usize>(field_name: &str, value: &str) -> Result<[u8; N], String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|e| e.to_string())?;

    bytes
        .try_into()
        .map_err(|_| format!("invalid {field_name} length"))
}

pub fn encrypt_mnemonic(phrase: &str, password: &str) -> Result<VaultBlob, String> {
    let mut salt = [0u8; SALT_LEN];
    let mut iv = [0u8; IV_LEN];
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

    key.zeroize();

    Ok(VaultBlob {
        version: 1,
        salt_b64: base64::engine::general_purpose::STANDARD.encode(salt),
        iv_b64: base64::engine::general_purpose::STANDARD.encode(iv),
        ciphertext_b64: base64::engine::general_purpose::STANDARD.encode(ciphertext),
    })
}

pub fn decrypt_mnemonic(blob: &VaultBlob, password: &str) -> Result<String, String> {
    let salt = decode_fixed::<SALT_LEN>("salt", &blob.salt_b64)?;
    let iv = decode_fixed::<IV_LEN>("iv", &blob.iv_b64)?;
    let ciphertext = base64::engine::general_purpose::STANDARD
        .decode(&blob.ciphertext_b64)
        .map_err(|e| e.to_string())?;

    if ciphertext.is_empty() {
        return Err("invalid ciphertext length".to_string());
    }

    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|e| e.to_string())?;

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&iv), ciphertext.as_ref())
        .map_err(|_| "invalid password or vault data".to_string())?;

    key.zeroize();

    String::from_utf8(plaintext).map_err(|e| e.to_string())
}
