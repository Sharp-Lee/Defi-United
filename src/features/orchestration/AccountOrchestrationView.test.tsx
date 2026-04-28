import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AccountRecord, HistoryRecord, TokenWatchlistState } from "../../lib/tauri";
import type { AccountChainState } from "../../lib/rpc";
import { renderScreen } from "../../test/render";
import { AccountOrchestrationView } from "./AccountOrchestrationView";

const accountA = "0x1111111111111111111111111111111111111111";
const accountB = "0x2222222222222222222222222222222222222222";
const tokenA = "0x3333333333333333333333333333333333333333";
const tokenB = "0x4444444444444444444444444444444444444444";
const external = "0x5555555555555555555555555555555555555555";

type AccountModel = AccountRecord & AccountChainState;

function accounts(overrides: Partial<AccountModel> = {}): AccountModel[] {
  return [
    {
      address: accountA,
      index: 0,
      label: "Account 0",
      nativeBalanceWei: null,
      nonce: null,
      lastSyncError: "RPC timeout",
      ...overrides,
    },
    {
      address: accountB,
      index: 1,
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
        balanceRaw: "10",
        balanceStatus: "ok",
        createdAt: "1710000000",
        updatedAt: "1710000001",
      },
      {
        account: accountA,
        chainId: 1,
        tokenContract: tokenB,
        balanceRaw: "0",
        balanceStatus: "zero",
        createdAt: "1710000000",
        updatedAt: "1710000001",
      },
    ],
    resolvedTokenMetadata: [],
  };
}

function pendingHistory(accountIndex: number, from: string, nonce: number): HistoryRecord {
  return {
    intent: {
      account_index: accountIndex,
      chain_id: 1,
      from,
      nonce,
    },
    outcome: {
      state: "Pending",
    },
  } as HistoryRecord;
}

function renderView(accountItems = accounts(), state = tokenState(), history: HistoryRecord[] = []) {
  return (
    <AccountOrchestrationView
      accounts={accountItems}
      chainName="Ethereum"
      history={history}
      selectedChainId={1n}
      tokenWatchlistState={state}
    />
  );
}

function renderOrchestration(accountItems = accounts(), state = tokenState(), history: HistoryRecord[] = []) {
  return renderScreen(renderView(accountItems, state, history));
}

describe("AccountOrchestrationView", () => {
  it("does not select source accounts by default", () => {
    renderOrchestration();

    const preview = screen.getByLabelText("Account set preview");
    expect(within(preview).getByText("No source accounts selected.")).toBeInTheDocument();
    expect(within(preview).getByText("Sources: 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Freeze Summary" })).toBeDisabled();
  });

  it("selects sources and local targets, adds external target, and freezes a read-only summary", () => {
    renderOrchestration();

    fireEvent.click(screen.getByLabelText("Source Account 0"));
    fireEvent.click(screen.getByLabelText("Local target Account 1"));
    fireEvent.change(screen.getByLabelText("External address"), {
      target: { value: external },
    });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Ops wallet" } });
    fireEvent.click(screen.getByRole("button", { name: "Add External" }));
    fireEvent.click(screen.getByRole("button", { name: "Freeze Summary" }));

    const preview = screen.getByLabelText("Account set preview");
    expect(within(preview).getByText("Sources: 1")).toBeInTheDocument();
    expect(within(preview).getByText("Local targets: 1")).toBeInTheDocument();
    expect(within(preview).getByText("External targets: 1")).toBeInTheDocument();
    expect(within(preview).getAllByText("missing")).toHaveLength(2);
    expect(within(preview).getByText("1 ok, 1 zero, 0 stale, 0 failed, 0 missing")).toBeInTheDocument();

    const frozen = screen.getByLabelText("Frozen orchestration summary");
    expect(within(frozen).getByText("Read-only")).toBeInTheDocument();
    expect(within(frozen).getByText(/0x[a-fA-F0-9]{64}/)).toBeInTheDocument();
    expect(within(frozen).getAllByText(accountA).length).toBeGreaterThan(0);
    expect(within(frozen).getByText(accountB)).toBeInTheDocument();
    expect(within(frozen).getByText(external)).toBeInTheDocument();
  });

  it("keeps invalid external address errors visible", () => {
    renderOrchestration();

    fireEvent.change(screen.getByLabelText("External address"), {
      target: { value: "not-an-address" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add External" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid EVM address.");
    expect(screen.getByText("No external targets added.")).toBeInTheDocument();
  });

  it("clears the frozen summary when the selection changes", async () => {
    renderOrchestration();

    fireEvent.click(screen.getByLabelText("Source Account 0"));
    fireEvent.click(screen.getByRole("button", { name: "Freeze Summary" }));
    expect(screen.getByLabelText("Frozen orchestration summary")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Source Account 1"));
    await waitFor(() =>
      expect(screen.queryByLabelText("Frozen orchestration summary")).not.toBeInTheDocument(),
    );
  });

  it("clears the frozen summary when account snapshot inputs change", async () => {
    const { rerender } = renderOrchestration();

    fireEvent.click(screen.getByLabelText("Source Account 0"));
    fireEvent.click(screen.getByRole("button", { name: "Freeze Summary" }));
    expect(screen.getByLabelText("Frozen orchestration summary")).toBeInTheDocument();

    rerender(renderView(accounts({ nativeBalanceWei: 123n, nonce: 4, lastSyncError: null })));
    await waitFor(() =>
      expect(screen.queryByLabelText("Frozen orchestration summary")).not.toBeInTheDocument(),
    );
  });

  it("clears the frozen summary when token snapshot counts change", async () => {
    const { rerender } = renderOrchestration();

    fireEvent.click(screen.getByLabelText("Source Account 0"));
    fireEvent.click(screen.getByRole("button", { name: "Freeze Summary" }));
    expect(screen.getByLabelText("Frozen orchestration summary")).toBeInTheDocument();

    rerender(
      renderView(accounts(), {
        ...tokenState(),
        watchlistTokens: [
          ...tokenState().watchlistTokens,
          {
            chainId: 1,
            tokenContract: "0x6666666666666666666666666666666666666666",
            label: "Token C",
            pinned: false,
            hidden: false,
            createdAt: "1710000000",
            updatedAt: "1710000000",
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Frozen orchestration summary")).not.toBeInTheDocument(),
    );
  });

  it("keeps the frozen summary while editing an unadded external address", () => {
    renderOrchestration();

    fireEvent.click(screen.getByLabelText("Source Account 0"));
    fireEvent.click(screen.getByRole("button", { name: "Freeze Summary" }));
    expect(screen.getByLabelText("Frozen orchestration summary")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("External address"), {
      target: { value: external },
    });
    expect(screen.getByLabelText("Frozen orchestration summary")).toBeInTheDocument();
  });

  it("gates multi-source native distribution and previews collection gas reserve", () => {
    renderOrchestration([
      {
        address: accountA,
        index: 0,
        label: "Account 0",
        nativeBalanceWei: 5_000_000n,
        nonce: 3,
        lastSyncError: null,
      },
      {
        address: accountB,
        index: 1,
        label: "Account 1",
        nativeBalanceWei: 2_099_999n,
        nonce: 4,
        lastSyncError: null,
      },
    ]);

    fireEvent.click(screen.getByLabelText("Source Account 0"));
    fireEvent.click(screen.getByLabelText("Source Account 1"));
    fireEvent.click(screen.getByLabelText("Local target Account 0"));
    fireEvent.click(screen.getByLabelText("Local target Account 1"));

    const nativeBatch = screen.getByLabelText("Native batch plan");
    expect(
      within(nativeBatch).getByText(/disabled for multiple sources/),
    ).toBeInTheDocument();
    expect(within(nativeBatch).getByRole("button", { name: "Submit Native Batch" })).toBeDisabled();

    fireEvent.change(within(nativeBatch).getByLabelText("Max fee wei"), {
      target: { value: "100" },
    });
    fireEvent.change(within(nativeBatch).getByLabelText("Batch kind"), {
      target: { value: "collect" },
    });
    fireEvent.click(screen.getByLabelText("Local target Account 0"));

    expect(within(nativeBatch).getByText("2900000 wei")).toBeInTheDocument();
    expect(within(nativeBatch).getAllByText("skipped").length).toBeGreaterThan(0);
    expect(within(nativeBatch).getByText(/gas reserve/)).toBeInTheDocument();
  });

  it("shows native distribution as one Disperse contract parent without per-child nonces", () => {
    renderOrchestration([
      {
        address: accountA,
        index: 0,
        label: "Account 0",
        nativeBalanceWei: 10_000_000_000_000_000n,
        nonce: 7,
        lastSyncError: null,
      },
      {
        address: accountB,
        index: 1,
        label: "Account 1",
        nativeBalanceWei: 0n,
        nonce: 0,
        lastSyncError: null,
      },
    ]);

    fireEvent.click(screen.getByLabelText("Source Account 0"));
    fireEvent.click(screen.getByLabelText("Local target Account 1"));
    fireEvent.change(screen.getByLabelText("External address"), {
      target: { value: external },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add External" }));

    const nativeBatch = screen.getByLabelText("Native batch plan");
    expect(within(nativeBatch).getByText("0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3")).toBeInTheDocument();
    expect(within(nativeBatch).getByText("0xe63d38ed")).toBeInTheDocument();
    expect(within(nativeBatch).getByText("disperseEther(address[],uint256[])")).toBeInTheDocument();
    expect(within(nativeBatch).getByText("Parent nonce")).toBeInTheDocument();
    expect(within(nativeBatch).getAllByText(/recipient row; parent nonce 7/)).toHaveLength(2);
    expect(within(nativeBatch).queryByText("8")).not.toBeInTheDocument();
  });

  it("shows native distribution parent nonce reserved past local pending history", () => {
    renderOrchestration(
      [
        {
          address: accountA,
          index: 0,
          label: "Account 0",
          nativeBalanceWei: 10_000_000_000_000_000n,
          nonce: 7,
          lastSyncError: null,
        },
        {
          address: accountB,
          index: 1,
          label: "Account 1",
          nativeBalanceWei: 0n,
          nonce: 0,
          lastSyncError: null,
        },
      ],
      tokenState(),
      [pendingHistory(0, accountA, 9)],
    );

    fireEvent.click(screen.getByLabelText("Source Account 0"));
    fireEvent.click(screen.getByLabelText("Local target Account 1"));
    fireEvent.change(screen.getByLabelText("External address"), {
      target: { value: external },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add External" }));

    const nativeBatch = screen.getByLabelText("Native batch plan");
    expect(within(nativeBatch).getAllByText(/recipient row; parent nonce 10/)).toHaveLength(2);
    expect(within(nativeBatch).queryByText("7")).not.toBeInTheDocument();
  });
});
