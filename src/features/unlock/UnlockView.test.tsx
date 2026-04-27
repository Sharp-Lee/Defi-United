import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderScreen } from "../../test/render";
import { UnlockView } from "./UnlockView";

describe("UnlockView", () => {
  it("does not render or request plaintext mnemonic material in create mode", () => {
    renderScreen(
      <UnlockView
        onCreateVault={async () => {}}
        onUnlock={async () => {}}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Create" }));

    expect(screen.queryByLabelText(/mnemonic/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /mnemonic/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/test test test/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /regenerate/i })).not.toBeInTheDocument();
  });

  it("creates a vault by passing only the password to the desktop handler", async () => {
    const onCreateVault = vi.fn(async () => {});
    renderScreen(
      <UnlockView
        onCreateVault={onCreateVault}
        onUnlock={async () => {}}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Create" }));
    fireEvent.change(screen.getByLabelText("Vault password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Vault" }));

    await waitFor(() => expect(onCreateVault).toHaveBeenCalledTimes(1));
    expect(onCreateVault).toHaveBeenCalledWith("correct horse battery staple");
  });
});
