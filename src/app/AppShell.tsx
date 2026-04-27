import { AccountsView } from "../features/accounts/AccountsView";
import { HistoryView } from "../features/history/HistoryView";
import { SettingsView } from "../features/settings/SettingsView";
import { TransferView } from "../features/transfer/TransferView";
import { UnlockView } from "../features/unlock/UnlockView";

export type WorkspaceTab = "accounts" | "transfer" | "history" | "settings";

export interface AppShellProps {
  session: { status: "locked" | "ready" };
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onUnlock: (password: string) => Promise<void>;
}

const workspaceTabs: WorkspaceTab[] = ["accounts", "transfer", "history", "settings"];

function tabLabel(tab: WorkspaceTab) {
  return tab[0].toUpperCase() + tab.slice(1);
}

export function AppShell({ session, activeTab, onTabChange, onUnlock }: AppShellProps) {
  return (
    <div className="workbench-shell">
      <header className="workbench-header">
        <h1>EVM Wallet Workbench</h1>
      </header>
      {session.status === "locked" ? (
        <UnlockView onUnlock={onUnlock} />
      ) : (
        <>
          <nav aria-label="Workspace sections" className="workspace-tabs" role="tablist">
            {workspaceTabs.map((tab) => (
              <button
                aria-selected={activeTab === tab}
                className={`workspace-tab ${activeTab === tab ? "workspace-tab-active" : ""}`}
                key={tab}
                onClick={() => onTabChange(tab)}
                role="tab"
                type="button"
              >
                {tabLabel(tab)}
              </button>
            ))}
          </nav>
          {activeTab === "accounts" && <AccountsView accounts={[]} onAddAccount={async () => {}} />}
          {activeTab === "transfer" && <TransferView draft={null} />}
          {activeTab === "history" && <HistoryView items={[]} />}
          {activeTab === "settings" && <SettingsView chains={[]} />}
        </>
      )}
    </div>
  );
}
