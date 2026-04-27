import { fireEvent, screen, within } from "@testing-library/react";
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
}) {
  return {
    schema_version: 2,
    intent: {
      rpc_url: "http://127.0.0.1:8545",
      account_index: accountIndex,
      chain_id: chainId,
      from,
      to: recipient,
      value_wei: "100",
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
      frozen_key: `${chainId}:${from}:${recipient}:100:${nonce}`,
      tx_hash: txHash,
      kind,
      source: "submission",
      chain_id: chainId,
      account_index: accountIndex,
      from,
      to: recipient,
      value_wei: "100",
      nonce,
      gas_limit: "21000",
      max_fee_per_gas: "40000000000",
      max_priority_fee_per_gas: "1500000000",
      broadcasted_at: "1700000001",
      replaces_tx_hash: replacesTxHash,
    },
    outcome: {
      state,
      tx_hash: txHash,
      finalized_at: state === "Pending" ? null : "1700000100",
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
    expect(table.getByText("submission: 0xoriginal")).toBeInTheDocument();
    expect(table.getByText("replacement: 0xreplacement")).toBeInTheDocument();
    expect(table.getByText("cancellation: 0xcancel")).toBeInTheDocument();
    expect(table.queryByText("0xother")).not.toBeInTheDocument();
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
  });
});
