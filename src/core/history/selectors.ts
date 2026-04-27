import type { ChainOutcomeState, HistoryRecord, SubmissionKind } from "./schema";

export type HistoryStatus =
  | "pending"
  | "confirmed"
  | "failed"
  | "replaced"
  | "cancelled"
  | "dropped"
  | "unknown";

export type HistorySubmissionRole = "legacy" | "submission" | "replacement" | "cancellation";
export type HistoryIdentitySource = "submission" | "nonceThread" | "intent";
export type HistoryIdentityIssueKind = "incomplete" | "inconsistent";

export interface HistoryIdentityIssue {
  kind: HistoryIdentityIssueKind;
  field: "account" | "accountIndex" | "from" | "chainId" | "nonce";
  sources: HistoryIdentitySource[];
}

export interface HistoryAccountIdentity {
  key: string | null;
  accountIndex: number | null;
  from: string | null;
  normalizedFrom: string | null;
}

export interface HistoryNonceIdentity {
  account: HistoryAccountIdentity;
  chainId: number | null;
  nonce: number | null;
  key: string;
  identitySource: HistoryIdentitySource;
  identityComplete: boolean;
  identityConsistent: boolean;
  identityIssues: HistoryIdentityIssue[];
}

export interface HistoryReadModel extends HistoryNonceIdentity {
  record: HistoryRecord;
  txHash: string;
  status: HistoryStatus;
  submissionKind: SubmissionKind;
  submissionRole: HistorySubmissionRole;
  replacesTxHash: string | null;
  replacedByTxHash: string | null;
  broadcastedAt: string | null;
  originalIndex: number;
}

export interface HistoryNonceGroup extends HistoryNonceIdentity {
  submissions: HistoryReadModel[];
  statuses: HistoryStatus[];
  statusCounts: Record<HistoryStatus, number>;
  hasReplacement: boolean;
  hasCancellation: boolean;
}

export interface HistoryAccountFilter {
  key?: string;
  accountIndex?: number | null;
  from?: string | null;
}

export interface HistorySelectorFilters {
  account?: HistoryAccountFilter;
  chainId?: number | null;
  status?: HistoryStatus | ChainOutcomeState | Array<HistoryStatus | ChainOutcomeState>;
  nonce?: number | null;
}

interface IdentityCandidate {
  source: HistoryIdentitySource;
  accountIndex: number | null;
  from: string | null;
  normalizedFrom: string | null;
  accountKey: string | null;
  chainId: number | null;
  nonce: number | null;
}

const EMPTY_STATUS_COUNTS: Record<HistoryStatus, number> = {
  pending: 0,
  confirmed: 0,
  failed: 0,
  replaced: 0,
  cancelled: 0,
  dropped: 0,
  unknown: 0,
};

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function normalizeAddress(value: string | null) {
  return value === null ? null : value.toLowerCase();
}

function createAccountKey(accountIndex: number | null, normalizedFrom: string | null) {
  return accountIndex === null || normalizedFrom === null
    ? null
    : `index:${accountIndex}|from:${normalizedFrom}`;
}

function identityCandidate({
  source,
  accountIndex,
  from,
  chainId,
  nonce,
}: {
  source: HistoryIdentitySource;
  accountIndex: unknown;
  from: unknown;
  chainId: unknown;
  nonce: unknown;
}): IdentityCandidate {
  const normalizedAccountIndex = numberOrNull(accountIndex);
  const normalizedFrom = normalizeAddress(stringOrNull(from));
  return {
    source,
    accountIndex: normalizedAccountIndex,
    from: stringOrNull(from),
    normalizedFrom,
    accountKey: createAccountKey(normalizedAccountIndex, normalizedFrom),
    chainId: numberOrNull(chainId),
    nonce: numberOrNull(nonce),
  };
}

function isCompleteIdentity(candidate: IdentityCandidate) {
  return candidate.accountKey !== null && candidate.chainId !== null && candidate.nonce !== null;
}

function hasAnyIdentityValue(candidate: IdentityCandidate) {
  return (
    candidate.accountIndex !== null ||
    candidate.normalizedFrom !== null ||
    candidate.chainId !== null ||
    candidate.nonce !== null
  );
}

function isolationKey(record: HistoryRecord, originalIndex: number) {
  if (record.submission.tx_hash !== "unknown") return `txHash=${record.submission.tx_hash}`;
  if (record.outcome.tx_hash !== "unknown") return `outcomeTxHash=${record.outcome.tx_hash}`;
  if (record.submission.frozen_key !== "unknown") return `frozenKey=${record.submission.frozen_key}`;
  return `recordIndex=${originalIndex}`;
}

export function createHistoryGroupKey({
  accountKey,
  chainId,
  nonce,
  isolationKey,
}: {
  accountKey: string | null;
  chainId: number | null;
  nonce: number | null;
  isolationKey: string;
}) {
  if (accountKey === null || chainId === null || nonce === null) {
    return `isolated|${isolationKey}`;
  }
  return `account=${accountKey}|chainId=${chainId}|nonce=${nonce}`;
}

export function selectHistoryStatus(state: ChainOutcomeState): HistoryStatus {
  switch (state) {
    case "Pending":
      return "pending";
    case "Confirmed":
      return "confirmed";
    case "Failed":
      return "failed";
    case "Replaced":
      return "replaced";
    case "Cancelled":
      return "cancelled";
    case "Dropped":
      return "dropped";
    case "Unknown":
      return "unknown";
  }
}

export function selectSubmissionRole(kind: SubmissionKind): HistorySubmissionRole {
  switch (kind) {
    case "legacy":
      return "legacy";
    case "nativeTransfer":
      return "submission";
    case "replacement":
      return "replacement";
    case "cancellation":
      return "cancellation";
  }
}

export function selectHistoryIdentity(
  record: HistoryRecord,
  originalIndex = 0,
): HistoryNonceIdentity {
  const candidates = [
    identityCandidate({
      source: "submission",
      accountIndex: record.submission.account_index,
      from: record.submission.from,
      chainId: record.submission.chain_id,
      nonce: record.submission.nonce,
    }),
    identityCandidate({
      source: "nonceThread",
      accountIndex: record.nonce_thread.account_index,
      from: record.nonce_thread.from,
      chainId: record.nonce_thread.chain_id,
      nonce: record.nonce_thread.nonce,
    }),
    identityCandidate({
      source: "intent",
      accountIndex: record.intent.account_index,
      from: record.intent.from,
      chainId: record.intent.chain_id,
      nonce: record.intent.nonce,
    }),
  ];
  const selected =
    candidates.find(isCompleteIdentity) ??
    candidates.find(hasAnyIdentityValue) ??
    candidates[candidates.length - 1];
  const identityIssues = selectIdentityIssues(selected, candidates);
  const identityComplete = isCompleteIdentity(selected);

  return {
    account: {
      key: selected.accountKey,
      accountIndex: selected.accountIndex,
      from: selected.from,
      normalizedFrom: selected.normalizedFrom,
    },
    chainId: selected.chainId,
    nonce: selected.nonce,
    key: createHistoryGroupKey({
      accountKey: selected.accountKey,
      chainId: selected.chainId,
      nonce: selected.nonce,
      isolationKey: isolationKey(record, originalIndex),
    }),
    identitySource: selected.source,
    identityComplete,
    identityConsistent: !identityIssues.some((issue) => issue.kind === "inconsistent"),
    identityIssues,
  };
}

export function selectHistoryEntries(
  records: HistoryRecord[],
  filters: HistorySelectorFilters = {},
): HistoryReadModel[] {
  const statuses = normalizeStatusFilter(filters.status);
  return records
    .map((record, originalIndex) => {
      const identity = selectHistoryIdentity(record, originalIndex);
      return {
        ...identity,
        record,
        txHash: record.submission.tx_hash,
        status: selectHistoryStatus(record.outcome.state),
        submissionKind: record.submission.kind,
        submissionRole: selectSubmissionRole(record.submission.kind),
        replacesTxHash: record.submission.replaces_tx_hash ?? record.nonce_thread.replaces_tx_hash,
        replacedByTxHash: record.nonce_thread.replaced_by_tx_hash,
        broadcastedAt: record.submission.broadcasted_at,
        originalIndex,
      };
    })
    .filter((entry) => matchesFilters(entry, filters, statuses))
    .sort(compareHistoryEntries);
}

export function groupHistoryByNonce(
  records: HistoryRecord[],
  filters: HistorySelectorFilters = {},
): HistoryNonceGroup[] {
  const groups = new Map<string, HistoryNonceGroup>();

  for (const entry of selectHistoryEntries(records, filters)) {
    const existing = groups.get(entry.key);
    if (existing) {
      existing.submissions.push(entry);
      existing.statusCounts[entry.status] += 1;
      if (!existing.statuses.includes(entry.status)) {
        existing.statuses.push(entry.status);
      }
      existing.hasReplacement ||= entry.submissionRole === "replacement";
      existing.hasCancellation ||= entry.submissionRole === "cancellation";
      existing.identityConsistent &&= entry.identityConsistent;
      existing.identityIssues = mergeIdentityIssues(existing.identityIssues, entry.identityIssues);
      continue;
    }

    groups.set(entry.key, {
      account: entry.account,
      chainId: entry.chainId,
      nonce: entry.nonce,
      key: entry.key,
      identitySource: entry.identitySource,
      identityComplete: entry.identityComplete,
      identityConsistent: entry.identityConsistent,
      identityIssues: entry.identityIssues,
      submissions: [entry],
      statuses: [entry.status],
      statusCounts: { ...EMPTY_STATUS_COUNTS, [entry.status]: 1 },
      hasReplacement: entry.submissionRole === "replacement",
      hasCancellation: entry.submissionRole === "cancellation",
    });
  }

  return Array.from(groups.values()).sort(compareHistoryGroups);
}

function selectIdentityIssues(
  selected: IdentityCandidate,
  candidates: IdentityCandidate[],
): HistoryIdentityIssue[] {
  const issues: HistoryIdentityIssue[] = [];
  if (selected.accountKey === null) {
    issues.push({ kind: "incomplete", field: "account", sources: [selected.source] });
  }
  if (selected.chainId === null) {
    issues.push({ kind: "incomplete", field: "chainId", sources: [selected.source] });
  }
  if (selected.nonce === null) {
    issues.push({ kind: "incomplete", field: "nonce", sources: [selected.source] });
  }

  addInconsistencyIssue(issues, candidates, "accountIndex", (candidate) => candidate.accountIndex);
  addInconsistencyIssue(issues, candidates, "from", (candidate) => candidate.normalizedFrom);
  addInconsistencyIssue(issues, candidates, "chainId", (candidate) => candidate.chainId);
  addInconsistencyIssue(issues, candidates, "nonce", (candidate) => candidate.nonce);
  return issues;
}

function addInconsistencyIssue(
  issues: HistoryIdentityIssue[],
  candidates: IdentityCandidate[],
  field: Extract<HistoryIdentityIssue["field"], "accountIndex" | "from" | "chainId" | "nonce">,
  selectValue: (candidate: IdentityCandidate) => string | number | null,
) {
  const seen = new Map<string | number, HistoryIdentitySource[]>();
  for (const candidate of candidates) {
    const value = selectValue(candidate);
    if (value === null) continue;
    const sources = seen.get(value) ?? [];
    sources.push(candidate.source);
    seen.set(value, sources);
  }
  if (seen.size > 1) {
    issues.push({
      kind: "inconsistent",
      field,
      sources: Array.from(seen.values()).flat(),
    });
  }
}

function mergeIdentityIssues(
  existing: HistoryIdentityIssue[],
  next: HistoryIdentityIssue[],
): HistoryIdentityIssue[] {
  const merged = new Map<string, HistoryIdentityIssue>();
  for (const issue of [...existing, ...next]) {
    const key = `${issue.kind}:${issue.field}`;
    const previous = merged.get(key);
    if (previous === undefined) {
      merged.set(key, { ...issue, sources: [...issue.sources] });
      continue;
    }
    previous.sources = mergeIdentityIssueSources(previous.sources, issue.sources);
  }
  return Array.from(merged.values());
}

function mergeIdentityIssueSources(
  existing: HistoryIdentitySource[],
  next: HistoryIdentitySource[],
) {
  return Array.from(new Set([...existing, ...next]));
}

function normalizeStatusFilter(
  status: HistorySelectorFilters["status"],
): Set<HistoryStatus> | null {
  if (status === undefined) return null;
  const values = Array.isArray(status) ? status : [status];
  return new Set(
    values.map((value) =>
      value === value.toLowerCase()
        ? (value as HistoryStatus)
        : selectHistoryStatus(value as ChainOutcomeState),
    ),
  );
}

function matchesFilters(
  entry: HistoryReadModel,
  filters: HistorySelectorFilters,
  statuses: Set<HistoryStatus> | null,
) {
  if (filters.chainId !== undefined && entry.chainId !== filters.chainId) return false;
  if (filters.nonce !== undefined && entry.nonce !== filters.nonce) return false;
  if (statuses !== null && !statuses.has(entry.status)) return false;
  if (filters.account === undefined) return true;

  const { key, accountIndex, from } = filters.account;
  if (key !== undefined && entry.account.key !== key) return false;
  if (accountIndex !== undefined && entry.account.accountIndex !== accountIndex) return false;
  if (from !== undefined && entry.account.normalizedFrom !== normalizeAddress(from)) return false;
  return true;
}

function compareHistoryEntries(left: HistoryReadModel, right: HistoryReadModel) {
  if (!left.identityComplete && !right.identityComplete) {
    return left.originalIndex - right.originalIndex;
  }
  if (left.identityComplete !== right.identityComplete) {
    return left.identityComplete ? -1 : 1;
  }
  return (
    compareNullableNumbers(left.chainId, right.chainId) ||
    compareNullableStrings(left.account.key, right.account.key) ||
    compareNullableNumbers(left.nonce, right.nonce) ||
    compareNullableStrings(left.broadcastedAt, right.broadcastedAt) ||
    left.originalIndex - right.originalIndex
  );
}

function compareHistoryGroups(left: HistoryNonceGroup, right: HistoryNonceGroup) {
  if (!left.identityComplete && !right.identityComplete) {
    return left.submissions[0].originalIndex - right.submissions[0].originalIndex;
  }
  if (left.identityComplete !== right.identityComplete) {
    return left.identityComplete ? -1 : 1;
  }
  return (
    compareNullableNumbers(left.chainId, right.chainId) ||
    compareNullableStrings(left.account.key, right.account.key) ||
    compareNullableNumbers(left.nonce, right.nonce) ||
    left.submissions[0].originalIndex - right.submissions[0].originalIndex
  );
}

function compareNullableNumbers(left: number | null, right: number | null) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function compareNullableStrings(left: string | null, right: string | null) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}
