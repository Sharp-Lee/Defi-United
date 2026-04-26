import { useEffect, useMemo, useReducer, useRef, useCallback } from "react";
import { JsonRpcProvider, HDNodeWallet } from "ethers";
import { AppContext, initialState, reducer } from "./state/store";
import type { AppContextValue } from "./state/store";
import { hasVault } from "./state/vault";
import { deriveAccount, deriveRoot } from "./wallet/hd";
import { makeProvider, probeNetwork } from "./wallet/provider";
import { checkDisperseContract } from "./wallet/actions";
import { SetupScreen } from "./components/SetupScreen";
import { UnlockScreen } from "./components/UnlockScreen";
import { Dashboard } from "./components/Dashboard";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Mount: decide initial phase
  useEffect(() => {
    dispatch({ type: "SET_PHASE", phase: hasVault() ? "unlock" : "setup" });
  }, []);

  // Cache provider + derived wallets across renders
  const providerRef = useRef<JsonRpcProvider | null>(null);
  const providerUrlRef = useRef<string | null>(null);

  const getProvider = useCallback((): JsonRpcProvider | null => {
    if (!state.vault) return null;
    const url = state.vault.rpcUrl;
    if (!url) return null;
    if (providerUrlRef.current !== url) {
      try {
        providerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      providerRef.current = makeProvider(url);
      providerUrlRef.current = url;
    }
    return providerRef.current;
  }, [state.vault]);

  const rootRef = useRef<HDNodeWallet | null>(null);
  const childCacheRef = useRef<Map<number, HDNodeWallet>>(new Map());
  const lastMnemonicRef = useRef<string | null>(null);

  const ensureWalletsFresh = useCallback(() => {
    const m = state.vault?.mnemonic ?? null;
    if (m !== lastMnemonicRef.current) {
      lastMnemonicRef.current = m;
      rootRef.current = m ? deriveRoot(m) : null;
      childCacheRef.current = new Map();
    }
  }, [state.vault]);

  const getRoot = useCallback((): HDNodeWallet | null => {
    ensureWalletsFresh();
    return rootRef.current;
  }, [ensureWalletsFresh]);

  const getChildWallet = useCallback(
    (index: number): HDNodeWallet | null => {
      ensureWalletsFresh();
      if (!state.vault) return null;
      const cache = childCacheRef.current;
      if (!cache.has(index)) cache.set(index, deriveAccount(state.vault.mnemonic, index));
      return cache.get(index) ?? null;
    },
    [ensureWalletsFresh, state.vault],
  );

  // Probe network whenever rpcUrl changes
  useEffect(() => {
    if (state.phase !== "ready") return;
    const provider = getProvider();
    if (!provider) {
      dispatch({ type: "SET_NETWORK", network: null, error: "未配置 RPC" });
      return;
    }
    let cancelled = false;
    probeNetwork(provider)
      .then((info) => {
        if (cancelled) return;
        dispatch({ type: "SET_NETWORK", network: info, error: null });
      })
      .catch((e) => {
        if (cancelled) return;
        dispatch({ type: "SET_NETWORK", network: null, error: e.message ?? String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [state.phase, state.vault?.rpcUrl, getProvider]);

  // Probe Disperse contract whenever address or network changes
  useEffect(() => {
    if (state.phase !== "ready") return;
    const provider = getProvider();
    if (!provider || !state.network) {
      dispatch({ type: "SET_CONTRACT_STATUS", status: null });
      return;
    }
    let cancelled = false;
    checkDisperseContract(provider, state.vault!.disperseAddress)
      .then((status) => {
        if (!cancelled) dispatch({ type: "SET_CONTRACT_STATUS", status });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "SET_CONTRACT_STATUS", status: null });
      });
    return () => {
      cancelled = true;
    };
  }, [state.phase, state.vault?.disperseAddress, state.network, getProvider, state.vault]);

  const ctx = useMemo<AppContextValue>(
    () => ({ state, dispatch, getProvider, getRoot, getChildWallet }),
    [state, getProvider, getRoot, getChildWallet],
  );

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="app-header">
          <div>
            <h1>DeFi United · Local Donor</h1>
            <small>本地助记词 / HD 派生 / Disperse 批量分发 / 主网仅</small>
          </div>
          <div>
            {state.phase === "ready" && (
              <button className="secondary" onClick={() => dispatch({ type: "LOCK" })}>
                锁定
              </button>
            )}
          </div>
        </header>
        {state.phase === "loading" && <p>Loading…</p>}
        {state.phase === "setup" && <SetupScreen />}
        {state.phase === "unlock" && <UnlockScreen />}
        {state.phase === "ready" && <Dashboard />}
      </div>
    </AppContext.Provider>
  );
}
