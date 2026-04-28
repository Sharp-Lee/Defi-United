import { useEffect, useMemo, useState } from "react";
import type { AccountRecord, TokenWatchlistState } from "../../lib/tauri";
import type { AccountChainState } from "../../lib/rpc";
import {
  buildAccountOrchestrationPreviews,
  buildOrchestrationDraft,
  computeFrozenKey,
  freezeOrchestrationDraft,
  normalizeExternalAddressTarget,
  type ExternalAddressReference,
  type FrozenOrchestrationSummary,
} from "../../core/accountOrchestration/selection";
import {
  buildNativeBatchPlan,
  freezeNativeBatchPlan,
  isFrozenNativeBatchPlanValid,
  type FrozenNativeBatchPlan,
  type NativeBatchKind,
  type NativeBatchPlan,
} from "../../core/batch/nativeBatch";
import {
  DISPERSE_TOKEN_METHOD,
  DISPERSE_TOKEN_SELECTOR,
  buildErc20BatchPlan,
  erc20BatchTargetAmountKey,
  freezeErc20BatchPlan,
  isFrozenErc20BatchPlanValid,
  type Erc20BatchKind,
  type Erc20BatchPlan,
  type FrozenErc20BatchPlan,
} from "../../core/batch/erc20Batch";
import type { Erc20BatchSubmitResult, HistoryRecord, NativeBatchSubmitResult } from "../../lib/tauri";
import { submitErc20Batch, submitNativeBatch } from "../../lib/tauri";

type AccountModel = AccountRecord & AccountChainState;

export interface AccountOrchestrationViewProps {
  accounts: AccountModel[];
  selectedChainId: bigint;
  chainName: string;
  history?: HistoryRecord[];
  tokenWatchlistState: TokenWatchlistState | null;
  rpcUrl?: string;
  historyStorageIssue?: string | null;
  onNativeBatchSubmitted?: (records: HistoryRecord[], result: NativeBatchSubmitResult) => void;
  onErc20BatchSubmitted?: (records: HistoryRecord[], result: Erc20BatchSubmitResult) => void;
  onNativeBatchSubmitFailed?: (error: unknown) => Promise<void> | void;
}

function formatNativeBalance(value: bigint | null) {
  return value === null ? "not scanned" : `${value.toString()} wei`;
}

function statusLabel(value: "present" | "missing") {
  return value === "present" ? "present" : "missing";
}

function syncLabel(account: AccountModel) {
  if (account.lastSyncError) return `Error: ${account.lastSyncError}`;
  if (!account.lastSyncedAt) return "Synced: never";
  const numeric = Number(account.lastSyncedAt);
  const date = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(account.lastSyncedAt);
  return Number.isNaN(date.getTime()) ? `Synced: ${account.lastSyncedAt}` : `Synced: ${date.toLocaleString()}`;
}

function toggleAddress(addresses: string[], address: string, enabled: boolean) {
  if (enabled) return addresses.includes(address) ? addresses : [...addresses, address];
  return addresses.filter((item) => item !== address);
}

function snapshotText(counts: FrozenOrchestrationSummary["previews"][number]["erc20SnapshotCounts"]) {
  return `${counts.ok} ok, ${counts.zero} zero, ${counts.stale} stale, ${counts.failure} failed, ${counts.missing} missing`;
}

function newBatchId() {
  return `native-batch-${Date.now().toString(36)}`;
}

function newErc20BatchId() {
  return `erc20-batch-${Date.now().toString(36)}`;
}

function shortAddress(address: string) {
  return address.length > 14 ? `${address.slice(0, 10)}...${address.slice(-6)}` : address;
}

function planBlockedReason(
  plan: NativeBatchPlan,
  frozenPlan: FrozenNativeBatchPlan | null,
  rpcUrl: string,
  historyStorageIssue: string | null,
) {
  if (historyStorageIssue) return historyStorageIssue;
  if (!rpcUrl.trim()) return "Validate an RPC before submitting a native batch.";
  if (!frozenPlan) return "Freeze the native batch plan before submitting.";
  if (!isFrozenNativeBatchPlanValid(frozenPlan, plan)) {
    return "Native batch inputs changed after freeze; rebuild the frozen plan.";
  }
  if (plan.status !== "ready") return "Resolve blocked native batch children before submitting.";
  if (plan.summary.plannedCount === 0) return "No native batch rows are ready to submit.";
  return null;
}

function erc20PlanBlockedReason(
  plan: Erc20BatchPlan,
  frozenPlan: FrozenErc20BatchPlan | null,
  rpcUrl: string,
  historyStorageIssue: string | null,
) {
  if (historyStorageIssue) return historyStorageIssue;
  if (!rpcUrl.trim()) return "Validate an RPC before submitting an ERC-20 batch.";
  if (!frozenPlan) return "Freeze the ERC-20 batch plan before submitting.";
  if (!isFrozenErc20BatchPlanValid(frozenPlan, plan)) {
    return "ERC-20 batch inputs changed after freeze; rebuild the frozen plan.";
  }
  if (plan.status !== "ready") return "Resolve blocked ERC-20 batch rows before submitting.";
  if (plan.summary.plannedCount === 0) return "No ERC-20 batch rows are ready to submit.";
  return null;
}

export function AccountOrchestrationView({
  accounts,
  selectedChainId,
  chainName,
  history = [],
  tokenWatchlistState,
  rpcUrl = "",
  historyStorageIssue = null,
  onNativeBatchSubmitted = () => {},
  onErc20BatchSubmitted = () => {},
  onNativeBatchSubmitFailed = async () => {},
}: AccountOrchestrationViewProps) {
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedLocalTargets, setSelectedLocalTargets] = useState<string[]>([]);
  const [externalAddress, setExternalAddress] = useState("");
  const [externalLabel, setExternalLabel] = useState("");
  const [externalNotes, setExternalNotes] = useState("");
  const [externalTargets, setExternalTargets] = useState<ExternalAddressReference[]>([]);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [frozenSummary, setFrozenSummary] = useState<FrozenOrchestrationSummary | null>(null);
  const [batchKind, setBatchKind] = useState<NativeBatchKind>("distribute");
  const [batchAmountWei, setBatchAmountWei] = useState("1000000000000000");
  const [batchGasLimit, setBatchGasLimit] = useState("21000");
  const [batchMaxFeePerGas, setBatchMaxFeePerGas] = useState("40000000000");
  const [batchMaxPriorityFeePerGas, setBatchMaxPriorityFeePerGas] = useState("1500000000");
  const [batchId] = useState(newBatchId);
  const [frozenBatchPlan, setFrozenBatchPlan] = useState<FrozenNativeBatchPlan | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchSubmitResult, setBatchSubmitResult] = useState<NativeBatchSubmitResult | null>(null);
  const [batchSubmitError, setBatchSubmitError] = useState<string | null>(null);
  const [erc20BatchKind, setErc20BatchKind] = useState<Erc20BatchKind>("distribute");
  const [erc20TokenContract, setErc20TokenContract] = useState("");
  const [erc20AmountRaw, setErc20AmountRaw] = useState("1000000");
  const [erc20AmountsRawByTarget, setErc20AmountsRawByTarget] = useState<Record<string, string>>({});
  const [erc20AllowanceRaw, setErc20AllowanceRaw] = useState("");
  const [erc20GasLimit, setErc20GasLimit] = useState("120000");
  const [erc20MaxFeePerGas, setErc20MaxFeePerGas] = useState("40000000000");
  const [erc20MaxPriorityFeePerGas, setErc20MaxPriorityFeePerGas] = useState("1500000000");
  const [erc20BatchId] = useState(newErc20BatchId);
  const [frozenErc20BatchPlan, setFrozenErc20BatchPlan] = useState<FrozenErc20BatchPlan | null>(null);
  const [erc20BatchSubmitting, setErc20BatchSubmitting] = useState(false);
  const [erc20BatchSubmitResult, setErc20BatchSubmitResult] = useState<Erc20BatchSubmitResult | null>(null);
  const [erc20BatchSubmitError, setErc20BatchSubmitError] = useState<string | null>(null);

  const allPreviews = useMemo(
    () => buildAccountOrchestrationPreviews(accounts, selectedChainId, tokenWatchlistState),
    [accounts, selectedChainId, tokenWatchlistState],
  );

  const draft = useMemo(
    () =>
      buildOrchestrationDraft({
        chainId: selectedChainId,
        accounts,
        tokenWatchlistState,
        selectedSourceAddresses: selectedSources,
        selectedLocalTargetAddresses: selectedLocalTargets,
        externalTargets,
      }),
    [accounts, selectedChainId, selectedSources, selectedLocalTargets, externalTargets, tokenWatchlistState],
  );

  const draftSignature = useMemo(() => computeFrozenKey(draft), [draft]);

  useEffect(() => {
    setFrozenSummary(null);
  }, [draftSignature]);

  const nativeBatchPlan = useMemo(
    () =>
      buildNativeBatchPlan({
        batchKind,
        chainId: selectedChainId,
        orchestration: draft,
        accountSnapshots: accounts.map((account) => ({
          address: account.address,
          nativeBalanceWei: account.nativeBalanceWei,
          nonce: account.nonce,
        })),
        localPendingHistory: history,
        amountWei: batchKind === "collect" ? "0" : batchAmountWei,
        fees: {
          gasLimit: batchGasLimit,
          maxFeePerGas: batchMaxFeePerGas,
          maxPriorityFeePerGas: batchMaxPriorityFeePerGas,
        },
        batchId,
      }),
    [
      accounts,
      batchAmountWei,
      batchGasLimit,
      batchId,
      batchKind,
      batchMaxFeePerGas,
      batchMaxPriorityFeePerGas,
      draft,
      history,
      selectedChainId,
    ],
  );
  const nativeBatchFreezeKey = nativeBatchPlan.freezeKey;

  const selectableTokens = useMemo(
    () =>
      (tokenWatchlistState?.resolvedTokenMetadata ?? []).filter(
        (token) =>
          token.chainId === Number(selectedChainId) &&
          (tokenWatchlistState?.watchlistTokens ?? []).some(
            (watch) =>
              watch.chainId === token.chainId &&
              watch.tokenContract.toLowerCase() === token.tokenContract.toLowerCase() &&
              !watch.hidden,
          ),
      ),
    [selectedChainId, tokenWatchlistState],
  );

  useEffect(() => {
    if (!erc20TokenContract && selectableTokens[0]) {
      setErc20TokenContract(selectableTokens[0].tokenContract);
    }
  }, [erc20TokenContract, selectableTokens]);

  const erc20BatchPlan = useMemo(
    () =>
      buildErc20BatchPlan({
        batchKind: erc20BatchKind,
        chainId: selectedChainId,
        orchestration: draft,
        accountSnapshots: accounts.map((account) => ({
          address: account.address,
          nativeBalanceWei: account.nativeBalanceWei,
          nonce: account.nonce,
        })),
        localPendingHistory: history,
        tokenWatchlistState,
        tokenContract: erc20TokenContract,
        distributionAmountsRaw: erc20AmountsRawByTarget,
        defaultDistributionAmountRaw: erc20BatchKind === "collect" ? "0" : erc20AmountRaw,
        allowance: erc20AllowanceRaw.trim()
          ? { status: "ok", allowanceRaw: erc20AllowanceRaw.trim() }
          : { status: "unknown", allowanceRaw: null },
        fees: {
          gasLimit: erc20GasLimit,
          maxFeePerGas: erc20MaxFeePerGas,
          maxPriorityFeePerGas: erc20MaxPriorityFeePerGas,
        },
        batchId: erc20BatchId,
      }),
    [
      accounts,
      draft,
      erc20AllowanceRaw,
      erc20AmountRaw,
      erc20AmountsRawByTarget,
      erc20BatchId,
      erc20BatchKind,
      erc20GasLimit,
      erc20MaxFeePerGas,
      erc20MaxPriorityFeePerGas,
      erc20TokenContract,
      history,
      selectedChainId,
      tokenWatchlistState,
    ],
  );
  const erc20BatchFreezeKey = erc20BatchPlan.freezeKey;

  useEffect(() => {
    setFrozenBatchPlan(null);
    setBatchSubmitResult(null);
    setBatchSubmitError(null);
  }, [nativeBatchFreezeKey]);

  useEffect(() => {
    setFrozenErc20BatchPlan(null);
    setErc20BatchSubmitResult(null);
    setErc20BatchSubmitError(null);
  }, [erc20BatchFreezeKey]);

  function addExternalTarget() {
    const result = normalizeExternalAddressTarget(
      { address: externalAddress, label: externalLabel, notes: externalNotes },
      externalTargets,
    );
    if (!result.ok || !result.target) {
      setExternalError(result.error ?? "Unable to add external address.");
      return;
    }
    setExternalTargets((current) => [...current, result.target!]);
    setExternalAddress("");
    setExternalLabel("");
    setExternalNotes("");
    setExternalError(null);
  }

  function removeExternalTarget(address: string) {
    setExternalTargets((current) => current.filter((target) => target.address !== address));
  }

  async function submitFrozenNativeBatch() {
    if (!frozenBatchPlan) return;
    setBatchSubmitting(true);
    setBatchSubmitError(null);
    try {
      const result = await submitNativeBatch(frozenBatchPlan, rpcUrl.trim());
      setBatchSubmitResult(result);
      const records = [result.parent?.record, ...result.children.map((child) => child.record)]
        .filter((record): record is HistoryRecord => Boolean(record));
      onNativeBatchSubmitted(records, result);
      setFrozenBatchPlan(null);
    } catch (err) {
      setBatchSubmitError(err instanceof Error ? err.message : String(err));
      await onNativeBatchSubmitFailed(err);
    } finally {
      setBatchSubmitting(false);
    }
  }

  async function submitFrozenErc20Batch() {
    if (!frozenErc20BatchPlan) return;
    setErc20BatchSubmitting(true);
    setErc20BatchSubmitError(null);
    try {
      const result = await submitErc20Batch(frozenErc20BatchPlan, rpcUrl.trim());
      setErc20BatchSubmitResult(result);
      const records = [result.parent?.record, ...result.children.map((child) => child.record)]
        .filter((record): record is HistoryRecord => Boolean(record));
      onErc20BatchSubmitted(records, result);
      setFrozenErc20BatchPlan(null);
    } catch (err) {
      setErc20BatchSubmitError(err instanceof Error ? err.message : String(err));
      await onNativeBatchSubmitFailed(err);
    } finally {
      setErc20BatchSubmitting(false);
    }
  }

  function updateErc20TargetAmount(childTargetKey: string, value: string) {
    setErc20AmountsRawByTarget((current) => ({
      ...current,
      [childTargetKey]: value,
    }));
  }

  const submitBlockedReason = planBlockedReason(
    nativeBatchPlan,
    frozenBatchPlan,
    rpcUrl,
    historyStorageIssue,
  );
  const erc20SubmitBlockedReason = erc20PlanBlockedReason(
    erc20BatchPlan,
    frozenErc20BatchPlan,
    rpcUrl,
    historyStorageIssue,
  );

  return (
    <section className="workspace-section orchestration-grid">
      <header className="section-header">
        <div>
          <h2>Orchestration</h2>
          <p className="section-subtitle">
            Selection and freeze preview only. This view will not sign, broadcast, or write transaction history.
          </p>
        </div>
        <span className="pill">
          {chainName} chainId {selectedChainId.toString()}
        </span>
      </header>

      <section aria-label="Local source accounts" className="orchestration-panel">
        <div className="token-panel-header">
          <h3>Source Accounts</h3>
          <span className="history-status">{selectedSources.length} selected</span>
        </div>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Use</th>
                <th>Label</th>
                <th>Address</th>
                <th>Native Balance</th>
                <th>Nonce</th>
                <th>Sync</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={6}>No local accounts available.</td>
                </tr>
              )}
              {accounts.map((account) => (
                <tr key={account.address}>
                  <td>
                    <input
                      aria-label={`Source ${account.label}`}
                      checked={selectedSources.includes(account.address)}
                      onChange={(event) =>
                        setSelectedSources((current) =>
                          toggleAddress(current, account.address, event.target.checked),
                        )
                      }
                      type="checkbox"
                    />
                  </td>
                  <td>{account.label}</td>
                  <td className="mono">{account.address}</td>
                  <td className="mono">{formatNativeBalance(account.nativeBalanceWei)}</td>
                  <td className="mono">{account.nonce === null ? "not scanned" : account.nonce}</td>
                  <td>{syncLabel(account)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Local target accounts" className="orchestration-panel">
        <div className="token-panel-header">
          <h3>Local Targets</h3>
          <span className="history-status">{selectedLocalTargets.length} selected</span>
        </div>
        <div className="orchestration-choice-grid">
          {accounts.length === 0 && <p className="section-subtitle">No local target accounts available.</p>}
          {accounts.map((account) => (
            <label className="orchestration-checkbox" key={account.address}>
              <input
                aria-label={`Local target ${account.label}`}
                checked={selectedLocalTargets.includes(account.address)}
                onChange={(event) =>
                  setSelectedLocalTargets((current) =>
                    toggleAddress(current, account.address, event.target.checked),
                  )
                }
                type="checkbox"
              />
              <span>
                <strong>{account.label}</strong>
                <span className="mono">{account.address}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section aria-label="External target addresses" className="orchestration-panel">
        <div className="token-panel-header">
          <h3>External Targets</h3>
          <span className="history-status">{externalTargets.length} selected</span>
        </div>
        {externalError && (
          <div className="inline-warning" role="alert">
            {externalError}
          </div>
        )}
        <div className="orchestration-external-form">
          <label>
            External address
            <input
              onChange={(event) => setExternalAddress(event.target.value)}
              value={externalAddress}
            />
          </label>
          <label>
            Label
            <input onChange={(event) => setExternalLabel(event.target.value)} value={externalLabel} />
          </label>
          <label>
            Notes
            <input onChange={(event) => setExternalNotes(event.target.value)} value={externalNotes} />
          </label>
          <button onClick={addExternalTarget} type="button">
            Add External
          </button>
        </div>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Label</th>
                <th>Address</th>
                <th>Notes</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {externalTargets.length === 0 && (
                <tr>
                  <td colSpan={5}>No external targets added.</td>
                </tr>
              )}
              {externalTargets.map((target) => (
                <tr key={target.address}>
                  <td>externalAddress</td>
                  <td>{target.label || "Unlabeled"}</td>
                  <td className="mono">{target.address}</td>
                  <td>{target.notes || "None"}</td>
                  <td>
                    <button
                      className="secondary-button"
                      onClick={() => removeExternalTarget(target.address)}
                      type="button"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Account set preview" className="orchestration-panel">
        <div className="token-panel-header">
          <h3>Collection Preview</h3>
          <button
            disabled={draft.sourceAccounts.length === 0}
            onClick={() => setFrozenSummary(freezeOrchestrationDraft(draft))}
            type="button"
          >
            Freeze Summary
          </button>
        </div>
        <div className="orchestration-summary-strip">
          <span>Sources: {draft.sourceAccounts.length}</span>
          <span>Local targets: {draft.localTargets.length}</span>
          <span>External targets: {draft.externalTargets.length}</span>
        </div>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Native</th>
                <th>Nonce</th>
                <th>ERC-20 Snapshots</th>
                <th>Sync Error</th>
              </tr>
            </thead>
            <tbody>
              {draft.previews.length === 0 && (
                <tr>
                  <td colSpan={5}>No source accounts selected.</td>
                </tr>
              )}
              {draft.previews.map((preview) => (
                <tr key={preview.account.address}>
                  <td>
                    <strong>{preview.account.label}</strong>
                    <div className="mono">{preview.account.address}</div>
                  </td>
                  <td>{statusLabel(preview.nativeBalance)}</td>
                  <td>{statusLabel(preview.nonce)}</td>
                  <td>{snapshotText(preview.erc20SnapshotCounts)}</td>
                  <td>{preview.lastSyncError ?? "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {allPreviews.length > 0 && (
          <p className="section-subtitle">
            ERC-20 missing snapshots are shown as missing, not as zero balances.
          </p>
        )}
      </section>

      {frozenSummary && (
        <section aria-label="Frozen orchestration summary" className="orchestration-frozen">
          <div className="token-panel-header">
            <h3>Frozen Summary</h3>
            <span className="history-status history-status-confirmed">Read-only</span>
          </div>
          <dl className="orchestration-definition-grid">
            <dt>Frozen key</dt>
            <dd className="mono">{frozenSummary.frozenKey}</dd>
            <dt>Created</dt>
            <dd>{frozenSummary.createdAt}</dd>
            <dt>Frozen</dt>
            <dd>{frozenSummary.frozenAt}</dd>
            <dt>Chain</dt>
            <dd>chainId {frozenSummary.chainId}</dd>
            <dt>Sources</dt>
            <dd>{frozenSummary.sourceAccounts.map((account) => account.address).join(", ")}</dd>
            <dt>Local targets</dt>
            <dd>
              {frozenSummary.localTargets.map((account) => account.address).join(", ") || "None"}
            </dd>
            <dt>External targets</dt>
            <dd>
              {frozenSummary.externalTargets.map((target) => target.address).join(", ") || "None"}
            </dd>
          </dl>
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Native</th>
                  <th>Nonce</th>
                  <th>ERC-20 Snapshots</th>
                </tr>
              </thead>
              <tbody>
                {frozenSummary.previews.map((preview) => (
                  <tr key={preview.account.address}>
                    <td className="mono">{preview.account.address}</td>
                    <td>{statusLabel(preview.nativeBalance)}</td>
                    <td>{statusLabel(preview.nonce)}</td>
                    <td>{snapshotText(preview.erc20SnapshotCounts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-label="Native batch plan" className="orchestration-panel">
        <div className="token-panel-header">
          <h3>Native Batch</h3>
          <span className={`history-status history-status-${nativeBatchPlan.status === "ready" ? "confirmed" : "failed"}`}>
            {nativeBatchPlan.status}
          </span>
        </div>
        <div className="orchestration-external-form">
          <label>
            Batch kind
            <select
              onChange={(event) => setBatchKind(event.target.value as NativeBatchKind)}
              value={batchKind}
            >
              <option value="distribute">Distribute</option>
              <option value="collect">Collect</option>
            </select>
          </label>
          <label>
            Amount per target wei
            <input
              disabled={batchKind === "collect"}
              onChange={(event) => setBatchAmountWei(event.target.value)}
              value={batchKind === "collect" ? "auto: balance - gas reserve" : batchAmountWei}
            />
          </label>
          <label>
            Gas limit
            <input onChange={(event) => setBatchGasLimit(event.target.value)} value={batchGasLimit} />
          </label>
          <label>
            Max fee wei
            <input
              onChange={(event) => setBatchMaxFeePerGas(event.target.value)}
              value={batchMaxFeePerGas}
            />
          </label>
          <label>
            Priority fee wei
            <input
              onChange={(event) => setBatchMaxPriorityFeePerGas(event.target.value)}
              value={batchMaxPriorityFeePerGas}
            />
          </label>
        </div>
        <div className="orchestration-summary-strip">
          <span>Children: {nativeBatchPlan.summary.childCount}</span>
          <span>Ready: {nativeBatchPlan.summary.plannedCount}</span>
          <span>Skipped: {nativeBatchPlan.summary.skippedCount}</span>
          <span>Blocked: {nativeBatchPlan.summary.blockedCount}</span>
          <span>Total amount: {nativeBatchPlan.summary.totalPlannedAmountWei} wei</span>
          <span>Max gas: {nativeBatchPlan.summary.maxGasCostWei} wei</span>
        </div>
        {nativeBatchPlan.distributionParent && (
          <dl className="orchestration-definition-grid" aria-label="Native distribution contract call">
            <dt>Distribution contract</dt>
            <dd className="mono">{nativeBatchPlan.distributionParent.distributionContract}</dd>
            <dt>Selector</dt>
            <dd className="mono">{nativeBatchPlan.distributionParent.selector}</dd>
            <dt>Method</dt>
            <dd className="mono">{nativeBatchPlan.distributionParent.methodName}</dd>
            <dt>Recipients</dt>
            <dd>{nativeBatchPlan.distributionParent.recipients.length}</dd>
            <dt>Total value</dt>
            <dd className="mono">{nativeBatchPlan.distributionParent.totalValueWei} wei</dd>
            <dt>Parent nonce</dt>
            <dd className="mono">{nativeBatchPlan.distributionParent.nonce ?? "missing"}</dd>
            <dt>Parent gas / fee</dt>
            <dd className="mono">
              {nativeBatchPlan.distributionParent.gasLimit} / {nativeBatchPlan.distributionParent.maxFeePerGas}
            </dd>
          </dl>
        )}
        {batchKind === "distribute" && draft.sourceAccounts.length > 1 && (
          <div className="inline-warning" role="alert">
            Native contract distribution is disabled for multiple sources in this release. Split into one batch per payer.
          </div>
        )}
        {[...nativeBatchPlan.errors, ...nativeBatchPlan.warnings].map((message) => (
          <div className="inline-warning" key={message}>
            {message}
          </div>
        ))}
        {batchSubmitError && (
          <div className="inline-error" role="alert">
            {batchSubmitError}
          </div>
        )}
        <div className="button-row">
          <button
            disabled={nativeBatchPlan.summary.childCount === 0 || nativeBatchPlan.status === "empty"}
            onClick={() => setFrozenBatchPlan(freezeNativeBatchPlan(nativeBatchPlan))}
            type="button"
          >
            Freeze Native Plan
          </button>
          <button
            disabled={batchSubmitting || Boolean(submitBlockedReason)}
            onClick={() => void submitFrozenNativeBatch()}
            title={submitBlockedReason ?? undefined}
            type="button"
          >
            {batchSubmitting ? "Submitting..." : "Submit Native Batch"}
          </button>
        </div>
        {submitBlockedReason && <p className="section-subtitle">{submitBlockedReason}</p>}
        {frozenBatchPlan && (
          <dl className="orchestration-definition-grid">
            <dt>Batch id</dt>
            <dd className="mono">{frozenBatchPlan.batchId}</dd>
            <dt>Freeze key</dt>
            <dd className="mono">{frozenBatchPlan.freezeKey}</dd>
            <dt>Frozen</dt>
            <dd>{frozenBatchPlan.frozenAt}</dd>
          </dl>
        )}
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Child</th>
                <th>Source</th>
                <th>Target</th>
                <th>Amount</th>
                <th>{batchKind === "distribute" ? "Parent tx" : "Nonce"}</th>
                <th>Gas / Fee</th>
                <th>Warnings / Errors</th>
              </tr>
            </thead>
            <tbody>
              {nativeBatchPlan.children.length === 0 && (
                <tr>
                  <td colSpan={8}>No native batch children to preview.</td>
                </tr>
              )}
              {nativeBatchPlan.children.map((child) => (
                <tr key={child.childId}>
                  <td>{child.status}</td>
                  <td className="mono">{child.childId}</td>
                  <td>
                    <strong>{child.source.label}</strong>
                    <div className="mono">{shortAddress(child.source.address)}</div>
                  </td>
                  <td>
                    <strong>{child.target.kind}</strong>
                    <div className="mono">{shortAddress(child.targetAddress)}</div>
                  </td>
                  <td className="mono">{child.amountWei} wei</td>
                  <td className="mono">
                    {batchKind === "distribute"
                      ? `recipient row; parent nonce ${nativeBatchPlan.distributionParent?.nonce ?? "missing"}`
                      : (child.nonce ?? "missing")}
                  </td>
                  <td className="mono">
                    {child.gasLimit} / {child.maxFeePerGas}
                  </td>
                  <td>
                    {[...child.warnings, ...child.errors].join("; ") || "None"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {batchSubmitResult && (
          <div className="data-table-wrap">
            {batchSubmitResult.parent && (
              <dl className="orchestration-definition-grid" aria-label="Native distribution submit parent">
                <dt>Parent tx hash</dt>
                <dd className="mono">{batchSubmitResult.parent.record?.submission.tx_hash ?? "None"}</dd>
                <dt>Parent error</dt>
                <dd>{batchSubmitResult.parent.error ?? "None"}</dd>
                <dt>Recovery hint</dt>
                <dd>{batchSubmitResult.parent.recoveryHint ?? "None"}</dd>
              </dl>
            )}
            <table>
              <thead>
                <tr>
                  <th>{batchSubmitResult.parent ? "Recipient row" : "Child"}</th>
                  <th>{batchSubmitResult.parent ? "Parent tx hash" : "Tx hash"}</th>
                  {batchSubmitResult.parent && <th>Target</th>}
                  {batchSubmitResult.parent && <th>Amount</th>}
                  <th>Error</th>
                  <th>Recovery hint</th>
                </tr>
              </thead>
              <tbody>
                {batchSubmitResult.children.map((child) => (
                  <tr key={child.childId}>
                    <td className="mono">{child.childId}</td>
                    <td className="mono">
                      {child.record?.submission.tx_hash ?? batchSubmitResult.parent?.record?.submission.tx_hash ?? "None"}
                    </td>
                    {batchSubmitResult.parent && <td className="mono">{child.targetAddress ?? "unknown"}</td>}
                    {batchSubmitResult.parent && <td className="mono">{child.amountWei ?? "unknown"} wei</td>}
                    <td>{child.error ?? "None"}</td>
                    <td>{child.recoveryHint ?? "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="ERC-20 batch plan" className="orchestration-panel">
        <div className="token-panel-header">
          <h3>ERC-20 Batch</h3>
          <span className={`history-status history-status-${erc20BatchPlan.status === "ready" ? "confirmed" : "failed"}`}>
            {erc20BatchPlan.status}
          </span>
        </div>
        <div className="orchestration-external-form">
          <label>
            Token
            <select
              onChange={(event) => setErc20TokenContract(event.target.value)}
              value={erc20TokenContract}
            >
              <option value="">Choose watchlist token</option>
              {selectableTokens.map((token) => (
                <option key={`${token.chainId}:${token.tokenContract}`} value={token.tokenContract}>
                  {token.symbol ?? token.name ?? shortAddress(token.tokenContract)} · {shortAddress(token.tokenContract)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Batch kind
            <select
              onChange={(event) => setErc20BatchKind(event.target.value as Erc20BatchKind)}
              value={erc20BatchKind}
            >
              <option value="distribute">Distribute</option>
              <option value="collect">Collect</option>
            </select>
          </label>
          <label>
            Default raw per target
            <input
              disabled={erc20BatchKind === "collect"}
              onChange={(event) => setErc20AmountRaw(event.target.value)}
              value={erc20BatchKind === "collect" ? "auto: token snapshot balance" : erc20AmountRaw}
            />
          </label>
          <label>
            Allowance raw
            <input
              disabled={erc20BatchKind === "collect"}
              onChange={(event) => setErc20AllowanceRaw(event.target.value)}
              placeholder="distribution preflight"
              value={erc20BatchKind === "collect" ? "" : erc20AllowanceRaw}
            />
          </label>
          <label>
            Gas limit
            <input onChange={(event) => setErc20GasLimit(event.target.value)} value={erc20GasLimit} />
          </label>
          <label>
            Max fee wei
            <input
              onChange={(event) => setErc20MaxFeePerGas(event.target.value)}
              value={erc20MaxFeePerGas}
            />
          </label>
          <label>
            Priority fee wei
            <input
              onChange={(event) => setErc20MaxPriorityFeePerGas(event.target.value)}
              value={erc20MaxPriorityFeePerGas}
            />
          </label>
        </div>
        <div className="orchestration-summary-strip">
          <span>Children: {erc20BatchPlan.summary.childCount}</span>
          <span>Ready: {erc20BatchPlan.summary.plannedCount}</span>
          <span>Skipped: {erc20BatchPlan.summary.skippedCount}</span>
          <span>Blocked: {erc20BatchPlan.summary.blockedCount}</span>
          <span>Total raw: {erc20BatchPlan.summary.totalPlannedAmountRaw}</span>
          <span>Max gas: {erc20BatchPlan.summary.maxGasCostWei} wei</span>
        </div>
        {erc20BatchPlan.token && (
          <dl className="orchestration-definition-grid" aria-label="ERC-20 token metadata">
            <dt>Token contract</dt>
            <dd className="mono">{erc20BatchPlan.token.tokenContract}</dd>
            <dt>Decimals</dt>
            <dd>{erc20BatchPlan.token.decimals ?? "missing"}</dd>
            <dt>Symbol</dt>
            <dd>{erc20BatchPlan.token.symbol ?? "unknown"}</dd>
            <dt>Metadata</dt>
            <dd>{erc20BatchPlan.token.source ?? "missing"} / {erc20BatchPlan.token.status}</dd>
          </dl>
        )}
        {erc20BatchPlan.distributionParent && (
          <dl className="orchestration-definition-grid" aria-label="ERC-20 distribution contract call">
            <dt>Parent tx to</dt>
            <dd className="mono">{erc20BatchPlan.distributionParent.distributionContract}</dd>
            <dt>Selector</dt>
            <dd className="mono">{erc20BatchPlan.distributionParent.selector || DISPERSE_TOKEN_SELECTOR}</dd>
            <dt>Method</dt>
            <dd className="mono">{erc20BatchPlan.distributionParent.methodName || DISPERSE_TOKEN_METHOD}</dd>
            <dt>Token param</dt>
            <dd className="mono">{erc20BatchPlan.distributionParent.tokenContract}</dd>
            <dt>Recipients</dt>
            <dd>{erc20BatchPlan.distributionParent.recipients.length}</dd>
            <dt>Total raw</dt>
            <dd className="mono">{erc20BatchPlan.distributionParent.totalAmountRaw}</dd>
            <dt>Parent nonce</dt>
            <dd className="mono">{erc20BatchPlan.distributionParent.nonce ?? "missing"}</dd>
          </dl>
        )}
        {erc20BatchKind === "distribute" && draft.sourceAccounts.length > 1 && (
          <div className="inline-warning" role="alert">
            ERC-20 contract distribution is disabled for multiple sources in this release.
          </div>
        )}
        {[...erc20BatchPlan.errors, ...erc20BatchPlan.warnings, ...(erc20BatchPlan.distributionParent?.warnings ?? [])].map((message) => (
          <div className="inline-warning" key={message}>
            {message}
          </div>
        ))}
        {erc20BatchSubmitError && (
          <div className="inline-error" role="alert">
            {erc20BatchSubmitError}
          </div>
        )}
        <div className="button-row">
          <button
            disabled={erc20BatchPlan.summary.childCount === 0 || erc20BatchPlan.status === "empty"}
            onClick={() => setFrozenErc20BatchPlan(freezeErc20BatchPlan(erc20BatchPlan))}
            type="button"
          >
            Freeze ERC-20 Plan
          </button>
          <button
            disabled={erc20BatchSubmitting || Boolean(erc20SubmitBlockedReason)}
            onClick={() => void submitFrozenErc20Batch()}
            title={erc20SubmitBlockedReason ?? undefined}
            type="button"
          >
            {erc20BatchSubmitting ? "Submitting..." : "Submit ERC-20 Batch"}
          </button>
        </div>
        {erc20SubmitBlockedReason && <p className="section-subtitle">{erc20SubmitBlockedReason}</p>}
        {frozenErc20BatchPlan && (
          <dl className="orchestration-definition-grid">
            <dt>Batch id</dt>
            <dd className="mono">{frozenErc20BatchPlan.batchId}</dd>
            <dt>Freeze key</dt>
            <dd className="mono">{frozenErc20BatchPlan.freezeKey}</dd>
            <dt>Frozen</dt>
            <dd>{frozenErc20BatchPlan.frozenAt}</dd>
          </dl>
        )}
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Child</th>
                <th>Source</th>
                <th>Target / recipient</th>
                <th>Amount raw</th>
                <th>{erc20BatchKind === "distribute" ? "Parent tx" : "Child tx"}</th>
                <th>Snapshot</th>
                <th>Warnings / Errors</th>
              </tr>
            </thead>
            <tbody>
              {erc20BatchPlan.children.length === 0 && (
                <tr>
                  <td colSpan={8}>No ERC-20 batch children to preview.</td>
                </tr>
              )}
              {erc20BatchPlan.children.map((child) => (
                <tr key={child.childId}>
                  <td>{child.status}</td>
                  <td className="mono">{child.childId}</td>
                  <td>
                    <strong>{child.source.label}</strong>
                    <div className="mono">{shortAddress(child.source.address)}</div>
                  </td>
                  <td>
                    <strong>{child.target.kind}</strong>
                    <div className="mono">{shortAddress(child.targetAddress)}</div>
                  </td>
                  <td className="mono">
                    {erc20BatchKind === "distribute" ? (
                      <input
                        aria-label={`Amount raw ${child.childId}`}
                        onChange={(event) =>
                          updateErc20TargetAmount(
                            erc20BatchTargetAmountKey(child.target),
                            event.target.value,
                          )
                        }
                        value={
                          erc20AmountsRawByTarget[erc20BatchTargetAmountKey(child.target)] ??
                          child.amountRaw
                        }
                      />
                    ) : (
                      child.amountRaw
                    )}
                  </td>
                  <td className="mono">
                    {erc20BatchKind === "distribute"
                      ? `allocation row; parent tx to Disperse; parent nonce ${erc20BatchPlan.distributionParent?.nonce ?? "missing"}`
                      : `tx to token contract ${shortAddress(child.tokenContract)}; recipient calldata param; nonce ${child.nonce ?? "missing"}`}
                  </td>
                  <td>
                    {child.sourceTokenSnapshot.balanceStatus}
                    {child.sourceTokenSnapshot.balanceRaw !== null ? ` · ${child.sourceTokenSnapshot.balanceRaw}` : ""}
                  </td>
                  <td>
                    {[...child.warnings, ...child.errors].join("; ") || "None"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {erc20BatchSubmitResult && (
          <div className="data-table-wrap">
            {erc20BatchSubmitResult.parent && (
              <dl className="orchestration-definition-grid" aria-label="ERC-20 distribution submit parent">
                <dt>Parent tx hash</dt>
                <dd className="mono">{erc20BatchSubmitResult.parent.record?.submission.tx_hash ?? "None"}</dd>
                <dt>Parent error</dt>
                <dd>{erc20BatchSubmitResult.parent.error ?? "None"}</dd>
                <dt>Recovery hint</dt>
                <dd>{erc20BatchSubmitResult.parent.recoveryHint ?? "None"}</dd>
              </dl>
            )}
            <table>
              <thead>
                <tr>
                  <th>{erc20BatchSubmitResult.parent ? "Allocation row" : "Child"}</th>
                  <th>{erc20BatchSubmitResult.parent ? "Parent tx hash" : "Tx hash"}</th>
                  {erc20BatchSubmitResult.parent && <th>Target</th>}
                  <th>Amount raw</th>
                  <th>Error</th>
                  <th>Recovery hint</th>
                </tr>
              </thead>
              <tbody>
                {erc20BatchSubmitResult.children.map((child) => (
                  <tr key={child.childId}>
                    <td className="mono">{child.childId}</td>
                    <td className="mono">
                      {child.record?.submission.tx_hash ?? erc20BatchSubmitResult.parent?.record?.submission.tx_hash ?? "None"}
                    </td>
                    {erc20BatchSubmitResult.parent && <td className="mono">{child.targetAddress ?? "unknown"}</td>}
                    <td className="mono">{child.amountRaw ?? "unknown"}</td>
                    <td>{child.error ?? "None"}</td>
                    <td>{child.recoveryHint ?? "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
