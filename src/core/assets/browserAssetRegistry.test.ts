import { describe, expect, it } from "vitest";
import {
  addWatchedErc20Asset,
  createDefaultBrowserAssetRegistryState,
  getEnabledWatchedErc20AssetsForChain,
  removeWatchedErc20Asset,
  updateWatchedErc20Asset,
  validateBrowserAssetRegistryState,
} from "./browserAssetRegistry";

describe("browser asset registry", () => {
  const VALID_ISO_TIMESTAMP = "2026-05-14T00:00:00.000Z";

  function createUsdcState() {
    return addWatchedErc20Asset(createDefaultBrowserAssetRegistryState(), {
      chainId: 1,
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      symbol: "usdc",
      decimals: 6,
      label: "USD Coin",
    });
  }

  function createPersistedUsdcState() {
    const state = createUsdcState();
    return {
      ...state,
      updatedAt: VALID_ISO_TIMESTAMP,
      watchedErc20Assets: state.watchedErc20Assets.map((asset) => ({
        ...asset,
        createdAt: VALID_ISO_TIMESTAMP,
        updatedAt: VALID_ISO_TIMESTAMP,
      })),
    };
  }

  it("adds normalized watched ERC-20 assets and filters them by active chain", () => {
    const state = createDefaultBrowserAssetRegistryState();
    const withUsdc = addWatchedErc20Asset(state, {
      chainId: 1,
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      symbol: " usdc ",
      decimals: 6,
      label: " USD Coin ",
    });
    const withBaseToken = addWatchedErc20Asset(withUsdc, {
      chainId: 8453,
      contractAddress: "0x0000000000000000000000000000000000000001",
      symbol: "base",
      decimals: 18,
      label: "",
    });

    expect(getEnabledWatchedErc20AssetsForChain(withBaseToken, 1)).toMatchObject([
      {
        chainId: 1,
        contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        symbol: "USDC",
        decimals: 6,
        label: "USD Coin",
        enabled: true,
      },
    ]);
  });

  it("updates and removes watched assets without mutating other assets", () => {
    const state = addWatchedErc20Asset(createDefaultBrowserAssetRegistryState(), {
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000001",
      symbol: "one",
      decimals: 18,
      label: "One",
    });
    const assetId = state.watchedErc20Assets[0].id;
    const disabled = updateWatchedErc20Asset(state, assetId, { enabled: false, symbol: "two" });
    const removed = removeWatchedErc20Asset(disabled, assetId);

    expect(disabled.watchedErc20Assets[0]).toMatchObject({ enabled: false, symbol: "TWO" });
    expect(removed.watchedErc20Assets).toHaveLength(0);
  });

  it("updates chain, address, symbol, decimals, label, and enabled fields", () => {
    const state = createUsdcState();
    const assetId = state.watchedErc20Assets[0].id;
    const updated = updateWatchedErc20Asset(state, assetId, {
      chainId: 8453,
      contractAddress: "0x0000000000000000000000000000000000000001",
      symbol: " base ",
      decimals: 18,
      label: " Base Token ",
      enabled: false,
    });

    expect(updated.watchedErc20Assets[0]).toMatchObject({
      chainId: 8453,
      contractAddress: "0x0000000000000000000000000000000000000001",
      symbol: "BASE",
      decimals: 18,
      label: "Base Token",
      enabled: false,
    });
  });

  it("rejects updates that would duplicate another watched asset identity", () => {
    const state = addWatchedErc20Asset(createUsdcState(), {
      chainId: 8453,
      contractAddress: "0x0000000000000000000000000000000000000001",
      symbol: "base",
      decimals: 18,
      label: "Base",
    });
    const usdcAssetId = state.watchedErc20Assets[0].id;

    expect(() =>
      updateWatchedErc20Asset(state, usdcAssetId, {
        chainId: 8453,
        contractAddress: "0x0000000000000000000000000000000000000001",
      }),
    ).toThrow("Invalid browser asset registry state.");
  });

  it("does not refresh state timestamps when updating or removing an unknown asset", () => {
    const state = createUsdcState();

    expect(updateWatchedErc20Asset(state, "missing", { symbol: "weth" })).toBe(state);
    expect(removeWatchedErc20Asset(state, "missing")).toBe(state);
  });

  it("deduplicates same-chain same-contract adds and re-enables the existing asset", () => {
    const state = createUsdcState();
    const assetId = state.watchedErc20Assets[0].id;
    const disabled = updateWatchedErc20Asset(state, assetId, { enabled: false });
    const deduped = addWatchedErc20Asset(disabled, {
      chainId: 1,
      contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: " usdt ",
      decimals: 6,
      label: " Tether USD ",
    });

    expect(deduped.watchedErc20Assets).toHaveLength(1);
    expect(deduped.watchedErc20Assets[0]).toMatchObject({
      id: assetId,
      symbol: "USDT",
      label: "Tether USD",
      enabled: true,
    });
  });

  it("normalizes symbol fallbacks, symbol length, and decimals boundaries", () => {
    const state = createDefaultBrowserAssetRegistryState();
    const withFallback = addWatchedErc20Asset(state, {
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000001",
      symbol: " ",
      decimals: 0,
      label: "",
    });
    const withLongSymbol = addWatchedErc20Asset(withFallback, {
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000002",
      symbol: "abcdefghijklmnopqrstuvwxyz",
      decimals: 36,
      label: "",
    });

    expect(withLongSymbol.watchedErc20Assets[0]).toMatchObject({
      symbol: "TOKEN",
      label: "TOKEN",
      decimals: 0,
    });
    expect(withLongSymbol.watchedErc20Assets[1]).toMatchObject({
      symbol: "ABCDEFGHIJKLMNOPQRSTUVWX",
      label: "ABCDEFGHIJKLMNOPQRSTUVWX",
      decimals: 36,
    });
  });

  it("rejects malformed registry state", () => {
    expect(() =>
      validateBrowserAssetRegistryState({
        schemaVersion: 1,
        updatedAt: VALID_ISO_TIMESTAMP,
        watchedErc20Assets: [
          {
            id: "bad",
            chainId: 1,
            contractAddress: "not-an-address",
            symbol: "BAD",
            decimals: 18,
            label: "Bad",
            enabled: true,
            createdAt: VALID_ISO_TIMESTAMP,
            updatedAt: VALID_ISO_TIMESTAMP,
          },
        ],
      }),
    ).toThrow(/Invalid browser asset registry state/);
  });

  it("rejects invalid schema versions and malformed field types", () => {
    const state = createUsdcState();

    expect(() => validateBrowserAssetRegistryState({ ...state, schemaVersion: 2 })).toThrow(
      /Invalid browser asset registry state/,
    );
    expect(() => validateBrowserAssetRegistryState({ ...state, updatedAt: 123 })).toThrow(
      /Invalid browser asset registry state/,
    );
    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], chainId: "1" }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], enabled: "true" }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
  });

  it("rejects invalid decimals and chain ids", () => {
    const state = createUsdcState();

    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], decimals: -1 }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], decimals: 37 }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], chainId: 0 }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
  });

  it("rejects persisted non-canonical symbols, addresses, and labels", () => {
    const state = createPersistedUsdcState();

    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], symbol: " usdc " }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], symbol: "" }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], symbol: "ABCDEFGHIJKLMNOPQRSTUVWXY" }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [
          {
            ...state.watchedErc20Assets[0],
            contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          },
        ],
      }),
    ).toThrow(/Invalid browser asset registry state/);
    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], label: " USD Coin " }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], label: "" }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
  });

  it("rejects persisted duplicate asset identities", () => {
    const state = createPersistedUsdcState();

    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [
          state.watchedErc20Assets[0],
          {
            ...state.watchedErc20Assets[0],
            id: "asset-second",
          },
        ],
      }),
    ).toThrow(/Invalid browser asset registry state/);
  });

  it("rejects persisted duplicate asset ids", () => {
    const state = createPersistedUsdcState();

    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [
          state.watchedErc20Assets[0],
          {
            ...state.watchedErc20Assets[0],
            chainId: 8453,
            contractAddress: "0x0000000000000000000000000000000000000001",
            symbol: "BASE",
            decimals: 18,
            label: "Base",
          },
        ],
      }),
    ).toThrow("Invalid browser asset registry state.");
  });

  it("rejects empty ids and invalid timestamps in persisted assets", () => {
    const state = createPersistedUsdcState();

    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        updatedAt: "now",
      }),
    ).toThrow(/Invalid browser asset registry state/);
    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], id: "" }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], createdAt: "now" }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
    expect(() =>
      validateBrowserAssetRegistryState({
        ...state,
        watchedErc20Assets: [{ ...state.watchedErc20Assets[0], updatedAt: "" }],
      }),
    ).toThrow(/Invalid browser asset registry state/);
  });
});
