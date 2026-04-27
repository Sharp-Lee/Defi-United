import { useMemo, useState } from "react";
import {
  groupHistoryByNonce,
  selectHistoryEntries,
  type HistoryNonceGroup,
  type HistoryReadModel,
  type HistorySelectorFilters,
  type HistoryStatus,
} from "../../core/history/selectors";
import type { HistoryRecord, PendingMutationRequest } from "../../lib/tauri";

const ALL = "__all__";
const UNKNOWN = "__unknown__";
const ACCOUNT_KEY_PREFIX = "key:";
const ACCOUNT_INDEX_PREFIX = "index:";
const ACCOUNT_FROM_PREFIX = "from:";

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

function short(value: string) {
  return value.length > 14 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value;
}

function formatMaybe(value: string | number | null) {
  return value === null ? "Unknown" : value.toString();
}

function formatOptional(value: string | number | null | undefined) {
  return value === null || value === undefined ? "Unknown" : value.toString();
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

function isSupersededInThread(entry: HistoryReadModel, entries: HistoryReadModel[]) {
  return (
    entry.replacedByTxHash !== null ||
    entry.status === "replaced" ||
    entry.status === "cancelled" ||
    entries.some((candidate) => candidate.replacesTxHash === entry.txHash)
  );
}

function isActionablePending(entry: HistoryReadModel, entries: HistoryReadModel[]) {
  return (
    entry.status === "pending" &&
    entries.some((candidate) => candidate.originalIndex === entry.originalIndex) &&
    !isSupersededInThread(entry, entries)
  );
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

function pendingRequestFromRecord(record: HistoryRecord): PendingMutationRequest {
  return {
    txHash: record.submission.tx_hash,
    rpcUrl: record.intent.rpc_url,
    accountIndex: record.intent.account_index,
    chainId: record.intent.chain_id,
    from: record.intent.from,
    nonce: record.intent.nonce,
    gasLimit: record.intent.gas_limit,
    maxFeePerGas: bumpWei(record.intent.max_fee_per_gas),
    maxPriorityFeePerGas: bumpWei(record.intent.max_priority_fee_per_gas),
    to: record.intent.to,
    valueWei: record.intent.value_wei,
  };
}

export function HistoryView({
  items,
  onRefresh,
  onReplace,
  onCancelPending,
  disabled = false,
  loading = false,
  error = null,
}: {
  items: HistoryRecord[];
  onRefresh: () => Promise<void> | void;
  onReplace?: (request: PendingMutationRequest) => Promise<void> | void;
  onCancelPending?: (request: PendingMutationRequest) => Promise<void> | void;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
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
  const statusMessage = refreshError ?? error;

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
    const current = isActionablePending(entry, threadEntries);
    return (
      <div className="button-row history-actions">
        {renderDetailButton(entry)}
        {current && (
          <>
            <button
              className="secondary-button"
              disabled={disabled}
              onClick={() => onReplace?.(pendingRequestFromRecord(entry.record))}
              type="button"
            >
              Replace {short(entry.txHash)}
            </button>
            <button
              className="secondary-button"
              disabled={disabled}
              onClick={() => onCancelPending?.(pendingRequestFromRecord(entry.record))}
              type="button"
            >
              Cancel {short(entry.txHash)}
            </button>
          </>
        )}
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
      {statusMessage && <div className="inline-error">{statusMessage}</div>}
      {isBusy && items.length === 0 && <div className="inline-warning">Loading transaction history...</div>}
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
                  <td>{renderStatus(entry.status)}</td>
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
                          {isActionablePending(
                            entry,
                            allThreadEntriesByKey.get(group.key) ?? [],
                          ) && (
                            <span className="history-thread-current"> current pending</span>
                          )}
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
          onClose={() => setDetailSelection(null)}
          renderStatus={renderStatus}
        />
      )}
    </section>
  );
}

function HistoryDetails({
  detail,
  onClose,
  renderStatus,
}: {
  detail:
    | { type: "submission"; entry: HistoryReadModel; threadEntries: HistoryReadModel[] }
    | { type: "thread"; group: HistoryNonceGroup; threadEntries: HistoryReadModel[] };
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
          const current = isActionablePending(entry, threadEntries);
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
  threadEntries,
  renderStatus,
}: {
  entry: HistoryReadModel;
  threadEntries: HistoryReadModel[];
  renderStatus: (status: HistoryStatus) => JSX.Element;
}) {
  const { record } = entry;
  const current = isActionablePending(entry, threadEntries);
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
    ["Error source", error?.source],
    ["Error category", error?.category],
    ["Error message", error?.message],
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
