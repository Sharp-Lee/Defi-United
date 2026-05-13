import {
  createDefaultQueueHistoryState,
  validateQueueHistoryState,
  type QueueHistoryState,
} from "../core/queue";

const STORAGE_KEY = "defi-united-pwa-queue-history";
const INVALID_QUEUE_HISTORY = "Invalid queue history state.";
const UNSAFE_PERSISTED_KEYS = new Set([
  "activeDraft",
  "activeDrafts",
  "draft",
  "drafts",
  "mnemonic",
  "password",
  "privateKey",
  "rawSignedTransaction",
  "rawTransaction",
  "rawUnsignedTransaction",
  "rpcCredentials",
  "signedTransaction",
  "unsignedTransaction",
  "vaultMaterial",
]);

export interface BrowserQueueHistoryStorage {
  loadState(): Promise<QueueHistoryState>;
  saveState(state: QueueHistoryState): Promise<void>;
  clearState(): Promise<void>;
}

function getLocalStorage() {
  if (!globalThis.localStorage) {
    throw new Error("Browser queue history storage is unavailable in this browser context.");
  }
  return globalThis.localStorage;
}

function assertNoUnsafePersistedKeys(value: unknown) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(assertNoUnsafePersistedKeys);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_PERSISTED_KEYS.has(key)) {
      throw new Error(INVALID_QUEUE_HISTORY);
    }
    assertNoUnsafePersistedKeys(child);
  }
}

function toPersistedState(state: QueueHistoryState): QueueHistoryState {
  return validateQueueHistoryState(state);
}

function fromPersistedState(value: unknown): QueueHistoryState {
  assertNoUnsafePersistedKeys(value);
  return toPersistedState(value as QueueHistoryState);
}

export const localStorageBrowserQueueHistoryStorage = {
  async loadState() {
    const serialized = getLocalStorage().getItem(STORAGE_KEY);
    if (!serialized) {
      return createDefaultQueueHistoryState();
    }
    return fromPersistedState(JSON.parse(serialized));
  },
  async saveState(state: QueueHistoryState) {
    getLocalStorage().setItem(STORAGE_KEY, JSON.stringify(toPersistedState(state)));
  },
  async clearState() {
    getLocalStorage().removeItem(STORAGE_KEY);
  },
} satisfies BrowserQueueHistoryStorage;

export function createMemoryBrowserQueueHistoryStorage(initialState?: unknown) {
  let state: unknown = initialState ?? createDefaultQueueHistoryState();
  return {
    async loadState() {
      return fromPersistedState(state);
    },
    async saveState(nextState: QueueHistoryState) {
      state = toPersistedState(nextState);
    },
    async clearState() {
      state = createDefaultQueueHistoryState();
    },
  } satisfies BrowserQueueHistoryStorage;
}

export async function loadBrowserQueueHistoryState(
  storage: BrowserQueueHistoryStorage = localStorageBrowserQueueHistoryStorage,
) {
  return storage.loadState();
}

export async function saveBrowserQueueHistoryState(
  state: QueueHistoryState,
  storage: BrowserQueueHistoryStorage = localStorageBrowserQueueHistoryStorage,
) {
  await storage.saveState(state);
}
