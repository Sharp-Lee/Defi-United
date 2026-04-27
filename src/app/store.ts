import type { SessionState } from "./session";
import type { AccountRecord } from "../lib/tauri";
import type { AccountChainState } from "../lib/rpc";

export interface AppStore {
  session: SessionState;
  defaultRpcUrl: string;
  accounts: Array<AccountRecord & AccountChainState>;
}

export const initialStore: AppStore = {
  session: {
    status: "locked",
    lockedAt: Date.now(),
    idleLockMinutes: 15,
  },
  defaultRpcUrl: "",
  accounts: [],
};
