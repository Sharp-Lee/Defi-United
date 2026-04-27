use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultBlob {
    pub version: u8,
    pub salt_b64: String,
    pub iv_b64: String,
    pub ciphertext_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_chain_id", alias = "default_chain_id")]
    pub default_chain_id: u64,
    #[serde(default = "default_idle_lock_minutes", alias = "idle_lock_minutes")]
    pub idle_lock_minutes: u32,
    #[serde(
        default = "default_enabled_builtin_chain_ids",
        alias = "enabled_builtin_chain_ids"
    )]
    pub enabled_builtin_chain_ids: Vec<u64>,
    #[serde(default, alias = "rpc_endpoints")]
    pub rpc_endpoints: Vec<RpcEndpointConfig>,
    #[serde(default, alias = "display_preferences")]
    pub display_preferences: DisplayPreferences,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            default_chain_id: default_chain_id(),
            idle_lock_minutes: default_idle_lock_minutes(),
            enabled_builtin_chain_ids: default_enabled_builtin_chain_ids(),
            rpc_endpoints: Vec::new(),
            display_preferences: DisplayPreferences::default(),
        }
    }
}

fn default_chain_id() -> u64 {
    1
}

fn default_idle_lock_minutes() -> u32 {
    15
}

fn default_enabled_builtin_chain_ids() -> Vec<u64> {
    vec![1, 8453, 42161, 10, 56, 137]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RpcEndpointConfig {
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub name: String,
    #[serde(alias = "native_symbol")]
    pub native_symbol: String,
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(alias = "validated_at")]
    pub validated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DisplayPreferences {
    #[serde(alias = "fiat_currency")]
    pub fiat_currency: String,
}

impl Default for DisplayPreferences {
    fn default() -> Self {
        Self {
            fiat_currency: "USD".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ChainOutcomeState {
    Pending,
    Confirmed,
    Failed,
    Replaced,
    Cancelled,
    Dropped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeTransferIntent {
    pub rpc_url: String,
    pub account_index: u32,
    pub chain_id: u64,
    pub from: String,
    pub to: String,
    pub value_wei: String,
    pub nonce: u64,
    pub gas_limit: String,
    pub max_fee_per_gas: String,
    pub max_priority_fee_per_gas: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmissionRecord {
    pub frozen_key: String,
    pub tx_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainOutcome {
    pub state: ChainOutcomeState,
    pub tx_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryRecord {
    pub intent: NativeTransferIntent,
    pub submission: SubmissionRecord,
    pub outcome: ChainOutcome,
}
