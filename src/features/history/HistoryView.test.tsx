import { act, fireEvent, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeHistoryRecords,
  type ChainOutcomeState,
  type SubmissionKind,
} from "../../core/history/schema";
import { renderScreen } from "../../test/render";
import { HistoryView } from "./HistoryView";

const accountA = "0x1111111111111111111111111111111111111111";
const accountB = "0x2222222222222222222222222222222222222222";
const recipient = "0x3333333333333333333333333333333333333333";
const stylesCss = readFileSync("src/styles.css", "utf8");

function record({
  txHash,
  accountIndex = 1,
  from = accountA,
  chainId = 1,
  nonce = 7,
  state = "Pending",
  kind = "nativeTransfer",
  replacesTxHash = null,
  replacedByTxHash = null,
  intentValueWei = "100",
  submissionValueWei = "100",
  maxFeePerGas = "40000000000",
  maxPriorityFeePerGas = "1500000000",
  broadcastedAt = "1700000001",
  finalizedAt,
  receipt = null,
  reconcileSummary = null,
  errorSummary = null,
  droppedReviewHistory = [],
}: {
  txHash: string;
  accountIndex?: number;
  from?: string;
  chainId?: number;
  nonce?: number | null;
  state?: ChainOutcomeState;
  kind?: SubmissionKind;
  replacesTxHash?: string | null;
  replacedByTxHash?: string | null;
  intentValueWei?: string;
  submissionValueWei?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  broadcastedAt?: string;
  finalizedAt?: string | null;
  receipt?: Record<string, unknown> | null;
  reconcileSummary?: Record<string, unknown> | null;
  errorSummary?: Record<string, unknown> | null;
  droppedReviewHistory?: Record<string, unknown>[];
}) {
  return {
    schema_version: 2,
    intent: {
      rpc_url: "http://127.0.0.1:8545",
      account_index: accountIndex,
      chain_id: chainId,
      from,
      to: recipient,
      value_wei: intentValueWei,
      nonce,
      gas_limit: "21000",
      max_fee_per_gas: maxFeePerGas,
      max_priority_fee_per_gas: maxPriorityFeePerGas,
    },
    intent_snapshot: {
      source: "nativeTransferIntent",
      captured_at: "1700000000",
    },
    submission: {
      frozen_key: `${chainId}:${from}:${recipient}:${submissionValueWei}:${nonce}`,
      tx_hash: txHash,
      kind,
      source: "submission",
      chain_id: chainId,
      account_index: accountIndex,
      from,
      to: recipient,
      value_wei: submissionValueWei,
      nonce,
      gas_limit: "21000",
      max_fee_per_gas: maxFeePerGas,
      max_priority_fee_per_gas: maxPriorityFeePerGas,
      broadcasted_at: broadcastedAt,
      replaces_tx_hash: replacesTxHash,
    },
    outcome: {
      state,
      tx_hash: txHash,
      finalized_at: finalizedAt ?? (state === "Pending" ? null : "1700000100"),
      receipt,
      reconciled_at: reconcileSummary ? "1700000101" : null,
      reconcile_summary: reconcileSummary,
      error_summary: errorSummary,
      dropped_review_history: droppedReviewHistory,
    },
    nonce_thread: {
      source: "derived",
      key: `${chainId}:${accountIndex}:${from.toLowerCase()}:${nonce}`,
      chain_id: chainId,
      account_index: accountIndex,
      from,
      nonce,
      replaces_tx_hash: replacesTxHash,
      replaced_by_tx_hash: replacedByTxHash,
    },
  };
}

function unknownAccountRecord(txHash = "0xunknown") {
  return {
    schema_version: 2,
    intent: {
      rpc_url: "http://127.0.0.1:8545",
      chain_id: 1,
      to: recipient,
      value_wei: "100",
      nonce: 42,
      gas_limit: "21000",
      max_fee_per_gas: "40000000000",
      max_priority_fee_per_gas: "1500000000",
    },
    intent_snapshot: {
      source: "legacy",
      captured_at: "1700000000",
    },
    submission: {
      frozen_key: "unknown-account-key",
      tx_hash: txHash,
      kind: "legacy",
      source: "legacy",
      chain_id: 1,
      account_index: null,
      from: null,
      to: recipient,
      value_wei: "100",
      nonce: 42,
      gas_limit: "21000",
      max_fee_per_gas: "40000000000",
      max_priority_fee_per_gas: "1500000000",
      broadcasted_at: "1700000001",
      replaces_tx_hash: null,
    },
    outcome: {
      state: "Confirmed",
      tx_hash: txHash,
      finalized_at: "1700000100",
    },
    nonce_thread: {
      source: "legacy",
      key: "unknown-account-key",
      chain_id: 1,
      account_index: null,
      from: null,
      nonce: 42,
      replaces_tx_hash: null,
      replaced_by_tx_hash: null,
    },
  };
}

function incompleteAccountRecord({
  txHash,
  accountIndex,
  from,
  nonce,
}: {
  txHash: string;
  accountIndex: number | null;
  from: string | null;
  nonce: number;
}) {
  return {
    schema_version: 2,
    intent: {
      rpc_url: "http://127.0.0.1:8545",
      account_index: accountIndex,
      chain_id: 1,
      from,
      to: recipient,
      value_wei: "100",
      nonce,
      gas_limit: "21000",
      max_fee_per_gas: "40000000000",
      max_priority_fee_per_gas: "1500000000",
    },
    intent_snapshot: {
      source: "legacy",
      captured_at: "1700000000",
    },
    submission: {
      frozen_key: `incomplete-${txHash}`,
      tx_hash: txHash,
      kind: "legacy",
      source: "legacy",
      chain_id: 1,
      account_index: accountIndex,
      from,
      to: recipient,
      value_wei: "100",
      nonce,
      gas_limit: "21000",
      max_fee_per_gas: "40000000000",
      max_priority_fee_per_gas: "1500000000",
      broadcasted_at: "1700000001",
      replaces_tx_hash: null,
    },
    outcome: {
      state: "Confirmed",
      tx_hash: txHash,
      finalized_at: "1700000100",
    },
    nonce_thread: {
      source: "legacy",
      key: `incomplete-${txHash}`,
      chain_id: 1,
      account_index: accountIndex,
      from,
      nonce,
      replaces_tx_hash: null,
      replaced_by_tx_hash: null,
    },
  };
}

function renderHistory(rawRecords: unknown[], options = {}) {
  return renderScreen(
    <HistoryView
      chainReady
      items={normalizeHistoryRecords(rawRecords)}
      onRefresh={vi.fn()}
      rpcUrl="http://127.0.0.1:8545"
      {...options}
    />,
  );
}

function erc20Record() {
  const tokenContract = "0x4444444444444444444444444444444444444444";
  const erc20Recipient = "0x5555555555555555555555555555555555555555";
  return {
    ...record({ txHash: "0xerc20", nonce: 11, submissionValueWei: "0", intentValueWei: "0" }),
    intent: {
      ...record({ txHash: "0xerc20-intent", nonce: 11 }).intent,
      transaction_type: "erc20Transfer",
      to: tokenContract,
      value_wei: "0",
      token_contract: tokenContract,
      recipient: erc20Recipient,
      amount_raw: "1234500",
      decimals: 6,
      token_symbol: "TST",
      token_name: "Test Token",
      token_metadata_source: "userConfirmed",
      selector: "0xa9059cbb",
      method_name: "transfer",
      native_value_wei: "0",
    },
    submission: {
      ...record({ txHash: "0xerc20-submission", nonce: 11 }).submission,
      frozen_key: "erc20-key",
      tx_hash: "0xerc20",
      kind: "erc20Transfer",
      transaction_type: "erc20Transfer",
      to: tokenContract,
      value_wei: "0",
      token_contract: tokenContract,
      recipient: erc20Recipient,
      amount_raw: "1234500",
      decimals: 6,
      token_symbol: "TST",
      token_name: "Test Token",
      token_metadata_source: "userConfirmed",
      selector: "0xa9059cbb",
      method_name: "transfer",
      native_value_wei: "0",
      nonce: 11,
    },
    nonce_thread: {
      source: "derived",
      key: `${1}:${1}:${accountA.toLowerCase()}:${11}`,
      chain_id: 1,
      account_index: 1,
      from: accountA,
      nonce: 11,
      replaces_tx_hash: null,
      replaced_by_tx_hash: null,
    },
  };
}

function nativeDistributionRecord() {
  const contract = "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3";
  return {
    ...record({ txHash: "0xdisperse", nonce: 12, submissionValueWei: "300", intentValueWei: "300" }),
    intent: {
      ...record({ txHash: "0xdisperse-intent", nonce: 12 }).intent,
      transaction_type: "contractCall",
      to: contract,
      value_wei: "300",
      native_value_wei: "300",
      selector: "0xe63d38ed",
      method_name: "disperseEther(address[],uint256[])",
    },
    submission: {
      ...record({ txHash: "0xdisperse-submission", nonce: 12 }).submission,
      frozen_key: "disperse-key",
      tx_hash: "0xdisperse",
      transaction_type: "contractCall",
      to: contract,
      value_wei: "300",
      native_value_wei: "300",
      selector: "0xe63d38ed",
      method_name: "disperseEther(address[],uint256[])",
      nonce: 12,
    },
    outcome: {
      state: "Pending",
      tx_hash: "0xdisperse",
      finalized_at: null,
      receipt: null,
      reconciled_at: null,
      reconcile_summary: null,
      error_summary: null,
      dropped_review_history: [],
    },
    batch_metadata: {
      batch_id: "batch-disperse",
      child_id: "batch-disperse:parent",
      batch_kind: "distribute",
      asset_kind: "native",
      freeze_key: "0xfrozen-disperse",
      child_count: 2,
      contract_address: contract,
      selector: "0xe63d38ed",
      method_name: "disperseEther(address[],uint256[])",
      total_value_wei: "300",
      recipients: [
        {
          child_id: "batch-disperse:child-0001",
          child_index: 0,
          target_kind: "localAccount",
          target_address: accountB,
          value_wei: "100",
        },
        {
          child_id: "batch-disperse:child-0002",
          child_index: 1,
          target_kind: "externalAddress",
          target_address: recipient,
          value_wei: "200",
        },
      ],
    },
  };
}

function recoveryIntent(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "broadcast-1",
    status: "active",
    createdAt: "1700000002",
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    kind: "nativeTransfer",
    chainId: 1,
    accountIndex: 1,
    from: accountA,
    nonce: 7,
    to: recipient,
    valueWei: "100",
    gasLimit: "21000",
    maxFeePerGas: "40000000000",
    maxPriorityFeePerGas: "1500000000",
    replacesTxHash: null,
    broadcastedAt: "1700000001",
    writeError: "Is a directory",
    lastRecoveryError: null,
    recoveredAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

const damagedStorage = {
  status: "corrupted" as const,
  path: "/tmp/tx-history.json",
  corruptionType: "jsonParseFailed" as const,
  readable: true,
  recordCount: 0,
  invalidRecordCount: 0,
  invalidRecordIndices: [],
  errorSummary: "expected value at line 1 column 1",
  rawSummary: {
    fileSizeBytes: 12,
    modifiedAt: "1700000000",
    topLevel: null,
    arrayLen: null,
  },
};

describe("HistoryView", () => {
  it("shows scanner columns and all transaction outcome states", () => {
    renderHistory([
      record({ txHash: "0xpending", state: "Pending", nonce: 1 }),
      record({ txHash: "0xconfirmed", state: "Confirmed", nonce: 2 }),
      record({ txHash: "0xfailed", state: "Failed", nonce: 3 }),
      record({ txHash: "0xreplaced", state: "Replaced", nonce: 4 }),
      record({ txHash: "0xcancelled", state: "Cancelled", nonce: 5 }),
      record({ txHash: "0xdropped", state: "Dropped", nonce: 6 }),
    ]);

    const table = within(screen.getByRole("table"));
    expect(table.getAllByText("chainId 1")).toHaveLength(6);
    expect(table.getByText("Pending")).toBeInTheDocument();
    expect(table.getByText("Confirmed")).toBeInTheDocument();
    expect(table.getByText("Failed")).toBeInTheDocument();
    expect(table.getByText("Replaced")).toBeInTheDocument();
    expect(table.getByText("Cancelled")).toBeInTheDocument();
    expect(table.getByText("Dropped (local)")).toBeInTheDocument();
    expect(table.getByText("0xpending")).toBeInTheDocument();
    expect(table.getAllByText("Account 1 · 0x11111111...1111")).toHaveLength(6);
  });

  it("keeps replaced and cancelled status pills visually distinct", () => {
    renderHistory([
      record({ txHash: "0xreplaced", state: "Replaced", nonce: 4 }),
      record({ txHash: "0xcancelled", state: "Cancelled", nonce: 5 }),
    ]);

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Replaced")).toHaveClass("history-status-replaced");
    expect(table.getByText("Cancelled")).toHaveClass("history-status-cancelled");
    expect(stylesCss).toMatch(/\.history-status-replaced\s*\{/);
    expect(stylesCss).toMatch(/\.history-status-cancelled\s*\{/);
    expect(stylesCss).not.toMatch(/\.history-status-replaced,\s*\n\.history-status-cancelled/);
  });

  it("filters by account, chainId, status, and nonce using selector output", () => {
    renderHistory([
      record({ txHash: "0xmatch", chainId: 5, nonce: 12, state: "Pending" }),
      record({ txHash: "0xwrongchain", chainId: 1, nonce: 12, state: "Pending" }),
      record({ txHash: "0xwrongaccount", accountIndex: 2, from: accountB, chainId: 5, nonce: 12 }),
      record({ txHash: "0xwrongnonce", chainId: 5, nonce: 13, state: "Pending" }),
    ]);

    fireEvent.change(screen.getByLabelText("Account"), {
      target: { value: `key:index:1|from:${accountA}` },
    });
    fireEvent.change(screen.getByLabelText("Chain"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "pending" } });
    fireEvent.change(screen.getByLabelText("Nonce"), { target: { value: "12" } });

    const table = within(screen.getByRole("table"));
    expect(table.getByText("0xmatch")).toBeInTheDocument();
    expect(table.queryByText("0xwrongchain")).not.toBeInTheDocument();
    expect(table.queryByText("0xwrongaccount")).not.toBeInTheDocument();
    expect(table.queryByText("0xwrongnonce")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "confirmed" } });
    expect(table.getByText("No history records match these filters.")).toBeInTheDocument();
  });

  it("can filter records with unknown or incomplete account identity", () => {
    renderHistory([
      record({ txHash: "0xknownaccount", state: "Confirmed", nonce: 1 }),
      unknownAccountRecord(),
    ]);

    fireEvent.change(screen.getByLabelText("Account"), {
      target: { value: "__unknown__" },
    });

    const table = within(screen.getByRole("table"));
    expect(table.getByText("0xunknown")).toBeInTheDocument();
    expect(table.getByText("Account ? · unknown")).toBeInTheDocument();
    expect(table.queryByText("0xknownaccount")).not.toBeInTheDocument();
  });

  it("keeps index-only and from-only account filters from matching complete accounts", () => {
    renderHistory([
      record({ txHash: "0xfullidx", accountIndex: 1, from: accountA, nonce: 1 }),
      incompleteAccountRecord({
        txHash: "0xindexonly",
        accountIndex: 1,
        from: null,
        nonce: 2,
      }),
      record({ txHash: "0xfullfrom", accountIndex: 2, from: accountB, nonce: 3 }),
      incompleteAccountRecord({
        txHash: "0xfromonly",
        accountIndex: null,
        from: accountB,
        nonce: 4,
      }),
    ]);

    fireEvent.change(screen.getByLabelText("Account"), { target: { value: "index:1" } });

    let table = within(screen.getByRole("table"));
    expect(table.getByText("0xindexonly")).toBeInTheDocument();
    expect(table.queryByText("0xfullidx")).not.toBeInTheDocument();
    expect(
      Array.from((screen.getByLabelText("Thread") as HTMLSelectElement).options).map(
        (option) => option.textContent,
      ),
    ).toEqual(["All threads", "chainId 1 · account 1 · nonce 2"]);

    fireEvent.change(screen.getByLabelText("Account"), { target: { value: `from:${accountB}` } });

    table = within(screen.getByRole("table"));
    expect(table.getByText("0xfromonly")).toBeInTheDocument();
    expect(table.queryByText("0xfullfrom")).not.toBeInTheDocument();
    expect(
      Array.from((screen.getByLabelText("Thread") as HTMLSelectElement).options).map(
        (option) => option.textContent,
      ),
    ).toEqual(["All threads", "chainId 1 · account ? · nonce 4"]);
  });

  it("limits thread options to the current account, chain, status, and nonce filters", () => {
    renderHistory([
      record({ txHash: "0xchain1", chainId: 1, nonce: 1, state: "Pending" }),
      record({ txHash: "0xchain5", chainId: 5, nonce: 2, state: "Confirmed" }),
    ]);

    fireEvent.change(screen.getByLabelText("Chain"), { target: { value: "5" } });

    const threadOptions = Array.from(
      (screen.getByLabelText("Thread") as HTMLSelectElement).options,
    ).map((option) => option.textContent);

    expect(threadOptions).toContain("All threads");
    expect(threadOptions).toContain("chainId 5 · account 1 · nonce 2");
    expect(threadOptions).not.toContain("chainId 1 · account 1 · nonce 1");
  });

  it("clears all filters and restores the full submission list", () => {
    renderHistory([
      record({ txHash: "0xpending", chainId: 1, nonce: 1, state: "Pending" }),
      record({ txHash: "0xconfirmed", chainId: 5, nonce: 2, state: "Confirmed" }),
    ]);

    fireEvent.change(screen.getByLabelText("Chain"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "confirmed" } });

    const table = within(screen.getByRole("table"));
    expect(table.queryByText("0xpending")).not.toBeInTheDocument();
    expect(table.getByText("0xconfirmed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(table.getByText("0xpending")).toBeInTheDocument();
    expect(table.getByText("0xconfirmed")).toBeInTheDocument();
    expect(screen.getByLabelText("Chain")).toHaveValue("__all__");
    expect(screen.getByLabelText("Status")).toHaveValue("__all__");
    expect(screen.getByLabelText("Thread")).toHaveValue("__all__");
  });

  it("can scan an exact nonce thread in grouped view", () => {
    renderHistory([
      record({
        txHash: "0xoriginal",
        nonce: 9,
        state: "Replaced",
        replacedByTxHash: "0xreplacement",
      }),
      record({
        txHash: "0xreplacement",
        nonce: 9,
        state: "Pending",
        kind: "replacement",
        replacesTxHash: "0xoriginal",
      }),
      record({
        txHash: "0xcancel",
        nonce: 9,
        state: "Pending",
        kind: "cancellation",
        replacesTxHash: "0xreplacement",
      }),
      record({ txHash: "0xother", nonce: 10, state: "Confirmed" }),
    ]);

    fireEvent.change(screen.getByLabelText("Thread"), {
      target: { value: `account=index:1|from:${accountA}|chainId=1|nonce=9` },
    });
    fireEvent.change(screen.getByLabelText("View"), { target: { value: "threads" } });

    const table = within(screen.getByRole("table"));
    expect(table.getByText(/Original submission: 0xoriginal/)).toBeInTheDocument();
    expect(table.getByText(/Replacement submission: 0xreplacement/)).toBeInTheDocument();
    expect(table.getByText(/Cancel submission: 0xcancel/)).toBeInTheDocument();
    expect(table.queryByText("0xother")).not.toBeInTheDocument();
  });

  it("shows intent, frozen submission, and pending chain outcome as separate detail layers", () => {
    renderHistory([
      record({
        txHash: "0xdetail",
        state: "Pending",
        intentValueWei: "100",
        submissionValueWei: "250",
        reconcileSummary: {
          source: "localTracker",
          checked_at: "1700000002",
          rpc_chain_id: 1,
          latest_confirmed_nonce: null,
          decision: "broadcastTracked",
        },
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    const panel = within(screen.getByLabelText("History details"));
    const intentSection = panel.getByText("Intent").closest("section");
    const submissionSection = panel.getByText("Submission").closest("section");
    const outcomeSection = panel.getByText("ChainOutcome").closest("section");

    expect(intentSection).not.toBeNull();
    expect(submissionSection).not.toBeNull();
    expect(outcomeSection).not.toBeNull();
    expect(within(intentSection as HTMLElement).getAllByText("100 wei").length).toBeGreaterThan(0);
    expect(within(submissionSection as HTMLElement).getAllByText("250 wei").length).toBeGreaterThan(0);
    expect(within(submissionSection as HTMLElement).getByText("0xdetail")).toBeInTheDocument();
    expect(
      within(outcomeSection as HTMLElement).getByText(
        "Pending - Broadcasted and tracked locally.",
      ),
    ).toBeInTheDocument();
    expect(within(outcomeSection as HTMLElement).getByText("broadcastTracked")).toBeInTheDocument();
  });

  it("shows ERC-20 typed details without treating recipient as transaction to", () => {
    renderHistory([erc20Record()]);

    const row = screen.getByText("0xerc20").closest("tr") as HTMLElement;
    expect(within(row).getByText("0x44444444...4444")).toBeInTheDocument();
    expect(within(row).getByText("1234500 raw")).toBeInTheDocument();

    fireEvent.click(within(row).getByText("Details"));

    const panel = within(screen.getByLabelText("History details"));
    const intentSection = panel.getByText("Intent").closest("section") as HTMLElement;
    const submissionSection = panel.getByText("Submission").closest("section") as HTMLElement;

    expect(within(intentSection).getByText("ERC-20 transfer (erc20Transfer)")).toBeInTheDocument();
    expect(within(intentSection).getByText("Token contract")).toBeInTheDocument();
    expect(
      within(intentSection).getAllByText("0x4444444444444444444444444444444444444444")
        .length,
    ).toBeGreaterThan(0);
    expect(within(intentSection).getByText("Recipient")).toBeInTheDocument();
    expect(within(intentSection).getByText("0x5555555555555555555555555555555555555555")).toBeInTheDocument();
    expect(within(intentSection).getByText("Amount raw")).toBeInTheDocument();
    expect(within(intentSection).getByText("1234500")).toBeInTheDocument();
    expect(within(submissionSection).getByText("Selector")).toBeInTheDocument();
    expect(within(submissionSection).getByText("0xa9059cbb")).toBeInTheDocument();
    expect(within(submissionSection).getByText("Method name")).toBeInTheDocument();
    expect(within(submissionSection).getByText("transfer")).toBeInTheDocument();
    expect(within(submissionSection).getByText("Metadata source")).toBeInTheDocument();
    expect(within(submissionSection).getByText("userConfirmed")).toBeInTheDocument();
  });

  it("renders native distribution recipient allocations from persisted batch metadata", () => {
    renderHistory([nativeDistributionRecord()]);

    const row = screen.getByText("0xdisperse").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByText("Details"));

    const panel = within(screen.getByLabelText("History details"));
    const allocations = within(panel.getByLabelText("Distribution recipient allocations"));
    expect(allocations.getByText("batch-disperse:child-0001")).toBeInTheDocument();
    expect(allocations.getByText("batch-disperse:child-0002")).toBeInTheDocument();
    expect(allocations.getByText("localAccount")).toBeInTheDocument();
    expect(allocations.getByText("externalAddress")).toBeInTheDocument();
    expect(allocations.getByText(accountB)).toBeInTheDocument();
    expect(allocations.getByText(recipient)).toBeInTheDocument();
    expect(allocations.getByText("100 wei")).toBeInTheDocument();
    expect(allocations.getByText("200 wei")).toBeInTheDocument();
    expect(allocations.getAllByText("0xdisperse")).toHaveLength(2);
    expect(allocations.getAllByText("Pending")).toHaveLength(2);
  });

  it("shows unknown typed records as unsupported instead of native transfer copy", () => {
    const unsupported = record({ txHash: "0xunknownkind", nonce: 12 });
    (unsupported.intent as Record<string, unknown>).transaction_type = "mysteryCall";
    (unsupported.submission as Record<string, unknown>).transaction_type = "mysteryCall";
    (unsupported.submission as Record<string, unknown>).kind = "mysteryKind";
    renderHistory([unsupported]);

    const row = screen.getByText("0xunknownkind").closest("tr") as HTMLElement;
    expect(within(row).getAllByText("Unsupported/unknown").length).toBeGreaterThan(0);

    fireEvent.click(within(row).getByText("Details"));

    const panel = within(screen.getByLabelText("History details"));
    expect(panel.getAllByText("Unsupported/unknown transaction type").length).toBeGreaterThan(0);
    expect(panel.queryByText("Native transfer (nativeTransfer)")).not.toBeInTheDocument();
  });

  it("explains terminal chain outcomes without treating dropped as a chain failure", () => {
    renderHistory([
      record({
        txHash: "0xconfirmed",
        state: "Confirmed",
        nonce: 1,
        receipt: {
          status: 1,
          block_number: 12,
          block_hash: "0xblock",
          transaction_index: 0,
          gas_used: "21000",
          effective_gas_price: "123",
        },
      }),
      record({ txHash: "0xfailed", state: "Failed", nonce: 2 }),
      record({ txHash: "0xreplaced", state: "Replaced", nonce: 3 }),
      record({ txHash: "0xcancelled", state: "Cancelled", nonce: 4 }),
      record({ txHash: "0xdropped", state: "Dropped", nonce: 5 }),
    ]);

    fireEvent.click(within(screen.getByText("0xconfirmed").closest("tr") as HTMLElement).getByText("Details"));
    expect(screen.getByText("Confirmed - Confirmed on chain.")).toBeInTheDocument();
    expect(screen.getByText("0xblock")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(screen.getByText("0xfailed").closest("tr") as HTMLElement).getByText("Details"));
    expect(screen.getByText("Failed - Included on chain with a failed receipt.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(screen.getByText("0xreplaced").closest("tr") as HTMLElement).getByText("Details"));
    expect(
      screen.getByText("Replaced - Superseded by another submission in the nonce thread."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(screen.getByText("0xcancelled").closest("tr") as HTMLElement).getByText("Details"));
    expect(
      screen.getByText("Cancelled - Cancelled by a later nonce-thread submission."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(screen.getByText("0xdropped").closest("tr") as HTMLElement).getByText("Details"));
    expect(
      screen.getByText("Dropped - Local reconcile marked this as dropped; it is not a chain failure."),
    ).toBeInTheDocument();
  });

  it("shows nonce thread details with each submission in the thread", () => {
    renderHistory([
      record({
        txHash: "0xoriginal",
        nonce: 9,
        state: "Replaced",
        replacedByTxHash: "0xreplacement",
      }),
      record({
        txHash: "0xreplacement",
        nonce: 9,
        state: "Pending",
        kind: "replacement",
        replacesTxHash: "0xoriginal",
      }),
    ]);

    fireEvent.change(screen.getByLabelText("View"), { target: { value: "threads" } });
    fireEvent.click(screen.getByRole("button", { name: "Thread details" }));

    const panel = within(screen.getByLabelText("History details"));
    expect(panel.getByText("Nonce thread details grouped by account, chainId, and nonce.")).toBeInTheDocument();
    expect(panel.getAllByText("0xoriginal").length).toBeGreaterThan(0);
    expect(panel.getAllByText("0xreplacement").length).toBeGreaterThan(0);
    expect(panel.getByLabelText("Nonce thread timeline")).toBeInTheDocument();
    expect(panel.getByText("Thread outcomes: Replaced on 0xoriginal")).toBeInTheDocument();
    expect(panel.getAllByText("ChainOutcome")).toHaveLength(2);
  });

  it("orders multiple replacements by timestamps and marks only the latest pending submission actionable", () => {
    renderHistory([
      record({
        txHash: "0xoriginal",
        nonce: 9,
        state: "Replaced",
        replacedByTxHash: "0xreplace1",
        broadcastedAt: "1700000001",
        finalizedAt: "1700000100",
      }),
      record({
        txHash: "0xreplace2",
        nonce: 9,
        state: "Pending",
        kind: "replacement",
        replacesTxHash: "0xreplace1",
        broadcastedAt: "1700000003",
      }),
      record({
        txHash: "0xreplace1",
        nonce: 9,
        state: "Replaced",
        kind: "replacement",
        replacesTxHash: "0xoriginal",
        replacedByTxHash: "0xreplace2",
        broadcastedAt: "1700000002",
        finalizedAt: "1700000101",
      }),
    ]);

    fireEvent.change(screen.getByLabelText("View"), { target: { value: "threads" } });
    fireEvent.click(screen.getByRole("button", { name: "Thread details" }));

    const timeline = within(screen.getByLabelText("Nonce thread timeline"));
    const steps = timeline.getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringContaining("Original submission0xoriginal"),
      expect.stringContaining("Replacement submission0xreplace1"),
      expect.stringContaining("Replacement submission0xreplace2"),
    ]);
    expect(timeline.getByText("current pending action target")).toBeInTheDocument();
    expect(screen.getAllByText("Action target")).toHaveLength(3);
    expect(screen.getByText("Current pending submission")).toBeInTheDocument();
  });

  it("uses full nonce-thread context for action gating when filters hide later submissions", () => {
    renderHistory([
      record({
        txHash: "0xoriginal",
        nonce: 9,
        state: "Pending",
        broadcastedAt: "1700000001",
      }),
      record({
        txHash: "0xreplacement",
        nonce: 9,
        state: "Confirmed",
        kind: "replacement",
        replacesTxHash: "0xoriginal",
        broadcastedAt: "1700000002",
        finalizedAt: "1700000100",
      }),
      record({
        txHash: "0xcancel",
        nonce: 9,
        state: "Dropped",
        kind: "cancellation",
        replacesTxHash: "0xreplacement",
        submissionValueWei: "0",
        broadcastedAt: "1700000003",
        finalizedAt: "1700000101",
      }),
    ]);

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "pending" } });

    expect(screen.getByText("0xoriginal")).toBeInTheDocument();
    expect(screen.queryByText("0xreplacement")).not.toBeInTheDocument();
    expect(screen.queryByText("0xcancel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace 0xoriginal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel 0xoriginal" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("View"), { target: { value: "threads" } });

    const table = within(screen.getByRole("table"));
    expect(table.queryByText("current pending")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace 0xoriginal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel 0xoriginal" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thread details" }));
    const panel = within(screen.getByLabelText("History details"));
    expect(panel.queryByText("current pending action target")).not.toBeInTheDocument();
    expect(panel.getByText("Not current pending")).toBeInTheDocument();
    expect(
      panel.queryByText("Broadcasted and tracked locally. This is the current pending submission for replace/cancel actions."),
    ).not.toBeInTheDocument();
  });

  it("only exposes replace and cancel actions for the current pending nonce-thread target", () => {
    renderHistory(
      [
        record({
          txHash: "0xoriginal",
          nonce: 9,
          state: "Replaced",
          replacedByTxHash: "0xreplace",
          broadcastedAt: "1700000001",
          finalizedAt: "1700000100",
        }),
        record({
          txHash: "0xreplace",
          nonce: 9,
          state: "Pending",
          kind: "replacement",
          replacesTxHash: "0xoriginal",
          broadcastedAt: "1700000002",
        }),
        record({
          txHash: "0xcancel",
          nonce: 9,
          state: "Pending",
          kind: "cancellation",
          replacesTxHash: "0xreplace",
          submissionValueWei: "0",
          broadcastedAt: "1700000003",
        }),
      ],
      {
        onReplace: vi.fn(),
        onCancelPending: vi.fn(),
      },
    );

    expect(screen.queryByRole("button", { name: "Replace 0xreplace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel 0xreplace" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace 0xcancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel 0xcancel" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("View"), { target: { value: "threads" } });

    expect(screen.queryByRole("button", { name: "Replace 0xreplace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel 0xreplace" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace 0xcancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel 0xcancel" })).toBeInTheDocument();
  });

  it("builds replace and cancel requests from the current validated RPC and frozen submission", () => {
    const onReplace = vi.fn();
    const onCancelPending = vi.fn();
    const staleIntentAccount = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const frozenSubmissionAccount = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const frozenRecipient = "0x4444444444444444444444444444444444444444";
    const validatedRpcUrl = "https://validated-rpc.example";
    const staleIntentRecord = record({
      txHash: "0xaction",
      accountIndex: 1,
      from: staleIntentAccount,
      chainId: 1,
      nonce: 4,
      state: "Pending",
      maxFeePerGas: "40000000000",
      maxPriorityFeePerGas: "1500000000",
      intentValueWei: "100",
    });
    staleIntentRecord.intent.rpc_url = "recovered://history-write-failed";
    staleIntentRecord.submission.chain_id = 5;
    staleIntentRecord.submission.account_index = 2;
    staleIntentRecord.submission.from = frozenSubmissionAccount;
    staleIntentRecord.submission.to = frozenRecipient;
    staleIntentRecord.submission.value_wei = "250";
    staleIntentRecord.submission.nonce = 9;
    staleIntentRecord.submission.gas_limit = "22000";
    staleIntentRecord.submission.max_fee_per_gas = "50000000000";
    staleIntentRecord.submission.max_priority_fee_per_gas = "2000000000";
    staleIntentRecord.nonce_thread.key = `5:2:${frozenSubmissionAccount}:9`;
    staleIntentRecord.nonce_thread.chain_id = 5;
    staleIntentRecord.nonce_thread.account_index = 2;
    staleIntentRecord.nonce_thread.from = frozenSubmissionAccount;
    staleIntentRecord.nonce_thread.nonce = 9;
    renderHistory(
      [staleIntentRecord],
      {
        onReplace,
        onCancelPending,
        rpcUrl: validatedRpcUrl,
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace 0xaction" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel 0xaction" }));

    const expectedRequest = {
      txHash: "0xaction",
      rpcUrl: validatedRpcUrl,
      accountIndex: 2,
      chainId: 5,
      from: frozenSubmissionAccount,
      nonce: 9,
      gasLimit: "22000",
      maxFeePerGas: "62500000001",
      maxPriorityFeePerGas: "2500000001",
      to: frozenRecipient,
      valueWei: "250",
    };
    expect(onReplace).toHaveBeenCalledWith(expectedRequest);
    expect(onCancelPending).toHaveBeenCalledWith(expectedRequest);
  });

  it("disables replace and cancel when the current RPC has not been validated", () => {
    const onReplace = vi.fn();
    const onCancelPending = vi.fn();
    const reason = "Validate an RPC endpoint before replacing or cancelling pending transactions.";
    renderHistory([record({ txHash: "0xnotready", state: "Pending" })], {
      chainReady: false,
      onReplace,
      onCancelPending,
      rpcUrl: "http://127.0.0.1:8545",
    });

    const replace = screen.getByRole("button", { name: "Replace 0xnotready" });
    const cancel = screen.getByRole("button", { name: "Cancel 0xnotready" });

    expect(replace).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(replace).toHaveAttribute("title", reason);
    expect(cancel).toHaveAttribute("title", reason);
    fireEvent.click(replace);
    fireEvent.click(cancel);
    expect(onReplace).not.toHaveBeenCalled();
    expect(onCancelPending).not.toHaveBeenCalled();
  });

  it("disables replace and cancel when no validated RPC URL is provided", () => {
    const reason = "Validate an RPC endpoint before replacing or cancelling pending transactions.";
    renderHistory([record({ txHash: "0xmissingrpc", state: "Pending" })], {
      onReplace: vi.fn(),
      onCancelPending: vi.fn(),
      rpcUrl: undefined,
    });

    const replace = screen.getByRole("button", { name: "Replace 0xmissingrpc" });
    const cancel = screen.getByRole("button", { name: "Cancel 0xmissingrpc" });

    expect(replace).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(replace).toHaveAttribute("title", reason);
    expect(cancel).toHaveAttribute("title", reason);
  });

  it("uses full nonce-thread context when marking single-submission details actionable", () => {
    renderHistory([
      record({
        txHash: "0xoriginal",
        nonce: 9,
        state: "Replaced",
        replacedByTxHash: "0xreplace",
        broadcastedAt: "1700000001",
        finalizedAt: "1700000100",
      }),
      record({
        txHash: "0xreplace",
        nonce: 9,
        state: "Pending",
        kind: "replacement",
        replacesTxHash: "0xoriginal",
        broadcastedAt: "1700000002",
      }),
      record({
        txHash: "0xcancel",
        nonce: 9,
        state: "Pending",
        kind: "cancellation",
        replacesTxHash: "0xreplace",
        submissionValueWei: "0",
        broadcastedAt: "1700000003",
      }),
    ]);

    fireEvent.click(within(screen.getByText("0xreplace").closest("tr") as HTMLElement).getByText("Details"));

    let panel = within(screen.getByLabelText("History details"));
    expect(
      panel.queryByText("Broadcasted and tracked locally. This is the current pending submission for replace/cancel actions."),
    ).not.toBeInTheDocument();
    expect(panel.getByText("Not current pending")).toBeInTheDocument();
    expect(panel.queryByText("Current pending submission")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(screen.getByText("0xcancel").closest("tr") as HTMLElement).getByText("Details"));

    panel = within(screen.getByLabelText("History details"));
    expect(
      panel.getByText("Broadcasted and tracked locally. This is the current pending submission for replace/cancel actions."),
    ).toBeInTheDocument();
    expect(panel.getByText("Current pending submission")).toBeInTheDocument();
  });

  it("explains a confirmed cancel submission as the final nonce-thread outcome", () => {
    renderHistory([
      record({
        txHash: "0xoriginal",
        nonce: 9,
        state: "Cancelled",
        replacedByTxHash: "0xcancel",
        broadcastedAt: "1700000001",
        finalizedAt: "1700000100",
      }),
      record({
        txHash: "0xcancel",
        nonce: 9,
        state: "Confirmed",
        kind: "cancellation",
        replacesTxHash: "0xoriginal",
        submissionValueWei: "0",
        broadcastedAt: "1700000002",
        finalizedAt: "1700000102",
      }),
    ]);

    fireEvent.change(screen.getByLabelText("View"), { target: { value: "threads" } });
    fireEvent.click(screen.getByRole("button", { name: "Thread details" }));

    const panel = within(screen.getByLabelText("History details"));
    expect(panel.getByText("Thread outcomes: Cancelled on 0xoriginal; Confirmed on 0xcancel")).toBeInTheDocument();
    expect(
      panel.getAllByText(
        "Cancel model: same nonce, 0 wei, sent from the account to itself with a higher fee.",
      ).length,
    ).toBeGreaterThan(0);
    expect(panel.getByText("cancels 0xoriginal")).toBeInTheDocument();
  });

  it("keeps dropped originals in the nonce thread next to their replacement result", () => {
    renderHistory([
      record({
        txHash: "0xoriginal",
        nonce: 9,
        state: "Dropped",
        replacedByTxHash: "0xreplacement",
        broadcastedAt: "1700000001",
        finalizedAt: "1700000100",
      }),
      record({
        txHash: "0xreplacement",
        nonce: 9,
        state: "Confirmed",
        kind: "replacement",
        replacesTxHash: "0xoriginal",
        broadcastedAt: "1700000002",
        finalizedAt: "1700000102",
      }),
    ]);

    fireEvent.change(screen.getByLabelText("View"), { target: { value: "threads" } });
    fireEvent.click(screen.getByRole("button", { name: "Thread details" }));

    const timeline = within(screen.getByLabelText("Nonce thread timeline"));
    expect(timeline.getByText("Thread outcomes: Dropped on 0xoriginal; Confirmed on 0xreplacement")).toBeInTheDocument();
    expect(timeline.getByText("ChainOutcome Dropped")).toBeInTheDocument();
    expect(timeline.getByText("replaced by 0xreplacement")).toBeInTheDocument();
  });

  it("does not describe a later dropped cancellation as the final thread outcome", () => {
    renderHistory([
      record({
        txHash: "0xoriginal",
        nonce: 9,
        state: "Replaced",
        replacedByTxHash: "0xreplacement",
        broadcastedAt: "1700000001",
        finalizedAt: "1700000100",
      }),
      record({
        txHash: "0xreplacement",
        nonce: 9,
        state: "Confirmed",
        kind: "replacement",
        replacesTxHash: "0xoriginal",
        broadcastedAt: "1700000002",
        finalizedAt: "1700000101",
      }),
      record({
        txHash: "0xcancel",
        nonce: 9,
        state: "Dropped",
        kind: "cancellation",
        replacesTxHash: "0xreplacement",
        submissionValueWei: "0",
        broadcastedAt: "1700000003",
        finalizedAt: "1700000102",
      }),
    ]);

    fireEvent.change(screen.getByLabelText("View"), { target: { value: "threads" } });
    fireEvent.click(screen.getByRole("button", { name: "Thread details" }));

    const timeline = within(screen.getByLabelText("Nonce thread timeline"));
    expect(timeline.queryByText(/Final ChainOutcome/)).not.toBeInTheDocument();
    expect(timeline.getByText("Thread outcomes: Replaced on 0xoriginal; Confirmed on 0xreplacement; Dropped on 0xcancel")).toBeInTheDocument();
  });

  it("does not merge nonce threads across chains when hashes share the same nonce", () => {
    renderHistory([
      record({ txHash: "0xchain1", chainId: 1, nonce: 9, state: "Pending" }),
      record({ txHash: "0xchain5", chainId: 5, nonce: 9, state: "Pending" }),
    ]);

    fireEvent.change(screen.getByLabelText("View"), { target: { value: "threads" } });

    const table = within(screen.getByRole("table"));
    expect(table.getAllByRole("row")).toHaveLength(3);
    expect(table.getByText("chainId 1")).toBeInTheDocument();
    expect(table.getByText("chainId 5")).toBeInTheDocument();
  });

  it("hides an open submission detail when filters make that record invisible", () => {
    renderHistory([
      record({ txHash: "0xpending", state: "Pending", nonce: 1 }),
      record({ txHash: "0xconfirmed", state: "Confirmed", nonce: 2 }),
    ]);

    fireEvent.click(within(screen.getByText("0xpending").closest("tr") as HTMLElement).getByText("Details"));
    expect(screen.getByLabelText("History details")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "confirmed" } });

    expect(screen.queryByLabelText("History details")).not.toBeInTheDocument();
    expect(screen.queryByText("0xpending")).not.toBeInTheDocument();
    expect(screen.getByText("0xconfirmed")).toBeInTheDocument();
  });

  it("keeps thread details limited to submissions allowed by active filters", () => {
    renderHistory([
      record({
        txHash: "0xoriginal",
        nonce: 9,
        state: "Replaced",
        replacedByTxHash: "0xreplacement",
      }),
      record({
        txHash: "0xreplacement",
        nonce: 9,
        state: "Pending",
        kind: "replacement",
        replacesTxHash: "0xoriginal",
      }),
    ]);

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "pending" } });
    fireEvent.change(screen.getByLabelText("View"), { target: { value: "threads" } });
    fireEvent.click(screen.getByRole("button", { name: "Thread details" }));

    const panel = within(screen.getByLabelText("History details"));
    expect(panel.getAllByText("0xreplacement").length).toBeGreaterThan(0);
    expect(
      panel.queryByText("Replaced - Superseded by another submission in the nonce thread."),
    ).not.toBeInTheDocument();
    expect(panel.getAllByText("ChainOutcome")).toHaveLength(1);
  });

  it("keeps legacy and missing fields explicit in details instead of inventing values", () => {
    renderHistory([unknownAccountRecord()]);

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    const panel = within(screen.getByLabelText("History details"));
    const intentSection = panel.getByText("Intent").closest("section");
    const submissionSection = panel.getByText("Submission").closest("section");

    expect(within(intentSection as HTMLElement).getByText("legacy")).toBeInTheDocument();
    expect(within(submissionSection as HTMLElement).getAllByText("legacy")).toHaveLength(2);
    expect(within(submissionSection as HTMLElement).getByText("Account Unknown · Unknown")).toBeInTheDocument();
  });

  it("shows empty, loading, and error states", () => {
    const { rerender } = renderHistory([]);
    expect(screen.getByText("No local transaction history.")).toBeInTheDocument();

    rerender(
      <HistoryView
        error="History refresh failed"
        items={[]}
        loading
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading transaction history...")).toBeInTheDocument();
    expect(screen.getByText("History refresh failed")).toBeInTheDocument();
    expect(screen.getByText("Local history error")).toBeInTheDocument();
  });

  it("classifies manual refresh chainId mismatch errors in the history view", () => {
    renderHistory([], {
      error: "RPC returned chainId 8453; expected 1.",
    });

    expect(screen.getByText("Chain identity mismatch")).toBeInTheDocument();
    expect(screen.getByText(/chainId is the stable chain identity/)).toBeInTheDocument();
    expect(screen.getByText(/RPC URL is only an access endpoint/)).toBeInTheDocument();
    expect(screen.getByText("manual history refresh")).toBeInTheDocument();
  });

  it("shows recent categorized error summaries without exposing full raw payloads", () => {
    renderHistory([
      record({
        txHash: "0xnonce",
        state: "Pending",
        nonce: 1,
        errorSummary: {
          source: "rpc",
          category: "nonce",
          message: "replacement underpriced",
        },
      }),
      record({
        txHash: "0xfunds",
        state: "Pending",
        nonce: 2,
        errorSummary: {
          source: "broadcast",
          category: "submit",
          message: `insufficient funds for gas * price + value ${"0x".padEnd(132, "a")}`,
        },
      }),
      record({
        txHash: "0xchain",
        state: "Unknown",
        nonce: 3,
        errorSummary: {
          source: "rpc validation",
          category: "chainId mismatch",
          message: "Remote chainId 8453 does not match expected chainId 1",
        },
      }),
    ]);

    const issues = within(screen.getByLabelText("Recent history issues"));
    expect(issues.getByText("Replacement fee too low")).toBeInTheDocument();
    expect(issues.getByText("Insufficient funds")).toBeInTheDocument();
    expect(issues.getByText("Chain identity mismatch")).toBeInTheDocument();
    expect(issues.getByText(/chainId is the stable chain identity/)).toBeInTheDocument();
    expect(issues.getByText(/0xaaaaaaaa\.\.\.aaaaaaaa/)).toBeInTheDocument();
    expect(issues.queryByText(new RegExp("a{80}"))).not.toBeInTheDocument();
  });

  it("surfaces long pending records in recent issues without an error summary", () => {
    renderHistory([
      record({
        txHash: "0xstuck",
        state: "Pending",
        nonce: 44,
        broadcastedAt: "1700000000",
      }),
    ]);

    const issues = within(screen.getByLabelText("Recent history issues"));
    expect(issues.getByText("Pending for an extended time")).toBeInTheDocument();
    expect(
      issues.getByText(
        "This transaction is still pending locally and no terminal receipt, replacement, cancellation, or dropped decision is recorded.",
      ),
    ).toBeInTheDocument();
    expect(issues.getByText("Pending · chainId 1 · nonce 44")).toBeInTheDocument();
  });

  it("shows categorized error details and preserves dropped reconcile semantics", () => {
    renderHistory([
      record({
        txHash: "0xdropped",
        state: "Dropped",
        reconcileSummary: {
          source: "localReconcile",
          checked_at: "1700000100",
          rpc_chain_id: 1,
          latest_confirmed_nonce: 8,
          decision: "nonceAdvancedWithoutReceipt",
        },
      }),
      record({
        txHash: "0xrpc",
        state: "Pending",
        nonce: 8,
        errorSummary: {
          source: "rpc",
          category: "provider",
          message: "RPC endpoint unavailable",
        },
      }),
    ]);

    fireEvent.click(within(screen.getByText("0xdropped").closest("tr") as HTMLElement).getByText("Details"));

    let panel = within(screen.getByLabelText("History details"));
    expect(panel.getAllByText("Dropped by local reconcile").length).toBeGreaterThan(0);
    expect(
      panel.getByText(
        "Local reconcile marked this transaction as a terminal dropped record. This is not the same as an on-chain failed receipt.",
      ),
    ).toBeInTheDocument();
    expect(panel.getByText("Error class")).toBeInTheDocument();
    expect(panel.getAllByText("Reconcile").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(screen.getByText("0xrpc").closest("tr") as HTMLElement).getByText("Details"));

    panel = within(screen.getByLabelText("History details"));
    expect(panel.getAllByText("RPC unavailable or rejected").length).toBeGreaterThan(0);
    expect(panel.getByText("The RPC endpoint failed, timed out, or returned an error while checking this transaction.")).toBeInTheDocument();
  });

  it("shows a dropped review action and audit details", () => {
    const onReviewDropped = vi.fn();
    renderHistory(
      [
        record({
          txHash: "0xdropped",
          state: "Dropped",
          reconcileSummary: {
            source: "rpcNonce",
            checked_at: "1700000101",
            rpc_chain_id: 1,
            latest_confirmed_nonce: 8,
            decision: "missingReceiptNonceAdvanced",
          },
          droppedReviewHistory: [
            {
              reviewed_at: "1700000200",
              source: "droppedManualReview",
              tx_hash: "0xdropped",
              rpc_endpoint_summary: "https://mainnet.example",
              requested_chain_id: 1,
              rpc_chain_id: 1,
              latest_confirmed_nonce: 8,
              transaction_found: false,
              original_state: "Dropped",
              original_reconciled_at: "1700000101",
              original_reconcile_summary: {
                source: "rpcNonce",
                checked_at: "1700000101",
                rpc_chain_id: 1,
                latest_confirmed_nonce: 8,
                decision: "missingReceiptNonceAdvanced",
              },
              result_state: "Dropped",
              decision: "stillMissingReceiptNonceAdvanced",
              recommendation: "Outcome remains uncertain/still dropped, not failed.",
            },
          ],
        }),
      ],
      { onReviewDropped },
    );

    fireEvent.click(screen.getByRole("button", { name: "Review dropped" }));
    expect(onReviewDropped).toHaveBeenCalledWith("0xdropped");

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    const guidance = within(screen.getByLabelText("Action guidance"));
    expect(guidance.getByText("Review dropped")).toBeInTheDocument();
    expect(guidance.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("Original dropped decision")).toBeInTheDocument();
    expect(screen.getByText("Latest review RPC endpoint")).toBeInTheDocument();
    expect(screen.getByText("https://mainnet.example")).toBeInTheDocument();
    expect(screen.getByText("Latest review recommendation")).toBeInTheDocument();
    expect(screen.getByText("Outcome remains uncertain/still dropped, not failed.")).toBeInTheDocument();
  });

  it("prioritizes incomplete dropped review fields over missing RPC guidance", () => {
    renderHistory([record({ txHash: "0xdropped", state: "Dropped", nonce: null })], {
      reviewRpcDisabledReason: "Validate an RPC before reviewing a dropped transaction.",
    });

    const reviewButton = screen.getByRole("button", { name: "Review dropped" });
    expect(reviewButton).toBeDisabled();
    expect(reviewButton).toHaveAttribute("title", "Missing frozen submission nonce.");
    expect(screen.getByText(/Review dropped: Missing frozen submission nonce/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Review dropped: Validate an RPC before reviewing/),
    ).not.toBeInTheDocument();
  });

  it("describes refresh as global tracked history instead of a row-scoped reconcile", () => {
    renderHistory([record({ txHash: "0xpending", state: "Pending" })]);

    expect(screen.getByRole("button", { name: "Refresh tracked history" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refresh\/Reconcile 0xpending/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Refresh\/Reconcile 0xpending/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    const guidance = within(screen.getByLabelText("Action guidance"));
    expect(guidance.getByText("Global refresh/reconcile")).toBeInTheDocument();
    expect(guidance.getByText(/currently selected chain\/RPC/)).toBeInTheDocument();
    expect(guidance.getByText(/not a single transaction/)).toBeInTheDocument();
  });

  it("shows pending age, latest reconcile check, and uncertain review guidance", () => {
    renderHistory([
      record({
        txHash: "0xaging",
        state: "Pending",
        nonce: 7,
        broadcastedAt: "1700000000",
        reconcileSummary: {
          source: "localReconcile",
          checked_at: "1700000100",
          rpc_chain_id: 1,
          latest_confirmed_nonce: 9,
          decision: "missingReceiptNonceAdvanced",
        },
      }),
    ]);

    expect(screen.getAllByText("Needs review").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Age .* checked/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Chain nonce evidence suggests this pending transaction may need review\/reconcile/).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/pending transaction failed/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    const pendingGuidance = within(screen.getByLabelText("Pending age guidance"));
    expect(pendingGuidance.getByText("Pending Age")).toBeInTheDocument();
    expect(pendingGuidance.getByText("Latest confirmed nonce from reconcile: 9.")).toBeInTheDocument();
    expect(pendingGuidance.getByText("Global refresh/reconcile")).toBeInTheDocument();
    expect(pendingGuidance.getByText("View diagnostics")).toBeInTheDocument();
  });

  it("shows pending age action disabled reasons from existing gates", () => {
    renderHistory([record({ txHash: "0xmissingnonce", state: "Pending", nonce: null })], {
      onReplace: vi.fn(),
      onCancelPending: vi.fn(),
    });

    expect(screen.getByText(/Replace: disabled - Missing frozen submission nonce/)).toBeInTheDocument();
    expect(screen.getByText(/Cancel: disabled - Missing frozen submission nonce/)).toBeInTheDocument();
  });

  it("refreshes pending age guidance on the minute clock while the page stays open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_001_740_000));
    try {
      renderHistory([
        record({
          txHash: "0xticking",
          state: "Pending",
          broadcastedAt: "1700000000",
        }),
      ]);

      expect(screen.getAllByText("Normal pending").length).toBeGreaterThan(0);
      expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2 * 60 * 1000);
      });

      expect(screen.getAllByText("Needs attention").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Age 31m/).length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows recovery actions and disables pending mutations when storage is corrupted", () => {
    const onRefresh = vi.fn();
    const onQuarantineHistory = vi.fn();
    renderHistory([record({ txHash: "0xpending", state: "Pending" })], {
      onRefresh,
      onQuarantineHistory,
      onReplace: vi.fn(),
      onCancelPending: vi.fn(),
      storage: damagedStorage,
    });

    expect(screen.getByText("History storage recovery")).toBeInTheDocument();
    expect(screen.getByText("JSON parse failed")).toBeInTheDocument();
    expect(screen.getByText("History actions disabled")).toBeInTheDocument();
    expect(screen.getByText(/submit, replace, cancel, and dropped review actions stay blocked/)).toBeInTheDocument();
    expect(screen.getByText("/tmp/tx-history.json")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry read" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Quarantine and start empty history" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Replace 0xpending" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel 0xpending" })).toBeDisabled();
    expect(screen.getByText(/Submit\/replace\/cancel: Disabled while local transaction history is unreadable/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quarantine and start empty history" }));
    expect(onQuarantineHistory).toHaveBeenCalledTimes(1);
  });

  it("does not show damaged-history recovery for first run empty history", () => {
    renderHistory([], {
      storage: {
        ...damagedStorage,
        status: "notFound",
        corruptionType: undefined,
        errorSummary: undefined,
      },
    });

    expect(screen.getByText("No local transaction history.")).toBeInTheDocument();
    expect(screen.queryByText("History storage recovery")).not.toBeInTheDocument();
    expect(screen.queryByText("History actions disabled")).not.toBeInTheDocument();
  });

  it("shows broadcast recovery parameters and calls recover by id", () => {
    const onRecoverBroadcastedHistory = vi.fn();
    const onDismissRecovery = vi.fn();
    renderHistory([], {
      recoveryIntents: [recoveryIntent()],
      onRecoverBroadcastedHistory,
      onDismissRecovery,
    });

    expect(screen.getByText("Broadcast recovery")).toBeInTheDocument();
    expect(screen.getByText("History missing")).toBeInTheDocument();
    expect(screen.getByText(/without signing or broadcasting again/)).toBeInTheDocument();
    expect(screen.getByText("chainId")).toBeInTheDocument();
    expect(screen.getByText("gas 21000 · max 40000000000 wei · priority 1500000000 wei")).toBeInTheDocument();
    expect(screen.getByText("Is a directory")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Recover 0xaaaaaaaa/i }));
    expect(onRecoverBroadcastedHistory).toHaveBeenCalledWith("broadcast-1");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismissRecovery).toHaveBeenCalledWith("broadcast-1");
  });

  it("disables broadcast recovery when minimum frozen fields are missing", () => {
    renderHistory([], {
      recoveryIntents: [recoveryIntent({ nonce: null })],
      onRecoverBroadcastedHistory: vi.fn(),
    });

    expect(screen.getByRole("button", { name: /Recover 0xaaaaaaaa/i })).toBeDisabled();
    expect(screen.getByText(/frozen nonce is missing/)).toBeInTheDocument();
  });

  it("redacts sensitive recovery errors before display", () => {
    renderHistory([], {
      recoveryIntents: [
        recoveryIntent({
          writeError:
            "failed at https://rpc.example/v1?apiKey=write-secret rawTx=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa token token-secret password hunter2",
          lastRecoveryError:
            "Authorization Bearer bearer-secret mnemonic test test test test next=value privateKey=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb signature sig-secret private key my-secret raw tx raw-secret",
        }),
      ],
      onRecoverBroadcastedHistory: vi.fn(),
    });

    expect(screen.getByText(/\[redacted_url\]/)).toBeInTheDocument();
    expect(screen.getAllByText(/\[redacted/).length).toBeGreaterThan(1);
    expect(screen.queryByText(/rpc\.example/)).not.toBeInTheDocument();
    expect(screen.queryByText(/write-secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/token-secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hunter2/)).not.toBeInTheDocument();
    expect(screen.queryByText(/bearer-secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sig-secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/my-secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw-secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/test test test/)).not.toBeInTheDocument();
    expect(screen.queryByText(/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/)).not.toBeInTheDocument();
  });

  it("blocks broadcast recovery while history storage is corrupted", () => {
    renderHistory([], {
      recoveryIntents: [recoveryIntent()],
      onRecoverBroadcastedHistory: vi.fn(),
      storage: damagedStorage,
    });

    expect(screen.getByRole("button", { name: /Recover 0xaaaaaaaa/i })).toBeDisabled();
    expect(screen.getByText(/Disabled while local transaction history is unreadable/)).toBeInTheDocument();
  });
});
