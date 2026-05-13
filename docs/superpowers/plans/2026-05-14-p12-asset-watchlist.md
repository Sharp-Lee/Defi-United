# P12 Asset Watchlist And Balance Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `资产` workspace that validates chain identity, refreshes native and watched ERC-20 balances for selected local accounts, and keeps all balance snapshots session-only.

**Architecture:** Add asset registry and balance-refresh logic outside React first, then wire it into the existing PWA shell. Persistent state is limited to non-secret watched ERC-20 definitions in localStorage; fetched balances and refresh errors remain in current React memory. P12 must not add signing, broadcasting, transaction queues, approvals, distribution, collection, ABI writes, inscriptions, reverse parsing, or durable transaction history. Per this project's workflow, subagents implement or review only; the controller performs fresh verification, commit, and push after each reviewed task.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, Playwright production-preview smoke tests, ethers v6 `getAddress`, `Interface`, `formatUnits`, existing encrypted vault and chain/RPC config boundaries.

---

## File Structure

- Create: `src/core/assets/browserAssetRegistry.ts`
  - Pure watched ERC-20 registry model, validation, add/update/remove/filter helpers.
- Create: `src/core/assets/browserAssetRegistry.test.ts`
  - Unit tests for registry validation, per-chain filtering, remove behavior, and no balance persistence.
- Create: `src/core/assets/balanceSnapshots.ts`
  - Pure refresh orchestrator, status model, snapshot types, formatting helpers, and sanitized error helpers.
- Create: `src/core/assets/balanceSnapshots.test.ts`
  - Unit tests for chain validation, native and ERC-20 refresh, partial failure, stale preservation, and redaction.
- Create: `src/core/assets/index.ts`
  - Public re-exports for asset domain.
- Create: `src/lib/browserAssetRegistry.ts`
  - localStorage and memory storage adapters for watched ERC-20 definitions.
- Create: `src/lib/browserAssetRegistry.test.ts`
  - Storage tests proving watched definitions persist and snapshots are not part of storage.
- Create: `src/services/rpc/browserJsonRpcClient.ts`
  - Small JSON-RPC client and ERC-20 `balanceOf` encoder/decoder.
- Create: `src/services/rpc/browserJsonRpcClient.test.ts`
  - Tests for JSON-RPC request shape, hex parsing, ERC-20 encoding/decoding, and sanitized errors.
- Create: `src/features/assets/AssetsModule.tsx`
  - Feature wrapper matching current module style.
- Create: `src/features/assets/PwaAssetWorkspace.tsx`
  - Read-only asset UI, watchlist editor, refresh status, native table, ERC-20 table.
- Create: `src/features/assets/PwaAssetWorkspace.test.tsx`
  - UI tests for locked/no-selected states, token add/remove, refresh callbacks, status labels, and no send controls.
- Modify: `src/app/shell/navigation.ts`
  - Mark `assets` as `ready` once UI is integrated.
- Modify: `src/app/shell/AppWorkspace.tsx`
  - Render `assetsContent` when the active module is `assets`.
- Modify: `src/app/shell/AppPreviewRail.tsx`
  - Update risk wording: P12 includes read-only balance scanning, but still no signing/broadcast/submit/history.
- Modify: `src/app/shell/AppShell.tsx`
  - Accept and forward `assetsContent`.
- Modify: `src/app/PwaShell.tsx`
  - Load asset registry, own session-only refresh state, wire asset workspace callbacks and RPC client factory.
- Modify: `src/app/PwaShell.test.tsx`
  - Integration tests for asset module, refresh success, chain mismatch, session-only snapshots, no send controls.
- Modify: `tests/browser/pwa-smoke.spec.ts`
  - Production-preview desktop/mobile smoke opens `资产` and verifies read-only boundary.
- Modify: `src/styles/features.css` and possibly `src/styles/components.css`
  - Asset table/editor/status styles using existing token system.
- Modify at milestone close: `README.md`, `docs/superpowers/project-overview.md`, `docs/superpowers/roadmap.md`, `docs/superpowers/project-status.md`
  - Current capability wording and P12 status.

---

### Task 1: Asset Registry Core And Storage

**Files:**
- Create: `src/core/assets/browserAssetRegistry.ts`
- Create: `src/core/assets/browserAssetRegistry.test.ts`
- Create: `src/core/assets/index.ts`
- Create: `src/lib/browserAssetRegistry.ts`
- Create: `src/lib/browserAssetRegistry.test.ts`

- [ ] **Step 1: Write failing registry core tests**

Create `src/core/assets/browserAssetRegistry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addWatchedErc20Asset,
  createDefaultBrowserAssetRegistryState,
  getEnabledWatchedErc20AssetsForChain,
  removeWatchedErc20Asset,
  updateWatchedErc20Asset,
  validateBrowserAssetRegistryState,
} from "./browserAssetRegistry";

describe("browser asset registry", () => {
  it("adds normalized watched ERC-20 assets and filters them by active chain", () => {
    const state = createDefaultBrowserAssetRegistryState();
    const withUsdc = addWatchedErc20Asset(state, {
      chainId: 1,
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      symbol: " usdc ",
      decimals: 6,
      label: " USD Coin ",
    });
    const withBaseToken = addWatchedErc20Asset(withUsdc, {
      chainId: 8453,
      contractAddress: "0x0000000000000000000000000000000000000001",
      symbol: "base",
      decimals: 18,
      label: "",
    });

    expect(getEnabledWatchedErc20AssetsForChain(withBaseToken, 1)).toMatchObject([
      {
        chainId: 1,
        contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        symbol: "USDC",
        decimals: 6,
        label: "USD Coin",
        enabled: true,
      },
    ]);
  });

  it("updates and removes watched assets without mutating other assets", () => {
    const state = addWatchedErc20Asset(createDefaultBrowserAssetRegistryState(), {
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000001",
      symbol: "one",
      decimals: 18,
      label: "One",
    });
    const assetId = state.watchedErc20Assets[0].id;
    const disabled = updateWatchedErc20Asset(state, assetId, { enabled: false, symbol: "two" });
    const removed = removeWatchedErc20Asset(disabled, assetId);

    expect(disabled.watchedErc20Assets[0]).toMatchObject({ enabled: false, symbol: "TWO" });
    expect(removed.watchedErc20Assets).toHaveLength(0);
  });

  it("rejects malformed registry state", () => {
    expect(() =>
      validateBrowserAssetRegistryState({
        schemaVersion: 1,
        updatedAt: "now",
        watchedErc20Assets: [
          {
            id: "bad",
            chainId: 1,
            contractAddress: "not-an-address",
            symbol: "BAD",
            decimals: 18,
            label: "Bad",
            enabled: true,
            createdAt: "now",
            updatedAt: "now",
          },
        ],
      }),
    ).toThrow(/Invalid browser asset registry state/);
  });
});
```

- [ ] **Step 2: Write failing storage tests**

Create `src/lib/browserAssetRegistry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addWatchedErc20Asset,
  createDefaultBrowserAssetRegistryState,
  getEnabledWatchedErc20AssetsForChain,
} from "../core/assets/browserAssetRegistry";
import {
  createMemoryBrowserAssetRegistryStorage,
  loadBrowserAssetRegistryState,
  saveBrowserAssetRegistryState,
} from "./browserAssetRegistry";

describe("browser asset registry storage", () => {
  it("loads a default empty registry", async () => {
    const storage = createMemoryBrowserAssetRegistryStorage();
    const state = await loadBrowserAssetRegistryState(storage);

    expect(state).toMatchObject({ schemaVersion: 1, watchedErc20Assets: [] });
  });

  it("persists watched token definitions but has no balance snapshot fields", async () => {
    const storage = createMemoryBrowserAssetRegistryStorage();
    const state = addWatchedErc20Asset(createDefaultBrowserAssetRegistryState(), {
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000001",
      symbol: "TOK",
      decimals: 18,
      label: "Token",
    });

    await saveBrowserAssetRegistryState(state, storage);
    const reloaded = await loadBrowserAssetRegistryState(storage);

    expect(getEnabledWatchedErc20AssetsForChain(reloaded, 1)).toHaveLength(1);
    expect(JSON.stringify(reloaded)).not.toMatch(/balance|snapshot|private|mnemonic|password|signed/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/core/assets/browserAssetRegistry.test.ts src/lib/browserAssetRegistry.test.ts
```

Expected: FAIL because the new modules do not exist yet.

- [ ] **Step 4: Implement registry core**

Create `src/core/assets/browserAssetRegistry.ts` with these exports:

```ts
import { getAddress, isAddress } from "ethers/address";

export const BROWSER_ASSET_REGISTRY_SCHEMA_VERSION = 1;

export interface BrowserWatchedErc20Asset {
  id: string;
  chainId: number;
  contractAddress: string;
  symbol: string;
  decimals: number;
  label: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserAssetRegistryState {
  schemaVersion: typeof BROWSER_ASSET_REGISTRY_SCHEMA_VERSION;
  watchedErc20Assets: BrowserWatchedErc20Asset[];
  updatedAt: string;
}

export interface BrowserWatchedErc20AssetInput {
  chainId: number;
  contractAddress: string;
  symbol: string;
  decimals: number;
  label?: string;
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeSymbol(value: string) {
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed.slice(0, 24) : "TOKEN";
}

function normalizeDecimals(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 36) {
    throw new Error("Invalid browser asset registry state.");
  }
  return value;
}

function normalizeChainId(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Invalid browser asset registry state.");
  }
  return value;
}

function normalizeAddress(value: string) {
  if (!isAddress(value)) {
    throw new Error("Invalid browser asset registry state.");
  }
  return getAddress(value);
}

function normalizeInput(input: BrowserWatchedErc20AssetInput) {
  const symbol = normalizeSymbol(input.symbol);
  const label = input.label?.trim() || symbol;
  return {
    chainId: normalizeChainId(input.chainId),
    contractAddress: normalizeAddress(input.contractAddress),
    symbol,
    decimals: normalizeDecimals(input.decimals),
    label,
  };
}

export function createDefaultBrowserAssetRegistryState(): BrowserAssetRegistryState {
  return {
    schemaVersion: BROWSER_ASSET_REGISTRY_SCHEMA_VERSION,
    watchedErc20Assets: [],
    updatedAt: nowIso(),
  };
}

export function addWatchedErc20Asset(
  state: BrowserAssetRegistryState,
  input: BrowserWatchedErc20AssetInput,
): BrowserAssetRegistryState {
  const timestamp = nowIso();
  const normalized = normalizeInput(input);
  const existing = state.watchedErc20Assets.find(
    (asset) => asset.chainId === normalized.chainId && asset.contractAddress === normalized.contractAddress,
  );
  if (existing) {
    return updateWatchedErc20Asset(state, existing.id, { ...normalized, enabled: true });
  }
  return {
    ...state,
    watchedErc20Assets: [
      ...state.watchedErc20Assets,
      {
        id: createId("watched-erc20"),
        ...normalized,
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    updatedAt: timestamp,
  };
}

export function updateWatchedErc20Asset(
  state: BrowserAssetRegistryState,
  assetId: string,
  updates: Partial<BrowserWatchedErc20AssetInput & Pick<BrowserWatchedErc20Asset, "enabled">>,
): BrowserAssetRegistryState {
  const timestamp = nowIso();
  let changed = false;
  const watchedErc20Assets = state.watchedErc20Assets.map((asset) => {
    if (asset.id !== assetId) return asset;
    changed = true;
    const normalized = normalizeInput({
      chainId: updates.chainId ?? asset.chainId,
      contractAddress: updates.contractAddress ?? asset.contractAddress,
      symbol: updates.symbol ?? asset.symbol,
      decimals: updates.decimals ?? asset.decimals,
      label: updates.label ?? asset.label,
    });
    return {
      ...asset,
      ...normalized,
      enabled: updates.enabled ?? asset.enabled,
      updatedAt: timestamp,
    };
  });

  return changed ? { ...state, watchedErc20Assets, updatedAt: timestamp } : state;
}

export function removeWatchedErc20Asset(state: BrowserAssetRegistryState, assetId: string): BrowserAssetRegistryState {
  const watchedErc20Assets = state.watchedErc20Assets.filter((asset) => asset.id !== assetId);
  return watchedErc20Assets.length === state.watchedErc20Assets.length
    ? state
    : { ...state, watchedErc20Assets, updatedAt: nowIso() };
}

export function getEnabledWatchedErc20AssetsForChain(state: BrowserAssetRegistryState, chainId: number) {
  return state.watchedErc20Assets.filter((asset) => asset.enabled && asset.chainId === chainId);
}

export function validateBrowserAssetRegistryState(value: unknown): BrowserAssetRegistryState {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid browser asset registry state.");
  }
  const state = value as BrowserAssetRegistryState;
  if (
    state.schemaVersion !== BROWSER_ASSET_REGISTRY_SCHEMA_VERSION ||
    typeof state.updatedAt !== "string" ||
    !Array.isArray(state.watchedErc20Assets)
  ) {
    throw new Error("Invalid browser asset registry state.");
  }
  for (const asset of state.watchedErc20Assets) {
    if (
      typeof asset.id !== "string" ||
      typeof asset.symbol !== "string" ||
      typeof asset.label !== "string" ||
      typeof asset.createdAt !== "string" ||
      typeof asset.updatedAt !== "string" ||
      typeof asset.enabled !== "boolean"
    ) {
      throw new Error("Invalid browser asset registry state.");
    }
    normalizeChainId(asset.chainId);
    normalizeAddress(asset.contractAddress);
    normalizeDecimals(asset.decimals);
  }
  return {
    ...state,
    watchedErc20Assets: state.watchedErc20Assets.map((asset) => ({
      ...asset,
      chainId: normalizeChainId(asset.chainId),
      contractAddress: normalizeAddress(asset.contractAddress),
      symbol: normalizeSymbol(asset.symbol),
      decimals: normalizeDecimals(asset.decimals),
      label: asset.label.trim() || normalizeSymbol(asset.symbol),
    })),
  };
}
```

- [ ] **Step 5: Implement storage adapters and re-export**

Create `src/core/assets/index.ts`:

```ts
export * from "./browserAssetRegistry";
```

Create `src/lib/browserAssetRegistry.ts`:

```ts
import {
  createDefaultBrowserAssetRegistryState,
  validateBrowserAssetRegistryState,
  type BrowserAssetRegistryState,
} from "../core/assets/browserAssetRegistry";

const STORAGE_KEY = "defi-united-pwa-asset-registry";

export interface BrowserAssetRegistryStorage {
  loadState(): Promise<BrowserAssetRegistryState>;
  saveState(state: BrowserAssetRegistryState): Promise<void>;
  clearState(): Promise<void>;
}

function getLocalStorage() {
  if (!globalThis.localStorage) {
    throw new Error("Browser asset registry storage is unavailable in this browser context.");
  }
  return globalThis.localStorage;
}

export const localStorageBrowserAssetRegistryStorage = {
  async loadState() {
    const serialized = getLocalStorage().getItem(STORAGE_KEY);
    if (!serialized) return createDefaultBrowserAssetRegistryState();
    return validateBrowserAssetRegistryState(JSON.parse(serialized));
  },
  async saveState(state: BrowserAssetRegistryState) {
    getLocalStorage().setItem(STORAGE_KEY, JSON.stringify(validateBrowserAssetRegistryState(state)));
  },
  async clearState() {
    getLocalStorage().removeItem(STORAGE_KEY);
  },
} satisfies BrowserAssetRegistryStorage;

export function createMemoryBrowserAssetRegistryStorage(initialState?: BrowserAssetRegistryState) {
  let state = initialState
    ? validateBrowserAssetRegistryState(initialState)
    : createDefaultBrowserAssetRegistryState();
  return {
    async loadState() {
      return state;
    },
    async saveState(nextState: BrowserAssetRegistryState) {
      state = validateBrowserAssetRegistryState(nextState);
    },
    async clearState() {
      state = createDefaultBrowserAssetRegistryState();
    },
  } satisfies BrowserAssetRegistryStorage;
}

export async function loadBrowserAssetRegistryState(
  storage: BrowserAssetRegistryStorage = localStorageBrowserAssetRegistryStorage,
) {
  return storage.loadState();
}

export async function saveBrowserAssetRegistryState(
  state: BrowserAssetRegistryState,
  storage: BrowserAssetRegistryStorage = localStorageBrowserAssetRegistryStorage,
) {
  await storage.saveState(state);
}
```

- [ ] **Step 6: Verify Task 1**

Run:

```bash
npm test -- src/core/assets/browserAssetRegistry.test.ts src/lib/browserAssetRegistry.test.ts
npm run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Controller commit gate for Task 1**

Controller only, after spec and quality review pass:

```bash
git add src/core/assets/browserAssetRegistry.ts src/core/assets/browserAssetRegistry.test.ts src/core/assets/index.ts src/lib/browserAssetRegistry.ts src/lib/browserAssetRegistry.test.ts docs/superpowers/project-status.md
git diff --cached --check
git commit -m "feat: add browser asset registry"
git push
```

---

### Task 2: RPC Client And Balance Refresh Core

**Files:**
- Create: `src/services/rpc/browserJsonRpcClient.ts`
- Create: `src/services/rpc/browserJsonRpcClient.test.ts`
- Create: `src/core/assets/balanceSnapshots.ts`
- Create: `src/core/assets/balanceSnapshots.test.ts`
- Modify: `src/core/assets/index.ts`

- [ ] **Step 1: Write failing RPC client tests**

Create `src/services/rpc/browserJsonRpcClient.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createBrowserJsonRpcClient,
  decodeErc20BalanceResult,
  encodeErc20BalanceOfCall,
  sanitizeRpcErrorMessage,
} from "./browserJsonRpcClient";

describe("browser JSON-RPC client", () => {
  it("posts JSON-RPC requests and parses hex quantities", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x1" }),
    })) as unknown as typeof fetch;
    const client = createBrowserJsonRpcClient("https://rpc.example.test/secret-token", fetchImpl);

    await expect(client.getChainId()).resolves.toBe(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://rpc.example.test/secret-token",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("encodes and decodes ERC-20 balanceOf calls", () => {
    const data = encodeErc20BalanceOfCall("0x0000000000000000000000000000000000000001");
    const decoded = decodeErc20BalanceResult(
      "0x000000000000000000000000000000000000000000000000000000000000007b",
    );

    expect(data).toMatch(/^0x70a08231/);
    expect(decoded).toBe("123");
  });

  it("sanitizes RPC errors without leaking endpoint paths", () => {
    const message = sanitizeRpcErrorMessage(
      new Error("fetch failed for https://rpc.example.test/my-secret-token"),
    );

    expect(message).toContain("RPC request failed");
    expect(message).not.toContain("my-secret-token");
    expect(message).not.toContain("https://");
  });
});
```

- [ ] **Step 2: Write failing refresh core tests**

Create `src/core/assets/balanceSnapshots.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addWatchedErc20Asset, createDefaultBrowserAssetRegistryState } from "./browserAssetRegistry";
import { refreshAssetBalanceSnapshots, type AssetBalanceRpcClient } from "./balanceSnapshots";

const accounts = [
  { label: "账户 1", address: "0x0000000000000000000000000000000000000001" },
  { label: "账户 2", address: "0x0000000000000000000000000000000000000002" },
];

function createRpcClient(overrides: Partial<AssetBalanceRpcClient> = {}): AssetBalanceRpcClient {
  return {
    async getChainId() {
      return 1;
    },
    async getBlockNumber() {
      return 100;
    },
    async getNativeBalance(address: string) {
      return address.endsWith("1") ? "1000000000000000000" : "2000000000000000000";
    },
    async getErc20Balance() {
      return "1230000";
    },
    ...overrides,
  };
}

describe("asset balance snapshots", () => {
  it("refreshes native and ERC-20 balances after chain validation", async () => {
    const registry = addWatchedErc20Asset(createDefaultBrowserAssetRegistryState(), {
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000010",
      symbol: "TOK",
      decimals: 6,
      label: "Token",
    });

    const result = await refreshAssetBalanceSnapshots({
      activeChainId: 1,
      accounts,
      watchedAssets: registry.watchedErc20Assets,
      rpcClient: createRpcClient(),
      previous: null,
    });

    expect(result.status).toBe("success");
    expect(result.nativeBalances).toHaveLength(2);
    expect(result.erc20Balances).toHaveLength(2);
    expect(result.nativeBalances[0]).toMatchObject({ balanceWei: "1000000000000000000", blockNumber: 100 });
  });

  it("blocks refresh on chain mismatch and keeps previous snapshots stale", async () => {
    const previous = await refreshAssetBalanceSnapshots({
      activeChainId: 1,
      accounts,
      watchedAssets: [],
      rpcClient: createRpcClient(),
      previous: null,
    });

    const mismatch = await refreshAssetBalanceSnapshots({
      activeChainId: 1,
      accounts,
      watchedAssets: [],
      rpcClient: createRpcClient({ async getChainId() { return 8453; } }),
      previous,
    });

    expect(mismatch.status).toBe("chain-mismatch");
    expect(mismatch.chainValidation).toMatchObject({ expectedChainId: 1, actualChainId: 8453 });
    expect(mismatch.stale).toBe(true);
    expect(mismatch.nativeBalances).toHaveLength(2);
  });

  it("reports partial failures without silently zeroing failed rows", async () => {
    const result = await refreshAssetBalanceSnapshots({
      activeChainId: 1,
      accounts,
      watchedAssets: [],
      rpcClient: createRpcClient({
        async getNativeBalance(address: string) {
          if (address.endsWith("2")) throw new Error("RPC request failed");
          return "1000000000000000000";
        },
      }),
      previous: null,
    });

    expect(result.status).toBe("partial");
    expect(result.nativeBalances).toHaveLength(1);
    expect(result.failures).toEqual([
      expect.objectContaining({ accountAddress: accounts[1].address, message: "RPC request failed" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("https://");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/services/rpc/browserJsonRpcClient.test.ts src/core/assets/balanceSnapshots.test.ts
```

Expected: FAIL because the new modules do not exist yet.

- [ ] **Step 4: Implement JSON-RPC client**

Create `src/services/rpc/browserJsonRpcClient.ts` with:

```ts
import { Interface, getBytes, hexlify, toBigInt } from "ethers";

export interface BrowserJsonRpcClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<number>;
  getNativeBalance(address: string): Promise<string>;
  getErc20Balance(tokenAddress: string, accountAddress: string): Promise<string>;
}

const erc20Interface = new Interface(["function balanceOf(address) view returns (uint256)"]);

export function sanitizeRpcErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutUrls = raw.replace(/https?:\/\/\S+/gi, "[redacted-rpc-url]");
  return withoutUrls.includes("RPC request failed") ? withoutUrls : `RPC request failed: ${withoutUrls}`;
}

export function encodeErc20BalanceOfCall(accountAddress: string) {
  return erc20Interface.encodeFunctionData("balanceOf", [accountAddress]);
}

export function decodeErc20BalanceResult(result: string) {
  return erc20Interface.decodeFunctionResult("balanceOf", result)[0].toString();
}

function parseHexQuantity(value: unknown) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error("RPC request failed: invalid hex quantity");
  }
  return Number(toBigInt(value));
}

async function requestJsonRpc(rpcUrl: string, fetchImpl: typeof fetch, method: string, params: unknown[]) {
  try {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message ?? "JSON-RPC error");
    return payload.result;
  } catch (error) {
    throw new Error(sanitizeRpcErrorMessage(error));
  }
}

export function createBrowserJsonRpcClient(
  rpcUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): BrowserJsonRpcClient {
  return {
    async getChainId() {
      return parseHexQuantity(await requestJsonRpc(rpcUrl, fetchImpl, "eth_chainId", []));
    },
    async getBlockNumber() {
      return parseHexQuantity(await requestJsonRpc(rpcUrl, fetchImpl, "eth_blockNumber", []));
    },
    async getNativeBalance(address: string) {
      return toBigInt(await requestJsonRpc(rpcUrl, fetchImpl, "eth_getBalance", [address, "latest"])).toString();
    },
    async getErc20Balance(tokenAddress: string, accountAddress: string) {
      const data = encodeErc20BalanceOfCall(accountAddress);
      const result = await requestJsonRpc(rpcUrl, fetchImpl, "eth_call", [{ to: tokenAddress, data }, "latest"]);
      getBytes(hexlify(result));
      return decodeErc20BalanceResult(result);
    },
  };
}
```

If `globalThis.fetch.bind(globalThis)` fails under tests because `fetch` is undefined, change the default to:

```ts
const defaultFetch = globalThis.fetch;
if (!defaultFetch) throw new Error("RPC request failed: fetch unavailable");
```

and keep tests dependency-injected.

- [ ] **Step 5: Implement balance snapshot core**

Create `src/core/assets/balanceSnapshots.ts` with:

```ts
import type { BrowserWatchedErc20Asset } from "./browserAssetRegistry";

export type AssetRefreshStatus =
  | "idle"
  | "validating-chain"
  | "refreshing"
  | "success"
  | "partial"
  | "failed"
  | "chain-mismatch"
  | "no-rpc"
  | "no-selected-accounts";

export interface AssetBalanceAccount {
  label: string;
  address: string;
}

export interface AssetBalanceRpcClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<number>;
  getNativeBalance(address: string): Promise<string>;
  getErc20Balance(tokenAddress: string, accountAddress: string): Promise<string>;
}

export interface NativeBalanceSnapshot {
  chainId: number;
  accountAddress: string;
  accountLabel: string;
  balanceWei: string;
  blockNumber: number | null;
  refreshedAt: string;
}

export interface Erc20BalanceSnapshot {
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  accountAddress: string;
  accountLabel: string;
  balanceRaw: string;
  blockNumber: number | null;
  refreshedAt: string;
}

export interface AssetRefreshFailure {
  scope: "native" | "erc20";
  accountAddress: string;
  tokenAddress?: string;
  message: string;
}

export interface AssetBalanceSnapshotState {
  status: AssetRefreshStatus;
  stale: boolean;
  chainValidation: {
    expectedChainId: number | null;
    actualChainId: number | null;
  };
  nativeBalances: NativeBalanceSnapshot[];
  erc20Balances: Erc20BalanceSnapshot[];
  failures: AssetRefreshFailure[];
  refreshedAt: string | null;
}

export const EMPTY_ASSET_BALANCE_SNAPSHOT_STATE: AssetBalanceSnapshotState = {
  status: "idle",
  stale: false,
  chainValidation: { expectedChainId: null, actualChainId: null },
  nativeBalances: [],
  erc20Balances: [],
  failures: [],
  refreshedAt: null,
};

function safeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/https?:\/\/\S+/gi, "[redacted-rpc-url]");
}

export async function refreshAssetBalanceSnapshots({
  activeChainId,
  accounts,
  watchedAssets,
  rpcClient,
  previous,
}: {
  activeChainId: number;
  accounts: AssetBalanceAccount[];
  watchedAssets: BrowserWatchedErc20Asset[];
  rpcClient: AssetBalanceRpcClient;
  previous: AssetBalanceSnapshotState | null;
}): Promise<AssetBalanceSnapshotState> {
  if (accounts.length === 0) {
    return { ...(previous ?? EMPTY_ASSET_BALANCE_SNAPSHOT_STATE), status: "no-selected-accounts", stale: Boolean(previous) };
  }

  const actualChainId = await rpcClient.getChainId();
  if (actualChainId !== activeChainId) {
    return {
      ...(previous ?? EMPTY_ASSET_BALANCE_SNAPSHOT_STATE),
      status: "chain-mismatch",
      stale: Boolean(previous),
      chainValidation: { expectedChainId: activeChainId, actualChainId },
    };
  }

  const blockNumber = await rpcClient.getBlockNumber();
  const refreshedAt = new Date().toISOString();
  const nativeBalances: NativeBalanceSnapshot[] = [];
  const erc20Balances: Erc20BalanceSnapshot[] = [];
  const failures: AssetRefreshFailure[] = [];

  for (const account of accounts) {
    try {
      nativeBalances.push({
        chainId: activeChainId,
        accountAddress: account.address,
        accountLabel: account.label,
        balanceWei: await rpcClient.getNativeBalance(account.address),
        blockNumber,
        refreshedAt,
      });
    } catch (error) {
      failures.push({
        scope: "native",
        accountAddress: account.address,
        message: safeErrorMessage(error),
      });
    }
  }

  for (const asset of watchedAssets.filter((asset) => asset.enabled && asset.chainId === activeChainId)) {
    for (const account of accounts) {
      try {
        erc20Balances.push({
          chainId: activeChainId,
          tokenAddress: asset.contractAddress,
          tokenSymbol: asset.symbol,
          tokenDecimals: asset.decimals,
          accountAddress: account.address,
          accountLabel: account.label,
          balanceRaw: await rpcClient.getErc20Balance(asset.contractAddress, account.address),
          blockNumber,
          refreshedAt,
        });
      } catch (error) {
        failures.push({
          scope: "erc20",
          accountAddress: account.address,
          tokenAddress: asset.contractAddress,
          message: safeErrorMessage(error),
        });
      }
    }
  }

  const successCount = nativeBalances.length + erc20Balances.length;
  const status: AssetRefreshStatus = failures.length === 0 ? "success" : successCount > 0 ? "partial" : "failed";

  return {
    status,
    stale: false,
    chainValidation: { expectedChainId: activeChainId, actualChainId },
    nativeBalances,
    erc20Balances,
    failures,
    refreshedAt,
  };
}
```

Update `src/core/assets/index.ts`:

```ts
export * from "./balanceSnapshots";
export * from "./browserAssetRegistry";
```

- [ ] **Step 6: Verify Task 2**

Run:

```bash
npm test -- src/services/rpc/browserJsonRpcClient.test.ts src/core/assets/balanceSnapshots.test.ts
npm run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Controller commit gate for Task 2**

Controller only, after spec and quality review pass:

```bash
git add src/services/rpc/browserJsonRpcClient.ts src/services/rpc/browserJsonRpcClient.test.ts src/core/assets/balanceSnapshots.ts src/core/assets/balanceSnapshots.test.ts src/core/assets/index.ts docs/superpowers/project-status.md
git diff --cached --check
git commit -m "feat: add asset balance refresh core"
git push
```

---

### Task 3: Asset Workspace UI

**Files:**
- Create: `src/features/assets/AssetsModule.tsx`
- Create: `src/features/assets/PwaAssetWorkspace.tsx`
- Create: `src/features/assets/PwaAssetWorkspace.test.tsx`
- Modify: `src/styles/features.css`

- [ ] **Step 1: Write failing workspace UI tests**

Create `src/features/assets/PwaAssetWorkspace.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { addWatchedErc20Asset, createDefaultBrowserAssetRegistryState } from "../../core/assets/browserAssetRegistry";
import { EMPTY_ASSET_BALANCE_SNAPSHOT_STATE, type AssetBalanceSnapshotState } from "../../core/assets/balanceSnapshots";
import { createDefaultBrowserChainConfigState, getActiveBrowserChain, getPrimaryRpcEndpoint } from "../../core/chains";
import { renderScreen } from "../../test/render";
import { PwaAssetWorkspace } from "./PwaAssetWorkspace";

const activeChain = getActiveBrowserChain(createDefaultBrowserChainConfigState())!;
const primaryRpc = getPrimaryRpcEndpoint(activeChain)!;

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof PwaAssetWorkspace>> = {}) {
  const registry = createDefaultBrowserAssetRegistryState();
  return renderScreen(
    <PwaAssetWorkspace
      activeChain={activeChain}
      assetRegistry={registry}
      busy={false}
      error={null}
      primaryRpc={primaryRpc}
      refreshState={EMPTY_ASSET_BALANCE_SNAPSHOT_STATE}
      selectedAccounts={[]}
      totalAccountCount={0}
      unlocked={false}
      onAddWatchedAsset={vi.fn()}
      onRefreshBalances={vi.fn()}
      onRemoveWatchedAsset={vi.fn()}
      {...overrides}
    />,
  );
}

describe("PwaAssetWorkspace", () => {
  it("shows locked and no-selected states without send controls", () => {
    renderWorkspace();

    expect(screen.getByRole("heading", { name: "资产" })).toBeInTheDocument();
    expect(screen.getByText(/解锁 vault 后才能刷新本地账户余额/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新余额" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /签名|广播|提交|approve|分发|归集/i })).not.toBeInTheDocument();
  });

  it("submits watched token definitions and remove actions", () => {
    const onAddWatchedAsset = vi.fn();
    const registry = addWatchedErc20Asset(createDefaultBrowserAssetRegistryState(), {
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000010",
      symbol: "TOK",
      decimals: 6,
      label: "Token",
    });
    const onRemoveWatchedAsset = vi.fn();
    renderWorkspace({ assetRegistry: registry, onAddWatchedAsset, onRemoveWatchedAsset, unlocked: true });

    fireEvent.change(screen.getByLabelText("Token 合约地址"), {
      target: { value: "0x0000000000000000000000000000000000000001" },
    });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Decimals"), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "ABC Token" } });
    fireEvent.click(screen.getByRole("button", { name: "添加 Token" }));

    expect(onAddWatchedAsset).toHaveBeenCalledWith({
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000001",
      symbol: "abc",
      decimals: 18,
      label: "ABC Token",
    });

    fireEvent.click(screen.getByRole("button", { name: /移除 TOK/ }));
    expect(onRemoveWatchedAsset).toHaveBeenCalledWith(registry.watchedErc20Assets[0].id);
  });

  it("renders refreshed native and ERC-20 balances with partial failure state", () => {
    const refreshState: AssetBalanceSnapshotState = {
      status: "partial",
      stale: false,
      chainValidation: { expectedChainId: 1, actualChainId: 1 },
      refreshedAt: "2026-05-14T00:00:00.000Z",
      nativeBalances: [
        {
          chainId: 1,
          accountAddress: "0x0000000000000000000000000000000000000001",
          accountLabel: "账户 1",
          balanceWei: "1000000000000000000",
          blockNumber: 100,
          refreshedAt: "2026-05-14T00:00:00.000Z",
        },
      ],
      erc20Balances: [
        {
          chainId: 1,
          tokenAddress: "0x0000000000000000000000000000000000000010",
          tokenSymbol: "TOK",
          tokenDecimals: 6,
          accountAddress: "0x0000000000000000000000000000000000000001",
          accountLabel: "账户 1",
          balanceRaw: "1230000",
          blockNumber: 100,
          refreshedAt: "2026-05-14T00:00:00.000Z",
        },
      ],
      failures: [{ scope: "native", accountAddress: "0x2", message: "RPC request failed" }],
    };

    renderWorkspace({
      refreshState,
      selectedAccounts: [{ label: "账户 1", address: "0x0000000000000000000000000000000000000001" }],
      totalAccountCount: 1,
      unlocked: true,
    });

    expect(screen.getByText("部分失败")).toBeInTheDocument();
    expect(screen.getByText("1.0 ETH")).toBeInTheDocument();
    expect(screen.getByText("1.23 TOK")).toBeInTheDocument();
    expect(screen.getByText(/RPC request failed/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/features/assets/PwaAssetWorkspace.test.tsx
```

Expected: FAIL because `PwaAssetWorkspace` does not exist yet.

- [ ] **Step 3: Implement feature wrapper**

Create `src/features/assets/AssetsModule.tsx`:

```tsx
import type { ReactNode } from "react";

export function AssetsModule({ children }: { children: ReactNode }) {
  return <section className="workspace-section assets-section">{children}</section>;
}
```

- [ ] **Step 4: Implement workspace UI**

Create `src/features/assets/PwaAssetWorkspace.tsx` with these public props:

```tsx
import { useState } from "react";
import { formatUnits } from "ethers";
import type { BrowserAssetRegistryState, BrowserWatchedErc20AssetInput } from "../../core/assets/browserAssetRegistry";
import { getEnabledWatchedErc20AssetsForChain } from "../../core/assets/browserAssetRegistry";
import type { AssetBalanceAccount, AssetBalanceSnapshotState } from "../../core/assets/balanceSnapshots";
import type { BrowserChainRecord, BrowserRpcEndpoint } from "../../core/chains";

export interface PwaAssetWorkspaceProps {
  activeChain: BrowserChainRecord | null;
  primaryRpc: BrowserRpcEndpoint | null;
  assetRegistry: BrowserAssetRegistryState;
  refreshState: AssetBalanceSnapshotState;
  selectedAccounts: AssetBalanceAccount[];
  totalAccountCount: number;
  unlocked: boolean;
  busy?: boolean;
  error?: string | null;
  onAddWatchedAsset(input: BrowserWatchedErc20AssetInput): void;
  onRemoveWatchedAsset(assetId: string): void;
  onRefreshBalances(): void;
}
```

Implement:

- status label map:

```ts
const STATUS_LABELS = {
  idle: "未刷新",
  "validating-chain": "校验链",
  refreshing: "刷新中",
  success: "已刷新",
  partial: "部分失败",
  failed: "刷新失败",
  "chain-mismatch": "链不匹配",
  "no-rpc": "无 RPC",
  "no-selected-accounts": "未选择账户",
} satisfies Record<AssetBalanceSnapshotState["status"], string>;
```

- form state for `contractAddress`, `symbol`, `decimals`, `label`;
- disabled refresh when `!unlocked || !activeChain || !primaryRpc || selectedAccounts.length === 0 || busy`;
- native table that formats `balanceWei` via `formatUnits(balanceWei, 18)` plus `activeChain.nativeCurrencySymbol`;
- ERC-20 table that formats `balanceRaw` via `formatUnits(balanceRaw, tokenDecimals)` plus token symbol;
- watched-token table filtered with `getEnabledWatchedErc20AssetsForChain(assetRegistry, activeChain.chainId)`;
- chain mismatch line:

```tsx
{refreshState.status === "chain-mismatch" && (
  <p className="inline-error">
    Chain ID 不匹配：期望 {refreshState.chainValidation.expectedChainId}，实际 {refreshState.chainValidation.actualChainId}
  </p>
)}
```

- no send controls. Do not add buttons containing `签名`, `广播`, `提交`, `approve`, `分发`, or `归集`.

- [ ] **Step 5: Add focused asset styles**

Append to `src/styles/features.css`:

```css
.assets-section {
  max-width: 1280px;
}

.asset-status-strip,
.asset-watchlist-form,
.asset-summary-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: end;
}

.asset-watchlist-form > label {
  min-width: 150px;
  flex: 1 1 170px;
}

.asset-table-grid {
  display: grid;
  gap: 14px;
}

.asset-failure-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 18px;
}
```

- [ ] **Step 6: Verify Task 3**

Run:

```bash
npm test -- src/features/assets/PwaAssetWorkspace.test.tsx
npm run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Controller commit gate for Task 3**

Controller only, after spec and quality review pass:

```bash
git add src/features/assets/AssetsModule.tsx src/features/assets/PwaAssetWorkspace.tsx src/features/assets/PwaAssetWorkspace.test.tsx src/styles/features.css docs/superpowers/project-status.md
git diff --cached --check
git commit -m "feat: add read-only asset workspace"
git push
```

---

### Task 4: Shell Integration, Refresh Wiring, And Browser Smoke

**Files:**
- Modify: `src/app/PwaShell.tsx`
- Modify: `src/app/PwaShell.test.tsx`
- Modify: `src/app/shell/AppShell.tsx`
- Modify: `src/app/shell/AppWorkspace.tsx`
- Modify: `src/app/shell/AppPreviewRail.tsx`
- Modify: `src/app/shell/navigation.ts`
- Modify: `tests/browser/pwa-smoke.spec.ts`

- [ ] **Step 1: Write failing shell integration tests**

In `src/app/PwaShell.test.tsx`, add imports:

```ts
import { Interface } from "ethers";
import { createMemoryBrowserAssetRegistryStorage } from "../lib/browserAssetRegistry";
import type { BrowserJsonRpcClient } from "../services/rpc/browserJsonRpcClient";
```

Update `renderPwaShell` and `renderPwaShellWithSharedStorage` to pass `assetRegistryStorage` where needed.

Add:

```tsx
function createMockRpcClient(overrides: Partial<BrowserJsonRpcClient> = {}): BrowserJsonRpcClient {
  return {
    async getChainId() {
      return 1;
    },
    async getBlockNumber() {
      return 123;
    },
    async getNativeBalance() {
      return "1000000000000000000";
    },
    async getErc20Balance() {
      return "2500000";
    },
    ...overrides,
  };
}

async function createUnlockedShellWithSelectedAccount(rpcClient: BrowserJsonRpcClient = createMockRpcClient()) {
  const vaultStorage = createMemoryBrowserVaultStorage();
  const chainConfigStorage = createMemoryBrowserChainConfigStorage();
  const assetRegistryStorage = createMemoryBrowserAssetRegistryStorage();
  renderScreen(
    <PwaShell
      assetRegistryStorage={assetRegistryStorage}
      chainConfigStorage={chainConfigStorage}
      createAssetRpcClient={() => rpcClient}
      vaultStorage={vaultStorage}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "账户库" }));
  fireEvent.change(screen.getByLabelText("Vault 密码"), { target: { value: "correct horse battery staple" } });
  fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "correct horse battery staple" } });
  fireEvent.click(screen.getByRole("button", { name: "创建 vault" }));
  await screen.findByRole("heading", { name: "账户与组" });
  fireEvent.click(screen.getByRole("button", { name: "资产" }));
  await screen.findByRole("heading", { name: "资产" });
}
```

Add tests:

```tsx
  it("refreshes asset balances through chain-validated RPC without send controls", async () => {
    await createUnlockedShellWithSelectedAccount();

    fireEvent.change(screen.getByLabelText("Token 合约地址"), {
      target: { value: "0x0000000000000000000000000000000000000010" },
    });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "tok" } });
    fireEvent.change(screen.getByLabelText("Decimals"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "添加 Token" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新余额" }));

    expect(await screen.findByText("已刷新")).toBeInTheDocument();
    expect(screen.getByText("1.0 ETH")).toBeInTheDocument();
    expect(screen.getByText("2.5 TOK")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /签名|广播|提交|approve|分发|归集/i })).not.toBeInTheDocument();
  });

  it("shows chain mismatch without leaking RPC URL secrets", async () => {
    await createUnlockedShellWithSelectedAccount(createMockRpcClient({ async getChainId() { return 8453; } }));

    fireEvent.click(screen.getByRole("button", { name: "刷新余额" }));

    expect(await screen.findByText("链不匹配")).toBeInTheDocument();
    expect(screen.getByText(/期望 1，实际 8453/)).toBeInTheDocument();
    expect(screen.queryByText(/ethereum\.publicnode\.com|https:\/\//i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/app/PwaShell.test.tsx
```

Expected: FAIL because `PwaShell` does not accept the new props and assets still render the planned-module surface.

- [ ] **Step 3: Wire shell module rendering**

Modify `src/app/shell/navigation.ts`:

```ts
{
  id: "assets",
  label: "资产",
  summary: "查看选中本地账户的原生币和 watched ERC-20 余额快照。",
  status: "ready",
  planned: ["链校验后余额刷新", "Token watchlist", "失败与陈旧状态"],
}
```

Modify `src/app/shell/AppShell.tsx` props:

```tsx
export function AppShell({
  accountsContent,
  activeModuleId,
  assetsContent,
  onSelectModule,
  sessionSummary,
  settingsContent,
}: {
  accountsContent: ReactNode;
  activeModuleId: AppModuleId;
  assetsContent: ReactNode;
  onSelectModule(moduleId: AppModuleId): void;
  sessionSummary: AppSessionSummary;
  settingsContent: ReactNode;
}) {
```

Pass `assetsContent` into `AppWorkspace`.

Modify `src/app/shell/AppWorkspace.tsx`:

```tsx
export function AppWorkspace({ accountsContent, activeModuleId, assetsContent, settingsContent }: Props) {
  if (activeModuleId === "accounts") return <>{accountsContent}</>;
  if (activeModuleId === "assets") return <>{assetsContent}</>;
  if (activeModuleId === "settings") return <>{settingsContent}</>;
  return <ModulePlaceholder module={getModuleById(activeModuleId)} />;
}
```

Modify `src/app/shell/AppPreviewRail.tsx` risk copy:

```tsx
<p>当前 shell 只允许 P12 只读余额刷新；仍不包含签名、广播、RPC 提交交易、分发归集执行或真实历史写入。</p>
```

- [ ] **Step 4: Wire PwaShell state and callbacks**

Modify `src/app/PwaShell.tsx`:

- import asset registry helpers/storage;
- import `AssetsModule`, `PwaAssetWorkspace`, `EMPTY_ASSET_BALANCE_SNAPSHOT_STATE`, `refreshAssetBalanceSnapshots`, `createBrowserJsonRpcClient`, `getPrimaryRpcEndpoint`;
- extend props:

```ts
export interface PwaShellProps {
  vaultStorage?: BrowserVaultStorage;
  chainConfigStorage?: BrowserChainConfigStorage;
  assetRegistryStorage?: BrowserAssetRegistryStorage;
  createAssetRpcClient?: (rpcUrl: string) => AssetBalanceRpcClient;
}
```

- create state:

```ts
const [assetRegistry, setAssetRegistry] = useState<BrowserAssetRegistryState>(createDefaultBrowserAssetRegistryState());
const [assetRegistryBusy, setAssetRegistryBusy] = useState(false);
const [assetRegistryError, setAssetRegistryError] = useState<string | null>(null);
const [assetRefreshState, setAssetRefreshState] = useState<AssetBalanceSnapshotState>(EMPTY_ASSET_BALANCE_SNAPSHOT_STATE);
const [assetRefreshBusy, setAssetRefreshBusy] = useState(false);
const assetRefreshRequestId = useRef(0);
```

- load registry in `useEffect`;
- persist registry using `saveBrowserAssetRegistryState`;
- derive selected accounts:

```ts
const selectedAccounts =
  session?.state.groups
    .flatMap((group) => group.accounts)
    .filter((account) => account.selected)
    .map((account) => ({ label: account.label, address: account.address })) ?? [];
```

- implement `handleRefreshAssetBalances`:

```ts
async function handleRefreshAssetBalances() {
  const primaryRpc = getPrimaryRpcEndpoint(activeChain);
  if (!session || !activeChain || !primaryRpc) {
    setAssetRefreshState((previous) => ({
      ...previous,
      status: primaryRpc ? "no-selected-accounts" : "no-rpc",
      stale: previous.nativeBalances.length + previous.erc20Balances.length > 0,
    }));
    return;
  }
  const selected = selectedAccounts;
  if (selected.length === 0) {
    setAssetRefreshState((previous) => ({ ...previous, status: "no-selected-accounts", stale: false }));
    return;
  }
  const requestId = assetRefreshRequestId.current + 1;
  assetRefreshRequestId.current = requestId;
  setAssetRefreshBusy(true);
  setAssetRefreshState((previous) => ({ ...previous, status: "validating-chain" }));
  try {
    const rpcClient = (createAssetRpcClient ?? ((url) => createBrowserJsonRpcClient(url)))(primaryRpc.url);
    const next = await refreshAssetBalanceSnapshots({
      activeChainId: activeChain.chainId,
      accounts: selected,
      watchedAssets: assetRegistry.watchedErc20Assets,
      rpcClient,
      previous: assetRefreshState,
    });
    if (assetRefreshRequestId.current === requestId) setAssetRefreshState(next);
  } catch (err) {
    if (assetRefreshRequestId.current === requestId) {
      setAssetRefreshState((previous) => ({
        ...previous,
        status: "failed",
        stale: previous.nativeBalances.length + previous.erc20Balances.length > 0,
        failures: [{ scope: "native", accountAddress: "all", message: err instanceof Error ? err.message : String(err) }],
      }));
    }
  } finally {
    if (assetRefreshRequestId.current === requestId) setAssetRefreshBusy(false);
  }
}
```

If `scope: "native", accountAddress: "all"` feels too awkward, add a `scope: "refresh"` variant to `AssetRefreshFailure` and update tests accordingly.

- implement add/remove watched asset callbacks with registry persistence;
- pass `assetsContent` to `AppShell`.

- [ ] **Step 5: Update browser smoke**

In `tests/browser/pwa-smoke.spec.ts`, update the shell baseline test after nav loop:

```ts
await page.getByRole("button", { name: "资产" }).click();
await expect(page.getByRole("heading", { name: "资产" })).toBeVisible();
await expect(page.getByText(/解锁 vault 后才能刷新本地账户余额/)).toBeVisible();
await expect(page.getByRole("button", { name: /签名|广播|提交|approve|分发|归集/i })).toHaveCount(0);
```

Do not make smoke depend on live public RPC.

- [ ] **Step 6: Verify Task 4**

Run:

```bash
npm test -- src/app/PwaShell.test.tsx
npm run typecheck
npm run smoke:browser
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Controller commit gate for Task 4**

Controller only, after spec and quality review pass:

```bash
git add src/app/PwaShell.tsx src/app/PwaShell.test.tsx src/app/shell/AppShell.tsx src/app/shell/AppWorkspace.tsx src/app/shell/AppPreviewRail.tsx src/app/shell/navigation.ts tests/browser/pwa-smoke.spec.ts docs/superpowers/project-status.md
git diff --cached --check
git commit -m "feat: wire asset snapshots into PWA shell"
git push
```

---

### Task 5: P12 Docs, Status, And Release Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/specs/evm-wallet-workbench.md`
- Modify: `docs/superpowers/project-overview.md`
- Modify: `docs/superpowers/roadmap.md`
- Modify: `docs/superpowers/project-status.md`

- [ ] **Step 1: Update current capability wording**

Update current capability sections to say P12 adds:

- read-only asset module;
- chainId validation before balance refresh;
- selected-account native balances;
- watched ERC-20 balance snapshots;
- local watched token registry;
- explicit stale/failed/partial/chain-mismatch states.

Do not say the app can distribute, collect, sign, broadcast, approve, run ABI writes, inscribe calldata, reverse parse transactions, or write real transaction history.

- [ ] **Step 2: Update project status table**

In `docs/superpowers/project-status.md`, add/update P12 rows:

Use one status row per reviewed task. Each row must record the actual short SHA from the task commit, the review result, the focused verification command list, pushed status, merged status, and a short note. Do not use `current`, `pending`, or a branch name as a substitute for the concrete commit after a task is committed.

- [ ] **Step 3: Run full release gate**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:browser
git diff --check
git status --short --branch --untracked-files=all
```

Expected:

- `npm test`: all tests pass.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- `npm run smoke:browser`: 10 browser smoke tests pass on desktop and mobile unless the test count intentionally changes.
- `git diff --check`: no output.
- status shows only intended docs before the docs commit, then clean after commit.

- [ ] **Step 4: Controller commit gate for Task 5**

Controller only, after final spec and quality review pass:

```bash
git add README.md docs/specs/evm-wallet-workbench.md docs/superpowers/project-overview.md docs/superpowers/roadmap.md docs/superpowers/project-status.md
git diff --cached --check
git commit -m "docs: record P12 asset snapshot status"
git push
```

- [ ] **Step 5: Milestone merge gate**

Controller only:

```bash
git -C /Users/wukong/mylife/Defi-United fetch origin
git -C /Users/wukong/mylife/Defi-United checkout main
git -C /Users/wukong/mylife/Defi-United pull --ff-only origin main
git -C /Users/wukong/mylife/Defi-United merge --no-ff codex/p12-asset-watchlist -m "merge: land P12 asset watchlist"
npm test
npm run typecheck
npm run build
npm run smoke:browser
git diff --check
```

After the post-merge gate passes, update `docs/superpowers/project-status.md` on `main` with the merge commit and push `main`.

---

## Plan Self-Review

- Spec coverage: Tasks cover persistent watched ERC-20 definitions, chainId validation, native/ERC-20 balance refresh, session-only snapshots, stale/partial/failed states, locked/no-selected UI, sanitized errors, desktop/mobile smoke, and truthful docs. Out-of-scope send/queue/distribution/ABI/inscription/reverse parsing is explicitly blocked in UI and tests.
- Completeness scan: The plan has no deferred-work markers or unspecified implementation gaps. Task-status rows require actual commit SHAs after each controller commit.
- Type consistency: Registry types, refresh types, UI props, and PwaShell integration names match across tasks.
