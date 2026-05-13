import { describe, expect, it, vi } from "vitest";
import {
  createBrowserJsonRpcClient,
  decodeErc20BalanceResult,
  encodeErc20BalanceOfCall,
  sanitizeRpcErrorMessage,
} from "./browserJsonRpcClient";

function createJsonResponse(result: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  };
}

describe("browser JSON-RPC client", () => {
  const BALANCE_OF_DEAD_ACCOUNT_CALL = `0x70a08231${"0".repeat(60)}dead`;

  it("posts JSON-RPC requests and parses chain id hex quantities", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse("0x2105")) as unknown as typeof fetch;
    const client = createBrowserJsonRpcClient("https://rpc.example/private-token", fetchImpl);

    await expect(client.getChainId()).resolves.toBe(8453);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://rpc.example/private-token",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      }),
    );
  });

  it("rejects HTTP errors without leaking RPC URLs or path tokens", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized https://rpc.example.com/project/secret-token",
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const client = createBrowserJsonRpcClient("https://rpc.example.com/project/secret-token", fetchImpl);

    await expect(client.getChainId()).rejects.toThrow(/RPC request failed/);
    await expect(client.getChainId()).rejects.not.toThrow(/rpc\.example\.com|secret-token/);
  });

  it("rejects JSON-RPC errors with sanitized messages", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "boom https://rpc.example.com/project/secret-token" },
      }),
    })) as unknown as typeof fetch;
    const client = createBrowserJsonRpcClient("https://rpc.example.com/project/secret-token", fetchImpl);

    await expect(client.getBlockNumber()).rejects.toThrow(/RPC request failed/);
    await expect(client.getBlockNumber()).rejects.not.toThrow(/rpc\.example\.com|secret-token/);
  });

  it("parses block numbers as safe numbers", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse("0x3039")) as unknown as typeof fetch;
    const client = createBrowserJsonRpcClient("https://rpc.example/private-token", fetchImpl);

    await expect(client.getBlockNumber()).resolves.toBe(12345);
  });

  it("parses native balance hex quantities into decimal strings", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse("0xde0b6b3a7640000")) as unknown as typeof fetch;
    const client = createBrowserJsonRpcClient("https://rpc.example/private-token", fetchImpl);

    await expect(client.getNativeBalance("0x000000000000000000000000000000000000dEaD")).resolves.toBe(
      "1000000000000000000",
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://rpc.example/private-token",
      expect.objectContaining({
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBalance",
          params: ["0x000000000000000000000000000000000000dEaD", "latest"],
        }),
      }),
    );
  });

  it("uses eth_call balanceOf(address) and decodes ERC-20 balances into decimal strings", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse("0x0000000000000000000000000000000000000000000000000000000000003039"),
    ) as unknown as typeof fetch;
    const client = createBrowserJsonRpcClient("https://rpc.example/private-token", fetchImpl);

    await expect(
      client.getErc20Balance(
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "0x000000000000000000000000000000000000dEaD",
      ),
    ).resolves.toBe("12345");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://rpc.example/private-token",
      expect.objectContaining({
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [
            {
              to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
              data: BALANCE_OF_DEAD_ACCOUNT_CALL,
            },
            "latest",
          ],
        }),
      }),
    );
  });

  it("encodes and decodes ERC-20 balanceOf(address) calls", () => {
    const callData = encodeErc20BalanceOfCall("0x000000000000000000000000000000000000dEaD");

    expect(callData).toBe(BALANCE_OF_DEAD_ACCOUNT_CALL);
    expect(
      decodeErc20BalanceResult("0x0000000000000000000000000000000000000000000000000000000000003039"),
    ).toBe("12345");
  });

  it("sanitizes errors without leaking full RPC URLs or path tokens", () => {
    const sanitized = sanitizeRpcErrorMessage(
      new Error("failed https://rpc.example.com/project/secret-token/path?apiKey=abc 500"),
    );

    expect(sanitized).toContain("RPC request failed");
    expect(sanitized).not.toContain("https://rpc.example.com");
    expect(sanitized).not.toContain("secret-token");
    expect(sanitized).not.toContain("apiKey=abc");
  });

  it("sanitizes bare single-segment path tokens", () => {
    const sanitized = sanitizeRpcErrorMessage(new Error("provider said /secret-token failed"));

    expect(sanitized).toContain("RPC request failed");
    expect(sanitized).not.toContain("secret-token");
  });
});
