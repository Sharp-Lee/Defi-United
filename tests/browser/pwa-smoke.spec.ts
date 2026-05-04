import { expect, test } from "@playwright/test";

const navLabels = ["账户", "资产", "分发/归集", "铭文刻录", "合约调用", "历史", "设置"];

test("PWA shell loads and exposes the P10b navigation baseline", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "DeFi United PWA 钱包工作台" })).toBeVisible();
  await expect(page.getByText("Tauri desktop v1")).toBeVisible();

  for (const label of navLabels) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

  await expect(page.getByRole("heading", { name: "账户" })).toBeVisible();
  await expect(page.getByLabel("Vault 密码")).toBeVisible();

  await page.getByRole("button", { name: "合约调用" }).click();
  await expect(page.getByRole("heading", { name: "合约调用" })).toBeVisible();
  await expect(page.getByText(/本页仍不包含签名、广播、RPC 提交/)).toBeVisible();
});

test("PWA account vault creates, derives, and locks without RPC actions", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Vault 密码").fill("correct horse battery staple");
  await page.getByLabel("确认密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建 vault" }).click();

  await expect(page.getByRole("heading", { name: "账户与组" })).toBeVisible();
  await expect(page.getByText("主账户组")).toBeVisible();
  await expect(page.getByText("账户 1")).toBeVisible();

  await page.getByRole("button", { name: "派生 1 个账户" }).click();
  await expect(page.getByText("账户 2")).toBeVisible();
  await expect(page.getByText(/^0x[0-9a-fA-F]{40}$/)).toHaveCount(2);

  await expect(page.getByRole("button", { name: /签名|广播|sign|broadcast/i })).toHaveCount(0);
  await page.getByRole("button", { name: "锁定" }).click();
  await expect(page.getByRole("button", { name: "解锁 vault" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "账户与组" })).toHaveCount(0);
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
});
