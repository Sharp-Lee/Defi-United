import { useState } from "react";
import { useApp } from "../state/store";
import { SettingsPanel } from "./SettingsPanel";
import { RootPanel } from "./RootPanel";
import { ChildAccountsTable } from "./ChildAccountsTable";
import { DistributeForm } from "./DistributeForm";
import { DonateForm } from "./DonateForm";
import { SweepForm } from "./SweepForm";
import { ActivityLog } from "./ActivityLog";

export function Dashboard() {
  const { state } = useApp();
  const [tab, setTab] = useState<"distribute" | "donate" | "sweep">("distribute");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const canBroadcast = state.network?.chainId === 1n && state.busy === null;

  return (
    <div className="col">
      <SettingsPanel />
      <RootPanel />
      <ChildAccountsTable selected={selected} setSelected={setSelected} />

      <div className="panel">
        <h2>操作</h2>
        <div className="tabs">
          <button
            className={`tab ${tab === "distribute" ? "active" : ""}`}
            onClick={() => setTab("distribute")}
          >
            1) Distribute (合约批量)
          </button>
          <button
            className={`tab ${tab === "donate" ? "active" : ""}`}
            onClick={() => setTab("donate")}
          >
            2) Donate
          </button>
          <button
            className={`tab ${tab === "sweep" ? "active" : ""}`}
            onClick={() => setTab("sweep")}
          >
            3) Sweep
          </button>
        </div>
        {tab === "distribute" && (
          <DistributeForm selected={selected} canBroadcast={canBroadcast} />
        )}
        {tab === "donate" && <DonateForm selected={selected} canBroadcast={canBroadcast} />}
        {tab === "sweep" && <SweepForm selected={selected} canBroadcast={canBroadcast} />}
      </div>

      <ActivityLog />
    </div>
  );
}
