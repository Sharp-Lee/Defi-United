import { JsonRpcProvider } from "ethers";

export interface NetworkInfo {
  chainId: bigint;
  name: string;
  blockNumber: number;
}

export function makeProvider(rpcUrl: string): JsonRpcProvider {
  // staticNetwork=true would skip auto-detection; we want detection for safety.
  return new JsonRpcProvider(rpcUrl);
}

export async function probeNetwork(provider: JsonRpcProvider): Promise<NetworkInfo> {
  const [net, blockNumber] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber(),
  ]);
  return { chainId: net.chainId, name: net.name, blockNumber };
}

export function isMainnet(info: NetworkInfo | null): boolean {
  return !!info && info.chainId === 1n;
}
