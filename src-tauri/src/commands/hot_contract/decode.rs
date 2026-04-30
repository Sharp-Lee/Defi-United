use std::collections::BTreeSet;
use std::fs;

use ethers::utils::keccak256;
use serde_json::Value;

use crate::commands::abi_registry::{
    load_abi_registry_state_readonly, AbiCacheEntryRecord, AbiSelectorSummaryRecord,
};
use crate::diagnostics::sanitize_diagnostic_message;
use crate::storage::abi_artifact_path_readonly;

use super::aggregate::{is_selector, is_topic};
use super::types::{
    HotContractAbiSourceSummary, HotContractAggregateAnalysis, HotContractClassificationCandidate,
    HotContractDecodeAnalysis, HotContractDecodeItem, HotContractSourceSample,
    HotContractUncertaintyStatus,
};

pub fn empty_decode_analysis() -> HotContractDecodeAnalysis {
    HotContractDecodeAnalysis {
        status: "notRequested".to_string(),
        items: Vec::new(),
        abi_sources: Vec::new(),
        classification_candidates: Vec::new(),
        uncertainty_statuses: Vec::new(),
    }
}

pub(crate) fn decode_samples(
    chain_id: u64,
    contract_address: &str,
    samples: &[HotContractSourceSample],
    omitted_samples: u64,
    aggregate: &HotContractAggregateAnalysis,
) -> HotContractDecodeAnalysis {
    let mut analysis = empty_decode_analysis();
    analysis.status = if samples.is_empty() {
        "empty".to_string()
    } else {
        "advisory".to_string()
    };

    add_aggregate_classifications(&mut analysis, aggregate);
    add_sample_uncertainties(&mut analysis, samples, omitted_samples);
    add_abi_uncertainties(&mut analysis, chain_id, contract_address, aggregate);
    reconcile_unknown_classifications(&mut analysis);
    if !analysis.uncertainty_statuses.is_empty() {
        analysis.status = "uncertain".to_string();
    }
    analysis
}

fn add_aggregate_classifications(
    analysis: &mut HotContractDecodeAnalysis,
    aggregate: &HotContractAggregateAnalysis,
) {
    for selector in &aggregate.selectors {
        for label in &selector.advisory_labels {
            let (kind, text, signature, reason) = selector_classification(label);
            analysis
                .classification_candidates
                .push(classification_candidate(
                    kind,
                    text,
                    "medium",
                    "sampledSelector",
                    Some(selector.selector.clone()),
                    None,
                    signature,
                    vec![reason],
                ));
        }
    }
    for topic in &aggregate.topics {
        for label in &topic.advisory_labels {
            let (kind, text, signature, reason) = topic_classification(label);
            analysis
                .classification_candidates
                .push(classification_candidate(
                    kind,
                    text,
                    "medium",
                    "sampledTopic",
                    None,
                    Some(topic.topic.clone()),
                    signature,
                    vec![reason],
                ));
        }
    }
    dedupe_classifications(&mut analysis.classification_candidates);
}

fn selector_classification(
    label: &str,
) -> (&'static str, &'static str, Option<String>, &'static str) {
    match label {
        "erc20Transfer" => (
            "erc20Transfer",
            "ERC-20 transfer",
            Some("transfer(address,uint256)".to_string()),
            "knownErc20TransferSelector",
        ),
        "erc20Approval" => (
            "erc20Approval",
            "ERC-20 approval",
            Some("approve(address,uint256)".to_string()),
            "knownErc20ApproveSelector",
        ),
        "erc20RevokeCandidate" => (
            "erc20RevokeCandidate",
            "ERC-20 revoke candidate",
            Some("approve(address,uint256)".to_string()),
            "approvalSelectorMaySetZero",
        ),
        "batchDisperse" => (
            "batchDisperse",
            "Batch disperse",
            None,
            "knownDisperseSelector",
        ),
        "contractCreation" => (
            "contractCreation",
            "Contract creation",
            None,
            "sampleToIsNull",
        ),
        _ => (
            "rawCalldataUnknown",
            "Unknown raw calldata",
            None,
            "noFunctionDecodeCandidate",
        ),
    }
}

fn topic_classification(label: &str) -> (&'static str, &'static str, Option<String>, &'static str) {
    match label {
        "erc20TransferEvent" => (
            "erc20TransferEvent",
            "ERC-20 Transfer event",
            Some("Transfer(address,address,uint256)".to_string()),
            "knownErc20TransferTopic",
        ),
        "erc20ApprovalEvent" => (
            "erc20ApprovalEvent",
            "ERC-20 Approval event",
            Some("Approval(address,address,uint256)".to_string()),
            "knownErc20ApprovalTopic",
        ),
        _ => (
            "unknownEventTopic",
            "Unknown event topic",
            None,
            "noEventDecodeCandidate",
        ),
    }
}

fn add_sample_uncertainties(
    analysis: &mut HotContractDecodeAnalysis,
    samples: &[HotContractSourceSample],
    omitted_samples: u64,
) {
    if omitted_samples > 0 {
        analysis.push_uncertainty(
            "providerPartialSample",
            "warning",
            "sampleProvider",
            Some(format!(
                "{omitted_samples} source samples were omitted by the read-model cap"
            )),
        );
    }

    let has_malformed_selector = samples.iter().any(|sample| {
        sample.to.is_some()
            && sample
                .selector
                .as_deref()
                .map(|selector| !is_selector(selector))
                .unwrap_or(true)
    });
    if has_malformed_selector {
        analysis.push_uncertainty(
            "malformedCalldata",
            "warning",
            "sampleProvider",
            Some("one or more samples did not expose a valid 4-byte selector".to_string()),
        );
    }

    if samples
        .iter()
        .any(|sample| sample.log_topic0.iter().any(|topic| !is_topic(topic)))
    {
        analysis.push_uncertainty(
            "malformedLog",
            "warning",
            "sampleProvider",
            Some("one or more sampled log topics were malformed".to_string()),
        );
    }

    if samples.iter().any(|sample| sample.log_topic0.is_empty()) {
        analysis.push_uncertainty("missingLogs", "warning", "sampleProvider", None);
    }

    if samples.iter().any(|sample| {
        sample.to.is_some()
            && sample
                .selector
                .as_deref()
                .filter(|selector| is_selector(selector))
                .map(|selector| {
                    !matches!(
                        selector,
                        "0xa9059cbb" | "0x095ea7b3" | "0xe63d38ed" | "0xc73a2d60"
                    )
                })
                .unwrap_or(false)
    }) {
        analysis.push_uncertainty("unknownSelector", "warning", "sampleProvider", None);
    }
}

fn add_abi_uncertainties(
    analysis: &mut HotContractDecodeAnalysis,
    chain_id: u64,
    contract_address: &str,
    aggregate: &HotContractAggregateAnalysis,
) {
    let state = match load_abi_registry_state_readonly() {
        Ok(state) => state,
        Err(error) => {
            analysis.push_uncertainty(
                "abiRegistryUnavailable",
                "warning",
                "abiCache",
                Some(sanitized_summary(error)),
            );
            return;
        }
    };

    for entry in state.cache_entries {
        if entry.chain_id != chain_id
            || !entry
                .contract_address
                .eq_ignore_ascii_case(contract_address)
        {
            continue;
        }
        let (artifact_status, artifact_error, raw_abi) = artifact_status(&entry);
        let source = abi_source_summary(&entry, artifact_status, artifact_error);
        if source.artifact_status == "ok" {
            add_abi_decode_items(analysis, &source, raw_abi.as_ref(), aggregate);
        }
        add_source_uncertainties(analysis, &source, &entry.selector_summary, raw_abi.as_ref());
        analysis.abi_sources.push(source);
    }
}

fn add_abi_decode_items(
    analysis: &mut HotContractDecodeAnalysis,
    source: &HotContractAbiSourceSummary,
    raw_abi: Option<&Value>,
    aggregate: &HotContractAggregateAnalysis,
) {
    let Some(raw_abi) = raw_abi else {
        return;
    };
    let selector_keys = aggregate
        .selectors
        .iter()
        .map(|row| row.selector.as_str())
        .filter(|selector| is_selector(selector))
        .collect::<BTreeSet<_>>();
    let topic_keys = aggregate
        .topics
        .iter()
        .map(|row| row.topic.as_str())
        .filter(|topic| is_topic(topic))
        .collect::<BTreeSet<_>>();

    for item in raw_items_matching_any(raw_abi, "function", &selector_keys) {
        let Some(signature) = raw_item_signature(&item, "function") else {
            continue;
        };
        analysis.items.push(decode_item(
            "function",
            Some(selector_for_signature(&signature)),
            None,
            signature,
            source,
            "abiFunctionSelectorMatch",
        ));
    }
    for item in raw_items_matching_any(raw_abi, "event", &topic_keys) {
        let Some(signature) = raw_item_signature(&item, "event") else {
            continue;
        };
        analysis.items.push(decode_item(
            "event",
            None,
            Some(topic_for_signature(&signature)),
            signature,
            source,
            "abiEventTopicMatch",
        ));
    }
    dedupe_decode_items(&mut analysis.items);
}

fn raw_items_matching_any(raw_abi: &Value, kind: &str, keys: &BTreeSet<&str>) -> Vec<Value> {
    let Some(items) = raw_abi.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .filter(|item| {
            item.get("type")
                .and_then(Value::as_str)
                .unwrap_or("function")
                == kind
                && raw_item_signature(item, kind)
                    .map(|signature| {
                        let key = if kind == "event" {
                            topic_for_signature(&signature)
                        } else {
                            selector_for_signature(&signature)
                        };
                        keys.iter()
                            .any(|existing| key.eq_ignore_ascii_case(existing))
                    })
                    .unwrap_or(false)
        })
        .cloned()
        .collect()
}

fn raw_item_signature(item: &Value, expected_type: &str) -> Option<String> {
    if item
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("function")
        != expected_type
    {
        return None;
    }
    let name = item.get("name").and_then(Value::as_str)?;
    if name.trim().is_empty() {
        return None;
    }
    let inputs = raw_param_list(item.get("inputs"))?;
    Some(format!("{}({})", name.trim(), inputs.join(",")))
}

fn raw_param_list(value: Option<&Value>) -> Option<Vec<String>> {
    match value {
        Some(Value::Array(items)) => items.iter().map(raw_param_type).collect(),
        Some(_) => None,
        None => Some(Vec::new()),
    }
}

fn raw_param_type(value: &Value) -> Option<String> {
    let kind = value.get("type").and_then(Value::as_str)?.trim();
    if kind.is_empty() {
        return None;
    }
    if kind.starts_with("tuple") {
        let suffix = kind.strip_prefix("tuple").unwrap_or_default();
        let components = raw_param_list(value.get("components"))?;
        return Some(format!("({}){}", components.join(","), suffix));
    }
    Some(kind.to_string())
}

fn artifact_status(entry: &AbiCacheEntryRecord) -> (String, Option<String>, Option<Value>) {
    let path = match abi_artifact_path_readonly(&entry.abi_hash) {
        Ok(path) => path,
        Err(_) => {
            return (
                "artifactUnavailable".to_string(),
                Some("ABI artifact storage is unavailable".to_string()),
                None,
            );
        }
    };
    let artifact = match fs::read_to_string(path) {
        Ok(artifact) => artifact,
        Err(error) => {
            return (
                "artifactUnavailable".to_string(),
                Some(artifact_read_error_summary(&error).to_string()),
                None,
            );
        }
    };
    if hash_text(&artifact) != entry.abi_hash {
        return (
            "artifactHashDrift".to_string(),
            Some("ABI artifact hash does not match cache entry".to_string()),
            None,
        );
    }
    match serde_json::from_str::<Value>(&artifact) {
        Ok(value @ Value::Array(_)) => ("ok".to_string(), None, Some(value)),
        Ok(_) | Err(_) => (
            "malformedAbiArtifact".to_string(),
            Some("ABI artifact could not be parsed".to_string()),
            None,
        ),
    }
}

fn artifact_read_error_summary(error: &std::io::Error) -> &'static str {
    match error.kind() {
        std::io::ErrorKind::NotFound => "ABI artifact not found",
        std::io::ErrorKind::PermissionDenied => "ABI artifact is not readable",
        _ => "ABI artifact could not be read",
    }
}

fn abi_source_summary(
    entry: &AbiCacheEntryRecord,
    artifact_status: String,
    error_summary: Option<String>,
) -> HotContractAbiSourceSummary {
    HotContractAbiSourceSummary {
        contract_address: entry.contract_address.clone(),
        source_kind: entry.source_kind.clone(),
        provider_config_id: entry.provider_config_id.clone(),
        user_source_id: entry.user_source_id.clone(),
        version_id: entry.version_id.clone(),
        selected: entry.selected,
        fetch_source_status: entry.fetch_source_status.clone(),
        validation_status: entry.validation_status.clone(),
        cache_status: entry.cache_status.clone(),
        selection_status: entry.selection_status.clone(),
        artifact_status,
        proxy_detected: entry.proxy_detected,
        provider_proxy_hint: entry.provider_proxy_hint.as_deref().map(sanitized_summary),
        error_summary: error_summary
            .or_else(|| entry.last_error_summary.as_deref().map(sanitized_summary)),
    }
}

fn add_source_uncertainties(
    analysis: &mut HotContractDecodeAnalysis,
    source: &HotContractAbiSourceSummary,
    selector_summary: &Option<AbiSelectorSummaryRecord>,
    raw_abi: Option<&Value>,
) {
    if source.fetch_source_status == "notVerified" {
        analysis.push_uncertainty(
            "unverifiedAbi",
            "warning",
            "abiCache",
            Some(source.version_id.clone()),
        );
    } else if source.fetch_source_status != "ok" {
        analysis.push_uncertainty(
            &source.fetch_source_status,
            "warning",
            "abiCache",
            Some(source.version_id.clone()),
        );
    }
    if source.cache_status != "cacheFresh" {
        analysis.push_uncertainty(
            "staleAbi",
            "warning",
            "abiCache",
            Some(format!("{} {}", source.version_id, source.cache_status)),
        );
    }
    if source.validation_status == "selectorConflict" {
        analysis.push_uncertainty(
            "selectorCollision",
            "warning",
            "abiCache",
            Some(source.version_id.clone()),
        );
    } else if source.validation_status != "ok" {
        analysis.push_uncertainty(
            &source.validation_status,
            "warning",
            "abiCache",
            Some(source.version_id.clone()),
        );
    }
    if matches!(
        source.selection_status.as_str(),
        "sourceConflict" | "needsUserChoice"
    ) {
        analysis.push_uncertainty(
            &source.selection_status,
            "warning",
            "abiCache",
            Some(source.version_id.clone()),
        );
    }
    if source.proxy_detected {
        analysis.push_uncertainty(
            "proxyImplementationUncertainty",
            "warning",
            "abiCache",
            source.provider_proxy_hint.clone(),
        );
    }
    if source.artifact_status != "ok" {
        analysis.push_uncertainty(
            &source.artifact_status,
            "warning",
            "abiCache",
            source.error_summary.clone(),
        );
    }
    if source_has_event_topic_conflict(selector_summary, raw_abi) {
        analysis.push_uncertainty(
            "eventDecodeConflict",
            "warning",
            "abiCache",
            Some(source.version_id.clone()),
        );
    }
    if source_has_overload(selector_summary, raw_abi) {
        analysis.push_uncertainty(
            "overloadedSignatures",
            "warning",
            "abiCache",
            Some(source.version_id.clone()),
        );
    }
}

fn source_has_event_topic_conflict(
    summary: &Option<AbiSelectorSummaryRecord>,
    raw_abi: Option<&Value>,
) -> bool {
    if abi_has_duplicate_event_topics(raw_abi) {
        return true;
    }
    let Some(summary) = summary else {
        return false;
    };
    summary.event_topic_count.unwrap_or(0) > 0 && summary.conflict_count.unwrap_or(0) > 0
}

fn abi_has_duplicate_event_topics(raw_abi: Option<&Value>) -> bool {
    let Some(Value::Array(items)) = raw_abi else {
        return false;
    };
    let mut topics = BTreeSet::new();
    for item in items {
        if item.get("type").and_then(Value::as_str).unwrap_or_default() != "event" {
            continue;
        }
        let Some(signature) = raw_item_signature(item, "event") else {
            continue;
        };
        if !topics.insert(topic_for_signature(&signature)) {
            return true;
        }
    }
    false
}

fn source_has_overload(
    summary: &Option<AbiSelectorSummaryRecord>,
    raw_abi: Option<&Value>,
) -> bool {
    if summary
        .as_ref()
        .and_then(|summary| summary.notes.as_deref())
        .map(|notes| notes.to_ascii_lowercase().contains("overload"))
        .unwrap_or(false)
    {
        return true;
    }
    let Some(Value::Array(items)) = raw_abi else {
        return false;
    };
    let mut names = BTreeSet::new();
    for item in items {
        if item
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("function")
            != "function"
        {
            continue;
        }
        let Some(name) = item.get("name").and_then(Value::as_str) else {
            continue;
        };
        if !names.insert(name.to_string()) {
            return true;
        }
    }
    false
}

impl HotContractDecodeAnalysis {
    fn push_uncertainty(
        &mut self,
        code: &str,
        severity: &str,
        source: &str,
        summary: Option<String>,
    ) {
        if self
            .uncertainty_statuses
            .iter()
            .any(|status| status.code == code && status.source == source)
        {
            return;
        }
        self.uncertainty_statuses
            .push(HotContractUncertaintyStatus {
                code: code.to_string(),
                severity: severity.to_string(),
                source: source.to_string(),
                summary,
            });
    }
}

fn classification_candidate(
    kind: &str,
    label: &str,
    confidence: &str,
    source: &str,
    selector: Option<String>,
    topic: Option<String>,
    signature: Option<String>,
    reasons: Vec<&str>,
) -> HotContractClassificationCandidate {
    HotContractClassificationCandidate {
        kind: kind.to_string(),
        label: label.to_string(),
        confidence: confidence.to_string(),
        source: source.to_string(),
        selector,
        topic,
        signature,
        reasons: reasons.into_iter().map(str::to_string).collect(),
    }
}

fn decode_item(
    kind: &str,
    selector: Option<String>,
    topic: Option<String>,
    signature: String,
    source: &HotContractAbiSourceSummary,
    reason: &str,
) -> HotContractDecodeItem {
    HotContractDecodeItem {
        kind: kind.to_string(),
        status: "candidate".to_string(),
        selector,
        topic,
        signature: Some(signature),
        source: "abiCache".to_string(),
        confidence: "advisory".to_string(),
        abi_version_id: Some(source.version_id.clone()),
        abi_selected: Some(source.selected),
        reasons: vec![reason.to_string()],
    }
}

fn dedupe_classifications(items: &mut Vec<HotContractClassificationCandidate>) {
    let mut seen = BTreeSet::new();
    items.retain(|item| {
        seen.insert((
            item.kind.clone(),
            item.selector.clone(),
            item.topic.clone(),
            item.signature.clone(),
        ))
    });
}

fn dedupe_decode_items(items: &mut Vec<HotContractDecodeItem>) {
    let mut seen = BTreeSet::new();
    items.retain(|item| {
        seen.insert((
            item.kind.clone(),
            item.selector.clone(),
            item.topic.clone(),
            item.signature.clone(),
            item.source.clone(),
            item.abi_version_id.clone(),
        ))
    });
}

fn reconcile_unknown_classifications(analysis: &mut HotContractDecodeAnalysis) {
    let decoded_selectors = analysis
        .items
        .iter()
        .filter(|item| item.kind == "function")
        .filter_map(|item| item.selector.as_deref())
        .map(str::to_ascii_lowercase)
        .collect::<BTreeSet<_>>();
    if decoded_selectors.is_empty() {
        return;
    }
    analysis.classification_candidates.retain(|candidate| {
        candidate.kind != "rawCalldataUnknown"
            || candidate
                .selector
                .as_deref()
                .map(|selector| !decoded_selectors.contains(&selector.to_ascii_lowercase()))
                .unwrap_or(true)
    });
}

fn topic_for_signature(signature: &str) -> String {
    format!("0x{}", hex_lower(&keccak256(signature.as_bytes())))
}

fn selector_for_signature(signature: &str) -> String {
    format!("0x{}", hex_lower(&keccak256(signature.as_bytes())[..4]))
}

fn hash_text(value: &str) -> String {
    format!("0x{}", hex_lower(&keccak256(value.as_bytes())))
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

fn sanitized_summary(value: impl AsRef<str>) -> String {
    sanitize_diagnostic_message(value.as_ref())
}
