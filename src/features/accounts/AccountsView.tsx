import type { AccountRecord } from "../../lib/tauri";
import type { AccountChainState } from "../../lib/rpc";

export interface AccountsViewProps {
  accounts: Array<AccountRecord & AccountChainState>;
  onAddAccount: () => Promise<void> | void;
  onRefreshAccounts: () => Promise<void> | void;
  busy?: boolean;
  chainLabel?: string;
  disabledReason?: string | null;
}

function formatSyncTime(value?: string | null) {
  if (!value) return "never";
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function AccountsView({
  accounts,
  onAddAccount,
  onRefreshAccounts,
  busy = false,
  chainLabel = "Current chain",
  disabledReason = null,
}: AccountsViewProps) {
  return (
    <section className="workspace-section">
      <header className="section-header">
        <h2>Accounts</h2>
        <div className="button-row">
          <button disabled={busy || !!disabledReason} onClick={onAddAccount} type="button">
            Add Account
          </button>
          <button className="secondary-button" disabled={busy || accounts.length === 0} onClick={onRefreshAccounts} type="button">
            Refresh
          </button>
        </div>
      </header>
      {disabledReason && <div className="inline-warning">{disabledReason}</div>}
      <div className="data-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Index</th>
              <th>Label</th>
              <th>Address</th>
              <th>{chainLabel} Balance</th>
              <th>Nonce</th>
              <th>Sync</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr>
                <td colSpan={6}>No accounts yet.</td>
              </tr>
            )}
            {accounts.map((account) => (
              <tr key={account.index}>
                <td>{account.index}</td>
                <td>{account.label}</td>
                <td className="mono">{account.address}</td>
                <td className="mono">
                  {account.nativeBalanceWei === null
                    ? "not scanned"
                    : `${account.nativeBalanceWei.toString()} wei`}
                </td>
                <td className="mono">{account.nonce === null ? "not scanned" : account.nonce}</td>
                <td>
                  {account.lastSyncError
                    ? `Error: ${account.lastSyncError}`
                    : `Synced: ${formatSyncTime(account.lastSyncedAt)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
