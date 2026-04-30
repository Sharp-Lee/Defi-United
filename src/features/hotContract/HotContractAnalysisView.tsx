import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AbiRegistryState,
  HotContractAnalysisFetchInput,
  HotContractAnalysisReadModel,
  HotContractSourceStatus,
} from "../../lib/tauri";
import {
  buildHotContractCopySummary,
  compactBoundedHotContractText,
  compactHotContractError,
  compactHotContractText,
  hotContractStatusTitle,
  percentFromBps,
  sourceStatusLabel,
  uncertaintyLabel,
} from "../../core/hotContract/readModel";
import {
  rawCalldataRpcEndpointFingerprint,
  summarizeRawCalldataRpcEndpoint,
} from "../rawCalldata/RawCalldataView";

export interface HotContractAnalysisViewProps {
  chainId: bigint;
  chainName: string;
  rpcUrl: string;
  chainReady: boolean;
  abiRegistryState?: AbiRegistryState | null;
  onFetchHotContractAnalysis?: (
    input: HotContractAnalysisFetchInput,
  ) => Promise<HotContractAnalysisReadModel>;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const MAX_SAMPLE_LIMIT = 500;
const SAMPLE_WINDOW_ERROR = "Use a bounded sample window from 1h to 720h or 1d to 30d.";
const UNSAFE_CHAIN_ID_ERROR =
  "Hot contract analysis requires a positive safe integer chainId.";

function clampSampleLimit(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_SAMPLE_LIMIT);
}

function normalizeSampleWindow(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true as const, value: null };
  const match = /^([1-9]\d*)([hHdD])$/.exec(trimmed);
  if (!match) return { ok: false as const, value: null };
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (!Number.isSafeInteger(amount)) return { ok: false as const, value: null };
  if (unit === "h" && amount >= 1 && amount <= 720) {
    return { ok: true as const, value: `${amount}h` };
  }
  if (unit === "d" && amount >= 1 && amount <= 30) {
    return { ok: true as const, value: `${amount}d` };
  }
  return { ok: false as const, value: null };
}

function safeChainIdNumber(value: bigint) {
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
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

function SourcePill({ name, value }: { name: string; value: HotContractSourceStatus }) {
  return <span className="pill">{sourceStatusLabel(name, value)}</span>;
}

function sourceLimitedLabel(analysis: HotContractAnalysisReadModel) {
  if (
    analysis.status === "limited" ||
    analysis.sampleCoverage.sourceStatus !== "ok" ||
    analysis.sources.source.status !== "ok"
  ) {
    return "RPC-only limited analysis";
  }
  return null;
}

function sourceIdentityValue(source: HotContractAnalysisReadModel["decode"]["abiSources"][number]) {
  return compactBoundedHotContractText(
    source.userSourceId ?? source.providerConfigId ?? source.versionId,
  );
}

function clearAnalysisState(
  invalidateInFlightAnalysis: () => void,
  setAnalysis: (value: HotContractAnalysisReadModel | null) => void,
  setError: (value: string | null) => void,
  setCopied: (value: string | null) => void,
) {
  invalidateInFlightAnalysis();
  setAnalysis(null);
  setError(null);
  setCopied(null);
}

export function HotContractAnalysisView({
  abiRegistryState = null,
  chainId,
  chainName,
  rpcUrl,
  chainReady,
  onFetchHotContractAnalysis,
}: HotContractAnalysisViewProps) {
  const [contractAddress, setContractAddress] = useState("");
  const [seedTxHash, setSeedTxHash] = useState("");
  const [sourceProvider, setSourceProvider] = useState("local-only");
  const [sampleLimit, setSampleLimit] = useState("25");
  const [sampleWindow, setSampleWindow] = useState("7d");
  const [analysis, setAnalysis] = useState<HotContractAnalysisReadModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const activeRequestRef = useRef<number | null>(null);

  const trimmedAddress = contractAddress.trim();
  const validAddress = ADDRESS_RE.test(trimmedAddress);
  const trimmedSeedTxHash = seedTxHash.trim();
  const validSeedTxHash = !trimmedSeedTxHash || TX_HASH_RE.test(trimmedSeedTxHash);
  const provenanceSeedTxHash = analysis?.seedTxHash ?? trimmedSeedTxHash;
  const seedTxHashSummary = provenanceSeedTxHash
    ? compactBoundedHotContractText(provenanceSeedTxHash)
    : "none";
  const normalizedSampleWindow = normalizeSampleWindow(sampleWindow);
  const trimmedRpcUrl = rpcUrl.trim();
  const chainIdNumber = safeChainIdNumber(chainId);
  const sourceProviders = useMemo(
    () =>
      chainIdNumber === null
        ? []
        : (abiRegistryState?.dataSources ?? []).filter(
            (source) => source.chainId === chainIdNumber && source.enabled,
          ),
    [abiRegistryState, chainIdNumber],
  );
  const endpointSummary = trimmedRpcUrl ? summarizeRawCalldataRpcEndpoint(trimmedRpcUrl) : "none";
  const endpointFingerprint = trimmedRpcUrl
    ? rawCalldataRpcEndpointFingerprint(trimmedRpcUrl)
    : null;
  const disabledReason = !chainReady
    ? "Validate an RPC before analyzing a hot contract."
    : chainIdNumber === null
      ? UNSAFE_CHAIN_ID_ERROR
    : !validAddress
      ? "Enter a 0x-prefixed 20-byte contract address."
      : !validSeedTxHash
        ? "Enter a 0x-prefixed 32-byte transaction hash or leave seed empty."
        : !normalizedSampleWindow.ok
          ? SAMPLE_WINDOW_ERROR
          : null;

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

  useEffect(() => {
    if (
      sourceProvider !== "local-only" &&
      !sourceProviders.some((source) => source.id === sourceProvider)
    ) {
      clearAnalysisState(invalidateInFlightAnalysis, setAnalysis, setError, setCopied);
      setSourceProvider("local-only");
    }
  }, [sourceProvider, sourceProviders]);

  async function handleAnalyze() {
    if (disabledReason) return;
    if (chainIdNumber === null) return;
    const requestId = requestVersionRef.current + 1;
    requestVersionRef.current = requestId;
    activeRequestRef.current = requestId;
    setLoading(true);
    setAnalysis(null);
    setError(null);
    setCopied(null);
    try {
      if (!onFetchHotContractAnalysis) {
        throw new Error("Hot contract analysis handler is not configured.");
      }
      const result = await onFetchHotContractAnalysis({
        rpcUrl: trimmedRpcUrl,
        chainId: chainIdNumber,
        contractAddress: trimmedAddress,
        seedTxHash: trimmedSeedTxHash || null,
        selectedRpc: {
          chainId: chainIdNumber,
          providerConfigId: null,
          endpointId: "active",
          endpointName: "Selected RPC",
          endpointSummary,
          endpointFingerprint,
        },
        source: {
          providerConfigId: sourceProvider === "local-only" ? null : sourceProvider,
          limit: clampSampleLimit(sampleLimit),
          window: normalizedSampleWindow.value,
          cursor: null,
        },
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
      setError(compactHotContractError(err));
    } finally {
      if (activeRequestRef.current === requestId || activeRequestRef.current === null) {
        if (activeRequestRef.current === requestId) {
          activeRequestRef.current = null;
        }
        setLoading(false);
      }
    }
  }

  const title = analysis ? hotContractStatusTitle(analysis) : null;
  const limitedLabel = analysis ? sourceLimitedLabel(analysis) : null;

  return (
    <section className="workspace-section hot-contract-grid">
      <header className="section-header">
        <div>
          <h2>Hot Contract Analysis</h2>
          <p className="section-subtitle">
            Read-only contract activity sampling for {chainName} chainId {chainId.toString()}.
          </p>
        </div>
      </header>

      <div className="inline-warning" role="note">
        Read-only analysis only. This view does not submit, rebroadcast, replace, cancel, revoke, or
        recover transactions.
      </div>

      <section aria-label="Hot contract lookup" className="confirmation-panel">
        <div className="field-row hot-contract-input-grid">
          <label>
            Contract address
            <input
              autoComplete="off"
              className="mono"
              onChange={(event) => {
                invalidateInFlightAnalysis();
                setContractAddress(event.target.value);
                setAnalysis(null);
                setError(null);
                setCopied(null);
              }}
              placeholder="0x..."
              value={contractAddress}
            />
          </label>
          <label>
            Optional tx hash seed (display only)
            <input
              autoComplete="off"
              className="mono"
              onChange={(event) => {
                clearAnalysisState(invalidateInFlightAnalysis, setAnalysis, setError, setCopied);
                setSeedTxHash(event.target.value);
              }}
              placeholder="0x..."
              value={seedTxHash}
            />
          </label>
          <label>
            Source provider
            <select
              onChange={(event) => {
                clearAnalysisState(invalidateInFlightAnalysis, setAnalysis, setError, setCopied);
                setSourceProvider(event.target.value);
              }}
              value={sourceProvider}
            >
              <option value="local-only">Local/RPC only</option>
              {sourceProviders.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.id} ({source.providerKind})
                </option>
              ))}
            </select>
          </label>
          <label>
            Sample limit
            <input
              inputMode="numeric"
              min="1"
              onChange={(event) => {
                clearAnalysisState(invalidateInFlightAnalysis, setAnalysis, setError, setCopied);
                setSampleLimit(event.target.value);
              }}
              type="number"
              value={sampleLimit}
            />
          </label>
          <label>
            Sample window
            <input
              onChange={(event) => {
                clearAnalysisState(invalidateInFlightAnalysis, setAnalysis, setError, setCopied);
                setSampleWindow(event.target.value);
              }}
              value={sampleWindow}
            />
          </label>
          <button disabled={Boolean(disabledReason) || loading} onClick={handleAnalyze} type="button">
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </div>
        {disabledReason && <div className="inline-warning">{disabledReason}</div>}
        <dl className="confirmation-grid tx-analysis-summary-grid">
          <div>Selected chain</div>
          <div>
            {chainName} ({chainId.toString()})
          </div>
          <div>RPC endpoint</div>
          <div className="mono">{endpointSummary}</div>
          <div>RPC fingerprint</div>
          <div className="mono">{endpointFingerprint ?? "none"}</div>
          <div>Bounded sample limit</div>
          <div>{clampSampleLimit(sampleLimit)}</div>
          <div>Seed tx hash</div>
          <div className="mono">{seedTxHashSummary}</div>
        </dl>
      </section>

      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}

      {analysis && title && (
        <>
          <section aria-label="Contract request summary" className="confirmation-panel">
            <header className="section-header">
              <div>
                <h3>Provider Visibility</h3>
                <p className="section-subtitle">
                  Provider and ABI enrichment are advisory; sampled counts are bounded.
                </p>
              </div>
              <div className="button-row">
                <button
                  onClick={() =>
                    void copyText(
                      buildHotContractCopySummary(
                        analysis,
                        endpointSummary,
                        analysis.seedTxHash ?? (trimmedSeedTxHash || null),
                      ),
                      setCopied,
                      "summary",
                    )
                  }
                  type="button"
                >
                  Copy summary
                </button>
                <span className={title === "Analysis ready" ? "pill" : "pill danger-pill"}>
                  {title}
                </span>
                {limitedLabel && <span className="pill">{limitedLabel}</span>}
              </div>
            </header>
            {copied === "summary" && <div className="inline-success">Copied summary.</div>}
            {analysis.errorSummary && (
              <div className="inline-warning">{compactHotContractText(analysis.errorSummary)}</div>
            )}
            <div className="tx-analysis-pill-row">
              <SourcePill name="chainId" value={analysis.sources.chainId} />
              <SourcePill name="code" value={analysis.sources.code} />
              <SourcePill name="source" value={analysis.sources.source} />
            </div>
            <dl className="confirmation-grid tx-analysis-summary-grid">
              <div>Expected chainId</div>
              <div>{analysis.rpc.expectedChainId}</div>
              <div>Actual chainId</div>
              <div>{analysis.rpc.actualChainId ?? "unknown"}</div>
              <div>RPC chain status</div>
              <div>{analysis.rpc.chainStatus}</div>
              <div>Seed tx hash</div>
              <div className="mono">{seedTxHashSummary}</div>
              <div>Read model status</div>
              <div>{analysis.status}</div>
            </dl>
          </section>

          <section aria-label="Contract identity" className="confirmation-panel">
            <header className="section-header">
              <h3>Contract Identity</h3>
              <button
                onClick={() =>
                  void copyText(analysis.contract.address, setCopied, "contract address")
                }
                type="button"
              >
                Copy contract address
              </button>
            </header>
            {copied === "contract address" && (
              <div className="inline-success">Copied contract address.</div>
            )}
            <dl className="confirmation-grid tx-analysis-summary-grid">
              <div>Address</div>
              <div className="mono">{analysis.contract.address}</div>
              <div>Code status</div>
              <div>{analysis.code.status}</div>
              <div>Code summary</div>
              <div>
                {analysis.code.byteLength ?? "unknown"} bytes at {analysis.code.blockTag}
                {analysis.code.codeHash ? (
                  <>
                    {" "}
                    · {analysis.code.codeHashVersion ?? "hash"}{" "}
                    <span className="mono">{analysis.code.codeHash}</span>
                    <CopyInline
                      label="code hash"
                      onCopied={setCopied}
                      value={analysis.code.codeHash}
                    />
                  </>
                ) : null}
              </div>
            </dl>
          </section>

          <section aria-label="Sample coverage" className="confirmation-panel">
            <header className="section-header">
              <h3>Sample Coverage</h3>
              <span className="pill">{analysis.sampleCoverage.sourceStatus}</span>
            </header>
            <dl className="confirmation-grid tx-analysis-summary-grid">
              <div>Requested limit</div>
              <div>{analysis.sampleCoverage.requestedLimit}</div>
              <div>Returned samples</div>
              <div>{analysis.sampleCoverage.returnedSamples}</div>
              <div>Omitted samples</div>
              <div>{analysis.sampleCoverage.omittedSamples}</div>
            </dl>
          </section>

          <section aria-label="Selector summary" className="confirmation-panel">
            <header className="section-header">
              <h3>Selector Summary</h3>
            </header>
            {analysis.analysis.selectors.length === 0 ? (
              <div className="inline-warning">No selector rows available.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Selector status</th>
                    <th>Sampled calls</th>
                    <th>Share</th>
                    <th>Status</th>
                    <th>Advisory labels</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.analysis.selectors.map((selector) => (
                    <tr key={selector.selector}>
                      <td className="mono">
                        {selector.selector}
                        <CopyInline
                          label="selector"
                          onCopied={setCopied}
                          value={selector.selector}
                        />
                      </td>
                      <td>{selector.sampledCallCount}</td>
                      <td>{percentFromBps(selector.sampleShareBps)}</td>
                      <td>
                        {selector.successCount} success · {selector.revertCount} revert ·{" "}
                        {selector.unknownStatusCount} unknown
                      </td>
                      <td>{selector.advisoryLabels.join(", ") || "none"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-label="Event topic summary" className="confirmation-panel">
            <header className="section-header">
              <h3>Event and Topic Summary</h3>
            </header>
            {analysis.analysis.topics.length === 0 ? (
              <div className="inline-warning">No event topic rows available.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Topic</th>
                    <th>Logs</th>
                    <th>Share</th>
                    <th>Advisory labels</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.analysis.topics.map((topic) => (
                    <tr key={topic.topic}>
                      <td className="mono">
                        {topic.topic}
                        <CopyInline label="topic" onCopied={setCopied} value={topic.topic} />
                      </td>
                      <td>{topic.logCount}</td>
                      <td>{percentFromBps(topic.sampleShareBps)}</td>
                      <td>{topic.advisoryLabels.join(", ") || "none"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-label="Example transactions" className="confirmation-panel">
            <header className="section-header">
              <h3>Example Transactions</h3>
            </header>
            {analysis.samples.length === 0 ? (
              <div className="inline-warning">No examples returned.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Tx hash</th>
                    <th>Block</th>
                    <th>Selector</th>
                    <th>Calldata summary</th>
                    <th>Topics</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.samples.map((sample, index) => (
                    <tr key={`${sample.txHash ?? "missing"}-${index}`}>
                      <td className="mono">
                        {sample.txHash ?? "unknown"}
                        {sample.txHash && (
                          <CopyInline
                            label="sample tx hash"
                            onCopied={setCopied}
                            value={sample.txHash}
                          />
                        )}
                      </td>
                      <td>{sample.blockNumber ?? "unknown"}</td>
                      <td>{sample.selector ? "present" : "none"}</td>
                      <td>
                        {sample.calldataLength ?? "unknown"} bytes
                        {sample.calldataHash ? (
                          <>
                            {" "}
                            · hash <span className="mono">{sample.calldataHash}</span>
                          </>
                        ) : null}
                      </td>
                      <td>{sample.logTopic0.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-label="Decode and uncertainty" className="confirmation-panel">
            <header className="section-header">
              <h3>Decode and Uncertainty</h3>
              <span className="pill">{analysis.decode.status}</span>
            </header>
            {analysis.decode.uncertaintyStatuses.length > 0 && (
              <div className="tx-analysis-pill-row">
                {analysis.decode.uncertaintyStatuses.map((item) => (
                  <span className="pill" key={`${item.code}-${item.source}`}>
                    {uncertaintyLabel(item.code)}
                  </span>
                ))}
              </div>
            )}
            {analysis.decode.items.length > 0 && (
              <div className="tx-analysis-candidate-list">
                {analysis.decode.items.map((item) => (
                  <article
                    className="tx-analysis-candidate"
                    key={`${item.kind}-${item.selector ?? item.topic ?? item.signature}`}
                  >
                    <div className="tx-analysis-candidate-title">
                      <strong>{item.signature ?? item.selector ?? item.topic ?? item.kind}</strong>
                      <span className="pill">{item.confidence}</span>
                    </div>
                    <p>
                      {item.kind} · {item.status} · {item.source}
                    </p>
                  </article>
                ))}
              </div>
            )}
            {analysis.decode.classificationCandidates.length > 0 && (
              <div className="tx-analysis-candidate-list">
                {analysis.decode.classificationCandidates.map((candidate) => (
                  <article
                    className="tx-analysis-candidate"
                    key={`${candidate.kind}-${candidate.selector ?? candidate.topic ?? candidate.label}`}
                  >
                    <div className="tx-analysis-candidate-title">
                      <strong>{candidate.label}</strong>
                      <span className="pill">{candidate.confidence}</span>
                    </div>
                    <p>{candidate.source}</p>
                  </article>
                ))}
              </div>
            )}
            {analysis.decode.abiSources.length > 0 && (
              <div className="tx-analysis-source-list">
                {analysis.decode.abiSources.map((source) => {
                  const copyValue = sourceIdentityValue(source);
                  return (
                    <article
                      className="tx-analysis-candidate"
                      key={`${source.sourceKind}-${source.versionId}-${copyValue}`}
                    >
                      <div className="tx-analysis-candidate-title">
                        <strong>
                          {source.sourceKind} {source.versionId}
                        </strong>
                        <span className="pill">{source.selected ? "selected" : "unselected"}</span>
                      </div>
                      <p>
                        {source.fetchSourceStatus} · {source.validationStatus} ·{" "}
                        {source.cacheStatus}
                      </p>
                      <p className="mono">
                        {copyValue}
                        <CopyInline
                          label="ABI source identity"
                          onCopied={setCopied}
                          value={copyValue}
                        />
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
