import { useState } from "react";
import type {
  BrowserVaultAccountLibrarySummary,
  BrowserVaultAccountRecord,
  BrowserVaultGroupRecord,
} from "../../core/accounts";

export interface PwaVaultWorkspaceProps {
  activeGroup: BrowserVaultGroupRecord | null;
  groups: BrowserVaultGroupRecord[];
  librarySummary: BrowserVaultAccountLibrarySummary;
  busy?: boolean;
  onSelectGroup(groupId: string): void;
  onRenameGroup(groupId: string, name: string): void;
  onAddGroup(): void;
  onDeriveAccounts(groupId: string, count: number): void;
  onToggleAccountSelection(groupId: string, accountId: string): void;
  onSelectAllAccounts(groupId: string): void;
  onClearAccountSelection(groupId: string): void;
  onRenameAccount(groupId: string, accountId: string, label: string): void;
  onExportVault(): void;
  onLock(): void;
}

const DEFAULT_DERIVE_COUNT = 20;
const MAX_DERIVE_COUNT = 100;

function normalizeDeriveCount(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_DERIVE_COUNT, Math.max(0, Math.trunc(value)));
}

function AccountRow({
  account,
  groupId,
  busy,
  onToggleAccountSelection,
  onRenameAccount,
}: {
  account: BrowserVaultAccountRecord;
  groupId: string;
  busy: boolean;
  onToggleAccountSelection(groupId: string, accountId: string): void;
  onRenameAccount(groupId: string, accountId: string, label: string): void;
}) {
  const checkboxLabel = `${account.label} ${account.address}`;

  return (
    <li className={account.selected ? "pwa-account-row pwa-account-row-selected" : "pwa-account-row"}>
      <div className="pwa-account-row-main">
        <label className="pwa-checkbox-row">
          <input
            aria-label={checkboxLabel}
            checked={account.selected}
            disabled={busy}
            onChange={() => onToggleAccountSelection(groupId, account.id)}
            type="checkbox"
          />
          <strong>{account.label}</strong>
        </label>
        <span className="mono">{account.address}</span>
        <span className="mono">{account.derivationPath}</span>
      </div>
      <div className="button-row">
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

function summarizeGroupCounts(group: BrowserVaultGroupRecord) {
  return {
    accountCount: group.accounts.length,
    selectedAccountCount: group.accounts.filter((account) => account.selected).length,
  };
}

export function PwaVaultWorkspace({
  activeGroup,
  groups,
  librarySummary,
  busy = false,
  onSelectGroup,
  onRenameGroup,
  onAddGroup,
  onDeriveAccounts,
  onToggleAccountSelection,
  onSelectAllAccounts,
  onClearAccountSelection,
  onRenameAccount,
  onExportVault,
  onLock,
}: PwaVaultWorkspaceProps) {
  const [deriveCount, setDeriveCount] = useState(DEFAULT_DERIVE_COUNT);
  const normalizedDeriveCount = normalizeDeriveCount(deriveCount);
  const canDerive = Boolean(activeGroup) && normalizedDeriveCount > 0 && !busy;

  function handleDerive(count: number) {
    if (!activeGroup) return;
    const normalizedCount = normalizeDeriveCount(count);
    if (normalizedCount <= 0) return;
    onDeriveAccounts(activeGroup.id, normalizedCount);
  }

  return (
    <section className="pwa-vault-workspace">
      <header className="section-header">
        <div>
          <h2>账户与组</h2>
          <p className="section-subtitle">热解锁会话只在当前标签页内存中；账户库变更会保存回加密 vault。</p>
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

      <div className="pwa-card pwa-account-library-summary">
        <h3>账户库摘要</h3>
        <div className="button-row">
          <span className="status-badge">
            {librarySummary.totalGroupCount} 组 / {librarySummary.totalAccountCount} 账户
          </span>
          <span className="status-badge">
            已选 {librarySummary.totalSelectedAccountCount} / 全部 {librarySummary.totalAccountCount}
          </span>
          <span className="status-badge">当前组 {librarySummary.activeGroupName}</span>
          <span className="status-badge">下一个 index {librarySummary.activeGroupNextAccountIndex}</span>
          <span className="status-badge">
            当前组已选 {librarySummary.activeGroupSelectedAccountCount} / {librarySummary.activeGroupAccountCount}
          </span>
        </div>
      </div>

      <div className="pwa-vault-workspace-grid">
        <aside className="pwa-card pwa-group-list-card">
          <h3>账户组</h3>
          <div className="pwa-group-list">
            {groups.map((group) => {
              const groupCounts = summarizeGroupCounts(group);

              return (
                <button
                  key={group.id}
                  className={group.id === activeGroup?.id ? "pwa-group-pill pwa-group-pill-active" : "pwa-group-pill"}
                  disabled={busy}
                  onClick={() => onSelectGroup(group.id)}
                  type="button"
                >
                  <span>{group.name}</span>
                  <span className="pwa-muted-note">
                    已选 {groupCounts.selectedAccountCount} / {groupCounts.accountCount}
                  </span>
                </button>
              );
            })}
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
                onClick={() => handleDerive(1)}
                type="button"
              >
                派生 1
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => handleDerive(5)}
                type="button"
              >
                派生 5
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => handleDerive(20)}
                type="button"
              >
                派生 20
              </button>
            </div>
          )}
        </aside>

        <article className="pwa-card">
          <div className="pwa-card-heading-row">
            <div>
              <h3>派生账户</h3>
              <p className="pwa-muted-note">
                当前组已选 {librarySummary.activeGroupSelectedAccountCount} / {librarySummary.activeGroupAccountCount}
              </p>
            </div>
            {activeGroup && (
              <div className="button-row">
                <label>
                  派生数量
                  <input
                    aria-label="派生数量"
                    disabled={busy}
                    max={MAX_DERIVE_COUNT}
                    min={0}
                    onChange={(event) => setDeriveCount(normalizeDeriveCount(event.target.valueAsNumber))}
                    step={1}
                    type="number"
                    value={deriveCount}
                  />
                </label>
                <button disabled={!canDerive} onClick={() => handleDerive(deriveCount)} type="button">
                  派生账户
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => onSelectAllAccounts(activeGroup.id)}
                  type="button"
                >
                  全选
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => onClearAccountSelection(activeGroup.id)}
                  type="button"
                >
                  清空选择
                </button>
              </div>
            )}
          </div>
          {activeGroup ? (
            <ul className="pwa-account-list">
              {activeGroup.accounts.map((account) => (
                <AccountRow
                  account={account}
                  busy={busy}
                  groupId={activeGroup.id}
                  key={account.id}
                  onRenameAccount={onRenameAccount}
                  onToggleAccountSelection={onToggleAccountSelection}
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
