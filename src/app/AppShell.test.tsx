import { screen } from "@testing-library/react";
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
});
