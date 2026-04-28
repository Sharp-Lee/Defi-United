import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "./app/AppShell";
import type { WorkspaceTab } from "./app/AppShell";
import { BUILT_IN_CHAINS, validateCustomRpc } from "./core/chains/registry";
import { probeChainId, readAccountState } from "./lib/rpc";
import type { AccountChainState } from "./lib/rpc";
import {
  createAndScanAccount,
  createVault,
  dismissHistoryRecoveryIntent,
  inspectTransactionHistoryStorage,
  loadAppConfig,
  loadAccounts,
  loadHistoryRecoveryIntents,
  loadTokenWatchlistState,
  loadTransactionHistory,
  lockVault,
  cancelPendingTransfer,
  quarantineTransactionHistory,
  rememberValidatedRpc,
  recoverBroadcastedHistoryRecord,
  reconcilePendingHistory,
  replacePendingTransfer,
  reviewDroppedHistoryRecord,
  saveAccountSyncError,
  saveScannedAccount,
  addWatchlistToken,
  editWatchlistToken,
  removeWatchlistToken,
  scanErc20Balance,
  scanWatchlistBalances,
  scanWatchlistTokenMetadata,
  unlockVault,
} from "./lib/tauri";
import type {
  AccountRecord,
  AddWatchlistTokenInput,
  AppConfig,
  EditWatchlistTokenInput,
  HistoryRecord,
  HistoryRecoveryIntent,
  HistoryStorageInspection,
  HistoryStorageQuarantineResult,
  PendingMutationRequest,
  StoredAccountRecord,
  TokenWatchlistState,
} from "./lib/tauri";

type AccountViewModel = AccountRecord & AccountChainState;
type SettingsStatus = { kind: "idle" | "ok" | "error"; message: string | null };

function accountIdentity(account: Pick<AccountRecord, "index" | "address">) {
  return `${account.index}:${account.address.toLowerCase()}`;
}

export function mergeRefreshedAccounts<T extends Pick<AccountRecord, "index" | "address">>(
  current: T[],
  refreshed: T[],
) {
  const refreshedByIdentity = new Map(
    refreshed.map((account) => [accountIdentity(account), account] as const),
  );

  return current.map((account) => refreshedByIdentity.get(accountIdentity(account)) ?? account);
}

export function isAccountsRefreshCurrent(
  requestId: number,
  refreshChainId: bigint,
  latestRequestId: number,
  selectedChainId: bigint,
) {
  return requestId === latestRequestId && selectedChainId === refreshChainId;
}

export function canStartAccountsRefresh(inFlightCount: number) {
  return inFlightCount === 0;
}

export function isTokenOperationCurrent(
  operationGeneration: number,
  currentGeneration: number,
  sessionStatus: "locked" | "ready",
) {
  return sessionStatus === "ready" && operationGeneration === currentGeneration;
}

export function nextTokenOperationGeneration(currentGeneration: number) {
  return currentGeneration + 1;
}

export async function ensureRpcChainMatchesSelectedChain(
  rpcUrl: string,
  expectedChainId: bigint,
  probe: (rpcUrl: string) => Promise<bigint>,
) {
  const remoteChainId = await probe(rpcUrl);
  if (remoteChainId !== expectedChainId) {
    throw new Error(
      `RPC returned chainId ${remoteChainId.toString()}; expected ${expectedChainId.toString()}.`,
    );
  }
  return remoteChainId;
}

function accountFromStored(account: StoredAccountRecord, chainId: bigint): AccountViewModel {
  const snapshot = account.snapshots.find(
    (item) =>
      BigInt(item.chainId) === chainId &&
      (!item.accountAddress || item.accountAddress === account.address),
  );
  return {
    index: account.index,
    address: account.address,
    label: account.label,
    accountAddress: snapshot?.accountAddress ?? null,
    nativeBalanceWei: snapshot ? BigInt(snapshot.nativeBalanceWei) : null,
    nonce: snapshot?.nonce ?? null,
    lastSyncedAt: snapshot?.lastSyncedAt ?? null,
    lastSyncError: snapshot?.lastSyncError ?? null,
  };
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function localSyncErrorMessage(err: unknown) {
  return errorMessage(err).replace(/https?:\/\/\S+/g, "[redacted RPC URL]");
}

export function App() {
  const [sessionStatus, setSessionStatus] = useState<"locked" | "ready">("locked");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("accounts");
  const [selectedChainId, setSelectedChainId] = useState<bigint>(1n);
  const [rpcUrl, setRpcUrl] = useState("");
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus>({
    kind: "idle",
    message: null,
  });
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [accounts, setAccounts] = useState<AccountViewModel[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyStorage, setHistoryStorage] = useState<HistoryStorageInspection | null>(null);
  const [tokenWatchlistState, setTokenWatchlistState] =
    useState<TokenWatchlistState | null>(null);
  const [tokenWatchlistError, setTokenWatchlistError] = useState<string | null>(null);
  const [lastHistoryQuarantine, setLastHistoryQuarantine] =
    useState<HistoryStorageQuarantineResult | null>(null);
  const [historyRecoveryIntents, setHistoryRecoveryIntents] = useState<HistoryRecoveryIntent[]>([]);
  const selectedChainIdRef = useRef<bigint>(1n);
  const sessionStatusRef = useRef<"locked" | "ready">("locked");
  const tokenOperationGenerationRef = useRef(0);
  const diskAccountsRefreshRequestRef = useRef(0);
  const allowedDiskAccountsRefreshRequestRef = useRef(0);
  const remoteAccountsRefreshRequestRef = useRef(0);
  const remoteAccountsRefreshInFlightRef = useRef(0);

  const availableChains = useMemo(() => {
    const customChains =
      appConfig?.rpcEndpoints
        .filter(
          (endpoint) =>
            !BUILT_IN_CHAINS.some((chain) => chain.chainId === BigInt(endpoint.chainId)),
        )
        .map((endpoint) => ({
          id: `custom-${endpoint.chainId}`,
          name: endpoint.name || `Chain ${endpoint.chainId}`,
          chainId: BigInt(endpoint.chainId),
          nativeSymbol: endpoint.nativeSymbol || "ETH",
          rpcUrl: endpoint.rpcUrl,
        })) ?? [];
    return [...BUILT_IN_CHAINS, ...customChains];
  }, [appConfig]);

  const selectedChain = useMemo(
    () => availableChains.find((chain) => chain.chainId === selectedChainId) ?? availableChains[0],
    [availableChains, selectedChainId],
  );

  function updateSelectedChainId(chainId: bigint) {
    selectedChainIdRef.current = chainId;
    setSelectedChainId(chainId);
  }

  function applyAppConfig(config: AppConfig) {
    setAppConfig(config);
    const defaultChainId = BigInt(config.defaultChainId);
    const defaultEndpoint = config.rpcEndpoints.find(
      (endpoint) => endpoint.chainId === config.defaultChainId,
    );

    updateSelectedChainId(defaultChainId);
    setRpcUrl(defaultEndpoint?.rpcUrl ?? "");
    setSettingsStatus(
      defaultEndpoint
        ? {
            kind: "ok",
            message: `Restored validated RPC for chainId ${config.defaultChainId}.`,
          }
        : { kind: "idle", message: null },
    );

    return defaultChainId;
  }

  const refreshAccountsFromDisk = useCallback(
    async (
      chainId = selectedChainIdRef.current,
      options: { allowDuringRemote?: boolean } = {},
    ) => {
      const allowDuringRemote = options.allowDuringRemote === true;
      const requestId = allowDuringRemote
        ? ++allowedDiskAccountsRefreshRequestRef.current
        : ++diskAccountsRefreshRequestRef.current;
      const remoteRequestId = remoteAccountsRefreshRequestRef.current;
      const remoteWasInFlight = remoteAccountsRefreshInFlightRef.current > 0;
      const stored = await loadAccounts();
      if (
        (allowDuringRemote
          ? requestId !== allowedDiskAccountsRefreshRequestRef.current
          : requestId !== diskAccountsRefreshRequestRef.current) ||
        selectedChainIdRef.current !== chainId ||
        (!allowDuringRemote &&
          (remoteRequestId !== remoteAccountsRefreshRequestRef.current ||
            remoteWasInFlight ||
            remoteAccountsRefreshInFlightRef.current > 0))
      ) {
        return;
      }
      setAccounts(stored.map((account) => accountFromStored(account, chainId)));
    },
    [],
  );

  const refreshHistory = useCallback(async () => {
    setAppError(null);
    setHistoryError(null);
    setLastHistoryQuarantine(null);
    try {
      const records = rpcUrl.trim()
        ? await reconcilePendingHistory(rpcUrl.trim(), Number(selectedChainId))
        : await loadTransactionHistory();
      setHistory([...records].reverse());
      setHistoryStorage(await inspectTransactionHistoryStorage());
      setHistoryRecoveryIntents(await loadHistoryRecoveryIntents());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAppError(message);
      setHistoryError(message);
      try {
        setHistoryStorage(await inspectTransactionHistoryStorage());
      } catch {
        // Keep the original history error visible.
      }
    }
  }, [rpcUrl, selectedChainId]);

  const refreshHistoryFromDisk = useCallback(async () => {
    const records = await loadTransactionHistory();
    setHistory([...records].reverse());
    setHistoryStorage(await inspectTransactionHistoryStorage());
    setHistoryRecoveryIntents(await loadHistoryRecoveryIntents());
  }, []);

  const inspectHistoryStorageGate = useCallback(async (fallbackMessage?: string | null) => {
    try {
      const storage = await inspectTransactionHistoryStorage();
      setHistoryStorage(storage);
      if (storage.status === "corrupted") {
        setLastHistoryQuarantine(null);
        setHistoryError(
          fallbackMessage ??
            storage.errorSummary ??
            "transaction history storage is unreadable",
        );
      }
      return storage;
    } catch {
      return null;
    }
  }, []);

  const refreshWorkspace = useCallback(async (chainId = selectedChainIdRef.current) => {
    const accountsRequestId = ++diskAccountsRefreshRequestRef.current;
    const remoteRequestId = remoteAccountsRefreshRequestRef.current;
    const remoteWasInFlight = remoteAccountsRefreshInFlightRef.current > 0;
    const tokenGeneration = tokenOperationGenerationRef.current;
    const [stored, tokenResult, historyResult] = await Promise.all([
      loadAccounts(),
      loadTokenWatchlistState()
        .then((state) => ({ state, error: null as string | null }))
        .catch((err) => ({ state: null as TokenWatchlistState | null, error: errorMessage(err) })),
      loadTransactionHistory()
        .then((records) => ({ records, error: null as string | null }))
        .catch((err) => ({ records: [] as HistoryRecord[], error: errorMessage(err) })),
    ]);
    if (
      accountsRequestId === diskAccountsRefreshRequestRef.current &&
      remoteRequestId === remoteAccountsRefreshRequestRef.current &&
      !remoteWasInFlight &&
      remoteAccountsRefreshInFlightRef.current === 0 &&
      selectedChainIdRef.current === chainId
    ) {
      setAccounts(stored.map((account) => accountFromStored(account, chainId)));
    }
    if (isTokenOperationCurrent(
      tokenGeneration,
      tokenOperationGenerationRef.current,
      sessionStatusRef.current,
    )) {
      setTokenWatchlistState(tokenResult.state);
      setTokenWatchlistError(tokenResult.error);
    }
    setHistory([...historyResult.records].reverse());
    setHistoryError(historyResult.error);
    try {
      setHistoryRecoveryIntents(await loadHistoryRecoveryIntents());
    } catch {
      // Recovery intents are supplementary; history read errors remain the main workspace signal.
    }
    if (historyResult.error) {
      setAppError(historyResult.error);
    }
    try {
      setHistoryStorage(await inspectTransactionHistoryStorage());
    } catch {
      // Workspace restore still shows the load error; storage inspect can be retried from History.
    }
  }, []);

  async function restoreWorkspaceAfterUnlock() {
    try {
      const config = await loadAppConfig();
      const restoredChainId = applyAppConfig(config);
      await refreshWorkspace(restoredChainId);
    } catch (err) {
      setAppError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleUnlock(password: string) {
    setAppError(null);
    await unlockVault(password);
    tokenOperationGenerationRef.current += 1;
    sessionStatusRef.current = "ready";
    setSessionStatus("ready");
    await restoreWorkspaceAfterUnlock();
  }

  async function handleCreateVault(password: string) {
    setAppError(null);
    await createVault(password);
    await unlockVault(password);
    tokenOperationGenerationRef.current += 1;
    sessionStatusRef.current = "ready";
    setSessionStatus("ready");
    await restoreWorkspaceAfterUnlock();
  }

  async function handleLock() {
    setBusy(true);
    const previousSessionStatus = sessionStatusRef.current;
    tokenOperationGenerationRef.current += 1;
    sessionStatusRef.current = "locked";
    try {
      await lockVault();
      setSessionStatus("locked");
      setAccounts([]);
      setHistory([]);
      setTokenWatchlistState(null);
      setTokenWatchlistError(null);
      setHistoryRecoveryIntents([]);
      setActiveTab("accounts");
    } catch (err) {
      sessionStatusRef.current = previousSessionStatus;
      setAppError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleChainChange(chainId: bigint) {
    updateSelectedChainId(chainId);
    const endpoint = appConfig?.rpcEndpoints.find((item) => item.chainId === Number(chainId));
    setRpcUrl(endpoint?.rpcUrl ?? "");
    setSettingsStatus(
      endpoint
        ? {
            kind: "ok",
            message: `Restored validated RPC for chainId ${endpoint.chainId}.`,
          }
        : { kind: "idle", message: null },
    );
    void refreshAccountsFromDisk(chainId, { allowDuringRemote: true });
  }

  async function handleValidateRpc() {
    setAppError(null);
    setBusy(true);
    try {
      const validated = await validateCustomRpc(
        { ...selectedChain, rpcUrl: rpcUrl.trim() },
        probeChainId,
      );
      const config = await rememberValidatedRpc({
        chainId: Number(validated.chainId),
        name: validated.name,
        nativeSymbol: validated.nativeSymbol,
        rpcUrl: validated.rpcUrl,
      });
      setAppConfig(config);
      updateSelectedChainId(validated.chainId);
      void refreshAccountsFromDisk(validated.chainId, { allowDuringRemote: true });
      setSettingsStatus({
        kind: "ok",
        message: `Connected and saved chainId ${validated.chainId.toString()}.`,
      });
    } catch (err) {
      setSettingsStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleAddAccount() {
    setAppError(null);
    if (settingsStatus.kind !== "ok") {
      setAppError("Validate the RPC before adding an account.");
      return;
    }
    setBusy(true);
    try {
      const accountRpcUrl = rpcUrl.trim();
      const accountChainId = selectedChainId;
      await ensureRpcChainMatchesSelectedChain(accountRpcUrl, accountChainId, probeChainId);
      const nextIndex = accounts.reduce((max, account) => Math.max(max, account.index), 0) + 1;
      const account = await createAndScanAccount(
        nextIndex,
        Number(accountChainId),
        accountRpcUrl,
      );
      setAccounts((current) => [...current, account]);
    } catch (err) {
      setAppError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshAccounts() {
    setAppError(null);
    const refreshRpcUrl = rpcUrl.trim();
    const refreshChainId = selectedChainId;
    if (!refreshRpcUrl) {
      setAppError("RPC URL is required.");
      return;
    }
    if (!canStartAccountsRefresh(remoteAccountsRefreshInFlightRef.current)) {
      setAppError("Account refresh is already in progress.");
      return;
    }
    setBusy(true);
    let requestId: number | null = null;
    try {
      requestId = ++remoteAccountsRefreshRequestRef.current;
      remoteAccountsRefreshInFlightRef.current += 1;
      const isCurrentRefresh = () =>
        isAccountsRefreshCurrent(
          requestId ?? -1,
          refreshChainId,
          remoteAccountsRefreshRequestRef.current,
          selectedChainIdRef.current,
        );
      await ensureRpcChainMatchesSelectedChain(refreshRpcUrl, refreshChainId, probeChainId);
      const remoteOutcomes = await Promise.all(
        accounts.map(async (account) => {
          try {
            const snapshot = await readAccountState(refreshRpcUrl, account.address);
            return {
              account,
              snapshot,
              error: null,
            };
          } catch (err) {
            const message = localSyncErrorMessage(err);
            return {
              account,
              snapshot: null,
              error: message,
            };
          }
        }),
      );
      if (!isCurrentRefresh()) {
        return;
      }
      const outcomes = await Promise.all(
        remoteOutcomes.map(async (outcome) => {
          if (!isCurrentRefresh()) {
            return {
              account: outcome.account,
              error: null,
            };
          }
          if (outcome.snapshot) {
            const stored = await saveScannedAccount(
              outcome.account.index,
              Number(refreshChainId),
              outcome.snapshot.nativeBalanceWei ?? 0n,
              outcome.snapshot.nonce ?? 0,
            );
            return {
              account: accountFromStored(stored, refreshChainId),
              error: null,
            };
          }

          const message = outcome.error ?? "Unknown sync error";
          try {
            const stored = await saveAccountSyncError(
              outcome.account.index,
              Number(refreshChainId),
              message,
            );
            return {
              account: accountFromStored(stored, refreshChainId),
              error: `${outcome.account.label}: ${message}`,
            };
          } catch (saveErr) {
            return {
              account: outcome.account,
              error: `${outcome.account.label}: ${message}; failed to persist sync error (${errorMessage(
                saveErr,
              )})`,
            };
          }
        }),
      );
      if (!isCurrentRefresh()) {
        return;
      }
      setAccounts((current) =>
        mergeRefreshedAccounts(
          current,
          outcomes.map((outcome) => outcome.account),
        ),
      );
      const errors = outcomes
        .map((outcome) => outcome.error)
        .filter((message): message is string => message !== null);
      if (errors.length > 0) {
        setAppError(`Refresh completed with ${errors.length} error(s): ${errors.join("; ")}`);
      }
    } catch (err) {
      if (
        requestId === remoteAccountsRefreshRequestRef.current &&
        selectedChainIdRef.current === refreshChainId
      ) {
        setAppError(errorMessage(err));
      }
    } finally {
      remoteAccountsRefreshInFlightRef.current = Math.max(
        0,
        remoteAccountsRefreshInFlightRef.current - 1,
      );
      setBusy(false);
    }
  }

  function requireTokenRpc(chainId: number) {
    const tokenRpcUrl = rpcUrl.trim();
    if (!tokenRpcUrl || settingsStatus.kind !== "ok") {
      throw new Error("Validate an RPC before scanning token metadata or balances.");
    }
    if (chainId !== Number(selectedChainIdRef.current)) {
      throw new Error(
        `Switch to chainId ${chainId} and validate its RPC before scanning this token.`,
      );
    }
    return tokenRpcUrl;
  }

  function isCurrentTokenOperation(operationGeneration: number) {
    return isTokenOperationCurrent(
      operationGeneration,
      tokenOperationGenerationRef.current,
      sessionStatusRef.current,
    );
  }

  function beginTokenOperation() {
    const operationGeneration = nextTokenOperationGeneration(tokenOperationGenerationRef.current);
    tokenOperationGenerationRef.current = operationGeneration;
    setTokenWatchlistError(null);
    setBusy(true);
    return operationGeneration;
  }

  async function handleAddWatchlistToken(
    input: AddWatchlistTokenInput,
    rpcProfileId?: string | null,
  ) {
    const operationGeneration = beginTokenOperation();
    let addSucceeded = false;
    try {
      const state = await addWatchlistToken(input);
      addSucceeded = true;
      if (!isCurrentTokenOperation(operationGeneration)) return false;
      setTokenWatchlistState(state);
      if (
        input.chainId === Number(selectedChainIdRef.current) &&
        rpcUrl.trim() &&
        settingsStatus.kind === "ok"
      ) {
        const scanRpcProfileId = rpcProfileId?.trim() || `chain-${input.chainId}`;
        const scannedState = await scanWatchlistTokenMetadata({
          rpcUrl: rpcUrl.trim(),
          chainId: input.chainId,
          tokenContract: input.tokenContract,
          rpcProfileId: scanRpcProfileId,
        });
        if (!isCurrentTokenOperation(operationGeneration)) return false;
        setTokenWatchlistState(scannedState);
      } else if (input.chainId === Number(selectedChainIdRef.current)) {
        if (isCurrentTokenOperation(operationGeneration)) {
          setTokenWatchlistError("Added token. Validate an RPC to scan metadata.");
        }
      }
      return true;
    } catch (err) {
      const message = errorMessage(err);
      if (isCurrentTokenOperation(operationGeneration)) {
        setTokenWatchlistError(message);
      }
      return addSucceeded;
    } finally {
      if (isCurrentTokenOperation(operationGeneration)) {
        setBusy(false);
      }
    }
  }

  async function handleEditWatchlistToken(input: EditWatchlistTokenInput) {
    const operationGeneration = beginTokenOperation();
    try {
      const state = await editWatchlistToken(input);
      if (!isCurrentTokenOperation(operationGeneration)) return false;
      setTokenWatchlistState(state);
      return true;
    } catch (err) {
      const message = errorMessage(err);
      if (isCurrentTokenOperation(operationGeneration)) {
        setTokenWatchlistError(message);
      }
      return false;
    } finally {
      if (isCurrentTokenOperation(operationGeneration)) {
        setBusy(false);
      }
    }
  }

  async function handleRemoveWatchlistToken(chainId: number, tokenContract: string) {
    const operationGeneration = beginTokenOperation();
    try {
      const state = await removeWatchlistToken({
        chainId,
        tokenContract,
        clearMetadataCache: false,
        clearScanState: false,
        clearSnapshots: false,
      });
      if (!isCurrentTokenOperation(operationGeneration)) return false;
      setTokenWatchlistState(state);
      return true;
    } catch (err) {
      const message = errorMessage(err);
      if (isCurrentTokenOperation(operationGeneration)) {
        setTokenWatchlistError(message);
      }
      return false;
    } finally {
      if (isCurrentTokenOperation(operationGeneration)) {
        setBusy(false);
      }
    }
  }

  async function handleScanWatchlistTokenMetadata(chainId: number, tokenContract: string) {
    const operationGeneration = beginTokenOperation();
    try {
      const tokenRpcUrl = requireTokenRpc(chainId);
      const state = await scanWatchlistTokenMetadata({
        rpcUrl: tokenRpcUrl,
        chainId,
        tokenContract,
        rpcProfileId: `chain-${chainId}`,
      });
      if (!isCurrentTokenOperation(operationGeneration)) return false;
      setTokenWatchlistState(state);
      return true;
    } catch (err) {
      const message = errorMessage(err);
      if (isCurrentTokenOperation(operationGeneration)) {
        setTokenWatchlistError(message);
      }
      return false;
    } finally {
      if (isCurrentTokenOperation(operationGeneration)) {
        setBusy(false);
      }
    }
  }

  async function handleScanErc20Balance(
    account: string,
    chainId: number,
    tokenContract: string,
  ) {
    const operationGeneration = beginTokenOperation();
    try {
      const tokenRpcUrl = requireTokenRpc(chainId);
      const state = await scanErc20Balance({
        rpcUrl: tokenRpcUrl,
        chainId,
        account,
        tokenContract,
        rpcProfileId: `chain-${chainId}`,
      });
      if (!isCurrentTokenOperation(operationGeneration)) return false;
      setTokenWatchlistState(state);
      return true;
    } catch (err) {
      const message = errorMessage(err);
      if (isCurrentTokenOperation(operationGeneration)) {
        setTokenWatchlistError(message);
      }
      return false;
    } finally {
      if (isCurrentTokenOperation(operationGeneration)) {
        setBusy(false);
      }
    }
  }

  async function handleScanWatchlistBalances(account: string, retryFailedOnly = false) {
    const operationGeneration = beginTokenOperation();
    try {
      const chainId = Number(selectedChainIdRef.current);
      const tokenRpcUrl = requireTokenRpc(chainId);
      const state = await scanWatchlistBalances({
        rpcUrl: tokenRpcUrl,
        chainId,
        accounts: [account],
        retryFailedOnly,
        rpcProfileId: `chain-${chainId}`,
      });
      if (!isCurrentTokenOperation(operationGeneration)) return false;
      setTokenWatchlistState(state);
      return true;
    } catch (err) {
      const message = errorMessage(err);
      if (isCurrentTokenOperation(operationGeneration)) {
        setTokenWatchlistError(message);
      }
      return false;
    } finally {
      if (isCurrentTokenOperation(operationGeneration)) {
        setBusy(false);
      }
    }
  }

  function handleTransferSubmitted(record: HistoryRecord) {
    setHistory((current) => [record, ...current]);
    void inspectTransactionHistoryStorage()
      .then(setHistoryStorage)
      .catch(() => {});
    void refreshAccountsFromDisk();
  }

  function handleNativeBatchSubmitted(records: HistoryRecord[]) {
    if (records.length > 0) {
      setHistory((current) => [...records].reverse().concat(current));
    }
    void inspectTransactionHistoryStorage()
      .then(setHistoryStorage)
      .catch(() => {});
    void loadHistoryRecoveryIntents()
      .then(setHistoryRecoveryIntents)
      .catch(() => {});
    void refreshAccountsFromDisk();
  }

  async function handleReplacePending(request: PendingMutationRequest) {
    setAppError(null);
    setBusy(true);
    try {
      await replacePendingTransfer(request);
      await refreshHistoryFromDisk();
      void refreshAccountsFromDisk();
    } catch (err) {
      const message = errorMessage(err);
      try {
        await refreshHistoryFromDisk();
      } catch (refreshErr) {
        const refreshMessage = errorMessage(refreshErr);
        setHistoryError(refreshMessage);
        await inspectHistoryStorageGate(refreshMessage);
      }
      await inspectHistoryStorageGate(message);
      setAppError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelPending(request: PendingMutationRequest) {
    setAppError(null);
    setBusy(true);
    try {
      await cancelPendingTransfer(request);
      await refreshHistoryFromDisk();
      void refreshAccountsFromDisk();
    } catch (err) {
      const message = errorMessage(err);
      try {
        await refreshHistoryFromDisk();
      } catch (refreshErr) {
        const refreshMessage = errorMessage(refreshErr);
        setHistoryError(refreshMessage);
        await inspectHistoryStorageGate(refreshMessage);
      }
      await inspectHistoryStorageGate(message);
      setAppError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReviewDropped(txHash: string) {
    setAppError(null);
    setHistoryError(null);
    const reviewRpcUrl = rpcUrl.trim();
    if (!reviewRpcUrl) {
      setAppError("Validate an RPC before reviewing a dropped transaction.");
      return;
    }
    setBusy(true);
    try {
      const records = await reviewDroppedHistoryRecord(
        txHash,
        reviewRpcUrl,
        Number(selectedChainId),
      );
      setHistory([...records].reverse());
      setHistoryStorage(await inspectTransactionHistoryStorage());
      void refreshAccountsFromDisk();
    } catch (err) {
      const message = errorMessage(err);
      setAppError(message);
      setHistoryError(message);
      try {
        await refreshHistoryFromDisk();
      } catch {
        // Keep the review error visible.
      }
      await inspectHistoryStorageGate(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleTransferSubmitFailed(err: unknown) {
    await inspectHistoryStorageGate(errorMessage(err));
    try {
      setHistoryRecoveryIntents(await loadHistoryRecoveryIntents());
    } catch {
      // Keep the original submit error visible.
    }
  }

  async function handleQuarantineHistory() {
    setAppError(null);
    setHistoryError(null);
    setBusy(true);
    try {
      const result = await quarantineTransactionHistory();
      setLastHistoryQuarantine(result);
      setHistoryStorage(result.current);
      setHistory([]);
      setHistoryRecoveryIntents(await loadHistoryRecoveryIntents());
      void refreshAccountsFromDisk();
    } catch (err) {
      const message = errorMessage(err);
      setAppError(message);
      setHistoryError(message);
      try {
        setHistoryStorage(await inspectTransactionHistoryStorage());
      } catch {
        // Keep the quarantine error visible.
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRecoverBroadcastedHistory(recoveryId: string) {
    setAppError(null);
    setHistoryError(null);
    const recoveryRpcUrl = rpcUrl.trim();
    if (!recoveryRpcUrl) {
      setAppError("Validate an RPC before recovering a broadcasted transaction.");
      return;
    }
    setBusy(true);
    try {
      const result = await recoverBroadcastedHistoryRecord(
        recoveryId,
        recoveryRpcUrl,
        Number(selectedChainId),
      );
      setHistory([...result.history].reverse());
      setHistoryRecoveryIntents(await loadHistoryRecoveryIntents());
      setHistoryStorage(await inspectTransactionHistoryStorage());
      void refreshAccountsFromDisk();
    } catch (err) {
      const message = errorMessage(err);
      setAppError(message);
      setHistoryError(message);
      try {
        setHistoryRecoveryIntents(await loadHistoryRecoveryIntents());
        setHistoryStorage(await inspectTransactionHistoryStorage());
      } catch {
        // Keep the recovery error visible.
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDismissHistoryRecovery(recoveryId: string) {
    setAppError(null);
    setBusy(true);
    try {
      setHistoryRecoveryIntents(await dismissHistoryRecoveryIntent(recoveryId));
    } catch (err) {
      setAppError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void loadAppConfig()
      .then((config) => {
        if (!cancelled) applyAppConfig(config);
      })
      .catch((err) => {
        if (!cancelled) setAppError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const hasPendingOnCurrentChain = history.some(
      (record) =>
        record.intent.chain_id === Number(selectedChainId) && record.outcome.state === "Pending",
    );
    if (sessionStatus !== "ready" || !rpcUrl.trim() || !hasPendingOnCurrentChain) return;

    const interval = window.setInterval(() => {
      void reconcilePendingHistory(rpcUrl.trim(), Number(selectedChainId))
        .then((records) => setHistory([...records].reverse()))
        .catch(() => {
          // Keep background reconciliation quiet; manual Refresh shows errors.
        });
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [history, rpcUrl, selectedChainId, sessionStatus]);

  return (
    <AppShell
      activeTab={activeTab}
      accounts={accounts}
      appError={appError}
      busy={busy}
      chains={availableChains}
      history={history}
      historyError={historyError}
      historyRecoveryIntents={historyRecoveryIntents}
      historyRecoveryRpcDisabledReason={
        rpcUrl.trim() ? null : "Validate an RPC before recovering a broadcasted transaction."
      }
      historyReviewRpcDisabledReason={
        rpcUrl.trim() ? null : "Validate an RPC before reviewing a dropped transaction."
      }
      historyStorage={historyStorage}
      lastHistoryQuarantine={lastHistoryQuarantine}
      onAddAccount={handleAddAccount}
      onAddWatchlistToken={handleAddWatchlistToken}
      onEditWatchlistToken={handleEditWatchlistToken}
      onRemoveWatchlistToken={handleRemoveWatchlistToken}
      onScanErc20Balance={handleScanErc20Balance}
      onScanWatchlistBalances={handleScanWatchlistBalances}
      onScanWatchlistTokenMetadata={handleScanWatchlistTokenMetadata}
      onChainChange={handleChainChange}
      onCreateVault={handleCreateVault}
      onLock={handleLock}
      onRefreshAccounts={handleRefreshAccounts}
      onRefreshHistory={refreshHistory}
      onQuarantineHistory={handleQuarantineHistory}
      onRecoverBroadcastedHistory={handleRecoverBroadcastedHistory}
      onDismissHistoryRecovery={handleDismissHistoryRecovery}
      onReviewDropped={handleReviewDropped}
      onReplacePending={handleReplacePending}
      onRpcUrlChange={(value) => {
        setRpcUrl(value);
        setSettingsStatus({ kind: "idle", message: null });
      }}
      onCancelPending={handleCancelPending}
      onNativeBatchSubmitFailed={handleTransferSubmitFailed}
      onNativeBatchSubmitted={handleNativeBatchSubmitted}
      onTabChange={setActiveTab}
      onTransferSubmitFailed={handleTransferSubmitFailed}
      onTransferSubmitted={handleTransferSubmitted}
      onUnlock={handleUnlock}
      onValidateRpc={handleValidateRpc}
      rpcUrl={rpcUrl}
      selectedChainId={selectedChainId}
      session={{ status: sessionStatus }}
      settingsStatusKind={settingsStatus.kind}
      settingsStatusMessage={settingsStatus.message}
      tokenWatchlistError={tokenWatchlistError}
      tokenWatchlistState={tokenWatchlistState}
    />
  );
}
