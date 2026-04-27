import { describe, expect, it } from "vitest";
import { normalizeHistoryRecords, type ChainOutcomeState, type SubmissionKind } from "./schema";
import { selectHistoryEntries } from "./selectors";
import { getPendingAgeGuidance } from "./pendingAge";

const account = "0x1111111111111111111111111111111111111111";
const recipient = "0x3333333333333333333333333333333333333333";
const nowMs = 1_700_086_400_000;

function secondsAgo(seconds: number) {
  return Math.floor((nowMs - seconds * 1000) / 1000).toString();
}

function rawRecord({
  txHash,
  state = "Pending",
  nonce = 7,
  kind = "nativeTransfer",
  replacesTxHash = null,
  replacedByTxHash = null,
  broadcastedAt = secondsAgo(5 * 60),
  capturedAt = secondsAgo(5 * 60),
  reconcileSummary = null,
  errorSummary = null,
}: {
  txHash: string;
  state?: ChainOutcomeState;
  nonce?: number | null;
  kind?: SubmissionKind;
  replacesTxHash?: string | null;
  replacedByTxHash?: string | null;
  broadcastedAt?: string | null;
  capturedAt?: string | null;
  reconcileSummary?: Record<string, unknown> | null;
  errorSummary?: { source: string; category: string; message: string } | null;
}) {
  return {
    schema_version: 2,
    intent: {
      rpc_url: "http://127.0.0.1:8545",
      account_index: 1,
      chain_id: 1,
      from: account,
      to: recipient,
      value_wei: "100",
      nonce,
      gas_limit: "21000",
      max_fee_per_gas: "40000000000",
      max_priority_fee_per_gas: "1500000000",
    },
    intent_snapshot: {
      source: "nativeTransferIntent",
      captured_at: capturedAt,
    },
    submission: {
      frozen_key: "key",
      tx_hash: txHash,
      kind,
      source: "submission",
      chain_id: 1,
      account_index: 1,
      from: account,
      to: recipient,
      value_wei: "100",
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
      finalized_at: state === "Pending" ? null : secondsAgo(1),
      receipt: null,
      reconciled_at: reconcileSummary ? secondsAgo(2 * 60) : null,
      reconcile_summary: reconcileSummary,
      error_summary: errorSummary,
      dropped_review_history: [],
    },
    nonce_thread: {
      source: "derived",
      key: `1:1:${account.toLowerCase()}:${nonce}`,
      chain_id: 1,
      account_index: 1,
      from: account,
      nonce,
      replaces_tx_hash: replacesTxHash,
      replaced_by_tx_hash: replacedByTxHash,
    },
  };
}

function entriesFor(rawRecords: unknown[]) {
  return selectHistoryEntries(normalizeHistoryRecords(rawRecords));
}

function guidance(rawRecords: unknown[], txHash: string) {
  const entries = entriesFor(rawRecords);
  const entry = entries.find((item) => item.txHash === txHash);
  if (!entry) throw new Error(`Missing ${txHash}`);
  const result = getPendingAgeGuidance(entry, entries, nowMs);
  if (!result) throw new Error(`Missing guidance for ${txHash}`);
  return result;
}

describe("pending age guidance", () => {
  it("classifies pending age with conservative thresholds", () => {
    expect(
      guidance([rawRecord({ txHash: "0xfresh", broadcastedAt: secondsAgo(10 * 60) })], "0xfresh"),
    ).toMatchObject({ state: "fresh", label: "Normal pending", ageLabel: "10m" });
    expect(
      guidance([rawRecord({ txHash: "0xattention", broadcastedAt: secondsAgo(45 * 60) })], "0xattention"),
    ).toMatchObject({ state: "attention", label: "Needs attention", ageLabel: "45m" });
    expect(
      guidance([rawRecord({ txHash: "0xstale", broadcastedAt: secondsAgo(5 * 60 * 60) })], "0xstale"),
    ).toMatchObject({ state: "stale", label: "Long pending", ageLabel: "5h" });
    expect(
      guidance([rawRecord({ txHash: "0xreview", broadcastedAt: secondsAgo(25 * 60 * 60) })], "0xreview"),
    ).toMatchObject({ state: "needsReview", label: "Needs review", ageLabel: "1d 1h" });
  });

  it("uses exact threshold boundaries for age state transitions", () => {
    expect(
      guidance(
        [rawRecord({ txHash: "0xbeforeattention", broadcastedAt: secondsAgo(30 * 60 - 1) })],
        "0xbeforeattention",
      ).state,
    ).toBe("fresh");
    expect(
      guidance(
        [rawRecord({ txHash: "0xattention", broadcastedAt: secondsAgo(30 * 60) })],
        "0xattention",
      ).state,
    ).toBe("attention");
    expect(
      guidance(
        [rawRecord({ txHash: "0xstale", broadcastedAt: secondsAgo(4 * 60 * 60) })],
        "0xstale",
      ).state,
    ).toBe("stale");
    expect(
      guidance(
        [rawRecord({ txHash: "0xreview", broadcastedAt: secondsAgo(24 * 60 * 60) })],
        "0xreview",
      ).state,
    ).toBe("needsReview");
  });

  it("handles missing pending timestamps without relying on memory state", () => {
    const raw = rawRecord({ txHash: "0xmissingtime", broadcastedAt: null, capturedAt: null });

    const result = guidance([raw], "0xmissingtime");

    expect(result).toMatchObject({
      state: "attention",
      ageMs: null,
      ageLabel: "Unknown",
    });
    expect(result.evidence).toContain("Pending age: Unknown.");
  });

  it("uses persisted reconcile summaries for checked time and chain nonce evidence", () => {
    const result = guidance(
      [
        rawRecord({
          txHash: "0xnonceadvanced",
          nonce: 7,
          broadcastedAt: secondsAgo(20 * 60),
          reconcileSummary: {
            source: "localReconcile",
            checked_at: secondsAgo(2 * 60),
            rpc_chain_id: 1,
            latest_confirmed_nonce: 9,
            decision: "missingReceiptNonceAdvanced",
          },
        }),
      ],
      "0xnonceadvanced",
    );

    expect(result.state).toBe("needsReview");
    expect(result.checkedLabel).toBe("2m ago");
    expect(result.summary).toContain("may need review/reconcile");
    expect(result.summary).not.toMatch(/\bfailed\b/i);
    expect(result.evidence).toContain("Latest confirmed nonce from reconcile: 9.");
  });

  it("does not treat a single RPC failure as dropped or failed", () => {
    const result = guidance(
      [
        rawRecord({
          txHash: "0xrpc",
          broadcastedAt: secondsAgo(15 * 60),
          errorSummary: {
            source: "rpc",
            category: "provider",
            message: "RPC endpoint unavailable",
          },
        }),
      ],
      "0xrpc",
    );

    expect(result.state).toBe("attention");
    expect(result.summary).not.toMatch(/\bdropped\b|\bfailed\b/i);
    expect(result.evidence.join(" ")).toContain("provider from rpc");
  });

  it("keeps replace and cancel guidance aligned with current nonce-thread action gates", () => {
    const result = guidance(
      [
        rawRecord({
          txHash: "0xoriginal",
          state: "Pending",
          replacedByTxHash: "0xreplacement",
          broadcastedAt: secondsAgo(26 * 60 * 60),
        }),
        rawRecord({
          txHash: "0xreplacement",
          state: "Pending",
          kind: "replacement",
          replacesTxHash: "0xoriginal",
          broadcastedAt: secondsAgo(10 * 60),
        }),
      ],
      "0xoriginal",
    );

    expect(result.state).toBe("needsReview");
    expect(result.summary).toContain("later same-nonce submission");
    expect(result.recommendations).toContainEqual(
      expect.objectContaining({
        kind: "replace",
        enabled: false,
        reason: expect.stringContaining("not the current pending nonce-thread target"),
      }),
    );
    expect(result.recommendations).toContainEqual(
      expect.objectContaining({
        kind: "cancel",
        enabled: false,
        reason: expect.stringContaining("not the current pending nonce-thread target"),
      }),
    );
  });

  it("returns no guidance for terminal records", () => {
    const [entry] = entriesFor([rawRecord({ txHash: "0xconfirmed", state: "Confirmed" })]);
    expect(getPendingAgeGuidance(entry, [entry], nowMs)).toBeNull();
  });
});
