import { describe, expect, it } from "vitest";
import { createDefaultBrowserChainConfigState, getActiveBrowserChain, type BrowserChainRecord } from "../../core/chains";
import { summarizeAppSession } from "./appSession";

describe("summarizeAppSession", () => {
  it("summarizes chain RPC and fee context for the top bar", () => {
    const activeChain = getActiveBrowserChain(createDefaultBrowserChainConfigState());

    expect(summarizeAppSession(null, activeChain)).toMatchObject({
      activeChainName: "Ethereum Mainnet",
      baseFeeMultiplierLabel: "2x",
      maxFeeLabel: "30 gwei",
      priorityFeeLabel: "1.5 gwei",
      rpcLabel: "Public RPC",
      vaultStateLabel: "未解锁",
    });
  });

  it("uses RPC labels without exposing full RPC URLs", () => {
    const activeChain = getActiveBrowserChain(createDefaultBrowserChainConfigState())!;
    const chainWithSecretUrl: BrowserChainRecord = {
      ...activeChain,
      rpcEndpoints: [
        {
          id: "rpc-secret",
          label: "Fast private RPC",
          primary: true,
          enabled: true,
          url: "https://rpc.example.test/secret-api-key",
        },
      ],
    };

    const summary = summarizeAppSession(null, chainWithSecretUrl);

    expect(summary.rpcLabel).toBe("Fast private RPC");
    expect(summary.rpcLabel).not.toContain("secret-api-key");
    expect(summary.rpcLabel).not.toContain("https://");
  });

  it("summarizes legacy gas price without a priority tip", () => {
    const activeChain = getActiveBrowserChain(createDefaultBrowserChainConfigState())!;
    const legacyChain: BrowserChainRecord = {
      ...activeChain,
      feeDraft: {
        ...activeChain.feeDraft,
        gasPriceGwei: "7",
        mode: "legacy",
      },
    };

    expect(summarizeAppSession(null, legacyChain)).toMatchObject({
      baseFeeMultiplierLabel: "2x",
      maxFeeLabel: "7 gwei",
      priorityFeeLabel: "--",
    });
  });
});
