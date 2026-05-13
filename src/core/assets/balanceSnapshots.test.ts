import { describe, expect, it, vi } from "vitest";
import type { BrowserWatchedErc20Asset } from "./browserAssetRegistry";
import {
  EMPTY_ASSET_BALANCE_SNAPSHOT_STATE,
  type AssetBalanceRpcClient,
  type AssetBalanceSnapshotState,
  type AssetRefreshStatus,
  refreshAssetBalanceSnapshots,
} from "./balanceSnapshots";

describe("asset balance snapshots", () => {
  const ACCOUNT_ONE = {
    id: "account-1",
    address: "0x0000000000000000000000000000000000000001",
    label: "One",
  };
  const ACCOUNT_TWO = {
    id: "account-2",
    address: "0x0000000000000000000000000000000000000002",
    label: "Two",
  };
  const USDC: BrowserWatchedErc20Asset = {
    id: "asset-usdc",
    chainId: 1,
    contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    symbol: "USDC",
    decimals: 6,
    label: "USD Coin",
    enabled: true,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
  };
  const ALL_STATUSES: AssetRefreshStatus[] = [
    "idle",
    "validating-chain",
    "refreshing",
    "success",
    "partial",
    "failed",
    "chain-mismatch",
    "no-rpc",
    "no-selected-accounts",
  ];

  function createRpcClient(overrides: Partial<AssetBalanceRpcClient> = {}): AssetBalanceRpcClient {
    return {
      getChainId: vi.fn(async () => 1),
      getBlockNumber: vi.fn(async () => 100),
      getNativeBalance: vi.fn(async (accountAddress: string) =>
        accountAddress === ACCOUNT_ONE.address ? "1000000000000000000" : "2000000000000000000",
      ),
      getErc20Balance: vi.fn(async (_tokenAddress: string, accountAddress: string) =>
        accountAddress === ACCOUNT_ONE.address ? "1230000" : "4560000",
      ),
      ...overrides,
    };
  }

  function createPreviousState(): AssetBalanceSnapshotState {
    return {
      status: "success",
      stale: false,
      chainValidation: { expectedChainId: 1, actualChainId: 1 },
      nativeBalances: [
        {
          chainId: 1,
          accountAddress: ACCOUNT_ONE.address,
          accountLabel: "One",
          balanceWei: "10",
          blockNumber: 99,
          refreshedAt: "2026-05-14T00:00:00.000Z",
        },
      ],
      erc20Balances: [
        {
          chainId: 1,
          tokenAddress: USDC.contractAddress,
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          accountAddress: ACCOUNT_ONE.address,
          accountLabel: "One",
          balanceRaw: "20",
          blockNumber: 99,
          refreshedAt: "2026-05-14T00:00:00.000Z",
        },
      ],
      failures: [],
      refreshedAt: "2026-05-14T00:00:00.000Z",
    };
  }

  it("exports the complete asset refresh status union", () => {
    expect(ALL_STATUSES).toEqual([
      "idle",
      "validating-chain",
      "refreshing",
      "success",
      "partial",
      "failed",
      "chain-mismatch",
      "no-rpc",
      "no-selected-accounts",
    ]);
  });

  it("refreshes native and enabled ERC-20 balances after chain validation", async () => {
    const rpcClient = createRpcClient();

    const refreshed = await refreshAssetBalanceSnapshots({
      activeChainId: 1,
      accounts: [ACCOUNT_ONE, ACCOUNT_TWO],
      watchedAssets: [USDC, { ...USDC, id: "disabled", enabled: false }],
      rpcClient,
      previous: EMPTY_ASSET_BALANCE_SNAPSHOT_STATE,
    });

    expect(refreshed.status).toBe("success");
    expect(refreshed.chainValidation).toEqual({ expectedChainId: 1, actualChainId: 1 });
    expect(refreshed.refreshedAt).toEqual(expect.any(String));
    expect(refreshed.stale).toBe(false);
    expect(refreshed.failures).toEqual([]);
    expect(refreshed.nativeBalances).toMatchObject([
      {
        chainId: 1,
        accountAddress: ACCOUNT_ONE.address,
        accountLabel: "One",
        balanceWei: "1000000000000000000",
        blockNumber: 100,
        refreshedAt: refreshed.refreshedAt,
      },
      {
        chainId: 1,
        accountAddress: ACCOUNT_TWO.address,
        accountLabel: "Two",
        balanceWei: "2000000000000000000",
        blockNumber: 100,
        refreshedAt: refreshed.refreshedAt,
      },
    ]);
    expect(refreshed.erc20Balances).toMatchObject([
      {
        chainId: 1,
        tokenAddress: USDC.contractAddress,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        accountAddress: ACCOUNT_ONE.address,
        accountLabel: "One",
        balanceRaw: "1230000",
        blockNumber: 100,
        refreshedAt: refreshed.refreshedAt,
      },
      {
        chainId: 1,
        tokenAddress: USDC.contractAddress,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        accountAddress: ACCOUNT_TWO.address,
        accountLabel: "Two",
        balanceRaw: "4560000",
        blockNumber: 100,
        refreshedAt: refreshed.refreshedAt,
      },
    ]);
    expect(vi.mocked(rpcClient.getChainId).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(rpcClient.getBlockNumber).mock.invocationCallOrder[0],
    );
    expect(rpcClient.getErc20Balance).toHaveBeenCalledTimes(2);
  });

  it("returns chain-mismatch with previous snapshots preserved as stale", async () => {
    const previous = createPreviousState();
    const rpcClient = createRpcClient({ getChainId: vi.fn(async () => 8453) });

    const refreshed = await refreshAssetBalanceSnapshots({
      activeChainId: 1,
      accounts: [ACCOUNT_ONE],
      watchedAssets: [USDC],
      rpcClient,
      previous,
    });

    expect(refreshed.status).toBe("chain-mismatch");
    expect(refreshed.chainValidation).toEqual({ expectedChainId: 1, actualChainId: 8453 });
    expect(refreshed.refreshedAt).toEqual(expect.any(String));
    expect(refreshed.stale).toBe(true);
    expect(refreshed.nativeBalances).toBe(previous.nativeBalances);
    expect(refreshed.erc20Balances).toBe(previous.erc20Balances);
    expect(rpcClient.getBlockNumber).not.toHaveBeenCalled();
  });

  it("records partial native failures without displaying failed accounts as zero", async () => {
    const rpcClient = createRpcClient({
      getNativeBalance: vi.fn(async (accountAddress: string) => {
        if (accountAddress === ACCOUNT_TWO.address) {
          throw new Error("native failed https://rpc.example.com/project/secret-token");
        }
        return "100";
      }),
      getErc20Balance: vi.fn(async () => "500"),
    });

    const refreshed = await refreshAssetBalanceSnapshots({
      activeChainId: 1,
      accounts: [ACCOUNT_ONE, ACCOUNT_TWO],
      watchedAssets: [USDC],
      rpcClient,
      previous: EMPTY_ASSET_BALANCE_SNAPSHOT_STATE,
    });

    expect(refreshed.status).toBe("partial");
    expect(refreshed.chainValidation).toEqual({ expectedChainId: 1, actualChainId: 1 });
    expect(refreshed.nativeBalances).toMatchObject([
      { accountAddress: ACCOUNT_ONE.address, accountLabel: "One", balanceWei: "100", blockNumber: 100 },
    ]);
    expect(refreshed.nativeBalances).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ accountAddress: ACCOUNT_TWO.address, balanceWei: "0" })]),
    );
    expect(refreshed.failures).toMatchObject([{ kind: "native", accountAddress: ACCOUNT_TWO.address }]);
    expect(refreshed.failures[0].message).not.toContain("https://rpc.example.com");
    expect(refreshed.failures[0].message).not.toContain("secret-token");
  });

  it("keeps previous snapshots stale when all balance calls fail", async () => {
    const previous = createPreviousState();
    const rpcClient = createRpcClient({
      getNativeBalance: vi.fn(async () => {
        throw new Error("native failed");
      }),
      getErc20Balance: vi.fn(async () => {
        throw new Error("erc20 failed");
      }),
    });

    const refreshed = await refreshAssetBalanceSnapshots({
      activeChainId: 1,
      accounts: [ACCOUNT_ONE],
      watchedAssets: [USDC],
      rpcClient,
      previous,
    });

    expect(refreshed.status).toBe("failed");
    expect(refreshed.stale).toBe(true);
    expect(refreshed.chainValidation).toEqual({ expectedChainId: 1, actualChainId: 1 });
    expect(refreshed.nativeBalances).toBe(previous.nativeBalances);
    expect(refreshed.erc20Balances).toBe(previous.erc20Balances);
    expect(refreshed.failures).toHaveLength(2);
  });
});
