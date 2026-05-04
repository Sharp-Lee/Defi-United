import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type WebManifest = {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
};

describe("PWA manifest", () => {
  it("defines the P10a installability baseline", async () => {
    const manifestPath = resolve(process.cwd(), "public/manifest.webmanifest");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as WebManifest;

    expect(manifest.name).toBe("DeFi United PWA 钱包工作台");
    expect(manifest.short_name).toBe("DeFi United");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#101216");
    expect(manifest.theme_color).toBe("#00a56a");
    expect(manifest.icons).toContainEqual({
      src: "/pwa-icon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any maskable",
    });
  });
});
