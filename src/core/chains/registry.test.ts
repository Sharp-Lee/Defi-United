import { describe, expect, it } from "vitest";
import { validateCustomRpc } from "./registry";

describe("validateCustomRpc", () => {
  it("rejects a custom RPC whose returned chain id does not match the expected chain", async () => {
    const fetchChainId = async () => 8453n;

    await expect(
      validateCustomRpc(
        {
          id: "eth-mainnet",
          name: "Ethereum",
          chainId: 1n,
          nativeSymbol: "ETH",
          rpcUrl: "https://rpc.example",
        },
        fetchChainId,
      ),
    ).rejects.toThrow("Remote chainId 8453 does not match expected chainId 1");
  });
});
