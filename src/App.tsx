import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "./app/AppShell";
import type { WorkspaceTab } from "./app/AppShell";
import { BUILT_IN_CHAINS, validateCustomRpc } from "./core/chains/registry";
import { probeChainId, readAccountState } from "./lib/rpc";
import type { AccountChainState } from "./lib/rpc";
import {
  createAndScanAccount,
  createVault,
  generateMnemonicPhrase,
  loadAppConfig,
  loadAccounts,
  loadTransactionHistory,
  lockVault,
  cancelPendingTransfer,
  rememberValidatedRpc,
  reconcilePendingHistory,
  replacePendingTransfer,
  saveAccountSyncError,
  saveScannedAccount,
  unlockVault,
} from "./lib/tauri";
import type {
  AccountRecord,
  AppConfig,
  HistoryRecord,
  PendingMutationRequest,
  StoredAccountRecord,
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
  const selectedChainIdRef = useRef<bigint>(1n);
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
    try {
      const records = rpcUrl.trim()
        ? await reconcilePendingHistory(rpcUrl.trim(), Number(selectedChainId))
        : await loadTransactionHistory();
      setHistory([...records].reverse());
    } catch (err) {
      setAppError(err instanceof Error ? err.message : String(err));
    }
  }, [rpcUrl, selectedChainId]);

  const refreshHistoryFromDisk = useCallback(async () => {
    const records = await loadTransactionHistory();
    setHistory([...records].reverse());
  }, []);

  const refreshWorkspace = useCallback(async (chainId = selectedChainIdRef.current) => {
    const accountsRequestId = ++diskAccountsRefreshRequestRef.current;
    const remoteRequestId = remoteAccountsRefreshRequestRef.current;
    const remoteWasInFlight = remoteAccountsRefreshInFlightRef.current > 0;
    const [stored, records] = await Promise.all([loadAccounts(), loadTransactionHistory()]);
    if (
      accountsRequestId === diskAccountsRefreshRequestRef.current &&
      remoteRequestId === remoteAccountsRefreshRequestRef.current &&
      !remoteWasInFlight &&
      remoteAccountsRefreshInFlightRef.current === 0 &&
      selectedChainIdRef.current === chainId
    ) {
      setAccounts(stored.map((account) => accountFromStored(account, chainId)));
    }
    setHistory([...records].reverse());
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
    setSessionStatus("ready");
    await restoreWorkspaceAfterUnlock();
  }

  async function handleCreateVault(mnemonic: string, password: string) {
    setAppError(null);
    await createVault(mnemonic, password);
    await unlockVault(password);
    setSessionStatus("ready");
    await restoreWorkspaceAfterUnlock();
  }

  async function handleLock() {
    setBusy(true);
    try {
      await lockVault();
      setSessionStatus("locked");
      setAccounts([]);
      setHistory([]);
      setActiveTab("accounts");
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

  function handleTransferSubmitted(record: HistoryRecord) {
    setHistory((current) => [record, ...current]);
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
      try {
        await refreshHistoryFromDisk();
      } catch {
        // Keep the original mutation error visible.
      }
      setAppError(err instanceof Error ? err.message : String(err));
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
      try {
        await refreshHistoryFromDisk();
      } catch {
        // Keep the original mutation error visible.
      }
      setAppError(err instanceof Error ? err.message : String(err));
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
      onAddAccount={handleAddAccount}
      onChainChange={handleChainChange}
      onCreateVault={handleCreateVault}
      onGenerateMnemonic={generateMnemonicPhrase}
      onLock={handleLock}
      onRefreshAccounts={handleRefreshAccounts}
      onRefreshHistory={refreshHistory}
      onReplacePending={handleReplacePending}
      onRpcUrlChange={(value) => {
        setRpcUrl(value);
        setSettingsStatus({ kind: "idle", message: null });
      }}
      onCancelPending={handleCancelPending}
      onTabChange={setActiveTab}
      onTransferSubmitted={handleTransferSubmitted}
      onUnlock={handleUnlock}
      onValidateRpc={handleValidateRpc}
      rpcUrl={rpcUrl}
      selectedChainId={selectedChainId}
      session={{ status: sessionStatus }}
      settingsStatusKind={settingsStatus.kind}
      settingsStatusMessage={settingsStatus.message}
    />
  );
}
