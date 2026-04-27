import { useEffect, useMemo, useState } from "react";
import {
  ALL_DIAGNOSTIC_FILTER,
  defaultDiagnosticFilters,
  diagnosticExportScopeSummary,
  diagnosticFilterOptions,
  diagnosticQueryFromFilters,
  diagnosticSensitiveExclusionText,
  selectDiagnosticEventViews,
  type DiagnosticViewFilters,
} from "../../core/diagnostics/selectors";
import {
  exportDiagnosticEvents,
  loadDiagnosticEvents,
  type DiagnosticEvent,
  type DiagnosticEventQuery,
  type DiagnosticExportResult,
} from "../../lib/tauri";

interface DiagnosticsViewProps {
  loadEvents?: (query?: DiagnosticEventQuery) => Promise<DiagnosticEvent[]>;
  exportEvents?: (query?: DiagnosticEventQuery) => Promise<DiagnosticExportResult>;
  nowMs?: number;
}

const TIME_WINDOWS: Array<{ value: DiagnosticViewFilters["timeWindow"]; label: string }> = [
  { value: "all", label: "All time" },
  { value: "hour", label: "Last hour" },
  { value: "day", label: "Last day" },
  { value: "week", label: "Last week" },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function DiagnosticsView({
  loadEvents = loadDiagnosticEvents,
  exportEvents = exportDiagnosticEvents,
  nowMs,
}: DiagnosticsViewProps) {
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [filters, setFilters] = useState(defaultDiagnosticFilters);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<DiagnosticExportResult | null>(null);
  const [queryNowMs] = useState(() => nowMs ?? Date.now());
  const effectiveNow = nowMs ?? queryNowMs;

  const options = useMemo(() => diagnosticFilterOptions(events), [events]);
  const query = useMemo(() => diagnosticQueryFromFilters(filters, effectiveNow), [
    effectiveNow,
    filters,
  ]);
  const visibleEvents = useMemo(() => selectDiagnosticEventViews(events), [events]);
  const exportScope = useMemo(() => diagnosticExportScopeSummary(query), [query]);

  async function refresh(nextQuery = query) {
    setLoading(true);
    setLoadError(null);
    try {
      setEvents(await loadEvents(nextQuery));
    } catch (error) {
      setLoadError(errorMessage(error));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    setExportResult(null);
    try {
      setExportResult(await exportEvents(query));
    } catch (error) {
      setExportError(errorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  function updateFilter<Key extends keyof DiagnosticViewFilters>(
    key: Key,
    value: DiagnosticViewFilters[Key],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setFilters(defaultDiagnosticFilters());
  }

  useEffect(() => {
    void refresh(query);
  }, [query]);

  return (
    <section className="workspace-section diagnostics-section">
      <header className="section-header">
        <div>
          <h2>Diagnostics</h2>
          <p className="section-subtitle">
            Local troubleshooting events only; transaction status still comes from history and
            chain reconcile, not chain confirmation facts.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => refresh()}
          type="button"
        >
          {loading ? "Loading" : "Refresh"}
        </button>
      </header>

      {loadError && (
        <div className="inline-error" role="alert">
          Unable to read diagnostics: {loadError}
        </div>
      )}

      <div className="diagnostics-controls" aria-label="Diagnostics filters">
        <label>
          Category
          <select
            onChange={(event) => updateFilter("category", event.target.value)}
            value={filters.category}
          >
            <option value={ALL_DIAGNOSTIC_FILTER}>All categories</option>
            {options.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label>
          Time
          <select
            onChange={(event) =>
              updateFilter("timeWindow", event.target.value as DiagnosticViewFilters["timeWindow"])
            }
            value={filters.timeWindow}
          >
            {TIME_WINDOWS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Chain
          <select
            onChange={(event) => updateFilter("chainId", event.target.value)}
            value={filters.chainId}
          >
            <option value={ALL_DIAGNOSTIC_FILTER}>All chainIds</option>
            {options.chainIds.map((chainId) => (
              <option key={chainId} value={chainId.toString()}>
                chainId {chainId}
              </option>
            ))}
          </select>
        </label>
        <label>
          Level
          <select
            onChange={(event) => updateFilter("level", event.target.value)}
            value={filters.level}
          >
            <option value={ALL_DIAGNOSTIC_FILTER}>All levels</option>
            {options.levels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label>
          Account
          <input
            onChange={(event) => updateFilter("account", event.target.value)}
            placeholder="index or address"
            value={filters.account}
          />
        </label>
        <label>
          Tx hash
          <input
            onChange={(event) => updateFilter("txHash", event.target.value)}
            placeholder="0x..."
            value={filters.txHash}
          />
        </label>
        <label>
          Status or stage
          <input
            onChange={(event) => updateFilter("status", event.target.value)}
            placeholder="pending, provider..."
            value={filters.status}
          />
        </label>
        <button className="secondary-button" onClick={clearFilters} type="button">
          Clear
        </button>
      </div>

      <section className="diagnostics-export" aria-label="Diagnostics export">
        <div>
          <h3>Export Scope</h3>
          <p>{exportScope}</p>
          <p>{diagnosticSensitiveExclusionText()}</p>
        </div>
        <button
          className="secondary-button"
          disabled={exporting}
          onClick={handleExport}
          type="button"
        >
          {exporting ? "Exporting" : "Export JSON"}
        </button>
      </section>
      {exportResult && (
        <div className="inline-success" role="status">
          Exported {exportResult.count} diagnostic event(s) to {exportResult.path}.
        </div>
      )}
      {exportError && (
        <div className="inline-error" role="alert">
          Unable to export diagnostics: {exportError}
        </div>
      )}

      <div className="data-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Level</th>
              <th>Category</th>
              <th>Chain</th>
              <th>Account</th>
              <th>Nonce</th>
              <th>Tx hash</th>
              <th>Stage</th>
              <th>Status</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {visibleEvents.length === 0 && (
              <tr>
                <td colSpan={10}>
                  {loading
                    ? "Loading diagnostics..."
                    : events.length === 0
                      ? "No diagnostic events recorded yet."
                      : "No diagnostic events match the current filters."}
                </td>
              </tr>
            )}
            {visibleEvents.map((item) => (
              <tr key={`${item.event.timestamp}-${item.event.event}-${item.event.txHash ?? ""}`}>
                <td>{item.timestampLabel}</td>
                <td>
                  <span className={`diagnostics-level diagnostics-level-${item.event.level}`}>
                    {item.levelLabel}
                  </span>
                </td>
                <td>{item.categoryLabel}</td>
                <td>{item.chainLabel}</td>
                <td>{item.accountLabel}</td>
                <td>{item.nonceLabel}</td>
                <td className="mono">{item.txHashLabel}</td>
                <td>{item.stageLabel}</td>
                <td>{item.statusLabel}</td>
                <td>{item.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
