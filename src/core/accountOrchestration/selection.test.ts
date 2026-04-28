import { describe, expect, it } from "vitest";
import type { AccountModel } from "./selection";
import type { TokenWatchlistState } from "../../lib/tauri";
import {
  buildAccountOrchestrationPreviews,
  buildOrchestrationDraft,
  computeFrozenKey,
  freezeOrchestrationDraft,
  normalizeExternalAddressTarget,
  orchestrationFrozenPayload,
} from "./selection";

const accountA = "0x1111111111111111111111111111111111111111";
const accountB = "0x2222222222222222222222222222222222222222";
const tokenA = "0x3333333333333333333333333333333333333333";
const tokenB = "0x4444444444444444444444444444444444444444";

function accounts(): AccountModel[] {
  return [
    {
      index: 0,
      address: accountA,
      label: "Account 0",
      nativeBalanceWei: null,
      nonce: null,
      lastSyncError: "RPC timeout",
    },
    {
      index: 1,
      address: accountB,
      label: "Account 1",
      nativeBalanceWei: 0n,
      nonce: 0,
      lastSyncError: null,
    },
  ];
}

function tokenState(): TokenWatchlistState {
  return {
    schemaVersion: 1,
    watchlistTokens: [
      {
        chainId: 1,
        tokenContract: tokenA,
        label: "Token A",
        pinned: false,
        hidden: false,
        createdAt: "1710000000",
        updatedAt: "1710000000",
      },
      {
        chainId: 1,
        tokenContract: tokenB,
        label: "Token B",
        pinned: false,
        hidden: false,
        createdAt: "1710000000",
        updatedAt: "1710000000",
      },
    ],
    tokenMetadataCache: [],
    tokenScanState: [],
    erc20BalanceSnapshots: [
      {
        account: accountA,
        chainId: 1,
        tokenContract: tokenA,
        balanceRaw: "0",
        balanceStatus: "zero",
        createdAt: "1710000000",
        updatedAt: "1710000001",
      },
      {
        account: accountB,
        chainId: 1,
        tokenContract: tokenA,
        balanceRaw: "99",
        balanceStatus: "ok",
        createdAt: "1710000000",
        updatedAt: "1710000001",
      },
      {
        account: accountB,
        chainId: 1,
        tokenContract: tokenB,
        balanceRaw: "99",
        balanceStatus: "balanceCallFailed",
        createdAt: "1710000000",
        updatedAt: "1710000001",
      },
    ],
    resolvedTokenMetadata: [],
  };
}

describe("account orchestration selection", () => {
  it("validates, normalizes, and deduplicates external address targets", () => {
    const first = normalizeExternalAddressTarget({
      address: "0x5555555555555555555555555555555555555555",
      label: "External one",
      notes: "outside vault",
    });

    expect(first.ok).toBe(true);
    expect(first.target).toMatchObject({
      kind: "externalAddress",
      address: "0x5555555555555555555555555555555555555555",
      label: "External one",
      notes: "outside vault",
    });

    expect(normalizeExternalAddressTarget({ address: "not-an-address" }).error).toMatch(
      /valid EVM address/,
    );
    expect(
      normalizeExternalAddressTarget(
        { address: "0x5555555555555555555555555555555555555555" },
        [first.target!],
      ).error,
    ).toMatch(/already/);
  });

  it("keeps local and external targets as distinct reference kinds", () => {
    const external = normalizeExternalAddressTarget({
      address: "0x5555555555555555555555555555555555555555",
    }).target!;
    const draft = buildOrchestrationDraft({
      chainId: 1n,
      accounts: accounts(),
      tokenWatchlistState: tokenState(),
      selectedSourceAddresses: [accountA],
      selectedLocalTargetAddresses: [accountB],
      externalTargets: [external],
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    expect(draft.sourceAccounts).toHaveLength(1);
    expect(draft.localTargets[0].kind).toBe("localAccount");
    expect(draft.externalTargets[0].kind).toBe("externalAddress");
    expect(draft.localTargets[0].address).toBe(accountB);
    expect(draft.externalTargets[0].address).toBe("0x5555555555555555555555555555555555555555");
  });

  it("does not auto-select every account when the selected source list is empty", () => {
    const draft = buildOrchestrationDraft({
      chainId: 1,
      accounts: accounts(),
      tokenWatchlistState: tokenState(),
      selectedSourceAddresses: [],
      selectedLocalTargetAddresses: [],
      externalTargets: [],
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    expect(draft.sourceAccounts).toEqual([]);
    expect(draft.previews).toEqual([]);
  });

  it("marks missing native balance and nonce as missing rather than zero", () => {
    const previews = buildAccountOrchestrationPreviews(accounts(), 1, tokenState());
    const missingPreview = previews.find((preview) => preview.account.address === accountA)!;
    const zeroPreview = previews.find((preview) => preview.account.address === accountB)!;

    expect(missingPreview.nativeBalance).toBe("missing");
    expect(missingPreview.nonce).toBe("missing");
    expect(missingPreview.erc20SnapshotCounts.zero).toBe(1);
    expect(missingPreview.erc20SnapshotCounts.missing).toBe(1);

    expect(zeroPreview.nativeBalance).toBe("present");
    expect(zeroPreview.nonce).toBe("present");
    expect(zeroPreview.erc20SnapshotCounts.ok).toBe(1);
    expect(zeroPreview.erc20SnapshotCounts.failure).toBe(1);
  });

  it("produces a stable frozen key without sensitive fields or timestamps", () => {
    const baseInput = {
      chainId: 1,
      accounts: accounts().map((account) => ({
        ...account,
        mnemonic: "never include me",
        privateKey: "never include me either",
      })) as AccountModel[],
      tokenWatchlistState: tokenState(),
      selectedSourceAddresses: [accountA],
      selectedLocalTargetAddresses: [accountB],
      externalTargets: [
        normalizeExternalAddressTarget({
          address: "0x5555555555555555555555555555555555555555",
        }).target!,
      ],
    };
    const draftOne = buildOrchestrationDraft({
      ...baseInput,
      createdAt: "2026-04-28T00:00:00.000Z",
    });
    const draftTwo = buildOrchestrationDraft({
      ...baseInput,
      createdAt: "2026-04-28T00:01:00.000Z",
    });

    expect(computeFrozenKey(draftOne)).toBe(computeFrozenKey(draftTwo));
    expect(freezeOrchestrationDraft(draftOne, "2026-04-28T00:02:00.000Z").frozenKey).toBe(
      freezeOrchestrationDraft(draftTwo, "2026-04-28T00:03:00.000Z").frozenKey,
    );
    const frozenPayload = JSON.stringify(orchestrationFrozenPayload(draftOne));
    expect(frozenPayload).not.toContain("mnemonic");
    expect(frozenPayload).not.toContain("privateKey");
    expect(frozenPayload).not.toContain("never include");
    expect(frozenPayload).not.toContain("2026-04-28T00:00:00.000Z");
  });

  it("canonicalizes selected account and external target sets before freezing", () => {
    const externalA = normalizeExternalAddressTarget({
      address: "0x5555555555555555555555555555555555555555",
      label: "External A",
    }).target!;
    const externalB = normalizeExternalAddressTarget({
      address: "0x7777777777777777777777777777777777777777",
      label: "External B",
    }).target!;
    const firstDraft = buildOrchestrationDraft({
      chainId: 1,
      accounts: accounts(),
      tokenWatchlistState: tokenState(),
      selectedSourceAddresses: [accountB, accountA],
      selectedLocalTargetAddresses: [accountB, accountA],
      externalTargets: [externalB, externalA],
      createdAt: "2026-04-28T00:00:00.000Z",
    });
    const secondDraft = buildOrchestrationDraft({
      chainId: 1,
      accounts: accounts(),
      tokenWatchlistState: tokenState(),
      selectedSourceAddresses: [accountA, accountB],
      selectedLocalTargetAddresses: [accountA, accountB],
      externalTargets: [externalA, externalB],
      createdAt: "2026-04-28T00:01:00.000Z",
    });

    expect(firstDraft.sourceAccounts.map((account) => account.address)).toEqual([accountA, accountB]);
    expect(firstDraft.localTargets.map((account) => account.address)).toEqual([accountA, accountB]);
    expect(firstDraft.externalTargets.map((target) => target.address)).toEqual([
      externalA.address,
      externalB.address,
    ]);
    expect(orchestrationFrozenPayload(firstDraft)).toEqual(orchestrationFrozenPayload(secondDraft));
    expect(computeFrozenKey(firstDraft)).toBe(computeFrozenKey(secondDraft));
  });
});
