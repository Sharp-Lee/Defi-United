import type {
  AllowanceSnapshotRecord,
  AllowanceSnapshotStatus,
  ApprovalSourceKind,
  ApprovalWatchKind,
  ApprovalWatchlistRecord,
  AssetScanJobRecord,
  AssetScanJobStatus,
  AssetSnapshotRecord,
  AssetSnapshotStatus,
  NftApprovalSnapshotRecord,
  NftApprovalSnapshotStatus,
  TokenWatchlistState,
} from "../../lib/tauri";

export type ApprovalReadModelKind =
  | "watchlist"
  | "asset"
  | "allowance"
  | "nftApproval"
  | "scanJob";

export type ApprovalReadModelStatus =
  | AssetSnapshotStatus
  | AllowanceSnapshotStatus
  | NftApprovalSnapshotStatus
  | AssetScanJobStatus
  | "configured";

export interface ApprovalIdentityInput {
  chainId: number;
  owner: string;
  contract?: string | null;
  spender?: string | null;
  operator?: string | null;
  tokenId?: string | null;
  kind?: ApprovalWatchKind | string | null;
}

export interface ApprovalReadModelEntry {
  kind: ApprovalReadModelKind;
  identityKey: string;
  chainId: number;
  owner: string;
  contract: string | null;
  spender: string | null;
  operator: string | null;
  tokenId: string | null;
  sourceKind: ApprovalSourceKind | null;
  status: ApprovalReadModelStatus;
  stale: boolean;
  failure: boolean;
  record:
    | ApprovalWatchlistRecord
    | AssetSnapshotRecord
    | AllowanceSnapshotRecord
    | NftApprovalSnapshotRecord
    | AssetScanJobRecord;
}

export interface ApprovalSelectorFilters {
  account?: string | null;
  owner?: string | null;
  chainId?: number | null;
  contract?: string | null;
  spender?: string | null;
  operator?: string | null;
  tokenId?: string | null;
  status?: ApprovalReadModelStatus | ApprovalReadModelStatus[] | null;
  sourceKind?: ApprovalSourceKind | ApprovalSourceKind[] | null;
  stale?: boolean | null;
  failure?: boolean | null;
  kind?: ApprovalReadModelKind | ApprovalReadModelKind[] | null;
}

const FAILURE_STATUSES = new Set<ApprovalReadModelStatus>([
  "unknown",
  "readFailed",
  "sourceUnavailable",
  "rateLimited",
  "chainMismatch",
  "failed",
  "partial",
]);

function normalizeAddress(value: string | null | undefined) {
  return value ? value.toLowerCase() : null;
}

function normalizeTokenId(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/^0+/, "");
  return normalized || "0";
}

function normalizeOneOrMany<T extends string>(value: T | T[] | null | undefined) {
  if (value == null) return null;
  return new Set(Array.isArray(value) ? value : [value]);
}

export function createApprovalIdentityKey({
  chainId,
  owner,
  contract,
  spender,
  operator,
  tokenId,
  kind,
}: ApprovalIdentityInput) {
  return [
    `chainId=${chainId}`,
    `owner=${normalizeAddress(owner) ?? ""}`,
    `contract=${normalizeAddress(contract) ?? ""}`,
    `kind=${kind ?? ""}`,
    `spender=${normalizeAddress(spender) ?? ""}`,
    `operator=${normalizeAddress(operator) ?? ""}`,
    `tokenId=${normalizeTokenId(tokenId) ?? ""}`,
  ].join("|");
}

function staleFrom(status: ApprovalReadModelStatus, staleAfter?: string | null) {
  if (status === "stale") return true;
  if (!staleAfter) return false;
  const staleAtMs = Number(staleAfter) * 1000;
  return Number.isFinite(staleAtMs) && staleAtMs <= Date.now();
}

function entryMatches(entry: ApprovalReadModelEntry, filters: ApprovalSelectorFilters) {
  const owner = normalizeAddress(filters.owner ?? filters.account);
  const statusSet = normalizeOneOrMany(filters.status);
  const sourceSet = normalizeOneOrMany(filters.sourceKind);
  const kindSet = normalizeOneOrMany(filters.kind);
  if (owner && entry.owner !== owner) return false;
  if (filters.chainId != null && entry.chainId !== filters.chainId) return false;
  if (filters.contract && entry.contract !== normalizeAddress(filters.contract)) return false;
  if (filters.spender && entry.spender !== normalizeAddress(filters.spender)) return false;
  if (filters.operator && entry.operator !== normalizeAddress(filters.operator)) return false;
  if (filters.tokenId && entry.tokenId !== normalizeTokenId(filters.tokenId)) return false;
  if (statusSet && !statusSet.has(entry.status)) return false;
  if (sourceSet && (!entry.sourceKind || !sourceSet.has(entry.sourceKind))) return false;
  if (kindSet && !kindSet.has(entry.kind)) return false;
  if (filters.stale != null && entry.stale !== filters.stale) return false;
  if (filters.failure != null && entry.failure !== filters.failure) return false;
  return true;
}

function readModelEntry(
  kind: ApprovalReadModelKind,
  record:
    | ApprovalWatchlistRecord
    | AssetSnapshotRecord
    | AllowanceSnapshotRecord
    | NftApprovalSnapshotRecord
    | AssetScanJobRecord,
  identity: ApprovalIdentityInput,
  status: ApprovalReadModelStatus,
  sourceKind: ApprovalSourceKind | null,
  staleAfter?: string | null,
): ApprovalReadModelEntry {
  return {
    kind,
    identityKey: createApprovalIdentityKey(identity),
    chainId: identity.chainId,
    owner: normalizeAddress(identity.owner) ?? "",
    contract: normalizeAddress(identity.contract),
    spender: normalizeAddress(identity.spender),
    operator: normalizeAddress(identity.operator),
    tokenId: normalizeTokenId(identity.tokenId),
    sourceKind,
    status,
    stale: staleFrom(status, staleAfter),
    failure: FAILURE_STATUSES.has(status),
    record,
  };
}

export function listApprovalReadModelEntries(
  state: Pick<
    TokenWatchlistState,
    | "approvalWatchlist"
    | "assetSnapshots"
    | "allowanceSnapshots"
    | "nftApprovalSnapshots"
  | "assetScanJobs"
  >,
  filters: ApprovalSelectorFilters = {},
) {
  const entries: ApprovalReadModelEntry[] = [
    ...(state.approvalWatchlist ?? []).map((record) =>
      readModelEntry(
        "watchlist",
        record,
        {
          chainId: record.chainId,
          owner: record.owner,
          contract: record.tokenContract,
          kind: record.kind,
          spender: record.spender,
          operator: record.operator,
          tokenId: record.tokenId,
        },
        "configured",
        record.source.kind,
      ),
    ),
    ...(state.assetSnapshots ?? []).map((record) =>
      readModelEntry(
        "asset",
        record,
        {
          chainId: record.chainId,
          owner: record.owner,
          contract: record.tokenContract,
          kind: record.assetKind,
          tokenId: record.tokenId,
        },
        record.status,
        record.source.kind,
        record.staleAfter,
      ),
    ),
    ...(state.allowanceSnapshots ?? []).map((record) =>
      readModelEntry(
        "allowance",
        record,
        {
          chainId: record.chainId,
          owner: record.owner,
          contract: record.tokenContract,
          kind: "erc20Allowance",
          spender: record.spender,
        },
        record.status,
        record.source.kind,
        record.staleAfter,
      ),
    ),
    ...(state.nftApprovalSnapshots ?? []).map((record) =>
      readModelEntry(
        "nftApproval",
        record,
        {
          chainId: record.chainId,
          owner: record.owner,
          contract: record.tokenContract,
          kind: record.kind,
          operator: record.operator,
          tokenId: record.tokenId,
        },
        record.status,
        record.source.kind,
        record.staleAfter,
      ),
    ),
    ...(state.assetScanJobs ?? []).map((record) =>
      readModelEntry(
        "scanJob",
        record,
        {
          chainId: record.chainId,
          owner: record.owner,
          contract: record.contractFilter,
          kind: "scanJob",
        },
        record.status,
        record.source.kind,
      ),
    ),
  ];

  return entries.filter((entry) => entryMatches(entry, filters));
}

export function findApprovalReadModelEntry(
  state: Parameters<typeof listApprovalReadModelEntries>[0],
  identityKey: string,
) {
  return listApprovalReadModelEntries(state).find((entry) => entry.identityKey === identityKey);
}
