import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createInitialBrowserVaultState } from "../core/browserVault/accounts";
import { createMemoryBrowserChainConfigStorage } from "../lib/browserChainConfig";
import {
  createBrowserVaultSession,
  createMemoryBrowserVaultStorage,
  serializeBrowserVaultEnvelope,
} from "../lib/browserVault";
import { renderScreen } from "../test/render";
import { PwaShell } from "./PwaShell";

const primaryNavLabels = ["总览", "账户库", "资产", "分发/归集", "铭文刻录", "合约调用", "队列/历史", "设置"];

function renderPwaShell() {
  const vaultStorage = createMemoryBrowserVaultStorage();
  const chainConfigStorage = createMemoryBrowserChainConfigStorage();
  return renderScreen(<PwaShell chainConfigStorage={chainConfigStorage} vaultStorage={vaultStorage} />);
}

describe("PwaShell", () => {
  it("renders the Chinese PWA shell baseline", async () => {
    renderPwaShell();

    expect(screen.getByText("PWA 控制台")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "主工作区" })).toBeInTheDocument();
    expect(screen.getByLabelText("预览与风险")).toBeInTheDocument();
    expect(screen.getByText(/Browser-first PWA mainline/i)).toBeInTheDocument();
    expect(screen.getAllByText(/P13 前仅占位，不运行签名或广播队列/)).toHaveLength(2);
    await waitFor(() => expect(screen.getByRole("heading", { name: "总览" })).toBeInTheDocument());
  });

  it("shows all primary navigation labels", async () => {
    renderPwaShell();

    for (const label of primaryNavLabels) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "账户库" }));
    expect(screen.getByRole("heading", { name: "账户库" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Vault 密码")).toBeInTheDocument());
  });

  it("switches active section from accounts to contract calls", async () => {
    renderPwaShell();

    fireEvent.click(screen.getByRole("button", { name: /账户库/ }));
    expect(await screen.findByLabelText("Vault 密码")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "合约调用" }));

    expect(screen.getByRole("heading", { name: "合约调用" })).toBeInTheDocument();
    expect(screen.getByText(/ABI 管理/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("未启用")).toBeInTheDocument());
  });

  it("renders browser chain config and shared fee settings without send controls", async () => {
    renderPwaShell();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chain / RPC Config" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "共享 Fee Panel" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ethereum Mainnet")).toBeInTheDocument();
    expect(screen.getByLabelText("RPC URL")).toHaveValue("https://ethereum.publicnode.com");

    fireEvent.change(screen.getByLabelText("Max Fee gwei"), { target: { value: "42" } });
    await waitFor(() => expect(screen.getByText(/0\.00088200 ETH/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "添加 Base 示例链" }));
    await waitFor(() => expect(screen.getByDisplayValue("Base")).toBeInTheDocument());
    expect(screen.getByLabelText("Chain ID")).toHaveValue("8453");
    expect(screen.queryByRole("button", { name: /sign|broadcast|签名|广播|提交/i })).not.toBeInTheDocument();
  });

  it("keeps P10c+ wallet capabilities unavailable outside implemented sections", async () => {
    renderPwaShell();

    fireEvent.click(screen.getByRole("button", { name: "合约调用" }));

    expect(screen.getByText("未启用")).toBeInTheDocument();
    expect(screen.getByText(/不会运行签名、广播、RPC 提交/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign|broadcast|签名|广播/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "合约调用" })).toBeInTheDocument());
  });

  it("imports only password-verified encrypted vault files with overwrite confirmation", async () => {
    const existingStorage = createMemoryBrowserVaultStorage();
    await createBrowserVaultSession("existing password", createInitialBrowserVaultState(), existingStorage);
    const importStorage = createMemoryBrowserVaultStorage();
    const imported = await createBrowserVaultSession(
      "import password",
      createInitialBrowserVaultState({
        mnemonicPhrase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      }),
      importStorage,
    );
    const chainConfigStorage = createMemoryBrowserChainConfigStorage();
    renderScreen(<PwaShell chainConfigStorage={chainConfigStorage} vaultStorage={existingStorage} />);

    fireEvent.click(screen.getByRole("button", { name: "账户库" }));
    expect(await screen.findByRole("button", { name: "解锁 vault" })).toBeInTheDocument();
    const importInput = screen.getByLabelText("导入加密 vault") as HTMLInputElement;
    expect(importInput.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("导入 vault 密码"), { target: { value: "wrong password" } });
    expect(importInput.disabled).toBe(true);

    const serializedImport = serializeBrowserVaultEnvelope(imported.envelope);
    const wrongPasswordFile = new File([serializedImport], "vault-wrong-password.json", { type: "application/json" });
    Object.defineProperty(wrongPasswordFile, "text", { value: async () => serializedImport });

    fireEvent.click(screen.getByLabelText("确认覆盖已有 vault"));
    fireEvent.change(screen.getByLabelText("导入加密 vault"), {
      target: {
        files: [wrongPasswordFile],
      },
    });
    expect(await screen.findByText(/unable to unlock encrypted vault/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "账户与组" })).not.toBeInTheDocument();

    const correctPasswordFile = new File([serializedImport], "vault-correct-password.json", { type: "application/json" });
    Object.defineProperty(correctPasswordFile, "text", { value: async () => serializedImport });

    fireEvent.change(screen.getByLabelText("导入 vault 密码"), { target: { value: "import password" } });
    fireEvent.change(screen.getByLabelText("导入加密 vault"), {
      target: {
        files: [correctPasswordFile],
      },
    });

    expect(await screen.findByRole("heading", { name: "账户与组" })).toBeInTheDocument();
    expect(screen.getByText(imported.state.groups[0].accounts[0].address)).toBeInTheDocument();
  });

  it("creates a browser vault, derives an account, and locks the hot session", async () => {
    renderPwaShell();

    fireEvent.click(screen.getByRole("button", { name: /账户库/ }));

    fireEvent.change(screen.getByLabelText("Vault 密码"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建 vault" }));

    expect(await screen.findByRole("heading", { name: "账户与组" })).toBeInTheDocument();
    expect(screen.getByText("主账户组")).toBeInTheDocument();
    expect(screen.getByText("账户 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "派生 1 个账户" }));

    await waitFor(() => expect(screen.getByText("账户 2")).toBeInTheDocument());
    expect(screen.getAllByText(/^0x[0-9a-fA-F]{40}$/)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "锁定" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "账户与组" })).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "账户与组" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "解锁 vault" })).toBeInTheDocument();
  });
});
