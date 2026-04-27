use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use ethers::types::U64;
use wallet_workbench_lib::storage::history_path;
use wallet_workbench_lib::transactions::{
    apply_pending_history_updates, broadcast_history_write_error,
    chain_outcome_from_receipt_status, dropped_state_for_missing_receipt, load_history_records,
    mark_prior_history_state, mark_prior_history_state_with_replacement,
    next_nonce_with_pending_history, nonce_thread_key, persist_pending_history,
    persist_pending_history_with_kind, reconcile_pending_history, ChainOutcomeState, HistoryRecord,
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
fn pending_mutation_mark_failure_error_carries_recovery_record() {
    let record = history_record(4, ChainOutcomeState::Pending, "0xaaa");

    let error = wallet_workbench_lib::commands::transactions::pending_mutation_mark_failure_error(
        &record,
        "old record is not pending",
    );

    assert!(error.contains("recovery_record="));
    assert!(error.contains("0xaaa"));
    assert!(error.contains("old record is not pending"));
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
fn missing_receipt_can_mark_pending_as_dropped_after_nonce_advances() {
    let record = history_record(4, ChainOutcomeState::Pending, "0xaaa");

    assert_eq!(
        dropped_state_for_missing_receipt(&record, 5),
        Some(ChainOutcomeState::Dropped)
    );
    assert_eq!(dropped_state_for_missing_receipt(&record, 4), None);
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
