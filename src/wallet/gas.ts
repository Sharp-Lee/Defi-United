import { JsonRpcProvider, formatEther, formatUnits } from "ethers";

export interface FeeSnapshot {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gasPrice: bigint;
}

export async function getFees(provider: JsonRpcProvider): Promise<FeeSnapshot> {
  const fee = await provider.getFeeData();
  const maxFeePerGas = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? 1_500_000_000n;
  const gasPrice = fee.gasPrice ?? maxFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas, gasPrice };
}

export function fmtEth(wei: bigint, digits = 6): string {
  const s = formatEther(wei);
  const [a, b = ""] = s.split(".");
  return b ? `${a}.${b.slice(0, digits)}` : a;
}

export function fmtGwei(wei: bigint, digits = 2): string {
  const s = formatUnits(wei, "gwei");
  const [a, b = ""] = s.split(".");
  return b ? `${a}.${b.slice(0, digits)}` : a;
}

export function estimateDistributeGas(n: number): bigint {
  // Disperse.disperseEther: ~30000 base + ~35000 per recipient (transfer + array overhead).
  // Conservative; we still recompute via estimateGas before broadcast.
  return BigInt(30_000 + n * 35_000);
}

export const PLAIN_TRANSFER_GAS = 21_000n;
