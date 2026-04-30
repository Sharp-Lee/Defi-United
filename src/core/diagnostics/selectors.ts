import type { DiagnosticEvent, DiagnosticEventQuery, DiagnosticLevel } from "../../lib/tauri";

export const ALL_DIAGNOSTIC_FILTER = "__all__";
export const DEFAULT_DIAGNOSTIC_LIMIT = 200;

export type DiagnosticTimeWindow = "all" | "hour" | "day" | "week";

export interface DiagnosticViewFilters {
  category: string;
  timeWindow: DiagnosticTimeWindow;
  chainId: string;
  account: string;
  txHash: string;
  level: string;
  status: string;
}

export interface DiagnosticEventViewModel {
  event: DiagnosticEvent;
  timestampLabel: string;
  categoryLabel: string;
  levelLabel: string;
  chainLabel: string;
  accountLabel: string;
  nonceLabel: string;
  txHashLabel: string;
  stageLabel: string;
  statusLabel: string;
  summary: string;
}

const ONE_HOUR_SECONDS = 60 * 60;
const ONE_DAY_SECONDS = 24 * ONE_HOUR_SECONDS;
const ONE_WEEK_SECONDS = 7 * ONE_DAY_SECONDS;
const UNKNOWN = "Unknown";

export function defaultDiagnosticFilters(): DiagnosticViewFilters {
  return {
    category: ALL_DIAGNOSTIC_FILTER,
    timeWindow: "all",
    chainId: ALL_DIAGNOSTIC_FILTER,
    account: "",
    txHash: "",
    level: ALL_DIAGNOSTIC_FILTER,
    status: "",
  };
}

export function diagnosticQueryFromFilters(
  filters: DiagnosticViewFilters,
  nowMs = Date.now(),
): DiagnosticEventQuery {
  return pruneQuery({
    limit: DEFAULT_DIAGNOSTIC_LIMIT,
    category: filters.category === ALL_DIAGNOSTIC_FILTER ? undefined : filters.category,
    sinceTimestamp: sinceTimestampForWindow(filters.timeWindow, nowMs),
    chainId:
      filters.chainId === ALL_DIAGNOSTIC_FILTER || filters.chainId === ""
        ? undefined
        : Number(filters.chainId),
    account: filters.account.trim() || undefined,
    txHash: filters.txHash.trim() || undefined,
    level: filters.level === ALL_DIAGNOSTIC_FILTER ? undefined : diagnosticLevel(filters.level),
    status: filters.status.trim() || undefined,
  });
}

export function selectDiagnosticEvents(
  events: DiagnosticEvent[],
  filters: DiagnosticViewFilters = defaultDiagnosticFilters(),
  nowMs = Date.now(),
) {
  const query = diagnosticQueryFromFilters(filters, nowMs);
  return events
    .filter((event) => matchesDiagnosticQuery(event, query))
    .sort((left, right) => timestampMillis(right.timestamp) - timestampMillis(left.timestamp))
    .slice(0, query.limit ?? DEFAULT_DIAGNOSTIC_LIMIT)
    .map(toDiagnosticViewModel);
}

export function selectDiagnosticEventViews(events: DiagnosticEvent[]) {
  return [...events]
    .sort((left, right) => timestampMillis(right.timestamp) - timestampMillis(left.timestamp))
    .map(toDiagnosticViewModel);
}

export function diagnosticFilterOptions(events: DiagnosticEvent[]) {
  const categories = new Set<string>();
  const chainIds = new Set<number>();
  const levels = new Set<string>();
  for (const event of events) {
    if (event.category) categories.add(event.category);
    if (event.chainId !== undefined) chainIds.add(event.chainId);
    levels.add(event.level);
  }
  return {
    categories: Array.from(categories).sort((left, right) => left.localeCompare(right)),
    chainIds: Array.from(chainIds).sort((left, right) => left - right),
    levels: Array.from(levels).sort((left, right) => left.localeCompare(right)),
  };
}

export function diagnosticExportScopeSummary(query: DiagnosticEventQuery) {
  const parts = [`up to ${query.limit ?? DEFAULT_DIAGNOSTIC_LIMIT} recent events`];
  if (query.category) parts.push(`category ${sanitizeScopePreviewValue(query.category)}`);
  if (query.sinceTimestamp) parts.push(`since ${formatTimestamp(String(query.sinceTimestamp))}`);
  if (query.untilTimestamp) parts.push(`until ${formatTimestamp(String(query.untilTimestamp))}`);
  if (query.chainId !== undefined) parts.push(`chainId ${query.chainId}`);
  if (query.account) {
    parts.push(`account/address matching "${sanitizeScopePreviewValue(query.account)}"`);
  }
  if (query.txHash) parts.push(`tx hash matching "${sanitizeScopePreviewValue(query.txHash)}"`);
  if (query.level) parts.push(`level ${query.level}`);
  if (query.status) {
    parts.push(`status/stage matching "${sanitizeScopePreviewValue(query.status)}"`);
  }
  return parts.join("; ");
}

export function diagnosticSensitiveExclusionText() {
  return "Exports contain only sanitized diagnostic metadata: category, time, chainId, account/address summaries, nonce, tx hash, stage, status/level, error summary and sanitized metadata. They exclude mnemonics, private keys, seed material, passwords, signatures, raw signed transactions, query tokens, full credentials, vault data, app-config source, history source, full logs, raw provider responses, hot contract sample payloads, local history match details, local history examples, classification truth, analysis labels and unredacted RPC URL secrets.";
}

export function toDiagnosticViewModel(event: DiagnosticEvent): DiagnosticEventViewModel {
  const stage = firstMetadataValue(event.metadata, ["stage", "phase", "source"]);
  const nonce = firstMetadataValue(event.metadata, ["nonce"]);
  const status = firstMetadataValue(event.metadata, [
    "status",
    "state",
    "nextState",
    "decision",
  ]);
  return {
    event,
    timestampLabel: formatTimestamp(event.timestamp),
    categoryLabel: event.category || UNKNOWN,
    levelLabel: titleCase(event.level),
    chainLabel: event.chainId === undefined ? UNKNOWN : `chainId ${event.chainId}`,
    accountLabel: accountSummary(event),
    nonceLabel: nonce ?? UNKNOWN,
    txHashLabel: event.txHash ?? UNKNOWN,
    stageLabel: stage ?? event.source ?? UNKNOWN,
    statusLabel: status ?? titleCase(event.level),
    summary: event.message ?? event.event,
  };
}

function matchesDiagnosticQuery(event: DiagnosticEvent, query: DiagnosticEventQuery) {
  if (query.category && event.category.toLowerCase() !== query.category.toLowerCase()) {
    return false;
  }
  if (query.chainId !== undefined && event.chainId !== query.chainId) {
    return false;
  }
  if (query.level && event.level !== query.level) {
    return false;
  }
  const seconds = timestampSeconds(event.timestamp);
  if (query.sinceTimestamp !== undefined && (seconds === null || seconds < query.sinceTimestamp)) {
    return false;
  }
  if (query.untilTimestamp !== undefined && (seconds === null || seconds > query.untilTimestamp)) {
    return false;
  }
  if (query.account && !accountSearchText(event).includes(query.account.toLowerCase())) {
    return false;
  }
  if (query.txHash && !(event.txHash ?? "").toLowerCase().includes(query.txHash.toLowerCase())) {
    return false;
  }
  if (query.status && !statusSearchText(event).includes(query.status.toLowerCase())) {
    return false;
  }
  return true;
}

function pruneQuery(query: DiagnosticEventQuery): DiagnosticEventQuery {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== ""),
  ) as DiagnosticEventQuery;
}

function diagnosticLevel(value: string): DiagnosticLevel | undefined {
  return value === "info" || value === "warn" || value === "error" ? value : undefined;
}

function sinceTimestampForWindow(window: DiagnosticTimeWindow, nowMs: number) {
  const nowSeconds = Math.floor(nowMs / 1000);
  switch (window) {
    case "hour":
      return nowSeconds - ONE_HOUR_SECONDS;
    case "day":
      return nowSeconds - ONE_DAY_SECONDS;
    case "week":
      return nowSeconds - ONE_WEEK_SECONDS;
    case "all":
      return undefined;
  }
}

function firstMetadataValue(metadata: Record<string, unknown>, keys: string[]) {
  const value = findMetadataValue(metadata, keys);
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function findMetadataValue(value: unknown, keys: string[]): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMetadataValue(item, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (keys.some((candidate) => key.toLowerCase() === candidate.toLowerCase())) {
      return item;
    }
  }
  for (const item of Object.values(record)) {
    const found = findMetadataValue(item, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function accountSummary(event: DiagnosticEvent) {
  const address = firstMetadataValue(event.metadata, [
    "accountAddress",
    "address",
    "from",
    "sender",
  ]);
  const index = event.accountIndex === undefined ? "?" : event.accountIndex.toString();
  if (address) return `Account ${index} · ${short(address)}`;
  if (event.accountIndex !== undefined) return `Account ${index}`;
  return UNKNOWN;
}

function accountSearchText(event: DiagnosticEvent) {
  const parts = [accountSummary(event)];
  if (event.accountIndex !== undefined) parts.push(String(event.accountIndex));
  for (const key of ["account", "accountAddress", "address", "from", "sender"]) {
    const value = firstMetadataValue(event.metadata, [key]);
    if (value) parts.push(value);
  }
  return parts.join(" ").toLowerCase();
}

function statusSearchText(event: DiagnosticEvent) {
  const parts = [event.level, event.event, event.source, event.category];
  for (const key of ["status", "state", "nextState", "decision", "stage", "phase"]) {
    const value = firstMetadataValue(event.metadata, [key]);
    if (value) parts.push(value);
  }
  return parts.join(" ").toLowerCase();
}

function timestampSeconds(value: string) {
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

function timestampMillis(value: string) {
  const seconds = timestampSeconds(value);
  return seconds === null ? 0 : seconds * 1000;
}

function formatTimestamp(value: string) {
  const millis = timestampMillis(value);
  if (millis === 0) return value || UNKNOWN;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(millis));
}

function short(value: string) {
  return value.length > 14 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value;
}

function titleCase(value: string) {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function sanitizeScopePreviewValue(value: string) {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (/[a-z][a-z0-9+.-]*:\/\/\S+/i.test(singleLine) || /[@?]/.test(singleLine)) {
    return "[redacted filter]";
  }
  if (/\b[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?\b/i.test(singleLine)) {
    return "[redacted filter]";
  }
  if (
    /\b(rpcurl|url|mnemonic|seed|password|passphrase|privatekey|private key|signature|signedtx|signed transaction|rawtx|raw transaction|payload|apikey|api key|accesstoken|access token|token|authorization|bearer|basic|auth|secret|key)\b/i.test(
      singleLine.replace(/[_-]/g, ""),
    )
  ) {
    return "[redacted filter]";
  }
  if (/\b0x[a-fA-F0-9]{80,}\b/.test(singleLine)) {
    return singleLine.replace(/\b0x[a-fA-F0-9]{80,}\b/g, "[redacted hex]");
  }
  return singleLine.length > 120 ? `${singleLine.slice(0, 120)}...` : singleLine;
}
