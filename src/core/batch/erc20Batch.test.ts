import { describe, expect, it } from "vitest";
import type {
  ExternalAddressReference,
  LocalAccountReference,
  OrchestrationDraft,
} from "../accountOrchestration/selection";
import type { PendingNonceHistoryRecord } from "../history/reconciler";
import type { TokenWatchlistState } from "../../lib/tauri";
import {
  DEFAULT_ERC20_DISTRIBUTION_CONTRACT,
  DISPERSE_TOKEN_METHOD,
  DISPERSE_TOKEN_SELECTOR,
  buildErc20BatchPlan,
  erc20BatchTargetAmountKey,
  freezeErc20BatchPlan,
  isFrozenErc20BatchPlanValid,
} from "./erc20Batch";

const accountA = "0x1111111111111111111111111111111111111111";
const accountB = "0x2222222222222222222222222222222222222222";
const accountC = "0x3333333333333333333333333333333333333333";
const external = "0x4444444444444444444444444444444444444444";
const token = "0x5555555555555555555555555555555555555555";

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

function tokenState(overrides: Partial<TokenWatchlistState> = {}): TokenWatchlistState {
  return {
    schemaVersion: 1,
    watchlistTokens: [],
    tokenMetadataCache: [],
    tokenScanState: [],
    resolvedTokenMetadata: [
      {
        chainId: 1,
        tokenContract: token,
        decimals: 6,
        symbol: "TST",
        name: "Test Token",
        source: "onChainCall",
        status: "ok",
        updatedAt: "2026-04-28T00:00:00.000Z",
      },
    ],
    erc20BalanceSnapshots: [
      {
        account: accountA,
        chainId: 1,
        tokenContract: token,
        balanceRaw: "10000",
        balanceStatus: "ok",
        createdAt: "2026-04-28T00:00:00.000Z",
        updatedAt: "2026-04-28T00:00:00.000Z",
        resolvedMetadata: {
          decimals: 6,
          symbol: "TST",
          name: "Test Token",
          source: "onChainCall",
          status: "ok",
        },
      },
    ],
    ...overrides,
  };
}

const fees = {
  gasLimit: "60000",
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

describe("ERC-20 batch planning", () => {
  it("builds single-source distribution as one Disperse token parent with allocation rows", () => {
    const localTarget = local(1, accountB);
    const extTarget = externalTarget();
    const plan = buildErc20BatchPlan({
      batchKind: "distribute",
      chainId: 1,
      orchestration: draft({ localTargets: [localTarget], externalTargets: [extTarget] }),
      accountSnapshots: [{ address: accountA, nativeBalanceWei: 10_000_000n, nonce: 7 }],
      tokenWatchlistState: tokenState(),
      tokenContract: token,
      distributionAmountsRaw: {
        [erc20BatchTargetAmountKey(localTarget)]: "1000",
        [erc20BatchTargetAmountKey(extTarget)]: "2000",
      },
      allowance: { status: "ok", allowanceRaw: "3000" },
      fees,
      batchId: "erc20-batch-a",
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    expect(plan.status).toBe("ready");
    expect(plan.distributionParent).toMatchObject({
      distributionContract: DEFAULT_ERC20_DISTRIBUTION_CONTRACT,
      selector: DISPERSE_TOKEN_SELECTOR,
      methodName: DISPERSE_TOKEN_METHOD,
      tokenContract: token,
      decimals: 6,
      totalAmountRaw: "3000",
      nativeValueWei: "0",
      nonce: 7,
    });
    expect(plan.distributionParent?.recipients.map((recipient) => recipient.targetAddress)).toEqual([
      accountB,
      external,
    ]);
    expect(plan.children.map((child) => child.amountRaw)).toEqual(["1000", "2000"]);
    expect(plan.children.map((child) => child.nonce)).toEqual([null, null]);
    expect(plan.summary.totalPlannedAmountRaw).toBe("3000");
  });

  it("blocks insufficient allowance/preflight representation before submit", () => {
    const plan = buildErc20BatchPlan({
      batchKind: "distribute",
      chainId: 1,
      orchestration: draft(),
      accountSnapshots: [{ address: accountA, nativeBalanceWei: 10_000_000n, nonce: 7 }],
      tokenWatchlistState: tokenState(),
      tokenContract: token,
      defaultDistributionAmountRaw: "1000",
      allowance: { status: "ok", allowanceRaw: "999" },
      fees,
      batchId: "erc20-batch-allowance",
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    expect(plan.status).toBe("blocked");
    expect(plan.distributionParent?.errors.join(" ")).toMatch(/allowance/i);
    expect(plan.children[0].status).toBe("blocked");
  });

  it("blocks only duplicate allocation rows when distribution recipients repeat an address", () => {
    const uniqueTarget = local(2, accountC);
    const duplicateLocalTarget = local(1, accountB);
    const duplicateExternal = externalTarget(accountB.toUpperCase());
    const plan = buildErc20BatchPlan({
      batchKind: "distribute",
      chainId: 1,
      orchestration: draft({
        localTargets: [uniqueTarget, duplicateLocalTarget],
        externalTargets: [duplicateExternal],
      }),
      accountSnapshots: [{ address: accountA, nativeBalanceWei: 10_000_000n, nonce: 7 }],
      tokenWatchlistState: tokenState(),
      tokenContract: token,
      distributionAmountsRaw: {
        [erc20BatchTargetAmountKey(uniqueTarget)]: "1000",
        [erc20BatchTargetAmountKey(duplicateLocalTarget)]: "2000",
        [erc20BatchTargetAmountKey(duplicateExternal)]: "3000",
      },
      allowance: { status: "ok", allowanceRaw: "6000" },
      fees,
      batchId: "erc20-batch-duplicate-recipient",
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    expect(plan.status).toBe("blocked");
    expect(plan.distributionParent?.errors.join(" ")).toMatch(/duplicate recipient address/i);
    expect(plan.children.map((child) => child.status)).toEqual(["notSubmitted", "blocked", "blocked"]);
    expect(plan.children[0].errors.join(" ")).not.toMatch(/duplicate recipient address/i);
    expect(plan.children[1].errors.join(" ")).toMatch(/duplicate recipient address/i);
    expect(plan.children[2].errors.join(" ")).toMatch(/duplicate recipient address/i);
  });

  it("applies collection snapshot rules without treating missing as zero", () => {
    const plan = buildErc20BatchPlan({
      batchKind: "collect",
      chainId: 1,
      orchestration: draft({
        sourceAccounts: [local(0, accountA), local(1, accountB), local(2, accountC)],
        localTargets: [],
        externalTargets: [externalTarget()],
      }),
      accountSnapshots: [
        { address: accountA, nativeBalanceWei: 10_000_000n, nonce: 3 },
        { address: accountB, nativeBalanceWei: 10_000_000n, nonce: 4 },
        { address: accountC, nativeBalanceWei: 10_000_000n, nonce: 5 },
      ],
      tokenWatchlistState: tokenState({
        erc20BalanceSnapshots: [
          {
            account: accountA,
            chainId: 1,
            tokenContract: token,
            balanceRaw: "123",
            balanceStatus: "ok",
            createdAt: "2026-04-28T00:00:00.000Z",
            updatedAt: "2026-04-28T00:00:00.000Z",
          },
          {
            account: accountB,
            chainId: 1,
            tokenContract: token,
            balanceRaw: "0",
            balanceStatus: "zero",
            createdAt: "2026-04-28T00:00:00.000Z",
            updatedAt: "2026-04-28T00:00:00.000Z",
          },
        ],
      }),
      tokenContract: token,
      fees,
      batchId: "erc20-batch-collect",
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    expect(plan.children.map((child) => child.status)).toEqual(["notSubmitted", "skipped", "blocked"]);
    expect(plan.children.map((child) => child.amountRaw)).toEqual(["123", "0", "0"]);
    expect(plan.children[2].errors.join(" ")).toMatch(/missing is not treated as zero/);
    expect(plan.status).toBe("blocked");
  });

  it("reserves collection child nonces past local pending history per source", () => {
    const plan = buildErc20BatchPlan({
      batchKind: "collect",
      chainId: 1,
      orchestration: draft({
        sourceAccounts: [local(0, accountA), local(1, accountB)],
        localTargets: [],
        externalTargets: [externalTarget()],
      }),
      accountSnapshots: [
        { address: accountA, nativeBalanceWei: 10_000_000n, nonce: 3 },
        { address: accountB, nativeBalanceWei: 10_000_000n, nonce: 9 },
      ],
      localPendingHistory: [
        pendingNonce(0, 1, accountA, 5),
        pendingNonce(1, 1, accountB.toUpperCase(), 12),
      ],
      tokenWatchlistState: tokenState({
        erc20BalanceSnapshots: [
          ...tokenState().erc20BalanceSnapshots,
          {
            account: accountB,
            chainId: 1,
            tokenContract: token,
            balanceRaw: "456",
            balanceStatus: "ok",
            createdAt: "2026-04-28T00:00:00.000Z",
            updatedAt: "2026-04-28T00:00:00.000Z",
          },
        ],
      }),
      tokenContract: token,
      fees,
      batchId: "erc20-batch-pending",
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    expect(plan.status).toBe("ready");
    expect(plan.children.map((child) => child.nonce)).toEqual([6, 13]);
  });

  it("invalidates a freeze when token metadata, recipient order, gas, or snapshot changes", () => {
    const base = {
      batchKind: "distribute" as const,
      chainId: 1,
      orchestration: draft({ externalTargets: [externalTarget()] }),
      accountSnapshots: [{ address: accountA, nativeBalanceWei: 10_000_000n, nonce: 7 }],
      tokenWatchlistState: tokenState(),
      tokenContract: token,
      defaultDistributionAmountRaw: "1000",
      allowance: { status: "ok" as const, allowanceRaw: "2000" },
      fees,
      batchId: "erc20-batch-freeze",
      createdAt: "2026-04-28T00:00:00.000Z",
    };
    const frozen = freezeErc20BatchPlan(buildErc20BatchPlan(base), "2026-04-28T01:00:00.000Z");

    expect(isFrozenErc20BatchPlanValid(frozen, buildErc20BatchPlan(base))).toBe(true);
    expect(
      isFrozenErc20BatchPlanValid(
        frozen,
        buildErc20BatchPlan({ ...base, fees: { ...fees, gasLimit: "70000" } }),
      ),
    ).toBe(false);
    expect(
      isFrozenErc20BatchPlanValid(
        frozen,
        buildErc20BatchPlan({
          ...base,
          orchestration: draft({ localTargets: [], externalTargets: [externalTarget(), externalTarget(accountC)] }),
        }),
      ),
    ).toBe(false);
    expect(
      isFrozenErc20BatchPlanValid(
        frozen,
        buildErc20BatchPlan({
          ...base,
          tokenWatchlistState: tokenState({
            resolvedTokenMetadata: [
              {
                ...tokenState().resolvedTokenMetadata[0],
                source: "userConfirmed",
              },
            ],
          }),
        }),
      ),
    ).toBe(false);
    expect(
      isFrozenErc20BatchPlanValid(
        frozen,
        buildErc20BatchPlan({
          ...base,
          tokenWatchlistState: tokenState({
            erc20BalanceSnapshots: [
              {
                ...tokenState().erc20BalanceSnapshots[0],
                updatedAt: "2026-04-28T02:00:00.000Z",
              },
            ],
          }),
        }),
      ),
    ).toBe(false);
  });
});
