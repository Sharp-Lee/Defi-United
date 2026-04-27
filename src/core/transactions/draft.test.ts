import { describe, expect, it } from "vitest";
import { createTransferDraft } from "./draft";

describe("createTransferDraft", () => {
  it("flags fee risk when maxFeePerGas is far above the live reference fee", () => {
    const draft = createTransferDraft({
      chainId: 1n,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      valueWei: 10n,
      nonce: 7,
      gasLimit: 21_000n,
      maxFeePerGas: 150n,
      maxPriorityFeePerGas: 5n,
      liveMaxFeePerGas: 40n,
      liveMaxPriorityFeePerGas: 2n,
      estimatedGasLimit: 21_000n,
    });

    expect(draft.feeRisk).toBe("high");
    expect(draft.requiresSecondConfirmation).toBe(true);
  });

  it("flags fee risk when the priority fee is far above the live priority reference", () => {
    const draft = createTransferDraft({
      chainId: 1n,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      valueWei: 10n,
      nonce: 7,
      gasLimit: 21_000n,
      maxFeePerGas: 40n,
      maxPriorityFeePerGas: 20n,
      liveMaxFeePerGas: 40n,
      liveMaxPriorityFeePerGas: 1n,
      estimatedGasLimit: 21_000n,
    });

    expect(draft.feeRisk).toBe("high");
    expect(draft.requiresSecondConfirmation).toBe(true);
  });
});
