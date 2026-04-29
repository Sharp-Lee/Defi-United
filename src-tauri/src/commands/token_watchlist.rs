use std::fs;
use std::io::ErrorKind;
use std::str::FromStr;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use ethers::types::Address;
use ethers::utils::to_checksum;
use serde::{Deserialize, Serialize};

use crate::diagnostics::sanitize_diagnostic_message;
use crate::storage::{token_watchlist_path, write_file_atomic};

const TOKEN_WATCHLIST_SCHEMA_VERSION: u8 = 1;

fn token_watchlist_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn now_unix_seconds() -> Result<String, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenWatchlistState {
    pub schema_version: u8,
    pub watchlist_tokens: Vec<WatchlistTokenRecord>,
    pub token_metadata_cache: Vec<TokenMetadataCacheRecord>,
    pub token_scan_state: Vec<TokenScanStateRecord>,
    pub erc20_balance_snapshots: Vec<Erc20BalanceSnapshotRecord>,
    pub approval_watchlist: Vec<ApprovalWatchlistRecord>,
    pub asset_scan_jobs: Vec<AssetScanJobRecord>,
    pub asset_snapshots: Vec<AssetSnapshotRecord>,
    pub allowance_snapshots: Vec<AllowanceSnapshotRecord>,
    pub nft_approval_snapshots: Vec<NftApprovalSnapshotRecord>,
    pub resolved_token_metadata: Vec<ResolvedTokenMetadataRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredTokenWatchlistState {
    #[serde(default = "default_schema_version", alias = "schema_version")]
    schema_version: u8,
    #[serde(default, alias = "watchlist_tokens")]
    watchlist_tokens: Vec<WatchlistTokenRecord>,
    #[serde(default, alias = "token_metadata_cache")]
    token_metadata_cache: Vec<TokenMetadataCacheRecord>,
    #[serde(default, alias = "token_scan_state")]
    token_scan_state: Vec<TokenScanStateRecord>,
    #[serde(default, alias = "erc20_balance_snapshots")]
    erc20_balance_snapshots: Vec<Erc20BalanceSnapshotRecord>,
    #[serde(default, alias = "approval_watchlist")]
    approval_watchlist: Vec<ApprovalWatchlistRecord>,
    #[serde(default, alias = "asset_scan_jobs")]
    asset_scan_jobs: Vec<AssetScanJobRecord>,
    #[serde(default, alias = "asset_snapshots")]
    asset_snapshots: Vec<AssetSnapshotRecord>,
    #[serde(default, alias = "allowance_snapshots")]
    allowance_snapshots: Vec<AllowanceSnapshotRecord>,
    #[serde(default, alias = "nft_approval_snapshots")]
    nft_approval_snapshots: Vec<NftApprovalSnapshotRecord>,
}

impl Default for StoredTokenWatchlistState {
    fn default() -> Self {
        Self {
            schema_version: TOKEN_WATCHLIST_SCHEMA_VERSION,
            watchlist_tokens: Vec::new(),
            token_metadata_cache: Vec::new(),
            token_scan_state: Vec::new(),
            erc20_balance_snapshots: Vec::new(),
            approval_watchlist: Vec::new(),
            asset_scan_jobs: Vec::new(),
            asset_snapshots: Vec::new(),
            allowance_snapshots: Vec::new(),
            nft_approval_snapshots: Vec::new(),
        }
    }
}

fn default_schema_version() -> u8 {
    TOKEN_WATCHLIST_SCHEMA_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchlistTokenRecord {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, alias = "user_notes")]
    pub user_notes: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
    #[serde(default, alias = "metadata_override")]
    pub metadata_override: Option<MetadataOverrideRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataOverrideRecord {
    #[serde(default)]
    pub symbol: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub decimals: Option<u8>,
    pub source: UserMetadataSource,
    #[serde(alias = "confirmed_at")]
    pub confirmed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UserMetadataSource {
    UserConfirmed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenMetadataCacheRecord {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(default, alias = "raw_symbol")]
    pub raw_symbol: Option<String>,
    #[serde(default, alias = "raw_name")]
    pub raw_name: Option<String>,
    #[serde(default, alias = "raw_decimals")]
    pub raw_decimals: Option<u8>,
    pub source: RawMetadataSource,
    pub status: RawMetadataStatus,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
    #[serde(default, alias = "last_scanned_at")]
    pub last_scanned_at: Option<String>,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "observed_decimals")]
    pub observed_decimals: Option<u8>,
    #[serde(default, alias = "previous_decimals")]
    pub previous_decimals: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RawMetadataSource {
    OnChainCall,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RawMetadataStatus {
    Ok,
    MissingDecimals,
    Malformed,
    CallFailed,
    NonErc20,
    DecimalsChanged,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenScanStateRecord {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    pub status: TokenScanStatus,
    #[serde(default, alias = "created_at")]
    pub created_at: String,
    #[serde(default, alias = "last_started_at")]
    pub last_started_at: Option<String>,
    #[serde(default, alias = "last_finished_at")]
    pub last_finished_at: Option<String>,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TokenScanStatus {
    Idle,
    Scanning,
    Ok,
    Partial,
    Failed,
    ChainMismatch,
    NonErc20,
    Malformed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Erc20BalanceSnapshotRecord {
    pub account: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(alias = "balance_raw")]
    pub balance_raw: String,
    #[serde(alias = "balance_status")]
    pub balance_status: BalanceStatus,
    #[serde(default, alias = "created_at")]
    pub created_at: String,
    #[serde(default, alias = "metadata_status_ref")]
    pub metadata_status_ref: Option<ResolvedMetadataStatus>,
    #[serde(default, alias = "last_scanned_at")]
    pub last_scanned_at: Option<String>,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
    #[serde(default, alias = "resolved_metadata")]
    pub resolved_metadata: Option<ResolvedTokenMetadataSnapshot>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BalanceStatus {
    Ok,
    Zero,
    BalanceCallFailed,
    MalformedBalance,
    RpcFailed,
    ChainMismatch,
    Stale,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceMetadataRecord {
    pub kind: ApprovalSourceKind,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, alias = "source_id")]
    pub source_id: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default, alias = "provider_hint")]
    pub provider_hint: Option<String>,
    #[serde(default, alias = "observed_at")]
    pub observed_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalSourceKind {
    RpcPointRead,
    UserWatchlist,
    HistoryDerivedCandidate,
    ExplorerCandidate,
    IndexerCandidate,
    ManualImport,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalWatchKind {
    Erc20Allowance,
    Erc721ApprovalForAll,
    Erc721TokenApproval,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AssetKind {
    Erc20,
    Erc721,
    Erc1155,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AssetSnapshotStatus {
    Active,
    Zero,
    Unknown,
    Stale,
    ReadFailed,
    SourceUnavailable,
    RateLimited,
    ChainMismatch,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AllowanceSnapshotStatus {
    Active,
    Zero,
    Unknown,
    Stale,
    ReadFailed,
    SourceUnavailable,
    RateLimited,
    ChainMismatch,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NftApprovalSnapshotStatus {
    Active,
    Revoked,
    Unknown,
    Stale,
    ReadFailed,
    SourceUnavailable,
    RateLimited,
    ChainMismatch,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AssetScanJobStatus {
    Idle,
    Scanning,
    Ok,
    Partial,
    Failed,
    ChainMismatch,
    SourceUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalWatchlistRecord {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    pub kind: ApprovalWatchKind,
    #[serde(default)]
    pub spender: Option<String>,
    #[serde(default)]
    pub operator: Option<String>,
    #[serde(default, alias = "token_id")]
    pub token_id: Option<String>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, alias = "user_notes")]
    pub user_notes: Option<String>,
    pub source: SourceMetadataRecord,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssetScanJobRecord {
    #[serde(alias = "job_id")]
    pub job_id: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    pub status: AssetScanJobStatus,
    pub source: SourceMetadataRecord,
    #[serde(default, alias = "contract_filter")]
    pub contract_filter: Option<String>,
    #[serde(default, alias = "started_at")]
    pub started_at: Option<String>,
    #[serde(default, alias = "finished_at")]
    pub finished_at: Option<String>,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssetSnapshotRecord {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(alias = "asset_kind")]
    pub asset_kind: AssetKind,
    #[serde(default, alias = "token_id")]
    pub token_id: Option<String>,
    #[serde(default, alias = "balance_raw")]
    pub balance_raw: Option<String>,
    pub status: AssetSnapshotStatus,
    pub source: SourceMetadataRecord,
    #[serde(default, alias = "last_scanned_at")]
    pub last_scanned_at: Option<String>,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "stale_after")]
    pub stale_after: Option<String>,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AllowanceSnapshotRecord {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    pub spender: String,
    #[serde(alias = "allowance_raw")]
    pub allowance_raw: String,
    pub status: AllowanceSnapshotStatus,
    pub source: SourceMetadataRecord,
    #[serde(default, alias = "last_scanned_at")]
    pub last_scanned_at: Option<String>,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "stale_after")]
    pub stale_after: Option<String>,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NftApprovalSnapshotRecord {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    pub kind: ApprovalWatchKind,
    pub operator: String,
    #[serde(default, alias = "token_id")]
    pub token_id: Option<String>,
    #[serde(default, alias = "approved")]
    pub approved: Option<bool>,
    pub status: NftApprovalSnapshotStatus,
    pub source: SourceMetadataRecord,
    #[serde(default, alias = "last_scanned_at")]
    pub last_scanned_at: Option<String>,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "stale_after")]
    pub stale_after: Option<String>,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTokenMetadataRecord {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(default)]
    pub symbol: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub decimals: Option<u8>,
    pub source: ResolvedMetadataSource,
    pub status: ResolvedMetadataStatus,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTokenMetadataSnapshot {
    #[serde(default)]
    pub symbol: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub decimals: Option<u8>,
    pub source: ResolvedMetadataSource,
    pub status: ResolvedMetadataStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResolvedMetadataSource {
    OnChainCall,
    UserConfirmed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResolvedMetadataStatus {
    Ok,
    MissingDecimals,
    Malformed,
    CallFailed,
    NonErc20,
    DecimalsChanged,
    SourceConflict,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddWatchlistTokenInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, alias = "user_notes")]
    pub user_notes: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, alias = "metadata_override")]
    pub metadata_override: Option<MetadataOverrideInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditWatchlistTokenInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(default, alias = "new_chain_id")]
    pub new_chain_id: Option<u64>,
    #[serde(default, alias = "new_token_contract")]
    pub new_token_contract: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, alias = "clear_label")]
    pub clear_label: bool,
    #[serde(default, alias = "user_notes")]
    pub user_notes: Option<String>,
    #[serde(default, alias = "clear_user_notes")]
    pub clear_user_notes: bool,
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(default)]
    pub hidden: Option<bool>,
    #[serde(default, alias = "metadata_override")]
    pub metadata_override: Option<MetadataOverrideInput>,
    #[serde(default, alias = "clear_metadata_override")]
    pub clear_metadata_override: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveWatchlistTokenInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(default, alias = "clear_metadata_cache")]
    pub clear_metadata_cache: bool,
    #[serde(default, alias = "clear_scan_state")]
    pub clear_scan_state: bool,
    #[serde(default, alias = "clear_snapshots")]
    pub clear_snapshots: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataOverrideInput {
    #[serde(default)]
    pub symbol: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub decimals: Option<u8>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default, alias = "confirmed_at")]
    pub confirmed_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertTokenMetadataCacheInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(default, alias = "raw_symbol")]
    pub raw_symbol: Option<String>,
    #[serde(default, alias = "raw_name")]
    pub raw_name: Option<String>,
    #[serde(default, alias = "raw_decimals")]
    pub raw_decimals: Option<u8>,
    #[serde(default)]
    pub source: Option<String>,
    pub status: RawMetadataStatus,
    #[serde(default, alias = "last_scanned_at")]
    pub last_scanned_at: Option<String>,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "observed_decimals")]
    pub observed_decimals: Option<u8>,
    #[serde(default, alias = "previous_decimals")]
    pub previous_decimals: Option<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertTokenScanStateInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    pub status: TokenScanStatus,
    #[serde(default, alias = "last_started_at")]
    pub last_started_at: Option<String>,
    #[serde(default, alias = "clear_last_started_at")]
    pub clear_last_started_at: bool,
    #[serde(default, alias = "last_finished_at")]
    pub last_finished_at: Option<String>,
    #[serde(default, alias = "clear_last_finished_at")]
    pub clear_last_finished_at: bool,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "clear_last_error_summary")]
    pub clear_last_error_summary: bool,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "clear_rpc_identity")]
    pub clear_rpc_identity: bool,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
    #[serde(default, alias = "clear_rpc_profile_id")]
    pub clear_rpc_profile_id: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertErc20BalanceSnapshotInput {
    pub account: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(default, alias = "balance_raw")]
    pub balance_raw: Option<String>,
    #[serde(alias = "balance_status")]
    pub balance_status: BalanceStatus,
    #[serde(default, alias = "metadata_status_ref")]
    pub metadata_status_ref: Option<ResolvedMetadataStatus>,
    #[serde(default, alias = "clear_metadata_status_ref")]
    pub clear_metadata_status_ref: bool,
    #[serde(default, alias = "last_scanned_at")]
    pub last_scanned_at: Option<String>,
    #[serde(default, alias = "clear_last_scanned_at")]
    pub clear_last_scanned_at: bool,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "clear_last_error_summary")]
    pub clear_last_error_summary: bool,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "clear_rpc_identity")]
    pub clear_rpc_identity: bool,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
    #[serde(default, alias = "clear_rpc_profile_id")]
    pub clear_rpc_profile_id: bool,
    #[serde(default, alias = "resolved_metadata")]
    pub resolved_metadata: Option<ResolvedTokenMetadataSnapshot>,
    #[serde(default, alias = "clear_resolved_metadata")]
    pub clear_resolved_metadata: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMetadataInput {
    pub kind: ApprovalSourceKind,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, alias = "source_id")]
    pub source_id: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default, alias = "provider_hint")]
    pub provider_hint: Option<String>,
    #[serde(default, alias = "observed_at")]
    pub observed_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertApprovalWatchlistEntryInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    pub kind: ApprovalWatchKind,
    #[serde(default)]
    pub spender: Option<String>,
    #[serde(default)]
    pub operator: Option<String>,
    #[serde(default, alias = "token_id")]
    pub token_id: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, alias = "clear_label")]
    pub clear_label: bool,
    #[serde(default, alias = "user_notes")]
    pub user_notes: Option<String>,
    #[serde(default, alias = "clear_user_notes")]
    pub clear_user_notes: bool,
    #[serde(default)]
    pub source: Option<SourceMetadataInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAssetScanJobInput {
    #[serde(default, alias = "job_id")]
    pub job_id: Option<String>,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    pub status: AssetScanJobStatus,
    #[serde(default)]
    pub source: Option<SourceMetadataInput>,
    #[serde(default, alias = "contract_filter")]
    pub contract_filter: Option<String>,
    #[serde(default, alias = "clear_contract_filter")]
    pub clear_contract_filter: bool,
    #[serde(default, alias = "started_at")]
    pub started_at: Option<String>,
    #[serde(default, alias = "clear_started_at")]
    pub clear_started_at: bool,
    #[serde(default, alias = "finished_at")]
    pub finished_at: Option<String>,
    #[serde(default, alias = "clear_finished_at")]
    pub clear_finished_at: bool,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "clear_last_error_summary")]
    pub clear_last_error_summary: bool,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "clear_rpc_identity")]
    pub clear_rpc_identity: bool,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
    #[serde(default, alias = "clear_rpc_profile_id")]
    pub clear_rpc_profile_id: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAssetSnapshotInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    #[serde(alias = "asset_kind")]
    pub asset_kind: AssetKind,
    #[serde(default, alias = "token_id")]
    pub token_id: Option<String>,
    #[serde(default, alias = "balance_raw")]
    pub balance_raw: Option<String>,
    pub status: AssetSnapshotStatus,
    #[serde(default)]
    pub source: Option<SourceMetadataInput>,
    #[serde(default, alias = "last_scanned_at")]
    pub last_scanned_at: Option<String>,
    #[serde(default, alias = "clear_last_scanned_at")]
    pub clear_last_scanned_at: bool,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "clear_last_error_summary")]
    pub clear_last_error_summary: bool,
    #[serde(default, alias = "stale_after")]
    pub stale_after: Option<String>,
    #[serde(default, alias = "clear_stale_after")]
    pub clear_stale_after: bool,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "clear_rpc_identity")]
    pub clear_rpc_identity: bool,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
    #[serde(default, alias = "clear_rpc_profile_id")]
    pub clear_rpc_profile_id: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAllowanceSnapshotInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    pub spender: String,
    #[serde(default, alias = "allowance_raw")]
    pub allowance_raw: Option<String>,
    pub status: AllowanceSnapshotStatus,
    #[serde(default)]
    pub source: Option<SourceMetadataInput>,
    #[serde(default, alias = "last_scanned_at")]
    pub last_scanned_at: Option<String>,
    #[serde(default, alias = "clear_last_scanned_at")]
    pub clear_last_scanned_at: bool,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "clear_last_error_summary")]
    pub clear_last_error_summary: bool,
    #[serde(default, alias = "stale_after")]
    pub stale_after: Option<String>,
    #[serde(default, alias = "clear_stale_after")]
    pub clear_stale_after: bool,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "clear_rpc_identity")]
    pub clear_rpc_identity: bool,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
    #[serde(default, alias = "clear_rpc_profile_id")]
    pub clear_rpc_profile_id: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertNftApprovalSnapshotInput {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    #[serde(alias = "token_contract")]
    pub token_contract: String,
    pub kind: ApprovalWatchKind,
    pub operator: String,
    #[serde(default, alias = "token_id")]
    pub token_id: Option<String>,
    #[serde(default, alias = "approved")]
    pub approved: Option<bool>,
    pub status: NftApprovalSnapshotStatus,
    #[serde(default)]
    pub source: Option<SourceMetadataInput>,
    #[serde(default, alias = "last_scanned_at")]
    pub last_scanned_at: Option<String>,
    #[serde(default, alias = "clear_last_scanned_at")]
    pub clear_last_scanned_at: bool,
    #[serde(default, alias = "last_error_summary")]
    pub last_error_summary: Option<String>,
    #[serde(default, alias = "clear_last_error_summary")]
    pub clear_last_error_summary: bool,
    #[serde(default, alias = "stale_after")]
    pub stale_after: Option<String>,
    #[serde(default, alias = "clear_stale_after")]
    pub clear_stale_after: bool,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "clear_rpc_identity")]
    pub clear_rpc_identity: bool,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
    #[serde(default, alias = "clear_rpc_profile_id")]
    pub clear_rpc_profile_id: bool,
}

#[tauri::command]
pub fn load_token_watchlist_state() -> Result<TokenWatchlistState, String> {
    read_token_watchlist_state().map(into_read_state)
}

#[tauri::command]
pub fn add_watchlist_token(input: AddWatchlistTokenInput) -> Result<TokenWatchlistState, String> {
    let _guard = token_watchlist_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_token_watchlist_state_for_update()?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let token_contract = normalize_evm_address(&input.token_contract, "token contract")?;
    if token_index(&state.watchlist_tokens, chain_id, &token_contract).is_some() {
        return Err("watchlist token already exists".to_string());
    }

    let now = now_unix_seconds()?;
    state.watchlist_tokens.push(WatchlistTokenRecord {
        chain_id,
        token_contract,
        label: input.label.and_then(non_empty_string),
        user_notes: input.user_notes.and_then(non_empty_string),
        pinned: input.pinned,
        hidden: input.hidden,
        created_at: now.clone(),
        updated_at: now,
        metadata_override: normalize_metadata_override(input.metadata_override)?,
    });
    sort_state(&mut state);
    write_token_watchlist_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn edit_watchlist_token(input: EditWatchlistTokenInput) -> Result<TokenWatchlistState, String> {
    let _guard = token_watchlist_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_token_watchlist_state_for_update()?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let token_contract = normalize_evm_address(&input.token_contract, "token contract")?;
    let index = token_index(&state.watchlist_tokens, chain_id, &token_contract)
        .ok_or_else(|| "watchlist token not found".to_string())?;

    let next_chain_id = normalize_chain_id(input.new_chain_id.unwrap_or(chain_id))?;
    let next_token_contract = match input.new_token_contract.as_deref() {
        Some(value) => normalize_evm_address(value, "token contract")?,
        None => token_contract.clone(),
    };
    let identity_changed = next_chain_id != chain_id || next_token_contract != token_contract;
    if identity_changed
        && token_index(&state.watchlist_tokens, next_chain_id, &next_token_contract).is_some()
    {
        return Err("watchlist token already exists".to_string());
    }

    let mut record = state.watchlist_tokens.remove(index);
    let now = now_unix_seconds()?;
    if identity_changed {
        record.chain_id = next_chain_id;
        record.token_contract = next_token_contract;
        record.created_at = now.clone();
    }
    if input.metadata_override.is_some() && input.clear_metadata_override {
        return Err("metadataOverride and clearMetadataOverride cannot both be set".to_string());
    }
    if input.clear_label {
        record.label = None;
    } else if let Some(label) = input.label {
        record.label = non_empty_string(label);
    }
    if input.clear_user_notes {
        record.user_notes = None;
    } else if let Some(user_notes) = input.user_notes {
        record.user_notes = non_empty_string(user_notes);
    }
    if let Some(pinned) = input.pinned {
        record.pinned = pinned;
    }
    if let Some(hidden) = input.hidden {
        record.hidden = hidden;
    }
    if input.clear_metadata_override {
        record.metadata_override = None;
    } else if identity_changed {
        record.metadata_override = normalize_metadata_override(input.metadata_override)?;
    } else if input.metadata_override.is_some() {
        record.metadata_override = normalize_metadata_override(input.metadata_override)?;
    }
    record.updated_at = now;
    state.watchlist_tokens.push(record);
    sort_state(&mut state);
    write_token_watchlist_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn remove_watchlist_token(
    input: RemoveWatchlistTokenInput,
) -> Result<TokenWatchlistState, String> {
    let _guard = token_watchlist_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_token_watchlist_state_for_update()?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let token_contract = normalize_evm_address(&input.token_contract, "token contract")?;
    let before = state.watchlist_tokens.len();
    state.watchlist_tokens.retain(|item| {
        !token_matches(
            item.chain_id,
            &item.token_contract,
            chain_id,
            &token_contract,
        )
    });
    if state.watchlist_tokens.len() == before {
        return Err("watchlist token not found".to_string());
    }

    if input.clear_metadata_cache {
        state.token_metadata_cache.retain(|item| {
            !token_matches(
                item.chain_id,
                &item.token_contract,
                chain_id,
                &token_contract,
            )
        });
    }
    if input.clear_scan_state {
        state.token_scan_state.retain(|item| {
            !token_matches(
                item.chain_id,
                &item.token_contract,
                chain_id,
                &token_contract,
            )
        });
    }
    if input.clear_snapshots {
        state.erc20_balance_snapshots.retain(|item| {
            !token_matches(
                item.chain_id,
                &item.token_contract,
                chain_id,
                &token_contract,
            )
        });
    }
    write_token_watchlist_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn upsert_token_metadata_cache(
    input: UpsertTokenMetadataCacheInput,
) -> Result<TokenWatchlistState, String> {
    let _guard = token_watchlist_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_token_watchlist_state_for_update()?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let token_contract = normalize_evm_address(&input.token_contract, "token contract")?;
    validate_raw_metadata_source(input.source.as_deref())?;
    let now = now_unix_seconds()?;
    let existing_index =
        metadata_cache_index(&state.token_metadata_cache, chain_id, &token_contract);
    let existing = existing_index.and_then(|index| state.token_metadata_cache.get(index));
    let incoming_raw_symbol = input.raw_symbol.and_then(non_empty_string);
    let incoming_raw_name = input.raw_name.and_then(non_empty_string);
    let incoming_raw_decimals = input.raw_decimals;
    let preserve_existing_raw_metadata = should_preserve_existing_raw_metadata(input.status);
    let raw_symbol = if preserve_existing_raw_metadata {
        existing
            .and_then(|record| record.raw_symbol.clone())
            .or(incoming_raw_symbol)
    } else {
        incoming_raw_symbol
    };
    let raw_name = if preserve_existing_raw_metadata {
        existing
            .and_then(|record| record.raw_name.clone())
            .or(incoming_raw_name)
    } else {
        incoming_raw_name
    };
    let raw_decimals = if preserve_existing_raw_metadata {
        existing
            .and_then(|record| record.raw_decimals)
            .or(incoming_raw_decimals)
    } else {
        incoming_raw_decimals
    };
    let observed_decimals = if preserve_existing_raw_metadata {
        input
            .observed_decimals
            .or_else(|| existing.and_then(|record| record.observed_decimals))
    } else {
        input.observed_decimals.or(incoming_raw_decimals)
    };
    let previous_decimals = input.previous_decimals.or_else(|| {
        if preserve_existing_raw_metadata {
            return existing.and_then(|record| record.previous_decimals);
        }
        let existing_decimals = existing.and_then(|record| record.raw_decimals);
        if input.status == RawMetadataStatus::DecimalsChanged && existing_decimals != raw_decimals {
            existing_decimals
        } else {
            None
        }
    });
    let record = TokenMetadataCacheRecord {
        chain_id,
        token_contract,
        raw_symbol,
        raw_name,
        raw_decimals,
        source: RawMetadataSource::OnChainCall,
        status: input.status,
        created_at: existing
            .map(|record| record.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
        last_scanned_at: input.last_scanned_at,
        last_error_summary: sanitize_optional(input.last_error_summary),
        observed_decimals,
        previous_decimals,
    };
    upsert_by_index(&mut state.token_metadata_cache, existing_index, record);
    sort_state(&mut state);
    write_token_watchlist_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn upsert_token_scan_state(
    input: UpsertTokenScanStateInput,
) -> Result<TokenWatchlistState, String> {
    let _guard = token_watchlist_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_token_watchlist_state_for_update()?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let token_contract = normalize_evm_address(&input.token_contract, "token contract")?;
    let now = now_unix_seconds()?;
    let index = scan_state_index(&state.token_scan_state, chain_id, &token_contract);
    let existing = index.and_then(|index| state.token_scan_state.get(index).cloned());
    let created_at = index
        .and_then(|index| state.token_scan_state.get(index))
        .map(|record| non_empty_string(record.created_at.clone()).unwrap_or_else(|| now.clone()))
        .unwrap_or_else(|| now.clone());
    let record = TokenScanStateRecord {
        chain_id,
        token_contract,
        status: input.status,
        created_at,
        last_started_at: merge_optional_string(
            input.last_started_at,
            existing
                .as_ref()
                .and_then(|record| record.last_started_at.clone()),
            input.clear_last_started_at,
        ),
        last_finished_at: merge_optional_string(
            input.last_finished_at,
            existing
                .as_ref()
                .and_then(|record| record.last_finished_at.clone()),
            input.clear_last_finished_at,
        ),
        updated_at: now,
        last_error_summary: merge_optional_sanitized(
            input.last_error_summary,
            existing
                .as_ref()
                .and_then(|record| record.last_error_summary.clone()),
            input.clear_last_error_summary,
        ),
        rpc_identity: merge_optional_sanitized(
            input.rpc_identity,
            existing
                .as_ref()
                .and_then(|record| record.rpc_identity.clone()),
            input.clear_rpc_identity,
        ),
        rpc_profile_id: merge_optional_sanitized(
            input.rpc_profile_id,
            existing
                .as_ref()
                .and_then(|record| record.rpc_profile_id.clone()),
            input.clear_rpc_profile_id,
        ),
    };
    upsert_by_index(&mut state.token_scan_state, index, record);
    sort_state(&mut state);
    write_token_watchlist_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn upsert_erc20_balance_snapshot(
    input: UpsertErc20BalanceSnapshotInput,
) -> Result<TokenWatchlistState, String> {
    let _guard = token_watchlist_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_token_watchlist_state_for_update()?;
    let account = normalize_evm_address(&input.account, "account")?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let token_contract = normalize_evm_address(&input.token_contract, "token contract")?;
    let index = balance_snapshot_index(
        &state.erc20_balance_snapshots,
        &account,
        chain_id,
        &token_contract,
    );
    let existing = index.and_then(|index| state.erc20_balance_snapshots.get(index).cloned());
    let incoming_balance = match input.balance_raw {
        Some(value) => normalize_balance_raw(value)?,
        None => existing
            .as_ref()
            .map(|record| record.balance_raw.clone())
            .unwrap_or_else(|| "0".to_string()),
    };
    let balance_raw = preserve_success_balance_on_failure(
        existing.as_ref(),
        input.balance_status,
        incoming_balance,
    );
    let now = now_unix_seconds()?;
    let created_at = existing
        .as_ref()
        .map(|record| non_empty_string(record.created_at.clone()).unwrap_or_else(|| now.clone()))
        .unwrap_or_else(|| now.clone());
    let record = Erc20BalanceSnapshotRecord {
        account,
        chain_id,
        token_contract,
        balance_raw,
        balance_status: input.balance_status,
        created_at,
        metadata_status_ref: merge_optional_value(
            input.metadata_status_ref,
            existing
                .as_ref()
                .and_then(|record| record.metadata_status_ref),
            input.clear_metadata_status_ref,
        ),
        last_scanned_at: merge_optional_string(
            input.last_scanned_at,
            existing
                .as_ref()
                .and_then(|record| record.last_scanned_at.clone()),
            input.clear_last_scanned_at,
        ),
        updated_at: now,
        last_error_summary: merge_optional_sanitized(
            input.last_error_summary,
            existing
                .as_ref()
                .and_then(|record| record.last_error_summary.clone()),
            input.clear_last_error_summary,
        ),
        rpc_identity: merge_optional_sanitized(
            input.rpc_identity,
            existing
                .as_ref()
                .and_then(|record| record.rpc_identity.clone()),
            input.clear_rpc_identity,
        ),
        rpc_profile_id: merge_optional_sanitized(
            input.rpc_profile_id,
            existing
                .as_ref()
                .and_then(|record| record.rpc_profile_id.clone()),
            input.clear_rpc_profile_id,
        ),
        resolved_metadata: merge_optional_value(
            input.resolved_metadata,
            existing
                .as_ref()
                .and_then(|record| record.resolved_metadata.clone()),
            input.clear_resolved_metadata,
        ),
    };
    upsert_by_index(&mut state.erc20_balance_snapshots, index, record);
    sort_state(&mut state);
    write_token_watchlist_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn upsert_approval_watchlist_entry(
    input: UpsertApprovalWatchlistEntryInput,
) -> Result<TokenWatchlistState, String> {
    let _guard = token_watchlist_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_token_watchlist_state_for_update()?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let owner = normalize_evm_address(&input.owner, "owner")?;
    let token_contract = normalize_evm_address(&input.token_contract, "token contract")?;
    let (spender, operator, token_id) =
        normalize_approval_identity(input.kind, input.spender, input.operator, input.token_id)?;
    let index = approval_watchlist_index(
        &state.approval_watchlist,
        chain_id,
        &owner,
        &token_contract,
        input.kind,
        spender.as_deref(),
        operator.as_deref(),
        token_id.as_deref(),
    );
    let existing = index.and_then(|index| state.approval_watchlist.get(index).cloned());
    let now = now_unix_seconds()?;
    let created_at = existing
        .as_ref()
        .map(|record| non_empty_string(record.created_at.clone()).unwrap_or_else(|| now.clone()))
        .unwrap_or_else(|| now.clone());
    let record = ApprovalWatchlistRecord {
        chain_id,
        owner,
        token_contract,
        kind: input.kind,
        spender,
        operator,
        token_id,
        enabled: input
            .enabled
            .or_else(|| existing.as_ref().map(|record| record.enabled))
            .unwrap_or(true),
        label: merge_optional_sanitized(
            input.label,
            existing.as_ref().and_then(|record| record.label.clone()),
            input.clear_label,
        ),
        user_notes: merge_optional_sanitized(
            input.user_notes,
            existing
                .as_ref()
                .and_then(|record| record.user_notes.clone()),
            input.clear_user_notes,
        ),
        source: normalize_source_metadata(
            input.source,
            existing.as_ref().map(|record| record.source.clone()),
            ApprovalSourceKind::UserWatchlist,
        ),
        created_at,
        updated_at: now,
    };
    upsert_by_index(&mut state.approval_watchlist, index, record);
    sort_state(&mut state);
    write_token_watchlist_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn upsert_asset_scan_job(
    input: UpsertAssetScanJobInput,
) -> Result<TokenWatchlistState, String> {
    let _guard = token_watchlist_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_token_watchlist_state_for_update()?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let owner = normalize_evm_address(&input.owner, "owner")?;
    let contract_filter = match input.contract_filter {
        Some(value) => Some(normalize_evm_address(&value, "contract filter")?),
        None => None,
    };
    let job_id = asset_scan_job_id(chain_id, &owner, contract_filter.as_deref());
    if let Some(custom_job_id) = input.job_id.and_then(non_empty_string) {
        if custom_job_id != job_id {
            return Err("jobId must match chainId, owner, and contractFilter".to_string());
        }
    }
    let index = asset_scan_job_index(&state.asset_scan_jobs, &job_id);
    let existing = index.and_then(|index| state.asset_scan_jobs.get(index).cloned());
    let now = now_unix_seconds()?;
    let created_at = existing
        .as_ref()
        .map(|record| non_empty_string(record.created_at.clone()).unwrap_or_else(|| now.clone()))
        .unwrap_or_else(|| now.clone());
    let record = AssetScanJobRecord {
        job_id,
        chain_id,
        owner,
        status: input.status,
        source: normalize_source_metadata(
            input.source,
            existing.as_ref().map(|record| record.source.clone()),
            ApprovalSourceKind::RpcPointRead,
        ),
        contract_filter: merge_optional_value(
            contract_filter,
            existing
                .as_ref()
                .and_then(|record| record.contract_filter.clone()),
            input.clear_contract_filter,
        ),
        started_at: merge_optional_string(
            input.started_at,
            existing
                .as_ref()
                .and_then(|record| record.started_at.clone()),
            input.clear_started_at,
        ),
        finished_at: merge_optional_string(
            input.finished_at,
            existing
                .as_ref()
                .and_then(|record| record.finished_at.clone()),
            input.clear_finished_at,
        ),
        last_error_summary: merge_optional_sanitized(
            input.last_error_summary,
            existing
                .as_ref()
                .and_then(|record| record.last_error_summary.clone()),
            input.clear_last_error_summary,
        ),
        rpc_identity: merge_optional_sanitized(
            input.rpc_identity,
            existing
                .as_ref()
                .and_then(|record| record.rpc_identity.clone()),
            input.clear_rpc_identity,
        ),
        rpc_profile_id: merge_optional_sanitized(
            input.rpc_profile_id,
            existing
                .as_ref()
                .and_then(|record| record.rpc_profile_id.clone()),
            input.clear_rpc_profile_id,
        ),
        created_at,
        updated_at: now,
    };
    upsert_by_index(&mut state.asset_scan_jobs, index, record);
    sort_state(&mut state);
    write_token_watchlist_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn upsert_asset_snapshot(
    input: UpsertAssetSnapshotInput,
) -> Result<TokenWatchlistState, String> {
    let _guard = token_watchlist_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_token_watchlist_state_for_update()?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let owner = normalize_evm_address(&input.owner, "owner")?;
    let token_contract = normalize_evm_address(&input.token_contract, "token contract")?;
    let token_id = normalize_asset_snapshot_token_id(input.asset_kind, input.token_id)?;
    let balance_raw = match input.balance_raw {
        Some(value) => Some(normalize_balance_raw(value)?),
        None => None,
    };
    let index = asset_snapshot_index(
        &state.asset_snapshots,
        chain_id,
        &owner,
        &token_contract,
        input.asset_kind,
        token_id.as_deref(),
    );
    let existing = index.and_then(|index| state.asset_snapshots.get(index).cloned());
    let now = now_unix_seconds()?;
    let created_at = existing
        .as_ref()
        .map(|record| non_empty_string(record.created_at.clone()).unwrap_or_else(|| now.clone()))
        .unwrap_or_else(|| now.clone());
    let record = AssetSnapshotRecord {
        chain_id,
        owner,
        token_contract,
        asset_kind: input.asset_kind,
        token_id,
        balance_raw: if asset_status_is_failure(input.status) {
            existing
                .as_ref()
                .and_then(|record| record.balance_raw.clone())
                .or(balance_raw)
        } else {
            balance_raw
        },
        status: input.status,
        source: normalize_source_metadata(
            input.source,
            existing.as_ref().map(|record| record.source.clone()),
            ApprovalSourceKind::RpcPointRead,
        ),
        last_scanned_at: merge_optional_string(
            input.last_scanned_at,
            existing
                .as_ref()
                .and_then(|record| record.last_scanned_at.clone()),
            input.clear_last_scanned_at,
        ),
        last_error_summary: merge_optional_sanitized(
            input.last_error_summary,
            existing
                .as_ref()
                .and_then(|record| record.last_error_summary.clone()),
            input.clear_last_error_summary,
        ),
        stale_after: merge_optional_string(
            input.stale_after,
            existing
                .as_ref()
                .and_then(|record| record.stale_after.clone()),
            input.clear_stale_after,
        ),
        rpc_identity: merge_optional_sanitized(
            input.rpc_identity,
            existing
                .as_ref()
                .and_then(|record| record.rpc_identity.clone()),
            input.clear_rpc_identity,
        ),
        rpc_profile_id: merge_optional_sanitized(
            input.rpc_profile_id,
            existing
                .as_ref()
                .and_then(|record| record.rpc_profile_id.clone()),
            input.clear_rpc_profile_id,
        ),
        created_at,
        updated_at: now,
    };
    upsert_by_index(&mut state.asset_snapshots, index, record);
    sort_state(&mut state);
    write_token_watchlist_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn upsert_allowance_snapshot(
    input: UpsertAllowanceSnapshotInput,
) -> Result<TokenWatchlistState, String> {
    let _guard = token_watchlist_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_token_watchlist_state_for_update()?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let owner = normalize_evm_address(&input.owner, "owner")?;
    let token_contract = normalize_evm_address(&input.token_contract, "token contract")?;
    let spender = normalize_evm_address(&input.spender, "spender")?;
    let index = allowance_snapshot_index(
        &state.allowance_snapshots,
        chain_id,
        &owner,
        &token_contract,
        &spender,
    );
    let existing = index.and_then(|index| state.allowance_snapshots.get(index).cloned());
    let incoming_allowance = match input.allowance_raw {
        Some(value) => normalize_balance_raw(value)?,
        None => existing
            .as_ref()
            .map(|record| record.allowance_raw.clone())
            .unwrap_or_else(|| "0".to_string()),
    };
    let allowance_raw =
        preserve_success_allowance_on_failure(existing.as_ref(), input.status, incoming_allowance);
    let now = now_unix_seconds()?;
    let created_at = existing
        .as_ref()
        .map(|record| non_empty_string(record.created_at.clone()).unwrap_or_else(|| now.clone()))
        .unwrap_or_else(|| now.clone());
    let record = AllowanceSnapshotRecord {
        chain_id,
        owner,
        token_contract,
        spender,
        allowance_raw,
        status: input.status,
        source: normalize_source_metadata(
            input.source,
            existing.as_ref().map(|record| record.source.clone()),
            ApprovalSourceKind::RpcPointRead,
        ),
        last_scanned_at: merge_optional_string(
            input.last_scanned_at,
            existing
                .as_ref()
                .and_then(|record| record.last_scanned_at.clone()),
            input.clear_last_scanned_at,
        ),
        last_error_summary: merge_optional_sanitized(
            input.last_error_summary,
            existing
                .as_ref()
                .and_then(|record| record.last_error_summary.clone()),
            input.clear_last_error_summary,
        ),
        stale_after: merge_optional_string(
            input.stale_after,
            existing
                .as_ref()
                .and_then(|record| record.stale_after.clone()),
            input.clear_stale_after,
        ),
        rpc_identity: merge_optional_sanitized(
            input.rpc_identity,
            existing
                .as_ref()
                .and_then(|record| record.rpc_identity.clone()),
            input.clear_rpc_identity,
        ),
        rpc_profile_id: merge_optional_sanitized(
            input.rpc_profile_id,
            existing
                .as_ref()
                .and_then(|record| record.rpc_profile_id.clone()),
            input.clear_rpc_profile_id,
        ),
        created_at,
        updated_at: now,
    };
    upsert_by_index(&mut state.allowance_snapshots, index, record);
    sort_state(&mut state);
    write_token_watchlist_state(&state)?;
    Ok(into_read_state(state))
}

#[tauri::command]
pub fn upsert_nft_approval_snapshot(
    input: UpsertNftApprovalSnapshotInput,
) -> Result<TokenWatchlistState, String> {
    let _guard = token_watchlist_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_token_watchlist_state_for_update()?;
    let chain_id = normalize_chain_id(input.chain_id)?;
    let owner = normalize_evm_address(&input.owner, "owner")?;
    let token_contract = normalize_evm_address(&input.token_contract, "token contract")?;
    if input.kind == ApprovalWatchKind::Erc20Allowance {
        return Err(
            "NFT approval snapshot kind must be erc721ApprovalForAll or erc721TokenApproval"
                .to_string(),
        );
    }
    let operator = normalize_nft_approval_operator(&input.operator, input.kind, input.status)?;
    let token_id = normalize_optional_token_id(input.token_id)?;
    if input.kind == ApprovalWatchKind::Erc721TokenApproval && token_id.is_none() {
        return Err("tokenId is required for erc721TokenApproval".to_string());
    }
    if input.kind == ApprovalWatchKind::Erc721ApprovalForAll && token_id.is_some() {
        return Err("tokenId is only allowed for erc721TokenApproval".to_string());
    }
    let index = nft_approval_snapshot_index(
        &state.nft_approval_snapshots,
        chain_id,
        &owner,
        &token_contract,
        input.kind,
        &operator,
        token_id.as_deref(),
    );
    let existing = index.and_then(|index| state.nft_approval_snapshots.get(index).cloned());
    let approved =
        preserve_success_approval_on_failure(existing.as_ref(), input.status, input.approved);
    let now = now_unix_seconds()?;
    let created_at = existing
        .as_ref()
        .map(|record| non_empty_string(record.created_at.clone()).unwrap_or_else(|| now.clone()))
        .unwrap_or_else(|| now.clone());
    let record = NftApprovalSnapshotRecord {
        chain_id,
        owner,
        token_contract,
        kind: input.kind,
        operator,
        token_id,
        approved,
        status: input.status,
        source: normalize_source_metadata(
            input.source,
            existing.as_ref().map(|record| record.source.clone()),
            ApprovalSourceKind::RpcPointRead,
        ),
        last_scanned_at: merge_optional_string(
            input.last_scanned_at,
            existing
                .as_ref()
                .and_then(|record| record.last_scanned_at.clone()),
            input.clear_last_scanned_at,
        ),
        last_error_summary: merge_optional_sanitized(
            input.last_error_summary,
            existing
                .as_ref()
                .and_then(|record| record.last_error_summary.clone()),
            input.clear_last_error_summary,
        ),
        stale_after: merge_optional_string(
            input.stale_after,
            existing
                .as_ref()
                .and_then(|record| record.stale_after.clone()),
            input.clear_stale_after,
        ),
        rpc_identity: merge_optional_sanitized(
            input.rpc_identity,
            existing
                .as_ref()
                .and_then(|record| record.rpc_identity.clone()),
            input.clear_rpc_identity,
        ),
        rpc_profile_id: merge_optional_sanitized(
            input.rpc_profile_id,
            existing
                .as_ref()
                .and_then(|record| record.rpc_profile_id.clone()),
            input.clear_rpc_profile_id,
        ),
        created_at,
        updated_at: now,
    };
    upsert_by_index(&mut state.nft_approval_snapshots, index, record);
    sort_state(&mut state);
    write_token_watchlist_state(&state)?;
    Ok(into_read_state(state))
}

fn read_token_watchlist_state() -> Result<StoredTokenWatchlistState, String> {
    let path = token_watchlist_path()?;
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<StoredTokenWatchlistState>(&raw)
            .map(normalize_loaded_state)
            .map_err(|_| {
                "token-watchlist.json is invalid; fix or remove it before saving token state"
                    .to_string()
            }),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            Ok(StoredTokenWatchlistState::default())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn read_token_watchlist_state_for_update() -> Result<StoredTokenWatchlistState, String> {
    read_token_watchlist_state()
}

fn write_token_watchlist_state(state: &StoredTokenWatchlistState) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    write_file_atomic(&token_watchlist_path()?, &raw)
}

fn normalize_loaded_state(mut state: StoredTokenWatchlistState) -> StoredTokenWatchlistState {
    for scan_state in &mut state.token_scan_state {
        if scan_state.created_at.trim().is_empty() {
            scan_state.created_at = scan_state.updated_at.clone();
        }
    }
    for snapshot in &mut state.erc20_balance_snapshots {
        if snapshot.created_at.trim().is_empty() {
            snapshot.created_at = snapshot.updated_at.clone();
        }
    }
    for record in &mut state.approval_watchlist {
        if record.created_at.trim().is_empty() {
            record.created_at = record.updated_at.clone();
        }
    }
    for record in &mut state.asset_scan_jobs {
        if record.created_at.trim().is_empty() {
            record.created_at = record.updated_at.clone();
        }
    }
    for record in &mut state.asset_snapshots {
        if record.created_at.trim().is_empty() {
            record.created_at = record.updated_at.clone();
        }
    }
    for record in &mut state.allowance_snapshots {
        if record.created_at.trim().is_empty() {
            record.created_at = record.updated_at.clone();
        }
    }
    for record in &mut state.nft_approval_snapshots {
        if record.created_at.trim().is_empty() {
            record.created_at = record.updated_at.clone();
        }
    }
    sort_state(&mut state);
    state
}

fn into_read_state(state: StoredTokenWatchlistState) -> TokenWatchlistState {
    let resolved_token_metadata = resolve_watchlist_metadata(&state);
    TokenWatchlistState {
        schema_version: state.schema_version,
        watchlist_tokens: state.watchlist_tokens,
        token_metadata_cache: state.token_metadata_cache,
        token_scan_state: state.token_scan_state,
        erc20_balance_snapshots: state.erc20_balance_snapshots,
        approval_watchlist: state.approval_watchlist,
        asset_scan_jobs: state.asset_scan_jobs,
        asset_snapshots: state.asset_snapshots,
        allowance_snapshots: state.allowance_snapshots,
        nft_approval_snapshots: state.nft_approval_snapshots,
        resolved_token_metadata,
    }
}

fn resolve_watchlist_metadata(
    state: &StoredTokenWatchlistState,
) -> Vec<ResolvedTokenMetadataRecord> {
    state
        .watchlist_tokens
        .iter()
        .filter_map(|token| {
            let cache = state.token_metadata_cache.iter().find(|item| {
                token_matches(
                    item.chain_id,
                    &item.token_contract,
                    token.chain_id,
                    &token.token_contract,
                )
            });
            if let Some(override_record) = token.metadata_override.as_ref() {
                let status = if cache
                    .map(|cache| override_conflicts_with_cache(override_record, cache))
                    .unwrap_or(false)
                {
                    ResolvedMetadataStatus::SourceConflict
                } else {
                    cache
                        .map(|cache| raw_status_to_resolved(cache.status))
                        .unwrap_or(ResolvedMetadataStatus::Ok)
                };
                return Some(ResolvedTokenMetadataRecord {
                    chain_id: token.chain_id,
                    token_contract: token.token_contract.clone(),
                    symbol: override_record
                        .symbol
                        .clone()
                        .or_else(|| cache.and_then(|cache| cache.raw_symbol.clone())),
                    name: override_record
                        .name
                        .clone()
                        .or_else(|| cache.and_then(|cache| cache.raw_name.clone())),
                    decimals: override_record
                        .decimals
                        .or_else(|| cache.and_then(|cache| cache.raw_decimals)),
                    source: ResolvedMetadataSource::UserConfirmed,
                    status,
                    updated_at: token.updated_at.clone(),
                });
            }

            cache.map(|cache| ResolvedTokenMetadataRecord {
                chain_id: token.chain_id,
                token_contract: token.token_contract.clone(),
                symbol: cache.raw_symbol.clone(),
                name: cache.raw_name.clone(),
                decimals: cache.raw_decimals,
                source: ResolvedMetadataSource::OnChainCall,
                status: raw_status_to_resolved(cache.status),
                updated_at: cache.updated_at.clone(),
            })
        })
        .collect()
}

fn override_conflicts_with_cache(
    override_record: &MetadataOverrideRecord,
    cache: &TokenMetadataCacheRecord,
) -> bool {
    override_record
        .symbol
        .as_ref()
        .zip(cache.raw_symbol.as_ref())
        .map(|(left, right)| left != right)
        .unwrap_or(false)
        || override_record
            .name
            .as_ref()
            .zip(cache.raw_name.as_ref())
            .map(|(left, right)| left != right)
            .unwrap_or(false)
        || override_record
            .decimals
            .zip(cache.raw_decimals)
            .map(|(left, right)| left != right)
            .unwrap_or(false)
}

fn raw_status_to_resolved(status: RawMetadataStatus) -> ResolvedMetadataStatus {
    match status {
        RawMetadataStatus::Ok => ResolvedMetadataStatus::Ok,
        RawMetadataStatus::MissingDecimals => ResolvedMetadataStatus::MissingDecimals,
        RawMetadataStatus::Malformed => ResolvedMetadataStatus::Malformed,
        RawMetadataStatus::CallFailed => ResolvedMetadataStatus::CallFailed,
        RawMetadataStatus::NonErc20 => ResolvedMetadataStatus::NonErc20,
        RawMetadataStatus::DecimalsChanged => ResolvedMetadataStatus::DecimalsChanged,
    }
}

fn should_preserve_existing_raw_metadata(status: RawMetadataStatus) -> bool {
    !matches!(
        status,
        RawMetadataStatus::Ok | RawMetadataStatus::DecimalsChanged
    )
}

fn normalize_metadata_override(
    input: Option<MetadataOverrideInput>,
) -> Result<Option<MetadataOverrideRecord>, String> {
    let Some(input) = input else {
        return Ok(None);
    };
    if let Some(source) = input.source.as_deref() {
        if source != "userConfirmed" {
            return Err("metadata override source must be userConfirmed".to_string());
        }
    }
    Ok(Some(MetadataOverrideRecord {
        symbol: input.symbol.and_then(non_empty_string),
        name: input.name.and_then(non_empty_string),
        decimals: input.decimals,
        source: UserMetadataSource::UserConfirmed,
        confirmed_at: input
            .confirmed_at
            .and_then(non_empty_string)
            .unwrap_or(now_unix_seconds()?),
    }))
}

fn validate_raw_metadata_source(source: Option<&str>) -> Result<(), String> {
    match source {
        None | Some("onChainCall") => Ok(()),
        Some("userConfirmed") | Some("watchlistCache") => {
            Err("token metadata cache source must be onChainCall".to_string())
        }
        Some(_) => Err("token metadata cache source must be onChainCall".to_string()),
    }
}

fn normalize_chain_id(chain_id: u64) -> Result<u64, String> {
    if chain_id == 0 {
        return Err("chainId must be greater than zero".to_string());
    }
    Ok(chain_id)
}

fn normalize_evm_address(value: &str, label: &str) -> Result<String, String> {
    let address = Address::from_str(value.trim())
        .map_err(|_| format!("{label} must be a valid EVM address"))?;
    if address == Address::zero() {
        return Err(format!("{label} cannot be the zero address"));
    }
    Ok(to_checksum(&address, None))
}

fn normalize_nft_approval_operator(
    value: &str,
    kind: ApprovalWatchKind,
    status: NftApprovalSnapshotStatus,
) -> Result<String, String> {
    let address = Address::from_str(value.trim())
        .map_err(|_| "operator must be a valid EVM address".to_string())?;
    if address == Address::zero() {
        if kind == ApprovalWatchKind::Erc721TokenApproval
            && !matches!(status, NftApprovalSnapshotStatus::Active)
        {
            return Ok(to_checksum(&address, None));
        }
        return Err("operator cannot be the zero address".to_string());
    }
    Ok(to_checksum(&address, None))
}

fn normalize_balance_raw(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("balanceRaw must be a non-negative integer string".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_optional_token_id(value: Option<String>) -> Result<Option<String>, String> {
    match value.and_then(non_empty_string) {
        Some(token_id) => {
            if !token_id.chars().all(|ch| ch.is_ascii_digit()) {
                return Err("tokenId must be a non-negative integer string".to_string());
            }
            let normalized = token_id.trim_start_matches('0');
            Ok(Some(if normalized.is_empty() {
                "0".to_string()
            } else {
                normalized.to_string()
            }))
        }
        None => Ok(None),
    }
}

fn normalize_asset_snapshot_token_id(
    asset_kind: AssetKind,
    token_id: Option<String>,
) -> Result<Option<String>, String> {
    let token_id = normalize_optional_token_id(token_id)?;
    match asset_kind {
        AssetKind::Erc20 => {
            if token_id.is_some() {
                Err("tokenId is not allowed for ERC20 asset snapshots".to_string())
            } else {
                Ok(None)
            }
        }
        AssetKind::Erc721 | AssetKind::Erc1155 => token_id
            .ok_or_else(|| "tokenId is required for NFT asset snapshots".to_string())
            .map(Some),
    }
}

fn normalize_approval_identity(
    kind: ApprovalWatchKind,
    spender: Option<String>,
    operator: Option<String>,
    token_id: Option<String>,
) -> Result<(Option<String>, Option<String>, Option<String>), String> {
    match kind {
        ApprovalWatchKind::Erc20Allowance => {
            let spender = spender
                .as_deref()
                .ok_or_else(|| "spender is required for erc20Allowance".to_string())
                .and_then(|value| normalize_evm_address(value, "spender"))?;
            if operator
                .as_ref()
                .and_then(|value| non_empty_string(value.clone()))
                .is_some()
            {
                return Err(
                    "operator is only allowed for NFT approval watchlist entries".to_string(),
                );
            }
            if token_id
                .as_ref()
                .and_then(|value| non_empty_string(value.clone()))
                .is_some()
            {
                return Err("tokenId is only allowed for erc721TokenApproval".to_string());
            }
            Ok((Some(spender), None, None))
        }
        ApprovalWatchKind::Erc721ApprovalForAll => {
            let operator = operator
                .as_deref()
                .ok_or_else(|| "operator is required for erc721ApprovalForAll".to_string())
                .and_then(|value| normalize_evm_address(value, "operator"))?;
            if spender
                .as_ref()
                .and_then(|value| non_empty_string(value.clone()))
                .is_some()
            {
                return Err("spender is only allowed for erc20Allowance".to_string());
            }
            if token_id
                .as_ref()
                .and_then(|value| non_empty_string(value.clone()))
                .is_some()
            {
                return Err("tokenId is only allowed for erc721TokenApproval".to_string());
            }
            Ok((None, Some(operator), None))
        }
        ApprovalWatchKind::Erc721TokenApproval => {
            let operator = operator
                .as_deref()
                .ok_or_else(|| "operator is required for erc721TokenApproval".to_string())
                .and_then(|value| normalize_evm_address(value, "operator"))?;
            if spender
                .as_ref()
                .and_then(|value| non_empty_string(value.clone()))
                .is_some()
            {
                return Err("spender is only allowed for erc20Allowance".to_string());
            }
            let token_id = normalize_optional_token_id(token_id)?
                .ok_or_else(|| "tokenId is required for erc721TokenApproval".to_string())?;
            Ok((None, Some(operator), Some(token_id)))
        }
    }
}

fn normalize_source_metadata(
    incoming: Option<SourceMetadataInput>,
    existing: Option<SourceMetadataRecord>,
    default_kind: ApprovalSourceKind,
) -> SourceMetadataRecord {
    match incoming {
        Some(input) => SourceMetadataRecord {
            kind: input.kind,
            label: sanitize_optional(input.label),
            source_id: sanitize_optional(input.source_id),
            summary: sanitize_optional(input.summary),
            provider_hint: sanitize_optional(input.provider_hint),
            observed_at: sanitize_observed_at(input.observed_at),
        },
        None => existing.unwrap_or(SourceMetadataRecord {
            kind: default_kind,
            label: None,
            source_id: None,
            summary: None,
            provider_hint: None,
            observed_at: None,
        }),
    }
}

fn preserve_success_balance_on_failure(
    existing: Option<&Erc20BalanceSnapshotRecord>,
    incoming_status: BalanceStatus,
    incoming_balance: String,
) -> String {
    if !balance_status_is_failure(incoming_status) || incoming_balance != "0" {
        return incoming_balance;
    }
    existing
        .filter(|record| balance_status_has_confirmed_amount(record.balance_status))
        .map(|record| record.balance_raw.clone())
        .unwrap_or(incoming_balance)
}

fn balance_status_is_failure(status: BalanceStatus) -> bool {
    matches!(
        status,
        BalanceStatus::BalanceCallFailed
            | BalanceStatus::MalformedBalance
            | BalanceStatus::RpcFailed
            | BalanceStatus::ChainMismatch
    )
}

fn balance_status_has_confirmed_amount(status: BalanceStatus) -> bool {
    matches!(status, BalanceStatus::Ok | BalanceStatus::Zero)
}

fn preserve_success_allowance_on_failure(
    existing: Option<&AllowanceSnapshotRecord>,
    incoming_status: AllowanceSnapshotStatus,
    incoming_allowance: String,
) -> String {
    if !allowance_status_is_failure(incoming_status) {
        return incoming_allowance;
    }
    existing
        .filter(|record| allowance_status_has_confirmed_amount(record.status))
        .map(|record| record.allowance_raw.clone())
        .unwrap_or(incoming_allowance)
}

fn allowance_status_is_failure(status: AllowanceSnapshotStatus) -> bool {
    matches!(
        status,
        AllowanceSnapshotStatus::Unknown
            | AllowanceSnapshotStatus::Stale
            | AllowanceSnapshotStatus::ReadFailed
            | AllowanceSnapshotStatus::SourceUnavailable
            | AllowanceSnapshotStatus::RateLimited
            | AllowanceSnapshotStatus::ChainMismatch
    )
}

fn allowance_status_has_confirmed_amount(status: AllowanceSnapshotStatus) -> bool {
    matches!(
        status,
        AllowanceSnapshotStatus::Active | AllowanceSnapshotStatus::Zero
    )
}

fn preserve_success_approval_on_failure(
    existing: Option<&NftApprovalSnapshotRecord>,
    incoming_status: NftApprovalSnapshotStatus,
    incoming_approved: Option<bool>,
) -> Option<bool> {
    if !nft_approval_status_is_failure(incoming_status) {
        return incoming_approved.or_else(|| existing.and_then(|record| record.approved));
    }
    existing
        .filter(|record| {
            nft_approval_status_has_confirmed_value(record.status)
                || nft_approval_status_is_failure(record.status)
        })
        .and_then(|record| record.approved)
        .or(incoming_approved)
}

fn nft_approval_status_is_failure(status: NftApprovalSnapshotStatus) -> bool {
    matches!(
        status,
        NftApprovalSnapshotStatus::Unknown
            | NftApprovalSnapshotStatus::Stale
            | NftApprovalSnapshotStatus::ReadFailed
            | NftApprovalSnapshotStatus::SourceUnavailable
            | NftApprovalSnapshotStatus::RateLimited
            | NftApprovalSnapshotStatus::ChainMismatch
    )
}

fn nft_approval_status_has_confirmed_value(status: NftApprovalSnapshotStatus) -> bool {
    matches!(
        status,
        NftApprovalSnapshotStatus::Active | NftApprovalSnapshotStatus::Revoked
    )
}

fn asset_status_is_failure(status: AssetSnapshotStatus) -> bool {
    matches!(
        status,
        AssetSnapshotStatus::Unknown
            | AssetSnapshotStatus::Stale
            | AssetSnapshotStatus::ReadFailed
            | AssetSnapshotStatus::SourceUnavailable
            | AssetSnapshotStatus::RateLimited
            | AssetSnapshotStatus::ChainMismatch
    )
}

fn non_empty_string(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn sanitize_optional(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(sanitize_diagnostic_message)
        .and_then(non_empty_string)
}

fn sanitize_observed_at(value: Option<String>) -> Option<String> {
    let value = value.and_then(non_empty_string)?;
    if is_safe_observed_at(&value) {
        Some(value)
    } else {
        Some(sanitize_diagnostic_message(&value)).and_then(non_empty_string)
    }
}

fn is_safe_observed_at(value: &str) -> bool {
    let len = value.len();
    if len == 0 || len > 64 {
        return false;
    }
    if value.chars().all(|ch| ch.is_ascii_digit()) {
        return true;
    }
    value.contains('T')
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | ':' | '.' | '+'))
}

fn merge_optional_string(
    incoming: Option<String>,
    existing: Option<String>,
    clear: bool,
) -> Option<String> {
    if clear {
        None
    } else if incoming.is_some() {
        incoming.and_then(non_empty_string)
    } else {
        existing
    }
}

fn merge_optional_sanitized(
    incoming: Option<String>,
    existing: Option<String>,
    clear: bool,
) -> Option<String> {
    if clear {
        None
    } else if incoming.is_some() {
        sanitize_optional(incoming)
    } else {
        existing
    }
}

fn merge_optional_value<T>(incoming: Option<T>, existing: Option<T>, clear: bool) -> Option<T> {
    if clear {
        None
    } else {
        incoming.or(existing)
    }
}

fn token_index(
    tokens: &[WatchlistTokenRecord],
    chain_id: u64,
    token_contract: &str,
) -> Option<usize> {
    tokens.iter().position(|item| {
        token_matches(
            item.chain_id,
            &item.token_contract,
            chain_id,
            token_contract,
        )
    })
}

fn metadata_cache_index(
    cache: &[TokenMetadataCacheRecord],
    chain_id: u64,
    token_contract: &str,
) -> Option<usize> {
    cache.iter().position(|item| {
        token_matches(
            item.chain_id,
            &item.token_contract,
            chain_id,
            token_contract,
        )
    })
}

fn scan_state_index(
    states: &[TokenScanStateRecord],
    chain_id: u64,
    token_contract: &str,
) -> Option<usize> {
    states.iter().position(|item| {
        token_matches(
            item.chain_id,
            &item.token_contract,
            chain_id,
            token_contract,
        )
    })
}

fn balance_snapshot_index(
    snapshots: &[Erc20BalanceSnapshotRecord],
    account: &str,
    chain_id: u64,
    token_contract: &str,
) -> Option<usize> {
    snapshots.iter().position(|item| {
        item.account == account
            && token_matches(
                item.chain_id,
                &item.token_contract,
                chain_id,
                token_contract,
            )
    })
}

fn approval_watchlist_index(
    records: &[ApprovalWatchlistRecord],
    chain_id: u64,
    owner: &str,
    token_contract: &str,
    kind: ApprovalWatchKind,
    spender: Option<&str>,
    operator: Option<&str>,
    token_id: Option<&str>,
) -> Option<usize> {
    records.iter().position(|item| {
        item.chain_id == chain_id
            && item.owner == owner
            && item.token_contract == token_contract
            && item.kind == kind
            && item.spender.as_deref() == spender
            && item.operator.as_deref() == operator
            && item.token_id.as_deref() == token_id
    })
}

fn asset_scan_job_index(records: &[AssetScanJobRecord], job_id: &str) -> Option<usize> {
    records.iter().position(|item| item.job_id == job_id)
}

fn asset_snapshot_index(
    records: &[AssetSnapshotRecord],
    chain_id: u64,
    owner: &str,
    token_contract: &str,
    asset_kind: AssetKind,
    token_id: Option<&str>,
) -> Option<usize> {
    records.iter().position(|item| {
        item.chain_id == chain_id
            && item.owner == owner
            && item.token_contract == token_contract
            && item.asset_kind == asset_kind
            && item.token_id.as_deref() == token_id
    })
}

fn allowance_snapshot_index(
    records: &[AllowanceSnapshotRecord],
    chain_id: u64,
    owner: &str,
    token_contract: &str,
    spender: &str,
) -> Option<usize> {
    records.iter().position(|item| {
        item.chain_id == chain_id
            && item.owner == owner
            && item.token_contract == token_contract
            && item.spender == spender
    })
}

fn nft_approval_snapshot_index(
    records: &[NftApprovalSnapshotRecord],
    chain_id: u64,
    owner: &str,
    token_contract: &str,
    kind: ApprovalWatchKind,
    operator: &str,
    token_id: Option<&str>,
) -> Option<usize> {
    records.iter().position(|item| {
        item.chain_id == chain_id
            && item.owner == owner
            && item.token_contract == token_contract
            && item.kind == kind
            && item.operator == operator
            && item.token_id.as_deref() == token_id
    })
}

fn asset_scan_job_id(chain_id: u64, owner: &str, contract_filter: Option<&str>) -> String {
    format!(
        "asset-scan|chainId={chain_id}|owner={owner}|contract={}",
        contract_filter.unwrap_or("*")
    )
}

fn token_matches(
    left_chain_id: u64,
    left_token_contract: &str,
    right_chain_id: u64,
    right_token_contract: &str,
) -> bool {
    left_chain_id == right_chain_id && left_token_contract == right_token_contract
}

fn upsert_by_index<T>(items: &mut Vec<T>, index: Option<usize>, record: T) {
    if let Some(index) = index {
        items[index] = record;
    } else {
        items.push(record);
    }
}

fn sort_state(state: &mut StoredTokenWatchlistState) {
    state.watchlist_tokens.sort_by(|left, right| {
        token_sort_key(left.chain_id, &left.token_contract)
            .cmp(&token_sort_key(right.chain_id, &right.token_contract))
    });
    state.token_metadata_cache.sort_by(|left, right| {
        token_sort_key(left.chain_id, &left.token_contract)
            .cmp(&token_sort_key(right.chain_id, &right.token_contract))
    });
    state.token_scan_state.sort_by(|left, right| {
        token_sort_key(left.chain_id, &left.token_contract)
            .cmp(&token_sort_key(right.chain_id, &right.token_contract))
    });
    state.erc20_balance_snapshots.sort_by(|left, right| {
        (
            left.account.as_str(),
            left.chain_id,
            left.token_contract.as_str(),
        )
            .cmp(&(
                right.account.as_str(),
                right.chain_id,
                right.token_contract.as_str(),
            ))
    });
    state.approval_watchlist.sort_by(|left, right| {
        approval_sort_key(
            left.chain_id,
            &left.owner,
            &left.token_contract,
            left.kind,
            left.spender.as_deref(),
            left.operator.as_deref(),
            left.token_id.as_deref(),
        )
        .cmp(&approval_sort_key(
            right.chain_id,
            &right.owner,
            &right.token_contract,
            right.kind,
            right.spender.as_deref(),
            right.operator.as_deref(),
            right.token_id.as_deref(),
        ))
    });
    state.asset_scan_jobs.sort_by(|left, right| {
        (
            left.chain_id,
            left.owner.as_str(),
            left.contract_filter.as_deref().unwrap_or(""),
            left.job_id.as_str(),
        )
            .cmp(&(
                right.chain_id,
                right.owner.as_str(),
                right.contract_filter.as_deref().unwrap_or(""),
                right.job_id.as_str(),
            ))
    });
    state.asset_snapshots.sort_by(|left, right| {
        (
            left.chain_id,
            left.owner.as_str(),
            left.token_contract.as_str(),
            asset_kind_order(left.asset_kind),
            left.token_id.as_deref().unwrap_or(""),
        )
            .cmp(&(
                right.chain_id,
                right.owner.as_str(),
                right.token_contract.as_str(),
                asset_kind_order(right.asset_kind),
                right.token_id.as_deref().unwrap_or(""),
            ))
    });
    state.allowance_snapshots.sort_by(|left, right| {
        (
            left.chain_id,
            left.owner.as_str(),
            left.token_contract.as_str(),
            left.spender.as_str(),
        )
            .cmp(&(
                right.chain_id,
                right.owner.as_str(),
                right.token_contract.as_str(),
                right.spender.as_str(),
            ))
    });
    state.nft_approval_snapshots.sort_by(|left, right| {
        approval_sort_key(
            left.chain_id,
            &left.owner,
            &left.token_contract,
            left.kind,
            None,
            Some(&left.operator),
            left.token_id.as_deref(),
        )
        .cmp(&approval_sort_key(
            right.chain_id,
            &right.owner,
            &right.token_contract,
            right.kind,
            None,
            Some(&right.operator),
            right.token_id.as_deref(),
        ))
    });
}

fn token_sort_key(chain_id: u64, token_contract: &str) -> (u64, &str) {
    (chain_id, token_contract)
}

fn approval_sort_key<'a>(
    chain_id: u64,
    owner: &'a str,
    token_contract: &'a str,
    kind: ApprovalWatchKind,
    spender: Option<&'a str>,
    operator: Option<&'a str>,
    token_id: Option<&'a str>,
) -> (u64, &'a str, &'a str, &'a str, &'a str, &'a str, u8) {
    (
        chain_id,
        owner,
        token_contract,
        spender.unwrap_or(""),
        operator.unwrap_or(""),
        token_id.unwrap_or(""),
        approval_kind_order(kind),
    )
}

fn approval_kind_order(kind: ApprovalWatchKind) -> u8 {
    match kind {
        ApprovalWatchKind::Erc20Allowance => 0,
        ApprovalWatchKind::Erc721ApprovalForAll => 1,
        ApprovalWatchKind::Erc721TokenApproval => 2,
    }
}

fn asset_kind_order(kind: AssetKind) -> u8 {
    match kind {
        AssetKind::Erc20 => 0,
        AssetKind::Erc721 => 1,
        AssetKind::Erc1155 => 2,
    }
}
