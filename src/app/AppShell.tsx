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
        <main className="workspace-tabs" />
      )}
    </div>
  );
}
