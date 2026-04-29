import type {
  AbiCacheEntryRecord,
  AbiCacheStatus,
  AbiCalldataPreviewResult,
  AbiDecodedFieldSummary,
  AbiDecodedValueSummary,
  AbiFetchSourceStatus,
  AbiFunctionSchema,
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

export interface AbiWriteDraftSelectedRpcSummary {
  chainId: number | null;
  endpointSummary: string | null;
}

export interface AbiWriteDraftStatus {
  level: "info" | "warning" | "blocking";
  code: string;
  message: string;
  source: string;
}

export interface AbiWriteDraftInput {
  selectedChainId: number;
  chainLabel: string;
  accountIndex: number | null;
  from: string | null;
  rpcConfigured: boolean;
  selectedRpc: AbiWriteDraftSelectedRpcSummary | null;
  entry: AbiCacheEntryRecord | null;
  fn: AbiFunctionSchema | null;
  preview: AbiCalldataPreviewResult | null;
  nativeValueWei: string;
  gasLimit: string;
  latestBaseFeeGwei: string;
  baseFeeGwei: string;
  baseFeeMultiplier: string;
  maxFeeOverrideGwei: string;
  priorityFeeGwei: string;
  nonce: string;
  createdAt: string;
}

export interface AbiWriteDraftReadModel {
  draftId: string;
  frozenKey: string;
  createdAt: string;
  chainId: number;
  chainLabel: string;
  accountIndex: number;
  from: string;
  contractAddress: string;
  sourceKind: AbiSourceKind;
  providerConfigId: string | null;
  userSourceId: string | null;
  versionId: string;
  abiHash: string;
  sourceFingerprint: string;
  functionSignature: string;
  selector: string | null;
  argumentSummary: AbiDecodedValueSummary[];
  argumentHash: string | null;
  calldataHash: string | null;
  calldataByteLength: number | null;
  nativeValueWei: string;
  gasLimit: string;
  latestBaseFeePerGas: string | null;
  baseFeePerGas: string;
  baseFeeMultiplier: string;
  maxFeePerGas: string;
  maxFeeOverridePerGas: string | null;
  maxPriorityFeePerGas: string;
  nonce: number;
  selectedRpc: AbiWriteDraftSelectedRpcSummary | null;
  warnings: AbiWriteDraftStatus[];
  blockingStatuses: AbiWriteDraftStatus[];
  canSubmit: false;
}

export interface AbiWriteDraftBuildResult {
  draft: AbiWriteDraftReadModel | null;
  warnings: AbiWriteDraftStatus[];
  blockingStatuses: AbiWriteDraftStatus[];
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

export function buildAbiWriteDraft(input: AbiWriteDraftInput): AbiWriteDraftBuildResult {
  const warnings: AbiWriteDraftStatus[] = [
    status("warning", "gasEstimationUnavailable", "Gas estimation unavailable; enter a manual gas limit.", "fee"),
  ];
  const blockingStatuses: AbiWriteDraftStatus[] = [];
  const entry = input.entry;
  const fn = input.fn;
  const preview = input.preview;

  if (!input.rpcConfigured) {
    blockingStatuses.push(status("blocking", "missingRpc", "Select and validate an RPC before drafting.", "rpc"));
  } else if (
    input.selectedRpc?.chainId !== null &&
    input.selectedRpc?.chainId !== undefined &&
    input.selectedRpc.chainId !== input.selectedChainId
  ) {
    blockingStatuses.push(
      status(
        "blocking",
        "chainMismatch",
        `RPC returned chainId ${input.selectedRpc.chainId}; expected ${input.selectedChainId}.`,
        "rpc",
      ),
    );
  }
  if (input.accountIndex === null || !input.from) {
    blockingStatuses.push(status("blocking", "missingSelectedAccount", "Select a sender account.", "account"));
  }
  if (!entry) {
    blockingStatuses.push(status("blocking", "missingAbiEntry", "Select a managed ABI entry.", "abi"));
  } else {
    if (entry.chainId !== input.selectedChainId) {
      blockingStatuses.push(
        status("blocking", "chainMismatch", `ABI entry chainId ${entry.chainId} does not match selected chainId ${input.selectedChainId}.`, "chain"),
      );
    }
    for (const reason of reasonsForEntry(entry)) {
      blockingStatuses.push(
        status("blocking", reason, `ABI source is blocked: ${reason}.`, "abi"),
      );
    }
  }
  if (!fn) {
    blockingStatuses.push(status("blocking", "missingFunction", "Select a function.", "abi"));
  } else if (!isWriteDraftFunction(fn)) {
    blockingStatuses.push(
      status(
        "blocking",
        functionBlockCode(fn),
        fn.callKind === "read" || fn.stateMutability === "view" || fn.stateMutability === "pure"
          ? "Read/view/pure functions do not create write drafts."
          : fn.unsupportedReason ?? "Function kind is unsupported for write drafts.",
        "abi",
      ),
    );
  }
  if (!preview) {
    blockingStatuses.push(status("blocking", "missingPreview", "Preview calldata before drafting.", "preview"));
  } else if (preview.status !== "success") {
    blockingStatuses.push(
      status("blocking", preview.status, preview.errorSummary ?? "Calldata preview is not successful.", "preview"),
    );
  } else if (entry && fn) {
    blockingStatuses.push(...previewIdentityStatuses(preview, entry, fn));
  }

  const nativeValue = parseUintText(input.nativeValueWei, "nativeValue", blockingStatuses, "value");
  const gasLimit = parsePositiveUintText(input.gasLimit, "gasLimit", blockingStatuses, "fee");
  const nonce = parseNonce(input.nonce, blockingStatuses);
  const priorityFee = parseGweiText(input.priorityFeeGwei, "priorityFee", blockingStatuses);
  const latestBaseFee = parseOptionalGweiText(input.latestBaseFeeGwei, "latestBaseFee", blockingStatuses);
  const customBaseFee = parseOptionalGweiText(input.baseFeeGwei, "baseFee", blockingStatuses);
  const multiplier = parseMultiplier(input.baseFeeMultiplier, blockingStatuses);
  const maxFeeOverride = parseOptionalGweiText(input.maxFeeOverrideGwei, "maxFeeOverride", blockingStatuses);
  const baseFee = customBaseFee ?? latestBaseFee;

  if (baseFee === null) {
    blockingStatuses.push(
      status("blocking", "baseFeeUnavailable", "Latest base fee unavailable; enter a base fee manually.", "fee"),
    );
  } else if (customBaseFee !== null) {
    warnings.push(status("info", "customBaseFee", "Using custom base fee.", "fee"));
  }
  if (latestBaseFee === null) {
    warnings.push(status("warning", "latestBaseFeeUnavailable", "Latest base fee reference is unavailable.", "fee"));
  }
  if (fn && nativeValue !== null && nativeValue > 0n && fn.stateMutability !== "payable") {
    blockingStatuses.push(
      status("blocking", "nonpayableValue", "Nonpayable functions require native value 0.", "value"),
    );
  }

  const maxFee =
    baseFee !== null && priorityFee !== null && multiplier !== null
      ? maxFeeOverride ?? ceilMultiply(baseFee, multiplier.numerator, multiplier.denominator) + priorityFee
      : null;
  if (maxFee !== null && priorityFee !== null && maxFee < priorityFee) {
    blockingStatuses.push(
      status("blocking", "maxFeeBelowPriorityFee", "Max fee must be greater than or equal to priority fee.", "fee"),
    );
  }

  const uniqueBlocking = uniqueStatuses(blockingStatuses);
  const uniqueWarnings = uniqueStatuses(warnings);
  if (
    uniqueBlocking.length > 0 ||
    !entry ||
    !fn ||
    !preview ||
    nativeValue === null ||
    gasLimit === null ||
    nonce === null ||
    priorityFee === null ||
    baseFee === null ||
    multiplier === null ||
    maxFee === null ||
    input.accountIndex === null ||
    !input.from
  ) {
    return { draft: null, warnings: uniqueWarnings, blockingStatuses: uniqueBlocking };
  }

  const argumentSummary = boundedArgumentSummary(preview.parameterSummary);
  const calldataHash = preview.calldata?.hash ?? null;
  const calldataByteLength = preview.calldata?.byteLength ?? null;
  const frozenParts = [
    "abiWriteDraft",
    input.selectedChainId.toString(),
    input.accountIndex.toString(),
    input.from,
    entry.contractAddress,
    entry.sourceKind,
    entry.providerConfigId ?? "",
    entry.userSourceId ?? "",
    entry.versionId,
    entry.abiHash,
    entry.sourceFingerprint,
    fn.signature,
    preview.selector ?? "",
    calldataHash ?? "",
    calldataByteLength?.toString() ?? "",
    nativeValue.toString(),
    gasLimit.toString(),
    baseFee.toString(),
    input.baseFeeMultiplier.trim(),
    maxFee.toString(),
    maxFeeOverride?.toString() ?? "",
    priorityFee.toString(),
    nonce.toString(),
  ];

  return {
    draft: {
      draftId: compactHashKey([...frozenParts, input.createdAt].join(":")),
      frozenKey: compactHashKey(frozenParts.join(":")),
      createdAt: input.createdAt,
      chainId: input.selectedChainId,
      chainLabel: input.chainLabel,
      accountIndex: input.accountIndex,
      from: input.from,
      contractAddress: entry.contractAddress,
      sourceKind: entry.sourceKind,
      providerConfigId: entry.providerConfigId ?? null,
      userSourceId: entry.userSourceId ?? null,
      versionId: entry.versionId,
      abiHash: entry.abiHash,
      sourceFingerprint: entry.sourceFingerprint,
      functionSignature: fn.signature,
      selector: preview.selector ?? fn.selector ?? null,
      argumentSummary,
      argumentHash: calldataHash,
      calldataHash,
      calldataByteLength,
      nativeValueWei: nativeValue.toString(),
      gasLimit: gasLimit.toString(),
      latestBaseFeePerGas: latestBaseFee?.toString() ?? null,
      baseFeePerGas: baseFee.toString(),
      baseFeeMultiplier: multiplier.text,
      maxFeePerGas: maxFee.toString(),
      maxFeeOverridePerGas: maxFeeOverride?.toString() ?? null,
      maxPriorityFeePerGas: priorityFee.toString(),
      nonce,
      selectedRpc: sanitizeSelectedRpc(input.selectedRpc),
      warnings: uniqueWarnings,
      blockingStatuses: [],
      canSubmit: false,
    },
    warnings: uniqueWarnings,
    blockingStatuses: [],
  };
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

function isWriteDraftFunction(fn: AbiFunctionSchema) {
  return (
    fn.supported &&
    fn.callKind === "writeDraft" &&
    fn.stateMutability !== "view" &&
    fn.stateMutability !== "pure"
  );
}

function previewIdentityStatuses(
  preview: AbiCalldataPreviewResult,
  entry: AbiCacheEntryRecord,
  fn: AbiFunctionSchema,
) {
  const statuses: AbiWriteDraftStatus[] = [];
  const mismatches: string[] = [];
  if (preview.functionSignature !== fn.signature) {
    mismatches.push("function signature");
  }
  if (!preview.contractAddress || normalizeAddress(preview.contractAddress) !== normalizeAddress(entry.contractAddress)) {
    mismatches.push("contract");
  }
  if (preview.sourceKind !== entry.sourceKind) {
    mismatches.push("source kind");
  }
  if (nullKey(preview.providerConfigId) !== nullKey(entry.providerConfigId)) {
    mismatches.push("provider config");
  }
  if (nullKey(preview.userSourceId) !== nullKey(entry.userSourceId)) {
    mismatches.push("user source");
  }
  if (preview.versionId !== entry.versionId) {
    mismatches.push("version");
  }
  if (preview.abiHash !== entry.abiHash) {
    mismatches.push("ABI hash");
  }
  if (preview.sourceFingerprint !== entry.sourceFingerprint) {
    mismatches.push("source fingerprint");
  }
  if (fn.selector && preview.selector !== fn.selector) {
    mismatches.push("selector");
  }
  if (mismatches.length > 0) {
    statuses.push(
      status(
        "blocking",
        "previewIdentityMismatch",
        `Calldata preview does not match selected ABI/function: ${mismatches.join(", ")}.`,
        "preview",
      ),
    );
  }
  return statuses;
}

function functionBlockCode(fn: AbiFunctionSchema) {
  if (!fn.supported) return "unsupportedFunction";
  if (fn.callKind === "read" || fn.stateMutability === "view" || fn.stateMutability === "pure") {
    return "readFunction";
  }
  return "unsupportedFunctionKind";
}

function status(
  level: AbiWriteDraftStatus["level"],
  code: string,
  message: string,
  source: string,
): AbiWriteDraftStatus {
  return { level, code, message, source };
}

function uniqueStatuses(statuses: AbiWriteDraftStatus[]) {
  const seen = new Set<string>();
  return statuses.filter((item) => {
    const key = `${item.level}:${item.code}:${item.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseUintText(
  value: string,
  code: string,
  blockingStatuses: AbiWriteDraftStatus[],
  source: string,
) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    blockingStatuses.push(status("blocking", code, `${code} must be a non-negative integer.`, source));
    return null;
  }
  return BigInt(trimmed);
}

function parsePositiveUintText(
  value: string,
  code: string,
  blockingStatuses: AbiWriteDraftStatus[],
  source: string,
) {
  const parsed = parseUintText(value, code, blockingStatuses, source);
  if (parsed !== null && parsed <= 0n) {
    blockingStatuses.push(status("blocking", code, `${code} must be greater than zero.`, source));
    return null;
  }
  return parsed;
}

function parseNonce(value: string, blockingStatuses: AbiWriteDraftStatus[]) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    blockingStatuses.push(status("blocking", "nonce", "Nonce must be a non-negative integer.", "nonce"));
    return null;
  }
  const numeric = Number(trimmed);
  if (!Number.isSafeInteger(numeric)) {
    blockingStatuses.push(status("blocking", "nonce", "Nonce is too large.", "nonce"));
    return null;
  }
  return numeric;
}

function parseOptionalGweiText(
  value: string,
  code: string,
  blockingStatuses: AbiWriteDraftStatus[],
) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return parseGweiText(trimmed, code, blockingStatuses);
}

function parseGweiText(
  value: string,
  code: string,
  blockingStatuses: AbiWriteDraftStatus[],
) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{0,9})?$/.test(trimmed)) {
    blockingStatuses.push(status("blocking", code, `${code} must be a gwei decimal with up to 9 decimals.`, "fee"));
    return null;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt((fraction + "000000000").slice(0, 9));
}

function parseMultiplier(value: string, blockingStatuses: AbiWriteDraftStatus[]) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    blockingStatuses.push(
      status("blocking", "baseFeeMultiplier", "Base fee multiplier must be a non-negative decimal.", "fee"),
    );
    return null;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}` || "0");
  return { numerator, denominator, text: trimmed };
}

function ceilMultiply(value: bigint, numerator: bigint, denominator: bigint) {
  return (value * numerator + denominator - 1n) / denominator;
}

function boundedArgumentSummary(summaries: AbiDecodedValueSummary[]) {
  return summaries.slice(0, 12).map((summary) => boundedDecodedValue(summary, 0));
}

function boundedDecodedValue(summary: AbiDecodedValueSummary, depth: number): AbiDecodedValueSummary {
  return {
    kind: boundToken(summary.kind, "unknown", 80),
    type: boundToken(summary.type, "unknown", 96),
    value: boundNullableText(summary.value ?? null, 96),
    byteLength: typeof summary.byteLength === "number" ? summary.byteLength : null,
    hash: boundNullableText(summary.hash ?? null, 128),
    items:
      depth >= 3 || !summary.items
        ? []
        : summary.items.slice(0, 8).map((item) => boundedDecodedValue(item, depth + 1)),
    fields:
      depth >= 3 || !summary.fields
        ? []
        : summary.fields.slice(0, 8).map((field) => boundedDecodedField(field, depth + 1)),
    truncated:
      summary.truncated ||
      (summary.items?.length ?? 0) > 8 ||
      (summary.fields?.length ?? 0) > 8 ||
      (typeof summary.value === "string" && summary.value.length > 96),
  };
}

function boundedDecodedField(field: AbiDecodedFieldSummary, depth: number): AbiDecodedFieldSummary {
  return {
    name: boundNullableText(field.name ?? null, 64),
    value: boundedDecodedValue(field.value, depth),
  };
}

function boundToken(value: unknown, fallback: string, maxLength: number) {
  return typeof value === "string" ? boundText(value, maxLength) : fallback;
}

function boundNullableText(value: string | null, maxLength: number) {
  return value === null ? null : boundText(redactText(value) ?? value, maxLength);
}

function boundText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength)}...[truncated]`;
}

function sanitizeSelectedRpc(
  selectedRpc: AbiWriteDraftSelectedRpcSummary | null,
): AbiWriteDraftSelectedRpcSummary | null {
  if (selectedRpc === null) return null;
  return {
    chainId: selectedRpc.chainId,
    endpointSummary: sanitizeRpcSummary(selectedRpc.endpointSummary),
  };
}

function sanitizeRpcSummary(value: string | null) {
  if (value === null) return null;
  const compact = boundText(value, 200)
    .replace(/https?:\/\/[^\s"'<>;,]+/gi, (match) => {
      try {
        const url = new URL(match);
        return url.origin;
      } catch {
        return "[redacted_url]";
      }
    })
    .replace(/\bBearer\s+[^\s"'<>;,]+/gi, "Bearer [redacted]")
    .replace(/\b(api_?key|apikey|token|access_token|password|secret)=\S+/gi, "$1=[redacted]");
  return boundText(compact, 200);
}

function compactHashKey(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `abi-draft-${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
