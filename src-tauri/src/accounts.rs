use coins_bip32::path::DerivationPath;
use coins_bip32::prelude::XPriv;
use coins_bip39::Mnemonic;
use ethers::signers::{LocalWallet, Signer};
use ethers::utils::to_checksum;

pub fn derive_wallet(phrase: &str, index: u32) -> Result<LocalWallet, String> {
    let mnemonic: Mnemonic<coins_bip39::English> = phrase.parse().map_err(|e| format!("{e}"))?;
    let seed = mnemonic.to_seed(None).map_err(|e| format!("{e}"))?;
    let path: DerivationPath = format!("m/44'/60'/0'/0/{index}")
        .parse()
        .map_err(|e| format!("{e}"))?;
    let root = XPriv::root_from_seed(seed.as_ref(), None).map_err(|e| format!("{e}"))?;
    let derived = root
        .derive_path::<std::convert::Infallible, _>(path)
        .map_err(|e| format!("{e}"))?;
    let secret = <XPriv as AsRef<coins_bip32::ecdsa::SigningKey>>::as_ref(&derived).to_bytes();
    LocalWallet::from_bytes(secret.as_slice()).map_err(|e| e.to_string())
}

pub fn derive_account_address(phrase: &str, index: u32) -> Result<String, String> {
    let wallet = derive_wallet(phrase, index)?;
    Ok(to_checksum(&wallet.address(), None))
}
