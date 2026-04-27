import { describe, expect, it } from "vitest";
import { getHistoryActionGates, isCurrentPendingActionTarget } from "./actions";
import { normalizeHistoryRecords, type ChainOutcomeState, type SubmissionKind } from "./schema";
import { selectHistoryEntries } from "./selectors";

const account = "0x1111111111111111111111111111111111111111";
const recipient = "0x3333333333333333333333333333333333333333";

function rawRecord({
  txHash,
  state = "Pending",
  chainId = 1,
  accountIndex = 1,
  from = account,
  nonce = 7,
  replacedByTxHash = null,
  replacesTxHash = null,
  kind = "nativeTransfer",
  submissionSource = "submission",
  nonceThreadSource = "derived",
  errorSummary = null,
}: {
  txHash: string;
  state?: ChainOutcomeState;
  chainId?: number | null;
  accountIndex?: number | null;
  from?: string | null;
  nonce?: number | null;
  replacedByTxHash?: string | null;
  replacesTxHash?: string | null;
  kind?: SubmissionKind;
  submissionSource?: string;
  nonceThreadSource?: string;
  errorSummary?: { source: string; category: string; message: string } | null;
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
      frozen_key: "key",
      tx_hash: txHash,
      kind,
      source: submissionSource,
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
      receipt: null,
      reconciled_at: null,
      reconcile_summary: null,
      error_summary: errorSummary,
    },
    nonce_thread: {
      source: nonceThreadSource,
      key: "thread",
      chain_id: chainId,
      account_index: accountIndex,
      from,
      nonce,
      replaces_tx_hash: replacesTxHash,
      replaced_by_tx_hash: replacedByTxHash,
    },
  };
}

function entryFor(rawRecords: unknown[], txHash: string) {
  const entries = selectHistoryEntries(normalizeHistoryRecords(rawRecords));
  const entry = entries.find((item) => item.txHash === txHash);
  if (!entry) throw new Error(`Missing test entry ${txHash}`);
  return { entry, entries };
}

function gateMap(rawRecords: unknown[], txHash: string) {
  const { entry, entries } = entryFor(rawRecords, txHash);
  return new Map(getHistoryActionGates(entry, entries).map((action) => [action.kind, action]));
}

describe("history action gating", () => {
  it("enables reconcile, replace, and cancel only for a complete current pending submission", () => {
    const gates = gateMap([rawRecord({ txHash: "0xpending" })], "0xpending");

    expect(gates.get("reconcile")).toMatchObject({ visible: true, enabled: true });
    expect(gates.get("replace")).toMatchObject({ visible: true, enabled: true });
    expect(gates.get("cancel")).toMatchObject({ visible: true, enabled: true });
  });

  it("hides replace and cancel for non-current pending and terminal statuses", () => {
    const thread = [
      rawRecord({ txHash: "0xoldpending", replacedByTxHash: "0xreplacement" }),
      rawRecord({ txHash: "0xreplacement", replacesTxHash: "0xoldpending" }),
    ];
    const { entry, entries } = entryFor(thread, "0xoldpending");

    expect(isCurrentPendingActionTarget(entry, entries)).toBe(false);
    expect(gateMap(thread, "0xoldpending").has("replace")).toBe(false);

    for (const state of ["Confirmed", "Failed", "Replaced", "Cancelled"] as ChainOutcomeState[]) {
      const gates = gateMap([rawRecord({ txHash: `0x${state}`, state })], `0x${state}`);
      expect(gates.has("reconcile")).toBe(false);
      expect(gates.has("replace")).toBe(false);
      expect(gates.has("cancel")).toBe(false);
    }
  });

  it("enables dropped review for complete dropped records", () => {
    const gates = gateMap([rawRecord({ txHash: "0xdropped", state: "Dropped" })], "0xdropped");

    expect(gates.get("droppedReview")).toMatchObject({
      visible: true,
      enabled: true,
      reason: expect.stringContaining("frozen submission"),
    });
    expect(gates.has("replace")).toBe(false);
    expect(gates.has("cancel")).toBe(false);
  });

  it("disables dropped review when frozen submission fields are incomplete", () => {
    const raw = rawRecord({ txHash: "0xdroppedmissing", state: "Dropped", nonce: null });

    expect(gateMap([raw], "0xdroppedmissing").get("droppedReview")).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("frozen submission nonce"),
    });
  });

  it("disables pending actions when trace or mutation identity fields are missing", () => {
    for (const raw of [
      rawRecord({ txHash: "unknown" }),
      rawRecord({ txHash: "0xnochain", chainId: null }),
      rawRecord({ txHash: "0xnoaccount", accountIndex: null }),
      rawRecord({ txHash: "0xnofrom", from: null }),
    ]) {
      const txHash = raw.submission.tx_hash;
      const gates = gateMap([raw], txHash);
      expect(gates.get("reconcile")?.enabled).toBe(false);
      expect(gates.get("replace")?.enabled).toBe(false);
      expect(gates.get("cancel")?.enabled).toBe(false);
      expect([
        gates.get("reconcile")?.reason,
        gates.get("replace")?.reason,
        gates.get("cancel")?.reason,
      ].join(" ")).toMatch(/Missing|Disabled/);
    }

    const missingNonce = gateMap([rawRecord({ txHash: "0xnononce", nonce: null })], "0xnononce");
    expect(missingNonce.get("reconcile")?.enabled).toBe(true);
    expect(missingNonce.get("replace")?.enabled).toBe(false);
    expect(missingNonce.get("cancel")?.enabled).toBe(false);
    expect(missingNonce.get("replace")?.reason).toContain("Missing frozen submission nonce");
  });

  it("does not enable replace or cancel from stale intent fields when frozen submission fields are missing", () => {
    const raw = rawRecord({ txHash: "0xfrozenmissing" });
    raw.submission.account_index = null;
    raw.submission.from = null;
    raw.submission.nonce = null;

    const gates = gateMap([raw], "0xfrozenmissing");

    expect(gates.get("replace")).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("frozen submission"),
    });
    expect(gates.get("cancel")).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("frozen submission"),
    });
  });

  it("disables actions for chainId mismatch and local history write failures", () => {
    const chainMismatch = rawRecord({
      txHash: "0xchain",
      errorSummary: {
        source: "rpc validation",
        category: "chainId mismatch",
        message: "Remote chainId 8453 does not match expected chainId 1",
      },
    });
    const historyWriteFailed = rawRecord({
      txHash: "0xhistory",
      errorSummary: {
        source: "history",
        category: "write",
        message: "broadcast may have succeeded but history write failed",
      },
    });

    expect(gateMap([chainMismatch], "0xchain").get("replace")).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("chainId"),
    });
    expect(gateMap([historyWriteFailed], "0xhistory").get("reconcile")).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("history storage"),
    });
  });

  it("keeps RPC unavailable and nonce conflict on existing safe paths with explicit guidance", () => {
    const rpcUnavailable = rawRecord({
      txHash: "0xrpc",
      errorSummary: {
        source: "rpc",
        category: "provider",
        message: "RPC endpoint unavailable",
      },
    });
    const nonceConflict = rawRecord({
      txHash: "0xnonce",
      errorSummary: {
        source: "rpc",
        category: "nonce",
        message: "nonce conflict",
      },
    });

    expect(gateMap([rpcUnavailable], "0xrpc").get("reconcile")).toMatchObject({
      enabled: true,
      reason: expect.stringContaining("RPC endpoint"),
    });
    expect(gateMap([rpcUnavailable], "0xrpc").get("reconcile")?.label).toBe(
      "Global refresh/reconcile",
    );
    expect(gateMap([rpcUnavailable], "0xrpc").get("reconcile")?.reason).toContain(
      "currently selected chain/RPC",
    );
    expect(gateMap([nonceConflict], "0xnonce").get("replace")).toMatchObject({
      enabled: true,
      reason: expect.stringContaining("Nonce conflict"),
    });
  });

  it("disables replace and cancel for complete legacy pending records", () => {
    const gates = gateMap(
      [
        rawRecord({
          txHash: "0xlegacy",
          kind: "legacy",
          submissionSource: "legacy",
          nonceThreadSource: "legacy",
        }),
      ],
      "0xlegacy",
    );

    expect(gates.get("reconcile")).toMatchObject({ visible: true, enabled: true });
    expect(gates.get("replace")).toMatchObject({
      visible: true,
      enabled: false,
      reason: "Legacy history record lacks frozen submission identity for replace/cancel.",
    });
    expect(gates.get("cancel")).toMatchObject({
      visible: true,
      enabled: false,
      reason: "Legacy history record lacks frozen submission identity for replace/cancel.",
    });
  });
});
