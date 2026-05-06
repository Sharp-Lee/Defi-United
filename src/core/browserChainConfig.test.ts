import { describe, expect, it } from "vitest";
import {
  addBrowserChainRecord,
  createDefaultBrowserChainConfigState,
  getActiveBrowserChain,
  getPrimaryRpcEndpoint,
  selectBrowserChain,
  updateBrowserFeeDraft,
  updateBrowserChainRecord,
  updatePrimaryRpcEndpoint,
  validateBrowserChainConfigState,
} from "./browserChainConfig";

describe("browserChainConfig", () => {
  it("creates a default Ethereum chain config", () => {
    const state = createDefaultBrowserChainConfigState();
    const activeChain = getActiveBrowserChain(state);

    expect(state.schemaVersion).toBe(1);
    expect(activeChain?.chainId).toBe(1);
    expect(activeChain?.nativeCurrencySymbol).toBe("ETH");
    expect(getPrimaryRpcEndpoint(activeChain)?.url).toMatch(/^https:\/\//);
  });

  it("adds and selects a browser chain record", () => {
    const state = createDefaultBrowserChainConfigState();
    const nextState = addBrowserChainRecord(state, {
      name: "Base",
      chainId: 8453,
      nativeCurrencySymbol: "eth",
      rpcUrl: "https://mainnet.base.org",
      rpcLabel: "Base public RPC",
    });

    expect(nextState.chains).toHaveLength(2);
    expect(getActiveBrowserChain(nextState)?.chainId).toBe(8453);
    expect(getActiveBrowserChain(selectBrowserChain(nextState, state.activeChainId))?.chainId).toBe(1);
  });

  it("updates chain, rpc, and fee drafts without accepting malformed fee input", () => {
    const state = createDefaultBrowserChainConfigState();
    const activeChainId = state.activeChainId;
    const renamed = updateBrowserChainRecord(state, activeChainId, {
      name: "Ethereum",
      nativeCurrencySymbol: "eth",
      explorerUrl: "https://etherscan.io/",
    });
    const rpcUpdated = updatePrimaryRpcEndpoint(renamed, activeChainId, {
      label: "Custom RPC",
      url: "https://rpc.example.test",
    });
    const feeUpdated = updateBrowserFeeDraft(rpcUpdated, activeChainId, {
      gasLimit: "25000",
      maxFeePerGasGwei: "not-a-number",
      maxPriorityFeePerGasGwei: "2",
    });
    const activeChain = getActiveBrowserChain(feeUpdated);

    expect(activeChain?.name).toBe("Ethereum");
    expect(activeChain?.nativeCurrencySymbol).toBe("ETH");
    expect(getPrimaryRpcEndpoint(activeChain)?.label).toBe("Custom RPC");
    expect(getPrimaryRpcEndpoint(activeChain)?.url).toBe("https://rpc.example.test");
    expect(activeChain?.feeDraft.gasLimit).toBe("25000");
    expect(activeChain?.feeDraft.maxFeePerGasGwei).toBe("30");
    expect(activeChain?.feeDraft.maxPriorityFeePerGasGwei).toBe("2");
  });

  it("rejects malformed browser chain config state", () => {
    const state = createDefaultBrowserChainConfigState();

    expect(() => validateBrowserChainConfigState({ ...state, schemaVersion: 999 })).toThrow(
      "Invalid browser chain config state.",
    );
    expect(() =>
      validateBrowserChainConfigState({
        ...state,
        chains: [
          {
            ...state.chains[0],
            rpcEndpoints: [{ ...state.chains[0].rpcEndpoints[0], url: "ftp://invalid" }],
          },
        ],
      }),
    ).toThrow("Invalid browser chain config state.");
  });
});
