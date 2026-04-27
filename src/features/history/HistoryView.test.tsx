import { fireEvent, screen, within } from "@testing-library/react";
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
  broadcastedAt = "1700000001",
  finalizedAt,
  receipt = null,
  reconcileSummary = null,
  errorSummary = null,
}: {
  txHash: string;
  accountIndex?: number;
  from?: string;
  chainId?: number;
  nonce?: number;
  state?: ChainOutcomeState;
  kind?: SubmissionKind;
  replacesTxHash?: string | null;
  replacedByTxHash?: string | null;
  intentValueWei?: string;
  submissionValueWei?: string;
  broadcastedAt?: string;
  finalizedAt?: string | null;
  receipt?: Record<string, unknown> | null;
  reconcileSummary?: Record<string, unknown> | null;
  errorSummary?: Record<string, unknown> | null;
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
      max_fee_per_gas: "40000000000",
      max_priority_fee_per_gas: "1500000000",
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
      max_fee_per_gas: "40000000000",
      max_priority_fee_per_gas: "1500000000",
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
      items={normalizeHistoryRecords(rawRecords)}
      onRefresh={vi.fn()}
      {...options}
    />,
  );
}

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
    expect(within(intentSection as HTMLElement).getByText("100 wei")).toBeInTheDocument();
    expect(within(submissionSection as HTMLElement).getByText("250 wei")).toBeInTheDocument();
    expect(within(submissionSection as HTMLElement).getByText("0xdetail")).toBeInTheDocument();
    expect(
      within(outcomeSection as HTMLElement).getByText(
        "Pending - Broadcasted and tracked locally.",
      ),
    ).toBeInTheDocument();
    expect(within(outcomeSection as HTMLElement).getByText("broadcastTracked")).toBeInTheDocument();
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
});
