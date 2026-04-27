import { describe, expect, it } from "vitest";
import {
  canStartAccountsRefresh,
  ensureRpcChainMatchesSelectedChain,
  isAccountsRefreshCurrent,
  mergeRefreshedAccounts,
} from "./App";

describe("mergeRefreshedAccounts", () => {
  it("updates matching accounts without dropping accounts added during refresh", () => {
    const original = { index: 1, address: "0xA", nativeBalanceWei: 1n };
    const addedDuringRefresh = { index: 2, address: "0xB", nativeBalanceWei: 2n };
    const refreshed = { index: 1, address: "0xa", nativeBalanceWei: 10n };

    expect(mergeRefreshedAccounts([original, addedDuringRefresh], [refreshed])).toEqual([
      refreshed,
      addedDuringRefresh,
    ]);
  });
});

describe("isAccountsRefreshCurrent", () => {
  it("requires the same request id and selected chain before account refresh writes", () => {
    expect(isAccountsRefreshCurrent(2, 8453n, 2, 8453n)).toBe(true);
    expect(isAccountsRefreshCurrent(1, 8453n, 2, 8453n)).toBe(false);
    expect(isAccountsRefreshCurrent(2, 8453n, 2, 1n)).toBe(false);
  });
});

describe("canStartAccountsRefresh", () => {
  it("prevents overlapping remote account refreshes", () => {
    expect(canStartAccountsRefresh(0)).toBe(true);
    expect(canStartAccountsRefresh(1)).toBe(false);
  });
});

describe("ensureRpcChainMatchesSelectedChain", () => {
  it("rejects RPC endpoints that report a different chain before account writes", async () => {
    await expect(
      ensureRpcChainMatchesSelectedChain("https://rpc.example", 1n, async () => 8453n),
    ).rejects.toThrow("RPC returned chainId 8453; expected 1.");
  });

  it("returns the probed chain id when it matches", async () => {
    await expect(
      ensureRpcChainMatchesSelectedChain("https://rpc.example", 8453n, async () => 8453n),
    ).resolves.toBe(8453n);
  });
});
