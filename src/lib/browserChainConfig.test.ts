import { describe, expect, it } from "vitest";
import {
  addBrowserChainRecord,
  getActiveBrowserChain,
  updateBrowserFeeDraft,
} from "../core/browserChainConfig";
import {
  createMemoryBrowserChainConfigStorage,
  loadBrowserChainConfigState,
  saveBrowserChainConfigState,
} from "./browserChainConfig";

describe("browserChainConfig storage", () => {
  it("loads a default state when storage is empty", async () => {
    const storage = createMemoryBrowserChainConfigStorage();
    const state = await loadBrowserChainConfigState(storage);

    expect(getActiveBrowserChain(state)?.chainId).toBe(1);
  });

  it("saves and reloads browser chain config state", async () => {
    const storage = createMemoryBrowserChainConfigStorage();
    const state = addBrowserChainRecord(await loadBrowserChainConfigState(storage), {
      name: "Base",
      chainId: 8453,
      nativeCurrencySymbol: "ETH",
      rpcUrl: "https://mainnet.base.org",
    });

    await saveBrowserChainConfigState(state, storage);
    const reloaded = await loadBrowserChainConfigState(storage);

    expect(reloaded.chains).toHaveLength(2);
    expect(getActiveBrowserChain(reloaded)?.chainId).toBe(8453);
  });

  it("does not persist fee draft edits across reloads", async () => {
    const storage = createMemoryBrowserChainConfigStorage();
    const loaded = await loadBrowserChainConfigState(storage);
    const editedFee = updateBrowserFeeDraft(loaded, loaded.activeChainId, { maxFeePerGasGwei: "42" });

    await saveBrowserChainConfigState(editedFee, storage);
    const reloaded = await loadBrowserChainConfigState(storage);

    expect(getActiveBrowserChain(editedFee)?.feeDraft.maxFeePerGasGwei).toBe("42");
    expect(getActiveBrowserChain(reloaded)?.feeDraft.maxFeePerGasGwei).toBe("30");
  });

  it("clears storage back to the default chain config", async () => {
    const storage = createMemoryBrowserChainConfigStorage();
    await saveBrowserChainConfigState(
      addBrowserChainRecord(await loadBrowserChainConfigState(storage), {
        name: "Base",
        chainId: 8453,
        nativeCurrencySymbol: "ETH",
        rpcUrl: "https://mainnet.base.org",
      }),
      storage,
    );

    await storage.clearState();
    const reloaded = await loadBrowserChainConfigState(storage);

    expect(reloaded.chains).toHaveLength(1);
    expect(getActiveBrowserChain(reloaded)?.chainId).toBe(1);
  });
});
