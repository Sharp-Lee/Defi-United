import { describe, expect, it } from "vitest";
import { formatEstimatedNativeCost } from "./number";

describe("formatEstimatedNativeCost", () => {
  it("formats gas times gwei as native token cost", () => {
    expect(formatEstimatedNativeCost("21000", "42")).toBe("0.00088200");
  });

  it("returns placeholder for invalid values", () => {
    expect(formatEstimatedNativeCost("", "42")).toBe("--");
    expect(formatEstimatedNativeCost("21000", "0")).toBe("--");
    expect(formatEstimatedNativeCost("nope", "42")).toBe("--");
  });
});
