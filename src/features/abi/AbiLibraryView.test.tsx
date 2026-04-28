import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AbiCacheEntryRecord,
  AbiFetchSourceStatus,
  AbiRegistryMutationResult,
  AbiRegistryState,
  AbiValidationStatus,
} from "../../lib/tauri";
import { renderScreen } from "../../test/render";
import { AbiLibraryView } from "./AbiLibraryView";

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
  };
  renderScreen(
    <AbiLibraryView
      selectedChainId={1n}
      state={state}
      {...props}
    />,
  );
  return props;
}

describe("AbiLibraryView", () => {
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
});
