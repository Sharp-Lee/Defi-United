import { screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import { renderScreen } from "../test/render";

describe("AppShell", () => {
  it("renders the locked workspace when no session is active", () => {
    renderScreen(
      <AppShell
        activeTab="accounts"
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "locked" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "EVM Wallet Workbench" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock Vault" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Accounts" })).not.toBeInTheDocument();
  });

  it("renders the workspace tabs when a session is ready", () => {
    renderScreen(
      <AppShell
        activeTab="accounts"
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    expect(screen.getByRole("tab", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Transfer" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlock Vault" })).not.toBeInTheDocument();
  });

  it("locks settings inputs while the workspace is busy", () => {
    renderScreen(
      <AppShell
        activeTab="settings"
        busy={true}
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Chain" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "RPC URL" })).toBeDisabled();
  });

  it("sanitizes long global app errors before displaying them", () => {
    const rawBlob = "0x".padEnd(132, "a");
    renderScreen(
      <AppShell
        activeTab="history"
        appError={`RPC failed with payload ${rawBlob} ${"x".repeat(300)}`}
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    const banner = document.querySelector(".inline-error");
    expect(banner).not.toBeNull();
    expect(banner).toHaveTextContent("RPC unavailable or rejected");
    expect(banner).toHaveTextContent(/0xaaaaaaaa\.\.\.aaaaaaaa/);
    expect(banner).not.toHaveTextContent(new RegExp("a{80}"));
    expect(screen.queryByText(new RegExp("a{80}"))).not.toBeInTheDocument();
  });

  it("does not show non-history global errors as manual history refresh failures", () => {
    renderScreen(
      <AppShell
        activeTab="history"
        appError="Account refresh failed: RPC timeout"
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    expect(document.querySelector(".inline-error")).toHaveTextContent("RPC unavailable or rejected");
    const historySection = within(screen.getByRole("heading", { name: "History" }).closest("section") as HTMLElement);
    expect(historySection.queryByText("Manual refresh")).not.toBeInTheDocument();
    expect(historySection.queryByText("manual history refresh")).not.toBeInTheDocument();
  });

  it("passes history refresh errors into HistoryView classification", () => {
    renderScreen(
      <AppShell
        activeTab="history"
        appError="RPC returned chainId 8453; expected 1."
        historyError="RPC returned chainId 8453; expected 1."
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    const historySection = within(screen.getByRole("heading", { name: "History" }).closest("section") as HTMLElement);
    expect(historySection.getByText("Manual refresh")).toBeInTheDocument();
    expect(historySection.getByText("Chain identity mismatch")).toBeInTheDocument();
    expect(historySection.getByText(/chainId is the stable chain identity/)).toBeInTheDocument();
  });

  it("passes corrupted history storage into transfer gating", () => {
    renderScreen(
      <AppShell
        activeTab="transfer"
        accounts={[
          {
            address: "0x1111111111111111111111111111111111111111",
            index: 1,
            label: "Account 1",
            nativeBalanceWei: 1n,
            nonce: 0,
          },
        ]}
        historyStorage={{
          status: "corrupted",
          path: "/tmp/tx-history.json",
          corruptionType: "jsonParseFailed",
          readable: true,
          recordCount: 0,
          invalidRecordCount: 0,
          invalidRecordIndices: [],
          errorSummary: "expected value",
          rawSummary: {
            fileSizeBytes: 12,
            modifiedAt: null,
            topLevel: null,
            arrayLen: null,
          },
        }}
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Build Draft" })).toBeDisabled();
    expect(screen.getByText(/Local transaction history is unreadable/)).toBeInTheDocument();
  });
});
