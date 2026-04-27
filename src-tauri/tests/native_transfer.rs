use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ethers::types::U64;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use wallet_workbench_lib::diagnostics::read_diagnostic_events_from_path;
use wallet_workbench_lib::storage::{diagnostics_path, history_path};
use wallet_workbench_lib::transactions::{
    apply_pending_history_updates, broadcast_history_write_error,
    chain_outcome_from_receipt_status, dropped_state_for_missing_receipt, inspect_history_storage,
    load_history_records, load_history_recovery_intents, mark_prior_history_state,
    mark_prior_history_state_with_replacement, next_nonce_with_pending_history, nonce_thread_key,
    persist_pending_history, persist_pending_history_with_kind, quarantine_history_storage,
    reconcile_pending_history, recover_broadcasted_history_record, review_dropped_history_record,
    ChainOutcomeState, HistoryCorruptionType, HistoryRecord, HistoryStorageStatus,
    NativeTransferIntent,
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

struct TestAppDirGuard {
    dir: PathBuf,
    previous: Option<std::ffi::OsString>,
}

impl TestAppDirGuard {
    fn new(test_name: &str) -> Self {
        let dir = unique_test_dir(test_name);
        let previous = std::env::var_os(APP_DIR_ENV);

        if dir.exists() {
            fs::remove_dir_all(&dir).expect("clean temp dir");
        }

        fs::create_dir_all(&dir).expect("create temp dir");
        std::env::set_var(APP_DIR_ENV, &dir);
        wallet_workbench_lib::session::clear_session_mnemonic();

        Self { dir, previous }
    }
}

impl Drop for TestAppDirGuard {
    fn drop(&mut self) {
        wallet_workbench_lib::session::clear_session_mnemonic();
        if let Some(value) = &self.previous {
            std::env::set_var(APP_DIR_ENV, value);
        } else {
            std::env::remove_var(APP_DIR_ENV);
        }
        let _ = fs::remove_dir_all(&self.dir);
    }
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

fn history_record(nonce: u64, state: ChainOutcomeState, tx_hash: &str) -> HistoryRecord {
    let intent = native_transfer_intent(nonce, "1");
    let key = nonce_thread_key(
        intent.chain_id,
        intent.account_index,
        &intent.from,
        intent.nonce,
    );

    HistoryRecord {
        schema_version: 2,
        intent_snapshot: wallet_workbench_lib::models::IntentSnapshotMetadata {
            source: "test".into(),
            captured_at: Some("1700000000".into()),
        },
        submission: wallet_workbench_lib::models::SubmissionRecord {
            frozen_key: format!(
                "{}:{}:{}:{}:{}",
                intent.chain_id, intent.from, intent.to, intent.value_wei, intent.nonce
            ),
            tx_hash: tx_hash.into(),
            kind: wallet_workbench_lib::models::SubmissionKind::NativeTransfer,
            source: "submission".into(),
            chain_id: Some(intent.chain_id),
            account_index: Some(intent.account_index),
            from: Some(intent.from.clone()),
            to: Some(intent.to.clone()),
            value_wei: Some(intent.value_wei.clone()),
            nonce: Some(intent.nonce),
            gas_limit: Some(intent.gas_limit.clone()),
            max_fee_per_gas: Some(intent.max_fee_per_gas.clone()),
            max_priority_fee_per_gas: Some(intent.max_priority_fee_per_gas.clone()),
            broadcasted_at: Some("1700000000".into()),
            replaces_tx_hash: None,
        },
        outcome: wallet_workbench_lib::models::ChainOutcome {
            state,
            tx_hash: tx_hash.into(),
            receipt: None,
            finalized_at: None,
            reconciled_at: None,
            reconcile_summary: None,
            error_summary: None,
            dropped_review_history: Vec::new(),
        },
        nonce_thread: wallet_workbench_lib::models::NonceThread {
            source: "derived".into(),
            key,
            chain_id: Some(intent.chain_id),
            account_index: Some(intent.account_index),
            from: Some(intent.from.clone()),
            nonce: Some(intent.nonce),
            replaces_tx_hash: None,
            replaced_by_tx_hash: None,
        },
        intent,
    }
}

fn start_preflight_rpc_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind rpc server");
    let address = listener.local_addr().expect("local addr");
    thread::spawn(move || {
        for (index, stream) in listener.incoming().take(2).enumerate() {
            let mut stream = stream.expect("accept rpc request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set read timeout");
            let mut buffer = [0; 4096];
            let bytes = stream.read(&mut buffer).expect("read rpc request");
            let request = String::from_utf8_lossy(&buffer[..bytes]);
            let result = if request.contains("eth_chainId") || index == 0 {
                "\"0x1\""
            } else if request.contains("eth_getBalance") || index == 1 {
                "\"0xffffffffffffffffffff\""
            } else {
                "null"
            };
            let body = format!(r#"{{"jsonrpc":"2.0","id":1,"result":{result}}}"#);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write rpc response");
        }
    });
    format!("http://{address}")
}

fn start_submission_guard_rpc_server() -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind rpc server");
    let address = listener.local_addr().expect("local addr");
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&requests);
    thread::spawn(move || {
        for stream in listener.incoming().take(4) {
            let mut stream = stream.expect("accept rpc request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set read timeout");
            let mut buffer = [0; 4096];
            let bytes = stream.read(&mut buffer).expect("read rpc request");
            let mut request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
            while !request.contains("eth_") {
                match stream.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(bytes) => request.push_str(&String::from_utf8_lossy(&buffer[..bytes])),
                    Err(_) => break,
                }
            }
            seen.lock().expect("request lock").push(request.clone());
            let result = if request.contains("eth_chainId") {
                "\"0x1\""
            } else if request.contains("eth_getBalance") {
                "\"0xffffffffffffffffffff\""
            } else if request.contains("eth_getTransactionCount") {
                "\"0x0\""
            } else if request.contains("eth_sendRawTransaction") {
                "\"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\""
            } else {
                "null"
            };
            let body = format!(r#"{{"jsonrpc":"2.0","id":1,"result":{result}}}"#);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write rpc response");
        }
    });
    (format!("http://{address}"), requests)
}

fn start_history_write_failure_rpc_server(history_path: PathBuf) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind rpc server");
    let address = listener.local_addr().expect("local addr");
    thread::spawn(move || {
        for stream in listener.incoming().take(4) {
            let mut stream = stream.expect("accept rpc request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set read timeout");
            let mut buffer = [0; 4096];
            let bytes = stream.read(&mut buffer).expect("read rpc request");
            let mut request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
            while !request.contains("eth_") {
                match stream.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(bytes) => request.push_str(&String::from_utf8_lossy(&buffer[..bytes])),
                    Err(_) => break,
                }
            }
            let result = if request.contains("eth_chainId") {
                "\"0x1\""
            } else if request.contains("eth_getBalance") {
                "\"0xffffffffffffffffffff\""
            } else if request.contains("eth_getTransactionCount") {
                "\"0x0\""
            } else if request.contains("eth_sendRawTransaction") {
                fs::create_dir_all(&history_path).expect("turn history path into directory");
                "\"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\""
            } else {
                "null"
            };
            let body = format!(r#"{{"jsonrpc":"2.0","id":1,"result":{result}}}"#);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write rpc response");
        }
    });
    format!("http://{address}")
}

fn start_recovery_rpc_server(
    receipt_result: &'static str,
    transaction_result: &'static str,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind rpc server");
    let address = listener.local_addr().expect("local addr");
    thread::spawn(move || {
        for stream in listener.incoming().take(3) {
            let mut stream = stream.expect("accept rpc request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set read timeout");
            let mut buffer = [0; 4096];
            let bytes = stream.read(&mut buffer).expect("read rpc request");
            let mut request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
            while !request.contains("eth_") {
                match stream.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(bytes) => request.push_str(&String::from_utf8_lossy(&buffer[..bytes])),
                    Err(_) => break,
                }
            }
            let result = if request.contains("eth_chainId") {
                "\"0x1\""
            } else if request.contains("eth_getTransactionReceipt") {
                receipt_result
            } else if request.contains("eth_getTransactionByHash") {
                transaction_result
            } else {
                "null"
            };
            let body = format!(r#"{{"jsonrpc":"2.0","id":1,"result":{result}}}"#);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write rpc response");
        }
    });
    format!("http://{address}")
}

fn start_recovery_rpc_server_writing_history_on_receipt(
    receipt_result: String,
    history_path: PathBuf,
    history_contents: String,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind rpc server");
    let address = listener.local_addr().expect("local addr");
    thread::spawn(move || {
        for stream in listener.incoming().take(2) {
            let mut stream = stream.expect("accept rpc request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set read timeout");
            let mut buffer = [0; 4096];
            let bytes = stream.read(&mut buffer).expect("read rpc request");
            let mut request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
            while !request.contains("eth_") {
                match stream.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(bytes) => request.push_str(&String::from_utf8_lossy(&buffer[..bytes])),
                    Err(_) => break,
                }
            }
            let result = if request.contains("eth_chainId") {
                "\"0x1\"".to_string()
            } else if request.contains("eth_getTransactionReceipt") {
                fs::write(&history_path, &history_contents).expect("write concurrent history");
                receipt_result.clone()
            } else {
                "null".to_string()
            };
            let body = format!(r#"{{"jsonrpc":"2.0","id":1,"result":{result}}}"#);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write rpc response");
        }
    });
    format!("http://{address}")
}

fn confirmed_recovery_receipt_json() -> String {
    let bloom = format!("0x{}", "0".repeat(512));
    format!(
        r#"{{
          "transactionHash":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "transactionIndex":"0x0",
          "blockHash":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "blockNumber":"0x1",
          "from":"0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
          "to":"0x2222222222222222222222222222222222222222",
          "cumulativeGasUsed":"0x5208",
          "gasUsed":"0x5208",
          "contractAddress":null,
          "logs":[],
          "logsBloom":"{bloom}",
          "status":"0x1",
          "effectiveGasPrice":"0x1",
          "type":"0x2"
        }}"#
    )
}

fn receipt_json(tx_hash: &str, status: u64) -> String {
    let bloom = format!("0x{}", "0".repeat(512));
    format!(
        r#"{{
          "transactionHash":"{tx_hash}",
          "transactionIndex":"0x0",
          "blockHash":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "blockNumber":"0x1",
          "from":"0x1111111111111111111111111111111111111111",
          "to":"0x2222222222222222222222222222222222222222",
          "cumulativeGasUsed":"0x5208",
          "gasUsed":"0x5208",
          "contractAddress":null,
          "logs":[],
          "logsBloom":"{bloom}",
          "status":"0x{status:x}",
          "effectiveGasPrice":"0x1",
          "type":"0x2"
        }}"#
    )
}

fn receipt_json_without_status(tx_hash: &str) -> String {
    let bloom = format!("0x{}", "0".repeat(512));
    format!(
        r#"{{
          "transactionHash":"{tx_hash}",
          "transactionIndex":"0x0",
          "blockHash":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "blockNumber":"0x1",
          "from":"0x1111111111111111111111111111111111111111",
          "to":"0x2222222222222222222222222222222222222222",
          "cumulativeGasUsed":"0x5208",
          "gasUsed":"0x5208",
          "contractAddress":null,
          "logs":[],
          "logsBloom":"{bloom}",
          "effectiveGasPrice":"0x1",
          "type":"0x2"
        }}"#
    )
}

fn full_hash(ch: char) -> String {
    format!("0x{}", ch.to_string().repeat(64))
}

fn start_dropped_review_rpc_server(
    chain_id_result: &'static str,
    receipt_result: String,
    transaction_result: &'static str,
    nonce_result: &'static str,
    request_count: usize,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind rpc server");
    let address = listener.local_addr().expect("local addr");
    thread::spawn(move || {
        for stream in listener.incoming().take(request_count) {
            let mut stream = stream.expect("accept rpc request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set read timeout");
            let mut buffer = [0; 4096];
            let bytes = stream.read(&mut buffer).expect("read rpc request");
            let mut request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
            while !request.contains("eth_") {
                match stream.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(bytes) => request.push_str(&String::from_utf8_lossy(&buffer[..bytes])),
                    Err(_) => break,
                }
            }
            let result = if request.contains("eth_chainId") {
                chain_id_result.to_string()
            } else if request.contains("eth_getTransactionReceipt") {
                receipt_result.clone()
            } else if request.contains("eth_getTransactionByHash") {
                transaction_result.to_string()
            } else if request.contains("eth_getTransactionCount") {
                nonce_result.to_string()
            } else {
                "null".to_string()
            };
            let body = format!(r#"{{"jsonrpc":"2.0","id":1,"result":{result}}}"#);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write rpc response");
        }
    });
    format!("http://{address}")
}

fn start_dropped_review_rpc_server_writing_history_on_transaction_lookup(
    history_path: PathBuf,
    history_contents: String,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind rpc server");
    let address = listener.local_addr().expect("local addr");
    thread::spawn(move || {
        for stream in listener.incoming().take(4) {
            let mut stream = stream.expect("accept rpc request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set read timeout");
            let mut buffer = [0; 4096];
            let bytes = stream.read(&mut buffer).expect("read rpc request");
            let mut request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
            while !request.contains("eth_") {
                match stream.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(bytes) => request.push_str(&String::from_utf8_lossy(&buffer[..bytes])),
                    Err(_) => break,
                }
            }
            let result = if request.contains("eth_chainId") {
                "\"0x1\"".to_string()
            } else if request.contains("eth_getTransactionReceipt") {
                "null".to_string()
            } else if request.contains("eth_getTransactionByHash") {
                fs::write(&history_path, &history_contents).expect("write concurrent history");
                "null".to_string()
            } else if request.contains("eth_getTransactionCount") {
                "\"0x5\"".to_string()
            } else {
                "null".to_string()
            };
            let body = format!(r#"{{"jsonrpc":"2.0","id":1,"result":{result}}}"#);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write rpc response");
        }
    });
    format!("http://{address}")
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
        assert_eq!(record.schema_version, 2);
        assert_eq!(record.intent_snapshot.source, "nativeTransferIntent");
        assert_eq!(
            record.submission.kind,
            wallet_workbench_lib::models::SubmissionKind::NativeTransfer
        );
        assert_eq!(record.submission.chain_id, Some(1));
        assert_eq!(record.submission.nonce, Some(3));
        assert!(record.submission.broadcasted_at.is_some());
        assert_eq!(
            record.nonce_thread.key,
            "1:1:0x1111111111111111111111111111111111111111:3"
        );
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
fn missing_history_file_is_empty_not_corrupt() {
    with_test_app_dir("history-not-found", |_| {
        let records = load_history_records().expect("missing history is empty");
        let inspection = inspect_history_storage().expect("inspect missing history");

        assert!(records.is_empty());
        assert_eq!(inspection.status, HistoryStorageStatus::NotFound);
        assert_eq!(inspection.corruption_type, None);
    });
}

#[test]
fn bad_json_history_is_classified_without_deleting_source() {
    with_test_app_dir("history-bad-json", |_| {
        let path = history_path().expect("history path");
        fs::write(&path, "{ not json").expect("write bad history");

        let error = load_history_records().expect_err("bad JSON must fail");
        let inspection = inspect_history_storage().expect("inspect bad JSON");

        assert!(error.contains("jsonParseFailed"));
        assert_eq!(inspection.status, HistoryStorageStatus::Corrupted);
        assert_eq!(
            inspection.corruption_type,
            Some(HistoryCorruptionType::JsonParseFailed)
        );
        assert!(path.exists(), "inspect must not remove original history");
    });
}

#[test]
fn incompatible_and_partial_history_schema_are_classified() {
    with_test_app_dir("history-schema-health", |_| {
        let path = history_path().expect("history path");
        fs::write(&path, r#"{"records":[]}"#).expect("write incompatible history");
        let incompatible = inspect_history_storage().expect("inspect incompatible history");
        assert_eq!(incompatible.status, HistoryStorageStatus::Corrupted);
        assert_eq!(
            incompatible.corruption_type,
            Some(HistoryCorruptionType::SchemaIncompatible)
        );

        let valid = history_record(1, ChainOutcomeState::Pending, "0xvalid");
        fs::write(
            &path,
            serde_json::to_string_pretty(&serde_json::json!([valid, { "intent": null }]))
                .expect("serialize partial history"),
        )
        .expect("write partial history");
        let partial = inspect_history_storage().expect("inspect partial history");
        assert_eq!(partial.status, HistoryStorageStatus::Corrupted);
        assert_eq!(
            partial.corruption_type,
            Some(HistoryCorruptionType::PartialRecordsInvalid)
        );
        assert_eq!(partial.record_count, 1);
        assert_eq!(partial.invalid_record_count, 1);
        assert_eq!(partial.invalid_record_indices, vec![1]);
    });
}

#[test]
fn partial_history_reports_full_invalid_count_with_preview_indices() {
    with_test_app_dir("history-partial-invalid-count", |_| {
        let path = history_path().expect("history path");
        let valid = history_record(1, ChainOutcomeState::Pending, "0xvalid");
        let mut raw_records = vec![serde_json::to_value(valid).expect("serialize valid record")];
        for index in 0..10 {
            raw_records.push(serde_json::json!({ "invalid_record": index }));
        }
        fs::write(
            &path,
            serde_json::to_string_pretty(&raw_records).expect("serialize invalid history"),
        )
        .expect("write partial history");

        let inspection = inspect_history_storage().expect("inspect partial history");
        let events =
            read_diagnostic_events_from_path(&diagnostics_path().expect("diagnostics path"))
                .expect("read diagnostics");
        let event = events
            .iter()
            .find(|event| event.event == "historyStorageCorruptionDetected")
            .expect("corruption diagnostic");

        assert_eq!(inspection.status, HistoryStorageStatus::Corrupted);
        assert_eq!(
            inspection.corruption_type,
            Some(HistoryCorruptionType::PartialRecordsInvalid)
        );
        assert_eq!(inspection.record_count, 1);
        assert_eq!(inspection.invalid_record_count, 10);
        assert_eq!(
            inspection.invalid_record_indices,
            vec![1, 2, 3, 4, 5, 6, 7, 8]
        );
        assert!(inspection
            .error_summary
            .as_deref()
            .expect("error summary")
            .contains("10 transaction history record(s)"));
        assert_eq!(
            event
                .metadata
                .get("invalidRecordCount")
                .and_then(|value| value.as_u64()),
            Some(10)
        );
    });
}

#[test]
fn quarantine_preserves_damaged_history_and_starts_empty_history() {
    with_test_app_dir("history-quarantine", |_| {
        let path = history_path().expect("history path");
        fs::write(&path, "{ broken").expect("write damaged history");

        let result = quarantine_history_storage().expect("quarantine damaged history");
        let quarantined_path = PathBuf::from(&result.quarantined_path);
        let records = load_history_records().expect("load empty history after quarantine");
        let raw_current = fs::read_to_string(&path).expect("read new history");
        let raw_quarantined = fs::read_to_string(&quarantined_path).expect("read quarantine");

        assert_eq!(result.previous.status, HistoryStorageStatus::Corrupted);
        assert_eq!(result.current.status, HistoryStorageStatus::Healthy);
        assert!(records.is_empty());
        assert_eq!(raw_current.trim(), "[]");
        assert_eq!(raw_quarantined, "{ broken");
        assert!(quarantined_path
            .file_name()
            .and_then(|value| value.to_str())
            .expect("quarantine file name")
            .contains(".quarantine-"));
    });
}

#[cfg(unix)]
#[test]
fn quarantine_prepare_failure_keeps_damaged_history_blocking() {
    let _guard = test_lock().lock().expect("test lock");
    let app_dir_guard = TestAppDirGuard::new("history-quarantine-prepare-failure");
    let path = history_path().expect("history path");
    fs::write(&path, "{ broken").expect("write damaged history");
    let dir = path.parent().expect("history parent").to_path_buf();
    let original_permissions = fs::metadata(&dir).expect("dir metadata").permissions();
    let mut readonly_permissions = original_permissions.clone();
    readonly_permissions.set_mode(0o500);
    fs::set_permissions(&dir, readonly_permissions).expect("make app dir readonly");

    let result = quarantine_history_storage();

    fs::set_permissions(&dir, original_permissions).expect("restore app dir permissions");

    let error = result.expect_err("quarantine must fail before moving damaged history");
    assert!(error.contains("original damaged history remains in place"));
    assert!(
        path.exists(),
        "damaged history must remain at original path"
    );
    let inspection = inspect_history_storage().expect("inspect history after failed quarantine");
    assert_eq!(inspection.status, HistoryStorageStatus::Corrupted);
    assert_eq!(
        inspection.corruption_type,
        Some(HistoryCorruptionType::JsonParseFailed)
    );
    let load_error = load_history_records().expect_err("history must remain blocking");
    assert!(load_error.contains("jsonParseFailed"));
    drop(app_dir_guard);
}

#[test]
fn history_recovery_actions_are_recorded_without_sensitive_paths() {
    with_test_app_dir("history-quarantine-diagnostics", |_| {
        let path = history_path().expect("history path");
        fs::write(&path, "{ broken").expect("write damaged history");

        let result = quarantine_history_storage().expect("quarantine damaged history");
        let events =
            read_diagnostic_events_from_path(&diagnostics_path().expect("diagnostics path"))
                .expect("read diagnostics");
        let event = events
            .iter()
            .find(|event| event.event == "historyStorageQuarantined")
            .expect("quarantine diagnostic");

        assert_eq!(event.category, "transaction");
        assert_eq!(
            event
                .metadata
                .get("corruptionType")
                .and_then(|value| value.as_str()),
            Some("jsonParseFailed")
        );
        assert_eq!(
            event
                .metadata
                .get("action")
                .and_then(|value| value.as_str()),
            Some("quarantineAndStartEmptyHistory")
        );
        assert!(!serde_json::to_string(event)
            .expect("serialize event")
            .contains(&result.quarantined_path));
    });
}

#[tokio::test(flavor = "current_thread")]
async fn submit_refuses_to_broadcast_when_history_is_unreadable() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("submit-history-corrupt-preflight");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    fs::write(history_path().expect("history path"), "{ broken").expect("write damaged history");
    let (rpc_url, requests) = start_submission_guard_rpc_server();

    let mut intent = native_transfer_intent(0, "1");
    intent.rpc_url = rpc_url;
    intent.account_index = 1;
    intent.chain_id = 1;
    intent.from = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".into();

    let error = wallet_workbench_lib::transactions::submit_native_transfer(intent)
        .await
        .expect_err("corrupt history must stop submission");
    let joined_requests = requests.lock().expect("requests lock").join("\n");

    assert!(
        error.contains("jsonParseFailed"),
        "unexpected error: {error}; requests={joined_requests}"
    );
    assert!(!joined_requests.contains("eth_sendRawTransaction"));
}

#[tokio::test(flavor = "current_thread")]
async fn broadcast_history_write_failure_records_recovery_intent_without_rpc_secret() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("broadcast-history-recovery-intent");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let path = history_path().expect("history path");
    let rpc_url = start_history_write_failure_rpc_server(path);
    let mut intent = native_transfer_intent(0, "1");
    intent.rpc_url = format!("{rpc_url}/?apiKey=super-secret");
    intent.account_index = 1;
    intent.chain_id = 1;
    intent.from = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".into();

    let error = wallet_workbench_lib::transactions::submit_native_transfer(intent)
        .await
        .expect_err("history write should fail after broadcast");
    let intents = load_history_recovery_intents().expect("load recovery intents");
    let raw_intents = serde_json::to_string(&intents).expect("serialize recovery intents");
    let events = read_diagnostic_events_from_path(&diagnostics_path().expect("diagnostics path"))
        .expect("read diagnostics");
    let raw_events = serde_json::to_string(&events).expect("serialize diagnostics");

    assert!(error.contains("transaction broadcast"));
    assert_eq!(intents.len(), 1);
    assert_eq!(
        intents[0].tx_hash,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    assert_eq!(intents[0].chain_id, Some(1));
    assert_eq!(intents[0].account_index, Some(1));
    assert_eq!(
        intents[0].from.as_deref(),
        Some("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")
    );
    assert_eq!(intents[0].nonce, Some(0));
    assert!(
        intents[0].write_error.contains("Is a directory")
            || intents[0].write_error.contains("directory")
    );
    assert!(!raw_intents.contains("rpc_url"));
    assert!(!raw_intents.contains("super-secret"));
    assert!(!raw_events.contains("super-secret"));
    assert!(events
        .iter()
        .any(|event| event.event == "nativeTransferHistoryWriteAfterBroadcastFailed"));
}

#[tokio::test(flavor = "current_thread")]
async fn recovery_writes_confirmed_history_and_does_not_duplicate() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("broadcast-history-recover-confirmed");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let path = history_path().expect("history path");
    let rpc_url = start_history_write_failure_rpc_server(path.clone());
    let mut intent = native_transfer_intent(0, "1");
    intent.rpc_url = rpc_url;
    intent.account_index = 1;
    intent.chain_id = 1;
    intent.from = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".into();
    let _ = wallet_workbench_lib::transactions::submit_native_transfer(intent)
        .await
        .expect_err("history write should fail after broadcast");
    fs::remove_dir_all(&path).expect("remove blocking history directory");
    fs::write(&path, "[]").expect("reset healthy history");
    let recovery_id = load_history_recovery_intents()
        .expect("load recovery intents")
        .first()
        .expect("recovery intent")
        .id
        .clone();
    let receipt = confirmed_recovery_receipt_json();
    let rpc_url = format!(
        "{}/v1?apiKey=recovery-secret-token",
        start_recovery_rpc_server(Box::leak(receipt.into_boxed_str()), "null")
    );

    let result = recover_broadcasted_history_record(recovery_id.clone(), rpc_url, 1)
        .await
        .expect("recover history");
    let duplicate = recover_broadcasted_history_record(recovery_id, "http://127.0.0.1:1".into(), 1)
        .await
        .expect("duplicate recovery should not need rpc");
    let records = load_history_records().expect("load recovered history");

    assert_eq!(result.record.outcome.state, ChainOutcomeState::Confirmed);
    assert_eq!(
        result
            .record
            .outcome
            .receipt
            .as_ref()
            .and_then(|receipt| receipt.status),
        Some(1)
    );
    assert_eq!(
        result.record.intent_snapshot.source,
        "historyRecoveryIntent"
    );
    assert_eq!(
        result.record.intent.rpc_url,
        "recovered://history-write-failed"
    );
    assert!(!serde_json::to_string(&result.record)
        .expect("serialize recovered record")
        .contains("recovery-secret-token"));
    assert!(!serde_json::to_string(&result.record)
        .expect("serialize recovered record")
        .contains("127.0.0.1"));
    assert_eq!(duplicate.history.len(), 1);
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0].outcome.tx_hash,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn recovery_final_write_reloads_history_inside_lock_to_preserve_concurrent_records() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("broadcast-history-recover-concurrent-reload");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let path = history_path().expect("history path");
    let rpc_url = start_history_write_failure_rpc_server(path.clone());
    let mut intent = native_transfer_intent(0, "1");
    intent.rpc_url = rpc_url;
    intent.account_index = 1;
    intent.chain_id = 1;
    intent.from = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".into();
    let _ = wallet_workbench_lib::transactions::submit_native_transfer(intent)
        .await
        .expect_err("history write should fail after broadcast");
    fs::remove_dir_all(&path).expect("remove blocking history directory");
    fs::write(&path, "[]").expect("reset healthy history");
    let recovery_id = load_history_recovery_intents()
        .expect("load recovery intents")
        .first()
        .expect("recovery intent")
        .id
        .clone();
    let concurrent_record = history_record(77, ChainOutcomeState::Pending, "0xconcurrent");
    let concurrent_history = serde_json::to_string_pretty(&vec![concurrent_record])
        .expect("serialize concurrent history");
    let rpc_url = start_recovery_rpc_server_writing_history_on_receipt(
        confirmed_recovery_receipt_json(),
        path.clone(),
        concurrent_history,
    );

    let result = recover_broadcasted_history_record(recovery_id, rpc_url, 1)
        .await
        .expect("recover history");
    let records = load_history_records().expect("load history");

    assert_eq!(result.history.len(), 2);
    assert_eq!(records.len(), 2);
    assert!(records
        .iter()
        .any(|record| record.outcome.tx_hash == "0xconcurrent"));
    assert!(records.iter().any(|record| {
        record.outcome.tx_hash
            == "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }));
}

#[tokio::test(flavor = "current_thread")]
async fn recovery_does_not_write_when_chain_has_no_transaction() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("broadcast-history-recover-not-found");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let path = history_path().expect("history path");
    let rpc_url = start_history_write_failure_rpc_server(path.clone());
    let mut intent = native_transfer_intent(0, "1");
    intent.rpc_url = rpc_url;
    intent.account_index = 1;
    intent.chain_id = 1;
    intent.from = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".into();
    let _ = wallet_workbench_lib::transactions::submit_native_transfer(intent)
        .await
        .expect_err("history write should fail after broadcast");
    fs::remove_dir_all(&path).expect("remove blocking history directory");
    fs::write(&path, "[]").expect("reset healthy history");
    let recovery_id = load_history_recovery_intents()
        .expect("load recovery intents")
        .first()
        .expect("recovery intent")
        .id
        .clone();
    let rpc_url = start_recovery_rpc_server("null", "null");

    let error = recover_broadcasted_history_record(recovery_id, rpc_url, 1)
        .await
        .expect_err("missing transaction should not write terminal history");
    let records = load_history_records().expect("load history");

    assert!(error.contains("not found"));
    assert!(records.is_empty());
}

#[tokio::test(flavor = "current_thread")]
async fn recovery_rejects_intents_missing_minimum_frozen_fields() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("broadcast-history-recover-missing-fields");
    let path = wallet_workbench_lib::storage::history_recovery_intents_path()
        .expect("recovery intents path");
    fs::write(
        path,
        serde_json::to_string_pretty(&serde_json::json!([
            {
                "schemaVersion": 1,
                "id": "missing-nonce",
                "status": "active",
                "createdAt": "1700000000",
                "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "kind": "nativeTransfer",
                "chainId": 1,
                "accountIndex": 1,
                "from": "0x1111111111111111111111111111111111111111",
                "nonce": null,
                "to": "0x2222222222222222222222222222222222222222",
                "valueWei": "1",
                "gasLimit": "21000",
                "maxFeePerGas": "1",
                "maxPriorityFeePerGas": "1",
                "replacesTxHash": null,
                "broadcastedAt": "1700000000",
                "writeError": "disk full",
                "lastRecoveryError": null,
                "recoveredAt": null,
                "dismissedAt": null
            }
        ]))
        .expect("serialize recovery intent"),
    )
    .expect("write recovery intent");
    let error =
        recover_broadcasted_history_record("missing-nonce".into(), "http://127.0.0.1:1".into(), 1)
            .await
            .expect_err("missing nonce must be rejected before rpc");

    assert!(error.contains("missing nonce"));
}

#[test]
fn recovery_intents_load_with_sanitized_errors() {
    with_test_app_dir("broadcast-history-recovery-error-sanitize", |_| {
        let path = wallet_workbench_lib::storage::history_recovery_intents_path()
            .expect("recovery intents path");
        fs::write(
            path,
            serde_json::to_string_pretty(&serde_json::json!([
                {
                    "schemaVersion": 1,
                    "id": "sensitive-error",
                    "status": "active",
                    "createdAt": "1700000000",
                    "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "kind": "nativeTransfer",
                    "chainId": 1,
                    "accountIndex": 1,
                    "from": "0x1111111111111111111111111111111111111111",
                    "nonce": 1,
                    "to": "0x2222222222222222222222222222222222222222",
                    "valueWei": "1",
                    "gasLimit": "21000",
                    "maxFeePerGas": "1",
                    "maxPriorityFeePerGas": "1",
                    "replacesTxHash": null,
                    "broadcastedAt": "1700000000",
                    "writeError": "failed at https://rpc.example/v1?apiKey=write-secret rawTx=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa token token-secret password hunter2",
                    "lastRecoveryError": "Authorization Bearer bearer-secret mnemonic test test test test next=value privateKey=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb signature sig-secret private key my-secret raw tx raw-secret",
                    "recoveredAt": null,
                    "dismissedAt": null
                }
            ]))
            .expect("serialize recovery intent"),
        )
        .expect("write recovery intent");

        let intents = load_history_recovery_intents().expect("load recovery intents");
        let raw = serde_json::to_string(&intents).expect("serialize recovery intents");

        assert_eq!(intents.len(), 1);
        assert!(raw.contains("[redacted"));
        assert!(!raw.contains("rpc.example"));
        assert!(!raw.contains("write-secret"));
        assert!(!raw.contains("token-secret"));
        assert!(!raw.contains("hunter2"));
        assert!(!raw.contains("bearer-secret"));
        assert!(!raw.contains("sig-secret"));
        assert!(!raw.contains("my-secret"));
        assert!(!raw.contains("raw-secret"));
        assert!(!raw.contains("test test test"));
        assert!(!raw.contains("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
    });
}

#[test]
fn pending_history_write_records_a_diagnostic_event() {
    with_test_app_dir("pending-history-diagnostics", |_| {
        persist_pending_history(native_transfer_intent(4, "1"), "0xabc".into()).expect("persist");

        let events =
            read_diagnostic_events_from_path(&diagnostics_path().expect("diagnostics path"))
                .expect("read diagnostics");

        let event = events
            .iter()
            .find(|event| event.event == "pendingHistoryWriteSucceeded")
            .expect("pending history diagnostic");
        assert_eq!(event.category, "transaction");
        assert_eq!(event.chain_id, Some(1));
        assert_eq!(event.account_index, Some(1));
        assert_eq!(event.tx_hash.as_deref(), Some("0xabc"));
    });
}

#[tokio::test(flavor = "current_thread")]
async fn preflight_parse_failure_records_a_diagnostic_event() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("preflight-parse-diagnostics");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );

    let mut intent = native_transfer_intent(0, "not-a-number");
    intent.rpc_url = start_preflight_rpc_server();
    intent.chain_id = 1;
    intent.from = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".into();

    let result = wallet_workbench_lib::transactions::submit_native_transfer(intent).await;
    let events = read_diagnostic_events_from_path(&diagnostics_path().expect("diagnostics path"))
        .expect("read diagnostics");

    assert!(result.is_err(), "submit should fail");
    let event = events
        .iter()
        .find(|event| event.event == "nativeTransferPreflightNumericFieldInvalid")
        .unwrap_or_else(|| {
            panic!("preflight parse diagnostic; result={result:?}; events={events:?}")
        });
    assert_eq!(event.chain_id, Some(1));
    assert_eq!(event.account_index, Some(1));
    assert_eq!(
        event.metadata.get("field").and_then(|value| value.as_str()),
        Some("value_wei")
    );
}

#[test]
fn legacy_v1_history_records_deserialize_with_display_defaults() {
    with_test_app_dir("legacy-history-schema", |_| {
        let legacy = r#"[
          {
            "intent": {
              "rpc_url": "http://127.0.0.1:8545",
              "account_index": 1,
              "chain_id": 1,
              "from": "0x1111111111111111111111111111111111111111",
              "to": "0x2222222222222222222222222222222222222222",
              "value_wei": "100",
              "nonce": 7,
              "gas_limit": "21000",
              "max_fee_per_gas": "40000000000",
              "max_priority_fee_per_gas": "1500000000"
            },
            "submission": {
              "frozen_key": "legacy-key",
              "tx_hash": "0xlegacy"
            },
            "outcome": {
              "state": "Pending",
              "tx_hash": "0xlegacy"
            }
          }
        ]"#;
        fs::write(history_path().expect("history path"), legacy).expect("write legacy history");

        let records = load_history_records().expect("load legacy history");

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].schema_version, 1);
        assert_eq!(records[0].intent_snapshot.source, "legacy");
        assert_eq!(
            records[0].submission.kind,
            wallet_workbench_lib::models::SubmissionKind::Legacy
        );
        assert_eq!(records[0].submission.broadcasted_at, None);
        assert!(records[0].outcome.receipt.is_none());
        assert_eq!(records[0].outcome.finalized_at, None);
        assert_eq!(records[0].nonce_thread.source, "legacy");
        assert_eq!(records[0].nonce_thread.key, "unknown");
    });
}

#[test]
fn mixed_legacy_and_p3_history_records_read_without_migration() {
    with_test_app_dir("mixed-history-schema", |_| {
        let p3_record = persist_pending_history(native_transfer_intent(8, "200"), "0xp3".into())
            .expect("persist p3 record");
        let legacy = serde_json::json!({
            "intent": native_transfer_intent(7, "100"),
            "submission": {
                "frozen_key": "legacy-key",
                "tx_hash": "0xlegacy"
            },
            "outcome": {
                "state": "Pending",
                "tx_hash": "0xlegacy"
            }
        });
        let raw = serde_json::to_string_pretty(&serde_json::json!([legacy, p3_record]))
            .expect("serialize mixed history");
        fs::write(history_path().expect("history path"), raw).expect("write mixed history");

        let records = load_history_records().expect("load mixed history");

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].schema_version, 1);
        assert_eq!(records[0].submission.broadcasted_at, None);
        assert_eq!(records[1].schema_version, 2);
        assert!(records[1].submission.broadcasted_at.is_some());
        assert_eq!(
            next_nonce_with_pending_history(
                &records,
                1,
                1,
                "0x1111111111111111111111111111111111111111",
                7,
            ),
            9
        );
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

#[test]
fn mark_prior_history_state_requires_an_existing_pending_record() {
    with_test_app_dir("mark-prior-validation", |_| {
        persist_pending_history(native_transfer_intent(5, "1"), "0xabc".into())
            .expect("persist pending");

        assert!(mark_prior_history_state("0xmissing", ChainOutcomeState::Replaced).is_err());
        mark_prior_history_state("0xabc", ChainOutcomeState::Replaced).expect("mark replaced");
        assert!(mark_prior_history_state("0xabc", ChainOutcomeState::Cancelled).is_err());
    });
}

#[test]
fn local_replace_and_cancel_marking_preserves_nonce_thread_without_finalizing() {
    with_test_app_dir("local-replacement-contract", |_| {
        persist_pending_history(native_transfer_intent(10, "100"), "0xoriginal".into())
            .expect("persist original");
        persist_pending_history_with_kind(
            native_transfer_intent(10, "200"),
            "0xreplacement".into(),
            wallet_workbench_lib::models::SubmissionKind::Replacement,
            Some("0xoriginal".into()),
        )
        .expect("persist replacement");
        mark_prior_history_state_with_replacement(
            "0xoriginal",
            ChainOutcomeState::Replaced,
            Some("0xreplacement".into()),
        )
        .expect("mark original replaced");

        persist_pending_history(native_transfer_intent(11, "300"), "0xcancelled".into())
            .expect("persist cancellable");
        let mut cancel_intent = native_transfer_intent(11, "0");
        cancel_intent.to = cancel_intent.from.clone();
        persist_pending_history_with_kind(
            cancel_intent,
            "0xcancel".into(),
            wallet_workbench_lib::models::SubmissionKind::Cancellation,
            Some("0xcancelled".into()),
        )
        .expect("persist cancellation");
        mark_prior_history_state_with_replacement(
            "0xcancelled",
            ChainOutcomeState::Cancelled,
            Some("0xcancel".into()),
        )
        .expect("mark original cancelled");

        let records = load_history_records().expect("load history");
        let original = records
            .iter()
            .find(|record| record.submission.tx_hash == "0xoriginal")
            .expect("original record");
        let replacement = records
            .iter()
            .find(|record| record.submission.tx_hash == "0xreplacement")
            .expect("replacement record");
        let cancelled = records
            .iter()
            .find(|record| record.submission.tx_hash == "0xcancelled")
            .expect("cancelled record");
        let cancel = records
            .iter()
            .find(|record| record.submission.tx_hash == "0xcancel")
            .expect("cancel record");

        assert_eq!(original.outcome.state, ChainOutcomeState::Replaced);
        assert_eq!(original.outcome.finalized_at, None);
        assert_eq!(original.outcome.reconciled_at, None);
        assert_eq!(
            original
                .outcome
                .reconcile_summary
                .as_ref()
                .map(|summary| summary.source.as_str()),
            Some("localHistoryMutation")
        );
        assert_eq!(
            original
                .outcome
                .reconcile_summary
                .as_ref()
                .map(|summary| summary.decision.as_str()),
            Some("markedReplacedByLocalSubmission")
        );
        assert_eq!(
            original.nonce_thread.replaced_by_tx_hash.as_deref(),
            Some("0xreplacement")
        );
        assert_eq!(
            replacement.submission.kind,
            wallet_workbench_lib::models::SubmissionKind::Replacement
        );
        assert_eq!(
            replacement.submission.replaces_tx_hash.as_deref(),
            Some("0xoriginal")
        );
        assert_eq!(
            replacement.nonce_thread.replaces_tx_hash.as_deref(),
            Some("0xoriginal")
        );

        assert_eq!(cancelled.outcome.state, ChainOutcomeState::Cancelled);
        assert_eq!(cancelled.outcome.finalized_at, None);
        assert_eq!(cancelled.outcome.reconciled_at, None);
        assert_eq!(
            cancelled
                .outcome
                .reconcile_summary
                .as_ref()
                .map(|summary| summary.decision.as_str()),
            Some("markedCancelledByLocalSubmission")
        );
        assert_eq!(
            cancelled.nonce_thread.replaced_by_tx_hash.as_deref(),
            Some("0xcancel")
        );
        assert_eq!(
            cancel.submission.kind,
            wallet_workbench_lib::models::SubmissionKind::Cancellation
        );
        assert_eq!(
            cancel.submission.replaces_tx_hash.as_deref(),
            Some("0xcancelled")
        );
        assert_eq!(
            cancel.submission.to.as_deref(),
            Some(cancel.intent.from.as_str())
        );
        assert_eq!(cancel.submission.value_wei.as_deref(), Some("0"));
    });
}

#[test]
fn pending_mutation_request_must_match_local_pending_history() {
    with_test_app_dir("pending-mutation-validation", |_| {
        persist_pending_history(native_transfer_intent(9, "100"), "0xabc".into())
            .expect("persist pending");

        let request = wallet_workbench_lib::commands::transactions::PendingMutationRequest {
            tx_hash: "0xabc".into(),
            rpc_url: "http://127.0.0.1:8545".into(),
            account_index: 1,
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111".into(),
            nonce: 9,
            gas_limit: "21000".into(),
            max_fee_per_gas: "50000000000".into(),
            max_priority_fee_per_gas: "2000000000".into(),
            to: Some("0x3333333333333333333333333333333333333333".into()),
            value_wei: Some("200".into()),
        };

        let replace_intent =
            wallet_workbench_lib::commands::transactions::build_replace_intent_from_pending_request(
                request.clone(),
            )
            .expect("replace intent");
        assert_eq!(replace_intent.account_index, 1);
        assert_eq!(replace_intent.chain_id, 1);
        assert_eq!(
            replace_intent.from,
            "0x1111111111111111111111111111111111111111"
        );
        assert_eq!(replace_intent.nonce, 9);
        assert_eq!(
            replace_intent.to,
            "0x3333333333333333333333333333333333333333"
        );
        assert_eq!(replace_intent.value_wei, "200");

        let cancel_intent =
            wallet_workbench_lib::commands::transactions::build_cancel_intent_from_pending_request(
                request.clone(),
            )
            .expect("cancel intent");
        assert_eq!(cancel_intent.to, cancel_intent.from);
        assert_eq!(cancel_intent.value_wei, "0");
        assert_eq!(cancel_intent.nonce, 9);

        let mut mismatched = request.clone();
        mismatched.nonce = 10;
        assert!(
            wallet_workbench_lib::commands::transactions::build_replace_intent_from_pending_request(
                mismatched,
            )
            .is_err()
        );

        assert!(
            wallet_workbench_lib::commands::transactions::build_cancel_intent_from_pending_request(
                request,
            )
            .is_ok()
        );
        mark_prior_history_state("0xabc", ChainOutcomeState::Replaced).expect("mark replaced");
        let after_replaced = wallet_workbench_lib::commands::transactions::PendingMutationRequest {
            tx_hash: "0xabc".into(),
            rpc_url: "http://127.0.0.1:8545".into(),
            account_index: 1,
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111".into(),
            nonce: 9,
            gas_limit: "21000".into(),
            max_fee_per_gas: "50000000000".into(),
            max_priority_fee_per_gas: "2000000000".into(),
            to: Some("0x3333333333333333333333333333333333333333".into()),
            value_wei: Some("200".into()),
        };
        assert!(
            wallet_workbench_lib::commands::transactions::build_replace_intent_from_pending_request(
                after_replaced,
            )
            .is_err()
        );
    });
}

#[test]
fn replace_and_cancel_requests_refuse_unreadable_history() {
    with_test_app_dir("pending-mutation-corrupt-history", |_| {
        fs::write(history_path().expect("history path"), "{ broken")
            .expect("write damaged history");
        let request = wallet_workbench_lib::commands::transactions::PendingMutationRequest {
            tx_hash: "0xabc".into(),
            rpc_url: "http://127.0.0.1:8545".into(),
            account_index: 1,
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111".into(),
            nonce: 9,
            gas_limit: "21000".into(),
            max_fee_per_gas: "50000000000".into(),
            max_priority_fee_per_gas: "2000000000".into(),
            to: Some("0x3333333333333333333333333333333333333333".into()),
            value_wei: Some("200".into()),
        };

        let replace_error =
            wallet_workbench_lib::commands::transactions::build_replace_intent_from_pending_request(
                request.clone(),
            )
            .expect_err("replace must refuse unreadable history");
        let cancel_error =
            wallet_workbench_lib::commands::transactions::build_cancel_intent_from_pending_request(
                request,
            )
            .expect_err("cancel must refuse unreadable history");

        assert!(replace_error.contains("jsonParseFailed"));
        assert!(cancel_error.contains("jsonParseFailed"));
    });
}

#[test]
fn pending_mutation_request_uses_frozen_submission_when_intent_is_stale() {
    with_test_app_dir("pending-mutation-frozen-submission", |_| {
        persist_pending_history(native_transfer_intent(9, "100"), "0xabc".into())
            .expect("persist pending");
        let mut records = load_history_records().expect("load history");
        let record = records.first_mut().expect("pending record");
        record.intent.chain_id = 1;
        record.intent.account_index = 1;
        record.intent.from = "0x1111111111111111111111111111111111111111".into();
        record.intent.nonce = 9;
        record.intent.gas_limit = "21000".into();
        record.intent.max_fee_per_gas = "40000000000".into();
        record.intent.max_priority_fee_per_gas = "1500000000".into();
        record.submission.chain_id = Some(5);
        record.submission.account_index = Some(2);
        record.submission.from = Some("0x2222222222222222222222222222222222222222".into());
        record.submission.nonce = Some(12);
        record.submission.gas_limit = Some("22000".into());
        record.submission.max_fee_per_gas = Some("50000000000".into());
        record.submission.max_priority_fee_per_gas = Some("2000000000".into());
        fs::write(
            history_path().expect("history path"),
            serde_json::to_string_pretty(&records).expect("serialize history"),
        )
        .expect("write history");

        let request = wallet_workbench_lib::commands::transactions::PendingMutationRequest {
            tx_hash: "0xabc".into(),
            rpc_url: "http://127.0.0.1:8545".into(),
            account_index: 2,
            chain_id: 5,
            from: "0x2222222222222222222222222222222222222222".into(),
            nonce: 12,
            gas_limit: "22000".into(),
            max_fee_per_gas: "62500000000".into(),
            max_priority_fee_per_gas: "2500000000".into(),
            to: Some("0x3333333333333333333333333333333333333333".into()),
            value_wei: Some("200".into()),
        };

        let replace_intent =
            wallet_workbench_lib::commands::transactions::build_replace_intent_from_pending_request(
                request.clone(),
            )
            .expect("replace intent from frozen submission");
        assert_eq!(replace_intent.chain_id, 5);
        assert_eq!(replace_intent.account_index, 2);
        assert_eq!(
            replace_intent.from,
            "0x2222222222222222222222222222222222222222"
        );
        assert_eq!(replace_intent.nonce, 12);
        assert_eq!(replace_intent.gas_limit, "22000");
        assert_eq!(replace_intent.max_fee_per_gas, "62500000000");
        assert_eq!(replace_intent.max_priority_fee_per_gas, "2500000000");

        let cancel_intent =
            wallet_workbench_lib::commands::transactions::build_cancel_intent_from_pending_request(
                request,
            )
            .expect("cancel intent from frozen submission");
        assert_eq!(cancel_intent.chain_id, 5);
        assert_eq!(cancel_intent.account_index, 2);
        assert_eq!(
            cancel_intent.from,
            "0x2222222222222222222222222222222222222222"
        );
        assert_eq!(cancel_intent.to, cancel_intent.from);
        assert_eq!(cancel_intent.value_wei, "0");
        assert_eq!(cancel_intent.nonce, 12);

        let stale_intent_request =
            wallet_workbench_lib::commands::transactions::PendingMutationRequest {
                tx_hash: "0xabc".into(),
                rpc_url: "http://127.0.0.1:8545".into(),
                account_index: 1,
                chain_id: 1,
                from: "0x1111111111111111111111111111111111111111".into(),
                nonce: 9,
                gas_limit: "21000".into(),
                max_fee_per_gas: "62500000000".into(),
                max_priority_fee_per_gas: "2500000000".into(),
                to: Some("0x3333333333333333333333333333333333333333".into()),
                value_wei: Some("200".into()),
            };
        let error =
            wallet_workbench_lib::commands::transactions::build_replace_intent_from_pending_request(
                stale_intent_request,
            )
            .expect_err("stale intent request must not validate");
        assert!(error.contains("frozen submission"));
    });
}

#[test]
fn pending_mutation_guard_rejects_same_nonce_key_until_released() {
    let first = history_record(7, ChainOutcomeState::Pending, "0xaaa");
    let mut same_nonce_replacement = first.clone();
    same_nonce_replacement.submission.tx_hash = "0xbbb".into();
    same_nonce_replacement.outcome.tx_hash = "0xbbb".into();
    same_nonce_replacement.intent.from = first.intent.from.to_uppercase();
    let mut different_nonce = first.clone();
    different_nonce.intent.nonce = 8;
    different_nonce.submission.nonce = Some(8);

    let first_key =
        wallet_workbench_lib::commands::transactions::pending_mutation_guard_key(&first);
    let same_nonce_key = wallet_workbench_lib::commands::transactions::pending_mutation_guard_key(
        &same_nonce_replacement,
    );
    let same_nonce_request_key =
        wallet_workbench_lib::commands::transactions::pending_mutation_guard_key_from_request(
            &wallet_workbench_lib::commands::transactions::PendingMutationRequest {
                tx_hash: "0xbbb".into(),
                rpc_url: "http://127.0.0.1:8545".into(),
                account_index: same_nonce_replacement.intent.account_index,
                chain_id: same_nonce_replacement.intent.chain_id,
                from: same_nonce_replacement.intent.from.clone(),
                nonce: same_nonce_replacement.intent.nonce,
                gas_limit: "21000".into(),
                max_fee_per_gas: "50000000000".into(),
                max_priority_fee_per_gas: "2000000000".into(),
                to: Some("0x3333333333333333333333333333333333333333".into()),
                value_wei: Some("200".into()),
            },
        );
    let different_nonce_key =
        wallet_workbench_lib::commands::transactions::pending_mutation_guard_key(&different_nonce);

    assert_eq!(first_key, same_nonce_key);
    assert_eq!(first_key, same_nonce_request_key);
    assert_ne!(first_key, different_nonce_key);

    let guard =
        wallet_workbench_lib::commands::transactions::acquire_pending_mutation_guard(&first_key)
            .expect("first guard");

    assert!(
        wallet_workbench_lib::commands::transactions::acquire_pending_mutation_guard(
            &same_nonce_key,
        )
        .is_err()
    );
    assert!(
        wallet_workbench_lib::commands::transactions::acquire_pending_mutation_guard(
            &different_nonce_key,
        )
        .is_ok()
    );

    drop(guard);
    assert!(
        wallet_workbench_lib::commands::transactions::acquire_pending_mutation_guard(
            &same_nonce_key,
        )
        .is_ok()
    );
}

#[test]
fn pending_mutation_mark_failure_error_carries_safe_recovery_summary() {
    let mut record = history_record(4, ChainOutcomeState::Pending, "0xaaa");
    record.intent.rpc_url = "https://rpc.example.com/v1/raw-secret-api-key?apiKey=abc123".into();

    let error = wallet_workbench_lib::commands::transactions::pending_mutation_mark_failure_error(
        &record,
        "old record is not pending",
    );

    assert!(error.contains("recovery_record="));
    assert!(error.contains("0xaaa"));
    assert!(error.contains("old record is not pending"));
    assert!(error.contains("\"submission\""));
    assert!(error.contains("\"nonce_thread\""));
    assert!(!error.contains("rpc_url"));
    assert!(!error.contains("raw-secret-api-key"));
    assert!(!error.contains("apiKey"));
}

#[test]
fn empty_reconcile_updates_return_latest_history_snapshot() {
    with_test_app_dir("empty-reconcile-updates", |_| {
        persist_pending_history(native_transfer_intent(1, "1"), "0xaaa".into())
            .expect("persist first");
        persist_pending_history(native_transfer_intent(2, "1"), "0xbbb".into())
            .expect("persist second");

        let records = apply_pending_history_updates(1, &[]).expect("latest history");

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].outcome.tx_hash, "0xaaa");
        assert_eq!(records[1].outcome.tx_hash, "0xbbb");
    });
}

#[test]
fn reconcile_updates_are_scoped_to_the_requested_chain_id() {
    with_test_app_dir("chain-scoped-reconcile-updates", |_| {
        persist_pending_history(native_transfer_intent(1, "1"), "0xchain1".into())
            .expect("persist chain one");
        let mut chain_five = native_transfer_intent(1, "1");
        chain_five.chain_id = 5;
        persist_pending_history(chain_five, "0xchain5".into()).expect("persist chain five");

        let records =
            apply_pending_history_updates(5, &[("0xchain5".into(), ChainOutcomeState::Confirmed)])
                .expect("apply updates");

        let chain_one = records
            .iter()
            .find(|record| record.outcome.tx_hash == "0xchain1")
            .expect("chain one record");
        let chain_five = records
            .iter()
            .find(|record| record.outcome.tx_hash == "0xchain5")
            .expect("chain five record");

        assert_eq!(chain_one.outcome.state, ChainOutcomeState::Pending);
        assert_eq!(chain_five.outcome.state, ChainOutcomeState::Confirmed);
    });
}

#[test]
fn reconcile_updates_use_frozen_chain_identity_when_intent_is_stale() {
    with_test_app_dir("chain-scoped-frozen-reconcile-updates", |_| {
        let mut record = history_record(4, ChainOutcomeState::Pending, "0xfrozenchain5");
        record.intent.chain_id = 1;
        record.submission.chain_id = Some(5);
        record.nonce_thread.chain_id = Some(5);
        let raw = serde_json::to_string_pretty(&vec![record]).expect("serialize history");
        fs::write(history_path().expect("history path"), raw).expect("write history");

        let chain_one_records = apply_pending_history_updates(
            1,
            &[("0xfrozenchain5".into(), ChainOutcomeState::Confirmed)],
        )
        .expect("apply chain one updates");
        assert_eq!(
            chain_one_records[0].outcome.state,
            ChainOutcomeState::Pending
        );

        let chain_five_records = apply_pending_history_updates(
            5,
            &[("0xfrozenchain5".into(), ChainOutcomeState::Confirmed)],
        )
        .expect("apply chain five updates");
        assert_eq!(
            chain_five_records[0].outcome.state,
            ChainOutcomeState::Confirmed
        );
    });
}

#[test]
fn pending_history_reserves_next_nonce_for_matching_account_and_chain() {
    let mut records = Vec::new();
    records.push(history_record(4, ChainOutcomeState::Pending, "0xaaa"));
    records.push(history_record(6, ChainOutcomeState::Confirmed, "0xbbb"));

    assert_eq!(
        next_nonce_with_pending_history(
            &records,
            1,
            1,
            "0x1111111111111111111111111111111111111111",
            3,
        ),
        5
    );
    assert_eq!(
        next_nonce_with_pending_history(
            &records,
            1,
            1,
            "0x1111111111111111111111111111111111111111",
            8,
        ),
        8
    );
}

#[test]
fn pending_history_reserves_next_nonce_from_frozen_identity_before_stale_intent() {
    let mut record = history_record(4, ChainOutcomeState::Pending, "0xaaa");
    record.intent.chain_id = 99;
    record.intent.account_index = 9;
    record.intent.from = "0x9999999999999999999999999999999999999999".into();
    record.intent.nonce = 99;
    record.submission.chain_id = Some(1);
    record.submission.account_index = Some(1);
    record.submission.from = Some("0x1111111111111111111111111111111111111111".into());
    record.submission.nonce = Some(8);
    record.nonce_thread.chain_id = Some(1);
    record.nonce_thread.account_index = Some(1);
    record.nonce_thread.from = Some("0x1111111111111111111111111111111111111111".into());
    record.nonce_thread.nonce = Some(8);

    assert_eq!(
        next_nonce_with_pending_history(
            &[record],
            1,
            1,
            "0x1111111111111111111111111111111111111111",
            3,
        ),
        9
    );
}

#[test]
fn pending_history_uses_nonce_thread_identity_when_submission_is_incomplete() {
    let mut record = history_record(4, ChainOutcomeState::Pending, "0xaaa");
    record.intent.chain_id = 99;
    record.intent.account_index = 9;
    record.intent.from = "0x9999999999999999999999999999999999999999".into();
    record.intent.nonce = 99;
    record.submission.chain_id = None;
    record.submission.account_index = None;
    record.submission.from = None;
    record.submission.nonce = None;
    record.nonce_thread.chain_id = Some(1);
    record.nonce_thread.account_index = Some(1);
    record.nonce_thread.from = Some("0x1111111111111111111111111111111111111111".into());
    record.nonce_thread.nonce = Some(8);

    assert_eq!(
        next_nonce_with_pending_history(
            &[record],
            1,
            1,
            "0x1111111111111111111111111111111111111111",
            3,
        ),
        9
    );
}

#[test]
fn missing_receipt_can_mark_pending_as_dropped_after_nonce_advances() {
    let record = history_record(4, ChainOutcomeState::Pending, "0xaaa");

    assert_eq!(
        dropped_state_for_missing_receipt(&record, 5),
        Some(ChainOutcomeState::Dropped)
    );
    assert_eq!(dropped_state_for_missing_receipt(&record, 4), None);
}

#[test]
fn missing_receipt_drop_uses_frozen_nonce_before_stale_intent_nonce() {
    let mut record = history_record(4, ChainOutcomeState::Pending, "0xaaa");
    record.intent.nonce = 1;
    record.submission.nonce = Some(9);
    record.nonce_thread.nonce = Some(9);

    assert_eq!(dropped_state_for_missing_receipt(&record, 5), None);
    assert_eq!(
        dropped_state_for_missing_receipt(&record, 10),
        Some(ChainOutcomeState::Dropped)
    );
}

#[test]
fn broadcast_history_write_error_includes_the_tx_hash() {
    let message = broadcast_history_write_error("0xabc", "disk full");

    assert!(message.contains("0xabc"));
    assert!(message.contains("disk full"));
    assert!(message.contains("transaction broadcast"));
}

#[test]
fn receipt_status_maps_to_terminal_history_states() {
    assert_eq!(
        chain_outcome_from_receipt_status(Some(U64::from(1))),
        ChainOutcomeState::Confirmed
    );
    assert_eq!(
        chain_outcome_from_receipt_status(Some(U64::from(0))),
        ChainOutcomeState::Failed
    );
    assert_eq!(
        chain_outcome_from_receipt_status(None),
        ChainOutcomeState::Pending
    );
}

#[tokio::test(flavor = "current_thread")]
async fn dropped_review_confirms_receipt_and_preserves_original_dropped_audit() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("dropped-review-confirmed");
    let tx_hash = full_hash('a');
    let mut record = history_record(4, ChainOutcomeState::Dropped, &tx_hash);
    record.outcome.finalized_at = Some("1700000100".into());
    record.outcome.reconciled_at = Some("1700000100".into());
    record.outcome.reconcile_summary = Some(wallet_workbench_lib::models::ReconcileSummary {
        source: "rpcNonce".into(),
        checked_at: Some("1700000100".into()),
        rpc_chain_id: Some(1),
        latest_confirmed_nonce: Some(5),
        decision: "missingReceiptNonceAdvanced".into(),
    });
    fs::write(
        history_path().expect("history path"),
        serde_json::to_string_pretty(&vec![record]).expect("serialize history"),
    )
    .expect("write history");
    let base_rpc_url =
        start_dropped_review_rpc_server("\"0x1\"", receipt_json(&tx_hash, 1), "null", "\"0x5\"", 2);
    let rpc_url = format!(
        "{}{}{}",
        base_rpc_url.replacen("http://", "http://user:pass@", 1),
        "/private/path",
        "?token=secret-token"
    );

    let records = review_dropped_history_record(tx_hash.clone(), rpc_url, 1)
        .await
        .expect("review dropped");

    assert_eq!(records[0].outcome.state, ChainOutcomeState::Confirmed);
    assert_eq!(records[0].outcome.receipt.as_ref().unwrap().status, Some(1));
    assert_eq!(records[0].outcome.dropped_review_history.len(), 1);
    let review = &records[0].outcome.dropped_review_history[0];
    assert_eq!(review.original_state, ChainOutcomeState::Dropped);
    assert_eq!(
        review
            .original_reconcile_summary
            .as_ref()
            .expect("original dropped summary")
            .decision,
        "missingReceiptNonceAdvanced"
    );
    assert_eq!(review.result_state, ChainOutcomeState::Confirmed);
    assert_eq!(review.decision, "receiptStatus1");
    assert_eq!(review.rpc_endpoint_summary, base_rpc_url);
    assert!(!review.rpc_endpoint_summary.contains("user"));
    assert!(!review.rpc_endpoint_summary.contains("pass"));
    assert!(!review.rpc_endpoint_summary.contains("secret-token"));
    assert!(!review.rpc_endpoint_summary.contains("private"));
}

#[tokio::test(flavor = "current_thread")]
async fn dropped_review_marks_failed_only_from_failed_receipt() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("dropped-review-failed");
    let tx_hash = full_hash('b');
    fs::write(
        history_path().expect("history path"),
        serde_json::to_string_pretty(&vec![history_record(
            4,
            ChainOutcomeState::Dropped,
            &tx_hash,
        )])
        .expect("serialize history"),
    )
    .expect("write history");
    let rpc_url =
        start_dropped_review_rpc_server("\"0x1\"", receipt_json(&tx_hash, 0), "null", "\"0x5\"", 2);

    let records = review_dropped_history_record(tx_hash, rpc_url, 1)
        .await
        .expect("review dropped");

    assert_eq!(records[0].outcome.state, ChainOutcomeState::Failed);
    assert_eq!(
        records[0].outcome.dropped_review_history[0].decision,
        "receiptStatus0"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn dropped_review_keeps_uncertain_missing_receipt_as_dropped_not_failed() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("dropped-review-still-dropped");
    let tx_hash = full_hash('c');
    fs::write(
        history_path().expect("history path"),
        serde_json::to_string_pretty(&vec![history_record(
            4,
            ChainOutcomeState::Dropped,
            &tx_hash,
        )])
        .expect("serialize history"),
    )
    .expect("write history");
    let rpc_url = start_dropped_review_rpc_server("\"0x1\"", "null".into(), "null", "\"0x5\"", 4);

    let records = review_dropped_history_record(tx_hash, rpc_url, 1)
        .await
        .expect("review dropped");

    assert_eq!(records[0].outcome.state, ChainOutcomeState::Dropped);
    let review = &records[0].outcome.dropped_review_history[0];
    assert_eq!(review.result_state, ChainOutcomeState::Dropped);
    assert_eq!(review.decision, "stillMissingReceiptNonceAdvanced");
    assert!(review.recommendation.contains("not failed"));
}

#[tokio::test(flavor = "current_thread")]
async fn dropped_review_keeps_receipt_with_unknown_status_as_dropped_not_pending() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("dropped-review-unknown-receipt-status");
    let tx_hash = full_hash('5');
    fs::write(
        history_path().expect("history path"),
        serde_json::to_string_pretty(&vec![history_record(
            4,
            ChainOutcomeState::Dropped,
            &tx_hash,
        )])
        .expect("serialize history"),
    )
    .expect("write history");
    let rpc_url = start_dropped_review_rpc_server(
        "\"0x1\"",
        receipt_json_without_status(&tx_hash),
        "null",
        "\"0x5\"",
        2,
    );

    let records = review_dropped_history_record(tx_hash, rpc_url, 1)
        .await
        .expect("review dropped");

    assert_eq!(records[0].outcome.state, ChainOutcomeState::Dropped);
    assert!(records[0].outcome.receipt.is_none());
    let review = &records[0].outcome.dropped_review_history[0];
    assert_eq!(review.result_state, ChainOutcomeState::Dropped);
    assert_eq!(review.decision, "receiptStatusUnknown");
    assert_eq!(
        review.receipt.as_ref().expect("review receipt").status,
        None
    );
    assert!(review.recommendation.contains("status is unknown"));
}

#[tokio::test(flavor = "current_thread")]
async fn dropped_review_uses_local_same_nonce_replacement_without_mempool_inference() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("dropped-review-local-replacement");
    let dropped_hash = full_hash('d');
    let replacement_hash = full_hash('e');
    let mut dropped = history_record(4, ChainOutcomeState::Dropped, &dropped_hash);
    dropped.nonce_thread.replaced_by_tx_hash = Some(replacement_hash.clone());
    let mut replacement = history_record(4, ChainOutcomeState::Pending, &replacement_hash);
    replacement.submission.kind = wallet_workbench_lib::models::SubmissionKind::Replacement;
    replacement.submission.replaces_tx_hash = Some(dropped_hash.clone());
    replacement.nonce_thread.replaces_tx_hash = Some(dropped_hash.clone());
    fs::write(
        history_path().expect("history path"),
        serde_json::to_string_pretty(&vec![dropped, replacement]).expect("serialize history"),
    )
    .expect("write history");
    let rpc_url = start_dropped_review_rpc_server("\"0x1\"", "null".into(), "null", "\"0x5\"", 4);

    let records = review_dropped_history_record(dropped_hash, rpc_url, 1)
        .await
        .expect("review dropped");
    let original = records
        .iter()
        .find(|record| record.submission.tx_hash == full_hash('d'))
        .expect("dropped original");

    assert_eq!(original.outcome.state, ChainOutcomeState::Replaced);
    let review = &original.outcome.dropped_review_history[0];
    assert_eq!(
        review.local_same_nonce_tx_hash.as_deref(),
        Some(replacement_hash.as_str())
    );
    assert_eq!(review.decision, "localReplacementSameNonce");
}

#[tokio::test(flavor = "current_thread")]
async fn dropped_review_revalidates_local_same_nonce_relation_inside_final_history_lock() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("dropped-review-stale-local-relation");
    let dropped_hash = full_hash('1');
    let replacement_hash = full_hash('2');
    let mut dropped = history_record(4, ChainOutcomeState::Dropped, &dropped_hash);
    dropped.nonce_thread.replaced_by_tx_hash = Some(replacement_hash.clone());
    let mut replacement = history_record(4, ChainOutcomeState::Pending, &replacement_hash);
    replacement.submission.kind = wallet_workbench_lib::models::SubmissionKind::Replacement;
    replacement.submission.replaces_tx_hash = Some(dropped_hash.clone());
    replacement.nonce_thread.replaces_tx_hash = Some(dropped_hash.clone());
    fs::write(
        history_path().expect("history path"),
        serde_json::to_string_pretty(&vec![dropped.clone(), replacement.clone()])
            .expect("serialize initial history"),
    )
    .expect("write initial history");

    dropped.nonce_thread.replaced_by_tx_hash = None;
    replacement.submission.replaces_tx_hash = None;
    replacement.nonce_thread.replaces_tx_hash = None;
    let stale_relation_removed_history = serde_json::to_string_pretty(&vec![dropped, replacement])
        .expect("serialize concurrent history");
    let rpc_url = start_dropped_review_rpc_server_writing_history_on_transaction_lookup(
        history_path().expect("history path"),
        stale_relation_removed_history,
    );

    let records = review_dropped_history_record(dropped_hash.clone(), rpc_url, 1)
        .await
        .expect("review dropped");
    let original = records
        .iter()
        .find(|record| record.submission.tx_hash == dropped_hash)
        .expect("dropped original");

    assert_eq!(original.outcome.state, ChainOutcomeState::Dropped);
    let review = &original.outcome.dropped_review_history[0];
    assert_eq!(review.result_state, ChainOutcomeState::Dropped);
    assert_eq!(review.decision, "staleLocalSameNonceRelation");
    assert_eq!(review.local_same_nonce_tx_hash, None);
    assert!(review
        .recommendation
        .contains("changed before the review write"));
}

#[tokio::test(flavor = "current_thread")]
async fn dropped_review_uses_local_same_nonce_cancellation_without_mempool_inference() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("dropped-review-local-cancellation");
    let dropped_hash = full_hash('6');
    let cancellation_hash = full_hash('7');
    let mut dropped = history_record(4, ChainOutcomeState::Dropped, &dropped_hash);
    dropped.nonce_thread.replaced_by_tx_hash = Some(cancellation_hash.clone());
    let mut cancellation = history_record(4, ChainOutcomeState::Pending, &cancellation_hash);
    cancellation.submission.kind = wallet_workbench_lib::models::SubmissionKind::Cancellation;
    cancellation.submission.replaces_tx_hash = Some(dropped_hash.clone());
    cancellation.nonce_thread.replaces_tx_hash = Some(dropped_hash.clone());
    fs::write(
        history_path().expect("history path"),
        serde_json::to_string_pretty(&vec![dropped, cancellation]).expect("serialize history"),
    )
    .expect("write history");
    let rpc_url = start_dropped_review_rpc_server("\"0x1\"", "null".into(), "null", "\"0x5\"", 4);

    let records = review_dropped_history_record(dropped_hash, rpc_url, 1)
        .await
        .expect("review dropped");
    let original = records
        .iter()
        .find(|record| record.submission.tx_hash == full_hash('6'))
        .expect("dropped original");

    assert_eq!(original.outcome.state, ChainOutcomeState::Cancelled);
    assert_eq!(
        original.outcome.dropped_review_history[0].decision,
        "localCancellationSameNonce"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn dropped_review_records_rpc_and_chain_errors_without_changing_outcome() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("dropped-review-safe-errors");
    let rpc_error_hash = full_hash('8');
    let mismatch_hash = full_hash('9');
    fs::write(
        history_path().expect("history path"),
        serde_json::to_string_pretty(&vec![
            history_record(4, ChainOutcomeState::Dropped, &rpc_error_hash),
            history_record(5, ChainOutcomeState::Dropped, &mismatch_hash),
        ])
        .expect("serialize history"),
    )
    .expect("write history");
    let rpc_error_records =
        review_dropped_history_record(rpc_error_hash.clone(), "http://127.0.0.1:1".into(), 1)
            .await
            .expect("review with unavailable rpc");
    let rpc_error_record = rpc_error_records
        .iter()
        .find(|record| record.submission.tx_hash == rpc_error_hash)
        .expect("rpc error record");
    assert_eq!(rpc_error_record.outcome.state, ChainOutcomeState::Dropped);
    assert_eq!(
        rpc_error_record.outcome.dropped_review_history[0]
            .error_summary
            .as_ref()
            .expect("rpc error summary")
            .category,
        "rpcUnavailable"
    );

    let rpc_url = start_dropped_review_rpc_server("\"0x5\"", "null".into(), "null", "\"0x5\"", 1);
    let mismatch_records = review_dropped_history_record(mismatch_hash.clone(), rpc_url, 1)
        .await
        .expect("review chain mismatch");
    let mismatch_record = mismatch_records
        .iter()
        .find(|record| record.submission.tx_hash == mismatch_hash)
        .expect("mismatch record");
    assert_eq!(mismatch_record.outcome.state, ChainOutcomeState::Dropped);
    assert_eq!(
        mismatch_record.outcome.dropped_review_history[0].decision,
        "rpcChainIdMismatch"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn dropped_review_rejects_incomplete_frozen_submission_identity() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("dropped-review-incomplete");
    let tx_hash = full_hash('f');
    let mut record = history_record(4, ChainOutcomeState::Dropped, &tx_hash);
    record.submission.nonce = None;
    fs::write(
        history_path().expect("history path"),
        serde_json::to_string_pretty(&vec![record]).expect("serialize history"),
    )
    .expect("write history");

    let error = review_dropped_history_record(tx_hash, "http://127.0.0.1:1".into(), 1)
        .await
        .expect_err("review should reject incomplete identity");

    assert!(error.contains("nonce"));
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
    let reconciled = reconcile_pending_history("http://127.0.0.1:8545".into(), 31337).await;

    wallet_workbench_lib::session::clear_session_mnemonic();
    if let Some(value) = previous {
        std::env::set_var(APP_DIR_ENV, value);
    } else {
        std::env::remove_var(APP_DIR_ENV);
    }
    fs::remove_dir_all(&dir).expect("remove temp dir");

    assert!(result.is_ok(), "submit failed: {result:?}");
    let records = reconciled.expect("reconcile");
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].outcome.state, ChainOutcomeState::Confirmed);
}
