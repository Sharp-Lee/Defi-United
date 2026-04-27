import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderScreen } from "../../test/render";
import type { DiagnosticEvent } from "../../lib/tauri";
import { DiagnosticsView } from "./DiagnosticsView";

function diagnosticEvent(overrides: Partial<DiagnosticEvent> = {}): DiagnosticEvent {
  return {
    timestamp: "1700000000",
    level: "error",
    category: "transaction",
    source: "transactions",
    event: "nativeTransferBroadcastFailed",
    chainId: 1,
    accountIndex: 1,
    txHash: "0xabc",
    message: "replacement underpriced",
    metadata: {
      nonce: 7,
      stage: "broadcast",
      nextState: "Pending",
      from: "0x1111111111111111111111111111111111111111",
    },
    ...overrides,
  };
}

describe("DiagnosticsView", () => {
  it("renders empty state and export safety copy", async () => {
    renderScreen(
      <DiagnosticsView
        exportEvents={vi.fn()}
        loadEvents={vi.fn().mockResolvedValue([])}
        nowMs={1_700_000_000_000}
      />,
    );

    expect(await screen.findByText("No diagnostic events recorded yet.")).toBeInTheDocument();
    expect(screen.getByText(/exclude mnemonics, private keys/)).toBeInTheDocument();
    expect(screen.getByText(/not chain confirmation facts/i)).toBeInTheDocument();
  });

  it("shows diagnostic events and filters by category, chain, account, tx hash and level", async () => {
    const allEvents = [
      diagnosticEvent(),
      diagnosticEvent({
        category: "rpc",
        chainId: 5,
        accountIndex: 2,
        txHash: "0xdef",
        level: "info",
        message: "chain probe ok",
        metadata: { stage: "provider", nonce: 9 },
      }),
    ];
    const loadEvents = vi.fn().mockImplementation(async (query) => {
      if (query?.category === "transaction") return [allEvents[0]];
      return allEvents;
    });

    renderScreen(
      <DiagnosticsView
        exportEvents={vi.fn()}
        loadEvents={loadEvents}
        nowMs={1_700_000_000_000}
      />,
    );

    await screen.findByText("replacement underpriced");
    const table = within(screen.getByRole("table"));
    expect(table.getByText("replacement underpriced")).toBeInTheDocument();
    expect(table.getByText("chain probe ok")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "transaction" } });
    fireEvent.change(screen.getByLabelText("Chain"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "error" } });
    fireEvent.change(screen.getByLabelText("Account"), { target: { value: "1111" } });
    fireEvent.change(screen.getByLabelText("Tx hash"), { target: { value: "abc" } });

    await waitFor(() => {
      expect(table.getByText("replacement underpriced")).toBeInTheDocument();
      expect(table.queryByText("chain probe ok")).not.toBeInTheDocument();
    });
    expect(loadEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({
        category: "transaction",
        chainId: 1,
        level: "error",
        account: "1111",
        txHash: "abc",
        limit: 200,
      }),
    );
  });

  it("exports the current filter scope", async () => {
    const exportEvents = vi.fn().mockResolvedValue({
      path: "/tmp/diagnostics-export.json",
      count: 1,
      scope: { limit: 200 },
    });
    renderScreen(
      <DiagnosticsView
        exportEvents={exportEvents}
        loadEvents={vi.fn().mockResolvedValue([diagnosticEvent()])}
        nowMs={1_700_000_000_000}
      />,
    );

    await screen.findByText("replacement underpriced");
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "transaction" } });
    fireEvent.change(screen.getByLabelText("Status or stage"), { target: { value: "broadcast" } });
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Exported 1 diagnostic event(s)",
    );
    expect(exportEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "transaction",
        status: "broadcast",
        limit: 200,
      }),
    );
  });

  it("shows read and permission/export failures without crashing", async () => {
    const exportEvents = vi.fn().mockRejectedValue(new Error("Permission denied"));
    renderScreen(
      <DiagnosticsView
        exportEvents={exportEvents}
        loadEvents={vi.fn().mockRejectedValue(new Error("invalid JSON on line 2"))}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to read diagnostics: invalid JSON on line 2",
    );
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    expect(await screen.findByText(/Unable to export diagnostics: Permission denied/)).toBeInTheDocument();
  });
});
