import { UnlockView } from "../features/unlock/UnlockView";

export interface AppShellProps {
  session: { status: "locked" | "ready" };
}

export function AppShell({ session }: AppShellProps) {
  return (
    <div className="workbench-shell">
      <header className="workbench-header">
        <h1>EVM Wallet Workbench</h1>
      </header>
      {session.status === "locked" ? (
        <UnlockView />
      ) : (
        <main className="workspace-tabs">
          <div aria-label="Workspace sections" className="workspace-tablist" role="tablist">
            <button aria-selected="true" className="workspace-tab workspace-tab-active" role="tab" type="button">
              Accounts
            </button>
          </div>
        </main>
      )}
    </div>
  );
}
