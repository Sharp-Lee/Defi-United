use crate::commands::abi_registry::{load_abi_registry_state_readonly, AbiDataSourceConfigRecord};

use super::code::{bounded_hex_payload_len, prefixed_hash};
use super::sanitized_summary;
use super::types::{
    HotContractFixtureSamples, HotContractSampleCoverage, HotContractSourceFetchInput,
    HotContractSourceOutboundRequest, HotContractSourceSample, HotContractSourceStatus,
};

const DEFAULT_SOURCE_LIMIT: u32 = 25;
const MAX_SOURCE_LIMIT: u32 = 500;
const MAX_SAMPLE_CALLDATA_BYTES: usize = 4096;
const SOURCE_WINDOW_ERROR: &str = "source window must be 1h..720h or 1d..30d";
const ERC20_APPROVE_SELECTOR: &str = "0x095ea7b3";
const SUPPORTED_SAMPLING_PROVIDER_KINDS: &[&str] = &[
    "explorerConfigured",
    "customIndexer",
    "etherscanCompatible",
    "blockscoutCompatible",
];

#[allow(dead_code)]
pub(crate) trait HotContractSampleProvider: Send + Sync {
    fn fetch_samples(
        &self,
        request: &HotContractSourceOutboundRequest,
    ) -> Result<Vec<HotContractSourceSample>, String>;
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct EmptyHotContractSampleProvider;

impl HotContractSampleProvider for EmptyHotContractSampleProvider {
    fn fetch_samples(
        &self,
        _request: &HotContractSourceOutboundRequest,
    ) -> Result<Vec<HotContractSourceSample>, String> {
        Ok(Vec::new())
    }
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub(crate) struct FixtureHotContractSampleProvider {
    samples: Vec<HotContractSourceSample>,
}

#[cfg(test)]
impl FixtureHotContractSampleProvider {
    pub(crate) fn new(samples: Vec<HotContractSourceSample>) -> Self {
        Self { samples }
    }
}

#[cfg(test)]
impl HotContractSampleProvider for FixtureHotContractSampleProvider {
    fn fetch_samples(
        &self,
        _request: &HotContractSourceOutboundRequest,
    ) -> Result<Vec<HotContractSourceSample>, String> {
        Ok(self.samples.clone())
    }
}

pub fn resolve_source_status(
    chain_id: u64,
    source: Option<&HotContractSourceFetchInput>,
) -> HotContractSourceStatus {
    let provider_config_id = source
        .and_then(|source| source.provider_config_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let Some(provider_config_id) = provider_config_id else {
        return HotContractSourceStatus::new("missing", Some("sourceProviderMissing"), None);
    };

    let state = match load_abi_registry_state_readonly() {
        Ok(state) => state,
        Err(error) => {
            return HotContractSourceStatus::unavailable(
                "sourceRegistryUnavailable",
                Some(sanitized_summary(error)),
            );
        }
    };

    if let Some(provider) = state
        .data_sources
        .iter()
        .find(|source| source.id == provider_config_id && source.chain_id == chain_id)
    {
        return provider_status(provider, chain_id);
    }

    if state
        .data_sources
        .iter()
        .any(|source| source.id == provider_config_id)
    {
        return HotContractSourceStatus::new("wrongChain", Some("sourceWrongChain"), None);
    }

    HotContractSourceStatus::new("missing", Some("sourceProviderMissing"), None)
}

fn provider_status(provider: &AbiDataSourceConfigRecord, chain_id: u64) -> HotContractSourceStatus {
    if provider.chain_id != chain_id {
        return HotContractSourceStatus::new("wrongChain", Some("sourceWrongChain"), None);
    }
    if !provider.enabled {
        return HotContractSourceStatus::new("disabled", Some("sourceDisabled"), None);
    }
    if provider.rate_limited {
        return HotContractSourceStatus::new(
            "rateLimited",
            Some("sourceRateLimited"),
            provider.last_error_summary.as_ref().map(sanitized_summary),
        );
    }
    if provider.cooldown_until.is_some() {
        return HotContractSourceStatus::new("stale", Some("sourceStale"), None);
    }
    if !SUPPORTED_SAMPLING_PROVIDER_KINDS.contains(&provider.provider_kind.as_str()) {
        return HotContractSourceStatus::new("unsupported", Some("sourceUnsupported"), None);
    }

    HotContractSourceStatus::ok()
}

pub fn validate_source_outbound_request(
    chain_id: u64,
    provider_config_id: &str,
    contract_address: &str,
    input: HotContractSourceFetchInput,
) -> Result<HotContractSourceOutboundRequest, String> {
    let provider_config_id = provider_config_id.trim();
    if provider_config_id.is_empty() {
        return Err("source providerConfigId is required".to_string());
    }
    let limit = input
        .limit
        .unwrap_or(DEFAULT_SOURCE_LIMIT)
        .clamp(1, MAX_SOURCE_LIMIT);
    let window = input
        .window
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(normalize_source_window)
        .transpose()?;
    let cursor = input
        .cursor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sanitized_summary);

    Ok(HotContractSourceOutboundRequest {
        chain_id,
        provider_config_id: provider_config_id.to_string(),
        contract_address: contract_address.to_string(),
        limit,
        window,
        cursor,
    })
}

fn normalize_source_window(value: &str) -> Result<String, String> {
    let Some(unit) = value.chars().last().map(|char| char.to_ascii_lowercase()) else {
        return Err(SOURCE_WINDOW_ERROR.to_string());
    };
    if unit != 'h' && unit != 'd' {
        return Err(SOURCE_WINDOW_ERROR.to_string());
    }
    let amount = &value[..value.len().saturating_sub(1)];
    if amount.is_empty() || !amount.chars().all(|char| char.is_ascii_digit()) {
        return Err(SOURCE_WINDOW_ERROR.to_string());
    }
    let parsed = amount
        .parse::<u32>()
        .map_err(|_| SOURCE_WINDOW_ERROR.to_string())?;
    match unit {
        'h' if (1..=720).contains(&parsed) => Ok(format!("{parsed}h")),
        'd' if (1..=30).contains(&parsed) => Ok(format!("{parsed}d")),
        _ => Err(SOURCE_WINDOW_ERROR.to_string()),
    }
}

pub(crate) fn fetch_normalized_source_samples(
    provider: &dyn HotContractSampleProvider,
    request: &HotContractSourceOutboundRequest,
) -> Result<HotContractFixtureSamples, String> {
    provider
        .fetch_samples(request)
        .map(|samples| normalize_fixture_source_samples(samples, request.limit as usize))
        .map_err(sanitized_summary)
}

pub(crate) fn sample_coverage_from_fixture(
    request: &HotContractSourceOutboundRequest,
    source_status: &HotContractSourceStatus,
    samples: &HotContractFixtureSamples,
) -> HotContractSampleCoverage {
    HotContractSampleCoverage {
        requested_limit: request.limit,
        returned_samples: samples.samples.len() as u64,
        omitted_samples: samples.omitted_count,
        source_status: source_status.status.clone(),
    }
}

pub fn normalize_fixture_source_samples(
    samples: Vec<HotContractSourceSample>,
    cap: usize,
) -> HotContractFixtureSamples {
    let total = samples.len();
    let samples = samples
        .into_iter()
        .take(cap)
        .map(normalize_fixture_source_sample)
        .collect::<Vec<_>>();
    HotContractFixtureSamples {
        omitted_count: total.saturating_sub(samples.len()) as u64,
        samples,
    }
}

fn normalize_fixture_source_sample(mut sample: HotContractSourceSample) -> HotContractSourceSample {
    if let Some(calldata) = sample.calldata.take() {
        let calldata = calldata.trim();
        sample.calldata_length = calldata
            .strip_prefix("0x")
            .filter(|hex| hex.len() % 2 == 0)
            .map(|hex| (hex.len() / 2) as u64);
        sample.selector = sample.selector.or_else(|| {
            calldata
                .strip_prefix("0x")
                .filter(|hex| hex.len() >= 8)
                .map(|hex| format!("0x{}", hex[..8].to_ascii_lowercase()))
        });
        sample.approve_amount_is_zero = approve_amount_is_zero_hint(calldata);
        if bounded_hex_payload_len(&calldata, "calldata", MAX_SAMPLE_CALLDATA_BYTES)
            .unwrap_or(false)
        {
            let bytes = decode_hex_bytes_lossy(&calldata);
            sample.calldata_hash = Some(prefixed_hash(&bytes));
        } else {
            sample.calldata_hash = Some("payloadTooLarge".to_string());
        }
    }
    sample.contract_address = normalize_hex_summary(sample.contract_address, 40);
    sample.tx_hash = sample.tx_hash.map(|value| normalize_hex_summary(value, 64));
    sample.block_time = sample.block_time.map(normalize_sample_text);
    sample.from = sample.from.map(|value| normalize_hex_summary(value, 40));
    sample.to = sample.to.map(|value| normalize_hex_summary(value, 40));
    sample.value = sample.value.map(normalize_sample_text);
    sample.status = sample.status.map(normalize_sample_text);
    sample.selector = sample.selector.map(|value| normalize_hex_summary(value, 8));
    sample.log_topic0 = sample
        .log_topic0
        .into_iter()
        .map(|value| normalize_hex_summary(value, 64))
        .filter(|value| !value.is_empty())
        .take(16)
        .collect();
    sample.provider_label = sample.provider_label.map(normalize_sample_text);
    sample
}

fn approve_amount_is_zero_hint(calldata: &str) -> Option<bool> {
    let hex = calldata.trim().strip_prefix("0x")?;
    if hex.len() != 8 + 64 + 64 || !hex.as_bytes().iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    if !format!("0x{}", &hex[..8]).eq_ignore_ascii_case(ERC20_APPROVE_SELECTOR) {
        return None;
    }
    Some(hex[72..136].as_bytes().iter().all(|byte| *byte == b'0'))
}

fn normalize_sample_text(value: String) -> String {
    sanitize_sample_summary(value.trim())
}

fn sanitize_sample_summary(value: &str) -> String {
    let sanitized = sanitized_summary(value.trim());
    let lower = sanitized.to_ascii_lowercase();
    if lower.contains("provider raw response body")
        || lower.contains("full logs")
        || lower.contains("full revert data")
        || lower.contains("secreturl")
        || lower.contains("querytoken")
        || lower.contains("privatekey")
        || lower.contains("rawsignedtx")
    {
        "[redacted]".to_string()
    } else {
        sanitized
    }
}

fn normalize_hex_summary(value: String, expected_hex_len: usize) -> String {
    let trimmed = value.trim();
    let Some(hex) = trimmed.strip_prefix("0x") else {
        return sanitize_sample_summary(trimmed);
    };
    if hex.len() == expected_hex_len && hex.as_bytes().iter().all(u8::is_ascii_hexdigit) {
        return format!("0x{}", hex.to_ascii_lowercase());
    }
    sanitize_sample_summary(trimmed)
}

fn decode_hex_bytes_lossy(value: &str) -> Vec<u8> {
    let Some(hex) = value.trim().strip_prefix("0x") else {
        return Vec::new();
    };
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for pair in hex.as_bytes().chunks_exact(2) {
        let high = super::code::decode_hex_nibble(pair[0]).unwrap_or(0);
        let low = super::code::decode_hex_nibble(pair[1]).unwrap_or(0);
        bytes.push((high << 4) | low);
    }
    bytes
}
