import { useEffect, useMemo, useRef, useState } from "react";
import type {
  HistoryRecord,
  TxAnalysisDecodedValueSummary,
  TxAnalysisErrorDecodeCandidate,
  TxAnalysisEventDecodeCandidate,
  TxAnalysisFetchInput,
  TxAnalysisFetchReadModel,
  TxAnalysisFunctionDecodeCandidate,
} from "../../lib/tauri";
import {
  rawCalldataRpcEndpointFingerprint,
  summarizeRawCalldataRpcEndpoint,
} from "../rawCalldata/RawCalldataView";

export interface TxAnalysisViewProps {
  chainId: bigint;
  chainName: string;
  rpcUrl: string;
  chainReady: boolean;
  history?: HistoryRecord[];
  onFetchTxAnalysis?: (input: TxAnalysisFetchInput) => Promise<TxAnalysisFetchReadModel>;
}

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const DECODED_VALUE_DISPLAY_MAX = 96;
const DECODED_VALUE_EDGE = 36;

function short(value: string | null | undefined) {
  if (!value) return "unknown";
  return value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

function sourceLabel(key: string) {
  switch (key) {
    case "chainId":
      return "RPC chainId";
    case "localHistory":
      return "Local history";
    default:
      return key[0].toUpperCase() + key.slice(1);
  }
}

function statusTitle(model: TxAnalysisFetchReadModel) {
  if (
    model.rpc.chainStatus.toLowerCase().includes("mismatch") ||
    (model.rpc.actualChainId !== null &&
      model.rpc.actualChainId !== undefined &&
      model.rpc.actualChainId !== model.rpc.expectedChainId)
  ) {
    return "Chain/RPC mismatch";
  }
  if (!model.transaction) return "Transaction not found";
  if (!model.receipt) return "Pending or no receipt yet";
  if (model.receipt.status === 0 || model.receipt.statusLabel.toLowerCase().includes("revert")) {
    return "Reverted";
  }
  return "Analysis ready";
}

function isWarningTitle(title: string) {
  return title !== "Analysis ready";
}

function uncertaintyLabel(code: string) {
  switch (code) {
    case "unknownSelector":
      return "Unknown selector";
    case "selectorConflict":
      return "Selector conflict";
    default:
      return code;
  }
}

function boundedDecodedText(value: string) {
  if (value.length <= DECODED_VALUE_DISPLAY_MAX) return value;
  return `${value.slice(0, DECODED_VALUE_EDGE)}...${value.slice(-DECODED_VALUE_EDGE)} [truncated]`;
}

function valueSummary(value: TxAnalysisDecodedValueSummary): string {
  const displayValue = value.value
    ? boundedDecodedText(value.value)
    : value.hash
      ? boundedDecodedText(value.hash)
      : value.byteLength !== null && value.byteLength !== undefined
        ? `${value.byteLength} bytes`
        : null;
  const parts = [
    value.name ? `${value.name}:` : null,
    value.type,
    displayValue,
    value.truncated ? "(truncated)" : null,
  ].filter(Boolean);
  return parts.join(" ");
}

function candidateSummary(candidate: TxAnalysisFunctionDecodeCandidate) {
  const args = candidate.argumentSummary.map(valueSummary).join(", ");
  return args ? `${candidate.functionSignature}(${args})` : candidate.functionSignature;
}

function eventCandidateSummary(candidate: TxAnalysisEventDecodeCandidate) {
  const args = candidate.argumentSummary.map(valueSummary).join(", ");
  return args ? `${candidate.eventSignature}(${args})` : candidate.eventSignature;
}

function errorCandidateSummary(candidate: TxAnalysisErrorDecodeCandidate) {
  const args = candidate.argumentSummary.map(valueSummary).join(", ");
  return args ? `${candidate.errorSignature}(${args})` : candidate.errorSignature;
}

function copySummary(
  model: TxAnalysisFetchReadModel,
  title: string,
  localState: string,
  endpointSummary: string,
) {
  return [
    `tx=${model.hash}`,
    `chainId=${model.chainId}`,
    `rpc=${endpointSummary}`,
    `status=${title}`,
    `selector=${model.transaction?.selector ?? model.analysis.selector.selector ?? "none"}`,
    `calldataHash=${model.transaction?.calldataHash ?? "unknown"}`,
    `receipt=${model.receipt?.statusLabel ?? "none"}`,
    `block=${model.block?.number ?? "unknown"}`,
    `localHistory=${localState}`,
  ].join("\n");
}

function matchingHistory(records: HistoryRecord[], hash: string, chainId: number) {
  const normalizedHash = hash.toLowerCase();
  return records.find(
    (record) =>
      record.submission?.tx_hash?.toLowerCase() === normalizedHash &&
      record.submission.chain_id === chainId,
  );
}

async function copyText(value: string, onCopied: (label: string) => void, label: string) {
  await navigator.clipboard?.writeText(value);
  onCopied(label);
}

function CopyInline({
  label,
  value,
  onCopied,
}: {
  label: string;
  value: string;
  onCopied: (label: string) => void;
}) {
  return (
    <button
      className="tx-analysis-inline-copy"
      onClick={() => void copyText(value, onCopied, label)}
      type="button"
    >
      Copy {label}
    </button>
  );
}

export function TxAnalysisView({
  chainId,
  chainName,
  rpcUrl,
  chainReady,
  history = [],
  onFetchTxAnalysis,
}: TxAnalysisViewProps) {
  const [txHash, setTxHash] = useState("");
  const [analysis, setAnalysis] = useState<TxAnalysisFetchReadModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const activeRequestRef = useRef<number | null>(null);

  const trimmedHash = txHash.trim();
  const validHash = TX_HASH_RE.test(trimmedHash);
  const trimmedRpcUrl = rpcUrl.trim();
  const disabledReason = !chainReady
    ? "Validate an RPC before analyzing a transaction hash."
    : !validHash
      ? "Enter a 0x-prefixed 32-byte transaction hash."
      : null;
  const endpointSummary = trimmedRpcUrl ? summarizeRawCalldataRpcEndpoint(trimmedRpcUrl) : "none";
  const endpointFingerprint = trimmedRpcUrl
    ? rawCalldataRpcEndpointFingerprint(trimmedRpcUrl)
    : null;
  const chainIdNumber = Number(chainId);
  const localMatch = useMemo(
    () => matchingHistory(history, analysis?.hash ?? trimmedHash, chainIdNumber),
    [analysis?.hash, chainIdNumber, history, trimmedHash],
  );

  function invalidateInFlightAnalysis() {
    requestVersionRef.current += 1;
    if (activeRequestRef.current !== null) {
      activeRequestRef.current = null;
      setLoading(false);
    }
  }

  useEffect(() => {
    invalidateInFlightAnalysis();
    setAnalysis(null);
    setError(null);
    setCopied(null);
  }, [chainIdNumber, trimmedRpcUrl]);

  async function handleAnalyze() {
    if (disabledReason) return;
    const requestId = requestVersionRef.current + 1;
    requestVersionRef.current = requestId;
    activeRequestRef.current = requestId;
    setLoading(true);
    setError(null);
    setCopied(null);
    try {
      if (!onFetchTxAnalysis) {
        throw new Error("Tx analysis handler is not configured.");
      }
      const result = await onFetchTxAnalysis({
        rpcUrl: trimmedRpcUrl,
        chainId: chainIdNumber,
        txHash: trimmedHash,
        selectedRpc: {
          chainId: chainIdNumber,
          providerConfigId: `chain-${chainIdNumber}`,
          endpointId: "active",
          endpointName: "Selected RPC",
          endpointSummary,
          endpointFingerprint,
        },
        boundedRevertData: null,
      });
      if (requestVersionRef.current !== requestId || activeRequestRef.current !== requestId) {
        return;
      }
      setAnalysis(result);
    } catch (err) {
      if (requestVersionRef.current !== requestId || activeRequestRef.current !== requestId) {
        return;
      }
      setAnalysis(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (activeRequestRef.current === requestId || activeRequestRef.current === null) {
        if (activeRequestRef.current === requestId) {
          activeRequestRef.current = null;
        }
        setLoading(false);
      }
    }
  }

  const title = analysis ? statusTitle(analysis) : null;

  return (
    <section className="workspace-section tx-analysis-grid">
      <header className="section-header">
        <div>
          <h2>Tx Analysis</h2>
          <p className="section-subtitle">
            Read-only transaction hash analysis for {chainName} chainId {chainId.toString()}.
          </p>
        </div>
      </header>

      <div className="inline-warning" role="note">
        Read-only analysis only. This view does not submit, rebroadcast, replace, cancel, revoke, or
        recover transactions.
      </div>

      <section aria-label="Transaction lookup" className="confirmation-panel">
        <div className="field-row">
          <label>
            Transaction hash
            <input
              autoComplete="off"
              className="mono"
              onChange={(event) => {
                invalidateInFlightAnalysis();
                setTxHash(event.target.value);
                setAnalysis(null);
                setError(null);
                setCopied(null);
              }}
              placeholder="0x..."
              value={txHash}
            />
          </label>
          <button disabled={Boolean(disabledReason) || loading} onClick={handleAnalyze} type="button">
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </div>
        {disabledReason && <div className="inline-warning">{disabledReason}</div>}
        <dl className="confirmation-grid tx-analysis-summary-grid">
          <div>Selected chain</div>
          <div>{chainName} ({chainId.toString()})</div>
          <div>RPC endpoint</div>
          <div className="mono">{endpointSummary}</div>
          <div>RPC fingerprint</div>
          <div className="mono">{endpointFingerprint ?? "none"}</div>
        </dl>
      </section>

      {error && <div className="inline-error" role="alert">{error}</div>}

      {analysis && title && (
        <>
          <section aria-label="Request and source summary" className="confirmation-panel">
            <header className="section-header">
              <div>
                <h3>Request and Sources</h3>
                <p className="section-subtitle">
                  Provider visibility is explicit; explorer and indexer enrichment are advisory when present.
                </p>
              </div>
              <div className="button-row">
                <button
                  onClick={() =>
                    void copyText(
                      copySummary(
                        analysis,
                        title,
                        localMatch ? "match" : "noMatch",
                        endpointSummary,
                      ),
                      setCopied,
                      "summary",
                    )
                  }
                  type="button"
                >
                  Copy summary
                </button>
                <span className={isWarningTitle(title) ? "pill danger-pill" : "pill"}>{title}</span>
              </div>
            </header>
            {copied === "summary" && <div className="inline-success">Copied summary.</div>}
            {analysis.errorSummary && (
              <div className="inline-warning">{analysis.errorSummary}</div>
            )}
            <div className="tx-analysis-pill-row">
              {(Object.entries(analysis.sources) as Array<[
                keyof TxAnalysisFetchReadModel["sources"],
                TxAnalysisFetchReadModel["sources"][keyof TxAnalysisFetchReadModel["sources"]],
              ]>).map(([key, value]) => (
                <span className="pill" key={key}>
                  {sourceLabel(key)}: {value.status}
                  {value.reason ? ` (${value.reason})` : ""}
                </span>
              ))}
            </div>
            <dl className="confirmation-grid tx-analysis-summary-grid">
              <div>Expected chainId</div>
              <div>{analysis.rpc.expectedChainId}</div>
              <div>Actual chainId</div>
              <div>{analysis.rpc.actualChainId ?? "unknown"}</div>
              <div>RPC chain status</div>
              <div>{analysis.rpc.chainStatus}</div>
              <div>Read model status</div>
              <div>{analysis.status}</div>
            </dl>
          </section>

          <section aria-label="Transaction identity" className="confirmation-panel">
            <header className="section-header">
              <h3>Transaction Identity</h3>
              <button
                onClick={() => void copyText(analysis.hash, setCopied, "tx hash")}
                type="button"
              >
                Copy tx hash
              </button>
            </header>
            {copied === "tx hash" && <div className="inline-success">Copied tx hash.</div>}
            {analysis.transaction ? (
              <dl className="confirmation-grid tx-analysis-summary-grid">
                <div>Tx hash</div>
                <div className="mono">{analysis.hash}</div>
                <div>From</div>
                <div className="mono">
                  {analysis.transaction.from}
                  <CopyInline
                    label="from address"
                    onCopied={setCopied}
                    value={analysis.transaction.from}
                  />
                </div>
                <div>To</div>
                <div className="mono">
                  {analysis.transaction.contractCreation
                    ? "contract creation"
                    : analysis.transaction.to ?? "unknown"}
                  {!analysis.transaction.contractCreation && analysis.transaction.to && (
                    <CopyInline
                      label="to address"
                      onCopied={setCopied}
                      value={analysis.transaction.to}
                    />
                  )}
                </div>
                <div>Nonce</div>
                <div>{analysis.transaction.nonce}</div>
                <div>Value</div>
                <div>{analysis.transaction.valueWei} wei</div>
                <div>Selector</div>
                <div className="mono">
                  {analysis.transaction.selector ?? "none"}
                  {analysis.transaction.selector && (
                    <CopyInline
                      label="selector"
                      onCopied={setCopied}
                      value={analysis.transaction.selector}
                    />
                  )}
                </div>
                <div>Calldata</div>
                <div>
                  {analysis.transaction.calldataByteLength} bytes · {analysis.transaction.calldataHashVersion}{" "}
                  <span className="mono">{analysis.transaction.calldataHash}</span>
                  <CopyInline
                    label="calldata hash"
                    onCopied={setCopied}
                    value={analysis.transaction.calldataHash}
                  />
                </div>
              </dl>
            ) : (
              <div className="inline-warning">Transaction not found</div>
            )}
          </section>

          <section aria-label="Receipt and logs" className="confirmation-panel">
            <header className="section-header">
              <h3>Receipt and Logs</h3>
              <span className="pill">{analysis.receipt?.statusLabel ?? "no receipt"}</span>
            </header>
            {analysis.receipt ? (
              <>
                <dl className="confirmation-grid tx-analysis-summary-grid">
                  <div>Receipt status</div>
                  <div>{analysis.receipt.statusLabel}</div>
                  <div>Gas used</div>
                  <div>{analysis.receipt.gasUsed ?? "unknown"}</div>
                  <div>Effective gas price</div>
                  <div>{analysis.receipt.effectiveGasPrice ?? "unknown"}</div>
                  <div>Logs status</div>
                  <div>{analysis.receipt.logsStatus}</div>
                  <div>Logs count</div>
                  <div>{analysis.receipt.logsCount ?? analysis.receipt.logs.length}</div>
                </dl>
                {analysis.receipt.logs.length === 0 ? (
                  <div className="inline-warning">Logs missing or unavailable</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Index</th>
                        <th>Address</th>
                        <th>Topic 0</th>
                        <th>Data summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.receipt.logs.map((log) => (
                        <tr key={`${log.address}-${log.logIndex ?? "unknown"}`}>
                          <td>{log.logIndex ?? "unknown"}</td>
                          <td className="mono">
                            {short(log.address)}
                            <CopyInline
                              label="log address"
                              onCopied={setCopied}
                              value={log.address}
                            />
                          </td>
                          <td className="mono">
                            {log.topic0 ?? "none"}
                            {log.topic0 && (
                              <CopyInline
                                label="topic"
                                onCopied={setCopied}
                                value={log.topic0}
                              />
                            )}
                          </td>
                          <td>
                            {log.dataByteLength} bytes · {log.dataHashVersion}{" "}
                            <span className="mono">{log.dataHash}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            ) : (
              <div className="inline-warning">Pending or no receipt yet</div>
            )}
          </section>

          <section aria-label="Block and code" className="confirmation-panel">
            <header className="section-header">
              <h3>Block and Code</h3>
            </header>
            <dl className="confirmation-grid tx-analysis-summary-grid">
              <div>Block</div>
              <div>{analysis.block?.number ?? "unknown"}</div>
              <div>Block hash</div>
              <div className="mono">{analysis.block?.hash ?? "unknown"}</div>
              <div>Timestamp</div>
              <div>{analysis.block?.timestamp ?? "unknown"}</div>
            </dl>
            {analysis.addressCodes.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Address</th>
                    <th>Status</th>
                    <th>Code summary</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.addressCodes.map((code) => (
                    <tr key={`${code.role}-${code.address}`}>
                      <td>{code.role}</td>
                      <td className="mono">
                        {short(code.address)}
                        <CopyInline
                          label={`${code.role} code address`}
                          onCopied={setCopied}
                          value={code.address}
                        />
                      </td>
                      <td>{code.status}</td>
                      <td>
                        {code.byteLength ?? "unknown"} bytes at {code.blockTag}
                        {code.codeHash ? (
                          <>
                            {" "}· {code.codeHashVersion} <span className="mono">{code.codeHash}</span>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="inline-warning">No code summaries available.</div>
            )}
          </section>

          <section aria-label="Decode candidates" className="confirmation-panel">
            <header className="section-header">
              <div>
                <h3>Decode and Classification Candidates</h3>
                <p className="section-subtitle">
                  ABI decode and classifications are candidates, not certain facts.
                </p>
              </div>
              <span className={analysis.analysis.selector.conflict ? "pill danger-pill" : "pill"}>
                {analysis.analysis.selector.conflict ? "Selector conflict" : analysis.analysis.status}
              </span>
            </header>
            <div className="tx-analysis-pill-row">
              {analysis.analysis.selector.selectorStatus !== "present" && (
                <span className="pill danger-pill">Unknown selector</span>
              )}
              {analysis.analysis.selector.conflict && (
                <span className="pill danger-pill">Selector conflict</span>
              )}
              {analysis.analysis.uncertaintyStatuses.map((item) => (
                <span className="pill danger-pill" key={`${item.source}-${item.code}`}>
                  {uncertaintyLabel(item.code)}
                </span>
              ))}
            </div>
            <dl className="confirmation-grid tx-analysis-summary-grid">
              <div>Selector</div>
              <div className="mono">{analysis.analysis.selector.selector ?? "none"}</div>
              <div>Matches</div>
              <div>
                {analysis.analysis.selector.selectorMatchCount} matches ·{" "}
                {analysis.analysis.selector.uniqueSignatureCount} unique signatures ·{" "}
                {analysis.analysis.selector.sourceCount} source(s)
              </div>
            </dl>
            {analysis.analysis.abiSources.length > 0 && (
              <div className="tx-analysis-source-list">
                {analysis.analysis.abiSources.map((source) => (
                  <dl
                    className="confirmation-grid tx-analysis-summary-grid"
                    key={`${source.contractAddress}-${source.versionId}-${source.sourceFingerprint}`}
                  >
                    <div>ABI source</div>
                    <div>{source.sourceKind} · {source.selectionStatus}</div>
                    <div>Source hash</div>
                    <div className="mono">
                      {source.sourceFingerprint}
                      <CopyInline
                        label="source fingerprint"
                        onCopied={setCopied}
                        value={source.sourceFingerprint}
                      />
                    </div>
                    <div>ABI hash</div>
                    <div className="mono">
                      {source.abiHash}
                      <CopyInline label="ABI hash" onCopied={setCopied} value={source.abiHash} />
                    </div>
                  </dl>
                ))}
              </div>
            )}
            {analysis.analysis.functionCandidates.length > 0 ? (
              <div className="tx-analysis-candidate-list">
                {analysis.analysis.functionCandidates.map((candidate) => (
                  <article
                    className="tx-analysis-candidate"
                    key={`${candidate.selector}-${candidate.functionSignature}-${candidate.sourceLabel}`}
                  >
                    <div className="tx-analysis-candidate-title">
                      <strong>{candidate.functionSignature}</strong>
                      <span className="pill">{candidate.confidence}</span>
                    </div>
                    <p>{candidateSummary(candidate)}</p>
                    <p className="section-subtitle">
                      {candidate.sourceLabel} · {candidate.decodeStatus}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="inline-warning">No function decode candidates.</div>
            )}
            {analysis.analysis.eventCandidates.length > 0 && (
              <div className="tx-analysis-candidate-list">
                {analysis.analysis.eventCandidates.map((candidate) => (
                  <article
                    className="tx-analysis-candidate"
                    key={`${candidate.address}-${candidate.logIndex ?? "unknown"}-${candidate.eventSignature}-${candidate.sourceLabel}`}
                  >
                    <div className="tx-analysis-candidate-title">
                      <strong>{candidate.eventSignature}</strong>
                      <span className="pill">{candidate.confidence}</span>
                    </div>
                    <p>{eventCandidateSummary(candidate)}</p>
                    <p className="section-subtitle">
                      Event decode candidate from {candidate.sourceLabel} · {candidate.decodeStatus}
                    </p>
                    <dl className="confirmation-grid tx-analysis-summary-grid">
                      <div>Log</div>
                      <div>
                        #{candidate.logIndex ?? "unknown"} · topic0{" "}
                        <span className="mono">{candidate.topic0 ?? "none"}</span>
                      </div>
                      <div>Data hash</div>
                      <div className="mono">{candidate.dataHash}</div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
            {analysis.analysis.errorCandidates.length > 0 && (
              <div className="tx-analysis-candidate-list">
                {analysis.analysis.errorCandidates.map((candidate) => (
                  <article
                    className="tx-analysis-candidate"
                    key={`${candidate.selector}-${candidate.errorSignature}-${candidate.sourceLabel}`}
                  >
                    <div className="tx-analysis-candidate-title">
                      <strong>{candidate.errorSignature}</strong>
                      <span className="pill">{candidate.confidence}</span>
                    </div>
                    <p>{errorCandidateSummary(candidate)}</p>
                    <p className="section-subtitle">
                      Error decode candidate from {candidate.sourceLabel} · {candidate.decodeStatus}
                    </p>
                  </article>
                ))}
              </div>
            )}
            {analysis.analysis.revertData && (
              <article className="tx-analysis-candidate">
                <div className="tx-analysis-candidate-title">
                  <strong>Revert data candidate</strong>
                  <span className="pill">{analysis.analysis.revertData.status}</span>
                </div>
                <p className="section-subtitle">
                  Revert data is bounded and advisory; raw payload is not displayed.
                </p>
                <dl className="confirmation-grid tx-analysis-summary-grid">
                  <div>Source</div>
                  <div>{analysis.analysis.revertData.source}</div>
                  <div>Selector</div>
                  <div className="mono">{analysis.analysis.revertData.selector ?? "unknown"}</div>
                  <div>Data</div>
                  <div>
                    {analysis.analysis.revertData.byteLength ?? "unknown"} bytes ·{" "}
                    {analysis.analysis.revertData.dataHashVersion ?? "unknown"}{" "}
                    <span className="mono">{analysis.analysis.revertData.dataHash ?? "unknown"}</span>
                    {analysis.analysis.revertData.dataHash && (
                      <CopyInline
                        label="revert data hash"
                        onCopied={setCopied}
                        value={analysis.analysis.revertData.dataHash}
                      />
                    )}
                  </div>
                </dl>
              </article>
            )}
            {analysis.analysis.classificationCandidates.map((candidate) => (
              <article
                className="tx-analysis-candidate"
                key={`${candidate.kind}-${candidate.label}-${candidate.source}`}
              >
                <div className="tx-analysis-candidate-title">
                  <strong>{candidate.label}</strong>
                  <span className="pill">{candidate.confidence}</span>
                </div>
                <p>
                  {candidate.kind} candidate from {candidate.source}
                  {candidate.signature ? ` · ${candidate.signature}` : ""}
                </p>
              </article>
            ))}
          </section>

          <section aria-label="Local history comparison" className="confirmation-panel">
            <header className="section-header">
              <h3>Local History</h3>
              <span className="pill">{localMatch ? "Local history match" : "No local history match"}</span>
            </header>
            <p className="section-subtitle">
              Local history is shown beside RPC facts and does not override them.
            </p>
            {localMatch ? (
              <dl className="confirmation-grid tx-analysis-summary-grid">
                <div>Outcome</div>
                <div>{localMatch.outcome?.state ?? "unknown"}</div>
                <div>Local tx</div>
                <div className="mono">{localMatch.submission.tx_hash}</div>
                <div>Local chainId</div>
                <div>{localMatch.submission.chain_id ?? "unknown"}</div>
              </dl>
            ) : (
              <div className="inline-warning">No local history match</div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
