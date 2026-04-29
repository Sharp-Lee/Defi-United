export type ChainOutcomeState =
  | "Pending"
  | "Confirmed"
  | "Failed"
  | "Replaced"
  | "Cancelled"
  | "Dropped"
  | "Unknown";

export type TransactionType =
  | "legacy"
  | "nativeTransfer"
  | "erc20Transfer"
  | "contractCall"
  | "unknown";

export type SubmissionKind =
  | "legacy"
  | "nativeTransfer"
  | "erc20Transfer"
  | "abiWriteCall"
  | "replacement"
  | "cancellation"
  | "unsupported";

export interface TypedTransactionFields {
  transaction_type: TransactionType;
  token_contract: string | null;
  recipient: string | null;
  amount_raw: string | null;
  decimals: number | null;
  token_symbol: string | null;
  token_name: string | null;
  token_metadata_source: string | null;
  selector: string | null;
  method_name: string | null;
  native_value_wei: string | null;
}

export interface NativeTransferIntent {
  transaction_type?: "nativeTransfer";
  rpc_url: string;
  account_index: number;
  chain_id: number;
  from: string;
  to: string;
  value_wei: string;
  nonce: number;
  gas_limit: string;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
}

export interface HistoryTransactionIntent extends TypedTransactionFields {
  rpc_url: string | null;
  account_index: number | null;
  chain_id: number | null;
  from: string | null;
  to: string | null;
  value_wei: string | null;
  nonce: number | null;
  gas_limit: string | null;
  max_fee_per_gas: string | null;
  max_priority_fee_per_gas: string | null;
}

export interface IntentSnapshotMetadata {
  source: string;
  captured_at: string | null;
}

export interface SubmissionRecord {
  transaction_type: TransactionType;
  token_contract: string | null;
  recipient: string | null;
  amount_raw: string | null;
  decimals: number | null;
  token_symbol: string | null;
  token_name: string | null;
  token_metadata_source: string | null;
  selector: string | null;
  method_name: string | null;
  native_value_wei: string | null;
  frozen_key: string;
  tx_hash: string;
  kind: SubmissionKind;
  source: string;
  chain_id: number | null;
  account_index: number | null;
  from: string | null;
  to: string | null;
  value_wei: string | null;
  nonce: number | null;
  gas_limit: string | null;
  max_fee_per_gas: string | null;
  max_priority_fee_per_gas: string | null;
  broadcasted_at: string | null;
  replaces_tx_hash: string | null;
}

export interface ReceiptSummary {
  status: number | null;
  block_number: number | null;
  block_hash: string | null;
  transaction_index: number | null;
  gas_used: string | null;
  effective_gas_price: string | null;
}

export interface ReconcileSummary {
  source: string;
  checked_at: string | null;
  rpc_chain_id: number | null;
  latest_confirmed_nonce: number | null;
  decision: string;
}

export interface HistoryErrorSummary {
  source: string;
  category: string;
  message: string;
}

export interface DroppedReviewSummary {
  reviewed_at: string | null;
  source: string;
  tx_hash: string;
  rpc_endpoint_summary: string;
  requested_chain_id: number | null;
  rpc_chain_id: number | null;
  latest_confirmed_nonce: number | null;
  transaction_found: boolean | null;
  local_same_nonce_tx_hash: string | null;
  local_same_nonce_state: ChainOutcomeState | null;
  original_state: ChainOutcomeState;
  original_finalized_at: string | null;
  original_reconciled_at: string | null;
  original_reconcile_summary: ReconcileSummary | null;
  result_state: ChainOutcomeState;
  receipt: ReceiptSummary | null;
  decision: string;
  recommendation: string;
  error_summary: HistoryErrorSummary | null;
}

export interface ChainOutcome {
  state: ChainOutcomeState;
  tx_hash: string;
  receipt: ReceiptSummary | null;
  finalized_at: string | null;
  reconciled_at: string | null;
  reconcile_summary: ReconcileSummary | null;
  error_summary: HistoryErrorSummary | null;
  dropped_review_history: DroppedReviewSummary[];
}

export interface NonceThread {
  source: string;
  key: string;
  chain_id: number | null;
  account_index: number | null;
  from: string | null;
  nonce: number | null;
  replaces_tx_hash: string | null;
  replaced_by_tx_hash: string | null;
}

export interface BatchHistoryMetadata {
  batch_id: string;
  child_id: string;
  batch_kind: "distribute" | "collect" | "unknown";
  asset_kind: "native" | "erc20" | "unknown";
  child_index: number | null;
  freeze_key: string | null;
  child_count: number | null;
  contract_address: string | null;
  selector: string | null;
  method_name: string | null;
  total_value_wei: string | null;
  token_contract: string | null;
  decimals: number | null;
  token_symbol: string | null;
  token_name: string | null;
  token_metadata_source: string | null;
  total_amount_raw: string | null;
  recipients: BatchRecipientAllocation[];
}

export interface BatchRecipientAllocation {
  child_id: string;
  child_index: number;
  target_kind: "localAccount" | "externalAddress" | "unknown";
  target_address: string;
  value_wei: string;
  amount_raw: string | null;
}

export interface AbiCallSelectedRpcSummary {
  chain_id: number | null;
  provider_config_id: string | null;
  endpoint_id: string | null;
  endpoint_name: string | null;
  endpoint_summary: string | null;
  endpoint_fingerprint: string | null;
}

export interface AbiCallStatusSummary {
  level: "info" | "warning" | "blocking" | "unknown";
  code: string;
  message: string | null;
  source: string | null;
}

export interface AbiDecodedFieldHistorySummary {
  name: string | null;
  value: AbiDecodedValueHistorySummary;
}

export interface AbiDecodedValueHistorySummary {
  kind: string;
  type: string;
  value: string | null;
  byte_length: number | null;
  hash: string | null;
  items: AbiDecodedValueHistorySummary[];
  fields: AbiDecodedFieldHistorySummary[];
  truncated: boolean;
}

export interface AbiCallCalldataSummary {
  selector: string | null;
  byte_length: number | null;
  hash: string | null;
}

export interface AbiCallSubmissionPlaceholder {
  status: string | null;
  tx_hash: string | null;
  submitted_at: string | null;
  broadcasted_at: string | null;
  error_summary: string | null;
}

export interface AbiCallOutcomePlaceholder {
  state: ChainOutcomeState | null;
  checked_at: string | null;
  receipt_status: number | null;
  block_number: number | null;
  gas_used: string | null;
  error_summary: string | null;
}

export interface AbiCallBroadcastPlaceholder {
  tx_hash: string | null;
  broadcasted_at: string | null;
  rpc_chain_id: number | null;
  rpc_endpoint_summary: string | null;
  error_summary: string | null;
}

export interface AbiCallRecoveryPlaceholder {
  recovery_id: string | null;
  status: string | null;
  created_at: string | null;
  recovered_at: string | null;
  last_error: string | null;
  replacement_tx_hash: string | null;
}

export interface AbiCallHistoryMetadata {
  intent_kind: "abiWriteCall" | "unknown";
  draft_id: string | null;
  created_at: string | null;
  chain_id: number | null;
  account_index: number | null;
  from: string | null;
  contract_address: string | null;
  source_kind: string;
  provider_config_id: string | null;
  user_source_id: string | null;
  version_id: string | null;
  abi_hash: string | null;
  source_fingerprint: string | null;
  function_signature: string | null;
  selector: string | null;
  argument_summary: AbiDecodedValueHistorySummary[];
  argument_hash: string | null;
  native_value_wei: string | null;
  gas_limit: string | null;
  max_fee_per_gas: string | null;
  max_priority_fee_per_gas: string | null;
  nonce: number | null;
  selected_rpc: AbiCallSelectedRpcSummary | null;
  warnings: AbiCallStatusSummary[];
  blocking_statuses: AbiCallStatusSummary[];
  calldata: AbiCallCalldataSummary | null;
  future_submission: AbiCallSubmissionPlaceholder | null;
  future_outcome: AbiCallOutcomePlaceholder | null;
  broadcast: AbiCallBroadcastPlaceholder | null;
  recovery: AbiCallRecoveryPlaceholder | null;
}

export interface HistoryRecord {
  schema_version: number;
  intent: HistoryTransactionIntent;
  intent_snapshot: IntentSnapshotMetadata;
  submission: SubmissionRecord;
  outcome: ChainOutcome;
  nonce_thread: NonceThread;
  batch_metadata?: BatchHistoryMetadata | null;
  abi_call_metadata?: AbiCallHistoryMetadata | null;
}

const LEGACY = "legacy";
const UNKNOWN = "unknown";
const TRANSACTION_TYPES = new Set<TransactionType>([
  "legacy",
  "nativeTransfer",
  "erc20Transfer",
  "contractCall",
  "unknown",
]);
const SUBMISSION_KINDS = new Set<SubmissionKind>([
  "legacy",
  "nativeTransfer",
  "erc20Transfer",
  "abiWriteCall",
  "replacement",
  "cancellation",
  "unsupported",
]);
const OUTCOME_STATES = new Set<ChainOutcomeState>([
  "Pending",
  "Confirmed",
  "Failed",
  "Replaced",
  "Cancelled",
  "Dropped",
  "Unknown",
]);

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function stringOrDefault(value: unknown, fallback = UNKNOWN) {
  return typeof value === "string" ? value : fallback;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function boundedStringOrNull(value: unknown, maxLength = 256) {
  if (typeof value !== "string") return null;
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...[truncated]`;
}

function sanitizeDurableRpcSummary(value: unknown, maxLength = 200) {
  const bounded = boundedStringOrNull(value, maxLength);
  if (bounded === null) return null;
  const compact = bounded.replace(/\s+/g, " ").trim();
  const redacted = compact
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>;,]+/gi, "[redacted_endpoint]")
    .replace(/\bBearer\s+[^\s"'<>;,]+/gi, "Bearer [redacted_secret]")
    .replace(
      /\b[^\s"'<>;,]*(?:api[_-]?key|apikey|token|auth|authorization|password|secret|private[_-]?key|access[_-]?token)[^\s"'<>;,]*\s*[:=]\s*[^\s"'<>;,]+/gi,
      "[redacted_secret]",
    );
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}...[truncated]`;
}

function sanitizeAbiSummaryToken(value: unknown, fallback = UNKNOWN, maxLength = 96) {
  if (typeof value !== "string") return { value: fallback, changed: false };
  const compact = value.replace(/\s+/g, " ").trim();
  if (/^0x[0-9a-f]+$/i.test(compact) && compact.length > maxLength) {
    return { value: "[redacted_payload]", changed: true };
  }
  const redacted = sanitizeDurableRpcSummary(compact, maxLength) ?? fallback;
  const sanitized =
    redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}...[truncated]`;
  return { value: sanitized, changed: sanitized !== value };
}

function sanitizeAbiSummaryHash(value: unknown) {
  if (typeof value !== "string") return { value: null, changed: false };
  const compact = value.replace(/\s+/g, " ").trim();
  if (/^0x[0-9a-f]+$/i.test(compact)) {
    const sanitized = compact.length <= 128 ? compact : `${compact.slice(0, 66)}...[truncated]`;
    return { value: sanitized, changed: sanitized !== value };
  }
  const redacted = sanitizeDurableRpcSummary(compact, 128);
  return { value: redacted, changed: redacted !== value };
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeSubmissionKind(value: unknown): SubmissionKind {
  if (value === undefined || value === null) return "legacy";
  return typeof value === "string" && SUBMISSION_KINDS.has(value as SubmissionKind)
    ? (value as SubmissionKind)
    : "unsupported";
}

function normalizeTransactionType(value: unknown, fallback: TransactionType): TransactionType {
  if (value === undefined || value === null) return fallback;
  return typeof value === "string" && TRANSACTION_TYPES.has(value as TransactionType)
    ? (value as TransactionType)
    : "unknown";
}

function normalizeTypedTransactionFields(
  rawValue: Record<string, unknown>,
  fallback: TransactionType,
): TypedTransactionFields {
  return {
    transaction_type: normalizeTransactionType(rawValue.transaction_type, fallback),
    token_contract: stringOrNull(rawValue.token_contract),
    recipient: stringOrNull(rawValue.recipient),
    amount_raw: stringOrNull(rawValue.amount_raw),
    decimals: numberOrNull(rawValue.decimals),
    token_symbol: stringOrNull(rawValue.token_symbol),
    token_name: stringOrNull(rawValue.token_name),
    token_metadata_source: stringOrNull(rawValue.token_metadata_source),
    selector: stringOrNull(rawValue.selector),
    method_name: stringOrNull(rawValue.method_name),
    native_value_wei: stringOrNull(rawValue.native_value_wei),
  };
}

function transactionTypeFallbackForSubmission(kind: SubmissionKind): TransactionType {
  if (kind === "abiWriteCall") return "contractCall";
  return kind === "erc20Transfer" ? "erc20Transfer" : "nativeTransfer";
}

function normalizeTransactionIntent(rawIntent: unknown): HistoryTransactionIntent {
  const intent = objectOrEmpty(rawIntent);
  return {
    ...normalizeTypedTransactionFields(intent, "nativeTransfer"),
    rpc_url: stringOrNull(intent.rpc_url),
    account_index: numberOrNull(intent.account_index),
    chain_id: numberOrNull(intent.chain_id),
    from: stringOrNull(intent.from),
    to: stringOrNull(intent.to),
    value_wei: stringOrNull(intent.value_wei),
    nonce: numberOrNull(intent.nonce),
    gas_limit: stringOrNull(intent.gas_limit),
    max_fee_per_gas: stringOrNull(intent.max_fee_per_gas),
    max_priority_fee_per_gas: stringOrNull(intent.max_priority_fee_per_gas),
  };
}

function normalizeOutcomeState(value: unknown): ChainOutcomeState {
  return typeof value === "string" && OUTCOME_STATES.has(value as ChainOutcomeState)
    ? (value as ChainOutcomeState)
    : "Unknown";
}

function normalizeSubmission(rawSubmission: unknown): SubmissionRecord {
  const submission = objectOrEmpty(rawSubmission);
  const kind = normalizeSubmissionKind(submission.kind);
  return {
    ...normalizeTypedTransactionFields(submission, transactionTypeFallbackForSubmission(kind)),
    frozen_key: stringOrDefault(submission.frozen_key),
    tx_hash: stringOrDefault(submission.tx_hash),
    kind,
    source: stringOrDefault(submission.source, LEGACY),
    chain_id: numberOrNull(submission.chain_id),
    account_index: numberOrNull(submission.account_index),
    from: stringOrNull(submission.from),
    to: stringOrNull(submission.to),
    value_wei: stringOrNull(submission.value_wei),
    nonce: numberOrNull(submission.nonce),
    gas_limit: stringOrNull(submission.gas_limit),
    max_fee_per_gas: stringOrNull(submission.max_fee_per_gas),
    max_priority_fee_per_gas: stringOrNull(submission.max_priority_fee_per_gas),
    broadcasted_at: stringOrNull(submission.broadcasted_at),
    replaces_tx_hash: stringOrNull(submission.replaces_tx_hash),
  };
}

function normalizeReceipt(rawReceipt: unknown): ReceiptSummary | null {
  if (rawReceipt == null) return null;
  const receipt = objectOrEmpty(rawReceipt);
  return {
    status: numberOrNull(receipt.status),
    block_number: numberOrNull(receipt.block_number),
    block_hash: stringOrNull(receipt.block_hash),
    transaction_index: numberOrNull(receipt.transaction_index),
    gas_used: stringOrNull(receipt.gas_used),
    effective_gas_price: stringOrNull(receipt.effective_gas_price),
  };
}

function normalizeReconcileSummary(rawSummary: unknown): ReconcileSummary | null {
  if (rawSummary == null) return null;
  const summary = objectOrEmpty(rawSummary);
  return {
    source: stringOrDefault(summary.source, LEGACY),
    checked_at: stringOrNull(summary.checked_at),
    rpc_chain_id: numberOrNull(summary.rpc_chain_id),
    latest_confirmed_nonce: numberOrNull(summary.latest_confirmed_nonce),
    decision: stringOrDefault(summary.decision),
  };
}

function normalizeErrorSummary(rawSummary: unknown): HistoryErrorSummary | null {
  if (rawSummary == null) return null;
  const summary = objectOrEmpty(rawSummary);
  return {
    source: stringOrDefault(summary.source, LEGACY),
    category: stringOrDefault(summary.category),
    message: stringOrDefault(summary.message),
  };
}

function normalizeDroppedReview(rawReview: unknown): DroppedReviewSummary {
  const review = objectOrEmpty(rawReview);
  const localState = normalizeOutcomeState(review.local_same_nonce_state);
  return {
    reviewed_at: stringOrNull(review.reviewed_at),
    source: stringOrDefault(review.source, LEGACY),
    tx_hash: stringOrDefault(review.tx_hash),
    rpc_endpoint_summary: stringOrDefault(review.rpc_endpoint_summary),
    requested_chain_id: numberOrNull(review.requested_chain_id),
    rpc_chain_id: numberOrNull(review.rpc_chain_id),
    latest_confirmed_nonce: numberOrNull(review.latest_confirmed_nonce),
    transaction_found: booleanOrNull(review.transaction_found),
    local_same_nonce_tx_hash: stringOrNull(review.local_same_nonce_tx_hash),
    local_same_nonce_state: localState === "Unknown" ? null : localState,
    original_state: normalizeOutcomeState(review.original_state),
    original_finalized_at: stringOrNull(review.original_finalized_at),
    original_reconciled_at: stringOrNull(review.original_reconciled_at),
    original_reconcile_summary: normalizeReconcileSummary(review.original_reconcile_summary),
    result_state: normalizeOutcomeState(review.result_state),
    receipt: normalizeReceipt(review.receipt),
    decision: stringOrDefault(review.decision),
    recommendation: stringOrDefault(review.recommendation),
    error_summary: normalizeErrorSummary(review.error_summary),
  };
}

function normalizeDroppedReviews(rawReviews: unknown): DroppedReviewSummary[] {
  return Array.isArray(rawReviews) ? rawReviews.map(normalizeDroppedReview) : [];
}

function normalizeOutcome(rawOutcome: unknown): ChainOutcome {
  const outcome = objectOrEmpty(rawOutcome);
  return {
    state: normalizeOutcomeState(outcome.state),
    tx_hash: stringOrDefault(outcome.tx_hash),
    receipt: normalizeReceipt(outcome.receipt),
    finalized_at: stringOrNull(outcome.finalized_at),
    reconciled_at: stringOrNull(outcome.reconciled_at),
    reconcile_summary: normalizeReconcileSummary(outcome.reconcile_summary),
    error_summary: normalizeErrorSummary(outcome.error_summary),
    dropped_review_history: normalizeDroppedReviews(outcome.dropped_review_history),
  };
}

function normalizeNonceThread(rawNonceThread: unknown): NonceThread {
  const nonceThread = objectOrEmpty(rawNonceThread);
  return {
    source: stringOrDefault(nonceThread.source, LEGACY),
    key: stringOrDefault(nonceThread.key),
    chain_id: numberOrNull(nonceThread.chain_id),
    account_index: numberOrNull(nonceThread.account_index),
    from: stringOrNull(nonceThread.from),
    nonce: numberOrNull(nonceThread.nonce),
    replaces_tx_hash: stringOrNull(nonceThread.replaces_tx_hash),
    replaced_by_tx_hash: stringOrNull(nonceThread.replaced_by_tx_hash),
  };
}

function normalizeBatchKind(value: unknown): BatchHistoryMetadata["batch_kind"] {
  return value === "distribute" || value === "collect" ? value : "unknown";
}

function normalizeBatchAssetKind(value: unknown): BatchHistoryMetadata["asset_kind"] {
  return value === "native" || value === "erc20" ? value : "unknown";
}

function normalizeBatchTargetKind(value: unknown): BatchRecipientAllocation["target_kind"] {
  return value === "localAccount" || value === "externalAddress" ? value : "unknown";
}

function normalizeBatchRecipientAllocation(rawAllocation: unknown): BatchRecipientAllocation {
  const allocation = objectOrEmpty(rawAllocation);
  return {
    child_id: stringOrDefault(allocation.child_id ?? allocation.childId),
    child_index: numberOrNull(allocation.child_index ?? allocation.childIndex) ?? 0,
    target_kind: normalizeBatchTargetKind(allocation.target_kind ?? allocation.targetKind),
    target_address: stringOrDefault(allocation.target_address ?? allocation.targetAddress),
    value_wei: stringOrDefault(allocation.value_wei ?? allocation.valueWei),
    amount_raw: stringOrNull(allocation.amount_raw ?? allocation.amountRaw),
  };
}

function normalizeBatchRecipientAllocations(rawAllocations: unknown): BatchRecipientAllocation[] {
  return Array.isArray(rawAllocations)
    ? rawAllocations.map(normalizeBatchRecipientAllocation)
    : [];
}

export function normalizeBatchMetadata(rawMetadata: unknown): BatchHistoryMetadata | null {
  if (rawMetadata == null) return null;
  const metadata = objectOrEmpty(rawMetadata);
  return {
    batch_id: stringOrDefault(metadata.batch_id ?? metadata.batchId),
    child_id: stringOrDefault(metadata.child_id ?? metadata.childId),
    batch_kind: normalizeBatchKind(metadata.batch_kind ?? metadata.batchKind),
    asset_kind: normalizeBatchAssetKind(metadata.asset_kind ?? metadata.assetKind),
    child_index: numberOrNull(metadata.child_index ?? metadata.childIndex),
    freeze_key: stringOrNull(metadata.freeze_key ?? metadata.freezeKey),
    child_count: numberOrNull(metadata.child_count ?? metadata.childCount),
    contract_address: stringOrNull(metadata.contract_address ?? metadata.contractAddress),
    selector: stringOrNull(metadata.selector),
    method_name: stringOrNull(metadata.method_name ?? metadata.methodName),
    total_value_wei: stringOrNull(metadata.total_value_wei ?? metadata.totalValueWei),
    token_contract: stringOrNull(metadata.token_contract ?? metadata.tokenContract),
    decimals: numberOrNull(metadata.decimals),
    token_symbol: stringOrNull(metadata.token_symbol ?? metadata.tokenSymbol),
    token_name: stringOrNull(metadata.token_name ?? metadata.tokenName),
    token_metadata_source: stringOrNull(metadata.token_metadata_source ?? metadata.tokenMetadataSource),
    total_amount_raw: stringOrNull(metadata.total_amount_raw ?? metadata.totalAmountRaw),
    recipients: normalizeBatchRecipientAllocations(metadata.recipients),
  };
}

function normalizeAbiIntentKind(value: unknown): AbiCallHistoryMetadata["intent_kind"] {
  return value === "abiWriteCall" ? value : "unknown";
}

function normalizeAbiStatusLevel(value: unknown): AbiCallStatusSummary["level"] {
  return value === "info" || value === "warning" || value === "blocking" ? value : "unknown";
}

function normalizeAbiStatusSummary(rawStatus: unknown): AbiCallStatusSummary {
  const status = objectOrEmpty(rawStatus);
  return {
    level: normalizeAbiStatusLevel(status.level),
    code: stringOrDefault(status.code),
    message: sanitizeDurableRpcSummary(status.message, 256),
    source: stringOrNull(status.source),
  };
}

function normalizeAbiStatusSummaries(rawStatuses: unknown): AbiCallStatusSummary[] {
  return Array.isArray(rawStatuses) ? rawStatuses.slice(0, 32).map(normalizeAbiStatusSummary) : [];
}

function normalizeAbiDecodedFieldSummary(
  rawField: unknown,
  depth: number,
): AbiDecodedFieldHistorySummary {
  const field = objectOrEmpty(rawField);
  return {
    name: boundedStringOrNull(field.name, 96),
    value: normalizeAbiDecodedValueSummary(field.value, depth + 1),
  };
}

function normalizeAbiDecodedValueSummary(
  rawValue: unknown,
  depth = 0,
): AbiDecodedValueHistorySummary {
  const value = objectOrEmpty(rawValue);
  const rawItems = Array.isArray(value.items) && depth < 4 ? value.items : [];
  const rawFields = Array.isArray(value.fields) && depth < 4 ? value.fields : [];
  const items = rawItems.slice(0, 16).map((item) => normalizeAbiDecodedValueSummary(item, depth + 1));
  const fields = rawFields.slice(0, 16).map((field) => normalizeAbiDecodedFieldSummary(field, depth + 1));
  const wasTrimmed = rawItems.length > items.length || rawFields.length > fields.length || depth >= 4;
  const kind = sanitizeAbiSummaryToken(value.kind);
  const type = sanitizeAbiSummaryToken(value.type);
  const hash = sanitizeAbiSummaryHash(value.hash);
  const summaryValue = sanitizeDurableRpcSummary(value.value, 256);
  return {
    kind: kind.value,
    type: type.value,
    value: summaryValue,
    byte_length: numberOrNull(value.byte_length ?? value.byteLength),
    hash: hash.value,
    items,
    fields,
    truncated: Boolean(
      (booleanOrNull(value.truncated) ?? false) ||
        wasTrimmed ||
        kind.changed ||
        type.changed ||
        hash.changed ||
        summaryValue !== boundedStringOrNull(value.value, 256),
    ),
  };
}

function normalizeAbiDecodedValueSummaries(rawValues: unknown): AbiDecodedValueHistorySummary[] {
  return Array.isArray(rawValues)
    ? rawValues.slice(0, 32).map((value) => normalizeAbiDecodedValueSummary(value))
    : [];
}

function normalizeAbiSelectedRpcSummary(rawRpc: unknown): AbiCallSelectedRpcSummary | null {
  if (rawRpc == null) return null;
  const rpc = objectOrEmpty(rawRpc);
  return {
    chain_id: numberOrNull(rpc.chain_id ?? rpc.chainId),
    provider_config_id: stringOrNull(rpc.provider_config_id ?? rpc.providerConfigId),
    endpoint_id: stringOrNull(rpc.endpoint_id ?? rpc.endpointId),
    endpoint_name: sanitizeDurableRpcSummary(rpc.endpoint_name ?? rpc.endpointName, 120),
    endpoint_summary: sanitizeDurableRpcSummary(rpc.endpoint_summary ?? rpc.endpointSummary, 200),
    endpoint_fingerprint: stringOrNull(rpc.endpoint_fingerprint ?? rpc.endpointFingerprint),
  };
}

function normalizeAbiCalldataSummary(rawCalldata: unknown): AbiCallCalldataSummary | null {
  if (rawCalldata == null) return null;
  const calldata = objectOrEmpty(rawCalldata);
  return {
    selector: stringOrNull(calldata.selector),
    byte_length: numberOrNull(calldata.byte_length ?? calldata.byteLength),
    hash: stringOrNull(calldata.hash),
  };
}

function normalizeAbiSubmissionPlaceholder(rawPlaceholder: unknown): AbiCallSubmissionPlaceholder | null {
  if (rawPlaceholder == null) return null;
  const placeholder = objectOrEmpty(rawPlaceholder);
  return {
    status: stringOrNull(placeholder.status),
    tx_hash: stringOrNull(placeholder.tx_hash ?? placeholder.txHash),
    submitted_at: stringOrNull(placeholder.submitted_at ?? placeholder.submittedAt),
    broadcasted_at: stringOrNull(placeholder.broadcasted_at ?? placeholder.broadcastedAt),
    error_summary: sanitizeDurableRpcSummary(placeholder.error_summary ?? placeholder.errorSummary, 256),
  };
}

function normalizeAbiOutcomePlaceholder(rawPlaceholder: unknown): AbiCallOutcomePlaceholder | null {
  if (rawPlaceholder == null) return null;
  const placeholder = objectOrEmpty(rawPlaceholder);
  const state = normalizeOutcomeState(placeholder.state);
  return {
    state: state === "Unknown" ? null : state,
    checked_at: stringOrNull(placeholder.checked_at ?? placeholder.checkedAt),
    receipt_status: numberOrNull(placeholder.receipt_status ?? placeholder.receiptStatus),
    block_number: numberOrNull(placeholder.block_number ?? placeholder.blockNumber),
    gas_used: stringOrNull(placeholder.gas_used ?? placeholder.gasUsed),
    error_summary: sanitizeDurableRpcSummary(placeholder.error_summary ?? placeholder.errorSummary, 256),
  };
}

function normalizeAbiBroadcastPlaceholder(rawPlaceholder: unknown): AbiCallBroadcastPlaceholder | null {
  if (rawPlaceholder == null) return null;
  const placeholder = objectOrEmpty(rawPlaceholder);
  return {
    tx_hash: stringOrNull(placeholder.tx_hash ?? placeholder.txHash),
    broadcasted_at: stringOrNull(placeholder.broadcasted_at ?? placeholder.broadcastedAt),
    rpc_chain_id: numberOrNull(placeholder.rpc_chain_id ?? placeholder.rpcChainId),
    rpc_endpoint_summary: sanitizeDurableRpcSummary(placeholder.rpc_endpoint_summary ?? placeholder.rpcEndpointSummary, 200),
    error_summary: sanitizeDurableRpcSummary(placeholder.error_summary ?? placeholder.errorSummary, 256),
  };
}

function normalizeAbiRecoveryPlaceholder(rawPlaceholder: unknown): AbiCallRecoveryPlaceholder | null {
  if (rawPlaceholder == null) return null;
  const placeholder = objectOrEmpty(rawPlaceholder);
  return {
    recovery_id: stringOrNull(placeholder.recovery_id ?? placeholder.recoveryId),
    status: stringOrNull(placeholder.status),
    created_at: stringOrNull(placeholder.created_at ?? placeholder.createdAt),
    recovered_at: stringOrNull(placeholder.recovered_at ?? placeholder.recoveredAt),
    last_error: sanitizeDurableRpcSummary(placeholder.last_error ?? placeholder.lastError, 256),
    replacement_tx_hash: stringOrNull(placeholder.replacement_tx_hash ?? placeholder.replacementTxHash),
  };
}

export function normalizeAbiCallMetadata(rawMetadata: unknown): AbiCallHistoryMetadata | null {
  if (rawMetadata == null) return null;
  const metadata = objectOrEmpty(rawMetadata);
  return {
    intent_kind: normalizeAbiIntentKind(metadata.intent_kind ?? metadata.intentKind),
    draft_id: stringOrNull(metadata.draft_id ?? metadata.draftId),
    created_at: stringOrNull(metadata.created_at ?? metadata.createdAt),
    chain_id: numberOrNull(metadata.chain_id ?? metadata.chainId),
    account_index: numberOrNull(metadata.account_index ?? metadata.accountIndex),
    from: stringOrNull(metadata.from),
    contract_address: stringOrNull(metadata.contract_address ?? metadata.contractAddress),
    source_kind: stringOrDefault(metadata.source_kind ?? metadata.sourceKind),
    provider_config_id: stringOrNull(metadata.provider_config_id ?? metadata.providerConfigId),
    user_source_id: stringOrNull(metadata.user_source_id ?? metadata.userSourceId),
    version_id: stringOrNull(metadata.version_id ?? metadata.versionId),
    abi_hash: stringOrNull(metadata.abi_hash ?? metadata.abiHash),
    source_fingerprint: stringOrNull(metadata.source_fingerprint ?? metadata.sourceFingerprint),
    function_signature: stringOrNull(metadata.function_signature ?? metadata.functionSignature),
    selector: stringOrNull(metadata.selector),
    argument_summary: normalizeAbiDecodedValueSummaries(metadata.argument_summary ?? metadata.argumentSummary),
    argument_hash: stringOrNull(metadata.argument_hash ?? metadata.argumentHash),
    native_value_wei: stringOrNull(metadata.native_value_wei ?? metadata.nativeValueWei),
    gas_limit: stringOrNull(metadata.gas_limit ?? metadata.gasLimit),
    max_fee_per_gas: stringOrNull(metadata.max_fee_per_gas ?? metadata.maxFeePerGas),
    max_priority_fee_per_gas: stringOrNull(metadata.max_priority_fee_per_gas ?? metadata.maxPriorityFeePerGas),
    nonce: numberOrNull(metadata.nonce),
    selected_rpc: normalizeAbiSelectedRpcSummary(metadata.selected_rpc ?? metadata.selectedRpc),
    warnings: normalizeAbiStatusSummaries(metadata.warnings),
    blocking_statuses: normalizeAbiStatusSummaries(metadata.blocking_statuses ?? metadata.blockingStatuses),
    calldata: normalizeAbiCalldataSummary(metadata.calldata),
    future_submission: normalizeAbiSubmissionPlaceholder(metadata.future_submission ?? metadata.futureSubmission),
    future_outcome: normalizeAbiOutcomePlaceholder(metadata.future_outcome ?? metadata.futureOutcome),
    broadcast: normalizeAbiBroadcastPlaceholder(metadata.broadcast),
    recovery: normalizeAbiRecoveryPlaceholder(metadata.recovery),
  };
}

export function normalizeHistoryRecord(rawRecord: unknown): HistoryRecord {
  const record = objectOrEmpty(rawRecord);
  const intentSnapshot = objectOrEmpty(record.intent_snapshot);
  return {
    schema_version: numberOrNull(record.schema_version) ?? 1,
    intent: normalizeTransactionIntent(record.intent),
    intent_snapshot: {
      source: stringOrDefault(intentSnapshot.source, LEGACY),
      captured_at: stringOrNull(intentSnapshot.captured_at),
    },
    submission: normalizeSubmission(record.submission),
    outcome: normalizeOutcome(record.outcome),
    nonce_thread: normalizeNonceThread(record.nonce_thread),
    batch_metadata: normalizeBatchMetadata(record.batch_metadata ?? record.batchMetadata),
    abi_call_metadata: normalizeAbiCallMetadata(record.abi_call_metadata ?? record.abiCallMetadata),
  };
}

export function normalizeHistoryRecords(rawRecords: unknown): HistoryRecord[] {
  return Array.isArray(rawRecords) ? rawRecords.map(normalizeHistoryRecord) : [];
}

export function parseTransactionHistoryPayload(raw: string): HistoryRecord[] {
  return normalizeHistoryRecords(JSON.parse(raw));
}
