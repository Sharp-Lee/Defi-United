use crate::diagnostics::sanitize_diagnostic_message;
use crate::models::{
    AbiCallSelectedRpcSummary, AbiCallStatusSummary, AbiDecodedFieldHistorySummary,
    AbiDecodedValueHistorySummary, AssetApprovalRevokeHistoryMetadata,
    AssetApprovalRevokeSnapshotMetadata, NativeTransferIntent, TransactionType,
    TypedTransactionFields,
};
use crate::transactions::submit_asset_approval_revoke;
use ethers::abi::{encode, Token};
use ethers::providers::{Http, Middleware, Provider};
use ethers::types::{
    transaction::eip2718::TypedTransaction, Address, Bytes, TransactionRequest, U256,
};
use ethers::utils::{keccak256, to_checksum};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::str::FromStr;

const ERC20_APPROVE_SELECTOR: &str = "0x095ea7b3";
const SET_APPROVAL_FOR_ALL_SELECTOR: &str = "0xa22cb465";
const ERC20_ALLOWANCE_SELECTOR: [u8; 4] = [0xdd, 0x62, 0xed, 0x3e];
const NFT_IS_APPROVED_FOR_ALL_SELECTOR: [u8; 4] = [0xe9, 0x85, 0xe9, 0xc5];
const ERC721_GET_APPROVED_SELECTOR: [u8; 4] = [0x08, 0x18, 0x12, 0xfc];
const ZERO_ADDRESS: &str = "0x0000000000000000000000000000000000000000";
const REVOKE_DRAFT_VERSION: u64 = 1;
const JS_MAX_SAFE_INTEGER_U64: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetApprovalRevokeSubmitInput {
    #[serde(alias = "rpc_url")]
    pub rpc_url: String,
    #[serde(default, alias = "draft_id")]
    pub draft_id: Option<String>,
    #[serde(default, alias = "frozen_key")]
    pub frozen_key: Option<String>,
    #[serde(default, alias = "created_at")]
    pub created_at: Option<String>,
    #[serde(default, alias = "frozen_at")]
    pub frozen_at: Option<String>,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    #[serde(alias = "selected_rpc")]
    pub selected_rpc: AssetApprovalRevokeSelectedRpcInput,
    pub from: String,
    #[serde(default, alias = "account_index", alias = "fromAccountIndex")]
    pub account_index: Option<u32>,
    pub to: String,
    #[serde(alias = "value_wei")]
    pub value_wei: String,
    #[serde(default, alias = "approval_identity")]
    pub approval_identity: Option<AssetApprovalRevokeSnapshotIdentityInput>,
    #[serde(default, alias = "approval_kind")]
    pub approval_kind: Option<String>,
    #[serde(default, alias = "token_approval_contract")]
    pub token_approval_contract: Option<String>,
    #[serde(default)]
    pub spender: Option<String>,
    #[serde(default)]
    pub operator: Option<String>,
    #[serde(default, alias = "token_id")]
    pub token_id: Option<String>,
    pub method: String,
    pub selector: String,
    pub calldata: String,
    #[serde(default, alias = "calldata_args")]
    pub calldata_args: Vec<AssetApprovalRevokeCalldataArg>,
    pub nonce: u64,
    #[serde(alias = "gas_limit")]
    pub gas_limit: String,
    #[serde(default, alias = "latest_base_fee_per_gas")]
    pub latest_base_fee_per_gas: Option<String>,
    #[serde(default, alias = "base_fee_per_gas")]
    pub base_fee_per_gas: Option<String>,
    #[serde(alias = "max_fee_per_gas")]
    pub max_fee_per_gas: String,
    #[serde(alias = "max_priority_fee_per_gas")]
    pub max_priority_fee_per_gas: String,
    #[serde(default)]
    pub warnings: Vec<AssetApprovalRevokeStatusInput>,
    #[serde(default, alias = "blocking_statuses")]
    pub blocking_statuses: Vec<AssetApprovalRevokeStatusInput>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetApprovalRevokeSelectedRpcInput {
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetApprovalRevokeSnapshotIdentityInput {
    #[serde(alias = "identity_key")]
    pub identity_key: String,
    #[serde(alias = "chain_id")]
    pub chain_id: u64,
    pub owner: String,
    pub contract: String,
    pub kind: String,
    #[serde(default)]
    pub spender: Option<String>,
    #[serde(default)]
    pub operator: Option<String>,
    #[serde(default, alias = "token_id")]
    pub token_id: Option<String>,
    pub status: String,
    #[serde(alias = "source_kind")]
    pub source_kind: String,
    #[serde(default, alias = "source_summary")]
    pub source_summary: Option<String>,
    #[serde(default)]
    pub source: Value,
    #[serde(default)]
    pub stale: bool,
    #[serde(default)]
    pub failure: bool,
    #[serde(default, rename = "ref", alias = "ref")]
    pub ref_: AssetApprovalRevokeSnapshotRefInput,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetApprovalRevokeSnapshotRefInput {
    #[serde(default, alias = "created_at")]
    pub created_at: Option<String>,
    #[serde(default, alias = "updated_at")]
    pub updated_at: Option<String>,
    #[serde(default, alias = "last_scanned_at")]
    pub last_scanned_at: Option<String>,
    #[serde(default, alias = "stale_after")]
    pub stale_after: Option<String>,
    #[serde(default, alias = "rpc_identity")]
    pub rpc_identity: Option<String>,
    #[serde(default, alias = "rpc_profile_id")]
    pub rpc_profile_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetApprovalRevokeCalldataArg {
    pub name: String,
    #[serde(rename = "type")]
    pub type_label: String,
    pub value: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetApprovalRevokeStatusInput {
    pub level: String,
    pub code: String,
    pub message: String,
    pub source: String,
    #[serde(default, alias = "requires_acknowledgement")]
    pub requires_acknowledgement: bool,
    #[serde(default)]
    pub acknowledged: bool,
}

#[derive(Debug, Clone)]
struct ValidatedAssetApprovalRevoke {
    intent: NativeTransferIntent,
    calldata: Bytes,
    metadata: AssetApprovalRevokeHistoryMetadata,
    frozen_key: String,
    approval_kind: String,
    owner: Address,
    token_contract: Address,
    spender: Option<Address>,
    operator: Option<Address>,
    token_id: Option<U256>,
}

fn validate_asset_approval_revoke_submit_input(
    input: AssetApprovalRevokeSubmitInput,
) -> Result<ValidatedAssetApprovalRevoke, String> {
    if !input.blocking_statuses.is_empty() {
        return Err(format!(
            "asset approval revoke draft has unresolved blocking statuses: {}",
            input
                .blocking_statuses
                .iter()
                .map(|status| status.code.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    let rpc_url = input.rpc_url.trim().to_string();
    if rpc_url.is_empty() {
        return Err("rpcUrl is required".to_string());
    }
    let selected_chain_id = input.selected_rpc.chain_id.ok_or_else(|| {
        "selectedRpc.chainId is required for asset approval revoke submit".to_string()
    })?;
    if selected_chain_id != input.chain_id {
        return Err(format!(
            "selected RPC chainId {} does not match draft chainId {}",
            selected_chain_id, input.chain_id
        ));
    }
    validate_selected_rpc_endpoint(&input.selected_rpc, &rpc_url)?;
    let account_index = input
        .account_index
        .ok_or_else(|| "accountIndex is required for asset approval revoke submit".to_string())?;
    if input.nonce > JS_MAX_SAFE_INTEGER_U64 {
        return Err("nonce must be a non-negative safe integer".to_string());
    }

    let identity = input.approval_identity.as_ref().ok_or_else(|| {
        "approvalIdentity is required for asset approval revoke submit".to_string()
    })?;
    if identity.chain_id != input.chain_id {
        return Err("approvalIdentity chainId does not match draft chainId".to_string());
    }
    if identity.status != "active" {
        return Err("approval snapshot must still be active before revoke submit".to_string());
    }
    if identity.stale || identity.failure || identity.source_kind != "rpcPointRead" {
        return Err(
            "approval snapshot must be fresh RPC point-read data before revoke submit".to_string(),
        );
    }

    let from = checksum_address(&input.from, "from")?;
    let owner = parse_address(&from, "from")?;
    let frozen_from = lowercase_address(&owner);
    let identity_owner = checksum_address(&identity.owner, "approval owner")?;
    if !from.eq_ignore_ascii_case(&identity_owner) {
        return Err("from does not match approval owner".to_string());
    }
    let to = checksum_address(&input.to, "to")?;
    let token_contract = checksum_address(
        input
            .token_approval_contract
            .as_deref()
            .unwrap_or(&identity.contract),
        "token approval contract",
    )?;
    let identity_contract = checksum_address(&identity.contract, "approval contract")?;
    let token_contract_address = parse_address(&token_contract, "token approval contract")?;
    let frozen_token_contract = lowercase_address(&token_contract_address);
    if !to.eq_ignore_ascii_case(&token_contract)
        || !token_contract.eq_ignore_ascii_case(&identity_contract)
    {
        return Err("token approval contract does not match transaction target".to_string());
    }
    if input.value_wei != "0" {
        return Err("asset approval revoke valueWei must be 0".to_string());
    }
    let gas_limit = parse_u256_decimal("gasLimit", &input.gas_limit)?;
    if gas_limit.is_zero() {
        return Err("gasLimit must be greater than zero".to_string());
    }
    if let Some(value) = input.latest_base_fee_per_gas.as_deref() {
        parse_u256_decimal("latestBaseFeePerGas", value)?;
    }
    if let Some(value) = input.base_fee_per_gas.as_deref() {
        parse_u256_decimal("baseFeePerGas", value)?;
    }
    let max_fee_per_gas = parse_u256_decimal("maxFeePerGas", &input.max_fee_per_gas)?;
    let max_priority_fee_per_gas =
        parse_u256_decimal("maxPriorityFeePerGas", &input.max_priority_fee_per_gas)?;
    if max_priority_fee_per_gas > max_fee_per_gas {
        return Err(
            "maxFeePerGas must be greater than or equal to maxPriorityFeePerGas".to_string(),
        );
    }
    validate_warning_acknowledgements(&input.warnings)?;

    let approval_kind = input
        .approval_kind
        .clone()
        .unwrap_or_else(|| identity.kind.clone());
    if approval_kind != identity.kind {
        return Err("approvalKind does not match approvalIdentity.kind".to_string());
    }
    let expected_identity_key = approval_identity_key(identity)?;
    if identity.identity_key != expected_identity_key {
        return Err("approvalIdentity identityKey does not match semantic identity".to_string());
    }

    let normalized_calldata = normalize_calldata(&input.calldata)?;
    let selector = normalize_selector(&input.selector)?;
    if normalized_calldata.len() < 4 || !input.calldata[0..10].eq_ignore_ascii_case(&selector) {
        return Err("calldata selector does not match submitted selector".to_string());
    }

    let (
        expected_method,
        expected_selector,
        expected_args,
        spender,
        operator,
        token_id,
        expected_calldata,
    ) = expected_revoke_call(&approval_kind, identity, owner, token_contract_address)?;
    if input.method != expected_method {
        return Err("method does not match approval revoke kind".to_string());
    }
    if selector != expected_selector {
        return Err("selector does not match approval revoke method".to_string());
    }
    if input.calldata_args != expected_args {
        return Err("calldata args do not match approval revoke method".to_string());
    }
    if normalized_calldata != expected_calldata {
        return Err("calldata does not encode the expected approval revoke".to_string());
    }
    validate_counterparty_fields(&input, spender, operator, token_id)?;

    let expected_frozen_key = asset_revoke_frozen_key(&AssetApprovalRevokeFrozenPayloadParts {
        chain_id: input.chain_id,
        selected_rpc: &input.selected_rpc,
        approval_identity: identity,
        approval_kind: &approval_kind,
        token_approval_contract: &frozen_token_contract,
        spender: spender.as_ref().map(lowercase_address).as_deref(),
        operator: operator.as_ref().map(lowercase_address).as_deref(),
        token_id: token_id.as_ref().map(U256::to_string).as_deref(),
        from: Some(&frozen_from),
        account_index: Some(account_index),
        method: Some(&input.method),
        selector: Some(&selector),
        calldata_args: &input.calldata_args,
        calldata: Some(&normalized_calldata),
        gas_limit: Some(&input.gas_limit),
        latest_base_fee_per_gas: input.latest_base_fee_per_gas.as_deref(),
        base_fee_per_gas: input.base_fee_per_gas.as_deref(),
        max_fee_per_gas: Some(&input.max_fee_per_gas),
        max_priority_fee_per_gas: Some(&input.max_priority_fee_per_gas),
        nonce: Some(input.nonce),
        warnings: &input.warnings,
        blocking_statuses: &input.blocking_statuses,
    });
    let frozen_key = input
        .frozen_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "frozenKey is required for asset approval revoke submit".to_string())?;
    if frozen_key != expected_frozen_key {
        return Err("frozenKey does not match asset approval revoke draft fields".to_string());
    }

    let warning_summaries = input
        .warnings
        .iter()
        .map(status_to_history)
        .collect::<Vec<_>>();
    let metadata = AssetApprovalRevokeHistoryMetadata {
        intent_kind: "assetApprovalRevoke".to_string(),
        draft_id: input.draft_id,
        created_at: input.created_at,
        frozen_at: input.frozen_at,
        chain_id: Some(input.chain_id),
        account_index: Some(account_index),
        from: Some(from.clone()),
        to: Some(to.clone()),
        value_wei: Some("0".to_string()),
        approval_kind: Some(approval_kind.clone()),
        token_approval_contract: Some(token_contract.clone()),
        spender: spender.map(|address| to_checksum(&address, None)),
        operator: operator.map(|address| to_checksum(&address, None)),
        token_id: token_id.map(|value| value.to_string()),
        method: Some(input.method.clone()),
        selector: Some(selector.clone()),
        calldata_hash: Some(format!("0x{}", hex_lower(&keccak256(&normalized_calldata)))),
        calldata_byte_length: Some(normalized_calldata.len() as u64),
        calldata_args: calldata_args_to_history(&input.calldata_args),
        gas_limit: Some(input.gas_limit.clone()),
        latest_base_fee_per_gas: input.latest_base_fee_per_gas.clone(),
        base_fee_per_gas: input.base_fee_per_gas.clone(),
        max_fee_per_gas: Some(input.max_fee_per_gas.clone()),
        max_priority_fee_per_gas: Some(input.max_priority_fee_per_gas.clone()),
        nonce: Some(input.nonce),
        selected_rpc: Some(selected_rpc_to_history(&input.selected_rpc)),
        snapshot: Some(snapshot_to_history(identity)),
        warning_acknowledgements: warning_summaries.clone(),
        warning_summaries,
        blocking_statuses: Vec::new(),
        frozen_key: Some(expected_frozen_key.clone()),
        future_submission: None,
        future_outcome: None,
        broadcast: None,
        recovery: None,
    };
    let intent = NativeTransferIntent {
        typed_transaction: TypedTransactionFields::asset_approval_revoke(
            token_contract.clone(),
            selector,
            input.method,
        ),
        rpc_url,
        account_index,
        chain_id: input.chain_id,
        from,
        to,
        value_wei: "0".to_string(),
        nonce: input.nonce,
        gas_limit: input.gas_limit,
        max_fee_per_gas: input.max_fee_per_gas,
        max_priority_fee_per_gas: input.max_priority_fee_per_gas,
    };
    debug_assert_eq!(
        intent.typed_transaction.transaction_type,
        TransactionType::AssetApprovalRevoke
    );
    Ok(ValidatedAssetApprovalRevoke {
        intent,
        calldata: Bytes::from(normalized_calldata),
        metadata,
        frozen_key: expected_frozen_key,
        approval_kind,
        owner,
        token_contract: parse_address(&token_contract, "token approval contract")?,
        spender,
        operator,
        token_id,
    })
}

fn validate_counterparty_fields(
    input: &AssetApprovalRevokeSubmitInput,
    spender: Option<Address>,
    operator: Option<Address>,
    token_id: Option<U256>,
) -> Result<(), String> {
    if let Some(expected) = spender {
        let submitted = input
            .spender
            .as_deref()
            .ok_or_else(|| "spender is required for ERC-20 revoke".to_string())
            .and_then(|value| parse_address(value, "spender"))?;
        if submitted != expected {
            return Err("spender does not match approval snapshot identity".to_string());
        }
    } else if input
        .spender
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err("spender must be empty for this approval revoke kind".to_string());
    }
    if let Some(expected) = operator {
        let submitted = input
            .operator
            .as_deref()
            .ok_or_else(|| "operator is required for NFT approval revoke".to_string())
            .and_then(|value| parse_address(value, "operator"))?;
        if submitted != expected {
            return Err("operator does not match approval snapshot identity".to_string());
        }
    } else if input
        .operator
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err("operator must be empty for this approval revoke kind".to_string());
    }
    if let Some(expected) = token_id {
        let submitted = input
            .token_id
            .as_deref()
            .ok_or_else(|| "tokenId is required for ERC-721 token approval revoke".to_string())
            .and_then(parse_token_id)?;
        if submitted != expected {
            return Err("tokenId does not match approval snapshot identity".to_string());
        }
    } else if input
        .token_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err("tokenId must be empty for this approval revoke kind".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn submit_asset_approval_revoke_command(
    input: AssetApprovalRevokeSubmitInput,
) -> Result<String, String> {
    let validated = validate_asset_approval_revoke_submit_input(input)?;
    reread_current_approval_point(&validated).await?;
    let record = submit_asset_approval_revoke(
        validated.intent,
        validated.calldata,
        validated.metadata,
        validated.frozen_key,
    )
    .await?;
    serde_json::to_string(&record).map_err(|e| e.to_string())
}

async fn reread_current_approval_point(input: &ValidatedAssetApprovalRevoke) -> Result<(), String> {
    let provider = Provider::<Http>::try_from(input.intent.rpc_url.clone())
        .map_err(|error| sanitized_summary(format!("rpc provider invalid: {error}")))?;
    let chain_id = provider
        .get_chainid()
        .await
        .map_err(|error| sanitized_summary(format!("rpc chainId probe failed: {error}")))?;
    if chain_id.as_u64() != input.intent.chain_id {
        return Err(format!(
            "remote chainId {} does not match draft chainId {}; rebuild the revoke draft",
            chain_id, input.intent.chain_id
        ));
    }
    match input.approval_kind.as_str() {
        "erc20Allowance" => {
            let spender = input
                .spender
                .ok_or_else(|| "spender is required for ERC-20 revoke".to_string())?;
            let call: TypedTransaction = TransactionRequest::new()
                .to(input.token_contract)
                .data(build_two_address_calldata(
                    ERC20_ALLOWANCE_SELECTOR,
                    input.owner,
                    spender,
                ))
                .into();
            let bytes = provider.call(&call, None).await.map_err(|error| {
                sanitized_summary(format!("allowance point read failed: {error}"))
            })?;
            let allowance = decode_u256_result(&bytes, "allowance")?;
            if allowance.is_zero() {
                return Err(
                    "approval point is already zero; rescan and rebuild the revoke draft"
                        .to_string(),
                );
            }
        }
        "erc721ApprovalForAll" => {
            let operator = input
                .operator
                .ok_or_else(|| "operator is required for NFT operator revoke".to_string())?;
            let call: TypedTransaction = TransactionRequest::new()
                .to(input.token_contract)
                .data(build_two_address_calldata(
                    NFT_IS_APPROVED_FOR_ALL_SELECTOR,
                    input.owner,
                    operator,
                ))
                .into();
            let bytes = provider.call(&call, None).await.map_err(|error| {
                sanitized_summary(format!("isApprovedForAll point read failed: {error}"))
            })?;
            if !decode_bool_result(&bytes, "isApprovedForAll")? {
                return Err(
                    "approval point is already false; rescan and rebuild the revoke draft"
                        .to_string(),
                );
            }
        }
        "erc721TokenApproval" => {
            let operator = input
                .operator
                .ok_or_else(|| "operator is required for ERC-721 token revoke".to_string())?;
            let token_id = input
                .token_id
                .ok_or_else(|| "tokenId is required for ERC-721 token revoke".to_string())?;
            let call: TypedTransaction = TransactionRequest::new()
                .to(input.token_contract)
                .data(build_u256_calldata(ERC721_GET_APPROVED_SELECTOR, token_id))
                .into();
            let bytes = provider.call(&call, None).await.map_err(|error| {
                sanitized_summary(format!("getApproved point read failed: {error}"))
            })?;
            let current = decode_address_result(&bytes, "getApproved")?;
            if current == Address::zero() {
                return Err(
                    "approval point is already zero; rescan and rebuild the revoke draft"
                        .to_string(),
                );
            }
            if current != operator {
                return Err(
                    "approval point operator changed; rescan and rebuild the revoke draft"
                        .to_string(),
                );
            }
        }
        _ => return Err("unsupported approvalKind for asset approval revoke".to_string()),
    }
    Ok(())
}

fn expected_revoke_call(
    approval_kind: &str,
    identity: &AssetApprovalRevokeSnapshotIdentityInput,
    _owner: Address,
    token_contract: Address,
) -> Result<
    (
        String,
        String,
        Vec<AssetApprovalRevokeCalldataArg>,
        Option<Address>,
        Option<Address>,
        Option<U256>,
        Vec<u8>,
    ),
    String,
> {
    match approval_kind {
        "erc20Allowance" => {
            let spender_text = identity
                .spender
                .as_deref()
                .ok_or_else(|| "spender is required for ERC-20 revoke".to_string())?;
            let spender = parse_address(spender_text, "spender")?;
            let args = vec![
                calldata_arg_string("spender", "address", lowercase_address(&spender)),
                calldata_arg_string("amount", "uint256", "0"),
            ];
            Ok((
                "approve(address,uint256)".to_string(),
                ERC20_APPROVE_SELECTOR.to_string(),
                args,
                Some(spender),
                None,
                None,
                calldata_with_selector(
                    ERC20_APPROVE_SELECTOR,
                    &[Token::Address(spender), Token::Uint(U256::zero())],
                )?,
            ))
        }
        "erc721ApprovalForAll" => {
            let operator_text = identity
                .operator
                .as_deref()
                .ok_or_else(|| "operator is required for NFT operator revoke".to_string())?;
            let operator = parse_address(operator_text, "operator")?;
            let args = vec![
                calldata_arg_string("operator", "address", lowercase_address(&operator)),
                calldata_arg_bool("approved", false),
            ];
            Ok((
                "setApprovalForAll(address,bool)".to_string(),
                SET_APPROVAL_FOR_ALL_SELECTOR.to_string(),
                args,
                None,
                Some(operator),
                None,
                calldata_with_selector(
                    SET_APPROVAL_FOR_ALL_SELECTOR,
                    &[Token::Address(operator), Token::Bool(false)],
                )?,
            ))
        }
        "erc721TokenApproval" => {
            let operator_text = identity
                .operator
                .as_deref()
                .ok_or_else(|| "operator is required for ERC-721 token revoke".to_string())?;
            let operator = parse_address(operator_text, "operator")?;
            let token_id_text = identity
                .token_id
                .as_deref()
                .ok_or_else(|| "tokenId is required for ERC-721 token revoke".to_string())?;
            let token_id = parse_token_id(token_id_text)?;
            let args = vec![
                calldata_arg_string("approved", "address", ZERO_ADDRESS),
                calldata_arg_string("tokenId", "uint256", token_id.to_string()),
            ];
            Ok((
                "approve(address,uint256)".to_string(),
                ERC20_APPROVE_SELECTOR.to_string(),
                args,
                None,
                Some(operator),
                Some(token_id),
                calldata_with_selector(
                    ERC20_APPROVE_SELECTOR,
                    &[Token::Address(Address::zero()), Token::Uint(token_id)],
                )?,
            ))
        }
        _ => Err("unsupported approvalKind for asset approval revoke".to_string()),
    }
    .and_then(|result| {
        let _ = token_contract;
        Ok(result)
    })
}

fn calldata_with_selector(selector: &str, tokens: &[Token]) -> Result<Vec<u8>, String> {
    let mut bytes = decode_hex(selector.trim_start_matches("0x"), "selector")?;
    bytes.extend_from_slice(&encode(tokens));
    Ok(bytes)
}

fn build_two_address_calldata(selector: [u8; 4], first: Address, second: Address) -> Bytes {
    let mut data = Vec::with_capacity(68);
    data.extend_from_slice(&selector);
    data.extend_from_slice(&encode(&[Token::Address(first), Token::Address(second)]));
    Bytes::from(data)
}

fn build_u256_calldata(selector: [u8; 4], value: U256) -> Bytes {
    let mut data = Vec::with_capacity(36);
    data.extend_from_slice(&selector);
    data.extend_from_slice(&encode(&[Token::Uint(value)]));
    Bytes::from(data)
}

fn decode_u256_result(bytes: &Bytes, label: &str) -> Result<U256, String> {
    if bytes.len() != 32 {
        return Err(format!("{label} returned an unexpected response length"));
    }
    Ok(U256::from_big_endian(bytes.as_ref()))
}

fn decode_bool_result(bytes: &Bytes, label: &str) -> Result<bool, String> {
    let value = decode_u256_result(bytes, label)?;
    if value.is_zero() {
        Ok(false)
    } else if value == U256::one() {
        Ok(true)
    } else {
        Err(format!("{label} returned a non-boolean value"))
    }
}

fn decode_address_result(bytes: &Bytes, label: &str) -> Result<Address, String> {
    if bytes.len() != 32 {
        return Err(format!("{label} returned an unexpected response length"));
    }
    Ok(Address::from_slice(&bytes.as_ref()[12..32]))
}

fn validate_warning_acknowledgements(
    warnings: &[AssetApprovalRevokeStatusInput],
) -> Result<(), String> {
    let manual_fee = warnings.iter().any(|warning| {
        warning.code == "manualFeeGas" && warning.requires_acknowledgement && warning.acknowledged
    });
    if !manual_fee {
        return Err("manualFeeGas warning acknowledgement is required".to_string());
    }
    if let Some(warning) = warnings
        .iter()
        .find(|warning| warning.requires_acknowledgement && !warning.acknowledged)
    {
        return Err(format!(
            "warning acknowledgement is required before submit: {}",
            warning.code
        ));
    }
    Ok(())
}

fn normalize_calldata(value: &str) -> Result<Vec<u8>, String> {
    let trimmed = value.trim();
    let hex = trimmed
        .strip_prefix("0x")
        .ok_or_else(|| "calldata must start with 0x".to_string())?;
    decode_hex(hex, "calldata")
}

fn normalize_selector(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let hex = trimmed
        .strip_prefix("0x")
        .ok_or_else(|| "selector must be a 0x-prefixed 4-byte hex string".to_string())?;
    if hex.len() != 8 || !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err("selector must be a 0x-prefixed 4-byte hex string".to_string());
    }
    Ok(format!("0x{}", hex.to_ascii_lowercase()))
}

fn decode_hex(hex: &str, label: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
        return Err(format!("{label} hex must contain complete bytes"));
    }
    if !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(format!("{label} can only contain hexadecimal characters"));
    }
    (0..hex.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&hex[index..index + 2], 16)
                .map_err(|_| format!("{label} contains invalid hex"))
        })
        .collect()
}

fn checksum_address(value: &str, label: &str) -> Result<String, String> {
    let address = parse_address(value, label)?;
    Ok(to_checksum(&address, None))
}

fn lowercase_address(address: &Address) -> String {
    format!("{address:#x}")
}

fn parse_address(value: &str, label: &str) -> Result<Address, String> {
    Address::from_str(value.trim()).map_err(|_| format!("{label} must be a valid EVM address"))
}

fn parse_u256_decimal(label: &str, value: &str) -> Result<U256, String> {
    if value.trim().starts_with('-') {
        return Err(format!("{label} must be a non-negative decimal integer"));
    }
    U256::from_dec_str(value.trim()).map_err(|_| format!("{label} must be a decimal uint256"))
}

fn parse_token_id(value: &str) -> Result<U256, String> {
    let normalized = normalize_token_id(value).ok_or_else(|| {
        "tokenId must be a non-negative integer string within uint256 range".to_string()
    })?;
    U256::from_dec_str(&normalized).map_err(|_| {
        "tokenId must be a non-negative integer string within uint256 range".to_string()
    })
}

fn normalize_token_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('-')
        || !trimmed.chars().all(|ch| ch.is_ascii_digit())
    {
        return None;
    }
    let normalized = trimmed.trim_start_matches('0');
    Some(
        if normalized.is_empty() {
            "0"
        } else {
            normalized
        }
        .to_string(),
    )
}

fn approval_identity_key(
    identity: &AssetApprovalRevokeSnapshotIdentityInput,
) -> Result<String, String> {
    Ok(format!(
        "chainId={}|owner={}|contract={}|kind={}|spender={}|operator={}|tokenId={}",
        identity.chain_id,
        parse_address(&identity.owner, "approval owner")?
            .to_string()
            .to_lowercase(),
        parse_address(&identity.contract, "approval contract")?
            .to_string()
            .to_lowercase(),
        identity.kind,
        identity
            .spender
            .as_deref()
            .map(|value| parse_address(value, "spender")
                .map(|address| address.to_string().to_lowercase()))
            .transpose()?
            .unwrap_or_default(),
        identity
            .operator
            .as_deref()
            .map(|value| parse_address(value, "operator")
                .map(|address| address.to_string().to_lowercase()))
            .transpose()?
            .unwrap_or_default(),
        identity
            .token_id
            .as_deref()
            .and_then(normalize_token_id)
            .unwrap_or_default()
    ))
}

struct AssetApprovalRevokeFrozenPayloadParts<'a> {
    chain_id: u64,
    selected_rpc: &'a AssetApprovalRevokeSelectedRpcInput,
    approval_identity: &'a AssetApprovalRevokeSnapshotIdentityInput,
    approval_kind: &'a str,
    token_approval_contract: &'a str,
    spender: Option<&'a str>,
    operator: Option<&'a str>,
    token_id: Option<&'a str>,
    from: Option<&'a str>,
    account_index: Option<u32>,
    method: Option<&'a str>,
    selector: Option<&'a str>,
    calldata_args: &'a [AssetApprovalRevokeCalldataArg],
    calldata: Option<&'a [u8]>,
    gas_limit: Option<&'a str>,
    latest_base_fee_per_gas: Option<&'a str>,
    base_fee_per_gas: Option<&'a str>,
    max_fee_per_gas: Option<&'a str>,
    max_priority_fee_per_gas: Option<&'a str>,
    nonce: Option<u64>,
    warnings: &'a [AssetApprovalRevokeStatusInput],
    blocking_statuses: &'a [AssetApprovalRevokeStatusInput],
}

fn asset_revoke_frozen_key(parts: &AssetApprovalRevokeFrozenPayloadParts<'_>) -> String {
    let stable = stable_stringify(&asset_revoke_frozen_payload(parts));
    let hash = keccak256(stable.as_bytes());
    format!("asset-revoke-{}", hex_lower(&hash[..8]))
}

fn asset_revoke_frozen_payload(parts: &AssetApprovalRevokeFrozenPayloadParts<'_>) -> Value {
    object_value([
        (
            "kind",
            Value::String("assetApprovalRevokeDraft".to_string()),
        ),
        ("frozenVersion", number_value(REVOKE_DRAFT_VERSION)),
        ("expectedChainId", number_value(parts.chain_id)),
        ("selectedRpc", selected_rpc_value(parts.selected_rpc)),
        ("from", optional_string_value(parts.from)),
        (
            "fromAccountIndex",
            parts.account_index.map(number_value).unwrap_or(Value::Null),
        ),
        (
            "approvalIdentity",
            serde_json::to_value(parts.approval_identity).unwrap_or(Value::Null),
        ),
        (
            "approvalKind",
            Value::String(parts.approval_kind.to_string()),
        ),
        (
            "tokenApprovalContract",
            Value::String(parts.token_approval_contract.to_string()),
        ),
        ("spender", optional_string_value(parts.spender)),
        ("operator", optional_string_value(parts.operator)),
        ("tokenId", optional_string_value(parts.token_id)),
        ("method", optional_string_value(parts.method)),
        ("selector", optional_string_value(parts.selector)),
        (
            "calldataArgs",
            Value::Array(
                parts
                    .calldata_args
                    .iter()
                    .map(|arg| {
                        object_value([
                            ("name", Value::String(arg.name.clone())),
                            ("type", Value::String(arg.type_label.clone())),
                            ("value", arg.value.clone()),
                        ])
                    })
                    .collect(),
            ),
        ),
        (
            "calldata",
            parts
                .calldata
                .map(|bytes| Value::String(format!("0x{}", hex_lower(bytes))))
                .unwrap_or(Value::Null),
        ),
        (
            "gas",
            object_value([
                ("gasLimit", optional_string_value(parts.gas_limit)),
                (
                    "latestBaseFeePerGas",
                    optional_string_value(parts.latest_base_fee_per_gas),
                ),
                (
                    "baseFeePerGas",
                    optional_string_value(parts.base_fee_per_gas),
                ),
                ("maxFeePerGas", optional_string_value(parts.max_fee_per_gas)),
                (
                    "maxPriorityFeePerGas",
                    optional_string_value(parts.max_priority_fee_per_gas),
                ),
            ]),
        ),
        (
            "nonce",
            parts.nonce.map(number_value).unwrap_or(Value::Null),
        ),
        (
            "warningAcknowledgements",
            Value::Array(
                parts
                    .warnings
                    .iter()
                    .filter(|warning| warning.requires_acknowledgement)
                    .map(|warning| {
                        object_value([
                            ("code", Value::String(warning.code.clone())),
                            ("acknowledged", Value::Bool(warning.acknowledged)),
                        ])
                    })
                    .collect(),
            ),
        ),
        (
            "blockingStatuses",
            Value::Array(
                parts
                    .blocking_statuses
                    .iter()
                    .map(|status| {
                        object_value([
                            ("code", Value::String(status.code.clone())),
                            ("source", Value::String(status.source.clone())),
                        ])
                    })
                    .collect(),
            ),
        ),
    ])
}

fn selected_rpc_value(rpc: &AssetApprovalRevokeSelectedRpcInput) -> Value {
    object_value([
        (
            "chainId",
            rpc.chain_id.map(number_value).unwrap_or(Value::Null),
        ),
        (
            "providerConfigId",
            optional_string_value(rpc.provider_config_id.as_deref()),
        ),
        (
            "endpointId",
            optional_string_value(rpc.endpoint_id.as_deref()),
        ),
        (
            "endpointName",
            optional_string_value(rpc.endpoint_name.as_deref()),
        ),
        (
            "endpointSummary",
            optional_string_value(rpc.endpoint_summary.as_deref()),
        ),
        (
            "endpointFingerprint",
            optional_string_value(rpc.endpoint_fingerprint.as_deref()),
        ),
    ])
}

fn stable_stringify(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).expect("string serialization"),
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(stable_stringify)
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|key| format!(
                        "{}:{}",
                        serde_json::to_string(key).expect("key serialization"),
                        stable_stringify(&values[key])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

fn object_value<const N: usize>(entries: [(&str, Value); N]) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect::<Map<String, Value>>(),
    )
}

fn optional_string_value(value: Option<&str>) -> Value {
    value
        .map(|value| Value::String(value.to_string()))
        .unwrap_or(Value::Null)
}

fn number_value(value: impl Into<u64>) -> Value {
    Value::Number(serde_json::Number::from(value.into()))
}

fn selected_rpc_to_history(rpc: &AssetApprovalRevokeSelectedRpcInput) -> AbiCallSelectedRpcSummary {
    AbiCallSelectedRpcSummary {
        chain_id: rpc.chain_id,
        provider_config_id: rpc.provider_config_id.clone(),
        endpoint_id: rpc.endpoint_id.clone(),
        endpoint_name: rpc.endpoint_name.clone(),
        endpoint_summary: rpc.endpoint_summary.clone(),
        endpoint_fingerprint: rpc.endpoint_fingerprint.clone(),
    }
}

fn snapshot_to_history(
    snapshot: &AssetApprovalRevokeSnapshotIdentityInput,
) -> AssetApprovalRevokeSnapshotMetadata {
    AssetApprovalRevokeSnapshotMetadata {
        identity_key: Some(snapshot.identity_key.clone()),
        status: Some(snapshot.status.clone()),
        source_kind: Some(snapshot.source_kind.clone()),
        source_summary: snapshot.source_summary.clone(),
        stale: Some(snapshot.stale),
        failure: Some(snapshot.failure),
        created_at: snapshot.ref_.created_at.clone(),
        updated_at: snapshot.ref_.updated_at.clone(),
        last_scanned_at: snapshot.ref_.last_scanned_at.clone(),
        stale_after: snapshot.ref_.stale_after.clone(),
        rpc_identity: snapshot.ref_.rpc_identity.clone(),
        rpc_profile_id: snapshot.ref_.rpc_profile_id.clone(),
    }
}

fn status_to_history(status: &AssetApprovalRevokeStatusInput) -> AbiCallStatusSummary {
    AbiCallStatusSummary {
        level: status.level.clone(),
        code: status.code.clone(),
        message: Some(status.message.clone()),
        source: Some(status.source.clone()),
    }
}

fn calldata_args_to_history(
    args: &[AssetApprovalRevokeCalldataArg],
) -> Vec<AbiDecodedFieldHistorySummary> {
    args.iter()
        .map(|arg| AbiDecodedFieldHistorySummary {
            name: Some(arg.name.clone()),
            value: AbiDecodedValueHistorySummary {
                kind: "primitive".to_string(),
                type_label: arg.type_label.clone(),
                value: Some(match &arg.value {
                    Value::String(value) => value.clone(),
                    Value::Bool(value) => value.to_string(),
                    value => value.to_string(),
                }),
                byte_length: None,
                hash: None,
                items: Vec::new(),
                fields: Vec::new(),
                truncated: false,
            },
        })
        .collect()
}

fn calldata_arg_string(
    name: &str,
    type_label: &str,
    value: impl Into<String>,
) -> AssetApprovalRevokeCalldataArg {
    AssetApprovalRevokeCalldataArg {
        name: name.to_string(),
        type_label: type_label.to_string(),
        value: Value::String(value.into()),
    }
}

fn calldata_arg_bool(name: &str, value: bool) -> AssetApprovalRevokeCalldataArg {
    AssetApprovalRevokeCalldataArg {
        name: name.to_string(),
        type_label: "bool".to_string(),
        value: Value::Bool(value),
    }
}

fn validate_selected_rpc_endpoint(
    selected_rpc: &AssetApprovalRevokeSelectedRpcInput,
    rpc_url: &str,
) -> Result<(), String> {
    let endpoint_summary = selected_rpc
        .endpoint_summary
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "selectedRpc.endpointSummary is required for asset approval revoke submit".to_string()
        })?;
    if endpoint_summary != summarize_rpc_endpoint(rpc_url) {
        return Err(
            "submitted rpcUrl does not match frozen selectedRpc endpointSummary".to_string(),
        );
    }
    let endpoint_fingerprint = selected_rpc
        .endpoint_fingerprint
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "selectedRpc.endpointFingerprint is required for asset approval revoke submit"
                .to_string()
        })?;
    if endpoint_fingerprint != rpc_endpoint_fingerprint(rpc_url) {
        return Err(
            "submitted rpcUrl does not match frozen selectedRpc endpointFingerprint".to_string(),
        );
    }
    Ok(())
}

fn summarize_rpc_endpoint(rpc_url: &str) -> String {
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

fn rpc_endpoint_fingerprint(rpc_url: &str) -> String {
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
                    format!("{}=[redacted]", decode_rpc_query_key(key))
                })
                .collect::<Vec<_>>()
                .join("&")
        })
        .filter(|query| !query.is_empty())
        .map(|query| format!("?{query}"))
        .unwrap_or_default();
    format!("{scheme}://{authority}{path}{query}")
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
                if let (Some(high), Some(low)) =
                    (hex_value(input[index + 1]), hex_value(input[index + 2]))
                {
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

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn compact_hash_key_with_prefix(prefix: &str, value: &str) -> String {
    let mut hash = 0x811c9dc5u32;
    for code_unit in value.encode_utf16() {
        hash ^= code_unit as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{prefix}-{hash:08x}")
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sanitized_summary(value: impl Into<String>) -> String {
    let value = value.into();
    let mut value = sanitize_diagnostic_message(&value).replace('\n', " ");
    if value.len() > 256 {
        value.truncate(256);
        value.push_str("[truncated]");
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rpc() -> AssetApprovalRevokeSelectedRpcInput {
        AssetApprovalRevokeSelectedRpcInput {
            chain_id: Some(1),
            provider_config_id: Some("chain-1".to_string()),
            endpoint_id: Some("active".to_string()),
            endpoint_name: Some("Selected RPC".to_string()),
            endpoint_summary: Some("https://rpc.example".to_string()),
            endpoint_fingerprint: Some(rpc_endpoint_fingerprint("https://rpc.example")),
        }
    }

    fn identity(kind: &str) -> AssetApprovalRevokeSnapshotIdentityInput {
        let mut identity = AssetApprovalRevokeSnapshotIdentityInput {
            identity_key: String::new(),
            chain_id: 1,
            owner: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd".to_string(),
            contract: "0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed".to_string(),
            kind: kind.to_string(),
            spender: None,
            operator: None,
            token_id: None,
            status: "active".to_string(),
            source_kind: "rpcPointRead".to_string(),
            source_summary: Some("RPC point read".to_string()),
            source: Value::Null,
            stale: false,
            failure: false,
            ref_: AssetApprovalRevokeSnapshotRefInput::default(),
        };
        match kind {
            "erc20Allowance" => {
                identity.spender = Some("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef".to_string());
            }
            "erc721ApprovalForAll" => {
                identity.operator = Some("0xbaadf00dbaadf00dbaadf00dbaadf00dbaadf00d".to_string());
            }
            "erc721TokenApproval" => {
                identity.operator = Some("0xbaadf00dbaadf00dbaadf00dbaadf00dbaadf00d".to_string());
                identity.token_id = Some("42".to_string());
            }
            _ => {}
        }
        identity.identity_key = approval_identity_key(&identity).unwrap();
        identity
    }

    fn base_input(kind: &str) -> AssetApprovalRevokeSubmitInput {
        let identity = identity(kind);
        let owner = lowercase_address(&parse_address(&identity.owner, "owner").unwrap());
        let contract = lowercase_address(&parse_address(&identity.contract, "contract").unwrap());
        let (_method, selector, args, _spender, _operator, _token_id, calldata) =
            expected_revoke_call(
                kind,
                &identity,
                parse_address(&owner, "owner").unwrap(),
                parse_address(&contract, "contract").unwrap(),
            )
            .unwrap();
        let method = match kind {
            "erc721ApprovalForAll" => "setApprovalForAll(address,bool)",
            _ => "approve(address,uint256)",
        };
        let mut input = AssetApprovalRevokeSubmitInput {
            rpc_url: "https://rpc.example".to_string(),
            draft_id: Some("draft".to_string()),
            frozen_key: None,
            created_at: Some("2026-04-29T00:00:00.000Z".to_string()),
            frozen_at: Some("2026-04-29T00:00:00.000Z".to_string()),
            chain_id: 1,
            selected_rpc: rpc(),
            from: owner,
            account_index: Some(0),
            to: contract,
            value_wei: "0".to_string(),
            approval_identity: Some(identity.clone()),
            approval_kind: Some(kind.to_string()),
            token_approval_contract: Some(identity.contract.clone()),
            spender: identity.spender.clone(),
            operator: identity.operator.clone(),
            token_id: identity.token_id.clone(),
            method: method.to_string(),
            selector,
            calldata: format!("0x{}", hex_lower(&calldata)),
            calldata_args: args,
            nonce: 7,
            gas_limit: "50000".to_string(),
            latest_base_fee_per_gas: Some("10".to_string()),
            base_fee_per_gas: Some("10".to_string()),
            max_fee_per_gas: "12".to_string(),
            max_priority_fee_per_gas: "2".to_string(),
            warnings: vec![AssetApprovalRevokeStatusInput {
                level: "warning".to_string(),
                code: "manualFeeGas".to_string(),
                message: "Nonce, gas limit, and EIP-1559 fee fields are manual inputs.".to_string(),
                source: "fee".to_string(),
                requires_acknowledgement: true,
                acknowledged: true,
            }],
            blocking_statuses: Vec::new(),
        };
        refresh_frozen_key(&mut input);
        input
    }

    fn refresh_frozen_key(input: &mut AssetApprovalRevokeSubmitInput) {
        let identity = input.approval_identity.as_ref().unwrap();
        let calldata = normalize_calldata(&input.calldata).unwrap();
        input.frozen_key = Some(asset_revoke_frozen_key(
            &AssetApprovalRevokeFrozenPayloadParts {
                chain_id: input.chain_id,
                selected_rpc: &input.selected_rpc,
                approval_identity: identity,
                approval_kind: input.approval_kind.as_deref().unwrap(),
                token_approval_contract: input.token_approval_contract.as_deref().unwrap(),
                spender: input.spender.as_deref(),
                operator: input.operator.as_deref(),
                token_id: input.token_id.as_deref(),
                from: Some(&input.from),
                account_index: input.account_index,
                method: Some(&input.method),
                selector: Some(&input.selector),
                calldata_args: &input.calldata_args,
                calldata: Some(&calldata),
                gas_limit: Some(&input.gas_limit),
                latest_base_fee_per_gas: input.latest_base_fee_per_gas.as_deref(),
                base_fee_per_gas: input.base_fee_per_gas.as_deref(),
                max_fee_per_gas: Some(&input.max_fee_per_gas),
                max_priority_fee_per_gas: Some(&input.max_priority_fee_per_gas),
                nonce: Some(input.nonce),
                warnings: &input.warnings,
                blocking_statuses: &input.blocking_statuses,
            },
        ));
    }

    #[test]
    fn validates_erc20_revoke_intent_metadata_and_frozen_key() {
        let input = base_input("erc20Allowance");
        let result = validate_asset_approval_revoke_submit_input(input).unwrap();
        assert_eq!(
            result.intent.typed_transaction.transaction_type,
            TransactionType::AssetApprovalRevoke
        );
        assert_eq!(
            result.metadata.approval_kind.as_deref(),
            Some("erc20Allowance")
        );
        assert_eq!(
            result.metadata.method.as_deref(),
            Some("approve(address,uint256)")
        );
        assert_eq!(
            result.metadata.selector.as_deref(),
            Some(ERC20_APPROVE_SELECTOR)
        );
    }

    #[test]
    fn validates_nft_operator_and_token_specific_revoke() {
        for kind in ["erc721ApprovalForAll", "erc721TokenApproval"] {
            validate_asset_approval_revoke_submit_input(base_input(kind)).unwrap();
        }
    }

    #[test]
    fn frontend_style_payload_serializes_with_one_account_index_field() {
        let input = base_input("erc20Allowance");
        let value = serde_json::to_value(&input).expect("serialize frontend submit payload");

        assert_eq!(value.get("accountIndex").and_then(Value::as_u64), Some(0));
        assert!(value.get("fromAccountIndex").is_none());

        let roundtrip: AssetApprovalRevokeSubmitInput =
            serde_json::from_value(value).expect("deserialize frontend submit payload");
        assert_eq!(roundtrip.account_index, Some(0));
        validate_asset_approval_revoke_submit_input(roundtrip).unwrap();
    }

    #[test]
    fn point_read_error_summaries_redact_urls_and_secrets() {
        let error = sanitized_summary(
            "allowance point read failed: provider error at https://rpc.example.invalid/v1?apiKey=secret privateKey=0xabc123 rawSignedTx=0xdeadbeef",
        );

        assert!(error.contains("allowance point read failed"));
        assert!(!error.contains("https://rpc.example.invalid"));
        assert!(!error.contains("apiKey=secret"));
        assert!(!error.contains("privateKey=0xabc123"));
        assert!(!error.contains("rawSignedTx=0xdeadbeef"));
        assert!(error.len() <= 267);
    }

    #[test]
    fn rejects_chain_from_snapshot_selector_fee_warning_and_frozen_mismatches() {
        let mut input = base_input("erc20Allowance");
        input.selected_rpc.chain_id = Some(5);
        assert!(validate_asset_approval_revoke_submit_input(input)
            .unwrap_err()
            .contains("chainId"));

        let mut input = base_input("erc20Allowance");
        input.from = "0x9999999999999999999999999999999999999999".to_string();
        refresh_frozen_key(&mut input);
        assert!(validate_asset_approval_revoke_submit_input(input)
            .unwrap_err()
            .contains("from"));

        let mut input = base_input("erc20Allowance");
        input.selector = SET_APPROVAL_FOR_ALL_SELECTOR.to_string();
        refresh_frozen_key(&mut input);
        assert!(validate_asset_approval_revoke_submit_input(input)
            .unwrap_err()
            .contains("selector"));

        let mut input = base_input("erc20Allowance");
        input.max_priority_fee_per_gas = "13".to_string();
        refresh_frozen_key(&mut input);
        assert!(validate_asset_approval_revoke_submit_input(input)
            .unwrap_err()
            .contains("maxFeePerGas"));

        let mut input = base_input("erc20Allowance");
        input.warnings[0].acknowledged = false;
        refresh_frozen_key(&mut input);
        assert!(validate_asset_approval_revoke_submit_input(input)
            .unwrap_err()
            .contains("warning"));

        let mut input = base_input("erc20Allowance");
        input.frozen_key = Some("asset-revoke-deadbeefdeadbeef".to_string());
        assert!(validate_asset_approval_revoke_submit_input(input)
            .unwrap_err()
            .contains("frozenKey"));
    }

    #[test]
    fn rejects_snapshot_stale_identity_mismatch_and_already_inactive() {
        let mut input = base_input("erc20Allowance");
        input.approval_identity.as_mut().unwrap().status = "zero".to_string();
        refresh_frozen_key(&mut input);
        assert!(validate_asset_approval_revoke_submit_input(input)
            .unwrap_err()
            .contains("active"));

        let mut input = base_input("erc20Allowance");
        input.approval_identity.as_mut().unwrap().stale = true;
        refresh_frozen_key(&mut input);
        assert!(validate_asset_approval_revoke_submit_input(input)
            .unwrap_err()
            .contains("fresh RPC"));

        let mut input = base_input("erc20Allowance");
        input.approval_identity.as_mut().unwrap().identity_key = "wrong".to_string();
        refresh_frozen_key(&mut input);
        assert!(validate_asset_approval_revoke_submit_input(input)
            .unwrap_err()
            .contains("identityKey"));
    }
}
