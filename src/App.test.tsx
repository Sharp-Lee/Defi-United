import { describe, expect, it } from "vitest";
import {
  abiRegistryMutationFailureMessage,
  canStartAccountsRefresh,
  ensureRpcChainMatchesSelectedChain,
  isAccountsRefreshCurrent,
  isUsableAbiRegistryMutationResult,
  isTokenOperationCurrent,
  mergeRefreshedAccounts,
  nextTokenOperationGeneration,
} from "./App";
import type { AbiRegistryMutationResult } from "./lib/tauri";

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

describe("isTokenOperationCurrent", () => {
  it("requires a ready session and matching generation before token state writes", () => {
    expect(isTokenOperationCurrent(3, 3, "ready")).toBe(true);
    expect(isTokenOperationCurrent(2, 3, "ready")).toBe(false);
    expect(isTokenOperationCurrent(3, 3, "locked")).toBe(false);
  });

  it("treats an older token operation as stale after a newer operation starts", () => {
    const firstOperation = nextTokenOperationGeneration(3);
    const secondOperation = nextTokenOperationGeneration(firstOperation);

    expect(firstOperation).toBe(4);
    expect(secondOperation).toBe(5);
    expect(isTokenOperationCurrent(firstOperation, secondOperation, "ready")).toBe(false);
    expect(isTokenOperationCurrent(secondOperation, secondOperation, "locked")).toBe(false);
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

describe("isUsableAbiRegistryMutationResult", () => {
  function mutationResult(
    overrides: Partial<AbiRegistryMutationResult> = {},
  ): AbiRegistryMutationResult {
    return {
      state: { schemaVersion: 1, dataSources: [], cacheEntries: [] },
      validation: {
        fetchSourceStatus: "ok",
        validationStatus: "ok",
        functionCount: 1,
        eventCount: 0,
        errorCount: 0,
        selectorSummary: {},
        diagnostics: {},
      },
      cacheEntry: {} as AbiRegistryMutationResult["cacheEntry"],
      ...overrides,
    };
  }

  it("requires a cache entry and successful fetch/validation statuses", () => {
    expect(isUsableAbiRegistryMutationResult(mutationResult())).toBe(true);
    expect(
      isUsableAbiRegistryMutationResult(
        mutationResult({
          cacheEntry: null,
          validation: {
            ...mutationResult().validation,
            validationStatus: "parseFailed",
          },
        }),
      ),
    ).toBe(false);
    expect(
      isUsableAbiRegistryMutationResult(
        mutationResult({
          validation: {
            ...mutationResult().validation,
            fetchSourceStatus: "notConfigured",
            validationStatus: "notValidated",
          },
        }),
      ),
    ).toBe(false);
  });

  it("includes resolved backend failure diagnostics in the message", () => {
    const message = abiRegistryMutationFailureMessage(
      mutationResult({
        cacheEntry: null,
        validation: {
          ...mutationResult().validation,
          fetchSourceStatus: "notConfigured",
          validationStatus: "notValidated",
          diagnostics: {
            providerConfigId: "etherscan-mainnet",
            failureClass: "notConfigured",
          },
        },
      }),
    );

    expect(message).toContain("notConfigured");
    expect(message).toContain("etherscan-mainnet");
  });
});
