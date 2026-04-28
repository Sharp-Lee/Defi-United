import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AbiCacheEntryRecord,
  AbiCalldataPreviewInput,
  AbiCalldataPreviewResult,
  AbiDataSourceConfigRecord,
  AbiDecodedValueSummary,
  AbiFunctionCatalogResult,
  AbiFunctionSchema,
  AbiManagedEntryInput,
  AbiPayloadValidationReadModel,
  AbiProviderKind,
  AbiRegistryMutationResult,
  AbiRegistryState,
  FetchExplorerAbiInput,
  UpsertAbiDataSourceConfigInput,
  UserAbiPayloadInput,
} from "../../lib/tauri";

export type AbiMutationHandlerResult = AbiRegistryMutationResult | boolean | void;

export interface AbiLibraryViewProps {
  busy?: boolean;
  error?: string | null;
  selectedChainId: bigint;
  state: AbiRegistryState | null;
  onRefresh: () => Promise<boolean | void> | boolean | void;
  onSaveDataSource: (
    input: UpsertAbiDataSourceConfigInput,
  ) => Promise<boolean | void> | boolean | void;
  onRemoveDataSource: (id: string) => Promise<boolean | void> | boolean | void;
  onValidatePayload: (payload: string) => Promise<AbiPayloadValidationReadModel>;
  onImportPayload: (
    input: UserAbiPayloadInput,
  ) => Promise<AbiMutationHandlerResult> | AbiMutationHandlerResult;
  onPastePayload: (
    input: UserAbiPayloadInput,
  ) => Promise<AbiMutationHandlerResult> | AbiMutationHandlerResult;
  onFetchExplorerAbi: (
    input: FetchExplorerAbiInput,
  ) => Promise<AbiMutationHandlerResult> | AbiMutationHandlerResult;
  onMarkStale: (entry: AbiCacheEntryRecord) => Promise<boolean | void> | boolean | void;
  onDeleteEntry: (entry: AbiCacheEntryRecord) => Promise<boolean | void> | boolean | void;
  onListFunctions?: (input: AbiManagedEntryInput) => Promise<AbiFunctionCatalogResult>;
  onPreviewCalldata?: (input: AbiCalldataPreviewInput) => Promise<AbiCalldataPreviewResult>;
}

const providerKinds: AbiProviderKind[] = [
  "etherscanCompatible",
  "blockscoutCompatible",
  "customIndexer",
  "localOnly",
];

const statusLabels: Record<string, string> = {
  ok: "OK",
  notConfigured: "Not configured",
  unsupportedChain: "Unsupported chain",
  fetchFailed: "Fetch failed",
  rateLimited: "Rate limited",
  notVerified: "Not verified",
  malformedResponse: "Malformed response",
  notValidated: "Not validated",
  parseFailed: "Parse failed",
  malformedAbi: "Malformed ABI",
  emptyAbiItems: "Empty ABI items",
  payloadTooLarge: "Payload too large",
  selectorConflict: "Selector conflict",
  cacheFresh: "Fresh",
  cacheStale: "Stale",
  refreshing: "Refreshing",
  refreshFailed: "Refresh failed",
  versionSuperseded: "Superseded",
  selected: "Selected",
  unselected: "Unselected",
  sourceConflict: "Source conflict",
  needsUserChoice: "Needs user choice",
};

function compact(value: string, head = 10, tail = 6) {
  return value.length > head + tail + 3 ? `${value.slice(0, head)}...${value.slice(-tail)}` : value;
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Never";
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric * 1000).toLocaleString();
  }
  return value;
}

function statusLabel(status?: string | null) {
  if (!status) return "Unknown";
  return statusLabels[status] ?? status;
}

function statusClass(status?: string | null) {
  if (!status) return "history-status";
  if (["ok", "cacheFresh", "selected"].includes(status)) {
    return "history-status history-status-confirmed";
  }
  if (["notConfigured", "cacheStale", "refreshing", "needsUserChoice", "versionSuperseded"].includes(status)) {
    return "history-status history-status-pending";
  }
  if (["unselected"].includes(status)) return "history-status";
  return "history-status history-status-failed";
}

function sourceLabel(source: AbiDataSourceConfigRecord) {
  return `${source.chainId} / ${source.providerKind}`;
}

function cacheIdentity(entry: AbiCacheEntryRecord) {
  return [
    entry.chainId,
    entry.contractAddress.toLowerCase(),
    entry.sourceKind,
    entry.providerConfigId ?? "",
    entry.userSourceId ?? "",
    entry.versionId,
  ].join(":");
}

function sourceDisplay(entry: AbiCacheEntryRecord) {
  if (entry.sourceKind === "explorerFetched") {
    return `explorerFetched${entry.providerConfigId ? `:${entry.providerConfigId}` : ""}`;
  }
  return `${entry.sourceKind}${entry.userSourceId ? `:${entry.userSourceId}` : ""}`;
}

function selectorText(entry: Pick<AbiCacheEntryRecord, "selectorSummary">) {
  const summary = entry.selectorSummary;
  if (!summary) return "No selector summary";
  const parts = [
    `fn ${summary.functionSelectorCount ?? 0}`,
    `event ${summary.eventTopicCount ?? 0}`,
    `error ${summary.errorSelectorCount ?? 0}`,
  ];
  if ((summary.duplicateSelectorCount ?? 0) > 0) {
    parts.push(`dupes ${summary.duplicateSelectorCount}`);
  }
  if ((summary.conflictCount ?? 0) > 0) {
    parts.push(`conflicts ${summary.conflictCount}`);
  }
  return parts.join(" / ");
}

function defaultSourceId(chainId: bigint, kind: AbiProviderKind) {
  return `abi-${chainId.toString()}-${kind}`;
}

function emptyValidation(): AbiPayloadValidationReadModel | null {
  return null;
}

function isAbiMutationResult(result: AbiMutationHandlerResult): result is AbiRegistryMutationResult {
  return typeof result === "object" && result !== null && "validation" in result;
}

function isUsableAbiMutationResult(result: AbiRegistryMutationResult) {
  return (
    result.cacheEntry !== null &&
    result.cacheEntry !== undefined &&
    result.validation.fetchSourceStatus === "ok" &&
    (result.validation.validationStatus === "ok" ||
      result.validation.validationStatus === "selectorConflict")
  );
}

function isCallableEntry(entry: AbiCacheEntryRecord) {
  return (
    entry.selected &&
    entry.fetchSourceStatus === "ok" &&
    entry.validationStatus === "ok" &&
    entry.cacheStatus === "cacheFresh" &&
    entry.selectionStatus === "selected"
  );
}

function blockingReasons(entry: AbiCacheEntryRecord) {
  const reasons: string[] = [];
  if (!entry.selected) reasons.push("notSelected");
  if (entry.fetchSourceStatus !== "ok") reasons.push(entry.fetchSourceStatus);
  if (entry.validationStatus !== "ok") reasons.push(entry.validationStatus);
  if (entry.cacheStatus !== "cacheFresh") reasons.push(entry.cacheStatus);
  if (entry.selectionStatus !== "selected") reasons.push(entry.selectionStatus);
  return Array.from(new Set(reasons));
}

function entryInput(entry: AbiCacheEntryRecord): AbiManagedEntryInput {
  return {
    chainId: entry.chainId,
    contractAddress: entry.contractAddress,
    sourceKind: entry.sourceKind,
    providerConfigId: entry.providerConfigId ?? null,
    userSourceId: entry.userSourceId ?? null,
    versionId: entry.versionId,
    abiHash: entry.abiHash,
    sourceFingerprint: entry.sourceFingerprint,
  };
}

function functionOptionLabel(fn: AbiFunctionSchema) {
  const path = fn.callKind === "read" ? "read" : fn.callKind === "writeDraft" ? "write" : "blocked";
  return `${fn.signature} / ${path} / ${fn.stateMutability}`;
}

function functionPreviewModeLabel(fn: AbiFunctionSchema) {
  if (!fn.supported || fn.callKind === "unsupported") {
    return "Blocked preview";
  }
  if (fn.callKind === "read") {
    return "Read-only preview";
  }
  if (fn.callKind === "writeDraft") {
    return "Write draft preview";
  }
  return "Blocked preview";
}

function summaryLine(summary: AbiDecodedValueSummary): string {
  const parts = [summary.type, summary.kind];
  if (summary.value !== null && summary.value !== undefined) {
    parts.push(summary.truncated ? `${summary.value}...` : summary.value);
  }
  if (summary.byteLength !== null && summary.byteLength !== undefined) {
    parts.push(`${summary.byteLength} bytes`);
  }
  if (summary.hash) {
    parts.push(`hash ${compact(summary.hash, 14, 8)}`);
  }
  if (summary.truncated && (summary.value === null || summary.value === undefined)) {
    parts.push("truncated");
  }
  return parts.join(" / ");
}

function renderSummary(summary: AbiDecodedValueSummary, key: string) {
  return (
    <li key={key}>
      <span>{summaryLine(summary)}</span>
      {summary.fields && summary.fields.length > 0 && (
        <ul>
          {summary.fields.map((field, index) => (
            <li key={`${key}-field-${index}`}>
              <span>{field.name ?? `field ${index}`}: </span>
              <span>{summaryLine(field.value)}</span>
            </li>
          ))}
        </ul>
      )}
      {summary.items && summary.items.length > 0 && (
        <ul>{summary.items.map((item, index) => renderSummary(item, `${key}-item-${index}`))}</ul>
      )}
    </li>
  );
}

function validationDetails(validation: AbiPayloadValidationReadModel) {
  const diagnostics = validation.diagnostics;
  return [
    `Fetch ${statusLabel(validation.fetchSourceStatus)}`,
    `Validation ${statusLabel(validation.validationStatus)}`,
    diagnostics.failureClass ? `Failure ${diagnostics.failureClass}` : null,
    diagnostics.providerConfigId ? `Provider ${diagnostics.providerConfigId}` : null,
    diagnostics.host ? `Host ${diagnostics.host}` : null,
    diagnostics.configSummary ? `Config ${diagnostics.configSummary}` : null,
    diagnostics.rateLimitHint ? `Rate limit ${diagnostics.rateLimitHint}` : null,
  ].filter(Boolean);
}

export function AbiLibraryView({
  busy = false,
  error = null,
  selectedChainId,
  state,
  onRefresh,
  onSaveDataSource,
  onRemoveDataSource,
  onValidatePayload,
  onImportPayload,
  onPastePayload,
  onFetchExplorerAbi,
  onMarkStale,
  onDeleteEntry,
  onListFunctions = async (input) => ({
    status: "blocked",
    reasons: ["unknown"],
    contractAddress: input.contractAddress,
    sourceKind: input.sourceKind,
    providerConfigId: input.providerConfigId ?? null,
    userSourceId: input.userSourceId ?? null,
    versionId: input.versionId,
    abiHash: input.abiHash,
    sourceFingerprint: input.sourceFingerprint,
    functions: [],
    unsupportedItemCount: 0,
  }),
  onPreviewCalldata = async (input) => ({
    status: "blocked",
    reasons: ["unknown"],
    functionSignature: input.functionSignature,
    contractAddress: input.contractAddress,
    sourceKind: input.sourceKind,
    providerConfigId: input.providerConfigId ?? null,
    userSourceId: input.userSourceId ?? null,
    versionId: input.versionId,
    abiHash: input.abiHash,
    sourceFingerprint: input.sourceFingerprint,
    parameterSummary: [],
  }),
}: AbiLibraryViewProps) {
  const [targetChainId, setTargetChainId] = useState(selectedChainId.toString());
  const [targetAddress, setTargetAddress] = useState("");
  const [providerConfigId, setProviderConfigId] = useState("");
  const [sourceId, setSourceId] = useState(defaultSourceId(selectedChainId, "etherscanCompatible"));
  const [sourceChainId, setSourceChainId] = useState(selectedChainId.toString());
  const [providerKind, setProviderKind] = useState<AbiProviderKind>("etherscanCompatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeyRef, setApiKeyRef] = useState("");
  const [sourceEnabled, setSourceEnabled] = useState(true);
  const [userSourceId, setUserSourceId] = useState("");
  const [payload, setPayload] = useState("");
  const [validation, setValidation] = useState<AbiPayloadValidationReadModel | null>(
    emptyValidation,
  );
  const [selectedPreviewEntryKey, setSelectedPreviewEntryKey] = useState("");
  const [functionCatalog, setFunctionCatalog] = useState<AbiFunctionCatalogResult | null>(null);
  const [selectedFunctionSignature, setSelectedFunctionSignature] = useState("");
  const [paramsText, setParamsText] = useState("[]");
  const [preview, setPreview] = useState<AbiCalldataPreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const latestPreviewStateRef = useRef({
    entryKey: "",
    functionSignature: "",
    paramsText: "[]",
  });
  const catalogRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);

  useEffect(() => {
    setTargetChainId(selectedChainId.toString());
    setSourceChainId(selectedChainId.toString());
    setSourceId(defaultSourceId(selectedChainId, "etherscanCompatible"));
    setProviderConfigId("");
  }, [selectedChainId]);

  const targetChain = Number(targetChainId);
  const targetSources = useMemo(
    () =>
      (state?.dataSources ?? []).filter(
        (source) => source.chainId === targetChain && source.enabled,
      ),
    [state, targetChain],
  );
  const targetEntries = useMemo(
    () =>
      (state?.cacheEntries ?? []).filter((entry) => {
        if (targetChainId.trim() && entry.chainId !== targetChain) return false;
        if (targetAddress.trim()) {
          return entry.contractAddress.toLowerCase().includes(targetAddress.trim().toLowerCase());
        }
        return true;
      }),
    [state, targetAddress, targetChain, targetChainId],
  );
  const selectedPreviewEntry = useMemo(
    () => targetEntries.find((entry) => cacheIdentity(entry) === selectedPreviewEntryKey) ?? null,
    [selectedPreviewEntryKey, targetEntries],
  );
  const selectedFunction = useMemo(
    () =>
      functionCatalog?.functions.find(
        (fn) => fn.signature === selectedFunctionSignature,
      ) ?? null,
    [functionCatalog, selectedFunctionSignature],
  );
  const selectedEntryReasons = selectedPreviewEntry ? blockingReasons(selectedPreviewEntry) : [];
  const selectedEntryCallable = selectedPreviewEntry ? isCallableEntry(selectedPreviewEntry) : false;
  const previewDisabled =
    busy ||
    previewBusy ||
    !selectedPreviewEntry ||
    !selectedEntryCallable ||
    !selectedFunction ||
    !selectedFunction.supported;
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of state?.cacheEntries ?? []) {
      for (const status of [
        entry.fetchSourceStatus,
        entry.validationStatus,
        entry.cacheStatus,
        entry.selectionStatus,
      ]) {
        counts.set(status, (counts.get(status) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [state]);

  useEffect(() => {
    latestPreviewStateRef.current = {
      entryKey: selectedPreviewEntryKey,
      functionSignature: selectedFunctionSignature,
      paramsText,
    };
  }, [paramsText, selectedFunctionSignature, selectedPreviewEntryKey]);

  useEffect(() => {
    if (selectedPreviewEntryKey && selectedPreviewEntry) return;
    const selected = targetEntries.find((entry) => entry.selected) ?? targetEntries[0] ?? null;
    setSelectedPreviewEntryKey(selected ? cacheIdentity(selected) : "");
  }, [selectedPreviewEntry, selectedPreviewEntryKey, targetEntries]);

  useEffect(() => {
    setFunctionCatalog(null);
    setSelectedFunctionSignature("");
    setParamsText("[]");
    setPreview(null);
  }, [selectedPreviewEntryKey]);

  useEffect(() => {
    if (!functionCatalog || selectedFunctionSignature) return;
    const firstCallable =
      functionCatalog.functions.find((fn) => fn.supported && fn.callKind !== "unsupported") ??
      functionCatalog.functions[0] ??
      null;
    if (firstCallable) {
      setSelectedFunctionSignature(firstCallable.signature);
    }
  }, [functionCatalog, selectedFunctionSignature]);

  function parseTarget() {
    const chainId = Number(targetChainId);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new Error("chainId must be a positive integer.");
    }
    const contractAddress = targetAddress.trim();
    if (!contractAddress) {
      throw new Error("Contract address is required.");
    }
    return { chainId, contractAddress };
  }

  async function handleSaveSource() {
    setLocalError(null);
    setLocalMessage(null);
    const chainId = Number(sourceChainId);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      setLocalError("source chainId must be a positive integer.");
      return;
    }
    const succeeded = await onSaveDataSource({
      id: sourceId.trim(),
      chainId,
      providerKind,
      baseUrl: baseUrl.trim() || null,
      apiKeyRef: apiKeyRef.trim() || null,
      enabled: sourceEnabled,
    });
    if (succeeded === false) return;
    setLocalMessage("Data source saved.");
  }

  async function handleValidate() {
    setLocalError(null);
    setLocalMessage(null);
    setValidation(null);
    if (!payload.trim()) {
      setLocalError("ABI payload is required for validation.");
      return;
    }
    try {
      const result = await onValidatePayload(payload);
      setValidation(result);
      setLocalMessage(`Validation ${statusLabel(result.validationStatus)}.`);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  async function savePayload(mode: "paste" | "import") {
    setLocalError(null);
    setLocalMessage(null);
    try {
      const target = parseTarget();
      if (!payload.trim()) {
        setLocalError("ABI payload is required.");
        return;
      }
      const input = {
        ...target,
        payload,
        userSourceId: userSourceId.trim() || null,
      };
      const result =
        mode === "paste" ? await onPastePayload(input) : await onImportPayload(input);
      if (result === false) return;
      if (isAbiMutationResult(result)) {
        setValidation(result.validation);
        if (!isUsableAbiMutationResult(result)) {
          setLocalError(`ABI cache was not saved. ${validationDetails(result.validation).join(". ")}.`);
          return;
        }
      }
      setPayload("");
      setValidation(null);
      setLocalMessage(mode === "paste" ? "Saved as userPasted." : "Saved as userImported.");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleFetch() {
    setLocalError(null);
    setLocalMessage(null);
    try {
      const target = parseTarget();
      const result = await onFetchExplorerAbi({
        ...target,
        providerConfigId: providerConfigId.trim() || null,
      });
      if (result === false) return;
      if (isAbiMutationResult(result)) {
        setValidation(result.validation);
        if (!isUsableAbiMutationResult(result)) {
          setLocalError(`Explorer ABI was not cached. ${validationDetails(result.validation).join(". ")}.`);
          return;
        }
      }
      setLocalMessage("Explorer ABI cached.");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLoadFunctions() {
    setLocalError(null);
    setLocalMessage(null);
    setFunctionCatalog(null);
    setSelectedFunctionSignature("");
    setPreview(null);
    if (!selectedPreviewEntry) {
      setLocalError("Select a managed ABI entry.");
      return;
    }
    const requestId = catalogRequestIdRef.current + 1;
    catalogRequestIdRef.current = requestId;
    const requestEntryKey = cacheIdentity(selectedPreviewEntry);
    setPreviewBusy(true);
    try {
      const result = await onListFunctions(entryInput(selectedPreviewEntry));
      if (
        catalogRequestIdRef.current !== requestId ||
        latestPreviewStateRef.current.entryKey !== requestEntryKey
      ) {
        return;
      }
      setFunctionCatalog(result);
      if (result.status !== "success") {
        setLocalError(
          `Function catalog blocked: ${result.reasons.map(statusLabel).join(", ") || statusLabel(result.status)}.`,
        );
      }
    } catch (err) {
      if (
        catalogRequestIdRef.current !== requestId ||
        latestPreviewStateRef.current.entryKey !== requestEntryKey
      ) {
        return;
      }
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      if (catalogRequestIdRef.current === requestId) {
        setPreviewBusy(false);
      }
    }
  }

  async function handlePreviewCalldata() {
    setLocalError(null);
    setLocalMessage(null);
    setPreview(null);
    if (!selectedPreviewEntry || !selectedFunction) {
      setLocalError("Select a managed ABI entry and function.");
      return;
    }
    if (!selectedEntryCallable) {
      setLocalError(`ABI entry is blocked: ${selectedEntryReasons.map(statusLabel).join(", ")}.`);
      return;
    }
    if (!selectedFunction.supported) {
      setLocalError(`Function is blocked: ${selectedFunction.unsupportedReason ?? "unsupported type"}.`);
      return;
    }
    let canonicalParams: unknown;
    try {
      canonicalParams = JSON.parse(paramsText);
    } catch {
      setLocalError("Canonical params must be a valid JSON array.");
      return;
    }
    if (!Array.isArray(canonicalParams)) {
      setLocalError("Canonical params must be a JSON array.");
      return;
    }
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    const requestEntryKey = cacheIdentity(selectedPreviewEntry);
    const requestFunctionSignature = selectedFunction.signature;
    const requestParamsText = paramsText;
    setPreviewBusy(true);
    try {
      const result = await onPreviewCalldata({
        ...entryInput(selectedPreviewEntry),
        functionSignature: requestFunctionSignature,
        canonicalParams,
      });
      const latest = latestPreviewStateRef.current;
      if (
        previewRequestIdRef.current !== requestId ||
        latest.entryKey !== requestEntryKey ||
        latest.functionSignature !== requestFunctionSignature ||
        latest.paramsText !== requestParamsText
      ) {
        return;
      }
      setPreview(result);
      if (result.status !== "success") {
        const reasonText = result.reasons.map(statusLabel).join(", ");
        const previewReason = result.errorSummary ?? (reasonText || statusLabel(result.status));
        setLocalError(
          `Preview blocked: ${previewReason}.`,
        );
      }
    } catch (err) {
      const latest = latestPreviewStateRef.current;
      if (
        previewRequestIdRef.current !== requestId ||
        latest.entryKey !== requestEntryKey ||
        latest.functionSignature !== requestFunctionSignature ||
        latest.paramsText !== requestParamsText
      ) {
        return;
      }
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      if (previewRequestIdRef.current === requestId) {
        setPreviewBusy(false);
      }
    }
  }

  function beginEditSource(source: AbiDataSourceConfigRecord) {
    setSourceId(source.id);
    setSourceChainId(source.chainId.toString());
    setProviderKind(source.providerKind);
    setBaseUrl(source.baseUrl ?? "");
    setApiKeyRef(source.apiKeyRef ?? "");
    setSourceEnabled(source.enabled);
  }

  const configured = state !== null;

  return (
    <section className="workspace-section abi-section">
      <header className="section-header">
        <div>
          <h2>ABI Library</h2>
          <p className="section-subtitle">
            Local ABI cache status, configured explorer sources, and user-supplied ABI versions.
          </p>
        </div>
        <button className="secondary-button" disabled={busy} onClick={() => onRefresh()} type="button">
          Refresh
        </button>
      </header>

      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {localError && (
        <div className="inline-error" role="alert">
          {localError}
        </div>
      )}
      {localMessage && (
        <div className="inline-success" role="status">
          {localMessage}
        </div>
      )}

      <div className="abi-target-grid" aria-label="ABI lookup target">
        <label>
          chainId
          <input
            inputMode="numeric"
            onChange={(event) => setTargetChainId(event.target.value)}
            value={targetChainId}
          />
        </label>
        <label>
          Contract address
          <input
            className="mono"
            onChange={(event) => setTargetAddress(event.target.value)}
            placeholder="0x..."
            value={targetAddress}
          />
        </label>
        <label>
          Provider
          <select
            onChange={(event) => setProviderConfigId(event.target.value)}
            value={providerConfigId}
          >
            <option value="">Auto / configured</option>
            {targetSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.id}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy} onClick={handleFetch} type="button">
          Fetch / Refresh
        </button>
      </div>

      <section className="abi-panel" aria-label="ABI status summary">
        <div className="abi-summary-strip">
          <span>Sources {state?.dataSources.length ?? 0}</span>
          <span>Cache entries {state?.cacheEntries.length ?? 0}</span>
          <span>Target matches {targetEntries.length}</span>
          {!configured && <span>Registry not loaded</span>}
          {statusCounts.map(([status, count]) => (
            <span key={status}>
              {statusLabel(status)} {count}
            </span>
          ))}
        </div>
      </section>

      <section className="abi-panel" aria-label="ABI data sources">
        <header className="abi-panel-header">
          <h3>Data Sources</h3>
        </header>
        <div className="abi-source-form">
          <label>
            Source id
            <input onChange={(event) => setSourceId(event.target.value)} value={sourceId} />
          </label>
          <label>
            chainId
            <input
              inputMode="numeric"
              onChange={(event) => setSourceChainId(event.target.value)}
              value={sourceChainId}
            />
          </label>
          <label>
            Provider kind
            <select
              onChange={(event) => setProviderKind(event.target.value as AbiProviderKind)}
              value={providerKind}
            >
              {providerKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            Base URL
            <input
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://..."
              value={baseUrl}
            />
          </label>
          <label>
            apiKeyRef
            <input
              onChange={(event) => setApiKeyRef(event.target.value)}
              placeholder="env:ETHERSCAN_MAINNET_KEY or keychain:wallet-workbench/etherscan-mainnet"
              value={apiKeyRef}
            />
          </label>
          <label className="check-row">
            <input
              checked={sourceEnabled}
              onChange={(event) => setSourceEnabled(event.target.checked)}
              type="checkbox"
            />
            Enabled
          </label>
          <button disabled={busy} onClick={handleSaveSource} type="button">
            Save Source
          </button>
        </div>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Last activity</th>
                <th>Error</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(state?.dataSources ?? []).length === 0 && (
                <tr>
                  <td colSpan={6}>No ABI data sources configured.</td>
                </tr>
              )}
              {(state?.dataSources ?? []).map((source) => (
                <tr key={source.id}>
                  <td>
                    <strong>{source.id}</strong>
                    <div className="mono">{sourceLabel(source)}</div>
                  </td>
                  <td>
                    <div>{source.baseUrl || "Local only"}</div>
                    <div className="mono">apiKeyRef {source.apiKeyRef || "none"}</div>
                  </td>
                  <td>
                    <span className={statusClass(source.enabled ? "ok" : "notConfigured")}>
                      {source.enabled ? "Enabled" : "Disabled"}
                    </span>
                    {source.rateLimited && (
                      <span className={statusClass("rateLimited")}>Rate limited</span>
                    )}
                  </td>
                  <td>
                    <div>Success {formatTimestamp(source.lastSuccessAt)}</div>
                    <div>Failure {formatTimestamp(source.lastFailureAt)}</div>
                    <div>Cooldown {formatTimestamp(source.cooldownUntil)}</div>
                  </td>
                  <td>{source.lastErrorSummary || "None"}</td>
                  <td>
                    <div className="button-row">
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => beginEditSource(source)}
                        aria-label={`Edit ABI data source ${source.id}`}
                        title={`Edit ABI data source ${source.id}`}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => onRemoveDataSource(source.id)}
                        aria-label={`Remove ABI data source ${source.id}`}
                        title={`Remove ABI data source ${source.id}`}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="abi-panel" aria-label="ABI paste import">
        <header className="abi-panel-header">
          <h3>Paste / Import</h3>
          {validation && (
            <span className={statusClass(validation.validationStatus)}>
              {statusLabel(validation.validationStatus)}
            </span>
          )}
        </header>
        <div className="abi-payload-grid">
          <label>
            User source id
            <input
              onChange={(event) => setUserSourceId(event.target.value)}
              placeholder="manual-file or note"
              value={userSourceId}
            />
          </label>
          <label className="abi-payload-field">
            ABI payload
            <textarea
              onChange={(event) => {
                setPayload(event.target.value);
                setValidation(null);
              }}
              placeholder='[{"type":"function","name":"transfer",...}]'
              rows={6}
              value={payload}
            />
          </label>
          <div className="button-row abi-payload-actions">
            <button className="secondary-button" disabled={busy} onClick={handleValidate} type="button">
              Validate
            </button>
            <button disabled={busy} onClick={() => savePayload("paste")} type="button">
              Save Paste
            </button>
            <button disabled={busy} onClick={() => savePayload("import")} type="button">
              Save Import
            </button>
          </div>
        </div>
        {validation && (
          <div className="abi-validation-summary" aria-label="ABI validation summary">
            <span>Hash {validation.abiHash ? compact(validation.abiHash, 12, 8) : "none"}</span>
            <span>
              Fingerprint{" "}
              {validation.sourceFingerprint ? compact(validation.sourceFingerprint, 12, 8) : "none"}
            </span>
            <span>Functions {validation.functionCount}</span>
            <span>Events {validation.eventCount}</span>
            <span>Errors {validation.errorCount}</span>
            <span>{selectorText({ selectorSummary: validation.selectorSummary })}</span>
            <span>{statusLabel(validation.fetchSourceStatus)}</span>
            <span>{statusLabel(validation.validationStatus)}</span>
            {validationDetails(validation)
              .slice(2)
              .map((detail) => (
                <span key={detail}>{detail}</span>
              ))}
          </div>
        )}
      </section>

      <section className="abi-panel" aria-label="ABI calldata preview">
        <header className="abi-panel-header">
          <h3>Calldata Preview</h3>
          {preview && <span className={statusClass(preview.status)}>{statusLabel(preview.status)}</span>}
        </header>
        <div className="abi-caller-grid">
          <label>
            Managed entry
            <select
              onChange={(event) => {
                const entryKey = event.target.value;
                latestPreviewStateRef.current = {
                  ...latestPreviewStateRef.current,
                  entryKey,
                };
                setSelectedPreviewEntryKey(entryKey);
              }}
              value={selectedPreviewEntryKey}
            >
              <option value="">Select ABI entry</option>
              {targetEntries.map((entry) => (
                <option key={cacheIdentity(entry)} value={cacheIdentity(entry)}>
                  {entry.chainId} / {compact(entry.contractAddress, 12, 8)} / {sourceDisplay(entry)} /{" "}
                  {entry.versionId}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            disabled={busy || previewBusy || !selectedPreviewEntry}
            onClick={handleLoadFunctions}
            type="button"
          >
            Load Functions
          </button>
          <label>
            Function signature
            <select
              disabled={!functionCatalog || functionCatalog.functions.length === 0}
              onChange={(event) => {
                const functionSignature = event.target.value;
                latestPreviewStateRef.current = {
                  ...latestPreviewStateRef.current,
                  functionSignature,
                  paramsText: "[]",
                };
                setSelectedFunctionSignature(functionSignature);
                setParamsText("[]");
                setPreview(null);
              }}
              value={selectedFunctionSignature}
            >
              <option value="">Select function</option>
              {(functionCatalog?.functions ?? []).map((fn) => (
                <option key={fn.signature} value={fn.signature}>
                  {functionOptionLabel(fn)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedPreviewEntry && (
          <div className="abi-validation-summary" aria-label="ABI preview entry status">
            <span>{sourceDisplay(selectedPreviewEntry)}</span>
            <span>{statusLabel(selectedPreviewEntry.fetchSourceStatus)}</span>
            <span>{statusLabel(selectedPreviewEntry.validationStatus)}</span>
            <span>{statusLabel(selectedPreviewEntry.cacheStatus)}</span>
            <span>{statusLabel(selectedPreviewEntry.selectionStatus)}</span>
            {selectedEntryReasons.map((reason) => (
              <span key={reason}>Blocked {statusLabel(reason)}</span>
            ))}
          </div>
        )}

        {functionCatalog && (
          <div className="abi-validation-summary" aria-label="ABI function catalog summary">
            <span>Functions {functionCatalog.functions.length}</span>
            <span>Unsupported {functionCatalog.unsupportedItemCount}</span>
            <span>{statusLabel(functionCatalog.status)}</span>
            {functionCatalog.reasons.map((reason) => (
              <span key={reason}>{statusLabel(reason)}</span>
            ))}
          </div>
        )}

        {selectedFunction && (
          <div className="abi-function-detail" aria-label="ABI selected function schema">
            <div>
              <strong className="mono">{selectedFunction.signature}</strong>
              <div className="abi-resolution-guidance">
                {functionPreviewModeLabel(selectedFunction)}.
                Encoding preview only; no semantic safety claim.
              </div>
            </div>
            <div className="abi-validation-summary">
              <span>Selector {selectedFunction.selector ?? "blocked"}</span>
              <span>{statusLabel(selectedFunction.stateMutability)}</span>
              <span>{selectedFunction.supported ? "Supported" : selectedFunction.unsupportedReason ?? "Blocked"}</span>
              <span>Inputs {selectedFunction.inputs.length}</span>
              <span>Outputs {selectedFunction.outputs.length}</span>
            </div>
            {selectedFunction.inputs.length > 0 && (
              <div className="abi-param-list">
                {selectedFunction.inputs.map((input, index) => (
                  <span className="mono" key={`${selectedFunction.signature}-input-${index}`}>
                    {input.name ?? `arg${index}`}: {input.type}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="abi-param-editor">
          Canonical params JSON array
          <textarea
            className="mono"
            onChange={(event) => {
              const nextParamsText = event.target.value;
              latestPreviewStateRef.current = {
                ...latestPreviewStateRef.current,
                paramsText: nextParamsText,
              };
              setParamsText(nextParamsText);
              setPreview(null);
            }}
            rows={7}
            value={paramsText}
          />
        </label>

        <div className="button-row abi-payload-actions">
          <button disabled={previewDisabled} onClick={handlePreviewCalldata} type="button">
            Preview Encoding
          </button>
          <button disabled type="button">
            Read Call
          </button>
          <button disabled type="button">
            Submit Transaction
          </button>
        </div>

        {preview && (
          <div className="abi-preview-result" aria-label="ABI calldata preview result">
            <div className="confirmation-grid">
              <div>Signature</div>
              <div className="mono">{preview.functionSignature}</div>
              <div>Selector</div>
              <div className="mono">{preview.selector ?? "none"}</div>
              <div>Calldata bytes</div>
              <div>{preview.calldata?.byteLength ?? "none"}</div>
              <div>Calldata hash</div>
              <div className="mono">{preview.calldata?.hash ?? "none"}</div>
              <div>Status</div>
              <div>{statusLabel(preview.status)}</div>
            </div>
            {preview.errorSummary && <div className="inline-error">{preview.errorSummary}</div>}
            {preview.parameterSummary.length > 0 && (
              <ul className="abi-summary-tree">
                {preview.parameterSummary.map((summary, index) => renderSummary(summary, `param-${index}`))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="abi-panel" aria-label="ABI cache entries">
        <header className="abi-panel-header">
          <h3>Cache Entries</h3>
        </header>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Source</th>
                <th>Fingerprint</th>
                <th>Counts</th>
                <th>Status</th>
                <th>Dates</th>
                <th>Error</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {targetEntries.length === 0 && (
                <tr>
                  <td colSpan={8}>No cache entries match this target.</td>
                </tr>
              )}
              {targetEntries.map((entry) => {
                const selectionNeedsResolution =
                  entry.selectionStatus === "sourceConflict" ||
                  entry.selectionStatus === "needsUserChoice";
                return (
                  <tr key={cacheIdentity(entry)}>
                    <td>
                      <div>chainId {entry.chainId}</div>
                      <div className="mono">{entry.contractAddress}</div>
                    </td>
                    <td>
                      <strong>{sourceDisplay(entry)}</strong>
                      <div className="mono">version {entry.versionId}</div>
                      <div className="mono">attempt {entry.attemptId}</div>
                    </td>
                    <td>
                      <div className="mono">fp {compact(entry.sourceFingerprint, 14, 8)}</div>
                      <div className="mono">abi {compact(entry.abiHash, 14, 8)}</div>
                    </td>
                    <td>
                      <div>Functions {entry.functionCount ?? 0}</div>
                      <div>Events {entry.eventCount ?? 0}</div>
                      <div>Errors {entry.errorCount ?? 0}</div>
                      <div>{selectorText(entry)}</div>
                    </td>
                    <td>
                      <div className="history-status-stack">
                        <span className={statusClass(entry.fetchSourceStatus)}>
                          {statusLabel(entry.fetchSourceStatus)}
                        </span>
                        <span className={statusClass(entry.validationStatus)}>
                          {statusLabel(entry.validationStatus)}
                        </span>
                        <span className={statusClass(entry.cacheStatus)}>
                          {statusLabel(entry.cacheStatus)}
                        </span>
                        <span className={statusClass(entry.selectionStatus)}>
                          {statusLabel(entry.selectionStatus)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div>Fetched {formatTimestamp(entry.fetchedAt)}</div>
                      <div>Imported {formatTimestamp(entry.importedAt)}</div>
                      <div>Validated {formatTimestamp(entry.lastValidatedAt)}</div>
                      <div>Stale after {formatTimestamp(entry.staleAfter)}</div>
                      <div>Updated {formatTimestamp(entry.updatedAt)}</div>
                    </td>
                    <td>
                      <div>{entry.lastErrorSummary || "None"}</div>
                      {entry.proxyDetected && <div>Proxy hint {entry.providerProxyHint || "detected"}</div>}
                      {selectionNeedsResolution && (
                        <div className="abi-resolution-guidance">
                          Resolve with refresh, corrected import/paste, source config edit/remove,
                          mark stale, or delete.
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="button-row abi-action-stack">
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => onMarkStale(entry)}
                          aria-label={`Mark ABI cache entry ${entry.contractAddress} version ${
                            entry.versionId
                          } from ${sourceDisplay(entry)} stale`}
                          title={`Mark ABI cache entry ${entry.contractAddress} version ${
                            entry.versionId
                          } from ${sourceDisplay(entry)} stale`}
                          type="button"
                        >
                          Mark Stale
                        </button>
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => onDeleteEntry(entry)}
                          aria-label={`Delete ABI cache entry ${entry.contractAddress} version ${
                            entry.versionId
                          } from ${sourceDisplay(entry)}`}
                          title={`Delete ABI cache entry ${entry.contractAddress} version ${
                            entry.versionId
                          } from ${sourceDisplay(entry)}`}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
