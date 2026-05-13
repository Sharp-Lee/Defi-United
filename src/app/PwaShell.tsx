import { useEffect, useState } from "react";
import {
  addBrowserVaultGroup,
  createInitialBrowserVaultState,
  deriveBrowserVaultAccounts,
  getActiveBrowserVaultGroup,
  renameBrowserVaultAccount,
  renameBrowserVaultGroup,
  selectBrowserVaultAccount,
  selectBrowserVaultGroup,
} from "../core/browserVault/accounts";
import {
  addBrowserChainRecord,
  getActiveBrowserChain,
  selectBrowserChain,
  updateBrowserChainRecord,
  updateBrowserFeeDraft,
  updatePrimaryRpcEndpoint,
  type BrowserChainConfigState,
} from "../core/browserChainConfig";
import { PwaVaultAccessView } from "../features/pwaVault/PwaVaultAccessView";
import { PwaVaultWorkspace } from "../features/pwaVault/PwaVaultWorkspace";
import { PwaChainSettingsPanel } from "../features/pwaSettings/PwaChainSettingsPanel";
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
import { AppShell } from "./shell/AppShell";
import type { AppModuleId } from "./shell/navigation";
import { getDefaultModuleId } from "./state/appNavigation";
import { summarizeAppSession } from "./state/appSession";

export interface PwaShellProps {
  vaultStorage?: BrowserVaultStorage;
  chainConfigStorage?: BrowserChainConfigStorage;
}

export function PwaShell({ vaultStorage, chainConfigStorage }: PwaShellProps = {}) {
  const [activeModuleId, setActiveModuleId] = useState<AppModuleId>(getDefaultModuleId());
  const [session, setSession] = useState<BrowserVaultSession | null>(null);
  const [vaultExists, setVaultExists] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [chainConfig, setChainConfig] = useState<BrowserChainConfigState | null>(null);
  const [chainConfigBusy, setChainConfigBusy] = useState(false);
  const [chainConfigError, setChainConfigError] = useState<string | null>(null);
  const activeGroup = session ? getActiveBrowserVaultGroup(session.state) : null;
  const activeChain = chainConfig ? getActiveBrowserChain(chainConfig) : null;

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
    );
  }

  function renderAccountsSection() {
    if (!session) {
      return (
        <PwaVaultAccessView
          busy={vaultBusy}
          error={vaultError}
          hasVault={vaultExists}
          onCreateVault={handleCreateVault}
          onImportVault={handleImportVault}
          onUnlock={handleUnlock}
        />
      );
    }

    return (
      <PwaVaultWorkspace
        activeGroup={activeGroup}
        busy={vaultBusy}
        groups={session.state.groups}
        onAddGroup={() => void persistVaultState(addBrowserVaultGroup(session.state, `账户组 ${session.state.groups.length + 1}`))}
        onDeriveAccounts={(groupId, count) => void persistVaultState(deriveBrowserVaultAccounts(session.state, groupId, count))}
        onExportVault={handleExportVault}
        onLock={() => {
          setSession(null);
          setVaultError(null);
        }}
        onRenameAccount={(groupId, accountId, label) =>
          void persistVaultState(renameBrowserVaultAccount(session.state, groupId, accountId, label))
        }
        onRenameGroup={(groupId, name) => void persistVaultState(renameBrowserVaultGroup(session.state, groupId, name))}
        onSelectAccount={(groupId, accountId) =>
          void persistVaultState(selectBrowserVaultAccount(session.state, groupId, accountId))
        }
        onSelectGroup={(groupId) => void persistVaultState(selectBrowserVaultGroup(session.state, groupId))}
      />
    );
  }

  return (
    <AppShell
      accountsContent={renderAccountsSection()}
      activeModuleId={activeModuleId}
      onSelectModule={setActiveModuleId}
      sessionSummary={summarizeAppSession(session, activeChain)}
      settingsContent={renderSettingsSection()}
    />
  );
}
