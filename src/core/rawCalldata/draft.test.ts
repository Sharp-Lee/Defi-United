import { describe, expect, it } from "vitest";
import { keccak256 } from "ethers";
import {
  RAW_CALLDATA_HASH_VERSION,
  RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS,
  RAW_CALLDATA_HUMAN_PREVIEW_MAX_ROWS,
  RAW_CALLDATA_MAX_BYTES,
  buildRawCalldataDraft,
  buildRawCalldataPreview,
  normalizeRawCalldata,
  type BuildRawCalldataDraftInput,
  type RawCalldataWarningCode,
} from "./draft";

const baseInput: BuildRawCalldataDraftInput = {
  chainId: 1n,
  selectedRpc: {
    chainId: 1n,
    providerConfigId: "mainnet",
    endpointId: "primary",
    endpointName: "Primary",
    endpointSummary: "https://rpc.example",
    endpointFingerprint: "rpc-fp-1",
  },
  fromAccountIndex: 0,
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  valueWei: 0n,
  calldata: "0x12345678",
  nonce: 7,
  fee: {
    gasLimit: 21_000n,
    estimatedGasLimit: 21_000n,
    manualGas: false,
    latestBaseFeePerGas: 10n,
    baseFeePerGas: 10n,
    baseFeeMultiplier: "1",
    maxFeePerGas: 12n,
    maxFeeOverridePerGas: null,
    maxPriorityFeePerGas: 2n,
    liveMaxFeePerGas: 12n,
    liveMaxPriorityFeePerGas: 2n,
  },
  inference: {
    status: "matched",
    matchedSource: {
      identity: "verified-abi",
      version: "v1",
      fingerprint: "source-fp",
      abiHash: "abi-hash",
      functionSignature: "transfer(address,uint256)",
    },
    selectorMatchCount: 1,
    sourceStatus: "ok",
  },
  warningAcknowledgements: {},
  createdAt: "2026-04-29T00:00:00.000Z",
};

describe("normalizeRawCalldata", () => {
  it("rejects malformed calldata", () => {
    expect(normalizeRawCalldata("1234")).toMatchObject({
      ok: false,
      error: { code: "missing0xPrefix" },
    });
    expect(normalizeRawCalldata("0x123")).toMatchObject({
      ok: false,
      error: { code: "oddLength" },
    });
    expect(normalizeRawCalldata("0x12zz")).toMatchObject({
      ok: false,
      error: { code: "nonHex" },
    });
  });

  it("allows empty 0x and canonicalizes lowercase display", () => {
    expect(normalizeRawCalldata(" 0xABCDEF ")).toEqual({
      ok: true,
      canonical: "0xabcdef",
      byteLength: 3,
    });
    expect(normalizeRawCalldata("0x")).toEqual({
      ok: true,
      canonical: "0x",
      byteLength: 0,
    });
  });

  it("accepts exactly 128 KiB and rejects larger calldata", () => {
    const max = `0x${"aa".repeat(RAW_CALLDATA_MAX_BYTES)}`;
    const tooLarge = `${max}aa`;

    expect(normalizeRawCalldata(max)).toMatchObject({
      ok: true,
      byteLength: RAW_CALLDATA_MAX_BYTES,
    });
    expect(normalizeRawCalldata(tooLarge)).toMatchObject({
      ok: false,
      error: { code: "calldataTooLarge" },
    });
  });
});

describe("buildRawCalldataPreview", () => {
  it("reports empty, short, and normal selector states", () => {
    expect(buildRawCalldataPreview("0x").selectorStatus).toBe("none");
    expect(buildRawCalldataPreview("0x123456").selectorStatus).toBe("short");

    const preview = buildRawCalldataPreview("0xA9059CBB0000");
    expect(preview.selectorStatus).toBe("present");
    expect(preview.selector).toBe("0xa9059cbb");
  });

  it("includes keccak256-v1 hash and canonical lowercase calldata", () => {
    const preview = buildRawCalldataPreview("0xA9059CBB0000");

    expect(preview.canonical).toBe("0xa9059cbb0000");
    expect(preview.hashVersion).toBe(RAW_CALLDATA_HASH_VERSION);
    expect(preview.hash).toBe(keccak256("0xa9059cbb0000"));
    expect(buildRawCalldataPreview("0x").hash).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });

  it("bounds large calldata preview with prefix, suffix, and omitted byte count", () => {
    const calldata = `0x${"11".repeat(40)}${"22".repeat(10)}${"33".repeat(40)}`;
    const preview = buildRawCalldataPreview(calldata);

    expect(preview.byteLength).toBe(90);
    expect(preview.truncated).toBe(true);
    expect(preview.omittedBytes).toBe(26);
    expect(preview.prefix).toBe(`0x${"11".repeat(32)}`);
    expect(preview.suffix).toBe(`0x${"33".repeat(32)}`);
    expect(preview.display).toBe(`${preview.prefix}...${preview.suffix.slice(2)}`);
  });

  it("bounds human preview rows and text", () => {
    const rows = Array.from({ length: RAW_CALLDATA_HUMAN_PREVIEW_MAX_ROWS + 3 }, (_, index) => ({
      label: `row ${index} ${"label".repeat(12)}`,
      value: "x".repeat(RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS + index + 1),
    }));
    const preview = buildRawCalldataPreview("0x12345678", rows);

    expect(preview.human.rows).toHaveLength(RAW_CALLDATA_HUMAN_PREVIEW_MAX_ROWS);
    expect(preview.human.truncatedRows).toBe(true);
    expect(preview.human.omittedRows).toBe(3);
    expect(preview.human.rows[0].displayText).toHaveLength(RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS);
    expect(preview.human.rows[0].displayText).toBe(
      `${preview.human.rows[0].label}: ${preview.human.rows[0].value}`.slice(
        0,
        RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS,
      ),
    );
    expect(preview.human.rows[0].truncated).toBe(true);
  });
});

describe("buildRawCalldataDraft", () => {
  it("allows empty calldata only after acknowledgement", () => {
    const unacknowledged = buildRawCalldataDraft({ ...baseInput, calldata: "0x" });
    expect(warningCodes(unacknowledged)).toContain("emptyCalldata");
    expect(unacknowledged.canSubmit).toBe(false);

    const acknowledged = buildRawCalldataDraft({
      ...baseInput,
      calldata: "0x",
      warningAcknowledgements: { emptyCalldata: true, unknownSelector: true },
    });
    expect(acknowledged.canSubmit).toBe(true);
  });

  it("models inference warnings and acknowledgement requirements", () => {
    expect(buildRawCalldataDraft(baseInput).warnings).toEqual([]);

    const cases: Array<[BuildRawCalldataDraftInput["inference"], RawCalldataWarningCode]> = [
      [{ status: "unknown", selectorMatchCount: 0 }, "unknownSelector"],
      [
        { status: "conflict", selectorMatchCount: 2, conflictSummary: "two matches" },
        "selectorConflict",
      ],
      [{ status: "stale", staleSummary: "cache expired" }, "staleInference"],
      [{ status: "unavailable", sourceStatus: "rpc failed" }, "inferenceUnavailable"],
    ];

    for (const [inference, code] of cases) {
      const draft = buildRawCalldataDraft({ ...baseInput, inference });
      expect(warningCodes(draft)).toContain(code);
      expect(draft.warnings.find((warning) => warning.code === code)).toMatchObject({
        requiresAcknowledgement: true,
        acknowledged: false,
      });
      expect(draft.canSubmit).toBe(false);
      expect(
        buildRawCalldataDraft({
          ...baseInput,
          inference,
          warningAcknowledgements: { [code]: true },
        }).canSubmit,
      ).toBe(true);
    }
  });

  it("treats matched inference as unknown when calldata has no full selector", () => {
    const draft = buildRawCalldataDraft({
      ...baseInput,
      calldata: "0x123456",
      inference: baseInput.inference,
    });

    expect(draft.preview.selectorStatus).toBe("short");
    expect(draft.inference).toMatchObject({
      status: "unknown",
      selectorMatchCount: 0,
      sourceStatus: "selectorTooShort",
    });
    expect(warningCodes(draft)).toContain("unknownSelector");
    expect(draft.canSubmit).toBe(false);

    expect(
      buildRawCalldataDraft({
        ...baseInput,
        calldata: "0x123456",
        inference: baseInput.inference,
        warningAcknowledgements: { unknownSelector: true },
      }).canSubmit,
    ).toBe(true);
  });

  it("blocks a selected RPC that has no validated chain id", () => {
    const draft = buildRawCalldataDraft({
      ...baseInput,
      selectedRpc: { ...baseInput.selectedRpc, chainId: null },
    });

    expect(draft.submission).toBeNull();
    expect(draft.canSubmit).toBe(false);
    expect(draft.blockingStatuses).toMatchObject([{ code: "unvalidatedRpcChain" }]);
  });

  it("normalizes RPC chain id to JSON-safe number in submission and frozen key", () => {
    const bigintRpcDraft = buildRawCalldataDraft(baseInput);
    const numberRpcDraft = buildRawCalldataDraft({
      ...baseInput,
      selectedRpc: { ...baseInput.selectedRpc, chainId: 1 },
    });

    expect(bigintRpcDraft.frozenKey).toBe(numberRpcDraft.frozenKey);
    expect(bigintRpcDraft.submission?.selectedRpc?.chainId).toBe(1);
    expect(typeof bigintRpcDraft.submission?.selectedRpc?.chainId).toBe("number");
    expect(() => JSON.stringify(bigintRpcDraft.submission)).not.toThrow();
  });

  it("gates high-risk warning acknowledgements", () => {
    const riskyInput = {
      ...baseInput,
      valueWei: 1n,
      fee: {
        ...baseInput.fee,
        manualGas: true,
        gasLimit: 50_000n,
        maxFeePerGas: 100n,
        liveMaxFeePerGas: 10n,
      },
    };

    const draft = buildRawCalldataDraft(riskyInput);
    expect(warningCodes(draft)).toEqual(["nonzeroValue", "manualGas", "highFee"]);
    expect(draft.canSubmit).toBe(false);

    expect(
      buildRawCalldataDraft({
        ...riskyInput,
        warningAcknowledgements: {
          nonzeroValue: true,
          manualGas: true,
          highFee: true,
        },
      }).canSubmit,
    ).toBe(true);
  });

  it("warns on large calldata and keeps preview bounded", () => {
    const largeInput = {
      ...baseInput,
      calldata: `0x${"aa".repeat(RAW_CALLDATA_MAX_BYTES / 2 + 1)}`,
    };
    const draft = buildRawCalldataDraft(largeInput);

    expect(warningCodes(draft)).toContain("largeCalldata");
    expect(draft.preview.truncated).toBe(true);
    expect(draft.preview.prefix).toHaveLength(66);
    expect(draft.preview.suffix).toHaveLength(66);
    expect(draft.submission?.calldataByteLength).toBe(RAW_CALLDATA_MAX_BYTES / 2 + 1);
    expect(draft.canSubmit).toBe(false);
  });

  it("blocks malformed calldata drafts", () => {
    const draft = buildRawCalldataDraft({ ...baseInput, calldata: "0x123" });

    expect(draft.submission).toBeNull();
    expect(draft.canSubmit).toBe(false);
    expect(draft.blockingStatuses).toMatchObject([{ code: "oddLength" }]);
  });

  it("changes frozen key for covered transaction, preview, acknowledgement, and inference fields", () => {
    const frozenKey = buildRawCalldataDraft(baseInput).frozenKey;
    const changedInputs: BuildRawCalldataDraftInput[] = [
      { ...baseInput, chainId: 5n, selectedRpc: { ...baseInput.selectedRpc, chainId: 5n } },
      {
        ...baseInput,
        selectedRpc: { ...baseInput.selectedRpc, endpointFingerprint: "rpc-fp-2" },
      },
      { ...baseInput, from: "0x3333333333333333333333333333333333333333" },
      { ...baseInput, to: "0x4444444444444444444444444444444444444444" },
      { ...baseInput, valueWei: 1n, warningAcknowledgements: { nonzeroValue: true } },
      { ...baseInput, calldata: "0x87654321" },
      { ...baseInput, fee: { ...baseInput.fee, gasLimit: 22_000n, manualGas: true }, warningAcknowledgements: { manualGas: true } },
      { ...baseInput, fee: { ...baseInput.fee, maxFeePerGas: 13n } },
      { ...baseInput, nonce: 8 },
      { ...baseInput, inference: { status: "unknown", selectorMatchCount: 0 }, warningAcknowledgements: { unknownSelector: true } },
      {
        ...baseInput,
        inference: {
          status: "matched",
          matchedSource: { identity: "other", version: "v2", fingerprint: "fp2", abiHash: "hash2" },
          selectorMatchCount: 1,
        },
      },
    ];

    for (const changed of changedInputs) {
      expect(buildRawCalldataDraft(changed).frozenKey).not.toBe(frozenKey);
    }

    expect(
      buildRawCalldataDraft({
        ...baseInput,
        calldata: "0x",
        warningAcknowledgements: { emptyCalldata: false, unknownSelector: true },
      }).frozenKey,
    ).not.toBe(
      buildRawCalldataDraft({
        ...baseInput,
        calldata: "0x",
        warningAcknowledgements: { emptyCalldata: true, unknownSelector: true },
      }).frozenKey,
    );
  });
});

function warningCodes(draft: { warnings: Array<{ code: string }> }) {
  return draft.warnings.map((warning) => warning.code);
}
