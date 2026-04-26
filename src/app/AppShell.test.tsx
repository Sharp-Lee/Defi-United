import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("renders the locked workspace when no session is active", () => {
    render(<AppShell session={{ status: "locked" }} />);

    expect(screen.getByRole("heading", { name: "EVM Wallet Workbench" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock Vault" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Accounts" })).not.toBeInTheDocument();
  });
});
