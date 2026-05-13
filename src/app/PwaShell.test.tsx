import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Interface } from "ethers";
import { describe, expect, it, vi } from "vitest";
import { createInitialBrowserVaultState } from "../core/browserVault/accounts";
import { createDefaultBrowserChainConfigState } from "../core/browserChainConfig";
import { createMemoryBrowserAssetRegistryStorage } from "../lib/browserAssetRegistry";
import { createMemoryBrowserChainConfigStorage } from "../lib/browserChainConfig";
import {
  createBrowserVaultSession,
  createMemoryBrowserVaultStorage,
  serializeBrowserVaultEnvelope,
} from "../lib/browserVault";
import type { BrowserJsonRpcClient } from "../services/rpc/browserJsonRpcClient";
import { renderScreen } from "../test/render";
import { PwaShell } from "./PwaShell";

const primaryNavLabels = ["总览", "账户库", "资产", "分发/归集", "铭文刻录", "合约调用", "队列/历史", "设置"];

function renderPwaShell() {
  const vaultStorage = createMemoryBrowserVaultStorage();
  const chainConfigStorage = createMemoryBrowserChainConfigStorage();
  const assetRegistryStorage = createMemoryBrowserAssetRegistryStorage();
  return renderScreen(
    <PwaShell
      assetRegistryStorage={assetRegistryStorage}
      chainConfigStorage={chainConfigStorage}
      vaultStorage={vaultStorage}
    />,
  );
}

function renderPwaShellWithSharedStorage() {
  const vaultStorage = createMemoryBrowserVaultStorage();
  const chainConfigStorage = createMemoryBrowserChainConfigStorage();
  const assetRegistryStorage = createMemoryBrowserAssetRegistryStorage();
  return {
    assetRegistryStorage,
    chainConfigStorage,
    render: () =>
      renderScreen(
        <PwaShell
          assetRegistryStorage={assetRegistryStorage}
          chainConfigStorage={chainConfigStorage}
          vaultStorage={vaultStorage}
        />,
      ),
  };
}

const balanceOfInterface = new Interface(["function balanceOf(address) view returns (uint256)"]);

function createMockRpcClient(overrides: Partial<BrowserJsonRpcClient> = {}): BrowserJsonRpcClient {
  return {
    async getChainId() {
      return 1;
    },
    async getBlockNumber() {
      return 123;
    },
    async getNativeBalance() {
      return "1000000000000000000";
    },
    async getErc20Balance() {
      return balanceOfInterface.decodeFunctionResult("balanceOf", balanceOfInterface.encodeFunctionResult("balanceOf", [2500000n]))[0].toString();
    },
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function createUnlockedShellWithSelectedAccount(rpcClient: BrowserJsonRpcClient = createMockRpcClient()) {
  const vaultStorage = createMemoryBrowserVaultStorage();
  const chainConfigStorage = createMemoryBrowserChainConfigStorage();
  const assetRegistryStorage = createMemoryBrowserAssetRegistryStorage();
  renderScreen(
    <PwaShell
      assetRegistryStorage={assetRegistryStorage}
      chainConfigStorage={chainConfigStorage}
      createAssetRpcClient={() => rpcClient}
      vaultStorage={vaultStorage}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "账户库" }));
  fireEvent.change(await screen.findByLabelText("Vault 密码"), {
    target: { value: "correct horse battery staple" },
  });
  fireEvent.change(screen.getByLabelText("确认密码"), {
    target: { value: "correct horse battery staple" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建 vault" }));
  await screen.findByRole("heading", { name: "账户与组" });

  fireEvent.click(screen.getByRole("button", { name: "资产" }));
  await screen.findByRole("button", { name: "刷新余额" });
}

async function createUnlockedShellWithDisabledRpc() {
  const disabledRpcChainConfig = createDefaultBrowserChainConfigState();
  disabledRpcChainConfig.chains = disabledRpcChainConfig.chains.map((chain) => ({
    ...chain,
    rpcEndpoints: chain.rpcEndpoints.map((endpoint) => ({ ...endpoint, enabled: false })),
  }));
  const createAssetRpcClient = vi.fn(() => createMockRpcClient());
  renderScreen(
    <PwaShell
      assetRegistryStorage={createMemoryBrowserAssetRegistryStorage()}
      chainConfigStorage={createMemoryBrowserChainConfigStorage(disabledRpcChainConfig)}
      createAssetRpcClient={createAssetRpcClient}
      vaultStorage={createMemoryBrowserVaultStorage()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "账户库" }));
  fireEvent.change(await screen.findByLabelText("Vault 密码"), {
    target: { value: "correct horse battery staple" },
  });
  fireEvent.change(screen.getByLabelText("确认密码"), {
    target: { value: "correct horse battery staple" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建 vault" }));
  await screen.findByRole("heading", { name: "账户与组" });

  fireEvent.click(screen.getByRole("button", { name: "资产" }));
  await screen.findByRole("button", { name: "刷新余额" });
  return { createAssetRpcClient };
}

async function createUnlockedShellWithDisabledPrimaryAndEnabledFallbackRpc() {
  const chainConfig = createDefaultBrowserChainConfigState();
  chainConfig.chains = chainConfig.chains.map((chain) => ({
    ...chain,
    rpcEndpoints: [
      ...chain.rpcEndpoints.map((endpoint) => ({ ...endpoint, enabled: false, primary: true })),
      {
        id: "rpc-fallback",
        label: "Fallback RPC",
        url: "https://fallback.example.invalid/secret-token",
        enabled: true,
        primary: false,
      },
    ],
  }));
  const createAssetRpcClient = vi.fn(() => createMockRpcClient());
  renderScreen(
    <PwaShell
      assetRegistryStorage={createMemoryBrowserAssetRegistryStorage()}
      chainConfigStorage={createMemoryBrowserChainConfigStorage(chainConfig)}
      createAssetRpcClient={createAssetRpcClient}
      vaultStorage={createMemoryBrowserVaultStorage()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "账户库" }));
  fireEvent.change(await screen.findByLabelText("Vault 密码"), {
    target: { value: "correct horse battery staple" },
  });
  fireEvent.change(screen.getByLabelText("确认密码"), {
    target: { value: "correct horse battery staple" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建 vault" }));
  await screen.findByRole("heading", { name: "账户与组" });

  fireEvent.click(screen.getByRole("button", { name: "资产" }));
  await screen.findByRole("button", { name: "刷新余额" });
  return { createAssetRpcClient };
}

describe("PwaShell", () => {
  it("renders the Chinese PWA shell baseline", async () => {
    renderPwaShell();

    expect(screen.getByText("PWA 控制台")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "主工作区" })).toBeInTheDocument();
    expect(screen.getByLabelText("预览与风险")).toBeInTheDocument();
    expect(screen.getByText(/Browser-first PWA mainline/i)).toBeInTheDocument();
    expect(await screen.findByText("Public RPC")).toBeInTheDocument();
    expect(screen.getByText("Max 30 gwei")).toBeInTheDocument();
    expect(screen.getByText("Tip 1.5 gwei")).toBeInTheDocument();
    expect(screen.getByText("Base 2x")).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "链与 Fee 设置" })).toBeInTheDocument();
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

  it("persists RPC edits while resetting fee drafts across shell reloads", async () => {
    const harness = renderPwaShellWithSharedStorage();
    const firstRender = harness.render();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByRole("heading", { name: "Chain / RPC Config" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("RPC URL"), { target: { value: "https://rpc.example.local" } });
    await waitFor(() => expect(screen.getByLabelText("RPC URL")).toHaveValue("https://rpc.example.local"));

    fireEvent.change(screen.getByLabelText("Max Fee gwei"), { target: { value: "42" } });
    await waitFor(() => expect(screen.getByLabelText("Max Fee gwei")).toHaveValue("42"));

    firstRender.unmount();
    harness.render();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(await screen.findByLabelText("RPC URL")).toHaveValue("https://rpc.example.local");
    expect(screen.getByLabelText("Max Fee gwei")).toHaveValue("30");
  });

  it("keeps P10c+ wallet capabilities unavailable outside implemented sections", async () => {
    renderPwaShell();

    fireEvent.click(screen.getByRole("button", { name: "合约调用" }));

    expect(screen.getByText("未启用")).toBeInTheDocument();
    expect(screen.getByText(/不会运行签名、广播、RPC 提交/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign|broadcast|签名|广播/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "合约调用" })).toBeInTheDocument());
  });

  it("refreshes asset balances through chain-validated RPC without send controls", async () => {
    await createUnlockedShellWithSelectedAccount();

    fireEvent.change(screen.getByLabelText("合约地址"), {
      target: { value: "0x0000000000000000000000000000000000000010" },
    });
    fireEvent.change(screen.getByLabelText("符号"), { target: { value: "tok" } });
    fireEvent.change(screen.getByLabelText("精度"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "添加资产" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新余额" }));

    expect(await screen.findByText("已刷新")).toBeInTheDocument();
    expect(screen.getByText("1.0 ETH")).toBeInTheDocument();
    expect(screen.getByText("2.5 TOK")).toBeInTheDocument();
    expect(within(screen.getByLabelText("主工作区")).queryByRole("button", { name: /签名|广播|提交|approve|分发|归集|sign|broadcast|distribution|collection/i })).not.toBeInTheDocument();
  });

  it("shows chain mismatch without leaking RPC URL secrets", async () => {
    await createUnlockedShellWithSelectedAccount(createMockRpcClient({
      async getChainId() {
        return 8453;
      },
    }));

    fireEvent.click(screen.getByRole("button", { name: "刷新余额" }));

    expect(await screen.findByText("链不匹配")).toBeInTheDocument();
    expect(screen.getByText(/期望 1，实际 8453/)).toBeInTheDocument();
    expect(screen.queryByText(/ethereum\.publicnode\.com|https:\/\//i)).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("主工作区")).queryByRole("button", { name: /签名|广播|提交|approve|分发|归集|sign|broadcast|distribution|collection/i })).not.toBeInTheDocument();
  });

  it("treats disabled RPC endpoints as no RPC and never constructs an asset RPC client", async () => {
    const { createAssetRpcClient } = await createUnlockedShellWithDisabledRpc();

    expect(screen.getByText("RPC 未配置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新余额" })).toBeDisabled();
    expect(createAssetRpcClient).not.toHaveBeenCalled();
  });

  it("does not fall back to non-primary enabled RPC endpoints for asset refresh", async () => {
    const { createAssetRpcClient } = await createUnlockedShellWithDisabledPrimaryAndEnabledFallbackRpc();

    expect(screen.getByText("RPC 未配置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新余额" })).toBeDisabled();
    expect(createAssetRpcClient).not.toHaveBeenCalled();
  });

  it("clears asset snapshots when the watched asset context changes", async () => {
    await createUnlockedShellWithSelectedAccount();

    fireEvent.click(screen.getByRole("button", { name: "刷新余额" }));
    expect(await screen.findByText("1.0 ETH")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("合约地址"), {
      target: { value: "0x0000000000000000000000000000000000000010" },
    });
    fireEvent.change(screen.getByLabelText("符号"), { target: { value: "tok" } });
    fireEvent.change(screen.getByLabelText("精度"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "添加资产" }));

    await waitFor(() => expect(screen.queryByText("1.0 ETH")).not.toBeInTheDocument());
    expect(screen.getByText("原生余额 0")).toBeInTheDocument();
    expect(screen.getByText("还没有原生余额快照。")).toBeInTheDocument();
  });

  it("clears asset snapshots when the primary RPC URL changes", async () => {
    await createUnlockedShellWithSelectedAccount();

    fireEvent.click(screen.getByRole("button", { name: "刷新余额" }));
    expect(await screen.findByText("1.0 ETH")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByRole("heading", { name: "Chain / RPC Config" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("RPC URL"), { target: { value: "https://rpc.example.local/new-url" } });
    await waitFor(() => expect(screen.getByLabelText("RPC URL")).toHaveValue("https://rpc.example.local/new-url"));

    fireEvent.click(screen.getByRole("button", { name: "资产" }));

    await waitFor(() => expect(screen.queryByText("1.0 ETH")).not.toBeInTheDocument());
    expect(screen.getByText("原生余额 0")).toBeInTheDocument();
    expect(screen.getByText("还没有原生余额快照。")).toBeInTheDocument();
  });

  it("clears asset snapshots when the selected account context changes", async () => {
    await createUnlockedShellWithSelectedAccount();

    fireEvent.click(screen.getByRole("button", { name: "刷新余额" }));
    expect(await screen.findByText("1.0 ETH")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "账户库" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^账户 1 / }));
    await waitFor(() => expect(screen.getAllByText("当前组已选 0 / 1")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "资产" }));

    await waitFor(() => expect(screen.queryByText("1.0 ETH")).not.toBeInTheDocument());
    expect(screen.getByText("请选择至少一个本地账户后再刷新余额。")).toBeInTheDocument();
    expect(screen.getByText("原生余额 0")).toBeInTheDocument();
    expect(screen.getByText("还没有原生余额快照。")).toBeInTheDocument();
  });

  it("clears asset snapshots when the active chain changes", async () => {
    await createUnlockedShellWithSelectedAccount();

    fireEvent.click(screen.getByRole("button", { name: "刷新余额" }));
    expect(await screen.findByText("1.0 ETH")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加 Base 示例链" }));
    await waitFor(() => expect(screen.getByDisplayValue("Base")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "资产" }));

    await waitFor(() => expect(screen.queryByText("1.0 ETH")).not.toBeInTheDocument());
    expect(screen.getByText("链 Base (8453)")).toBeInTheDocument();
    expect(screen.getByText("原生余额 0")).toBeInTheDocument();
    expect(screen.getByText("还没有原生余额快照。")).toBeInTheDocument();
  });

  it("clears asset snapshots when locking the vault", async () => {
    await createUnlockedShellWithSelectedAccount();

    fireEvent.click(screen.getByRole("button", { name: "刷新余额" }));
    expect(await screen.findByText("1.0 ETH")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "账户库" }));
    fireEvent.click(screen.getByRole("button", { name: "锁定" }));
    fireEvent.click(screen.getByRole("button", { name: "资产" }));

    expect(screen.getByText("解锁 vault 后才能刷新本地账户余额")).toBeInTheDocument();
    expect(screen.queryByText("1.0 ETH")).not.toBeInTheDocument();
    expect(screen.queryByText(/^0x[0-9a-fA-F]{40}$/)).not.toBeInTheDocument();
  });

  it("ignores in-flight asset refresh results after the vault is locked", async () => {
    const deferredBalance = createDeferred<string>();
    await createUnlockedShellWithSelectedAccount(
      createMockRpcClient({
        async getNativeBalance() {
          return deferredBalance.promise;
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "刷新余额" }));
    expect(await screen.findByText("校验链")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "账户库" }));
    fireEvent.click(screen.getByRole("button", { name: "锁定" }));

    await act(async () => {
      deferredBalance.resolve("1000000000000000000");
      await deferredBalance.promise;
    });

    fireEvent.click(screen.getByRole("button", { name: "资产" }));

    expect(screen.getByText("解锁 vault 后才能刷新本地账户余额")).toBeInTheDocument();
    expect(screen.queryByText("1.0 ETH")).not.toBeInTheDocument();
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

  it("creates a browser vault, derives account batches, persists selection across lock and unlock, and has no send controls", async () => {
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
    expect(screen.getByLabelText("派生数量")).toHaveValue(20);

    fireEvent.click(screen.getByRole("button", { name: "派生账户" }));

    await waitFor(() => expect(screen.getByText("账户 21")).toBeInTheDocument());
    expect(screen.getAllByText(/^0x[0-9a-fA-F]{40}$/)).toHaveLength(21);
    expect(screen.getAllByText("当前组已选 1 / 21")).toHaveLength(2);

    fireEvent.click(screen.getByRole("checkbox", { name: /^账户 2 / }));
    await waitFor(() => expect(screen.getAllByText("当前组已选 2 / 21")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    await waitFor(() => expect(screen.getAllByText("当前组已选 21 / 21")).toHaveLength(2));
    expect(screen.getAllByRole("checkbox")).toHaveLength(21);
    expect(screen.getAllByRole("checkbox").every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
    await waitFor(() => expect(screen.getAllByText("当前组已选 0 / 21")).toHaveLength(2));
    expect(screen.getAllByRole("checkbox").every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /^账户 3 / }));
    await waitFor(() => expect(screen.getAllByText("当前组已选 1 / 21")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: /sign|broadcast|签名|广播|提交/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "锁定" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "账户与组" })).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "账户与组" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "解锁 vault" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Vault 密码"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "解锁 vault" }));

    expect(await screen.findByRole("heading", { name: "账户与组" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("当前组已选 1 / 21")).toHaveLength(2));
    expect(screen.getByRole("checkbox", { name: /^账户 3 / })).toBeChecked();
    expect(screen.queryByRole("button", { name: /sign|broadcast|签名|广播|提交/i })).not.toBeInTheDocument();
  });
});
