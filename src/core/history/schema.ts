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

export interface HistoryRecord {
  schema_version: number;
  intent: HistoryTransactionIntent;
  intent_snapshot: IntentSnapshotMetadata;
  submission: SubmissionRecord;
  outcome: ChainOutcome;
  nonce_thread: NonceThread;
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
  };
}

export function normalizeHistoryRecords(rawRecords: unknown): HistoryRecord[] {
  return Array.isArray(rawRecords) ? rawRecords.map(normalizeHistoryRecord) : [];
}

export function parseTransactionHistoryPayload(raw: string): HistoryRecord[] {
  return normalizeHistoryRecords(JSON.parse(raw));
}
