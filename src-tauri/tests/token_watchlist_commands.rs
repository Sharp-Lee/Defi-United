use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use wallet_workbench_lib::commands::token_watchlist::{
    add_watchlist_token, edit_watchlist_token, load_token_watchlist_state, remove_watchlist_token,
    upsert_erc20_balance_snapshot, upsert_token_metadata_cache, upsert_token_scan_state,
    AddWatchlistTokenInput, BalanceStatus, EditWatchlistTokenInput, MetadataOverrideInput,
    RawMetadataSource, RawMetadataStatus, RemoveWatchlistTokenInput, ResolvedMetadataSource,
    ResolvedMetadataStatus, ResolvedTokenMetadataSnapshot, TokenScanStatus,
    UpsertErc20BalanceSnapshotInput, UpsertTokenMetadataCacheInput, UpsertTokenScanStateInput,
    UserMetadataSource,
};
use wallet_workbench_lib::storage::token_watchlist_path;

const APP_DIR_ENV: &str = "EVM_WALLET_WORKBENCH_APP_DIR";
const USDC: &str = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const DAI: &str = "0x6b175474e89094c44da98b954eedeac495271d0f";
const ACCOUNT: &str = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

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

fn add_usdc() {
    add_watchlist_token(AddWatchlistTokenInput {
        chain_id: 1,
        token_contract: USDC.to_string(),
        label: Some("USDC".to_string()),
        user_notes: None,
        pinned: true,
        hidden: false,
        metadata_override: None,
    })
    .expect("add USDC");
}

fn metadata_cache_input(source: Option<&str>) -> UpsertTokenMetadataCacheInput {
    UpsertTokenMetadataCacheInput {
        chain_id: 1,
        token_contract: USDC.to_string(),
        raw_symbol: Some("USDC".to_string()),
        raw_name: Some("USD Coin".to_string()),
        raw_decimals: Some(6),
        source: source.map(str::to_string),
        status: RawMetadataStatus::Ok,
        last_scanned_at: Some("1700000000".to_string()),
        last_error_summary: None,
        observed_decimals: Some(6),
        previous_decimals: None,
    }
}

fn balance_snapshot_input(
    balance_raw: Option<&str>,
    status: BalanceStatus,
) -> UpsertErc20BalanceSnapshotInput {
    UpsertErc20BalanceSnapshotInput {
        account: ACCOUNT.to_string(),
        chain_id: 1,
        token_contract: USDC.to_string(),
        balance_raw: balance_raw.map(str::to_string),
        balance_status: status,
        metadata_status_ref: None,
        clear_metadata_status_ref: false,
        last_scanned_at: Some("1700000001".to_string()),
        clear_last_scanned_at: false,
        last_error_summary: None,
        clear_last_error_summary: false,
        rpc_identity: None,
        clear_rpc_identity: false,
        rpc_profile_id: None,
        clear_rpc_profile_id: false,
        resolved_metadata: None,
        clear_resolved_metadata: false,
    }
}

#[test]
fn missing_watchlist_file_loads_empty_default() {
    with_test_app_dir("token-watchlist-default", |_| {
        let state = load_token_watchlist_state().expect("load default state");

        assert_eq!(state.schema_version, 1);
        assert!(state.watchlist_tokens.is_empty());
        assert!(state.token_metadata_cache.is_empty());
        assert!(state.token_scan_state.is_empty());
        assert!(state.erc20_balance_snapshots.is_empty());
        assert!(state.resolved_token_metadata.is_empty());
        assert!(!token_watchlist_path().expect("path").exists());
    });
}

#[test]
fn add_token_normalizes_validates_and_dedupes_identity() {
    with_test_app_dir("token-watchlist-add", |_| {
        let state = add_watchlist_token(AddWatchlistTokenInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            label: Some(" USD Coin ".to_string()),
            user_notes: Some(" stable ".to_string()),
            pinned: true,
            hidden: false,
            metadata_override: None,
        })
        .expect("add token");

        assert_eq!(state.watchlist_tokens.len(), 1);
        assert_eq!(state.watchlist_tokens[0].chain_id, 1);
        assert_ne!(state.watchlist_tokens[0].token_contract, USDC);
        assert_eq!(state.watchlist_tokens[0].label.as_deref(), Some("USD Coin"));
        assert_eq!(
            state.watchlist_tokens[0].user_notes.as_deref(),
            Some("stable")
        );

        let duplicate = add_watchlist_token(AddWatchlistTokenInput {
            chain_id: 1,
            token_contract: state.watchlist_tokens[0].token_contract.to_lowercase(),
            label: None,
            user_notes: None,
            pinned: false,
            hidden: false,
            metadata_override: None,
        });
        assert_eq!(
            duplicate.expect_err("duplicate should fail"),
            "watchlist token already exists"
        );

        let invalid_chain = add_watchlist_token(AddWatchlistTokenInput {
            chain_id: 0,
            token_contract: DAI.to_string(),
            label: None,
            user_notes: None,
            pinned: false,
            hidden: false,
            metadata_override: None,
        });
        assert_eq!(
            invalid_chain.expect_err("chain 0 should fail"),
            "chainId must be greater than zero"
        );
    });
}

#[test]
fn edit_updates_user_config_and_user_confirmed_metadata_without_changing_identity() {
    with_test_app_dir("token-watchlist-edit", |_| {
        add_usdc();
        let before = load_token_watchlist_state().expect("load before");
        let original_contract = before.watchlist_tokens[0].token_contract.clone();

        let state = edit_watchlist_token(EditWatchlistTokenInput {
            chain_id: 1,
            token_contract: original_contract.clone(),
            new_chain_id: None,
            new_token_contract: None,
            label: Some("Circle USD".to_string()),
            clear_label: false,
            user_notes: Some("confirmed locally".to_string()),
            clear_user_notes: false,
            pinned: Some(false),
            hidden: Some(true),
            metadata_override: Some(MetadataOverrideInput {
                symbol: Some("USDC".to_string()),
                name: Some("USD Coin".to_string()),
                decimals: Some(6),
                source: Some("userConfirmed".to_string()),
                confirmed_at: None,
            }),
            clear_metadata_override: false,
        })
        .expect("edit token");

        let token = &state.watchlist_tokens[0];
        assert_eq!(token.chain_id, 1);
        assert_eq!(token.token_contract, original_contract);
        assert_eq!(token.label.as_deref(), Some("Circle USD"));
        assert_eq!(token.user_notes.as_deref(), Some("confirmed locally"));
        assert!(!token.pinned);
        assert!(token.hidden);
        let override_record = token.metadata_override.as_ref().expect("override");
        assert_eq!(override_record.decimals, Some(6));
        assert_eq!(override_record.source, UserMetadataSource::UserConfirmed);
        assert!(!override_record.confirmed_at.is_empty());
    });
}

#[test]
fn identity_edit_does_not_inherit_old_user_confirmed_metadata() {
    with_test_app_dir("token-watchlist-identity-edit-clears-override", |_| {
        add_watchlist_token(AddWatchlistTokenInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            label: Some("USDC".to_string()),
            user_notes: None,
            pinned: false,
            hidden: false,
            metadata_override: Some(MetadataOverrideInput {
                symbol: Some("USDC".to_string()),
                name: Some("USD Coin".to_string()),
                decimals: Some(6),
                source: Some("userConfirmed".to_string()),
                confirmed_at: Some("1700000000".to_string()),
            }),
        })
        .expect("add with override");

        let state = edit_watchlist_token(EditWatchlistTokenInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            new_chain_id: Some(8453),
            new_token_contract: Some(DAI.to_string()),
            label: Some("New token".to_string()),
            clear_label: false,
            user_notes: None,
            clear_user_notes: false,
            pinned: None,
            hidden: None,
            metadata_override: None,
            clear_metadata_override: false,
        })
        .expect("identity edit");

        assert_eq!(state.watchlist_tokens.len(), 1);
        assert_eq!(state.watchlist_tokens[0].chain_id, 8453);
        assert!(state.watchlist_tokens[0].metadata_override.is_none());
    });
}

#[test]
fn same_identity_edit_preserves_omitted_fields_and_supports_clear_flags() {
    with_test_app_dir("token-watchlist-edit-clear-flags", |_| {
        add_watchlist_token(AddWatchlistTokenInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            label: Some("USD Coin".to_string()),
            user_notes: Some("local note".to_string()),
            pinned: false,
            hidden: false,
            metadata_override: Some(MetadataOverrideInput {
                symbol: Some("USDC".to_string()),
                name: Some("USD Coin".to_string()),
                decimals: Some(6),
                source: Some("userConfirmed".to_string()),
                confirmed_at: Some("1700000000".to_string()),
            }),
        })
        .expect("add with user config");

        let preserved = edit_watchlist_token(EditWatchlistTokenInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            new_chain_id: None,
            new_token_contract: None,
            label: None,
            clear_label: false,
            user_notes: None,
            clear_user_notes: false,
            pinned: None,
            hidden: None,
            metadata_override: None,
            clear_metadata_override: false,
        })
        .expect("omitted edit preserves");
        let token = &preserved.watchlist_tokens[0];
        assert_eq!(token.label.as_deref(), Some("USD Coin"));
        assert_eq!(token.user_notes.as_deref(), Some("local note"));
        assert!(token.metadata_override.is_some());

        let cleared = edit_watchlist_token(EditWatchlistTokenInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            new_chain_id: None,
            new_token_contract: None,
            label: None,
            clear_label: true,
            user_notes: None,
            clear_user_notes: true,
            pinned: None,
            hidden: None,
            metadata_override: None,
            clear_metadata_override: true,
        })
        .expect("clear edit");
        let token = &cleared.watchlist_tokens[0];
        assert!(token.label.is_none());
        assert!(token.user_notes.is_none());
        assert!(token.metadata_override.is_none());
    });
}

#[test]
fn user_confirmed_metadata_blank_confirmed_at_is_filled() {
    with_test_app_dir("token-watchlist-blank-confirmed-at", |_| {
        let state = add_watchlist_token(AddWatchlistTokenInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            label: None,
            user_notes: None,
            pinned: false,
            hidden: false,
            metadata_override: Some(MetadataOverrideInput {
                symbol: Some("USDC".to_string()),
                name: Some("USD Coin".to_string()),
                decimals: Some(6),
                source: Some("userConfirmed".to_string()),
                confirmed_at: Some("   ".to_string()),
            }),
        })
        .expect("add with blank confirmed_at");

        let override_record = state.watchlist_tokens[0]
            .metadata_override
            .as_ref()
            .expect("override");
        assert_eq!(override_record.source, UserMetadataSource::UserConfirmed);
        assert_eq!(override_record.decimals, Some(6));
        assert!(!override_record.confirmed_at.trim().is_empty());
        assert_ne!(override_record.confirmed_at, "   ");
    });
}

#[test]
fn remove_token_preserves_cache_and_snapshots_by_default_and_clears_when_explicit() {
    with_test_app_dir("token-watchlist-remove", |_| {
        add_usdc();
        upsert_token_metadata_cache(metadata_cache_input(Some("onChainCall"))).expect("cache");
        upsert_token_scan_state(UpsertTokenScanStateInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            status: TokenScanStatus::Ok,
            last_started_at: Some("1700000000".to_string()),
            clear_last_started_at: false,
            last_finished_at: Some("1700000001".to_string()),
            clear_last_finished_at: false,
            last_error_summary: None,
            clear_last_error_summary: false,
            rpc_identity: Some("mainnet-primary".to_string()),
            clear_rpc_identity: false,
            rpc_profile_id: Some("profile-a".to_string()),
            clear_rpc_profile_id: false,
        })
        .expect("scan state");
        upsert_erc20_balance_snapshot(balance_snapshot_input(Some("123"), BalanceStatus::Ok))
            .expect("snapshot");

        let state = remove_watchlist_token(RemoveWatchlistTokenInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            clear_metadata_cache: false,
            clear_scan_state: false,
            clear_snapshots: false,
        })
        .expect("remove default");
        assert!(state.watchlist_tokens.is_empty());
        assert_eq!(state.token_metadata_cache.len(), 1);
        assert_eq!(state.token_scan_state.len(), 1);
        assert_eq!(state.erc20_balance_snapshots.len(), 1);

        add_usdc();
        let state = remove_watchlist_token(RemoveWatchlistTokenInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            clear_metadata_cache: true,
            clear_scan_state: true,
            clear_snapshots: true,
        })
        .expect("remove and clear");
        assert!(state.watchlist_tokens.is_empty());
        assert!(state.token_metadata_cache.is_empty());
        assert!(state.token_scan_state.is_empty());
        assert!(state.erc20_balance_snapshots.is_empty());
    });
}

#[test]
fn raw_metadata_cache_only_accepts_on_chain_call_source() {
    with_test_app_dir("token-watchlist-raw-cache-source", |_| {
        let user_confirmed =
            upsert_token_metadata_cache(metadata_cache_input(Some("userConfirmed")));
        assert_eq!(
            user_confirmed.expect_err("user source rejected"),
            "token metadata cache source must be onChainCall"
        );

        let watchlist_cache =
            upsert_token_metadata_cache(metadata_cache_input(Some("watchlistCache")));
        assert_eq!(
            watchlist_cache.expect_err("watchlist source rejected"),
            "token metadata cache source must be onChainCall"
        );

        let state = upsert_token_metadata_cache(metadata_cache_input(None)).expect("cache upsert");
        assert_eq!(state.token_metadata_cache.len(), 1);
        assert_eq!(
            state.token_metadata_cache[0].source,
            RawMetadataSource::OnChainCall
        );

        let raw = fs::read_to_string(token_watchlist_path().expect("path")).expect("read state");
        assert!(raw.contains("\"source\": \"onChainCall\""));
        assert!(!raw.contains("userConfirmed"));
        assert!(!raw.contains("watchlistCache"));
    });
}

#[test]
fn scan_state_and_failed_balance_snapshot_preserve_user_config_and_old_balance() {
    with_test_app_dir("token-watchlist-failure-preserves", |_| {
        add_usdc();
        upsert_erc20_balance_snapshot(balance_snapshot_input(Some("123"), BalanceStatus::Ok))
            .expect("success snapshot");

        upsert_token_scan_state(UpsertTokenScanStateInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            status: TokenScanStatus::Failed,
            last_started_at: Some("1700000002".to_string()),
            clear_last_started_at: false,
            last_finished_at: Some("1700000003".to_string()),
            clear_last_finished_at: false,
            last_error_summary: Some("RPC failed".to_string()),
            clear_last_error_summary: false,
            rpc_identity: Some("mainnet-primary".to_string()),
            clear_rpc_identity: false,
            rpc_profile_id: Some("profile-a".to_string()),
            clear_rpc_profile_id: false,
        })
        .expect("scan failed");
        let state = upsert_erc20_balance_snapshot(balance_snapshot_input(
            Some("0"),
            BalanceStatus::RpcFailed,
        ))
        .expect("failed snapshot");

        assert_eq!(state.watchlist_tokens.len(), 1);
        assert_eq!(state.watchlist_tokens[0].label.as_deref(), Some("USDC"));
        assert_eq!(state.erc20_balance_snapshots.len(), 1);
        assert_eq!(state.erc20_balance_snapshots[0].balance_raw, "123");
        assert_eq!(
            state.erc20_balance_snapshots[0].balance_status,
            BalanceStatus::RpcFailed
        );
    });
}

#[test]
fn partial_scan_state_and_balance_upserts_preserve_omitted_optional_fields() {
    with_test_app_dir("token-watchlist-partial-upsert-preserves", |_| {
        let first_scan = upsert_token_scan_state(UpsertTokenScanStateInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            status: TokenScanStatus::Scanning,
            last_started_at: Some("1700000100".to_string()),
            clear_last_started_at: false,
            last_finished_at: Some("1700000101".to_string()),
            clear_last_finished_at: false,
            last_error_summary: Some("temporary RPC issue".to_string()),
            clear_last_error_summary: false,
            rpc_identity: Some("mainnet-primary".to_string()),
            clear_rpc_identity: false,
            rpc_profile_id: Some("profile-a".to_string()),
            clear_rpc_profile_id: false,
        })
        .expect("first scan");
        assert_eq!(
            first_scan.token_scan_state[0].rpc_identity.as_deref(),
            Some("mainnet-primary")
        );

        let second_scan = upsert_token_scan_state(UpsertTokenScanStateInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            status: TokenScanStatus::Ok,
            last_started_at: None,
            clear_last_started_at: false,
            last_finished_at: None,
            clear_last_finished_at: false,
            last_error_summary: None,
            clear_last_error_summary: false,
            rpc_identity: None,
            clear_rpc_identity: false,
            rpc_profile_id: None,
            clear_rpc_profile_id: false,
        })
        .expect("partial scan");
        let scan = &second_scan.token_scan_state[0];
        assert_eq!(scan.status, TokenScanStatus::Ok);
        assert_eq!(scan.last_started_at.as_deref(), Some("1700000100"));
        assert_eq!(scan.last_finished_at.as_deref(), Some("1700000101"));
        assert_eq!(
            scan.last_error_summary.as_deref(),
            Some("temporary RPC issue")
        );
        assert_eq!(scan.rpc_identity.as_deref(), Some("mainnet-primary"));
        assert_eq!(scan.rpc_profile_id.as_deref(), Some("profile-a"));

        let first_snapshot = upsert_erc20_balance_snapshot(UpsertErc20BalanceSnapshotInput {
            account: ACCOUNT.to_string(),
            chain_id: 1,
            token_contract: USDC.to_string(),
            balance_raw: Some("100".to_string()),
            balance_status: BalanceStatus::Ok,
            metadata_status_ref: Some(ResolvedMetadataStatus::Ok),
            clear_metadata_status_ref: false,
            last_scanned_at: Some("1700000200".to_string()),
            clear_last_scanned_at: false,
            last_error_summary: Some("previous warning".to_string()),
            clear_last_error_summary: false,
            rpc_identity: Some("balance-rpc".to_string()),
            clear_rpc_identity: false,
            rpc_profile_id: Some("balance-profile".to_string()),
            clear_rpc_profile_id: false,
            resolved_metadata: Some(ResolvedTokenMetadataSnapshot {
                symbol: Some("USDC".to_string()),
                name: Some("USD Coin".to_string()),
                decimals: Some(6),
                source: ResolvedMetadataSource::OnChainCall,
                status: ResolvedMetadataStatus::Ok,
            }),
            clear_resolved_metadata: false,
        })
        .expect("first snapshot");
        assert_eq!(first_snapshot.erc20_balance_snapshots[0].balance_raw, "100");

        let second_snapshot = upsert_erc20_balance_snapshot(UpsertErc20BalanceSnapshotInput {
            account: ACCOUNT.to_string(),
            chain_id: 1,
            token_contract: USDC.to_string(),
            balance_raw: Some("200".to_string()),
            balance_status: BalanceStatus::Ok,
            metadata_status_ref: None,
            clear_metadata_status_ref: false,
            last_scanned_at: None,
            clear_last_scanned_at: false,
            last_error_summary: None,
            clear_last_error_summary: false,
            rpc_identity: None,
            clear_rpc_identity: false,
            rpc_profile_id: None,
            clear_rpc_profile_id: false,
            resolved_metadata: None,
            clear_resolved_metadata: false,
        })
        .expect("partial snapshot");
        let snapshot = &second_snapshot.erc20_balance_snapshots[0];
        assert_eq!(snapshot.balance_raw, "200");
        assert_eq!(
            snapshot.metadata_status_ref,
            Some(ResolvedMetadataStatus::Ok)
        );
        assert_eq!(snapshot.last_scanned_at.as_deref(), Some("1700000200"));
        assert_eq!(
            snapshot.last_error_summary.as_deref(),
            Some("previous warning")
        );
        assert_eq!(snapshot.rpc_identity.as_deref(), Some("balance-rpc"));
        assert_eq!(snapshot.rpc_profile_id.as_deref(), Some("balance-profile"));
        assert!(snapshot.resolved_metadata.is_some());
    });
}

#[test]
fn scan_state_and_balance_snapshot_created_at_is_set_and_preserved() {
    with_test_app_dir("token-watchlist-created-at", |_| {
        let first = upsert_token_scan_state(UpsertTokenScanStateInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            status: TokenScanStatus::Scanning,
            last_started_at: Some("1700000010".to_string()),
            clear_last_started_at: false,
            last_finished_at: None,
            clear_last_finished_at: false,
            last_error_summary: None,
            clear_last_error_summary: false,
            rpc_identity: None,
            clear_rpc_identity: false,
            rpc_profile_id: None,
            clear_rpc_profile_id: false,
        })
        .expect("first scan state");
        let first_created_at = first.token_scan_state[0].created_at.clone();
        assert!(!first_created_at.is_empty());

        let second = upsert_token_scan_state(UpsertTokenScanStateInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            status: TokenScanStatus::Ok,
            last_started_at: Some("1700000010".to_string()),
            clear_last_started_at: false,
            last_finished_at: Some("1700000011".to_string()),
            clear_last_finished_at: false,
            last_error_summary: None,
            clear_last_error_summary: false,
            rpc_identity: None,
            clear_rpc_identity: false,
            rpc_profile_id: None,
            clear_rpc_profile_id: false,
        })
        .expect("second scan state");
        assert_eq!(second.token_scan_state[0].created_at, first_created_at);
        assert!(!second.token_scan_state[0].updated_at.is_empty());

        let first_snapshot = upsert_erc20_balance_snapshot(UpsertErc20BalanceSnapshotInput {
            account: ACCOUNT.to_string(),
            chain_id: 1,
            token_contract: USDC.to_string(),
            balance_raw: Some("0".to_string()),
            balance_status: BalanceStatus::Zero,
            metadata_status_ref: Some(ResolvedMetadataStatus::Ok),
            clear_metadata_status_ref: false,
            last_scanned_at: Some("1700000012".to_string()),
            clear_last_scanned_at: false,
            last_error_summary: None,
            clear_last_error_summary: false,
            rpc_identity: None,
            clear_rpc_identity: false,
            rpc_profile_id: None,
            clear_rpc_profile_id: false,
            resolved_metadata: Some(ResolvedTokenMetadataSnapshot {
                symbol: Some("USDC".to_string()),
                name: Some("USD Coin".to_string()),
                decimals: Some(6),
                source: ResolvedMetadataSource::OnChainCall,
                status: ResolvedMetadataStatus::Ok,
            }),
            clear_resolved_metadata: false,
        })
        .expect("first balance snapshot");
        let snapshot_created_at = first_snapshot.erc20_balance_snapshots[0].created_at.clone();
        assert!(!snapshot_created_at.is_empty());

        let second_snapshot =
            upsert_erc20_balance_snapshot(balance_snapshot_input(Some("456"), BalanceStatus::Ok))
                .expect("second balance snapshot");
        assert_eq!(
            second_snapshot.erc20_balance_snapshots[0].created_at,
            snapshot_created_at
        );
        assert_eq!(
            second_snapshot.erc20_balance_snapshots[0].balance_raw,
            "456"
        );
    });
}

#[test]
fn persisted_errors_and_rpc_identity_are_sanitized() {
    with_test_app_dir("token-watchlist-sanitized", |_| {
        upsert_token_scan_state(UpsertTokenScanStateInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            status: TokenScanStatus::Failed,
            last_started_at: None,
            clear_last_started_at: false,
            last_finished_at: Some("1700000003".to_string()),
            clear_last_finished_at: false,
            last_error_summary: Some(
                "failed https://rpc.example/path?apiKey=secret Authorization Bearer bearer-secret private_key=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                    .to_string(),
            ),
            clear_last_error_summary: false,
            rpc_identity: Some("https://rpc.example/path?token=secret apiKey=hidden".to_string()),
            clear_rpc_identity: false,
            rpc_profile_id: Some("profile Authorization Bearer profile-secret".to_string()),
            clear_rpc_profile_id: false,
        })
        .expect("scan state");

        upsert_erc20_balance_snapshot(UpsertErc20BalanceSnapshotInput {
            account: ACCOUNT.to_string(),
            chain_id: 1,
            token_contract: USDC.to_string(),
            balance_raw: Some("0".to_string()),
            balance_status: BalanceStatus::BalanceCallFailed,
            metadata_status_ref: None,
            clear_metadata_status_ref: false,
            last_scanned_at: None,
            clear_last_scanned_at: false,
            last_error_summary: Some("apiKey=balance-secret token balance-token".to_string()),
            clear_last_error_summary: false,
            rpc_identity: Some("https://balance.example/rpc?token=balance-secret".to_string()),
            clear_rpc_identity: false,
            rpc_profile_id: None,
            clear_rpc_profile_id: false,
            resolved_metadata: None,
            clear_resolved_metadata: false,
        })
        .expect("balance state");

        let raw = fs::read_to_string(token_watchlist_path().expect("path")).expect("read state");
        assert!(!raw.contains("secret"));
        assert!(!raw.contains("apiKey=hidden"));
        assert!(!raw.contains("rpc.example/path?"));
        assert!(!raw.contains("balance.example/rpc?"));
        assert!(!raw.contains("aaaaaaaaaaaaaaaa"));
        assert!(raw.contains("[redacted"));
    });
}

#[test]
fn malformed_existing_file_returns_recoverable_error_without_overwriting() {
    with_test_app_dir("token-watchlist-malformed", |_| {
        let path = token_watchlist_path().expect("path");
        fs::write(&path, "{ this is not json").expect("write malformed");

        let error = load_token_watchlist_state().expect_err("load should fail");
        assert_eq!(
            error,
            "token-watchlist.json is invalid; fix or remove it before saving token state"
        );

        let add_error = add_watchlist_token(AddWatchlistTokenInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            label: None,
            user_notes: None,
            pinned: false,
            hidden: false,
            metadata_override: None,
        })
        .expect_err("save should fail");
        assert_eq!(
            add_error,
            "token-watchlist.json is invalid; fix or remove it before saving token state"
        );
        assert_eq!(
            fs::read_to_string(&path).expect("read malformed"),
            "{ this is not json"
        );
    });
}
