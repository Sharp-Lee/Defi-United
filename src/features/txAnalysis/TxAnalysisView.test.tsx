import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryRecord, TxAnalysisFetchInput, TxAnalysisFetchReadModel } from "../../lib/tauri";
import { renderScreen } from "../../test/render";
import { TxAnalysisView } from "./TxAnalysisView";

const txHash = `0x${"a".repeat(64)}`;
const otherHash = `0x${"b".repeat(64)}`;
const from = "0x1111111111111111111111111111111111111111";
const to = "0x2222222222222222222222222222222222222222";
const rpcUrl = "https://user:secret@rpc.example.invalid/v3/secret-key?apikey=topsecret";

type ModelOverrides = Omit<Partial<TxAnalysisFetchReadModel>, "rpc" | "sources" | "analysis"> & {
  rpc?: Partial<TxAnalysisFetchReadModel["rpc"]>;
  sources?: Partial<TxAnalysisFetchReadModel["sources"]>;
  analysis?: Omit<Partial<TxAnalysisFetchReadModel["analysis"]>, "selector"> & {
    selector?: Partial<TxAnalysisFetchReadModel["analysis"]["selector"]>;
  };
};

function decodedValue(value: string) {
  return {
    kind: "scalar",
    type: "address",
    value,
    byteLength: null,
    hash: null,
    items: null,
    fields: null,
    truncated: false,
  };
}

function sourceStatus(status = "ok", reason: string | null = null) {
  return { status, reason, errorSummary: null };
}

function model(overrides: ModelOverrides = {}): TxAnalysisFetchReadModel {
  const base: TxAnalysisFetchReadModel = {
    status: "ok",
    reasons: [],
    hash: txHash,
    chainId: 1,
    rpc: {
      endpoint: "https://rpc.example.invalid",
      expectedChainId: 1,
      actualChainId: 1,
      chainStatus: "matched",
    },
    transaction: {
      hash: txHash,
      from,
      to,
      contractCreation: false,
      nonce: "7",
      valueWei: "0",
      selector: "0xa9059cbb",
      selectorStatus: "present",
      calldataByteLength: 68,
      calldataHashVersion: "keccak256-v1",
      calldataHash: "0xcalldatahash",
      blockNumber: 123,
      blockHash: "0xblockhash",
      transactionIndex: 2,
    },
    receipt: {
      status: 1,
      statusLabel: "success",
      blockNumber: 123,
      blockHash: "0xblockhash",
      transactionIndex: 2,
      gasUsed: "51234",
      effectiveGasPrice: "1000000000",
      contractAddress: null,
      logsStatus: "present",
      logsCount: 1,
      logs: [
        {
          address: to,
          logIndex: 0,
          topic0: "0xddf252ad",
          topicsCount: 3,
          dataByteLength: 32,
          dataHashVersion: "keccak256-v1",
          dataHash: "0xlogdatahash",
          removed: false,
        },
      ],
      omittedLogs: 0,
    },
    block: {
      number: 123,
      hash: "0xblockhash",
      timestamp: "2026-04-30T00:00:00Z",
      baseFeePerGas: "100000000",
    },
    addressCodes: [
      {
        role: "to",
        address: to,
        status: "contract",
        blockTag: "latest",
        byteLength: 1024,
        codeHashVersion: "keccak256-v1",
        codeHash: "0xcodehash",
        errorSummary: null,
      },
    ],
    sources: {
      chainId: sourceStatus("ok"),
      transaction: sourceStatus("ok"),
      receipt: sourceStatus("ok"),
      logs: sourceStatus("ok"),
      block: sourceStatus("ok"),
      code: sourceStatus("ok"),
      explorer: sourceStatus("notConfigured"),
      indexer: sourceStatus("notConfigured"),
      localHistory: sourceStatus("noMatch"),
    },
    analysis: {
      status: "decoded",
      reasons: [],
      selector: {
        selector: "0xa9059cbb",
        selectorStatus: "present",
        selectorMatchCount: 1,
        uniqueSignatureCount: 1,
        sourceCount: 1,
        conflict: false,
      },
      abiSources: [
        {
          contractAddress: to,
          sourceKind: "userImported",
          providerConfigId: null,
          userSourceId: "safe-user-source",
          versionId: "v1",
          attemptId: "attempt-1",
          sourceFingerprint: "source-fingerprint",
          abiHash: "abi-hash",
          selected: true,
          fetchSourceStatus: "ok",
          validationStatus: "ok",
          cacheStatus: "cacheFresh",
          selectionStatus: "selected",
          selectorSummary: null,
          artifactStatus: "available",
          proxyDetected: false,
          providerProxyHint: null,
          errorSummary: null,
        },
      ],
      functionCandidates: [
        {
          selector: "0xa9059cbb",
          functionSignature: "transfer(address,uint256)",
          sourceLabel: "userImported v1",
          source: null,
          decodeStatus: "decoded",
          confidence: "candidate",
          argumentSummary: [decodedValue(from)],
          statuses: ["candidate"],
          errorSummary: null,
        },
      ],
      eventCandidates: [],
      errorCandidates: [],
      classificationCandidates: [
        {
          kind: "erc20Transfer",
          label: "ERC-20 transfer candidate",
          confidence: "candidate",
          source: "abi",
          selector: "0xa9059cbb",
          signature: "transfer(address,uint256)",
          argumentSummary: [decodedValue(from)],
          reasons: ["decoded selector matched cached ABI"],
        },
      ],
      uncertaintyStatuses: [],
      revertDataStatus: "notAvailable",
      revertData: null,
    },
    errorSummary: null,
  };

  return {
    ...base,
    ...overrides,
    rpc: { ...base.rpc, ...overrides.rpc },
    sources: { ...base.sources, ...overrides.sources },
    analysis: {
      ...base.analysis,
      ...overrides.analysis,
      selector: { ...base.analysis.selector, ...overrides.analysis?.selector },
    },
  };
}

function historyRecord(hash = txHash, chainId = 1): HistoryRecord {
  return {
    submission: {
      tx_hash: hash,
      chain_id: chainId,
      from,
      to,
      nonce: 7,
      transaction_type: "rawCalldata",
    },
    outcome: {
      state: "Pending",
      tx_hash: hash,
    },
  } as HistoryRecord;
}

function localHistoryWithSecrets(): HistoryRecord {
  return {
    ...historyRecord(txHash, 1),
    submission: {
      ...historyRecord(txHash, 1).submission,
      transaction_type: "rawCalldata",
      kind: "rawCalldata",
      selector: "0x12345678",
      source: "private_key=local-secret",
    },
    raw_calldata_metadata: {
      intent_kind: "rawCalldata",
      draft_id: "mnemonic abandon abandon",
      created_at: null,
      chain_id: 1,
      account_index: 0,
      from,
      to,
      value_wei: "0",
      gas_limit: null,
      max_fee_per_gas: null,
      max_priority_fee_per_gas: null,
      nonce: 7,
      calldata_hash_version: "keccak256-v1",
      calldata_hash: "0xrawhash",
      calldata_byte_length: 516,
      selector: "0x12345678",
      selector_status: "present",
      preview: {
        preview_prefix_bytes: 4,
        preview_suffix_bytes: 4,
        truncated: true,
        omitted_bytes: 508,
        display: `0x${"f".repeat(1024)}`,
        prefix: `0x${"e".repeat(512)}`,
        suffix: `0x${"d".repeat(512)}`,
      },
      warning_acknowledgements: [],
      warning_summaries: [
        {
          level: "warning",
          code: "providerError",
          message: "api_key=local-api-secret",
          source: "privateKey",
        },
      ],
      blocking_statuses: [],
      inference: {
        inference_status: "selectorMatched",
        matched_source_kind: "userImported",
        matched_source_id: "secret-source-id",
        matched_version_id: "v1",
        matched_source_fingerprint: "source-fingerprint",
        matched_abi_hash: "abi-hash",
        selector_match_count: 1,
        conflict_summary: null,
        stale_status: "fresh",
        source_status: "ok",
      },
      frozen_key: "signedTx=local-secret",
      future_submission: null,
      future_outcome: null,
      broadcast: null,
      recovery: null,
    },
  } as HistoryRecord;
}

function modelForHash(hash: string): TxAnalysisFetchReadModel {
  return model({
    hash,
    transaction: {
      ...model().transaction!,
      hash,
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function renderTxAnalysis(
  options: {
    chainReady?: boolean;
    history?: HistoryRecord[];
    onFetchTxAnalysis?: (input: TxAnalysisFetchInput) => Promise<TxAnalysisFetchReadModel>;
  } = {},
) {
  const onFetchTxAnalysis =
    options.onFetchTxAnalysis ??
    vi.fn<(input: TxAnalysisFetchInput) => Promise<TxAnalysisFetchReadModel>>(async () => model());
  renderScreen(
    <TxAnalysisView
      chainId={1n}
      chainName="Ethereum"
      chainReady={options.chainReady ?? true}
      history={options.history ?? []}
      onFetchTxAnalysis={onFetchTxAnalysis}
      rpcUrl={rpcUrl}
    />,
  );
  return onFetchTxAnalysis;
}

describe("TxAnalysisView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("disables analysis and explains invalid transaction hashes", () => {
    renderTxAnalysis();

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: "0x1234" } });

    expect(screen.getByText("Enter a 0x-prefixed 32-byte transaction hash.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeDisabled();
  });

  it("invokes the handler with a secret-safe selected RPC identity", async () => {
    const privateNote = "local note mnemonic abandon abandon";
    const localRecord = {
      ...localHistoryWithSecrets(),
      accountLabel: "Treasury hot wallet",
      note: privateNote,
      addressBookLabel: "Alice vendor",
      walletInventory: ["Account 1", "Account 2"],
    } as HistoryRecord & Record<string, unknown>;
    const onFetchTxAnalysis = vi.fn<
      (input: TxAnalysisFetchInput) => Promise<TxAnalysisFetchReadModel>
    >(async () => model());
    renderTxAnalysis({ history: [localRecord], onFetchTxAnalysis });

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: txHash } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await waitFor(() => expect(onFetchTxAnalysis).toHaveBeenCalledTimes(1));
    expect(onFetchTxAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 1,
        txHash,
        rpcUrl,
        selectedRpc: expect.objectContaining({
          endpointSummary: "https://rpc.example.invalid",
          endpointFingerprint: expect.stringMatching(/^rpc-endpoint/),
        }),
      }),
    );
    const firstCall = onFetchTxAnalysis.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    const serializedInput = JSON.stringify(firstCall);
    expect(JSON.stringify(firstCall?.selectedRpc)).not.toContain("secret");
    expect(serializedInput).not.toContain("Treasury");
    expect(serializedInput).not.toContain("Alice vendor");
    expect(serializedInput).not.toContain(privateNote);
    expect(serializedInput).not.toContain("walletInventory");
    expect(serializedInput).not.toContain("raw_calldata_metadata");
    expect(serializedInput).not.toContain("source-fingerprint");
    expect(screen.getByText("Explorer: notConfigured")).toBeInTheDocument();
    expect(screen.getByText("Indexer: notConfigured")).toBeInTheDocument();
  });

  it("shows chain mismatch, missing transaction, pending receipt, and reverted boundaries", async () => {
    const onFetchTxAnalysis = vi
      .fn()
      .mockResolvedValueOnce(
        model({
          status: "chainMismatch",
          reasons: ["rpcChainMismatch"],
          rpc: { actualChainId: 5, chainStatus: "mismatch" },
          transaction: null,
          receipt: null,
          errorSummary: "RPC returned chainId 5; expected 1.",
        }),
      )
      .mockResolvedValueOnce(
        model({
          status: "missing",
          reasons: ["transactionNotFound"],
          transaction: null,
          receipt: null,
          sources: { transaction: sourceStatus("missing"), receipt: sourceStatus("skipped") },
        }),
      )
      .mockResolvedValueOnce(
        model({
          status: "pending",
          reasons: ["receiptMissing"],
          receipt: null,
          sources: { receipt: sourceStatus("missing"), logs: sourceStatus("skipped") },
        }),
      )
      .mockResolvedValueOnce(
        model({
          status: "ok",
          receipt: {
            ...model().receipt!,
            status: 0,
            statusLabel: "reverted",
            logsStatus: "missing",
            logsCount: 0,
            logs: [],
          },
          sources: { logs: sourceStatus("missing") },
        }),
      );
    renderTxAnalysis({ onFetchTxAnalysis });
    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: txHash } });

    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByText("Chain/RPC mismatch")).toBeInTheDocument();
    expect(screen.getByText("RPC returned chainId 5; expected 1.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByText("Transaction not found")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByText("Pending or no receipt yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByText("Reverted")).toBeInTheDocument();
    expect(screen.getByText("Logs missing or unavailable")).toBeInTheDocument();
  });

  it("ignores stale in-flight analysis results after the input changes", async () => {
    const first = deferred<TxAnalysisFetchReadModel>();
    const second = deferred<TxAnalysisFetchReadModel>();
    const onFetchTxAnalysis = vi.fn(
      (input: TxAnalysisFetchInput) => (input.txHash === txHash ? first.promise : second.promise),
    );
    renderTxAnalysis({ onFetchTxAnalysis });

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: txHash } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: otherHash } });

    await act(async () => {
      first.resolve(modelForHash(txHash));
      await Promise.resolve();
    });

    expect(screen.queryByText(txHash)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await act(async () => {
      second.resolve(modelForHash(otherHash));
      await Promise.resolve();
    });

    expect(await screen.findByText(otherHash)).toBeInTheDocument();
    expect(onFetchTxAnalysis).toHaveBeenCalledTimes(2);
  });

  it("enables a new valid analysis immediately after invalidating a hung request", async () => {
    const first = deferred<TxAnalysisFetchReadModel>();
    const second = deferred<TxAnalysisFetchReadModel>();
    const onFetchTxAnalysis = vi.fn(
      (input: TxAnalysisFetchInput) => (input.txHash === txHash ? first.promise : second.promise),
    );
    renderTxAnalysis({ onFetchTxAnalysis });

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: txHash } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(screen.getByRole("button", { name: "Analyzing..." })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: otherHash } });

    expect(screen.getByRole("button", { name: "Analyze" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(onFetchTxAnalysis).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(modelForHash(otherHash));
      await Promise.resolve();
    });

    expect(await screen.findByText(otherHash)).toBeInTheDocument();

    await act(async () => {
      first.resolve(modelForHash(txHash));
      await Promise.resolve();
    });

    expect(screen.queryByText(txHash)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeEnabled();
  });

  it("renders decoded candidates with candidate, conflict, and unknown badges", async () => {
    renderTxAnalysis({
      onFetchTxAnalysis: vi.fn(async () =>
        model({
          analysis: {
            selector: {
              selector: "0xa9059cbb",
              selectorStatus: "present",
              selectorMatchCount: 3,
              uniqueSignatureCount: 2,
              sourceCount: 2,
              conflict: true,
            },
            uncertaintyStatuses: [
              {
                code: "unknownSelector",
                severity: "warning",
                source: "abi",
                summary: "Selector was not found in every configured ABI source.",
              },
              {
                code: "selectorConflict",
                severity: "warning",
                source: "abi",
                summary: "Multiple ABI candidates share this selector.",
              },
            ],
          },
        }),
      ),
    });

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: txHash } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(await screen.findByText("transfer(address,uint256)")).toBeInTheDocument();
    expect(screen.getAllByText("candidate").length).toBeGreaterThan(0);
    expect(screen.getByText("Unknown selector")).toBeInTheDocument();
    expect(screen.getAllByText("Selector conflict").length).toBeGreaterThan(0);
    expect(screen.getByText("ERC-20 transfer candidate")).toBeInTheDocument();
    expect(screen.getByText("source-fingerprint")).toBeInTheDocument();
    expect(screen.getByText("abi-hash")).toBeInTheDocument();
  });

  it("caps long decoded candidate values before rendering them", async () => {
    const longDecodedValue = `0x${"f".repeat(512)}`;
    renderTxAnalysis({
      onFetchTxAnalysis: vi.fn(async () =>
        model({
          analysis: {
            functionCandidates: [
              {
                selector: "0xa9059cbb",
                functionSignature: "transfer(address,uint256)",
                sourceLabel: "userImported v1",
                source: null,
                decodeStatus: "decoded",
                confidence: "candidate",
                argumentSummary: [
                  {
                    ...decodedValue(longDecodedValue),
                    type: "bytes",
                  },
                ],
                statuses: ["candidate"],
                errorSummary: null,
              },
            ],
          },
        }),
      ),
    });

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: txHash } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(await screen.findByText("transfer(address,uint256)")).toBeInTheDocument();
    expect(screen.queryByText(longDecodedValue)).not.toBeInTheDocument();
    expect(screen.getByText(/\[truncated\]/)).toBeInTheDocument();
  });

  it("renders effective gas price plus event, error, and revert advisory candidates", async () => {
    renderTxAnalysis({
      onFetchTxAnalysis: vi.fn(async () =>
        model({
          analysis: {
            eventCandidates: [
              {
                address: to,
                logIndex: 0,
                topic0: "0xddf252ad",
                topicsCount: 3,
                dataByteLength: 32,
                dataHashVersion: "keccak256-v1",
                dataHash: "0xlogdatahash",
                eventSignature: "Transfer(address,address,uint256)",
                source: null,
                sourceLabel: "userImported v1",
                decodeStatus: "decoded",
                confidence: "candidate",
                argumentSummary: [decodedValue(from), decodedValue(to)],
                statuses: ["candidate"],
                errorSummary: null,
              },
            ],
            errorCandidates: [
              {
                selector: "0x08c379a0",
                errorSignature: "Error(string)",
                source: null,
                sourceLabel: "bounded revert data",
                decodeStatus: "decoded",
                confidence: "candidate",
                argumentSummary: [
                  {
                    ...decodedValue("insufficient allowance"),
                    type: "string",
                  },
                ],
                statuses: ["candidate"],
                errorSummary: null,
              },
            ],
            revertDataStatus: "bounded",
            revertData: {
              source: "receipt",
              status: "bounded",
              selector: "0x08c379a0",
              byteLength: 100,
              dataHashVersion: "keccak256-v1",
              dataHash: "0xreverthash",
              errorSummary: null,
            },
          },
        }),
      ),
    });

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: txHash } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    const receipt = within(await screen.findByLabelText("Receipt and logs"));
    expect(receipt.getByText("Effective gas price")).toBeInTheDocument();
    expect(receipt.getByText("1000000000")).toBeInTheDocument();
    expect(await screen.findByText("Transfer(address,address,uint256)")).toBeInTheDocument();
    expect(screen.getByText("Error(string)")).toBeInTheDocument();
    expect(screen.getByText("Revert data candidate")).toBeInTheDocument();
    expect(screen.getByText("0xreverthash")).toBeInTheDocument();
    expect(screen.getAllByText("candidate").length).toBeGreaterThan(0);
  });

  it("finds local history side-by-side without overriding chain facts", async () => {
    renderTxAnalysis({ history: [historyRecord(otherHash, 1), historyRecord(txHash, 1)] });

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: txHash } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    const section = within(await screen.findByLabelText("Local history comparison"));
    expect(section.getByText("Local history match")).toBeInTheDocument();
    expect(section.getByText("Pending")).toBeInTheDocument();
    expect(section.getByText("Local history is shown beside RPC facts and does not override them.")).toBeInTheDocument();
  });

  it("renders duplicate local history and RPC conflict diagnostics side-by-side", async () => {
    renderTxAnalysis({
      history: [
        historyRecord(txHash, 5),
        {
          ...historyRecord(txHash, 1),
          submission: { ...historyRecord(txHash, 1).submission, from: "0x3333333333333333333333333333333333333333", nonce: 8 },
          outcome: { ...historyRecord(txHash, 1).outcome, state: "Confirmed" },
        } as HistoryRecord,
      ],
    });

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: txHash } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    const section = within(await screen.findByLabelText("Local history comparison"));
    expect(section.getByText("Duplicate tx hash in local history")).toBeInTheDocument();
    expect(section.getAllByText("Chain conflict").length).toBeGreaterThan(0);
    expect(section.getAllByText("From mismatch").length).toBeGreaterThan(0);
    expect(section.getAllByText("Nonce mismatch").length).toBeGreaterThan(0);
    expect(section.getAllByText(txHash)).toHaveLength(2);
    expect(section.getByText("Confirmed")).toBeInTheDocument();
  });

  it("renders typed local metadata summaries without full calldata or local secrets", async () => {
    renderTxAnalysis({ history: [localHistoryWithSecrets()] });

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: txHash } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    const localHistorySection = await screen.findByLabelText("Local history comparison");
    const section = within(localHistorySection);
    expect(section.getByText("Raw calldata")).toBeInTheDocument();
    expect(section.getByText("0x12345678")).toBeInTheDocument();
    expect(section.getByText("0xrawhash")).toBeInTheDocument();
    expect(section.getByText("516")).toBeInTheDocument();
    expect(section.getByText("selectorMatched")).toBeInTheDocument();

    const text = localHistorySection.textContent ?? "";
    expect(text).not.toContain("api_key=local-api-secret");
    expect(text).not.toContain("private_key=local-secret");
    expect(text).not.toContain("signedTx=local-secret");
    expect(text).not.toContain("mnemonic abandon abandon");
    expect(text).not.toContain("ffffffffffffffffffffffffffffffff");
    expect(text).not.toContain("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  });

  it("copies only bounded summary fields", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    renderTxAnalysis();

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: txHash } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    fireEvent.click(await screen.findByRole("button", { name: "Copy tx hash" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(txHash));

    writeText.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toContain(`tx=${txHash}`);
    expect(writeText.mock.calls[0]?.[0]).toContain("calldataHash=0xcalldatahash");
    expect(writeText.mock.calls[0]?.[0]).not.toContain("topsecret");
    expect(writeText.mock.calls[0]?.[0]).not.toContain("secret-key");
  });

  it("copies displayed address, calldata hash, and ABI source hashes without secrets or payloads", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    renderTxAnalysis();

    fireEvent.change(screen.getByLabelText("Transaction hash"), { target: { value: txHash } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await screen.findByText("transfer(address,uint256)");
    fireEvent.click(screen.getByRole("button", { name: "Copy from address" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(from));

    fireEvent.click(screen.getByRole("button", { name: "Copy calldata hash" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("0xcalldatahash"));

    fireEvent.click(screen.getByRole("button", { name: "Copy selector" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("0xa9059cbb"));

    fireEvent.click(screen.getByRole("button", { name: "Copy topic" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("0xddf252ad"));

    fireEvent.click(screen.getByRole("button", { name: "Copy source fingerprint" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("source-fingerprint"));

    fireEvent.click(screen.getByRole("button", { name: "Copy ABI hash" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("abi-hash"));

    const copiedValues = writeText.mock.calls.map((call) => String(call[0])).join("\n");
    expect(copiedValues).not.toContain("topsecret");
    expect(copiedValues).not.toContain("secret-key");
    expect(copiedValues).not.toContain("0x".padEnd(132, "f"));
  });
});
