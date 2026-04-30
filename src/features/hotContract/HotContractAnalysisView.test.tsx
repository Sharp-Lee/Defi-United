import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  AbiRegistryState,
  HistoryRecord,
  HotContractAnalysisFetchInput,
  HotContractAnalysisReadModel,
} from "../../lib/tauri";
import { renderScreen } from "../../test/render";
import { HotContractAnalysisView } from "./HotContractAnalysisView";

const address = "0x1111111111111111111111111111111111111111";
const txHash = `0x${"a".repeat(64)}`;
const rpcUrl = "https://user:secret@rpc.example.invalid/v3/secret-key?apikey=topsecret";

function status(status = "ok", reason: string | null = null) {
  return { status, reason, errorSummary: null };
}

function model(
  overrides: Omit<Partial<HotContractAnalysisReadModel>, "sources" | "sampleCoverage"> & {
    sources?: Partial<HotContractAnalysisReadModel["sources"]>;
    sampleCoverage?: Partial<HotContractAnalysisReadModel["sampleCoverage"]>;
  } = {},
): HotContractAnalysisReadModel {
  const base: HotContractAnalysisReadModel = {
    status: "ok",
    reasons: [],
    chainId: 1,
    contract: { address },
    rpc: {
      endpoint: "https://rpc.example.invalid",
      expectedChainId: 1,
      actualChainId: 1,
      chainStatus: "matched",
    },
    code: {
      status: "ok",
      blockTag: "latest",
      byteLength: 2048,
      codeHashVersion: "keccak256-v1",
      codeHash: "0xcodehash",
      errorSummary: null,
    },
    sources: {
      chainId: status("ok"),
      code: status("ok"),
      source: status("ok"),
    },
    sampleCoverage: {
      requestedLimit: 25,
      returnedSamples: 2,
      omittedSamples: 1,
      sourceStatus: "ok",
      sourceKind: "customIndexer",
      providerConfigId: "configured-mainnet",
      queryWindow: "24h",
      oldestBlock: 100,
      newestBlock: 123,
      oldestBlockTime: "2026-04-30T00:00:00Z",
      newestBlockTime: "2026-04-30T00:05:00Z",
      providerStatus: "ok",
      rateLimitStatus: "notRateLimited",
      completeness: "partial",
      payloadStatus: "ok",
    },
    samples: [
      {
        chainId: 1,
        contractAddress: address,
        txHash,
        blockTime: "2026-04-30T00:00:00Z",
        from: "0x2222222222222222222222222222222222222222",
        to: address,
        value: "0",
        status: "success",
        selector: "0xa9059cbb",
        approveAmountIsZero: false,
        calldataLength: 68,
        calldataHash: "0xcalldatahash",
        logTopic0: ["0xddf252ad"],
        providerLabel: "Sample provider",
        blockNumber: 123,
      },
    ],
    analysis: {
      selectors: [
        {
          selector: "0xa9059cbb",
          sampledCallCount: 2,
          sampleShareBps: 5000,
          uniqueSenderCount: 2,
          successCount: 1,
          revertCount: 1,
          unknownStatusCount: 0,
          firstBlock: 100,
          lastBlock: 123,
          firstBlockTime: null,
          lastBlockTime: null,
          nativeValue: {
            sampleCount: 2,
            nonZeroCount: 0,
            zeroCount: 2,
            totalWei: "0",
          },
          exampleTxHashes: [txHash],
          source: "providerSample",
          confidence: "candidate",
          advisoryLabels: ["ERC-20 transfer candidate"],
        },
      ],
      topics: [
        {
          topic: "0xddf252ad",
          logCount: 2,
          sampleShareBps: 5000,
          firstBlock: 100,
          lastBlock: 123,
          firstBlockTime: null,
          lastBlockTime: null,
          exampleTxHashes: [txHash],
          source: "providerSample",
          confidence: "candidate",
          advisoryLabels: ["Transfer event candidate"],
        },
      ],
    },
    decode: {
      status: "partial",
      items: [
        {
          kind: "function",
          status: "candidate",
          selector: "0xa9059cbb",
          topic: null,
          signature: "transfer(address,uint256)",
          source: "userImported v1",
          confidence: "candidate",
          abiVersionId: "v1",
          abiSelected: true,
          reasons: ["selector matched ABI"],
        },
      ],
      abiSources: [
        {
          contractAddress: address,
          sourceKind: "userImported",
          providerConfigId: null,
          userSourceId: "safe-source",
          versionId: "v1",
          selected: true,
          fetchSourceStatus: "ok",
          validationStatus: "ok",
          cacheStatus: "cacheFresh",
          selectionStatus: "selected",
          artifactStatus: "available",
          proxyDetected: false,
          providerProxyHint: null,
          errorSummary: null,
        },
      ],
      classificationCandidates: [
        {
          kind: "erc20Transfer",
          label: "ERC-20 transfer candidate",
          confidence: "candidate",
          source: "selector",
          selector: "0xa9059cbb",
          topic: null,
          signature: "transfer(address,uint256)",
          reasons: ["sample selector"],
        },
      ],
      uncertaintyStatuses: [
        {
          code: "sampledOnly",
          severity: "warning",
          source: "providerSample",
          summary: "Bounded sample; totals are not complete-chain facts.",
        },
      ],
    },
    errorSummary: null,
  };

  return {
    ...base,
    ...overrides,
    sources: { ...base.sources, ...overrides.sources },
    sampleCoverage: { ...base.sampleCoverage, ...overrides.sampleCoverage },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function abiRegistryState(
  dataSources: AbiRegistryState["dataSources"],
): AbiRegistryState {
  return { schemaVersion: 1, dataSources, cacheEntries: [] };
}

function dataSource(
  overrides: Partial<AbiRegistryState["dataSources"][number]> & { id: string },
): AbiRegistryState["dataSources"][number] {
  const { id, ...rest } = overrides;
  return {
    id,
    chainId: 1,
    providerKind: "etherscanCompatible",
    baseUrl: "https://api.etherscan.io/api",
    apiKeyRef: null,
    enabled: true,
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
    cooldownUntil: null,
    rateLimited: false,
    lastErrorSummary: null,
    createdAt: "2026-04-30T00:00:00Z",
    updatedAt: "2026-04-30T00:00:00Z",
    ...rest,
  };
}

function historyRecord(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    schema_version: 1,
    intent: {
      transaction_type: "contractCall",
      token_contract: null,
      recipient: null,
      amount_raw: null,
      decimals: null,
      token_symbol: null,
      token_name: null,
      token_metadata_source: null,
      selector: "0xa9059cbb",
      method_name: "transfer",
      native_value_wei: "0",
      rpc_url: "https://user:secret@rpc.example.invalid/v3/secret-key",
      account_index: 7,
      chain_id: 1,
      from: "0x3333333333333333333333333333333333333333",
      to: address,
      value_wei: "0",
      nonce: 42,
      gas_limit: "21000",
      max_fee_per_gas: "1",
      max_priority_fee_per_gas: "1",
    },
    intent_snapshot: { source: "private wallet inventory", captured_at: "2026-04-30T00:00:00Z" },
    submission: {
      transaction_type: "contractCall",
      token_contract: null,
      recipient: null,
      amount_raw: null,
      decimals: null,
      token_symbol: null,
      token_name: null,
      token_metadata_source: null,
      selector: "0xa9059cbb",
      method_name: "transfer",
      native_value_wei: "0",
      frozen_key: "private local frozen key",
      tx_hash: txHash,
      kind: "abiWriteCall",
      source: "local history secret source",
      chain_id: 1,
      account_index: 7,
      from: "0x3333333333333333333333333333333333333333",
      to: address,
      value_wei: "0",
      nonce: 42,
      gas_limit: "21000",
      max_fee_per_gas: "1",
      max_priority_fee_per_gas: "1",
      broadcasted_at: "2026-04-30T00:00:00Z",
      replaces_tx_hash: null,
    },
    outcome: {
      state: "Confirmed",
      tx_hash: txHash,
      receipt: null,
      error: null,
      reconciled_at: null,
      reconcile: null,
      dropped_review: null,
    },
    nonce_thread: {
      account_index: 7,
      chain_id: 1,
      nonce: 42,
      status: "Confirmed",
      original_tx_hash: txHash,
      replaces_tx_hash: null,
      replaced_by_tx_hash: null,
    },
    abi_call_metadata: {
      draft_id: "private draft id",
      chain_id: 1,
      from: "0x3333333333333333333333333333333333333333",
      to: address,
      selector: "0xa9059cbb",
      method_name: "transfer",
      function_signature: "transfer(address,uint256)",
      argument_summaries: [{ path: "note", type: "string", display_value: "private note" }],
    },
    ...overrides,
  } as HistoryRecord;
}

function renderHotContract(
  options: {
    abiRegistryState?: AbiRegistryState | null;
    chainReady?: boolean;
    chainId?: bigint;
    history?: HistoryRecord[];
    initialContractAddress?: string | null;
    initialSeedTxHash?: string | null;
    onFetchHotContractAnalysis?: (
      input: HotContractAnalysisFetchInput,
    ) => Promise<HotContractAnalysisReadModel>;
  } = {},
) {
  const onFetchHotContractAnalysis =
    options.onFetchHotContractAnalysis ??
    vi.fn(async () => model());
  renderScreen(
    <HotContractAnalysisView
      abiRegistryState={options.abiRegistryState}
      chainId={options.chainId ?? 1n}
      chainName="Ethereum"
      chainReady={options.chainReady ?? true}
      history={options.history}
      initialContractAddress={options.initialContractAddress}
      initialSeedTxHash={options.initialSeedTxHash}
      onFetchHotContractAnalysis={onFetchHotContractAnalysis}
      rpcUrl={rpcUrl}
    />,
  );
  return onFetchHotContractAnalysis;
}

describe("HotContractAnalysisView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("disables analysis for invalid contract addresses and chain/RPC not ready", () => {
    renderHotContract();

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: "0x1234" } });

    expect(screen.getByText("Enter a 0x-prefixed 20-byte contract address.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeDisabled();

    renderHotContract({ chainReady: false });

    expect(screen.getAllByText("Validate an RPC before analyzing a hot contract.").length).toBe(1);
  });

  it("disables analysis when chainId is outside the safe number range", () => {
    const onFetchHotContractAnalysis = vi.fn<
      (input: HotContractAnalysisFetchInput) => Promise<HotContractAnalysisReadModel>
    >(async () => model());
    renderHotContract({
      abiRegistryState: abiRegistryState([
        dataSource({ id: "unsafe-chain-source", chainId: Number.MAX_SAFE_INTEGER }),
      ]),
      chainId: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      onFetchHotContractAnalysis,
    });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });

    expect(screen.getByText("Hot contract analysis requires a positive safe integer chainId.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeDisabled();
    expect(within(screen.getByLabelText("Source provider")).queryByRole("option", { name: /unsafe-chain-source/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(onFetchHotContractAnalysis).not.toHaveBeenCalled();
  });

  it("invokes analysis with bounded sample controls and a secret-safe RPC identity", async () => {
    const onFetchHotContractAnalysis = vi.fn<
      (input: HotContractAnalysisFetchInput) => Promise<HotContractAnalysisReadModel>
    >(async () => model());
    renderHotContract({
      abiRegistryState: abiRegistryState([dataSource({ id: "configured-mainnet", chainId: 1 })]),
      onFetchHotContractAnalysis,
    });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.change(screen.getByLabelText("Sample limit"), { target: { value: "2500" } });
    fireEvent.change(screen.getByLabelText("Sample window"), { target: { value: "24h" } });
    fireEvent.change(screen.getByLabelText("Source provider"), {
      target: { value: "configured-mainnet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await waitFor(() => expect(onFetchHotContractAnalysis).toHaveBeenCalledTimes(1));
    expect(onFetchHotContractAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        rpcUrl,
        chainId: 1,
        contractAddress: address,
        selectedRpc: expect.objectContaining({
          providerConfigId: null,
          endpointSummary: "https://rpc.example.invalid",
          endpointFingerprint: expect.stringMatching(/^rpc-endpoint-/),
        }),
        source: {
          providerConfigId: "configured-mainnet",
          limit: 500,
          window: null,
          cursor: null,
        },
      }),
    );
    const firstCall = onFetchHotContractAnalysis.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    expect(JSON.stringify(firstCall?.selectedRpc)).not.toContain("secret");
  });

  it("keeps Local/RPC only requests free of provider fallback ids", async () => {
    const onFetchHotContractAnalysis = vi.fn<
      (input: HotContractAnalysisFetchInput) => Promise<HotContractAnalysisReadModel>
    >(async () => model());
    renderHotContract({ onFetchHotContractAnalysis });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await waitFor(() => expect(onFetchHotContractAnalysis).toHaveBeenCalledTimes(1));
    const firstCall = onFetchHotContractAnalysis.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    const selectedRpc = firstCall?.selectedRpc;
    expect(selectedRpc).toBeDefined();
    expect(selectedRpc?.providerConfigId).toBeNull();
    expect(firstCall?.source?.providerConfigId).toBeNull();
  });

  it("ignores invalid local-only sample windows and submits no window", async () => {
    const onFetchHotContractAnalysis = vi.fn<
      (input: HotContractAnalysisFetchInput) => Promise<HotContractAnalysisReadModel>
    >(async () => model());
    renderHotContract({ onFetchHotContractAnalysis });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.change(screen.getByLabelText("Sample window"), {
      target: { value: "all-history apiKey=secret" },
    });

    expect(screen.queryByText("Use a bounded sample window from 1h to 720h or 1d to 30d.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await waitFor(() => expect(onFetchHotContractAnalysis).toHaveBeenCalledTimes(1));
    const firstCall = onFetchHotContractAnalysis.mock.calls[0]?.[0];
    expect(firstCall?.source?.providerConfigId).toBeNull();
    expect(firstCall?.source?.window).toBeNull();
  });

  it("validates optional tx hash seed as display-only provenance", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const seedTxHash = `0x${"b".repeat(64)}`;
    const onFetchHotContractAnalysis = vi.fn<
      (input: HotContractAnalysisFetchInput) => Promise<HotContractAnalysisReadModel>
    >(async () => model());
    renderHotContract({ onFetchHotContractAnalysis });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.change(screen.getByLabelText("Optional tx hash seed (display only)"), {
      target: { value: "0x1234" },
    });

    expect(screen.getByText("Enter a 0x-prefixed 32-byte transaction hash or leave seed empty.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Optional tx hash seed (display only)"), {
      target: { value: seedTxHash },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await waitFor(() => expect(onFetchHotContractAnalysis).toHaveBeenCalledTimes(1));
    const firstCall = onFetchHotContractAnalysis.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    expect(firstCall).toEqual(expect.objectContaining({ seedTxHash }));
    expect(JSON.stringify(firstCall?.selectedRpc)).not.toContain(seedTxHash);
    expect(JSON.stringify(firstCall?.source)).not.toContain(seedTxHash);
    expect(firstCall?.source?.cursor).toBeNull();
    expect(firstCall?.source?.window).toBeNull();
    await waitFor(() => expect(screen.getAllByText(seedTxHash).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copiedSummary = String(writeText.mock.calls.at(-1)?.[0] ?? "");
    expect(copiedSummary).toContain(`seedTxHash=${seedTxHash}`);
    expect(copiedSummary).not.toContain("topsecret");
    expect(copiedSummary).not.toContain("secret-key");
  });

  it("prefills initial contract and seed values when navigation props change", () => {
    const seedTxHash = `0x${"c".repeat(64)}`;
    const nextAddress = "0x3333333333333333333333333333333333333333";
    const nextSeedTxHash = `0x${"d".repeat(64)}`;
    const onFetchHotContractAnalysis = vi.fn<
      (input: HotContractAnalysisFetchInput) => Promise<HotContractAnalysisReadModel>
    >(async () => model());
    const { rerender } = renderScreen(
      <HotContractAnalysisView
        chainId={1n}
        chainName="Ethereum"
        chainReady={true}
        initialContractAddress={address}
        initialSeedTxHash={seedTxHash}
        onFetchHotContractAnalysis={onFetchHotContractAnalysis}
        rpcUrl={rpcUrl}
      />,
    );

    expect(screen.getByLabelText("Contract address")).toHaveValue(address);
    expect(screen.getByLabelText("Optional tx hash seed (display only)")).toHaveValue(seedTxHash);

    rerender(
      <HotContractAnalysisView
        chainId={1n}
        chainName="Ethereum"
        chainReady={true}
        initialContractAddress={nextAddress}
        initialSeedTxHash={nextSeedTxHash}
        onFetchHotContractAnalysis={onFetchHotContractAnalysis}
        rpcUrl={rpcUrl}
      />,
    );

    expect(screen.getByLabelText("Contract address")).toHaveValue(nextAddress);
    expect(screen.getByLabelText("Optional tx hash seed (display only)")).toHaveValue(nextSeedTxHash);
  });

  it("validates and normalizes bounded sample windows", async () => {
    const onFetchHotContractAnalysis = vi.fn<
      (input: HotContractAnalysisFetchInput) => Promise<HotContractAnalysisReadModel>
    >(async () => model());
    renderHotContract({
      abiRegistryState: abiRegistryState([
        dataSource({ id: "configured-mainnet", chainId: 1, providerKind: "customIndexer" }),
      ]),
      onFetchHotContractAnalysis,
    });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.change(screen.getByLabelText("Source provider"), {
      target: { value: "configured-mainnet" },
    });
    fireEvent.change(screen.getByLabelText("Sample window"), {
      target: { value: "all-history apiKey=secret" },
    });

    expect(screen.getByText("Use a bounded sample window from 1h to 720h or 1d to 30d.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(onFetchHotContractAnalysis).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Sample window"), { target: { value: "31d" } });
    expect(screen.getByRole("button", { name: "Analyze" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Sample window"), { target: { value: "24H" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await waitFor(() => expect(onFetchHotContractAnalysis).toHaveBeenCalledTimes(1));
    expect(onFetchHotContractAnalysis.mock.calls[0]?.[0].source?.window).toBe("24h");
  });

  it("renders source missing and RPC-only limited states", async () => {
    renderHotContract({
      onFetchHotContractAnalysis: vi.fn(async () =>
        model({
          status: "limited",
          sources: { source: status("notConfigured", "no indexed transaction source") },
          sampleCoverage: { sourceStatus: "notConfigured", returnedSamples: 0, omittedSamples: 0 },
          samples: [],
          errorSummary: "No indexed source is configured for this contract.",
        }),
      ),
    });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(await screen.findByText("Source missing")).toBeInTheDocument();
    expect(screen.getByText("RPC-only limited analysis")).toBeInTheDocument();
    expect(screen.getByText("No indexed source is configured for this contract.")).toBeInTheDocument();
  });

  it("shows source unavailable when provider source is rate limited", async () => {
    renderHotContract({
      onFetchHotContractAnalysis: vi.fn(async () =>
        model({
          status: "sourceUnavailable",
          sources: { source: status("rateLimited", "provider rate limited") },
          sampleCoverage: { sourceStatus: "rateLimited", returnedSamples: 0, omittedSamples: 0 },
          samples: [],
        }),
      ),
    });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(await screen.findByText("Source unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Analysis ready")).not.toBeInTheDocument();
    expect(screen.getByText("Source: rateLimited (provider rate limited)")).toBeInTheDocument();
  });

  it("renders detailed sample coverage metadata", async () => {
    renderHotContract({
      onFetchHotContractAnalysis: vi.fn(async () =>
        model({
          sampleCoverage: {
            requestedLimit: 25,
            returnedSamples: 12,
            omittedSamples: 3,
            sourceStatus: "ok",
            sourceKind: "customIndexer",
            providerConfigId: "configured-mainnet",
            queryWindow: "24h",
            oldestBlock: 100,
            newestBlock: 140,
            oldestBlockTime: "2026-04-30T00:00:00Z",
            newestBlockTime: "2026-04-30T00:10:00Z",
            providerStatus: "ok",
            rateLimitStatus: "notRateLimited",
            completeness: "partial",
            payloadStatus: "ok",
          },
        }),
      ),
    });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    const coverage = await screen.findByLabelText("Sample coverage");
    expect(within(coverage).getByText("Source kind").nextElementSibling).toHaveTextContent(
      "customIndexer",
    );
    expect(within(coverage).getByText("Provider config ID").nextElementSibling).toHaveTextContent(
      "configured-mainnet",
    );
    expect(within(coverage).getByText("Query window").nextElementSibling).toHaveTextContent("24h");
    expect(within(coverage).getByText("Oldest block").nextElementSibling).toHaveTextContent("100");
    expect(within(coverage).getByText("Newest block").nextElementSibling).toHaveTextContent("140");
    expect(within(coverage).getByText("Oldest block time").nextElementSibling).toHaveTextContent(
      "2026-04-30T00:00:00Z",
    );
    expect(within(coverage).getByText("Newest block time").nextElementSibling).toHaveTextContent(
      "2026-04-30T00:10:00Z",
    );
    expect(within(coverage).getByText("Rate limit status").nextElementSibling).toHaveTextContent(
      "notRateLimited",
    );
    expect(within(coverage).getByText("Completeness").nextElementSibling).toHaveTextContent(
      "partial",
    );
    expect(within(coverage).getByText("Payload status").nextElementSibling).toHaveTextContent("ok");
  });

  it("ignores stale in-flight analysis results after the contract changes", async () => {
    const first = deferred<HotContractAnalysisReadModel>();
    const second = deferred<HotContractAnalysisReadModel>();
    const nextAddress = "0x2222222222222222222222222222222222222222";
    const onFetchHotContractAnalysis = vi.fn((input: HotContractAnalysisFetchInput) =>
      input.contractAddress === address ? first.promise : second.promise,
    );
    renderHotContract({ onFetchHotContractAnalysis });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: nextAddress } });

    await act(async () => {
      first.resolve(model());
      await Promise.resolve();
    });

    expect(screen.queryByText(address)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await act(async () => {
      second.resolve(model({ contract: { address: nextAddress } }));
      await Promise.resolve();
    });

    expect(await screen.findByText(nextAddress)).toBeInTheDocument();
  });

  it("ignores stale in-flight analysis results after request controls change", async () => {
    const first = deferred<HotContractAnalysisReadModel>();
    const second = deferred<HotContractAnalysisReadModel>();
    const seedTxHash = `0x${"b".repeat(64)}`;
    const onFetchHotContractAnalysis = vi.fn((input: HotContractAnalysisFetchInput) =>
      input.source?.window === "24h" ? second.promise : first.promise,
    );
    renderHotContract({
      abiRegistryState: abiRegistryState([
        dataSource({ id: "configured-mainnet", chainId: 1, providerKind: "customIndexer" }),
      ]),
      onFetchHotContractAnalysis,
    });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.change(screen.getByLabelText("Source provider"), {
      target: { value: "configured-mainnet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    fireEvent.change(screen.getByLabelText("Sample window"), { target: { value: "24H" } });
    fireEvent.change(screen.getByLabelText("Optional tx hash seed (display only)"), {
      target: { value: seedTxHash },
    });

    await act(async () => {
      first.resolve(model({ errorSummary: "stale-source-result" }));
      await Promise.resolve();
    });

    expect(screen.queryByText("stale-source-result")).not.toBeInTheDocument();
    expect(screen.queryByText("Contract Identity")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await act(async () => {
      second.resolve(model({ seedTxHash }));
      await Promise.resolve();
    });

    expect(await screen.findByText("Contract Identity")).toBeInTheDocument();
    expect(onFetchHotContractAnalysis).toHaveBeenCalledTimes(2);
    expect(onFetchHotContractAnalysis.mock.calls[1]?.[0].source?.window).toBe("24h");
    expect(onFetchHotContractAnalysis.mock.calls[1]?.[0].seedTxHash).toBe(seedTxHash);
  });

  it("renders selector, topic, examples, advisory labels, and avoids full payloads", async () => {
    const fullPayload = `0x${"f".repeat(256)}`;
    renderHotContract();

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(await screen.findByText("Contract Identity")).toBeInTheDocument();
    expect(screen.getByText("0xa9059cbb")).toBeInTheDocument();
    expect(screen.getByText("0xddf252ad")).toBeInTheDocument();
    expect(screen.getAllByText("ERC-20 transfer candidate").length).toBeGreaterThan(0);
    expect(screen.getByText("Transfer event candidate")).toBeInTheDocument();
    expect(screen.getByText(txHash)).toBeInTheDocument();
    expect(screen.getByText("Sampled only")).toBeInTheDocument();
    expect(screen.getByText("transfer(address,uint256)")).toBeInTheDocument();
    expect(screen.queryByText(fullPayload)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("topsecret");
    expect(document.body.textContent).not.toContain("secret-key");
  });

  it("renders P6-2f cross-layer security states as bounded advisory read models", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const fullPayload = `0x${"f".repeat(256)}`;
    const maliciousReason = [
      "provider rate limited at https://user:password@api.example.invalid/v1?apikey=secret-key",
      "Authorization: Bearer secret-token",
      `calldata=${fullPayload}`,
      "provider raw body={\"apiKey\":\"secret-json-key\",\"logs\":\"full logs\"}",
    ].join(" ");
    const baseModel = model();
    const managedTxHash = `0x${"d".repeat(64)}`;
    const onFetchHotContractAnalysis = vi.fn<
      (input: HotContractAnalysisFetchInput) => Promise<HotContractAnalysisReadModel>
    >(async () =>
      model({
        status: "sourceUnavailable",
        rpc: {
          ...baseModel.rpc,
          actualChainId: 5,
          chainStatus: "chainMismatch",
        },
        sources: {
          chainId: status("chainMismatch", "wrong chain"),
          source: status("rateLimited", maliciousReason),
        },
        sampleCoverage: {
          requestedLimit: 25,
          returnedSamples: 6,
          omittedSamples: 2,
          sourceStatus: "rateLimited",
          sourceKind: "customIndexer",
          providerConfigId: "configured-mainnet",
          queryWindow: "24h",
          oldestBlock: 100,
          newestBlock: 123,
          oldestBlockTime: "2026-04-30T00:00:00Z",
          newestBlockTime: "2026-04-30T00:05:00Z",
          providerStatus: "rateLimited",
          rateLimitStatus: "rateLimited",
          completeness: "partial",
          payloadStatus: "unavailable",
        },
        samples: [
          ...baseModel.samples,
          {
            ...baseModel.samples[0],
            txHash: managedTxHash,
            selector: "0xdafa4d41",
            calldataLength: 36,
            calldataHash: "0xmanagedcalldatahash",
            logTopic0: [],
            providerLabel: "advisory explorer sample",
          },
        ],
        analysis: {
          selectors: [
            baseModel.analysis.selectors[0],
            {
              ...baseModel.analysis.selectors[0],
              selector: "0x095ea7b3",
              sampledCallCount: 2,
              advisoryLabels: ["ERC-20 approval candidate", "ERC-20 revoke candidate"],
            },
            {
              ...baseModel.analysis.selectors[0],
              selector: "0xdafa4d41",
              sampledCallCount: 1,
              advisoryLabels: ["Managed ABI selector candidate"],
            },
            {
              ...baseModel.analysis.selectors[0],
              selector: "0x12345678",
              sampledCallCount: 1,
              advisoryLabels: ["Unknown raw selector candidate"],
            },
            {
              ...baseModel.analysis.selectors[0],
              selector: "0xe63d38ed",
              sampledCallCount: 1,
              advisoryLabels: ["Batch disperse candidate"],
            },
          ],
          topics: baseModel.analysis.topics,
        },
        decode: {
          status: "partial",
          items: [
            baseModel.decode.items[0],
            {
              kind: "function",
              status: "candidate",
              selector: "0xdafa4d41",
              topic: null,
              signature: "customDoThing(uint256)",
              source: "abiCache",
              confidence: "advisory",
              abiVersionId: "stale-v1",
              abiSelected: true,
              reasons: ["abiFunctionSelectorMatch"],
            },
          ],
          abiSources: [
            {
              ...baseModel.decode.abiSources[0],
              sourceKind: "explorerFetched",
              versionId: "stale-v1",
              fetchSourceStatus: "notVerified",
              cacheStatus: "cacheStale",
              proxyDetected: true,
              providerProxyHint: "implementation may differ",
            },
          ],
          classificationCandidates: [
            ...baseModel.decode.classificationCandidates,
            {
              kind: "erc20Approval",
              label: "ERC-20 approval candidate",
              confidence: "candidate",
              source: "selector",
              selector: "0x095ea7b3",
              topic: null,
              signature: "approve(address,uint256)",
              reasons: ["sample selector"],
            },
            {
              kind: "erc20RevokeCandidate",
              label: "ERC-20 revoke candidate",
              confidence: "candidate",
              source: "selector",
              selector: "0x095ea7b3",
              topic: null,
              signature: "approve(address,uint256)",
              reasons: ["zero approval amount hint"],
            },
            {
              kind: "batchDisperse",
              label: "Batch disperse candidate",
              confidence: "candidate",
              source: "selector",
              selector: "0xe63d38ed",
              topic: null,
              signature: null,
              reasons: ["sample selector"],
            },
            {
              kind: "rawCalldataUnknown",
              label: "Unknown raw selector candidate",
              confidence: "unknown",
              source: "providerSample",
              selector: "0x12345678",
              topic: null,
              signature: null,
              reasons: ["noFunctionDecodeCandidate"],
            },
          ],
          uncertaintyStatuses: [
            ...baseModel.decode.uncertaintyStatuses,
            {
              code: "proxyImplementationUncertainty",
              severity: "warning",
              source: "abiCache",
              summary: "implementation may differ",
            },
            {
              code: "staleAbi",
              severity: "warning",
              source: "stale-v1",
              summary: "ABI cache is stale.",
            },
            {
              code: "unverifiedAbi",
              severity: "warning",
              source: "stale-v1",
              summary: "Explorer ABI is not verified.",
            },
            {
              code: "providerPartialSample",
              severity: "warning",
              source: "providerSample",
              summary: "Source returned a partial sample.",
            },
            {
              code: "unknownSelector",
              severity: "info",
              source: "providerSample",
              summary: "A sampled selector had no decode candidate.",
            },
          ],
        },
      }),
    );
    renderHotContract({ history: [historyRecord()], onFetchHotContractAnalysis });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(await screen.findByText("Chain/RPC mismatch")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Source: rateLimited");
    expect(document.body.textContent).toContain("[redacted_url]");
    expect(document.body.textContent).toContain("[redacted_auth]");
    expect(document.body.textContent).toContain("[redacted_body]");
    const coverage = screen.getByLabelText("Sample coverage");
    expect(within(coverage).getByText("Rate limit status").nextElementSibling).toHaveTextContent(
      "rateLimited",
    );
    expect(within(coverage).getByText("Omitted samples").nextElementSibling).toHaveTextContent("2");
    expect(screen.getByText("0x095ea7b3")).toBeInTheDocument();
    expect(screen.getByText("0xdafa4d41")).toBeInTheDocument();
    expect(screen.getByText("0x12345678")).toBeInTheDocument();
    expect(screen.getByText("0xe63d38ed")).toBeInTheDocument();
    expect(document.body.textContent).toContain("ERC-20 transfer candidate");
    expect(document.body.textContent).toContain("ERC-20 approval candidate");
    expect(document.body.textContent).toContain("ERC-20 revoke candidate");
    expect(document.body.textContent).toContain("Managed ABI selector candidate");
    expect(document.body.textContent).toContain("Unknown raw selector candidate");
    expect(document.body.textContent).toContain("Batch disperse candidate");
    expect(screen.getByText("customDoThing(uint256)")).toBeInTheDocument();
    expect(screen.getByText("Proxy implementation uncertainty")).toBeInTheDocument();
    expect(screen.getByText("Stale ABI")).toBeInTheDocument();
    expect(screen.getByText("Unverified ABI")).toBeInTheDocument();
    expect(screen.getByText("Provider Partial Sample")).toBeInTheDocument();
    expect(screen.getByText("Unknown selector")).toBeInTheDocument();
    expect(screen.getByText("function · candidate · abiCache")).toBeInTheDocument();
    expect(screen.getByText("explorerFetched stale-v1")).toBeInTheDocument();
    expect(screen.getByText("notVerified · ok · cacheStale")).toBeInTheDocument();
    expect(screen.getAllByText("providerSample").length).toBeGreaterThan(0);

    const request = JSON.stringify(onFetchHotContractAnalysis.mock.calls[0]?.[0]);
    expect(request).not.toContain("private note");
    expect(request).not.toContain("private wallet inventory");
    expect(request).not.toContain("private local frozen key");
    expect(request).not.toContain("local history secret source");
    expect(request).not.toContain("abi_call_metadata");

    const screenText = document.body.textContent ?? "";
    expect(screenText).not.toContain(fullPayload);
    expect(screenText).not.toContain("secret-key");
    expect(screenText).not.toContain("secret-token");
    expect(screenText).not.toContain("secret-json-key");
    expect(screenText.toLowerCase()).not.toContain("raw body");

    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copiedSummary = String(writeText.mock.calls.at(-1)?.[0] ?? "");
    expect(copiedSummary).toContain("selector=0xdafa4d41");
    expect(copiedSummary).not.toContain(fullPayload);
    expect(copiedSummary).not.toContain("secret-key");
    expect(copiedSummary).not.toContain("secret-token");
  });

  it("uses enabled ABI data sources for the active chain as source provider options", async () => {
    const onFetchHotContractAnalysis = vi.fn<
      (input: HotContractAnalysisFetchInput) => Promise<HotContractAnalysisReadModel>
    >(async () => model());
    renderHotContract({
      abiRegistryState: abiRegistryState([
        dataSource({ id: "configured-mainnet", chainId: 1 }),
        dataSource({ id: "disabled-mainnet", chainId: 1, enabled: false }),
        dataSource({ id: "configured-base", chainId: 8453 }),
      ]),
      onFetchHotContractAnalysis,
    });

    const sourceSelect = screen.getByLabelText("Source provider");
    expect(within(sourceSelect).getByRole("option", { name: "Local/RPC only" })).toBeInTheDocument();
    expect(within(sourceSelect).getByRole("option", { name: /configured-mainnet/ })).toBeInTheDocument();
    expect(within(sourceSelect).queryByRole("option", { name: /disabled-mainnet/ })).not.toBeInTheDocument();
    expect(within(sourceSelect).queryByRole("option", { name: /configured-base/ })).not.toBeInTheDocument();
    expect(within(sourceSelect).queryByRole("option", { name: /etherscan-mainnet/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.change(sourceSelect, { target: { value: "configured-mainnet" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await waitFor(() => expect(onFetchHotContractAnalysis).toHaveBeenCalledTimes(1));
    const firstCall = onFetchHotContractAnalysis.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    const selectedRpc = firstCall?.selectedRpc;
    expect(selectedRpc).toBeDefined();
    expect(selectedRpc?.providerConfigId).toBeNull();
    const source = firstCall?.source;
    expect(source).toBeDefined();
    expect(source?.providerConfigId).toBe("configured-mainnet");
  });

  it("falls back to Local/RPC only when the selected ABI data source becomes unavailable", async () => {
    const onFetchHotContractAnalysis = vi.fn<
      (input: HotContractAnalysisFetchInput) => Promise<HotContractAnalysisReadModel>
    >(async () => model());
    const { rerender } = renderScreen(
      <HotContractAnalysisView
        abiRegistryState={abiRegistryState([dataSource({ id: "configured-mainnet", chainId: 1 })])}
        chainId={1n}
        chainName="Ethereum"
        chainReady={true}
        onFetchHotContractAnalysis={onFetchHotContractAnalysis}
        rpcUrl={rpcUrl}
      />,
    );

    fireEvent.change(screen.getByLabelText("Source provider"), {
      target: { value: "configured-mainnet" },
    });
    expect(screen.getByLabelText("Source provider")).toHaveValue("configured-mainnet");

    rerender(
      <HotContractAnalysisView
        abiRegistryState={abiRegistryState([dataSource({ id: "configured-base", chainId: 8453 })])}
        chainId={1n}
        chainName="Ethereum"
        chainReady={true}
        onFetchHotContractAnalysis={onFetchHotContractAnalysis}
        rpcUrl={rpcUrl}
      />,
    );

    expect(screen.getByLabelText("Source provider")).toHaveValue("local-only");
    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await waitFor(() => expect(onFetchHotContractAnalysis).toHaveBeenCalledTimes(1));
    const firstCall = onFetchHotContractAnalysis.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    const selectedRpc = firstCall?.selectedRpc;
    expect(selectedRpc).toBeDefined();
    expect(selectedRpc?.providerConfigId).toBeNull();
    const source = firstCall?.source;
    expect(source).toBeDefined();
    expect(source?.providerConfigId).toBeNull();
  });

  it("redacts malicious analysis error summaries on screen and in copied summaries", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const maliciousCalldata = `0x${"f".repeat(256)}`;
    const maliciousSummary = [
      "provider failed at https://user:password@api.example.invalid/v1?apikey=secret-api-key",
      "Authorization: Bearer secret-token-value",
      `calldata=${maliciousCalldata}`,
      "raw body={\"apiKey\":\"secret-json-key\",\"url\":\"https://secret.example.invalid/path\"}",
    ].join(" ");
    renderHotContract({
      onFetchHotContractAnalysis: vi.fn(async () => model({ errorSummary: maliciousSummary })),
    });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByText("Contract Identity");

    const screenText = document.body.textContent ?? "";
    expect(screenText).toContain("[redacted_url]");
    expect(screenText).toContain("[redacted_body]");
    expect(screenText.toLowerCase()).not.toContain("raw body");
    expect(screenText).not.toContain("{\"apiKey\"");
    expect(screenText).not.toContain("\"url\"");
    expect(screenText).not.toContain("secret-api-key");
    expect(screenText).not.toContain("secret-token-value");
    expect(screenText).not.toContain(maliciousCalldata);
    expect(screenText).not.toContain("secret.example.invalid");

    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copiedSummary = String(writeText.mock.calls.at(-1)?.[0] ?? "");
    expect(copiedSummary).toContain("error=");
    expect(copiedSummary).toContain("[redacted_url]");
    expect(copiedSummary).toContain("[redacted_body]");
    expect(copiedSummary.toLowerCase()).not.toContain("raw body");
    expect(copiedSummary).not.toContain("{\"apiKey\"");
    expect(copiedSummary).not.toContain("\"url\"");
    expect(copiedSummary).not.toContain("secret-api-key");
    expect(copiedSummary).not.toContain("secret-token-value");
    expect(copiedSummary).not.toContain(maliciousCalldata);
    expect(copiedSummary).not.toContain("secret.example.invalid");
  });

  it("redacts malicious source status reasons in provider visibility pills", async () => {
    const maliciousCalldata = `0x${"f".repeat(256)}`;
    const maliciousReason = [
      "provider failed at https://user:password@api.example.invalid/v1?apikey=secret-api-key",
      "Authorization: Bearer secret-token-value",
      `calldata=${maliciousCalldata}`,
      "raw body={\"apiKey\":\"secret-json-key\",\"url\":\"https://secret.example.invalid/path\"}",
    ].join(" ");
    renderHotContract({
      onFetchHotContractAnalysis: vi.fn(async () =>
        model({
          sources: {
            source: status("limited", maliciousReason),
          },
        }),
      ),
    });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByText("Contract Identity");

    const screenText = document.body.textContent ?? "";
    expect(screenText).toContain("Source: limited");
    expect(screenText).toContain("[redacted_url]");
    expect(screenText).toContain("[redacted_auth]");
    expect(screenText).toContain("[redacted_body]");
    expect(screenText).not.toContain("secret-api-key");
    expect(screenText).not.toContain("secret-token-value");
    expect(screenText).not.toContain("secret-json-key");
    expect(screenText).not.toContain(maliciousCalldata);
    expect(screenText).not.toContain("secret.example.invalid");
    expect(screenText.toLowerCase()).not.toContain("raw body");
    expect(screenText).not.toContain("{\"apiKey\"");
  });

  it("copies only allowed hot contract fields and bounded summaries", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderHotContract();

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByText("Contract Identity");

    fireEvent.click(screen.getByRole("button", { name: "Copy contract address" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(address));

    fireEvent.click(screen.getByRole("button", { name: "Copy selector" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("0xa9059cbb"));

    fireEvent.click(screen.getByRole("button", { name: "Copy topic" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("0xddf252ad"));

    fireEvent.click(screen.getByRole("button", { name: "Copy code hash" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("0xcodehash"));

    fireEvent.click(screen.getByRole("button", { name: "Copy ABI source identity" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("safe-source"));

    fireEvent.click(within(screen.getByLabelText("Example transactions")).getByRole("button", { name: "Copy sample tx hash" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(txHash));

    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining(`contract=${address}`)));

    const copiedValues = writeText.mock.calls.map((call) => String(call[0])).join("\n");
    expect(copiedValues).not.toContain("topsecret");
    expect(copiedValues).not.toContain("secret-key");
    expect(copiedValues).not.toContain("calldata=");
    expect(copiedValues).not.toContain("logs=");
  });

  it("shows only bounded local history hints and never uploads local record details", async () => {
    const onFetchHotContractAnalysis = vi.fn<
      (input: HotContractAnalysisFetchInput) => Promise<HotContractAnalysisReadModel>
    >(async () => model());
    renderHotContract({
      history: [
        historyRecord(),
        historyRecord({
          submission: { ...historyRecord().submission, tx_hash: `0x${"c".repeat(64)}` },
        }),
      ],
      onFetchHotContractAnalysis,
    });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await waitFor(() => expect(onFetchHotContractAnalysis).toHaveBeenCalledTimes(1));
    const request = JSON.stringify(onFetchHotContractAnalysis.mock.calls[0]?.[0]);
    expect(request).not.toContain("private note");
    expect(request).not.toContain("private wallet inventory");
    expect(request).not.toContain("private local frozen key");
    expect(request).not.toContain("local history secret source");
    expect(request).not.toContain("account_index");
    expect(request).not.toContain("abi_call_metadata");

    expect(await screen.findByText("Local example hint")).toBeInTheDocument();
    expect(screen.getByText("1 known locally")).toBeInTheDocument();
    expect(screen.getByText("known locally")).toBeInTheDocument();

    const screenText = document.body.textContent ?? "";
    expect(screenText).not.toContain("private note");
    expect(screenText).not.toContain("private wallet inventory");
    expect(screenText).not.toContain("private local frozen key");
    expect(screenText).not.toContain("local history secret source");
    expect(screenText).not.toContain("Account 7");
  });

  it("copies sanitized bounded ABI source identities", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const maliciousSourceId = `https://secret.example.invalid/path?apikey=secret-key-${"x".repeat(160)}`;
    const rawPayload = `0x${"f".repeat(256)}`;
    const maliciousProviderConfigId = `provider raw body={"apiKey":"secret-json-key","calldata":"${rawPayload}"}`;
    const baseModel = model();
    renderHotContract({
      onFetchHotContractAnalysis: vi.fn(async () =>
        model({
          decode: {
            ...baseModel.decode,
            abiSources: [
              {
                ...baseModel.decode.abiSources[0],
                userSourceId: maliciousSourceId,
                providerConfigId: maliciousProviderConfigId,
                versionId: maliciousProviderConfigId,
              },
            ],
          },
        }),
      ),
    });

    fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByText("Contract Identity");

    expect(screen.queryByRole("button", { name: "Copy ABI source hash" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy ABI source identity" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = String(writeText.mock.calls.at(-1)?.[0] ?? "");
    expect(copied.length).toBeLessThanOrEqual(120);
    expect(copied).toContain("[redacted_url]");
    expect(copied).toContain("...");
    expect(copied).not.toContain("secret-key");
    expect(copied).not.toContain("secret-json-key");
    expect(copied).not.toContain(rawPayload);
    expect(copied.toLowerCase()).not.toContain("raw body");
  });
});
