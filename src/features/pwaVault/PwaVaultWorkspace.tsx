import type { BrowserVaultAccountRecord, BrowserVaultGroupRecord } from "../../core/browserVault/accounts";

export interface PwaVaultWorkspaceProps {
  activeGroup: BrowserVaultGroupRecord | null;
  groups: BrowserVaultGroupRecord[];
  busy?: boolean;
  onSelectGroup(groupId: string): void;
  onRenameGroup(groupId: string, name: string): void;
  onAddGroup(): void;
  onDeriveAccounts(groupId: string, count: number): void;
  onSelectAccount(groupId: string, accountId: string): void;
  onRenameAccount(groupId: string, accountId: string, label: string): void;
  onExportVault(): void;
  onLock(): void;
}

function AccountRow({
  account,
  groupId,
  busy,
  onSelectAccount,
  onRenameAccount,
}: {
  account: BrowserVaultAccountRecord;
  groupId: string;
  busy: boolean;
  onSelectAccount(groupId: string, accountId: string): void;
  onRenameAccount(groupId: string, accountId: string, label: string): void;
}) {
  return (
    <li className={account.selected ? "pwa-account-row pwa-account-row-selected" : "pwa-account-row"}>
      <div className="pwa-account-row-main">
        <strong>{account.label}</strong>
        <span className="mono">{account.address}</span>
        <span className="mono">{account.derivationPath}</span>
      </div>
      <div className="button-row">
        <button disabled={busy} onClick={() => onSelectAccount(groupId, account.id)} type="button">
          选中
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => onRenameAccount(groupId, account.id, `${account.label}*`)}
          type="button"
        >
          改名
        </button>
      </div>
    </li>
  );
}

export function PwaVaultWorkspace({
  activeGroup,
  groups,
  busy = false,
  onSelectGroup,
  onRenameGroup,
  onAddGroup,
  onDeriveAccounts,
  onSelectAccount,
  onRenameAccount,
  onExportVault,
  onLock,
}: PwaVaultWorkspaceProps) {
  return (
    <section className="pwa-vault-workspace">
      <header className="section-header">
        <div>
          <h2>账户与组</h2>
          <p className="section-subtitle">解锁后的当前标签页热会话、账户组和派生账户仅存在于内存状态里。</p>
        </div>
        <div className="button-row">
          <button disabled={busy} onClick={onAddGroup} type="button">
            新建组
          </button>
          <button className="secondary-button" disabled={busy} onClick={onExportVault} type="button">
            导出加密 vault
          </button>
          <button className="secondary-button" disabled={busy} onClick={onLock} type="button">
            锁定
          </button>
        </div>
      </header>

      <div className="pwa-vault-workspace-grid">
        <aside className="pwa-card pwa-group-list-card">
          <h3>账户组</h3>
          <div className="pwa-group-list">
            {groups.map((group) => (
              <button
                key={group.id}
                className={group.id === activeGroup?.id ? "pwa-group-pill pwa-group-pill-active" : "pwa-group-pill"}
                disabled={busy}
                onClick={() => onSelectGroup(group.id)}
                type="button"
              >
                {group.name}
              </button>
            ))}
          </div>
          {activeGroup && (
            <div className="pwa-group-summary">
              <label>
                组名
                <input
                  aria-label="组名"
                  disabled={busy}
                  onChange={(event) => onRenameGroup(activeGroup.id, event.target.value)}
                  value={activeGroup.name}
                />
              </label>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => onDeriveAccounts(activeGroup.id, 1)}
                type="button"
              >
                派生 1 个账户
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => onDeriveAccounts(activeGroup.id, 5)}
                type="button"
              >
                派生 5 个账户
              </button>
            </div>
          )}
        </aside>

        <article className="pwa-card">
          <h3>派生账户</h3>
          {activeGroup ? (
            <ul className="pwa-account-list">
              {activeGroup.accounts.map((account) => (
                <AccountRow
                  account={account}
                  busy={busy}
                  groupId={activeGroup.id}
                  key={account.id}
                  onRenameAccount={onRenameAccount}
                  onSelectAccount={onSelectAccount}
                />
              ))}
            </ul>
          ) : (
            <p>当前没有账户组。</p>
          )}
        </article>
      </div>
    </section>
  );
}
