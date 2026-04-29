import { AccountsView } from "../features/accounts/AccountsView";
import { AbiLibraryView } from "../features/abi/AbiLibraryView";
import type { AbiMutationHandlerResult } from "../features/abi/AbiLibraryView";
import { AssetApprovalsView } from "../features/assets/AssetApprovalsView";
import { DiagnosticsView } from "../features/diagnostics/DiagnosticsView";
import { HistoryView } from "../features/history/HistoryView";
import { AccountOrchestrationView } from "../features/orchestration/AccountOrchestrationView";
import { RawCalldataView } from "../features/rawCalldata/RawCalldataView";
import { SettingsView } from "../features/settings/SettingsView";
import { TokensView } from "../features/tokens/TokensView";
import { TransferView } from "../features/transfer/TransferView";
import { UnlockView } from "../features/unlock/UnlockView";
import { BUILT_IN_CHAINS } from "../core/chains/registry";
import { getRawHistoryErrorDisplay } from "../core/history/errors";
import type { ChainRecord } from "../core/chains/registry";
import type {
  AccountRecord,
  Erc20BatchSubmitResult,
  HistoryRecord,
  HistoryRecoveryIntent,
  HistoryStorageInspection,
  HistoryStorageQuarantineResult,
  PendingMutationRequest,
  RawCalldataSubmitInput,
  AddWatchlistTokenInput,
  UpsertApprovalWatchlistEntryInput,
  AbiCacheEntryRecord,
  AbiCalldataPreviewInput,
  AbiCalldataPreviewResult,
  AbiFunctionCatalogResult,
  AbiManagedEntryInput,
  AbiPayloadValidationReadModel,
  AbiReadCallInput,
  AbiReadCallResult,
  AbiRegistryState,
  AbiWriteSubmitInput,
  FetchExplorerAbiInput,
  EditWatchlistTokenInput,
  TokenWatchlistState,
  UpsertAbiDataSourceConfigInput,
  UserAbiPayloadInput,
} from "../lib/tauri";
import type { AccountChainState } from "../lib/rpc";

export type WorkspaceTab =
  | "accounts"
  | "abi"
  | "tokens"
  | "assets"
  | "orchestration"
  | "transfer"
  | "rawCalldata"
  | "history"
  | "diagnostics"
  | "settings";

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
  historyReviewRpcDisabledReason?: string | null;
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
  tokenWatchlistState?: TokenWatchlistState | null;
  tokenWatchlistError?: string | null;
  abiRegistryState?: AbiRegistryState | null;
  abiRegistryError?: string | null;
  onAddAccount?: () => Promise<void> | void;
  onAddWatchlistToken?: (
    input: AddWatchlistTokenInput,
    rpcProfileId?: string | null,
  ) => Promise<boolean | void> | boolean | void;
  onEditWatchlistToken?: (
    input: EditWatchlistTokenInput,
  ) => Promise<boolean | void> | boolean | void;
  onRemoveWatchlistToken?: (
    chainId: number,
    tokenContract: string,
  ) => Promise<boolean | void> | boolean | void;
  onScanWatchlistTokenMetadata?: (
    chainId: number,
    tokenContract: string,
  ) => Promise<boolean | void> | boolean | void;
  onScanErc20Balance?: (
    account: string,
    chainId: number,
    tokenContract: string,
  ) => Promise<boolean | void> | boolean | void;
  onScanWatchlistBalances?: (
    account: string,
    retryFailedOnly?: boolean,
  ) => Promise<boolean | void> | boolean | void;
  onAddApprovalCandidate?: (
    input: UpsertApprovalWatchlistEntryInput,
  ) => Promise<boolean | void> | boolean | void;
  onScanErc20Allowance?: (
    owner: string,
    chainId: number,
    tokenContract: string,
    spender: string,
  ) => Promise<boolean | void> | boolean | void;
  onScanNftOperatorApproval?: (
    owner: string,
    chainId: number,
    tokenContract: string,
    operator: string,
  ) => Promise<boolean | void> | boolean | void;
  onScanErc721TokenApproval?: (
    owner: string,
    chainId: number,
    tokenContract: string,
    tokenId: string,
    operator?: string | null,
  ) => Promise<boolean | void> | boolean | void;
  onRefreshAbiRegistry?: () => Promise<boolean | void> | boolean | void;
  onSaveAbiDataSource?: (
    input: UpsertAbiDataSourceConfigInput,
  ) => Promise<boolean | void> | boolean | void;
  onRemoveAbiDataSource?: (id: string) => Promise<boolean | void> | boolean | void;
  onValidateAbiPayload?: (payload: string) => Promise<AbiPayloadValidationReadModel>;
  onImportAbiPayload?: (
    input: UserAbiPayloadInput,
  ) => Promise<AbiMutationHandlerResult> | AbiMutationHandlerResult;
  onPasteAbiPayload?: (
    input: UserAbiPayloadInput,
  ) => Promise<AbiMutationHandlerResult> | AbiMutationHandlerResult;
  onFetchExplorerAbi?: (
    input: FetchExplorerAbiInput,
  ) => Promise<AbiMutationHandlerResult> | AbiMutationHandlerResult;
  onMarkAbiStale?: (entry: AbiCacheEntryRecord) => Promise<boolean | void> | boolean | void;
  onDeleteAbiEntry?: (entry: AbiCacheEntryRecord) => Promise<boolean | void> | boolean | void;
  onListAbiFunctions?: (input: AbiManagedEntryInput) => Promise<AbiFunctionCatalogResult>;
  onPreviewAbiCalldata?: (
    input: AbiCalldataPreviewInput,
  ) => Promise<AbiCalldataPreviewResult>;
  onCallReadOnlyAbiFunction?: (input: AbiReadCallInput) => Promise<AbiReadCallResult>;
  onSubmitAbiWriteCall?: (input: AbiWriteSubmitInput) => Promise<HistoryRecord>;
  onRefreshAccounts?: () => Promise<void> | void;
  onRefreshHistory?: () => Promise<void> | void;
  onQuarantineHistory?: () => Promise<void> | void;
  onRecoverBroadcastedHistory?: (recoveryId: string) => Promise<void> | void;
  onDismissHistoryRecovery?: (recoveryId: string) => Promise<void> | void;
  onReviewDropped?: (txHash: string) => Promise<void> | void;
  onReplacePending?: (request: PendingMutationRequest) => Promise<void> | void;
  onCancelPending?: (request: PendingMutationRequest) => Promise<void> | void;
  onChainChange?: (chainId: bigint) => void;
  onRpcUrlChange?: (rpcUrl: string) => void;
  onValidateRpc?: () => Promise<void> | void;
  onTransferSubmitFailed?: (error: unknown) => Promise<void> | void;
  onTransferSubmitted?: (record: HistoryRecord) => void;
  onSubmitRawCalldata?: (input: RawCalldataSubmitInput) => Promise<HistoryRecord>;
  onNativeBatchSubmitFailed?: (error: unknown) => Promise<void> | void;
  onNativeBatchSubmitted?: (records: HistoryRecord[]) => void;
  onErc20BatchSubmitted?: (records: HistoryRecord[], result: Erc20BatchSubmitResult) => void;
}

const workspaceTabs: WorkspaceTab[] = [
  "accounts",
  "abi",
  "tokens",
  "assets",
  "orchestration",
  "transfer",
  "rawCalldata",
  "history",
  "diagnostics",
  "settings",
];

function tabLabel(tab: WorkspaceTab) {
  if (tab === "abi") return "ABI Library";
  if (tab === "rawCalldata") return "Raw Calldata";
  if (tab === "assets") return "Assets & Approvals";
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
  historyReviewRpcDisabledReason = null,
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
  tokenWatchlistState = null,
  tokenWatchlistError = null,
  abiRegistryState = null,
  abiRegistryError = null,
  onAddAccount = async () => {},
  onAddWatchlistToken = async () => {},
  onEditWatchlistToken = async () => {},
  onRemoveWatchlistToken = async () => {},
  onScanWatchlistTokenMetadata = async () => {},
  onScanErc20Balance = async () => {},
  onScanWatchlistBalances = async () => {},
  onAddApprovalCandidate = async () => {},
  onScanErc20Allowance = async () => {},
  onScanNftOperatorApproval = async () => {},
  onScanErc721TokenApproval = async () => {},
  onRefreshAbiRegistry = async () => {},
  onSaveAbiDataSource = async () => {},
  onRemoveAbiDataSource = async () => {},
  onValidateAbiPayload = async () => ({
    fetchSourceStatus: "notConfigured",
    validationStatus: "notValidated",
    functionCount: 0,
    eventCount: 0,
    errorCount: 0,
    selectorSummary: {},
    diagnostics: {},
  }),
  onImportAbiPayload = async () => {},
  onPasteAbiPayload = async () => {},
  onFetchExplorerAbi = async () => {},
  onMarkAbiStale = async () => {},
  onDeleteAbiEntry = async () => {},
  onListAbiFunctions = async () => ({
    status: "blocked",
    reasons: ["unknown"],
    sourceKind: "userPasted",
    versionId: "",
    abiHash: "",
    sourceFingerprint: "",
    functions: [],
    unsupportedItemCount: 0,
  }),
  onPreviewAbiCalldata = async (input) => ({
    status: "blocked",
    reasons: ["unknown"],
    functionSignature: input.functionSignature,
    sourceKind: input.sourceKind,
    versionId: input.versionId,
    abiHash: input.abiHash,
    sourceFingerprint: input.sourceFingerprint,
    parameterSummary: [],
  }),
  onCallReadOnlyAbiFunction = async (input) => ({
    status: "blocked",
    reasons: ["unknown"],
    functionSignature: input.functionSignature,
    contractAddress: input.contractAddress,
    from: input.from ?? null,
    sourceKind: input.sourceKind,
    providerConfigId: input.providerConfigId ?? null,
    userSourceId: input.userSourceId ?? null,
    versionId: input.versionId,
    abiHash: input.abiHash,
    sourceFingerprint: input.sourceFingerprint,
    outputs: [],
    rpc: {
      endpoint: "unknown",
      expectedChainId: input.chainId,
      actualChainId: null,
    },
    errorSummary: "Read caller is not configured.",
  }),
  onSubmitAbiWriteCall = async () => {
    throw new Error("ABI write submitter is not configured.");
  },
  onRefreshAccounts = async () => {},
  onRefreshHistory = async () => {},
  onQuarantineHistory = async () => {},
  onRecoverBroadcastedHistory = async () => {},
  onDismissHistoryRecovery = async () => {},
  onReviewDropped = async () => {},
  onReplacePending = async () => {},
  onCancelPending = async () => {},
  onChainChange = () => {},
  onRpcUrlChange = () => {},
  onValidateRpc = async () => {},
  onTransferSubmitFailed = async () => {},
  onTransferSubmitted = () => {},
  onSubmitRawCalldata = async () => {
    throw new Error("Raw calldata submitter is not configured.");
  },
  onNativeBatchSubmitFailed = async () => {},
  onNativeBatchSubmitted = () => {},
  onErc20BatchSubmitted = () => {},
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
                tokenWatchlistState={tokenWatchlistState}
              />
            )}
            {activeTab === "tokens" && (
              <TokensView
                accounts={accounts}
                busy={busy}
                error={tokenWatchlistError}
                onAddToken={onAddWatchlistToken}
                onEditToken={onEditWatchlistToken}
                onRemoveToken={onRemoveWatchlistToken}
                onScanBalance={onScanErc20Balance}
                onScanMetadata={onScanWatchlistTokenMetadata}
                onScanSelectedAccount={onScanWatchlistBalances}
                rpcReady={chainReady}
                selectedChainId={selectedChainId}
                state={tokenWatchlistState}
              />
            )}
            {activeTab === "assets" && (
              <AssetApprovalsView
                accounts={accounts}
                busy={busy}
                error={tokenWatchlistError}
                onAddApprovalCandidate={onAddApprovalCandidate}
                onScanErc20Allowance={onScanErc20Allowance}
                onScanErc721TokenApproval={onScanErc721TokenApproval}
                onScanNftOperatorApproval={onScanNftOperatorApproval}
                rpcReady={chainReady}
                selectedChainId={selectedChainId}
                state={tokenWatchlistState}
              />
            )}
            {activeTab === "rawCalldata" && (
              <RawCalldataView
                abiRegistryState={abiRegistryState}
                accounts={accounts}
                chainId={selectedChainId}
                chainName={selectedChain?.name ?? "Unknown chain"}
                history={history}
                historyStorageIssue={
                  historyStorage?.status === "corrupted"
                    ? "Local transaction history is unreadable. Submission is disabled until history is retried or the damaged file is quarantined."
                    : null
                }
                onListAbiFunctions={onListAbiFunctions}
                onSubmitFailed={onTransferSubmitFailed}
                onSubmitRawCalldata={onSubmitRawCalldata}
                rpcUrl={rpcUrl}
              />
            )}
            {activeTab === "abi" && (
              <AbiLibraryView
                accounts={accounts}
                busy={busy}
                chainName={selectedChain?.name ?? "Unknown chain"}
                error={abiRegistryError}
                onDeleteEntry={onDeleteAbiEntry}
                onCallReadOnlyFunction={onCallReadOnlyAbiFunction}
                onFetchExplorerAbi={onFetchExplorerAbi}
                onImportPayload={onImportAbiPayload}
                onMarkStale={onMarkAbiStale}
                onPastePayload={onPasteAbiPayload}
                onListFunctions={onListAbiFunctions}
                onPreviewCalldata={onPreviewAbiCalldata}
                onRefresh={onRefreshAbiRegistry}
                onRemoveDataSource={onRemoveAbiDataSource}
                onSaveDataSource={onSaveAbiDataSource}
                onSubmitWriteCall={onSubmitAbiWriteCall}
                onValidatePayload={onValidateAbiPayload}
                rpcUrl={rpcUrl}
                selectedChainId={selectedChainId}
                state={abiRegistryState}
              />
            )}
            {activeTab === "orchestration" && (
              <AccountOrchestrationView
                accounts={accounts}
                chainName={selectedChain?.name ?? "Unknown chain"}
                historyStorageIssue={
                  historyStorage?.status === "corrupted"
                    ? "Local transaction history is unreadable. Submission is disabled until history is retried or the damaged file is quarantined."
                    : null
                }
                onNativeBatchSubmitFailed={onNativeBatchSubmitFailed}
                onNativeBatchSubmitted={onNativeBatchSubmitted}
                onErc20BatchSubmitted={onErc20BatchSubmitted}
                history={history}
                rpcUrl={rpcUrl}
                selectedChainId={selectedChainId}
                tokenWatchlistState={tokenWatchlistState}
              />
            )}
            {activeTab === "history" && (
              <HistoryView
                chainReady={chainReady}
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
                onReviewDropped={onReviewDropped}
                recoveryIntents={historyRecoveryIntents}
                recoveryRpcDisabledReason={historyRecoveryRpcDisabledReason}
                reviewRpcDisabledReason={historyReviewRpcDisabledReason}
                rpcUrl={rpcUrl}
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
