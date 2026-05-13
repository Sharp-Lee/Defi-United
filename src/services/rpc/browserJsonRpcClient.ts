import { getAddress } from "ethers/address";

export interface BrowserJsonRpcClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<number>;
  getNativeBalance(accountAddress: string): Promise<string>;
  getErc20Balance(tokenAddress: string, accountAddress: string): Promise<string>;
}

type JsonRpcFetch = (input: string, init: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
}>;

interface JsonRpcSuccess {
  result: unknown;
}

interface JsonRpcFailure {
  error: {
    message?: string;
    code?: number;
  };
}

function getFetch(fetchImpl?: typeof fetch): JsonRpcFetch {
  const availableFetch = fetchImpl ?? globalThis.fetch;
  if (!availableFetch) {
    throw new Error("RPC request failed: fetch unavailable");
  }
  return availableFetch as JsonRpcFetch;
}

function parseHexQuantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`RPC request failed: invalid ${label}`);
  }
  return BigInt(value);
}

function parseChainId(value: unknown): number {
  const chainId = parseHexQuantity(value, "chain id");
  return bigintToSafeNumber(chainId, "chain id");
}

function bigintToSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`RPC request failed: ${label} exceeds safe integer range`);
  }
  return Number(value);
}

function assertJsonRpcResult(payload: unknown): JsonRpcSuccess {
  if (!payload || typeof payload !== "object") {
    throw new Error("RPC request failed: malformed response");
  }
  if ("error" in payload) {
    const failure = payload as JsonRpcFailure;
    throw new Error(sanitizeRpcErrorMessage(failure.error?.message ?? "JSON-RPC error"));
  }
  if (!("result" in payload)) {
    throw new Error("RPC request failed: missing result");
  }
  return payload as JsonRpcSuccess;
}

async function requestJsonRpc(
  rpcUrl: string,
  fetchImpl: typeof fetch | undefined,
  id: number,
  method: string,
  params: unknown[],
): Promise<unknown> {
  try {
    const fetchForRequest = getFetch(fetchImpl);
    const response = await fetchForRequest(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
    }
    return assertJsonRpcResult(await response.json()).result;
  } catch (error) {
    throw new Error(sanitizeRpcErrorMessage(error));
  }
}

export function sanitizeRpcErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const withoutUrls = rawMessage.replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]");
  const withoutPaths = withoutUrls.replace(/\/[A-Za-z0-9._~%!$&'()*+,;=:@-]+(?:\/[A-Za-z0-9._~%!$&'()*+,;=:@-]+)+/g, "/[redacted-path]");
  const withoutSingleSegmentPaths = withoutPaths.replace(/\/[A-Za-z0-9._~%!$&'()*+,;=:@-]+/g, "/[redacted-path]");
  const withoutQueries = withoutSingleSegmentPaths.replace(/[?&][A-Za-z0-9_.~-]+=[^\s"'<>]+/g, "[redacted-query]");
  const message = withoutQueries.trim() || "unknown error";
  return message.startsWith("RPC request failed") ? message : `RPC request failed: ${message}`;
}

export function encodeErc20BalanceOfCall(accountAddress: string): string {
  const normalizedAddress = getAddress(accountAddress).slice(2).toLowerCase();
  return `0x70a08231${normalizedAddress.padStart(64, "0")}`;
}

export function decodeErc20BalanceResult(result: unknown): string {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error("RPC request failed: invalid ERC-20 balance result");
  }
  return BigInt(result).toString(10);
}

export function createBrowserJsonRpcClient(rpcUrl: string, fetchImpl?: typeof fetch): BrowserJsonRpcClient {
  let nextId = 1;
  const request = (method: string, params: unknown[] = []) =>
    requestJsonRpc(rpcUrl, fetchImpl, nextId++, method, params);

  return {
    async getChainId() {
      return parseChainId(await request("eth_chainId"));
    },
    async getBlockNumber() {
      return bigintToSafeNumber(parseHexQuantity(await request("eth_blockNumber"), "block number"), "block number");
    },
    async getNativeBalance(accountAddress: string) {
      const result = await request("eth_getBalance", [getAddress(accountAddress), "latest"]);
      return parseHexQuantity(result, "native balance").toString(10);
    },
    async getErc20Balance(tokenAddress: string, accountAddress: string) {
      const result = await request("eth_call", [
        {
          to: getAddress(tokenAddress),
          data: encodeErc20BalanceOfCall(accountAddress),
        },
        "latest",
      ]);
      return decodeErc20BalanceResult(result);
    },
  };
}
