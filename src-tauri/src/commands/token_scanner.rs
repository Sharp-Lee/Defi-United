use std::str::FromStr;

use ethers::abi::{decode, ParamType, Token};
use ethers::providers::{Http, Middleware, Provider};
use ethers::types::transaction::eip2718::TypedTransaction;
use ethers::types::{Address, Bytes, TransactionRequest, U256};
use ethers::utils::to_checksum;
use serde::Deserialize;

use crate::commands::token_watchlist::{
    load_token_watchlist_state, upsert_erc20_balance_snapshot, upsert_token_metadata_cache,
    upsert_token_scan_state, BalanceStatus, RawMetadataStatus, ResolvedTokenMetadataSnapshot,
    TokenScanStatus, TokenWatchlistState, UpsertErc20BalanceSnapshotInput,
    UpsertTokenMetadataCacheInput, UpsertTokenScanStateInput,
};
use crate::diagnostics::sanitize_diagnostic_message;

const ERC20_DECIMALS_SELECTOR: [u8; 4] = [0x31, 0x3c, 0xe5, 0x67];
const ERC20_SYMBOL_SELECTOR: [u8; 4] = [0x95, 0xd8, 0x9b, 0x41];
const ERC20_NAME_SELECTOR: [u8; 4] = [0x06, 0xfd, 0xde, 0x03];
const ERC20_BALANCE_OF_SELECTOR: [u8; 4] = [0x70, 0xa0, 0x82, 0x31];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanWatchlistTokenMetadataInput {
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanErc20BalanceInput {
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub account: String,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanWatchlistBalancesInput {
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(default)]
    pub accounts: Option<Vec<String>>,
    #[serde(default, alias = "token_contracts")]
    pub token_contracts: Option<Vec<String>>,
    #[serde(default, alias = "retry_failed_only")]
    pub retry_failed_only: bool,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
}

#[tauri::command]
pub async fn scan_watchlist_token_metadata(
    input: ScanWatchlistTokenMetadataInput,
) -> Result<TokenWatchlistState, String> {
    scan_metadata_impl(
        &input.rpc_url,
        input.chain_id,
        &input.token_contract,
        input.rpc_profile_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn scan_erc20_balance(
    input: ScanErc20BalanceInput,
) -> Result<TokenWatchlistState, String> {
    scan_balance_impl(
        &input.rpc_url,
        input.chain_id,
        &input.account,
        &input.token_contract,
        input.rpc_profile_id.as_deref(),
        true,
    )
    .await
}

#[tauri::command]
pub async fn scan_watchlist_balances(
    input: ScanWatchlistBalancesInput,
) -> Result<TokenWatchlistState, String> {
    let chain_id = normalize_chain_id(input.chain_id)?;
    let rpc_identity = summarize_rpc_endpoint(&input.rpc_url);
    let provider = match Provider::<Http>::try_from(input.rpc_url.as_str()) {
        Ok(provider) => provider,
        Err(error) => {
            let message = sanitized_summary(format!("rpc provider invalid: {error}"));
            return mark_bulk_rpc_failed(
                chain_id,
                input.accounts.as_deref(),
                input.token_contracts.as_deref(),
                input.retry_failed_only,
                &message,
                &rpc_identity,
                input.rpc_profile_id.as_deref(),
            );
        }
    };

    match provider.get_chainid().await {
        Ok(actual) if actual.as_u64() == chain_id => {}
        Ok(actual) => {
            let message = chain_mismatch_message(chain_id, actual.as_u64());
            return mark_bulk_chain_mismatch(
                chain_id,
                actual.as_u64(),
                input.accounts.as_deref(),
                input.token_contracts.as_deref(),
                input.retry_failed_only,
                &rpc_identity,
                input.rpc_profile_id.as_deref(),
            )
            .map_err(|error| format!("{message}; {error}"));
        }
        Err(error) => {
            let message = sanitized_summary(format!("rpc chainId probe failed: {error}"));
            return mark_bulk_rpc_failed(
                chain_id,
                input.accounts.as_deref(),
                input.token_contracts.as_deref(),
                input.retry_failed_only,
                &message,
                &rpc_identity,
                input.rpc_profile_id.as_deref(),
            );
        }
    }

    let state = load_token_watchlist_state()?;
    let accounts = selected_accounts(input.accounts.as_deref())?;
    let mut token_contracts = selected_token_contracts(
        &state,
        chain_id,
        input.token_contracts.as_deref(),
        Some(&accounts),
        input.retry_failed_only,
    )?;
    token_contracts.sort();
    token_contracts.dedup();

    let mut latest = state;
    for token_contract in token_contracts {
        latest = scan_metadata_with_provider(
            provider.clone(),
            &rpc_identity,
            chain_id,
            &token_contract,
            input.rpc_profile_id.as_deref(),
        )
        .await?;
        for account in &accounts {
            latest = scan_balance_with_provider(
                provider.clone(),
                &rpc_identity,
                chain_id,
                account,
                &token_contract,
                input.rpc_profile_id.as_deref(),
                false,
            )
            .await?;
        }
    }
    Ok(latest)
}

async fn scan_metadata_impl(
    rpc_url: &str,
    chain_id: u64,
    token_contract: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    let chain_id = normalize_chain_id(chain_id)?;
    let token_contract = normalize_evm_address(token_contract, "token contract")?;
    let rpc_identity = summarize_rpc_endpoint(rpc_url);
    let provider = match Provider::<Http>::try_from(rpc_url.to_string()) {
        Ok(provider) => provider,
        Err(error) => {
            let message = sanitized_summary(format!("rpc provider invalid: {error}"));
            return upsert_token_scan_state(UpsertTokenScanStateInput {
                chain_id,
                token_contract,
                status: TokenScanStatus::Failed,
                last_started_at: None,
                clear_last_started_at: false,
                last_finished_at: Some(nowish()),
                clear_last_finished_at: false,
                last_error_summary: Some(message),
                clear_last_error_summary: false,
                rpc_identity: Some(rpc_identity),
                clear_rpc_identity: false,
                rpc_profile_id: rpc_profile_id.map(str::to_string),
                clear_rpc_profile_id: rpc_profile_id.is_none(),
            });
        }
    };

    let actual = match provider.get_chainid().await {
        Ok(value) => value.as_u64(),
        Err(error) => {
            let message = sanitized_summary(format!("rpc chainId probe failed: {error}"));
            return upsert_token_scan_state(UpsertTokenScanStateInput {
                chain_id,
                token_contract,
                status: TokenScanStatus::Failed,
                last_started_at: None,
                clear_last_started_at: false,
                last_finished_at: Some(nowish()),
                clear_last_finished_at: false,
                last_error_summary: Some(message),
                clear_last_error_summary: false,
                rpc_identity: Some(rpc_identity),
                clear_rpc_identity: false,
                rpc_profile_id: rpc_profile_id.map(str::to_string),
                clear_rpc_profile_id: rpc_profile_id.is_none(),
            });
        }
    };
    if actual != chain_id {
        return mark_metadata_chain_mismatch(
            chain_id,
            &token_contract,
            actual,
            &rpc_identity,
            rpc_profile_id,
        );
    }

    scan_metadata_with_provider(
        provider,
        &rpc_identity,
        chain_id,
        &token_contract,
        rpc_profile_id,
    )
    .await
}

async fn scan_balance_impl(
    rpc_url: &str,
    chain_id: u64,
    account: &str,
    token_contract: &str,
    rpc_profile_id: Option<&str>,
    refresh_metadata: bool,
) -> Result<TokenWatchlistState, String> {
    let chain_id = normalize_chain_id(chain_id)?;
    let account = normalize_evm_address(account, "account")?;
    let token_contract = normalize_evm_address(token_contract, "token contract")?;
    let rpc_identity = summarize_rpc_endpoint(rpc_url);
    let provider = match Provider::<Http>::try_from(rpc_url) {
        Ok(provider) => provider,
        Err(error) => {
            let message = sanitized_summary(format!("rpc provider invalid: {error}"));
            return upsert_balance_snapshot(
                &account,
                chain_id,
                &token_contract,
                None,
                BalanceStatus::RpcFailed,
                Some(message),
                &rpc_identity,
                rpc_profile_id,
            );
        }
    };

    let actual = match provider.get_chainid().await {
        Ok(value) => value.as_u64(),
        Err(error) => {
            let message = sanitized_summary(format!("rpc chainId probe failed: {error}"));
            return upsert_balance_snapshot(
                &account,
                chain_id,
                &token_contract,
                None,
                BalanceStatus::RpcFailed,
                Some(message),
                &rpc_identity,
                rpc_profile_id,
            );
        }
    };
    if actual != chain_id {
        return mark_balance_chain_mismatch(
            chain_id,
            &account,
            &token_contract,
            actual,
            &rpc_identity,
            rpc_profile_id,
        );
    }

    if refresh_metadata {
        scan_metadata_with_provider(
            provider.clone(),
            &rpc_identity,
            chain_id,
            &token_contract,
            rpc_profile_id,
        )
        .await?;
    }

    scan_balance_with_provider(
        provider,
        &rpc_identity,
        chain_id,
        &account,
        &token_contract,
        rpc_profile_id,
        false,
    )
    .await
}

async fn scan_metadata_with_provider(
    provider: Provider<Http>,
    rpc_identity: &str,
    chain_id: u64,
    token_contract: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    let token_address = parse_address(token_contract, "token contract")?;
    let started_at = nowish();
    upsert_token_scan_state(UpsertTokenScanStateInput {
        chain_id,
        token_contract: token_contract.to_string(),
        status: TokenScanStatus::Scanning,
        last_started_at: Some(started_at),
        clear_last_started_at: false,
        last_finished_at: None,
        clear_last_finished_at: false,
        last_error_summary: None,
        clear_last_error_summary: true,
        rpc_identity: Some(rpc_identity.to_string()),
        clear_rpc_identity: false,
        rpc_profile_id: rpc_profile_id.map(str::to_string),
        clear_rpc_profile_id: rpc_profile_id.is_none(),
    })?;

    let decimals = call_erc20_metadata(&provider, token_address, ERC20_DECIMALS_SELECTOR).await;
    let symbol = call_erc20_metadata(&provider, token_address, ERC20_SYMBOL_SELECTOR).await;
    let name = call_erc20_metadata(&provider, token_address, ERC20_NAME_SELECTOR).await;

    let (raw_decimals, decimals_error, decimals_failed) = match decimals {
        Ok(bytes) => match decode_decimals(&bytes) {
            Ok(value) => (Some(value), None, false),
            Err(MetadataDecodeError::Missing) => {
                (None, Some("decimals() returned no data".to_string()), false)
            }
            Err(MetadataDecodeError::Malformed(message)) => (None, Some(message), false),
        },
        Err(error) => (None, Some(error), true),
    };
    let (raw_symbol, symbol_error, symbol_failed) = decode_optional_text_call(symbol, "symbol()");
    let (raw_name, name_error, name_failed) = decode_optional_text_call(name, "name()");

    let existing = load_token_watchlist_state()?
        .token_metadata_cache
        .into_iter()
        .find(|item| item.chain_id == chain_id && item.token_contract == token_contract);
    let previous_decimals = existing.as_ref().and_then(|item| item.raw_decimals);
    let status = if raw_decimals.is_some()
        && previous_decimals.is_some()
        && previous_decimals != raw_decimals
    {
        RawMetadataStatus::DecimalsChanged
    } else if raw_decimals.is_some() {
        RawMetadataStatus::Ok
    } else if decimals_error
        .as_deref()
        .is_some_and(|message| message.contains("returned no data"))
    {
        RawMetadataStatus::MissingDecimals
    } else if decimals_failed && symbol_failed && name_failed {
        RawMetadataStatus::NonErc20
    } else if decimals_failed {
        RawMetadataStatus::CallFailed
    } else {
        RawMetadataStatus::Malformed
    };

    let errors = [decimals_error, symbol_error, name_error]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let error_summary = if errors.is_empty() {
        None
    } else {
        Some(sanitized_summary(errors.join("; ")))
    };
    let scan_status = match status {
        RawMetadataStatus::Ok | RawMetadataStatus::DecimalsChanged if error_summary.is_none() => {
            TokenScanStatus::Ok
        }
        RawMetadataStatus::Ok | RawMetadataStatus::DecimalsChanged => TokenScanStatus::Partial,
        RawMetadataStatus::NonErc20 => TokenScanStatus::NonErc20,
        RawMetadataStatus::Malformed | RawMetadataStatus::MissingDecimals => {
            TokenScanStatus::Malformed
        }
        RawMetadataStatus::CallFailed => TokenScanStatus::Failed,
    };
    let finished_at = nowish();
    upsert_token_metadata_cache(UpsertTokenMetadataCacheInput {
        chain_id,
        token_contract: token_contract.to_string(),
        raw_symbol,
        raw_name,
        raw_decimals,
        source: Some("onChainCall".to_string()),
        status,
        last_scanned_at: Some(finished_at.clone()),
        last_error_summary: error_summary.clone(),
        observed_decimals: raw_decimals,
        previous_decimals: if status == RawMetadataStatus::DecimalsChanged {
            previous_decimals
        } else {
            None
        },
    })?;
    let state = upsert_token_scan_state(UpsertTokenScanStateInput {
        chain_id,
        token_contract: token_contract.to_string(),
        status: scan_status,
        last_started_at: None,
        clear_last_started_at: false,
        last_finished_at: Some(finished_at),
        clear_last_finished_at: false,
        last_error_summary: error_summary,
        clear_last_error_summary: scan_status == TokenScanStatus::Ok,
        rpc_identity: Some(rpc_identity.to_string()),
        clear_rpc_identity: false,
        rpc_profile_id: rpc_profile_id.map(str::to_string),
        clear_rpc_profile_id: rpc_profile_id.is_none(),
    })?;
    Ok(state)
}

async fn scan_balance_with_provider(
    provider: Provider<Http>,
    rpc_identity: &str,
    chain_id: u64,
    account: &str,
    token_contract: &str,
    rpc_profile_id: Option<&str>,
    _chain_already_checked: bool,
) -> Result<TokenWatchlistState, String> {
    let account_address = parse_address(account, "account")?;
    let token_address = parse_address(token_contract, "token contract")?;
    let call: TypedTransaction = TransactionRequest::new()
        .to(token_address)
        .data(build_balance_of_calldata(account_address))
        .into();
    let result = provider.call(&call, None).await;
    match result {
        Ok(bytes) => match decode_balance(&bytes) {
            Ok(balance) => {
                let status = if balance.is_zero() {
                    BalanceStatus::Zero
                } else {
                    BalanceStatus::Ok
                };
                upsert_balance_snapshot(
                    account,
                    chain_id,
                    token_contract,
                    Some(balance.to_string()),
                    status,
                    None,
                    rpc_identity,
                    rpc_profile_id,
                )
            }
            Err(message) => upsert_balance_snapshot(
                account,
                chain_id,
                token_contract,
                None,
                BalanceStatus::MalformedBalance,
                Some(sanitized_summary(message)),
                rpc_identity,
                rpc_profile_id,
            ),
        },
        Err(error) => {
            let status = if previous_displayable_balance(account, chain_id, token_contract)? {
                BalanceStatus::Stale
            } else {
                BalanceStatus::BalanceCallFailed
            };
            upsert_balance_snapshot(
                account,
                chain_id,
                token_contract,
                None,
                status,
                Some(sanitized_summary(format!("balanceCallFailed: {error}"))),
                rpc_identity,
                rpc_profile_id,
            )
        }
    }
}

fn upsert_balance_snapshot(
    account: &str,
    chain_id: u64,
    token_contract: &str,
    balance_raw: Option<String>,
    balance_status: BalanceStatus,
    last_error_summary: Option<String>,
    rpc_identity: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    let metadata = resolved_metadata_snapshot(chain_id, token_contract)?;
    upsert_erc20_balance_snapshot(UpsertErc20BalanceSnapshotInput {
        account: account.to_string(),
        chain_id,
        token_contract: token_contract.to_string(),
        balance_raw,
        balance_status,
        metadata_status_ref: metadata.as_ref().map(|item| item.status),
        clear_metadata_status_ref: metadata.is_none(),
        last_scanned_at: Some(nowish()),
        clear_last_scanned_at: false,
        last_error_summary,
        clear_last_error_summary: matches!(balance_status, BalanceStatus::Ok | BalanceStatus::Zero),
        rpc_identity: Some(rpc_identity.to_string()),
        clear_rpc_identity: false,
        rpc_profile_id: rpc_profile_id.map(str::to_string),
        clear_rpc_profile_id: rpc_profile_id.is_none(),
        resolved_metadata: metadata,
        clear_resolved_metadata: false,
    })
}

fn resolved_metadata_snapshot(
    chain_id: u64,
    token_contract: &str,
) -> Result<Option<ResolvedTokenMetadataSnapshot>, String> {
    let state = load_token_watchlist_state()?;
    Ok(state
        .resolved_token_metadata
        .into_iter()
        .find(|item| item.chain_id == chain_id && item.token_contract == token_contract)
        .map(|item| ResolvedTokenMetadataSnapshot {
            symbol: item.symbol,
            name: item.name,
            decimals: item.decimals,
            source: item.source,
            status: item.status,
        }))
}

fn mark_metadata_chain_mismatch(
    chain_id: u64,
    token_contract: &str,
    actual_chain_id: u64,
    rpc_identity: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    upsert_token_scan_state(UpsertTokenScanStateInput {
        chain_id,
        token_contract: token_contract.to_string(),
        status: TokenScanStatus::ChainMismatch,
        last_started_at: None,
        clear_last_started_at: false,
        last_finished_at: Some(nowish()),
        clear_last_finished_at: false,
        last_error_summary: Some(chain_mismatch_message(chain_id, actual_chain_id)),
        clear_last_error_summary: false,
        rpc_identity: Some(rpc_identity.to_string()),
        clear_rpc_identity: false,
        rpc_profile_id: rpc_profile_id.map(str::to_string),
        clear_rpc_profile_id: rpc_profile_id.is_none(),
    })
}

fn mark_balance_chain_mismatch(
    chain_id: u64,
    account: &str,
    token_contract: &str,
    actual_chain_id: u64,
    rpc_identity: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    upsert_balance_snapshot(
        account,
        chain_id,
        token_contract,
        None,
        BalanceStatus::ChainMismatch,
        Some(chain_mismatch_message(chain_id, actual_chain_id)),
        rpc_identity,
        rpc_profile_id,
    )
}

fn mark_bulk_chain_mismatch(
    chain_id: u64,
    actual_chain_id: u64,
    accounts: Option<&[String]>,
    token_contracts: Option<&[String]>,
    retry_failed_only: bool,
    rpc_identity: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    let state = load_token_watchlist_state()?;
    let accounts = selected_accounts(accounts)?;
    let tokens = selected_token_contracts(
        &state,
        chain_id,
        token_contracts,
        Some(&accounts),
        retry_failed_only,
    )?;
    let mut latest = state;
    for token_contract in tokens {
        latest = mark_metadata_chain_mismatch(
            chain_id,
            &token_contract,
            actual_chain_id,
            rpc_identity,
            rpc_profile_id,
        )?;
        for account in &accounts {
            latest = mark_balance_chain_mismatch(
                chain_id,
                account,
                &token_contract,
                actual_chain_id,
                rpc_identity,
                rpc_profile_id,
            )?;
        }
    }
    Ok(latest)
}

fn mark_bulk_rpc_failed(
    chain_id: u64,
    accounts: Option<&[String]>,
    token_contracts: Option<&[String]>,
    retry_failed_only: bool,
    message: &str,
    rpc_identity: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    let state = load_token_watchlist_state()?;
    let accounts = selected_accounts(accounts)?;
    let tokens = selected_token_contracts(
        &state,
        chain_id,
        token_contracts,
        Some(&accounts),
        retry_failed_only,
    )?;
    let mut latest = state;
    for token_contract in tokens {
        latest = upsert_token_scan_state(UpsertTokenScanStateInput {
            chain_id,
            token_contract: token_contract.clone(),
            status: TokenScanStatus::Failed,
            last_started_at: None,
            clear_last_started_at: false,
            last_finished_at: Some(nowish()),
            clear_last_finished_at: false,
            last_error_summary: Some(message.to_string()),
            clear_last_error_summary: false,
            rpc_identity: Some(rpc_identity.to_string()),
            clear_rpc_identity: false,
            rpc_profile_id: rpc_profile_id.map(str::to_string),
            clear_rpc_profile_id: rpc_profile_id.is_none(),
        })?;
        for account in &accounts {
            latest = upsert_balance_snapshot(
                account,
                chain_id,
                &token_contract,
                None,
                BalanceStatus::RpcFailed,
                Some(message.to_string()),
                rpc_identity,
                rpc_profile_id,
            )?;
        }
    }
    Ok(latest)
}

fn selected_token_contracts(
    state: &TokenWatchlistState,
    chain_id: u64,
    token_contracts: Option<&[String]>,
    accounts: Option<&[String]>,
    retry_failed_only: bool,
) -> Result<Vec<String>, String> {
    let watchlist_tokens = state
        .watchlist_tokens
        .iter()
        .filter(|item| item.chain_id == chain_id && !item.hidden)
        .map(|item| item.token_contract.clone())
        .collect::<Vec<_>>();
    let selected = if let Some(token_contracts) = token_contracts {
        let normalized = token_contracts
            .iter()
            .map(|value| normalize_evm_address(value, "token contract"))
            .collect::<Result<Vec<_>, _>>()?;
        if normalized
            .iter()
            .any(|token_contract| !watchlist_tokens.iter().any(|item| item == token_contract))
        {
            return Err(
                "tokenContracts must all be non-hidden watchlist tokens for requested chainId"
                    .to_string(),
            );
        }
        normalized
    } else {
        watchlist_tokens
    };
    if !retry_failed_only {
        return Ok(selected);
    }
    Ok(selected
        .into_iter()
        .filter(|token_contract| {
            let metadata_failed = state
                .token_scan_state
                .iter()
                .find(|item| item.chain_id == chain_id && item.token_contract == *token_contract)
                .map(|item| {
                    matches!(
                        item.status,
                        TokenScanStatus::Failed
                            | TokenScanStatus::ChainMismatch
                            | TokenScanStatus::NonErc20
                            | TokenScanStatus::Malformed
                            | TokenScanStatus::Partial
                    )
                })
                .unwrap_or(true);
            let balance_failed = accounts
                .map(|accounts| {
                    state.erc20_balance_snapshots.iter().any(|item| {
                        item.chain_id == chain_id
                            && item.token_contract == *token_contract
                            && accounts.iter().any(|account| account == &item.account)
                            && matches!(
                                item.balance_status,
                                BalanceStatus::BalanceCallFailed
                                    | BalanceStatus::MalformedBalance
                                    | BalanceStatus::RpcFailed
                                    | BalanceStatus::ChainMismatch
                                    | BalanceStatus::Stale
                            )
                    })
                })
                .unwrap_or(false);
            metadata_failed || balance_failed
        })
        .collect())
}

fn selected_accounts(accounts: Option<&[String]>) -> Result<Vec<String>, String> {
    let Some(accounts) = accounts else {
        return Err("at least one account is required to scan ERC-20 balances".to_string());
    };
    let normalized = accounts
        .iter()
        .map(|value| normalize_evm_address(value, "account"))
        .collect::<Result<Vec<_>, _>>()?;
    if normalized.is_empty() {
        return Err("at least one account is required to scan ERC-20 balances".to_string());
    }
    Ok(normalized)
}

async fn call_erc20_metadata(
    provider: &Provider<Http>,
    token: Address,
    selector: [u8; 4],
) -> Result<Bytes, String> {
    let call: TypedTransaction = TransactionRequest::new()
        .to(token)
        .data(Bytes::from(selector.to_vec()))
        .into();
    provider
        .call(&call, None)
        .await
        .map_err(|error| sanitized_summary(format!("eth_call failed: {error}")))
}

fn build_balance_of_calldata(owner: Address) -> Bytes {
    let mut data = Vec::with_capacity(36);
    data.extend_from_slice(&ERC20_BALANCE_OF_SELECTOR);
    data.extend_from_slice(&[0u8; 12]);
    data.extend_from_slice(owner.as_bytes());
    Bytes::from(data)
}

enum MetadataDecodeError {
    Missing,
    Malformed(String),
}

fn decode_decimals(bytes: &Bytes) -> Result<u8, MetadataDecodeError> {
    let raw = bytes.as_ref();
    if raw.is_empty() {
        return Err(MetadataDecodeError::Missing);
    }
    if raw.len() != 32 {
        return Err(MetadataDecodeError::Malformed(format!(
            "decimals() returned {} bytes; expected 32-byte uint256 ABI payload",
            raw.len()
        )));
    }
    let value = U256::from_big_endian(raw);
    if value > U256::from(u8::MAX) {
        return Err(MetadataDecodeError::Malformed(
            "decimals() returned a value larger than uint8".to_string(),
        ));
    }
    Ok(value.as_u32() as u8)
}

fn decode_optional_text_call(
    result: Result<Bytes, String>,
    method: &'static str,
) -> (Option<String>, Option<String>, bool) {
    match result {
        Ok(bytes) => match decode_stringish(&bytes) {
            Ok(value) => (value, None, false),
            Err(message) => (
                None,
                Some(format!("{method} malformed response: {message}")),
                false,
            ),
        },
        Err(error) => (None, Some(format!("{method} {error}")), true),
    }
}

fn decode_stringish(bytes: &Bytes) -> Result<Option<String>, String> {
    let raw = bytes.as_ref();
    if raw.is_empty() {
        return Ok(None);
    }
    if let Ok(tokens) = decode(&[ParamType::String], raw) {
        if let Some(Token::String(value)) = tokens.into_iter().next() {
            return Ok(non_empty(value));
        }
    }
    if raw.len() == 32 {
        let end = raw.iter().position(|byte| *byte == 0).unwrap_or(raw.len());
        let value = std::str::from_utf8(&raw[..end]).map_err(|_| "bytes32 is not utf8")?;
        return Ok(non_empty(value.to_string()));
    }
    Err(format!(
        "returned {} bytes; expected ABI string or bytes32",
        raw.len()
    ))
}

fn decode_balance(bytes: &Bytes) -> Result<U256, String> {
    let raw = bytes.as_ref();
    if raw.len() != 32 {
        return Err(format!(
            "balanceOf returned {} bytes; expected 32-byte uint256 ABI payload",
            raw.len()
        ));
    }
    Ok(U256::from_big_endian(raw))
}

fn previous_displayable_balance(
    account: &str,
    chain_id: u64,
    token_contract: &str,
) -> Result<bool, String> {
    let state = load_token_watchlist_state()?;
    Ok(state.erc20_balance_snapshots.iter().any(|item| {
        item.account == account
            && item.chain_id == chain_id
            && item.token_contract == token_contract
            && matches!(
                item.balance_status,
                BalanceStatus::Ok | BalanceStatus::Zero | BalanceStatus::Stale
            )
    }))
}

fn normalize_chain_id(chain_id: u64) -> Result<u64, String> {
    if chain_id == 0 {
        return Err("chainId must be greater than zero".to_string());
    }
    Ok(chain_id)
}

fn normalize_evm_address(value: &str, label: &str) -> Result<String, String> {
    let address = parse_address(value, label)?;
    if address == Address::zero() {
        return Err(format!("{label} cannot be the zero address"));
    }
    Ok(to_checksum(&address, None))
}

fn parse_address(value: &str, label: &str) -> Result<Address, String> {
    Address::from_str(value.trim()).map_err(|_| format!("{label} must be a valid EVM address"))
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn nowish() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn chain_mismatch_message(expected: u64, actual: u64) -> String {
    format!("chainId mismatch: expected {expected}, actual {actual}")
}

fn sanitized_summary(value: impl AsRef<str>) -> String {
    sanitize_diagnostic_message(value.as_ref())
}

fn summarize_rpc_endpoint(rpc_url: &str) -> String {
    let trimmed = rpc_url.trim();
    let Some((scheme, rest)) = trimmed.split_once("://") else {
        return "[redacted_endpoint]".to_string();
    };
    let scheme = scheme.to_ascii_lowercase();
    if scheme.is_empty()
        || !scheme
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
    {
        return "[redacted_endpoint]".to_string();
    }

    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .rsplit('@')
        .next()
        .unwrap_or_default();
    if authority.is_empty() || authority.contains(char::is_whitespace) {
        return "[redacted_endpoint]".to_string();
    }

    format!("{scheme}://{authority}")
}
