#![recursion_limit = "256"]

use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ethers::abi::{encode, Token};
use ethers::middleware::SignerMiddleware;
use ethers::providers::{Http, Middleware, Provider};
use ethers::signers::Signer;
use ethers::types::{Address, Bytes, TransactionRequest, U256, U64};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use wallet_workbench_lib::diagnostics::read_diagnostic_events_from_path;
use wallet_workbench_lib::storage::{diagnostics_path, history_path};
use wallet_workbench_lib::transactions::{
    apply_pending_history_updates, broadcast_history_write_error, build_disperse_ether_calldata,
    build_disperse_token_calldata, build_erc20_allowance_calldata, build_erc20_transfer_calldata,
    chain_outcome_from_receipt_status, dropped_state_for_missing_receipt, inspect_history_storage,
    load_history_records, load_history_recovery_intents, mark_prior_history_state,
    mark_prior_history_state_with_replacement, next_nonce_with_pending_history, nonce_thread_key,
    persist_pending_history, persist_pending_history_with_kind, quarantine_history_storage,
    reconcile_pending_history, recover_broadcasted_history_record, review_dropped_history_record,
    submit_abi_write_call, ChainOutcomeState, HistoryCorruptionType, HistoryRecord,
    HistoryStorageStatus, NativeTransferIntent,
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
        typed_transaction: wallet_workbench_lib::models::TypedTransactionFields::native_transfer(
            value_wei,
        ),
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

fn abi_write_call_intent(rpc_url: String) -> NativeTransferIntent {
    NativeTransferIntent {
        typed_transaction: wallet_workbench_lib::models::TypedTransactionFields::contract_call(
            "0x13af4035",
            "setMessage(string)",
            "0",
        ),
        rpc_url,
        account_index: 1,
        chain_id: 1,
        from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".into(),
        to: "0x6666666666666666666666666666666666666666".into(),
        value_wei: "0".into(),
        nonce: 0,
        gas_limit: "90000".into(),
        max_fee_per_gas: "40000000000".into(),
        max_priority_fee_per_gas: "1500000000".into(),
    }
}

fn abi_write_call_calldata() -> Bytes {
    let mut bytes = vec![0x13, 0xaf, 0x40, 0x35];
    bytes.extend(encode(&[Token::String("hello".to_string())]));
    Bytes::from(bytes)
}

fn abi_write_call_metadata() -> wallet_workbench_lib::models::AbiCallHistoryMetadata {
    serde_json::from_value(serde_json::json!({
        "intentKind": "abiWriteCall",
        "draftId": "draft-abi-broadcast",
        "createdAt": "2026-04-29T01:02:03.000Z",
        "chainId": 1,
        "accountIndex": 1,
        "from": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "contractAddress": "0x6666666666666666666666666666666666666666",
        "sourceKind": "provider",
        "providerConfigId": "etherscan-mainnet",
        "versionId": "v1",
        "abiHash": "0xabi",
        "sourceFingerprint": "0xfingerprint",
        "functionSignature": "setMessage(string)",
        "selector": "0x13af4035",
        "argumentSummary": [
            {
                "kind": "string",
                "type": "string",
                "value": "hello",
                "byteLength": 5,
                "hash": "0xargumenthash",
                "truncated": false
            }
        ],
        "argumentHash": "0xargumenthash",
        "nativeValueWei": "0",
        "gasLimit": "90000",
        "maxFeePerGas": "40000000000",
        "maxPriorityFeePerGas": "1500000000",
        "nonce": 0,
        "selectedRpc": {
            "chainId": 1,
            "providerConfigId": "mainnet-rpc",
            "endpointName": "Mainnet token=ABI_RPC_SECRET",
            "endpointSummary": "https://rpc.example/?api_key=ABI_RPC_SECRET",
            "endpointFingerprint": "rpc-endpoint-broadcast"
        },
        "calldata": {
            "selector": "0x13af4035",
            "byteLength": 100,
            "hash": "0xcalldatahash",
            "rawCalldata": "0x13af4035ffffffff"
        },
        "canonicalParams": ["hello"],
        "rawAbi": "[{\"type\":\"function\",\"name\":\"setMessage\"}]"
    }))
    .expect("abi write metadata")
}

fn erc20_transfer_intent() -> wallet_workbench_lib::models::Erc20TransferIntent {
    let from = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".to_string();
    let token_contract = "0x3333333333333333333333333333333333333333".to_string();
    let recipient = "0x2222222222222222222222222222222222222222".to_string();
    let amount_raw = "1500000".to_string();
    let decimals = 6u8;
    let nonce = 0u64;
    let gas_limit = "65000".to_string();
    let max_fee_per_gas = "40000000000".to_string();
    let max_priority_fee_per_gas = "1500000000".to_string();
    let latest_base_fee_per_gas = Some("20000000000".to_string());
    let base_fee_per_gas = "20000000000".to_string();
    let base_fee_multiplier = "2".to_string();
    let max_fee_override_per_gas = None;
    let selector = "0xa9059cbb".to_string();
    let method = "transfer(address,uint256)".to_string();
    let native_value_wei = "0".to_string();
    let token_metadata_source = "onChainCall".to_string();
    let frozen_key = [
        "chainId=1".to_string(),
        format!("from={from}"),
        format!("tokenContract={token_contract}"),
        format!("recipient={recipient}"),
        format!("amountRaw={amount_raw}"),
        format!("decimals={decimals}"),
        format!("metadataSource={token_metadata_source}"),
        format!("nonce={nonce}"),
        format!("gasLimit={gas_limit}"),
        format!(
            "latestBaseFee={}",
            latest_base_fee_per_gas.as_deref().unwrap()
        ),
        format!("baseFee={base_fee_per_gas}"),
        format!("baseFeeMultiplier={base_fee_multiplier}"),
        format!("maxFee={max_fee_per_gas}"),
        "maxFeeOverride=auto".to_string(),
        format!("priorityFee={max_priority_fee_per_gas}"),
        format!("selector={selector}"),
        format!("method={method}"),
        format!("nativeValueWei={native_value_wei}"),
    ]
    .join("|");
    wallet_workbench_lib::models::Erc20TransferIntent {
        rpc_url: "http://127.0.0.1:8545".into(),
        account_index: 1,
        chain_id: 1,
        from,
        token_contract,
        recipient,
        amount_raw,
        decimals,
        token_symbol: Some("USDC".into()),
        token_name: Some("USD Coin".into()),
        token_metadata_source,
        nonce,
        gas_limit,
        max_fee_per_gas,
        max_priority_fee_per_gas,
        latest_base_fee_per_gas,
        base_fee_per_gas,
        base_fee_multiplier,
        max_fee_override_per_gas,
        selector,
        method,
        native_value_wei,
        frozen_key,
    }
}

fn erc20_history_intent_from_submit(
    intent: &wallet_workbench_lib::models::Erc20TransferIntent,
) -> NativeTransferIntent {
    NativeTransferIntent {
        typed_transaction: wallet_workbench_lib::models::TypedTransactionFields::erc20_transfer(
            intent.token_contract.clone(),
            intent.recipient.clone(),
            intent.amount_raw.clone(),
            intent.decimals,
            intent.token_symbol.clone(),
            intent.token_name.clone(),
            intent.token_metadata_source.clone(),
        ),
        rpc_url: intent.rpc_url.clone(),
        account_index: intent.account_index,
        chain_id: intent.chain_id,
        from: intent.from.clone(),
        to: intent.token_contract.clone(),
        value_wei: "0".to_string(),
        nonce: intent.nonce,
        gas_limit: intent.gas_limit.clone(),
        max_fee_per_gas: intent.max_fee_per_gas.clone(),
        max_priority_fee_per_gas: intent.max_priority_fee_per_gas.clone(),
    }
}

fn erc20_distribution_batch_input(
    rpc_url: String,
) -> wallet_workbench_lib::models::Erc20BatchSubmitInput {
    let from = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".to_string();
    let token_contract = "0x3333333333333333333333333333333333333333".to_string();
    let contract_address = "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3".to_string();
    wallet_workbench_lib::models::Erc20BatchSubmitInput {
        batch_id: "erc20-batch-test".to_string(),
        batch_kind: "distribute".to_string(),
        asset_kind: "erc20".to_string(),
        chain_id: 1,
        freeze_key: "erc20-freeze".to_string(),
        children: Vec::new(),
        distribution_parent: Some(wallet_workbench_lib::models::Erc20BatchDistributionParent {
            contract_address: contract_address.clone(),
            selector: "0xc73a2d60".to_string(),
            method_name: "disperseToken(address,address[],uint256[])".to_string(),
            token_contract: token_contract.clone(),
            decimals: 6,
            token_symbol: Some("USDC".to_string()),
            token_name: Some("USD Coin".to_string()),
            token_metadata_source: "onChainCall".to_string(),
            total_amount_raw: "1500000".to_string(),
            recipients: vec![
                wallet_workbench_lib::models::Erc20BatchDistributionRecipient {
                    child_id: "erc20-batch-test:child-0001".to_string(),
                    child_index: 0,
                    target_kind: "externalAddress".to_string(),
                    target_address: "0x2222222222222222222222222222222222222222".to_string(),
                    amount_raw: "1500000".to_string(),
                },
            ],
            intent: NativeTransferIntent {
                typed_transaction:
                    wallet_workbench_lib::models::TypedTransactionFields::contract_call(
                        "0xc73a2d60",
                        "disperseToken(address,address[],uint256[])",
                        "0",
                    ),
                rpc_url,
                account_index: 1,
                chain_id: 1,
                from,
                to: contract_address,
                value_wei: "0".to_string(),
                nonce: 0,
                gas_limit: "120000".to_string(),
                max_fee_per_gas: "40000000000".to_string(),
                max_priority_fee_per_gas: "1500000000".to_string(),
            },
        }),
    }
}

fn erc20_collection_batch_input() -> wallet_workbench_lib::models::Erc20BatchSubmitInput {
    let intent = erc20_transfer_intent();
    wallet_workbench_lib::models::Erc20BatchSubmitInput {
        batch_id: "erc20-collect-test".to_string(),
        batch_kind: "collect".to_string(),
        asset_kind: "erc20".to_string(),
        chain_id: 1,
        freeze_key: "erc20-collect-freeze".to_string(),
        distribution_parent: None,
        children: vec![wallet_workbench_lib::models::Erc20BatchSubmitChild {
            child_id: "erc20-collect-test:child-0001".to_string(),
            child_index: 0,
            batch_kind: "collect".to_string(),
            asset_kind: "erc20".to_string(),
            freeze_key: "erc20-collect-freeze".to_string(),
            target_kind: Some("externalAddress".to_string()),
            target_address: Some(intent.recipient.clone()),
            amount_raw: Some(intent.amount_raw.clone()),
            intent,
        }],
    }
}

fn u256_result_hex(value: U256) -> String {
    let mut bytes = [0u8; 32];
    value.to_big_endian(&mut bytes);
    let encoded = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("\"0x{encoded}\"")
}

fn decode_hex_bytes(input: &str) -> Vec<u8> {
    let trimmed = input.trim().trim_start_matches("0x");
    assert_eq!(trimmed.len() % 2, 0, "hex input must have even length");
    (0..trimmed.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&trimmed[index..index + 2], 16).expect("valid hex byte"))
        .collect()
}

fn erc20_frozen_key(
    chain_id: u64,
    from: &str,
    token_contract: &str,
    recipient: &str,
    amount_raw: &str,
    decimals: u8,
    nonce: u64,
    gas_limit: &str,
    max_fee_per_gas: &str,
    max_priority_fee_per_gas: &str,
) -> String {
    [
        format!("chainId={chain_id}"),
        format!("from={from}"),
        format!("tokenContract={token_contract}"),
        format!("recipient={recipient}"),
        format!("amountRaw={amount_raw}"),
        format!("decimals={decimals}"),
        "metadataSource=onChainCall".to_string(),
        format!("nonce={nonce}"),
        format!("gasLimit={gas_limit}"),
        "latestBaseFee=20000000000".to_string(),
        "baseFee=20000000000".to_string(),
        "baseFeeMultiplier=2".to_string(),
        format!("maxFee={max_fee_per_gas}"),
        "maxFeeOverride=auto".to_string(),
        format!("priorityFee={max_priority_fee_per_gas}"),
        "selector=0xa9059cbb".to_string(),
        "method=transfer(address,uint256)".to_string(),
        "nativeValueWei=0".to_string(),
    ]
    .join("|")
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
            typed_transaction:
                wallet_workbench_lib::models::TypedTransactionFields::native_transfer(
                    intent.value_wei.clone(),
                ),
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
        batch_metadata: None,
        abi_call_metadata: None,
        raw_calldata_metadata: None,
        intent,
    }
}

#[test]
fn history_record_accepts_additive_batch_metadata_without_breaking_legacy_json() {
    let legacy = serde_json::json!({
        "schema_version": 2,
        "intent": native_transfer_intent(1, "1"),
        "intent_snapshot": {
            "source": "nativeTransferIntent",
            "captured_at": "1700000000"
        },
        "submission": {
            "frozen_key": "key",
            "tx_hash": "0xabc",
            "kind": "nativeTransfer",
            "source": "submission",
            "chain_id": 1,
            "account_index": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x2222222222222222222222222222222222222222",
            "value_wei": "1",
            "nonce": 1,
            "gas_limit": "21000",
            "max_fee_per_gas": "40000000000",
            "max_priority_fee_per_gas": "1500000000",
            "broadcasted_at": "1700000001"
        },
        "outcome": {
            "state": "Pending",
            "tx_hash": "0xabc"
        },
        "nonce_thread": {
            "source": "derived",
            "key": "1:1:0x1111111111111111111111111111111111111111:1",
            "chain_id": 1,
            "account_index": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "nonce": 1
        }
    });
    let record: HistoryRecord = serde_json::from_value(legacy).expect("legacy record");
    assert!(record.batch_metadata.is_none());

    let with_batch = serde_json::json!({
        "schema_version": 2,
        "intent": native_transfer_intent(2, "2"),
        "intent_snapshot": {
            "source": "nativeTransferIntent",
            "captured_at": "1700000000"
        },
        "submission": {
            "frozen_key": "key",
            "tx_hash": "0xdef",
            "kind": "nativeTransfer",
            "source": "submission",
            "chain_id": 1,
            "account_index": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x2222222222222222222222222222222222222222",
            "value_wei": "2",
            "nonce": 2,
            "gas_limit": "21000",
            "max_fee_per_gas": "40000000000",
            "max_priority_fee_per_gas": "1500000000",
            "broadcasted_at": "1700000001"
        },
        "outcome": {
            "state": "Pending",
            "tx_hash": "0xdef"
        },
        "nonce_thread": {
            "source": "derived",
            "key": "1:1:0x1111111111111111111111111111111111111111:2",
            "chain_id": 1,
            "account_index": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "nonce": 2
        },
        "batch_metadata": {
            "batchId": "batch-1",
            "childId": "batch-1:child-0001",
            "batchKind": "collect",
            "assetKind": "native",
            "childIndex": 0,
            "freezeKey": "0xfrozen"
        }
    });
    let record: HistoryRecord = serde_json::from_value(with_batch).expect("batch record");
    let metadata = record.batch_metadata.expect("batch metadata");
    assert_eq!(metadata.batch_id, "batch-1");
    assert_eq!(metadata.child_id, "batch-1:child-0001");
    assert_eq!(metadata.batch_kind, "collect");
    assert_eq!(metadata.asset_kind, "native");
}

#[test]
fn history_record_roundtrips_abi_write_call_metadata_without_raw_payloads() {
    let raw_calldata = format!("0xa9059cbb{}", "0".repeat(512));
    let huge_value = format!("secret-param-{}", "x".repeat(5_000));
    let many_items = (0..20)
        .map(|index| {
            serde_json::json!({
                "kind": "uint",
                "type": "uint256",
                "value": format!("item-{index}"),
                "truncated": false
            })
        })
        .collect::<Vec<_>>();
    let many_fields = (0..20)
        .map(|index| {
            serde_json::json!({
                "name": format!("field-{index}"),
                "value": {
                    "kind": "string",
                    "type": "string",
                    "value": huge_value.clone(),
                    "hash": "0xfieldhash",
                    "byteLength": 5000,
                    "truncated": false
                }
            })
        })
        .collect::<Vec<_>>();
    let with_abi = serde_json::json!({
        "schema_version": 4,
        "intent": {
            "transaction_type": "contractCall",
            "rpc_url": "history-schema-placeholder",
            "account_index": 1,
            "chain_id": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x6666666666666666666666666666666666666666",
            "value_wei": "42",
            "nonce": 7,
            "gas_limit": "120000",
            "max_fee_per_gas": "40000000000",
            "max_priority_fee_per_gas": "1500000000",
            "selector": "0xa9059cbb",
            "method_name": "transfer(address,uint256)",
            "native_value_wei": "42"
        },
        "intent_snapshot": {
            "source": "abiWriteDraft",
            "captured_at": "2026-04-29T01:02:03.000Z"
        },
        "submission": {
            "transaction_type": "contractCall",
            "frozen_key": "abi-draft-key",
            "tx_hash": "unknown",
            "kind": "abiWriteCall",
            "source": "abiWriteDraft",
            "chain_id": 1,
            "account_index": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x6666666666666666666666666666666666666666",
            "value_wei": "42",
            "nonce": 7,
            "gas_limit": "120000",
            "max_fee_per_gas": "40000000000",
            "max_priority_fee_per_gas": "1500000000",
            "selector": "0xa9059cbb",
            "method_name": "transfer(address,uint256)",
            "native_value_wei": "42",
            "broadcasted_at": null
        },
        "outcome": {
            "state": "Pending",
            "tx_hash": "unknown"
        },
        "nonce_thread": {
            "source": "abiWriteDraft",
            "key": "1:1:0x1111111111111111111111111111111111111111:7",
            "chain_id": 1,
            "account_index": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "nonce": 7
        },
        "abi_call_metadata": {
            "intentKind": "abiWriteCall",
            "draftId": "draft-abi-1",
            "createdAt": "2026-04-29T01:02:03.000Z",
            "chainId": 1,
            "accountIndex": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "contractAddress": "0x6666666666666666666666666666666666666666",
            "sourceKind": "provider",
            "providerConfigId": "etherscan-mainnet",
            "userSourceId": null,
            "versionId": "v1",
            "abiHash": "0xabi",
            "sourceFingerprint": "0xfingerprint",
            "functionSignature": "transfer(address,uint256)",
            "selector": "0xa9059cbb",
            "argumentSummary": [
                {
                    "kind": "address",
                    "type": "address",
                    "value": "0x7777777777777777777777777777777777777777",
                    "truncated": false
                },
                {
                    "kind": "uint",
                    "type": "uint256",
                    "value": "1000000",
                    "truncated": false
                },
                {
                    "kind": "bytes",
                    "type": "bytes",
                    "value": huge_value.clone(),
                    "byteLength": 5000,
                    "hash": "0xhugehash",
                    "items": many_items,
                    "fields": many_fields,
                    "truncated": false
                }
            ],
            "argumentHash": "0xargs",
            "canonicalParams": ["0x7777777777777777777777777777777777777777", "1000000"],
            "nativeValueWei": "42",
            "gasLimit": null,
            "maxFeePerGas": null,
            "maxPriorityFeePerGas": null,
            "nonce": null,
            "selectedRpc": {
                "chainId": 1,
                "providerConfigId": "mainnet-rpc",
                "endpointId": "primary",
                "endpointName": "Mainnet primary token=SECRET_TOKEN",
                "endpointSummary": "https://rpc.example/?api_key=SECRET_TOKEN",
                "endpointFingerprint": "rpc-endpoint-1234abcd",
                "endpointFingerprintSource": "https://rpc.example/?api_key=SECRET_TOKEN",
                "rpcUrl": "https://rpc.example/?api_key=SECRET_TOKEN"
            },
            "warnings": [
                {
                    "level": "warning",
                    "code": "payable",
                    "message": "Requires value via https://rpc.example/?api_key=SECRET_TOKEN",
                    "source": "abi"
                }
            ],
            "blockingStatuses": [
                {
                    "level": "blocking",
                    "code": "unsupportedTuple",
                    "message": "Tuple input Authorization: Bearer SECRET_TOKEN",
                    "source": "abi"
                }
            ],
            "calldata": {
                "selector": "0xa9059cbb",
                "byteLength": 68,
                "hash": "0xcalldatahash",
                "rawCalldata": raw_calldata
            },
            "futureSubmission": {
                "status": null,
                "txHash": null,
                "submittedAt": null,
                "broadcastedAt": null,
                "errorSummary": "submit failed token=SECRET_TOKEN privateKey=0xabc rawTx=0xsigned signed transaction=signed-secret"
            },
            "futureOutcome": {
                "state": "Confirmed",
                "checkedAt": null,
                "receiptStatus": null,
                "blockNumber": null,
                "gasUsed": null,
                "errorSummary": "receipt failed https://rpc.example/?token=SECRET_TOKEN mnemonic=abandon abandon next=value"
            },
            "broadcast": {
                "txHash": null,
                "broadcastedAt": null,
                "rpcChainId": null,
                "rpcEndpointSummary": "wss://rpc.example/socket?token=SECRET_TOKEN",
                "errorSummary": "broadcast failed Bearer SECRET_TOKEN"
            },
            "recovery": {
                "recoveryId": null,
                "status": null,
                "createdAt": null,
                "recoveredAt": null,
                "lastError": "recover failed api_key=SECRET_TOKEN",
                "replacementTxHash": null
            },
            "rawAbi": "[{\"type\":\"function\",\"name\":\"transfer\"}]"
        }
    });

    let record: HistoryRecord = serde_json::from_value(with_abi).expect("abi call record");
    assert_eq!(
        record.submission.kind,
        wallet_workbench_lib::models::SubmissionKind::AbiWriteCall
    );
    assert_eq!(
        record.submission.typed_transaction.transaction_type,
        wallet_workbench_lib::models::TransactionType::ContractCall
    );
    let metadata = record
        .abi_call_metadata
        .as_ref()
        .expect("abi call metadata");
    assert_eq!(metadata.intent_kind, "abiWriteCall");
    assert_eq!(metadata.source_kind, "provider");
    assert_eq!(
        metadata.provider_config_id.as_deref(),
        Some("etherscan-mainnet")
    );
    assert_eq!(metadata.version_id.as_deref(), Some("v1"));
    assert_eq!(
        metadata.function_signature.as_deref(),
        Some("transfer(address,uint256)")
    );
    assert_eq!(metadata.argument_hash.as_deref(), Some("0xargs"));
    assert_eq!(metadata.argument_summary.len(), 3);
    assert_eq!(metadata.argument_summary[0].type_label, "address");
    let huge_summary = &metadata.argument_summary[2];
    assert_eq!(huge_summary.byte_length, Some(5000));
    assert_eq!(huge_summary.hash.as_deref(), Some("0xhugehash"));
    assert_eq!(huge_summary.items.len(), 16);
    assert_eq!(huge_summary.fields.len(), 16);
    assert!(huge_summary.truncated);
    assert!(!huge_summary
        .value
        .as_deref()
        .unwrap_or_default()
        .contains(&huge_value));
    assert!(!huge_summary.fields[0]
        .value
        .value
        .as_deref()
        .unwrap_or_default()
        .contains(&huge_value));
    assert_eq!(
        metadata
            .selected_rpc
            .as_ref()
            .and_then(|rpc| rpc.endpoint_summary.as_deref()),
        Some("[redacted_endpoint]")
    );
    assert_eq!(
        metadata
            .selected_rpc
            .as_ref()
            .and_then(|rpc| rpc.endpoint_name.as_deref()),
        Some("[redacted_endpoint]")
    );
    assert_eq!(
        metadata
            .selected_rpc
            .as_ref()
            .and_then(|rpc| rpc.endpoint_fingerprint.as_deref()),
        Some("rpc-endpoint-1234abcd")
    );
    assert_eq!(
        metadata
            .calldata
            .as_ref()
            .and_then(|calldata| calldata.hash.as_deref()),
        Some("0xcalldatahash")
    );
    assert_eq!(
        metadata
            .warnings
            .first()
            .and_then(|warning| warning.message.as_deref()),
        Some("Requires value via [redacted_url]")
    );
    assert_eq!(
        metadata
            .blocking_statuses
            .first()
            .and_then(|status| status.message.as_deref()),
        Some("Tuple input [redacted_secret] [redacted]")
    );
    assert!(metadata
        .future_submission
        .as_ref()
        .is_some_and(|placeholder| placeholder.tx_hash.is_none()));
    let future_submission = metadata
        .future_submission
        .as_ref()
        .expect("future submission placeholder");
    assert_eq!(
        future_submission.error_summary.as_deref(),
        Some(
            "submit failed [redacted_secret] [redacted_secret] [redacted_secret] [redacted_secret]"
        )
    );
    let future_outcome = metadata
        .future_outcome
        .as_ref()
        .expect("future outcome placeholder");
    assert_eq!(
        future_outcome.state,
        Some(wallet_workbench_lib::models::AbiCallOutcomeState::Confirmed)
    );
    assert_eq!(
        future_outcome.error_summary.as_deref(),
        Some("receipt failed [redacted_url] [redacted_secret] [redacted] next=value")
    );
    assert!(metadata
        .broadcast
        .as_ref()
        .is_some_and(|placeholder| placeholder.tx_hash.is_none()));
    assert_eq!(
        metadata
            .broadcast
            .as_ref()
            .and_then(|placeholder| placeholder.rpc_endpoint_summary.as_deref()),
        Some("[redacted_endpoint]")
    );
    assert_eq!(
        metadata
            .broadcast
            .as_ref()
            .and_then(|placeholder| placeholder.error_summary.as_deref()),
        Some("broadcast failed [redacted] [redacted]")
    );
    assert_eq!(
        metadata
            .recovery
            .as_ref()
            .and_then(|placeholder| placeholder.last_error.as_deref()),
        Some("recover failed [redacted_secret]")
    );
    assert!(metadata
        .recovery
        .as_ref()
        .is_some_and(|placeholder| placeholder.recovery_id.is_none()));

    let serialized = serde_json::to_string(&record).expect("serialize abi call record");
    assert!(serialized.contains("abiWriteCall"));
    assert!(serialized.contains("abi_call_metadata"));
    assert!(serialized.contains("\"state\":\"Confirmed\""));
    assert!(!serialized.contains("\"state\":\"confirmed\""));
    assert!(!serialized.contains(&raw_calldata));
    assert!(!serialized.contains(&huge_value));
    assert!(!serialized.contains("rawCalldata"));
    assert!(!serialized.contains("rawAbi"));
    assert!(!serialized.contains("canonicalParams"));
    assert!(!serialized.contains("endpointFingerprintSource"));
    assert!(!serialized.contains("SECRET_TOKEN"));
    assert!(!serialized.contains("api_key"));
    assert!(!serialized.contains("token="));
    assert!(!serialized.contains("0xabc"));
    assert!(!serialized.contains("0xsigned"));
    assert!(!serialized.contains("signed-secret"));
    assert!(!serialized.contains("abandon abandon"));
}

#[test]
fn history_recovery_intent_preserves_abi_write_placeholders_additively() {
    let intent: wallet_workbench_lib::models::HistoryRecoveryIntent =
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "id": "abi-recovery-1",
            "status": "active",
            "createdAt": "2026-04-29T01:02:03.000Z",
            "txHash": "unknown",
            "kind": "abiWriteCall",
            "chainId": 1,
            "accountIndex": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "nonce": 7,
            "to": "0x6666666666666666666666666666666666666666",
            "valueWei": "42",
            "selector": "0xa9059cbb",
            "methodName": "transfer(address,uint256)",
            "nativeValueWei": "42",
            "frozenKey": "abi-draft-key",
            "gasLimit": "120000",
            "maxFeePerGas": "40000000000",
            "maxPriorityFeePerGas": "1500000000",
            "abiCallMetadata": {
                "intentKind": "abiWriteCall",
                "draftId": "draft-abi-1",
                "createdAt": "2026-04-29T01:02:03.000Z",
                "chainId": 1,
                "accountIndex": 1,
                "contractAddress": "0x6666666666666666666666666666666666666666",
                "sourceKind": "provider",
                "versionId": "v1",
                "abiHash": "0xabi",
                "sourceFingerprint": "0xfingerprint",
                "functionSignature": "transfer(address,uint256)",
                "selector": "0xa9059cbb",
                "argumentHash": "0xargs",
                "nativeValueWei": "42",
                "calldata": { "selector": "0xa9059cbb", "byteLength": 68, "hash": "0xcalldatahash" },
                "futureSubmission": { "txHash": null },
                "broadcast": { "txHash": null },
                "recovery": { "recoveryId": null }
            },
            "broadcastedAt": "2026-04-29T01:02:04.000Z",
            "writeError": "schema placeholder only"
        }))
        .expect("recovery intent with abi metadata");

    assert_eq!(
        intent.kind,
        wallet_workbench_lib::models::SubmissionKind::AbiWriteCall
    );
    let metadata = intent.abi_call_metadata.expect("abi call metadata");
    assert_eq!(metadata.intent_kind, "abiWriteCall");
    assert_eq!(
        metadata
            .calldata
            .as_ref()
            .and_then(|calldata| calldata.byte_length),
        Some(68)
    );
    assert!(metadata
        .broadcast
        .as_ref()
        .is_some_and(|placeholder| placeholder.tx_hash.is_none()));

    let future: wallet_workbench_lib::models::HistoryRecoveryIntent =
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "id": "future-kind",
            "status": "active",
            "createdAt": "2026-04-29T01:02:03.000Z",
            "txHash": "unknown",
            "kind": "futureSubmitKind",
            "broadcastedAt": "2026-04-29T01:02:04.000Z",
            "writeError": "future kind"
        }))
        .expect("future recovery kind");
    assert_eq!(
        future.kind,
        wallet_workbench_lib::models::SubmissionKind::Unsupported
    );
}

#[test]
fn history_record_roundtrips_raw_calldata_metadata_without_raw_payloads() {
    let raw_calldata = format!("0x12345678{}", "ab".repeat(512));
    let with_raw = serde_json::json!({
        "schema_version": 5,
        "intent": {
            "transaction_type": "rawCalldata",
            "rpc_url": "history-schema-placeholder",
            "account_index": 1,
            "chain_id": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x6666666666666666666666666666666666666666",
            "value_wei": "42",
            "nonce": 7,
            "gas_limit": "120000",
            "max_fee_per_gas": "40000000000",
            "max_priority_fee_per_gas": "1500000000",
            "selector": "0x12345678",
            "native_value_wei": "42"
        },
        "intent_snapshot": {
            "source": "rawCalldataDraft",
            "captured_at": "2026-04-29T01:02:03.000Z"
        },
        "submission": {
            "transaction_type": "rawCalldata",
            "frozen_key": "raw-draft-key",
            "tx_hash": "0xraw",
            "kind": "rawCalldata",
            "source": "rawCalldataDraft",
            "chain_id": 1,
            "account_index": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x6666666666666666666666666666666666666666",
            "value_wei": "42",
            "nonce": 7,
            "gas_limit": "120000",
            "max_fee_per_gas": "40000000000",
            "max_priority_fee_per_gas": "1500000000",
            "selector": "0x12345678",
            "native_value_wei": "42",
            "broadcasted_at": null
        },
        "outcome": {
            "state": "Pending",
            "tx_hash": "0xraw"
        },
        "nonce_thread": {
            "source": "rawCalldataDraft",
            "key": "1:1:0x1111111111111111111111111111111111111111:7",
            "chain_id": 1,
            "account_index": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "nonce": 7
        },
        "raw_calldata_metadata": {
            "intentKind": "rawCalldata",
            "draftId": "draft-raw-1",
            "createdAt": "2026-04-29T01:02:03.000Z",
            "chainId": 1,
            "accountIndex": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x6666666666666666666666666666666666666666",
            "valueWei": "42",
            "gasLimit": "120000",
            "maxFeePerGas": "40000000000",
            "maxPriorityFeePerGas": "1500000000",
            "nonce": 7,
            "calldataHashVersion": "keccak256-v1",
            "calldataHash": "0xhash",
            "calldataByteLength": 516,
            "selector": "0x12345678",
            "selectorStatus": "matched",
            "preview": {
                "previewPrefixBytes": 32,
                "previewSuffixBytes": 32,
                "truncated": true,
                "omittedBytes": 452,
                "display": "0x12345678...abab",
                "prefix": "0x12345678",
                "suffix": "0xabab",
                "fullCalldata": raw_calldata
            },
            "warningAcknowledgements": [
                { "level": "warning", "code": "unknownSelector", "message": "ack token=SECRET_TOKEN", "source": "user" }
            ],
            "warningSummaries": [
                { "level": "warning", "code": "largeCalldata", "message": "payload is large", "source": "preview" }
            ],
            "blockingStatuses": [
                { "level": "blocking", "code": "missingAck", "message": "privateKey=0xabc", "source": "preview" }
            ],
            "inference": {
                "inferenceStatus": "matched",
                "matchedSourceKind": "explorerFetched",
                "matchedSourceId": "etherscan-mainnet",
                "matchedVersionId": "v1",
                "matchedSourceFingerprint": "0xfingerprint",
                "matchedAbiHash": "0xabi",
                "selectorMatchCount": 1,
                "conflictSummary": "none",
                "staleStatus": "fresh",
                "sourceStatus": "ok"
            },
            "frozenKey": "raw-draft-key",
            "futureSubmission": {
                "status": "pending",
                "txHash": null,
                "errorSummary": "failed signedTx=0xsigned mnemonic=abandon abandon next=value"
            },
            "broadcast": {
                "txHash": null,
                "rpcEndpointSummary": "https://rpc.example/?api_key=SECRET_TOKEN"
            },
            "recovery": {
                "recoveryId": null,
                "lastError": "recover failed rawTx=0xsigned"
            },
            "rawCalldata": raw_calldata,
            "calldata": raw_calldata,
            "canonicalCalldata": raw_calldata,
            "fullCalldata": raw_calldata,
            "privateKey": "0xabc"
        }
    });

    let record: HistoryRecord = serde_json::from_value(with_raw).expect("raw calldata record");
    assert_eq!(
        record.submission.kind,
        wallet_workbench_lib::models::SubmissionKind::RawCalldata
    );
    assert_eq!(
        record.submission.typed_transaction.transaction_type,
        wallet_workbench_lib::models::TransactionType::RawCalldata
    );
    assert!(record.abi_call_metadata.is_none());
    assert!(record.batch_metadata.is_none());
    let metadata = record
        .raw_calldata_metadata
        .as_ref()
        .expect("raw calldata metadata");
    assert_eq!(metadata.intent_kind, "rawCalldata");
    assert_eq!(metadata.calldata_hash_version, "keccak256-v1");
    assert_eq!(metadata.calldata_hash.as_deref(), Some("0xhash"));
    assert_eq!(metadata.calldata_byte_length, Some(516));
    assert_eq!(metadata.selector.as_deref(), Some("0x12345678"));
    assert_eq!(metadata.selector_status.as_deref(), Some("matched"));
    assert_eq!(
        metadata
            .preview
            .as_ref()
            .and_then(|preview| preview.omitted_bytes),
        Some(452)
    );
    assert_eq!(
        metadata
            .inference
            .as_ref()
            .map(|inference| inference.selector_match_count),
        Some(Some(1))
    );
    assert_eq!(
        metadata
            .warning_acknowledgements
            .first()
            .and_then(|warning| warning.message.as_deref()),
        Some("ack [redacted_secret]")
    );
    assert_eq!(
        metadata
            .blocking_statuses
            .first()
            .and_then(|status| status.message.as_deref()),
        Some("[redacted_secret]")
    );
    assert_eq!(
        metadata
            .future_submission
            .as_ref()
            .and_then(|future| future.error_summary.as_deref()),
        Some("failed [redacted_secret] [redacted_secret] [redacted] next=value")
    );
    assert_eq!(
        metadata
            .broadcast
            .as_ref()
            .and_then(|broadcast| broadcast.rpc_endpoint_summary.as_deref()),
        Some("[redacted_endpoint]")
    );

    let serialized = serde_json::to_string(&record).expect("serialize raw calldata record");
    assert!(serialized.contains("rawCalldata"));
    assert!(serialized.contains("raw_calldata_metadata"));
    assert!(!serialized.contains(&raw_calldata));
    assert!(!serialized.contains("rawCalldata\":\""));
    assert!(!serialized.contains("fullCalldata"));
    assert!(!serialized.contains("canonicalCalldata"));
    assert!(!serialized.contains("calldata\":\""));
    assert!(!serialized.contains("SECRET_TOKEN"));
    assert!(!serialized.contains("api_key"));
    assert!(!serialized.contains("0xabc"));
    assert!(!serialized.contains("0xsigned"));
    assert!(!serialized.contains("abandon abandon"));
}

#[test]
fn history_record_redacts_oversized_accepted_raw_calldata_summary_fields() {
    let oversized_hex = format!("0x12345678{}", "ab".repeat(512));
    let with_raw = serde_json::json!({
        "schema_version": 5,
        "intent": {
            "transaction_type": "rawCalldata",
            "rpc_url": "history-schema-placeholder",
            "account_index": 1,
            "chain_id": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x6666666666666666666666666666666666666666",
            "value_wei": "42",
            "nonce": 7,
            "gas_limit": "120000",
            "max_fee_per_gas": "40000000000",
            "max_priority_fee_per_gas": "1500000000",
            "selector": oversized_hex
        },
        "submission": {
            "transaction_type": "rawCalldata",
            "frozen_key": "raw-draft-key",
            "tx_hash": "0xraw",
            "kind": "rawCalldata",
            "selector": oversized_hex
        },
        "outcome": {
            "state": "Pending",
            "tx_hash": "0xraw"
        },
        "raw_calldata_metadata": {
            "intentKind": "rawCalldata",
            "calldataHashVersion": "keccak256-v1",
            "calldataHash": oversized_hex,
            "calldataByteLength": 516,
            "selector": oversized_hex,
            "selectorStatus": "unknown",
            "preview": {
                "display": oversized_hex,
                "prefix": oversized_hex,
                "suffix": oversized_hex,
                "truncated": true
            },
            "inference": {
                "inferenceStatus": "conflict",
                "matchedSourceFingerprint": oversized_hex,
                "matchedAbiHash": oversized_hex,
                "selectorMatchCount": 2,
                "conflictSummary": format!("{oversized_hex} privateKey=0xabc")
            }
        }
    });

    let record: HistoryRecord = serde_json::from_value(with_raw).expect("raw calldata record");
    let metadata = record
        .raw_calldata_metadata
        .as_ref()
        .expect("raw calldata metadata");

    assert_eq!(
        record.intent.typed_transaction.selector.as_deref(),
        Some("[redacted_payload]")
    );
    assert_eq!(
        record.submission.typed_transaction.selector.as_deref(),
        Some("[redacted_payload]")
    );
    assert_eq!(
        metadata.calldata_hash.as_deref(),
        Some("[redacted_payload]")
    );
    assert_eq!(metadata.selector.as_deref(), Some("[redacted_payload]"));
    assert_eq!(
        metadata
            .preview
            .as_ref()
            .and_then(|preview| preview.display.as_deref()),
        Some("[redacted_payload]")
    );
    assert_eq!(
        metadata
            .preview
            .as_ref()
            .and_then(|preview| preview.prefix.as_deref()),
        Some("[redacted_payload]")
    );
    assert_eq!(
        metadata
            .preview
            .as_ref()
            .and_then(|preview| preview.suffix.as_deref()),
        Some("[redacted_payload]")
    );
    assert_eq!(
        metadata
            .inference
            .as_ref()
            .and_then(|inference| inference.conflict_summary.as_deref()),
        Some("[redacted_payload]")
    );

    let serialized = serde_json::to_string(&record).expect("serialize raw calldata record");
    assert!(!serialized.contains(&oversized_hex));
    assert!(!serialized.contains("abababababababababababababababababababab"));
    assert!(!serialized.contains("0xabc"));
}

#[test]
fn history_recovery_intent_preserves_raw_calldata_metadata_additively() {
    let intent: wallet_workbench_lib::models::HistoryRecoveryIntent =
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "id": "raw-recovery-1",
            "status": "active",
            "createdAt": "2026-04-29T01:02:03.000Z",
            "txHash": "0xraw",
            "kind": "rawCalldata",
            "chainId": 1,
            "accountIndex": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "nonce": 7,
            "to": "0x6666666666666666666666666666666666666666",
            "valueWei": "42",
            "selector": "0x12345678",
            "nativeValueWei": "42",
            "frozenKey": "raw-draft-key",
            "gasLimit": "120000",
            "maxFeePerGas": "40000000000",
            "maxPriorityFeePerGas": "1500000000",
            "rawCalldataMetadata": {
                "intentKind": "rawCalldata",
                "chainId": 1,
                "accountIndex": 1,
                "from": "0x1111111111111111111111111111111111111111",
                "to": "0x6666666666666666666666666666666666666666",
                "calldataHashVersion": "keccak256-v1",
                "calldataHash": "0xhash",
                "calldataByteLength": 4,
                "selector": "0x12345678",
                "selectorStatus": "unknown",
                "preview": { "truncated": false, "display": "0x12345678" },
                "futureSubmission": { "txHash": null },
                "broadcast": { "txHash": null },
                "recovery": { "recoveryId": null }
            },
            "broadcastedAt": "2026-04-29T01:02:04.000Z",
            "writeError": "schema placeholder"
        }))
        .expect("recovery intent with raw calldata metadata");

    assert_eq!(
        intent.kind,
        wallet_workbench_lib::models::SubmissionKind::RawCalldata
    );
    let metadata = intent
        .raw_calldata_metadata
        .as_ref()
        .expect("raw calldata metadata");
    assert_eq!(metadata.intent_kind, "rawCalldata");
    assert_eq!(metadata.calldata_byte_length, Some(4));
    assert!(metadata
        .broadcast
        .as_ref()
        .is_some_and(|placeholder| placeholder.tx_hash.is_none()));

    let serialized = serde_json::to_string(&intent).expect("serialize raw recovery intent");
    assert!(serialized.contains("rawCalldataMetadata"));
    assert!(serialized.contains("calldataByteLength"));
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

fn start_abi_broadcast_failure_rpc_server() -> String {
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
            let body = if request.contains("eth_chainId") {
                r#"{"jsonrpc":"2.0","id":1,"result":"0x1"}"#.to_string()
            } else if request.contains("eth_getBalance") {
                r#"{"jsonrpc":"2.0","id":1,"result":"0xffffffffffffffffffff"}"#.to_string()
            } else if request.contains("eth_getTransactionCount") {
                r#"{"jsonrpc":"2.0","id":1,"result":"0x0"}"#.to_string()
            } else if request.contains("eth_sendRawTransaction") {
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "error": {
                        "code": -32000,
                        "message": "broadcast rejected rawCalldata=0x13af4035ffffffff api_key=SEND_SECRET privateKey=0xabc signedTx=signed-secret rawAbi=[{\"type\":\"function\"}] canonicalParams=[\"SEND_SECRET\"]"
                    }
                })
                .to_string()
            } else {
                r#"{"jsonrpc":"2.0","id":1,"result":null}"#.to_string()
            };
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

fn start_erc20_submit_rpc_server(
    native_balance: U256,
    token_balance: U256,
    history_path_to_turn_into_directory_on_broadcast: Option<PathBuf>,
) -> (String, Arc<Mutex<Vec<String>>>) {
    start_erc20_submit_rpc_server_with_call_result(
        native_balance,
        u256_result_hex(token_balance),
        history_path_to_turn_into_directory_on_broadcast,
    )
}

fn start_erc20_submit_rpc_server_with_call_result(
    native_balance: U256,
    eth_call_result: String,
    history_path_to_turn_into_directory_on_broadcast: Option<PathBuf>,
) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind rpc server");
    let address = listener.local_addr().expect("local addr");
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&requests);
    thread::spawn(move || {
        for stream in listener.incoming().take(8) {
            let mut stream = stream.expect("accept rpc request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set read timeout");
            let mut buffer = [0; 8192];
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
                "\"0x1\"".to_string()
            } else if request.contains("eth_getBalance") {
                u256_result_hex(native_balance)
            } else if request.contains("eth_call") {
                eth_call_result.clone()
            } else if request.contains("eth_getTransactionCount") {
                "\"0x0\"".to_string()
            } else if request.contains("eth_sendRawTransaction") {
                if let Some(path) = &history_path_to_turn_into_directory_on_broadcast {
                    let _ = fs::remove_file(path);
                    fs::create_dir_all(path).expect("turn history path into directory");
                }
                "\"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"".to_string()
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
    (format!("http://{address}"), requests)
}

fn start_erc20_batch_distribution_rpc_server(
    native_balance: U256,
    token_balance: U256,
    allowance: U256,
) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind rpc server");
    let address = listener.local_addr().expect("local addr");
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&requests);
    thread::spawn(move || {
        for stream in listener.incoming().take(8) {
            let mut stream = stream.expect("accept rpc request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set read timeout");
            let mut buffer = [0; 8192];
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
                "\"0x1\"".to_string()
            } else if request.contains("eth_getBalance") {
                u256_result_hex(native_balance)
            } else if request.contains("eth_getTransactionCount") {
                "\"0x0\"".to_string()
            } else if request.contains("eth_call") && request.contains("70a08231") {
                u256_result_hex(token_balance)
            } else if request.contains("eth_call") && request.contains("dd62ed3e") {
                u256_result_hex(allowance)
            } else if request.contains("eth_sendRawTransaction") {
                "\"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"".to_string()
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
    (format!("http://{address}"), requests)
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
async fn abi_write_history_write_failure_records_typed_recovery_without_payloads() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("abi-write-history-recovery");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let path = history_path().expect("history path");
    let rpc_url = start_history_write_failure_rpc_server(path);
    let intent = abi_write_call_intent(format!("{rpc_url}/?apiKey=ABI_RPC_SECRET"));
    let frozen_key = "abi-draft-frozen-key".to_string();

    let error = submit_abi_write_call(
        intent,
        abi_write_call_calldata(),
        abi_write_call_metadata(),
        frozen_key.clone(),
    )
    .await
    .expect_err("history write should fail after ABI write broadcast");
    let intents = load_history_recovery_intents().expect("load recovery intents");
    let raw_intents = serde_json::to_string(&intents).expect("serialize recovery intents");
    let events = read_diagnostic_events_from_path(&diagnostics_path().expect("diagnostics path"))
        .expect("read diagnostics");
    let raw_events = serde_json::to_string(&events).expect("serialize diagnostics");

    assert!(error.contains("ABI write call broadcast"));
    assert!(error
        .contains("tx_hash=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    assert!(error.contains("selector=0x13af4035"));
    assert!(error.contains("method=setMessage(string)"));
    assert!(error.contains(&format!("frozenKey={frozen_key}")));
    assert_eq!(intents.len(), 1);
    assert_eq!(
        intents[0].kind,
        wallet_workbench_lib::models::SubmissionKind::AbiWriteCall
    );
    assert_eq!(
        intents[0].tx_hash,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    assert_eq!(intents[0].frozen_key.as_deref(), Some(frozen_key.as_str()));
    assert_eq!(intents[0].selector.as_deref(), Some("0x13af4035"));
    assert_eq!(
        intents[0].method_name.as_deref(),
        Some("setMessage(string)")
    );
    let metadata = intents[0]
        .abi_call_metadata
        .as_ref()
        .expect("abi write metadata");
    assert_eq!(metadata.intent_kind, "abiWriteCall");
    assert_eq!(
        metadata.function_signature.as_deref(),
        Some("setMessage(string)")
    );
    assert_eq!(
        metadata
            .future_submission
            .as_ref()
            .and_then(|submission| submission.tx_hash.as_deref()),
        Some("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    );
    assert_eq!(
        metadata
            .broadcast
            .as_ref()
            .and_then(|broadcast| broadcast.tx_hash.as_deref()),
        Some("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    );
    let recovery = metadata.recovery.as_ref().expect("recovery metadata");
    assert_eq!(recovery.status.as_deref(), Some("active"));
    assert!(recovery.recovery_id.is_some());
    assert!(recovery
        .last_error
        .as_deref()
        .is_some_and(|value| { value.contains("directory") || value.contains("Is a directory") }));
    assert!(events
        .iter()
        .any(|event| event.event == "abiWriteCallHistoryWriteAfterBroadcastFailed"));

    for serialized in [&raw_intents, &raw_events, &error] {
        assert!(!serialized.contains("ABI_RPC_SECRET"));
        assert!(!serialized.contains("apiKey="));
        assert!(!serialized.contains("rawCalldata"));
        assert!(!serialized.contains("rawAbi"));
        assert!(!serialized.contains("canonicalParams"));
        assert!(!serialized.contains("0x13af4035ffffffff"));
        assert!(!serialized.contains("\"type\":\"function\""));
    }
}

#[tokio::test(flavor = "current_thread")]
async fn abi_write_broadcast_failure_diagnostics_redact_payloads_and_secrets() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("abi-write-broadcast-failure-redaction");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let rpc_url = start_abi_broadcast_failure_rpc_server();
    let intent = abi_write_call_intent(format!("{rpc_url}/?apiKey=ABI_RPC_SECRET"));

    let error = submit_abi_write_call(
        intent,
        abi_write_call_calldata(),
        abi_write_call_metadata(),
        "abi-draft-frozen-key".to_string(),
    )
    .await
    .expect_err("broadcast failure should be returned");
    let events = read_diagnostic_events_from_path(&diagnostics_path().expect("diagnostics path"))
        .expect("read diagnostics");
    let raw_events = serde_json::to_string(&events).expect("serialize diagnostics");

    assert!(events
        .iter()
        .any(|event| event.event == "abiWriteCallBroadcastFailed"));
    for serialized in [&raw_events, &error] {
        assert!(!serialized.contains("SEND_SECRET"));
        assert!(!serialized.contains("ABI_RPC_SECRET"));
        assert!(!serialized.contains("0x13af4035ffffffff"));
        assert!(!serialized.contains("0xabc"));
        assert!(!serialized.contains("signed-secret"));
        assert!(!serialized.contains("\"type\":\"function\""));
        assert!(!serialized.contains("[\"SEND_SECRET\"]"));
    }
}

#[test]
fn erc20_transfer_calldata_uses_standard_selector_recipient_and_amount() {
    let recipient: Address = "0x2222222222222222222222222222222222222222"
        .parse()
        .expect("recipient address");
    let calldata = build_erc20_transfer_calldata(recipient, U256::from(1_500_000u64));
    let encoded = calldata
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();

    assert_eq!(&encoded[..8], "a9059cbb");
    assert_eq!(
        &encoded[8..72],
        "0000000000000000000000002222222222222222222222222222222222222222"
    );
    assert_eq!(
        &encoded[72..],
        "000000000000000000000000000000000000000000000000000000000016e360"
    );
}

#[test]
fn disperse_ether_calldata_uses_fixed_selector_and_abi_arrays() {
    let recipients = vec![
        "0x1111111111111111111111111111111111111111"
            .parse::<Address>()
            .expect("recipient 1"),
        "0x2222222222222222222222222222222222222222"
            .parse::<Address>()
            .expect("recipient 2"),
    ];
    let values = vec![U256::from(1000u64), U256::from(2000u64)];
    let calldata = build_disperse_ether_calldata(&recipients, &values).expect("calldata");
    let bytes = calldata.as_ref();

    assert_eq!(&bytes[..4], &[0xe6, 0x3d, 0x38, 0xed]);
    assert_eq!(
        &bytes[4..],
        encode(&[
            Token::Array(recipients.into_iter().map(Token::Address).collect()),
            Token::Array(values.into_iter().map(Token::Uint).collect()),
        ])
        .as_slice()
    );
}

#[test]
fn disperse_token_calldata_uses_fixed_selector_token_and_abi_arrays() {
    let token: Address = "0x5555555555555555555555555555555555555555"
        .parse()
        .expect("token");
    let recipients = vec![
        "0x1111111111111111111111111111111111111111"
            .parse::<Address>()
            .expect("recipient 1"),
        "0x2222222222222222222222222222222222222222"
            .parse::<Address>()
            .expect("recipient 2"),
    ];
    let values = vec![U256::from(1000u64), U256::from(2000u64)];
    let calldata = build_disperse_token_calldata(token, &recipients, &values).expect("calldata");
    let bytes = calldata.as_ref();

    assert_eq!(&bytes[..4], &[0xc7, 0x3a, 0x2d, 0x60]);
    assert_eq!(
        &bytes[4..],
        encode(&[
            Token::Address(token),
            Token::Array(recipients.into_iter().map(Token::Address).collect()),
            Token::Array(values.into_iter().map(Token::Uint).collect()),
        ])
    );
}

#[test]
fn erc20_allowance_calldata_uses_owner_and_spender() {
    let owner: Address = "0x1111111111111111111111111111111111111111"
        .parse()
        .expect("owner");
    let spender: Address = "0x2222222222222222222222222222222222222222"
        .parse()
        .expect("spender");
    let calldata = build_erc20_allowance_calldata(owner, spender);
    let encoded = calldata
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();

    assert_eq!(&encoded[..8], "dd62ed3e");
    assert_eq!(
        &encoded[8..72],
        "0000000000000000000000001111111111111111111111111111111111111111"
    );
    assert_eq!(
        &encoded[72..],
        "0000000000000000000000002222222222222222222222222222222222222222"
    );
}

#[test]
fn erc20_distribution_parent_validation_rejects_non_fixed_contract() {
    let input = erc20_distribution_batch_input("http://127.0.0.1:8545".to_string());
    let mut parent = input
        .distribution_parent
        .clone()
        .expect("distribution parent");
    parent.contract_address = "0x0000000000000000000000000000000000000001".to_string();

    let error = wallet_workbench_lib::commands::transactions::validate_erc20_distribution_parent(
        &input, &parent,
    )
    .expect_err("fixed contract validation should fail");

    assert!(error.contains("fixed Disperse contract"));
}

#[test]
fn erc20_distribution_parent_validation_rejects_duplicate_target_address() {
    let input = erc20_distribution_batch_input("http://127.0.0.1:8545".to_string());
    let mut parent = input
        .distribution_parent
        .clone()
        .expect("distribution parent");
    parent.total_amount_raw = "3000000".to_string();
    let mut duplicate = parent.recipients[0].clone();
    duplicate.child_id = "erc20-batch-test:child-0002".to_string();
    duplicate.child_index = 1;
    duplicate.target_kind = "localAccount".to_string();
    parent.recipients.push(duplicate);

    let error = wallet_workbench_lib::commands::transactions::validate_erc20_distribution_parent(
        &input, &parent,
    )
    .expect_err("duplicate recipient address should fail");

    assert!(error.contains("targetAddress values must be unique"));
}

#[tokio::test(flavor = "current_thread")]
async fn submit_erc20_distribution_rejects_insufficient_allowance_before_broadcast() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("erc20-batch-allowance-insufficient");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let (rpc_url, requests) = start_erc20_batch_distribution_rpc_server(
        U256::from_dec_str("1000000000000000000").expect("native balance"),
        U256::from(2_000_000u64),
        U256::from(1_000_000u64),
    );
    let input = erc20_distribution_batch_input(rpc_url);

    let result = wallet_workbench_lib::commands::transactions::submit_erc20_batch_command(input)
        .await
        .expect("batch result should report parent error");
    let joined_requests = requests.lock().expect("requests lock").join("\n");

    assert!(result.contains("allowance insufficient"));
    assert!(!joined_requests.contains("eth_sendRawTransaction"));
}

#[test]
fn erc20_collection_validation_rejects_target_mismatch_before_submit() {
    let mut input = erc20_collection_batch_input();
    input.children[0].target_address =
        Some("0x9999999999999999999999999999999999999999".to_string());

    let error =
        wallet_workbench_lib::commands::transactions::validate_erc20_collection_children(&input)
            .expect_err("target mismatch should fail");

    assert!(error.contains("targetAddress must match intent.recipient"));
}

#[test]
fn erc20_collection_validation_requires_one_contiguous_target() {
    let mut input = erc20_collection_batch_input();
    let mut second = input.children[0].clone();
    second.child_id = "erc20-collect-test:child-0002".to_string();
    second.child_index = 2;
    second.target_address = Some("0x8888888888888888888888888888888888888888".to_string());
    second.intent.recipient = "0x8888888888888888888888888888888888888888".to_string();
    input.children.push(second);

    let error =
        wallet_workbench_lib::commands::transactions::validate_erc20_collection_children(&input)
            .expect_err("non-contiguous child index should fail first");

    assert!(error.contains("contiguous"));

    input.children[1].child_index = 1;
    let error =
        wallet_workbench_lib::commands::transactions::validate_erc20_collection_children(&input)
            .expect_err("multiple targets should fail");
    assert!(error.contains("share exactly one target"));
}

fn native_distribution_submit_input(
    contract: &str,
) -> wallet_workbench_lib::models::NativeBatchSubmitInput {
    let mut intent = native_transfer_intent(7, "3000");
    intent.typed_transaction = wallet_workbench_lib::models::TypedTransactionFields::contract_call(
        "0xe63d38ed",
        "disperseEther(address[],uint256[])",
        "3000",
    );
    intent.to = contract.to_string();
    intent.value_wei = "3000".to_string();
    intent.gas_limit = "120000".to_string();

    wallet_workbench_lib::models::NativeBatchSubmitInput {
        batch_id: "batch-disperse".into(),
        batch_kind: "distribute".into(),
        asset_kind: "native".into(),
        chain_id: 1,
        freeze_key: "0xfrozen".into(),
        distribution_parent: Some(
            wallet_workbench_lib::models::NativeBatchDistributionParent {
                contract_address: contract.into(),
                selector: "0xe63d38ed".into(),
                method_name: "disperseEther(address[],uint256[])".into(),
                recipients: vec![
                    wallet_workbench_lib::models::NativeBatchDistributionRecipient {
                        child_id: "batch-disperse:child-0001".into(),
                        child_index: 0,
                        target_kind: "localAccount".into(),
                        target_address: "0x2222222222222222222222222222222222222222".into(),
                        value_wei: "1000".into(),
                    },
                    wallet_workbench_lib::models::NativeBatchDistributionRecipient {
                        child_id: "batch-disperse:child-0002".into(),
                        child_index: 1,
                        target_kind: "externalAddress".into(),
                        target_address: "0x3333333333333333333333333333333333333333".into(),
                        value_wei: "2000".into(),
                    },
                ],
                total_value_wei: "3000".into(),
                intent,
            },
        ),
        children: Vec::new(),
    }
}

#[tokio::test(flavor = "current_thread")]
async fn native_distribution_submit_rejects_non_fixed_contract_before_broadcast() {
    let input = native_distribution_submit_input("0x0000000000000000000000000000000000000001");

    let error = wallet_workbench_lib::commands::transactions::submit_native_batch_command(input)
        .await
        .expect_err("non-fixed distribution contract should be rejected");

    assert!(error.contains("fixed Disperse contract"));
    assert!(error.contains("0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3"));
}

fn assert_distribution_validation_error(
    input: wallet_workbench_lib::models::NativeBatchSubmitInput,
    expected: &str,
) {
    let parent = input
        .distribution_parent
        .as_ref()
        .expect("distribution parent");
    let error = wallet_workbench_lib::commands::transactions::validate_native_distribution_parent(
        &input, parent,
    )
    .expect_err("malformed distribution should be rejected");
    assert!(
        error.contains(expected),
        "expected error containing {expected:?}, got {error:?}"
    );
}

#[test]
fn native_distribution_validation_rejects_empty_and_zero_recipient_sets() {
    let fixed = "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3";

    let mut empty = native_distribution_submit_input(fixed);
    empty
        .distribution_parent
        .as_mut()
        .expect("distribution parent")
        .recipients = Vec::new();
    assert_distribution_validation_error(empty, "at least one recipient");

    let mut zero_total = native_distribution_submit_input(fixed);
    {
        let parent = zero_total
            .distribution_parent
            .as_mut()
            .expect("distribution parent");
        parent.total_value_wei = "0".into();
        parent.intent.value_wei = "0".into();
        parent.intent.typed_transaction.native_value_wei = Some("0".into());
    }
    assert_distribution_validation_error(zero_total, "totalValueWei must be greater than zero");

    let mut zero_recipient = native_distribution_submit_input(fixed);
    zero_recipient
        .distribution_parent
        .as_mut()
        .expect("distribution parent")
        .recipients[0]
        .value_wei = "0".into();
    assert_distribution_validation_error(zero_recipient, "valueWei must be greater than zero");
}

#[test]
fn native_distribution_validation_rejects_overflowing_recipient_values() {
    let fixed = "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3";
    let max_u256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    let mut overflow = native_distribution_submit_input(fixed);
    {
        let parent = overflow
            .distribution_parent
            .as_mut()
            .expect("distribution parent");
        parent.total_value_wei = max_u256.into();
        parent.intent.value_wei = max_u256.into();
        parent.intent.typed_transaction.native_value_wei = Some(max_u256.into());
        parent.recipients[0].value_wei = max_u256.into();
        parent.recipients[1].value_wei = "1".into();
    }

    assert_distribution_validation_error(overflow, "recipient values overflow totalValueWei");
}

#[test]
fn native_distribution_validation_rejects_malformed_child_allocations() {
    let fixed = "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3";

    let mut empty_child_id = native_distribution_submit_input(fixed);
    empty_child_id
        .distribution_parent
        .as_mut()
        .expect("distribution parent")
        .recipients[0]
        .child_id = " ".into();
    assert_distribution_validation_error(empty_child_id, "childId must not be empty");

    let mut duplicate_child_id = native_distribution_submit_input(fixed);
    {
        let recipients = &mut duplicate_child_id
            .distribution_parent
            .as_mut()
            .expect("distribution parent")
            .recipients;
        recipients[1].child_id = recipients[0].child_id.clone();
    }
    assert_distribution_validation_error(duplicate_child_id, "childId values must be unique");

    let mut duplicate_child_index = native_distribution_submit_input(fixed);
    duplicate_child_index
        .distribution_parent
        .as_mut()
        .expect("distribution parent")
        .recipients[1]
        .child_index = 0;
    assert_distribution_validation_error(duplicate_child_index, "childIndex values must be unique");

    let mut non_contiguous_child_index = native_distribution_submit_input(fixed);
    non_contiguous_child_index
        .distribution_parent
        .as_mut()
        .expect("distribution parent")
        .recipients[1]
        .child_index = 2;
    assert_distribution_validation_error(
        non_contiguous_child_index,
        "contiguous from zero and match recipient order",
    );
}

#[test]
fn native_distribution_validation_rejects_noncanonical_typed_metadata() {
    let fixed = "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3";

    let mut wrong_selector = native_distribution_submit_input(fixed);
    wrong_selector
        .distribution_parent
        .as_mut()
        .expect("distribution parent")
        .intent
        .typed_transaction
        .selector = Some("0xdeadbeef".into());
    assert_distribution_validation_error(wrong_selector, "typed selector");

    let mut wrong_method = native_distribution_submit_input(fixed);
    wrong_method
        .distribution_parent
        .as_mut()
        .expect("distribution parent")
        .intent
        .typed_transaction
        .method_name = Some("disperseToken(address[],uint256[])".into());
    assert_distribution_validation_error(wrong_method, "typed method_name");

    let mut wrong_native_value = native_distribution_submit_input(fixed);
    wrong_native_value
        .distribution_parent
        .as_mut()
        .expect("distribution parent")
        .intent
        .typed_transaction
        .native_value_wei = Some("2999".into());
    assert_distribution_validation_error(wrong_native_value, "typed native_value_wei");

    let mut wrong_type = native_distribution_submit_input(fixed);
    wrong_type
        .distribution_parent
        .as_mut()
        .expect("distribution parent")
        .intent
        .typed_transaction =
        wallet_workbench_lib::models::TypedTransactionFields::native_transfer("3000");
    assert_distribution_validation_error(wrong_type, "transaction_type contractCall");
}

#[test]
fn recovery_intent_preserves_distribution_batch_metadata_additively() {
    let metadata = serde_json::json!({
        "batchId": "batch-disperse",
        "childId": "batch-disperse:parent",
        "batchKind": "distribute",
        "assetKind": "native",
        "freezeKey": "0xfrozen",
        "childCount": 2,
        "contractAddress": "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3",
        "selector": "0xe63d38ed",
        "methodName": "disperseEther(address[],uint256[])",
        "totalValueWei": "3000",
        "recipients": [
            {
                "childId": "batch-disperse:child-0001",
                "childIndex": 0,
                "targetKind": "localAccount",
                "targetAddress": "0x2222222222222222222222222222222222222222",
                "valueWei": "1000"
            },
            {
                "childId": "batch-disperse:child-0002",
                "childIndex": 1,
                "targetKind": "externalAddress",
                "targetAddress": "0x3333333333333333333333333333333333333333",
                "valueWei": "2000"
            }
        ]
    });
    let intent: wallet_workbench_lib::models::HistoryRecoveryIntent =
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "id": "recovery-1",
            "status": "active",
            "createdAt": "1700000000",
            "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "kind": "nativeTransfer",
            "chainId": 1,
            "accountIndex": 1,
            "from": "0x1111111111111111111111111111111111111111",
            "nonce": 7,
            "to": "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3",
            "valueWei": "3000",
            "selector": "0xe63d38ed",
            "methodName": "disperseEther(address[],uint256[])",
            "nativeValueWei": "3000",
            "frozenKey": "contract-frozen",
            "gasLimit": "120000",
            "maxFeePerGas": "40000000000",
            "maxPriorityFeePerGas": "1500000000",
            "batchMetadata": metadata,
            "broadcastedAt": "1700000001",
            "writeError": "history write failed"
        }))
        .expect("recovery intent with batch metadata");

    let batch = intent.batch_metadata.expect("batch metadata");
    assert_eq!(batch.freeze_key.as_deref(), Some("0xfrozen"));
    assert_eq!(
        batch.contract_address.as_deref(),
        Some("0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3")
    );
    assert_eq!(batch.recipients.len(), 2);
    assert_eq!(batch.recipients[0].target_kind, "localAccount");
    assert_eq!(batch.recipients[1].target_kind, "externalAddress");
    assert_eq!(batch.recipients[1].value_wei, "2000");
}

#[tokio::test(flavor = "current_thread")]
async fn submit_erc20_transfer_writes_typed_pending_history() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("erc20-submit-history");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let (rpc_url, requests) = start_erc20_submit_rpc_server(
        U256::from_dec_str("1000000000000000000").expect("native balance"),
        U256::from(2_000_000u64),
        None,
    );
    let mut intent = erc20_transfer_intent();
    intent.rpc_url = format!("{rpc_url}/v1?apiKey=super-secret");

    let record = wallet_workbench_lib::transactions::submit_erc20_transfer(intent)
        .await
        .expect("submit erc20");
    let joined_requests = requests.lock().expect("requests lock").join("\n");
    let raw_history = fs::read_to_string(history_path().expect("history path"))
        .expect("read erc20 success history");

    assert!(joined_requests.contains("eth_sendRawTransaction"));
    assert_eq!(record.intent.rpc_url, rpc_url);
    assert!(!raw_history.contains("super-secret"));
    assert!(!raw_history.contains("apiKey"));
    assert!(!raw_history.contains("/v1"));
    assert_eq!(
        record.submission.kind,
        wallet_workbench_lib::models::SubmissionKind::Erc20Transfer
    );
    assert_eq!(
        record.submission.typed_transaction.transaction_type,
        wallet_workbench_lib::models::TransactionType::Erc20Transfer
    );
    assert_eq!(
        record.submission.to.as_deref(),
        Some("0x3333333333333333333333333333333333333333")
    );
    assert_eq!(
        record
            .submission
            .typed_transaction
            .token_contract
            .as_deref(),
        Some("0x3333333333333333333333333333333333333333")
    );
    assert_eq!(
        record.submission.typed_transaction.recipient.as_deref(),
        Some("0x2222222222222222222222222222222222222222")
    );
    assert_eq!(
        record.submission.typed_transaction.amount_raw.as_deref(),
        Some("1500000")
    );
    assert_eq!(record.submission.typed_transaction.decimals, Some(6));
    assert_eq!(
        record.submission.typed_transaction.selector.as_deref(),
        Some("0xa9059cbb")
    );
    assert_eq!(record.submission.value_wei.as_deref(), Some("0"));
    assert_eq!(record.outcome.state, ChainOutcomeState::Pending);
}

#[tokio::test(flavor = "current_thread")]
async fn submit_erc20_transfer_rejects_insufficient_token_balance_before_broadcast() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("erc20-token-insufficient");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let (rpc_url, requests) = start_erc20_submit_rpc_server(
        U256::from_dec_str("1000000000000000000").expect("native balance"),
        U256::from(1_000_000u64),
        None,
    );
    let mut intent = erc20_transfer_intent();
    intent.rpc_url = rpc_url;

    let error = wallet_workbench_lib::transactions::submit_erc20_transfer(intent)
        .await
        .expect_err("token balance should fail");
    let joined_requests = requests.lock().expect("requests lock").join("\n");

    assert!(error.contains("token balance insufficient"));
    assert!(!joined_requests.contains("eth_sendRawTransaction"));
}

#[tokio::test(flavor = "current_thread")]
async fn submit_erc20_transfer_rejects_malformed_token_balance_response_before_broadcast() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("erc20-token-balance-malformed");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let long_uint256_response = format!("\"0x{}\"", "11".repeat(33));
    let (rpc_url, requests) = start_erc20_submit_rpc_server_with_call_result(
        U256::from_dec_str("1000000000000000000").expect("native balance"),
        long_uint256_response,
        None,
    );
    let mut intent = erc20_transfer_intent();
    intent.rpc_url = rpc_url;

    let error = wallet_workbench_lib::transactions::submit_erc20_transfer(intent)
        .await
        .expect_err("malformed balanceOf response should fail");
    let joined_requests = requests.lock().expect("requests lock").join("\n");

    assert!(error.contains("balanceOf returned 33 bytes"));
    assert!(error.contains("expected 32-byte uint256"));
    assert!(!joined_requests.contains("eth_sendRawTransaction"));
}

#[tokio::test(flavor = "current_thread")]
async fn submit_erc20_transfer_rejects_insufficient_native_gas_before_broadcast() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("erc20-native-gas-insufficient");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let (rpc_url, requests) =
        start_erc20_submit_rpc_server(U256::from(1u64), U256::from(2_000_000u64), None);
    let mut intent = erc20_transfer_intent();
    intent.rpc_url = rpc_url;

    let error = wallet_workbench_lib::transactions::submit_erc20_transfer(intent)
        .await
        .expect_err("native gas should fail");
    let joined_requests = requests.lock().expect("requests lock").join("\n");

    assert!(error.contains("native gas balance insufficient"));
    assert!(!joined_requests.contains("eth_sendRawTransaction"));
}

#[tokio::test(flavor = "current_thread")]
async fn erc20_history_write_failure_recovery_keeps_frozen_params_without_rpc_secret() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("erc20-history-write-recovery");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let path = history_path().expect("history path");
    let (rpc_url, _requests) = start_erc20_submit_rpc_server(
        U256::from_dec_str("1000000000000000000").expect("native balance"),
        U256::from(2_000_000u64),
        Some(path),
    );
    let mut intent = erc20_transfer_intent();
    intent.rpc_url = format!("{rpc_url}/?apiKey=super-secret");

    let error = wallet_workbench_lib::transactions::submit_erc20_transfer(intent)
        .await
        .expect_err("history write should fail after broadcast");
    let intents = load_history_recovery_intents().expect("load recovery intents");
    let raw_intents = serde_json::to_string(&intents).expect("serialize recovery intents");

    assert!(error.contains("transaction broadcast"));
    assert!(error.contains("tokenContract=0x3333333333333333333333333333333333333333"));
    assert!(error.contains("recipient=0x2222222222222222222222222222222222222222"));
    assert!(error.contains("amountRaw=1500000"));
    assert!(error.contains("frozenKey=chainId=1"));
    assert_eq!(intents.len(), 1);
    assert_eq!(
        intents[0].tx_hash,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    assert_eq!(
        intents[0].kind,
        wallet_workbench_lib::models::SubmissionKind::Erc20Transfer
    );
    assert_eq!(
        intents[0].token_contract.as_deref(),
        Some("0x3333333333333333333333333333333333333333")
    );
    assert_eq!(
        intents[0].recipient.as_deref(),
        Some("0x2222222222222222222222222222222222222222")
    );
    assert_eq!(intents[0].amount_raw.as_deref(), Some("1500000"));
    assert_eq!(intents[0].decimals, Some(6));
    assert_eq!(intents[0].selector.as_deref(), Some("0xa9059cbb"));
    assert_eq!(
        intents[0].method_name.as_deref(),
        Some("transfer(address,uint256)")
    );
    assert!(intents[0].frozen_key.as_deref().is_some_and(|key| {
        key.contains("chainId=1")
            && key.contains("tokenContract=0x3333333333333333333333333333333333333333")
            && key.contains("amountRaw=1500000")
            && key.contains("method=transfer(address,uint256)")
    }));
    assert!(!raw_intents.contains("rpc_url"));
    assert!(!raw_intents.contains("super-secret"));
}

#[test]
fn erc20_replacement_requires_a_fee_increase() {
    with_test_app_dir("erc20-replace-fee-increase", |_| {
        let submit_intent = erc20_transfer_intent();
        let history_intent = erc20_history_intent_from_submit(&submit_intent);
        persist_pending_history_with_kind(
            history_intent,
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
            wallet_workbench_lib::models::SubmissionKind::Erc20Transfer,
            None,
        )
        .expect("persist erc20 pending");

        let same_fee = wallet_workbench_lib::commands::transactions::PendingMutationRequest {
            tx_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
            rpc_url: "http://127.0.0.1:8545".into(),
            account_index: submit_intent.account_index,
            chain_id: submit_intent.chain_id,
            from: submit_intent.from.clone(),
            nonce: submit_intent.nonce,
            gas_limit: submit_intent.gas_limit.clone(),
            max_fee_per_gas: submit_intent.max_fee_per_gas.clone(),
            max_priority_fee_per_gas: submit_intent.max_priority_fee_per_gas.clone(),
            to: Some(submit_intent.token_contract.clone()),
            value_wei: Some("0".into()),
        };
        let error =
            wallet_workbench_lib::commands::transactions::build_replace_intent_from_pending_request(
                same_fee.clone(),
            )
            .expect_err("same-fee ERC-20 replace must fail");
        assert!(error.contains("must increase max_fee_per_gas or max_priority_fee_per_gas"));

        let mut bumped = same_fee;
        bumped.max_fee_per_gas = "40000000001".into();
        let intent =
            wallet_workbench_lib::commands::transactions::build_replace_intent_from_pending_request(
                bumped,
            )
            .expect("bumped ERC-20 replace intent");
        assert_eq!(
            intent.typed_transaction.transaction_type,
            wallet_workbench_lib::models::TransactionType::Erc20Transfer
        );
        assert_eq!(
            intent.typed_transaction.recipient.as_deref(),
            Some(submit_intent.recipient.as_str())
        );
        assert_eq!(
            intent.typed_transaction.amount_raw.as_deref(),
            Some(submit_intent.amount_raw.as_str())
        );
    });
}

#[tokio::test(flavor = "current_thread")]
async fn erc20_replacement_history_write_failure_returns_frozen_params_and_records_recovery() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("erc20-replace-history-write-recovery");
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );
    let submit_intent = erc20_transfer_intent();
    let history_intent = erc20_history_intent_from_submit(&submit_intent);
    let original_hash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    persist_pending_history_with_kind(
        history_intent,
        original_hash.into(),
        wallet_workbench_lib::models::SubmissionKind::Erc20Transfer,
        None,
    )
    .expect("persist erc20 pending");
    let path = history_path().expect("history path");
    let (rpc_url, _requests) = start_erc20_submit_rpc_server(
        U256::from_dec_str("1000000000000000000").expect("native balance"),
        U256::from(2_000_000u64),
        Some(path),
    );

    let request = wallet_workbench_lib::commands::transactions::PendingMutationRequest {
        tx_hash: original_hash.into(),
        rpc_url,
        account_index: submit_intent.account_index,
        chain_id: submit_intent.chain_id,
        from: submit_intent.from.clone(),
        nonce: submit_intent.nonce,
        gas_limit: submit_intent.gas_limit.clone(),
        max_fee_per_gas: "40000000001".into(),
        max_priority_fee_per_gas: submit_intent.max_priority_fee_per_gas.clone(),
        to: Some(submit_intent.token_contract.clone()),
        value_wei: Some("0".into()),
    };
    let error = wallet_workbench_lib::commands::transactions::replace_pending_transfer(request)
        .await
        .expect_err("history write should fail after replacement broadcast");
    let intents = load_history_recovery_intents().expect("load recovery intents");

    assert!(error
        .contains("tx_hash=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    assert!(error.contains("chainId=1"));
    assert!(error.contains("accountIndex=1"));
    assert!(error.contains("from=0x70997970C51812dc3A010C7d01b50e0d17dc79C8"));
    assert!(error.contains("nonce=0"));
    assert!(error.contains("tokenContract=0x3333333333333333333333333333333333333333"));
    assert!(error.contains("recipient=0x2222222222222222222222222222222222222222"));
    assert!(error.contains("amountRaw=1500000"));
    assert!(error.contains("decimals=6"));
    assert!(error.contains("selector=0xa9059cbb"));
    assert!(error.contains("method=transfer(address,uint256)"));
    assert!(error.contains("frozenKey=1:0x70997970C51812dc3A010C7d01b50e0d17dc79C8"));
    assert_eq!(intents.len(), 1);
    assert_eq!(
        intents[0].kind,
        wallet_workbench_lib::models::SubmissionKind::Replacement
    );
    assert_eq!(intents[0].replaces_tx_hash.as_deref(), Some(original_hash));
    assert_eq!(
        intents[0].token_contract.as_deref(),
        Some("0x3333333333333333333333333333333333333333")
    );
    assert_eq!(
        intents[0].recipient.as_deref(),
        Some("0x2222222222222222222222222222222222222222")
    );
    assert_eq!(intents[0].amount_raw.as_deref(), Some("1500000"));
    assert_eq!(intents[0].decimals, Some(6));
    assert_eq!(intents[0].selector.as_deref(), Some("0xa9059cbb"));
    assert_eq!(
        intents[0].method_name.as_deref(),
        Some("transfer(address,uint256)")
    );
    assert!(intents[0].frozen_key.as_deref().is_some_and(|key| {
        key.contains("0x3333333333333333333333333333333333333333")
            && key.contains("0x2222222222222222222222222222222222222222")
            && key.contains("1500000")
    }));
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
async fn recovery_reconstructs_abi_write_call_history_record() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("broadcast-history-recover-abi-write");
    let path = wallet_workbench_lib::storage::history_recovery_intents_path()
        .expect("recovery intents path");
    fs::write(
        path,
        serde_json::to_string_pretty(&serde_json::json!([
            {
                "schemaVersion": 1,
                "id": "abi-recovery",
                "status": "active",
                "createdAt": "1700000000",
                "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "kind": "abiWriteCall",
                "chainId": 1,
                "accountIndex": 3,
                "from": "0x1111111111111111111111111111111111111111",
                "nonce": 9,
                "to": "0x2222222222222222222222222222222222222222",
                "valueWei": "42",
                "selector": "0x12345678",
                "methodName": "setValue(uint256)",
                "nativeValueWei": "42",
                "frozenKey": "abi-draft-frozen-key",
                "gasLimit": "100000",
                "maxFeePerGas": "2000000000",
                "maxPriorityFeePerGas": "1000000000",
                "abiCallMetadata": {
                    "intentKind": "abiWriteCall",
                    "draftId": "draft-abi-1",
                    "createdAt": "1700000000",
                    "chainId": 1,
                    "accountIndex": 3,
                    "from": "0x1111111111111111111111111111111111111111",
                    "contractAddress": "0x2222222222222222222222222222222222222222",
                    "sourceKind": "explorerFetched",
                    "versionId": "v1",
                    "abiHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "sourceFingerprint": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    "functionSignature": "setValue(uint256)",
                    "selector": "0x12345678",
                    "argumentHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                    "nativeValueWei": "42",
                    "gasLimit": "100000",
                    "maxFeePerGas": "2000000000",
                    "maxPriorityFeePerGas": "1000000000",
                    "nonce": 9,
                    "calldata": {
                        "selector": "0x12345678",
                        "byteLength": 36,
                        "hash": "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
                    },
                    "futureSubmission": {
                        "status": "broadcasted",
                        "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "broadcastedAt": "1700000001"
                    },
                    "futureOutcome": {
                        "state": "Pending",
                        "checkedAt": null
                    },
                    "broadcast": {
                        "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "broadcastedAt": "1700000001",
                        "rpcChainId": 1,
                        "rpcEndpointSummary": "https://rpc.example.invalid"
                    },
                    "recovery": {
                        "recoveryId": "abi-recovery",
                        "status": "active",
                        "createdAt": "1700000000"
                    }
                },
                "broadcastedAt": "1700000001",
                "writeError": "schema placeholder"
            }
        ]))
        .expect("serialize recovery intent"),
    )
    .expect("write recovery intent");

    let result = recover_broadcasted_history_record(
        "abi-recovery".into(),
        start_recovery_rpc_server(
            Box::leak(
                receipt_json(
                    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    1,
                )
                .into_boxed_str(),
            ),
            "null",
        ),
        1,
    )
    .await
    .expect("ABI write recovery should reconstruct history");

    assert_eq!(
        result.record.submission.kind,
        wallet_workbench_lib::models::SubmissionKind::AbiWriteCall
    );
    assert_eq!(
        result.record.intent.typed_transaction.transaction_type,
        wallet_workbench_lib::models::TransactionType::ContractCall
    );
    assert_eq!(result.record.submission.frozen_key, "abi-draft-frozen-key");
    assert_eq!(
        result
            .record
            .abi_call_metadata
            .as_ref()
            .and_then(|metadata| metadata.broadcast.as_ref())
            .and_then(|broadcast| broadcast.tx_hash.clone()),
        Some("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string())
    );
    let abi_metadata = result
        .record
        .abi_call_metadata
        .as_ref()
        .expect("ABI metadata");
    let future_outcome = abi_metadata
        .future_outcome
        .as_ref()
        .expect("future outcome");
    assert_eq!(
        future_outcome.state,
        Some(wallet_workbench_lib::models::AbiCallOutcomeState::Confirmed)
    );
    assert!(future_outcome.checked_at.is_some());
    assert_eq!(future_outcome.receipt_status, Some(1));
    assert_eq!(future_outcome.block_number, Some(1));
    assert_eq!(future_outcome.gas_used.as_deref(), Some("21000"));
    let recovery = abi_metadata.recovery.as_ref().expect("recovery metadata");
    assert_eq!(recovery.status.as_deref(), Some("recovered"));
    assert!(recovery.recovered_at.is_some());
    assert!(recovery.last_error.is_none());
    let raw_history = serde_json::to_string(&result.history).expect("serialize history");
    assert!(!raw_history.contains("canonicalParams"));
    assert!(!raw_history.contains("apiKey"));
}

#[tokio::test(flavor = "current_thread")]
async fn recovery_reconstructs_raw_calldata_history_record_without_type_fallback() {
    let _guard = test_lock().lock().expect("test lock");
    let _app_dir_guard = TestAppDirGuard::new("broadcast-history-recover-raw-calldata");
    let path = wallet_workbench_lib::storage::history_recovery_intents_path()
        .expect("recovery intents path");
    fs::write(
        path,
        serde_json::to_string_pretty(&serde_json::json!([
            {
                "schemaVersion": 1,
                "id": "raw-recovery-with-selector",
                "status": "active",
                "createdAt": "1700000000",
                "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "kind": "rawCalldata",
                "chainId": 1,
                "accountIndex": 3,
                "from": "0x1111111111111111111111111111111111111111",
                "nonce": 9,
                "to": "0x2222222222222222222222222222222222222222",
                "valueWei": "42",
                "selector": "0x12345678",
                "nativeValueWei": "42",
                "frozenKey": "raw-draft-frozen-key",
                "gasLimit": "100000",
                "maxFeePerGas": "2000000000",
                "maxPriorityFeePerGas": "1000000000",
                "rawCalldataMetadata": {
                    "intentKind": "rawCalldata",
                    "chainId": 1,
                    "accountIndex": 3,
                    "from": "0x1111111111111111111111111111111111111111",
                    "to": "0x2222222222222222222222222222222222222222",
                    "valueWei": "42",
                    "nonce": 9,
                    "calldataHashVersion": "keccak256-v1",
                    "calldataHash": "0xhash",
                    "calldataByteLength": 36,
                    "selector": "0x12345678",
                    "selectorStatus": "unknown",
                    "preview": { "truncated": false, "display": "0x12345678" },
                    "futureSubmission": {
                        "status": "broadcasted",
                        "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "broadcastedAt": "1700000001"
                    },
                    "broadcast": {
                        "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "broadcastedAt": "1700000001",
                        "rpcChainId": 1,
                        "rpcEndpointSummary": "https://rpc.example.invalid"
                    },
                    "recovery": {
                        "recoveryId": "raw-recovery-with-selector",
                        "status": "active",
                        "createdAt": "1700000000",
                        "lastError": "stale raw recovery error privateKey=0xabc"
                    }
                },
                "broadcastedAt": "1700000001",
                "writeError": "schema placeholder"
            },
            {
                "schemaVersion": 1,
                "id": "raw-recovery-without-selector",
                "status": "active",
                "createdAt": "1700000000",
                "txHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "kind": "rawCalldata",
                "chainId": 1,
                "accountIndex": 3,
                "from": "0x1111111111111111111111111111111111111111",
                "nonce": 10,
                "to": "0x2222222222222222222222222222222222222222",
                "valueWei": "0",
                "nativeValueWei": "0",
                "frozenKey": "raw-empty-frozen-key",
                "gasLimit": "100000",
                "maxFeePerGas": "2000000000",
                "maxPriorityFeePerGas": "1000000000",
                "rawCalldataMetadata": {
                    "intentKind": "rawCalldata",
                    "chainId": 1,
                    "accountIndex": 3,
                    "from": "0x1111111111111111111111111111111111111111",
                    "to": "0x2222222222222222222222222222222222222222",
                    "valueWei": "0",
                    "nonce": 10,
                    "calldataHashVersion": "keccak256-v1",
                    "calldataHash": "0xemptyhash",
                    "calldataByteLength": 0,
                    "selectorStatus": "none",
                    "preview": { "truncated": false, "display": "0x" },
                    "recovery": {
                        "recoveryId": "raw-recovery-without-selector",
                        "status": "active",
                        "createdAt": "1700000000",
                        "lastError": "stale raw recovery error privateKey=0xabc"
                    }
                },
                "broadcastedAt": "1700000001",
                "writeError": "schema placeholder"
            }
        ]))
        .expect("serialize recovery intent"),
    )
    .expect("write recovery intent");

    let with_selector = recover_broadcasted_history_record(
        "raw-recovery-with-selector".into(),
        start_recovery_rpc_server(
            Box::leak(
                receipt_json(
                    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    1,
                )
                .into_boxed_str(),
            ),
            "null",
        ),
        1,
    )
    .await
    .expect("raw calldata recovery with selector should reconstruct history");

    let without_selector = recover_broadcasted_history_record(
        "raw-recovery-without-selector".into(),
        start_recovery_rpc_server(
            Box::leak(
                receipt_json(
                    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    1,
                )
                .into_boxed_str(),
            ),
            "null",
        ),
        1,
    )
    .await
    .expect("raw calldata recovery without selector should reconstruct history");

    for record in [&with_selector.record, &without_selector.record] {
        assert_eq!(
            record.submission.kind,
            wallet_workbench_lib::models::SubmissionKind::RawCalldata
        );
        assert_eq!(
            record.intent.typed_transaction.transaction_type,
            wallet_workbench_lib::models::TransactionType::RawCalldata
        );
        assert_eq!(
            record.submission.typed_transaction.transaction_type,
            wallet_workbench_lib::models::TransactionType::RawCalldata
        );
        assert!(record.abi_call_metadata.is_none());
        assert!(record.batch_metadata.is_none());
        assert_eq!(
            record
                .raw_calldata_metadata
                .as_ref()
                .map(|metadata| metadata.intent_kind.as_str()),
            Some("rawCalldata")
        );
        let metadata = record
            .raw_calldata_metadata
            .as_ref()
            .expect("raw calldata metadata");
        let future_outcome = metadata
            .future_outcome
            .as_ref()
            .expect("raw future outcome");
        assert_eq!(
            future_outcome.state,
            Some(wallet_workbench_lib::models::AbiCallOutcomeState::Confirmed)
        );
        assert!(future_outcome.checked_at.is_some());
        assert_eq!(future_outcome.receipt_status, Some(1));
        assert_eq!(future_outcome.block_number, Some(1));
        assert_eq!(future_outcome.gas_used.as_deref(), Some("21000"));
        let recovery = metadata.recovery.as_ref().expect("raw recovery metadata");
        assert_eq!(recovery.status.as_deref(), Some("recovered"));
        assert!(recovery.recovered_at.is_some());
        assert!(recovery.last_error.is_none());
    }
    assert_eq!(
        with_selector
            .record
            .submission
            .typed_transaction
            .selector
            .as_deref(),
        Some("0x12345678")
    );
    assert!(without_selector
        .record
        .submission
        .typed_transaction
        .selector
        .is_none());
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
        assert_eq!(
            records[0].intent.typed_transaction.transaction_type,
            wallet_workbench_lib::models::TransactionType::NativeTransfer
        );
        assert_eq!(
            records[0].submission.typed_transaction.transaction_type,
            wallet_workbench_lib::models::TransactionType::NativeTransfer
        );
        assert_eq!(records[0].submission.broadcasted_at, None);
        assert!(records[0].outcome.receipt.is_none());
        assert_eq!(records[0].outcome.finalized_at, None);
        assert_eq!(records[0].nonce_thread.source, "legacy");
        assert_eq!(records[0].nonce_thread.key, "unknown");
    });
}

#[test]
fn erc20_typed_history_fields_deserialize_additively() {
    let raw = r#"{
      "schema_version": 3,
      "intent": {
        "transaction_type": "erc20Transfer",
        "rpc_url": "http://127.0.0.1:8545",
        "account_index": 1,
        "chain_id": 1,
        "from": "0x1111111111111111111111111111111111111111",
        "to": "0x4444444444444444444444444444444444444444",
        "value_wei": "0",
        "token_contract": "0x4444444444444444444444444444444444444444",
        "recipient": "0x5555555555555555555555555555555555555555",
        "amount_raw": "1234500",
        "decimals": 6,
        "token_symbol": "TST",
        "token_name": "Test Token",
        "token_metadata_source": "userConfirmed",
        "selector": "0xa9059cbb",
        "method_name": "transfer",
        "native_value_wei": "0",
        "nonce": 7,
        "gas_limit": "65000",
        "max_fee_per_gas": "40000000000",
        "max_priority_fee_per_gas": "1500000000"
      },
      "submission": {
        "transaction_type": "erc20Transfer",
        "frozen_key": "erc20-key",
        "tx_hash": "0xerc20",
        "kind": "erc20Transfer",
        "source": "submission",
        "chain_id": 1,
        "account_index": 1,
        "from": "0x1111111111111111111111111111111111111111",
        "to": "0x4444444444444444444444444444444444444444",
        "value_wei": "0",
        "token_contract": "0x4444444444444444444444444444444444444444",
        "recipient": "0x5555555555555555555555555555555555555555",
        "amount_raw": "1234500",
        "decimals": 6,
        "selector": "0xa9059cbb",
        "method_name": "transfer",
        "native_value_wei": "0",
        "nonce": 7,
        "gas_limit": "65000",
        "max_fee_per_gas": "40000000000",
        "max_priority_fee_per_gas": "1500000000"
      },
      "outcome": {
        "state": "Pending",
        "tx_hash": "0xerc20"
      }
    }"#;

    let record: HistoryRecord = serde_json::from_str(raw).expect("typed erc20 history");

    assert_eq!(
        record.intent.typed_transaction.transaction_type,
        wallet_workbench_lib::models::TransactionType::Erc20Transfer
    );
    assert_eq!(
        record.submission.kind,
        wallet_workbench_lib::models::SubmissionKind::Erc20Transfer
    );
    assert_eq!(
        record.intent.typed_transaction.token_contract.as_deref(),
        Some("0x4444444444444444444444444444444444444444")
    );
    assert_eq!(
        record.intent.typed_transaction.recipient.as_deref(),
        Some("0x5555555555555555555555555555555555555555")
    );
    assert_eq!(
        record.submission.typed_transaction.amount_raw.as_deref(),
        Some("1234500")
    );
    assert_eq!(
        record
            .submission
            .typed_transaction
            .native_value_wei
            .as_deref(),
        Some("0")
    );
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
fn pending_mutation_refuses_abi_write_contract_call_records() {
    with_test_app_dir("pending-mutation-abi-write-blocked", |_| {
        let mut record = history_record(9, ChainOutcomeState::Pending, "0xabi");
        record.intent.typed_transaction =
            wallet_workbench_lib::models::TypedTransactionFields::contract_call(
                "0x12345678",
                "doThing(uint256)",
                "0",
            );
        record.submission.typed_transaction =
            wallet_workbench_lib::models::TypedTransactionFields::contract_call(
                "0x12345678",
                "doThing(uint256)",
                "0",
            );
        record.submission.kind = wallet_workbench_lib::models::SubmissionKind::AbiWriteCall;
        record.abi_call_metadata = Some(
            serde_json::from_value(serde_json::json!({
                "intentKind": "abiWriteCall",
                "sourceKind": "provider",
                "functionSignature": "doThing(uint256)",
                "selector": "0x12345678"
            }))
            .expect("abi metadata"),
        );
        fs::write(
            history_path().expect("history path"),
            serde_json::to_string_pretty(&vec![record]).expect("serialize history"),
        )
        .expect("write history");

        let request = wallet_workbench_lib::commands::transactions::PendingMutationRequest {
            tx_hash: "0xabi".into(),
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
            .expect_err("replace must reject ABI contract calls");
        let cancel_error =
            wallet_workbench_lib::commands::transactions::build_cancel_intent_from_pending_request(
                request,
            )
            .expect_err("cancel must reject ABI contract calls");

        assert!(replace_error.contains("contractCall"));
        assert!(cancel_error.contains("contractCall"));
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
        typed_transaction: wallet_workbench_lib::models::TypedTransactionFields::native_transfer(
            "1000000000000000",
        ),
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

#[tokio::test(flavor = "current_thread")]
#[ignore = "requires anvil running on 127.0.0.1:8545"]
async fn submit_erc20_transfer_roundtrip_against_anvil() {
    let _guard = test_lock().lock().expect("test lock");
    let dir = unique_test_dir("erc20-transfer-roundtrip");
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

    let provider = Provider::<Http>::try_from("http://127.0.0.1:8545").expect("anvil provider");
    let deployer = wallet_workbench_lib::accounts::derive_wallet(
        "test test test test test test test test test test test junk",
        0,
    )
    .expect("derive deployer")
    .with_chain_id(31337u64);
    let signer = SignerMiddleware::new(provider.clone(), deployer);
    let holder: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
        .parse()
        .expect("holder");
    let recipient = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    let mut deploy_data = decode_hex_bytes(include_str!("fixtures/test_erc20.bin"));
    deploy_data.extend_from_slice(&encode(&[
        Token::Address(holder),
        Token::Uint(U256::from(2_000_000u64)),
    ]));
    let deploy_receipt = signer
        .send_transaction(
            TransactionRequest::new()
                .data(Bytes::from(deploy_data))
                .gas(U256::from(5_000_000u64)),
            None,
        )
        .await
        .expect("send deploy")
        .await
        .expect("deploy pending")
        .expect("deploy receipt");
    let token_contract = deploy_receipt
        .contract_address
        .expect("deployed token contract");
    let nonce = provider
        .get_transaction_count(holder, None)
        .await
        .expect("holder nonce")
        .as_u64();
    let token_contract_text = format!("{:#x}", token_contract);
    let amount_raw = "1000000";
    let gas_limit = "100000";
    let max_fee_per_gas = "2000000000";
    let max_priority_fee_per_gas = "1500000000";
    let intent = wallet_workbench_lib::models::Erc20TransferIntent {
        rpc_url: "http://127.0.0.1:8545".into(),
        account_index: 1,
        chain_id: 31337,
        from: format!("{:#x}", holder),
        token_contract: token_contract_text.clone(),
        recipient: recipient.into(),
        amount_raw: amount_raw.into(),
        decimals: 6,
        token_symbol: Some("SMK".into()),
        token_name: Some("Smoke Token".into()),
        token_metadata_source: "onChainCall".into(),
        nonce,
        gas_limit: gas_limit.into(),
        max_fee_per_gas: max_fee_per_gas.into(),
        max_priority_fee_per_gas: max_priority_fee_per_gas.into(),
        latest_base_fee_per_gas: Some("1000000000".into()),
        base_fee_per_gas: "1000000000".into(),
        base_fee_multiplier: "2".into(),
        max_fee_override_per_gas: None,
        selector: "0xa9059cbb".into(),
        method: "transfer(address,uint256)".into(),
        native_value_wei: "0".into(),
        frozen_key: erc20_frozen_key(
            31337,
            &format!("{:#x}", holder),
            &token_contract_text,
            recipient,
            amount_raw,
            6,
            nonce,
            gas_limit,
            max_fee_per_gas,
            max_priority_fee_per_gas,
        )
        .replace("latestBaseFee=20000000000", "latestBaseFee=1000000000")
        .replace("baseFee=20000000000", "baseFee=1000000000"),
    };

    let result = wallet_workbench_lib::transactions::submit_erc20_transfer(intent).await;
    let pending_record = result.expect("submit erc20");
    let reconciled = reconcile_pending_history("http://127.0.0.1:8545".into(), 31337).await;

    wallet_workbench_lib::session::clear_session_mnemonic();
    if let Some(value) = previous {
        std::env::set_var(APP_DIR_ENV, value);
    } else {
        std::env::remove_var(APP_DIR_ENV);
    }
    fs::remove_dir_all(&dir).expect("remove temp dir");

    assert_eq!(pending_record.outcome.state, ChainOutcomeState::Pending);
    let records = reconciled.expect("reconcile");
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0].submission.kind,
        wallet_workbench_lib::models::SubmissionKind::Erc20Transfer
    );
    assert_eq!(
        records[0]
            .submission
            .typed_transaction
            .token_contract
            .as_deref(),
        Some(token_contract_text.as_str())
    );
    assert_eq!(
        records[0].submission.typed_transaction.recipient.as_deref(),
        Some(recipient)
    );
    assert_eq!(
        records[0].outcome.state,
        ChainOutcomeState::Confirmed,
        "ERC-20 smoke should reconcile to a terminal receipt"
    );
}
