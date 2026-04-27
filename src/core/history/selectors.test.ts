import { describe, expect, it } from "vitest";
import { normalizeHistoryRecords, type ChainOutcomeState, type SubmissionKind } from "./schema";
import { groupHistoryByNonce, selectHistoryEntries } from "./selectors";

const accountA = "0x1111111111111111111111111111111111111111";
const accountB = "0x2222222222222222222222222222222222222222";
const recipient = "0x3333333333333333333333333333333333333333";

function rawRecord({
  txHash,
  rpcUrl = "http://127.0.0.1:8545",
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
  rpcUrl?: string;
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
      rpc_url: rpcUrl,
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

function partialRawRecord({
  txHash,
  frozenKey = "unknown",
  intent = {},
  submission = {},
  nonceThread = {},
}: {
  txHash: string;
  frozenKey?: string;
  intent?: Record<string, unknown>;
  submission?: Record<string, unknown>;
  nonceThread?: Record<string, unknown>;
}) {
  return {
    intent: {
      rpc_url: "http://partial-rpc.example",
      to: recipient,
      value_wei: "1",
      gas_limit: "21000",
      max_fee_per_gas: "1",
      max_priority_fee_per_gas: "1",
      ...intent,
    },
    submission: {
      frozen_key: frozenKey,
      tx_hash: txHash,
      ...submission,
    },
    outcome: {
      state: "Pending",
      tx_hash: txHash,
    },
    nonce_thread: nonceThread,
  };
}

describe("history selectors", () => {
  it("maps core outcome states to stable read statuses and filters by status", () => {
    const records = normalizeHistoryRecords([
      rawRecord({ txHash: "0xpending", state: "Pending", nonce: 1 }),
      rawRecord({ txHash: "0xconfirmed", state: "Confirmed", nonce: 2 }),
      rawRecord({ txHash: "0xfailed", state: "Failed", nonce: 3 }),
      rawRecord({ txHash: "0xreplaced", state: "Replaced", nonce: 4 }),
      rawRecord({ txHash: "0xcancelled", state: "Cancelled", nonce: 5 }),
      rawRecord({ txHash: "0xdropped", state: "Dropped", nonce: 6 }),
    ]);

    expect(selectHistoryEntries(records).map((entry) => entry.status)).toEqual([
      "pending",
      "confirmed",
      "failed",
      "replaced",
      "cancelled",
      "dropped",
    ]);
    expect(selectHistoryEntries(records, { status: ["Pending", "failed"] }).map((entry) => entry.txHash)).toEqual([
      "0xpending",
      "0xfailed",
    ]);
  });

  it("groups by account, chainId, and nonce without using rpcUrl as chain identity", () => {
    const records = normalizeHistoryRecords([
      rawRecord({ txHash: "0xa1", chainId: 1, nonce: 7, rpcUrl: "http://rpc-a.example" }),
      rawRecord({ txHash: "0xa2", chainId: 1, nonce: 7, rpcUrl: "http://rpc-b.example" }),
      rawRecord({ txHash: "0xother-chain", chainId: 11155111, nonce: 7 }),
      rawRecord({ txHash: "0xother-account", chainId: 1, nonce: 7, accountIndex: 2, from: accountB }),
      rawRecord({ txHash: "0xother-nonce", chainId: 1, nonce: 8 }),
    ]);

    const groups = groupHistoryByNonce(records);
    const sameChainGroup = groups.find((group) =>
      group.submissions.some((entry) => entry.txHash === "0xa1"),
    );

    expect(groups).toHaveLength(4);
    expect(sameChainGroup?.submissions.map((entry) => entry.txHash)).toEqual(["0xa1", "0xa2"]);
    expect(sameChainGroup?.key).toContain("chainId=1");
    expect(sameChainGroup?.key).not.toContain("rpc-a.example");
    expect(sameChainGroup?.key).not.toContain("rpc-b.example");
  });

  it("aggregates original, replacement, and cancellation submissions in one nonce thread", () => {
    const records = normalizeHistoryRecords([
      rawRecord({
        txHash: "0xoriginal",
        nonce: 9,
        state: "Replaced",
        kind: "nativeTransfer",
        replacedByTxHash: "0xreplacement",
      }),
      rawRecord({
        txHash: "0xreplacement",
        nonce: 9,
        state: "Pending",
        kind: "replacement",
        replacesTxHash: "0xoriginal",
      }),
      rawRecord({
        txHash: "0xcancel",
        nonce: 9,
        state: "Pending",
        kind: "cancellation",
        replacesTxHash: "0xreplacement",
      }),
    ]);

    const [group] = groupHistoryByNonce(records);

    expect(group.key).toBe(
      `account=index:1|from:${accountA}|chainId=1|nonce=9`,
    );
    expect(group.submissions.map((entry) => [entry.txHash, entry.submissionRole])).toEqual([
      ["0xoriginal", "submission"],
      ["0xreplacement", "replacement"],
      ["0xcancel", "cancellation"],
    ]);
    expect(group.submissions[1].replacesTxHash).toBe("0xoriginal");
    expect(group.submissions[0].replacedByTxHash).toBe("0xreplacement");
    expect(group.hasReplacement).toBe(true);
    expect(group.hasCancellation).toBe(true);
    expect(group.statusCounts.pending).toBe(2);
    expect(group.statusCounts.replaced).toBe(1);
  });

  it("summarizes identity issues from later submissions at the group level", () => {
    const records = normalizeHistoryRecords([
      rawRecord({
        txHash: "0xoriginal",
        nonce: 10,
        state: "Replaced",
        kind: "nativeTransfer",
        replacedByTxHash: "0xreplacement",
      }),
      rawRecord({
        txHash: "0xreplacement",
        nonce: 10,
        state: "Pending",
        kind: "replacement",
        replacesTxHash: "0xoriginal",
      }),
      rawRecord({
        txHash: "0xcancel",
        nonce: 10,
        state: "Pending",
        kind: "cancellation",
        replacesTxHash: "0xreplacement",
      }),
    ]);
    records[1].intent.chain_id = 5;
    records[2].intent.nonce = 11;

    const [group] = groupHistoryByNonce(records);

    expect(group.submissions[0]).toMatchObject({
      txHash: "0xoriginal",
      identityConsistent: true,
      identityIssues: [],
    });
    expect(group.submissions[1]).toMatchObject({
      txHash: "0xreplacement",
      identityConsistent: false,
    });
    expect(group.submissions[2]).toMatchObject({
      txHash: "0xcancel",
      identityConsistent: false,
    });
    expect(group).toMatchObject({
      key: `account=index:1|from:${accountA}|chainId=1|nonce=10`,
      identityConsistent: false,
    });
    expect(group.identityIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "inconsistent", field: "chainId" }),
        expect.objectContaining({ kind: "inconsistent", field: "nonce" }),
      ]),
    );
  });

  it("filters grouped history by account, chainId, status, and nonce", () => {
    const records = normalizeHistoryRecords([
      rawRecord({ txHash: "0xmatch", chainId: 5, nonce: 12, state: "Pending" }),
      rawRecord({ txHash: "0xwrong-chain", chainId: 1, nonce: 12, state: "Pending" }),
      rawRecord({ txHash: "0xwrong-account", accountIndex: 2, from: accountB, chainId: 5, nonce: 12 }),
      rawRecord({ txHash: "0xwrong-status", chainId: 5, nonce: 12, state: "Confirmed" }),
      rawRecord({ txHash: "0xwrong-nonce", chainId: 5, nonce: 13, state: "Pending" }),
    ]);

    const groups = groupHistoryByNonce(records, {
      account: { accountIndex: 1, from: accountA.toUpperCase() },
      chainId: 5,
      status: "pending",
      nonce: 12,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].submissions.map((entry) => entry.txHash)).toEqual(["0xmatch"]);
  });

  it("falls back to legacy intent fields when additive p3 fields are unknown", () => {
    const records = normalizeHistoryRecords([
      {
        intent: {
          rpc_url: "http://legacy-rpc.example",
          account_index: 3,
          chain_id: 10,
          from: accountB,
          to: recipient,
          value_wei: "1",
          nonce: 21,
          gas_limit: "21000",
          max_fee_per_gas: "1",
          max_priority_fee_per_gas: "1",
        },
        submission: {
          frozen_key: "legacy-key",
          tx_hash: "0xlegacy",
        },
        outcome: {
          state: "Dropped",
          tx_hash: "0xlegacy",
        },
      },
    ]);

    const [group] = groupHistoryByNonce(records);

    expect(group.key).toBe(`account=index:3|from:${accountB}|chainId=10|nonce=21`);
    expect(group.submissions[0]).toMatchObject({
      txHash: "0xlegacy",
      submissionRole: "legacy",
      status: "dropped",
    });
  });

  it("isolates records with incomplete account, chainId, or nonce identity instead of merging unknown threads", () => {
    const records = normalizeHistoryRecords([
      partialRawRecord({
        txHash: "0xmissing-chain",
        submission: { account_index: 1, from: accountA, nonce: 4 },
      }),
      partialRawRecord({
        txHash: "0xmissing-nonce",
        submission: { account_index: 1, from: accountA, chain_id: 1 },
      }),
      partialRawRecord({
        txHash: "0xmissing-account",
        submission: { chain_id: 1, nonce: 4 },
      }),
    ]);

    const groups = groupHistoryByNonce(records);

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.key)).toEqual([
      "isolated|txHash=0xmissing-chain",
      "isolated|txHash=0xmissing-nonce",
      "isolated|txHash=0xmissing-account",
    ]);
    expect(groups.every((group) => !group.identityComplete)).toBe(true);
    expect(groups.map((group) => group.submissions)).toEqual([
      [expect.objectContaining({ txHash: "0xmissing-chain" })],
      [expect.objectContaining({ txHash: "0xmissing-nonce" })],
      [expect.objectContaining({ txHash: "0xmissing-account" })],
    ]);
  });

  it("does not synthesize identity across layers and exposes incomplete or inconsistent fields", () => {
    const records = normalizeHistoryRecords([
      partialRawRecord({
        txHash: "0xpartial",
        submission: { account_index: 1, from: accountA, nonce: 7 },
        nonceThread: { account_index: 2, from: accountA, chain_id: 5 },
      }),
      rawRecord({ txHash: "0xconflict", chainId: 1, nonce: 8 }),
    ]);
    records[1].intent.chain_id = 5;

    const entries = selectHistoryEntries(records);
    const partial = entries.find((entry) => entry.txHash === "0xpartial");
    const conflict = entries.find((entry) => entry.txHash === "0xconflict");

    expect(partial).toMatchObject({
      identitySource: "submission",
      identityComplete: false,
      identityConsistent: false,
      chainId: null,
      nonce: 7,
    });
    expect(partial?.key).toBe("isolated|txHash=0xpartial");
    expect(partial?.identityIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "incomplete", field: "chainId" }),
        expect.objectContaining({ kind: "inconsistent", field: "accountIndex" }),
      ]),
    );
    expect(conflict).toMatchObject({
      identitySource: "submission",
      identityComplete: true,
      identityConsistent: false,
      chainId: 1,
      nonce: 8,
    });
    expect(conflict?.identityIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "inconsistent", field: "chainId" }),
      ]),
    );
  });

  it("returns entries and groups in stable identity order with input order preserved inside ties", () => {
    const records = normalizeHistoryRecords([
      rawRecord({ txHash: "0xchain5-nonce2", chainId: 5, nonce: 2 }),
      rawRecord({ txHash: "0xchain1-nonce3", chainId: 1, nonce: 3 }),
      rawRecord({ txHash: "0xchain1-nonce1-a", chainId: 1, nonce: 1 }),
      rawRecord({ txHash: "0xchain1-nonce1-b", chainId: 1, nonce: 1 }),
    ]);

    expect(selectHistoryEntries(records).map((entry) => entry.txHash)).toEqual([
      "0xchain1-nonce1-a",
      "0xchain1-nonce1-b",
      "0xchain1-nonce3",
      "0xchain5-nonce2",
    ]);
    expect(groupHistoryByNonce(records).map((group) => group.submissions.map((entry) => entry.txHash))).toEqual([
      ["0xchain1-nonce1-a", "0xchain1-nonce1-b"],
      ["0xchain1-nonce3"],
      ["0xchain5-nonce2"],
    ]);
  });
});
