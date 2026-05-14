import { describe, expect, it, vi } from "vitest";
import { createDefaultQueuePolicy } from "./queueHistory";
import { summarizeCalldata } from "./queueRedaction";
import {
  rerunQueueFromFailedNonce,
  resumeStoppedQueueJob,
  retryFailedQueueJob,
  runQueueJob,
  type QueueBroadcaster,
  type QueueClock,
  type QueueSigner,
} from "./queueExecution";
import type { PreparedQueueTransactionDraft, QueueTransactionRecord } from "./queueTypes";

const baseDraft = {
  chainId: 1,
  to: "0x00000000000000000000000000000000000000AA",
  valueWei: "0",
  data: "0x64617461",
  gasLimit: "21000",
  fee: { mode: "eip1559", gasLimit: "21000", maxFeePerGasGwei: "30", maxPriorityFeePerGasGwei: "1.5" },
  actionType: "raw-calldata",
  preview: {
    title: "test",
    description: "test calldata",
    calldata: { selector: "0x64617461", byteLength: 4, summary: "0x64617461 - 4 bytes" },
  },
} satisfies Omit<PreparedQueueTransactionDraft, "id" | "accountId" | "accountAddress">;

function draft(id: string, accountId: string, accountAddress: string): PreparedQueueTransactionDraft {
  return { ...baseDraft, id, accountId, accountAddress };
}

function signer(): QueueSigner {
  return {
    signTransaction: vi.fn(async (_accountId, request) => `0xsigned-${request.nonce}-${request.from}`),
  };
}

function deterministicClock(): QueueClock & { sleeps: number[] } {
  let nowMs = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => nowMs,
    sleep: vi.fn(async (ms) => {
      sleeps.push(ms);
      nowMs += ms;
    }),
  };
}

function historicalTx(overrides: Partial<QueueTransactionRecord>): QueueTransactionRecord {
  return {
    id: "old-a1",
    jobId: "old-job",
    chainId: 1,
    accountId: "account-1",
    accountAddress: "0x0000000000000000000000000000000000000001",
    nonce: 10,
    status: "failed",
    actionType: "raw-calldata",
    target: "0x00000000000000000000000000000000000000AA",
    valueWei: "0",
    calldataSummary: { selector: "0x64617461", byteLength: 4, summary: "0x64617461 - 4 bytes" },
    feeSummary: { mode: "eip1559", gasLimit: "21000", maxFeePerGasGwei: "30", maxPriorityFeePerGasGwei: "1.5" },
    txHash: null,
    error: { category: "broadcast-failed", message: "RPC failed", retryable: true },
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    ...overrides,
  };
}

function historicalTxWithData(overrides: Partial<QueueTransactionRecord> & { data: string }): QueueTransactionRecord {
  const { data, ...recordOverrides } = overrides;
  return historicalTx({ ...recordOverrides, calldataSummary: summarizeCalldata(data) });
}

function broadcaster(overrides: Partial<QueueBroadcaster> = {}): QueueBroadcaster {
  return {
    validateChainId: vi.fn(async () => 1),
    getPendingNonce: vi.fn(async (account) => (account.endsWith("1") ? 10 : 20)),
    broadcastSignedTransaction: vi.fn(async (raw) => `0xhash-${raw}`),
    ...overrides,
  };
}

describe("queue execution engine", () => {
  it("assigns sequential nonces per account and runs different accounts through injected signer/broadcaster", async () => {
    const queueSigner = signer();
    const queueBroadcaster = broadcaster();
    const result = await runQueueJob({
      chainId: 1,
      title: "test queue",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("a2", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("b1", "account-2", "0x0000000000000000000000000000000000000002"),
      ],
      policy: createDefaultQueuePolicy(),
      signer: queueSigner,
      broadcaster: queueBroadcaster,
    });

    expect(result.job.status).toBe("completed");
    expect(result.transactions.map((tx) => [tx.accountId, tx.nonce, tx.status])).toEqual([
      ["account-1", 10, "pending"],
      ["account-1", 11, "pending"],
      ["account-2", 20, "pending"],
    ]);
    expect(JSON.stringify(result)).not.toContain("0xsigned");
  });

  it("passes the prepared fee draft to the signer request", async () => {
    const signedRequests: Array<{ fee?: PreparedQueueTransactionDraft["fee"] }> = [];
    const queueSigner: QueueSigner = {
      signTransaction: vi.fn(async (_accountId, request) => {
        signedRequests.push(request as typeof request & { fee?: PreparedQueueTransactionDraft["fee"] });
        return `0xsigned-${request.nonce}-${request.from}`;
      }),
    };

    await runQueueJob({
      chainId: 1,
      title: "fee request",
      sourceModule: "queue",
      drafts: [draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      policy: createDefaultQueuePolicy(),
      signer: queueSigner,
      broadcaster: broadcaster(),
    });

    expect(signedRequests[0].fee).toEqual(baseDraft.fee);
  });

  it("stores valid broadcaster transaction hashes in lowercase", async () => {
    const result = await runQueueJob({
      chainId: 1,
      title: "uppercase hash",
      sourceModule: "queue",
      drafts: [draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: broadcaster({
        broadcastSignedTransaction: vi.fn(async () => `0x${"A".repeat(64)}`),
      }),
    });

    expect(result.transactions[0].txHash).toBe(`0x${"a".repeat(64)}`);
  });

  it("rejects invalid queue policies before execution", async () => {
    const queueSigner = signer();
    const queueBroadcaster = broadcaster();
    await expect(
      runQueueJob({
        chainId: 1,
        title: "invalid policy",
        sourceModule: "queue",
        drafts: [draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
        policy: { ...createDefaultQueuePolicy(), concurrency: Number.NaN },
        signer: queueSigner,
        broadcaster: queueBroadcaster,
      }),
    ).rejects.toThrow(/invalid queue policy/i);

    expect(queueBroadcaster.validateChainId).not.toHaveBeenCalled();
    expect(queueSigner.signTransaction).not.toHaveBeenCalled();
  });

  it("blocks signing when chain validation mismatches", async () => {
    const queueSigner = signer();
    const result = await runQueueJob({
      chainId: 1,
      title: "wrong chain",
      sourceModule: "queue",
      drafts: [draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      policy: createDefaultQueuePolicy(),
      signer: queueSigner,
      broadcaster: broadcaster({ validateChainId: vi.fn(async () => 8453) }),
    });

    expect(result.job.status).toBe("failed");
    expect(result.transactions[0].status).toBe("failed");
    expect(result.transactions[0].error?.category).toBe("chain-mismatch");
    expect(queueSigner.signTransaction).not.toHaveBeenCalled();
  });

  it("records signing failures separately from broadcast failures", async () => {
    const queueSigner: QueueSigner = {
      signTransaction: vi.fn(async () => {
        throw new Error("password hunter2 raw request should be sanitized");
      }),
    };

    const result = await runQueueJob({
      chainId: 1,
      title: "signing failure",
      sourceModule: "queue",
      drafts: [draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      policy: createDefaultQueuePolicy(),
      signer: queueSigner,
      broadcaster: broadcaster(),
    });

    expect(result.transactions[0].status).toBe("failed");
    expect(result.transactions[0].error?.category).toBe("signing-failed");
    expect(result.transactions[0].error?.message).toContain("[redacted-password]");
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("stops later same-account nonces after a failed nonce while allowing other accounts to continue", async () => {
    const result = await runQueueJob({
      chainId: 1,
      title: "partial",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("a2", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("b1", "account-2", "0x0000000000000000000000000000000000000002"),
      ],
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: broadcaster({
        broadcastSignedTransaction: vi.fn(async (raw) => {
          if (raw.includes("10-")) throw new Error("https://rpc.example.com/key/secret-token failed");
          return `0xhash-${raw}`;
        }),
      }),
    });

    expect(result.job.status).toBe("partial");
    expect(result.transactions.map((tx) => [tx.accountId, tx.nonce, tx.status, tx.error?.category ?? null])).toEqual([
      ["account-1", 10, "failed", "broadcast-failed"],
      ["account-1", 11, "stopped", "user-stopped"],
      ["account-2", 20, "pending", null],
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("stops queued work when continueOnFailure is false", async () => {
    const result = await runQueueJob({
      chainId: 1,
      title: "stop on first failure",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("b1", "account-2", "0x0000000000000000000000000000000000000002"),
      ],
      policy: { ...createDefaultQueuePolicy(), concurrency: 1, continueOnFailure: false },
      signer: signer(),
      broadcaster: broadcaster({
        broadcastSignedTransaction: vi.fn(async (raw) => {
          if (raw.includes("10-")) throw new Error("first account failed");
          return `0xhash-${raw}`;
        }),
      }),
    });

    expect(result.transactions.map((tx) => [tx.accountId, tx.status, tx.error?.category ?? null])).toEqual([
      ["account-1", "failed", "broadcast-failed"],
      ["account-2", "stopped", "user-stopped"],
    ]);
  });

  it("honors stop signals before starting new broadcasts", async () => {
    let checks = 0;
    const result = await runQueueJob({
      chainId: 1,
      title: "stopped",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("a2", "account-1", "0x0000000000000000000000000000000000000001"),
      ],
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: broadcaster(),
      shouldStop: () => {
        checks += 1;
        return checks > 2;
      },
    });

    expect(result.transactions.map((tx) => [tx.nonce, tx.status, tx.error?.category ?? null])).toEqual([
      [10, "pending", null],
      [11, "stopped", "user-stopped"],
    ]);
  });

  it("stops the signed transaction before broadcast when a stop signal arrives after signing", async () => {
    let stopAfterSigning = false;
    const queueSigner: QueueSigner = {
      signTransaction: vi.fn(async (_accountId, request) => {
        stopAfterSigning = true;
        return `0xsigned-${request.nonce}-${request.from}`;
      }),
    };
    const queueBroadcaster = broadcaster();

    const result = await runQueueJob({
      chainId: 1,
      title: "stop after signing",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("a2", "account-1", "0x0000000000000000000000000000000000000001"),
      ],
      policy: createDefaultQueuePolicy(),
      signer: queueSigner,
      broadcaster: queueBroadcaster,
      shouldStop: () => stopAfterSigning,
    });

    expect(queueSigner.signTransaction).toHaveBeenCalledTimes(1);
    expect(queueBroadcaster.broadcastSignedTransaction).not.toHaveBeenCalled();
    expect(result.transactions.map((tx) => [tx.nonce, tx.status, tx.error?.category ?? null])).toEqual([
      [10, "stopped", "user-stopped"],
      [11, "stopped", "user-stopped"],
    ]);
    expect(JSON.stringify(result)).not.toContain("0xsigned");
  });

  it("limits active account lanes by concurrency", async () => {
    let activeSigners = 0;
    let maxActiveSigners = 0;
    const releases: Array<() => void> = [];
    const queueSigner: QueueSigner = {
      signTransaction: vi.fn(
        async (_accountId, request) =>
          new Promise<string>((resolve) => {
            activeSigners += 1;
            maxActiveSigners = Math.max(maxActiveSigners, activeSigners);
            releases.push(() => {
              activeSigners -= 1;
              resolve(`0xsigned-${request.nonce}-${request.from}`);
            });
          }),
      ),
    };

    const resultPromise = runQueueJob({
      chainId: 1,
      title: "concurrency",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("b1", "account-2", "0x0000000000000000000000000000000000000002"),
        draft("c1", "account-3", "0x0000000000000000000000000000000000000003"),
      ],
      policy: { ...createDefaultQueuePolicy(), concurrency: 2, rpcRequestsPerSecond: 100 },
      signer: queueSigner,
      broadcaster: broadcaster({ getPendingNonce: vi.fn(async () => 1) }),
    });

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(maxActiveSigners).toBe(2);
    releases.shift()?.();
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();

    const result = await resultPromise;
    expect(result.job.status).toBe("completed");
    expect(maxActiveSigners).toBe(2);
  });

  it("applies global RPC token bucket to chain validation, nonce reads, and broadcasts", async () => {
    const clock = deterministicClock();
    const queueBroadcaster = broadcaster();

    await runQueueJob({
      chainId: 1,
      title: "rate limited",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("a2", "account-1", "0x0000000000000000000000000000000000000001"),
      ],
      policy: { ...createDefaultQueuePolicy(), concurrency: 1, rpcRequestsPerSecond: 2 },
      signer: signer(),
      broadcaster: queueBroadcaster,
      clock,
    });

    expect(queueBroadcaster.validateChainId).toHaveBeenCalledTimes(1);
    expect(queueBroadcaster.getPendingNonce).toHaveBeenCalledTimes(1);
    expect(queueBroadcaster.broadcastSignedTransaction).toHaveBeenCalledTimes(2);
    expect(clock.sleeps).toContain(1000);
  });

  it("serializes RPC token waits so concurrent lanes cannot over-issue a one-per-second limit", async () => {
    const clock = deterministicClock();
    const rpcCalls: Array<[string, number]> = [];
    const queueBroadcaster = broadcaster({
      validateChainId: vi.fn(async () => {
        rpcCalls.push(["validate", clock.now()]);
        return 1;
      }),
      getPendingNonce: vi.fn(async (account) => {
        rpcCalls.push([`nonce-${account.slice(-1)}`, clock.now()]);
        return 1;
      }),
      broadcastSignedTransaction: vi.fn(async (raw) => {
        rpcCalls.push([`broadcast-${raw.slice(-42)}`, clock.now()]);
        return `0xhash-${raw}`;
      }),
    });

    await runQueueJob({
      chainId: 1,
      title: "concurrent rate limit",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("b1", "account-2", "0x0000000000000000000000000000000000000002"),
        draft("c1", "account-3", "0x0000000000000000000000000000000000000003"),
      ],
      policy: { ...createDefaultQueuePolicy(), concurrency: 3, rpcRequestsPerSecond: 1 },
      signer: signer(),
      broadcaster: queueBroadcaster,
      clock,
    });

    expect(rpcCalls).toHaveLength(7);
    expect(clock.sleeps).toEqual([1000, 1000, 1000, 1000, 1000, 1000]);
    expect(rpcCalls.map(([, at]) => at)).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000]);
  });

  it("allows slow RPC operations to overlap after their starts acquire available tokens", async () => {
    let activeNonceReads = 0;
    let maxActiveNonceReads = 0;
    let activeBroadcasts = 0;
    let maxActiveBroadcasts = 0;
    const nonceReleases: Array<() => void> = [];
    const broadcastReleases: Array<() => void> = [];
    const queueBroadcaster = broadcaster({
      validateChainId: vi.fn(async () => 1),
      getPendingNonce: vi.fn(
        async () =>
          new Promise<number>((resolve) => {
            activeNonceReads += 1;
            maxActiveNonceReads = Math.max(maxActiveNonceReads, activeNonceReads);
            nonceReleases.push(() => {
              activeNonceReads -= 1;
              resolve(10);
            });
          }),
      ),
      broadcastSignedTransaction: vi.fn(
        async () =>
          new Promise<string>((resolve) => {
            activeBroadcasts += 1;
            maxActiveBroadcasts = Math.max(maxActiveBroadcasts, activeBroadcasts);
            broadcastReleases.push(() => {
              activeBroadcasts -= 1;
              resolve(`0x${"1".repeat(64)}`);
            });
          }),
      ),
    });

    const resultPromise = runQueueJob({
      chainId: 1,
      title: "overlap rpc operations",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("b1", "account-2", "0x0000000000000000000000000000000000000002"),
        draft("c1", "account-3", "0x0000000000000000000000000000000000000003"),
      ],
      policy: { ...createDefaultQueuePolicy(), concurrency: 3, rpcRequestsPerSecond: 100 },
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    await vi
      .waitFor(() => expect(nonceReleases).toHaveLength(3), { timeout: 100 })
      .catch((error) => {
        nonceReleases.splice(0).forEach((release) => release());
        throw error;
      });
    expect(maxActiveNonceReads).toBe(3);
    nonceReleases.splice(0).forEach((release) => release());
    await vi
      .waitFor(() => expect(broadcastReleases).toHaveLength(3), { timeout: 100 })
      .catch((error) => {
        broadcastReleases.splice(0).forEach((release) => release());
        throw error;
      });
    expect(maxActiveBroadcasts).toBe(3);
    broadcastReleases.splice(0).forEach((release) => release());

    await expect(resultPromise).resolves.toMatchObject({ job: { status: "completed" } });
  });

  it("applies walletIntervalMs between same-account transaction starts only", async () => {
    const clock = deterministicClock();
    const signStarts: number[] = [];
    const queueSigner: QueueSigner = {
      signTransaction: vi.fn(async (_accountId, request) => {
        signStarts.push(clock.now());
        return `0xsigned-${request.nonce}-${request.from}`;
      }),
    };

    await runQueueJob({
      chainId: 1,
      title: "wallet interval",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("a2", "account-1", "0x0000000000000000000000000000000000000001"),
      ],
      policy: { ...createDefaultQueuePolicy(), concurrency: 1, walletIntervalMs: 250, rpcRequestsPerSecond: 100 },
      signer: queueSigner,
      broadcaster: broadcaster(),
      clock,
    });

    expect(signStarts).toEqual([0, 250]);
    expect(clock.sleeps).toContain(250);
  });

  it("cannot resume stopped durable history without current-tab prepared drafts", async () => {
    await expect(
      resumeStoppedQueueJob({
        chainId: 1,
        title: "resume",
        historyTransactions: [historicalTx({ id: "old-a2", nonce: 11, status: "stopped" })],
        sessionDraftsByTransactionId: new Map(),
        policy: createDefaultQueuePolicy(),
        signer: signer(),
        broadcaster: broadcaster(),
      }),
    ).rejects.toThrow(/current-tab prepared drafts/i);
  });

  it("rejects recovery when the current-tab draft does not match the history record", async () => {
    await expect(
      resumeStoppedQueueJob({
        chainId: 1,
        title: "resume mismatch",
        historyTransactions: [historicalTx({ id: "old-a2", nonce: 11, status: "stopped" })],
        sessionDraftsByTransactionId: new Map([
          ["old-a2", draft("wrong-account", "account-2", "0x0000000000000000000000000000000000000002")],
        ]),
        policy: createDefaultQueuePolicy(),
        signer: signer(),
        broadcaster: broadcaster(),
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it("resumes stopped transactions from current-tab drafts and refetches pending nonce", async () => {
    const queueBroadcaster = broadcaster({ getPendingNonce: vi.fn(async () => 42) });
    const result = await resumeStoppedQueueJob({
      chainId: 1,
      title: "resume",
      historyTransactions: [historicalTx({ id: "old-a2", nonce: 11, status: "stopped" })],
      sessionDraftsByTransactionId: new Map([
        ["old-a2", draft("a2", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    expect(queueBroadcaster.getPendingNonce).toHaveBeenCalledWith("0x0000000000000000000000000000000000000001");
    expect(result.transactions.map((tx) => [tx.nonce, tx.status])).toEqual([[42, "pending"]]);
  });

  it("resumes stopped transactions as linked replacement records and queues the stopped originals in history updates", async () => {
    const originalStopped = historicalTx({ id: "old-a2", nonce: 11, status: "stopped" });
    const queueBroadcaster = broadcaster({ getPendingNonce: vi.fn(async () => 42) });

    const result = await resumeStoppedQueueJob({
      chainId: 1,
      title: "resume linked",
      historyTransactions: [originalStopped],
      sessionDraftsByTransactionId: new Map([
        ["old-a2", draft("a2", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    expect(result.transactions.map((tx) => [tx.nonce, tx.status, tx.retryOfTransactionId])).toEqual([
      [42, "pending", "old-a2"],
    ]);
    expect(result.historyUpdates.map((tx) => [tx.id, tx.status, tx.error])).toEqual([["old-a2", "queued", null]]);
  });

  it("does not mark stopped originals queued when resume fails chain validation", async () => {
    const result = await resumeStoppedQueueJob({
      chainId: 1,
      title: "resume wrong chain",
      historyTransactions: [historicalTx({ id: "old-a2", nonce: 11, status: "stopped" })],
      sessionDraftsByTransactionId: new Map([
        ["old-a2", draft("a2", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: broadcaster({ validateChainId: vi.fn(async () => 8453) }),
    });

    expect(result.historyUpdates).toEqual([]);
    expect(result.transactions.map((tx) => [tx.retryOfTransactionId, tx.status, tx.error?.category])).toEqual([
      ["old-a2", "failed", "chain-mismatch"],
    ]);
  });

  it("marks only successfully resumed stopped originals as queued", async () => {
    const result = await resumeStoppedQueueJob({
      chainId: 1,
      title: "resume mixed",
      historyTransactions: [
        historicalTx({ id: "old-a1", nonce: 10, status: "stopped" }),
        historicalTx({ id: "old-a2", nonce: 11, status: "stopped" }),
      ],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-a2", draft("a2", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: broadcaster({
        broadcastSignedTransaction: vi.fn(async (raw) => {
          if (raw.includes("11-")) throw new Error("second resume failed");
          return `0x${"3".repeat(64)}`;
        }),
      }),
    });

    expect(result.transactions.map((tx) => [tx.retryOfTransactionId, tx.status, tx.error?.category ?? null])).toEqual([
      ["old-a1", "pending", null],
      ["old-a2", "failed", "broadcast-failed"],
    ]);
    expect(result.historyUpdates.map((tx) => [tx.id, tx.status])).toEqual([["old-a1", "queued"]]);
  });

  it("retries failed transactions in place when pending nonce still equals failed nonce", async () => {
    const queueBroadcaster = broadcaster({ getPendingNonce: vi.fn(async () => 10) });
    const result = await retryFailedQueueJob({
      chainId: 1,
      title: "retry same nonce",
      historyTransactions: [historicalTx({ id: "old-a1", nonce: 10, status: "failed" })],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    expect(result.historyUpdates).toEqual([]);
    expect(result.transactions[0].retryOfTransactionId).toBe("old-a1");
    expect(result.transactions[0].nonce).toBe(10);
    expect(result.transactions[0].status).toBe("pending");
  });

  it("records retry nonce preload failures per account without leaking RPC secrets", async () => {
    const result = await retryFailedQueueJob({
      chainId: 1,
      title: "retry nonce partial failure",
      historyTransactions: [
        historicalTx({
          id: "old-a1",
          accountId: "account-1",
          accountAddress: "0x0000000000000000000000000000000000000001",
          nonce: 10,
        }),
        historicalTx({
          id: "old-b1",
          accountId: "account-2",
          accountAddress: "0x0000000000000000000000000000000000000002",
          nonce: 20,
        }),
      ],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-b1", draft("b1", "account-2", "0x0000000000000000000000000000000000000002")],
      ]),
      policy: { ...createDefaultQueuePolicy(), concurrency: 2 },
      signer: signer(),
      broadcaster: broadcaster({
        getPendingNonce: vi.fn(async (account) => {
          if (account.endsWith("1")) throw new Error("https://rpc.example.com/key/secret-token nonce failed");
          return 20;
        }),
      }),
    });

    expect(result.transactions.map((tx) => [tx.retryOfTransactionId, tx.status, tx.error?.category ?? null])).toEqual([
      ["old-a1", "failed", "nonce-load-failed"],
      ["old-b1", "pending", null],
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("validates chain before retry recovery reads pending nonces", async () => {
    const queueSigner = signer();
    const queueBroadcaster = broadcaster({
      validateChainId: vi.fn(async () => 8453),
      getPendingNonce: vi.fn(async () => 10),
    });

    const result = await retryFailedQueueJob({
      chainId: 1,
      title: "retry wrong chain",
      historyTransactions: [historicalTx({ id: "old-a1", nonce: 10, status: "failed" })],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: queueSigner,
      broadcaster: queueBroadcaster,
    });

    expect(queueBroadcaster.validateChainId).toHaveBeenCalledTimes(1);
    expect(queueBroadcaster.getPendingNonce).not.toHaveBeenCalled();
    expect(queueSigner.signTransaction).not.toHaveBeenCalled();
    expect(result.transactions.map((tx) => [tx.retryOfTransactionId, tx.status, tx.error?.category])).toEqual([
      ["old-a1", "failed", "chain-mismatch"],
    ]);
  });

  it("rate limits retry recovery pending nonce preload as queue-owned RPC calls", async () => {
    const clock = deterministicClock();
    const nonceReads: Array<[string, number]> = [];
    const queueBroadcaster = broadcaster({
      validateChainId: vi.fn(async () => 1),
      getPendingNonce: vi.fn(async (account) => {
        nonceReads.push([account, clock.now()]);
        return account.endsWith("1") ? 10 : 20;
      }),
    });

    await retryFailedQueueJob({
      chainId: 1,
      title: "retry preload rate limit",
      historyTransactions: [
        historicalTx({
          id: "old-a1",
          accountId: "account-1",
          accountAddress: "0x0000000000000000000000000000000000000001",
          nonce: 10,
        }),
        historicalTx({
          id: "old-b1",
          accountId: "account-2",
          accountAddress: "0x0000000000000000000000000000000000000002",
          nonce: 20,
        }),
      ],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-b1", draft("b1", "account-2", "0x0000000000000000000000000000000000000002")],
      ]),
      policy: { ...createDefaultQueuePolicy(), concurrency: 2, rpcRequestsPerSecond: 1 },
      signer: signer(),
      broadcaster: queueBroadcaster,
      clock,
    });

    expect(queueBroadcaster.validateChainId).toHaveBeenCalledTimes(1);
    expect(nonceReads.map(([, at]) => at)).toEqual([1000, 2000]);
    expect(clock.sleeps).toContain(1000);
  });

  it("allows retry recovery nonce preload RPC operations to overlap after acquiring tokens", async () => {
    let activeNonceReads = 0;
    let maxActiveNonceReads = 0;
    const nonceReleases: Array<() => void> = [];
    const queueBroadcaster = broadcaster({
      validateChainId: vi.fn(async () => 1),
      getPendingNonce: vi.fn(
        async (account) =>
          new Promise<number>((resolve) => {
            activeNonceReads += 1;
            maxActiveNonceReads = Math.max(maxActiveNonceReads, activeNonceReads);
            nonceReleases.push(() => {
              activeNonceReads -= 1;
              resolve(account.endsWith("1") ? 10 : 20);
            });
          }),
      ),
    });

    const resultPromise = retryFailedQueueJob({
      chainId: 1,
      title: "retry overlapping nonce preload",
      historyTransactions: [
        historicalTx({
          id: "old-a1",
          accountId: "account-1",
          accountAddress: "0x0000000000000000000000000000000000000001",
          nonce: 10,
        }),
        historicalTx({
          id: "old-b1",
          accountId: "account-2",
          accountAddress: "0x0000000000000000000000000000000000000002",
          nonce: 20,
        }),
      ],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-b1", draft("b1", "account-2", "0x0000000000000000000000000000000000000002")],
      ]),
      policy: { ...createDefaultQueuePolicy(), concurrency: 2, rpcRequestsPerSecond: 100 },
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    await vi
      .waitFor(() => expect(nonceReleases).toHaveLength(2), { timeout: 100 })
      .catch((error) => {
        nonceReleases.splice(0).forEach((release) => release());
        throw error;
      });
    expect(maxActiveNonceReads).toBe(2);
    nonceReleases.splice(0).forEach((release) => release());

    const result = await resultPromise;
    expect(result.transactions.map((tx) => [tx.retryOfTransactionId, tx.status])).toEqual([
      ["old-a1", "pending"],
      ["old-b1", "pending"],
    ]);
  });

  it("shares one retry recovery token bucket across validation, nonce preload, and broadcast starts", async () => {
    const clock = deterministicClock();
    const rpcCalls: Array<[string, number]> = [];
    const queueBroadcaster = broadcaster({
      validateChainId: vi.fn(async () => {
        rpcCalls.push(["validate", clock.now()]);
        return 1;
      }),
      getPendingNonce: vi.fn(async () => {
        rpcCalls.push(["nonce", clock.now()]);
        return 10;
      }),
      broadcastSignedTransaction: vi.fn(async () => {
        rpcCalls.push(["broadcast", clock.now()]);
        return `0x${"2".repeat(64)}`;
      }),
    });

    const result = await retryFailedQueueJob({
      chainId: 1,
      title: "retry shared bucket",
      historyTransactions: [historicalTx({ id: "old-a1", nonce: 10, status: "failed" })],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: { ...createDefaultQueuePolicy(), rpcRequestsPerSecond: 1 },
      signer: signer(),
      broadcaster: queueBroadcaster,
      clock,
    });

    expect(result.transactions[0].status).toBe("pending");
    expect(rpcCalls).toEqual([
      ["validate", 0],
      ["nonce", 1000],
      ["broadcast", 2000],
    ]);
  });

  it("does not retry duplicate failed records for the same account nonce by assigning a later nonce", async () => {
    const signedRequests: Array<{ data: string; nonce: number }> = [];
    const queueSigner: QueueSigner = {
      signTransaction: vi.fn(async (_accountId, request) => {
        signedRequests.push({ data: request.data, nonce: request.nonce });
        return `0xsigned-${request.nonce}-${request.data}`;
      }),
    };

    const result = await retryFailedQueueJob({
      chainId: 1,
      title: "retry duplicate nonce",
      historyTransactions: [
        historicalTxWithData({ id: "old-a10-primary", nonce: 10, status: "failed", data: "0xaaaa" }),
        historicalTxWithData({ id: "old-a10-duplicate", nonce: 10, status: "failed", data: "0xbbbb" }),
      ],
      sessionDraftsByTransactionId: new Map([
        [
          "old-a10-primary",
          { ...draft("a10-primary", "account-1", "0x0000000000000000000000000000000000000001"), data: "0xaaaa" },
        ],
        [
          "old-a10-duplicate",
          { ...draft("a10-duplicate", "account-1", "0x0000000000000000000000000000000000000001"), data: "0xbbbb" },
        ],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: queueSigner,
      broadcaster: broadcaster({ getPendingNonce: vi.fn(async () => 10) }),
    });

    expect(signedRequests).toEqual([{ data: "0xaaaa", nonce: 10 }]);
    expect(result.transactions.map((tx) => [tx.retryOfTransactionId, tx.nonce, tx.status])).toEqual([
      ["old-a10-primary", 10, "pending"],
    ]);
    expect(result.historyUpdates).toEqual([]);
  });

  it("requires current-tab drafts before marking stale retry records nonce-consumed", async () => {
    await expect(
      retryFailedQueueJob({
        chainId: 1,
        title: "retry stale missing draft",
        historyTransactions: [historicalTx({ id: "old-a1", nonce: 10, status: "failed" })],
        sessionDraftsByTransactionId: new Map(),
        policy: createDefaultQueuePolicy(),
        signer: signer(),
        broadcaster: broadcaster({ getPendingNonce: vi.fn(async () => 43) }),
      }),
    ).rejects.toThrow(/current-tab prepared drafts/i);
  });

  it("marks stale failed retry nonces as consumed instead of replaying them at a fresh pending nonce", async () => {
    const queueBroadcaster = broadcaster({ getPendingNonce: vi.fn(async () => 43) });
    const result = await retryFailedQueueJob({
      chainId: 1,
      title: "retry",
      historyTransactions: [historicalTx({ id: "old-a1", nonce: 10, status: "failed" })],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    expect(result.historyUpdates.map((tx) => [tx.id, tx.status, tx.error?.category])).toEqual([
      ["old-a1", "skipped", "nonce-consumed"],
    ]);
    expect(result.transactions).toEqual([]);
  });

  it("marks nonce-consumed retry history per original retry pair instead of using the global minimum nonce", async () => {
    const oldA1 = historicalTx({
      id: "old-a1",
      accountId: "account-1",
      accountAddress: "0x0000000000000000000000000000000000000001",
      nonce: 10,
      status: "failed",
    });
    const oldB1 = historicalTx({
      id: "old-b1",
      accountId: "account-2",
      accountAddress: "0x0000000000000000000000000000000000000002",
      nonce: 50,
      status: "failed",
    });
    const queueBroadcaster = broadcaster({
      getPendingNonce: vi.fn(async (account) => (account.endsWith("1") ? 43 : 50)),
    });

    const result = await retryFailedQueueJob({
      chainId: 1,
      title: "retry per pair",
      historyTransactions: [oldA1, oldB1],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-b1", draft("b1", "account-2", "0x0000000000000000000000000000000000000002")],
      ]),
      policy: { ...createDefaultQueuePolicy(), concurrency: 2 },
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    expect(result.transactions.map((tx) => [tx.retryOfTransactionId, tx.nonce, tx.status])).toEqual([
      ["old-b1", 50, "pending"],
    ]);
    expect(result.historyUpdates.map((tx) => [tx.id, tx.status, tx.error?.category])).toEqual([
      ["old-a1", "skipped", "nonce-consumed"],
    ]);
  });

  it("does not replay stale same-account failed drafts at the refreshed pending nonce", async () => {
    const oldNonce10 = historicalTxWithData({ id: "old-a10", nonce: 10, status: "failed", data: "0x1010" });
    const oldNonce11 = historicalTxWithData({ id: "old-a11", nonce: 11, status: "failed", data: "0x1111" });
    const signedRequests: Array<{ data: string; nonce: number }> = [];
    const queueSigner: QueueSigner = {
      signTransaction: vi.fn(async (_accountId, request) => {
        signedRequests.push({ data: request.data, nonce: request.nonce });
        return `0xsigned-${request.nonce}-${request.data}`;
      }),
    };

    const result = await retryFailedQueueJob({
      chainId: 1,
      title: "retry same account stale nonce",
      historyTransactions: [oldNonce10, oldNonce11],
      sessionDraftsByTransactionId: new Map([
        ["old-a10", { ...draft("a10", "account-1", "0x0000000000000000000000000000000000000001"), data: "0x1010" }],
        ["old-a11", { ...draft("a11", "account-1", "0x0000000000000000000000000000000000000001"), data: "0x1111" }],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: queueSigner,
      broadcaster: broadcaster({ getPendingNonce: vi.fn(async () => 11) }),
    });

    expect(signedRequests).toEqual([{ data: "0x1111", nonce: 11 }]);
    expect(result.historyUpdates.map((tx) => [tx.id, tx.status, tx.error?.category])).toEqual([
      ["old-a10", "skipped", "nonce-consumed"],
    ]);
    expect(result.transactions.map((tx) => [tx.retryOfTransactionId, tx.nonce, tx.status])).toEqual([
      ["old-a11", 11, "pending"],
    ]);
  });

  it("does not move a retry-safe failed draft when a later nonce read advances before execution", async () => {
    const signedRequests: Array<{ data: string; nonce: number }> = [];
    const queueSigner: QueueSigner = {
      signTransaction: vi.fn(async (_accountId, request) => {
        signedRequests.push({ data: request.data, nonce: request.nonce });
        return `0xsigned-${request.nonce}-${request.data}`;
      }),
    };
    let nonceReads = 0;

    const result = await retryFailedQueueJob({
      chainId: 1,
      title: "retry stable pending nonce",
      historyTransactions: [historicalTxWithData({ id: "old-a11", nonce: 11, status: "failed", data: "0x1111" })],
      sessionDraftsByTransactionId: new Map([
        ["old-a11", { ...draft("a11", "account-1", "0x0000000000000000000000000000000000000001"), data: "0x1111" }],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: queueSigner,
      broadcaster: broadcaster({
        getPendingNonce: vi.fn(async () => {
          nonceReads += 1;
          return nonceReads === 1 ? 11 : 12;
        }),
      }),
    });

    expect(signedRequests).toEqual([{ data: "0x1111", nonce: 11 }]);
    expect(result.transactions.map((tx) => [tx.retryOfTransactionId, tx.nonce, tx.status])).toEqual([
      ["old-a11", 11, "pending"],
    ]);
  });

  it("reruns from the first failed nonce and skips later stale history records", async () => {
    const oldFailed = historicalTx({ id: "old-a1", nonce: 10, status: "failed" });
    const oldStopped = historicalTx({ id: "old-a2", nonce: 11, status: "stopped" });
    const queueBroadcaster = broadcaster({ getPendingNonce: vi.fn(async () => 50) });

    const result = await rerunQueueFromFailedNonce({
      chainId: 1,
      title: "rerun",
      historyTransactions: [
        oldFailed,
        oldStopped,
        historicalTx({ id: "old-b1", accountId: "account-2", nonce: 7, status: "pending" }),
      ],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-a2", draft("a2", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    expect(result.historyUpdates.map((tx) => [tx.id, tx.status, tx.error?.category])).toEqual([
      ["old-a1", "skipped", "nonce-consumed"],
      ["old-a2", "skipped", "nonce-consumed"],
    ]);
    expect(result.transactions.map((tx) => [tx.accountId, tx.nonce, tx.status, tx.retryOfTransactionId])).toEqual([
      ["account-1", 50, "pending", "old-a1"],
      ["account-1", 51, "pending", "old-a2"],
    ]);
    expect(result.transactions.map((tx) => tx.id)).not.toContain("old-a1");
    expect(result.transactions.map((tx) => tx.id)).not.toContain("old-a2");
  });

  it("does not mark rerun source records consumed when replacement broadcast fails", async () => {
    const result = await rerunQueueFromFailedNonce({
      chainId: 1,
      title: "rerun failed replacement",
      historyTransactions: [historicalTx({ id: "old-a1", nonce: 10, status: "failed" })],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: broadcaster({
        getPendingNonce: vi.fn(async () => 50),
        broadcastSignedTransaction: vi.fn(async () => {
          throw new Error("replacement failed");
        }),
      }),
    });

    expect(result.historyUpdates).toEqual([]);
    expect(result.transactions.map((tx) => [tx.retryOfTransactionId, tx.status, tx.error?.category])).toEqual([
      ["old-a1", "failed", "broadcast-failed"],
    ]);
  });

  it("rerun from failed nonce preserves pending same-account records while skipping failed queued and stopped records", async () => {
    const oldFailed = historicalTx({ id: "old-a1", nonce: 10, status: "failed" });
    const oldPending = historicalTx({ id: "old-a2", nonce: 11, status: "pending", error: null });
    const oldQueued = historicalTx({ id: "old-a3", nonce: 12, status: "queued", error: null });
    const oldStopped = historicalTx({ id: "old-a4", nonce: 13, status: "stopped" });
    const queueBroadcaster = broadcaster({ getPendingNonce: vi.fn(async () => 50) });

    const result = await rerunQueueFromFailedNonce({
      chainId: 1,
      title: "rerun preserving pending",
      historyTransactions: [oldFailed, oldPending, oldQueued, oldStopped],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-a3", draft("a3", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-a4", draft("a4", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    expect(result.historyUpdates.map((tx) => [tx.id, tx.status, tx.error?.category])).toEqual([
      ["old-a1", "skipped", "nonce-consumed"],
      ["old-a3", "skipped", "nonce-consumed"],
      ["old-a4", "skipped", "nonce-consumed"],
    ]);
    expect(result.historyUpdates.map((tx) => tx.id)).not.toContain("old-a2");
    expect(result.transactions.map((tx) => [tx.retryOfTransactionId, tx.nonce, tx.status])).toEqual([
      ["old-a1", 50, "pending"],
      ["old-a3", 51, "pending"],
      ["old-a4", 52, "pending"],
    ]);
  });

  it("reruns the targeted failed account even when another account has a lower failed nonce", async () => {
    const oldAFailed = historicalTx({
      id: "old-a10",
      accountId: "account-1",
      accountAddress: "0x0000000000000000000000000000000000000001",
      nonce: 10,
      status: "failed",
    });
    const oldAStopped = historicalTx({
      id: "old-a11",
      accountId: "account-1",
      accountAddress: "0x0000000000000000000000000000000000000001",
      nonce: 11,
      status: "stopped",
    });
    const oldBFailed = historicalTx({
      id: "old-b5",
      accountId: "account-2",
      accountAddress: "0x0000000000000000000000000000000000000002",
      nonce: 5,
      status: "failed",
    });

    const result = await rerunQueueFromFailedNonce({
      chainId: 1,
      title: "rerun targeted account",
      historyTransactions: [oldAFailed, oldAStopped, oldBFailed],
      sessionDraftsByTransactionId: new Map([
        ["old-a10", draft("a10", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-a11", draft("a11", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-b5", draft("b5", "account-2", "0x0000000000000000000000000000000000000002")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: broadcaster({ getPendingNonce: vi.fn(async (account) => (account.endsWith("1") ? 40 : 20)) }),
      targetTransactionId: "old-a10",
    });

    expect(result.historyUpdates.map((tx) => [tx.id, tx.status, tx.error?.category])).toEqual([
      ["old-a10", "skipped", "nonce-consumed"],
      ["old-a11", "skipped", "nonce-consumed"],
    ]);
    expect(result.transactions.map((tx) => [tx.accountId, tx.retryOfTransactionId, tx.nonce, tx.status])).toEqual([
      ["account-1", "old-a10", 40, "pending"],
      ["account-1", "old-a11", 41, "pending"],
    ]);
  });

  it("reruns from the first failed nonce without an explicit target when failures are scoped to one account", async () => {
    const oldFailed10 = historicalTx({ id: "old-a10", nonce: 10, status: "failed" });
    const oldFailed11 = historicalTx({ id: "old-a11", nonce: 11, status: "failed" });
    const oldStopped12 = historicalTx({ id: "old-a12", nonce: 12, status: "stopped" });

    const result = await rerunQueueFromFailedNonce({
      chainId: 1,
      title: "rerun unambiguous account",
      historyTransactions: [oldFailed10, oldFailed11, oldStopped12],
      sessionDraftsByTransactionId: new Map([
        ["old-a10", draft("a10", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-a11", draft("a11", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-a12", draft("a12", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: broadcaster({ getPendingNonce: vi.fn(async () => 30) }),
    });

    expect(result.historyUpdates.map((tx) => [tx.id, tx.status, tx.error?.category])).toEqual([
      ["old-a10", "skipped", "nonce-consumed"],
      ["old-a11", "skipped", "nonce-consumed"],
      ["old-a12", "skipped", "nonce-consumed"],
    ]);
    expect(result.transactions.map((tx) => [tx.retryOfTransactionId, tx.nonce, tx.status])).toEqual([
      ["old-a10", 30, "pending"],
      ["old-a11", 31, "pending"],
      ["old-a12", 32, "pending"],
    ]);
  });
});
