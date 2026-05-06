import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4177",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4177 --strictPort",
    url: "http://127.0.0.1:4177",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium-desktop-preview",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile-preview",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
