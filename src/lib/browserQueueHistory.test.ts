import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendQueueHistoryRecords,
  createDefaultQueueHistoryState,
  createDefaultQueuePolicy,
  type QueueHistoryState,
  type QueueTransactionRecord,
} from "../core/queue";
import {
  createMemoryBrowserQueueHistoryStorage,
  localStorageBrowserQueueHistoryStorage,
  loadBrowserQueueHistoryState,
  saveBrowserQueueHistoryState,
} from "./browserQueueHistory";

function installLocalStorageStub() {
  const records = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => records.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      records.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      records.delete(key);
    }),
    clear: vi.fn(() => {
      records.clear();
    }),
    key: vi.fn((index: number) => Array.from(records.keys())[index] ?? null),
    get length() {
      return records.size;
    },
  } satisfies Storage;
  vi.stubGlobal("localStorage", storage);
  return storage;
}

function transaction(overrides: Partial<QueueTransactionRecord> = {}): QueueTransactionRecord {
  return {
    id: "tx-1",
    jobId: "job-1",
    chainId: 1,
    accountId: "account-1",
    accountAddress: "0x0000000000000000000000000000000000000001",
    nonce: 3,
    status: "pending",
    actionType: "raw-calldata",
    target: "0x0000000000000000000000000000000000000002",
    valueWei: "0",
    calldataSummary: { selector: "0x64617461", byteLength: 16, summary: "0x64617461 · 16 bytes" },
    feeSummary: { mode: "eip1559", gasLimit: "21000", maxFeePerGasGwei: "30", maxPriorityFeePerGasGwei: "1.5" },
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    error: null,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    ...overrides,
  };
}

function historyState(): QueueHistoryState {
  return appendQueueHistoryRecords(createDefaultQueueHistoryState(), {
    jobs: [
      {
        id: "job-1",
        chainId: 1,
        title: "Distribution batch",
        sourceModule: "distribution",
        status: "partial",
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
        executionPolicy: createDefaultQueuePolicy(),
        transactionIds: ["tx-1"],
        summary: { total: 1, pending: 1, failed: 0, stopped: 0, completed: 0 },
      },
    ],
    transactions: [transaction()],
  });
}

describe("browserQueueHistory storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a default empty queue history when memory storage is empty", async () => {
    const storage = createMemoryBrowserQueueHistoryStorage();
    const state = await loadBrowserQueueHistoryState(storage);

    expect(state.schemaVersion).toBe(1);
    expect(state.jobs).toEqual([]);
    expect(state.transactions).toEqual([]);
  });

  it("saves and reloads redacted queue history records from memory storage", async () => {
    const storage = createMemoryBrowserQueueHistoryStorage();

    await saveBrowserQueueHistoryState(historyState(), storage);
    const reloaded = await loadBrowserQueueHistoryState(storage);

    expect(reloaded.jobs).toHaveLength(1);
    expect(reloaded.transactions).toHaveLength(1);
    expect(reloaded.transactions[0]).toMatchObject({
      accountAddress: "0x0000000000000000000000000000000000000001",
      calldataSummary: { selector: "0x64617461", byteLength: 16 },
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("persists redacted queue history to the browser queue history localStorage key", async () => {
    const storage = installLocalStorageStub();

    await saveBrowserQueueHistoryState(historyState());
    const serialized = storage.getItem("defi-united-pwa-queue-history");
    const reloaded = await localStorageBrowserQueueHistoryStorage.loadState();

    expect(serialized).toContain("transactions");
    expect(serialized).toContain("Distribution batch");
    expect(reloaded.transactions).toHaveLength(1);
  });

  it("does not persist active drafts, raw transactions, private keys, mnemonic, password, vault material, or RPC credentials", async () => {
    const storage = createMemoryBrowserQueueHistoryStorage();
    const state = historyState() as QueueHistoryState & {
      activeDrafts: unknown[];
      rawUnsignedTransaction: string;
      rawSignedTransaction: string;
      privateKey: string;
      mnemonic: string;
      password: string;
      vaultMaterial: string;
      rpcCredentials: string;
    };
    state.activeDrafts = [{ data: "0xrawunsigned" }];
    state.rawUnsignedTransaction = "0xrawunsigned";
    state.rawSignedTransaction = "0xf86c808504a817c80082520894aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    state.privateKey = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    state.mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    state.password = "hunter2";
    state.vaultMaterial = "encrypted vault secret";
    state.rpcCredentials = "https://user:pass@rpc.example.test/path?apiKey=secret";

    await saveBrowserQueueHistoryState(state, storage);
    const reloaded = await loadBrowserQueueHistoryState(storage);
    const serialized = JSON.stringify(reloaded);

    expect(serialized).not.toContain("activeDrafts");
    expect(serialized).not.toContain("rawUnsignedTransaction");
    expect(serialized).not.toContain("rawSignedTransaction");
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("mnemonic");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("vaultMaterial");
    expect(serialized).not.toContain("rpcCredentials");
    expect(serialized).not.toContain("0xrawunsigned");
    expect(serialized).not.toContain("f86c8085");
    expect(serialized).not.toContain("0123456789abcdef");
    expect(serialized).not.toContain("abandon abandon");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("rpc.example.test");
  });

  it("rejects tampered saved JSON containing unsafe raw signed transaction or private key fields", async () => {
    const tampered = {
      ...historyState(),
      transactions: [
        {
          ...transaction(),
          rawSignedTransaction: "0xf86c808504a817c80082520894aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          privateKey: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      ],
    };
    const storage = createMemoryBrowserQueueHistoryStorage(tampered);

    await expect(loadBrowserQueueHistoryState(storage)).rejects.toThrow("Invalid queue history state.");
  });

  it("clears storage back to the default empty queue history", async () => {
    const storage = createMemoryBrowserQueueHistoryStorage();

    await saveBrowserQueueHistoryState(historyState(), storage);
    await storage.clearState();
    const reloaded = await loadBrowserQueueHistoryState(storage);

    expect(reloaded.jobs).toEqual([]);
    expect(reloaded.transactions).toEqual([]);
  });
});
