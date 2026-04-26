import type { AccountRecord } from "../lib/tauri";
import type { AccountChainState } from "../lib/rpc";

export interface AppStore {
  sessionStatus: "locked" | "ready";
  defaultChainId: number;
  defaultRpcUrl: string;
  accounts: Array<AccountRecord & AccountChainState>;
}

export const initialStore: AppStore = {
  sessionStatus: "locked",
  defaultChainId: 1,
  defaultRpcUrl: "",
  accounts: [],
};
