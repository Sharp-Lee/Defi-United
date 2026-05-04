import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryBrowserVaultStorage } from "../lib/browserVault";
import { renderScreen } from "../test/render";
import { PwaShell } from "./PwaShell";

const primaryNavLabels = ["账户", "资产", "分发/归集", "铭文刻录", "合约调用", "历史", "设置"];

function renderPwaShell() {
  const vaultStorage = createMemoryBrowserVaultStorage();
  return renderScreen(<PwaShell vaultStorage={vaultStorage} />);
}

describe("PwaShell", () => {
  it("renders the Chinese PWA shell baseline", async () => {
    renderPwaShell();

    expect(screen.getByRole("heading", { name: "DeFi United PWA 钱包工作台" })).toBeInTheDocument();
    expect(screen.getByText(/Browser-first PWA mainline/i)).toBeInTheDocument();
    expect(screen.getByText(/Tauri desktop v1/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Vault 密码")).toBeInTheDocument());
  });

  it("shows all primary navigation labels", async () => {
    renderPwaShell();

    for (const label of primaryNavLabels) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByLabelText("Vault 密码")).toBeInTheDocument());
  });

  it("switches active section from accounts to contract calls", async () => {
    renderPwaShell();

    expect(screen.getByRole("heading", { name: "账户" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "合约调用" }));

    expect(screen.getByRole("heading", { name: "合约调用" })).toBeInTheDocument();
    expect(screen.getByText(/ABI 管理/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("当前未启用")).toBeInTheDocument());
  });

  it("keeps P10c+ wallet capabilities unavailable outside the account vault section", async () => {
    renderPwaShell();

    fireEvent.click(screen.getByRole("button", { name: "合约调用" }));

    expect(screen.getByText("当前未启用")).toBeInTheDocument();
    expect(screen.getByText(/本页仍不包含签名、广播、RPC 提交/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign|broadcast|签名|广播/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "合约调用" })).toBeInTheDocument());
  });

  it("creates a browser vault, derives an account, and locks the hot session", async () => {
    renderPwaShell();

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

    await waitFor(() => expect(screen.getByRole("heading", { name: "账户" })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "账户与组" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "解锁 vault" })).toBeInTheDocument();
  });

  it("shows the archived Tauri desktop baseline notice", async () => {
    renderPwaShell();

    expect(screen.getByLabelText("归档桌面基线说明")).toHaveTextContent("归档基线");
    expect(screen.getByLabelText("归档桌面基线说明")).toHaveTextContent("Tauri desktop v1");
    await waitFor(() => expect(screen.getByLabelText("Vault 密码")).toBeInTheDocument());
  });
});
