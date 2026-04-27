import { describe, expect, it } from "vitest";
import { normalizeHistoryRecords, parseTransactionHistoryPayload } from "./schema";

const legacyIntent = {
  rpc_url: "http://127.0.0.1:8545",
  account_index: 1,
  chain_id: 1,
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  value_wei: "100",
  nonce: 7,
  gas_limit: "21000",
  max_fee_per_gas: "40000000000",
  max_priority_fee_per_gas: "1500000000",
};

describe("history schema normalization", () => {
  it("loads v1 records with legacy unknown null defaults", () => {
    const records = parseTransactionHistoryPayload(
      JSON.stringify([
        {
          intent: legacyIntent,
          submission: {
            frozen_key: "legacy-key",
            tx_hash: "0xlegacy",
          },
          outcome: {
            state: "Pending",
            tx_hash: "0xlegacy",
          },
        },
      ]),
    );

    expect(records[0]).toMatchObject({
      schema_version: 1,
      intent_snapshot: { source: "legacy", captured_at: null },
      submission: {
        kind: "legacy",
        source: "legacy",
        broadcasted_at: null,
        chain_id: null,
      },
      outcome: {
        receipt: null,
        finalized_at: null,
        reconciled_at: null,
        reconcile_summary: null,
        error_summary: null,
      },
      nonce_thread: {
        source: "legacy",
        key: "unknown",
        chain_id: null,
      },
    });
  });

  it("preserves p3 submission, outcome, and nonce thread fields", () => {
    const records = normalizeHistoryRecords([
      {
        schema_version: 2,
        intent: legacyIntent,
        intent_snapshot: {
          source: "nativeTransferIntent",
          captured_at: "1700000000",
        },
        submission: {
          frozen_key: "p3-key",
          tx_hash: "0xp3",
          kind: "nativeTransfer",
          source: "submission",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          to: legacyIntent.to,
          value_wei: "100",
          nonce: 7,
          gas_limit: "21000",
          max_fee_per_gas: "40000000000",
          max_priority_fee_per_gas: "1500000000",
          broadcasted_at: "1700000001",
          replaces_tx_hash: null,
        },
        outcome: {
          state: "Confirmed",
          tx_hash: "0xp3",
          receipt: {
            status: 1,
            block_number: 12,
            block_hash: "0xblock",
            transaction_index: 0,
            gas_used: "21000",
            effective_gas_price: "123",
          },
          finalized_at: "1700000002",
          reconciled_at: "1700000002",
          reconcile_summary: {
            source: "rpcReceipt",
            checked_at: "1700000002",
            rpc_chain_id: 1,
            latest_confirmed_nonce: null,
            decision: "receiptStatus1",
          },
          error_summary: null,
        },
        nonce_thread: {
          source: "derived",
          key: "1:1:0x1111111111111111111111111111111111111111:7",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          nonce: 7,
          replaces_tx_hash: null,
          replaced_by_tx_hash: null,
        },
      },
    ]);

    expect(records[0].submission.broadcasted_at).toBe("1700000001");
    expect(records[0].outcome.receipt?.gas_used).toBe("21000");
    expect(records[0].nonce_thread.key).toBe(
      "1:1:0x1111111111111111111111111111111111111111:7",
    );
  });

  it("normalizes mixed legacy and p3 records to one stable contract", () => {
    const records = normalizeHistoryRecords([
      {
        intent: legacyIntent,
        submission: { frozen_key: "legacy-key", tx_hash: "0xlegacy" },
        outcome: { state: "Pending", tx_hash: "0xlegacy" },
      },
      {
        schema_version: 2,
        intent: { ...legacyIntent, nonce: 8 },
        intent_snapshot: { source: "nativeTransferIntent", captured_at: "1700000000" },
        submission: {
          frozen_key: "p3-key",
          tx_hash: "0xp3",
          kind: "replacement",
          source: "submission",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          to: legacyIntent.to,
          value_wei: "200",
          nonce: 8,
          gas_limit: "21000",
          max_fee_per_gas: "50000000000",
          max_priority_fee_per_gas: "2000000000",
          broadcasted_at: "1700000001",
          replaces_tx_hash: "0xlegacy",
        },
        outcome: { state: "Pending", tx_hash: "0xp3" },
        nonce_thread: {
          source: "derived",
          key: "1:1:0x1111111111111111111111111111111111111111:8",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          nonce: 8,
          replaces_tx_hash: "0xlegacy",
          replaced_by_tx_hash: null,
        },
      },
    ]);

    expect(records).toHaveLength(2);
    expect(records[0].submission.kind).toBe("legacy");
    expect(records[1].submission.kind).toBe("replacement");
    expect(records[1].outcome.receipt).toBeNull();
  });

  it("falls back when submission kind or outcome state are unknown", () => {
    const records = normalizeHistoryRecords([
      {
        intent: legacyIntent,
        submission: {
          frozen_key: "strange-key",
          tx_hash: "0xstrange",
          kind: "surprise",
        },
        outcome: {
          state: "MinedButMaybeNot",
          tx_hash: "0xstrange",
        },
      },
    ]);

    expect(records[0].submission.kind).toBe("legacy");
    expect(records[0].outcome.state).toBe("Unknown");
  });
});
