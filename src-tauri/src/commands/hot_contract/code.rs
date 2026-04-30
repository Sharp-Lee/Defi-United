use ethers::providers::{Http, Provider};
use ethers::utils::keccak256;
use serde_json::Value;
use tokio::time::timeout;

use super::{
    rpc_timeout_duration, HotContractCodeIdentity, HotContractRpcError, HotContractSelectedRpcInput,
};

const CODE_HASH_VERSION: &str = "keccak256-v1";

pub async fn fetch_contract_code(
    provider: &Provider<Http>,
    contract_address: &str,
) -> Result<HotContractCodeIdentity, HotContractRpcError> {
    let value = rpc_value_request(
        provider,
        "eth_getCode",
        serde_json::json!([contract_address, "latest"]),
    )
    .await?;
    let code = value
        .and_then(|value| value.as_str().map(str::to_string))
        .ok_or_else(|| {
            HotContractRpcError::Provider("code response must be a hex string".to_string())
        })?;
    let bytes = decode_hex_bytes(&code, "code")
        .map_err(|error| HotContractRpcError::Provider(error.to_string()))?;
    Ok(HotContractCodeIdentity {
        status: if bytes.is_empty() {
            "empty".to_string()
        } else {
            "ok".to_string()
        },
        block_tag: "latest".to_string(),
        byte_length: Some(bytes.len() as u64),
        code_hash_version: Some(CODE_HASH_VERSION.to_string()),
        code_hash: Some(prefixed_hash(&bytes)),
        error_summary: None,
    })
}

pub fn validate_selected_rpc(
    selected_rpc: &HotContractSelectedRpcInput,
    chain_id: u64,
    rpc_url: &str,
) -> Result<(), String> {
    let selected_chain_id = selected_rpc.chain_id.ok_or_else(|| {
        "selectedRpc.chainId is required for hot contract analysis fetch".to_string()
    })?;
    if selected_chain_id != chain_id {
        return Err("selectedRpc.chainId does not match hot contract analysis chainId".to_string());
    }

    let endpoint_summary = selected_rpc
        .endpoint_summary
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "selectedRpc.endpointSummary is required for hot contract analysis fetch".to_string()
        })?;
    if endpoint_summary != summarize_rpc_endpoint(rpc_url) {
        return Err("submitted rpcUrl does not match selectedRpc endpointSummary".to_string());
    }

    let endpoint_fingerprint = selected_rpc
        .endpoint_fingerprint
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "selectedRpc.endpointFingerprint is required for hot contract analysis fetch"
                .to_string()
        })?;
    if endpoint_fingerprint != rpc_endpoint_fingerprint(rpc_url) {
        return Err("submitted rpcUrl does not match selectedRpc endpointFingerprint".to_string());
    }

    Ok(())
}

async fn rpc_value_request(
    provider: &Provider<Http>,
    method: &str,
    params: Value,
) -> Result<Option<Value>, HotContractRpcError> {
    let value: Value = timeout(rpc_timeout_duration(), provider.request(method, params))
        .await
        .map_err(|_| HotContractRpcError::Timeout)?
        .map_err(|error| HotContractRpcError::Provider(error.to_string()))?;
    if value.is_null() {
        Ok(None)
    } else {
        Ok(Some(value))
    }
}

fn decode_hex_bytes(value: &str, field: &str) -> Result<Vec<u8>, String> {
    let trimmed = value.trim();
    let Some(hex) = trimmed.strip_prefix("0x") else {
        return Err(format!("{field} must start with 0x"));
    };
    if hex.len() % 2 != 0 {
        return Err(format!("{field} must have an even hex length"));
    }
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for pair in hex.as_bytes().chunks_exact(2) {
        let high = decode_hex_nibble(pair[0])
            .ok_or_else(|| format!("{field} contains a non-hex character"))?;
        let low = decode_hex_nibble(pair[1])
            .ok_or_else(|| format!("{field} contains a non-hex character"))?;
        bytes.push((high << 4) | low);
    }
    Ok(bytes)
}

pub(crate) fn bounded_hex_payload_len(
    value: &str,
    field: &str,
    max_bytes: usize,
) -> Result<bool, String> {
    let trimmed = value.trim();
    let Some(hex) = trimmed.strip_prefix("0x") else {
        return Err(format!("{field} must start with 0x"));
    };
    if hex.len() % 2 != 0 {
        return Err(format!("{field} must have an even hex length"));
    }
    Ok(hex.len() / 2 <= max_bytes)
}

pub(crate) fn prefixed_hash(bytes: &[u8]) -> String {
    format!("0x{}", hex_lower(&keccak256(bytes)))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

pub(crate) fn decode_hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

pub fn rpc_endpoint_fingerprint(rpc_url: &str) -> String {
    compact_hash_key_with_prefix(
        "rpc-endpoint",
        &normalized_secret_safe_rpc_identity(rpc_url),
    )
}

fn normalized_secret_safe_rpc_identity(rpc_url: &str) -> String {
    let trimmed = rpc_url.trim();
    let Some((scheme, rest)) = trimmed.split_once("://") else {
        return "[redacted_url]".to_string();
    };
    let scheme = scheme.to_ascii_lowercase();
    let rest = rest.split('#').next().unwrap_or_default();
    let authority_end = rest.find(['/', '?']).unwrap_or(rest.len());
    let authority = rest[..authority_end]
        .rsplit('@')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if authority.is_empty() {
        return "[redacted_url]".to_string();
    }
    let authority = canonical_rpc_authority(&scheme, &authority);
    let remainder = &rest[authority_end..];
    let (path, query) = match remainder.split_once('?') {
        Some((path, query)) => (if path.is_empty() { "/" } else { path }, Some(query)),
        None => {
            let path = if remainder.is_empty() { "/" } else { remainder };
            (path, None)
        }
    };
    let query = query
        .filter(|query| !query.is_empty())
        .map(|query| {
            query
                .split('&')
                .filter(|part| !part.is_empty())
                .map(|part| {
                    let key = part.split_once('=').map(|(key, _)| key).unwrap_or(part);
                    let key = decode_rpc_query_key(key);
                    format!("{key}=[redacted]")
                })
                .collect::<Vec<_>>()
                .join("&")
        })
        .filter(|query| !query.is_empty())
        .map(|query| format!("?{query}"))
        .unwrap_or_default();
    format!("{scheme}://{authority}{path}{query}")
}

pub fn summarize_rpc_endpoint(rpc_url: &str) -> String {
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

    format!("{scheme}://{}", canonical_rpc_authority(&scheme, authority))
}

fn canonical_rpc_authority(scheme: &str, authority: &str) -> String {
    let authority = authority.to_ascii_lowercase();
    if let Some(rest) = authority.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let bracketed_host = &authority[..=end + 1];
            let suffix = &authority[end + 2..];
            if let Some(port) = suffix.strip_prefix(':') {
                if is_default_rpc_port(scheme, port) {
                    return bracketed_host.to_string();
                }
            }
            return authority;
        }
    }
    if let Some((host, port)) = authority.rsplit_once(':') {
        if !host.contains(':') && is_default_rpc_port(scheme, port) {
            return host.to_string();
        }
    }
    authority
}

fn is_default_rpc_port(scheme: &str, port: &str) -> bool {
    matches!((scheme, port), ("https", "443") | ("http", "80"))
}

fn decode_rpc_query_key(value: &str) -> String {
    let mut bytes = Vec::with_capacity(value.len());
    let input = value.as_bytes();
    let mut index = 0;
    while index < input.len() {
        match input[index] {
            b'+' => {
                bytes.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < input.len() => {
                let high = input[index + 1];
                let low = input[index + 2];
                if let (Some(high), Some(low)) = (decode_hex_nibble(high), decode_hex_nibble(low)) {
                    bytes.push((high << 4) | low);
                    index += 3;
                } else {
                    bytes.push(input[index]);
                    index += 1;
                }
            }
            byte => {
                bytes.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn compact_hash_key_with_prefix(prefix: &str, value: &str) -> String {
    let mut hash = 0x811c9dc5u32;
    for code_unit in value.encode_utf16() {
        hash ^= code_unit as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{prefix}-{hash:08x}")
}
