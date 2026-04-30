import { describe, expect, it, vi } from "vitest";
import type { TokenWatchlistState } from "../../lib/tauri";
import { createApprovalIdentityKey, listApprovalReadModelEntries } from "./approvals";

const owner = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ownerLower = owner.toLowerCase();
const usdc = "0x1111111111111111111111111111111111111111";
const sameSymbolUsdc = "0x2222222222222222222222222222222222222222";
const spender = "0x3333333333333333333333333333333333333333";
const operator = "0x4444444444444444444444444444444444444444";

function state(overrides: Partial<TokenWatchlistState> = {}): TokenWatchlistState {
  return {
    schemaVersion: 1,
    watchlistTokens: [],
    tokenMetadataCache: [],
    tokenScanState: [],
    erc20BalanceSnapshots: [],
    approvalWatchlist: [],
    assetScanJobs: [],
    assetSnapshots: [],
    allowanceSnapshots: [],
    nftApprovalSnapshots: [],
    resolvedTokenMetadata: [],
    ...overrides,
  };
}

describe("approval asset read model", () => {
  it("uses identity fields instead of symbol/name/display labels", () => {
    const entries = listApprovalReadModelEntries(
      state({
        allowanceSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: usdc,
            spender,
            allowanceRaw: "100",
            status: "active",
            source: {
              kind: "rpcPointRead",
              label: "USDC",
              summary: "USD Coin",
            },
            createdAt: "1",
            updatedAt: "1",
          },
          {
            chainId: 1,
            owner,
            tokenContract: sameSymbolUsdc,
            spender,
            allowanceRaw: "200",
            status: "active",
            source: {
              kind: "manualImport",
              label: "USDC",
              summary: "USD Coin",
            },
            createdAt: "2",
            updatedAt: "2",
          },
        ],
      }),
    );

    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.identityKey)).size).toBe(2);
    expect(entries[0].identityKey).toBe(
      createApprovalIdentityKey({
        chainId: 1,
        owner,
        contract: usdc,
        kind: "erc20Allowance",
        spender,
      }),
    );
  });

  it("canonicalizes token ids for identity keys and filtering", () => {
    expect(
      createApprovalIdentityKey({
        chainId: 1,
        owner,
        contract: usdc,
        kind: "erc721TokenApproval",
        operator,
        tokenId: "042",
      }),
    ).toBe(
      createApprovalIdentityKey({
        chainId: 1,
        owner,
        contract: usdc,
        kind: "erc721TokenApproval",
        operator,
        tokenId: "42",
      }),
    );

    const model = state({
      nftApprovalSnapshots: [
        {
          chainId: 1,
          owner,
          tokenContract: usdc,
          kind: "erc721TokenApproval",
          operator,
          tokenId: "042",
          approved: true,
          status: "active",
          source: { kind: "rpcPointRead" },
          createdAt: "1",
          updatedAt: "1",
        },
      ],
    });

    const entries = listApprovalReadModelEntries(model, { tokenId: "42" });
    expect(entries).toHaveLength(1);
    expect(entries[0].tokenId).toBe("42");
    expect(listApprovalReadModelEntries(model, { tokenId: "00042" })).toHaveLength(1);
  });

  it("filters by owner, chain, contract, spender/operator, status, and source", () => {
    const model = state({
      approvalWatchlist: [
        {
          chainId: 1,
          owner,
          tokenContract: usdc,
          kind: "erc20Allowance",
          spender,
          enabled: true,
          label: "approval",
          source: { kind: "userWatchlist" },
          createdAt: "1",
          updatedAt: "1",
        },
      ],
      allowanceSnapshots: [
        {
          chainId: 1,
          owner,
          tokenContract: usdc,
          spender,
          allowanceRaw: "42",
          status: "active",
          source: { kind: "rpcPointRead" },
          createdAt: "1",
          updatedAt: "1",
        },
      ],
      nftApprovalSnapshots: [
        {
          chainId: 1,
          owner,
          tokenContract: sameSymbolUsdc,
          kind: "erc721ApprovalForAll",
          operator,
          approved: true,
          status: "active",
          source: { kind: "historyDerivedCandidate" },
          createdAt: "1",
          updatedAt: "1",
        },
      ],
    });

    expect(
      listApprovalReadModelEntries(model, {
        owner: ownerLower,
        chainId: 1,
        contract: usdc,
        spender,
        status: "active",
        sourceKind: "rpcPointRead",
      }),
    ).toHaveLength(1);
    expect(
      listApprovalReadModelEntries(model, {
        operator,
        sourceKind: "historyDerivedCandidate",
        kind: "nftApproval",
      }),
    ).toHaveLength(1);
    expect(listApprovalReadModelEntries(model, { sourceKind: "userWatchlist" })).toHaveLength(1);
  });

  it("keeps stale and failure states visible and filterable", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const model = state({
      allowanceSnapshots: [
        {
          chainId: 1,
          owner,
          tokenContract: usdc,
          spender,
          allowanceRaw: "100",
          status: "stale",
          staleAfter: "1",
          source: { kind: "rpcPointRead" },
          createdAt: "1",
          updatedAt: "2",
        },
        {
          chainId: 1,
          owner,
          tokenContract: sameSymbolUsdc,
          spender,
          allowanceRaw: "0",
          status: "readFailed",
          source: { kind: "unavailable" },
          createdAt: "1",
          updatedAt: "2",
        },
      ],
      assetScanJobs: [
        {
          jobId: "scan-1",
          chainId: 1,
          owner,
          status: "sourceUnavailable",
          source: { kind: "unavailable" },
          createdAt: "1",
          updatedAt: "2",
        },
      ],
    });

    expect(listApprovalReadModelEntries(model, { stale: true })).toHaveLength(1);
    expect(listApprovalReadModelEntries(model, { failure: true })).toHaveLength(2);
    expect(listApprovalReadModelEntries(model, { status: ["stale", "readFailed"] })).toHaveLength(2);
    vi.useRealTimers();
  });
});
