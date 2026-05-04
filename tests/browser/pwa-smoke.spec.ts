import { expect, test } from "@playwright/test";

const navLabels = ["账户", "资产", "分发/归集", "铭文刻录", "合约调用", "历史", "设置"];

test("PWA shell loads and exposes the P10a navigation baseline", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "DeFi United PWA 钱包工作台" })).toBeVisible();
  await expect(page.getByText("Tauri desktop v1")).toBeVisible();

  for (const label of navLabels) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

  await page.getByRole("button", { name: "合约调用" }).click();
  await expect(page.getByRole("heading", { name: "合约调用" })).toBeVisible();
  await expect(page.getByText(/当前不包含 vault 解锁/)).toBeVisible();
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
