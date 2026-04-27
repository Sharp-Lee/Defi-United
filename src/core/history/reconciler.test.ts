import { describe, expect, it } from "vitest";
import { releaseNonceReservation } from "./reconciler";

describe("releaseNonceReservation", () => {
  it("releases a nonce reservation when a pending transaction is dropped", () => {
    const next = releaseNonceReservation(
      {
        key: "1:0xabc",
        reservedNonce: 4,
        historyState: "pending",
      },
      "dropped",
    );

    expect(next.historyState).toBe("dropped");
    expect(next.reservedNonce).toBeNull();
  });
});
