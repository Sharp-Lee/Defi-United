import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BrowserChainRecord, BrowserRpcEndpoint } from "../../core/chains";
import { createDefaultBrowserAssetRegistryState } from "../../core/assets/browserAssetRegistry";
import type { AssetBalanceSnapshotState } from "../../core/assets/balanceSnapshots";
import { EMPTY_ASSET_BALANCE_SNAPSHOT_STATE } from "../../core/assets/balanceSnapshots";
import { renderScreen } from "../../test/render";
import { PwaAssetWorkspace } from "./PwaAssetWorkspace";

const activeChain: BrowserChainRecord = {
  id: "chain-ethereum",
  chainId: 1,
  name: "Ethereum",
  nativeCurrencySymbol: "ETH",
  explorerUrl: "https://etherscan.io",
  enabled: true,
  rpcEndpoints: [],
  feeDraft: {
    mode: "eip1559",
    gasLimit: "21000",
    gasPriceGwei: "",
    maxFeePerGasGwei: "30",
    maxPriorityFeePerGasGwei: "1.5",
    baseFeeMultiplier: "2",
  },
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z",
};

const primaryRpc: BrowserRpcEndpoint = {
  id: "rpc-mainnet",
  label: "Mainnet RPC",
  url: "https://example.invalid",
  enabled: true,
  primary: true,
};

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof PwaAssetWorkspace>> = {}) {
  const props: React.ComponentProps<typeof PwaAssetWorkspace> = {
    activeChain,
    primaryRpc,
    assetRegistry: createDefaultBrowserAssetRegistryState(),
    refreshState: EMPTY_ASSET_BALANCE_SNAPSHOT_STATE,
    selectedAccounts: [{ id: "account-1", address: "0x0000000000000000000000000000000000000001", label: "账户 1" }],
    totalAccountCount: 1,
    unlocked: true,
    busy: false,
    error: null,
    onAddWatchedAsset: vi.fn(),
    onRemoveWatchedAsset: vi.fn(),
    onRefreshBalances: vi.fn(),
    ...overrides,
  };

  renderScreen(<PwaAssetWorkspace {...props} />);
  return props;
}

describe("PwaAssetWorkspace", () => {
  it("shows the locked state, disables refresh, and has no send controls", () => {
    renderWorkspace({ unlocked: false });

    expect(screen.getByText("解锁 vault 后才能刷新本地账户余额")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新余额" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /签名|广播|提交|approve|分发|归集/i })).not.toBeInTheDocument();
  });

  it("shows no-selected-account state and keeps refresh disabled", () => {
    renderWorkspace({ selectedAccounts: [], totalAccountCount: 3 });

    expect(screen.getByText("请选择至少一个本地账户后再刷新余额。")).toBeInTheDocument();
    expect(screen.getByText("账户 0 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新余额" })).toBeDisabled();
  });

  it("renders chain mismatch details without enabling refresh-side effects", () => {
    renderWorkspace({
      refreshState: {
        ...EMPTY_ASSET_BALANCE_SNAPSHOT_STATE,
        status: "chain-mismatch",
        stale: true,
        chainValidation: { expectedChainId: 1, actualChainId: 8453 },
      },
    });

    expect(screen.getByText("链不匹配")).toBeInTheDocument();
    expect(screen.getByText("Chain ID 不匹配：期望 1，实际 8453")).toBeInTheDocument();
    expect(screen.getByText("旧快照")).toBeInTheDocument();
  });

  it("submits watchlist assets and removes existing token rows", () => {
    const onAddWatchedAsset = vi.fn();
    const onRemoveWatchedAsset = vi.fn();
    renderWorkspace({
      assetRegistry: {
        schemaVersion: 1,
        updatedAt: "2026-05-14T00:00:00.000Z",
        watchedErc20Assets: [
          {
            id: "asset-tok",
            chainId: 1,
            contractAddress: "0x00000000000000000000000000000000000000AA",
            symbol: "TOK",
            decimals: 18,
            label: "Token",
            enabled: true,
            createdAt: "2026-05-14T00:00:00.000Z",
            updatedAt: "2026-05-14T00:00:00.000Z",
          },
        ],
      },
      onAddWatchedAsset,
      onRemoveWatchedAsset,
    });

    fireEvent.change(screen.getByLabelText("合约地址"), {
      target: { value: "0x00000000000000000000000000000000000000bb" },
    });
    fireEvent.change(screen.getByLabelText("符号"), { target: { value: "new" } });
    fireEvent.change(screen.getByLabelText("精度"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "New Token" } });
    fireEvent.click(screen.getByRole("button", { name: "添加资产" }));

    expect(onAddWatchedAsset).toHaveBeenCalledWith({
      chainId: 1,
      contractAddress: "0x00000000000000000000000000000000000000bb",
      symbol: "new",
      decimals: 6,
      label: "New Token",
    });

    fireEvent.click(screen.getByRole("button", { name: "移除 TOK" }));
    expect(onRemoveWatchedAsset).toHaveBeenCalledWith("asset-tok");
  });

  it("renders partial refresh snapshots and failure messages", () => {
    const partialState: AssetBalanceSnapshotState = {
      status: "partial",
      stale: false,
      chainValidation: { expectedChainId: 1, actualChainId: 1 },
      nativeBalances: [
        {
          chainId: 1,
          accountAddress: "0x0000000000000000000000000000000000000001",
          accountLabel: "账户 1",
          balanceWei: "1000000000000000000",
          blockNumber: 123,
          refreshedAt: "2026-05-14T00:00:00.000Z",
        },
      ],
      erc20Balances: [
        {
          chainId: 1,
          tokenAddress: "0x00000000000000000000000000000000000000AA",
          tokenSymbol: "TOK",
          tokenDecimals: 18,
          accountAddress: "0x0000000000000000000000000000000000000001",
          accountLabel: "账户 1",
          balanceRaw: "1230000000000000000",
          blockNumber: 123,
          refreshedAt: "2026-05-14T00:00:00.000Z",
        },
      ],
      failures: [{ kind: "erc20", assetId: "asset-tok", message: "RPC timeout: token balance failed" }],
      refreshedAt: "2026-05-14T00:00:00.000Z",
    };

    renderWorkspace({ refreshState: partialState });

    expect(screen.getByText("部分失败")).toBeInTheDocument();
    expect(screen.getByText("1.0 ETH")).toBeInTheDocument();
    expect(screen.getByText("1.23 TOK")).toBeInTheDocument();
    expect(screen.getByText("RPC request failed: RPC timeout: token balance failed")).toBeInTheDocument();
  });

  it("formats zero, trimmed decimals, tiny values, and large balances", () => {
    const state: AssetBalanceSnapshotState = {
      status: "success",
      stale: false,
      chainValidation: { expectedChainId: 1, actualChainId: 1 },
      nativeBalances: [
        {
          chainId: 1,
          accountAddress: "0x0000000000000000000000000000000000000001",
          accountLabel: "账户 1",
          balanceWei: "0",
          blockNumber: 123,
          refreshedAt: "2026-05-14T00:00:00.000Z",
        },
        {
          chainId: 1,
          accountAddress: "0x0000000000000000000000000000000000000002",
          accountLabel: "账户 2",
          balanceWei: "123456789123456789123456789",
          blockNumber: 123,
          refreshedAt: "2026-05-14T00:00:00.000Z",
        },
      ],
      erc20Balances: [
        {
          chainId: 1,
          tokenAddress: "0x00000000000000000000000000000000000000AA",
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          accountAddress: "0x0000000000000000000000000000000000000001",
          accountLabel: "账户 1",
          balanceRaw: "1230000",
          blockNumber: 123,
          refreshedAt: "2026-05-14T00:00:00.000Z",
        },
        {
          chainId: 1,
          tokenAddress: "0x00000000000000000000000000000000000000BB",
          tokenSymbol: "TINY",
          tokenDecimals: 6,
          accountAddress: "0x0000000000000000000000000000000000000001",
          accountLabel: "账户 1",
          balanceRaw: "1",
          blockNumber: 123,
          refreshedAt: "2026-05-14T00:00:00.000Z",
        },
      ],
      failures: [],
      refreshedAt: "2026-05-14T00:00:00.000Z",
    };

    renderWorkspace({ refreshState: state });

    expect(screen.getByText("0.0 ETH")).toBeInTheDocument();
    expect(screen.getByText("123456789.123456789123456789 ETH")).toBeInTheDocument();
    expect(screen.getByText("1.23 USDC")).toBeInTheDocument();
    expect(screen.getByText("0.000001 TINY")).toBeInTheDocument();
  });

  it("sanitizes top-level and failure error messages before rendering", () => {
    const sensitiveUrl = "https://rpc.example.com/project/secret-token?apiKey=abc123";
    const failedState: AssetBalanceSnapshotState = {
      ...EMPTY_ASSET_BALANCE_SNAPSHOT_STATE,
      status: "failed",
      failures: [{ kind: "native", accountAddress: activeChain.id, message: `RPC failed at ${sensitiveUrl}` }],
    };

    renderWorkspace({ error: `Could not reach ${sensitiveUrl}`, refreshState: failedState });

    expect(screen.getAllByText(/Could not reach \[redacted-url\]|RPC failed at \[redacted-url\]/).length).toBe(2);
    expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
    expect(screen.queryByText(/apiKey/)).not.toBeInTheDocument();
  });
});
