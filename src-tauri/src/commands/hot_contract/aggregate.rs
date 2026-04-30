use super::types::HotContractAggregateAnalysis;

pub fn empty_aggregate_analysis() -> HotContractAggregateAnalysis {
    HotContractAggregateAnalysis {
        selectors: Vec::new(),
        topics: Vec::new(),
    }
}
