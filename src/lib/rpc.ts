import { JsonRpcProvider } from "ethers";

export interface AccountChainState {
  nativeBalanceWei: bigint;
  nonce: number;
}

export async function readAccountState(rpcUrl: string, address: string): Promise<AccountChainState> {
  const provider = new JsonRpcProvider(rpcUrl);
  const [nativeBalanceWei, nonce] = await Promise.all([
    provider.getBalance(address),
    provider.getTransactionCount(address),
  ]);
  return { nativeBalanceWei, nonce };
}
