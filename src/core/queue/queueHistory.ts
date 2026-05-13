import { getAddress, isAddress } from "ethers/address";
import { sanitizeQueueMessage, summarizeCalldata } from "./queueRedaction";
import type {
  QueueActionType,
  QueueErrorCategory,
  QueueExecutionError,
  QueueExecutionPolicy,
  QueueFeeSummary,
  QueueHistoryState,
  QueueJobRecord,
  QueueJobStatus,
  QueueJobSummary,
  QueueSourceModule,
  QueueTransactionRecord,
  QueueTransactionStatus,
  RedactedCalldataSummary,
} from "./queueTypes";

export const QUEUE_HISTORY_SCHEMA_VERSION = 1;
const INVALID_QUEUE_HISTORY = "Invalid queue history state.";

const JOB_STATUSES = new Set<QueueJobStatus>([
  "draft",
  "queued",
  "running",
  "stopping",
  "stopped",
  "completed",
  "partial",
  "failed",
]);
const TRANSACTION_STATUSES = new Set<QueueTransactionStatus>([
  "draft",
  "queued",
  "nonce-ready",
  "signing",
  "broadcasting",
  "pending",
  "failed",
  "skipped",
  "stopped",
]);
const SOURCE_MODULES = new Set<QueueSourceModule>(["queue", "distribution", "inscription", "contract-call", "reverse-parse"]);
const ACTION_TYPES = new Set<QueueActionType>([
  "native-transfer",
  "erc20-transfer",
  "contract-call",
  "raw-calldata",
  "approval",
  "unknown",
]);
const ERROR_CATEGORIES = new Set<QueueErrorCategory>([
  "chain-mismatch",
  "no-rpc",
  "vault-locked",
  "account-not-found",
  "nonce-load-failed",
  "session-drafts-unavailable",
  "signing-failed",
  "broadcast-failed",
  "rpc-rate-limited",
  "user-stopped",
  "nonce-consumed",
  "unknown",
]);
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const NON_NEGATIVE_INTEGER_STRING_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const NON_NEGATIVE_DECIMAL_STRING_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function nowIso() {
  return new Date().toISOString();
}

function assertIso(value: string) {
  if (value.trim() !== value || value.length === 0) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
}

function assertPlainString(value: string) {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  return value;
}

function assertSafeId(value: string) {
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  return value;
}

function assertNonNegativeIntegerString(value: string) {
  if (!NON_NEGATIVE_INTEGER_STRING_PATTERN.test(value)) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  return value;
}

function assertNonNegativeDecimalString(value: string) {
  if (!NON_NEGATIVE_DECIMAL_STRING_PATTERN.test(value)) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  return value;
}

function normalizeAddress(value: string) {
  const trimmed = value.trim();
  if (!isAddress(trimmed)) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  return getAddress(trimmed);
}

function normalizeAddressOrNull(value: string | null) {
  if (typeof value !== "string" && value !== null) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  if (value === null) return null;
  return normalizeAddress(value);
}

function validateStringArray(values: string[]) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !SAFE_ID_PATTERN.test(value))) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  return values;
}

function validateSummary(summary: QueueJobSummary): QueueJobSummary {
  if (
    typeof summary !== "object" ||
    summary === null ||
    !Number.isInteger(summary.total) ||
    !Number.isInteger(summary.pending) ||
    !Number.isInteger(summary.failed) ||
    !Number.isInteger(summary.stopped) ||
    !Number.isInteger(summary.completed) ||
    summary.total < 0 ||
    summary.pending < 0 ||
    summary.failed < 0 ||
    summary.stopped < 0 ||
    summary.completed < 0
  ) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  return {
    total: summary.total,
    pending: summary.pending,
    failed: summary.failed,
    stopped: summary.stopped,
    completed: summary.completed,
  };
}

function validateCalldataSummary(summary: RedactedCalldataSummary): RedactedCalldataSummary {
  if (
    typeof summary !== "object" ||
    summary === null ||
    (summary.selector !== null && !/^0x[0-9a-fA-F]{8}$/.test(summary.selector)) ||
    !Number.isInteger(summary.byteLength) ||
    summary.byteLength < 0 ||
    typeof summary.summary !== "string" ||
    summary.summary.length === 0
  ) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  return {
    selector: summary.selector === null ? null : summary.selector.toLowerCase(),
    byteLength: summary.byteLength,
    summary: sanitizeQueueMessage(summary.summary),
  };
}

function validateFeeSummary(feeSummary: QueueFeeSummary): QueueFeeSummary {
  if (typeof feeSummary !== "object" || feeSummary === null || typeof feeSummary.gasLimit !== "string") {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  if (feeSummary.mode === "eip1559") {
    if (typeof feeSummary.maxFeePerGasGwei !== "string" || typeof feeSummary.maxPriorityFeePerGasGwei !== "string") {
      throw new Error(INVALID_QUEUE_HISTORY);
    }
    return {
      mode: "eip1559",
      gasLimit: assertNonNegativeIntegerString(feeSummary.gasLimit),
      maxFeePerGasGwei: assertNonNegativeDecimalString(feeSummary.maxFeePerGasGwei),
      maxPriorityFeePerGasGwei: assertNonNegativeDecimalString(feeSummary.maxPriorityFeePerGasGwei),
    };
  }
  if (feeSummary.mode === "legacy") {
    if (typeof feeSummary.gasPriceGwei !== "string") {
      throw new Error(INVALID_QUEUE_HISTORY);
    }
    return {
      mode: "legacy",
      gasLimit: assertNonNegativeIntegerString(feeSummary.gasLimit),
      gasPriceGwei: assertNonNegativeDecimalString(feeSummary.gasPriceGwei),
    };
  }
  throw new Error(INVALID_QUEUE_HISTORY);
}

function validateQueueError(error: QueueExecutionError): QueueExecutionError {
  if (
    typeof error !== "object" ||
    error === null ||
    !ERROR_CATEGORIES.has(error.category) ||
    typeof error.message !== "string" ||
    typeof error.retryable !== "boolean"
  ) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  return {
    category: error.category,
    message: sanitizeQueueMessage(error.message),
    retryable: error.retryable,
  };
}

export function createDefaultQueuePolicy(): QueueExecutionPolicy {
  return {
    concurrency: 20,
    continueOnFailure: true,
    rerunFromFailedNonce: true,
    rpcRequestsPerSecond: 20,
    walletIntervalMs: 0,
  };
}

export function createDefaultQueueHistoryState(): QueueHistoryState {
  return {
    schemaVersion: QUEUE_HISTORY_SCHEMA_VERSION,
    updatedAt: nowIso(),
    jobs: [],
    transactions: [],
  };
}

function validatePolicy(policy: QueueExecutionPolicy): QueueExecutionPolicy {
  if (
    typeof policy !== "object" ||
    policy === null ||
    !Number.isInteger(policy.concurrency) ||
    policy.concurrency < 1 ||
    policy.concurrency > 100 ||
    !Number.isInteger(policy.walletIntervalMs) ||
    policy.walletIntervalMs < 0 ||
    policy.walletIntervalMs > 60_000 ||
    !Number.isInteger(policy.rpcRequestsPerSecond) ||
    policy.rpcRequestsPerSecond < 1 ||
    policy.rpcRequestsPerSecond > 500 ||
    typeof policy.continueOnFailure !== "boolean" ||
    typeof policy.rerunFromFailedNonce !== "boolean"
  ) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  return {
    concurrency: policy.concurrency,
    continueOnFailure: policy.continueOnFailure,
    rerunFromFailedNonce: policy.rerunFromFailedNonce,
    rpcRequestsPerSecond: policy.rpcRequestsPerSecond,
    walletIntervalMs: policy.walletIntervalMs,
  };
}

function validateJob(job: QueueJobRecord): QueueJobRecord {
  if (
    typeof job !== "object" ||
    job === null ||
    typeof job.id !== "string" ||
    typeof job.chainId !== "number" ||
    !Number.isInteger(job.chainId) ||
    job.chainId <= 0 ||
    typeof job.title !== "string" ||
    !SOURCE_MODULES.has(job.sourceModule) ||
    !JOB_STATUSES.has(job.status) ||
    typeof job.createdAt !== "string" ||
    typeof job.updatedAt !== "string" ||
    !Array.isArray(job.transactionIds)
  ) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  assertIso(job.createdAt);
  assertIso(job.updatedAt);
  return {
    id: assertSafeId(job.id),
    chainId: job.chainId,
    title: sanitizeQueueMessage(assertPlainString(job.title)),
    sourceModule: job.sourceModule,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    executionPolicy: validatePolicy(job.executionPolicy),
    transactionIds: validateStringArray(job.transactionIds),
    summary: validateSummary(job.summary),
  };
}

function validateTransaction(record: QueueTransactionRecord): QueueTransactionRecord {
  if (
    typeof record !== "object" ||
    record === null ||
    typeof record.id !== "string" ||
    typeof record.jobId !== "string" ||
    typeof record.chainId !== "number" ||
    !Number.isInteger(record.chainId) ||
    record.chainId <= 0 ||
    typeof record.accountId !== "string" ||
    typeof record.accountAddress !== "string" ||
    (record.nonce !== null && (!Number.isInteger(record.nonce) || record.nonce < 0)) ||
    !TRANSACTION_STATUSES.has(record.status) ||
    !ACTION_TYPES.has(record.actionType) ||
    typeof record.valueWei !== "string" ||
    (typeof record.txHash !== "string" && record.txHash !== null) ||
    (record.txHash !== null && !TX_HASH_PATTERN.test(record.txHash)) ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    (record.retryOfTransactionId !== undefined &&
      record.retryOfTransactionId !== null &&
      (typeof record.retryOfTransactionId !== "string" || !SAFE_ID_PATTERN.test(record.retryOfTransactionId)))
  ) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  assertIso(record.createdAt);
  assertIso(record.updatedAt);
  return {
    id: assertSafeId(record.id),
    jobId: assertSafeId(record.jobId),
    chainId: record.chainId,
    accountId: assertSafeId(record.accountId),
    accountAddress: normalizeAddress(record.accountAddress),
    nonce: record.nonce,
    status: record.status,
    actionType: record.actionType,
    target: normalizeAddressOrNull(record.target),
    valueWei: assertNonNegativeIntegerString(record.valueWei),
    calldataSummary: validateCalldataSummary(record.calldataSummary),
    feeSummary: validateFeeSummary(record.feeSummary),
    txHash: record.txHash,
    error: record.error === null ? null : validateQueueError(record.error),
    retryOfTransactionId:
      record.retryOfTransactionId === undefined || record.retryOfTransactionId === null
        ? record.retryOfTransactionId
        : assertSafeId(record.retryOfTransactionId),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function validateQueueHistoryState(value: unknown): QueueHistoryState {
  if (!value || typeof value !== "object") throw new Error(INVALID_QUEUE_HISTORY);
  const state = value as QueueHistoryState;
  if (
    state.schemaVersion !== QUEUE_HISTORY_SCHEMA_VERSION ||
    typeof state.updatedAt !== "string" ||
    !Array.isArray(state.jobs) ||
    !Array.isArray(state.transactions)
  ) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  assertIso(state.updatedAt);
  return {
    schemaVersion: QUEUE_HISTORY_SCHEMA_VERSION,
    updatedAt: state.updatedAt,
    jobs: state.jobs.map(validateJob),
    transactions: state.transactions.map(validateTransaction),
  };
}

export function appendQueueHistoryRecords(
  state: QueueHistoryState,
  records: { jobs: QueueJobRecord[]; transactions: QueueTransactionRecord[] },
): QueueHistoryState {
  const current = validateQueueHistoryState(state);
  return validateQueueHistoryState({
    schemaVersion: QUEUE_HISTORY_SCHEMA_VERSION,
    updatedAt: nowIso(),
    jobs: [...current.jobs, ...records.jobs],
    transactions: [...current.transactions, ...records.transactions],
  });
}

export function createQueueTransactionRecord(input: Omit<QueueTransactionRecord, "calldataSummary"> & { data: string }) {
  const { data, ...record } = input;
  return validateTransaction({
    ...record,
    calldataSummary: summarizeCalldata(data),
  });
}

export function exportRedactedQueueHistory(state: QueueHistoryState) {
  return JSON.stringify(validateQueueHistoryState(state), null, 2);
}
