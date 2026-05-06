import {
  DEFAULT_FEE_DRAFT,
  createDefaultBrowserChainConfigState,
  validateBrowserChainConfigState,
  type BrowserChainConfigState,
} from "../core/browserChainConfig";

const STORAGE_KEY = "defi-united-pwa-chain-config";

export interface BrowserChainConfigStorage {
  loadState(): Promise<BrowserChainConfigState>;
  saveState(state: BrowserChainConfigState): Promise<void>;
  clearState(): Promise<void>;
}

function getLocalStorage() {
  if (!globalThis.localStorage) {
    throw new Error("Browser chain config storage is unavailable in this browser context.");
  }
  return globalThis.localStorage;
}

function resetFeeDrafts(state: BrowserChainConfigState): BrowserChainConfigState {
  return {
    ...state,
    chains: state.chains.map((chain) => ({
      ...chain,
      feeDraft: { ...DEFAULT_FEE_DRAFT },
    })),
  };
}

export const localStorageBrowserChainConfigStorage = {
  async loadState() {
    const serialized = getLocalStorage().getItem(STORAGE_KEY);
    if (!serialized) {
      return createDefaultBrowserChainConfigState();
    }
    return resetFeeDrafts(validateBrowserChainConfigState(JSON.parse(serialized)));
  },
  async saveState(state: BrowserChainConfigState) {
    getLocalStorage().setItem(STORAGE_KEY, JSON.stringify(resetFeeDrafts(validateBrowserChainConfigState(state))));
  },
  async clearState() {
    getLocalStorage().removeItem(STORAGE_KEY);
  },
} satisfies BrowserChainConfigStorage;

export function createMemoryBrowserChainConfigStorage(initialState?: BrowserChainConfigState) {
  let state = initialState ? validateBrowserChainConfigState(initialState) : createDefaultBrowserChainConfigState();
  return {
    async loadState() {
      return resetFeeDrafts(state);
    },
    async saveState(nextState: BrowserChainConfigState) {
      state = resetFeeDrafts(validateBrowserChainConfigState(nextState));
    },
    async clearState() {
      state = createDefaultBrowserChainConfigState();
    },
  } satisfies BrowserChainConfigStorage;
}

export async function loadBrowserChainConfigState(
  storage: BrowserChainConfigStorage = localStorageBrowserChainConfigStorage,
) {
  return storage.loadState();
}

export async function saveBrowserChainConfigState(
  state: BrowserChainConfigState,
  storage: BrowserChainConfigStorage = localStorageBrowserChainConfigStorage,
) {
  await storage.saveState(state);
}
