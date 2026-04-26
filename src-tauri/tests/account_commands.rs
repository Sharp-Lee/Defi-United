use wallet_workbench_lib::accounts::derive_account_address;

#[test]
fn derives_expected_first_child_address() {
    let phrase = "test test test test test test test test test test test junk";
    let address = derive_account_address(phrase, 1).expect("derive");

    assert_eq!(address, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
}
