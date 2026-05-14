import { expect, test } from "@playwright/test";

const navLabels = ["总览", "账户库", "资产", "分发/归集", "铭文刻录", "合约调用", "队列/历史", "设置"];

test("PWA shell loads and exposes the browser-first baseline", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("PWA 控制台")).toBeVisible();
  await expect(page.getByRole("heading", { name: "主工作区" })).toBeVisible();
  await expect(page.getByLabel("预览与风险")).toBeVisible();

  for (const label of navLabels) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

  await page.getByRole("button", { name: "账户库" }).click();
  await expect(page.getByRole("heading", { name: "账户库" })).toBeVisible();
  await expect(page.getByLabel("Vault 密码", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "资产" }).click();
  await expect(page.getByRole("heading", { name: "资产" }).last()).toBeVisible();
  await expect(page.getByText(/解锁 vault 后才能刷新本地账户余额/)).toBeVisible();
  await expect(page.getByRole("button", { name: /签名|广播|提交|approve|sign|broadcast/i })).toHaveCount(0);

  await page.getByRole("button", { name: "合约调用" }).click();
  await expect(page.getByRole("heading", { name: "合约调用" })).toBeVisible();
  await expect(page.getByText(/不会运行签名、广播、RPC 提交/)).toBeVisible();
});

test("PWA queue history opens without arbitrary send forms", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "队列/历史" }).click();

  const workspace = page.getByLabel("主工作区");
  await expect(page.getByRole("heading", { name: "队列/历史" })).toBeVisible();
  await expect(page.getByText(/不提供任意交易发送表单/)).toBeVisible();
  await expect(workspace.getByRole("button", { name: /签名|广播|提交|发送|分发|归集|approve|ABI|calldata/i })).toHaveCount(0);
});

test("PWA account vault creates, batch-derives, multi-selects, and locks without RPC actions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "账户库" }).click();

  await page.getByLabel("Vault 密码", { exact: true }).fill("correct horse battery staple");
  await page.getByLabel("确认密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建 vault" }).click();

  await expect(page.getByRole("heading", { name: "账户与组" })).toBeVisible();
  await expect(page.getByRole("button", { name: /主账户组\s*已选 1 \/ 1/ })).toBeVisible();
  await expect(page.getByText("账户 1")).toBeVisible();

  await page.getByRole("button", { name: "派生 20" }).click();
  await expect(page.getByText("账户 21")).toBeVisible();
  await expect(page.getByText(/^0x[0-9a-fA-F]{40}$/)).toHaveCount(21);

  await page.getByRole("button", { name: "清空选择" }).click();
  await expect(page.getByText("当前组已选 0 / 21").first()).toBeVisible();

  await page.getByRole("button", { name: "全选" }).click();
  await expect(page.getByText("当前组已选 21 / 21").first()).toBeVisible();

  await expect(page.getByRole("button", { name: /签名|广播|sign|broadcast/i })).toHaveCount(0);
  await page.getByRole("button", { name: "锁定" }).click();
  await expect(page.getByRole("button", { name: "解锁 vault" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "账户与组" })).toHaveCount(0);
});

test("PWA import flow requires password verification and overwrite confirmation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "账户库" }).click();

  await page.getByLabel("Vault 密码", { exact: true }).fill("correct horse battery staple");
  await page.getByLabel("确认密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建 vault" }).click();
  await expect(page.getByRole("heading", { name: "账户与组" })).toBeVisible();

  await page.getByRole("button", { name: "锁定" }).click();
  await expect(page.getByLabel("导入加密 vault")).toBeDisabled();
  await page.getByLabel("导入 vault 密码").fill("correct horse battery staple");
  await expect(page.getByLabel("导入加密 vault")).toBeDisabled();
  await page.getByLabel("确认覆盖已有 vault").check();
  await expect(page.getByLabel("导入加密 vault")).toBeEnabled();
});

test("PWA settings persists chain/RPC config but resets fee drafts without send actions", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "Chain / RPC Config" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "共享 Fee Panel" })).toBeVisible();

  await page.getByLabel("RPC URL").fill("https://rpc.example.test");
  await page.getByLabel("Max Fee gwei").fill("42");
  await expect(page.getByText(/0\.00088200 ETH/)).toBeVisible();
  await expect(page.getByRole("button", { name: /签名|广播|sign|broadcast|提交/i })).toHaveCount(0);

  await page.reload();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByLabel("RPC URL")).toHaveValue("https://rpc.example.test");
  await expect(page.getByLabel("Max Fee gwei")).toHaveValue("30");
});

test("PWA manifest is linked and installability metadata is reachable", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#00a56a");

  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);

  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "DeFi United PWA 钱包工作台",
    short_name: "DeFi United",
    start_url: "/",
    display: "standalone",
    theme_color: "#00a56a",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" }),
      expect.objectContaining({ src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png" }),
    ]),
  );

  expect((await request.get("/pwa-icon-192.png")).ok()).toBe(true);
  expect((await request.get("/pwa-icon-512.png")).ok()).toBe(true);
});
