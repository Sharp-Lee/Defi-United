import type {
  AbiCacheEntryRecord,
  AbiCacheStatus,
  AbiFetchSourceStatus,
  AbiRegistryState,
  AbiSelectionStatus,
  AbiSelectorSummaryRecord,
  AbiSourceKind,
  AbiValidationStatus,
} from "../../lib/tauri";

export interface AbiReadModelSourceRef {
  chainId: number;
  contractAddress: string;
  sourceKind: AbiSourceKind;
  providerConfigId?: string | null;
  userSourceId?: string | null;
  versionId: string;
}

export type AbiReadModelReason =
  | "unknown"
  | "notSelected"
  | Exclude<AbiFetchSourceStatus, "ok">
  | Exclude<AbiValidationStatus, "ok">
  | Exclude<AbiCacheStatus, "cacheFresh">
  | Exclude<AbiSelectionStatus, "selected">;

export interface AbiSelectorFacingSummary {
  functionSelectorCount: number;
  eventTopicCount: number;
  errorSelectorCount: number;
  duplicateSelectorCount: number;
  conflictCount: number;
  notes: string | null;
}

export interface AbiReadModelEntry extends AbiReadModelSourceRef {
  sourceKey: string;
  selected: boolean;
  usable: boolean;
  reasons: AbiReadModelReason[];
  fetchSourceStatus: AbiFetchSourceStatus;
  validationStatus: AbiValidationStatus;
  cacheStatus: AbiCacheStatus;
  selectionStatus: AbiSelectionStatus;
  functionCount: number;
  eventCount: number;
  errorCount: number;
  selectorSummary: AbiSelectorFacingSummary;
  abiHash: string;
  sourceFingerprint: string;
  fetchedAt: string | null;
  importedAt: string | null;
  lastValidatedAt: string | null;
  staleAfter: string | null;
}

export interface AbiContractReadModel {
  chainId: number;
  contractAddress: string;
  entries: AbiReadModelEntry[];
  selectedEntry: AbiReadModelEntry | null;
  reasons: AbiReadModelReason[];
}

export interface AbiReadModelQuery {
  chainId: number;
  contractAddress: string;
  source?: Partial<Omit<AbiReadModelSourceRef, "chainId" | "contractAddress">>;
}

export function buildAbiContractReadModel(
  state: AbiRegistryState,
  query: AbiReadModelQuery,
): AbiContractReadModel {
  const entries = listAbiReadModelEntries(state, query);
  const requestedSource = query.source;
  const candidates = requestedSource
    ? entries.filter((entry) => sourceMatches(entry, requestedSource))
    : entries.filter((entry) => entry.selected);
  const selectedEntry = candidates.find((entry) => entry.usable) ?? null;

  return {
    chainId: query.chainId,
    contractAddress: query.contractAddress,
    entries,
    selectedEntry,
    reasons: selectedEntry
      ? []
      : reasonsForCandidates(candidates, entries, requestedSource === undefined),
  };
}

export function listAbiReadModelEntries(
  state: AbiRegistryState,
  query: Pick<AbiReadModelQuery, "chainId" | "contractAddress">,
): AbiReadModelEntry[] {
  const contractAddress = normalizeAddress(query.contractAddress);
  return state.cacheEntries
    .filter(
      (entry) =>
        entry.chainId === query.chainId &&
        normalizeAddress(entry.contractAddress) === contractAddress,
    )
    .map(toReadModelEntry)
    .sort((left, right) => compareCodeUnits(left.sourceKey, right.sourceKey));
}

export function findAbiReadModelEntry(
  state: AbiRegistryState,
  source: AbiReadModelSourceRef,
): AbiReadModelEntry | null {
  return (
    listAbiReadModelEntries(state, source).find((entry) =>
      sourceMatches(entry, {
        sourceKind: source.sourceKind,
        providerConfigId: source.providerConfigId,
        userSourceId: source.userSourceId,
        versionId: source.versionId,
      }),
    ) ?? null
  );
}

export function isAbiEntryUsable(entry: AbiCacheEntryRecord): boolean {
  return (
    entry.selected &&
    entry.fetchSourceStatus === "ok" &&
    entry.validationStatus === "ok" &&
    entry.cacheStatus === "cacheFresh" &&
    entry.selectionStatus === "selected"
  );
}

function toReadModelEntry(entry: AbiCacheEntryRecord): AbiReadModelEntry {
  const sourceRef = {
    chainId: entry.chainId,
    contractAddress: entry.contractAddress,
    sourceKind: entry.sourceKind,
    providerConfigId: entry.providerConfigId ?? null,
    userSourceId: entry.userSourceId ?? null,
    versionId: entry.versionId,
  };
  const reasons = reasonsForEntry(entry);
  return {
    ...sourceRef,
    sourceKey: sourceKey(sourceRef),
    selected: entry.selected,
    usable: reasons.length === 0,
    reasons,
    fetchSourceStatus: entry.fetchSourceStatus,
    validationStatus: entry.validationStatus,
    cacheStatus: entry.cacheStatus,
    selectionStatus: entry.selectionStatus,
    functionCount: entry.functionCount ?? 0,
    eventCount: entry.eventCount ?? 0,
    errorCount: entry.errorCount ?? 0,
    selectorSummary: selectorFacingSummary(entry.selectorSummary),
    abiHash: entry.abiHash,
    sourceFingerprint: entry.sourceFingerprint,
    fetchedAt: entry.fetchedAt ?? null,
    importedAt: entry.importedAt ?? null,
    lastValidatedAt: entry.lastValidatedAt ?? null,
    staleAfter: entry.staleAfter ?? null,
  };
}

function reasonsForEntry(entry: AbiCacheEntryRecord): AbiReadModelReason[] {
  const reasons: AbiReadModelReason[] = [];
  if (!entry.selected) {
    reasons.push("notSelected");
  }
  if (entry.fetchSourceStatus !== "ok") {
    reasons.push(entry.fetchSourceStatus);
  }
  if (entry.validationStatus !== "ok") {
    reasons.push(entry.validationStatus);
  }
  if (entry.cacheStatus !== "cacheFresh") {
    reasons.push(entry.cacheStatus);
  }
  if (entry.selectionStatus !== "selected") {
    reasons.push(entry.selectionStatus);
  }
  return Array.from(new Set(reasons));
}

function reasonsForCandidates(
  candidates: AbiReadModelEntry[],
  entries: AbiReadModelEntry[],
  aggregateAllEntries: boolean,
): AbiReadModelReason[] {
  if (aggregateAllEntries) {
    if (entries.length === 0) {
      return ["unknown"];
    }
    return uniqueReasons([
      "needsUserChoice",
      ...entries.flatMap((entry) => entry.reasons),
    ]);
  }
  if (candidates.length === 0) {
    return ["unknown"];
  }
  return uniqueReasons(candidates.flatMap((entry) => entry.reasons));
}

function sourceMatches(
  entry: AbiReadModelEntry,
  source: Partial<Omit<AbiReadModelSourceRef, "chainId" | "contractAddress">>,
) {
  return (
    (source.sourceKind === undefined || entry.sourceKind === source.sourceKind) &&
    (source.providerConfigId === undefined ||
      nullKey(entry.providerConfigId) === nullKey(source.providerConfigId)) &&
    (source.userSourceId === undefined ||
      nullKey(entry.userSourceId) === nullKey(source.userSourceId)) &&
    (source.versionId === undefined || entry.versionId === source.versionId)
  );
}

function selectorFacingSummary(
  summary: AbiSelectorSummaryRecord | null | undefined,
): AbiSelectorFacingSummary {
  return {
    functionSelectorCount: summary?.functionSelectorCount ?? 0,
    eventTopicCount: summary?.eventTopicCount ?? 0,
    errorSelectorCount: summary?.errorSelectorCount ?? 0,
    duplicateSelectorCount: summary?.duplicateSelectorCount ?? 0,
    conflictCount: summary?.conflictCount ?? 0,
    notes: redactText(summary?.notes ?? null),
  };
}

function sourceKey(source: AbiReadModelSourceRef): string {
  return [
    source.chainId.toString(),
    normalizeAddress(source.contractAddress),
    source.sourceKind,
    nullKey(source.providerConfigId),
    nullKey(source.userSourceId),
    source.versionId,
  ].join(":");
}

function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

function nullKey(value: string | null | undefined) {
  return value ?? "";
}

function uniqueReasons(reasons: AbiReadModelReason[]) {
  return Array.from(new Set(reasons));
}

function compareCodeUnits(left: string, right: string) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function redactText(value: string | null) {
  if (!value) {
    return null;
  }
  return value
    .replace(/https?:\/\/\S+/gi, "[redacted_url]")
    .replace(/\b(api_?key|apikey|token|access_token|key)=\S+/gi, "$1=[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]");
}
