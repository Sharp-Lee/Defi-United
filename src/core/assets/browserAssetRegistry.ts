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
  updatedAt: string;
  watchedErc20Assets: BrowserWatchedErc20Asset[];
}

export interface BrowserWatchedErc20AssetInput {
  chainId: number;
  contractAddress: string;
  symbol: string;
  decimals: number;
  label?: string;
}

type BrowserWatchedErc20AssetUpdates = Partial<
  BrowserWatchedErc20AssetInput & Pick<BrowserWatchedErc20Asset, "enabled">
>;

const INVALID_STATE_ERROR = "Invalid browser asset registry state.";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeChainId(chainId: number) {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(INVALID_STATE_ERROR);
  }
  return chainId;
}

function normalizeContractAddress(contractAddress: string) {
  const trimmed = contractAddress.trim();
  if (!isAddress(trimmed)) {
    throw new Error(INVALID_STATE_ERROR);
  }
  return getAddress(trimmed);
}

function normalizeSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase().slice(0, 24);
  return normalized.length > 0 ? normalized : "TOKEN";
}

function normalizeDecimals(decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(INVALID_STATE_ERROR);
  }
  return decimals;
}

function normalizeLabel(label: string | undefined, symbol: string) {
  const trimmed = label?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : symbol;
}

function identityKey(chainId: number, contractAddress: string) {
  return `${chainId}:${contractAddress.toLowerCase()}`;
}

function assertIsoTimestamp(value: string) {
  if (value.trim() !== value || value.length === 0) {
    throw new Error(INVALID_STATE_ERROR);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(INVALID_STATE_ERROR);
  }
}

function normalizeWatchedAssetInput(input: BrowserWatchedErc20AssetInput) {
  const symbol = normalizeSymbol(input.symbol);
  return {
    chainId: normalizeChainId(input.chainId),
    contractAddress: normalizeContractAddress(input.contractAddress),
    symbol,
    decimals: normalizeDecimals(input.decimals),
    label: normalizeLabel(input.label, symbol),
  };
}

function validateCanonicalWatchedAsset(asset: BrowserWatchedErc20Asset): BrowserWatchedErc20Asset {
  if (
    typeof asset.id !== "string" ||
    asset.id.length === 0 ||
    asset.id.trim() !== asset.id ||
    typeof asset.chainId !== "number" ||
    typeof asset.contractAddress !== "string" ||
    typeof asset.symbol !== "string" ||
    typeof asset.decimals !== "number" ||
    typeof asset.label !== "string" ||
    typeof asset.enabled !== "boolean" ||
    typeof asset.createdAt !== "string" ||
    typeof asset.updatedAt !== "string"
  ) {
    throw new Error(INVALID_STATE_ERROR);
  }

  const chainId = normalizeChainId(asset.chainId);
  const checksumAddress = normalizeContractAddress(asset.contractAddress);
  if (asset.contractAddress !== checksumAddress) {
    throw new Error(INVALID_STATE_ERROR);
  }
  if (
    asset.symbol.length === 0 ||
    asset.symbol.length > 24 ||
    asset.symbol.trim() !== asset.symbol ||
    asset.symbol.toUpperCase() !== asset.symbol
  ) {
    throw new Error(INVALID_STATE_ERROR);
  }
  normalizeDecimals(asset.decimals);
  if (asset.label.length === 0 || asset.label.trim() !== asset.label) {
    throw new Error(INVALID_STATE_ERROR);
  }
  assertIsoTimestamp(asset.createdAt);
  assertIsoTimestamp(asset.updatedAt);

  return {
    id: asset.id,
    chainId,
    contractAddress: asset.contractAddress,
    symbol: asset.symbol,
    decimals: asset.decimals,
    label: asset.label,
    enabled: asset.enabled,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

export function createDefaultBrowserAssetRegistryState(): BrowserAssetRegistryState {
  return {
    schemaVersion: BROWSER_ASSET_REGISTRY_SCHEMA_VERSION,
    updatedAt: nowIso(),
    watchedErc20Assets: [],
  };
}

export function addWatchedErc20Asset(
  state: BrowserAssetRegistryState,
  input: BrowserWatchedErc20AssetInput,
): BrowserAssetRegistryState {
  const timestamp = nowIso();
  const normalized = normalizeWatchedAssetInput(input);
  const existingAsset = state.watchedErc20Assets.find(
    (asset) =>
      asset.chainId === normalized.chainId &&
      asset.contractAddress.toLowerCase() === normalized.contractAddress.toLowerCase(),
  );

  if (existingAsset) {
    return {
      ...state,
      watchedErc20Assets: state.watchedErc20Assets.map((asset) =>
        asset.id === existingAsset.id
          ? {
              ...asset,
              ...normalized,
              enabled: true,
              updatedAt: timestamp,
            }
          : asset,
      ),
      updatedAt: timestamp,
    };
  }

  return {
    ...state,
    watchedErc20Assets: [
      ...state.watchedErc20Assets,
      {
        id: createId("asset"),
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
  updates: BrowserWatchedErc20AssetUpdates,
): BrowserAssetRegistryState {
  if (!state.watchedErc20Assets.some((asset) => asset.id === assetId)) {
    return state;
  }
  const timestamp = nowIso();
  const currentAsset = state.watchedErc20Assets.find((asset) => asset.id === assetId);
  if (!currentAsset) return state;
  const nextChainId = updates.chainId === undefined ? currentAsset.chainId : normalizeChainId(updates.chainId);
  const nextContractAddress =
    updates.contractAddress === undefined
      ? currentAsset.contractAddress
      : normalizeContractAddress(updates.contractAddress);
  const nextIdentity = identityKey(nextChainId, nextContractAddress);
  if (
    state.watchedErc20Assets.some(
      (asset) => asset.id !== assetId && identityKey(asset.chainId, asset.contractAddress) === nextIdentity,
    )
  ) {
    throw new Error(INVALID_STATE_ERROR);
  }

  return {
    ...state,
    watchedErc20Assets: state.watchedErc20Assets.map((asset) => {
      if (asset.id !== assetId) return asset;
      const symbol = updates.symbol === undefined ? asset.symbol : normalizeSymbol(updates.symbol);
      return {
        ...asset,
        chainId: nextChainId,
        contractAddress: nextContractAddress,
        symbol,
        decimals: updates.decimals === undefined ? asset.decimals : normalizeDecimals(updates.decimals),
        label: updates.label === undefined ? asset.label : normalizeLabel(updates.label, symbol),
        enabled: updates.enabled ?? asset.enabled,
        updatedAt: timestamp,
      };
    }),
    updatedAt: timestamp,
  };
}

export function removeWatchedErc20Asset(state: BrowserAssetRegistryState, assetId: string): BrowserAssetRegistryState {
  if (!state.watchedErc20Assets.some((asset) => asset.id === assetId)) {
    return state;
  }
  return {
    ...state,
    watchedErc20Assets: state.watchedErc20Assets.filter((asset) => asset.id !== assetId),
    updatedAt: nowIso(),
  };
}

export function getEnabledWatchedErc20AssetsForChain(state: BrowserAssetRegistryState, chainId: number) {
  return state.watchedErc20Assets.filter((asset) => asset.chainId === chainId && asset.enabled);
}

export function validateBrowserAssetRegistryState(value: unknown): BrowserAssetRegistryState {
  if (!value || typeof value !== "object") {
    throw new Error(INVALID_STATE_ERROR);
  }
  const state = value as BrowserAssetRegistryState;
  if (
    state.schemaVersion !== BROWSER_ASSET_REGISTRY_SCHEMA_VERSION ||
    typeof state.updatedAt !== "string" ||
    !Array.isArray(state.watchedErc20Assets)
  ) {
    throw new Error(INVALID_STATE_ERROR);
  }
  assertIsoTimestamp(state.updatedAt);

  const watchedErc20Assets = state.watchedErc20Assets.map(validateCanonicalWatchedAsset);
  const identities = new Set<string>();
  const ids = new Set<string>();
  for (const asset of watchedErc20Assets) {
    if (ids.has(asset.id)) {
      throw new Error(INVALID_STATE_ERROR);
    }
    ids.add(asset.id);

    const key = identityKey(asset.chainId, asset.contractAddress);
    if (identities.has(key)) {
      throw new Error(INVALID_STATE_ERROR);
    }
    identities.add(key);
  }

  return {
    schemaVersion: BROWSER_ASSET_REGISTRY_SCHEMA_VERSION,
    updatedAt: state.updatedAt,
    watchedErc20Assets,
  };
}
