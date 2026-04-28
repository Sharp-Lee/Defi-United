export type FeeRisk = "normal" | "high";

export interface TransferDraftInput {
  chainId: bigint;
  from: string;
  to: string;
  valueWei: bigint;
  nonce: number;
  gasLimit: bigint;
  latestBaseFeePerGas: bigint | null;
  baseFeePerGas: bigint;
  baseFeeMultiplier: string;
  maxFeePerGas: bigint;
  maxFeeOverridePerGas: bigint | null;
  maxPriorityFeePerGas: bigint;
  liveMaxFeePerGas: bigint;
  liveMaxPriorityFeePerGas: bigint;
  estimatedGasLimit: bigint;
}

export interface TransferDraft {
  frozenKey: string;
  feeRisk: FeeRisk;
  requiresSecondConfirmation: boolean;
  submission: TransferDraftInput;
}

export function createTransferDraft(input: TransferDraftInput): TransferDraft {
  const highFee = input.maxFeePerGas > input.liveMaxFeePerGas * 3n;
  const highBaseFee =
    input.latestBaseFeePerGas !== null &&
    input.latestBaseFeePerGas > 0n &&
    input.baseFeePerGas > input.latestBaseFeePerGas * 3n;
  const highTip =
    input.liveMaxPriorityFeePerGas > 0n &&
    input.maxPriorityFeePerGas > input.liveMaxPriorityFeePerGas * 3n;
  const highGasLimit = input.gasLimit > input.estimatedGasLimit * 2n;

  return {
    frozenKey: [
      input.chainId.toString(),
      input.from,
      input.to,
      input.valueWei.toString(),
      input.nonce.toString(),
      input.gasLimit.toString(),
      input.latestBaseFeePerGas?.toString() ?? "unavailable",
      input.baseFeePerGas.toString(),
      input.baseFeeMultiplier,
      input.maxFeePerGas.toString(),
      input.maxFeeOverridePerGas?.toString() ?? "auto",
      input.maxPriorityFeePerGas.toString(),
    ].join(":"),
    feeRisk: highFee || highBaseFee || highTip || highGasLimit ? "high" : "normal",
    requiresSecondConfirmation: highFee || highBaseFee || highTip || highGasLimit,
    submission: input,
  };
}
