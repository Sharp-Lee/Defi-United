import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeHistoryRecord } from "../../core/history/schema";
import type { AbiCacheEntryRecord, AbiRegistryState, RawCalldataSubmitInput } from "../../lib/tauri";
import { renderScreen } from "../../test/render";
import { RawCalldataView } from "./RawCalldataView";

const provider = vi.hoisted(() => ({
  estimateGas: vi.fn(),
  getBlock: vi.fn(),
  getFeeData: vi.fn(),
  getNetwork: vi.fn(),
  getTransactionCount: vi.fn(),
}));

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ...actual,
    JsonRpcProvider: vi.fn(() => provider),
  };
});

const account = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const rpcUrl = "https://rpc.example.invalid/mainnet?apikey=secret";

function historyRecord(txHash = "0xraw") {
  return normalizeHistoryRecord({
    schema_version: 2,
    intent: {
      transaction_type: "rawCalldata",
      rpc_url: "https://rpc.example.invalid",
      account_index: 1,
      chain_id: 1,
      from: account,
      to: target,
      value_wei: "0",
      native_value_wei: "0",
      selector: "0x12345678",
      nonce: 7,
      gas_limit: "50000",
      max_fee_per_gas: "41500000000",
      max_priority_fee_per_gas: "1500000000",
    },
    intent_snapshot: {
      source: "rawCalldata",
      captured_at: "1700000000",
    },
    submission: {
      frozen_key: "raw-calldata-test",
      tx_hash: txHash,
      kind: "rawCalldata",
      transaction_type: "rawCalldata",
      source: "submission",
      chain_id: 1,
      account_index: 1,
      from: account,
      to: target,
      value_wei: "0",
      native_value_wei: "0",
      selector: "0x12345678",
      nonce: 7,
      gas_limit: "50000",
      max_fee_per_gas: "41500000000",
      max_priority_fee_per_gas: "1500000000",
      broadcasted_at: "1700000001",
      replaces_tx_hash: null,
    },
    outcome: {
      state: "Pending",
      tx_hash: txHash,
      finalized_at: null,
      receipt: null,
      reconciled_at: null,
      reconcile_summary: null,
      error_summary: null,
      dropped_review_history: [],
    },
    nonce_thread: {
      source: "derived",
      key: `1:1:${account.toLowerCase()}:7`,
      chain_id: 1,
      account_index: 1,
      from: account,
      nonce: 7,
      replaces_tx_hash: null,
      replaced_by_tx_hash: null,
    },
    raw_calldata_metadata: {
      intent_kind: "rawCalldata",
      calldata_hash_version: "keccak256-v1",
      calldata_hash: "0x1234",
      calldata_byte_length: 4,
      selector: "0x12345678",
      selector_status: "present",
      preview: {
        display: "0x12345678",
        prefix: "0x12345678",
        suffix: "",
        truncated: false,
        omitted_bytes: 0,
      },
      warning_acknowledgements: [],
      warning_summaries: [],
      blocking_statuses: [],
      inference: {
        inference_status: "unknown",
        source_status: "noAbiForContract",
      },
      frozen_key: "raw-calldata-test",
    },
  });
}

function renderRawCalldata(
  options: {
    abiRegistryState?: AbiRegistryState | null;
    onSubmitRawCalldata?: (input: RawCalldataSubmitInput) => Promise<ReturnType<typeof historyRecord>>;
    onListAbiFunctions?: Parameters<typeof RawCalldataView>[0]["onListAbiFunctions"];
  } = {},
) {
  const abiRegistryState = Object.prototype.hasOwnProperty.call(options, "abiRegistryState")
    ? options.abiRegistryState
    : { schemaVersion: 1, dataSources: [], cacheEntries: [] };
  renderScreen(
    <RawCalldataView
      abiRegistryState={abiRegistryState}
      accounts={[
        {
          address: account,
          index: 1,
          label: "Account 1",
          nativeBalanceWei: 1_000_000_000_000_000_000n,
          nonce: 7,
        },
      ]}
      chainId={1n}
      chainName="Ethereum"
      history={[]}
      onListAbiFunctions={options.onListAbiFunctions}
      onSubmitRawCalldata={options.onSubmitRawCalldata}
      rpcUrl={rpcUrl}
    />,
  );
}

function fillBaseDraft(calldata = "0x12345678") {
  fireEvent.change(screen.getByLabelText("To"), { target: { value: target } });
  fireEvent.change(screen.getByLabelText("Calldata"), { target: { value: calldata } });
}

function abiEntry(overrides: Partial<AbiCacheEntryRecord> = {}): AbiCacheEntryRecord {
  return {
    chainId: 1,
    contractAddress: target,
    sourceKind: "userImported",
    versionId: "v1",
    attemptId: "attempt-1",
    sourceFingerprint: "source-fingerprint",
    abiHash: "abi-hash",
    selected: true,
    fetchSourceStatus: "ok",
    validationStatus: "ok",
    cacheStatus: "cacheFresh",
    selectionStatus: "selected",
    functionCount: 1,
    eventCount: 0,
    errorCount: 0,
    selectorSummary: {
      functionSelectorCount: 1,
      eventTopicCount: 0,
      errorSelectorCount: 0,
      duplicateSelectorCount: 0,
      conflictCount: 0,
    },
    fetchedAt: "2026-04-29T00:00:00.000Z",
    importedAt: "2026-04-29T00:00:00.000Z",
    lastValidatedAt: "2026-04-29T00:00:00.000Z",
    staleAfter: null,
    lastErrorSummary: null,
    providerProxyHint: null,
    proxyDetected: false,
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
    ...overrides,
  };
}

function registry(cacheEntries: AbiCacheEntryRecord[]): AbiRegistryState {
  return { schemaVersion: 1, dataSources: [], cacheEntries };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function matchedCatalog(selector = "0x12345678") {
  return {
    status: "success" as const,
    reasons: [],
    sourceKind: "userImported" as const,
    versionId: "v1",
    abiHash: "abi-hash",
    sourceFingerprint: "source-fingerprint",
    functions: [
      {
        name: "setOwner",
        signature: "setOwner(address)",
        selector,
        stateMutability: "nonpayable",
        callKind: "write",
        supported: true,
        inputs: [],
        outputs: [],
      },
    ],
    unsupportedItemCount: 0,
  };
}

describe("RawCalldataView", () => {
  beforeEach(() => {
    provider.getNetwork.mockReset().mockResolvedValue({ chainId: 1n });
    provider.getFeeData.mockReset().mockResolvedValue({
      gasPrice: 30_000_000_000n,
      maxFeePerGas: 40_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
    });
    provider.getBlock.mockReset().mockResolvedValue({ baseFeePerGas: 20_000_000_000n });
    provider.getTransactionCount.mockReset().mockResolvedValue(7);
    provider.estimateGas.mockReset().mockResolvedValue(50_000n);
  });

  it("requires acknowledgement for an unknown selector before submit", async () => {
    renderRawCalldata();
    fillBaseDraft("0x12345678");

    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByLabelText("Raw calldata confirmation")).toBeInTheDocument());
    expect(screen.getByText(/unknown · noAbiForContract/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Acknowledge unknown selector/)).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Acknowledge unknown selector/));

    expect(screen.getByLabelText(/Acknowledge unknown selector/)).toBeChecked();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("surfaces empty calldata, nonzero value, and manual gas warnings", async () => {
    renderRawCalldata();
    fillBaseDraft("0x");
    fireEvent.change(screen.getByLabelText("Native value (wei)"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Gas limit"), { target: { value: "55555" } });

    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    const warnings = await screen.findByLabelText("Raw calldata warnings");
    expect(within(warnings).getByLabelText(/Acknowledge empty calldata/)).toBeInTheDocument();
    expect(within(warnings).getByLabelText(/Acknowledge nonzero native value/)).toBeInTheDocument();
    expect(within(warnings).getByLabelText(/Acknowledge manual gas/)).toBeInTheDocument();
    expect(within(warnings).getByLabelText(/Acknowledge unknown selector/)).toBeInTheDocument();
    expect(warnings).toHaveTextContent("Manual gas limit is set.");
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });

  it("requires acknowledgement for conflict, stale, and unavailable selector inference", async () => {
    const cases: Array<[string, AbiRegistryState | null, RegExp]> = [
      [
        "conflict",
        registry([
          abiEntry({
            validationStatus: "selectorConflict",
            selectorSummary: {
              functionSelectorCount: 1,
              eventTopicCount: 0,
              errorSelectorCount: 0,
              duplicateSelectorCount: 1,
              conflictCount: 1,
            },
          }),
        ]),
        /Acknowledge selector conflict/,
      ],
      [
        "stale",
        registry([abiEntry({ cacheStatus: "cacheStale" })]),
        /Acknowledge stale inference/,
      ],
      ["unavailable", null, /Acknowledge unavailable inference/],
    ];

    for (const [label, abiRegistryState, acknowledgementLabel] of cases) {
      cleanup();
      renderRawCalldata({ abiRegistryState });
      fillBaseDraft("0x12345678");

      fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

      const acknowledgement = await screen.findByLabelText(acknowledgementLabel);
      expect(screen.getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();

      fireEvent.click(acknowledgement);

      expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
    }
  });

  it("keeps high fee drafts blocked until fee and selector warnings are acknowledged", async () => {
    renderRawCalldata();
    fillBaseDraft("0x12345678");
    fireEvent.change(screen.getByLabelText("Max fee override (gwei)"), {
      target: { value: "200" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    const warnings = await screen.findByLabelText("Raw calldata warnings");
    const highFee = within(warnings).getByLabelText(/Acknowledge high fee/);
    const unknownSelector = within(warnings).getByLabelText(/Acknowledge unknown selector/);
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();

    fireEvent.click(highFee);
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();

    fireEvent.click(unknownSelector);
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("keeps long calldata bounded to prefix and suffix in the confirmation", async () => {
    const longCalldata = `0x${"11".repeat(40)}${"22".repeat(10)}${"33".repeat(40)}`;
    renderRawCalldata();
    fillBaseDraft(longCalldata);

    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    const confirmation = await screen.findByLabelText("Raw calldata confirmation");
    expect(confirmation).toHaveTextContent(`0x${"11".repeat(32)}...${"33".repeat(32)}`);
    expect(confirmation).toHaveTextContent("omitted 26 bytes");
    expect(confirmation).not.toHaveTextContent(longCalldata);
  });

  it("submits the frozen raw calldata command input and reports the tx hash", async () => {
    const onSubmitRawCalldata = vi.fn(async (_input: RawCalldataSubmitInput) =>
      historyRecord("0xsubmitted"),
    );
    renderRawCalldata({ onSubmitRawCalldata });
    fillBaseDraft("0x12345678abcdef");

    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled());
    fireEvent.click(screen.getByLabelText(/Acknowledge unknown selector/));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(onSubmitRawCalldata).toHaveBeenCalledTimes(1));
    expect(onSubmitRawCalldata).toHaveBeenCalledWith(
      expect.objectContaining<Partial<RawCalldataSubmitInput>>({
        rpcUrl,
        chainId: 1,
        accountIndex: 1,
        from: account,
        to: target,
        valueWei: "0",
        calldata: "0x12345678abcdef",
        calldataHashVersion: "keccak256-v1",
        calldataByteLength: 7,
        selector: "0x12345678",
        selectorStatus: "present",
        nonce: 7,
        gasLimit: "50000",
        estimatedGasLimit: "50000",
        manualGas: false,
        baseFeePerGas: "20000000000",
        baseFeeMultiplier: "2",
        maxFeePerGas: "41500000000",
        maxPriorityFeePerGas: "1500000000",
        inference: expect.objectContaining({ status: "unknown" }),
        selectedRpc: expect.objectContaining({
          chainId: 1,
          endpointSummary: "https://rpc.example.invalid",
          endpointFingerprint: expect.stringMatching(/^rpc-endpoint-/),
        }),
        frozenKey: expect.stringMatching(/^raw-calldata-/),
      }),
    );
    const input = onSubmitRawCalldata.mock.calls[0][0];
    expect(input.warningAcknowledgements).toEqual([
      { code: "unknownSelector", acknowledged: true },
    ]);
    expect(JSON.stringify(input.humanPreview)).not.toContain("12345678abcdef");
    expect(screen.getByText(/Raw calldata submitted:/)).toBeInTheDocument();
    expect(screen.getByText("0xsubmitted")).toBeInTheDocument();
  });

  it("shows matched selector inference from the selected ABI function catalog", async () => {
    const onListAbiFunctions = vi.fn(async () => matchedCatalog());
    renderRawCalldata({
      abiRegistryState: registry([abiEntry()]),
      onListAbiFunctions,
    });
    fillBaseDraft("0x12345678");

    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(onListAbiFunctions).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/matched · selectedAbiFunctionSelector/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Acknowledge unknown selector/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("drops a stale async build when calldata changes before ABI inference returns", async () => {
    const catalog = deferred<ReturnType<typeof matchedCatalog>>();
    const onListAbiFunctions = vi
      .fn()
      .mockImplementationOnce(() => catalog.promise)
      .mockResolvedValue(matchedCatalog());
    renderRawCalldata({
      abiRegistryState: registry([abiEntry()]),
      onListAbiFunctions,
    });
    fillBaseDraft("0x12345678");

    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));
    await waitFor(() => expect(onListAbiFunctions).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Calldata"), { target: { value: "0xffffffff" } });
    await act(async () => {
      catalog.resolve(matchedCatalog());
      await catalog.promise;
    });

    await waitFor(() =>
      expect(screen.queryByLabelText("Raw calldata confirmation")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));
    await screen.findByLabelText("Raw calldata confirmation");

    expect(screen.getByText(/unknown · selectorNotFound/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Acknowledge unknown selector/)).toBeInTheDocument();
  });

  it("blocks automatic submit when gas estimation fails until manual gas is entered", async () => {
    const leakedCalldata = `0x12345678${"ab".repeat(96)}`;
    provider.estimateGas.mockRejectedValue(
      new Error(`execution reverted with data=${leakedCalldata}`),
    );
    renderRawCalldata();
    fillBaseDraft("0x12345678");

    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText(/Gas estimate failed:/)).toBeInTheDocument());
    expect(screen.getByText("gasLimit: Gas limit must be greater than zero.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    expect(screen.queryByText(leakedCalldata)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Gas limit"), { target: { value: "70000" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByLabelText(/Acknowledge manual gas/)).toBeInTheDocument());
    expect(screen.getAllByText(/0x12345678/).length).toBeGreaterThan(0);
    expect(screen.queryByText(leakedCalldata)).not.toBeInTheDocument();
  });
});
