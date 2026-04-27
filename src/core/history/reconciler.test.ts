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

  it("uses frozen submission identity before stale intent when recovering the next nonce", () => {
    const nextNonce = nextNonceWithLocalPending(
      7,
      [
        {
          intent: {
            account_index: 9,
            chain_id: 99,
            from: "0x9999999999999999999999999999999999999999",
            nonce: 99,
          },
          submission: {
            account_index: 1,
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111",
            nonce: 8,
          },
          nonce_thread: {
            account_index: 1,
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111",
            nonce: 8,
          },
          outcome: { state: "Pending" },
        },
      ],
      1,
      1,
      "0x1111111111111111111111111111111111111111",
    );

    expect(nextNonce).toBe(9);
  });

  it("falls back to nonce thread identity before stale intent when submission identity is incomplete", () => {
    const nextNonce = nextNonceWithLocalPending(
      3,
      [
        {
          intent: {
            account_index: 9,
            chain_id: 99,
            from: "0x9999999999999999999999999999999999999999",
            nonce: 99,
          },
          submission: {
            account_index: null,
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111",
            nonce: 4,
          },
          nonce_thread: {
            account_index: 1,
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111",
            nonce: 4,
          },
          outcome: { state: "Pending" },
        },
      ],
      1,
      1,
      "0x1111111111111111111111111111111111111111",
    );

    expect(nextNonce).toBe(5);
  });
});
