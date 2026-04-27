import { describe, expect, it } from "vitest";
import { nextNonceWithLocalPending, releaseNonceReservation } from "./reconciler";

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

describe("nextNonceWithLocalPending", () => {
  it("advances the suggested nonce past local pending history for the same account and chain", () => {
    const nextNonce = nextNonceWithLocalPending(
      7,
      [
        {
          intent: {
            account_index: 1,
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111",
            nonce: 7,
          },
          outcome: { state: "Pending" },
        },
        {
          intent: {
            account_index: 1,
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111",
            nonce: 9,
          },
          outcome: { state: "Confirmed" },
        },
        {
          intent: {
            account_index: 2,
            chain_id: 1,
            from: "0x2222222222222222222222222222222222222222",
            nonce: 12,
          },
          outcome: { state: "Pending" },
        },
      ],
      1,
      1,
      "0x1111111111111111111111111111111111111111",
    );

    expect(nextNonce).toBe(8);
  });
});
