import { AccountsView } from "../features/accounts/AccountsView";
import { DiagnosticsView } from "../features/diagnostics/DiagnosticsView";
import { HistoryView } from "../features/history/HistoryView";
import { SettingsView } from "../features/settings/SettingsView";
import { TransferView } from "../features/transfer/TransferView";
import { UnlockView } from "../features/unlock/UnlockView";
import { BUILT_IN_CHAINS } from "../core/chains/registry";
import { getRawHistoryErrorDisplay } from "../core/history/errors";
import type { ChainRecord } from "../core/chains/registry";
import type {
  AccountRecord,
  HistoryRecord,
  HistoryRecoveryIntent,
  HistoryStorageInspection,
  HistoryStorageQuarantineResult,
  PendingMutationRequest,
} from "../lib/tauri";
import type { AccountChainState } from "../lib/rpc";

export type WorkspaceTab = "accounts" | "transfer" | "history" | "diagnostics" | "settings";

export interface AppShellProps {
  session: { status: "locked" | "ready" };
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onUnlock: (password: string) => Promise<void>;
  onCreateVault?: (password: string) => Promise<void>;
  onLock?: () => Promise<void> | void;
  accounts?: Array<AccountRecord & AccountChainState>;
  history?: HistoryRecord[];
  historyRecoveryIntents?: HistoryRecoveryIntent[];
  historyRecoveryRpcDisabledReason?: string | null;
  chains?: ChainRecord[];
  selectedChainId?: bigint;
  rpcUrl?: string;
  settingsStatusMessage?: string | null;
  settingsStatusKind?: "idle" | "ok" | "error";
  busy?: boolean;
  appError?: string | null;
  historyError?: string | null;
  historyStorage?: HistoryStorageInspection | null;
  lastHistoryQuarantine?: HistoryStorageQuarantineResult | null;
  onAddAccount?: () => Promise<void> | void;
  onRefreshAccounts?: () => Promise<void> | void;
  onRefreshHistory?: () => Promise<void> | void;
  onQuarantineHistory?: () => Promise<void> | void;
  onRecoverBroadcastedHistory?: (recoveryId: string) => Promise<void> | void;
  onDismissHistoryRecovery?: (recoveryId: string) => Promise<void> | void;
  onReplacePending?: (request: PendingMutationRequest) => Promise<void> | void;
  onCancelPending?: (request: PendingMutationRequest) => Promise<void> | void;
  onChainChange?: (chainId: bigint) => void;
  onRpcUrlChange?: (rpcUrl: string) => void;
  onValidateRpc?: () => Promise<void> | void;
  onTransferSubmitFailed?: (error: unknown) => Promise<void> | void;
  onTransferSubmitted?: (record: HistoryRecord) => void;
}

const workspaceTabs: WorkspaceTab[] = ["accounts", "transfer", "history", "diagnostics", "settings"];

function tabLabel(tab: WorkspaceTab) {
  return tab[0].toUpperCase() + tab.slice(1);
}

export function AppShell({
  session,
  activeTab,
  onTabChange,
  onUnlock,
  onCreateVault = async () => {},
  onLock = () => {},
  accounts = [],
  history = [],
  historyRecoveryIntents = [],
  historyRecoveryRpcDisabledReason = null,
  chains = BUILT_IN_CHAINS,
  selectedChainId = 1n,
  rpcUrl = "",
  settingsStatusMessage = null,
  settingsStatusKind = "idle",
  busy = false,
  appError = null,
  historyError = null,
  historyStorage = null,
  lastHistoryQuarantine = null,
  onAddAccount = async () => {},
  onRefreshAccounts = async () => {},
  onRefreshHistory = async () => {},
  onQuarantineHistory = async () => {},
  onRecoverBroadcastedHistory = async () => {},
  onDismissHistoryRecovery = async () => {},
  onReplacePending = async () => {},
  onCancelPending = async () => {},
  onChainChange = () => {},
  onRpcUrlChange = () => {},
  onValidateRpc = async () => {},
  onTransferSubmitFailed = async () => {},
  onTransferSubmitted = () => {},
}: AppShellProps) {
  const selectedChain = chains.find((chain) => chain.chainId === selectedChainId) ?? chains[0];
  const chainReady = settingsStatusKind === "ok" && rpcUrl.trim().length > 0;
  const globalErrorDisplay = appError
    ? getRawHistoryErrorDisplay({
        message: appError,
        source: "app",
        category: "global",
      })
    : null;

  return (
    <div className="workbench-shell">
      <header className="workbench-header">
        <h1>EVM Wallet Workbench</h1>
        {session.status === "ready" && (
          <button className="secondary-button" onClick={onLock} type="button">
            Lock
          </button>
        )}
      </header>
      {globalErrorDisplay && (
        <div className="inline-error">
          {globalErrorDisplay.title}
          {globalErrorDisplay.message ? `: ${globalErrorDisplay.message}` : ""}
        </div>
      )}
      {session.status === "locked" ? (
        <UnlockView
          onCreateVault={onCreateVault}
          onUnlock={onUnlock}
        />
      ) : (
        <>
          <nav aria-label="Workspace sections" className="workspace-tablist" role="tablist">
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
          <div className="workspace-tabs">
            {activeTab === "accounts" && (
              <AccountsView
                accounts={accounts}
                busy={busy}
                chainLabel={selectedChain?.name}
                disabledReason={chainReady ? null : "Validate an RPC before adding accounts."}
                onAddAccount={onAddAccount}
                onRefreshAccounts={onRefreshAccounts}
              />
            )}
            {activeTab === "transfer" && (
              <TransferView
                accounts={accounts}
                chainId={selectedChainId}
                chainName={selectedChain?.name ?? "Unknown chain"}
                draft={null}
                history={history}
                historyStorageIssue={
                  historyStorage?.status === "corrupted"
                    ? "Local transaction history is unreadable. Submission is disabled until history is retried or the damaged file is quarantined."
                    : null
                }
                onSubmitFailed={onTransferSubmitFailed}
                onSubmitted={onTransferSubmitted}
                rpcUrl={rpcUrl}
              />
            )}
            {activeTab === "history" && (
              <HistoryView
                disabled={busy}
                error={historyError}
                items={history}
                lastQuarantine={lastHistoryQuarantine}
                loading={busy}
                onCancelPending={onCancelPending}
                onDismissRecovery={onDismissHistoryRecovery}
                onQuarantineHistory={onQuarantineHistory}
                onRefresh={onRefreshHistory}
                onRecoverBroadcastedHistory={onRecoverBroadcastedHistory}
                onReplace={onReplacePending}
                recoveryIntents={historyRecoveryIntents}
                recoveryRpcDisabledReason={historyRecoveryRpcDisabledReason}
                storage={historyStorage}
              />
            )}
            {activeTab === "diagnostics" && <DiagnosticsView />}
            {activeTab === "settings" && (
              <SettingsView
                busy={busy}
                chains={chains}
                onChainChange={onChainChange}
                onRpcUrlChange={onRpcUrlChange}
                onValidateRpc={onValidateRpc}
                rpcUrl={rpcUrl}
                selectedChainId={selectedChainId}
                statusKind={settingsStatusKind}
                statusMessage={settingsStatusMessage}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
