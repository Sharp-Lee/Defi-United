use crate::commands::abi_registry::{
    load_abi_registry_state_readonly, resolve_api_key_ref, AbiDataSourceConfigRecord,
};
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::code::{bounded_hex_payload_len, prefixed_hash};
use super::sanitized_summary;
use super::types::{
    HotContractFixtureSamples, HotContractSampleCoverage, HotContractSourceFetchInput,
    HotContractSourceOutboundRequest, HotContractSourceSample, HotContractSourceStatus,
};

const DEFAULT_SOURCE_LIMIT: u32 = 25;
const MAX_SOURCE_LIMIT: u32 = 500;
const MAX_SAMPLE_CALLDATA_BYTES: usize = 4096;
const SOURCE_REQUEST_TIMEOUT_SECONDS: u64 = 10;
const SOURCE_RESPONSE_SIZE_LIMIT_BYTES: usize = 1024 * 1024;
const SOURCE_WINDOW_ERROR: &str = "source window must be 1h..720h or 1d..30d";
const ERC20_APPROVE_SELECTOR: &str = "0x095ea7b3";
const SUPPORTED_SAMPLING_PROVIDER_KINDS: &[&str] = &[
    "explorerConfigured",
    "customIndexer",
    "etherscanCompatible",
    "blockscoutCompatible",
];

pub(crate) type SampleFetchFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<HotContractSourceSample>, String>> + Send + 'a>>;

pub(crate) trait HotContractSampleProvider: Send + Sync {
    fn fetch_samples<'a>(
        &'a self,
        request: &'a HotContractSourceOutboundRequest,
    ) -> SampleFetchFuture<'a>;
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ProductionHotContractSampleProvider;

impl HotContractSampleProvider for ProductionHotContractSampleProvider {
    fn fetch_samples<'a>(
        &'a self,
        request: &'a HotContractSourceOutboundRequest,
    ) -> SampleFetchFuture<'a> {
        Box::pin(async move { fetch_production_source_samples(request).await })
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
    fn fetch_samples<'a>(
        &'a self,
        _request: &'a HotContractSourceOutboundRequest,
    ) -> SampleFetchFuture<'a> {
        Box::pin(async move { Ok(self.samples.clone()) })
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

pub(crate) fn resolve_source_kind(
    chain_id: u64,
    provider_config_id: Option<&str>,
) -> Option<String> {
    let provider_config_id = provider_config_id
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let state = load_abi_registry_state_readonly().ok()?;
    state
        .data_sources
        .iter()
        .find(|source| source.id == provider_config_id && source.chain_id == chain_id)
        .map(|source| source.provider_kind.clone())
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
    if cooldown_is_active(provider.cooldown_until.as_deref()) {
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
    let value = value.trim().to_ascii_lowercase();
    let Some(amount) = value.strip_suffix('h').or_else(|| value.strip_suffix('d')) else {
        return Err(SOURCE_WINDOW_ERROR.to_string());
    };
    if amount.is_empty() || !amount.chars().all(|char| char.is_ascii_digit()) {
        return Err(SOURCE_WINDOW_ERROR.to_string());
    }
    let parsed = amount
        .parse::<u32>()
        .map_err(|_| SOURCE_WINDOW_ERROR.to_string())?;
    if value.ends_with('h') && (1..=720).contains(&parsed) {
        Ok(format!("{parsed}h"))
    } else if value.ends_with('d') && (1..=30).contains(&parsed) {
        Ok(format!("{parsed}d"))
    } else {
        Err(SOURCE_WINDOW_ERROR.to_string())
    }
}

pub(crate) async fn fetch_normalized_source_samples(
    provider: &dyn HotContractSampleProvider,
    request: &HotContractSourceOutboundRequest,
) -> Result<HotContractFixtureSamples, String> {
    provider
        .fetch_samples(request)
        .await
        .map(|samples| normalize_fixture_source_samples(samples, request.limit as usize))
        .map_err(sanitized_summary)
}

async fn fetch_production_source_samples(
    request: &HotContractSourceOutboundRequest,
) -> Result<Vec<HotContractSourceSample>, String> {
    let state =
        load_abi_registry_state_readonly().map_err(|_| "sourceRegistryUnavailable".to_string())?;
    let provider = state
        .data_sources
        .iter()
        .find(|source| {
            source.id == request.provider_config_id && source.chain_id == request.chain_id
        })
        .ok_or_else(|| "sourceProviderMissing".to_string())?;
    let status = provider_status(provider, request.chain_id);
    if status.status != "ok" {
        return Err(status.reason.unwrap_or(status.status));
    }
    let base_url = provider
        .base_url
        .as_deref()
        .ok_or_else(|| "sourceBaseUrlMissing".to_string())?;
    let api_key = resolve_api_key_ref(provider.api_key_ref.as_deref())
        .map_err(|failure_class| failure_class.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(SOURCE_REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|_| "sourceClientBuildFailed".to_string())?;
    let mut http_request = client.get(base_url);
    let limit = request.limit.to_string();
    if provider.provider_kind == "customIndexer" {
        http_request = http_request.query(&[
            ("address", request.contract_address.as_str()),
            ("limit", limit.as_str()),
        ]);
        if let Some(window) = request.window.as_deref() {
            http_request = http_request.query(&[("window", window)]);
        }
        if let Some(cursor) = request.cursor.as_deref() {
            http_request = http_request.query(&[("cursor", cursor)]);
        }
    } else {
        if request.window.is_some() {
            return Err("sourceWindowUnsupported".to_string());
        }
        http_request = http_request.query(&[
            ("module", "account"),
            ("action", "txlist"),
            ("address", request.contract_address.as_str()),
            ("page", "1"),
            ("offset", limit.as_str()),
            ("sort", "desc"),
        ]);
    }
    if let Some(api_key) = api_key.as_deref() {
        http_request = http_request.query(&[("apikey", api_key)]);
    }
    let response = http_request.send().await.map_err(|error| {
        if error.is_timeout() {
            "sourceTimeout"
        } else {
            "sourceNetworkError"
        }
        .to_string()
    })?;
    let status = response.status();
    if status.as_u16() == 429 {
        return Err("sourceRateLimited".to_string());
    }
    if !status.is_success() {
        return Err(format!("sourceHttp{}", status.as_u16()));
    }
    if response
        .content_length()
        .filter(|len| *len > SOURCE_RESPONSE_SIZE_LIMIT_BYTES as u64)
        .is_some()
    {
        return Err("sourcePayloadTooLarge".to_string());
    }
    let text = read_source_response_text_limited(response).await?;
    parse_source_response_samples(&text, request)
}

async fn read_source_response_text_limited(
    mut response: reqwest::Response,
) -> Result<String, String> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        if error.is_timeout() {
            "sourceTimeout"
        } else {
            "sourceReadFailed"
        }
        .to_string()
    })? {
        if body.len().saturating_add(chunk.len()) > SOURCE_RESPONSE_SIZE_LIMIT_BYTES {
            return Err("sourcePayloadTooLarge".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| "sourceInvalidUtf8".to_string())
}

fn parse_source_response_samples(
    text: &str,
    request: &HotContractSourceOutboundRequest,
) -> Result<Vec<HotContractSourceSample>, String> {
    let value = serde_json::from_str::<Value>(text).map_err(|_| "sourceInvalidJson".to_string())?;
    let sample_values = match &value {
        Value::Array(items) => items,
        Value::Object(object) => {
            if let Some(Value::Array(samples)) = object.get("samples") {
                samples
            } else if let Some(Value::Array(result)) = object.get("result") {
                result
            } else {
                let explorer_status = object.get("status").and_then(Value::as_str);
                if explorer_status == Some("0") {
                    return Err("sourceReturnedNotOk".to_string());
                }
                return Err("sourceMissingSamples".to_string());
            }
        }
        _ => return Err("sourceUnexpectedJsonShape".to_string()),
    };
    sample_values
        .iter()
        .map(|value| map_source_sample(value, request))
        .collect()
}

fn map_source_sample(
    value: &Value,
    request: &HotContractSourceOutboundRequest,
) -> Result<HotContractSourceSample, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "sourceInvalidSample".to_string())?;
    let tx_hash = string_field(value, &["txHash", "hash"]);
    let calldata = string_field(value, &["calldata", "input"]);
    let selector = string_field(value, &["selector", "methodId"]);
    let log_topic0 = object
        .get("logTopic0")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(value_to_string).collect::<Vec<_>>())
        .unwrap_or_default();
    if tx_hash.is_none() && calldata.is_none() && selector.is_none() && log_topic0.is_empty() {
        return Err("sourceInvalidSample".to_string());
    }
    let explicit_created_contract = string_field(
        value,
        &[
            "createdContractAddress",
            "createdContract",
            "contractCreated",
        ],
    )
    .filter(|address| address.eq_ignore_ascii_case(&request.contract_address));
    let to = if explicit_created_contract.is_some() {
        None
    } else {
        string_field(value, &["to"]).or_else(|| Some(request.contract_address.clone()))
    };
    Ok(HotContractSourceSample {
        chain_id: request.chain_id,
        contract_address: request.contract_address.clone(),
        tx_hash,
        block_time: string_field(value, &["blockTime", "timeStamp"]),
        from: string_field(value, &["from"]),
        to,
        value: string_field(value, &["value"]),
        status: sample_status(value).or_else(|| string_field(value, &["status"])),
        selector,
        calldata,
        approve_amount_is_zero: None,
        calldata_length: None,
        calldata_hash: None,
        log_topic0,
        provider_label: string_field(value, &["providerLabel", "functionName"]),
        block_number: string_field(value, &["blockNumber"]).and_then(|value| value.parse().ok()),
    })
}

fn string_field(value: &Value, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(value_to_string))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn sample_status(value: &Value) -> Option<String> {
    if string_field(value, &["isError"]).as_deref() == Some("1") {
        return Some("reverted".to_string());
    }
    match string_field(value, &["txreceipt_status"]).as_deref() {
        Some("1") => Some("success".to_string()),
        Some("0") => Some("reverted".to_string()),
        _ => None,
    }
}

fn cooldown_is_active(cooldown_until: Option<&str>) -> bool {
    let Some(cooldown_until) = cooldown_until
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    let Some(target) = parse_unix_seconds_like(cooldown_until) else {
        return false;
    };
    current_unix_seconds()
        .map(|now| target > now)
        .unwrap_or(false)
}

fn current_unix_seconds() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

fn parse_unix_seconds_like(value: &str) -> Option<u64> {
    if value.chars().all(|char| char.is_ascii_digit()) {
        return value.parse().ok();
    }
    parse_rfc3339_unix_seconds(value)
}

fn parse_rfc3339_unix_seconds(value: &str) -> Option<u64> {
    let (date, time) = value.split_once('T')?;
    let mut date_parts = date.split('-');
    let year: i32 = date_parts.next()?.parse().ok()?;
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;
    if date_parts.next().is_some() || !(1..=12).contains(&month) || day == 0 {
        return None;
    }

    let ((hour, minute, second), tz_offset_seconds) = parse_rfc3339_time_and_offset(time)?;
    let days = days_from_civil(year, month, day)?;
    let seconds = days
        .checked_mul(86_400)?
        .checked_add(i64::from(hour) * 3_600)?
        .checked_add(i64::from(minute) * 60)?
        .checked_add(i64::from(second))?;
    let adjusted = seconds.checked_sub(i64::from(tz_offset_seconds))?;
    u64::try_from(adjusted).ok()
}

fn parse_rfc3339_time_and_offset(value: &str) -> Option<((u32, u32, u32), i32)> {
    let (clock, offset) = if let Some(clock) = value.strip_suffix('Z') {
        (clock, 0)
    } else {
        let split_index = value.rfind('+').or_else(|| value.rfind('-'))?;
        let sign = if value.as_bytes().get(split_index) == Some(&b'+') {
            1
        } else {
            -1
        };
        let clock = &value[..split_index];
        let offset_text = &value[split_index + 1..];
        let mut offset_parts = offset_text.split(':');
        let hours: i32 = offset_parts.next()?.parse().ok()?;
        let minutes: i32 = offset_parts.next()?.parse().ok()?;
        if offset_parts.next().is_some() || hours > 23 || minutes > 59 {
            return None;
        }
        (clock, sign * (hours * 3_600 + minutes * 60))
    };

    let mut parts = clock.split(':');
    let hour: u32 = parts.next()?.parse().ok()?;
    let minute: u32 = parts.next()?.parse().ok()?;
    let second_part = parts.next()?;
    if parts.next().is_some() || hour > 23 || minute > 59 {
        return None;
    }
    let second = second_part
        .split_once('.')
        .map(|(whole, _)| whole)
        .unwrap_or(second_part)
        .parse()
        .ok()?;
    if second > 60 {
        return None;
    }
    Some(((hour, minute, second), offset))
}

fn days_from_civil(year: i32, month: u32, day: u32) -> Option<i64> {
    let month_lengths = [
        31,
        if is_leap_year(year) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let month_index = month.checked_sub(1)? as usize;
    if month_index >= month_lengths.len() || day > month_lengths[month_index] {
        return None;
    }
    let y = i64::from(year) - i64::from(month <= 2);
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = i64::from(month) + if month > 2 { -3 } else { 9 };
    let doy = (153 * m + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146097 + doe - 719468)
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

pub(crate) fn sample_coverage_from_fixture(
    request: &HotContractSourceOutboundRequest,
    source_status: &HotContractSourceStatus,
    source_kind: Option<&str>,
    samples: &HotContractFixtureSamples,
) -> HotContractSampleCoverage {
    build_sample_coverage(
        request,
        source_status,
        source_kind,
        &samples.samples,
        samples.omitted_count,
        "ok",
    )
}

pub(crate) fn build_sample_coverage(
    request: &HotContractSourceOutboundRequest,
    source_status: &HotContractSourceStatus,
    source_kind: Option<&str>,
    samples: &[HotContractSourceSample],
    omitted_count: u64,
    payload_status: &str,
) -> HotContractSampleCoverage {
    let (oldest_block, newest_block, oldest_block_time, newest_block_time) = sample_bounds(samples);
    let provider_status = source_status.status.clone();
    let rate_limit_status = if source_status.status == "rateLimited" {
        "rateLimited".to_string()
    } else if source_status.status == "ok" {
        "notRateLimited".to_string()
    } else {
        "unknown".to_string()
    };
    let completeness = if payload_status == "ok" {
        if omitted_count > 0 {
            "partial"
        } else if !samples.is_empty() {
            "complete"
        } else {
            "unknown"
        }
    } else {
        "unknown"
    };
    HotContractSampleCoverage {
        requested_limit: request.limit,
        returned_samples: samples.len() as u64,
        omitted_samples: omitted_count,
        source_status: source_status.status.clone(),
        source_kind: source_kind.map(str::to_string),
        provider_config_id: Some(request.provider_config_id.clone())
            .filter(|value| !value.is_empty()),
        query_window: request.window.clone(),
        oldest_block,
        newest_block,
        oldest_block_time,
        newest_block_time,
        provider_status,
        rate_limit_status,
        completeness: completeness.to_string(),
        payload_status: payload_status.to_string(),
    }
}

fn sample_bounds(
    samples: &[HotContractSourceSample],
) -> (Option<u64>, Option<u64>, Option<String>, Option<String>) {
    let oldest = samples
        .iter()
        .filter_map(|sample| {
            sample
                .block_number
                .map(|block| (block, sample.block_time.clone()))
        })
        .min_by_key(|(block, _)| *block);
    let newest = samples
        .iter()
        .filter_map(|sample| {
            sample
                .block_number
                .map(|block| (block, sample.block_time.clone()))
        })
        .max_by_key(|(block, _)| *block);

    (
        oldest.as_ref().map(|(block, _)| *block),
        newest.as_ref().map(|(block, _)| *block),
        oldest.and_then(|(_, time)| time),
        newest.and_then(|(_, time)| time),
    )
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
