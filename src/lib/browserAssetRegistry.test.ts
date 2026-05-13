import { afterEach, describe, expect, it, vi } from "vitest";
import { addWatchedErc20Asset } from "../core/assets/browserAssetRegistry";
import {
  createMemoryBrowserAssetRegistryStorage,
  localStorageBrowserAssetRegistryStorage,
  loadBrowserAssetRegistryState,
  saveBrowserAssetRegistryState,
} from "./browserAssetRegistry";

describe("browserAssetRegistry storage", () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a default empty registry from memory storage", async () => {
    const storage = createMemoryBrowserAssetRegistryStorage();
    const state = await loadBrowserAssetRegistryState(storage);

    expect(state.schemaVersion).toBe(1);
    expect(state.watchedErc20Assets).toEqual([]);
  });

  it("saves and reloads watched token definitions", async () => {
    const storage = createMemoryBrowserAssetRegistryStorage();
    const state = addWatchedErc20Asset(await loadBrowserAssetRegistryState(storage), {
      chainId: 1,
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      symbol: " usdc ",
      decimals: 6,
      label: " USD Coin ",
    });

    await saveBrowserAssetRegistryState(state, storage);
    const reloaded = await loadBrowserAssetRegistryState(storage);

    expect(reloaded.watchedErc20Assets).toHaveLength(1);
    expect(reloaded.watchedErc20Assets[0]).toMatchObject({
      chainId: 1,
      contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      decimals: 6,
      label: "USD Coin",
      enabled: true,
    });
  });

  it("persists watched token definitions to the browser asset registry localStorage key", async () => {
    const storage = installLocalStorageStub();
    const state = addWatchedErc20Asset(await loadBrowserAssetRegistryState(), {
      chainId: 1,
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      symbol: "usdc",
      decimals: 6,
      label: "USD Coin",
    });

    await saveBrowserAssetRegistryState(state);
    const serialized = storage.getItem("defi-united-pwa-asset-registry");
    const reloaded = await localStorageBrowserAssetRegistryStorage.loadState();

    expect(serialized).toContain("watchedErc20Assets");
    expect(serialized).toContain("USDC");
    expect(reloaded.watchedErc20Assets).toHaveLength(1);
  });

  it("clears storage back to the default empty registry", async () => {
    const storage = createMemoryBrowserAssetRegistryStorage();
    const state = addWatchedErc20Asset(await loadBrowserAssetRegistryState(storage), {
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000001",
      symbol: "one",
      decimals: 18,
      label: "One",
    });

    await saveBrowserAssetRegistryState(state, storage);
    await storage.clearState();
    const reloaded = await loadBrowserAssetRegistryState(storage);

    expect(reloaded.watchedErc20Assets).toEqual([]);
  });

  it("does not persist balance snapshots or secret fields", async () => {
    const storage = createMemoryBrowserAssetRegistryStorage();
    const state = addWatchedErc20Asset(await loadBrowserAssetRegistryState(storage), {
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000001",
      symbol: "one",
      decimals: 18,
      label: "One",
    }) as ReturnType<typeof addWatchedErc20Asset> & {
      balance: string;
      snapshot: unknown;
      privateKey: string;
      mnemonic: string;
      password: string;
      signedTransaction: string;
    };
    state.balance = "100";
    state.snapshot = { value: "cached-balance" };
    state.privateKey = "secret";
    state.mnemonic = "seed words";
    state.password = "hunter2";
    state.signedTransaction = "0xsigned";
    const asset = state.watchedErc20Assets[0] as typeof state.watchedErc20Assets[number] & {
      balance: string;
      snapshot: unknown;
      privateKey: string;
      password: string;
      signedTransaction: string;
    };
    asset.balance = "100";
    asset.snapshot = { value: "cached-balance" };
    asset.privateKey = "secret";
    asset.password = "hunter2";
    asset.signedTransaction = "0xsigned";

    await saveBrowserAssetRegistryState(state, storage);
    const reloaded = await loadBrowserAssetRegistryState(storage);
    const serialized = JSON.stringify(reloaded);

    expect(serialized).not.toMatch(/balance/i);
    expect(serialized).not.toMatch(/snapshot/i);
    expect(serialized).not.toMatch(/private/i);
    expect(serialized).not.toMatch(/mnemonic/i);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/signed/i);
  });
});
