import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TokenWatchlistState } from "../../lib/tauri";
import { renderScreen } from "../../test/render";
import { AssetApprovalsView } from "./AssetApprovalsView";

const owner = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const otherOwner = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const tokenA = "0x1111111111111111111111111111111111111111";
const tokenB = "0x2222222222222222222222222222222222222222";
const spender = "0x3333333333333333333333333333333333333333";
const freshSpender = "0x6666666666666666666666666666666666666666";
const operator = "0x4444444444444444444444444444444444444444";
const tokenOperator = "0x5555555555555555555555555555555555555555";

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

function richState() {
  return state({
    erc20BalanceSnapshots: [
      {
        account: owner,
        chainId: 1,
        tokenContract: tokenA,
        balanceRaw: "1500000",
        balanceStatus: "ok",
        createdAt: "1",
        updatedAt: "2",
        lastScannedAt: "2",
      },
      {
        account: otherOwner,
        chainId: 5,
        tokenContract: tokenB,
        balanceRaw: "99",
        balanceStatus: "rpcFailed",
        createdAt: "1",
        updatedAt: "2",
        lastErrorSummary: "balance rpc failed",
      },
    ],
    approvalWatchlist: [
      {
        chainId: 1,
        owner,
        tokenContract: tokenA,
        kind: "erc20Allowance",
        spender,
        enabled: true,
        label: "Same Label",
        source: { kind: "userWatchlist", summary: "local" },
        createdAt: "1",
        updatedAt: "1",
      },
      {
        chainId: 1,
        owner,
        tokenContract: tokenB,
        kind: "erc721ApprovalForAll",
        operator,
        enabled: true,
        label: "Same Label",
        source: { kind: "historyDerivedCandidate" },
        createdAt: "1",
        updatedAt: "1",
      },
      {
        chainId: 5,
        owner: otherOwner,
        tokenContract: tokenB,
        kind: "erc721TokenApproval",
        operator: tokenOperator,
        tokenId: "42",
        enabled: true,
        source: { kind: "indexerCandidate" },
        createdAt: "1",
        updatedAt: "1",
      },
    ],
    allowanceSnapshots: [
      {
        chainId: 1,
        owner,
        tokenContract: tokenA,
        spender,
        allowanceRaw: "100",
        status: "active",
        source: { kind: "rpcPointRead" },
        lastScannedAt: "2",
        staleAfter: "1",
        createdAt: "1",
        updatedAt: "2",
      },
      {
        chainId: 1,
        owner,
        tokenContract: tokenA,
        spender: freshSpender,
        allowanceRaw: "200",
        status: "active",
        source: { kind: "rpcPointRead" },
        lastScannedAt: "2",
        createdAt: "1",
        updatedAt: "2",
      },
      {
        chainId: 5,
        owner: otherOwner,
        tokenContract: tokenB,
        spender,
        allowanceRaw: "0",
        status: "readFailed",
        source: { kind: "unavailable" },
        lastErrorSummary: "allowance read failed",
        createdAt: "1",
        updatedAt: "2",
      },
      {
        chainId: 1,
        owner,
        tokenContract: tokenB,
        spender,
        allowanceRaw: "0",
        status: "zero",
        source: { kind: "rpcPointRead" },
        createdAt: "1",
        updatedAt: "2",
      },
    ],
    nftApprovalSnapshots: [
      {
        chainId: 1,
        owner,
        tokenContract: tokenB,
        kind: "erc721ApprovalForAll",
        operator,
        approved: false,
        status: "revoked",
        source: { kind: "historyDerivedCandidate" },
        createdAt: "1",
        updatedAt: "2",
      },
      {
        chainId: 5,
        owner: otherOwner,
        tokenContract: tokenB,
        kind: "erc721TokenApproval",
        operator: tokenOperator,
        tokenId: "42",
        approved: true,
        status: "stale",
        source: { kind: "indexerCandidate" },
        lastErrorSummary: "token approval stale",
        createdAt: "1",
        updatedAt: "2",
      },
    ],
    assetSnapshots: [
      {
        chainId: 1,
        owner,
        tokenContract: tokenB,
        assetKind: "erc721",
        tokenId: "7",
        status: "active",
        source: { kind: "explorerCandidate" },
        createdAt: "1",
        updatedAt: "2",
      },
    ],
    assetScanJobs: [
      {
        jobId: "job-1",
        chainId: 1,
        owner,
        status: "sourceUnavailable",
        source: { kind: "unavailable", summary: "no source configured" },
        lastErrorSummary: "coverage unavailable",
        createdAt: "1",
        updatedAt: "2",
      },
    ],
    resolvedTokenMetadata: [
      {
        chainId: 1,
        tokenContract: tokenA,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        source: "onChainCall",
        status: "ok",
        updatedAt: "2",
      },
      {
        chainId: 1,
        tokenContract: tokenB,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 0,
        source: "userConfirmed",
        status: "ok",
        updatedAt: "2",
      },
    ],
  });
}

function renderAssets(
  model = richState(),
  handlers: Partial<{
    onAddApprovalCandidate: ReturnType<typeof vi.fn>;
    onScanErc20Allowance: ReturnType<typeof vi.fn>;
    onScanNftOperatorApproval: ReturnType<typeof vi.fn>;
    onScanErc721TokenApproval: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const props = {
    onAddApprovalCandidate: handlers.onAddApprovalCandidate ?? vi.fn(),
    onScanErc20Allowance: handlers.onScanErc20Allowance ?? vi.fn(),
    onScanNftOperatorApproval: handlers.onScanNftOperatorApproval ?? vi.fn(),
    onScanErc721TokenApproval: handlers.onScanErc721TokenApproval ?? vi.fn(),
  };
  renderScreen(
    <AssetApprovalsView
      accounts={[
        {
          address: owner,
          index: 1,
          label: "Account 1",
          nativeBalanceWei: 1n,
          nonce: 0,
        },
      ]}
      rpcReady={true}
      selectedChainId={1n}
      state={model}
      {...props}
    />,
  );
  return props;
}

function filters() {
  return within(screen.getByLabelText("Approval filters"));
}

describe("AssetApprovalsView", () => {
  it("shows the unknown coverage empty state as not a full-chain safety scan", () => {
    renderAssets(state());

    expect(screen.getByText(/Approval source coverage is unknown\/not configured/)).toBeInTheDocument();
    expect(screen.getByText(/This is not a full-chain safety scan/)).toBeInTheDocument();
  });

  it("filters approval entries by account, chain, contract, spender/operator, status, source, stale, and failure", async () => {
    renderAssets();

    const watchlist = within(screen.getByLabelText("Approval watchlist candidates"));
    expect(watchlist.getAllByText("Same Label")).toHaveLength(2);

    fireEvent.change(filters().getByLabelText("Account / owner"), { target: { value: otherOwner } });
    fireEvent.change(filters().getByLabelText("Chain ID"), { target: { value: "5" } });
    expect(watchlist.queryByText("Same Label")).not.toBeInTheDocument();
    expect(watchlist.getByText(/tokenId 42/)).toBeInTheDocument();

    fireEvent.change(filters().getByLabelText("Spender / operator"), { target: { value: tokenOperator } });
    expect(watchlist.getAllByText(/operator 0x5555555555555555555555555555555555555555/).length).toBeGreaterThan(0);

    fireEvent.change(filters().getByLabelText("Status"), { target: { value: "stale" } });
    expect(within(screen.getByLabelText("NFT approval snapshots")).getByText("Stale / rescan required")).toBeInTheDocument();

    fireEvent.change(filters().getByLabelText("Source"), { target: { value: "indexerCandidate" } });
    expect(screen.getAllByText(/indexerCandidate/).length).toBeGreaterThan(0);

    fireEvent.change(filters().getByLabelText("Stale / failure"), { target: { value: "stale" } });
    expect(within(screen.getByLabelText("NFT approval snapshots")).getByText("token approval stale")).toBeInTheDocument();

    fireEvent.change(filters().getByLabelText("Status"), { target: { value: "" } });
    fireEvent.change(filters().getByLabelText("Spender / operator"), { target: { value: "" } });
    fireEvent.change(filters().getByLabelText("Source"), { target: { value: "unavailable" } });
    fireEvent.change(filters().getByLabelText("Stale / failure"), { target: { value: "failure" } });
    await waitFor(() => {
      expect(within(screen.getByLabelText("ERC-20 allowance snapshots")).getByText("allowance read failed")).toBeInTheDocument();
    });
  });

  it("filters by asset and approval kind", () => {
    renderAssets();

    fireEvent.change(filters().getByLabelText("Kind"), { target: { value: "watchlist" } });
    expect(within(screen.getByLabelText("Approval watchlist candidates")).getAllByText("Same Label")).toHaveLength(2);
    expect(within(screen.getByLabelText("ERC-20 allowance snapshots")).getByText("No ERC-20 allowance snapshots match these filters.")).toBeInTheDocument();

    fireEvent.change(filters().getByLabelText("Kind"), { target: { value: "allowance" } });
    expect(within(screen.getByLabelText("ERC-20 allowance snapshots")).getByText("Stale / rescan required")).toBeInTheDocument();
    expect(within(screen.getByLabelText("NFT approval snapshots")).getByText("No NFT approval snapshots match these filters.")).toBeInTheDocument();

    fireEvent.change(filters().getByLabelText("Kind"), { target: { value: "nftApproval" } });
    expect(within(screen.getByLabelText("NFT approval snapshots")).getByText("Revoked")).toBeInTheDocument();
    expect(within(screen.getByLabelText("ERC-20 allowance snapshots")).getByText("No ERC-20 allowance snapshots match these filters.")).toBeInTheDocument();

    fireEvent.change(filters().getByLabelText("Kind"), { target: { value: "asset:erc721" } });
    expect(within(screen.getByLabelText("Known NFT and asset snapshots")).getByText(/tokenId 7/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("NFT approval snapshots")).getByText("No NFT approval snapshots match these filters.")).toBeInTheDocument();

    fireEvent.change(filters().getByLabelText("Kind"), { target: { value: "erc20Balance" } });
    expect(within(screen.getByLabelText("ERC-20 balance snapshots")).getByText("1500000")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Approval watchlist candidates")).getByText("No approval candidates match these filters.")).toBeInTheDocument();
  });

  it("matches ERC-721 token-specific snapshots by tokenId when approved operator differs from candidate hint", () => {
    const hintedOperator = "0x7777777777777777777777777777777777777777";
    const actualOperator = "0x8888888888888888888888888888888888888888";
    renderAssets(
      state({
        approvalWatchlist: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenB,
            kind: "erc721TokenApproval",
            operator: hintedOperator,
            tokenId: "99",
            enabled: true,
            label: "Token specific candidate",
            source: { kind: "userWatchlist" },
            createdAt: "1",
            updatedAt: "1",
          },
        ],
        nftApprovalSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenB,
            kind: "erc721TokenApproval",
            operator: actualOperator,
            tokenId: "99",
            approved: true,
            status: "active",
            source: { kind: "rpcPointRead" },
            createdAt: "2",
            updatedAt: "2",
          },
        ],
      }),
    );

    const watchlist = within(screen.getByLabelText("Approval watchlist candidates"));
    expect(watchlist.getByText("Token specific candidate")).toBeInTheDocument();
    expect(watchlist.getByText(new RegExp(`operator ${hintedOperator}`))).toBeInTheDocument();
    expect(watchlist.getByText("Active")).toBeInTheDocument();
    expect(watchlist.getByText("approved true")).toBeInTheDocument();
    expect(watchlist.getByText(new RegExp(`actual operator ${actualOperator}`))).toBeInTheDocument();
    expect(watchlist.queryByText("No point-read snapshot yet.")).not.toBeInTheDocument();
  });

  it("uses active token-specific point truth instead of an old exact candidate-operator snapshot", () => {
    const hintedOperator = "0x7777777777777777777777777777777777777777";
    const actualOperator = "0x8888888888888888888888888888888888888888";
    renderAssets(
      state({
        approvalWatchlist: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenB,
            kind: "erc721TokenApproval",
            operator: hintedOperator,
            tokenId: "99",
            enabled: true,
            label: "Token specific candidate",
            source: { kind: "userWatchlist" },
            createdAt: "1",
            updatedAt: "1",
          },
        ],
        nftApprovalSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenB,
            kind: "erc721TokenApproval",
            operator: hintedOperator,
            tokenId: "99",
            approved: false,
            status: "revoked",
            source: { kind: "rpcPointRead" },
            lastScannedAt: "10",
            createdAt: "10",
            updatedAt: "10",
          },
          {
            chainId: 1,
            owner,
            tokenContract: tokenB,
            kind: "erc721TokenApproval",
            operator: actualOperator,
            tokenId: "99",
            approved: true,
            status: "active",
            source: { kind: "rpcPointRead" },
            lastScannedAt: "20",
            createdAt: "20",
            updatedAt: "20",
          },
        ],
      }),
    );

    const watchlist = within(screen.getByLabelText("Approval watchlist candidates"));
    expect(watchlist.getByText(new RegExp(`operator ${hintedOperator}`))).toBeInTheDocument();
    expect(watchlist.getByText("Active")).toBeInTheDocument();
    expect(watchlist.getByText("approved true")).toBeInTheDocument();
    expect(watchlist.getByText(new RegExp(`actual operator ${actualOperator}`))).toBeInTheDocument();
    expect(watchlist.getByText("Eligible for future revoke draft")).toBeInTheDocument();
    expect(watchlist.queryByText("Revoked")).not.toBeInTheDocument();
    expect(watchlist.queryByText("Not eligible: revoked or inactive")).not.toBeInTheDocument();
  });

  it("chooses the fresh active token-specific snapshot over a later array-order revoked row", () => {
    const activeOperator = "0x7777777777777777777777777777777777777777";
    const revokedOperator = "0x8888888888888888888888888888888888888888";
    renderAssets(
      state({
        approvalWatchlist: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenB,
            kind: "erc721TokenApproval",
            operator: revokedOperator,
            tokenId: "99",
            enabled: true,
            label: "Token specific candidate",
            source: { kind: "userWatchlist" },
            createdAt: "1",
            updatedAt: "1",
          },
        ],
        nftApprovalSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenB,
            kind: "erc721TokenApproval",
            operator: activeOperator,
            tokenId: "99",
            approved: true,
            status: "active",
            source: { kind: "rpcPointRead" },
            lastScannedAt: "30",
            createdAt: "30",
            updatedAt: "30",
          },
          {
            chainId: 1,
            owner,
            tokenContract: tokenB,
            kind: "erc721TokenApproval",
            operator: revokedOperator,
            tokenId: "99",
            approved: false,
            status: "revoked",
            source: { kind: "rpcPointRead" },
            lastScannedAt: "20",
            createdAt: "20",
            updatedAt: "20",
          },
        ],
      }),
    );

    const watchlist = within(screen.getByLabelText("Approval watchlist candidates"));
    expect(watchlist.getByText(new RegExp(`operator ${revokedOperator}`))).toBeInTheDocument();
    expect(watchlist.getByText("Active")).toBeInTheDocument();
    expect(watchlist.getByText("approved true")).toBeInTheDocument();
    expect(watchlist.getByText(new RegExp(`actual operator ${activeOperator}`))).toBeInTheDocument();
    expect(watchlist.queryByText("Revoked")).not.toBeInTheDocument();
  });

  it("keeps unknown metadata, stale/failure badges, and full contract identities visible", () => {
    renderAssets();
    fireEvent.change(filters().getByLabelText("Chain ID"), { target: { value: "" } });

    const balances = within(screen.getByLabelText("ERC-20 balance snapshots"));
    expect(balances.getByText("Unknown metadata")).toBeInTheDocument();
    expect(balances.getByText(new RegExp(tokenB))).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(tokenA)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(tokenB)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Same Label")).toHaveLength(2);
    expect(screen.getByText("balance rpc failed")).toBeInTheDocument();
    expect(screen.getByText("coverage unavailable")).toBeInTheDocument();
  });

  it("shows revoke gating for active, zero/revoked, stale, and failed snapshots", () => {
    renderAssets();
    fireEvent.change(filters().getByLabelText("Chain ID"), { target: { value: "" } });

    expect(screen.getAllByText("Eligible for future revoke draft").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not eligible: zero or inactive").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not eligible: revoked or inactive").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not eligible: rescan required").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Stale / rescan required").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Revoke draft unavailable" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
  });

  it("marks active approvals with expired staleAfter as stale and not revoke eligible", () => {
    renderAssets();

    const watchlist = within(screen.getByLabelText("Approval watchlist candidates"));
    expect(watchlist.getByText("Stale / rescan required")).toBeInTheDocument();
    expect(watchlist.getByText("Not eligible: rescan required")).toBeInTheDocument();
    expect(watchlist.queryByText("Eligible for future revoke draft")).not.toBeInTheDocument();

    const allowances = within(screen.getByLabelText("ERC-20 allowance snapshots"));
    expect(allowances.getByText("Stale / rescan required")).toBeInTheDocument();
    expect(allowances.getByText("Not eligible: rescan required")).toBeInTheDocument();
  });

  it("keeps stale watchlist annotation when filters hide the matching snapshot row", () => {
    renderAssets();

    fireEvent.change(filters().getByLabelText("Status"), { target: { value: "configured" } });
    fireEvent.change(filters().getByLabelText("Source"), { target: { value: "userWatchlist" } });
    fireEvent.change(filters().getByLabelText("Stale / failure"), { target: { value: "clean" } });

    const watchlist = within(screen.getByLabelText("Approval watchlist candidates"));
    expect(watchlist.getByText("Same Label")).toBeInTheDocument();
    expect(watchlist.getByText("Stale / rescan required")).toBeInTheDocument();
    expect(watchlist.getByText("Not eligible: rescan required")).toBeInTheDocument();
    expect(watchlist.queryByText("Eligible for future revoke draft")).not.toBeInTheDocument();

    const allowances = within(screen.getByLabelText("ERC-20 allowance snapshots"));
    expect(allowances.getByText("No ERC-20 allowance snapshots match these filters.")).toBeInTheDocument();
  });

  it("labels indexer and explorer candidates as not RPC-confirmed", () => {
    renderAssets();
    fireEvent.change(filters().getByLabelText("Chain ID"), { target: { value: "" } });

    expect(screen.getAllByText(/Candidate only; not RPC-confirmed/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/indexerCandidate · Candidate only; not RPC-confirmed/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/explorerCandidate · Candidate only; not RPC-confirmed/).length).toBeGreaterThan(0);
  });

  it("routes watchlist scans to the matching handler for each approval kind", () => {
    const onScanErc20Allowance = vi.fn();
    const onScanNftOperatorApproval = vi.fn();
    const onScanErc721TokenApproval = vi.fn();
    renderAssets(richState(), {
      onScanErc20Allowance,
      onScanNftOperatorApproval,
      onScanErc721TokenApproval,
    });
    fireEvent.change(filters().getByLabelText("Chain ID"), { target: { value: "" } });

    const watchlist = within(screen.getByLabelText("Approval watchlist candidates"));
    const scanButtons = watchlist.getAllByRole("button", { name: "Scan" });
    fireEvent.click(scanButtons[0]);
    fireEvent.click(scanButtons[1]);
    fireEvent.click(scanButtons[2]);

    expect(onScanErc20Allowance).toHaveBeenCalledWith(owner, 1, tokenA, spender);
    expect(onScanNftOperatorApproval).toHaveBeenCalledWith(owner, 1, tokenB, operator);
    expect(onScanErc721TokenApproval).toHaveBeenCalledWith(otherOwner, 5, tokenB, "42", tokenOperator);
  });

  it("adds local manual candidates without claiming discovery", () => {
    const onAddApprovalCandidate = vi.fn(() => false);
    renderAssets(state(), { onAddApprovalCandidate });

    const form = within(screen.getByLabelText("Manual approval candidate configuration"));
    fireEvent.change(form.getByLabelText("Token / NFT contract"), { target: { value: tokenA } });
    fireEvent.change(form.getByLabelText("Spender / operator"), { target: { value: spender } });
    fireEvent.change(form.getByLabelText("Label"), { target: { value: "Manual USDC approval" } });
    fireEvent.click(form.getByRole("button", { name: "Add Candidate" }));

    expect(onAddApprovalCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 1,
        owner,
        tokenContract: tokenA,
        kind: "erc20Allowance",
        spender,
        source: expect.objectContaining({
          kind: "userWatchlist",
          summary: expect.stringContaining("not discovered"),
        }),
      }),
    );
  });
});
