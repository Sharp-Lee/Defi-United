use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ethers::abi::{encode, Token};
use ethers::types::U256;
use wallet_workbench_lib::commands::token_scanner::{
    scan_erc20_balance, scan_watchlist_balances, scan_watchlist_token_metadata,
    ScanErc20BalanceInput, ScanWatchlistBalancesInput, ScanWatchlistTokenMetadataInput,
};
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
        Self { dir, previous }
    }
}

impl Drop for TestAppDirGuard {
    fn drop(&mut self) {
        if let Some(value) = &self.previous {
            std::env::set_var(APP_DIR_ENV, value);
        } else {
            std::env::remove_var(APP_DIR_ENV);
        }
        let _ = fs::remove_dir_all(&self.dir);
    }
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

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn u256_result_hex(value: U256) -> String {
    let mut bytes = [0u8; 32];
    value.to_big_endian(&mut bytes);
    format!("\"0x{}\"", bytes_to_hex(&bytes))
}

fn string_result_hex(value: &str) -> String {
    format!(
        "\"0x{}\"",
        bytes_to_hex(&encode(&[Token::String(value.to_string())]))
    )
}

fn raw_result_hex(hex_without_prefix: &str) -> String {
    format!("\"0x{hex_without_prefix}\"")
}

fn rpc_result(value: String) -> String {
    format!(r#""result":{value}"#)
}

fn rpc_error(message: &str) -> String {
    format!(r#""error":{{"code":-32000,"message":"{message}"}}"#)
}

fn read_http_request(stream: &mut std::net::TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("set read timeout");
    let mut buffer = [0; 8192];
    let mut request = String::new();
    loop {
        let bytes = stream.read(&mut buffer).expect("read rpc request");
        if bytes == 0 {
            break;
        }
        request.push_str(&String::from_utf8_lossy(&buffer[..bytes]));
        if request.contains("\r\n\r\n") {
            let header_end = request.find("\r\n\r\n").expect("headers");
            let headers = &request[..header_end];
            let content_length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            let body_len = request.len().saturating_sub(header_end + 4);
            if body_len >= content_length {
                break;
            }
        }
    }
    request
}

fn start_token_rpc_server(
    request_count: usize,
    handler: impl Fn(&str) -> String + Send + Sync + 'static,
) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind rpc server");
    let address = listener.local_addr().expect("local addr");
    let requests = Arc::new(Mutex::new(Vec::new()));
    let requests_for_thread = Arc::clone(&requests);
    let handler = Arc::new(handler);
    thread::spawn(move || {
        for stream in listener.incoming().take(request_count) {
            let mut stream = stream.expect("accept rpc request");
            let request = read_http_request(&mut stream);
            requests_for_thread
                .lock()
                .expect("requests lock")
                .push(request.clone());
            let payload = handler(&request);
            let body = format!(r#"{{"jsonrpc":"2.0","id":1,{payload}}}"#);
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

fn standard_token_rpc_payload(request: &str, balance: U256) -> String {
    if request.contains("eth_chainId") {
        rpc_result("\"0x1\"".to_string())
    } else if request.contains("313ce567") {
        rpc_result(u256_result_hex(U256::from(6u64)))
    } else if request.contains("95d89b41") {
        rpc_result(string_result_hex("USDC"))
    } else if request.contains("06fdde03") {
        rpc_result(string_result_hex("USD Coin"))
    } else if request.contains("70a08231") {
        rpc_result(u256_result_hex(balance))
    } else {
        rpc_result("null".to_string())
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
fn failed_metadata_cache_upsert_preserves_existing_raw_metadata() {
    with_test_app_dir("token-watchlist-failed-metadata-preserves-cache", |_| {
        add_usdc();
        upsert_token_metadata_cache(metadata_cache_input(Some("onChainCall"))).expect("cache");

        let state = upsert_token_metadata_cache(UpsertTokenMetadataCacheInput {
            chain_id: 1,
            token_contract: USDC.to_string(),
            raw_symbol: Some("BAD".to_string()),
            raw_name: Some("Bad Token".to_string()),
            raw_decimals: None,
            source: Some("onChainCall".to_string()),
            status: RawMetadataStatus::CallFailed,
            last_scanned_at: Some("1700000002".to_string()),
            last_error_summary: Some("decimals() call failed".to_string()),
            observed_decimals: None,
            previous_decimals: None,
        })
        .expect("failed cache upsert");

        let cache = &state.token_metadata_cache[0];
        assert_eq!(cache.status, RawMetadataStatus::CallFailed);
        assert_eq!(cache.raw_symbol.as_deref(), Some("USDC"));
        assert_eq!(cache.raw_name.as_deref(), Some("USD Coin"));
        assert_eq!(cache.raw_decimals, Some(6));
        assert_eq!(cache.last_scanned_at.as_deref(), Some("1700000002"));
        assert_eq!(
            cache.last_error_summary.as_deref(),
            Some("decimals() call failed")
        );
        assert_eq!(
            state.resolved_token_metadata[0].status,
            ResolvedMetadataStatus::CallFailed
        );
        assert_eq!(
            state.resolved_token_metadata[0].symbol.as_deref(),
            Some("USDC")
        );
        assert_eq!(state.resolved_token_metadata[0].decimals, Some(6));
    });
}

#[test]
fn failed_metadata_cache_upsert_preserves_decimals_changed_diagnostics() {
    with_test_app_dir(
        "token-watchlist-failed-metadata-preserves-decimal-diagnostics",
        |_| {
            add_usdc();
            upsert_token_metadata_cache(metadata_cache_input(Some("onChainCall"))).expect("cache");
            upsert_token_metadata_cache(UpsertTokenMetadataCacheInput {
                chain_id: 1,
                token_contract: USDC.to_string(),
                raw_symbol: Some("USDC".to_string()),
                raw_name: Some("USD Coin".to_string()),
                raw_decimals: Some(18),
                source: Some("onChainCall".to_string()),
                status: RawMetadataStatus::DecimalsChanged,
                last_scanned_at: Some("1700000001".to_string()),
                last_error_summary: None,
                observed_decimals: Some(18),
                previous_decimals: None,
            })
            .expect("decimals changed cache upsert");

            let state = upsert_token_metadata_cache(UpsertTokenMetadataCacheInput {
                chain_id: 1,
                token_contract: USDC.to_string(),
                raw_symbol: Some("BAD".to_string()),
                raw_name: Some("Bad Token".to_string()),
                raw_decimals: None,
                source: Some("onChainCall".to_string()),
                status: RawMetadataStatus::Malformed,
                last_scanned_at: Some("1700000002".to_string()),
                last_error_summary: Some("decimals() returned malformed data".to_string()),
                observed_decimals: None,
                previous_decimals: None,
            })
            .expect("failed cache upsert");

            let cache = &state.token_metadata_cache[0];
            assert_eq!(cache.status, RawMetadataStatus::Malformed);
            assert_eq!(cache.raw_symbol.as_deref(), Some("USDC"));
            assert_eq!(cache.raw_name.as_deref(), Some("USD Coin"));
            assert_eq!(cache.raw_decimals, Some(18));
            assert_eq!(cache.observed_decimals, Some(18));
            assert_eq!(cache.previous_decimals, Some(6));
            assert_eq!(cache.last_scanned_at.as_deref(), Some("1700000002"));
            assert_eq!(
                cache.last_error_summary.as_deref(),
                Some("decimals() returned malformed data")
            );
        },
    );
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

#[tokio::test(flavor = "current_thread")]
async fn scanner_chain_mismatch_records_expected_actual_without_metadata_calls() {
    let _lock = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("token-scanner-chain-mismatch");
    add_usdc();
    let (rpc_url, requests) = start_token_rpc_server(1, |request| {
        assert!(request.contains("eth_chainId"));
        rpc_result("\"0x5\"".to_string())
    });

    let state = scan_watchlist_token_metadata(ScanWatchlistTokenMetadataInput {
        rpc_url,
        chain_id: 1,
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("scan metadata");

    assert_eq!(requests.lock().expect("requests").len(), 1);
    assert!(state.token_metadata_cache.is_empty());
    assert_eq!(
        state.token_scan_state[0].status,
        TokenScanStatus::ChainMismatch
    );
    assert_eq!(
        state.token_scan_state[0].last_error_summary.as_deref(),
        Some("chainId mismatch: expected 1, actual 5")
    );
}

#[tokio::test(flavor = "current_thread")]
async fn scanner_metadata_success_writes_raw_cache_and_resolved_view() {
    let _lock = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("token-scanner-metadata-success");
    add_usdc();
    let (rpc_url, _requests) = start_token_rpc_server(4, |request| {
        standard_token_rpc_payload(request, U256::zero())
    });

    let state = scan_watchlist_token_metadata(ScanWatchlistTokenMetadataInput {
        rpc_url,
        chain_id: 1,
        token_contract: USDC.to_string(),
        rpc_profile_id: Some("mainnet".to_string()),
    })
    .await
    .expect("scan metadata");

    let cache = &state.token_metadata_cache[0];
    assert_eq!(cache.source, RawMetadataSource::OnChainCall);
    assert_eq!(cache.status, RawMetadataStatus::Ok);
    assert_eq!(cache.raw_decimals, Some(6));
    assert_eq!(cache.raw_symbol.as_deref(), Some("USDC"));
    assert_eq!(cache.raw_name.as_deref(), Some("USD Coin"));
    assert_eq!(
        state.resolved_token_metadata[0].status,
        ResolvedMetadataStatus::Ok
    );
    assert_eq!(
        state.resolved_token_metadata[0].source,
        ResolvedMetadataSource::OnChainCall
    );
    assert_eq!(state.token_scan_state[0].status, TokenScanStatus::Ok);
}

#[tokio::test(flavor = "current_thread")]
async fn scanner_failed_metadata_scan_preserves_prior_raw_cache() {
    let _lock = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("token-scanner-failed-metadata-preserves-cache");
    add_usdc();
    let (first_rpc, _requests) = start_token_rpc_server(4, |request| {
        standard_token_rpc_payload(request, U256::zero())
    });
    scan_watchlist_token_metadata(ScanWatchlistTokenMetadataInput {
        rpc_url: first_rpc,
        chain_id: 1,
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("first metadata scan");

    let (failed_rpc, _requests) = start_token_rpc_server(4, |request| {
        if request.contains("eth_chainId") {
            rpc_result("\"0x1\"".to_string())
        } else if request.contains("313ce567") {
            rpc_error("decimals reverted")
        } else if request.contains("95d89b41") {
            rpc_result(string_result_hex("BAD"))
        } else if request.contains("06fdde03") {
            rpc_result(string_result_hex("Bad Token"))
        } else {
            rpc_result("null".to_string())
        }
    });
    let state = scan_watchlist_token_metadata(ScanWatchlistTokenMetadataInput {
        rpc_url: failed_rpc,
        chain_id: 1,
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("failed metadata scan");

    assert_eq!(state.watchlist_tokens.len(), 1);
    let cache = &state.token_metadata_cache[0];
    assert_eq!(cache.status, RawMetadataStatus::CallFailed);
    assert_eq!(cache.raw_decimals, Some(6));
    assert_eq!(cache.raw_symbol.as_deref(), Some("USDC"));
    assert_eq!(cache.raw_name.as_deref(), Some("USD Coin"));
    assert!(cache.last_scanned_at.is_some());
    assert!(cache.last_error_summary.is_some());
    assert_eq!(state.token_scan_state[0].status, TokenScanStatus::Failed);
    assert!(state.token_scan_state[0].last_error_summary.is_some());
    assert_eq!(
        state.resolved_token_metadata[0].status,
        ResolvedMetadataStatus::CallFailed
    );
    assert_eq!(
        state.resolved_token_metadata[0].symbol.as_deref(),
        Some("USDC")
    );
    assert_eq!(
        state.resolved_token_metadata[0].name.as_deref(),
        Some("USD Coin")
    );
    assert_eq!(state.resolved_token_metadata[0].decimals, Some(6));
}

#[tokio::test(flavor = "current_thread")]
async fn scanner_decimals_changed_is_explicit_raw_and_resolved_status() {
    let _lock = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("token-scanner-decimals-changed");
    add_usdc();
    let (first_rpc, _requests) = start_token_rpc_server(4, |request| {
        standard_token_rpc_payload(request, U256::zero())
    });
    scan_watchlist_token_metadata(ScanWatchlistTokenMetadataInput {
        rpc_url: first_rpc,
        chain_id: 1,
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("first metadata scan");

    let (changed_rpc, _requests) = start_token_rpc_server(4, |request| {
        if request.contains("eth_chainId") {
            rpc_result("\"0x1\"".to_string())
        } else if request.contains("313ce567") {
            rpc_result(u256_result_hex(U256::from(18u64)))
        } else if request.contains("95d89b41") {
            rpc_result(string_result_hex("USDC"))
        } else if request.contains("06fdde03") {
            rpc_result(string_result_hex("USD Coin"))
        } else {
            rpc_result("null".to_string())
        }
    });
    let state = scan_watchlist_token_metadata(ScanWatchlistTokenMetadataInput {
        rpc_url: changed_rpc,
        chain_id: 1,
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("changed metadata scan");

    let cache = &state.token_metadata_cache[0];
    assert_eq!(cache.status, RawMetadataStatus::DecimalsChanged);
    assert_eq!(cache.raw_decimals, Some(18));
    assert_eq!(cache.observed_decimals, Some(18));
    assert_eq!(cache.previous_decimals, Some(6));
    assert_eq!(
        state.resolved_token_metadata[0].status,
        ResolvedMetadataStatus::DecimalsChanged
    );
}

#[tokio::test(flavor = "current_thread")]
async fn scanner_metadata_decimal_failures_are_explicit_and_keep_watchlist_token() {
    let _lock = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("token-scanner-decimals-failures");
    add_usdc();
    let (missing_rpc, _requests) = start_token_rpc_server(4, |request| {
        if request.contains("eth_chainId") {
            rpc_result("\"0x1\"".to_string())
        } else if request.contains("313ce567") {
            rpc_result(raw_result_hex(""))
        } else if request.contains("95d89b41") {
            rpc_result(string_result_hex("USDC"))
        } else if request.contains("06fdde03") {
            rpc_result(string_result_hex("USD Coin"))
        } else {
            rpc_result("null".to_string())
        }
    });

    let missing = scan_watchlist_token_metadata(ScanWatchlistTokenMetadataInput {
        rpc_url: missing_rpc,
        chain_id: 1,
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("missing decimals scan");
    assert_eq!(missing.watchlist_tokens.len(), 1);
    assert_eq!(
        missing.token_metadata_cache[0].status,
        RawMetadataStatus::MissingDecimals
    );
    assert_eq!(
        missing.resolved_token_metadata[0].status,
        ResolvedMetadataStatus::MissingDecimals
    );

    let (malformed_rpc, _requests) = start_token_rpc_server(4, |request| {
        if request.contains("eth_chainId") {
            rpc_result("\"0x1\"".to_string())
        } else if request.contains("313ce567") {
            rpc_result(raw_result_hex("01"))
        } else if request.contains("95d89b41") {
            rpc_result(string_result_hex("USDC"))
        } else if request.contains("06fdde03") {
            rpc_result(string_result_hex("USD Coin"))
        } else {
            rpc_result("null".to_string())
        }
    });
    let malformed = scan_watchlist_token_metadata(ScanWatchlistTokenMetadataInput {
        rpc_url: malformed_rpc,
        chain_id: 1,
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("malformed decimals scan");
    assert_eq!(
        malformed.token_metadata_cache[0].status,
        RawMetadataStatus::Malformed
    );

    let (call_failed_rpc, _requests) = start_token_rpc_server(4, |request| {
        if request.contains("eth_chainId") {
            rpc_result("\"0x1\"".to_string())
        } else if request.contains("313ce567") {
            rpc_error("decimals reverted")
        } else if request.contains("95d89b41") {
            rpc_result(string_result_hex("USDC"))
        } else if request.contains("06fdde03") {
            rpc_result(string_result_hex("USD Coin"))
        } else {
            rpc_result("null".to_string())
        }
    });
    let call_failed = scan_watchlist_token_metadata(ScanWatchlistTokenMetadataInput {
        rpc_url: call_failed_rpc,
        chain_id: 1,
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("call failed decimals scan");
    assert_eq!(
        call_failed.token_metadata_cache[0].status,
        RawMetadataStatus::CallFailed
    );

    let (non_erc20_rpc, _requests) = start_token_rpc_server(4, |request| {
        if request.contains("eth_chainId") {
            rpc_result("\"0x1\"".to_string())
        } else if request.contains("313ce567")
            || request.contains("95d89b41")
            || request.contains("06fdde03")
        {
            rpc_error("method not found")
        } else {
            rpc_result("null".to_string())
        }
    });
    let non_erc20 = scan_watchlist_token_metadata(ScanWatchlistTokenMetadataInput {
        rpc_url: non_erc20_rpc,
        chain_id: 1,
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("non ERC-20 scan");
    assert_eq!(
        non_erc20.token_metadata_cache[0].status,
        RawMetadataStatus::NonErc20
    );
}

#[tokio::test(flavor = "current_thread")]
async fn scanner_symbol_name_malformed_does_not_block_decimals_or_balance() {
    let _lock = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("token-scanner-symbol-name-malformed");
    add_usdc();
    let (rpc_url, _requests) = start_token_rpc_server(5, |request| {
        if request.contains("eth_chainId") {
            rpc_result("\"0x1\"".to_string())
        } else if request.contains("313ce567") {
            rpc_result(u256_result_hex(U256::from(6u64)))
        } else if request.contains("95d89b41") || request.contains("06fdde03") {
            rpc_result(raw_result_hex("1234"))
        } else if request.contains("70a08231") {
            rpc_result(u256_result_hex(U256::from(77u64)))
        } else {
            rpc_result("null".to_string())
        }
    });

    let state = scan_erc20_balance(ScanErc20BalanceInput {
        rpc_url,
        chain_id: 1,
        account: ACCOUNT.to_string(),
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("scan balance");

    assert_eq!(state.token_metadata_cache[0].status, RawMetadataStatus::Ok);
    assert_eq!(state.token_metadata_cache[0].raw_decimals, Some(6));
    assert_eq!(state.token_metadata_cache[0].raw_symbol, None);
    assert_eq!(
        state.erc20_balance_snapshots[0].balance_status,
        BalanceStatus::Ok
    );
    assert_eq!(state.erc20_balance_snapshots[0].balance_raw, "77");
}

#[tokio::test(flavor = "current_thread")]
async fn scanner_balance_success_writes_balance_and_metadata_snapshot() {
    let _lock = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("token-scanner-balance-success");
    add_usdc();
    let (rpc_url, _requests) = start_token_rpc_server(5, |request| {
        standard_token_rpc_payload(request, U256::from(1_500_000u64))
    });

    let state = scan_erc20_balance(ScanErc20BalanceInput {
        rpc_url,
        chain_id: 1,
        account: ACCOUNT.to_string(),
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("scan balance");

    let snapshot = &state.erc20_balance_snapshots[0];
    assert_eq!(snapshot.balance_raw, "1500000");
    assert_eq!(snapshot.balance_status, BalanceStatus::Ok);
    assert_eq!(
        snapshot.metadata_status_ref,
        Some(ResolvedMetadataStatus::Ok)
    );
    assert_eq!(
        snapshot
            .resolved_metadata
            .as_ref()
            .and_then(|item| item.decimals),
        Some(6)
    );
}

#[tokio::test(flavor = "current_thread")]
async fn scanner_balance_failure_after_success_preserves_old_balance_as_stale() {
    let _lock = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("token-scanner-balance-stale");
    add_usdc();
    let (success_rpc, _requests) = start_token_rpc_server(5, |request| {
        standard_token_rpc_payload(request, U256::from(100u64))
    });
    scan_erc20_balance(ScanErc20BalanceInput {
        rpc_url: success_rpc,
        chain_id: 1,
        account: ACCOUNT.to_string(),
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("first balance scan");

    let (failure_rpc, _requests) = start_token_rpc_server(5, |request| {
        if request.contains("eth_chainId") {
            rpc_result("\"0x1\"".to_string())
        } else if request.contains("313ce567") {
            rpc_result(u256_result_hex(U256::from(6u64)))
        } else if request.contains("95d89b41") {
            rpc_result(string_result_hex("USDC"))
        } else if request.contains("06fdde03") {
            rpc_result(string_result_hex("USD Coin"))
        } else if request.contains("70a08231") {
            rpc_error("execution reverted apiKey=super-secret Authorization Bearer hidden")
        } else {
            rpc_result("null".to_string())
        }
    });
    let state = scan_erc20_balance(ScanErc20BalanceInput {
        rpc_url: format!("{failure_rpc}/?apiKey=url-secret"),
        chain_id: 1,
        account: ACCOUNT.to_string(),
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("failed balance scan");

    let snapshot = &state.erc20_balance_snapshots[0];
    assert_eq!(snapshot.balance_raw, "100");
    assert_eq!(snapshot.balance_status, BalanceStatus::Stale);
    assert!(snapshot
        .last_error_summary
        .as_deref()
        .expect("last error")
        .contains("balanceCallFailed"));
    let raw = fs::read_to_string(token_watchlist_path().expect("path")).expect("read state");
    assert!(!raw.contains("super-secret"));
    assert!(!raw.contains("url-secret"));
    assert!(!raw.contains("Bearer hidden"));

    let (second_failure_rpc, _requests) = start_token_rpc_server(5, |request| {
        if request.contains("eth_chainId") {
            rpc_result("\"0x1\"".to_string())
        } else if request.contains("313ce567") {
            rpc_result(u256_result_hex(U256::from(6u64)))
        } else if request.contains("95d89b41") {
            rpc_result(string_result_hex("USDC"))
        } else if request.contains("06fdde03") {
            rpc_result(string_result_hex("USD Coin"))
        } else if request.contains("70a08231") {
            rpc_error("second failure marker")
        } else {
            rpc_result("null".to_string())
        }
    });
    let second = scan_erc20_balance(ScanErc20BalanceInput {
        rpc_url: second_failure_rpc,
        chain_id: 1,
        account: ACCOUNT.to_string(),
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("second failed balance scan");
    let snapshot = &second.erc20_balance_snapshots[0];
    assert_eq!(snapshot.balance_raw, "100");
    assert_eq!(snapshot.balance_status, BalanceStatus::Stale);
    assert!(snapshot
        .last_error_summary
        .as_deref()
        .expect("second error")
        .contains("second failure marker"));
}

#[tokio::test(flavor = "current_thread")]
async fn scanner_bulk_retry_failed_only_includes_failed_balance_snapshots() {
    let _lock = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("token-scanner-retry-failed-balances");
    add_usdc();
    add_watchlist_token(AddWatchlistTokenInput {
        chain_id: 1,
        token_contract: DAI.to_string(),
        label: Some("DAI".to_string()),
        user_notes: None,
        pinned: false,
        hidden: false,
        metadata_override: None,
    })
    .expect("add DAI");
    upsert_token_scan_state(UpsertTokenScanStateInput {
        chain_id: 1,
        token_contract: USDC.to_string(),
        status: TokenScanStatus::Ok,
        last_started_at: None,
        clear_last_started_at: false,
        last_finished_at: Some("1700000000".to_string()),
        clear_last_finished_at: false,
        last_error_summary: None,
        clear_last_error_summary: false,
        rpc_identity: None,
        clear_rpc_identity: false,
        rpc_profile_id: None,
        clear_rpc_profile_id: false,
    })
    .expect("USDC scan ok");
    upsert_token_scan_state(UpsertTokenScanStateInput {
        chain_id: 1,
        token_contract: DAI.to_string(),
        status: TokenScanStatus::Ok,
        last_started_at: None,
        clear_last_started_at: false,
        last_finished_at: Some("1700000000".to_string()),
        clear_last_finished_at: false,
        last_error_summary: None,
        clear_last_error_summary: false,
        rpc_identity: None,
        clear_rpc_identity: false,
        rpc_profile_id: None,
        clear_rpc_profile_id: false,
    })
    .expect("DAI scan ok");
    upsert_erc20_balance_snapshot(balance_snapshot_input(
        None,
        BalanceStatus::BalanceCallFailed,
    ))
    .expect("failed USDC balance");
    upsert_erc20_balance_snapshot(UpsertErc20BalanceSnapshotInput {
        account: ACCOUNT.to_string(),
        chain_id: 1,
        token_contract: DAI.to_string(),
        balance_raw: Some("1".to_string()),
        balance_status: BalanceStatus::Ok,
        metadata_status_ref: Some(ResolvedMetadataStatus::Ok),
        clear_metadata_status_ref: false,
        last_scanned_at: Some("1700000000".to_string()),
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
    .expect("ok DAI balance");
    let (rpc_url, requests) = start_token_rpc_server(5, |request| {
        standard_token_rpc_payload(request, U256::from(222u64))
    });

    let state = scan_watchlist_balances(ScanWatchlistBalancesInput {
        rpc_url,
        chain_id: 1,
        accounts: Some(vec![ACCOUNT.to_string()]),
        token_contracts: None,
        retry_failed_only: true,
        rpc_profile_id: None,
    })
    .await
    .expect("retry failed balances");

    assert_eq!(requests.lock().expect("requests").len(), 5);
    let usdc_snapshot = state
        .erc20_balance_snapshots
        .iter()
        .find(|item| item.balance_raw == "222")
        .expect("USDC snapshot");
    assert_eq!(usdc_snapshot.balance_raw, "222");
    let dai_snapshot = state
        .erc20_balance_snapshots
        .iter()
        .find(|item| item.balance_raw == "1")
        .expect("DAI snapshot remains unchanged");
    assert_eq!(dai_snapshot.balance_status, BalanceStatus::Ok);
}

#[tokio::test(flavor = "current_thread")]
async fn scanner_bulk_explicit_tokens_must_be_visible_watchlist_tokens_for_chain() {
    let _lock = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("token-scanner-explicit-watchlist-only");
    add_usdc();
    add_watchlist_token(AddWatchlistTokenInput {
        chain_id: 1,
        token_contract: DAI.to_string(),
        label: Some("Hidden DAI".to_string()),
        user_notes: None,
        pinned: false,
        hidden: true,
        metadata_override: None,
    })
    .expect("add hidden DAI");
    let other_chain_token = "0x3333333333333333333333333333333333333333";
    add_watchlist_token(AddWatchlistTokenInput {
        chain_id: 8453,
        token_contract: other_chain_token.to_string(),
        label: Some("Other chain".to_string()),
        user_notes: None,
        pinned: false,
        hidden: false,
        metadata_override: None,
    })
    .expect("add other-chain token");

    for token_contract in [
        "0x4444444444444444444444444444444444444444",
        DAI,
        other_chain_token,
    ] {
        let (rpc_url, requests) = start_token_rpc_server(1, |request| {
            assert!(request.contains("eth_chainId"));
            rpc_result("\"0x1\"".to_string())
        });
        let error = scan_watchlist_balances(ScanWatchlistBalancesInput {
            rpc_url,
            chain_id: 1,
            accounts: Some(vec![ACCOUNT.to_string()]),
            token_contracts: Some(vec![token_contract.to_string()]),
            retry_failed_only: false,
            rpc_profile_id: None,
        })
        .await
        .expect_err("explicit token outside visible chain watchlist must fail");
        assert_eq!(
            error,
            "tokenContracts must all be non-hidden watchlist tokens for requested chainId"
        );
        assert_eq!(requests.lock().expect("requests").len(), 1);
    }

    let state = load_token_watchlist_state().expect("load state");
    assert!(state.token_metadata_cache.is_empty());
    assert!(state.token_scan_state.is_empty());
    assert!(state.erc20_balance_snapshots.is_empty());
}

#[tokio::test(flavor = "current_thread")]
async fn scanner_malformed_balance_is_recoverable_and_not_zero() {
    let _lock = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("token-scanner-balance-malformed");
    add_usdc();
    let (rpc_url, _requests) = start_token_rpc_server(5, |request| {
        if request.contains("eth_chainId") {
            rpc_result("\"0x1\"".to_string())
        } else if request.contains("313ce567") {
            rpc_result(u256_result_hex(U256::from(6u64)))
        } else if request.contains("95d89b41") {
            rpc_result(string_result_hex("USDC"))
        } else if request.contains("06fdde03") {
            rpc_result(string_result_hex("USD Coin"))
        } else if request.contains("70a08231") {
            rpc_result(raw_result_hex("01"))
        } else {
            rpc_result("null".to_string())
        }
    });

    let state = scan_erc20_balance(ScanErc20BalanceInput {
        rpc_url,
        chain_id: 1,
        account: ACCOUNT.to_string(),
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("malformed balance scan");

    let snapshot = &state.erc20_balance_snapshots[0];
    assert_eq!(snapshot.balance_status, BalanceStatus::MalformedBalance);
    assert_eq!(snapshot.balance_raw, "0");
    assert!(snapshot.last_error_summary.is_some());
}

#[tokio::test(flavor = "current_thread")]
async fn scanner_override_conflict_is_resolved_metadata_status_on_snapshot() {
    let _lock = test_lock().lock().expect("test lock");
    let _app_dir = TestAppDirGuard::new("token-scanner-source-conflict");
    add_watchlist_token(AddWatchlistTokenInput {
        chain_id: 1,
        token_contract: USDC.to_string(),
        label: None,
        user_notes: None,
        pinned: false,
        hidden: false,
        metadata_override: Some(MetadataOverrideInput {
            symbol: Some("USDC".to_string()),
            name: Some("USD Coin".to_string()),
            decimals: Some(18),
            source: Some("userConfirmed".to_string()),
            confirmed_at: Some("1700000000".to_string()),
        }),
    })
    .expect("add token with override");
    let (rpc_url, _requests) = start_token_rpc_server(5, |request| {
        standard_token_rpc_payload(request, U256::from(50u64))
    });

    let state = scan_erc20_balance(ScanErc20BalanceInput {
        rpc_url,
        chain_id: 1,
        account: ACCOUNT.to_string(),
        token_contract: USDC.to_string(),
        rpc_profile_id: None,
    })
    .await
    .expect("scan balance");

    assert_eq!(
        state.resolved_token_metadata[0].status,
        ResolvedMetadataStatus::SourceConflict
    );
    assert_eq!(state.resolved_token_metadata[0].decimals, Some(18));
    let snapshot = &state.erc20_balance_snapshots[0];
    assert_eq!(snapshot.balance_status, BalanceStatus::Ok);
    assert_eq!(
        snapshot.metadata_status_ref,
        Some(ResolvedMetadataStatus::SourceConflict)
    );
    assert_eq!(
        snapshot
            .resolved_metadata
            .as_ref()
            .and_then(|item| item.decimals),
        Some(18)
    );
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
