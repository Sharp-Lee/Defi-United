export interface ChainRecord {
  id: string;
  name: string;
  chainId: bigint;
  nativeSymbol: string;
  rpcUrl: string;
}

export const BUILT_IN_CHAINS: ChainRecord[] = [
  { id: "eth-mainnet", name: "Ethereum", chainId: 1n, nativeSymbol: "ETH", rpcUrl: "" },
  { id: "base-mainnet", name: "Base", chainId: 8453n, nativeSymbol: "ETH", rpcUrl: "" },
  { id: "arb-mainnet", name: "Arbitrum", chainId: 42161n, nativeSymbol: "ETH", rpcUrl: "" },
  { id: "op-mainnet", name: "Optimism", chainId: 10n, nativeSymbol: "ETH", rpcUrl: "" },
  { id: "bsc-mainnet", name: "BSC", chainId: 56n, nativeSymbol: "BNB", rpcUrl: "" },
  { id: "polygon-mainnet", name: "Polygon", chainId: 137n, nativeSymbol: "POL", rpcUrl: "" },
];

export async function validateCustomRpc(
  chain: ChainRecord,
  fetchChainId: (rpcUrl: string) => Promise<bigint>,
) {
  const remoteChainId = await fetchChainId(chain.rpcUrl);
  if (remoteChainId !== chain.chainId) {
    throw new Error(
      `Remote chainId ${remoteChainId} does not match expected chainId ${chain.chainId}`,
    );
  }
  return { ...chain, chainId: remoteChainId };
}
