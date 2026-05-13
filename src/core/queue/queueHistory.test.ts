import { describe, expect, it } from "vitest";
import {
  appendQueueHistoryRecords,
  createDefaultQueueHistoryState,
  createDefaultQueuePolicy,
  exportRedactedQueueHistory,
  validateQueueHistoryState,
} from "./queueHistory";
import type { QueueHistoryState, QueueTransactionRecord } from "./queueTypes";

function tx(overrides: Partial<QueueTransactionRecord> = {}): QueueTransactionRecord {
  return {
    id: "tx-1",
    jobId: "job-1",
    chainId: 1,
    accountId: "account-1",
    accountAddress: "0x0000000000000000000000000000000000000001",
    nonce: 7,
    status: "pending",
    actionType: "raw-calldata",
    target: "0x0000000000000000000000000000000000000002",
    valueWei: "0",
    calldataSummary: { selector: "0x64617461", byteLength: 16, summary: "0x64617461 · 16 bytes" },
    feeSummary: { mode: "eip1559", gasLimit: "21000", maxFeePerGasGwei: "30", maxPriorityFeePerGasGwei: "1.5" },
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    error: null,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("queue history model", () => {
  it("uses safe defaults for queue policy", () => {
    expect(createDefaultQueuePolicy()).toEqual({
      concurrency: 20,
      continueOnFailure: true,
      rerunFromFailedNonce: true,
      rpcRequestsPerSecond: 20,
      walletIntervalMs: 0,
    });
  });

  it("appends redacted transaction records without persisting raw signed material", () => {
    const state = appendQueueHistoryRecords(createDefaultQueueHistoryState(), {
      jobs: [
        {
          id: "job-1",
          chainId: 1,
          title: "测试任务",
          sourceModule: "queue",
          status: "partial",
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z",
          executionPolicy: createDefaultQueuePolicy(),
          transactionIds: ["tx-1"],
          summary: { total: 1, pending: 1, failed: 0, stopped: 0, completed: 0 },
        },
      ],
      transactions: [
        tx({
          error: {
            category: "broadcast-failed",
            message:
              "failed at https://rpc.example.com/key/secret?apiKey=abc raw 0xf86c808504a817c80082520894aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            retryable: true,
          },
        }),
      ],
    });

    const serialized = JSON.stringify(state);
    expect(serialized).toContain("[redacted-url]");
    expect(serialized).not.toContain("rpc.example.com");
    expect(serialized).not.toContain("/key/secret");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("f86c8085");
    expect(validateQueueHistoryState(state).transactions).toHaveLength(1);
  });

  it("exports redacted JSON only", () => {
    const state = appendQueueHistoryRecords(createDefaultQueueHistoryState(), {
      jobs: [],
      transactions: [
        tx({
          error: {
            category: "signing-failed",
            message: "private key 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            retryable: false,
          },
        }),
      ],
    });

    const exported = exportRedactedQueueHistory(state);

    expect(exported).toContain("signing-failed");
    expect(exported).toContain("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(exported).not.toContain("private key");
    expect(exported).not.toContain("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  });

  it("rejects unsafe id and accountId fields before export", () => {
    const unsafeState = {
      ...createDefaultQueueHistoryState(),
      jobs: [
        {
          id: "job-1 private-key",
          chainId: 1,
          title: "safe title",
          sourceModule: "queue",
          status: "queued",
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z",
          executionPolicy: createDefaultQueuePolicy(),
          transactionIds: ["tx-1"],
          summary: { total: 1, pending: 1, failed: 0, stopped: 0, completed: 0 },
        },
      ],
      transactions: [tx({ accountId: "account-1 secret-token" })],
    };

    expect(() => validateQueueHistoryState(unsafeState)).toThrow("Invalid queue history state.");
    expect(() => exportRedactedQueueHistory(unsafeState as unknown as QueueHistoryState)).toThrow("Invalid queue history state.");
  });

  it("rejects unsafe transaction ids and fee strings before export", () => {
    const unsafeState = {
      ...createDefaultQueueHistoryState(),
      jobs: [
        {
          id: "job-1",
          chainId: 1,
          title: "safe title",
          sourceModule: "queue",
          status: "queued",
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z",
          executionPolicy: createDefaultQueuePolicy(),
          transactionIds: ["tx-1 secret-token"],
          summary: { total: 1, pending: 1, failed: 0, stopped: 0, completed: 0 },
        },
      ],
      transactions: [tx({ feeSummary: { mode: "eip1559", gasLimit: "21000 secret", maxFeePerGasGwei: "1e9", maxPriorityFeePerGasGwei: "1.5" } })],
    };

    expect(() => validateQueueHistoryState(unsafeState)).toThrow("Invalid queue history state.");
    expect(() => exportRedactedQueueHistory(unsafeState as unknown as QueueHistoryState)).toThrow("Invalid queue history state.");
  });

  it("rejects unsafe valueWei strings and malformed targets with the canonical error", () => {
    expect(() =>
      validateQueueHistoryState({
        ...createDefaultQueueHistoryState(),
        jobs: [],
        transactions: [tx({ valueWei: "1000 secret-token" })],
      }),
    ).toThrow("Invalid queue history state.");

    expect(() =>
      validateQueueHistoryState({
        ...createDefaultQueueHistoryState(),
        jobs: [],
        transactions: [tx({ target: 123 as unknown as string })],
      }),
    ).toThrow("Invalid queue history state.");
  });
});
