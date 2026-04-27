use std::fs;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use ethers::providers::{Http, Middleware, Provider};
use serde::{Deserialize, Serialize};
use tokio::time::{timeout, Duration};

use crate::models::{AppConfig, RpcEndpointConfig};
use crate::storage::{config_path, write_file_atomic};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedRpcEndpointInput {
    pub chain_id: u64,
    pub name: String,
    pub native_symbol: String,
    pub rpc_url: String,
}

const RPC_CHAIN_ID_PROBE_TIMEOUT_SECONDS: u64 = 10;

fn config_lock() -> &'static Mutex<()> {
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

async fn probe_rpc_chain_id(rpc_url: &str) -> Result<u64, String> {
    let provider =
        Provider::<Http>::try_from(rpc_url).map_err(|_| "RPC URL is invalid".to_string())?;
    let chain_id = timeout(
        Duration::from_secs(RPC_CHAIN_ID_PROBE_TIMEOUT_SECONDS),
        provider.get_chainid(),
    )
    .await
    .map_err(|_| "RPC chainId probe timed out".to_string())?
    .map_err(|_| "RPC chainId probe failed".to_string())?;

    Ok(chain_id.as_u64())
}

pub fn ensure_rpc_chain_id_matches(
    expected_chain_id: u64,
    remote_chain_id: u64,
) -> Result<(), String> {
    if remote_chain_id != expected_chain_id {
        return Err(format!(
            "remote chainId {remote_chain_id} does not match expected chainId {expected_chain_id}"
        ));
    }

    Ok(())
}

pub fn read_app_config() -> Result<AppConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }

    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn read_app_config_for_update() -> Result<AppConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }

    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|_| {
        "app-config.json is invalid; fix or remove it before saving RPC settings".to_string()
    })
}

pub fn write_app_config(config: &AppConfig) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    write_file_atomic(&config_path()?, &raw)
}

#[tauri::command]
pub fn load_app_config() -> Result<AppConfig, String> {
    read_app_config()
}

pub fn remember_validated_rpc_with_remote_chain_id(
    endpoint: ValidatedRpcEndpointInput,
    remote_chain_id: u64,
) -> Result<AppConfig, String> {
    ensure_rpc_chain_id_matches(endpoint.chain_id, remote_chain_id)?;

    let _guard = config_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut config = read_app_config_for_update()?;
    let chain_id = endpoint.chain_id;
    let saved = RpcEndpointConfig {
        chain_id,
        name: endpoint.name,
        native_symbol: endpoint.native_symbol,
        rpc_url: endpoint.rpc_url,
        validated_at: now_unix_seconds()?,
    };

    if let Some(existing) = config
        .rpc_endpoints
        .iter_mut()
        .find(|item| item.chain_id == saved.chain_id)
    {
        *existing = saved;
    } else {
        config.rpc_endpoints.push(saved);
    }

    config.default_chain_id = chain_id;
    write_app_config(&config)?;
    Ok(config)
}

#[tauri::command]
pub async fn remember_validated_rpc(
    endpoint: ValidatedRpcEndpointInput,
) -> Result<AppConfig, String> {
    let remote_chain_id = probe_rpc_chain_id(&endpoint.rpc_url).await?;
    remember_validated_rpc_with_remote_chain_id(endpoint, remote_chain_id)
}
