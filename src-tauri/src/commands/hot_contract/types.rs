use ethers::types::Address;
use ethers::utils::to_checksum;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

use super::{empty_aggregate_analysis, empty_decode_analysis};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotContractAnalysisFetchInput {
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "contract_address")]
    pub contract_address: String,
    #[serde(default, alias = "selected_rpc")]
    pub selected_rpc: Option<HotContractSelectedRpcInput>,
    #[serde(default)]
    pub source: Option<HotContractSourceFetchInput>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractSelectedRpcInput {
    #[serde(default, alias = "chain_id")]
    pub chain_id: Option<u64>,
    #[serde(default, alias = "provider_config_id")]
    pub provider_config_id: Option<String>,
    #[serde(default, alias = "endpoint_id")]
    pub endpoint_id: Option<String>,
    #[serde(default, alias = "endpoint_name")]
    pub endpoint_name: Option<String>,
    #[serde(default, alias = "endpoint_summary")]
    pub endpoint_summary: Option<String>,
    #[serde(default, alias = "endpoint_fingerprint")]
    pub endpoint_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractSourceFetchInput {
    #[serde(default, alias = "provider_config_id")]
    pub provider_config_id: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub window: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractAnalysisReadModel {
    pub status: String,
    pub reasons: Vec<String>,
    pub chain_id: u64,
    pub contract: HotContractIdentity,
    pub rpc: HotContractRpcSummary,
    pub code: HotContractCodeIdentity,
    pub sources: HotContractSourceStatuses,
    pub sample_coverage: HotContractSampleCoverage,
    pub samples: Vec<HotContractSourceSample>,
    pub analysis: HotContractAggregateAnalysis,
    pub decode: HotContractDecodeAnalysis,
    pub error_summary: Option<String>,
}

impl HotContractAnalysisReadModel {
    pub fn new(chain_id: u64, contract_address: String, endpoint: String) -> Self {
        Self {
            status: "pending".to_string(),
            reasons: Vec::new(),
            chain_id,
            contract: HotContractIdentity {
                address: contract_address,
            },
            rpc: HotContractRpcSummary {
                endpoint,
                expected_chain_id: chain_id,
                actual_chain_id: None,
                chain_status: "notRequested".to_string(),
            },
            code: HotContractCodeIdentity::not_requested(),
            sources: HotContractSourceStatuses::default(),
            sample_coverage: HotContractSampleCoverage::default(),
            samples: Vec::new(),
            analysis: empty_aggregate_analysis(),
            decode: empty_decode_analysis(),
            error_summary: None,
        }
    }

    pub fn push_reason(&mut self, reason: impl Into<String>) {
        let reason = reason.into();
        if !self.reasons.iter().any(|existing| existing == &reason) {
            self.reasons.push(reason);
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractIdentity {
    pub address: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractRpcSummary {
    pub endpoint: String,
    pub expected_chain_id: u64,
    pub actual_chain_id: Option<u64>,
    pub chain_status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractCodeIdentity {
    pub status: String,
    pub block_tag: String,
    pub byte_length: Option<u64>,
    pub code_hash_version: Option<String>,
    pub code_hash: Option<String>,
    pub error_summary: Option<String>,
}

impl HotContractCodeIdentity {
    pub fn not_requested() -> Self {
        Self {
            status: "notRequested".to_string(),
            block_tag: "latest".to_string(),
            byte_length: None,
            code_hash_version: None,
            code_hash: None,
            error_summary: None,
        }
    }

    pub fn unavailable(error_summary: Option<String>) -> Self {
        Self {
            status: "unavailable".to_string(),
            block_tag: "latest".to_string(),
            byte_length: None,
            code_hash_version: None,
            code_hash: None,
            error_summary,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractSourceStatuses {
    pub chain_id: HotContractSourceStatus,
    pub code: HotContractSourceStatus,
    pub source: HotContractSourceStatus,
}

impl Default for HotContractSourceStatuses {
    fn default() -> Self {
        Self {
            chain_id: HotContractSourceStatus::not_requested(),
            code: HotContractSourceStatus::not_requested(),
            source: HotContractSourceStatus::not_requested(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractSourceStatus {
    pub status: String,
    pub reason: Option<String>,
    pub error_summary: Option<String>,
}

impl HotContractSourceStatus {
    pub fn new(status: &str, reason: Option<&str>, error_summary: Option<String>) -> Self {
        Self {
            status: status.to_string(),
            reason: reason.map(str::to_string),
            error_summary,
        }
    }

    pub fn ok() -> Self {
        Self::new("ok", None, None)
    }

    pub fn not_requested() -> Self {
        Self::new("notRequested", None, None)
    }

    pub fn unavailable(reason: &str, error_summary: Option<String>) -> Self {
        Self::new("unavailable", Some(reason), error_summary)
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractAggregateAnalysis {
    pub selectors: Vec<HotContractSelectorAggregate>,
    pub topics: Vec<HotContractTopicAggregate>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractSelectorAggregate {
    pub selector: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractTopicAggregate {
    pub topic: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractDecodeAnalysis {
    pub items: Vec<HotContractDecodeItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractDecodeItem {
    pub status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractSourceOutboundRequest {
    pub chain_id: u64,
    pub provider_config_id: String,
    pub contract_address: String,
    pub limit: u32,
    pub window: Option<String>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct HotContractSampleCoverage {
    pub requested_limit: u32,
    pub returned_samples: u64,
    pub omitted_samples: u64,
    pub source_status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractSourceSample {
    pub chain_id: u64,
    pub contract_address: String,
    pub tx_hash: Option<String>,
    pub block_time: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub value: Option<String>,
    pub status: Option<String>,
    pub selector: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calldata: Option<String>,
    pub calldata_length: Option<u64>,
    pub calldata_hash: Option<String>,
    pub log_topic0: Vec<String>,
    pub provider_label: Option<String>,
    pub block_number: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotContractFixtureSamples {
    pub samples: Vec<HotContractSourceSample>,
    pub omitted_count: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct NormalizedHotContractInput {
    pub rpc_url: String,
    pub chain_id: u64,
    pub contract_address: String,
    pub selected_rpc: HotContractSelectedRpcInput,
    pub source: Option<HotContractSourceFetchInput>,
}

#[derive(Debug, Clone)]
pub(crate) struct HotContractInputError {
    pub chain_id: u64,
    pub contract_address: String,
    pub reason: String,
}

impl TryFrom<HotContractAnalysisFetchInput> for NormalizedHotContractInput {
    type Error = HotContractInputError;

    fn try_from(input: HotContractAnalysisFetchInput) -> Result<Self, Self::Error> {
        let chain_id = input.chain_id;
        let contract_seed = input.contract_address.trim().to_string();
        if chain_id == 0 {
            return Err(HotContractInputError {
                chain_id,
                contract_address: contract_seed,
                reason: "chainId must be greater than zero".to_string(),
            });
        }
        let contract_address =
            normalize_contract_address(&contract_seed).map_err(|reason| HotContractInputError {
                chain_id,
                contract_address: contract_seed.clone(),
                reason,
            })?;
        let selected_rpc = input.selected_rpc.ok_or_else(|| HotContractInputError {
            chain_id,
            contract_address: contract_address.clone(),
            reason: "selectedRpc is required for hot contract analysis fetch".to_string(),
        })?;
        Ok(Self {
            rpc_url: input.rpc_url,
            chain_id,
            contract_address,
            selected_rpc,
            source: input.source,
        })
    }
}

fn normalize_contract_address(value: &str) -> Result<String, String> {
    let address = Address::from_str(value)
        .map_err(|_| "contractAddress must be a 20-byte 0x-prefixed hex address".to_string())?;
    if !value.trim().starts_with("0x") || value.trim().len() != 42 {
        return Err("contractAddress must be a 20-byte 0x-prefixed hex address".to_string());
    }
    Ok(to_checksum(&address, None))
}
