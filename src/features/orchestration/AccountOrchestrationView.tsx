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

type AccountModel = AccountRecord & AccountChainState;

export interface AccountOrchestrationViewProps {
  accounts: AccountModel[];
  selectedChainId: bigint;
  chainName: string;
  tokenWatchlistState: TokenWatchlistState | null;
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

export function AccountOrchestrationView({
  accounts,
  selectedChainId,
  chainName,
  tokenWatchlistState,
}: AccountOrchestrationViewProps) {
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedLocalTargets, setSelectedLocalTargets] = useState<string[]>([]);
  const [externalAddress, setExternalAddress] = useState("");
  const [externalLabel, setExternalLabel] = useState("");
  const [externalNotes, setExternalNotes] = useState("");
  const [externalTargets, setExternalTargets] = useState<ExternalAddressReference[]>([]);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [frozenSummary, setFrozenSummary] = useState<FrozenOrchestrationSummary | null>(null);

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
    </section>
  );
}
