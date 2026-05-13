import type { BrowserWatchedErc20Asset } from "./browserAssetRegistry";
import { sanitizeRpcErrorMessage } from "../../services/rpc/browserJsonRpcClient";

export type AssetRefreshStatus =
  | "idle"
  | "validating-chain"
  | "refreshing"
  | "success"
  | "partial"
  | "failed"
  | "no-selected-accounts"
  | "chain-mismatch"
  | "no-rpc";

export interface AssetBalanceAccount {
  id: string;
  address: string;
  label?: string;
}

export interface AssetBalanceRpcClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<number>;
  getNativeBalance(accountAddress: string): Promise<string>;
  getErc20Balance(tokenAddress: string, accountAddress: string): Promise<string>;
}

export interface NativeBalanceSnapshot {
  chainId: number;
  accountAddress: string;
  accountLabel: string;
  balanceWei: string;
  blockNumber: number | null;
  refreshedAt: string;
}

export interface Erc20BalanceSnapshot {
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  accountAddress: string;
  accountLabel: string;
  balanceRaw: string;
  blockNumber: number | null;
  refreshedAt: string;
}

export interface AssetRefreshFailure {
  kind: "chain" | "block" | "native" | "erc20";
  message: string;
  accountId?: string;
  accountAddress?: string;
  assetId?: string;
  tokenAddress?: string;
}

export interface AssetBalanceSnapshotState {
  status: AssetRefreshStatus;
  stale: boolean;
  chainValidation: { expectedChainId: number | null; actualChainId: number | null };
  nativeBalances: NativeBalanceSnapshot[];
  erc20Balances: Erc20BalanceSnapshot[];
  failures: AssetRefreshFailure[];
  refreshedAt: string | null;
}

export interface RefreshAssetBalanceSnapshotsInput {
  activeChainId: number;
  accounts: AssetBalanceAccount[];
  watchedAssets: BrowserWatchedErc20Asset[];
  rpcClient: AssetBalanceRpcClient;
  previous?: AssetBalanceSnapshotState;
}

export const EMPTY_ASSET_BALANCE_SNAPSHOT_STATE: AssetBalanceSnapshotState = {
  status: "idle",
  stale: false,
  chainValidation: { expectedChainId: null, actualChainId: null },
  nativeBalances: [],
  erc20Balances: [],
  failures: [],
  refreshedAt: null,
};

function nowIso() {
  return new Date().toISOString();
}

function hasSnapshots(state: AssetBalanceSnapshotState | undefined) {
  return Boolean(state && (state.nativeBalances.length > 0 || state.erc20Balances.length > 0));
}

function previousNativeBalances(previous: AssetBalanceSnapshotState | undefined) {
  return previous?.nativeBalances ?? [];
}

function previousErc20Balances(previous: AssetBalanceSnapshotState | undefined) {
  return previous?.erc20Balances ?? [];
}

function createFailure(kind: AssetRefreshFailure["kind"], error: unknown, context: Omit<AssetRefreshFailure, "kind" | "message"> = {}) {
  return {
    kind,
    message: sanitizeRpcErrorMessage(error),
    ...context,
  };
}

function enabledAssetsForChain(watchedAssets: BrowserWatchedErc20Asset[], activeChainId: number) {
  return watchedAssets.filter((asset) => asset.enabled && asset.chainId === activeChainId);
}

function statusFromCounts(successCount: number, failureCount: number): AssetRefreshStatus {
  if (failureCount === 0) return "success";
  if (successCount === 0) return "failed";
  return "partial";
}

function accountLabel(account: AssetBalanceAccount) {
  return account.label?.trim() || account.address;
}

function keepPreviousSnapshots(
  previous: AssetBalanceSnapshotState | undefined,
  fallbackNativeBalances: NativeBalanceSnapshot[],
  fallbackErc20Balances: Erc20BalanceSnapshot[],
) {
  if (hasSnapshots(previous)) {
    return {
      stale: true,
      nativeBalances: previousNativeBalances(previous),
      erc20Balances: previousErc20Balances(previous),
    };
  }
  return {
    stale: false,
    nativeBalances: fallbackNativeBalances,
    erc20Balances: fallbackErc20Balances,
  };
}

export async function refreshAssetBalanceSnapshots({
  activeChainId,
  accounts,
  watchedAssets,
  rpcClient,
  previous,
}: RefreshAssetBalanceSnapshotsInput): Promise<AssetBalanceSnapshotState> {
  const startedAt = nowIso();
  if (accounts.length === 0) {
    return {
      status: "no-selected-accounts",
      stale: hasSnapshots(previous),
      chainValidation: { expectedChainId: activeChainId, actualChainId: null },
      nativeBalances: previousNativeBalances(previous),
      erc20Balances: previousErc20Balances(previous),
      failures: [],
      refreshedAt: startedAt,
    };
  }

  let actualChainId: number;
  try {
    actualChainId = await rpcClient.getChainId();
  } catch (error) {
    const retained = keepPreviousSnapshots(previous, [], []);
    return {
      status: "failed",
      stale: retained.stale,
      chainValidation: { expectedChainId: activeChainId, actualChainId: null },
      nativeBalances: retained.nativeBalances,
      erc20Balances: retained.erc20Balances,
      failures: [createFailure("chain", error)],
      refreshedAt: startedAt,
    };
  }

  if (actualChainId !== activeChainId) {
    return {
      status: "chain-mismatch",
      stale: hasSnapshots(previous),
      chainValidation: { expectedChainId: activeChainId, actualChainId },
      nativeBalances: previousNativeBalances(previous),
      erc20Balances: previousErc20Balances(previous),
      failures: [],
      refreshedAt: startedAt,
    };
  }

  let blockNumber: number;
  try {
    blockNumber = await rpcClient.getBlockNumber();
  } catch (error) {
    const retained = keepPreviousSnapshots(previous, [], []);
    return {
      status: "failed",
      stale: retained.stale,
      chainValidation: { expectedChainId: activeChainId, actualChainId },
      nativeBalances: retained.nativeBalances,
      erc20Balances: retained.erc20Balances,
      failures: [createFailure("block", error)],
      refreshedAt: startedAt,
    };
  }

  const nativeBalances: NativeBalanceSnapshot[] = [];
  const erc20Balances: Erc20BalanceSnapshot[] = [];
  const failures: AssetRefreshFailure[] = [];
  const activeWatchedAssets = enabledAssetsForChain(watchedAssets, activeChainId);

  for (const account of accounts) {
    try {
      nativeBalances.push({
        chainId: activeChainId,
        accountAddress: account.address,
        accountLabel: accountLabel(account),
        balanceWei: await rpcClient.getNativeBalance(account.address),
        blockNumber,
        refreshedAt: startedAt,
      });
    } catch (error) {
      failures.push(createFailure("native", error, { accountId: account.id, accountAddress: account.address }));
    }
  }

  for (const asset of activeWatchedAssets) {
    for (const account of accounts) {
      try {
        erc20Balances.push({
          chainId: activeChainId,
          tokenAddress: asset.contractAddress,
          tokenSymbol: asset.symbol,
          tokenDecimals: asset.decimals,
          accountAddress: account.address,
          accountLabel: accountLabel(account),
          balanceRaw: await rpcClient.getErc20Balance(asset.contractAddress, account.address),
          blockNumber,
          refreshedAt: startedAt,
        });
      } catch (error) {
        failures.push(
          createFailure("erc20", error, {
            accountId: account.id,
            accountAddress: account.address,
            assetId: asset.id,
            tokenAddress: asset.contractAddress,
          }),
        );
      }
    }
  }

  const successCount = nativeBalances.length + erc20Balances.length;
  const status = statusFromCounts(successCount, failures.length);
  const retained =
    status === "failed" ? keepPreviousSnapshots(previous, nativeBalances, erc20Balances) : undefined;
  return {
    status,
    stale: retained?.stale ?? false,
    chainValidation: { expectedChainId: activeChainId, actualChainId },
    nativeBalances: retained?.nativeBalances ?? nativeBalances,
    erc20Balances: retained?.erc20Balances ?? erc20Balances,
    failures,
    refreshedAt: startedAt,
  };
}
