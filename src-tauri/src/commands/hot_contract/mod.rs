mod aggregate;
mod code;
mod decode;
mod source;
mod types;

pub use aggregate::empty_aggregate_analysis;
pub use code::{rpc_endpoint_fingerprint, summarize_rpc_endpoint};
pub use decode::empty_decode_analysis;
pub use source::{normalize_fixture_source_samples, validate_source_outbound_request};
pub use types::*;

#[cfg(test)]
mod tests;

use ethers::providers::{Http, Middleware, Provider};
use tokio::time::{timeout, Duration};

use crate::diagnostics::sanitize_diagnostic_message;

use self::code::{fetch_contract_code, validate_selected_rpc};
use self::source::{
    fetch_normalized_source_samples, resolve_source_status, sample_coverage_from_fixture,
    EmptyHotContractSampleProvider, HotContractSampleProvider,
};

const STATUS_OK: &str = "ok";
const STATUS_VALIDATION_ERROR: &str = "validationError";
const STATUS_RPC_FAILURE: &str = "rpcFailure";
const STATUS_CHAIN_MISMATCH: &str = "chainMismatch";
const STATUS_CODE_ABSENT: &str = "codeAbsent";
const STATUS_SOURCE_UNAVAILABLE: &str = "sourceUnavailable";
const SOURCE_OK: &str = "ok";
const SOURCE_CHAIN_MISMATCH: &str = "chainMismatch";

#[cfg(not(test))]
const HOT_CONTRACT_RPC_TIMEOUT_SECONDS: u64 = 10;

#[tauri::command]
pub async fn fetch_hot_contract_analysis(
    input: HotContractAnalysisFetchInput,
) -> Result<HotContractAnalysisReadModel, String> {
    Ok(fetch_hot_contract_analysis_impl(input).await)
}

pub async fn fetch_hot_contract_analysis_impl(
    input: HotContractAnalysisFetchInput,
) -> HotContractAnalysisReadModel {
    fetch_hot_contract_analysis_with_sample_provider(input, &EmptyHotContractSampleProvider).await
}

pub(crate) async fn fetch_hot_contract_analysis_with_sample_provider(
    input: HotContractAnalysisFetchInput,
    sample_provider: &dyn HotContractSampleProvider,
) -> HotContractAnalysisReadModel {
    let endpoint = summarize_rpc_endpoint(&input.rpc_url);
    let normalized = match NormalizedHotContractInput::try_from(input) {
        Ok(input) => input,
        Err(error) => {
            let mut model =
                HotContractAnalysisReadModel::new(error.chain_id, error.contract_address, endpoint);
            model.status = STATUS_VALIDATION_ERROR.to_string();
            model.push_reason(error.reason.clone());
            model.error_summary = Some(error.reason);
            return model;
        }
    };

    let mut model = HotContractAnalysisReadModel::new(
        normalized.chain_id,
        normalized.contract_address.clone(),
        endpoint,
    );
    model.sources.source = resolve_source_status(
        normalized.chain_id,
        normalized.source.as_ref(),
        normalized.selected_rpc.provider_config_id.as_deref(),
    );
    let source_unavailable_reason = if model.sources.source.status == SOURCE_OK {
        None
    } else {
        model.sources.source.reason.clone()
    };
    let source_provider_config_id = normalized
        .source
        .as_ref()
        .and_then(|source| source.provider_config_id.as_deref())
        .or(normalized.selected_rpc.provider_config_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if let Err(reason) = validate_selected_rpc(
        &normalized.selected_rpc,
        normalized.chain_id,
        &normalized.rpc_url,
    ) {
        model.status = STATUS_VALIDATION_ERROR.to_string();
        model.push_reason(reason.clone());
        model.error_summary = Some(reason);
        return model;
    }

    let provider = match Provider::<Http>::try_from(normalized.rpc_url.as_str()) {
        Ok(provider) => provider,
        Err(error) => {
            let message = sanitized_summary(format!("rpc provider invalid: {error}"));
            model.status = STATUS_VALIDATION_ERROR.to_string();
            model.push_reason("rpcProviderInvalid");
            model.sources.chain_id =
                HotContractSourceStatus::unavailable("rpcProviderInvalid", Some(message.clone()));
            model.error_summary = Some(message);
            return model;
        }
    };

    let actual_chain_id = match rpc_chain_id_probe(&provider).await {
        Ok(value) => value,
        Err(error) => {
            let reason = if matches!(error, HotContractRpcError::Timeout) {
                "chainIdProbeTimeout"
            } else {
                "chainIdProbeFailed"
            };
            let message = error.sanitized_message("rpc chainId probe");
            model.status = STATUS_RPC_FAILURE.to_string();
            model.push_reason(reason);
            model.sources.chain_id =
                HotContractSourceStatus::unavailable(reason, Some(message.clone()));
            model.error_summary = Some(message);
            return model;
        }
    };
    model.rpc.actual_chain_id = Some(actual_chain_id);
    model.rpc.chain_status = SOURCE_OK.to_string();
    model.sources.chain_id = HotContractSourceStatus::ok();

    if actual_chain_id != normalized.chain_id {
        model.status = STATUS_CHAIN_MISMATCH.to_string();
        model.push_reason("chainMismatch");
        model.rpc.chain_status = SOURCE_CHAIN_MISMATCH.to_string();
        model.sources.chain_id =
            HotContractSourceStatus::new(SOURCE_CHAIN_MISMATCH, Some("chainMismatch"), None);
        model.error_summary = Some(format!(
            "chainId mismatch: expected {}, actual {}",
            normalized.chain_id, actual_chain_id
        ));
        return model;
    }

    match fetch_contract_code(&provider, &normalized.contract_address).await {
        Ok(code) => {
            model.code = code;
            if model.code.byte_length == Some(0) {
                model.status = STATUS_CODE_ABSENT.to_string();
                model.push_reason("codeAbsent");
                model.sources.code =
                    HotContractSourceStatus::new(STATUS_CODE_ABSENT, Some("codeAbsent"), None);
            } else {
                if let Some(reason) = source_unavailable_reason {
                    model.status = STATUS_SOURCE_UNAVAILABLE.to_string();
                    model.push_reason(reason.clone());
                    model.error_summary = Some(reason);
                } else {
                    populate_sample_coverage(
                        &mut model,
                        &normalized,
                        source_provider_config_id.as_deref(),
                        sample_provider,
                    );
                    if model.status == "pending" {
                        model.status = STATUS_OK.to_string();
                    }
                }
                model.sources.code = HotContractSourceStatus::ok();
            }
        }
        Err(error) => {
            let reason = if matches!(error, HotContractRpcError::Timeout) {
                "codeLookupTimeout"
            } else {
                "codeLookupFailed"
            };
            let message = error.sanitized_message("code lookup");
            model.status = STATUS_RPC_FAILURE.to_string();
            model.push_reason(reason);
            model.sources.code =
                HotContractSourceStatus::unavailable(reason, Some(message.clone()));
            model.code = HotContractCodeIdentity::unavailable(Some(message.clone()));
            model.error_summary = Some(message);
        }
    }

    model
}

fn populate_sample_coverage(
    model: &mut HotContractAnalysisReadModel,
    normalized: &NormalizedHotContractInput,
    provider_config_id: Option<&str>,
    sample_provider: &dyn HotContractSampleProvider,
) {
    let Some(provider_config_id) = provider_config_id else {
        return;
    };
    let source_input = normalized
        .source
        .clone()
        .unwrap_or_else(|| HotContractSourceFetchInput {
            provider_config_id: Some(provider_config_id.to_string()),
            limit: None,
            window: None,
            cursor: None,
        });
    let request = match validate_source_outbound_request(
        normalized.chain_id,
        provider_config_id,
        &normalized.contract_address,
        source_input,
    ) {
        Ok(request) => request,
        Err(error) => {
            let message = sanitized_summary(error);
            model.sources.source =
                HotContractSourceStatus::unavailable("sourceRequestInvalid", Some(message.clone()));
            model.status = STATUS_SOURCE_UNAVAILABLE.to_string();
            model.push_reason("sourceRequestInvalid");
            model.error_summary = Some(message);
            return;
        }
    };
    match fetch_normalized_source_samples(sample_provider, &request) {
        Ok(samples) => {
            model.sample_coverage =
                sample_coverage_from_fixture(&request, &model.sources.source, &samples);
            model.samples = samples.samples;
        }
        Err(error) => {
            model.sources.source =
                HotContractSourceStatus::unavailable("sourceFetchFailed", Some(error.clone()));
            model.sample_coverage.source_status = model.sources.source.status.clone();
            model.sample_coverage.requested_limit = request.limit;
            model.status = STATUS_SOURCE_UNAVAILABLE.to_string();
            model.push_reason("sourceFetchFailed");
            model.error_summary = Some(error);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HotContractRpcError {
    Timeout,
    Provider(String),
}

impl HotContractRpcError {
    fn sanitized_message(&self, stage: &str) -> String {
        match self {
            HotContractRpcError::Timeout => format!("{stage} timed out"),
            HotContractRpcError::Provider(error) => {
                sanitized_summary(format!("{stage} failed: {error}"))
            }
        }
    }
}

async fn rpc_chain_id_probe(provider: &Provider<Http>) -> Result<u64, HotContractRpcError> {
    timeout(rpc_timeout_duration(), provider.get_chainid())
        .await
        .map_err(|_| HotContractRpcError::Timeout)?
        .map(|value| value.as_u64())
        .map_err(|error| HotContractRpcError::Provider(error.to_string()))
}

#[cfg(test)]
fn rpc_timeout_duration() -> Duration {
    Duration::from_millis(150)
}

#[cfg(not(test))]
fn rpc_timeout_duration() -> Duration {
    Duration::from_secs(HOT_CONTRACT_RPC_TIMEOUT_SECONDS)
}

pub(crate) fn sanitized_summary(value: impl AsRef<str>) -> String {
    sanitize_diagnostic_message(value.as_ref())
}
