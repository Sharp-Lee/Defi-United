import { useEffect, useMemo, useState } from "react";
import type {
  AbiCacheEntryRecord,
  AbiDataSourceConfigRecord,
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
  const [localError, setLocalError] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

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
