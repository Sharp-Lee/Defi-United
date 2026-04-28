import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "ethers";
import type {
  AccountRecord,
  AddWatchlistTokenInput,
  BalanceStatus,
  EditWatchlistTokenInput,
  Erc20BalanceSnapshotRecord,
  ResolvedMetadataStatus,
  ResolvedTokenMetadataRecord,
  TokenMetadataCacheRecord,
  TokenScanStateRecord,
  TokenScanStatus,
  TokenWatchlistState,
  WatchlistTokenRecord,
} from "../../lib/tauri";
import type { AccountChainState } from "../../lib/rpc";
import {
  metadataBlocksHumanAmount,
  metadataConflictDetail,
  tokenIdentityKey,
} from "./metadataConflicts";

type AccountModel = AccountRecord & AccountChainState;

export interface TokensViewProps {
  accounts: AccountModel[];
  busy?: boolean;
  error?: string | null;
  rpcReady?: boolean;
  selectedChainId: bigint;
  state: TokenWatchlistState | null;
  onAddToken: (
    input: AddWatchlistTokenInput,
    rpcProfileId?: string | null,
  ) => Promise<boolean | void> | boolean | void;
  onEditToken: (input: EditWatchlistTokenInput) => Promise<boolean | void> | boolean | void;
  onRemoveToken: (
    chainId: number,
    tokenContract: string,
  ) => Promise<boolean | void> | boolean | void;
  onScanBalance: (
    account: string,
    chainId: number,
    tokenContract: string,
  ) => Promise<boolean | void> | boolean | void;
  onScanMetadata: (
    chainId: number,
    tokenContract: string,
  ) => Promise<boolean | void> | boolean | void;
  onScanSelectedAccount: (
    account: string,
    retryFailedOnly?: boolean,
  ) => Promise<boolean | void> | boolean | void;
}

const metadataStatusLabels: Record<ResolvedMetadataStatus, string> = {
  ok: "OK",
  missingDecimals: "Missing decimals",
  malformed: "Malformed metadata",
  callFailed: "Metadata call failed",
  nonErc20: "Not ERC-20",
  decimalsChanged: "Decimals changed",
  sourceConflict: "Source conflict",
};

const scanStatusLabels: Record<TokenScanStatus, string> = {
  idle: "Idle",
  scanning: "Scanning",
  ok: "OK",
  partial: "Partial",
  failed: "Scan failed",
  chainMismatch: "Chain mismatch",
  nonErc20: "Not ERC-20",
  malformed: "Malformed",
};

const balanceStatusLabels: Record<BalanceStatus, string> = {
  ok: "OK",
  zero: "Zero",
  balanceCallFailed: "Balance call failed",
  malformedBalance: "Malformed balance",
  rpcFailed: "RPC failed",
  chainMismatch: "Chain mismatch",
  stale: "Stale",
};

function balanceKey(account: string, chainId: number, tokenContract: string) {
  return `${account.toLowerCase()}:${tokenIdentityKey(chainId, tokenContract)}`;
}

function tokenDisplayName(token: WatchlistTokenRecord, metadata: ResolvedTokenMetadataRecord | null) {
  return token.label ?? metadata?.symbol ?? metadata?.name ?? "Unlabeled token";
}

function compactAddress(address: string) {
  return address.length > 14 ? `${address.slice(0, 10)}...${address.slice(-6)}` : address;
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Never";
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric * 1000).toLocaleString();
  }
  return value;
}

function statusClass(status: string | null | undefined) {
  if (!status) return "history-status";
  if (["ok", "zero"].includes(status)) return "history-status history-status-confirmed";
  if (["scanning", "partial", "stale"].includes(status)) {
    return "history-status history-status-pending";
  }
  return "history-status history-status-failed";
}

function canShowHumanAmount(snapshot: Erc20BalanceSnapshotRecord, metadata: ResolvedTokenMetadataRecord | null) {
  const decimals = metadata?.decimals ?? snapshot.resolvedMetadata?.decimals ?? null;
  const currentStatus = metadata?.status ?? snapshot.resolvedMetadata?.status ?? null;
  return decimals !== null && decimals !== undefined && !metadataBlocksHumanAmount(currentStatus);
}

function humanAmount(snapshot: Erc20BalanceSnapshotRecord, metadata: ResolvedTokenMetadataRecord | null) {
  if (!canShowHumanAmount(snapshot, metadata)) return "Unavailable";
  const decimals = metadata?.decimals ?? snapshot.resolvedMetadata?.decimals ?? 0;
  try {
    return formatUnits(BigInt(snapshot.balanceRaw), decimals);
  } catch {
    return "Unavailable";
  }
}

function defaultChainId(selectedChainId: bigint) {
  return selectedChainId.toString();
}

export function TokensView({
  accounts,
  busy = false,
  error = null,
  rpcReady = false,
  selectedChainId,
  state,
  onAddToken,
  onEditToken,
  onRemoveToken,
  onScanBalance,
  onScanMetadata,
  onScanSelectedAccount,
}: TokensViewProps) {
  const [addChainId, setAddChainId] = useState(defaultChainId(selectedChainId));
  const [addTokenContract, setAddTokenContract] = useState("");
  const [addRpcProfileId, setAddRpcProfileId] = useState(`chain-${selectedChainId.toString()}`);
  const [addLabel, setAddLabel] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSymbol, setEditSymbol] = useState("");
  const [editName, setEditName] = useState("");
  const [editDecimals, setEditDecimals] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setAddChainId(defaultChainId(selectedChainId));
    setAddRpcProfileId(`chain-${selectedChainId.toString()}`);
  }, [selectedChainId]);

  useEffect(() => {
    if (!selectedAccount && accounts.length > 0) {
      setSelectedAccount(accounts[0].address);
    }
  }, [accounts, selectedAccount]);

  const metadataByToken = useMemo(() => {
    const map = new Map<string, ResolvedTokenMetadataRecord>();
    for (const item of state?.resolvedTokenMetadata ?? []) {
      map.set(tokenIdentityKey(item.chainId, item.tokenContract), item);
    }
    return map;
  }, [state]);

  const metadataCacheByToken = useMemo(() => {
    const map = new Map<string, TokenMetadataCacheRecord>();
    for (const item of state?.tokenMetadataCache ?? []) {
      map.set(tokenIdentityKey(item.chainId, item.tokenContract), item);
    }
    return map;
  }, [state]);

  const scanByToken = useMemo(() => {
    const map = new Map<string, TokenScanStateRecord>();
    for (const item of state?.tokenScanState ?? []) {
      map.set(tokenIdentityKey(item.chainId, item.tokenContract), item);
    }
    return map;
  }, [state]);

  const balancesByIdentity = useMemo(() => {
    const map = new Map<string, Erc20BalanceSnapshotRecord>();
    for (const item of state?.erc20BalanceSnapshots ?? []) {
      map.set(balanceKey(item.account, item.chainId, item.tokenContract), item);
    }
    return map;
  }, [state]);

  const tokens = state?.watchlistTokens ?? [];
  const selectedAccountRecord =
    accounts.find((account) => account.address === selectedAccount) ?? accounts[0] ?? null;
  const selectedAccountAddress = selectedAccountRecord?.address ?? selectedAccount;
  const visibleBalanceTokens = tokens.filter(
    (token) => token.chainId === Number(selectedChainId) && !token.hidden,
  );

  function beginEdit(token: WatchlistTokenRecord) {
    setEditingKey(tokenIdentityKey(token.chainId, token.tokenContract));
    setEditLabel(token.label ?? "");
    setEditNotes(token.userNotes ?? "");
    setEditSymbol(token.metadataOverride?.symbol ?? "");
    setEditName(token.metadataOverride?.name ?? "");
    setEditDecimals(token.metadataOverride?.decimals?.toString() ?? "");
  }

  function clearEdit() {
    setEditingKey(null);
    setEditLabel("");
    setEditNotes("");
    setEditSymbol("");
    setEditName("");
    setEditDecimals("");
  }

  async function submitAdd() {
    setFormError(null);
    const chainId = Number(addChainId);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      setFormError("chainId must be a positive integer.");
      return;
    }
    const succeeded = await onAddToken(
      {
        chainId,
        tokenContract: addTokenContract,
        label: addLabel.trim() || null,
        userNotes: addNotes.trim() || null,
        pinned: false,
        hidden: false,
      },
      addRpcProfileId.trim() || null,
    );
    if (succeeded === false) return;
    setAddTokenContract("");
    setAddLabel("");
    setAddNotes("");
  }

  async function submitEdit(token: WatchlistTokenRecord) {
    setFormError(null);
    const decimals = editDecimals.trim() ? Number(editDecimals) : null;
    if (decimals !== null && (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)) {
      setFormError("Decimals override must be an integer from 0 to 255.");
      return;
    }
    const succeeded = await onEditToken({
      chainId: token.chainId,
      tokenContract: token.tokenContract,
      label: editLabel,
      clearLabel: editLabel.trim() === "",
      userNotes: editNotes,
      clearUserNotes: editNotes.trim() === "",
      metadataOverride:
        editSymbol.trim() || editName.trim() || decimals !== null
          ? {
              symbol: editSymbol.trim() || null,
              name: editName.trim() || null,
              decimals,
              source: "userConfirmed",
            }
          : undefined,
      clearMetadataOverride: !editSymbol.trim() && !editName.trim() && decimals === null,
    });
    if (succeeded === false) return;
    clearEdit();
  }

  return (
    <section className="workspace-section tokens-grid">
      <header className="section-header">
        <div>
          <h2>Tokens</h2>
          <p className="section-subtitle">
            Watchlist entries are local configuration. Removing one does not change transaction history.
          </p>
        </div>
        <span className="pill">chainId {selectedChainId.toString()}</span>
      </header>

      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {formError && (
        <div className="inline-warning" role="alert">
          {formError}
        </div>
      )}

      <section className="token-panel" aria-label="Add watchlist token">
        <div className="token-form-grid">
          <label>
            Chain ID
            <input
              inputMode="numeric"
              onChange={(event) => setAddChainId(event.target.value)}
              value={addChainId}
            />
          </label>
          <label>
            Token contract
            <input
              onChange={(event) => setAddTokenContract(event.target.value)}
              value={addTokenContract}
            />
          </label>
          <label>
            RPC profile
            <input
              onChange={(event) => setAddRpcProfileId(event.target.value)}
              value={addRpcProfileId}
            />
          </label>
          <label>
            Label
            <input onChange={(event) => setAddLabel(event.target.value)} value={addLabel} />
          </label>
          <label>
            Notes
            <input onChange={(event) => setAddNotes(event.target.value)} value={addNotes} />
          </label>
          <button disabled={busy || !addTokenContract.trim()} onClick={() => void submitAdd()} type="button">
            Add
          </button>
        </div>
      </section>

      <section className="token-panel" aria-label="Watchlist tokens">
        <header className="token-panel-header">
          <h3>Watchlist</h3>
          <span className="section-subtitle">{tokens.length} local token(s)</span>
        </header>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Metadata</th>
                <th>Scan</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => {
                const key = tokenIdentityKey(token.chainId, token.tokenContract);
                const metadata = metadataByToken.get(key) ?? null;
                const metadataCache = metadataCacheByToken.get(key) ?? null;
                const conflictDetail = metadataConflictDetail(
                  token,
                  metadataCache,
                  metadata?.status,
                );
                const scan = scanByToken.get(key) ?? null;
                const isEditing = editingKey === key;
                return (
                  <tr key={key}>
                    <td>
                      <strong>{tokenDisplayName(token, metadata)}</strong>
                      <div className="mono">chainId {token.chainId}</div>
                      <div className="mono">{token.tokenContract}</div>
                      {token.userNotes && <div className="muted">{token.userNotes}</div>}
                    </td>
                    <td>
                      {isEditing ? (
                        <div className="token-edit-grid">
                          <label>
                            Label
                            <input
                              onChange={(event) => setEditLabel(event.target.value)}
                              value={editLabel}
                            />
                          </label>
                          <label>
                            Notes
                            <input
                              onChange={(event) => setEditNotes(event.target.value)}
                              value={editNotes}
                            />
                          </label>
                          <label>
                            Symbol override
                            <input
                              onChange={(event) => setEditSymbol(event.target.value)}
                              value={editSymbol}
                            />
                          </label>
                          <label>
                            Name override
                            <input
                              onChange={(event) => setEditName(event.target.value)}
                              value={editName}
                            />
                          </label>
                          <label>
                            Decimals override
                            <input
                              inputMode="numeric"
                              onChange={(event) => setEditDecimals(event.target.value)}
                              value={editDecimals}
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="token-status-stack">
                          <span className={statusClass(metadata?.status)}>
                            {metadata ? metadataStatusLabels[metadata.status] : "Unscanned"}
                          </span>
                          <span>{metadata?.symbol ?? "Unknown symbol"} · {metadata?.name ?? "Unknown name"}</span>
                          <span className="muted">
                            decimals {metadata?.decimals ?? "unknown"} · source {metadata?.source ?? "unknown"}
                          </span>
                          {conflictDetail && <span className="token-error">{conflictDetail}</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="token-status-stack">
                        <span className={statusClass(scan?.status)}>
                          {scan ? scanStatusLabels[scan.status] : "Idle"}
                        </span>
                        <span className="muted">Last scan {formatTimestamp(scan?.lastFinishedAt)}</span>
                        {scan?.lastErrorSummary && (
                          <span className="token-error">{scan.lastErrorSummary}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {isEditing ? (
                        <div className="button-row history-actions">
                          <button
                            disabled={busy}
                            onClick={() => void submitEdit(token)}
                            type="button"
                          >
                            Save
                          </button>
                          <button className="secondary-button" onClick={clearEdit} type="button">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="button-row history-actions">
                          <button
                            disabled={busy || !rpcReady}
                            onClick={() => void onScanMetadata(token.chainId, token.tokenContract)}
                            title={rpcReady ? undefined : "Validate an RPC before scanning metadata."}
                            type="button"
                          >
                            Scan
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => beginEdit(token)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="secondary-button"
                            disabled={busy}
                            onClick={() => void onRemoveToken(token.chainId, token.tokenContract)}
                            title="Removes only the local watchlist entry; cached metadata, balances, and transaction history remain."
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {tokens.length === 0 && (
                <tr>
                  <td colSpan={4}>No watchlist tokens yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="token-panel" aria-label="ERC-20 balances">
        <header className="token-panel-header">
          <h3>Balances</h3>
          <div className="button-row history-actions">
            <label>
              Account
              <select
                disabled={accounts.length === 0}
                onChange={(event) => setSelectedAccount(event.target.value)}
                value={selectedAccountRecord?.address ?? ""}
              >
                {accounts.map((account) => (
                  <option key={account.address} value={account.address}>
                    {account.label} · {compactAddress(account.address)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !rpcReady || !selectedAccountAddress}
              onClick={() => void onScanSelectedAccount(selectedAccountAddress, false)}
              title={rpcReady ? undefined : "Validate an RPC before scanning balances."}
              type="button"
            >
              Scan Account
            </button>
            <button
              className="secondary-button"
              disabled={busy || !rpcReady || !selectedAccountAddress}
              onClick={() => void onScanSelectedAccount(selectedAccountAddress, true)}
              title={rpcReady ? undefined : "Validate an RPC before retrying failed scans."}
              type="button"
            >
              Retry Failed
            </button>
          </div>
        </header>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Raw balance</th>
                <th>Human amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleBalanceTokens.map((token) => {
                const key = tokenIdentityKey(token.chainId, token.tokenContract);
                const metadata = metadataByToken.get(key) ?? null;
                const snapshot = selectedAccountAddress
                  ? balancesByIdentity.get(
                      balanceKey(selectedAccountAddress, token.chainId, token.tokenContract),
                    ) ?? null
                  : null;
                return (
                  <tr key={key}>
                    <td>
                      <strong>{tokenDisplayName(token, metadata)}</strong>
                      <div className="mono">{token.tokenContract}</div>
                      <div className="muted">
                        {metadata?.symbol ?? "Unknown symbol"} · {metadata?.source ?? "unknown source"}
                      </div>
                    </td>
                    <td className="mono">{snapshot?.balanceRaw ?? "Unscanned"}</td>
                    <td>{snapshot ? humanAmount(snapshot, metadata) : "Unavailable"}</td>
                    <td>
                      <div className="token-status-stack">
                        <span className={statusClass(snapshot?.balanceStatus)}>
                          {snapshot ? balanceStatusLabels[snapshot.balanceStatus] : "Unscanned"}
                        </span>
                        <span className="muted">Last scan {formatTimestamp(snapshot?.lastScannedAt)}</span>
                        {snapshot?.lastErrorSummary && (
                          <span className="token-error">{snapshot.lastErrorSummary}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <button
                        disabled={busy || !rpcReady || !selectedAccountAddress}
                        onClick={() =>
                          void onScanBalance(
                            selectedAccountAddress,
                            token.chainId,
                            token.tokenContract,
                          )
                        }
                        title={rpcReady ? undefined : "Validate an RPC before scanning balances."}
                        type="button"
                      >
                        Scan
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visibleBalanceTokens.length === 0 && (
                <tr>
                  <td colSpan={5}>No visible watchlist tokens for this chain.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
