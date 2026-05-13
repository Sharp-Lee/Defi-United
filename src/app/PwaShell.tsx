import { useEffect, useRef, useState } from "react";
import {
  addWatchedErc20Asset,
  createDefaultBrowserAssetRegistryState,
  EMPTY_ASSET_BALANCE_SNAPSHOT_STATE,
  removeWatchedErc20Asset,
  refreshAssetBalanceSnapshots,
  type AssetBalanceAccount,
  type AssetBalanceRpcClient,
  type AssetBalanceSnapshotState,
  type BrowserAssetRegistryState,
  type BrowserWatchedErc20AssetInput,
} from "../core/assets";
import {
  addBrowserVaultGroup,
  clearBrowserVaultAccountSelection,
  createInitialBrowserVaultState,
  deriveBrowserVaultAccounts,
  getActiveBrowserVaultGroup,
  renameBrowserVaultAccount,
  renameBrowserVaultGroup,
  selectAllBrowserVaultAccounts,
  selectBrowserVaultGroup,
  summarizeBrowserVaultAccountLibrary,
  toggleBrowserVaultAccountSelection,
} from "../core/browserVault/accounts";
import {
  addBrowserChainRecord,
  getActiveBrowserChain,
  selectBrowserChain,
  updateBrowserChainRecord,
  updateBrowserFeeDraft,
  updatePrimaryRpcEndpoint,
  type BrowserChainRecord,
  type BrowserChainConfigState,
} from "../core/browserChainConfig";
import { AccountsModule } from "../features/accounts/AccountsModule";
import { PwaVaultAccessView } from "../features/accounts/PwaVaultAccessView";
import { PwaVaultWorkspace } from "../features/accounts/PwaVaultWorkspace";
import { AssetsModule } from "../features/assets/AssetsModule";
import { PwaAssetWorkspace } from "../features/assets/PwaAssetWorkspace";
import { PwaChainSettingsPanel } from "../features/settings/PwaChainSettingsPanel";
import { SettingsModule } from "../features/settings/SettingsModule";
import {
  loadBrowserAssetRegistryState,
  saveBrowserAssetRegistryState,
  type BrowserAssetRegistryStorage,
} from "../lib/browserAssetRegistry";
import {
  createBrowserVaultSession,
  hasBrowserVault,
  importBrowserVaultEnvelope,
  parseBrowserVaultEnvelope,
  saveBrowserVaultSession,
  serializeBrowserVaultEnvelope,
  unlockBrowserVaultSession,
  type BrowserVaultSession,
  type BrowserVaultStorage,
} from "../lib/browserVault";
import {
  loadBrowserChainConfigState,
  saveBrowserChainConfigState,
  type BrowserChainConfigStorage,
} from "../lib/browserChainConfig";
import { createBrowserJsonRpcClient, sanitizeRpcErrorMessage } from "../services/rpc/browserJsonRpcClient";
import { AppShell } from "./shell/AppShell";
import type { AppModuleId } from "./shell/navigation";
import { getDefaultModuleId } from "./state/appNavigation";
import { summarizeAppSession } from "./state/appSession";

export interface PwaShellProps {
  vaultStorage?: BrowserVaultStorage;
  chainConfigStorage?: BrowserChainConfigStorage;
  assetRegistryStorage?: BrowserAssetRegistryStorage;
  createAssetRpcClient?: (rpcUrl: string) => AssetBalanceRpcClient;
}

function getAssetRefreshRpcEndpoint(chain: BrowserChainRecord | null) {
  if (!chain) return null;
  return chain.rpcEndpoints.find((endpoint) => endpoint.primary && endpoint.enabled) ??
    chain.rpcEndpoints.find((endpoint) => endpoint.enabled) ??
    null;
}

export function PwaShell({
  vaultStorage,
  chainConfigStorage,
  assetRegistryStorage,
  createAssetRpcClient,
}: PwaShellProps = {}) {
  const [activeModuleId, setActiveModuleId] = useState<AppModuleId>(getDefaultModuleId());
  const [session, setSession] = useState<BrowserVaultSession | null>(null);
  const [vaultExists, setVaultExists] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [chainConfig, setChainConfig] = useState<BrowserChainConfigState | null>(null);
  const [chainConfigBusy, setChainConfigBusy] = useState(false);
  const [chainConfigError, setChainConfigError] = useState<string | null>(null);
  const [assetRegistry, setAssetRegistry] = useState<BrowserAssetRegistryState>(
    createDefaultBrowserAssetRegistryState(),
  );
  const [assetRegistryError, setAssetRegistryError] = useState<string | null>(null);
  const [assetRefreshState, setAssetRefreshState] = useState<AssetBalanceSnapshotState>(
    EMPTY_ASSET_BALANCE_SNAPSHOT_STATE,
  );
  const [assetRefreshBusy, setAssetRefreshBusy] = useState(false);
  const assetRefreshRequestId = useRef(0);
  const assetRefreshStateRef = useRef(assetRefreshState);
  const activeGroup = session ? getActiveBrowserVaultGroup(session.state) : null;
  const activeChain = chainConfig ? getActiveBrowserChain(chainConfig) : null;
  const assetRefreshRpc = getAssetRefreshRpcEndpoint(activeChain);
  const selectedAccounts: AssetBalanceAccount[] =
    session?.state.groups
      .flatMap((group) => group.accounts)
      .filter((account) => account.selected)
      .map((account) => ({
        id: account.id,
        address: account.address,
        label: account.label,
      })) ?? [];
  const totalAccountCount = session?.state.groups.reduce((count, group) => count + group.accounts.length, 0) ?? 0;
  const assetRefreshContextKey = [
    session ? "unlocked" : "locked",
    activeChain?.id ?? "no-chain",
    activeChain?.chainId ?? "no-chain-id",
    assetRefreshRpc?.id ?? "no-rpc",
    assetRegistry.updatedAt,
    selectedAccounts.map((account) => `${account.id}:${account.address}`).join("|"),
  ].join("::");

  useEffect(() => {
    let cancelled = false;
    void hasBrowserVault(vaultStorage)
      .then((exists) => {
        if (!cancelled) setVaultExists(exists);
      })
      .catch((err) => {
        if (!cancelled) setVaultError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [vaultStorage]);

  useEffect(() => {
    let cancelled = false;
    setChainConfigBusy(true);
    void loadBrowserChainConfigState(chainConfigStorage)
      .then((state) => {
        if (!cancelled) {
          setChainConfig(state);
          setChainConfigError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setChainConfigError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setChainConfigBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chainConfigStorage]);

  useEffect(() => {
    let cancelled = false;
    void loadBrowserAssetRegistryState(assetRegistryStorage)
      .then((state) => {
        if (!cancelled) {
          setAssetRegistry(state);
          setAssetRegistryError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setAssetRegistryError(sanitizeRpcErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [assetRegistryStorage]);

  useEffect(() => {
    assetRefreshStateRef.current = assetRefreshState;
  }, [assetRefreshState]);

  useEffect(() => {
    assetRefreshRequestId.current += 1;
  }, [assetRefreshContextKey]);

  async function updateSession(nextSessionPromise: Promise<BrowserVaultSession>) {
    setVaultBusy(true);
    setVaultError(null);
    try {
      const nextSession = await nextSessionPromise;
      setSession(nextSession);
      setVaultExists(true);
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : String(err));
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleCreateVault(password: string) {
    await updateSession(createBrowserVaultSession(password, createInitialBrowserVaultState(), vaultStorage));
  }

  async function handleUnlock(password: string) {
    await updateSession(unlockBrowserVaultSession(password, vaultStorage));
  }

  async function handleImportVault(input: { password: string; serializedEnvelope: string; overwriteExisting: boolean }) {
    setVaultBusy(true);
    setVaultError(null);
    try {
      const importedSession = await importBrowserVaultEnvelope(
        parseBrowserVaultEnvelope(input.serializedEnvelope),
        input.password,
        vaultStorage,
        { overwriteExisting: input.overwriteExisting },
      );
      setSession(importedSession);
      setVaultExists(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setVaultError(message);
      throw new Error(message);
    } finally {
      setVaultBusy(false);
    }
  }

  async function persistVaultState(nextState: BrowserVaultSession["state"]) {
    if (!session) return;
    await updateSession(saveBrowserVaultSession(session, nextState, vaultStorage));
  }

  async function persistChainConfig(nextState: BrowserChainConfigState) {
    setChainConfigBusy(true);
    setChainConfigError(null);
    try {
      await saveBrowserChainConfigState(nextState, chainConfigStorage);
    } catch (err) {
      setChainConfigError(err instanceof Error ? err.message : String(err));
    } finally {
      setChainConfigBusy(false);
    }
  }

  function updateChainConfig(mapper: (state: BrowserChainConfigState) => BrowserChainConfigState) {
    if (!chainConfig) return;
    const nextState = mapper(chainConfig);
    setChainConfig(nextState);
    void persistChainConfig(nextState);
  }

  function updateFeeDraft(mapper: (state: BrowserChainConfigState) => BrowserChainConfigState) {
    if (!chainConfig) return;
    setChainConfig(mapper(chainConfig));
  }

  async function persistAssetRegistry(nextState: BrowserAssetRegistryState) {
    setAssetRegistryError(null);
    try {
      await saveBrowserAssetRegistryState(nextState, assetRegistryStorage);
    } catch (err) {
      setAssetRegistryError(sanitizeRpcErrorMessage(err));
    }
  }

  function updateAssetRegistry(mapper: (state: BrowserAssetRegistryState) => BrowserAssetRegistryState) {
    const nextState = mapper(assetRegistry);
    setAssetRegistry(nextState);
    void persistAssetRegistry(nextState);
  }

  function updateAssetRefreshStatus(status: AssetBalanceSnapshotState["status"], stale = true) {
    setAssetRefreshState((previous) => ({
      ...previous,
      status,
      stale: stale && (previous.nativeBalances.length > 0 || previous.erc20Balances.length > 0),
      failures: [],
    }));
  }

  async function handleRefreshAssetBalances() {
    if (!session || !activeChain) {
      updateAssetRefreshStatus("no-selected-accounts");
      return;
    }
    if (!assetRefreshRpc) {
      updateAssetRefreshStatus("no-rpc");
      return;
    }
    const accounts = selectedAccounts;
    if (accounts.length === 0) {
      updateAssetRefreshStatus("no-selected-accounts");
      return;
    }

    const requestId = assetRefreshRequestId.current + 1;
    assetRefreshRequestId.current = requestId;
    setAssetRefreshBusy(true);
    setAssetRefreshState((previous) => ({ ...previous, status: "validating-chain", failures: [] }));

    try {
      const rpcClient = (createAssetRpcClient ?? ((rpcUrl: string) => createBrowserJsonRpcClient(rpcUrl)))(
        assetRefreshRpc.url,
      );
      const nextState = await refreshAssetBalanceSnapshots({
        activeChainId: activeChain.chainId,
        accounts,
        watchedAssets: assetRegistry.watchedErc20Assets,
        rpcClient,
        previous: assetRefreshStateRef.current,
      });
      if (assetRefreshRequestId.current === requestId) {
        setAssetRefreshState(nextState);
      }
    } catch (err) {
      if (assetRefreshRequestId.current === requestId) {
        setAssetRefreshState((previous) => ({
          ...previous,
          status: "failed",
          stale: previous.nativeBalances.length > 0 || previous.erc20Balances.length > 0,
          failures: [{ kind: "chain", message: sanitizeRpcErrorMessage(err) }],
        }));
      }
    } finally {
      if (assetRefreshRequestId.current === requestId) {
        setAssetRefreshBusy(false);
      }
    }
  }

  function handleExportVault() {
    if (!session) return;
    const serialized = serializeBrowserVaultEnvelope(session.envelope);
    const blob = new Blob([serialized], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "defi-united-encrypted-vault.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function renderSettingsSection() {
    return (
      <SettingsModule>
        <PwaChainSettingsPanel
          activeChain={activeChain}
          busy={chainConfigBusy}
          chains={chainConfig?.chains ?? []}
          error={chainConfigError}
          onAddChain={(input) => updateChainConfig((state) => addBrowserChainRecord(state, input))}
          onSelectChain={(chainId) => updateChainConfig((state) => selectBrowserChain(state, chainId))}
          onUpdateChain={(chainId, updates) =>
            updateChainConfig((state) => updateBrowserChainRecord(state, chainId, updates))
          }
          onUpdateFeeDraft={(chainId, updates) =>
            updateFeeDraft((state) => updateBrowserFeeDraft(state, chainId, updates))
          }
          onUpdatePrimaryRpc={(chainId, updates) =>
            updateChainConfig((state) => updatePrimaryRpcEndpoint(state, chainId, updates))
          }
        />
      </SettingsModule>
    );
  }

  function renderAccountsSection() {
    if (!session) {
      return (
        <AccountsModule>
          <PwaVaultAccessView
            busy={vaultBusy}
            error={vaultError}
            hasVault={vaultExists}
            onCreateVault={handleCreateVault}
            onImportVault={handleImportVault}
            onUnlock={handleUnlock}
          />
        </AccountsModule>
      );
    }

    return (
      <AccountsModule>
        <PwaVaultWorkspace
          activeGroup={activeGroup}
          busy={vaultBusy}
          groups={session.state.groups}
          librarySummary={summarizeBrowserVaultAccountLibrary(session.state)}
          onAddGroup={() => void persistVaultState(addBrowserVaultGroup(session.state, `账户组 ${session.state.groups.length + 1}`))}
          onClearAccountSelection={(groupId) =>
            void persistVaultState(clearBrowserVaultAccountSelection(session.state, groupId))
          }
          onDeriveAccounts={(groupId, count) => void persistVaultState(deriveBrowserVaultAccounts(session.state, groupId, count))}
          onExportVault={handleExportVault}
          onLock={() => {
            assetRefreshRequestId.current += 1;
            setAssetRefreshBusy(false);
            setAssetRefreshState(EMPTY_ASSET_BALANCE_SNAPSHOT_STATE);
            setSession(null);
            setVaultError(null);
          }}
          onRenameAccount={(groupId, accountId, label) =>
            void persistVaultState(renameBrowserVaultAccount(session.state, groupId, accountId, label))
          }
          onRenameGroup={(groupId, name) => void persistVaultState(renameBrowserVaultGroup(session.state, groupId, name))}
          onSelectAllAccounts={(groupId) => void persistVaultState(selectAllBrowserVaultAccounts(session.state, groupId))}
          onSelectGroup={(groupId) => void persistVaultState(selectBrowserVaultGroup(session.state, groupId))}
          onToggleAccountSelection={(groupId, accountId) =>
            void persistVaultState(toggleBrowserVaultAccountSelection(session.state, groupId, accountId))
          }
        />
      </AccountsModule>
    );
  }

  function renderAssetsSection() {
    return (
      <AssetsModule>
        <PwaAssetWorkspace
          activeChain={activeChain}
          assetRegistry={assetRegistry}
          busy={assetRefreshBusy}
          error={assetRegistryError}
          onAddWatchedAsset={(input: BrowserWatchedErc20AssetInput) =>
            updateAssetRegistry((state) => addWatchedErc20Asset(state, input))
          }
          onRefreshBalances={handleRefreshAssetBalances}
          onRemoveWatchedAsset={(assetId) =>
            updateAssetRegistry((state) => removeWatchedErc20Asset(state, assetId))
          }
          primaryRpc={assetRefreshRpc}
          refreshState={assetRefreshState}
          selectedAccounts={selectedAccounts}
          totalAccountCount={totalAccountCount}
          unlocked={Boolean(session)}
        />
      </AssetsModule>
    );
  }

  return (
    <AppShell
      accountsContent={renderAccountsSection()}
      activeModuleId={activeModuleId}
      assetsContent={renderAssetsSection()}
      onSelectModule={setActiveModuleId}
      sessionSummary={summarizeAppSession(session, activeChain)}
      settingsContent={renderSettingsSection()}
    />
  );
}
