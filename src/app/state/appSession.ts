import { getPrimaryRpcEndpoint, type BrowserChainRecord } from "../../core/chains";
import type { BrowserVaultSession } from "../../services/storage/browserVaultStorage";

export interface AppSessionSummary {
  accountCount: number;
  selectedAccountCount: number;
  activeChainName: string;
  baseFeeMultiplierLabel: string;
  maxFeeLabel: string;
  nativeSymbol: string;
  priorityFeeLabel: string;
  rpcLabel: string;
  vaultStateLabel: string;
}

function formatGweiLabel(value: string) {
  return value.trim().length > 0 ? `${value.trim()} gwei` : "--";
}

function formatMultiplierLabel(value: string) {
  return value.trim().length > 0 ? `${value.trim()}x` : "--";
}

export function summarizeAppSession(
  session: BrowserVaultSession | null,
  activeChain: BrowserChainRecord | null,
): AppSessionSummary {
  const accounts = session?.state.groups.flatMap((group) => group.accounts) ?? [];
  const feeDraft = activeChain?.feeDraft;
  return {
    accountCount: accounts.length,
    selectedAccountCount: accounts.filter((account) => account.selected).length,
    activeChainName: activeChain?.name ?? "未选择链",
    baseFeeMultiplierLabel: feeDraft ? formatMultiplierLabel(feeDraft.baseFeeMultiplier) : "--",
    maxFeeLabel: feeDraft
      ? formatGweiLabel(feeDraft.mode === "legacy" ? feeDraft.gasPriceGwei : feeDraft.maxFeePerGasGwei)
      : "--",
    nativeSymbol: activeChain?.nativeCurrencySymbol ?? "--",
    priorityFeeLabel: feeDraft && feeDraft.mode === "eip1559" ? formatGweiLabel(feeDraft.maxPriorityFeePerGasGwei) : "--",
    rpcLabel: getPrimaryRpcEndpoint(activeChain)?.label ?? "未配置 RPC",
    vaultStateLabel: session ? "已解锁" : "未解锁",
  };
}
