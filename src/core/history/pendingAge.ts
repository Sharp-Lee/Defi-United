import {
  getHistoryActionGates,
  isCurrentPendingActionTarget,
  type HistoryActionGate,
  type HistoryActionKind,
} from "./actions";
import type { HistoryReadModel } from "./selectors";

export type PendingAgeState = "fresh" | "attention" | "stale" | "needsReview";
export type PendingAgeRecommendationKind =
  | HistoryActionKind
  | "inspectNonceThread"
  | "diagnostics";

export interface PendingAgeRecommendation {
  kind: PendingAgeRecommendationKind;
  label: string;
  enabled: boolean;
  reason: string;
}

export interface PendingAgeGuidance {
  state: PendingAgeState;
  label: string;
  ageMs: number | null;
  ageLabel: string;
  broadcastedAt: string | null;
  checkedAt: string | null;
  checkedAgeMs: number | null;
  checkedLabel: string;
  summary: string;
  evidence: string[];
  recommendations: PendingAgeRecommendation[];
}

export const PENDING_AGE_THRESHOLDS_MS = {
  attention: 30 * 60 * 1000,
  stale: 4 * 60 * 60 * 1000,
  needsReview: 24 * 60 * 60 * 1000,
};

const STATE_LABELS: Record<PendingAgeState, string> = {
  fresh: "Normal pending",
  attention: "Needs attention",
  stale: "Long pending",
  needsReview: "Needs review",
};

function timestampMillis(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function clampElapsed(nowMs: number, thenMs: number | null) {
  if (thenMs === null) return null;
  return Math.max(0, nowMs - thenMs);
}

export function formatPendingDuration(ms: number | null) {
  if (ms === null) return "Unknown";
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  if (totalMinutes < 1) return "<1m";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function pendingStartedAt(entry: HistoryReadModel) {
  return entry.broadcastedAt ?? entry.record.intent_snapshot.captured_at;
}

function lastCheckedAt(entry: HistoryReadModel) {
  return entry.record.outcome.reconcile_summary?.checked_at ?? entry.record.outcome.reconciled_at;
}

function errorText(entry: HistoryReadModel) {
  const error = entry.record.outcome.error_summary;
  return `${error?.source ?? ""} ${error?.category ?? ""} ${error?.message ?? ""}`.toLowerCase();
}

function hasRpcOrReconcileError(entry: HistoryReadModel) {
  return ["rpc", "provider", "transport", "timeout", "connection", "unavailable", "network", "reconcile"].some(
    (needle) => errorText(entry).includes(needle),
  );
}

function deriveState(
  entry: HistoryReadModel,
  ageMs: number | null,
  currentPending: boolean,
) {
  const latestConfirmedNonce = entry.record.outcome.reconcile_summary?.latest_confirmed_nonce;
  if (
    typeof latestConfirmedNonce === "number" &&
    typeof entry.nonce === "number" &&
    latestConfirmedNonce > entry.nonce
  ) {
    return "needsReview";
  }
  if (!currentPending) return "needsReview";
  if (ageMs === null) return "attention";
  if (ageMs >= PENDING_AGE_THRESHOLDS_MS.needsReview) return "needsReview";
  if (ageMs >= PENDING_AGE_THRESHOLDS_MS.stale) return "stale";
  if (ageMs >= PENDING_AGE_THRESHOLDS_MS.attention || hasRpcOrReconcileError(entry)) {
    return "attention";
  }
  return "fresh";
}

function summaryForState(entry: HistoryReadModel, state: PendingAgeState, currentPending: boolean) {
  const latestConfirmedNonce = entry.record.outcome.reconcile_summary?.latest_confirmed_nonce;
  if (
    typeof latestConfirmedNonce === "number" &&
    typeof entry.nonce === "number" &&
    latestConfirmedNonce > entry.nonce
  ) {
    return "Chain nonce evidence suggests this pending transaction may need review/reconcile; this warning is not a terminal outcome.";
  }
  if (!currentPending) {
    return "A later same-nonce submission exists in this local thread, so inspect the nonce thread before taking any action.";
  }
  switch (state) {
    case "fresh":
      return "This is within the normal local pending window. Refresh tracked history if you want a current chain check.";
    case "attention":
      return "This pending transaction deserves a manual refresh or diagnostics check before deciding on replace or cancel.";
    case "stale":
      return "This transaction has been pending for several hours locally. Refresh tracked history and inspect the nonce thread before deciding whether to replace or cancel.";
    case "needsReview":
      return "This transaction has been pending locally for a long time. Treat the result as uncertain and review/reconcile before considering replace or cancel.";
  }
}

function evidenceFor(entry: HistoryReadModel, ageLabel: string, checkedLabel: string) {
  const evidence = [`Pending age: ${ageLabel}.`, `Last reconcile check: ${checkedLabel}.`];
  const reconcile = entry.record.outcome.reconcile_summary;
  if (reconcile?.decision) evidence.push(`Last reconcile decision: ${reconcile.decision}.`);
  if (typeof reconcile?.latest_confirmed_nonce === "number") {
    evidence.push(`Latest confirmed nonce from reconcile: ${reconcile.latest_confirmed_nonce}.`);
  }
  if (entry.record.outcome.error_summary) {
    evidence.push(
      `Latest diagnostic/error summary: ${entry.record.outcome.error_summary.category} from ${entry.record.outcome.error_summary.source}.`,
    );
  }
  return evidence;
}

function actionByKind(actions: HistoryActionGate[], kind: HistoryActionKind) {
  return actions.find((action) => action.kind === kind);
}

function recommendationFromAction(
  action: HistoryActionGate | undefined,
  fallback: PendingAgeRecommendation,
): PendingAgeRecommendation {
  if (!action) return fallback;
  return {
    kind: action.kind,
    label: action.label,
    enabled: action.enabled,
    reason: action.reason,
  };
}

function recommendationsFor(
  entry: HistoryReadModel,
  threadEntries: HistoryReadModel[],
  currentPending: boolean,
) {
  const actions = getHistoryActionGates(entry, threadEntries);
  const notCurrentReason =
    "Not available because this is not the current pending nonce-thread target.";
  const recommendations: PendingAgeRecommendation[] = [
    recommendationFromAction(actionByKind(actions, "reconcile"), {
      kind: "reconcile",
      label: "Refresh tracked history",
      enabled: false,
      reason: "Refresh is only available for pending records with a known tx hash, account, and chainId.",
    }),
    {
      kind: "inspectNonceThread",
      label: "Inspect nonce thread",
      enabled: true,
      reason:
        "Compare same-nonce submissions before deciding whether this pending record is still the active target.",
    },
    recommendationFromAction(actionByKind(actions, "replace"), {
      kind: "replace",
      label: "Replace",
      enabled: false,
      reason: currentPending
        ? "Replace is not available with the current frozen submission fields."
        : notCurrentReason,
    }),
    recommendationFromAction(actionByKind(actions, "cancel"), {
      kind: "cancel",
      label: "Cancel",
      enabled: false,
      reason: currentPending
        ? "Cancel is not available with the current frozen submission fields."
        : notCurrentReason,
    }),
    {
      kind: "diagnostics",
      label: "View diagnostics",
      enabled: true,
      reason: "Use the Diagnostics tab to inspect recent RPC, nonce, and reconcile events; diagnostics are not transaction truth.",
    },
  ];
  return recommendations;
}

export function getPendingAgeGuidance(
  entry: HistoryReadModel,
  threadEntries: HistoryReadModel[],
  nowMs = Date.now(),
): PendingAgeGuidance | null {
  if (entry.status !== "pending") return null;
  const broadcastedAt = pendingStartedAt(entry);
  const checkedAt = lastCheckedAt(entry);
  const ageMs = clampElapsed(nowMs, timestampMillis(broadcastedAt));
  const checkedAgeMs = clampElapsed(nowMs, timestampMillis(checkedAt));
  const currentPending = isCurrentPendingActionTarget(entry, threadEntries);
  const state = deriveState(entry, ageMs, currentPending);
  const ageLabel = formatPendingDuration(ageMs);
  const checkedLabel = checkedAgeMs === null ? "Unknown" : `${formatPendingDuration(checkedAgeMs)} ago`;
  return {
    state,
    label: STATE_LABELS[state],
    ageMs,
    ageLabel,
    broadcastedAt,
    checkedAt,
    checkedAgeMs,
    checkedLabel,
    summary: summaryForState(entry, state, currentPending),
    evidence: evidenceFor(entry, ageLabel, checkedLabel),
    recommendations: recommendationsFor(entry, threadEntries, currentPending),
  };
}
