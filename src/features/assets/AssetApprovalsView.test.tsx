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
    onSubmitAssetApprovalRevoke: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const props = {
    onAddApprovalCandidate: handlers.onAddApprovalCandidate ?? vi.fn(),
    onScanErc20Allowance: handlers.onScanErc20Allowance ?? vi.fn(),
    onScanNftOperatorApproval: handlers.onScanNftOperatorApproval ?? vi.fn(),
    onScanErc721TokenApproval: handlers.onScanErc721TokenApproval ?? vi.fn(),
    onSubmitAssetApprovalRevoke: handlers.onSubmitAssetApprovalRevoke,
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
      rpcUrl="https://rpc.example.invalid"
      rpcReady={true}
      selectedRpc={{
        chainId: 1,
        endpointSummary: "https://rpc.example.invalid",
        endpointFingerprint: "rpc-fp-1",
      }}
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

function fillRevokeFees() {
  const panel = within(screen.getByLabelText("Revoke draft confirmation"));
  fireEvent.change(panel.getByLabelText("Nonce"), { target: { value: "7" } });
  fireEvent.change(panel.getByLabelText("Gas limit"), { target: { value: "50000" } });
  fireEvent.change(panel.getByLabelText("Max fee (gwei)"), { target: { value: "12" } });
  fireEvent.change(panel.getByLabelText("Priority fee (gwei)"), { target: { value: "2" } });
  fireEvent.change(panel.getByLabelText("Latest base fee (gwei)"), { target: { value: "10" } });
  fireEvent.change(panel.getByLabelText("Base fee (gwei)"), { target: { value: "10" } });
}

function acknowledgeRevokeWarnings() {
  const warnings = within(screen.getByLabelText("Revoke warning acknowledgements"));
  for (const checkbox of warnings.getAllByRole("checkbox")) {
    if (!(checkbox as HTMLInputElement).checked) {
      fireEvent.click(checkbox);
    }
  }
}

function revokePanel() {
  return within(screen.getByLabelText("Revoke draft confirmation"));
}

function frozenKey() {
  return revokePanel().getByText(/^asset-revoke-(?!time-)/).textContent ?? "";
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
    expect(watchlist.getByText("Eligible for revoke draft")).toBeInTheDocument();
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

    expect(screen.getAllByText("Eligible for revoke draft").length).toBeGreaterThan(0);
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
    expect(watchlist.queryByText("Eligible for revoke draft")).not.toBeInTheDocument();

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
    expect(watchlist.queryByText("Eligible for revoke draft")).not.toBeInTheDocument();

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

  it("redacts source label, summary, sourceId, and provider hints in approval tables", () => {
    renderAssets(
      state({
        allowanceSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender,
            allowanceRaw: "100",
            status: "active",
            source: {
              kind: "explorerCandidate",
              label: "label key: secret-key",
              sourceId: "source token: secret-source",
              summary: "wss://explorer.example/v3/secret-path?apikey=secret",
              providerHint:
                "Bearer secret-token Basic abcdef Authorization=secret-auth authorization: secret-colon password: secret-pass api_key: secret-api authToken: secret-auth-token privateKey=0xabc mnemonic: word word signature: sig-secret rawTx: raw-secret",
              observedAt: "2026-04-29T00:00:00.000Z",
            },
            createdAt: "1",
            updatedAt: "2",
          },
        ],
      }),
    );

    const assets = screen.getByLabelText("ERC-20 allowance snapshots").closest("section") as HTMLElement;
    expect(assets).toHaveTextContent("label key: [redacted]");
    expect(assets).toHaveTextContent("source token: [redacted]");
    expect(assets).toHaveTextContent("wss://explorer.example/<redacted_path>?apikey=[redacted]");
    expect(assets).toHaveTextContent("Bearer [redacted]");
    expect(assets).toHaveTextContent("Basic [redacted]");
    expect(assets).toHaveTextContent("Authorization=[redacted]");
    expect(assets).toHaveTextContent("Authorization: [redacted]");
    expect(assets).toHaveTextContent("password: [redacted]");
    expect(assets).toHaveTextContent("api_key: [redacted]");
    expect(assets).toHaveTextContent("authToken: [redacted]");
    expect(assets).toHaveTextContent("privateKey=[redacted]");
    expect(assets).toHaveTextContent("mnemonic: [redacted]");
    expect(assets).not.toHaveTextContent("secret-key");
    expect(assets).not.toHaveTextContent("secret-source");
    expect(assets).not.toHaveTextContent("secret-path");
    expect(assets).not.toHaveTextContent("secret-token");
    expect(assets).not.toHaveTextContent("secret-pass");
    expect(assets).not.toHaveTextContent("secret-api");
    expect(assets).not.toHaveTextContent("secret-auth-token");
    expect(assets).not.toHaveTextContent("0xabc");
    expect(assets).not.toHaveTextContent("word word");
    expect(assets).not.toHaveTextContent("sig-secret");
    expect(assets).not.toHaveTextContent("raw-secret");
    expect(assets).not.toHaveTextContent("abcdef");
    expect(assets).not.toHaveTextContent("secret-auth");
    expect(assets).not.toHaveTextContent("secret-colon");
    expect(assets).not.toHaveTextContent("apikey=secret");
  });

  it("redacts watchlist user notes in source coverage cells", () => {
    renderAssets(
      state({
        approvalWatchlist: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            kind: "erc20Allowance",
            spender,
            enabled: true,
            label: "Legacy privateKey=secret-label mnemonic: label words",
            source: { kind: "userWatchlist" },
            userNotes:
              "note pass_phrase=secret-one pass-phrase: secret-two pass phrase secret three token: secret-token key: secret-key password: secret-pass authToken: secret-auth privateKey=0xabc mnemonic: word word signature: sig-secret rawTx: raw-secret Bearer secret-bearer",
            createdAt: "1",
            updatedAt: "1",
          },
        ],
      }),
    );

    const watchlist = screen.getByLabelText("Approval watchlist candidates");
    expect(watchlist).toHaveTextContent("Legacy privateKey=[redacted] mnemonic: [redacted]");
    expect(watchlist).toHaveTextContent("note pass_phrase=[redacted]");
    expect(watchlist).toHaveTextContent("pass_phrase=[redacted]");
    expect(watchlist).toHaveTextContent("pass-phrase: [redacted]");
    expect(watchlist).toHaveTextContent("pass phrase [redacted]");
    expect(watchlist).toHaveTextContent("token: [redacted]");
    expect(watchlist).toHaveTextContent("key: [redacted]");
    expect(watchlist).toHaveTextContent("password: [redacted]");
    expect(watchlist).toHaveTextContent("authToken: [redacted]");
    expect(watchlist).toHaveTextContent("privateKey=[redacted]");
    expect(watchlist).not.toHaveTextContent("secret-token");
    expect(watchlist).not.toHaveTextContent("secret-key");
    expect(watchlist).not.toHaveTextContent("secret-label");
    expect(watchlist).not.toHaveTextContent("label words");
    expect(watchlist).not.toHaveTextContent("secret-pass");
    expect(watchlist).not.toHaveTextContent("secret-auth");
    expect(watchlist).not.toHaveTextContent("0xabc");
    expect(watchlist).not.toHaveTextContent("word word");
    expect(watchlist).not.toHaveTextContent("sig-secret");
    expect(watchlist).not.toHaveTextContent("raw-secret");
    expect(watchlist).not.toHaveTextContent("secret-one");
    expect(watchlist).not.toHaveTextContent("secret-two");
    expect(watchlist).not.toHaveTextContent("secret three");
    expect(watchlist).not.toHaveTextContent("secret-bearer");
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
    let submittedCandidate: unknown = null;
    const onAddApprovalCandidate = vi.fn((candidate: unknown) => {
      submittedCandidate = candidate;
      return false;
    });
    renderAssets(state(), { onAddApprovalCandidate });

    const form = within(screen.getByLabelText("Manual approval candidate configuration"));
    fireEvent.change(form.getByLabelText("Token / NFT contract"), { target: { value: tokenA } });
    fireEvent.change(form.getByLabelText("Spender / operator"), { target: { value: spender } });
    fireEvent.change(form.getByLabelText("Label"), { target: { value: "Manual privateKey=0xabc approval" } });
    fireEvent.change(form.getByLabelText("Notes"), {
      target: { value: "note pass_phrase=secret privateKey=0xabc mnemonic: words" },
    });
    fireEvent.click(form.getByRole("button", { name: "Add Candidate" }));

    expect(onAddApprovalCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 1,
        owner,
        tokenContract: tokenA,
        kind: "erc20Allowance",
        spender,
        label: "Manual privateKey=[redacted] approval",
        userNotes: "note pass_phrase=[redacted] privateKey=[redacted] mnemonic: [redacted]",
        source: expect.objectContaining({
          kind: "userWatchlist",
          summary: expect.stringContaining("not discovered"),
        }),
      }),
    );
    expect(JSON.stringify(submittedCandidate)).not.toContain("secret");
    expect(JSON.stringify(submittedCandidate)).not.toContain("0xabc");
    expect(JSON.stringify(submittedCandidate)).not.toContain("words");
  });

  it("builds an ERC-20 revoke draft confirmation with approve(spender, 0) and transaction to token contract", () => {
    renderAssets(
      state({
        allowanceSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender,
            allowanceRaw: "100",
            status: "active",
            source: { kind: "rpcPointRead" },
            createdAt: "1",
            updatedAt: "2",
          },
        ],
      }),
    );

    fireEvent.click(within(screen.getByLabelText("ERC-20 allowance snapshots")).getByRole("button", { name: "Build Revoke Draft" }));
    fillRevokeFees();
    acknowledgeRevokeWarnings();

    const panel = revokePanel();
    expect(panel.getByText("Ready after acknowledgements")).toBeInTheDocument();
    expect(panel.getByText("approve(address,uint256)")).toBeInTheDocument();
    expect(panel.getByText("0x095ea7b3")).toBeInTheDocument();
    expect(panel.getByText(new RegExp(`to = token/approval contract ${tokenA}`))).toBeInTheDocument();
    expect(panel.getAllByText(new RegExp(`spender=${spender}`)).length).toBeGreaterThan(0);
    expect(panel.getByText(/amount=0/)).toBeInTheDocument();
    expect(panel.getByText(new RegExp(`spender ${spender}`))).toBeInTheDocument();
    expect(panel.queryByRole("button", { name: "Submit unavailable until P5-4f" })).not.toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Submit revoke" })).toBeDisabled();
  });

  it("submits a revoke payload with one canonical account index field", async () => {
    const onSubmitAssetApprovalRevoke = vi.fn(async (_input: unknown) => ({}));
    renderAssets(
      state({
        allowanceSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender,
            allowanceRaw: "100",
            status: "active",
            source: { kind: "rpcPointRead" },
            createdAt: "1",
            updatedAt: "2",
          },
        ],
      }),
      { onSubmitAssetApprovalRevoke },
    );

    fireEvent.click(within(screen.getByLabelText("ERC-20 allowance snapshots")).getByRole("button", { name: "Build Revoke Draft" }));
    fillRevokeFees();
    acknowledgeRevokeWarnings();
    fireEvent.click(revokePanel().getByRole("button", { name: "Submit revoke" }));

    await waitFor(() => expect(onSubmitAssetApprovalRevoke).toHaveBeenCalledTimes(1));
    const payload = onSubmitAssetApprovalRevoke.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.accountIndex).toBe(1);
    expect(payload).not.toHaveProperty("fromAccountIndex");
  });

  it("builds an NFT operator revoke draft with setApprovalForAll(operator, false)", () => {
    renderAssets(
      state({
        nftApprovalSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenB,
            kind: "erc721ApprovalForAll",
            operator,
            approved: true,
            status: "active",
            source: { kind: "rpcPointRead" },
            createdAt: "1",
            updatedAt: "2",
          },
        ],
      }),
    );

    fireEvent.click(within(screen.getByLabelText("NFT approval snapshots")).getByRole("button", { name: "Build Revoke Draft" }));
    fillRevokeFees();
    acknowledgeRevokeWarnings();

    const panel = revokePanel();
    expect(panel.getByText("setApprovalForAll(address,bool)")).toBeInTheDocument();
    expect(panel.getByText("0xa22cb465")).toBeInTheDocument();
    expect(panel.getByText(new RegExp(`to = token/approval contract ${tokenB}`))).toBeInTheDocument();
    expect(panel.getAllByText(new RegExp(`operator=${operator}`)).length).toBeGreaterThan(0);
    expect(panel.getByText(/approved=false/)).toBeInTheDocument();
  });

  it("builds an ERC-721 token-specific revoke draft with approve(address(0), tokenId)", () => {
    renderAssets(
      state({
        nftApprovalSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenB,
            kind: "erc721TokenApproval",
            operator: tokenOperator,
            tokenId: "42",
            approved: true,
            status: "active",
            source: { kind: "rpcPointRead" },
            createdAt: "1",
            updatedAt: "2",
          },
        ],
      }),
    );

    fireEvent.click(within(screen.getByLabelText("NFT approval snapshots")).getByRole("button", { name: "Build Revoke Draft" }));
    fillRevokeFees();
    acknowledgeRevokeWarnings();

    const panel = revokePanel();
    expect(panel.getByText("approve(address,uint256)")).toBeInTheDocument();
    expect(panel.getByText("0x095ea7b3")).toBeInTheDocument();
    expect(panel.getByText(/approved=0x0000000000000000000000000000000000000000/)).toBeInTheDocument();
    expect(panel.getAllByText(/tokenId=42/).length).toBeGreaterThan(0);
    expect(panel.getByText(new RegExp(`current approved operator ${tokenOperator}`))).toBeInTheDocument();
  });

  it("keeps stale, unknown, failed, zero, and revoked snapshots from building revoke drafts", () => {
    renderAssets(
      state({
        allowanceSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender,
            allowanceRaw: "100",
            status: "active",
            source: { kind: "rpcPointRead" },
            staleAfter: "1",
            createdAt: "1",
            updatedAt: "2",
          },
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender: freshSpender,
            allowanceRaw: "100",
            status: "unknown",
            source: { kind: "rpcPointRead" },
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
            approved: true,
            status: "readFailed",
            source: { kind: "unavailable" },
            createdAt: "1",
            updatedAt: "2",
          },
          {
            chainId: 1,
            owner,
            tokenContract: tokenB,
            kind: "erc721TokenApproval",
            operator: tokenOperator,
            tokenId: "42",
            approved: false,
            status: "revoked",
            source: { kind: "rpcPointRead" },
            createdAt: "1",
            updatedAt: "2",
          },
        ],
      }),
    );

    expect(screen.queryByRole("button", { name: "Build Revoke Draft" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Revoke draft unavailable" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(screen.getAllByText(/rescan required|zero or inactive|revoked or inactive/).length).toBeGreaterThan(0);
  });

  it("requires warning acknowledgements before the revoke draft is ready", () => {
    renderAssets(
      state({
        allowanceSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender,
            allowanceRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
            status: "active",
            source: { kind: "indexerCandidate" },
            createdAt: "1",
            updatedAt: "2",
          },
        ],
      }),
    );

    fireEvent.click(within(screen.getByLabelText("ERC-20 allowance snapshots")).getByRole("button", { name: "Build Revoke Draft" }));
    fillRevokeFees();

    expect(revokePanel().getByText("Blocked until required fields and acknowledgements are complete")).toBeInTheDocument();
    expect(revokePanel().getByText(/allowance appears unlimited/)).toBeInTheDocument();
    expect(revokePanel().getByText(/not RPC-confirmed/)).toBeInTheDocument();

    acknowledgeRevokeWarnings();

    expect(revokePanel().getByText("Ready after acknowledgements")).toBeInTheDocument();
  });

  it("blocks negative latest and base fee references instead of treating them as omitted", () => {
    renderAssets(
      state({
        allowanceSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender,
            allowanceRaw: "100",
            status: "active",
            source: { kind: "rpcPointRead" },
            createdAt: "1",
            updatedAt: "2",
          },
        ],
      }),
    );

    fireEvent.click(within(screen.getByLabelText("ERC-20 allowance snapshots")).getByRole("button", { name: "Build Revoke Draft" }));
    fillRevokeFees();
    acknowledgeRevokeWarnings();

    expect(revokePanel().getByText("Ready after acknowledgements")).toBeInTheDocument();

    fireEvent.change(revokePanel().getByLabelText("Latest base fee (gwei)"), { target: { value: "-1" } });
    expect(revokePanel().getByText("Blocked until required fields and acknowledgements are complete")).toBeInTheDocument();
    expect(revokePanel().getByText(/Latest base fee must be non-negative/)).toBeInTheDocument();

    fireEvent.change(revokePanel().getByLabelText("Latest base fee (gwei)"), { target: { value: "10" } });
    fireEvent.change(revokePanel().getByLabelText("Base fee (gwei)"), { target: { value: "-1" } });
    expect(revokePanel().getByText("Blocked until required fields and acknowledgements are complete")).toBeInTheDocument();
    expect(revokePanel().getByText(/Base fee must be non-negative/)).toBeInTheDocument();
  });

  it("blocks malformed optional latest and base fee references until cleared", () => {
    renderAssets(
      state({
        allowanceSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender,
            allowanceRaw: "100",
            status: "active",
            source: { kind: "rpcPointRead" },
            createdAt: "1",
            updatedAt: "2",
          },
        ],
      }),
    );

    fireEvent.click(within(screen.getByLabelText("ERC-20 allowance snapshots")).getByRole("button", { name: "Build Revoke Draft" }));
    fillRevokeFees();
    acknowledgeRevokeWarnings();

    fireEvent.change(revokePanel().getByLabelText("Latest base fee (gwei)"), { target: { value: "abc" } });
    expect(revokePanel().getByText("Blocked until required fields and acknowledgements are complete")).toBeInTheDocument();
    expect(revokePanel().getByText(/Latest base fee must be non-negative/)).toBeInTheDocument();
    expect(revokePanel().getByText("Invalid")).toBeInTheDocument();
    expect(revokePanel().queryByText("abc")).not.toBeInTheDocument();

    fireEvent.change(revokePanel().getByLabelText("Latest base fee (gwei)"), { target: { value: "" } });
    expect(revokePanel().getByText("Ready after acknowledgements")).toBeInTheDocument();
    expect(revokePanel().getAllByText("Not provided").length).toBeGreaterThan(0);

    fireEvent.change(revokePanel().getByLabelText("Base fee (gwei)"), { target: { value: "1..2" } });
    expect(revokePanel().getByText("Blocked until required fields and acknowledgements are complete")).toBeInTheDocument();
    expect(revokePanel().getByText(/Base fee must be non-negative/)).toBeInTheDocument();
    expect(revokePanel().getByText("Invalid")).toBeInTheDocument();
    expect(revokePanel().queryByText("1..2")).not.toBeInTheDocument();

    fireEvent.change(revokePanel().getByLabelText("Base fee (gwei)"), { target: { value: "" } });
    expect(revokePanel().getByText("Ready after acknowledgements")).toBeInTheDocument();
  });

  it("shows frozen version, time key, and sanitized snapshot source and ref context", () => {
    renderAssets(
      state({
        allowanceSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender,
            allowanceRaw: "100",
            status: "active",
            source: {
              kind: "explorerCandidate",
              label: "Watched token: secret-token",
              sourceId: "explorer api_key: secret-key",
              summary: "wss://explorer.example/path/secret-token?apikey=secret",
              providerHint:
                "Bearer secret-token Basic abcdef Authorization=secret-auth password: secret-pass authToken: secret-auth-token privateKey=0xabc mnemonic: word word signature: sig-secret rawTx: raw-secret",
              observedAt: "2026-04-29T00:00:00.000Z",
            },
            lastScannedAt: "101",
            staleAfter: "9999999999",
            rpcIdentity: "wss://rpc.example.invalid/v3/secret-token?apikey=secret",
            rpcProfileId: "profile token=secret-token",
            createdAt: "1",
            updatedAt: "2",
          },
        ],
      }),
    );

    fireEvent.click(within(screen.getByLabelText("ERC-20 allowance snapshots")).getByRole("button", { name: "Build Revoke Draft" }));
    fillRevokeFees();
    acknowledgeRevokeWarnings();

    const panel = screen.getByLabelText("Revoke draft confirmation");
    expect(panel).toHaveTextContent("Frozen version");
    expect(panel).toHaveTextContent("Frozen time key");
    expect(panel).toHaveTextContent(/asset-revoke-time-/);
    expect(panel).toHaveTextContent("Created at");
    expect(panel).toHaveTextContent("Frozen at");
    expect(panel).toHaveTextContent("sourceId=explorer api_key: [redacted]");
    expect(panel).toHaveTextContent("label=Watched token: [redacted]");
    expect(panel).toHaveTextContent("summary=wss://explorer.example/<redacted_path>?apikey=[redacted]");
    expect(panel).toHaveTextContent(
      "providerHint=Bearer [redacted] Basic [redacted] Authorization=[redacted] password: [redacted] authToken: [redacted] privateKey=[redacted] mnemonic: [redacted] signature: [redacted] rawTx: [redacted]",
    );
    expect(panel).toHaveTextContent("observedAt=2026-04-29T00:00:00.000Z");
    expect(panel).toHaveTextContent("createdAt=1");
    expect(panel).toHaveTextContent("updatedAt=2");
    expect(panel).toHaveTextContent("lastScannedAt=101");
    expect(panel).toHaveTextContent("staleAfter=9999999999");
    expect(panel).toHaveTextContent("rpcIdentity=wss://rpc.example.invalid/<redacted_path>?apikey=[redacted]");
    expect(panel).toHaveTextContent("rpcProfileId=profile token=[redacted]");
    expect(panel).not.toHaveTextContent("secret-token");
    expect(panel).not.toHaveTextContent("secret-key");
    expect(panel).not.toHaveTextContent("secret-pass");
    expect(panel).not.toHaveTextContent("secret-auth-token");
    expect(panel).not.toHaveTextContent("0xabc");
    expect(panel).not.toHaveTextContent("word word");
    expect(panel).not.toHaveTextContent("sig-secret");
    expect(panel).not.toHaveTextContent("raw-secret");
    expect(panel).not.toHaveTextContent("abcdef");
    expect(panel).not.toHaveTextContent("secret-auth");
    expect(panel).not.toHaveTextContent("/v3/");
    expect(panel).not.toHaveTextContent("/path/");
    expect(panel).not.toHaveTextContent("apikey=secret");
  });

  it("invalidates the frozen key when nonce, gas, fee, snapshot identity, or warning acknowledgements change", () => {
    renderAssets(
      state({
        allowanceSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender,
            allowanceRaw: "100",
            status: "active",
            source: { kind: "rpcPointRead" },
            createdAt: "1",
            updatedAt: "2",
          },
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender: freshSpender,
            allowanceRaw: "100",
            status: "active",
            source: { kind: "rpcPointRead" },
            createdAt: "1",
            updatedAt: "2",
          },
        ],
      }),
    );

    const allowances = within(screen.getByLabelText("ERC-20 allowance snapshots"));
    const buildButtons = allowances.getAllByRole("button", { name: "Build Revoke Draft" });
    fireEvent.click(buildButtons[0]);
    fillRevokeFees();
    acknowledgeRevokeWarnings();
    const baseFrozenKey = frozenKey();

    fireEvent.change(revokePanel().getByLabelText("Nonce"), { target: { value: "8" } });
    expect(frozenKey()).not.toBe(baseFrozenKey);
    fireEvent.change(revokePanel().getByLabelText("Nonce"), { target: { value: "7" } });
    expect(frozenKey()).toBe(baseFrozenKey);

    fireEvent.change(revokePanel().getByLabelText("Gas limit"), { target: { value: "60000" } });
    expect(frozenKey()).not.toBe(baseFrozenKey);
    fireEvent.change(revokePanel().getByLabelText("Gas limit"), { target: { value: "50000" } });

    fireEvent.change(revokePanel().getByLabelText("Max fee (gwei)"), { target: { value: "13" } });
    expect(frozenKey()).not.toBe(baseFrozenKey);
    fireEvent.change(revokePanel().getByLabelText("Max fee (gwei)"), { target: { value: "12" } });

    const firstWarning = within(screen.getByLabelText("Revoke warning acknowledgements")).getAllByRole("checkbox")[0];
    fireEvent.click(firstWarning);
    expect(frozenKey()).not.toBe(baseFrozenKey);

    fireEvent.click(buildButtons[1]);
    fillRevokeFees();
    acknowledgeRevokeWarnings();
    expect(frozenKey()).not.toBe(baseFrozenKey);
  });

  it("clears manual fee, gas, nonce inputs and acknowledgements when switching approvals", () => {
    renderAssets(
      state({
        allowanceSnapshots: [
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender,
            allowanceRaw: "100",
            status: "active",
            source: { kind: "rpcPointRead" },
            createdAt: "1",
            updatedAt: "2",
          },
          {
            chainId: 1,
            owner,
            tokenContract: tokenA,
            spender: freshSpender,
            allowanceRaw: "100",
            status: "active",
            source: { kind: "indexerCandidate" },
            createdAt: "1",
            updatedAt: "2",
          },
        ],
      }),
    );

    const allowances = within(screen.getByLabelText("ERC-20 allowance snapshots"));
    const buildButtons = allowances.getAllByRole("button", { name: "Build Revoke Draft" });
    fireEvent.click(buildButtons[0]);
    fillRevokeFees();
    acknowledgeRevokeWarnings();

    expect(revokePanel().getByLabelText("Nonce")).toHaveValue("7");
    expect(revokePanel().getByLabelText("Gas limit")).toHaveValue("50000");
    expect(revokePanel().getByLabelText("Max fee (gwei)")).toHaveValue("12");

    fireEvent.click(buildButtons[1]);

    expect(revokePanel().getByLabelText("Nonce")).toHaveValue("");
    expect(revokePanel().getByLabelText("Gas limit")).toHaveValue("");
    expect(revokePanel().getByLabelText("Max fee (gwei)")).toHaveValue("");
    expect(revokePanel().getByLabelText("Priority fee (gwei)")).toHaveValue("");
    expect(
      within(screen.getByLabelText("Revoke warning acknowledgements"))
        .getAllByRole("checkbox")
        .every((checkbox) => !(checkbox as HTMLInputElement).checked),
    ).toBe(true);
  });
});
