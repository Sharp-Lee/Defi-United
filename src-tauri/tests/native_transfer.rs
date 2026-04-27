use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use wallet_workbench_lib::storage::history_path;
use wallet_workbench_lib::transactions::{
    persist_pending_history, ChainOutcomeState, HistoryRecord, NativeTransferIntent,
};

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

    f(&dir);

    if let Some(value) = previous {
        std::env::set_var(APP_DIR_ENV, value);
    } else {
        std::env::remove_var(APP_DIR_ENV);
    }
    fs::remove_dir_all(&dir).expect("remove temp dir");
}

fn native_transfer_intent(nonce: u64, value_wei: &str) -> NativeTransferIntent {
    NativeTransferIntent {
        rpc_url: "http://127.0.0.1:8545".into(),
        account_index: 1,
        chain_id: 1,
        from: "0x1111111111111111111111111111111111111111".into(),
        to: "0x2222222222222222222222222222222222222222".into(),
        value_wei: value_wei.into(),
        nonce,
        gas_limit: "21000".into(),
        max_fee_per_gas: "40000000000".into(),
        max_priority_fee_per_gas: "1500000000".into(),
    }
}

#[test]
fn writes_pending_history_before_confirmation() {
    with_test_app_dir("pending-history", |_| {
        let first = persist_pending_history(native_transfer_intent(2, "1"), "0xdef".into())
            .expect("persist existing");
        let record = persist_pending_history(
            native_transfer_intent(3, "1000000000000000"),
            "0xabc".into(),
        )
        .expect("persist");

        assert_eq!(record.outcome.state, ChainOutcomeState::Pending);
        assert_eq!(record.outcome.tx_hash, "0xabc");
        assert_eq!(
            record.submission.frozen_key,
            "1:0x1111111111111111111111111111111111111111:0x2222222222222222222222222222222222222222:1000000000000000:3"
        );

        let raw = fs::read_to_string(history_path().expect("history path")).expect("read history");
        let records: Vec<HistoryRecord> = serde_json::from_str(&raw).expect("parse history");

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].outcome.tx_hash, first.outcome.tx_hash);
        assert_eq!(records[1].outcome.tx_hash, "0xabc");
    });
}

#[test]
fn replace_and_cancel_mutations_keep_the_same_nonce_contract() {
    let request = wallet_workbench_lib::commands::transactions::PendingMutationRequest {
        tx_hash: "0xabc".into(),
        rpc_url: "http://127.0.0.1:8545".into(),
        account_index: 1,
        chain_id: 31337,
        from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".into(),
        nonce: 5,
        gas_limit: "21000".into(),
        max_fee_per_gas: "2000000000".into(),
        max_priority_fee_per_gas: "1500000000".into(),
        to: Some("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC".into()),
        value_wei: Some("1000000000000000".into()),
    };

    assert_eq!(request.nonce, 5);
    assert_eq!(request.from, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "requires anvil running on 127.0.0.1:8545"]
async fn submit_native_transfer_roundtrip_against_anvil() {
    let _guard = test_lock().lock().expect("test lock");
    let dir = unique_test_dir("native-transfer-roundtrip");
    let previous = std::env::var_os(APP_DIR_ENV);

    if dir.exists() {
        fs::remove_dir_all(&dir).expect("clean temp dir");
    }
    fs::create_dir_all(&dir).expect("create temp dir");
    std::env::set_var(APP_DIR_ENV, &dir);
    wallet_workbench_lib::session::clear_session_mnemonic();
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );

    let intent = NativeTransferIntent {
        rpc_url: "http://127.0.0.1:8545".into(),
        account_index: 1,
        chain_id: 31337,
        from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".into(),
        to: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC".into(),
        value_wei: "1000000000000000".into(),
        nonce: 0,
        gas_limit: "21000".into(),
        max_fee_per_gas: "2000000000".into(),
        max_priority_fee_per_gas: "1500000000".into(),
    };

    let result = wallet_workbench_lib::transactions::submit_native_transfer(intent).await;

    wallet_workbench_lib::session::clear_session_mnemonic();
    if let Some(value) = previous {
        std::env::set_var(APP_DIR_ENV, value);
    } else {
        std::env::remove_var(APP_DIR_ENV);
    }
    fs::remove_dir_all(&dir).expect("remove temp dir");

    assert!(result.is_ok(), "submit failed: {result:?}");
}
