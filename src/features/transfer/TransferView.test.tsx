import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Interface } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenWatchlistState } from "../../lib/tauri";
import { submitErc20Transfer, submitNativeTransfer } from "../../lib/tauri";
import { renderScreen } from "../../test/render";
import { TransferView, type TransferViewProps } from "./TransferView";

const provider = vi.hoisted(() => ({
  call: vi.fn(),
  estimateGas: vi.fn(),
  getBalance: vi.fn(),
  getBlock: vi.fn(),
  getFeeData: vi.fn(),
  getNetwork: vi.fn(),
  getTransactionCount: vi.fn(),
}));

const erc20Interface = new Interface([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ...actual,
    JsonRpcProvider: vi.fn(() => provider),
  };
});

vi.mock("../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/tauri")>();
  return {
    ...actual,
    submitErc20Transfer: vi.fn(),
    submitNativeTransfer: vi.fn(),
  };
});

describe("TransferView", () => {
  beforeEach(() => {
    vi.mocked(submitNativeTransfer).mockReset();
    vi.mocked(submitErc20Transfer).mockReset();
    provider.getNetwork.mockResolvedValue({ chainId: 1n });
    provider.getFeeData.mockResolvedValue({
      gasPrice: 30_000_000_000n,
      maxFeePerGas: 40_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
    });
    provider.getBlock.mockResolvedValue({ baseFeePerGas: 20_000_000_000n });
    provider.getTransactionCount.mockResolvedValue(7);
    provider.estimateGas.mockResolvedValue(21_000n);
    provider.getBalance.mockResolvedValue(1_000_000_000_000_000_000n);
    provider.call.mockImplementation(async ({ data }) => {
      if (data === erc20Interface.encodeFunctionData("decimals")) {
        return erc20Interface.encodeFunctionResult("decimals", [6]);
      }
      if (data === erc20Interface.encodeFunctionData("symbol")) {
        return erc20Interface.encodeFunctionResult("symbol", ["USDC"]);
      }
      if (data === erc20Interface.encodeFunctionData("name")) {
        return erc20Interface.encodeFunctionResult("name", ["USD Coin"]);
      }
      if (data.startsWith(erc20Interface.getFunction("balanceOf")!.selector)) {
        return erc20Interface.encodeFunctionResult("balanceOf", [2_000_000n]);
      }
      throw new Error("unexpected ERC-20 call");
    });
  });

  function renderTransfer(
    onSubmitted = vi.fn(),
    options: {
      historyStorageIssue?: string | null;
      onSubmitFailed?: (error: unknown) => Promise<void> | void;
      tokenWatchlistState?: TokenWatchlistState | null;
      accounts?: TransferViewProps["accounts"];
    } = {},
  ) {
    renderScreen(
      <TransferView
        accounts={
          options.accounts ?? [
            {
              address: "0x1111111111111111111111111111111111111111",
              index: 1,
              label: "Account 1",
              nativeBalanceWei: 1_000_000_000_000_000_000n,
              nonce: 7,
            },
          ]
        }
        chainId={1n}
        chainName="Ethereum"
        draft={null}
        historyStorageIssue={options.historyStorageIssue}
        onSubmitFailed={options.onSubmitFailed}
        onSubmitted={onSubmitted}
        rpcUrl="http://127.0.0.1:8545"
        tokenWatchlistState={options.tokenWatchlistState}
      />,
    );
  }

  function watchlistState(
    metadataStatus: TokenWatchlistState["resolvedTokenMetadata"][number]["status"] = "ok",
    balanceStatus: TokenWatchlistState["erc20BalanceSnapshots"][number]["balanceStatus"] = "ok",
  ): TokenWatchlistState {
    const tokenHasOverride = metadataStatus === "sourceConflict";
    return {
      schemaVersion: 1,
      watchlistTokens: [
        {
          chainId: 1,
          tokenContract: "0x3333333333333333333333333333333333333333",
          label: "USD Coin",
          userNotes: null,
          pinned: false,
          hidden: false,
          createdAt: "1710000000",
          updatedAt: "1710000000",
          metadataOverride: tokenHasOverride
            ? {
                symbol: "USDC",
                name: "USD Coin",
                decimals: 6,
                source: "userConfirmed",
                confirmedAt: "1710000000",
              }
            : null,
        },
      ],
      tokenMetadataCache:
        metadataStatus === "decimalsChanged"
          ? [
              {
                chainId: 1,
                tokenContract: "0x3333333333333333333333333333333333333333",
                rawSymbol: "USDC",
                rawName: "USD Coin",
                rawDecimals: 18,
                source: "onChainCall",
                status: "decimalsChanged",
                createdAt: "1710000000",
                updatedAt: "1710000001",
                lastScannedAt: "1710000001",
                previousDecimals: 6,
                observedDecimals: 18,
              },
            ]
          : [
              {
                chainId: 1,
                tokenContract: "0x3333333333333333333333333333333333333333",
                rawSymbol: metadataStatus === "sourceConflict" ? "USDT" : "USDC",
                rawName: metadataStatus === "sourceConflict" ? "Tether USD" : "USD Coin",
                rawDecimals: metadataStatus === "sourceConflict" ? 18 : 6,
                source: "onChainCall",
                status: "ok",
                createdAt: "1710000000",
                updatedAt: "1710000001",
                lastScannedAt: "1710000001",
              },
            ],
      tokenScanState: [],
      erc20BalanceSnapshots: [
        {
          account: "0x1111111111111111111111111111111111111111",
          chainId: 1,
          tokenContract: "0x3333333333333333333333333333333333333333",
          balanceRaw: "2000000",
          balanceStatus,
          createdAt: "1710000000",
          updatedAt: "1710000001",
          lastScannedAt: "1710000001",
          lastErrorSummary:
            balanceStatus === "balanceCallFailed" ? "balanceCallFailed: timeout" : null,
          resolvedMetadata: {
            symbol: "USDC",
            name: "USD Coin",
            decimals: metadataStatus === "missingDecimals" ? null : 6,
            source: "onChainCall",
            status: metadataStatus,
          },
        },
      ],
      resolvedTokenMetadata: [
        {
          chainId: 1,
          tokenContract: "0x3333333333333333333333333333333333333333",
          symbol: "USDC",
          name: "USD Coin",
          decimals:
            metadataStatus === "missingDecimals" ? null : metadataStatus === "decimalsChanged" ? 18 : 6,
          source: tokenHasOverride ? "userConfirmed" : "onChainCall",
          status: metadataStatus,
          updatedAt: "1710000001",
        },
      ],
    };
  }

  async function buildValidDraft() {
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0.01" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));
    await waitFor(() => expect(screen.getByText("Confirm Transfer")).toBeInTheDocument());
  }

  it("keeps the built draft after auto-filling fee and nonce fields", async () => {
    renderTransfer();

    await buildValidDraft();
    await waitFor(() => expect(screen.getByText("Frozen key")).toBeInTheDocument());
    expect(screen.getByText("Ethereum (chainId 1)")).toBeInTheDocument();
    expect(screen.getByText("0x1111111111111111111111111111111111111111")).toBeInTheDocument();
    expect(screen.getByText("0x2222222222222222222222222222222222222222")).toBeInTheDocument();
    expect(screen.getByText("0.01 native (10000000000000000 wei)")).toBeInTheDocument();
    expect(screen.getByDisplayValue("20.0")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1.5")).toBeInTheDocument();
    expect(screen.getByText("Latest base fee reference")).toBeInTheDocument();
    expect(screen.getAllByText("20.0 gwei").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("41.5 gwei")).toBeInTheDocument();
    expect(screen.getByText("0.0008715 native (871500000000000 wei)")).toBeInTheDocument();
    expect(screen.getByText("0.0108715 native (10871500000000000 wei)")).toBeInTheDocument();
    expect(screen.getByLabelText("Max fee override (gwei)")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("uses a manual base fee override for automatic max fee calculation", async () => {
    renderTransfer();

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0.01" } });
    fireEvent.change(screen.getByLabelText("Base fee (gwei)"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Base fee multiplier"), { target: { value: "1.25" } });
    fireEvent.change(screen.getByLabelText("Priority fee (gwei)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText("Confirm Transfer")).toBeInTheDocument());
    expect(screen.getByText("Base fee used")).toBeInTheDocument();
    expect(screen.getByText("25.0 gwei")).toBeInTheDocument();
    expect(screen.getByText("1.25")).toBeInTheDocument();
    expect(screen.getByText("33.25 gwei")).toBeInTheDocument();
    expect(screen.getByLabelText("Max fee override (gwei)")).toHaveValue("");
  });

  it("refreshes an auto-filled base fee on rebuild unless the user edited it manually", async () => {
    provider.getBlock
      .mockResolvedValueOnce({ baseFeePerGas: 20_000_000_000n })
      .mockResolvedValueOnce({ baseFeePerGas: 30_000_000_000n })
      .mockResolvedValueOnce({ baseFeePerGas: 40_000_000_000n });
    renderTransfer();

    await buildValidDraft();
    expect(screen.getByDisplayValue("20.0")).toBeInTheDocument();
    expect(screen.getByText("41.5 gwei")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0.02" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText("61.5 gwei")).toBeInTheDocument());
    expect(screen.getByDisplayValue("30.0")).toBeInTheDocument();
    expect(screen.getAllByText("30.0 gwei").length).toBeGreaterThanOrEqual(1);

    fireEvent.change(screen.getByLabelText("Base fee (gwei)"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0.03" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText("51.5 gwei")).toBeInTheDocument());
    expect(screen.getByDisplayValue("25")).toBeInTheDocument();
    expect(screen.getByText("40.0 gwei")).toBeInTheDocument();
    expect(screen.getByText("25.0 gwei")).toBeInTheDocument();
  });

  it("uses max fee override as the final max fee without replacing the input", async () => {
    renderTransfer();

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0.01" } });
    fireEvent.change(screen.getByLabelText("Max fee override (gwei)"), {
      target: { value: "55" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText("Confirm Transfer")).toBeInTheDocument());
    expect(screen.getByText("55.0 gwei")).toBeInTheDocument();
    expect(screen.getByLabelText("Max fee override (gwei)")).toHaveValue("55");
  });

  it("requires manual base fee when the latest block has no base fee", async () => {
    provider.getBlock.mockResolvedValueOnce({ baseFeePerGas: null });
    renderTransfer();

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0.01" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText("Transfer input needs review")).toBeInTheDocument());
    expect(screen.getByText(/Latest block did not provide baseFeePerGas/)).toBeInTheDocument();
  });

  it("requires extra confirmation when the used base fee is far above latest base fee", async () => {
    renderTransfer();

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0.01" } });
    fireEvent.change(screen.getByLabelText("Base fee (gwei)"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText("High fee risk")).toBeInTheDocument());
    expect(screen.getByLabelText("Confirm high-risk fee settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });

  it("classifies broadcast success with local history write failure during submit", async () => {
    vi.mocked(submitNativeTransfer).mockRejectedValue(
      new Error(
        "broadcast succeeded with tx hash 0xabcdef1234567890 but local history write failed: permission denied",
      ),
    );
    const onSubmitted = vi.fn();
    renderTransfer(onSubmitted);

    await buildValidDraft();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(
        screen.getByText("Broadcast may have succeeded; local history write failed"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText(/Keep the transaction hash from the error message if present/)).toBeInTheDocument();
    expect(screen.getByText(/tx hash 0xabcdef1234567890/)).toBeInTheDocument();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("classifies local build validation errors without broadcast guidance", async () => {
    renderTransfer();

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "not an address" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0.01" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText("Transfer input needs review")).toBeInTheDocument());
    expect(screen.getByText("Validation")).toBeInTheDocument();
    expect(screen.getByText("Destination address is invalid.")).toBeInTheDocument();
    expect(screen.queryByText("Broadcast error")).not.toBeInTheDocument();
    expect(screen.queryByText(/Review the RPC error, account balance, nonce, and fee inputs/)).not.toBeInTheDocument();
  });

  it("disables draft building while local history is unreadable", () => {
    renderTransfer(vi.fn(), {
      historyStorageIssue:
        "Local transaction history is unreadable. Submission is disabled until history is retried or the damaged file is quarantined.",
    });

    expect(screen.getByRole("button", { name: "Build Draft" })).toBeDisabled();
    expect(screen.getByText(/Local transaction history is unreadable/)).toBeInTheDocument();
  });

  it("notifies the app shell when submit discovers unreadable history", async () => {
    const error = new Error(
      "transaction history storage is unreadable: type=jsonParseFailed; records=0; invalidRecords=0; error=expected value",
    );
    vi.mocked(submitNativeTransfer).mockRejectedValue(error);
    const onSubmitFailed = vi.fn();
    renderTransfer(vi.fn(), { onSubmitFailed });

    await buildValidDraft();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(onSubmitFailed).toHaveBeenCalledWith(error));
    expect(screen.getByText(/transaction history storage is unreadable/)).toBeInTheDocument();
  });

  it("builds an ERC-20 draft with transaction target, calldata recipient, raw amount, and metadata source", async () => {
    provider.estimateGas.mockResolvedValueOnce(65_000n);
    renderTransfer();

    fireEvent.click(screen.getByRole("button", { name: "ERC-20" }));
    fireEvent.change(screen.getByLabelText("Token contract"), {
      target: { value: "0x3333333333333333333333333333333333333333" },
    });
    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText("Confirm ERC-20 Transfer")).toBeInTheDocument());
    expect(screen.getByText("Transaction to")).toBeInTheDocument();
    expect(screen.getAllByText("0x3333333333333333333333333333333333333333").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Recipient calldata parameter")).toBeInTheDocument();
    expect(screen.getByText("0x2222222222222222222222222222222222222222")).toBeInTheDocument();
    expect(screen.getByText("1.5 token units (1500000 raw)")).toBeInTheDocument();
    expect(screen.getByText("6 (onChainCall)")).toBeInTheDocument();
    expect(screen.getByText("0xa9059cbb")).toBeInTheDocument();
    expect(screen.getByText("0 wei")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("selects an ERC-20 token from the watchlist and keeps transaction target distinct", async () => {
    provider.estimateGas.mockResolvedValueOnce(65_000n);
    renderTransfer(vi.fn(), { tokenWatchlistState: watchlistState() });

    fireEvent.click(screen.getByRole("button", { name: "ERC-20" }));
    fireEvent.change(screen.getByLabelText("Watchlist token"), {
      target: { value: "1:0x3333333333333333333333333333333333333333" },
    });
    expect(screen.getByLabelText("Token contract")).toHaveValue(
      "0x3333333333333333333333333333333333333333",
    );
    expect(screen.getByLabelText("Confirmed decimals")).toHaveValue("6");
    expect(screen.getByText(/Current account balance: 2.0 \(2000000 raw\)/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText("Confirm ERC-20 Transfer")).toBeInTheDocument());
    expect(screen.getByText("Transaction to")).toBeInTheDocument();
    expect(screen.getByText("Recipient calldata parameter")).toBeInTheDocument();
    expect(screen.getAllByText("0x3333333333333333333333333333333333333333").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("0x2222222222222222222222222222222222222222")).toBeInTheDocument();
  });

  it("blocks watchlist-selected ERC-20 drafts when metadata or balance status needs recovery", () => {
    renderTransfer(vi.fn(), {
      tokenWatchlistState: watchlistState("decimalsChanged", "balanceCallFailed"),
    });

    fireEvent.click(screen.getByRole("button", { name: "ERC-20" }));
    fireEvent.change(screen.getByLabelText("Watchlist token"), {
      target: { value: "1:0x3333333333333333333333333333333333333333" },
    });

    expect(screen.getAllByText(/decimalsChanged/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Decimals changed: previous 6, observed 18/).length).toBeGreaterThan(0);
    expect(screen.getByText(/balanceCallFailed: timeout/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build Draft" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Watchlist token"), {
      target: { value: "" },
    });
    expect(screen.getByLabelText("Token contract")).toHaveValue("");
    expect(screen.getByLabelText("Confirmed decimals")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Build Draft" })).toBeEnabled();
  });

  it("does not clear manual ERC-20 token inputs when manual mode was already selected", () => {
    renderTransfer(vi.fn(), { tokenWatchlistState: watchlistState("decimalsChanged") });

    fireEvent.click(screen.getByRole("button", { name: "ERC-20" }));
    fireEvent.change(screen.getByLabelText("Token contract"), {
      target: { value: "0x4444444444444444444444444444444444444444" },
    });
    fireEvent.change(screen.getByLabelText("Confirmed decimals"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Watchlist token"), { target: { value: "" } });

    expect(screen.getByLabelText("Token contract")).toHaveValue(
      "0x4444444444444444444444444444444444444444",
    );
    expect(screen.getByLabelText("Confirmed decimals")).toHaveValue("8");
  });

  it("clears selector-derived decimals when token contract edits leave watchlist mode", () => {
    renderTransfer(vi.fn(), { tokenWatchlistState: watchlistState() });

    fireEvent.click(screen.getByRole("button", { name: "ERC-20" }));
    fireEvent.change(screen.getByLabelText("Watchlist token"), {
      target: { value: "1:0x3333333333333333333333333333333333333333" },
    });
    expect(screen.getByLabelText("Confirmed decimals")).toHaveValue("6");

    fireEvent.change(screen.getByLabelText("Token contract"), {
      target: { value: "0x4444444444444444444444444444444444444444" },
    });

    expect(screen.getByLabelText("Watchlist token")).toHaveValue("");
    expect(screen.getByLabelText("Token contract")).toHaveValue(
      "0x4444444444444444444444444444444444444444",
    );
    expect(screen.getByLabelText("Confirmed decimals")).toHaveValue("");
  });

  it("preserves manually typed decimals when editing a manual token contract", () => {
    renderTransfer(vi.fn(), { tokenWatchlistState: watchlistState() });

    fireEvent.click(screen.getByRole("button", { name: "ERC-20" }));
    fireEvent.change(screen.getByLabelText("Token contract"), {
      target: { value: "0x4444444444444444444444444444444444444444" },
    });
    fireEvent.change(screen.getByLabelText("Confirmed decimals"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Token contract"), {
      target: { value: "0x5555555555555555555555555555555555555555" },
    });

    expect(screen.getByLabelText("Confirmed decimals")).toHaveValue("8");
  });

  it("clears selector-derived token fields when sender changes out of watchlist mode", async () => {
    renderTransfer(vi.fn(), {
      tokenWatchlistState: watchlistState(),
      accounts: [
        {
          address: "0x1111111111111111111111111111111111111111",
          index: 1,
          label: "Account 1",
          nativeBalanceWei: 1_000_000_000_000_000_000n,
          nonce: 7,
        },
        {
          address: "0x2222222222222222222222222222222222222222",
          index: 2,
          label: "Account 2",
          nativeBalanceWei: 1_000_000_000_000_000_000n,
          nonce: 0,
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "ERC-20" }));
    fireEvent.change(screen.getByLabelText("Watchlist token"), {
      target: { value: "1:0x3333333333333333333333333333333333333333" },
    });
    expect(screen.getByLabelText("Token contract")).toHaveValue(
      "0x3333333333333333333333333333333333333333",
    );
    expect(screen.getByLabelText("Confirmed decimals")).toHaveValue("6");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2" } });

    await waitFor(() => expect(screen.getByLabelText("Watchlist token")).toHaveValue(""));
    expect(screen.getByLabelText("Token contract")).toHaveValue("");
    expect(screen.getByLabelText("Confirmed decimals")).toHaveValue("");
  });

  it("preserves manual token fields when sender changes without selector-derived values", async () => {
    renderTransfer(vi.fn(), {
      tokenWatchlistState: watchlistState(),
      accounts: [
        {
          address: "0x1111111111111111111111111111111111111111",
          index: 1,
          label: "Account 1",
          nativeBalanceWei: 1_000_000_000_000_000_000n,
          nonce: 7,
        },
        {
          address: "0x2222222222222222222222222222222222222222",
          index: 2,
          label: "Account 2",
          nativeBalanceWei: 1_000_000_000_000_000_000n,
          nonce: 0,
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "ERC-20" }));
    fireEvent.change(screen.getByLabelText("Token contract"), {
      target: { value: "0x4444444444444444444444444444444444444444" },
    });
    fireEvent.change(screen.getByLabelText("Confirmed decimals"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2" } });

    await waitFor(() =>
      expect(screen.getByLabelText("Token contract")).toHaveValue(
        "0x4444444444444444444444444444444444444444",
      ),
    );
    expect(screen.getByLabelText("Confirmed decimals")).toHaveValue("8");
  });

  it("shows source conflict detail in the ERC-20 watchlist selector", () => {
    renderTransfer(vi.fn(), {
      tokenWatchlistState: watchlistState("sourceConflict"),
    });

    fireEvent.click(screen.getByRole("button", { name: "ERC-20" }));
    fireEvent.change(screen.getByLabelText("Watchlist token"), {
      target: { value: "1:0x3333333333333333333333333333333333333333" },
    });

    expect(screen.getAllByText(/sourceConflict/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/decimals userConfirmed 6 vs onChainCall 18/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/symbol userConfirmed USDC vs onChainCall USDT/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Manual token contract entry remains available/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Build Draft" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Watchlist token"), {
      target: { value: "" },
    });
    expect(screen.getByRole("button", { name: "Build Draft" })).toBeEnabled();
  });

  it("submits ERC-20 frozen draft values through the Rust command and requires rebuild after edits", async () => {
    const onSubmitted = vi.fn();
    vi.mocked(submitErc20Transfer).mockResolvedValue({
      schema_version: 2,
      intent: {} as never,
      intent_snapshot: { source: "test", captured_at: null },
      submission: {} as never,
      outcome: { state: "Pending", tx_hash: "0xerc20", receipt: null, finalized_at: null, reconciled_at: null, reconcile_summary: null, error_summary: null, dropped_review_history: [] },
      nonce_thread: {} as never,
    });
    provider.estimateGas.mockResolvedValueOnce(65_000n);
    renderTransfer(onSubmitted);

    fireEvent.click(screen.getByRole("button", { name: "ERC-20" }));
    fireEvent.change(screen.getByLabelText("Token contract"), {
      target: { value: "0x3333333333333333333333333333333333333333" },
    });
    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText("Confirm ERC-20 Transfer")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(submitErc20Transfer).toHaveBeenCalledTimes(1));
    expect(submitErc20Transfer).toHaveBeenCalledWith(
      expect.objectContaining({
        rpc_url: "http://127.0.0.1:8545",
        account_index: 1,
        chain_id: 1,
        from: "0x1111111111111111111111111111111111111111",
        token_contract: "0x3333333333333333333333333333333333333333",
        recipient: "0x2222222222222222222222222222222222222222",
        amount_raw: "1500000",
        decimals: 6,
        token_metadata_source: "onChainCall",
        nonce: 7,
        gas_limit: "65000",
        max_fee_per_gas: "41500000000",
        max_priority_fee_per_gas: "1500000000",
        selector: "0xa9059cbb",
        method: "transfer(address,uint256)",
        native_value_wei: "0",
        frozen_key: expect.stringContaining("amountRaw=1500000"),
      }),
    );
    expect(onSubmitted).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2.0" } });
    expect(screen.queryByText("Confirm ERC-20 Transfer")).not.toBeInTheDocument();
  });

  it("shows ERC-20 metadata failures as visible draft errors", async () => {
    provider.call.mockRejectedValueOnce(new Error("execution reverted"));
    renderTransfer();

    fireEvent.click(screen.getByRole("button", { name: "ERC-20" }));
    fireEvent.change(screen.getByLabelText("Token contract"), {
      target: { value: "0x3333333333333333333333333333333333333333" },
    });
    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText("Transfer input needs review")).toBeInTheDocument());
    expect(screen.getByText(/Token decimals metadata call failed/)).toBeInTheDocument();
  });
});
