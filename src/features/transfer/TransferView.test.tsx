import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderScreen } from "../../test/render";
import { TransferView } from "./TransferView";

const provider = vi.hoisted(() => ({
  estimateGas: vi.fn(),
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
    provider.getNetwork.mockResolvedValue({ chainId: 1n });
    provider.getFeeData.mockResolvedValue({
      gasPrice: 30_000_000_000n,
      maxFeePerGas: 40_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
    });
    provider.getTransactionCount.mockResolvedValue(7);
    provider.estimateGas.mockResolvedValue(21_000n);
  });

  it("keeps the built draft after auto-filling fee and nonce fields", async () => {
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
        onSubmitted={() => {}}
        rpcUrl="http://127.0.0.1:8545"
      />,
    );

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0.01" } });
    fireEvent.click(screen.getByRole("button", { name: "Build Draft" }));

    await waitFor(() => expect(screen.getByText("Confirm Transfer")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Frozen key")).toBeInTheDocument());
    expect(screen.getByText("Ethereum (chainId 1)")).toBeInTheDocument();
    expect(screen.getByText("0x1111111111111111111111111111111111111111")).toBeInTheDocument();
    expect(screen.getByText("0x2222222222222222222222222222222222222222")).toBeInTheDocument();
    expect(screen.getByText("0.01 native (10000000000000000 wei)")).toBeInTheDocument();
    expect(screen.getByText("0.00084 native (840000000000000 wei)")).toBeInTheDocument();
    expect(screen.getByText("0.01084 native (10840000000000000 wei)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });
});
