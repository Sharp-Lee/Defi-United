import { useEffect, useMemo, useState } from "react";
import {
  getHistoryActionGates,
  isCurrentPendingActionTarget,
  type HistoryActionGate,
} from "../../core/history/actions";
import { getHistoryErrorDisplay, getRawHistoryErrorDisplay } from "../../core/history/errors";
import {
  getPendingAgeGuidance,
  type PendingAgeGuidance,
  type PendingAgeRecommendation,
} from "../../core/history/pendingAge";
import { HistoryErrorCard } from "./HistoryErrorCard";
import {
  groupHistoryByNonce,
  selectHistoryEntries,
  type HistoryNonceGroup,
  type HistoryReadModel,
  type HistorySelectorFilters,
  type HistoryStatus,
} from "../../core/history/selectors";
import type {
  HistoryCorruptionType,
  HistoryRecoveryIntent,
  HistoryRecord,
  HistoryStorageInspection,
  HistoryStorageQuarantineResult,
  PendingMutationRequest,
} from "../../lib/tauri";

const ALL = "__all__";
const UNKNOWN = "__unknown__";
const ACCOUNT_KEY_PREFIX = "key:";
const ACCOUNT_INDEX_PREFIX = "index:";
const ACCOUNT_FROM_PREFIX = "from:";
const HISTORY_CLOCK_INTERVAL_MS = 60 * 1000;

type DetailSelection =
  | { type: "submission"; key: string }
  | { type: "thread"; key: string }
  | null;

const historyStatuses: HistoryStatus[] = [
  "pending",
  "confirmed",
  "failed",
  "replaced",
  "cancelled",
  "dropped",
  "unknown",
];

const statusLabels: Record<HistoryStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  failed: "Failed",
  replaced: "Replaced",
  cancelled: "Cancelled",
  dropped: "Dropped (local)",
  unknown: "Unknown",
};

const statusDescriptions: Record<HistoryStatus, string> = {
  pending: "Broadcasted and tracked locally.",
  confirmed: "Confirmed on chain.",
  failed: "Included on chain with a failed receipt.",
  replaced: "Superseded by another submission in the nonce thread.",
  cancelled: "Cancelled by a later nonce-thread submission.",
  dropped: "Local reconcile marked this as dropped; it is not a chain failure.",
  unknown: "Outcome is not known yet.",
};

const corruptionLabels: Record<HistoryCorruptionType, string> = {
  permissionDenied: "Permission denied",
  ioError: "I/O error",
  jsonParseFailed: "JSON parse failed",
  schemaIncompatible: "Schema incompatible",
  partialRecordsInvalid: "Partial records invalid",
};

function short(value: string) {
  return value.length > 14 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value;
}

function formatMaybe(value: string | number | null) {
  return value === null ? "Unknown" : value.toString();
}

function formatOptional(value: string | number | null | undefined) {
  return value === null || value === undefined ? "Unknown" : value.toString();
}

function formatOptionalBoolean(value: boolean | null | undefined) {
  return value === null || value === undefined ? null : value ? "Yes" : "No";
}

function formatAccount(entry: Pick<HistoryReadModel, "account">) {
  const index = entry.account.accountIndex === null ? "?" : entry.account.accountIndex.toString();
  const from = entry.account.from ?? "unknown";
  return `Account ${index} · ${short(from)}`;
}

function accountOptionFor(entry: HistoryReadModel) {
  if (entry.account.key !== null) {
    return {
      value: `${ACCOUNT_KEY_PREFIX}${entry.account.key}`,
      label: formatAccount(entry),
    };
  }
  if (entry.account.accountIndex !== null) {
    return {
      value: `${ACCOUNT_INDEX_PREFIX}${entry.account.accountIndex}`,
      label: `Account ${entry.account.accountIndex} · Unknown address`,
    };
  }
  if (entry.account.normalizedFrom !== null) {
    return {
      value: `${ACCOUNT_FROM_PREFIX}${entry.account.normalizedFrom}`,
      label: `Unknown index · ${short(entry.account.from ?? entry.account.normalizedFrom)}`,
    };
  }
  return {
    value: UNKNOWN,
    label: "Unknown account",
  };
}

function accountFilterFor(value: string): HistorySelectorFilters["account"] | undefined {
  if (value === ALL) return undefined;
  if (value === UNKNOWN) return { accountIndex: null, from: null };
  if (value.startsWith(ACCOUNT_KEY_PREFIX)) {
    return { key: value.slice(ACCOUNT_KEY_PREFIX.length) };
  }
  if (value.startsWith(ACCOUNT_INDEX_PREFIX)) {
    return { accountIndex: Number(value.slice(ACCOUNT_INDEX_PREFIX.length)), from: null };
  }
  if (value.startsWith(ACCOUNT_FROM_PREFIX)) {
    return { accountIndex: null, from: value.slice(ACCOUNT_FROM_PREFIX.length) };
  }
  return undefined;
}

function formatThread(group: HistoryNonceGroup) {
  const chain = formatMaybe(group.chainId);
  const index = group.account.accountIndex === null ? "?" : group.account.accountIndex.toString();
  return `chainId ${chain} · account ${index} · nonce ${formatMaybe(group.nonce)}`;
}

function roleLabel(entry: Pick<HistoryReadModel, "submissionRole">) {
  switch (entry.submissionRole) {
    case "submission":
      return "Original submission";
    case "replacement":
      return "Replacement submission";
    case "cancellation":
      return "Cancel submission";
    case "legacy":
      return "Legacy submission";
  }
}

function relationshipLabel(entry: HistoryReadModel) {
  if (entry.submissionRole === "replacement" && entry.replacesTxHash) {
    return `replaces ${short(entry.replacesTxHash)}`;
  }
  if (entry.submissionRole === "cancellation" && entry.replacesTxHash) {
    return `cancels ${short(entry.replacesTxHash)}`;
  }
  if (entry.replacedByTxHash) {
    return `replaced by ${short(entry.replacedByTxHash)}`;
  }
  return "thread root";
}

function timestampValue(entry: HistoryReadModel) {
  return (
    entry.record.outcome.finalized_at ??
    entry.record.outcome.reconciled_at ??
    entry.broadcastedAt ??
    entry.record.intent_snapshot.captured_at
  );
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

function formatTimestamp(value: string | null) {
  const millis = timestampMillis(value);
  if (millis === null) return value ?? "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(millis));
}

function latestTimestamp(entries: HistoryReadModel[]) {
  return entries
    .map((entry) => timestampValue(entry))
    .sort((left, right) => (timestampMillis(right) ?? 0) - (timestampMillis(left) ?? 0))[0] ?? null;
}

function compareThreadEntries(left: HistoryReadModel, right: HistoryReadModel) {
  return (
    (timestampMillis(threadOrderTimestamp(left)) ?? 0) -
      (timestampMillis(threadOrderTimestamp(right)) ?? 0) ||
    left.originalIndex - right.originalIndex
  );
}

function sortedThreadEntries(entries: HistoryReadModel[]) {
  return [...entries].sort(compareThreadEntries);
}

function threadOrderTimestamp(entry: HistoryReadModel) {
  return entry.broadcastedAt ?? entry.record.intent_snapshot.captured_at ?? timestampValue(entry);
}

function statusClass(status: HistoryStatus) {
  return `history-status history-status-${status}`;
}

function detailKey(entry: HistoryReadModel) {
  return `${entry.txHash}-${entry.originalIndex}`;
}

function bumpWei(value: string) {
  const wei = BigInt(value);
  return ((wei * 125n) / 100n + 1n).toString();
}

function requireFrozenField<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined || value === "") {
    throw new Error(`Missing frozen submission field: ${label}`);
  }
  return value;
}

function pendingRequestFromRecord(record: HistoryRecord, rpcUrl: string): PendingMutationRequest {
  const { submission } = record;
  return {
    txHash: submission.tx_hash,
    rpcUrl,
    accountIndex: requireFrozenField(submission.account_index, "account_index"),
    chainId: requireFrozenField(submission.chain_id, "chain_id"),
    from: requireFrozenField(submission.from, "from"),
    nonce: requireFrozenField(submission.nonce, "nonce"),
    gasLimit: requireFrozenField(submission.gas_limit, "gas_limit"),
    maxFeePerGas: bumpWei(requireFrozenField(submission.max_fee_per_gas, "max_fee_per_gas")),
    maxPriorityFeePerGas: bumpWei(
      requireFrozenField(submission.max_priority_fee_per_gas, "max_priority_fee_per_gas"),
    ),
    to: requireFrozenField(submission.to, "to"),
    valueWei: requireFrozenField(submission.value_wei, "value_wei"),
  };
}

export function HistoryView({
  items,
  onRefresh,
  onQuarantineHistory,
  onRecoverBroadcastedHistory,
  onDismissRecovery,
  onReviewDropped,
  onReplace,
  onCancelPending,
  disabled = false,
  loading = false,
  error = null,
  storage = null,
  lastQuarantine = null,
  recoveryIntents = [],
  recoveryRpcDisabledReason = null,
  reviewRpcDisabledReason = null,
  rpcUrl = null,
  chainReady = false,
}: {
  items: HistoryRecord[];
  onRefresh: () => Promise<void> | void;
  onQuarantineHistory?: () => Promise<void> | void;
  onRecoverBroadcastedHistory?: (recoveryId: string) => Promise<void> | void;
  onDismissRecovery?: (recoveryId: string) => Promise<void> | void;
  onReviewDropped?: (txHash: string) => Promise<void> | void;
  onReplace?: (request: PendingMutationRequest) => Promise<void> | void;
  onCancelPending?: (request: PendingMutationRequest) => Promise<void> | void;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  storage?: HistoryStorageInspection | null;
  lastQuarantine?: HistoryStorageQuarantineResult | null;
  recoveryIntents?: HistoryRecoveryIntent[];
  recoveryRpcDisabledReason?: string | null;
  reviewRpcDisabledReason?: string | null;
  rpcUrl?: string | null;
  chainReady?: boolean;
}) {
  const [viewMode, setViewMode] = useState<"submissions" | "threads">("submissions");
  const [accountFilter, setAccountFilter] = useState(ALL);
  const [chainFilter, setChainFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [nonceFilter, setNonceFilter] = useState(ALL);
  const [threadFilter, setThreadFilter] = useState(ALL);
  const [detailSelection, setDetailSelection] = useState<DetailSelection>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), HISTORY_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const allEntries = useMemo(() => selectHistoryEntries(items), [items]);
  const allGroups = useMemo(() => groupHistoryByNonce(items), [items]);
  const allThreadEntriesByKey = useMemo(
    () => new Map(allGroups.map((group) => [group.key, group.submissions])),
    [allGroups],
  );
  const accountOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const entry of allEntries) {
      const option = accountOptionFor(entry);
      options.set(option.value, option.label);
    }
    return Array.from(options, ([value, label]) => ({ value, label }));
  }, [allEntries]);
  const chainOptions = useMemo(() => {
    const options = new Set<number | null>();
    for (const entry of allEntries) options.add(entry.chainId);
    return Array.from(options).map((value) => ({
      value: value === null ? UNKNOWN : value.toString(),
      label: `chainId ${formatMaybe(value)}`,
    }));
  }, [allEntries]);
  const nonceOptions = useMemo(() => {
    const options = new Set<number | null>();
    for (const group of allGroups) options.add(group.nonce);
    return Array.from(options).map((value) => ({
      value: value === null ? UNKNOWN : value.toString(),
      label: `nonce ${formatMaybe(value)}`,
    }));
  }, [allGroups]);

  const filters = useMemo<HistorySelectorFilters>(() => {
    const next: HistorySelectorFilters = {};
    const account = accountFilterFor(accountFilter);
    if (account !== undefined) next.account = account;
    if (chainFilter !== ALL) next.chainId = chainFilter === UNKNOWN ? null : Number(chainFilter);
    if (statusFilter !== ALL) next.status = statusFilter as HistoryStatus;
    if (nonceFilter !== ALL) next.nonce = nonceFilter === UNKNOWN ? null : Number(nonceFilter);
    return next;
  }, [accountFilter, chainFilter, nonceFilter, statusFilter]);

  const filteredEntries = useMemo(() => selectHistoryEntries(items, filters), [filters, items]);
  const filteredGroups = useMemo(() => groupHistoryByNonce(items, filters), [filters, items]);
  const visibleGroups = useMemo(
    () =>
      threadFilter === ALL
        ? filteredGroups
        : filteredGroups.filter((group) => group.key === threadFilter),
    [filteredGroups, threadFilter],
  );
  const visibleEntries = useMemo(
    () =>
      threadFilter === ALL
        ? filteredEntries
        : visibleGroups.flatMap((group) => group.submissions),
    [filteredEntries, threadFilter, visibleGroups],
  );
  const selectedDetail = useMemo(() => {
    if (detailSelection === null) return null;
    if (detailSelection.type === "thread") {
      const group = visibleGroups.find((item) => item.key === detailSelection.key);
      return group
        ? {
            type: "thread" as const,
            group,
            threadEntries: allThreadEntriesByKey.get(group.key) ?? [],
          }
        : null;
    }
    const entry = visibleEntries.find((item) => detailKey(item) === detailSelection.key);
    return entry
      ? {
          type: "submission" as const,
          entry,
          threadEntries: allThreadEntriesByKey.get(entry.key) ?? [],
        }
      : null;
  }, [allThreadEntriesByKey, detailSelection, visibleEntries, visibleGroups]);
  const isBusy = loading || refreshing;
  const storageBlocked = storage?.status === "corrupted";
  const storageBlockedReason = storageBlocked
    ? "Disabled while local transaction history is unreadable. Retry the read or quarantine the damaged file before submitting, replacing, cancelling, or reviewing dropped records."
    : null;
  const pendingActionRpcUrl = chainReady ? (rpcUrl ?? "").trim() : "";
  const pendingActionRpcDisabledReason = pendingActionRpcUrl
    ? null
    : "Validate an RPC endpoint before replacing or cancelling pending transactions.";
  const statusMessage = refreshError ?? error;
  const statusError = useMemo(
    () =>
      statusMessage
        ? getRawHistoryErrorDisplay({
            message: statusMessage,
            source: "manual history refresh",
            category: "refresh",
          })
        : null,
    [statusMessage],
  );
  const recentFailureSummaries = useMemo(
    () =>
      allEntries
        .map((entry) => ({
          entry,
          error: getHistoryErrorDisplay({
            record: entry.record,
            status: entry.status,
            identityIssues: entry.identityIssues,
            nowMs,
          }),
        }))
        .filter(
          (
            item,
          ): item is {
            entry: HistoryReadModel;
            error: NonNullable<ReturnType<typeof getHistoryErrorDisplay>>;
          } => item.error !== null,
        )
        .sort(
          (left, right) =>
            (timestampMillis(timestampValue(right.entry)) ?? 0) -
            (timestampMillis(timestampValue(left.entry)) ?? 0),
        )
        .slice(0, 3),
    [allEntries, nowMs],
  );
  const activeRecoveryIntents = useMemo(
    () => recoveryIntents.filter((intent) => intent.status === "active"),
    [recoveryIntents],
  );

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onRefresh();
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  function clearFilters() {
    setAccountFilter(ALL);
    setChainFilter(ALL);
    setStatusFilter(ALL);
    setNonceFilter(ALL);
    setThreadFilter(ALL);
  }

  function renderDetailButton(entry: HistoryReadModel) {
    return (
      <button
        className="secondary-button"
        onClick={() => setDetailSelection({ type: "submission", key: detailKey(entry) })}
        type="button"
      >
        Details
      </button>
    );
  }

  function renderStatus(status: HistoryStatus) {
    return (
      <span className={statusClass(status)} title={statusDescriptions[status]}>
        {statusLabels[status]}
      </span>
    );
  }

  function renderActions(entry: HistoryReadModel, threadEntries: HistoryReadModel[]) {
    const actionGates = getHistoryActionGates(entry, threadEntries);
    const pendingGuidance = getPendingAgeGuidance(entry, threadEntries, nowMs);
    const reconcile = actionGates.find((action) => action.kind === "reconcile");
    const replace = actionGates.find((action) => action.kind === "replace");
    const cancel = actionGates.find((action) => action.kind === "cancel");
    const droppedReview = actionGates.find((action) => action.kind === "droppedReview");
    const droppedReviewBlockedReason = droppedReview
      ? storageBlockedReason ??
        (!droppedReview.enabled
          ? droppedReview.reason
          : !onReviewDropped
            ? "Dropped review handler is not available in this view."
            : reviewRpcDisabledReason)
      : null;
    const replaceBlockedReason = replace
      ? storageBlockedReason ??
        (!replace.enabled
          ? replace.reason
          : !onReplace
            ? "Replace handler is not available in this view."
            : pendingActionRpcDisabledReason)
      : null;
    const cancelBlockedReason = cancel
      ? storageBlockedReason ??
        (!cancel.enabled
          ? cancel.reason
          : !onCancelPending
            ? "Cancel handler is not available in this view."
            : pendingActionRpcDisabledReason)
      : null;
    return (
      <div className="button-row history-actions">
        {renderDetailButton(entry)}
        {pendingGuidance && <HistoryPendingActionSummary guidance={pendingGuidance} />}
        {reconcile && (
          <button
            className="secondary-button"
            disabled={disabled || isBusy || !reconcile.enabled}
            onClick={handleRefresh}
            title={reconcile.reason}
            type="button"
          >
            Refresh tracked history
          </button>
        )}
        {replace && cancel && (
          <>
            <button
              className="secondary-button"
              disabled={
                disabled ||
                storageBlocked ||
                !replace.enabled ||
                !onReplace ||
                Boolean(pendingActionRpcDisabledReason)
              }
              onClick={() => {
                if (pendingActionRpcUrl) {
                  onReplace?.(pendingRequestFromRecord(entry.record, pendingActionRpcUrl));
                }
              }}
              title={replaceBlockedReason ?? replace.reason}
              type="button"
            >
              Replace {short(entry.txHash)}
            </button>
            <button
              className="secondary-button"
              disabled={
                disabled ||
                storageBlocked ||
                !cancel.enabled ||
                !onCancelPending ||
                Boolean(pendingActionRpcDisabledReason)
              }
              onClick={() => {
                if (pendingActionRpcUrl) {
                  onCancelPending?.(pendingRequestFromRecord(entry.record, pendingActionRpcUrl));
                }
              }}
              title={cancelBlockedReason ?? cancel.reason}
              type="button"
            >
              Cancel {short(entry.txHash)}
            </button>
          </>
        )}
        {storageBlockedReason && (replace || cancel || droppedReview) && (
          <span className="history-action-reason">
            {replace || cancel ? "Submit/replace/cancel" : "History actions"}:{" "}
            {storageBlockedReason}
          </span>
        )}
        {droppedReview && (
          <button
            className="secondary-button"
            disabled={
              disabled ||
              isBusy ||
              storageBlocked ||
              !droppedReview.enabled ||
              !onReviewDropped ||
              Boolean(reviewRpcDisabledReason)
            }
            onClick={() => void onReviewDropped?.(entry.txHash)}
            title={
              droppedReviewBlockedReason ?? droppedReview.reason
            }
            type="button"
          >
            Review dropped
          </button>
        )}
        {actionGates
          .filter(
            (action) =>
              !action.enabled ||
              (action.kind === "droppedReview" && action.enabled && reviewRpcDisabledReason),
          )
          .map((action) => (
            <span className="history-action-reason" key={action.kind}>
              {action.label}:{" "}
              {action.kind === "droppedReview" && action.enabled && reviewRpcDisabledReason
                ? reviewRpcDisabledReason
                : action.reason}
            </span>
          ))}
      </div>
    );
  }

  return (
    <section className="workspace-section">
      <header className="section-header">
        <h2>History</h2>
        <button
          className="secondary-button"
          disabled={disabled || isBusy}
          onClick={handleRefresh}
          type="button"
        >
          {isBusy ? "Refreshing" : "Refresh"}
        </button>
      </header>
      {statusError && (
        <HistoryErrorCard error={statusError} meta="Manual refresh" role="alert" />
      )}
      {storage?.status === "corrupted" && (
        <HistoryStorageRecoveryCard
          disabled={disabled || isBusy}
          lastQuarantine={lastQuarantine}
          onQuarantineHistory={onQuarantineHistory}
          onRetry={handleRefresh}
          storage={storage}
        />
      )}
      {lastQuarantine && storage?.status !== "corrupted" && (
        <HistoryStorageRecoveredCard result={lastQuarantine} />
      )}
      {activeRecoveryIntents.length > 0 && (
        <HistoryBroadcastRecoveryList
          disabled={disabled || isBusy}
          intents={activeRecoveryIntents}
          onDismissRecovery={onDismissRecovery}
          onRecoverBroadcastedHistory={onRecoverBroadcastedHistory}
          recoveryRpcDisabledReason={recoveryRpcDisabledReason}
          storageBlockedReason={storageBlockedReason}
        />
      )}
      {isBusy && items.length === 0 && <div className="inline-warning">Loading transaction history...</div>}
      {recentFailureSummaries.length > 0 && (
        <section className="history-error-summary" aria-label="Recent history issues">
          <h3>Recent Issues</h3>
          <div className="history-error-summary-list">
            {recentFailureSummaries.map(({ entry, error }) => (
              <HistoryErrorCard
                error={error}
                key={`${entry.txHash}-${entry.originalIndex}-issue`}
                meta={`${statusLabels[entry.status]} · chainId ${formatMaybe(entry.chainId)} · nonce ${formatMaybe(entry.nonce)}`}
              />
            ))}
          </div>
        </section>
      )}
      <div className="history-controls" aria-label="History filters">
        <label>
          Account
          <select
            onChange={(event) => {
              setAccountFilter(event.target.value);
              setThreadFilter(ALL);
            }}
            value={accountFilter}
          >
            <option value={ALL}>All accounts</option>
            {accountOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Chain
          <select
            onChange={(event) => {
              setChainFilter(event.target.value);
              setThreadFilter(ALL);
            }}
            value={chainFilter}
          >
            <option value={ALL}>All chainIds</option>
            {chainOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setThreadFilter(ALL);
            }}
            value={statusFilter}
          >
            <option value={ALL}>All statuses</option>
            {historyStatuses.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nonce
          <select
            onChange={(event) => {
              setNonceFilter(event.target.value);
              setThreadFilter(ALL);
            }}
            value={nonceFilter}
          >
            <option value={ALL}>All nonces</option>
            {nonceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Thread
          <select onChange={(event) => setThreadFilter(event.target.value)} value={threadFilter}>
            <option value={ALL}>All threads</option>
            {filteredGroups.map((group) => (
              <option key={group.key} value={group.key}>
                {formatThread(group)}
              </option>
            ))}
          </select>
        </label>
        <label>
          View
          <select
            onChange={(event) => setViewMode(event.target.value as "submissions" | "threads")}
            value={viewMode}
          >
            <option value="submissions">Submissions</option>
            <option value="threads">Nonce threads</option>
          </select>
        </label>
        <button className="secondary-button" onClick={clearFilters} type="button">
          Clear
        </button>
      </div>
      <div className="data-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Chain</th>
              <th>Account</th>
              <th>Nonce</th>
              <th>Tx hash</th>
              <th>To</th>
              <th>Value</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !isBusy && (
              <tr>
                <td colSpan={9}>No local transaction history.</td>
              </tr>
            )}
            {items.length > 0 && viewMode === "submissions" && visibleEntries.length === 0 && (
              <tr>
                <td colSpan={9}>No history records match these filters.</td>
              </tr>
            )}
            {items.length > 0 && viewMode === "threads" && visibleGroups.length === 0 && (
              <tr>
                <td colSpan={9}>No nonce threads match these filters.</td>
              </tr>
            )}
            {viewMode === "submissions" &&
              visibleEntries.map((entry) => (
                <tr key={`${entry.txHash}-${entry.originalIndex}`}>
                  <td>
                    <div className="history-status-stack">
                      {renderStatus(entry.status)}
                      <HistoryPendingAgeBadge
                        guidance={getPendingAgeGuidance(
                          entry,
                          allThreadEntriesByKey.get(entry.key) ?? [entry],
                          nowMs,
                        )}
                      />
                    </div>
                  </td>
                  <td className="mono">chainId {formatMaybe(entry.chainId)}</td>
                  <td className="mono">{formatAccount(entry)}</td>
                  <td className="mono">{formatMaybe(entry.nonce)}</td>
                  <td className="mono">{short(entry.txHash)}</td>
                  <td className="mono">
                    {short(entry.record.submission.to ?? entry.record.intent.to)}
                  </td>
                  <td className="mono">
                    {entry.record.submission.value_wei ?? entry.record.intent.value_wei} wei
                  </td>
                  <td>{formatTimestamp(timestampValue(entry))}</td>
                  <td>{renderActions(entry, allThreadEntriesByKey.get(entry.key) ?? [entry])}</td>
                </tr>
              ))}
            {viewMode === "threads" &&
              visibleGroups.map((group) => (
                <tr key={group.key}>
                  <td>
                    <div className="history-status-stack">
                      {group.statuses.map((status) => (
                        <span key={status}>
                          {renderStatus(status)}
                          {group.statusCounts[status] > 1 ? ` x${group.statusCounts[status]}` : ""}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="mono">chainId {formatMaybe(group.chainId)}</td>
                  <td className="mono">
                    Account {formatMaybe(group.account.accountIndex)} ·{" "}
                    {short(group.account.from ?? "unknown")}
                  </td>
                  <td className="mono">{formatMaybe(group.nonce)}</td>
                  <td className="mono">
                    <div className="history-thread-list">
                      {sortedThreadEntries(group.submissions).map((entry) => (
                        <div key={`${entry.txHash}-${entry.originalIndex}`}>
                          {roleLabel(entry)}: {short(entry.txHash)}
                          <span className="history-thread-relation"> {relationshipLabel(entry)}</span>
                          {isCurrentPendingActionTarget(
                            entry,
                            allThreadEntriesByKey.get(group.key) ?? [],
                          ) && (
                            <span className="history-thread-current"> current pending</span>
                          )}
                          <HistoryPendingAgeBadge
                            guidance={getPendingAgeGuidance(
                              entry,
                              allThreadEntriesByKey.get(group.key) ?? [],
                              nowMs,
                            )}
                          />
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="mono">
                    {short(
                      group.submissions[0].record.submission.to ??
                        group.submissions[0].record.intent.to,
                    )}
                  </td>
                  <td className="mono">
                    {group.submissions[0].record.submission.value_wei ??
                      group.submissions[0].record.intent.value_wei}{" "}
                    wei
                  </td>
                  <td>{formatTimestamp(latestTimestamp(group.submissions))}</td>
                  <td>
                    <div className="history-thread-list">
                      <button
                        className="secondary-button"
                        onClick={() => setDetailSelection({ type: "thread", key: group.key })}
                        type="button"
                      >
                        Thread details
                      </button>
                      {sortedThreadEntries(group.submissions).map((entry) => (
                        <div key={`${entry.txHash}-${entry.originalIndex}-actions`}>
                          {renderActions(entry, allThreadEntriesByKey.get(group.key) ?? [])}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {selectedDetail && (
        <HistoryDetails
          detail={selectedDetail}
          nowMs={nowMs}
          onClose={() => setDetailSelection(null)}
          renderStatus={renderStatus}
        />
      )}
    </section>
  );
}

function formatRawSummary(storage: HistoryStorageInspection) {
  const summary = storage.rawSummary;
  return [
    `file ${summary.fileSizeBytes ?? "unknown"} bytes`,
    `top ${summary.topLevel ?? "unknown"}`,
    `array len ${summary.arrayLen ?? "unknown"}`,
    `modified ${formatTimestamp(summary.modifiedAt)}`,
  ].join(" · ");
}

function invalidRecordSummary(storage: HistoryStorageInspection) {
  if (storage.invalidRecordCount === 0) return "No invalid record indices were reported.";
  const indices = storage.invalidRecordIndices.length
    ? storage.invalidRecordIndices.join(", ")
    : "not available";
  return `${storage.invalidRecordCount} invalid record(s); first indices: ${indices}.`;
}

function recoveryDisabledReason(
  intent: HistoryRecoveryIntent,
  storageBlockedReason: string | null,
  recoveryRpcDisabledReason: string | null,
  handlerAvailable: boolean,
) {
  if (storageBlockedReason) return storageBlockedReason;
  if (recoveryRpcDisabledReason) return recoveryRpcDisabledReason;
  if (!handlerAvailable) return "Recovery handler is not available in this view.";
  if (intent.chainId === null || intent.chainId === undefined) {
    return "Recovery is disabled because the frozen chainId is missing.";
  }
  if (intent.accountIndex === null || intent.accountIndex === undefined || !intent.from) {
    return "Recovery is disabled because the frozen account/from is missing.";
  }
  if (intent.nonce === null || intent.nonce === undefined) {
    return "Recovery is disabled because the frozen nonce is missing.";
  }
  if (!intent.txHash) return "Recovery is disabled because the tx hash is missing.";
  return null;
}

function feeSummary(intent: HistoryRecoveryIntent) {
  const gasLimit = intent.gasLimit ?? "unknown";
  const maxFee = intent.maxFeePerGas ?? "unknown";
  const priority = intent.maxPriorityFeePerGas ?? "unknown";
  return `gas ${gasLimit} · max ${maxFee} wei · priority ${priority} wei`;
}

function sanitizeRecoveryDisplayText(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, "[redacted_url]")
    .replace(/\b(?:wss?|ws):\/\/\S+/gi, "[redacted_url]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[redacted_auth]")
    .replace(
      /\b(mnemonic|seed(?:\s+phrase)?|recovery\s+phrase)\b\s+.*?(?=\s+[A-Za-z0-9_-]+\s*[:=]|$)/gi,
      "$1 [redacted]",
    )
    .replace(
      /\b(api\s+key|access\s+token|private\s+key|raw\s+tx|signed\s+tx|raw\s+transaction|signed\s+transaction|token|authorization|auth|password|passphrase|signature|secret)\b\s+("[^"]*"|'[^']*'|[^\s,;)]+)/gi,
      "$1 [redacted]",
    )
    .replace(
      /\b(api[_-]?key|access[_-]?token|token|authorization|auth|password|passphrase|mnemonic|seed|private[_-]?key|signature|signed[_-]?tx|raw[_-]?tx|secret)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;)]+)/gi,
      "$1=[redacted]",
    )
    .replace(/0x[a-f0-9]{64,}/gi, "[redacted_hex]");
}

function HistoryBroadcastRecoveryList({
  intents,
  disabled,
  storageBlockedReason,
  recoveryRpcDisabledReason,
  onRecoverBroadcastedHistory,
  onDismissRecovery,
}: {
  intents: HistoryRecoveryIntent[];
  disabled: boolean;
  storageBlockedReason: string | null;
  recoveryRpcDisabledReason: string | null;
  onRecoverBroadcastedHistory?: (recoveryId: string) => Promise<void> | void;
  onDismissRecovery?: (recoveryId: string) => Promise<void> | void;
}) {
  return (
    <section className="history-broadcast-recovery-list" aria-label="Broadcast recovery">
      {intents.map((intent) => {
        const reason = recoveryDisabledReason(
          intent,
          storageBlockedReason,
          recoveryRpcDisabledReason,
          Boolean(onRecoverBroadcastedHistory),
        );
        return (
          <article className="history-recovery-card" key={intent.id} role="alert">
            <header>
              <div>
                <span>Broadcast recovery</span>
                <h3>{short(intent.txHash)}</h3>
              </div>
              <span className="pill danger-pill">History missing</span>
            </header>
            <p>
              The transaction was broadcast, but the local history write failed. Recovery queries
              the selected RPC for this tx hash and writes a local record without signing or
              broadcasting again.
            </p>
            <dl>
              <div>
                <dt>chainId</dt>
                <dd className="mono">{formatOptional(intent.chainId)}</dd>
              </div>
              <div>
                <dt>Account/from</dt>
                <dd className="mono">
                  Account {formatOptional(intent.accountIndex)} · {short(formatOptional(intent.from))}
                </dd>
              </div>
              <div>
                <dt>Nonce</dt>
                <dd className="mono">{formatOptional(intent.nonce)}</dd>
              </div>
              <div>
                <dt>To/value</dt>
                <dd className="mono">
                  {short(formatOptional(intent.to))} · {formatOptional(intent.valueWei)} wei
                </dd>
              </div>
              <div>
                <dt>Fee summary</dt>
                <dd className="mono">{feeSummary(intent)}</dd>
              </div>
              <div>
                <dt>Broadcasted at</dt>
                <dd>{formatTimestamp(intent.broadcastedAt)}</dd>
              </div>
              <div>
                <dt>Write error</dt>
                <dd>{sanitizeRecoveryDisplayText(intent.writeError)}</dd>
              </div>
              {intent.lastRecoveryError && (
                <div>
                  <dt>Last recovery error</dt>
                  <dd>{sanitizeRecoveryDisplayText(intent.lastRecoveryError)}</dd>
                </div>
              )}
            </dl>
            <p className="history-thread-note">
              Risk: only recover transactions you recognize. Unknown fields remain unknown; this
              flow does not recreate an intent beyond the saved frozen submission.
            </p>
            <div className="button-row">
              <button
                className="secondary-button"
                disabled={disabled || reason !== null}
                onClick={() => void onRecoverBroadcastedHistory?.(intent.id)}
                title={reason ?? "Recover local history from this broadcast tx hash."}
                type="button"
              >
                Recover {short(intent.txHash)}
              </button>
              <button
                className="secondary-button"
                disabled={disabled || !onDismissRecovery}
                onClick={() => void onDismissRecovery?.(intent.id)}
                type="button"
              >
                Dismiss
              </button>
              {reason && <span className="history-action-reason">{reason}</span>}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function HistoryStorageRecoveryCard({
  storage,
  lastQuarantine,
  onRetry,
  onQuarantineHistory,
  disabled,
}: {
  storage: HistoryStorageInspection;
  lastQuarantine: HistoryStorageQuarantineResult | null;
  onRetry: () => Promise<void> | void;
  onQuarantineHistory?: () => Promise<void> | void;
  disabled: boolean;
}) {
  const corruptionType = storage.corruptionType ?? "ioError";
  return (
    <article className="history-recovery-card" role="alert">
      <header>
        <div>
          <span>History storage recovery</span>
          <h3>{corruptionLabels[corruptionType]}</h3>
        </div>
        <span className="pill danger-pill">History actions disabled</span>
      </header>
      <p>
        Local transaction history cannot be trusted right now. New submit, replace, cancel, and
        dropped review actions stay blocked so pending nonce recovery and review audit trails are
        not bypassed.
      </p>
      <dl>
        <div>
          <dt>Impact</dt>
          <dd>History list, pending nonce recovery, submit, replace, cancel, and dropped review.</dd>
        </div>
        <div>
          <dt>Original file</dt>
          <dd className="mono">{storage.path}</dd>
        </div>
        <div>
          <dt>Error</dt>
          <dd>{storage.errorSummary ?? "No OS or parser message was returned."}</dd>
        </div>
        <div>
          <dt>Raw summary</dt>
          <dd className="mono">{formatRawSummary(storage)}</dd>
        </div>
        <div>
          <dt>Record scope</dt>
          <dd>{invalidRecordSummary(storage)}</dd>
        </div>
        {lastQuarantine && (
          <div>
            <dt>Last quarantine copy</dt>
            <dd className="mono">{lastQuarantine.quarantinedPath}</dd>
          </div>
        )}
      </dl>
      <div className="button-row">
        <button className="secondary-button" disabled={disabled} onClick={() => void onRetry()} type="button">
          Retry read
        </button>
        <button
          className="secondary-button"
          disabled={disabled || !onQuarantineHistory}
          onClick={() => void onQuarantineHistory?.()}
          type="button"
        >
          Quarantine and start empty history
        </button>
      </div>
    </article>
  );
}

function HistoryStorageRecoveredCard({
  result,
}: {
  result: HistoryStorageQuarantineResult;
}) {
  const previousType = result.previous.corruptionType ?? "ioError";
  return (
    <article className="history-recovery-card history-recovery-card-ok" aria-label="History recovery result">
      <header>
        <div>
          <span>History storage recovered</span>
          <h3>Empty history started</h3>
        </div>
        <span className="pill">Audit copy retained</span>
      </header>
      <p>
        The damaged history file was moved aside. The current history is empty; old records were not
        recreated or inferred from chain data.
      </p>
      <dl>
        <div>
          <dt>Quarantine copy</dt>
          <dd className="mono">{result.quarantinedPath}</dd>
        </div>
        <div>
          <dt>Previous classification</dt>
          <dd>{corruptionLabels[previousType]}</dd>
        </div>
        <div>
          <dt>Previous summary</dt>
          <dd className="mono">{formatRawSummary(result.previous)}</dd>
        </div>
      </dl>
    </article>
  );
}

function HistoryDetails({
  detail,
  nowMs,
  onClose,
  renderStatus,
}: {
  detail:
    | { type: "submission"; entry: HistoryReadModel; threadEntries: HistoryReadModel[] }
    | { type: "thread"; group: HistoryNonceGroup; threadEntries: HistoryReadModel[] };
  nowMs: number;
  onClose: () => void;
  renderStatus: (status: HistoryStatus) => JSX.Element;
}) {
  const entries = detail.type === "submission" ? [detail.entry] : detail.group.submissions;
  const title =
    detail.type === "submission" ? `Submission ${short(detail.entry.txHash)}` : formatThread(detail.group);
  const threadEntries = sortedThreadEntries(detail.threadEntries);

  return (
    <section className="history-detail-panel" aria-label="History details">
      <header className="history-detail-header">
        <div>
          <h3>{title}</h3>
          <p>
            {detail.type === "thread"
              ? "Nonce thread details grouped by account, chainId, and nonce."
              : "Transaction details separated by user intent, frozen submission, and chain outcome."}
          </p>
        </div>
        <button className="secondary-button" onClick={onClose} type="button">
          Close
        </button>
      </header>
      {detail.type === "thread" && (
        <NonceThreadTimeline
          entries={sortedThreadEntries(entries)}
          threadEntries={threadEntries}
          renderStatus={renderStatus}
        />
      )}
      <div className="history-detail-submissions">
        {sortedThreadEntries(entries).map((entry) => (
          <HistorySubmissionDetails
            entry={entry}
            nowMs={nowMs}
            threadEntries={threadEntries}
            key={`${entry.txHash}-${entry.originalIndex}-detail`}
            renderStatus={renderStatus}
          />
        ))}
      </div>
    </section>
  );
}

function NonceThreadTimeline({
  entries,
  threadEntries,
  renderStatus,
}: {
  entries: HistoryReadModel[];
  threadEntries: HistoryReadModel[];
  renderStatus: (status: HistoryStatus) => JSX.Element;
}) {
  return (
    <section className="history-thread-timeline" aria-label="Nonce thread timeline">
      <header>
        <h4>Nonce Thread</h4>
        <p>{threadOutcomeSummary(threadEntries)}</p>
      </header>
      <ol>
        {entries.map((entry) => {
          const current = isCurrentPendingActionTarget(entry, threadEntries);
          return (
            <li key={`${entry.txHash}-${entry.originalIndex}-timeline`}>
              <div className="history-thread-step-main">
                <strong>{roleLabel(entry)}</strong>
                <span className="mono">{short(entry.txHash)}</span>
                {renderStatus(entry.status)}
                {current && <span className="history-thread-current">current pending action target</span>}
              </div>
              <div className="history-thread-step-meta">
                <span>{formatTimestamp(timestampValue(entry))}</span>
                <span>{relationshipLabel(entry)}</span>
                <span>ChainOutcome {entry.record.outcome.state}</span>
              </div>
              {entry.submissionRole === "cancellation" && (
                <p className="history-thread-note">
                  Cancel model: same nonce, 0 wei, sent from the account to itself with a higher fee.
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function threadOutcomeSummary(entries: HistoryReadModel[]) {
  const outcomes = sortedThreadEntries(entries)
    .filter((entry) => entry.status !== "pending" && entry.status !== "unknown")
    .map((entry) => `${entry.record.outcome.state} on ${short(entry.txHash)}`);
  return outcomes.length > 0 ? `Thread outcomes: ${outcomes.join("; ")}` : "Thread outcomes: Pending";
}

function HistorySubmissionDetails({
  entry,
  nowMs,
  threadEntries,
  renderStatus,
}: {
  entry: HistoryReadModel;
  nowMs: number;
  threadEntries: HistoryReadModel[];
  renderStatus: (status: HistoryStatus) => JSX.Element;
}) {
  const { record } = entry;
  const current = isCurrentPendingActionTarget(entry, threadEntries);
  const actionGates = getHistoryActionGates(entry, threadEntries);
  const pendingGuidance = getPendingAgeGuidance(entry, threadEntries, nowMs);
  const errorDisplay = getHistoryErrorDisplay({
    record,
    status: entry.status,
    identityIssues: entry.identityIssues,
    nowMs,
  });
  return (
    <article className="history-detail-record">
      <header className="history-detail-record-header">
        <div>
          <h4>
            {roleLabel(entry)} · <span className="mono">{short(entry.txHash)}</span>
          </h4>
          <p>
            {statusDescriptions[entry.status]}
            {current ? " This is the current pending submission for replace/cancel actions." : ""}
          </p>
        </div>
        {renderStatus(entry.status)}
      </header>
      {entry.submissionRole === "cancellation" && (
        <p className="history-thread-note">
          Cancel model: same nonce, 0 wei, sent from the account to itself with a higher fee.
        </p>
      )}
      {pendingGuidance && <HistoryPendingAgeGuidance guidance={pendingGuidance} />}
      {errorDisplay && (
        <HistoryErrorCard
          error={errorDisplay}
          meta={`${statusLabels[entry.status]} · chainId ${formatMaybe(entry.chainId)} · nonce ${formatMaybe(entry.nonce)}`}
        />
      )}
      {actionGates.length > 0 && <HistoryActionGuidance actions={actionGates} />}
      <div className="history-detail-grid">
        <HistoryDetailSection
          title="Intent"
          rows={[
            ["Snapshot source", record.intent_snapshot.source],
            ["Captured at", formatTimestamp(record.intent_snapshot.captured_at)],
            ["Account", `Account ${formatOptional(record.intent.account_index)} · ${short(formatOptional(record.intent.from))}`],
            ["chainId", formatOptional(record.intent.chain_id)],
            ["To", record.intent.to],
            ["Value", `${formatOptional(record.intent.value_wei)} wei`],
            ["Nonce input", formatOptional(record.intent.nonce)],
            ["Gas limit input", formatOptional(record.intent.gas_limit)],
            ["Max fee input", `${formatOptional(record.intent.max_fee_per_gas)} wei`],
            ["Priority fee input", `${formatOptional(record.intent.max_priority_fee_per_gas)} wei`],
          ]}
        />
        <HistoryDetailSection
          title="Submission"
          rows={[
            ["Source", record.submission.source],
            ["Kind", record.submission.kind],
            ["Draft key", record.submission.frozen_key],
            ["Tx hash", record.submission.tx_hash],
            ["Broadcasted at", formatTimestamp(record.submission.broadcasted_at)],
            ["Account", `Account ${formatOptional(record.submission.account_index)} · ${short(formatOptional(record.submission.from))}`],
            ["chainId", formatOptional(record.submission.chain_id)],
            ["To", record.submission.to],
            ["Value", `${formatOptional(record.submission.value_wei)} wei`],
            ["Nonce", formatOptional(record.submission.nonce)],
            ["Gas limit", formatOptional(record.submission.gas_limit)],
            ["Max fee", `${formatOptional(record.submission.max_fee_per_gas)} wei`],
            ["Priority fee", `${formatOptional(record.submission.max_priority_fee_per_gas)} wei`],
            ["Replaces tx", record.submission.replaces_tx_hash],
            ["Replaced by tx", record.nonce_thread.replaced_by_tx_hash],
            ["Thread role", roleLabel(entry)],
            ["Action target", current ? "Current pending submission" : "Not current pending"],
          ]}
        />
        <HistoryDetailSection title="ChainOutcome" rows={outcomeRows(entry)} />
      </div>
    </article>
  );
}

function outcomeRows(entry: HistoryReadModel): Array<[string, string | number | null | undefined]> {
  const { outcome } = entry.record;
  const receipt = outcome.receipt;
  const reconcile = outcome.reconcile_summary;
  const error = outcome.error_summary;
  const latestReview =
    outcome.dropped_review_history.length > 0
      ? outcome.dropped_review_history[outcome.dropped_review_history.length - 1]
      : null;
  const errorDisplay = getHistoryErrorDisplay({
    record: entry.record,
    status: entry.status,
    identityIssues: entry.identityIssues,
  });
  return [
    ["State", `${outcome.state} - ${statusDescriptions[entry.status]}`],
    ["Outcome tx hash", outcome.tx_hash],
    [outcomeTimeLabel(entry.status), formatTimestamp(outcome.finalized_at)],
    ["Reconciled at", formatTimestamp(outcome.reconciled_at)],
    ["Receipt status", receipt?.status],
    ["Receipt block", receipt?.block_number],
    ["Receipt block hash", receipt?.block_hash],
    ["Receipt index", receipt?.transaction_index],
    ["Receipt gas used", receipt?.gas_used],
    ["Receipt effective gas price", receipt?.effective_gas_price],
    ["Reconcile source", reconcile?.source],
    ["Reconcile checked at", formatTimestamp(reconcile?.checked_at ?? null)],
    ["Reconcile RPC chainId", reconcile?.rpc_chain_id],
    ["Reconcile latest confirmed nonce", reconcile?.latest_confirmed_nonce],
    ["Reconcile decision", reconcile?.decision],
    ["Dropped review count", outcome.dropped_review_history.length || null],
    ["Original dropped decision", latestReview?.original_reconcile_summary?.decision],
    ["Original dropped source", latestReview?.original_reconcile_summary?.source],
    ["Original dropped at", formatTimestamp(latestReview?.original_reconciled_at ?? null)],
    ["Latest review at", formatTimestamp(latestReview?.reviewed_at ?? null)],
    ["Latest review source", latestReview?.source],
    ["Latest review RPC endpoint", latestReview?.rpc_endpoint_summary],
    ["Latest review requested chainId", latestReview?.requested_chain_id],
    ["Latest review RPC chainId", latestReview?.rpc_chain_id],
    ["Latest review transaction found", formatOptionalBoolean(latestReview?.transaction_found)],
    ["Latest review latest confirmed nonce", latestReview?.latest_confirmed_nonce],
    ["Latest review local same nonce tx", latestReview?.local_same_nonce_tx_hash],
    ["Latest review local same nonce state", latestReview?.local_same_nonce_state],
    ["Latest review result", latestReview?.result_state],
    ["Latest review decision", latestReview?.decision],
    ["Latest review recommendation", latestReview?.recommendation],
    ["Latest review error source", latestReview?.error_summary?.source],
    ["Latest review error category", latestReview?.error_summary?.category],
    ["Latest review error", latestReview?.error_summary?.message],
    ["Error class", errorDisplay?.label],
    ["Error title", errorDisplay?.title],
    ["Error source", errorDisplay?.source ?? error?.source],
    ["Error category", errorDisplay?.category ?? error?.category],
    ["Error message", errorDisplay?.message],
    ["Thread key", entry.record.nonce_thread.key],
    ["Thread replaced by", entry.record.nonce_thread.replaced_by_tx_hash],
  ];
}

function outcomeTimeLabel(status: HistoryStatus) {
  switch (status) {
    case "confirmed":
      return "Confirmed at";
    case "failed":
      return "Failed at";
    case "replaced":
      return "Replaced at";
    case "cancelled":
      return "Cancelled at";
    case "dropped":
      return "Dropped at";
    case "pending":
      return "Finalized at";
    case "unknown":
      return "Finalized at";
  }
}

function PendingRecommendationLine({ recommendation }: { recommendation: PendingAgeRecommendation }) {
  return (
    <li>
      <strong>{recommendation.label}</strong>
      <span>{recommendation.enabled ? "Available" : "Disabled"}</span>
      <p>{recommendation.reason}</p>
    </li>
  );
}

function HistoryPendingAgeBadge({ guidance }: { guidance: PendingAgeGuidance | null }) {
  if (!guidance) return null;
  return (
    <span
      className={`history-pending-age history-pending-age-${guidance.state}`}
      title={`${guidance.label}: ${guidance.summary}`}
    >
      Age {guidance.ageLabel} · checked {guidance.checkedLabel}
    </span>
  );
}

function HistoryPendingActionSummary({ guidance }: { guidance: PendingAgeGuidance }) {
  const primary = guidance.recommendations.find((item) => item.kind === "reconcile");
  const disabled = guidance.recommendations.filter((item) => !item.enabled).slice(0, 2);
  return (
    <div className={`history-pending-summary history-pending-summary-${guidance.state}`}>
      <strong>{guidance.label}</strong>
      <span>
        Age {guidance.ageLabel}; last check {guidance.checkedLabel}.
      </span>
      <span>{guidance.summary}</span>
      {primary && (
        <span>
          Suggested: {primary.label} ({primary.enabled ? "available" : `disabled: ${primary.reason}`})
        </span>
      )}
      {disabled.map((item) => (
        <span key={item.kind}>
          {item.label}: disabled - {item.reason}
        </span>
      ))}
    </div>
  );
}

function HistoryPendingAgeGuidance({ guidance }: { guidance: PendingAgeGuidance }) {
  return (
    <section className="history-action-guidance history-pending-guidance" aria-label="Pending age guidance">
      <h5>Pending Age</h5>
      <p>{guidance.summary}</p>
      <dl className="history-pending-guidance-facts">
        <div>
          <dt>Status</dt>
          <dd>{guidance.label}</dd>
        </div>
        <div>
          <dt>Pending age</dt>
          <dd>{guidance.ageLabel}</dd>
        </div>
        <div>
          <dt>Broadcasted at</dt>
          <dd>{formatTimestamp(guidance.broadcastedAt)}</dd>
        </div>
        <div>
          <dt>Last check</dt>
          <dd>
            {guidance.checkedAt ? `${formatTimestamp(guidance.checkedAt)} (${guidance.checkedLabel})` : "Unknown"}
          </dd>
        </div>
      </dl>
      <ul>
        {guidance.recommendations.map((recommendation) => (
          <PendingRecommendationLine key={recommendation.kind} recommendation={recommendation} />
        ))}
      </ul>
      <div className="history-pending-evidence">
        {guidance.evidence.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </section>
  );
}

function HistoryActionGuidance({ actions }: { actions: HistoryActionGate[] }) {
  return (
    <section className="history-action-guidance" aria-label="Action guidance">
      <h5>Action Guidance</h5>
      <ul>
        {actions.map((action) => (
          <li key={action.kind}>
            <strong>{action.label}</strong>
            <span>{action.enabled ? "Available" : "Disabled"}</span>
            <p>{action.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HistoryDetailSection({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string | number | null | undefined]>;
}) {
  return (
    <section className="history-detail-section">
      <h5>{title}</h5>
      <dl>
        {rows.map(([label, value]) => (
          <div className="history-detail-row" key={label}>
            <dt>{label}</dt>
            <dd className="mono">{formatOptional(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
