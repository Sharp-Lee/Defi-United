import { useState } from "react";
import { AppShell } from "./app/AppShell";
import type { WorkspaceTab } from "./app/AppShell";
import { unlockVault } from "./lib/tauri";

export function App() {
  const [sessionStatus, setSessionStatus] = useState<"locked" | "ready">("locked");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("accounts");

  async function handleUnlock(password: string) {
    await unlockVault(password);
    setSessionStatus("ready");
  }

  return (
    <AppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onUnlock={handleUnlock}
      session={{ status: sessionStatus }}
    />
  );
}
