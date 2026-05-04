import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderScreen } from "../../test/render";
import { PwaVaultAccessView } from "./PwaVaultAccessView";

describe("PwaVaultAccessView", () => {
  it("renders create mode without plaintext seed inputs", () => {
    renderScreen(
      <PwaVaultAccessView
        hasVault={false}
        onCreateVault={async () => {}}
        onImportVault={async () => {}}
        onUnlock={async () => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "账户" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "创建" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Vault 密码")).toBeInTheDocument();
    expect(screen.getByLabelText("确认密码")).toBeInTheDocument();
    expect(screen.queryByLabelText(/mnemonic|助记词|private key|私钥/i)).not.toBeInTheDocument();
    expect(screen.getByText(/本阶段不展示明文助记词/)).toBeInTheDocument();
  });

  it("switches to unlock mode when stored vault detection completes", async () => {
    const { rerender } = renderScreen(
      <PwaVaultAccessView
        hasVault={false}
        onCreateVault={async () => {}}
        onImportVault={async () => {}}
        onUnlock={async () => {}}
      />,
    );

    expect(screen.getByRole("tab", { name: "创建" })).toHaveAttribute("aria-selected", "true");

    rerender(
      <PwaVaultAccessView
        hasVault={true}
        onCreateVault={async () => {}}
        onImportVault={async () => {}}
        onUnlock={async () => {}}
      />,
    );

    await waitFor(() => expect(screen.getByRole("tab", { name: "解锁" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByLabelText("确认密码")).not.toBeInTheDocument();
  });

  it("validates create passwords before calling the handler", async () => {
    const onCreateVault = vi.fn(async () => {});
    renderScreen(
      <PwaVaultAccessView
        hasVault={false}
        onCreateVault={onCreateVault}
        onImportVault={async () => {}}
        onUnlock={async () => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Vault 密码"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "创建 vault" }));

    expect(await screen.findByText("Password must be at least 8 characters.")).toBeInTheDocument();
    expect(onCreateVault).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Vault 密码"), { target: { value: "correct horse" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "wrong horse" } });
    fireEvent.click(screen.getByRole("button", { name: "创建 vault" }));

    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(onCreateVault).not.toHaveBeenCalled();
  });

  it("creates, unlocks, and imports through explicit handlers", async () => {
    const onCreateVault = vi.fn(async () => {});
    const onUnlock = vi.fn(async () => {});
    const onImportVault = vi.fn(async () => {});
    const { rerender } = renderScreen(
      <PwaVaultAccessView
        hasVault={false}
        onCreateVault={onCreateVault}
        onImportVault={onImportVault}
        onUnlock={onUnlock}
      />,
    );

    fireEvent.change(screen.getByLabelText("Vault 密码"), { target: { value: "correct horse battery staple" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "correct horse battery staple" } });
    fireEvent.click(screen.getByRole("button", { name: "创建 vault" }));

    await waitFor(() => expect(onCreateVault).toHaveBeenCalledWith("correct horse battery staple"));

    rerender(
      <PwaVaultAccessView
        hasVault={true}
        onCreateVault={onCreateVault}
        onImportVault={onImportVault}
        onUnlock={onUnlock}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "解锁" }));
    fireEvent.change(screen.getByLabelText("Vault 密码"), { target: { value: "correct horse battery staple" } });
    fireEvent.click(screen.getByRole("button", { name: "解锁 vault" }));

    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith("correct horse battery staple"));

    const encryptedEnvelope = JSON.stringify({ schemaVersion: 1, ciphertext: "encrypted" });
    const file = new File([encryptedEnvelope], "vault.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => encryptedEnvelope });
    fireEvent.change(screen.getByLabelText("导入加密 vault"), { target: { files: [file] } });

    await waitFor(() => expect(onImportVault).toHaveBeenCalledWith(encryptedEnvelope));
  });
});
