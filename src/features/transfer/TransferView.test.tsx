import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitNativeTransfer } from "../../lib/tauri";
import { renderScreen } from "../../test/render";
import { TransferView } from "./TransferView";

const provider = vi.hoisted(() => ({
  estimateGas: vi.fn(),
  getBlock: vi.fn(),
  getFeeData: vi.fn(),
  getNetwork: vi.fn(),
  getTransactionCount: vi.fn(),
}));

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
    submitNativeTransfer: vi.fn(),
  };
});

describe("TransferView", () => {
  beforeEach(() => {
    vi.mocked(submitNativeTransfer).mockReset();
    provider.getNetwork.mockResolvedValue({ chainId: 1n });
    provider.getFeeData.mockResolvedValue({
      gasPrice: 30_000_000_000n,
      maxFeePerGas: 40_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
    });
    provider.getBlock.mockResolvedValue({ baseFeePerGas: 20_000_000_000n });
    provider.getTransactionCount.mockResolvedValue(7);
    provider.estimateGas.mockResolvedValue(21_000n);
  });

  function renderTransfer(
    onSubmitted = vi.fn(),
    options: {
      historyStorageIssue?: string | null;
      onSubmitFailed?: (error: unknown) => Promise<void> | void;
    } = {},
  ) {
    renderScreen(
      <TransferView
        accounts={[
          {
            address: "0x1111111111111111111111111111111111111111",
            index: 1,
            label: "Account 1",
            nativeBalanceWei: 1_000_000_000_000_000_000n,
            nonce: 7,
          },
        ]}
        chainId={1n}
        chainName="Ethereum"
        draft={null}
        historyStorageIssue={options.historyStorageIssue}
        onSubmitFailed={options.onSubmitFailed}
        onSubmitted={onSubmitted}
        rpcUrl="http://127.0.0.1:8545"
      />,
    );
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
});
