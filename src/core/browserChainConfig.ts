export const BROWSER_CHAIN_CONFIG_SCHEMA_VERSION = 1;

export type FeeMode = "eip1559" | "legacy";

export interface BrowserRpcEndpoint {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
  primary: boolean;
}

export interface BrowserFeeDraft {
  mode: FeeMode;
  gasLimit: string;
  gasPriceGwei: string;
  maxFeePerGasGwei: string;
  maxPriorityFeePerGasGwei: string;
  baseFeeMultiplier: string;
}

export interface BrowserChainRecord {
  id: string;
  chainId: number;
  name: string;
  nativeCurrencySymbol: string;
  explorerUrl: string;
  enabled: boolean;
  rpcEndpoints: BrowserRpcEndpoint[];
  feeDraft: BrowserFeeDraft;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserChainConfigState {
  schemaVersion: typeof BROWSER_CHAIN_CONFIG_SCHEMA_VERSION;
  activeChainId: string;
  chains: BrowserChainRecord[];
  updatedAt: string;
}

export interface BrowserChainRecordInput {
  name: string;
  chainId: number;
  nativeCurrencySymbol: string;
  rpcUrl: string;
  rpcLabel?: string;
  explorerUrl?: string;
}

export const DEFAULT_FEE_DRAFT: BrowserFeeDraft = {
  mode: "eip1559",
  gasLimit: "21000",
  gasPriceGwei: "",
  maxFeePerGasGwei: "30",
  maxPriorityFeePerGasGwei: "1.5",
  baseFeeMultiplier: "2",
};

const DEFAULT_CHAIN_ID = "chain-ethereum-mainnet";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureTrimmed(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeUrl(value: string) {
  return value.trim();
}

function isValidRpcUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function sanitizeDecimalInput(value: string, fallback: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : fallback;
}

function createRpcEndpoint(url: string, label = "Primary RPC", primary = true): BrowserRpcEndpoint {
  return {
    id: createId("rpc"),
    label: ensureTrimmed(label, "Primary RPC"),
    url: normalizeUrl(url),
    enabled: true,
    primary,
  };
}

export function createDefaultBrowserChainConfigState(): BrowserChainConfigState {
  const timestamp = nowIso();
  return {
    schemaVersion: BROWSER_CHAIN_CONFIG_SCHEMA_VERSION,
    activeChainId: DEFAULT_CHAIN_ID,
    updatedAt: timestamp,
    chains: [
      {
        id: DEFAULT_CHAIN_ID,
        chainId: 1,
        name: "Ethereum Mainnet",
        nativeCurrencySymbol: "ETH",
        explorerUrl: "https://etherscan.io",
        enabled: true,
        rpcEndpoints: [createRpcEndpoint("https://ethereum.publicnode.com", "Public RPC")],
        feeDraft: { ...DEFAULT_FEE_DRAFT },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

export function getActiveBrowserChain(state: BrowserChainConfigState) {
  return state.chains.find((chain) => chain.id === state.activeChainId) ?? state.chains[0] ?? null;
}

export function getPrimaryRpcEndpoint(chain: BrowserChainRecord | null) {
  if (!chain) return null;
  return chain.rpcEndpoints.find((endpoint) => endpoint.primary && endpoint.enabled) ?? chain.rpcEndpoints.find((endpoint) => endpoint.enabled) ?? chain.rpcEndpoints[0] ?? null;
}

export function addBrowserChainRecord(
  state: BrowserChainConfigState,
  input: BrowserChainRecordInput,
): BrowserChainConfigState {
  const timestamp = nowIso();
  const chain: BrowserChainRecord = {
    id: createId("chain"),
    chainId: Math.max(1, Math.floor(input.chainId)),
    name: ensureTrimmed(input.name, `Chain ${input.chainId}`),
    nativeCurrencySymbol: ensureTrimmed(input.nativeCurrencySymbol, "ETH").toUpperCase(),
    explorerUrl: input.explorerUrl?.trim() ?? "",
    enabled: true,
    rpcEndpoints: [createRpcEndpoint(input.rpcUrl, input.rpcLabel)],
    feeDraft: { ...DEFAULT_FEE_DRAFT },
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    ...state,
    activeChainId: chain.id,
    chains: [...state.chains, chain],
    updatedAt: timestamp,
  };
}

export function selectBrowserChain(state: BrowserChainConfigState, chainId: string): BrowserChainConfigState {
  if (!state.chains.some((chain) => chain.id === chainId)) return state;
  return {
    ...state,
    activeChainId: chainId,
    updatedAt: nowIso(),
  };
}

export function updateBrowserChainRecord(
  state: BrowserChainConfigState,
  chainId: string,
  updates: Partial<Pick<BrowserChainRecord, "name" | "nativeCurrencySymbol" | "explorerUrl" | "enabled">>,
): BrowserChainConfigState {
  const timestamp = nowIso();
  return {
    ...state,
    chains: state.chains.map((chain) =>
      chain.id === chainId
        ? {
            ...chain,
            name: updates.name === undefined ? chain.name : ensureTrimmed(updates.name, chain.name),
            nativeCurrencySymbol:
              updates.nativeCurrencySymbol === undefined
                ? chain.nativeCurrencySymbol
                : ensureTrimmed(updates.nativeCurrencySymbol, chain.nativeCurrencySymbol).toUpperCase(),
            explorerUrl: updates.explorerUrl === undefined ? chain.explorerUrl : updates.explorerUrl.trim(),
            enabled: updates.enabled ?? chain.enabled,
            updatedAt: timestamp,
          }
        : chain,
    ),
    updatedAt: timestamp,
  };
}

export function updatePrimaryRpcEndpoint(
  state: BrowserChainConfigState,
  chainId: string,
  updates: Partial<Pick<BrowserRpcEndpoint, "label" | "url" | "enabled">>,
): BrowserChainConfigState {
  const timestamp = nowIso();
  return {
    ...state,
    chains: state.chains.map((chain) => {
      if (chain.id !== chainId) return chain;
      const primaryEndpoint = getPrimaryRpcEndpoint(chain);
      if (!primaryEndpoint) return chain;
      return {
        ...chain,
        rpcEndpoints: chain.rpcEndpoints.map((endpoint) =>
          endpoint.id === primaryEndpoint.id
            ? {
                ...endpoint,
                label: updates.label === undefined ? endpoint.label : ensureTrimmed(updates.label, endpoint.label),
                url: updates.url === undefined ? endpoint.url : normalizeUrl(updates.url),
                enabled: updates.enabled ?? endpoint.enabled,
              }
            : endpoint,
        ),
        updatedAt: timestamp,
      };
    }),
    updatedAt: timestamp,
  };
}

export function updateBrowserFeeDraft(
  state: BrowserChainConfigState,
  chainId: string,
  updates: Partial<BrowserFeeDraft>,
): BrowserChainConfigState {
  const timestamp = nowIso();
  return {
    ...state,
    chains: state.chains.map((chain) =>
      chain.id === chainId
        ? {
            ...chain,
            feeDraft: {
              ...chain.feeDraft,
              mode: updates.mode ?? chain.feeDraft.mode,
              gasLimit: sanitizeDecimalInput(updates.gasLimit ?? chain.feeDraft.gasLimit, chain.feeDraft.gasLimit),
              gasPriceGwei: sanitizeDecimalInput(updates.gasPriceGwei ?? chain.feeDraft.gasPriceGwei, chain.feeDraft.gasPriceGwei),
              maxFeePerGasGwei: sanitizeDecimalInput(
                updates.maxFeePerGasGwei ?? chain.feeDraft.maxFeePerGasGwei,
                chain.feeDraft.maxFeePerGasGwei,
              ),
              maxPriorityFeePerGasGwei: sanitizeDecimalInput(
                updates.maxPriorityFeePerGasGwei ?? chain.feeDraft.maxPriorityFeePerGasGwei,
                chain.feeDraft.maxPriorityFeePerGasGwei,
              ),
              baseFeeMultiplier: sanitizeDecimalInput(
                updates.baseFeeMultiplier ?? chain.feeDraft.baseFeeMultiplier,
                chain.feeDraft.baseFeeMultiplier,
              ),
            },
            updatedAt: timestamp,
          }
        : chain,
    ),
    updatedAt: timestamp,
  };
}

export function validateBrowserChainConfigState(value: unknown): BrowserChainConfigState {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid browser chain config state.");
  }
  const state = value as BrowserChainConfigState;
  if (state.schemaVersion !== BROWSER_CHAIN_CONFIG_SCHEMA_VERSION || !Array.isArray(state.chains)) {
    throw new Error("Invalid browser chain config state.");
  }
  if (typeof state.activeChainId !== "string" || typeof state.updatedAt !== "string") {
    throw new Error("Invalid browser chain config state.");
  }

  for (const chain of state.chains) {
    if (
      typeof chain.id !== "string" ||
      typeof chain.chainId !== "number" ||
      !Number.isInteger(chain.chainId) ||
      chain.chainId <= 0 ||
      typeof chain.name !== "string" ||
      typeof chain.nativeCurrencySymbol !== "string" ||
      typeof chain.explorerUrl !== "string" ||
      typeof chain.enabled !== "boolean" ||
      !Array.isArray(chain.rpcEndpoints) ||
      !chain.feeDraft
    ) {
      throw new Error("Invalid browser chain config state.");
    }
    for (const endpoint of chain.rpcEndpoints) {
      if (
        typeof endpoint.id !== "string" ||
        typeof endpoint.label !== "string" ||
        typeof endpoint.url !== "string" ||
        !isValidRpcUrl(endpoint.url) ||
        typeof endpoint.enabled !== "boolean" ||
        typeof endpoint.primary !== "boolean"
      ) {
        throw new Error("Invalid browser chain config state.");
      }
    }
    if (
      (chain.feeDraft.mode !== "eip1559" && chain.feeDraft.mode !== "legacy") ||
      typeof chain.feeDraft.gasLimit !== "string" ||
      typeof chain.feeDraft.gasPriceGwei !== "string" ||
      typeof chain.feeDraft.maxFeePerGasGwei !== "string" ||
      typeof chain.feeDraft.maxPriorityFeePerGasGwei !== "string" ||
      typeof chain.feeDraft.baseFeeMultiplier !== "string"
    ) {
      throw new Error("Invalid browser chain config state.");
    }
  }

  if (state.chains.length > 0 && !state.chains.some((chain) => chain.id === state.activeChainId)) {
    throw new Error("Invalid browser chain config state.");
  }

  return state;
}
