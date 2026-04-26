import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import { renderScreen } from "../test/render";

describe("AppShell", () => {
  it("renders the locked workspace when no session is active", () => {
    renderScreen(<AppShell session={{ status: "locked" }} />);

    expect(screen.getByRole("heading", { name: "EVM Wallet Workbench" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock Vault" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Accounts" })).not.toBeInTheDocument();
  });

  it("renders the workspace tabs when a session is ready", () => {
    renderScreen(<AppShell session={{ status: "ready" }} />);

    expect(screen.getByRole("tab", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlock Vault" })).not.toBeInTheDocument();
  });
});
