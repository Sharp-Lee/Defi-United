import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TokenWatchlistState } from "../../lib/tauri";
import { renderScreen } from "../../test/render";
import { TokensView } from "./TokensView";

const tokenContract = "0x3333333333333333333333333333333333333333";
const account = "0x1111111111111111111111111111111111111111";

function watchlistState(overrides: Partial<TokenWatchlistState> = {}): TokenWatchlistState {
  return {
    schemaVersion: 1,
    watchlistTokens: [
      {
        chainId: 1,
        tokenContract,
        label: "USD Coin",
        userNotes: "local config",
        pinned: false,
        hidden: false,
        createdAt: "1710000000",
        updatedAt: "1710000000",
      },
    ],
    tokenMetadataCache: [],
    tokenScanState: [
      {
        chainId: 1,
        tokenContract,
        status: "failed",
        createdAt: "1710000000",
        lastStartedAt: "1710000001",
        lastFinishedAt: "1710000002",
        updatedAt: "1710000002",
        lastErrorSummary: "eth_call failed: execution reverted",
      },
    ],
    erc20BalanceSnapshots: [
      {
        account,
        chainId: 1,
        tokenContract,
        balanceRaw: "1500000",
        balanceStatus: "balanceCallFailed",
        createdAt: "1710000000",
        updatedAt: "1710000003",
        lastScannedAt: "1710000003",
        lastErrorSummary: "balanceCallFailed: timeout",
        resolvedMetadata: {
          symbol: "USDC",
          name: "USD Coin",
          decimals: 6,
          source: "onChainCall",
          status: "ok",
        },
      },
    ],
    resolvedTokenMetadata: [
      {
        chainId: 1,
        tokenContract,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        source: "onChainCall",
        status: "ok",
        updatedAt: "1710000002",
      },
    ],
    ...overrides,
  };
}

function renderTokens(
  state = watchlistState(),
  handlers: {
    onAddToken?: ReturnType<typeof vi.fn>;
    onEditToken?: ReturnType<typeof vi.fn>;
    onRemoveToken?: ReturnType<typeof vi.fn>;
    onScanBalance?: ReturnType<typeof vi.fn>;
    onScanMetadata?: ReturnType<typeof vi.fn>;
    onScanSelectedAccount?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const props = {
    onAddToken: handlers.onAddToken ?? vi.fn(),
    onEditToken: handlers.onEditToken ?? vi.fn(),
    onRemoveToken: handlers.onRemoveToken ?? vi.fn(),
    onScanBalance: handlers.onScanBalance ?? vi.fn(),
    onScanMetadata: handlers.onScanMetadata ?? vi.fn(),
    onScanSelectedAccount: handlers.onScanSelectedAccount ?? vi.fn(),
  };
  renderScreen(
    <TokensView
      accounts={[
        {
          address: account,
          index: 1,
          label: "Account 1",
          nativeBalanceWei: 1n,
          nonce: 0,
        },
      ]}
      rpcReady={true}
      selectedChainId={1n}
      state={state}
      {...props}
    />,
  );
  return props;
}

describe("TokensView", () => {
  it("renders metadata and balance failures without hiding raw balance", () => {
    renderTokens();

    expect(screen.getByText("Watchlist")).toBeInTheDocument();
    expect(screen.getByText("Scan failed")).toBeInTheDocument();
    expect(screen.getByText("eth_call failed: execution reverted")).toBeInTheDocument();
    expect(screen.getByText("Balance call failed")).toBeInTheDocument();
    expect(screen.getByText("balanceCallFailed: timeout")).toBeInTheDocument();
    expect(screen.getByText("1500000")).toBeInTheDocument();
    expect(screen.getByText("1.5")).toBeInTheDocument();
    expect(screen.getByText(/Removing one does not change transaction history/)).toBeInTheDocument();
  });

  it("uses current metadata conflict status to hide human amount and show conflict detail", () => {
    renderTokens(
      watchlistState({
        watchlistTokens: [
          {
            chainId: 1,
            tokenContract,
            label: "USD Coin",
            userNotes: "local config",
            pinned: false,
            hidden: false,
            createdAt: "1710000000",
            updatedAt: "1710000004",
            metadataOverride: {
              symbol: "USDC",
              name: "USD Coin",
              decimals: 6,
              source: "userConfirmed",
              confirmedAt: "1710000004",
            },
          },
        ],
        tokenMetadataCache: [
          {
            chainId: 1,
            tokenContract,
            rawSymbol: "USDT",
            rawName: "Tether USD",
            rawDecimals: 18,
            source: "onChainCall",
            status: "ok",
            createdAt: "1710000001",
            updatedAt: "1710000004",
            lastScannedAt: "1710000004",
          },
        ],
        resolvedTokenMetadata: [
          {
            chainId: 1,
            tokenContract,
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
            source: "userConfirmed",
            status: "sourceConflict",
            updatedAt: "1710000004",
          },
        ],
      }),
    );

    const balancesSection = screen.getByLabelText("ERC-20 balances");
    expect(within(balancesSection).getByText("1500000")).toBeInTheDocument();
    expect(within(balancesSection).getByText("Unavailable")).toBeInTheDocument();
    expect(within(balancesSection).queryByText("1.5")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Source conflict/).length).toBeGreaterThan(0);
    expect(screen.getByText(/decimals userConfirmed 6 vs onChainCall 18/)).toBeInTheDocument();
    expect(screen.getByText(/symbol userConfirmed USDC vs onChainCall USDT/)).toBeInTheDocument();
  });

  it("shows previous and observed decimals for decimalsChanged metadata", () => {
    renderTokens(
      watchlistState({
        tokenMetadataCache: [
          {
            chainId: 1,
            tokenContract,
            rawSymbol: "USDC",
            rawName: "USD Coin",
            rawDecimals: 18,
            source: "onChainCall",
            status: "decimalsChanged",
            createdAt: "1710000001",
            updatedAt: "1710000004",
            lastScannedAt: "1710000004",
            previousDecimals: 6,
            observedDecimals: 18,
          },
        ],
        resolvedTokenMetadata: [
          {
            chainId: 1,
            tokenContract,
            symbol: "USDC",
            name: "USD Coin",
            decimals: 18,
            source: "onChainCall",
            status: "decimalsChanged",
            updatedAt: "1710000004",
          },
        ],
      }),
    );

    const balancesSection = screen.getByLabelText("ERC-20 balances");
    expect(within(balancesSection).getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Decimals changed: previous 6, observed 18/)).toBeInTheDocument();
  });

  it("calls scan handlers for one token and selected account retry", () => {
    const onScanMetadata = vi.fn();
    const onScanBalance = vi.fn();
    const onScanSelectedAccount = vi.fn();
    renderTokens(watchlistState(), {
      onScanMetadata,
      onScanBalance,
      onScanSelectedAccount,
    });

    const watchlistSection = screen.getByLabelText("Watchlist tokens");
    fireEvent.click(within(watchlistSection).getByRole("button", { name: "Scan" }));
    expect(onScanMetadata).toHaveBeenCalledWith(1, tokenContract);

    const balancesSection = screen.getByLabelText("ERC-20 balances");
    fireEvent.click(within(balancesSection).getByRole("button", { name: "Scan" }));
    expect(onScanBalance).toHaveBeenCalledWith(account, 1, tokenContract);

    fireEvent.click(within(balancesSection).getByRole("button", { name: "Retry Failed" }));
    expect(onScanSelectedAccount).toHaveBeenCalledWith(account, true);
  });

  it("submits add and edit inputs without changing token identity", async () => {
    const onAddToken = vi.fn();
    const onEditToken = vi.fn();
    renderTokens(watchlistState(), { onAddToken, onEditToken });

    fireEvent.change(screen.getByLabelText("Token contract"), {
      target: { value: "0x4444444444444444444444444444444444444444" },
    });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Test Token" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(onAddToken).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: 1,
          tokenContract: "0x4444444444444444444444444444444444444444",
          label: "Test Token",
        }),
        "chain-1",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Symbol override"), { target: { value: "USDC" } });
    fireEvent.change(screen.getByLabelText("Decimals override"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onEditToken).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: 1,
          tokenContract,
          metadataOverride: expect.objectContaining({ decimals: 6, source: "userConfirmed" }),
        }),
      ),
    );
  });

  it("preserves add form input when parent reports failure", async () => {
    const onAddToken = vi.fn().mockResolvedValue(false);
    renderTokens(watchlistState(), { onAddToken });

    fireEvent.change(screen.getByLabelText("Token contract"), {
      target: { value: "0x4444444444444444444444444444444444444444" },
    });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Test Token" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onAddToken).toHaveBeenCalled());
    expect(screen.getByLabelText("Token contract")).toHaveValue(
      "0x4444444444444444444444444444444444444444",
    );
    expect(screen.getByLabelText("Label")).toHaveValue("Test Token");
  });
});
