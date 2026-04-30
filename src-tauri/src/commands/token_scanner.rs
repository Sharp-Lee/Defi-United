use std::str::FromStr;

use ethers::abi::{decode, ParamType, Token};
use ethers::providers::{Http, Middleware, Provider};
use ethers::types::transaction::eip2718::TypedTransaction;
use ethers::types::{Address, Bytes, TransactionRequest, U256};
use ethers::utils::to_checksum;
use serde::Deserialize;

use crate::commands::token_watchlist::{
    load_token_watchlist_state, upsert_allowance_snapshot, upsert_asset_scan_job,
    upsert_erc20_balance_snapshot, upsert_nft_approval_snapshot, upsert_token_metadata_cache,
    upsert_token_scan_state, AllowanceSnapshotStatus, ApprovalSourceKind, ApprovalWatchKind,
    AssetScanJobStatus, BalanceStatus, NftApprovalSnapshotStatus, RawMetadataStatus,
    ResolvedTokenMetadataSnapshot, SourceMetadataInput, TokenScanStatus, TokenWatchlistState,
    UpsertAllowanceSnapshotInput, UpsertAssetScanJobInput, UpsertErc20BalanceSnapshotInput,
    UpsertNftApprovalSnapshotInput, UpsertTokenMetadataCacheInput, UpsertTokenScanStateInput,
};
use crate::diagnostics::sanitize_diagnostic_message;

const ERC20_DECIMALS_SELECTOR: [u8; 4] = [0x31, 0x3c, 0xe5, 0x67];
const ERC20_SYMBOL_SELECTOR: [u8; 4] = [0x95, 0xd8, 0x9b, 0x41];
const ERC20_NAME_SELECTOR: [u8; 4] = [0x06, 0xfd, 0xde, 0x03];
const ERC20_BALANCE_OF_SELECTOR: [u8; 4] = [0x70, 0xa0, 0x82, 0x31];
const ERC20_ALLOWANCE_SELECTOR: [u8; 4] = [0xdd, 0x62, 0xed, 0x3e];
const NFT_IS_APPROVED_FOR_ALL_SELECTOR: [u8; 4] = [0xe9, 0x85, 0xe9, 0xc5];
const ERC721_GET_APPROVED_SELECTOR: [u8; 4] = [0x08, 0x18, 0x12, 0xfc];
const ZERO_ADDRESS: &str = "0x0000000000000000000000000000000000000000";

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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanErc20AllowanceInput {
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    pub spender: String,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanNftOperatorApprovalInput {
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    pub operator: String,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanErc721TokenApprovalInput {
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(alias = "token_id")]
    pub token_id: String,
    #[serde(default)]
    pub operator: Option<String>,
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

#[tauri::command]
pub async fn scan_erc20_allowance(
    input: ScanErc20AllowanceInput,
) -> Result<TokenWatchlistState, String> {
    scan_allowance_impl(
        &input.rpc_url,
        input.chain_id,
        &input.owner,
        &input.token_contract,
        &input.spender,
        input.rpc_profile_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn scan_nft_operator_approval(
    input: ScanNftOperatorApprovalInput,
) -> Result<TokenWatchlistState, String> {
    scan_nft_operator_approval_impl(
        &input.rpc_url,
        input.chain_id,
        &input.owner,
        &input.token_contract,
        &input.operator,
        input.rpc_profile_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn scan_erc721_token_approval(
    input: ScanErc721TokenApprovalInput,
) -> Result<TokenWatchlistState, String> {
    scan_erc721_token_approval_impl(
        &input.rpc_url,
        input.chain_id,
        &input.owner,
        &input.token_contract,
        &input.token_id,
        input.operator.as_deref(),
        input.rpc_profile_id.as_deref(),
    )
    .await
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

async fn scan_allowance_impl(
    rpc_url: &str,
    chain_id: u64,
    owner: &str,
    token_contract: &str,
    spender: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    let chain_id = normalize_chain_id(chain_id)?;
    let owner = normalize_evm_address(owner, "owner")?;
    let token_contract = normalize_evm_address(token_contract, "token contract")?;
    let spender = normalize_evm_address(spender, "spender")?;
    let rpc_identity = summarize_rpc_endpoint(rpc_url);
    mark_approval_job_started(
        chain_id,
        &owner,
        &token_contract,
        &rpc_identity,
        rpc_profile_id,
    )?;
    let provider = match Provider::<Http>::try_from(rpc_url) {
        Ok(provider) => provider,
        Err(error) => {
            let message = sanitized_summary(format!("rpc provider invalid: {error}"));
            let had_previous =
                previous_displayable_allowance(&owner, chain_id, &token_contract, &spender)?;
            upsert_allowance_scan_failure(
                chain_id,
                &owner,
                &token_contract,
                &spender,
                classify_allowance_failure(&message, had_previous),
                Some(message),
                &rpc_identity,
                rpc_profile_id,
            )?;
            return mark_approval_job_finished(
                chain_id,
                &owner,
                &token_contract,
                AssetScanJobStatus::SourceUnavailable,
                Some("rpc provider invalid".to_string()),
                &rpc_identity,
                rpc_profile_id,
            );
        }
    };

    let actual = match provider.get_chainid().await {
        Ok(value) => value.as_u64(),
        Err(error) => {
            let message = sanitized_summary(format!("rpc chainId probe failed: {error}"));
            let had_previous =
                previous_displayable_allowance(&owner, chain_id, &token_contract, &spender)?;
            upsert_allowance_scan_failure(
                chain_id,
                &owner,
                &token_contract,
                &spender,
                classify_allowance_failure(&message, had_previous),
                Some(message.clone()),
                &rpc_identity,
                rpc_profile_id,
            )?;
            return mark_approval_job_finished(
                chain_id,
                &owner,
                &token_contract,
                AssetScanJobStatus::SourceUnavailable,
                Some(message),
                &rpc_identity,
                rpc_profile_id,
            );
        }
    };
    if actual != chain_id {
        let message = chain_mismatch_message(chain_id, actual);
        upsert_allowance_scan_failure(
            chain_id,
            &owner,
            &token_contract,
            &spender,
            AllowanceSnapshotStatus::ChainMismatch,
            Some(message.clone()),
            &rpc_identity,
            rpc_profile_id,
        )?;
        return mark_approval_job_finished(
            chain_id,
            &owner,
            &token_contract,
            AssetScanJobStatus::ChainMismatch,
            Some(message),
            &rpc_identity,
            rpc_profile_id,
        );
    }

    let token_address = parse_address(&token_contract, "token contract")?;
    let owner_address = parse_address(&owner, "owner")?;
    let spender_address = parse_address(&spender, "spender")?;
    let call: TypedTransaction = TransactionRequest::new()
        .to(token_address)
        .data(build_two_address_calldata(
            ERC20_ALLOWANCE_SELECTOR,
            owner_address,
            spender_address,
        ))
        .into();
    match provider.call(&call, None).await {
        Ok(bytes) => match decode_u256_result(&bytes, "allowance") {
            Ok(allowance) => {
                let status = if allowance.is_zero() {
                    AllowanceSnapshotStatus::Zero
                } else {
                    AllowanceSnapshotStatus::Active
                };
                upsert_allowance_snapshot(UpsertAllowanceSnapshotInput {
                    chain_id,
                    owner: owner.clone(),
                    token_contract: token_contract.clone(),
                    spender: spender.clone(),
                    allowance_raw: Some(allowance.to_string()),
                    status,
                    source: Some(rpc_point_source()),
                    last_scanned_at: Some(nowish()),
                    clear_last_scanned_at: false,
                    last_error_summary: None,
                    clear_last_error_summary: true,
                    stale_after: None,
                    clear_stale_after: true,
                    rpc_identity: Some(rpc_identity.to_string()),
                    clear_rpc_identity: false,
                    rpc_profile_id: rpc_profile_id.map(str::to_string),
                    clear_rpc_profile_id: rpc_profile_id.is_none(),
                })?;
                mark_approval_job_finished(
                    chain_id,
                    &owner,
                    &token_contract,
                    AssetScanJobStatus::Ok,
                    None,
                    &rpc_identity,
                    rpc_profile_id,
                )
            }
            Err(message) => {
                let message = sanitized_summary(message);
                let had_previous =
                    previous_displayable_allowance(&owner, chain_id, &token_contract, &spender)?;
                upsert_allowance_scan_failure(
                    chain_id,
                    &owner,
                    &token_contract,
                    &spender,
                    classify_allowance_failure(&message, had_previous),
                    Some(message.clone()),
                    &rpc_identity,
                    rpc_profile_id,
                )?;
                mark_approval_job_finished(
                    chain_id,
                    &owner,
                    &token_contract,
                    AssetScanJobStatus::Failed,
                    Some(message),
                    &rpc_identity,
                    rpc_profile_id,
                )
            }
        },
        Err(error) => {
            let message = sanitized_summary(format!("allowanceCallFailed: {error}"));
            let had_previous =
                previous_displayable_allowance(&owner, chain_id, &token_contract, &spender)?;
            upsert_allowance_scan_failure(
                chain_id,
                &owner,
                &token_contract,
                &spender,
                classify_allowance_failure(&message, had_previous),
                Some(message.clone()),
                &rpc_identity,
                rpc_profile_id,
            )?;
            mark_approval_job_finished(
                chain_id,
                &owner,
                &token_contract,
                classify_job_failure(&message),
                Some(message),
                &rpc_identity,
                rpc_profile_id,
            )
        }
    }
}

async fn scan_nft_operator_approval_impl(
    rpc_url: &str,
    chain_id: u64,
    owner: &str,
    token_contract: &str,
    operator: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    let chain_id = normalize_chain_id(chain_id)?;
    let owner = normalize_evm_address(owner, "owner")?;
    let token_contract = normalize_evm_address(token_contract, "token contract")?;
    let operator = normalize_evm_address(operator, "operator")?;
    let rpc_identity = summarize_rpc_endpoint(rpc_url);
    mark_approval_job_started(
        chain_id,
        &owner,
        &token_contract,
        &rpc_identity,
        rpc_profile_id,
    )?;
    let provider = match Provider::<Http>::try_from(rpc_url) {
        Ok(provider) => provider,
        Err(error) => {
            let message = sanitized_summary(format!("rpc provider invalid: {error}"));
            let had_previous = previous_displayable_nft_approval(
                &owner,
                chain_id,
                &token_contract,
                ApprovalWatchKind::Erc721ApprovalForAll,
                &operator,
                None,
            )?;
            upsert_nft_approval_scan_failure(
                NftApprovalFailureTarget {
                    chain_id,
                    owner: &owner,
                    token_contract: &token_contract,
                    kind: ApprovalWatchKind::Erc721ApprovalForAll,
                    operator: &operator,
                    token_id: None,
                },
                classify_nft_approval_failure(&message, had_previous),
                Some(message),
                &rpc_identity,
                rpc_profile_id,
            )?;
            return mark_approval_job_finished(
                chain_id,
                &owner,
                &token_contract,
                AssetScanJobStatus::SourceUnavailable,
                Some("rpc provider invalid".to_string()),
                &rpc_identity,
                rpc_profile_id,
            );
        }
    };

    let actual = match provider.get_chainid().await {
        Ok(value) => value.as_u64(),
        Err(error) => {
            let message = sanitized_summary(format!("rpc chainId probe failed: {error}"));
            let had_previous = previous_displayable_nft_approval(
                &owner,
                chain_id,
                &token_contract,
                ApprovalWatchKind::Erc721ApprovalForAll,
                &operator,
                None,
            )?;
            upsert_nft_approval_scan_failure(
                NftApprovalFailureTarget {
                    chain_id,
                    owner: &owner,
                    token_contract: &token_contract,
                    kind: ApprovalWatchKind::Erc721ApprovalForAll,
                    operator: &operator,
                    token_id: None,
                },
                classify_nft_approval_failure(&message, had_previous),
                Some(message.clone()),
                &rpc_identity,
                rpc_profile_id,
            )?;
            return mark_approval_job_finished(
                chain_id,
                &owner,
                &token_contract,
                AssetScanJobStatus::SourceUnavailable,
                Some(message),
                &rpc_identity,
                rpc_profile_id,
            );
        }
    };
    if actual != chain_id {
        let message = chain_mismatch_message(chain_id, actual);
        upsert_nft_approval_scan_failure(
            NftApprovalFailureTarget {
                chain_id,
                owner: &owner,
                token_contract: &token_contract,
                kind: ApprovalWatchKind::Erc721ApprovalForAll,
                operator: &operator,
                token_id: None,
            },
            NftApprovalSnapshotStatus::ChainMismatch,
            Some(message.clone()),
            &rpc_identity,
            rpc_profile_id,
        )?;
        return mark_approval_job_finished(
            chain_id,
            &owner,
            &token_contract,
            AssetScanJobStatus::ChainMismatch,
            Some(message),
            &rpc_identity,
            rpc_profile_id,
        );
    }

    let token_address = parse_address(&token_contract, "token contract")?;
    let owner_address = parse_address(&owner, "owner")?;
    let operator_address = parse_address(&operator, "operator")?;
    let call: TypedTransaction = TransactionRequest::new()
        .to(token_address)
        .data(build_two_address_calldata(
            NFT_IS_APPROVED_FOR_ALL_SELECTOR,
            owner_address,
            operator_address,
        ))
        .into();
    match provider.call(&call, None).await {
        Ok(bytes) => match decode_bool_result(&bytes, "isApprovedForAll") {
            Ok(approved) => {
                let status = if approved {
                    NftApprovalSnapshotStatus::Active
                } else {
                    NftApprovalSnapshotStatus::Revoked
                };
                upsert_nft_approval_snapshot(UpsertNftApprovalSnapshotInput {
                    chain_id,
                    owner: owner.clone(),
                    token_contract: token_contract.clone(),
                    kind: ApprovalWatchKind::Erc721ApprovalForAll,
                    operator: operator.clone(),
                    token_id: None,
                    approved: Some(approved),
                    status,
                    source: Some(rpc_point_source()),
                    last_scanned_at: Some(nowish()),
                    clear_last_scanned_at: false,
                    last_error_summary: None,
                    clear_last_error_summary: true,
                    stale_after: None,
                    clear_stale_after: true,
                    rpc_identity: Some(rpc_identity.to_string()),
                    clear_rpc_identity: false,
                    rpc_profile_id: rpc_profile_id.map(str::to_string),
                    clear_rpc_profile_id: rpc_profile_id.is_none(),
                })?;
                mark_approval_job_finished(
                    chain_id,
                    &owner,
                    &token_contract,
                    AssetScanJobStatus::Ok,
                    None,
                    &rpc_identity,
                    rpc_profile_id,
                )
            }
            Err(message) => {
                let message = sanitized_summary(message);
                let had_previous = previous_displayable_nft_approval(
                    &owner,
                    chain_id,
                    &token_contract,
                    ApprovalWatchKind::Erc721ApprovalForAll,
                    &operator,
                    None,
                )?;
                upsert_nft_approval_scan_failure(
                    NftApprovalFailureTarget {
                        chain_id,
                        owner: &owner,
                        token_contract: &token_contract,
                        kind: ApprovalWatchKind::Erc721ApprovalForAll,
                        operator: &operator,
                        token_id: None,
                    },
                    classify_nft_approval_failure(&message, had_previous),
                    Some(message.clone()),
                    &rpc_identity,
                    rpc_profile_id,
                )?;
                mark_approval_job_finished(
                    chain_id,
                    &owner,
                    &token_contract,
                    AssetScanJobStatus::Failed,
                    Some(message),
                    &rpc_identity,
                    rpc_profile_id,
                )
            }
        },
        Err(error) => {
            let message = sanitized_summary(format!("approvalForAllCallFailed: {error}"));
            let had_previous = previous_displayable_nft_approval(
                &owner,
                chain_id,
                &token_contract,
                ApprovalWatchKind::Erc721ApprovalForAll,
                &operator,
                None,
            )?;
            upsert_nft_approval_scan_failure(
                NftApprovalFailureTarget {
                    chain_id,
                    owner: &owner,
                    token_contract: &token_contract,
                    kind: ApprovalWatchKind::Erc721ApprovalForAll,
                    operator: &operator,
                    token_id: None,
                },
                classify_nft_approval_failure(&message, had_previous),
                Some(message.clone()),
                &rpc_identity,
                rpc_profile_id,
            )?;
            mark_approval_job_finished(
                chain_id,
                &owner,
                &token_contract,
                classify_job_failure(&message),
                Some(message),
                &rpc_identity,
                rpc_profile_id,
            )
        }
    }
}

async fn scan_erc721_token_approval_impl(
    rpc_url: &str,
    chain_id: u64,
    owner: &str,
    token_contract: &str,
    token_id: &str,
    operator_hint: Option<&str>,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    let chain_id = normalize_chain_id(chain_id)?;
    let owner = normalize_evm_address(owner, "owner")?;
    let token_contract = normalize_evm_address(token_contract, "token contract")?;
    let token_id = normalize_token_id(token_id)?;
    let operator_hint = operator_hint
        .map(|operator| normalize_evm_address(operator, "operator"))
        .transpose()?;
    let rpc_identity = summarize_rpc_endpoint(rpc_url);
    mark_approval_job_started(
        chain_id,
        &owner,
        &token_contract,
        &rpc_identity,
        rpc_profile_id,
    )?;
    let provider = match Provider::<Http>::try_from(rpc_url) {
        Ok(provider) => provider,
        Err(error) => {
            let message = sanitized_summary(format!("rpc provider invalid: {error}"));
            let operator = token_approval_failure_operator(
                &owner,
                chain_id,
                &token_contract,
                &token_id,
                operator_hint.as_deref(),
            )?;
            let had_previous = previous_displayable_nft_approval(
                &owner,
                chain_id,
                &token_contract,
                ApprovalWatchKind::Erc721TokenApproval,
                &operator,
                Some(&token_id),
            )?;
            upsert_nft_approval_scan_failure(
                NftApprovalFailureTarget {
                    chain_id,
                    owner: &owner,
                    token_contract: &token_contract,
                    kind: ApprovalWatchKind::Erc721TokenApproval,
                    operator: &operator,
                    token_id: Some(&token_id),
                },
                classify_nft_approval_failure(&message, had_previous),
                Some(message),
                &rpc_identity,
                rpc_profile_id,
            )?;
            return mark_approval_job_finished(
                chain_id,
                &owner,
                &token_contract,
                AssetScanJobStatus::SourceUnavailable,
                Some("rpc provider invalid".to_string()),
                &rpc_identity,
                rpc_profile_id,
            );
        }
    };

    let actual = match provider.get_chainid().await {
        Ok(value) => value.as_u64(),
        Err(error) => {
            let message = sanitized_summary(format!("rpc chainId probe failed: {error}"));
            let operator = token_approval_failure_operator(
                &owner,
                chain_id,
                &token_contract,
                &token_id,
                operator_hint.as_deref(),
            )?;
            let had_previous = previous_displayable_nft_approval(
                &owner,
                chain_id,
                &token_contract,
                ApprovalWatchKind::Erc721TokenApproval,
                &operator,
                Some(&token_id),
            )?;
            upsert_nft_approval_scan_failure(
                NftApprovalFailureTarget {
                    chain_id,
                    owner: &owner,
                    token_contract: &token_contract,
                    kind: ApprovalWatchKind::Erc721TokenApproval,
                    operator: &operator,
                    token_id: Some(&token_id),
                },
                classify_nft_approval_failure(&message, had_previous),
                Some(message.clone()),
                &rpc_identity,
                rpc_profile_id,
            )?;
            return mark_approval_job_finished(
                chain_id,
                &owner,
                &token_contract,
                AssetScanJobStatus::SourceUnavailable,
                Some(message),
                &rpc_identity,
                rpc_profile_id,
            );
        }
    };
    if actual != chain_id {
        let message = chain_mismatch_message(chain_id, actual);
        let operator = token_approval_failure_operator(
            &owner,
            chain_id,
            &token_contract,
            &token_id,
            operator_hint.as_deref(),
        )?;
        upsert_nft_approval_scan_failure(
            NftApprovalFailureTarget {
                chain_id,
                owner: &owner,
                token_contract: &token_contract,
                kind: ApprovalWatchKind::Erc721TokenApproval,
                operator: &operator,
                token_id: Some(&token_id),
            },
            NftApprovalSnapshotStatus::ChainMismatch,
            Some(message.clone()),
            &rpc_identity,
            rpc_profile_id,
        )?;
        return mark_approval_job_finished(
            chain_id,
            &owner,
            &token_contract,
            AssetScanJobStatus::ChainMismatch,
            Some(message),
            &rpc_identity,
            rpc_profile_id,
        );
    }

    let token_address = parse_address(&token_contract, "token contract")?;
    let token_id_value = U256::from_dec_str(&token_id).map_err(|_| {
        "tokenId must be a non-negative integer string within uint256 range".to_string()
    })?;
    let call: TypedTransaction = TransactionRequest::new()
        .to(token_address)
        .data(build_u256_calldata(
            ERC721_GET_APPROVED_SELECTOR,
            token_id_value,
        ))
        .into();
    match provider.call(&call, None).await {
        Ok(bytes) => match decode_address_result(&bytes, "getApproved") {
            Ok(approved_address) => {
                let approved = approved_address != Address::zero();
                let status = if approved {
                    NftApprovalSnapshotStatus::Active
                } else {
                    NftApprovalSnapshotStatus::Revoked
                };
                let operator = if approved {
                    to_checksum(&approved_address, None)
                } else {
                    token_approval_failure_operator(
                        &owner,
                        chain_id,
                        &token_contract,
                        &token_id,
                        operator_hint.as_deref(),
                    )?
                };
                upsert_nft_approval_snapshot(UpsertNftApprovalSnapshotInput {
                    chain_id,
                    owner: owner.clone(),
                    token_contract: token_contract.clone(),
                    kind: ApprovalWatchKind::Erc721TokenApproval,
                    operator: operator.clone(),
                    token_id: Some(token_id.clone()),
                    approved: Some(approved),
                    status,
                    source: Some(rpc_point_source()),
                    last_scanned_at: Some(nowish()),
                    clear_last_scanned_at: false,
                    last_error_summary: None,
                    clear_last_error_summary: true,
                    stale_after: None,
                    clear_stale_after: true,
                    rpc_identity: Some(rpc_identity.to_string()),
                    clear_rpc_identity: false,
                    rpc_profile_id: rpc_profile_id.map(str::to_string),
                    clear_rpc_profile_id: rpc_profile_id.is_none(),
                })?;
                mark_token_approval_operators_revoked(
                    &owner,
                    chain_id,
                    &token_contract,
                    &token_id,
                    approved.then_some(operator.as_str()),
                    &rpc_identity,
                    rpc_profile_id,
                )?;
                mark_approval_job_finished(
                    chain_id,
                    &owner,
                    &token_contract,
                    AssetScanJobStatus::Ok,
                    None,
                    &rpc_identity,
                    rpc_profile_id,
                )
            }
            Err(message) => {
                let message = sanitized_summary(message);
                let operator = token_approval_failure_operator(
                    &owner,
                    chain_id,
                    &token_contract,
                    &token_id,
                    operator_hint.as_deref(),
                )?;
                let had_previous = previous_displayable_nft_approval(
                    &owner,
                    chain_id,
                    &token_contract,
                    ApprovalWatchKind::Erc721TokenApproval,
                    &operator,
                    Some(&token_id),
                )?;
                upsert_nft_approval_scan_failure(
                    NftApprovalFailureTarget {
                        chain_id,
                        owner: &owner,
                        token_contract: &token_contract,
                        kind: ApprovalWatchKind::Erc721TokenApproval,
                        operator: &operator,
                        token_id: Some(&token_id),
                    },
                    classify_nft_approval_failure(&message, had_previous),
                    Some(message.clone()),
                    &rpc_identity,
                    rpc_profile_id,
                )?;
                mark_approval_job_finished(
                    chain_id,
                    &owner,
                    &token_contract,
                    AssetScanJobStatus::Failed,
                    Some(message),
                    &rpc_identity,
                    rpc_profile_id,
                )
            }
        },
        Err(error) => {
            let message = sanitized_summary(format!("getApprovedCallFailed: {error}"));
            let operator = token_approval_failure_operator(
                &owner,
                chain_id,
                &token_contract,
                &token_id,
                operator_hint.as_deref(),
            )?;
            let had_previous = previous_displayable_nft_approval(
                &owner,
                chain_id,
                &token_contract,
                ApprovalWatchKind::Erc721TokenApproval,
                &operator,
                Some(&token_id),
            )?;
            upsert_nft_approval_scan_failure(
                NftApprovalFailureTarget {
                    chain_id,
                    owner: &owner,
                    token_contract: &token_contract,
                    kind: ApprovalWatchKind::Erc721TokenApproval,
                    operator: &operator,
                    token_id: Some(&token_id),
                },
                classify_nft_approval_failure(&message, had_previous),
                Some(message.clone()),
                &rpc_identity,
                rpc_profile_id,
            )?;
            mark_approval_job_finished(
                chain_id,
                &owner,
                &token_contract,
                classify_job_failure(&message),
                Some(message),
                &rpc_identity,
                rpc_profile_id,
            )
        }
    }
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

fn upsert_allowance_scan_failure(
    chain_id: u64,
    owner: &str,
    token_contract: &str,
    spender: &str,
    status: AllowanceSnapshotStatus,
    last_error_summary: Option<String>,
    rpc_identity: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    upsert_allowance_snapshot(UpsertAllowanceSnapshotInput {
        chain_id,
        owner: owner.to_string(),
        token_contract: token_contract.to_string(),
        spender: spender.to_string(),
        allowance_raw: None,
        status,
        source: Some(approval_failure_source(status)),
        last_scanned_at: Some(nowish()),
        clear_last_scanned_at: false,
        last_error_summary,
        clear_last_error_summary: false,
        stale_after: None,
        clear_stale_after: false,
        rpc_identity: Some(rpc_identity.to_string()),
        clear_rpc_identity: false,
        rpc_profile_id: rpc_profile_id.map(str::to_string),
        clear_rpc_profile_id: rpc_profile_id.is_none(),
    })
}

struct NftApprovalFailureTarget<'a> {
    chain_id: u64,
    owner: &'a str,
    token_contract: &'a str,
    kind: ApprovalWatchKind,
    operator: &'a str,
    token_id: Option<&'a str>,
}

fn upsert_nft_approval_scan_failure(
    target: NftApprovalFailureTarget<'_>,
    status: NftApprovalSnapshotStatus,
    last_error_summary: Option<String>,
    rpc_identity: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    upsert_nft_approval_snapshot(UpsertNftApprovalSnapshotInput {
        chain_id: target.chain_id,
        owner: target.owner.to_string(),
        token_contract: target.token_contract.to_string(),
        kind: target.kind,
        operator: target.operator.to_string(),
        token_id: target.token_id.map(str::to_string),
        approved: None,
        status,
        source: Some(nft_approval_failure_source(status)),
        last_scanned_at: Some(nowish()),
        clear_last_scanned_at: false,
        last_error_summary,
        clear_last_error_summary: false,
        stale_after: None,
        clear_stale_after: false,
        rpc_identity: Some(rpc_identity.to_string()),
        clear_rpc_identity: false,
        rpc_profile_id: rpc_profile_id.map(str::to_string),
        clear_rpc_profile_id: rpc_profile_id.is_none(),
    })
}

fn mark_approval_job_started(
    chain_id: u64,
    owner: &str,
    token_contract: &str,
    rpc_identity: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    upsert_asset_scan_job(UpsertAssetScanJobInput {
        job_id: None,
        chain_id,
        owner: owner.to_string(),
        status: AssetScanJobStatus::Scanning,
        source: Some(rpc_point_source()),
        contract_filter: Some(token_contract.to_string()),
        clear_contract_filter: false,
        started_at: Some(nowish()),
        clear_started_at: false,
        finished_at: None,
        clear_finished_at: true,
        last_error_summary: None,
        clear_last_error_summary: true,
        rpc_identity: Some(rpc_identity.to_string()),
        clear_rpc_identity: false,
        rpc_profile_id: rpc_profile_id.map(str::to_string),
        clear_rpc_profile_id: rpc_profile_id.is_none(),
    })
}

fn mark_approval_job_finished(
    chain_id: u64,
    owner: &str,
    token_contract: &str,
    status: AssetScanJobStatus,
    last_error_summary: Option<String>,
    rpc_identity: &str,
    rpc_profile_id: Option<&str>,
) -> Result<TokenWatchlistState, String> {
    upsert_asset_scan_job(UpsertAssetScanJobInput {
        job_id: None,
        chain_id,
        owner: owner.to_string(),
        status,
        source: Some(if matches!(status, AssetScanJobStatus::Ok) {
            rpc_point_source()
        } else {
            unavailable_source()
        }),
        contract_filter: Some(token_contract.to_string()),
        clear_contract_filter: false,
        started_at: None,
        clear_started_at: false,
        finished_at: Some(nowish()),
        clear_finished_at: false,
        last_error_summary,
        clear_last_error_summary: matches!(status, AssetScanJobStatus::Ok),
        rpc_identity: Some(rpc_identity.to_string()),
        clear_rpc_identity: false,
        rpc_profile_id: rpc_profile_id.map(str::to_string),
        clear_rpc_profile_id: rpc_profile_id.is_none(),
    })
}

fn rpc_point_source() -> SourceMetadataInput {
    SourceMetadataInput {
        kind: ApprovalSourceKind::RpcPointRead,
        label: None,
        source_id: None,
        summary: None,
        provider_hint: None,
        observed_at: Some(nowish()),
    }
}

fn unavailable_source() -> SourceMetadataInput {
    SourceMetadataInput {
        kind: ApprovalSourceKind::Unavailable,
        label: None,
        source_id: None,
        summary: None,
        provider_hint: None,
        observed_at: Some(nowish()),
    }
}

fn approval_failure_source(status: AllowanceSnapshotStatus) -> SourceMetadataInput {
    if matches!(status, AllowanceSnapshotStatus::Stale) {
        rpc_point_source()
    } else {
        unavailable_source()
    }
}

fn nft_approval_failure_source(status: NftApprovalSnapshotStatus) -> SourceMetadataInput {
    if matches!(status, NftApprovalSnapshotStatus::Stale) {
        rpc_point_source()
    } else {
        unavailable_source()
    }
}

fn classify_allowance_failure(message: &str, had_previous: bool) -> AllowanceSnapshotStatus {
    if had_previous {
        AllowanceSnapshotStatus::Stale
    } else if looks_rate_limited(message) {
        AllowanceSnapshotStatus::RateLimited
    } else if looks_source_unavailable(message) {
        AllowanceSnapshotStatus::SourceUnavailable
    } else {
        AllowanceSnapshotStatus::ReadFailed
    }
}

fn classify_nft_approval_failure(message: &str, had_previous: bool) -> NftApprovalSnapshotStatus {
    if had_previous {
        NftApprovalSnapshotStatus::Stale
    } else if looks_rate_limited(message) {
        NftApprovalSnapshotStatus::RateLimited
    } else if looks_source_unavailable(message) {
        NftApprovalSnapshotStatus::SourceUnavailable
    } else {
        NftApprovalSnapshotStatus::ReadFailed
    }
}

fn classify_job_failure(message: &str) -> AssetScanJobStatus {
    if looks_source_unavailable(message) || looks_rate_limited(message) {
        AssetScanJobStatus::SourceUnavailable
    } else {
        AssetScanJobStatus::Failed
    }
}

fn looks_rate_limited(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("rate limit")
        || lower.contains("rate-limit")
        || lower.contains("too many requests")
        || lower.contains("429")
}

fn looks_source_unavailable(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("connection")
        || lower.contains("unavailable")
        || lower.contains("temporarily unavailable")
        || lower.contains("provider invalid")
        || lower.contains("chainid probe failed")
}

fn previous_displayable_allowance(
    owner: &str,
    chain_id: u64,
    token_contract: &str,
    spender: &str,
) -> Result<bool, String> {
    let state = load_token_watchlist_state()?;
    Ok(state.allowance_snapshots.iter().any(|item| {
        item.owner == owner
            && item.chain_id == chain_id
            && item.token_contract == token_contract
            && item.spender == spender
            && matches!(
                item.status,
                AllowanceSnapshotStatus::Active
                    | AllowanceSnapshotStatus::Zero
                    | AllowanceSnapshotStatus::Stale
            )
    }))
}

fn previous_displayable_nft_approval(
    owner: &str,
    chain_id: u64,
    token_contract: &str,
    kind: ApprovalWatchKind,
    operator: &str,
    token_id: Option<&str>,
) -> Result<bool, String> {
    let state = load_token_watchlist_state()?;
    Ok(state.nft_approval_snapshots.iter().any(|item| {
        item.owner == owner
            && item.chain_id == chain_id
            && item.token_contract == token_contract
            && item.kind == kind
            && item.operator == operator
            && item.token_id.as_deref() == token_id
            && matches!(
                item.status,
                NftApprovalSnapshotStatus::Active
                    | NftApprovalSnapshotStatus::Revoked
                    | NftApprovalSnapshotStatus::Stale
            )
    }))
}

fn token_approval_failure_operator(
    owner: &str,
    chain_id: u64,
    token_contract: &str,
    token_id: &str,
    operator_hint: Option<&str>,
) -> Result<String, String> {
    if let Some(operator) = operator_hint {
        return Ok(operator.to_string());
    }
    let state = load_token_watchlist_state()?;
    Ok(state
        .nft_approval_snapshots
        .iter()
        .find(|item| {
            item.owner == owner
                && item.chain_id == chain_id
                && item.token_contract == token_contract
                && item.kind == ApprovalWatchKind::Erc721TokenApproval
                && item.token_id.as_deref() == Some(token_id)
                && matches!(
                    item.status,
                    NftApprovalSnapshotStatus::Active
                        | NftApprovalSnapshotStatus::Revoked
                        | NftApprovalSnapshotStatus::Stale
                )
        })
        .map(|item| item.operator.clone())
        .unwrap_or_else(|| ZERO_ADDRESS.to_string()))
}

fn mark_token_approval_operators_revoked(
    owner: &str,
    chain_id: u64,
    token_contract: &str,
    token_id: &str,
    except_operator: Option<&str>,
    rpc_identity: &str,
    rpc_profile_id: Option<&str>,
) -> Result<(), String> {
    let state = load_token_watchlist_state()?;
    let stale_operators = state
        .nft_approval_snapshots
        .iter()
        .filter(|item| {
            item.owner == owner
                && item.chain_id == chain_id
                && item.token_contract == token_contract
                && item.kind == ApprovalWatchKind::Erc721TokenApproval
                && item.token_id.as_deref() == Some(token_id)
                && except_operator != Some(item.operator.as_str())
                && item.operator != ZERO_ADDRESS
        })
        .map(|item| item.operator.clone())
        .collect::<Vec<_>>();
    for operator in stale_operators {
        upsert_nft_approval_snapshot(UpsertNftApprovalSnapshotInput {
            chain_id,
            owner: owner.to_string(),
            token_contract: token_contract.to_string(),
            kind: ApprovalWatchKind::Erc721TokenApproval,
            operator,
            token_id: Some(token_id.to_string()),
            approved: Some(false),
            status: NftApprovalSnapshotStatus::Revoked,
            source: Some(rpc_point_source()),
            last_scanned_at: Some(nowish()),
            clear_last_scanned_at: false,
            last_error_summary: None,
            clear_last_error_summary: true,
            stale_after: None,
            clear_stale_after: true,
            rpc_identity: Some(rpc_identity.to_string()),
            clear_rpc_identity: false,
            rpc_profile_id: rpc_profile_id.map(str::to_string),
            clear_rpc_profile_id: rpc_profile_id.is_none(),
        })?;
    }
    Ok(())
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

fn build_two_address_calldata(selector: [u8; 4], first: Address, second: Address) -> Bytes {
    let mut data = Vec::with_capacity(68);
    data.extend_from_slice(&selector);
    data.extend_from_slice(&[0u8; 12]);
    data.extend_from_slice(first.as_bytes());
    data.extend_from_slice(&[0u8; 12]);
    data.extend_from_slice(second.as_bytes());
    Bytes::from(data)
}

fn build_u256_calldata(selector: [u8; 4], value: U256) -> Bytes {
    let mut word = [0u8; 32];
    value.to_big_endian(&mut word);
    let mut data = Vec::with_capacity(36);
    data.extend_from_slice(&selector);
    data.extend_from_slice(&word);
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
    decode_u256_result(bytes, "balanceOf")
}

fn decode_u256_result(bytes: &Bytes, method: &str) -> Result<U256, String> {
    let raw = bytes.as_ref();
    if raw.len() != 32 {
        return Err(format!(
            "{method} returned {} bytes; expected 32-byte uint256 ABI payload",
            raw.len()
        ));
    }
    Ok(U256::from_big_endian(raw))
}

fn decode_bool_result(bytes: &Bytes, method: &str) -> Result<bool, String> {
    let value = decode_u256_result(bytes, method)?;
    if value.is_zero() {
        Ok(false)
    } else if value == U256::one() {
        Ok(true)
    } else {
        Err(format!("{method} returned non-boolean uint256 value"))
    }
}

fn decode_address_result(bytes: &Bytes, method: &str) -> Result<Address, String> {
    let raw = bytes.as_ref();
    if raw.len() != 32 {
        return Err(format!(
            "{method} returned {} bytes; expected 32-byte address ABI payload",
            raw.len()
        ));
    }
    if raw[..12].iter().any(|byte| *byte != 0) {
        return Err(format!("{method} returned malformed address padding"));
    }
    Ok(Address::from_slice(&raw[12..]))
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

fn normalize_token_id(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("tokenId must be a non-negative integer string".to_string());
    }
    let normalized = trimmed.trim_start_matches('0');
    let token_id = if normalized.is_empty() {
        "0".to_string()
    } else {
        normalized.to_string()
    };
    U256::from_dec_str(&token_id)
        .map_err(|_| "tokenId must be a non-negative integer string within uint256 range")?;
    Ok(token_id)
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
