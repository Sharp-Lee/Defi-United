import { describe, expect, it } from "vitest";
import type { AbiCacheEntryRecord, AbiRegistryState } from "../../lib/tauri";
import type { AbiReadModelReason, AbiWriteDraftInput } from "./readModel";
import {
  buildAbiWriteDraft,
  buildAbiContractReadModel,
  findAbiReadModelEntry,
  listAbiReadModelEntries,
} from "./readModel";

function acceptReadModelReason(_reason: AbiReadModelReason) {}

// @ts-expect-error Success fetch/validation statuses are not read-model reasons.
acceptReadModelReason("ok");
// @ts-expect-error A fresh cache is the usable state, not a reason.
acceptReadModelReason("cacheFresh");
// @ts-expect-error A selected source is the usable state, not a reason.
acceptReadModelReason("selected");

const contract = "0x1111111111111111111111111111111111111111";
const otherContract = "0x2222222222222222222222222222222222222222";

function cacheEntry(
  versionId: string,
  overrides: Partial<AbiCacheEntryRecord> = {},
): AbiCacheEntryRecord {
  return {
    chainId: 1,
    contractAddress: contract,
    sourceKind: "explorerFetched",
    providerConfigId: "etherscan-mainnet",
    userSourceId: null,
    versionId,
    attemptId: `attempt-${versionId}`,
    sourceFingerprint: `fingerprint-${versionId}`,
    abiHash: `abi-hash-${versionId}`,
    selected: false,
    fetchSourceStatus: "ok",
    validationStatus: "ok",
    cacheStatus: "cacheFresh",
    selectionStatus: "unselected",
    functionCount: 2,
    eventCount: 1,
    errorCount: 1,
    selectorSummary: {
      functionSelectorCount: 2,
      eventTopicCount: 1,
      errorSelectorCount: 1,
      duplicateSelectorCount: 0,
      conflictCount: 0,
      notes: null,
    },
    fetchedAt: "1710000000",
    importedAt: null,
    lastValidatedAt: "1710000100",
    staleAfter: "1710003600",
    lastErrorSummary: null,
    providerProxyHint: null,
    proxyDetected: false,
    createdAt: "1710000000",
    updatedAt: "1710000100",
    ...overrides,
  };
}

function registry(cacheEntries: AbiCacheEntryRecord[]): AbiRegistryState {
  return {
    schemaVersion: 1,
    dataSources: [
      {
        id: "etherscan-mainnet",
        chainId: 1,
        providerKind: "etherscanCompatible",
        baseUrl: "https://rpc.example.invalid/api?apikey=base-url-secret",
        apiKeyRef: "env:ETHERSCAN_SECRET_KEY",
        enabled: true,
        lastSuccessAt: "1710000000",
        lastFailureAt: null,
        failureCount: 0,
        cooldownUntil: null,
        rateLimited: false,
        lastErrorSummary: null,
        createdAt: "1710000000",
        updatedAt: "1710000000",
      },
    ],
    cacheEntries,
  };
}

function fixtureEntries() {
  return [
    cacheEntry("stale", {
      sourceKind: "userImported",
      providerConfigId: null,
      userSourceId: "manual-file",
      cacheStatus: "cacheStale",
      selectionStatus: "selected",
      selected: true,
      fetchedAt: null,
      importedAt: "1710000200",
    }),
    cacheEntry("usable", {
      selected: true,
      selectionStatus: "selected",
    }),
    cacheEntry("pasted-conflict", {
      sourceKind: "userPasted",
      providerConfigId: null,
      userSourceId: "manual-paste",
      validationStatus: "selectorConflict",
      selectionStatus: "needsUserChoice",
      selectorSummary: {
        functionSelectorCount: 2,
        eventTopicCount: 1,
        errorSelectorCount: 1,
        duplicateSelectorCount: 1,
        conflictCount: 1,
        notes:
          "selector conflict from https://rpc.example.invalid/api?token=secret-value Bearer secret",
      },
    }),
    cacheEntry("source-conflict", {
      sourceKind: "userImported",
      providerConfigId: null,
      userSourceId: "manual-conflict",
      selected: false,
      cacheStatus: "cacheFresh",
      selectionStatus: "sourceConflict",
    }),
    cacheEntry("superseded", {
      selected: false,
      cacheStatus: "versionSuperseded",
      selectionStatus: "unselected",
    }),
    cacheEntry("other-contract", {
      contractAddress: otherContract,
      selected: true,
      selectionStatus: "selected",
    }),
  ];
}

describe("ABI read model", () => {
  it("selects a usable ABI by chain, contract, and selected source identity", () => {
    const state = registry(fixtureEntries());

    const model = buildAbiContractReadModel(state, {
      chainId: 1,
      contractAddress: contract.toUpperCase(),
      source: {
        sourceKind: "explorerFetched",
        providerConfigId: "etherscan-mainnet",
        userSourceId: null,
        versionId: "usable",
      },
    });

    expect(model.selectedEntry?.versionId).toBe("usable");
    expect(model.selectedEntry?.usable).toBe(true);
    expect(model.reasons).toEqual([]);
  });

  it("returns null and keeps stale, source conflict, and selector conflict reasons visible", () => {
    const state = registry(fixtureEntries());

    expect(
      buildAbiContractReadModel(state, {
        chainId: 1,
        contractAddress: contract,
        source: { sourceKind: "userImported", userSourceId: "manual-file", versionId: "stale" },
      }),
    ).toMatchObject({
      selectedEntry: null,
      reasons: ["cacheStale"],
    });

    expect(
      buildAbiContractReadModel(state, {
        chainId: 1,
        contractAddress: contract,
        source: {
          sourceKind: "userImported",
          userSourceId: "manual-conflict",
          versionId: "source-conflict",
        },
      }).reasons,
    ).toEqual(["notSelected", "sourceConflict"]);

    const selectorConflict = buildAbiContractReadModel(state, {
      chainId: 1,
      contractAddress: contract,
      source: {
        sourceKind: "userPasted",
        userSourceId: "manual-paste",
        versionId: "pasted-conflict",
      },
    });
    expect(selectorConflict.selectedEntry).toBeNull();
    expect(selectorConflict.reasons).toEqual([
      "notSelected",
      "selectorConflict",
      "needsUserChoice",
    ]);
    expect(
      selectorConflict.entries.find((entry) => entry.versionId === "pasted-conflict")
        ?.selectorSummary,
    ).toMatchObject({
      duplicateSelectorCount: 1,
      conflictCount: 1,
    });
  });

  it("aggregates concrete entry reasons when no source is requested and nothing is selected", () => {
    const model = buildAbiContractReadModel(
      registry([
        cacheEntry("selector-conflict", {
          selected: false,
          validationStatus: "selectorConflict",
          selectionStatus: "needsUserChoice",
        }),
        cacheEntry("stale-source-conflict", {
          sourceKind: "userImported",
          providerConfigId: null,
          userSourceId: "manual-stale-conflict",
          selected: false,
          cacheStatus: "cacheStale",
          selectionStatus: "sourceConflict",
        }),
      ]),
      {
        chainId: 1,
        contractAddress: contract,
      },
    );

    expect(model.selectedEntry).toBeNull();
    expect(model.reasons).toEqual(
      expect.arrayContaining([
        "needsUserChoice",
        "notSelected",
        "selectorConflict",
        "cacheStale",
        "sourceConflict",
      ]),
    );
    expect(model.reasons).not.toEqual(["needsUserChoice"]);
    expect(model.reasons).not.toContain("ok");
    expect(model.reasons).not.toContain("cacheFresh");
    expect(model.reasons).not.toContain("selected");
  });

  it("aggregates concrete entry reasons when the selected source is unusable", () => {
    const state = registry([
      cacheEntry("selected-stale", {
        selected: true,
        cacheStatus: "cacheStale",
        selectionStatus: "selected",
      }),
      cacheEntry("selector-conflict", {
        sourceKind: "userPasted",
        providerConfigId: null,
        userSourceId: "manual-selector-conflict",
        selected: false,
        validationStatus: "selectorConflict",
        selectionStatus: "needsUserChoice",
      }),
      cacheEntry("source-conflict", {
        sourceKind: "userImported",
        providerConfigId: null,
        userSourceId: "manual-source-conflict",
        selected: false,
        selectionStatus: "sourceConflict",
      }),
    ]);

    const model = buildAbiContractReadModel(state, {
      chainId: 1,
      contractAddress: contract,
    });

    expect(model.selectedEntry).toBeNull();
    expect(model.reasons).toEqual(
      expect.arrayContaining([
        "needsUserChoice",
        "cacheStale",
        "notSelected",
        "selectorConflict",
        "sourceConflict",
      ]),
    );

    expect(
      buildAbiContractReadModel(state, {
        chainId: 1,
        contractAddress: contract,
        source: {
          sourceKind: "explorerFetched",
          providerConfigId: "etherscan-mainnet",
          userSourceId: null,
          versionId: "selected-stale",
        },
      }).reasons,
    ).toEqual(["cacheStale"]);
  });

  it("lists entries in stable source order and can find an exact source entry", () => {
    const shuffled = [
      ...fixtureEntries(),
      cacheEntry("alpha_1"),
      cacheEntry("Alpha!"),
      cacheEntry("alpha-1"),
    ].reverse();
    const entries = listAbiReadModelEntries(registry(shuffled), {
      chainId: 1,
      contractAddress: contract,
    });

    expect(entries.map((entry) => entry.versionId)).toEqual([
      "Alpha!",
      "alpha-1",
      "alpha_1",
      "superseded",
      "usable",
      "source-conflict",
      "stale",
      "pasted-conflict",
    ]);
    expect(
      findAbiReadModelEntry(registry(shuffled), {
        chainId: 1,
        contractAddress: contract,
        sourceKind: "userPasted",
        providerConfigId: null,
        userSourceId: "manual-paste",
        versionId: "pasted-conflict",
      })?.selectionStatus,
    ).toBe("needsUserChoice");
  });

  it("does not expose provider config, raw ABI, RPC URL, or API-key material in summaries", () => {
    const state = registry(fixtureEntries());
    const modelWithProvider = buildAbiContractReadModel(state, {
      chainId: 1,
      contractAddress: contract,
    });
    const stateWithDifferentProvider = registry(fixtureEntries());
    stateWithDifferentProvider.dataSources[0] = {
      ...stateWithDifferentProvider.dataSources[0],
      baseUrl: "https://another.example.invalid/api?apikey=different-secret",
      apiKeyRef: "keychain:wallet-workbench/etherscan-mainnet",
    };
    const modelWithOtherProvider = buildAbiContractReadModel(stateWithDifferentProvider, {
      chainId: 1,
      contractAddress: contract,
    });

    expect(JSON.stringify(modelWithProvider)).toBe(JSON.stringify(modelWithOtherProvider));
    const serialized = JSON.stringify(modelWithProvider);
    expect(serialized).not.toContain("baseUrl");
    expect(serialized).not.toContain("apiKeyRef");
    expect(serialized).not.toContain("base-url-secret");
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain('"type":"function"');
    expect(serialized).toContain("[redacted_url]");
    expect(serialized).toContain("Bearer [redacted]");
  });

  it("returns unknown when no ABI entries match the chain and contract", () => {
    const model = buildAbiContractReadModel(registry(fixtureEntries()), {
      chainId: 137,
      contractAddress: contract,
    });

    expect(model.selectedEntry).toBeNull();
    expect(model.entries).toEqual([]);
    expect(model.reasons).toEqual(["unknown"]);
  });

  it("builds an ABI write draft from managed ABI identity and bounded preview summaries", () => {
    const entry = cacheEntry("usable", {
      selected: true,
      selectionStatus: "selected",
    });
    const longValue = "value-".repeat(80);
    const result = buildAbiWriteDraft({
      selectedChainId: 1,
      chainLabel: "Ethereum",
      accountIndex: 0,
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      rpcConfigured: true,
      selectedRpc: {
        chainId: 1,
        endpointSummary: "https://rpc.example.invalid/mainnet?apikey=secret-token / chainId 1",
      },
      entry,
      fn: {
        name: "deposit",
        signature: "deposit(string)",
        selector: "0xdeadbeef",
        stateMutability: "payable",
        callKind: "writeDraft",
        supported: true,
        unsupportedReason: null,
        inputs: [{ name: "memo", type: "string", kind: "string", arrayLength: null, components: null }],
        outputs: [],
      },
      preview: {
        status: "success",
        reasons: [],
        functionSignature: "deposit(string)",
        selector: "0xdeadbeef",
        contractAddress: contract,
        sourceKind: entry.sourceKind,
        providerConfigId: entry.providerConfigId,
        userSourceId: entry.userSourceId,
        versionId: entry.versionId,
        abiHash: entry.abiHash,
        sourceFingerprint: entry.sourceFingerprint,
        parameterSummary: [
          {
            kind: "string",
            type: "string",
            value: longValue,
            byteLength: longValue.length,
            hash: "0xargs",
            items: null,
            fields: null,
            truncated: true,
          },
        ],
        calldata: { byteLength: 68, hash: "0xcalldata" },
      },
      nativeValueWei: "5",
      gasLimit: "90000",
      latestBaseFeeGwei: "10",
      baseFeeGwei: "",
      baseFeeMultiplier: "2",
      maxFeeOverrideGwei: "",
      priorityFeeGwei: "1",
      nonce: "7",
      createdAt: "2026-04-29T01:02:03.000Z",
    });

    expect(result.blockingStatuses).toEqual([]);
    expect(result.draft).toMatchObject({
      chainId: 1,
      accountIndex: 0,
      contractAddress: contract,
      functionSignature: "deposit(string)",
      selector: "0xdeadbeef",
      nativeValueWei: "5",
      gasLimit: "90000",
      latestBaseFeePerGas: "10000000000",
      baseFeePerGas: "10000000000",
      maxFeePerGas: "21000000000",
      maxPriorityFeePerGas: "1000000000",
      nonce: 7,
      canSubmit: false,
    });
    expect(result.draft?.argumentSummary[0].value).toContain("[truncated]");
    expect(JSON.stringify(result.draft)).not.toContain(longValue);
    expect(JSON.stringify(result.draft)).not.toContain("secret-token");
    expect(result.draft?.selectedRpc?.endpointSummary).toContain("https://rpc.example.invalid");
  });

  it("freezes selected RPC identity into ABI write draft keys", () => {
    const entry = cacheEntry("usable", { selected: true, selectionStatus: "selected" });
    const baseInput: Omit<AbiWriteDraftInput, "selectedRpc"> = {
      selectedChainId: 1,
      chainLabel: "Ethereum",
      accountIndex: 0,
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      rpcConfigured: true,
      entry,
      fn: {
        name: "deposit",
        signature: "deposit(uint256)",
        selector: "0xb6b55f25",
        stateMutability: "payable",
        callKind: "writeDraft",
        supported: true,
        unsupportedReason: null,
        inputs: [],
        outputs: [],
      },
      preview: {
        status: "success",
        reasons: [],
        functionSignature: "deposit(uint256)",
        selector: "0xb6b55f25",
        contractAddress: contract,
        sourceKind: entry.sourceKind,
        providerConfigId: entry.providerConfigId,
        userSourceId: entry.userSourceId,
        versionId: entry.versionId,
        abiHash: entry.abiHash,
        sourceFingerprint: entry.sourceFingerprint,
        parameterSummary: [],
        calldata: { byteLength: 36, hash: "0xpreviewhash" },
      },
      nativeValueWei: "0",
      gasLimit: "90000",
      latestBaseFeeGwei: "10",
      baseFeeGwei: "",
      baseFeeMultiplier: "2",
      maxFeeOverrideGwei: "",
      priorityFeeGwei: "1",
      nonce: "7",
      createdAt: "2026-04-29T01:02:03.000Z",
    };

    const first = buildAbiWriteDraft({
      ...baseInput,
      selectedRpc: { chainId: 1, endpointSummary: "https://rpc.example/a?token=secret" },
    });
    const second = buildAbiWriteDraft({
      ...baseInput,
      selectedRpc: { chainId: 1, endpointSummary: "https://rpc.example/b?token=secret" },
    });
    const third = buildAbiWriteDraft({
      ...baseInput,
      selectedRpc: { chainId: 1, endpointSummary: "https://other-rpc.example/a?token=secret" },
    });
    const encodedKey = buildAbiWriteDraft({
      ...baseInput,
      selectedRpc: { chainId: 1, endpointSummary: "https://rpc.example/a?api%5Fkey=secret" },
    });
    const decodedKey = buildAbiWriteDraft({
      ...baseInput,
      selectedRpc: { chainId: 1, endpointSummary: "https://rpc.example/a?api_key=other-secret" },
    });
    const plusKeyFromRawSource = buildAbiWriteDraft({
      ...baseInput,
      selectedRpc: {
        chainId: 1,
        endpointSummary: "https://rpc.example/a?token name=[redacted]",
        endpointFingerprintSource: "https://rpc.example/a?token+name=secret",
      },
    });
    const spaceKeyFromRawSource = buildAbiWriteDraft({
      ...baseInput,
      selectedRpc: {
        chainId: 1,
        endpointSummary: "https://rpc.example/a?token name=[redacted]",
        endpointFingerprintSource: "https://rpc.example/a?token%20name=other-secret",
      },
    });

    expect(first.draft?.frozenKey).not.toEqual(second.draft?.frozenKey);
    expect(first.draft?.frozenKey).not.toEqual(third.draft?.frozenKey);
    expect(encodedKey.draft?.frozenKey).toEqual(decodedKey.draft?.frozenKey);
    expect(plusKeyFromRawSource.draft?.selectedRpc?.endpointSummary).toBe("https://rpc.example");
    expect(plusKeyFromRawSource.draft?.frozenKey).toEqual(spaceKeyFromRawSource.draft?.frozenKey);
    expect(JSON.stringify(first.draft)).not.toContain("secret");
    expect(JSON.stringify(encodedKey.draft)).not.toContain("secret");
    expect(JSON.stringify(plusKeyFromRawSource.draft)).not.toContain("secret");
  });

  it("blocks read functions, cacheStale entries, selector conflicts, missing preview, and nonpayable value", () => {
    const staleConflict = cacheEntry("blocked", {
      selected: true,
      cacheStatus: "cacheStale",
      validationStatus: "selectorConflict",
      selectionStatus: "selected",
    });
    const result = buildAbiWriteDraft({
      selectedChainId: 1,
      chainLabel: "Ethereum",
      accountIndex: 0,
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      rpcConfigured: true,
      selectedRpc: { chainId: 1, endpointSummary: "Configured RPC / chainId 1" },
      entry: staleConflict,
      fn: {
        name: "balanceOf",
        signature: "balanceOf(address)",
        selector: "0x70a08231",
        stateMutability: "view",
        callKind: "read",
        supported: true,
        unsupportedReason: null,
        inputs: [],
        outputs: [],
      },
      preview: null,
      nativeValueWei: "1",
      gasLimit: "90000",
      latestBaseFeeGwei: "10",
      baseFeeGwei: "",
      baseFeeMultiplier: "2",
      maxFeeOverrideGwei: "",
      priorityFeeGwei: "1",
      nonce: "7",
      createdAt: "2026-04-29T01:02:03.000Z",
    });

    expect(result.draft).toBeNull();
    expect(result.blockingStatuses.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "selectorConflict",
        "cacheStale",
        "readFunction",
        "missingPreview",
        "nonpayableValue",
      ]),
    );
  });

  it("blocks drafts when successful calldata preview identity differs from selected ABI entry or function", () => {
    const entry = cacheEntry("usable", { selected: true, selectionStatus: "selected" });
    const result = buildAbiWriteDraft({
      selectedChainId: 1,
      chainLabel: "Ethereum",
      accountIndex: 0,
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      rpcConfigured: true,
      selectedRpc: { chainId: 1, endpointSummary: "Configured RPC / chainId 1" },
      entry,
      fn: {
        name: "deposit",
        signature: "deposit(uint256)",
        selector: "0xb6b55f25",
        stateMutability: "payable",
        callKind: "writeDraft",
        supported: true,
        unsupportedReason: null,
        inputs: [],
        outputs: [],
      },
      preview: {
        status: "success",
        reasons: [],
        functionSignature: "withdraw(uint256)",
        selector: "0x2e1a7d4d",
        contractAddress: otherContract,
        sourceKind: "userPasted",
        providerConfigId: null,
        userSourceId: "other-source",
        versionId: "other-version",
        abiHash: "other-abi-hash",
        sourceFingerprint: "other-fingerprint",
        parameterSummary: [],
        calldata: { byteLength: 36, hash: "0xpreviewhash" },
      },
      nativeValueWei: "0",
      gasLimit: "90000",
      latestBaseFeeGwei: "10",
      baseFeeGwei: "",
      baseFeeMultiplier: "2",
      maxFeeOverrideGwei: "",
      priorityFeeGwei: "1",
      nonce: "7",
      createdAt: "2026-04-29T01:02:03.000Z",
    });

    expect(result.draft).toBeNull();
    expect(result.blockingStatuses).toContainEqual(
      expect.objectContaining({
        code: "previewIdentityMismatch",
        message: expect.stringContaining("function signature"),
      }),
    );
    expect(result.blockingStatuses[0]?.message).toEqual(expect.stringContaining("selector"));
  });

  it("keeps gas fee nonce validation recoverable without dangerous defaults", () => {
    const entry = cacheEntry("usable", { selected: true, selectionStatus: "selected" });
    const baseInput: AbiWriteDraftInput = {
      selectedChainId: 1,
      chainLabel: "Ethereum",
      accountIndex: 0,
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      rpcConfigured: true,
      selectedRpc: { chainId: 1, endpointSummary: "Configured RPC / chainId 1" },
      entry,
      fn: {
        name: "deposit",
        signature: "deposit()",
        selector: "0xd0e30db0",
        stateMutability: "payable",
        callKind: "writeDraft",
        supported: true,
        unsupportedReason: null,
        inputs: [],
        outputs: [],
      },
      preview: {
        status: "success",
        reasons: [],
        functionSignature: "deposit()",
        selector: "0xd0e30db0",
        contractAddress: contract,
        sourceKind: entry.sourceKind,
        providerConfigId: entry.providerConfigId,
        userSourceId: entry.userSourceId,
        versionId: entry.versionId,
        abiHash: entry.abiHash,
        sourceFingerprint: entry.sourceFingerprint,
        parameterSummary: [],
        calldata: { byteLength: 4, hash: "0xhash" },
      },
      nativeValueWei: "0",
      gasLimit: "",
      latestBaseFeeGwei: "",
      baseFeeGwei: "",
      baseFeeMultiplier: "bad",
      maxFeeOverrideGwei: "",
      priorityFeeGwei: "",
      nonce: "",
      createdAt: "2026-04-29T01:02:03.000Z",
    };

    const blocked = buildAbiWriteDraft(baseInput);
    expect(blocked.draft).toBeNull();
    expect(blocked.blockingStatuses.map((item) => item.code)).toEqual(
      expect.arrayContaining(["gasLimit", "baseFeeUnavailable", "baseFeeMultiplier", "priorityFee", "nonce"]),
    );

    const recovered = buildAbiWriteDraft({
      ...baseInput,
      gasLimit: "90000",
      baseFeeGwei: "10",
      baseFeeMultiplier: "2",
      priorityFeeGwei: "1",
      nonce: "8",
    });
    expect(recovered.blockingStatuses).toEqual([]);
    expect(recovered.draft?.nonce).toBe(8);

    const boundary = buildAbiWriteDraft({
      ...baseInput,
      gasLimit: "90000",
      baseFeeGwei: "10",
      baseFeeMultiplier: "1.123456789012345678",
      priorityFeeGwei: "1",
      nonce: "8",
    });
    expect(boundary.blockingStatuses).toEqual([]);
    expect(boundary.draft?.baseFeeMultiplier).toBe("1.123456789012345678");

    const tooPrecise = buildAbiWriteDraft({
      ...baseInput,
      gasLimit: "90000",
      baseFeeGwei: "10",
      baseFeeMultiplier: "1.1234567890123456789",
      priorityFeeGwei: "1",
      nonce: "8",
    });
    expect(tooPrecise.draft).toBeNull();
    expect(tooPrecise.blockingStatuses.map((item) => item.code)).toContain("baseFeeMultiplier");
  });
});
