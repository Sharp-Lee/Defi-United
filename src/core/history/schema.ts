export type ChainOutcomeState =
  | "Pending"
  | "Confirmed"
  | "Failed"
  | "Replaced"
  | "Cancelled"
  | "Dropped"
  | "Unknown";

export type SubmissionKind = "legacy" | "nativeTransfer" | "replacement" | "cancellation";

export interface NativeTransferIntent {
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

export interface IntentSnapshotMetadata {
  source: string;
  captured_at: string | null;
}

export interface SubmissionRecord {
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

export interface ChainOutcome {
  state: ChainOutcomeState;
  tx_hash: string;
  receipt: ReceiptSummary | null;
  finalized_at: string | null;
  reconciled_at: string | null;
  reconcile_summary: ReconcileSummary | null;
  error_summary: HistoryErrorSummary | null;
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
  intent: NativeTransferIntent;
  intent_snapshot: IntentSnapshotMetadata;
  submission: SubmissionRecord;
  outcome: ChainOutcome;
  nonce_thread: NonceThread;
}

const LEGACY = "legacy";
const UNKNOWN = "unknown";
const SUBMISSION_KINDS = new Set<SubmissionKind>([
  "legacy",
  "nativeTransfer",
  "replacement",
  "cancellation",
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

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeSubmissionKind(value: unknown): SubmissionKind {
  return typeof value === "string" && SUBMISSION_KINDS.has(value as SubmissionKind)
    ? (value as SubmissionKind)
    : "legacy";
}

function normalizeOutcomeState(value: unknown): ChainOutcomeState {
  return typeof value === "string" && OUTCOME_STATES.has(value as ChainOutcomeState)
    ? (value as ChainOutcomeState)
    : "Unknown";
}

function normalizeSubmission(rawSubmission: unknown): SubmissionRecord {
  const submission = objectOrEmpty(rawSubmission);
  return {
    frozen_key: stringOrDefault(submission.frozen_key),
    tx_hash: stringOrDefault(submission.tx_hash),
    kind: normalizeSubmissionKind(submission.kind),
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
    intent: record.intent as NativeTransferIntent,
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
