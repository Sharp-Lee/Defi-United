import { describe, expect, it } from "vitest";
import type {
  ExternalAddressReference,
  LocalAccountReference,
  OrchestrationDraft,
} from "../accountOrchestration/selection";
import type { PendingNonceHistoryRecord } from "../history/reconciler";
import {
  DEFAULT_NATIVE_DISTRIBUTION_CONTRACT,
  DISPERSE_ETHER_SELECTOR,
  buildNativeBatchPlan,
  freezeNativeBatchPlan,
  isFrozenNativeBatchPlanValid,
} from "./nativeBatch";

const accountA = "0x1111111111111111111111111111111111111111";
const accountB = "0x2222222222222222222222222222222222222222";
const accountC = "0x3333333333333333333333333333333333333333";
const external = "0x4444444444444444444444444444444444444444";

function local(index: number, address: string): LocalAccountReference {
  return {
    kind: "localAccount",
    accountIndex: index,
    address,
    label: `Account ${index}`,
    chainSnapshotStatus: {
      chainId: 1,
      nativeBalance: "present",
      nonce: "present",
      lastSyncError: null,
    },
  };
}

function externalTarget(address = external): ExternalAddressReference {
  return {
    kind: "externalAddress",
    address,
    label: "External",
    notes: null,
  };
}

function draft(overrides: Partial<OrchestrationDraft> = {}): OrchestrationDraft {
  return {
    chainId: 1,
    sourceAccounts: [local(0, accountA)],
    localTargets: [local(1, accountB)],
    externalTargets: [],
    previews: [],
    createdAt: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

const fees = {
  gasLimit: "21000",
  maxFeePerGas: "100",
  maxPriorityFeePerGas: "2",
};

function pendingNonce(
  accountIndex: number,
  chainId: number,
  from: string,
  nonce: number,
): PendingNonceHistoryRecord {
  return {
    intent: {
      account_index: accountIndex,
      chain_id: chainId,
      from,
      nonce,
    },
    outcome: {
      state: "Pending",
    },
  };
}

describe("native batch planning", () => {
  it("builds single-source distribution as one contract parent with recipient allocation rows", () => {
    const plan = buildNativeBatchPlan({
      batchKind: "distribute",
      chainId: 1,
      orchestration: draft({
        localTargets: [local(1, accountB)],
        externalTargets: [externalTarget()],
      }),
      accountSnapshots: [{ address: accountA, nativeBalanceWei: 10_000_000n, nonce: 7 }],
      amountWei: "1000",
      fees,
      batchId: "batch-a",
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    expect(plan.status).toBe("ready");
    expect(plan.distributionParent).toMatchObject({
      distributionContract: DEFAULT_NATIVE_DISTRIBUTION_CONTRACT,
      selector: DISPERSE_ETHER_SELECTOR,
      methodName: "disperseEther(address[],uint256[])",
      totalValueWei: "2000",
      nonce: 7,
      gasLimit: "21000",
    });
    expect(plan.distributionParent?.recipients.map((recipient) => recipient.targetAddress)).toEqual([
      accountB,
      external,
    ]);
    expect(plan.children).toHaveLength(2);
    expect(plan.children.map((child) => child.nonce)).toEqual([null, null]);
    expect(plan.children.map((child) => child.status)).toEqual(["notSubmitted", "notSubmitted"]);
    expect(plan.children[0].target.kind).toBe("localAccount");
    expect(plan.children[1].target.kind).toBe("externalAddress");
    expect(plan.summary.totalPlannedAmountWei).toBe("2000");
    expect(plan.summary.maxGasCostWei).toBe("2100000");
  });

  it("collects many local sources into one target after reserving maximum gas", () => {
    const plan = buildNativeBatchPlan({
      batchKind: "collect",
      chainId: 1,
      orchestration: draft({
        sourceAccounts: [local(0, accountA), local(1, accountB), local(2, accountC)],
        localTargets: [],
        externalTargets: [externalTarget()],
      }),
      accountSnapshots: [
        { address: accountA, nativeBalanceWei: 5_000_000n, nonce: 3 },
        { address: accountB, nativeBalanceWei: 2_100_000n, nonce: 9 },
        { address: accountC, nativeBalanceWei: 2_099_999n, nonce: 11 },
      ],
      amountWei: "0",
      fees,
      batchId: "batch-collect",
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    expect(plan.status).toBe("ready");
    expect(plan.children.map((child) => child.amountWei)).toEqual(["2900000", "0", "0"]);
    expect(plan.children.map((child) => child.status)).toEqual([
      "notSubmitted",
      "skipped",
      "skipped",
    ]);
    expect(plan.children[1].warnings[0]).toMatch(/gas reserve/);
    expect(plan.summary.plannedCount).toBe(1);
    expect(plan.summary.skippedCount).toBe(2);
  });

  it("reserves distribution parent nonce past local pending history", () => {
    const plan = buildNativeBatchPlan({
      batchKind: "distribute",
      chainId: 1,
      orchestration: draft({
        localTargets: [local(1, accountB)],
        externalTargets: [externalTarget()],
      }),
      accountSnapshots: [{ address: accountA, nativeBalanceWei: 10_000_000n, nonce: 7 }],
      localPendingHistory: [
        pendingNonce(0, 1, accountA, 9),
        pendingNonce(1, 1, accountB, 25),
        pendingNonce(0, 2, accountA, 30),
      ],
      amountWei: "1000",
      fees,
      batchId: "batch-pending-distribution",
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    expect(plan.status).toBe("ready");
    expect(plan.distributionParent?.nonce).toBe(10);
    expect(plan.children.map((child) => child.nonce)).toEqual([null, null]);
  });

  it("reserves collection child nonces past local pending history per source", () => {
    const plan = buildNativeBatchPlan({
      batchKind: "collect",
      chainId: 1,
      orchestration: draft({
        sourceAccounts: [local(0, accountA), local(1, accountB), local(2, accountC)],
        localTargets: [],
        externalTargets: [externalTarget()],
      }),
      accountSnapshots: [
        { address: accountA, nativeBalanceWei: 5_000_000n, nonce: 3 },
        { address: accountB, nativeBalanceWei: 5_000_000n, nonce: 9 },
        { address: accountC, nativeBalanceWei: 5_000_000n, nonce: 11 },
      ],
      localPendingHistory: [
        pendingNonce(0, 1, accountA, 5),
        pendingNonce(1, 1, accountB.toUpperCase(), 12),
        pendingNonce(2, 1, accountC, 10),
      ],
      amountWei: "0",
      fees,
      batchId: "batch-pending-collect",
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    expect(plan.status).toBe("ready");
    expect(plan.children.map((child) => child.nonce)).toEqual([6, 13, 11]);
  });

  it("blocks many-source many-target distribution in the minimal shape", () => {
    const plan = buildNativeBatchPlan({
      batchKind: "distribute",
      chainId: 1,
      orchestration: draft({
        sourceAccounts: [local(0, accountA), local(1, accountB)],
        localTargets: [local(2, accountC)],
        externalTargets: [externalTarget()],
      }),
      accountSnapshots: [
        { address: accountA, nativeBalanceWei: 10_000_000n, nonce: 1 },
        { address: accountB, nativeBalanceWei: 10_000_000n, nonce: 5 },
      ],
      amountWei: "1000",
      fees,
      batchId: "batch-blocked",
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    expect(plan.status).toBe("blocked");
    expect(plan.children).toHaveLength(0);
    expect(plan.errors.join(" ")).toMatch(/multiple sources/);
  });

  it("invalidates a freeze when contract distribution amount, gas, target order, or contract address changes", () => {
    const base = {
      batchKind: "distribute" as const,
      chainId: 1,
      orchestration: draft({
        localTargets: [local(1, accountB)],
        externalTargets: [externalTarget()],
      }),
      accountSnapshots: [{ address: accountA, nativeBalanceWei: 10_000_000n, nonce: 7 }],
      amountWei: "1000",
      fees,
      batchId: "batch-freeze",
      createdAt: "2026-04-28T00:00:00.000Z",
    };
    const frozen = freezeNativeBatchPlan(buildNativeBatchPlan(base), "2026-04-28T01:00:00.000Z");

    expect(isFrozenNativeBatchPlanValid(frozen, buildNativeBatchPlan(base))).toBe(true);
    expect(
      isFrozenNativeBatchPlanValid(
        frozen,
        buildNativeBatchPlan({ ...base, amountWei: "1001" }),
      ),
    ).toBe(false);
    expect(
      isFrozenNativeBatchPlanValid(
        frozen,
        buildNativeBatchPlan({
          ...base,
          fees: { ...fees, gasLimit: "22000" },
        }),
      ),
    ).toBe(false);
    expect(
      isFrozenNativeBatchPlanValid(
        frozen,
        buildNativeBatchPlan({
          ...base,
          orchestration: draft({
            localTargets: [],
            externalTargets: [externalTarget(), externalTarget(accountC)],
          }),
        }),
      ),
    ).toBe(false);
    const changedContract = buildNativeBatchPlan(base);
    changedContract.distributionParent!.distributionContract =
      "0x0000000000000000000000000000000000000001";
    expect(isFrozenNativeBatchPlanValid(frozen, changedContract)).toBe(false);
  });
});
