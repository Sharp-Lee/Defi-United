import {
  createDefaultBrowserAssetRegistryState,
  validateBrowserAssetRegistryState,
  type BrowserAssetRegistryState,
} from "../core/assets";

const STORAGE_KEY = "defi-united-pwa-asset-registry";

export interface BrowserAssetRegistryStorage {
  loadState(): Promise<BrowserAssetRegistryState>;
  saveState(state: BrowserAssetRegistryState): Promise<void>;
  clearState(): Promise<void>;
}

function getLocalStorage() {
  if (!globalThis.localStorage) {
    throw new Error("Browser asset registry storage is unavailable in this browser context.");
  }
  return globalThis.localStorage;
}

function toPersistedState(state: BrowserAssetRegistryState): BrowserAssetRegistryState {
  const validated = validateBrowserAssetRegistryState(state);
  return {
    schemaVersion: validated.schemaVersion,
    updatedAt: validated.updatedAt,
    watchedErc20Assets: validated.watchedErc20Assets.map((asset) => ({
      id: asset.id,
      chainId: asset.chainId,
      contractAddress: asset.contractAddress,
      symbol: asset.symbol,
      decimals: asset.decimals,
      label: asset.label,
      enabled: asset.enabled,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    })),
  };
}

export const localStorageBrowserAssetRegistryStorage = {
  async loadState() {
    const serialized = getLocalStorage().getItem(STORAGE_KEY);
    if (!serialized) {
      return createDefaultBrowserAssetRegistryState();
    }
    return toPersistedState(JSON.parse(serialized));
  },
  async saveState(state: BrowserAssetRegistryState) {
    getLocalStorage().setItem(STORAGE_KEY, JSON.stringify(toPersistedState(state)));
  },
  async clearState() {
    getLocalStorage().removeItem(STORAGE_KEY);
  },
} satisfies BrowserAssetRegistryStorage;

export function createMemoryBrowserAssetRegistryStorage(initialState?: BrowserAssetRegistryState) {
  let state = initialState ? toPersistedState(initialState) : createDefaultBrowserAssetRegistryState();
  return {
    async loadState() {
      return toPersistedState(state);
    },
    async saveState(nextState: BrowserAssetRegistryState) {
      state = toPersistedState(nextState);
    },
    async clearState() {
      state = createDefaultBrowserAssetRegistryState();
    },
  } satisfies BrowserAssetRegistryStorage;
}

export async function loadBrowserAssetRegistryState(
  storage: BrowserAssetRegistryStorage = localStorageBrowserAssetRegistryStorage,
) {
  return storage.loadState();
}

export async function saveBrowserAssetRegistryState(
  state: BrowserAssetRegistryState,
  storage: BrowserAssetRegistryStorage = localStorageBrowserAssetRegistryStorage,
) {
  await storage.saveState(state);
}
