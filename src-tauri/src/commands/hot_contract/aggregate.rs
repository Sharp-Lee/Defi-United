use std::collections::{BTreeMap, BTreeSet};

use ethers::types::U256;

use super::types::{
    HotContractAggregateAnalysis, HotContractNativeValueAggregate, HotContractSelectorAggregate,
    HotContractSourceSample, HotContractTopicAggregate,
};

const ERC20_TRANSFER_SELECTOR: &str = "0xa9059cbb";
const ERC20_APPROVE_SELECTOR: &str = "0x095ea7b3";
const DISPERSE_ETHER_SELECTOR: &str = "0xe63d38ed";
const DISPERSE_TOKEN_SELECTOR: &str = "0xc73a2d60";
const ERC20_TRANSFER_TOPIC: &str =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ERC20_APPROVAL_TOPIC: &str =
    "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";

pub fn empty_aggregate_analysis() -> HotContractAggregateAnalysis {
    HotContractAggregateAnalysis {
        selectors: Vec::new(),
        topics: Vec::new(),
    }
}

pub(crate) fn aggregate_samples(
    samples: &[HotContractSourceSample],
) -> HotContractAggregateAnalysis {
    let mut selector_rows: BTreeMap<String, SelectorAccumulator> = BTreeMap::new();
    let mut topic_rows: BTreeMap<String, TopicAccumulator> = BTreeMap::new();
    let sample_count = samples.len() as u64;
    let topic_count = samples
        .iter()
        .map(|sample| sample.log_topic0.len() as u64)
        .sum::<u64>();

    for sample in samples {
        let selector = sample_selector_key(sample);
        let row = selector_rows.entry(selector.clone()).or_default();
        row.push(sample);
        if sample.to.is_none() {
            row.labels.insert("contractCreation".to_string());
        } else {
            for label in selector_labels(&selector, sample) {
                row.labels.insert(label.to_string());
            }
        }

        for topic in &sample.log_topic0 {
            let normalized = topic.to_ascii_lowercase();
            let row = topic_rows.entry(normalized.clone()).or_default();
            row.push(sample);
            for label in topic_labels(&normalized) {
                row.labels.insert(label.to_string());
            }
        }
    }

    let mut selectors = selector_rows
        .into_iter()
        .map(|(selector, row)| row.into_selector(selector, sample_count))
        .collect::<Vec<_>>();
    selectors.sort_by(|left, right| {
        right
            .sampled_call_count
            .cmp(&left.sampled_call_count)
            .then_with(|| left.selector.cmp(&right.selector))
    });

    let mut topics = topic_rows
        .into_iter()
        .map(|(topic, row)| row.into_topic(topic, topic_count))
        .collect::<Vec<_>>();
    topics.sort_by(|left, right| {
        right
            .log_count
            .cmp(&left.log_count)
            .then_with(|| left.topic.cmp(&right.topic))
    });

    HotContractAggregateAnalysis { selectors, topics }
}

fn sample_selector_key(sample: &HotContractSourceSample) -> String {
    if sample.to.is_none() {
        return "contractCreation".to_string();
    }
    sample
        .selector
        .as_deref()
        .map(str::to_ascii_lowercase)
        .filter(|selector| is_selector(selector))
        .unwrap_or_else(|| "malformedCalldata".to_string())
}

fn selector_labels(selector: &str, sample: &HotContractSourceSample) -> Vec<&'static str> {
    match selector {
        ERC20_TRANSFER_SELECTOR => vec!["erc20Transfer"],
        ERC20_APPROVE_SELECTOR if sample.approve_amount_is_zero == Some(true) => {
            vec!["erc20Approval", "erc20RevokeCandidate"]
        }
        ERC20_APPROVE_SELECTOR => vec!["erc20Approval"],
        DISPERSE_ETHER_SELECTOR | DISPERSE_TOKEN_SELECTOR => vec!["batchDisperse"],
        "malformedCalldata" => vec!["rawCalldataUnknown"],
        _ => vec!["rawCalldataUnknown"],
    }
}

fn topic_labels(topic: &str) -> Vec<&'static str> {
    match topic {
        ERC20_TRANSFER_TOPIC => vec!["erc20TransferEvent"],
        ERC20_APPROVAL_TOPIC => vec!["erc20ApprovalEvent"],
        _ => vec!["unknownEventTopic"],
    }
}

pub(crate) fn is_selector(value: &str) -> bool {
    value.len() == 10
        && value.starts_with("0x")
        && value[2..].as_bytes().iter().all(u8::is_ascii_hexdigit)
}

pub(crate) fn is_topic(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value[2..].as_bytes().iter().all(u8::is_ascii_hexdigit)
}

#[derive(Default)]
struct SelectorAccumulator {
    sampled_call_count: u64,
    senders: BTreeSet<String>,
    saw_sender: bool,
    success_count: u64,
    revert_count: u64,
    unknown_status_count: u64,
    first_block: Option<u64>,
    last_block: Option<u64>,
    first_block_time: Option<String>,
    last_block_time: Option<String>,
    native_value_sample_count: u64,
    non_zero_count: u64,
    zero_count: u64,
    total_wei: Option<U256>,
    example_tx_hashes: Vec<String>,
    labels: BTreeSet<String>,
}

impl SelectorAccumulator {
    fn push(&mut self, sample: &HotContractSourceSample) {
        self.sampled_call_count += 1;
        if let Some(sender) = sample.from.as_deref() {
            self.saw_sender = true;
            self.senders.insert(sender.to_ascii_lowercase());
        }
        match sample
            .status
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "success" | "ok" | "succeeded" => self.success_count += 1,
            "reverted" | "revert" | "failed" | "failure" => self.revert_count += 1,
            _ => self.unknown_status_count += 1,
        }
        self.update_range(sample);
        self.push_value(sample.value.as_deref());
        self.push_example(sample.tx_hash.as_deref());
    }

    fn update_range(&mut self, sample: &HotContractSourceSample) {
        if let Some(block) = sample.block_number {
            if self.first_block.map_or(true, |existing| block < existing) {
                self.first_block = Some(block);
                self.first_block_time = sample.block_time.clone();
            }
            if self.last_block.map_or(true, |existing| block > existing) {
                self.last_block = Some(block);
                self.last_block_time = sample.block_time.clone();
            }
        }
    }

    fn push_value(&mut self, value: Option<&str>) {
        let Some(value) = value else {
            return;
        };
        let Ok(parsed) = U256::from_dec_str(value.trim()) else {
            return;
        };
        self.native_value_sample_count += 1;
        if parsed.is_zero() {
            self.zero_count += 1;
        } else {
            self.non_zero_count += 1;
        }
        self.total_wei = Some(self.total_wei.unwrap_or_default() + parsed);
    }

    fn push_example(&mut self, tx_hash: Option<&str>) {
        let Some(tx_hash) = tx_hash else {
            return;
        };
        if self.example_tx_hashes.len() < 3
            && !self
                .example_tx_hashes
                .iter()
                .any(|existing| existing == tx_hash)
        {
            self.example_tx_hashes.push(tx_hash.to_string());
        }
    }

    fn into_selector(self, selector: String, sample_count: u64) -> HotContractSelectorAggregate {
        HotContractSelectorAggregate {
            selector,
            sampled_call_count: self.sampled_call_count,
            sample_share_bps: share_bps(self.sampled_call_count, sample_count),
            unique_sender_count: self.saw_sender.then_some(self.senders.len() as u64),
            success_count: self.success_count,
            revert_count: self.revert_count,
            unknown_status_count: self.unknown_status_count,
            first_block: self.first_block,
            last_block: self.last_block,
            first_block_time: self.first_block_time,
            last_block_time: self.last_block_time,
            native_value: HotContractNativeValueAggregate {
                sample_count: self.native_value_sample_count,
                non_zero_count: self.non_zero_count,
                zero_count: self.zero_count,
                total_wei: self.total_wei.map(|value| value.to_string()),
            },
            example_tx_hashes: self.example_tx_hashes,
            source: "sampledTransactions".to_string(),
            confidence: "medium".to_string(),
            advisory_labels: self.labels.into_iter().collect(),
        }
    }
}

#[derive(Default)]
struct TopicAccumulator {
    log_count: u64,
    first_block: Option<u64>,
    last_block: Option<u64>,
    first_block_time: Option<String>,
    last_block_time: Option<String>,
    example_tx_hashes: Vec<String>,
    labels: BTreeSet<String>,
}

impl TopicAccumulator {
    fn push(&mut self, sample: &HotContractSourceSample) {
        self.log_count += 1;
        if let Some(block) = sample.block_number {
            if self.first_block.map_or(true, |existing| block < existing) {
                self.first_block = Some(block);
                self.first_block_time = sample.block_time.clone();
            }
            if self.last_block.map_or(true, |existing| block > existing) {
                self.last_block = Some(block);
                self.last_block_time = sample.block_time.clone();
            }
        }
        if let Some(tx_hash) = sample.tx_hash.as_deref() {
            if self.example_tx_hashes.len() < 3
                && !self
                    .example_tx_hashes
                    .iter()
                    .any(|existing| existing == tx_hash)
            {
                self.example_tx_hashes.push(tx_hash.to_string());
            }
        }
    }

    fn into_topic(self, topic: String, topic_count: u64) -> HotContractTopicAggregate {
        HotContractTopicAggregate {
            topic,
            log_count: self.log_count,
            sample_share_bps: share_bps(self.log_count, topic_count),
            first_block: self.first_block,
            last_block: self.last_block,
            first_block_time: self.first_block_time,
            last_block_time: self.last_block_time,
            example_tx_hashes: self.example_tx_hashes,
            source: "sampledLogs".to_string(),
            confidence: "medium".to_string(),
            advisory_labels: self.labels.into_iter().collect(),
        }
    }
}

fn share_bps(count: u64, total: u64) -> u64 {
    if total == 0 {
        0
    } else {
        count.saturating_mul(10_000) / total
    }
}
