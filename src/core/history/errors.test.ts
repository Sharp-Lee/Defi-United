import { describe, expect, it } from "vitest";
import {
  getHistoryErrorDisplay,
  getRawHistoryErrorDisplay,
  sanitizeHistoryErrorMessage,
} from "./errors";
import { normalizeHistoryRecord } from "./schema";

const account = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";

function record({
  state = "Pending",
  errorSummary = null,
  broadcastedAt = "1700000000",
  reconciledAt = null,
  reconcileSummary = null,
}: {
  state?: "Pending" | "Confirmed" | "Failed" | "Replaced" | "Cancelled" | "Dropped" | "Unknown";
  errorSummary?: Record<string, unknown> | null;
  broadcastedAt?: string | null;
  reconciledAt?: string | null;
  reconcileSummary?: Record<string, unknown> | null;
}) {
  return normalizeHistoryRecord({
    schema_version: 2,
    intent: {
      rpc_url: "http://127.0.0.1:8545",
      account_index: 1,
      chain_id: 1,
      from: account,
      to: recipient,
      value_wei: "100",
      nonce: 7,
      gas_limit: "21000",
      max_fee_per_gas: "40000000000",
      max_priority_fee_per_gas: "1500000000",
    },
    intent_snapshot: {
      source: "nativeTransferIntent",
      captured_at: "1700000000",
    },
    submission: {
      frozen_key: "key",
      tx_hash: "0xtx",
      kind: "nativeTransfer",
      source: "submission",
      chain_id: 1,
      account_index: 1,
      from: account,
      to: recipient,
      value_wei: "100",
      nonce: 7,
      gas_limit: "21000",
      max_fee_per_gas: "40000000000",
      max_priority_fee_per_gas: "1500000000",
      broadcasted_at: broadcastedAt,
      replaces_tx_hash: null,
    },
    outcome: {
      state,
      tx_hash: "0xtx",
      receipt: null,
      finalized_at: state === "Pending" ? null : "1700000100",
      reconciled_at: reconciledAt,
      reconcile_summary: reconcileSummary,
      error_summary: errorSummary,
    },
    nonce_thread: {
      source: "derived",
      key: "thread",
      chain_id: 1,
      account_index: 1,
      from: account,
      nonce: 7,
      replaces_tx_hash: null,
      replaced_by_tx_hash: null,
    },
  });
}

describe("history error display", () => {
  it("classifies replacement underpriced as a nonce error", () => {
    const display = getHistoryErrorDisplay({
      record: record({
        errorSummary: {
          source: "rpc",
          category: "nonce",
          message: "replacement underpriced",
        },
      }),
      status: "pending",
      nowMs: 1_700_000_100_000,
    });

    expect(display).toMatchObject({
      label: "Nonce",
      title: "Replacement fee too low",
    });
    expect(display?.summary).toContain("same-nonce replacement");
  });

  it("classifies insufficient funds as a broadcast error", () => {
    const display = getHistoryErrorDisplay({
      record: record({
        errorSummary: {
          source: "rpc",
          category: "broadcast",
          message: "insufficient funds for gas * price + value",
        },
      }),
      status: "pending",
      nowMs: 1_700_000_100_000,
    });

    expect(display).toMatchObject({
      label: "Broadcast",
      title: "Insufficient funds",
    });
    expect(display?.suggestion).toContain("balance");
  });

  it("explains chainId mismatch as chain identity instead of RPC URL identity", () => {
    const display = getHistoryErrorDisplay({
      record: record({
        errorSummary: {
          source: "rpc validation",
          category: "chainId mismatch",
          message: "Remote chainId 8453 does not match expected chainId 1",
        },
      }),
      status: "unknown",
    });

    expect(display).toMatchObject({
      label: "Chain identity",
      title: "Chain identity mismatch",
    });
    expect(display?.summary).toContain("chainId is the stable chain identity");
    expect(display?.summary).toContain("RPC URL is only an access endpoint");
  });

  it("explains dropped as local reconcile and not an on-chain failed receipt", () => {
    const display = getHistoryErrorDisplay({
      record: record({
        state: "Dropped",
        reconcileSummary: {
          source: "localReconcile",
          checked_at: "1700000100",
          rpc_chain_id: 1,
          latest_confirmed_nonce: 8,
          decision: "nonceAdvancedWithoutReceipt",
        },
      }),
      status: "dropped",
    });

    expect(display).toMatchObject({
      label: "Reconcile",
      title: "Dropped by local reconcile",
      source: "localReconcile",
      category: "dropped",
    });
    expect(display?.summary).toContain("not the same as an on-chain failed receipt");
  });

  it("keeps the existing 30 minute stale pending fallback", () => {
    const display = getHistoryErrorDisplay({
      record: record({
        state: "Pending",
        broadcastedAt: "1700000000",
      }),
      status: "pending",
      nowMs: 1_700_001_860_000,
    });

    expect(display).toMatchObject({
      label: "Reconcile",
      title: "Pending for an extended time",
      category: "pending",
    });
    expect(display?.suggestion).toContain("Refresh history");
  });

  it("sanitizes long hex payloads and truncates long messages", () => {
    const rawPayload = `rpc error ${"0x".padEnd(132, "a")} ${"x".repeat(300)}`;
    const message = sanitizeHistoryErrorMessage(rawPayload);

    expect(message).toContain("0xaaaaaaaa...aaaaaaaa");
    expect(message?.length).toBeLessThanOrEqual(180);
  });

  it("redacts raw RPC URLs before displaying history errors", () => {
    const message = sanitizeHistoryErrorMessage(
      "reconcile failed for https://rpc.example.com/v1/super-secret-key?apiKey=abc123 and http://localhost:8545/path",
    );

    expect(message).toContain("[redacted URL]");
    expect(message).not.toContain("super-secret-key");
    expect(message).not.toContain("apiKey");
    expect(message).not.toContain("localhost:8545/path");
  });

  it("classifies raw refresh errors without a history record", () => {
    const display = getRawHistoryErrorDisplay({
      source: "manual history refresh",
      category: "refresh",
      message: "RPC returned chainId 8453; expected 1.",
    });

    expect(display).toMatchObject({
      label: "Chain identity",
      title: "Chain identity mismatch",
      source: "manual history refresh",
    });
  });

  it("classifies raw broadcast-success history-write failures as history errors", () => {
    const display = getRawHistoryErrorDisplay({
      source: "transfer submit",
      category: "submit",
      message:
        "broadcast succeeded with tx hash 0xabcdef1234567890 but local history write failed: permission denied",
    });

    expect(display).toMatchObject({
      label: "History",
      title: "Broadcast may have succeeded; local history write failed",
    });
    expect(display.summary).toContain("broadcast may have succeeded");
    expect(display.suggestion).toContain("Keep the transaction hash");
  });
});
