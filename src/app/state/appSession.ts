import type { BrowserChainRecord } from "../../core/chains";
import type { BrowserVaultSession } from "../../services/storage/browserVaultStorage";

export interface AppSessionSummary {
  accountCount: number;
  selectedAccountCount: number;
  activeChainName: string;
  nativeSymbol: string;
  vaultStateLabel: string;
}

export function summarizeAppSession(
  session: BrowserVaultSession | null,
  activeChain: BrowserChainRecord | null,
): AppSessionSummary {
  const accounts = session?.state.groups.flatMap((group) => group.accounts) ?? [];
  return {
    accountCount: accounts.length,
    selectedAccountCount: accounts.filter((account) => account.selected).length,
    activeChainName: activeChain?.name ?? "未选择链",
    nativeSymbol: activeChain?.nativeCurrencySymbol ?? "--",
    vaultStateLabel: session ? "已解锁" : "未解锁",
  };
}
