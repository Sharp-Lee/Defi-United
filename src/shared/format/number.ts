export function formatEstimatedNativeCost(gasLimit: string, feePerGasGwei: string): string {
  const gas = Number(gasLimit);
  const fee = Number(feePerGasGwei);
  if (!Number.isFinite(gas) || !Number.isFinite(fee) || gas <= 0 || fee <= 0) return "--";
  return ((gas * fee) / 1_000_000_000).toFixed(8);
}
