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
      latestBaseFeePerGas: 10n,
      baseFeePerGas: 10n,
      baseFeeMultiplier: "2",
      maxFeePerGas: 150n,
      maxFeeOverridePerGas: 150n,
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
      latestBaseFeePerGas: 10n,
      baseFeePerGas: 10n,
      baseFeeMultiplier: "2",
      maxFeePerGas: 40n,
      maxFeeOverridePerGas: null,
      maxPriorityFeePerGas: 20n,
      liveMaxFeePerGas: 40n,
      liveMaxPriorityFeePerGas: 1n,
      estimatedGasLimit: 21_000n,
    });

    expect(draft.feeRisk).toBe("high");
    expect(draft.requiresSecondConfirmation).toBe(true);
  });

  it("flags fee risk when the used base fee is far above the latest base fee", () => {
    const draft = createTransferDraft({
      chainId: 1n,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      valueWei: 10n,
      nonce: 7,
      gasLimit: 21_000n,
      latestBaseFeePerGas: 10n,
      baseFeePerGas: 31n,
      baseFeeMultiplier: "2",
      maxFeePerGas: 64n,
      maxFeeOverridePerGas: null,
      maxPriorityFeePerGas: 2n,
      liveMaxFeePerGas: 64n,
      liveMaxPriorityFeePerGas: 2n,
      estimatedGasLimit: 21_000n,
    });

    expect(draft.feeRisk).toBe("high");
    expect(draft.requiresSecondConfirmation).toBe(true);
  });

  it("freezes the base fee controls and max fee override choice", () => {
    const draft = createTransferDraft({
      chainId: 1n,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      valueWei: 10n,
      nonce: 7,
      gasLimit: 21_000n,
      latestBaseFeePerGas: 10n,
      baseFeePerGas: 11n,
      baseFeeMultiplier: "1.5",
      maxFeePerGas: 19n,
      maxFeeOverridePerGas: null,
      maxPriorityFeePerGas: 2n,
      liveMaxFeePerGas: 19n,
      liveMaxPriorityFeePerGas: 2n,
      estimatedGasLimit: 21_000n,
    });

    expect(draft.frozenKey).toContain(":10:11:1.5:19:auto:2");
  });
});
