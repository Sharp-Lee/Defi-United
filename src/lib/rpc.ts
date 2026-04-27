import { JsonRpcProvider } from "ethers";

export interface AccountChainState {
  accountAddress?: string | null;
  nativeBalanceWei: bigint | null;
  nonce: number | null;
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
}

export async function readAccountState(rpcUrl: string, address: string): Promise<AccountChainState> {
  const provider = new JsonRpcProvider(rpcUrl);
  const [nativeBalanceWei, nonce] = await Promise.all([
    provider.getBalance(address),
    provider.getTransactionCount(address),
  ]);
  return {
    accountAddress: address,
    nativeBalanceWei,
    nonce,
    lastSyncedAt: null,
    lastSyncError: null,
  };
}

export async function probeChainId(rpcUrl: string): Promise<bigint> {
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  return network.chainId;
}
