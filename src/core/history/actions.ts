import type { HistoryReadModel, HistoryIdentityIssue } from "./selectors";

export type HistoryActionKind = "reconcile" | "replace" | "cancel" | "droppedReview";

export interface HistoryActionGate {
  kind: HistoryActionKind;
  label: string;
  visible: boolean;
  enabled: boolean;
  reason: string;
}

const UNKNOWN_TX_HASH = "unknown";

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasKnownTxHash(value: string | null | undefined) {
  return hasText(value) && value !== UNKNOWN_TX_HASH;
}

function lower(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function errorText(entry: HistoryReadModel) {
  const error = entry.record.outcome.error_summary;
  return `${lower(error?.source)} ${lower(error?.category)} ${lower(error?.message)}`;
}

function hasHistoryStorageError(entry: HistoryReadModel) {
  const text = errorText(entry);
  return ["history", "storage", "persist", "write", "read"].some((needle) => text.includes(needle));
}

function hasRpcError(entry: HistoryReadModel) {
  const text = errorText(entry);
  return ["rpc", "provider", "transport", "timeout", "connection", "unavailable", "network"].some((needle) =>
    text.includes(needle),
  );
}

function hasNonceConflict(entry: HistoryReadModel) {
  const text = errorText(entry);
  return ["replacement underpriced", "nonce conflict", "nonce too low", "same nonce", "already known"].some((needle) =>
    text.includes(needle),
  );
}

function hasChainIdentityError(entry: HistoryReadModel) {
  const text = errorText(entry);
  return ["chainid", "chain id", "wrong chain", "chain mismatch"].some((needle) => text.includes(needle));
}

function hasIssue(issues: HistoryIdentityIssue[], field: HistoryIdentityIssue["field"], kind?: HistoryIdentityIssue["kind"]) {
  return issues.some((issue) => issue.field === field && (kind === undefined || issue.kind === kind));
}

function firstMissingMutationField(entry: HistoryReadModel) {
  const { intent } = entry.record;
  if (
    entry.submissionKind === "legacy" ||
    entry.record.submission.source === "legacy" ||
    entry.record.nonce_thread.source === "legacy" ||
    entry.identitySource === "intent"
  ) {
    return "Legacy history record lacks frozen submission identity for replace/cancel.";
  }
  if (hasHistoryStorageError(entry)) {
    return "Disabled while local history storage is reporting read/write failures.";
  }
  if (hasChainIdentityError(entry)) {
    return "Disabled because the RPC chainId does not match this record.";
  }
  if (!hasKnownTxHash(entry.txHash)) return "Missing transaction hash.";
  if (hasIssue(entry.identityIssues, "chainId", "inconsistent")) {
    return "Disabled because record identity has conflicting chainId values.";
  }
  if (hasIssue(entry.identityIssues, "accountIndex", "inconsistent") || hasIssue(entry.identityIssues, "from", "inconsistent")) {
    return "Disabled because record identity has conflicting account values.";
  }
  if (hasIssue(entry.identityIssues, "nonce", "inconsistent")) {
    return "Disabled because record identity has conflicting nonce values.";
  }
  if (!hasNumber(intent.chain_id)) return "Missing chainId.";
  if (!hasNumber(intent.account_index)) return "Missing account.";
  if (!hasText(intent.from)) return "Missing from address.";
  if (!hasNumber(intent.nonce)) return "Missing nonce.";
  if (!hasText(intent.rpc_url)) return "Missing RPC endpoint.";
  if (!hasText(intent.gas_limit)) return "Missing gas limit.";
  if (!hasText(intent.max_fee_per_gas) || !hasText(intent.max_priority_fee_per_gas)) {
    return "Missing fee fields.";
  }
  return null;
}

function firstMissingTraceField(entry: HistoryReadModel) {
  if (hasHistoryStorageError(entry)) {
    return "Disabled while local history storage is reporting read/write failures.";
  }
  if (hasChainIdentityError(entry)) {
    return "Disabled because the RPC chainId does not match this record.";
  }
  if (!hasKnownTxHash(entry.txHash)) return "Missing transaction hash.";
  if (hasIssue(entry.identityIssues, "chainId", "inconsistent")) {
    return "Disabled because record identity has conflicting chainId values.";
  }
  if (hasIssue(entry.identityIssues, "accountIndex", "inconsistent") || hasIssue(entry.identityIssues, "from", "inconsistent")) {
    return "Disabled because record identity has conflicting account values.";
  }
  if (!hasNumber(entry.chainId)) return "Missing chainId.";
  if (entry.account.accountIndex === null || entry.account.normalizedFrom === null) return "Missing account.";
  return null;
}

function isSupersededInThread(entry: HistoryReadModel, entries: HistoryReadModel[]) {
  return (
    entry.replacedByTxHash !== null ||
    entry.status === "replaced" ||
    entry.status === "cancelled" ||
    entries.some((candidate) => candidate.replacesTxHash === entry.txHash)
  );
}

export function isCurrentPendingActionTarget(entry: HistoryReadModel, entries: HistoryReadModel[]) {
  return (
    entry.status === "pending" &&
    entries.some((candidate) => candidate.originalIndex === entry.originalIndex) &&
    !isSupersededInThread(entry, entries)
  );
}

export function getHistoryActionGates(entry: HistoryReadModel, threadEntries: HistoryReadModel[]): HistoryActionGate[] {
  const currentPending = isCurrentPendingActionTarget(entry, threadEntries);
  const traceReason = firstMissingTraceField(entry);
  const mutationReason = firstMissingMutationField(entry);
  const terminalReason = `${entry.status} submissions are terminal and do not support replace/cancel actions.`;
  const reconcileReadyReason = hasRpcError(entry)
    ? "Global refresh/reconcile uses the app's currently selected chain/RPC; the RPC endpoint must be available and on the expected chainId."
    : "Global refresh/reconcile updates tracked history using the app's currently selected chain/RPC, not a single transaction.";
  const mutationReadyReason = hasNonceConflict(entry)
    ? "Nonce conflict recorded; inspect the nonce thread before using the existing replace/cancel path."
    : "Available for the current pending nonce-thread target.";

  const actions: HistoryActionGate[] = [
    {
      kind: "reconcile",
      label: "Global refresh/reconcile",
      visible: entry.status === "pending",
      enabled: entry.status === "pending" && traceReason === null,
      reason: traceReason ?? reconcileReadyReason,
    },
    {
      kind: "replace",
      label: "Replace",
      visible: currentPending,
      enabled: currentPending && mutationReason === null,
      reason: currentPending
        ? mutationReason ?? mutationReadyReason
        : terminalReason,
    },
    {
      kind: "cancel",
      label: "Cancel",
      visible: currentPending,
      enabled: currentPending && mutationReason === null,
      reason: currentPending
        ? mutationReason ?? mutationReadyReason
        : terminalReason,
    },
    {
      kind: "droppedReview",
      label: "P4 Review",
      visible: entry.status === "dropped",
      enabled: false,
      reason: "Dropped records can be reviewed or reconciled manually in P4; P3 only shows this follow-up prompt.",
    },
  ];
  return actions.filter((action) => action.visible);
}
