import { createContext, useContext } from "react";
import type { HDNodeWallet, JsonRpcProvider } from "ethers";
import type { ChildAccount, TxRecord, VaultPlaintext } from "../types";
import type { NetworkInfo } from "../wallet/provider";

export type Phase = "loading" | "setup" | "unlock" | "ready";

export interface AppState {
  phase: Phase;
  vault: VaultPlaintext | null;
  password: string | null; // kept in memory only (never persisted)
  rootAddress: string | null;
  rootBalanceWei: bigint | null;
  children: ChildAccount[];
  txLog: TxRecord[];
  network: NetworkInfo | null;
  networkError: string | null;
  contractStatus: { exists: boolean; selectorMatches: boolean } | null;
  busy: string | null;
}

export const initialState: AppState = {
  phase: "loading",
  vault: null,
  password: null,
  rootAddress: null,
  rootBalanceWei: null,
  children: [],
  txLog: [],
  network: null,
  networkError: null,
  contractStatus: null,
  busy: null,
};

export type Action =
  | { type: "SET_PHASE"; phase: Phase }
  | { type: "UNLOCKED"; vault: VaultPlaintext; password: string; rootAddress: string }
  | { type: "VAULT_UPDATE"; vault: VaultPlaintext }
  | { type: "SET_ROOT_BALANCE"; balanceWei: bigint | null }
  | { type: "SET_CHILDREN"; children: ChildAccount[] }
  | { type: "UPDATE_CHILD"; index: number; patch: Partial<ChildAccount> }
  | { type: "TX"; record: TxRecord }
  | { type: "CLEAR_LOG" }
  | { type: "SET_NETWORK"; network: NetworkInfo | null; error: string | null }
  | { type: "SET_CONTRACT_STATUS"; status: { exists: boolean; selectorMatches: boolean } | null }
  | { type: "SET_BUSY"; busy: string | null }
  | { type: "LOCK" };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_PHASE":
      return { ...state, phase: action.phase };
    case "UNLOCKED":
      return {
        ...state,
        phase: "ready",
        vault: action.vault,
        password: action.password,
        rootAddress: action.rootAddress,
      };
    case "VAULT_UPDATE":
      return { ...state, vault: action.vault };
    case "SET_ROOT_BALANCE":
      return { ...state, rootBalanceWei: action.balanceWei };
    case "SET_CHILDREN":
      return { ...state, children: action.children };
    case "UPDATE_CHILD": {
      const next = state.children.map((c) =>
        c.index === action.index ? { ...c, ...action.patch } : c,
      );
      return { ...state, children: next };
    }
    case "TX": {
      const idx = state.txLog.findIndex((r) => r.id === action.record.id);
      const next = idx >= 0
        ? state.txLog.map((r) => (r.id === action.record.id ? action.record : r))
        : [action.record, ...state.txLog].slice(0, 200);
      return { ...state, txLog: next };
    }
    case "CLEAR_LOG":
      return { ...state, txLog: [] };
    case "SET_NETWORK":
      return { ...state, network: action.network, networkError: action.error };
    case "SET_CONTRACT_STATUS":
      return { ...state, contractStatus: action.status };
    case "SET_BUSY":
      return { ...state, busy: action.busy };
    case "LOCK":
      return { ...initialState, phase: "unlock" };
    default:
      return state;
  }
}

export interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  // helpers populated by the provider
  getProvider: () => JsonRpcProvider | null;
  getRoot: () => HDNodeWallet | null;
  getChildWallet: (index: number) => HDNodeWallet | null;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext not provided");
  return ctx;
}
