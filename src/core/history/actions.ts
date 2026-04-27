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

function mismatchesFrozenSubmission(
  entry: HistoryReadModel,
  field: "chainId" | "accountIndex" | "from" | "nonce",
) {
  const { submission, nonce_thread: nonceThread } = entry.record;
  if (nonceThread.source === "legacy") return false;
  switch (field) {
    case "chainId":
      return nonceThread.chain_id !== null && submission.chain_id !== null && nonceThread.chain_id !== submission.chain_id;
    case "accountIndex":
      return nonceThread.account_index !== null && submission.account_index !== null && nonceThread.account_index !== submission.account_index;
    case "from":
      return nonceThread.from !== null && submission.from !== null && lower(nonceThread.from) !== lower(submission.from);
    case "nonce":
      return nonceThread.nonce !== null && submission.nonce !== null && nonceThread.nonce !== submission.nonce;
  }
}

function firstMissingMutationField(entry: HistoryReadModel) {
  const { intent, submission } = entry.record;
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
  if (mismatchesFrozenSubmission(entry, "chainId")) {
    return "Disabled because frozen submission and nonce thread have conflicting chainId values.";
  }
  if (mismatchesFrozenSubmission(entry, "accountIndex") || mismatchesFrozenSubmission(entry, "from")) {
    return "Disabled because frozen submission and nonce thread have conflicting account values.";
  }
  if (mismatchesFrozenSubmission(entry, "nonce")) {
    return "Disabled because frozen submission and nonce thread have conflicting nonce values.";
  }
  if (!hasText(intent.rpc_url)) return "Missing RPC endpoint.";
  if (!hasNumber(submission.chain_id)) return "Missing frozen submission chainId.";
  if (!hasNumber(submission.account_index)) return "Missing frozen submission account.";
  if (!hasText(submission.from)) return "Missing frozen submission from address.";
  if (!hasNumber(submission.nonce)) return "Missing frozen submission nonce.";
  if (!hasText(submission.gas_limit)) return "Missing frozen submission gas limit.";
  if (!hasText(submission.max_fee_per_gas) || !hasText(submission.max_priority_fee_per_gas)) return "Missing frozen submission fee fields.";
  if (!hasText(submission.to)) return "Missing frozen submission destination.";
  if (!hasText(submission.value_wei)) return "Missing frozen submission value.";
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

function firstMissingDroppedReviewField(entry: HistoryReadModel) {
  const { submission } = entry.record;
  if (hasHistoryStorageError(entry)) {
    return "Disabled while local history storage is reporting read/write failures.";
  }
  if (!hasKnownTxHash(entry.txHash) || !hasKnownTxHash(submission.tx_hash)) {
    return "Missing frozen submission transaction hash.";
  }
  if (!hasNumber(submission.chain_id)) return "Missing frozen submission chainId.";
  if (!hasNumber(submission.account_index)) return "Missing frozen submission account.";
  if (!hasText(submission.from)) return "Missing frozen submission from address.";
  if (!hasNumber(submission.nonce)) return "Missing frozen submission nonce.";
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
  const droppedReviewReason = firstMissingDroppedReviewField(entry);
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
      label: "Review dropped",
      visible: entry.status === "dropped",
      enabled: entry.status === "dropped" && droppedReviewReason === null,
      reason:
        droppedReviewReason ??
        "Review uses the frozen submission chainId, account, nonce, and transaction hash against the selected RPC.",
    },
  ];
  return actions.filter((action) => action.visible);
}
