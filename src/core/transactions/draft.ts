export type FeeRisk = "normal" | "high";

export interface TransferDraftInput {
  chainId: bigint;
  from: string;
  to: string;
  valueWei: bigint;
  nonce: number;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  liveMaxFeePerGas: bigint;
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
  const highTip =
    input.liveMaxFeePerGas > 0n &&
    input.maxPriorityFeePerGas > input.liveMaxFeePerGas * 3n;
  const highGasLimit = input.gasLimit > input.estimatedGasLimit * 2n;

  return {
    frozenKey: [
      input.chainId.toString(),
      input.from,
      input.to,
      input.valueWei.toString(),
      input.nonce.toString(),
      input.gasLimit.toString(),
      input.maxFeePerGas.toString(),
      input.maxPriorityFeePerGas.toString(),
    ].join(":"),
    feeRisk: highFee || highTip || highGasLimit ? "high" : "normal",
    requiresSecondConfirmation: highFee || highTip || highGasLimit,
    submission: input,
  };
}
