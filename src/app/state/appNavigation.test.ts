import { describe, expect, it } from "vitest";
import { getDefaultModuleId, getModuleById } from "./appNavigation";

describe("appNavigation", () => {
  it("uses dashboard as default module", () => {
    expect(getDefaultModuleId()).toBe("dashboard");
  });

  it("falls back to dashboard for unknown ids", () => {
    expect(getModuleById("contracts")?.label).toBe("合约调用");
    expect(getModuleById("missing")?.id).toBe("dashboard");
  });
});
