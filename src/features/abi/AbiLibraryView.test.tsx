import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AbiCacheEntryRecord,
  AbiCalldataPreviewInput,
  AbiCalldataPreviewResult,
  AbiFetchSourceStatus,
  AbiFunctionCatalogResult,
  AbiManagedEntryInput,
  AbiRegistryMutationResult,
  AbiRegistryState,
  AbiValidationStatus,
} from "../../lib/tauri";
import { renderScreen } from "../../test/render";
import { AbiLibraryView } from "./AbiLibraryView";

const provider = vi.hoisted(() => ({
  getBlock: vi.fn(),
  getFeeData: vi.fn(),
  getNetwork: vi.fn(),
}));

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ...actual,
    JsonRpcProvider: vi.fn(() => provider),
  };
});

const contract = "0x1111111111111111111111111111111111111111";

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
    sourceFingerprint: `fingerprint-${versionId}-1234567890`,
    abiHash: `abi-hash-${versionId}-1234567890`,
    selected: versionId === "v1",
    fetchSourceStatus: "ok",
    validationStatus: "ok",
    cacheStatus: "cacheFresh",
    selectionStatus: versionId === "v1" ? "selected" : "unselected",
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
    lastValidatedAt: "1710000001",
    staleAfter: "1710003600",
    lastErrorSummary: null,
    providerProxyHint: null,
    proxyDetected: false,
    createdAt: "1710000000",
    updatedAt: "1710000001",
    ...overrides,
  };
}

function cacheKey(entry: AbiCacheEntryRecord) {
  return [
    entry.chainId,
    entry.contractAddress.toLowerCase(),
    entry.sourceKind,
    entry.providerConfigId ?? "",
    entry.userSourceId ?? "",
    entry.versionId,
  ].join(":");
}

function registryState(overrides: Partial<AbiRegistryState> = {}): AbiRegistryState {
  const fetchStatuses: AbiFetchSourceStatus[] = [
    "notConfigured",
    "fetchFailed",
    "rateLimited",
    "notVerified",
    "malformedResponse",
    "unsupportedChain",
  ];
  const validationStatuses: AbiValidationStatus[] = ["parseFailed", "selectorConflict"];
  return {
    schemaVersion: 1,
    dataSources: [
      {
        id: "etherscan-mainnet",
        chainId: 1,
        providerKind: "etherscanCompatible",
        baseUrl: "https://api.etherscan.io/api",
        apiKeyRef: "ETHERSCAN_API_KEY",
        enabled: true,
        lastSuccessAt: "1710000000",
        lastFailureAt: "1710000200",
        failureCount: 1,
        cooldownUntil: "1710000300",
        rateLimited: true,
        lastErrorSummary: "rate limit window",
        createdAt: "1710000000",
        updatedAt: "1710000200",
      },
    ],
    cacheEntries: [
      cacheEntry("v1"),
      cacheEntry("source-conflict", {
        sourceKind: "userImported",
        providerConfigId: null,
        userSourceId: "manual-file",
        selected: false,
        selectionStatus: "sourceConflict",
        cacheStatus: "cacheStale",
        importedAt: "1710000100",
        fetchedAt: null,
        lastErrorSummary: "source changed since selected ABI",
      }),
      cacheEntry("needs-choice", {
        sourceKind: "userPasted",
        providerConfigId: null,
        userSourceId: "manual-paste",
        selected: false,
        selectionStatus: "needsUserChoice",
        validationStatus: "selectorConflict",
        selectorSummary: {
          functionSelectorCount: 2,
          eventTopicCount: 1,
          errorSelectorCount: 1,
          duplicateSelectorCount: 1,
          conflictCount: 1,
          notes: "duplicate selector",
        },
      }),
      ...fetchStatuses.map((status) =>
        cacheEntry(status, {
          selected: false,
          fetchSourceStatus: status,
          cacheStatus: status === "fetchFailed" ? "refreshFailed" : "cacheStale",
          selectionStatus: "unselected",
          lastErrorSummary: status,
        }),
      ),
      ...validationStatuses.map((status) =>
        cacheEntry(status, {
          selected: false,
          sourceKind: "userPasted",
          providerConfigId: null,
          userSourceId: `validation-${status}`,
          validationStatus: status,
          selectionStatus: status === "selectorConflict" ? "needsUserChoice" : "unselected",
          lastErrorSummary: status,
        }),
      ),
    ],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function failedMutationResult(
  overrides: Partial<AbiRegistryMutationResult["validation"]>,
): AbiRegistryMutationResult {
  return {
    state: registryState({ cacheEntries: [] }),
    validation: {
      fetchSourceStatus: "ok",
      validationStatus: "parseFailed",
      abiHash: null,
      sourceFingerprint: null,
      functionCount: 0,
      eventCount: 0,
      errorCount: 0,
      selectorSummary: {
        functionSelectorCount: 0,
        eventTopicCount: 0,
        errorSelectorCount: 0,
        duplicateSelectorCount: 0,
        conflictCount: 0,
        notes: "invalid ABI JSON",
      },
      diagnostics: {},
      ...overrides,
    },
    cacheEntry: null,
  };
}

function renderAbi(
  state = registryState(),
  handlers: Partial<{
    onRefresh: ReturnType<typeof vi.fn>;
    onSaveDataSource: ReturnType<typeof vi.fn>;
    onRemoveDataSource: ReturnType<typeof vi.fn>;
    onValidatePayload: ReturnType<typeof vi.fn>;
    onImportPayload: ReturnType<typeof vi.fn>;
    onPastePayload: ReturnType<typeof vi.fn>;
    onFetchExplorerAbi: ReturnType<typeof vi.fn>;
    onMarkStale: ReturnType<typeof vi.fn>;
    onDeleteEntry: ReturnType<typeof vi.fn>;
    onListFunctions: ReturnType<typeof vi.fn>;
    onPreviewCalldata: ReturnType<typeof vi.fn>;
  }> = {},
  options: Partial<{
    rpcUrl: string;
  }> = {},
) {
  const props = {
    onRefresh: handlers.onRefresh ?? vi.fn(),
    onSaveDataSource: handlers.onSaveDataSource ?? vi.fn(),
    onRemoveDataSource: handlers.onRemoveDataSource ?? vi.fn(),
    onValidatePayload:
      handlers.onValidatePayload ??
      vi.fn(async () => ({
        fetchSourceStatus: "ok",
        validationStatus: "ok",
        abiHash: "hash-validation",
        sourceFingerprint: "fingerprint-validation",
        functionCount: 1,
        eventCount: 0,
        errorCount: 0,
        selectorSummary: {
          functionSelectorCount: 1,
          eventTopicCount: 0,
          errorSelectorCount: 0,
          duplicateSelectorCount: 0,
          conflictCount: 0,
          notes: null,
        },
        diagnostics: {},
      })),
    onImportPayload: handlers.onImportPayload ?? vi.fn(),
    onPastePayload: handlers.onPastePayload ?? vi.fn(),
    onFetchExplorerAbi: handlers.onFetchExplorerAbi ?? vi.fn(),
    onMarkStale: handlers.onMarkStale ?? vi.fn(),
    onDeleteEntry: handlers.onDeleteEntry ?? vi.fn(),
    onListFunctions:
      handlers.onListFunctions ??
      vi.fn(async (input: AbiManagedEntryInput): Promise<AbiFunctionCatalogResult> => ({
        status: "blocked",
        reasons: ["unknown"],
        contractAddress: input.contractAddress,
        sourceKind: input.sourceKind,
        providerConfigId: input.providerConfigId ?? null,
        userSourceId: input.userSourceId ?? null,
        versionId: input.versionId,
        abiHash: input.abiHash,
        sourceFingerprint: input.sourceFingerprint,
        functions: [],
        unsupportedItemCount: 0,
      })),
    onPreviewCalldata:
      handlers.onPreviewCalldata ??
      vi.fn(async (input: AbiCalldataPreviewInput): Promise<AbiCalldataPreviewResult> => ({
        status: "blocked",
        reasons: ["unknown"],
        functionSignature: input.functionSignature,
        contractAddress: input.contractAddress,
        sourceKind: input.sourceKind,
        providerConfigId: input.providerConfigId ?? null,
        userSourceId: input.userSourceId ?? null,
        versionId: input.versionId,
        abiHash: input.abiHash,
        sourceFingerprint: input.sourceFingerprint,
        parameterSummary: [],
      })),
  };
  renderScreen(
    <AbiLibraryView
      accounts={[
        {
          index: 0,
          address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          label: "Account 0",
          nativeBalanceWei: 1000000000000000000n,
          nonce: 7,
          lastSyncedAt: null,
          lastSyncError: null,
        },
      ]}
      chainName="Ethereum"
      rpcUrl={options.rpcUrl ?? "https://rpc.example.invalid/mainnet?apikey=secret"}
      selectedChainId={1n}
      state={state}
      {...props}
    />,
  );
  return props;
}

function writeFunctionCatalog(
  input: AbiManagedEntryInput,
  fn: Partial<AbiFunctionCatalogResult["functions"][number]> = {},
): AbiFunctionCatalogResult {
  return {
    status: "success",
    reasons: [],
    contractAddress: input.contractAddress,
    sourceKind: input.sourceKind,
    providerConfigId: input.providerConfigId ?? null,
    userSourceId: input.userSourceId ?? null,
    versionId: input.versionId,
    abiHash: input.abiHash,
    sourceFingerprint: input.sourceFingerprint,
    unsupportedItemCount: 0,
    functions: [
      {
        name: "deposit",
        signature: "deposit(uint256)",
        selector: "0xb6b55f25",
        stateMutability: "payable",
        callKind: "writeDraft",
        supported: true,
        unsupportedReason: null,
        inputs: [{ name: "amount", type: "uint256", kind: "uint", arrayLength: null, components: null }],
        outputs: [],
        ...fn,
      },
    ],
  };
}

function successfulWritePreview(
  input: AbiCalldataPreviewInput,
  parameterSummary: AbiCalldataPreviewResult["parameterSummary"] = [
    {
      kind: "uint",
      type: "uint256",
      value: "42",
      byteLength: null,
      hash: null,
      items: null,
      fields: null,
      truncated: false,
    },
  ],
): AbiCalldataPreviewResult {
  return {
    status: "success",
    reasons: [],
    functionSignature: input.functionSignature,
    selector: "0xb6b55f25",
    contractAddress: input.contractAddress,
    sourceKind: input.sourceKind,
    providerConfigId: input.providerConfigId ?? null,
    userSourceId: input.userSourceId ?? null,
    versionId: input.versionId,
    abiHash: input.abiHash,
    sourceFingerprint: input.sourceFingerprint,
    parameterSummary,
    calldata: {
      byteLength: 36,
      hash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
  };
}

async function buildSuccessfulWriteDraft() {
  fireEvent.click(screen.getByRole("button", { name: "Load Functions" }));
  await waitFor(() => expect(screen.getByLabelText("Function signature")).toHaveValue("deposit(uint256)"));
  fireEvent.change(screen.getByLabelText("Canonical params JSON array"), {
    target: { value: "[42]" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview Encoding" }));
  await waitFor(() => expect(screen.getByLabelText("ABI calldata preview result")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Native value (wei)"), { target: { value: "123" } });
  fireEvent.change(screen.getByLabelText("Gas limit"), { target: { value: "80000" } });
  fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));
  await screen.findByLabelText("ABI write draft confirmation");
}

async function buildFrozenKeyForRpc(rpcUrl: string) {
  const onListFunctions = vi.fn(async (input: AbiManagedEntryInput) => writeFunctionCatalog(input));
  const onPreviewCalldata = vi.fn(async (input: AbiCalldataPreviewInput) =>
    successfulWritePreview(input),
  );
  renderAbi(
    registryState({ cacheEntries: [cacheEntry("v1")] }),
    { onListFunctions, onPreviewCalldata },
    { rpcUrl },
  );
  await buildSuccessfulWriteDraft();
  const confirmation = screen.getByLabelText("ABI write draft confirmation");
  const match = confirmation.textContent?.match(/Frozen key(abi-draft-[0-9a-f]+)/);
  expect(match?.[1]).toBeTruthy();
  expect(confirmation).not.toHaveTextContent("SECRET");
  return match![1];
}

describe("AbiLibraryView", () => {
  beforeEach(() => {
    provider.getNetwork.mockReset();
    provider.getFeeData.mockReset();
    provider.getBlock.mockReset();
    provider.getNetwork.mockResolvedValue({ chainId: 1n });
    provider.getFeeData.mockResolvedValue({
      gasPrice: 30_000_000_000n,
      maxFeePerGas: 40_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
    });
    provider.getBlock.mockResolvedValue({ baseFeePerGas: 20_000_000_000n });
  });

  it("renders configured source/cache rows and important failure statuses", () => {
    renderAbi();

    expect(screen.getByRole("heading", { name: "ABI Library" })).toBeInTheDocument();
    expect(screen.getAllByText("etherscan-mainnet").length).toBeGreaterThan(0);
    expect(screen.getByText("apiKeyRef ETHERSCAN_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("userImported:manual-file")).toBeInTheDocument();
    expect(screen.getByText("userPasted:manual-paste")).toBeInTheDocument();

    for (const label of [
      "Not configured",
      "Fetch failed",
      "Rate limited",
      "Not verified",
      "Malformed response",
      "Parse failed",
      "Source conflict",
      "Stale",
      "Unsupported chain",
      "Selector conflict",
      "Needs user choice",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("validates payload without rendering the raw ABI body in summaries", async () => {
    const onValidatePayload = vi.fn(async () => ({
      fetchSourceStatus: "ok",
      validationStatus: "ok",
      abiHash: "hash-validation",
      sourceFingerprint: "fingerprint-validation",
      functionCount: 1,
      eventCount: 0,
      errorCount: 0,
      selectorSummary: {
        functionSelectorCount: 1,
        eventTopicCount: 0,
        errorSelectorCount: 0,
        duplicateSelectorCount: 0,
        conflictCount: 0,
        notes: null,
      },
      diagnostics: {},
    }));
    renderAbi(registryState(), { onValidatePayload });

    const rawAbi =
      '[{"type":"function","name":"transfer","inputs":[{"name":"to","type":"address"}]}]';
    fireEvent.change(screen.getByLabelText("ABI payload"), { target: { value: rawAbi } });
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));

    await waitFor(() => expect(onValidatePayload).toHaveBeenCalledWith(rawAbi));
    expect(screen.getByLabelText("ABI validation summary")).toHaveTextContent("Functions 1");
    expect(screen.getByLabelText("ABI validation summary")).not.toHaveTextContent("transfer");
  });

  it("calls paste import fetch stale and delete handlers with explicit identities", async () => {
    const onPastePayload = vi.fn(async () => true);
    const onImportPayload = vi.fn(async () => true);
    const onFetchExplorerAbi = vi.fn(async () => true);
    const onMarkStale = vi.fn();
    const onDeleteEntry = vi.fn();
    renderAbi(registryState(), {
      onPastePayload,
      onImportPayload,
      onFetchExplorerAbi,
      onMarkStale,
      onDeleteEntry,
    });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: contract } });
    fireEvent.change(screen.getByLabelText("User source id"), { target: { value: "manual-note" } });
    fireEvent.change(screen.getByLabelText("ABI payload"), {
      target: { value: '[{"type":"event","name":"Transfer"}]' },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Paste" }));
    await waitFor(() =>
      expect(onPastePayload).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: 1,
          contractAddress: contract,
          userSourceId: "manual-note",
        }),
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Saved as userPasted");

    fireEvent.change(screen.getByLabelText("ABI payload"), {
      target: { value: '[{"type":"event","name":"Approval"}]' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Import" }));
    await waitFor(() =>
      expect(onImportPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: 1,
          contractAddress: contract,
          userSourceId: "manual-note",
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Fetch / Refresh" }));
    await waitFor(() =>
      expect(onFetchExplorerAbi).toHaveBeenCalledWith({
        chainId: 1,
        contractAddress: contract,
        providerConfigId: null,
      }),
    );

    const cacheSection = screen.getByLabelText("ABI cache entries");
    const conflictRow = within(cacheSection).getByText("userImported:manual-file").closest("tr");
    expect(conflictRow).not.toBeNull();
    expect(
      within(conflictRow as HTMLElement).getByText(/source config edit\/remove/),
    ).toBeInTheDocument();
    expect(
      within(conflictRow as HTMLElement).queryByRole("button", { name: /adopt/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(conflictRow as HTMLElement).getByRole("button", {
        name: /Mark ABI cache entry .*source-conflict.*userImported:manual-file stale/,
      }),
    );
    expect(onMarkStale).toHaveBeenCalledWith(expect.objectContaining({ versionId: "source-conflict" }));
    fireEvent.click(
      within(conflictRow as HTMLElement).getByRole("button", {
        name: /Delete ABI cache entry .*source-conflict/,
      }),
    );
    expect(onDeleteEntry).toHaveBeenCalledWith(expect.objectContaining({ versionId: "source-conflict" }));
  });

  it.each([
    ["paste", "Save Paste", "ABI cache was not saved"],
    ["import", "Save Import", "ABI cache was not saved"],
  ] as const)(
    "preserves payload and shows diagnostics when %s resolves with malformed payload",
    async (_mode, buttonName, messagePrefix) => {
      const onPastePayload = vi.fn(async () =>
        failedMutationResult({ validationStatus: "parseFailed" }),
      );
      const onImportPayload = vi.fn(async () =>
        failedMutationResult({ validationStatus: "payloadTooLarge" }),
      );
      renderAbi(registryState(), { onPastePayload, onImportPayload });

      const rawAbi = '{"abi":';
      fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: contract } });
      fireEvent.change(screen.getByLabelText("ABI payload"), { target: { value: rawAbi } });
      fireEvent.click(screen.getByRole("button", { name: buttonName }));

      const expectedHandler = buttonName === "Save Paste" ? onPastePayload : onImportPayload;
      await waitFor(() => expect(expectedHandler).toHaveBeenCalled());
      expect(screen.getByRole("alert")).toHaveTextContent(messagePrefix);
      expect(screen.getByLabelText("ABI payload")).toHaveValue(rawAbi);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.getByLabelText("ABI validation summary")).toHaveTextContent(
        buttonName === "Save Paste" ? "Parse failed" : "Payload too large",
      );
    },
  );

  it("shows fetch failure diagnostics without reporting cache success", async () => {
    const onFetchExplorerAbi = vi.fn(async () =>
      failedMutationResult({
        fetchSourceStatus: "notConfigured",
        validationStatus: "notValidated",
        diagnostics: {
          providerConfigId: "etherscan-mainnet",
          failureClass: "notConfigured",
        },
      }),
    );
    renderAbi(registryState(), { onFetchExplorerAbi });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: contract } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch / Refresh" }));

    await waitFor(() => expect(onFetchExplorerAbi).toHaveBeenCalled());
    expect(screen.getByRole("alert")).toHaveTextContent("Explorer ABI was not cached");
    expect(screen.getByRole("alert")).toHaveTextContent("Not configured");
    expect(screen.queryByText("Explorer ABI cached.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("ABI validation summary")).toHaveTextContent(
      "Failure notConfigured",
    );
  });

  it("saves and removes data source config using apiKeyRef only", async () => {
    const onSaveDataSource = vi.fn();
    const onRemoveDataSource = vi.fn();
    renderAbi(registryState(), { onSaveDataSource, onRemoveDataSource });

    fireEvent.change(screen.getByLabelText("Source id"), { target: { value: "blockscout-base" } });
    fireEvent.change(screen.getByLabelText("Provider kind"), {
      target: { value: "blockscoutCompatible" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://blockscout.example/api" },
    });
    fireEvent.change(screen.getByLabelText("apiKeyRef"), { target: { value: "BLOCKSCOUT_REF" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Source" }));

    await waitFor(() =>
      expect(onSaveDataSource).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "blockscout-base",
          providerKind: "blockscoutCompatible",
          baseUrl: "https://blockscout.example/api",
          apiKeyRef: "BLOCKSCOUT_REF",
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Edit ABI data source etherscan-mainnet/ }));
    expect(screen.getByLabelText("Source id")).toHaveValue("etherscan-mainnet");

    fireEvent.click(screen.getByRole("button", { name: /Remove ABI data source etherscan-mainnet/ }));
    expect(onRemoveDataSource).toHaveBeenCalledWith("etherscan-mainnet");
  });

  it("selects overloaded functions by full signature and renders bounded calldata preview", async () => {
    const onListFunctions = vi.fn(async (input: AbiManagedEntryInput): Promise<AbiFunctionCatalogResult> => ({
      status: "success",
      reasons: [],
      contractAddress: input.contractAddress,
      sourceKind: input.sourceKind,
      providerConfigId: input.providerConfigId ?? null,
      userSourceId: input.userSourceId ?? null,
      versionId: input.versionId,
      abiHash: input.abiHash,
      sourceFingerprint: input.sourceFingerprint,
      unsupportedItemCount: 1,
      functions: [
        {
          name: "lookup",
          signature: "lookup(uint256)",
          selector: "0x9d46a1a8",
          stateMutability: "view",
          callKind: "read",
          supported: true,
          unsupportedReason: null,
          inputs: [{ name: "id", type: "uint256", kind: "uint", arrayLength: null, components: null }],
          outputs: [],
        },
        {
          name: "lookup",
          signature: "lookup(address)",
          selector: "0xf23a6e61",
          stateMutability: "view",
          callKind: "read",
          supported: true,
          unsupportedReason: null,
          inputs: [{ name: "owner", type: "address", kind: "address", arrayLength: null, components: null }],
          outputs: [],
        },
      ],
    }));
    const onPreviewCalldata = vi.fn(
      async (input: AbiCalldataPreviewInput): Promise<AbiCalldataPreviewResult> => ({
        status: "success",
        reasons: [],
        functionSignature: input.functionSignature,
        selector: "0xf23a6e61",
        contractAddress: input.contractAddress,
        sourceKind: input.sourceKind,
        providerConfigId: input.providerConfigId ?? null,
        userSourceId: input.userSourceId ?? null,
        versionId: input.versionId,
        abiHash: input.abiHash,
        sourceFingerprint: input.sourceFingerprint,
        parameterSummary: [
          {
            kind: "address",
            type: "address",
            value: "0x2222222222222222222222222222222222222222",
            byteLength: null,
            hash: null,
            items: null,
            fields: null,
            truncated: false,
          },
          {
            kind: "string",
            type: "string",
            value: "x".repeat(256),
            byteLength: null,
            hash: null,
            items: null,
            fields: null,
            truncated: true,
          },
        ],
        calldata: {
          byteLength: 36,
          hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }),
    );
    renderAbi(registryState({ cacheEntries: [cacheEntry("v1")] }), {
      onListFunctions,
      onPreviewCalldata,
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Functions" }));
    await waitFor(() => expect(onListFunctions).toHaveBeenCalledWith(expect.objectContaining({
      chainId: 1,
      abiHash: expect.stringContaining("abi-hash"),
    })));
    fireEvent.change(screen.getByLabelText("Function signature"), {
      target: { value: "lookup(address)" },
    });
    fireEvent.change(screen.getByLabelText("Canonical params JSON array"), {
      target: { value: '["0x2222222222222222222222222222222222222222"]' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview Encoding" }));

    await waitFor(() =>
      expect(onPreviewCalldata).toHaveBeenCalledWith(
        expect.objectContaining({
          functionSignature: "lookup(address)",
          canonicalParams: ["0x2222222222222222222222222222222222222222"],
        }),
      ),
    );
    const preview = screen.getByLabelText("ABI calldata preview result");
    expect(preview).toHaveTextContent("lookup(address)");
    expect(preview).toHaveTextContent("0xf23a6e61");
    expect(preview).toHaveTextContent("36");
    expect(preview).toHaveTextContent("0xaaaaaaaaaa");
    expect(preview).not.toHaveTextContent("0xf23a6e61000000000000000000000000");
  });

  it("allows payable value and shows bounded ABI write confirmation with submit stubbed", async () => {
    const onListFunctions = vi.fn(async (input: AbiManagedEntryInput) => writeFunctionCatalog(input));
    const onPreviewCalldata = vi.fn(async (input: AbiCalldataPreviewInput) =>
      successfulWritePreview(input),
    );
    renderAbi(registryState({ cacheEntries: [cacheEntry("v1")] }), {
      onListFunctions,
      onPreviewCalldata,
    });

    await buildSuccessfulWriteDraft();

    const confirmation = await screen.findByLabelText("ABI write draft confirmation");
    expect(provider.getBlock).toHaveBeenCalledWith("latest");
    expect(provider.getFeeData).toHaveBeenCalled();
    expect(confirmation).toHaveTextContent("deposit(uint256)");
    expect(confirmation).toHaveTextContent("123 wei");
    expect(confirmation).toHaveTextContent("80000");
    expect(confirmation).toHaveTextContent("20.0 gwei");
    expect(confirmation).toHaveTextContent("1.5 gwei");
    expect(confirmation).toHaveTextContent("0xcccccccccccc");
    expect(confirmation).toHaveTextContent("https://rpc.example.invalid");
    expect(confirmation).not.toHaveTextContent("/mainnet");
    expect(confirmation).not.toHaveTextContent("apikey=secret");
    expect(screen.getByRole("button", { name: "Submit Transaction" })).toBeDisabled();
  });

  it("ignores stale write draft fee lookups when draft inputs change in flight", async () => {
    const latestBlock = deferred<{ baseFeePerGas: bigint | null }>();
    provider.getBlock.mockReturnValueOnce(latestBlock.promise);
    const onListFunctions = vi.fn(async (input: AbiManagedEntryInput) => writeFunctionCatalog(input));
    const onPreviewCalldata = vi.fn(async (input: AbiCalldataPreviewInput) =>
      successfulWritePreview(input),
    );
    renderAbi(registryState({ cacheEntries: [cacheEntry("v1")] }), {
      onListFunctions,
      onPreviewCalldata,
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Functions" }));
    await waitFor(() => expect(screen.getByLabelText("Function signature")).toHaveValue("deposit(uint256)"));
    fireEvent.change(screen.getByLabelText("Canonical params JSON array"), {
      target: { value: "[42]" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview Encoding" }));
    await waitFor(() => expect(screen.getByLabelText("ABI calldata preview result")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Gas limit"), { target: { value: "80000" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));
    await waitFor(() => expect(provider.getBlock).toHaveBeenCalledWith("latest"));

    fireEvent.change(screen.getByLabelText("Canonical params JSON array"), {
      target: { value: "[43]" },
    });
    await act(async () => {
      latestBlock.resolve({ baseFeePerGas: 20_000_000_000n });
      await latestBlock.promise;
    });

    await waitFor(() =>
      expect(screen.queryByLabelText("ABI write draft confirmation")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Latest base fee (gwei)")).toHaveValue("");
    expect(screen.queryByText("20.0 gwei")).not.toBeInTheDocument();
  });

  it("redacts RPC fee lookup errors before rendering draft statuses", async () => {
    provider.getBlock.mockRejectedValueOnce(
      new Error(
        "failed https://rpc.example.invalid/path?apikey=SECRET Bearer SECRET token=SECRET",
      ),
    );
    const onListFunctions = vi.fn(async (input: AbiManagedEntryInput) => writeFunctionCatalog(input));
    const onPreviewCalldata = vi.fn(async (input: AbiCalldataPreviewInput) =>
      successfulWritePreview(input),
    );
    renderAbi(registryState({ cacheEntries: [cacheEntry("v1")] }), {
      onListFunctions,
      onPreviewCalldata,
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Functions" }));
    await waitFor(() => expect(screen.getByLabelText("Function signature")).toHaveValue("deposit(uint256)"));
    fireEvent.click(screen.getByRole("button", { name: "Preview Encoding" }));
    await waitFor(() => expect(screen.getByLabelText("ABI calldata preview result")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Gas limit"), { target: { value: "80000" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    const blockers = await screen.findByLabelText("ABI write blocking statuses");
    expect(screen.getByRole("alert")).toHaveTextContent("RPC fee lookup failed");
    expect(blockers).toHaveTextContent("https://rpc.example.invalid");
    expect(blockers).toHaveTextContent("Bearer [redacted]");
    expect(blockers).not.toHaveTextContent("SECRET");
    expect(blockers).not.toHaveTextContent("apikey=SECRET");
    expect(blockers).not.toHaveTextContent("token=SECRET");
  });

  it("blocks nonpayable functions with nonzero native value", async () => {
    const onListFunctions = vi.fn(async (input: AbiManagedEntryInput) =>
      writeFunctionCatalog(input, {
        name: "setValue",
        signature: "setValue(uint256)",
        stateMutability: "nonpayable",
      }),
    );
    const onPreviewCalldata = vi.fn(async (input: AbiCalldataPreviewInput) =>
      successfulWritePreview(input),
    );
    renderAbi(registryState({ cacheEntries: [cacheEntry("v1")] }), {
      onListFunctions,
      onPreviewCalldata,
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Functions" }));
    await waitFor(() => expect(screen.getByLabelText("Function signature")).toHaveValue("setValue(uint256)"));
    fireEvent.click(screen.getByRole("button", { name: "Preview Encoding" }));
    await waitFor(() => expect(screen.getByLabelText("ABI calldata preview result")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Native value (wei)"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Gas limit"), { target: { value: "80000" } });
    fireEvent.change(screen.getByLabelText("Latest base fee (gwei)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Priority fee (gwei)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Nonpayable value"));
    expect(screen.getByLabelText("ABI write blocking statuses")).toHaveTextContent(
      "Nonpayable functions require native value 0",
    );
    expect(screen.queryByLabelText("ABI write draft confirmation")).not.toBeInTheDocument();
  });

  it("does not build write drafts for view functions", async () => {
    const onListFunctions = vi.fn(async (input: AbiManagedEntryInput) =>
      writeFunctionCatalog(input, {
        name: "balanceOf",
        signature: "balanceOf(address)",
        selector: "0x70a08231",
        stateMutability: "view",
        callKind: "read",
      }),
    );
    const onPreviewCalldata = vi.fn(async (input: AbiCalldataPreviewInput) =>
      successfulWritePreview(input),
    );
    renderAbi(registryState({ cacheEntries: [cacheEntry("v1")] }), {
      onListFunctions,
      onPreviewCalldata,
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Functions" }));
    await waitFor(() => expect(screen.getByLabelText("Function signature")).toHaveValue("balanceOf(address)"));
    fireEvent.click(screen.getByRole("button", { name: "Preview Encoding" }));
    await waitFor(() => expect(screen.getByLabelText("ABI calldata preview result")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Gas limit"), { target: { value: "80000" } });
    fireEvent.change(screen.getByLabelText("Latest base fee (gwei)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Priority fee (gwei)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    expect(await screen.findByLabelText("ABI write blocking statuses")).toHaveTextContent(
      "Read/view/pure functions do not create write drafts",
    );
    expect(screen.queryByLabelText("ABI write draft confirmation")).not.toBeInTheDocument();
  });

  it("keeps stale ABI cache entries blocked for write drafts", async () => {
    const stale = cacheEntry("stale", {
      selected: true,
      cacheStatus: "cacheStale",
      selectionStatus: "selected",
    });
    renderAbi(registryState({ cacheEntries: [stale] }));

    expect(screen.getByLabelText("ABI write blocking statuses")).toHaveTextContent("cacheStale");
    expect(screen.getByRole("button", { name: "Preview Encoding" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit Transaction" })).toBeDisabled();
  });

  it("bounds large ABI argument summaries in the write confirmation", async () => {
    const largePayload = "raw-argument-".repeat(80);
    const onListFunctions = vi.fn(async (input: AbiManagedEntryInput) => writeFunctionCatalog(input));
    const onPreviewCalldata = vi.fn(async (input: AbiCalldataPreviewInput) =>
      successfulWritePreview(input, [
        {
          kind: "string",
          type: "string",
          value: largePayload,
          byteLength: largePayload.length,
          hash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          items: null,
          fields: null,
          truncated: true,
        },
      ]),
    );
    renderAbi(registryState({ cacheEntries: [cacheEntry("v1")] }), {
      onListFunctions,
      onPreviewCalldata,
    });

    await buildSuccessfulWriteDraft();

    const summary = screen.getByLabelText("ABI write argument summary");
    expect(summary).toHaveTextContent("[truncated]");
    expect(summary).not.toHaveTextContent(largePayload);
  });

  it("shows recoverable gas fee nonce blockers and builds after correction", async () => {
    provider.getBlock.mockResolvedValueOnce({ baseFeePerGas: null });
    provider.getFeeData.mockResolvedValueOnce({
      gasPrice: null,
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    });
    const onListFunctions = vi.fn(async (input: AbiManagedEntryInput) => writeFunctionCatalog(input));
    const onPreviewCalldata = vi.fn(async (input: AbiCalldataPreviewInput) =>
      successfulWritePreview(input),
    );
    renderAbi(registryState({ cacheEntries: [cacheEntry("v1")] }), {
      onListFunctions,
      onPreviewCalldata,
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Functions" }));
    await waitFor(() => expect(screen.getByLabelText("Function signature")).toHaveValue("deposit(uint256)"));
    fireEvent.click(screen.getByRole("button", { name: "Preview Encoding" }));
    await waitFor(() => expect(screen.getByLabelText("ABI calldata preview result")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Gas limit"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Latest base fee (gwei)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Priority fee (gwei)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Nonce"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    const blockers = await screen.findByLabelText("ABI write blocking statuses");
    expect(blockers).toHaveTextContent("gasLimit must");
    expect(blockers).toHaveTextContent("Latest base fee unavailable");
    expect(blockers).toHaveTextContent("priorityFee must");
    expect(blockers).toHaveTextContent("Nonce must");

    fireEvent.change(screen.getByLabelText("Gas limit"), { target: { value: "80000" } });
    fireEvent.change(screen.getByLabelText("Base fee (gwei)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Priority fee (gwei)"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Nonce"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    expect(await screen.findByLabelText("ABI write draft confirmation")).toHaveTextContent("Nonce");
    expect(screen.getByLabelText("ABI write draft confirmation")).toHaveTextContent("8");
  });

  it("builds RPC fingerprints from raw endpoint source without losing decoded query keys", async () => {
    const plusKeyFrozenKey = await buildFrozenKeyForRpc(
      "https://rpc.example.invalid/mainnet?token+name=SECRET",
    );
    cleanup();
    const encodedSpaceFrozenKey = await buildFrozenKeyForRpc(
      "https://rpc.example.invalid/mainnet?token%20name=OTHER_SECRET",
    );
    cleanup();
    const differentKeyFrozenKey = await buildFrozenKeyForRpc(
      "https://rpc.example.invalid/mainnet?tokenName=SECRET",
    );

    expect(plusKeyFrozenKey).toEqual(encodedSpaceFrozenKey);
    expect(plusKeyFrozenKey).not.toEqual(differentKeyFrozenKey);
  });

  it("keeps preview call and submit disabled for selector-conflict entries", async () => {
    const blocked = cacheEntry("blocked", {
      selected: false,
      validationStatus: "selectorConflict",
      selectionStatus: "needsUserChoice",
    });
    const onListFunctions = vi.fn(async (input: AbiManagedEntryInput): Promise<AbiFunctionCatalogResult> => ({
      status: "blocked",
      reasons: ["selectorConflict", "needsUserChoice"],
      contractAddress: input.contractAddress,
      sourceKind: input.sourceKind,
      providerConfigId: input.providerConfigId ?? null,
      userSourceId: input.userSourceId ?? null,
      versionId: input.versionId,
      abiHash: input.abiHash,
      sourceFingerprint: input.sourceFingerprint,
      functions: [],
      unsupportedItemCount: 0,
    }));
    renderAbi(registryState({ cacheEntries: [blocked] }), { onListFunctions });

    await waitFor(() =>
      expect(screen.getByLabelText("ABI preview entry status")).toHaveTextContent(
        "Blocked Selector conflict",
      ),
    );
    expect(screen.getByRole("button", { name: "Preview Encoding" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Read Call" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit Transaction" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Load Functions" }));
    await waitFor(() => expect(onListFunctions).toHaveBeenCalled());
    expect(screen.getByRole("alert")).toHaveTextContent("Selector conflict");
  });

  it("ignores stale function catalogs when the selected ABI entry changes", async () => {
    const catalog = deferred<AbiFunctionCatalogResult>();
    const selected = cacheEntry("v1");
    const replacement = cacheEntry("v2", {
      selected: false,
      selectionStatus: "unselected",
      userSourceId: null,
    });
    const onListFunctions = vi.fn(() => catalog.promise);
    renderAbi(registryState({ cacheEntries: [selected, replacement] }), { onListFunctions });

    await waitFor(() =>
      expect(screen.getByLabelText("ABI preview entry status")).toHaveTextContent("explorerFetched"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Load Functions" }));
    await waitFor(() => expect(onListFunctions).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Managed entry"), {
      target: { value: cacheKey(replacement) },
    });
    await act(async () => {
      catalog.resolve({
        status: "success",
        reasons: [],
        contractAddress: selected.contractAddress,
        sourceKind: selected.sourceKind,
        providerConfigId: selected.providerConfigId,
        userSourceId: selected.userSourceId,
        versionId: selected.versionId,
        abiHash: selected.abiHash,
        sourceFingerprint: selected.sourceFingerprint,
        unsupportedItemCount: 0,
        functions: [
          {
            name: "stale",
            signature: "stale()",
            selector: "0x00000000",
            stateMutability: "view",
            callKind: "read",
            supported: true,
            unsupportedReason: null,
            inputs: [],
            outputs: [],
          },
        ],
      });
      await catalog.promise;
    });

    expect(screen.queryByLabelText("ABI function catalog summary")).not.toBeInTheDocument();
    expect(screen.queryByText("stale()")).not.toBeInTheDocument();
  });

  it("ignores stale calldata previews when params change in flight", async () => {
    const previewResult = deferred<AbiCalldataPreviewResult>();
    const entry = cacheEntry("v1");
    const onListFunctions = vi.fn(async (input: AbiManagedEntryInput): Promise<AbiFunctionCatalogResult> => ({
      status: "success",
      reasons: [],
      contractAddress: input.contractAddress,
      sourceKind: input.sourceKind,
      providerConfigId: input.providerConfigId ?? null,
      userSourceId: input.userSourceId ?? null,
      versionId: input.versionId,
      abiHash: input.abiHash,
      sourceFingerprint: input.sourceFingerprint,
      unsupportedItemCount: 0,
      functions: [
        {
          name: "lookup",
          signature: "lookup(uint256)",
          selector: "0x9d46a1a8",
          stateMutability: "view",
          callKind: "read",
          supported: true,
          unsupportedReason: null,
          inputs: [{ name: "id", type: "uint256", kind: "uint", arrayLength: null, components: null }],
          outputs: [],
        },
      ],
    }));
    const onPreviewCalldata = vi.fn(() => previewResult.promise);
    renderAbi(registryState({ cacheEntries: [entry] }), {
      onListFunctions,
      onPreviewCalldata,
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Functions" }));
    await waitFor(() => expect(screen.getByLabelText("Function signature")).toHaveValue("lookup(uint256)"));
    fireEvent.change(screen.getByLabelText("Canonical params JSON array"), {
      target: { value: '["1"]' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview Encoding" }));
    await waitFor(() => expect(onPreviewCalldata).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Canonical params JSON array"), {
      target: { value: '["2"]' },
    });
    await act(async () => {
      previewResult.resolve({
        status: "success",
        reasons: [],
        functionSignature: "lookup(uint256)",
        selector: "0x9d46a1a8",
        contractAddress: entry.contractAddress,
        sourceKind: entry.sourceKind,
        providerConfigId: entry.providerConfigId,
        userSourceId: entry.userSourceId,
        versionId: entry.versionId,
        abiHash: entry.abiHash,
        sourceFingerprint: entry.sourceFingerprint,
        parameterSummary: [
          {
            kind: "uint",
            type: "uint256",
            value: "1",
            byteLength: null,
            hash: null,
            items: null,
            fields: null,
            truncated: false,
          },
        ],
        calldata: {
          byteLength: 36,
          hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      });
      await previewResult.promise;
    });

    expect(screen.queryByLabelText("ABI calldata preview result")).not.toBeInTheDocument();
    expect(screen.queryByText("0xbbbbbbbbbb")).not.toBeInTheDocument();
  });
});
