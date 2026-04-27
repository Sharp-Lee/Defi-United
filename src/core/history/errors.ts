import type { HistoryRecord } from "./schema";
import type { HistoryIdentityIssue, HistoryStatus } from "./selectors";

export type HistoryErrorKind =
  | "rpc"
  | "history"
  | "nonce"
  | "broadcast"
  | "reconcile"
  | "chainIdentity"
  | "validation"
  | "unknown";

export interface HistoryErrorDisplay {
  kind: HistoryErrorKind;
  label: string;
  title: string;
  summary: string;
  suggestion: string;
  source: string;
  category: string;
  message: string | null;
}

export interface HistoryErrorInput {
  record: HistoryRecord;
  status: HistoryStatus;
  identityIssues?: HistoryIdentityIssue[];
  nowMs?: number;
}

export interface RawHistoryErrorInput {
  message: string;
  source?: string;
  category?: string;
}

const PENDING_STALE_MS = 30 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 180;

const KIND_LABELS: Record<HistoryErrorKind, string> = {
  rpc: "RPC",
  history: "History",
  nonce: "Nonce",
  broadcast: "Broadcast",
  reconcile: "Reconcile",
  chainIdentity: "Chain identity",
  validation: "Validation",
  unknown: "Unknown",
};

function lower(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function timestampMillis(value: string | null) {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function latestKnownTimestamp(record: HistoryRecord) {
  return (
    timestampMillis(record.outcome.reconciled_at) ??
    timestampMillis(record.submission.broadcasted_at) ??
    timestampMillis(record.intent_snapshot.captured_at)
  );
}

export function sanitizeHistoryErrorMessage(message: string | null | undefined) {
  if (message == null) return null;
  const singleLine = message.replace(/\s+/g, " ").trim();
  if (singleLine.length === 0) return null;
  const redacted = singleLine.replace(/\b0x[a-fA-F0-9]{80,}\b/g, (value) => {
    return `${value.slice(0, 10)}...${value.slice(-8)}`;
  });
  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH - 3)}...`
    : redacted;
}

function classifyErrorText({
  source,
  category,
  message,
  identityIssues = [],
}: {
  source?: string | null;
  category?: string | null;
  message?: string | null;
  identityIssues?: HistoryIdentityIssue[];
}) {
  const rawSource = lower(source);
  const rawCategory = lower(category);
  const rawMessage = lower(message);
  const haystack = `${rawSource} ${rawCategory} ${rawMessage}`;

  if (
    identityIssues.some((issue) => issue.kind === "inconsistent" && issue.field === "chainId") ||
    includesAny(haystack, ["chainid", "chain id", "wrong chain", "chain mismatch"])
  ) {
    return "chainIdentity";
  }

  if (
    includesAny(haystack, [
      "validation",
      "invalid",
      "required",
      "select a sender",
      "amount must",
      "greater than zero",
      "extra confirmation",
      "high-risk fee settings",
    ])
  ) {
    return "validation";
  }

  if (
    includesAny(haystack, [
      "replacement underpriced",
      "nonce too low",
      "nonce too high",
      "nonce conflict",
      "already known",
      "already imported",
      "known transaction",
      "same nonce",
      "underpriced",
    ])
  ) {
    return "nonce";
  }

  if (includesAny(haystack, ["history", "storage", "persist", "write", "read", "parse", "json"])) {
    return "history";
  }

  if (
    includesAny(haystack, [
      "broadcast",
      "sendrawtransaction",
      "send raw transaction",
      "submit",
      "insufficient funds",
      "intrinsic gas",
      "transaction underpriced",
      "fee cap",
    ])
  ) {
    return "broadcast";
  }

  if (
    includesAny(haystack, [
      "rpc",
      "provider",
      "transport",
      "timeout",
      "connection",
      "unavailable",
      "could not connect",
      "network",
    ])
  ) {
    return "rpc";
  }

  if (includesAny(haystack, ["reconcile", "receipt", "dropped", "mempool"])) {
    return "reconcile";
  }

  return haystack.trim().length > 0 ? "unknown" : null;
}

function isBroadcastHistoryWriteFailure(message: string | null) {
  const value = lower(message);
  return (
    includesAny(value, ["history", "persist", "write", "storage"]) &&
    includesAny(value, ["broadcast", "submitted", "tx hash", "transaction hash", "success"])
  );
}

function displayForKind(
  kind: HistoryErrorKind,
  message: string | null,
): Omit<HistoryErrorDisplay, "source" | "category" | "message"> {
  switch (kind) {
    case "chainIdentity":
      return {
        kind,
        label: KIND_LABELS[kind],
        title: "Chain identity mismatch",
        summary:
          "The configured endpoint did not match the expected chain identity. chainId is the stable chain identity; the RPC URL is only an access endpoint.",
        suggestion: "Check the selected chainId and use an RPC endpoint that reports the same chainId.",
      };
    case "nonce":
      if (message?.toLowerCase().includes("replacement underpriced")) {
        return {
          kind,
          label: KIND_LABELS[kind],
          title: "Replacement fee too low",
          summary:
            "The RPC rejected this same-nonce replacement because its fee was not high enough to replace the tracked transaction.",
          suggestion: "Review the nonce thread and submit a higher-fee replacement only if the transaction is still pending.",
        };
      }
      return {
        kind,
        label: KIND_LABELS[kind],
        title: "Nonce conflict",
        summary:
          "The RPC reported a nonce conflict or same-nonce transaction condition for this account and chainId.",
        suggestion: "Compare this record with the nonce thread before submitting another transaction for the same nonce.",
      };
    case "history":
      if (isBroadcastHistoryWriteFailure(message)) {
        return {
          kind,
          label: KIND_LABELS[kind],
          title: "Broadcast may have succeeded; local history write failed",
          summary:
            "The submit command reported that broadcast may have succeeded, but the app could not write the local transaction history record.",
          suggestion:
            "Keep the transaction hash from the error message if present. Do not assume the local history list is complete until history storage is readable again.",
        };
      }
      return {
        kind,
        label: KIND_LABELS[kind],
        title: "Local history error",
        summary:
          "The app could not read or write the local transaction history needed for reliable tracking.",
        suggestion:
          "Keep the transaction hash visible and refresh after the local history issue is resolved; submission safety still depends on readable local history.",
      };
    case "rpc":
      return {
        kind,
        label: KIND_LABELS[kind],
        title: "RPC unavailable or rejected",
        summary: "The RPC endpoint failed, timed out, or returned an error while checking this transaction.",
        suggestion: "Check the endpoint health and confirm it reports the expected chainId before retrying.",
      };
    case "broadcast":
      if (message?.toLowerCase().includes("insufficient funds")) {
        return {
          kind,
          label: KIND_LABELS[kind],
          title: "Insufficient funds",
          summary: "The RPC rejected the broadcast because the sender balance could not cover value plus gas.",
          suggestion: "Review the account balance, value, gas limit, and fee inputs for this chainId.",
        };
      }
      return {
        kind,
        label: KIND_LABELS[kind],
        title: "Broadcast error",
        summary: "The transaction was not accepted by the RPC for broadcast.",
        suggestion: "Review the RPC error, account balance, nonce, and fee inputs before trying again.",
      };
    case "reconcile":
      return {
        kind,
        label: KIND_LABELS[kind],
        title: "Reconcile error",
        summary: "The local reconcile pass could not confidently update this transaction from RPC state.",
        suggestion: "Refresh history after checking that the configured RPC endpoint is available for this chainId.",
      };
    case "validation":
      return {
        kind,
        label: KIND_LABELS[kind],
        title: "Transfer input needs review",
        summary:
          "The transfer draft was not built or submitted because the current local inputs did not pass validation.",
        suggestion: "Review the highlighted input message before building or submitting the transaction again.",
      };
    case "unknown":
      return {
        kind,
        label: KIND_LABELS[kind],
        title: "Unclassified error",
        summary: "The record contains an error summary that does not match a known category.",
        suggestion: "Use the source, category, and message fields to inspect the current state.",
      };
  }
}

export function getHistoryErrorDisplay({
  record,
  status,
  identityIssues = [],
  nowMs = Date.now(),
}: HistoryErrorInput): HistoryErrorDisplay | null {
  const error = record.outcome.error_summary;
  const message = sanitizeHistoryErrorMessage(error?.message);
  const rawKind = error
    ? classifyErrorText({
        source: error.source,
        category: error.category,
        message: error.message,
        identityIssues,
      })
    : null;
  const kind =
    rawKind ??
    (status === "dropped" ? "reconcile" : null) ??
    (status === "pending" && isStalePending(record, nowMs) ? "reconcile" : null);

  if (kind === null) return null;

  if (status === "dropped" && rawKind === null) {
    return {
      kind,
      label: KIND_LABELS[kind],
      title: "Dropped by local reconcile",
      summary:
        "Local reconcile marked this transaction as a terminal dropped record. This is not the same as an on-chain failed receipt.",
      suggestion: "Use the transaction hash and nonce thread to inspect the current state before taking further action.",
      source: record.outcome.reconcile_summary?.source ?? "local reconcile",
      category: "dropped",
      message,
    };
  }

  if (status === "pending" && rawKind === null) {
    return {
      kind,
      label: KIND_LABELS[kind],
      title: "Pending for an extended time",
      summary:
        "This transaction is still pending locally and no terminal receipt, replacement, cancellation, or dropped decision is recorded.",
      suggestion: "Refresh history and inspect the nonce thread before deciding whether to replace or cancel.",
      source: record.outcome.reconcile_summary?.source ?? "local tracker",
      category: "pending",
      message,
    };
  }

  return {
    ...displayForKind(kind, message),
    source: error?.source ?? (kind === "chainIdentity" ? "identity check" : "unknown"),
    category: error?.category ?? KIND_LABELS[kind],
    message,
  };
}

export function getRawHistoryErrorDisplay({
  message: rawMessage,
  source = "ui",
  category = "error",
}: RawHistoryErrorInput): HistoryErrorDisplay {
  const message = sanitizeHistoryErrorMessage(rawMessage);
  const kind =
    classifyErrorText({
      source,
      category,
      message: rawMessage,
    }) ?? "unknown";

  return {
    ...displayForKind(kind, message),
    source,
    category,
    message,
  };
}

function isStalePending(record: HistoryRecord, nowMs: number) {
  const latest = latestKnownTimestamp(record);
  return latest !== null && nowMs - latest >= PENDING_STALE_MS;
}
