use wallet_workbench_lib::vault::{decrypt_mnemonic, encrypt_mnemonic};

#[test]
fn encrypts_and_decrypts_a_mnemonic_roundtrip() {
    let phrase = "test test test test test test test test test test test junk";
    let password = "correct horse battery staple";

    let blob = encrypt_mnemonic(phrase, password).expect("encrypt");
    let roundtrip = decrypt_mnemonic(&blob, password).expect("decrypt");

    assert_eq!(roundtrip, phrase);
}
