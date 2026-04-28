import type {
  ResolvedMetadataStatus,
  TokenMetadataCacheRecord,
  WatchlistTokenRecord,
} from "../../lib/tauri";

export function tokenIdentityKey(chainId: number, tokenContract: string) {
  return `${chainId}:${tokenContract.toLowerCase()}`;
}

export function metadataBlocksHumanAmount(status: ResolvedMetadataStatus | null | undefined) {
  return status === "missingDecimals" || status === "decimalsChanged" || status === "sourceConflict";
}

function displayValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "unknown" : String(value);
}

function fieldConflict(
  field: "symbol" | "name" | "decimals",
  userValue: string | number | null | undefined,
  chainValue: string | number | null | undefined,
) {
  if (userValue === null || userValue === undefined || chainValue === null || chainValue === undefined) {
    return null;
  }
  if (userValue === chainValue) return null;
  return `${field} userConfirmed ${displayValue(userValue)} vs onChainCall ${displayValue(chainValue)}`;
}

export function metadataConflictDetail(
  token: WatchlistTokenRecord,
  cache: TokenMetadataCacheRecord | null,
  status: ResolvedMetadataStatus | null | undefined,
) {
  if (status === "decimalsChanged") {
    const previous = cache?.previousDecimals ?? null;
    const observed = cache?.observedDecimals ?? cache?.rawDecimals ?? null;
    if (previous !== null || observed !== null) {
      return `Decimals changed: previous ${displayValue(previous)}, observed ${displayValue(observed)} from onChainCall. Review and rescan or set a user-confirmed override.`;
    }
    return "Decimals changed: on-chain decimals differ from the previously scanned value. Review and rescan or set a user-confirmed override.";
  }

  if (status !== "sourceConflict") return null;

  const override = token.metadataOverride ?? null;
  const conflicts = [
    fieldConflict("symbol", override?.symbol, cache?.rawSymbol),
    fieldConflict("name", override?.name, cache?.rawName),
    fieldConflict("decimals", override?.decimals, cache?.rawDecimals),
  ].filter((item): item is string => item !== null);

  if (conflicts.length > 0) {
    return `Source conflict: ${conflicts.join("; ")}. Edit the user-confirmed metadata or rescan on-chain metadata.`;
  }
  return "Source conflict: user-confirmed metadata disagrees with on-chain metadata. Edit the override or rescan on-chain metadata.";
}
