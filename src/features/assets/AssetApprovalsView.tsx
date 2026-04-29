import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "ethers";
import {
  createApprovalIdentityKey,
  listApprovalReadModelEntries,
} from "../../core/assets/approvals";
import type { ApprovalReadModelEntry, ApprovalReadModelStatus } from "../../core/assets/approvals";
import {
  buildRevokeDraft,
  getRevokeDraftEligibility,
  sanitizeRevokeDraftDisplayText,
  type RevokeDraft,
  type RevokeDraftRpcIdentityInput,
  type RevokeDraftSnapshot,
  type RevokeDraftWarningCode,
} from "../../core/assets/revokeDraft";
import type {
  AccountRecord,
  AllowanceSnapshotRecord,
  AllowanceSnapshotStatus,
  ApprovalSourceKind,
  ApprovalWatchKind,
  ApprovalWatchlistRecord,
  AssetScanJobStatus,
  AssetSnapshotStatus,
  BalanceStatus,
  Erc20BalanceSnapshotRecord,
  NftApprovalSnapshotRecord,
  NftApprovalSnapshotStatus,
  ResolvedTokenMetadataRecord,
  TokenWatchlistState,
  UpsertApprovalWatchlistEntryInput,
} from "../../lib/tauri";
import type { AccountChainState } from "../../lib/rpc";

type AccountModel = AccountRecord & AccountChainState;
type StaleFailureFilter = "all" | "stale" | "failure" | "clean";
type KindFilter =
  | ""
  | "watchlist"
  | "erc20Balance"
  | "asset"
  | "asset:erc20"
  | "asset:erc721"
  | "asset:erc1155"
  | "allowance"
  | "nftApproval"
  | "approval:erc20Allowance"
  | "approval:erc721ApprovalForAll"
  | "approval:erc721TokenApproval"
  | "scanJob";

export interface AssetApprovalsViewProps {
  accounts: AccountModel[];
  busy?: boolean;
  error?: string | null;
  rpcReady?: boolean;
  selectedRpc?: RevokeDraftRpcIdentityInput | null;
  selectedChainId: bigint;
  state: TokenWatchlistState | null;
  onAddApprovalCandidate: (
    input: UpsertApprovalWatchlistEntryInput,
  ) => Promise<boolean | void> | boolean | void;
  onScanErc20Allowance: (
    owner: string,
    chainId: number,
    tokenContract: string,
    spender: string,
  ) => Promise<boolean | void> | boolean | void;
  onScanNftOperatorApproval: (
    owner: string,
    chainId: number,
    tokenContract: string,
    operator: string,
  ) => Promise<boolean | void> | boolean | void;
  onScanErc721TokenApproval: (
    owner: string,
    chainId: number,
    tokenContract: string,
    tokenId: string,
    operator?: string | null,
  ) => Promise<boolean | void> | boolean | void;
}

const approvalKinds: ApprovalWatchKind[] = [
  "erc20Allowance",
  "erc721ApprovalForAll",
  "erc721TokenApproval",
];

const INVALID_GWEI_SENTINEL = -1n;

const sourceKinds: ApprovalSourceKind[] = [
  "rpcPointRead",
  "userWatchlist",
  "historyDerivedCandidate",
  "explorerCandidate",
  "indexerCandidate",
  "manualImport",
  "unavailable",
];

const sourceFilterOptions = [...sourceKinds, "onChainCall", "userConfirmed", "unknownMetadata"];

const kindFilterOptions: Array<{ value: KindFilter; label: string }> = [
  { value: "", label: "Any" },
  { value: "watchlist", label: "Configured candidates" },
  { value: "erc20Balance", label: "ERC-20 balances" },
  { value: "asset", label: "Asset snapshots" },
  { value: "asset:erc20", label: "Asset: ERC-20" },
  { value: "asset:erc721", label: "Asset: ERC-721" },
  { value: "asset:erc1155", label: "Asset: ERC-1155" },
  { value: "allowance", label: "ERC-20 allowances" },
  { value: "nftApproval", label: "NFT approvals" },
  { value: "approval:erc20Allowance", label: "Approval: ERC-20 allowance" },
  { value: "approval:erc721ApprovalForAll", label: "Approval: ERC-721 approval-for-all" },
  { value: "approval:erc721TokenApproval", label: "Approval: ERC-721 token-specific" },
  { value: "scanJob", label: "Scan jobs" },
];

const statusOptions = [
  "configured",
  "active",
  "zero",
  "revoked",
  "unknown",
  "stale",
  "readFailed",
  "sourceUnavailable",
  "rateLimited",
  "chainMismatch",
  "idle",
  "scanning",
  "ok",
  "partial",
  "failed",
  "balanceCallFailed",
  "malformedBalance",
  "rpcFailed",
] as const;

const allowanceStatusLabels: Record<AllowanceSnapshotStatus, string> = {
  active: "Active",
  zero: "Zero",
  unknown: "Unknown",
  stale: "Stale",
  readFailed: "Read failed",
  sourceUnavailable: "Source unavailable",
  rateLimited: "Rate limited",
  chainMismatch: "Chain mismatch",
};

const nftApprovalStatusLabels: Record<NftApprovalSnapshotStatus, string> = {
  active: "Active",
  revoked: "Revoked",
  unknown: "Unknown",
  stale: "Stale",
  readFailed: "Read failed",
  sourceUnavailable: "Source unavailable",
  rateLimited: "Rate limited",
  chainMismatch: "Chain mismatch",
};

const assetStatusLabels: Record<AssetSnapshotStatus, string> = {
  active: "Active",
  zero: "Zero",
  unknown: "Unknown",
  stale: "Stale",
  readFailed: "Read failed",
  sourceUnavailable: "Source unavailable",
  rateLimited: "Rate limited",
  chainMismatch: "Chain mismatch",
};

const jobStatusLabels: Record<AssetScanJobStatus, string> = {
  idle: "Idle",
  scanning: "Scanning",
  ok: "OK",
  partial: "Partial",
  failed: "Failed",
  chainMismatch: "Chain mismatch",
  sourceUnavailable: "Source unavailable",
};

const balanceStatusLabels: Record<BalanceStatus, string> = {
  ok: "OK",
  zero: "Zero",
  balanceCallFailed: "Balance call failed",
  malformedBalance: "Malformed balance",
  rpcFailed: "RPC failed",
  chainMismatch: "Chain mismatch",
  stale: "Stale",
};

function compactAddress(address: string) {
  return address.length > 14 ? `${address.slice(0, 10)}...${address.slice(-6)}` : address;
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Never";
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric * 1000).toLocaleString();
  }
  return value;
}

function statusClass(status: string | null | undefined, stale = false, failure = false) {
  if (failure) return "history-status history-status-failed";
  if (stale || status === "stale" || status === "scanning" || status === "partial") {
    return "history-status history-status-pending";
  }
  if (status === "active" || status === "ok" || status === "zero" || status === "revoked") {
    return "history-status history-status-confirmed";
  }
  if (!status || status === "configured" || status === "idle") return "history-status";
  return "history-status history-status-failed";
}

function sourceLabel(
  source?: {
    kind: string;
    label?: string | null;
    sourceId?: string | null;
    summary?: string | null;
    providerHint?: string | null;
    observedAt?: string | null;
  } | null,
) {
  if (!source) return "unknown source";
  return [
    source.kind,
    source.kind === "indexerCandidate" || source.kind === "explorerCandidate"
      ? "Candidate only; not RPC-confirmed"
      : null,
    sanitizeRevokeDraftDisplayText(source.label),
    sanitizeRevokeDraftDisplayText(source.sourceId),
    sanitizeRevokeDraftDisplayText(source.summary),
    sanitizeRevokeDraftDisplayText(source.providerHint),
    sanitizeRevokeDraftDisplayText(source.observedAt),
  ].filter(Boolean).join(" · ");
}

function visibleStatus(label: string, stale = false) {
  return stale ? "Stale / rescan required" : label;
}

function tokenIdentityKey(chainId: number, tokenContract: string) {
  return `${chainId}:${tokenContract.toLowerCase()}`;
}

function metadataFor(
  metadataByToken: Map<string, ResolvedTokenMetadataRecord>,
  chainId: number,
  tokenContract: string,
  snapshotMetadata?: Erc20BalanceSnapshotRecord["resolvedMetadata"],
) {
  return metadataByToken.get(tokenIdentityKey(chainId, tokenContract)) ?? snapshotMetadata ?? null;
}

function tokenDisplay(metadata: ReturnType<typeof metadataFor>, fallbackLabel?: string | null) {
  return fallbackLabel ?? metadata?.symbol ?? metadata?.name ?? "Unknown asset";
}

function humanBalance(snapshot: Erc20BalanceSnapshotRecord, metadata: ReturnType<typeof metadataFor>) {
  if (metadata?.decimals === null || metadata?.decimals === undefined) return "Unavailable";
  try {
    return formatUnits(BigInt(snapshot.balanceRaw), metadata.decimals);
  } catch {
    return "Unavailable";
  }
}

function balanceFailure(status: BalanceStatus) {
  return !["ok", "zero", "stale"].includes(status);
}

function staleFailureFilter(staleFailure: StaleFailureFilter) {
  if (staleFailure === "stale") return { stale: true };
  if (staleFailure === "failure") return { failure: true };
  if (staleFailure === "clean") return { stale: false, failure: false };
  return {};
}

function readModelKindForFilter(kind: KindFilter) {
  if (kind === "watchlist" || kind === "asset" || kind === "allowance" || kind === "nftApproval" || kind === "scanJob") {
    return kind;
  }
  if (kind.startsWith("asset:")) return "asset";
  if (kind === "approval:erc20Allowance") return "allowance";
  if (kind === "approval:erc721ApprovalForAll" || kind === "approval:erc721TokenApproval") {
    return "nftApproval";
  }
  return null;
}

function entryMatchesKindFilter(entry: ApprovalReadModelEntry, kind: KindFilter) {
  if (!kind) return true;
  if (kind === "erc20Balance") return false;
  if (kind === "watchlist" || kind === "asset" || kind === "allowance" || kind === "nftApproval" || kind === "scanJob") {
    return entry.kind === kind;
  }
  if (kind.startsWith("asset:") && entry.kind === "asset") {
    return "assetKind" in entry.record && entry.record.assetKind === kind.slice("asset:".length);
  }
  if (kind === "approval:erc20Allowance" && entry.kind === "allowance") return true;
  if (
    (kind === "approval:erc721ApprovalForAll" || kind === "approval:erc721TokenApproval") &&
    entry.kind === "nftApproval"
  ) {
    return "kind" in entry.record && entry.record.kind === kind.slice("approval:".length);
  }
  return false;
}

function entryFilters(
  owner: string,
  chainId: string,
  contract: string,
  status: string,
  source: string,
  staleFailure: StaleFailureFilter,
  kind: KindFilter,
) {
  return {
    owner: owner.trim() || null,
    chainId: chainId.trim() ? Number(chainId) : null,
    contract: contract.trim() || null,
    status: status.trim() ? (status as ApprovalReadModelStatus) : null,
    sourceKind: sourceKinds.includes(source.trim() as ApprovalSourceKind)
      ? (source.trim() as ApprovalSourceKind)
      : null,
    kind: readModelKindForFilter(kind),
    ...staleFailureFilter(staleFailure),
  };
}

function uniqueEntries(entries: ApprovalReadModelEntry[]) {
  return Array.from(new Map(entries.map((entry) => [entry.kind + ":" + entry.identityKey, entry])).values());
}

function matchingEntries(
  state: TokenWatchlistState | null,
  owner: string,
  chainId: string,
  contract: string,
  counterparty: string,
  status: string,
  source: string,
  staleFailure: StaleFailureFilter,
  kind: KindFilter,
) {
  const base = entryFilters(owner, chainId, contract, status, source, staleFailure, kind);
  if (!state) return [];
  if (source.trim() && !sourceKinds.includes(source.trim() as ApprovalSourceKind)) return [];
  const matchedEntries = !counterparty.trim() ? listApprovalReadModelEntries(state, base) : uniqueEntries([
    ...listApprovalReadModelEntries(state, { ...base, spender: counterparty }),
    ...listApprovalReadModelEntries(state, { ...base, operator: counterparty }),
  ]);
  return matchedEntries.filter((entry) => entryMatchesKindFilter(entry, kind));
}

function allowanceKey(record: Pick<AllowanceSnapshotRecord, "chainId" | "owner" | "tokenContract" | "spender">) {
  return createApprovalIdentityKey({
    chainId: record.chainId,
    owner: record.owner,
    contract: record.tokenContract,
    kind: "erc20Allowance",
    spender: record.spender,
  });
}

function nftApprovalKey(
  record: Pick<
    NftApprovalSnapshotRecord,
    "chainId" | "owner" | "tokenContract" | "kind" | "operator" | "tokenId"
  >,
) {
  return createApprovalIdentityKey({
    chainId: record.chainId,
    owner: record.owner,
    contract: record.tokenContract,
    kind: record.kind,
    operator: record.operator,
    tokenId: record.tokenId,
  });
}

function nftTokenApprovalPointKey({
  chainId,
  owner,
  tokenContract,
  tokenId,
}: Pick<NftApprovalSnapshotRecord, "chainId" | "owner" | "tokenContract" | "tokenId">) {
  return createApprovalIdentityKey({
    chainId,
    owner,
    contract: tokenContract,
    kind: "erc721TokenApproval",
    tokenId,
  });
}

function timestampScore(value?: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NEGATIVE_INFINITY;
}

function nftSnapshotStale(snapshot: NftApprovalSnapshotRecord) {
  if (snapshot.status === "stale") return true;
  if (!snapshot.staleAfter) return false;
  const staleAt = Number(snapshot.staleAfter);
  return Number.isFinite(staleAt) && staleAt * 1000 <= Date.now();
}

function nftStatusPriority(status: NftApprovalSnapshotStatus) {
  if (status === "active") return 4;
  if (status === "revoked") return 3;
  if (status === "unknown") return 2;
  if (status === "stale") return 1;
  return 0;
}

function tokenApprovalSnapshotRank(snapshot: NftApprovalSnapshotRecord) {
  const activeAndFresh = snapshot.status === "active" && !nftSnapshotStale(snapshot) ? 1 : 0;
  const lastRead = Math.max(
    timestampScore(snapshot.lastScannedAt),
    timestampScore(snapshot.updatedAt),
  );
  return {
    activeAndFresh,
    lastRead,
    statusPriority: nftStatusPriority(snapshot.status),
  };
}

function betterTokenApprovalSnapshot(
  current: NftApprovalSnapshotRecord | null,
  candidate: NftApprovalSnapshotRecord,
) {
  if (!current) return candidate;
  const currentRank = tokenApprovalSnapshotRank(current);
  const candidateRank = tokenApprovalSnapshotRank(candidate);
  if (candidateRank.activeAndFresh !== currentRank.activeAndFresh) {
    return candidateRank.activeAndFresh > currentRank.activeAndFresh ? candidate : current;
  }
  if (candidateRank.lastRead !== currentRank.lastRead) {
    return candidateRank.lastRead > currentRank.lastRead ? candidate : current;
  }
  if (candidateRank.statusPriority !== currentRank.statusPriority) {
    return candidateRank.statusPriority > currentRank.statusPriority ? candidate : current;
  }
  return current;
}

function approvalSnapshotFor(
  row: ApprovalWatchlistRecord,
  allowanceByKey: Map<string, AllowanceSnapshotRecord>,
  nftApprovalByKey: Map<string, NftApprovalSnapshotRecord>,
  nftTokenApprovalByPointKey: Map<string, NftApprovalSnapshotRecord>,
) {
  if (row.kind === "erc20Allowance" && row.spender) {
    return allowanceByKey.get(
      createApprovalIdentityKey({
        chainId: row.chainId,
        owner: row.owner,
        contract: row.tokenContract,
        kind: row.kind,
        spender: row.spender,
      }),
    ) ?? null;
  }
  if (row.kind === "erc721TokenApproval" && row.tokenId) {
    return nftTokenApprovalByPointKey.get(
      createApprovalIdentityKey({
        chainId: row.chainId,
        owner: row.owner,
        contract: row.tokenContract,
        kind: row.kind,
        tokenId: row.tokenId,
      }),
    ) ?? null;
  }
  if (row.operator) {
    return nftApprovalByKey.get(
      createApprovalIdentityKey({
        chainId: row.chainId,
        owner: row.owner,
        contract: row.tokenContract,
        kind: row.kind,
        operator: row.operator,
        tokenId: row.tokenId,
      }),
    ) ?? null;
  }
  return null;
}

function approvalEligibility(
  snapshot: AllowanceSnapshotRecord | NftApprovalSnapshotRecord | null,
  stale = false,
  failure = false,
) {
  const eligibility = getRevokeDraftEligibility(snapshot, stale, failure);
  return eligibility.eligible ? "Eligible for revoke draft" : eligibility.reason;
}

interface RevokeDraftSelection {
  snapshot: RevokeDraftSnapshot;
  stale: boolean;
  failure: boolean;
  sourceLabel: string;
  createdAt: string;
}

function parseNonceInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositiveIntegerInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

function parseGweiInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return parseUnits(trimmed, "gwei");
  } catch {
    return INVALID_GWEI_SENTINEL;
  }
}

function parsedGweiDisplay(input: string, value: string | null | undefined, optional = false) {
  if (!input.trim()) return optional ? "Not provided" : "Required";
  const parsed = parseGweiInput(input);
  if (parsed !== null && parsed < 0n) return "Invalid";
  return value ? formatGwei(value) : input;
}

function formatGwei(value: string | null | undefined) {
  return value ? formatUnits(BigInt(value), "gwei") : "Not provided";
}

function approvalCounterpartyLabel(snapshot: RevokeDraftSnapshot) {
  if ("allowanceRaw" in snapshot) return `spender ${snapshot.spender}`;
  if (snapshot.kind === "erc721TokenApproval") return `current approved operator ${snapshot.operator}`;
  return `operator ${snapshot.operator}`;
}

function detailList(details: Array<[string, string | null | undefined]>) {
  const visible = details.filter(([, value]) => value);
  return visible.length > 0
    ? visible.map(([label, value]) => `${label}=${value}`).join(", ")
    : "None";
}

function canBuildRevokeDraft(snapshot: RevokeDraftSnapshot | null, stale?: boolean, failure?: boolean) {
  return getRevokeDraftEligibility(snapshot, stale, failure).eligible;
}

function balanceMatches(
  snapshot: Erc20BalanceSnapshotRecord,
  owner: string,
  chainId: string,
  contract: string,
  status: string,
  source: string,
  staleFailure: StaleFailureFilter,
  metadataSource: string | null,
  kind: KindFilter,
) {
  if (kind && kind !== "erc20Balance") return false;
  if (owner.trim() && snapshot.account.toLowerCase() !== owner.trim().toLowerCase()) return false;
  if (chainId.trim() && snapshot.chainId !== Number(chainId)) return false;
  if (contract.trim() && snapshot.tokenContract.toLowerCase() !== contract.trim().toLowerCase()) return false;
  if (status.trim() && snapshot.balanceStatus !== status) return false;
  if (source.trim()) {
    const sourceValue = source.trim();
    if (sourceValue === "unknownMetadata") {
      if (metadataSource !== null) return false;
    } else if (metadataSource !== sourceValue) {
      return false;
    }
  }
  if (staleFailure === "stale" && snapshot.balanceStatus !== "stale") return false;
  if (staleFailure === "failure" && !balanceFailure(snapshot.balanceStatus)) return false;
  if (staleFailure === "clean" && (snapshot.balanceStatus === "stale" || balanceFailure(snapshot.balanceStatus))) {
    return false;
  }
  return true;
}

export function AssetApprovalsView({
  accounts,
  busy = false,
  error = null,
  rpcReady = false,
  selectedRpc = null,
  selectedChainId,
  state,
  onAddApprovalCandidate,
  onScanErc20Allowance,
  onScanNftOperatorApproval,
  onScanErc721TokenApproval,
}: AssetApprovalsViewProps) {
  const [filterOwner, setFilterOwner] = useState("");
  const [filterChainId, setFilterChainId] = useState("");
  const [filterContract, setFilterContract] = useState("");
  const [filterCounterparty, setFilterCounterparty] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterKind, setFilterKind] = useState<KindFilter>("");
  const [filterStaleFailure, setFilterStaleFailure] = useState<StaleFailureFilter>("all");
  const [candidateKind, setCandidateKind] = useState<ApprovalWatchKind>("erc20Allowance");
  const [candidateOwner, setCandidateOwner] = useState("");
  const [candidateChainId, setCandidateChainId] = useState(selectedChainId.toString());
  const [candidateContract, setCandidateContract] = useState("");
  const [candidateCounterparty, setCandidateCounterparty] = useState("");
  const [candidateTokenId, setCandidateTokenId] = useState("");
  const [candidateLabel, setCandidateLabel] = useState("");
  const [candidateNotes, setCandidateNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [revokeSelection, setRevokeSelection] = useState<RevokeDraftSelection | null>(null);
  const [revokeNonce, setRevokeNonce] = useState("");
  const [revokeGasLimit, setRevokeGasLimit] = useState("");
  const [revokeLatestBaseFeeGwei, setRevokeLatestBaseFeeGwei] = useState("");
  const [revokeBaseFeeGwei, setRevokeBaseFeeGwei] = useState("");
  const [revokeMaxFeeGwei, setRevokeMaxFeeGwei] = useState("");
  const [revokePriorityFeeGwei, setRevokePriorityFeeGwei] = useState("");
  const [revokeAcknowledgements, setRevokeAcknowledgements] = useState<
    Partial<Record<RevokeDraftWarningCode, boolean>>
  >({});

  useEffect(() => {
    setCandidateChainId(selectedChainId.toString());
    setFilterChainId((current) => current || selectedChainId.toString());
  }, [selectedChainId]);

  useEffect(() => {
    if (!candidateOwner && accounts[0]) {
      setCandidateOwner(accounts[0].address);
    }
  }, [accounts, candidateOwner]);

  const metadataByToken = useMemo(() => {
    const map = new Map<string, ResolvedTokenMetadataRecord>();
    for (const item of state?.resolvedTokenMetadata ?? []) {
      map.set(tokenIdentityKey(item.chainId, item.tokenContract), item);
    }
    return map;
  }, [state]);

  const entries = useMemo(
    () =>
      matchingEntries(
        state,
        filterOwner,
        filterChainId,
        filterContract,
        filterCounterparty,
        filterStatus,
        filterSource,
        filterStaleFailure,
        filterKind,
      ),
    [
      state,
      filterOwner,
      filterChainId,
      filterContract,
      filterCounterparty,
      filterStatus,
      filterSource,
      filterStaleFailure,
      filterKind,
    ],
  );

  const unfilteredEntries = useMemo(() => (state ? listApprovalReadModelEntries(state) : []), [state]);

  const visibleWatchlistKeys = new Set(
    entries.filter((entry) => entry.kind === "watchlist").map((entry) => entry.identityKey),
  );
  const visibleAssetKeys = new Set(
    entries.filter((entry) => entry.kind === "asset").map((entry) => entry.identityKey),
  );
  const visibleAllowanceKeys = new Set(
    entries.filter((entry) => entry.kind === "allowance").map((entry) => entry.identityKey),
  );
  const visibleNftApprovalKeys = new Set(
    entries.filter((entry) => entry.kind === "nftApproval").map((entry) => entry.identityKey),
  );
  const visibleJobKeys = new Set(
    entries.filter((entry) => entry.kind === "scanJob").map((entry) => entry.identityKey),
  );

  const allowanceEntriesByKey = new Map(
    entries
      .filter((entry) => entry.kind === "allowance")
      .map((entry) => [entry.identityKey, entry] as const),
  );
  const nftApprovalEntriesByKey = new Map(
    entries
      .filter((entry) => entry.kind === "nftApproval")
      .map((entry) => [entry.identityKey, entry] as const),
  );
  const unfilteredAllowanceEntriesByKey = new Map(
    unfilteredEntries
      .filter((entry) => entry.kind === "allowance")
      .map((entry) => [entry.identityKey, entry] as const),
  );
  const unfilteredNftApprovalEntriesByKey = new Map(
    unfilteredEntries
      .filter((entry) => entry.kind === "nftApproval")
      .map((entry) => [entry.identityKey, entry] as const),
  );
  const assetEntriesByKey = new Map(
    entries.filter((entry) => entry.kind === "asset").map((entry) => [entry.identityKey, entry] as const),
  );
  const jobEntriesByKey = new Map(
    entries.filter((entry) => entry.kind === "scanJob").map((entry) => [entry.identityKey, entry] as const),
  );

  const allowanceByKey = useMemo(() => {
    const map = new Map<string, AllowanceSnapshotRecord>();
    for (const item of state?.allowanceSnapshots ?? []) map.set(allowanceKey(item), item);
    return map;
  }, [state]);

  const nftApprovalByKey = useMemo(() => {
    const map = new Map<string, NftApprovalSnapshotRecord>();
    for (const item of state?.nftApprovalSnapshots ?? []) map.set(nftApprovalKey(item), item);
    return map;
  }, [state]);

  const nftTokenApprovalByPointKey = useMemo(() => {
    const map = new Map<string, NftApprovalSnapshotRecord>();
    for (const item of state?.nftApprovalSnapshots ?? []) {
      if (item.kind === "erc721TokenApproval" && item.tokenId) {
        const key = nftTokenApprovalPointKey(item);
        map.set(key, betterTokenApprovalSnapshot(map.get(key) ?? null, item));
      }
    }
    return map;
  }, [state]);

  const balanceRows = (state?.erc20BalanceSnapshots ?? []).filter((snapshot) => {
    const metadata = metadataFor(
      metadataByToken,
      snapshot.chainId,
      snapshot.tokenContract,
      snapshot.resolvedMetadata,
    );
    return balanceMatches(
      snapshot,
      filterOwner,
      filterChainId,
      filterContract,
      filterStatus,
      filterSource,
      filterStaleFailure,
      metadata?.source ?? null,
      filterKind,
    );
  });
  const watchlistRows = (state?.approvalWatchlist ?? []).filter((row) =>
    visibleWatchlistKeys.has(
      createApprovalIdentityKey({
        chainId: row.chainId,
        owner: row.owner,
        contract: row.tokenContract,
        kind: row.kind,
        spender: row.spender,
        operator: row.operator,
        tokenId: row.tokenId,
      }),
    ),
  );
  const assetRows = (state?.assetSnapshots ?? []).filter((row) =>
    visibleAssetKeys.has(
      createApprovalIdentityKey({
        chainId: row.chainId,
        owner: row.owner,
        contract: row.tokenContract,
        kind: row.assetKind,
        tokenId: row.tokenId,
      }),
    ),
  );
  const allowanceRows = (state?.allowanceSnapshots ?? []).filter((row) =>
    visibleAllowanceKeys.has(allowanceKey(row)),
  );
  const nftApprovalRows = (state?.nftApprovalSnapshots ?? []).filter((row) =>
    visibleNftApprovalKeys.has(nftApprovalKey(row)),
  );
  const jobRows = (state?.assetScanJobs ?? []).filter((row) =>
    visibleJobKeys.has(
      createApprovalIdentityKey({
        chainId: row.chainId,
        owner: row.owner,
        contract: row.contractFilter,
        kind: "scanJob",
      }),
    ),
  );
  const localAccounts = useMemo(
    () => accounts.map((account) => ({ address: account.address, index: account.index })),
    [accounts],
  );
  const revokeDraft: RevokeDraft | null = useMemo(() => {
    if (!revokeSelection) return null;
    return buildRevokeDraft({
      chainId: revokeSelection.snapshot.chainId,
      selectedRpc,
      snapshot: revokeSelection.snapshot,
      snapshotStale: revokeSelection.stale,
      snapshotFailure: revokeSelection.failure,
      localAccounts,
      fee: {
        nonce: parseNonceInput(revokeNonce),
        gasLimit: parsePositiveIntegerInput(revokeGasLimit),
        latestBaseFeePerGas: parseGweiInput(revokeLatestBaseFeeGwei),
        baseFeePerGas: parseGweiInput(revokeBaseFeeGwei),
        maxFeePerGas: parseGweiInput(revokeMaxFeeGwei),
        maxPriorityFeePerGas: parseGweiInput(revokePriorityFeeGwei),
      },
      warningAcknowledgements: revokeAcknowledgements,
      createdAt: revokeSelection.createdAt,
    });
  }, [
    localAccounts,
    revokeAcknowledgements,
    revokeBaseFeeGwei,
    revokeGasLimit,
    revokeLatestBaseFeeGwei,
    revokeMaxFeeGwei,
    revokeNonce,
    revokePriorityFeeGwei,
    revokeSelection,
    selectedRpc,
  ]);

  function selectRevokeSnapshot(
    snapshot: RevokeDraftSnapshot,
    entry: ApprovalReadModelEntry | null | undefined,
    source: string,
  ) {
    setRevokeSelection({
      snapshot,
      stale: entry?.stale === true,
      failure: entry?.failure === true,
      sourceLabel: source,
      createdAt: new Date().toISOString(),
    });
    setRevokeAcknowledgements({});
    setRevokeNonce("");
    setRevokeGasLimit("");
    setRevokeLatestBaseFeeGwei("");
    setRevokeBaseFeeGwei("");
    setRevokeMaxFeeGwei("");
    setRevokePriorityFeeGwei("");
  }

  function setRevokeAcknowledgement(code: RevokeDraftWarningCode, acknowledged: boolean) {
    setRevokeAcknowledgements((current) => ({ ...current, [code]: acknowledged }));
  }

  async function submitCandidate() {
    setFormError(null);
    const chainId = Number(candidateChainId);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      setFormError("chainId must be a positive integer.");
      return;
    }
    if (!candidateOwner.trim() || !candidateContract.trim()) {
      setFormError("Owner and token contract are required.");
      return;
    }
    if (!candidateCounterparty.trim()) {
      setFormError("Spender/operator is required for manual candidate configuration.");
      return;
    }
    if (candidateKind === "erc721TokenApproval" && !candidateTokenId.trim()) {
      setFormError("tokenId is required for ERC-721 token-specific approvals.");
      return;
    }
    const sanitizedCandidateLabel = sanitizeRevokeDraftDisplayText(candidateLabel);
    const sanitizedCandidateNotes = sanitizeRevokeDraftDisplayText(candidateNotes);
    const succeeded = await onAddApprovalCandidate({
      chainId,
      owner: candidateOwner,
      tokenContract: candidateContract,
      kind: candidateKind,
      spender: candidateKind === "erc20Allowance" ? candidateCounterparty : null,
      operator: candidateKind === "erc20Allowance" ? null : candidateCounterparty,
      tokenId: candidateKind === "erc721TokenApproval" ? candidateTokenId : null,
      enabled: true,
      label: sanitizedCandidateLabel || null,
      userNotes: sanitizedCandidateNotes || null,
      source: {
        kind: "userWatchlist",
        label: "Local manual candidate",
        summary: "Configured locally; not discovered as full-chain coverage.",
      },
    });
    if (succeeded === false) return;
    setCandidateContract("");
    setCandidateCounterparty("");
    setCandidateTokenId("");
    setCandidateLabel("");
    setCandidateNotes("");
  }

  function scanWatchlistRow(row: ApprovalWatchlistRecord) {
    if (row.kind === "erc20Allowance" && row.spender) {
      return onScanErc20Allowance(row.owner, row.chainId, row.tokenContract, row.spender);
    }
    if (row.kind === "erc721ApprovalForAll" && row.operator) {
      return onScanNftOperatorApproval(row.owner, row.chainId, row.tokenContract, row.operator);
    }
    if (row.kind === "erc721TokenApproval" && row.tokenId) {
      return onScanErc721TokenApproval(
        row.owner,
        row.chainId,
        row.tokenContract,
        row.tokenId,
        row.operator ?? null,
      );
    }
    setFormError("This candidate is missing the spender/operator or tokenId required for scanning.");
    return false;
  }

  return (
    <section className="workspace-section assets-grid">
      <header className="section-header">
        <div>
          <h2>Assets & Approvals</h2>
          <p className="section-subtitle">
            Local candidate configuration and point-read snapshots. Symbols and labels are display context only.
          </p>
        </div>
        <span className="pill">chainId {selectedChainId.toString()}</span>
      </header>

      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {formError && (
        <div className="inline-warning" role="alert">
          {formError}
        </div>
      )}

      <section className="token-panel" aria-label="Approval filters">
        <div className="asset-filter-grid">
          <label>
            Account / owner
            <input onChange={(event) => setFilterOwner(event.target.value)} value={filterOwner} />
          </label>
          <label>
            Chain ID
            <input
              inputMode="numeric"
              onChange={(event) => setFilterChainId(event.target.value)}
              value={filterChainId}
            />
          </label>
          <label>
            Contract
            <input onChange={(event) => setFilterContract(event.target.value)} value={filterContract} />
          </label>
          <label>
            Spender / operator
            <input
              onChange={(event) => setFilterCounterparty(event.target.value)}
              value={filterCounterparty}
            />
          </label>
          <label>
            Status
            <select onChange={(event) => setFilterStatus(event.target.value)} value={filterStatus}>
              <option value="">Any</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source
            <select onChange={(event) => setFilterSource(event.target.value)} value={filterSource}>
              <option value="">Any</option>
              {sourceFilterOptions.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kind
            <select
              onChange={(event) => setFilterKind(event.target.value as KindFilter)}
              value={filterKind}
            >
              {kindFilterOptions.map((option) => (
                <option key={option.value || "any"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stale / failure
            <select
              onChange={(event) => setFilterStaleFailure(event.target.value as StaleFailureFilter)}
              value={filterStaleFailure}
            >
              <option value="all">Any</option>
              <option value="stale">Stale only</option>
              <option value="failure">Failure only</option>
              <option value="clean">Clean only</option>
            </select>
          </label>
        </div>
      </section>

      <section className="token-panel" aria-label="Revoke draft confirmation">
        <header className="token-panel-header">
          <h3>Revoke draft confirmation</h3>
          <span className="section-subtitle">
            Draft only. React does not sign, broadcast, submit, or write history.
          </span>
        </header>
        {revokeSelection && revokeDraft ? (
          <div className="token-status-stack">
            <div className="asset-candidate-grid">
              <label>
                Nonce
                <input
                  inputMode="numeric"
                  onChange={(event) => setRevokeNonce(event.target.value)}
                  value={revokeNonce}
                />
              </label>
              <label>
                Gas limit
                <input
                  inputMode="numeric"
                  onChange={(event) => setRevokeGasLimit(event.target.value)}
                  value={revokeGasLimit}
                />
              </label>
              <label>
                Max fee (gwei)
                <input
                  inputMode="decimal"
                  onChange={(event) => setRevokeMaxFeeGwei(event.target.value)}
                  value={revokeMaxFeeGwei}
                />
              </label>
              <label>
                Priority fee (gwei)
                <input
                  inputMode="decimal"
                  onChange={(event) => setRevokePriorityFeeGwei(event.target.value)}
                  value={revokePriorityFeeGwei}
                />
              </label>
              <label>
                Latest base fee (gwei)
                <input
                  inputMode="decimal"
                  onChange={(event) => setRevokeLatestBaseFeeGwei(event.target.value)}
                  value={revokeLatestBaseFeeGwei}
                />
              </label>
              <label>
                Base fee (gwei)
                <input
                  inputMode="decimal"
                  onChange={(event) => setRevokeBaseFeeGwei(event.target.value)}
                  value={revokeBaseFeeGwei}
                />
              </label>
            </div>
            <div className="confirmation-grid">
              <div>Ready</div>
              <div>{revokeDraft.ready ? "Ready after acknowledgements" : "Blocked until required fields and acknowledgements are complete"}</div>
              <div>Chain</div>
              <div className="mono">chainId {revokeDraft.approvalIdentity?.chainId ?? revokeSelection.snapshot.chainId}</div>
              <div>From owner</div>
              <div className="mono">{revokeDraft.approvalIdentity?.owner ?? revokeSelection.snapshot.owner}</div>
              <div>Selected RPC</div>
              <div className="mono">
                {revokeDraft.selectedRpc.endpointSummary} · {revokeDraft.selectedRpc.endpointFingerprint}
              </div>
              <div>Transaction to</div>
              <div className="mono">
                to = token/approval contract {revokeDraft.transactionTo ?? revokeSelection.snapshot.tokenContract}
              </div>
              <div>Approval contract</div>
              <div className="mono">{revokeDraft.approvalIdentity?.contract ?? revokeSelection.snapshot.tokenContract}</div>
              <div>Calldata target</div>
              <div className="mono">{approvalCounterpartyLabel(revokeSelection.snapshot)}</div>
              <div>Method</div>
              <div className="mono">{revokeDraft.method ?? "Unavailable"}</div>
              <div>Selector</div>
              <div className="mono">{revokeDraft.selector ?? "Unavailable"}</div>
              <div>Calldata args</div>
              <div className="mono">
                {revokeDraft.calldataArgs.map((arg) => `${arg.name}=${String(arg.value)}`).join(", ") || "Unavailable"}
              </div>
              <div>Calldata</div>
              <div className="mono">{revokeDraft.calldata ?? "Unavailable"}</div>
              <div>Snapshot</div>
              <div>
                {revokeDraft.approvalIdentity?.status ?? revokeSelection.snapshot.status} · source{" "}
                {revokeDraft.approvalIdentity?.sourceKind ?? revokeSelection.snapshot.source.kind} ·{" "}
                {revokeDraft.approvalIdentity?.stale ? "stale" : "fresh"} · {revokeSelection.sourceLabel}
              </div>
              <div>Snapshot ref</div>
              <div className="mono">{revokeDraft.approvalIdentity?.identityKey ?? "Unavailable"}</div>
              <div>Snapshot source ref</div>
              <div className="mono">
                {revokeDraft.approvalIdentity
                  ? detailList([
                      ["kind", revokeDraft.approvalIdentity.source.kind],
                      ["label", revokeDraft.approvalIdentity.source.label],
                      ["sourceId", revokeDraft.approvalIdentity.source.sourceId],
                      ["summary", revokeDraft.approvalIdentity.source.summary],
                      ["providerHint", revokeDraft.approvalIdentity.source.providerHint],
                      ["observedAt", revokeDraft.approvalIdentity.source.observedAt],
                    ])
                  : "Unavailable"}
              </div>
              <div>Snapshot storage ref</div>
              <div className="mono">
                {revokeDraft.approvalIdentity
                  ? detailList([
                      ["createdAt", revokeDraft.approvalIdentity.ref.createdAt],
                      ["updatedAt", revokeDraft.approvalIdentity.ref.updatedAt],
                      ["lastScannedAt", revokeDraft.approvalIdentity.ref.lastScannedAt],
                      ["staleAfter", revokeDraft.approvalIdentity.ref.staleAfter],
                      ["rpcIdentity", revokeDraft.approvalIdentity.ref.rpcIdentity],
                      ["rpcProfileId", revokeDraft.approvalIdentity.ref.rpcProfileId],
                    ])
                  : "Unavailable"}
              </div>
              <div>Nonce</div>
              <div className="mono">{revokeDraft.intent?.nonce ?? (revokeNonce || "Required")}</div>
              <div>Gas limit</div>
              <div className="mono">{revokeDraft.intent?.gasLimit ?? (revokeGasLimit || "Required")}</div>
              <div>Latest base fee</div>
              <div className="mono">
                {revokeDraft.intent?.latestBaseFeePerGas
                  ? formatGwei(revokeDraft.intent.latestBaseFeePerGas)
                  : parsedGweiDisplay(revokeLatestBaseFeeGwei, revokeDraft.intent?.latestBaseFeePerGas, true)}
              </div>
              <div>Base fee</div>
              <div className="mono">
                {revokeDraft.intent?.baseFeePerGas
                  ? formatGwei(revokeDraft.intent.baseFeePerGas)
                  : parsedGweiDisplay(revokeBaseFeeGwei, revokeDraft.intent?.baseFeePerGas, true)}
              </div>
              <div>Max fee</div>
              <div className="mono">{revokeDraft.intent ? formatGwei(revokeDraft.intent.maxFeePerGas) : revokeMaxFeeGwei || "Required"}</div>
              <div>Priority fee</div>
              <div className="mono">{revokeDraft.intent ? formatGwei(revokeDraft.intent.maxPriorityFeePerGas) : revokePriorityFeeGwei || "Required"}</div>
              <div>Frozen key</div>
              <div className="mono">{revokeDraft.frozenKey}</div>
              <div>Frozen version</div>
              <div className="mono">{revokeDraft.frozenVersion}</div>
              <div>Frozen time key</div>
              <div className="mono">{revokeDraft.frozenTimeKey}</div>
              <div>Created at</div>
              <div className="mono">{revokeDraft.createdAt}</div>
              <div>Frozen at</div>
              <div className="mono">{revokeDraft.frozenAt}</div>
            </div>
            {revokeDraft.blockingStatuses.length > 0 && (
              <div className="inline-warning">
                {revokeDraft.blockingStatuses.map((status) => status.message).join(" ")}
              </div>
            )}
            <div className="raw-calldata-warning-list" aria-label="Revoke warning acknowledgements">
              {revokeDraft.warnings.map((warning) => (
                <label className="check-row" key={`${warning.code}:${warning.source}`}>
                  <input
                    checked={warning.acknowledged === true}
                    onChange={(event) =>
                      setRevokeAcknowledgement(warning.code as RevokeDraftWarningCode, event.target.checked)
                    }
                    type="checkbox"
                  />
                  {warning.message}
                </label>
              ))}
            </div>
            <button disabled type="button">
              Submit unavailable until P5-4f
            </button>
          </div>
        ) : (
          <span className="muted">Select an active approval row to build a revoke draft.</span>
        )}
      </section>

      <section className="token-panel" aria-label="Manual approval candidate configuration">
        <header className="token-panel-header">
          <h3>Local/manual candidate configuration</h3>
          <span className="section-subtitle">This does not discover contracts, owners, or approvals.</span>
        </header>
        <div className="asset-candidate-grid">
          <label>
            Kind
            <select
              onChange={(event) => setCandidateKind(event.target.value as ApprovalWatchKind)}
              value={candidateKind}
            >
              {approvalKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            Owner
            <select onChange={(event) => setCandidateOwner(event.target.value)} value={candidateOwner}>
              {accounts.map((account) => (
                <option key={account.address} value={account.address}>
                  {sanitizeRevokeDraftDisplayText(account.label) ?? "Account"} · {compactAddress(account.address)}
                </option>
              ))}
              <option value="">Custom owner</option>
            </select>
          </label>
          <label>
            Owner text
            <input onChange={(event) => setCandidateOwner(event.target.value)} value={candidateOwner} />
          </label>
          <label>
            Chain ID
            <input
              inputMode="numeric"
              onChange={(event) => setCandidateChainId(event.target.value)}
              value={candidateChainId}
            />
          </label>
          <label>
            Token / NFT contract
            <input
              onChange={(event) => setCandidateContract(event.target.value)}
              value={candidateContract}
            />
          </label>
          <label>
            Spender / operator
            <input
              onChange={(event) => setCandidateCounterparty(event.target.value)}
              value={candidateCounterparty}
            />
          </label>
          <label>
            Token ID
            <input
              disabled={candidateKind !== "erc721TokenApproval"}
              onChange={(event) => setCandidateTokenId(event.target.value)}
              value={candidateTokenId}
            />
          </label>
          <label>
            Label
            <input onChange={(event) => setCandidateLabel(event.target.value)} value={candidateLabel} />
          </label>
          <label>
            Notes
            <input onChange={(event) => setCandidateNotes(event.target.value)} value={candidateNotes} />
          </label>
          <button
            disabled={busy || !candidateOwner.trim() || !candidateContract.trim() || !candidateCounterparty.trim()}
            onClick={() => void submitCandidate()}
            type="button"
          >
            Add Candidate
          </button>
        </div>
      </section>

      <section className="token-panel" aria-label="Approval watchlist candidates">
        <header className="token-panel-header">
          <h3>Approval watchlist</h3>
          <span className="section-subtitle">
            Source coverage is local/manual unless a candidate row says otherwise.
          </span>
        </header>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Candidate identity</th>
                <th>Source coverage</th>
                <th>Latest snapshot</th>
                <th>Future revoke</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {watchlistRows.map((row) => {
                const snapshot = approvalSnapshotFor(
                  row,
                  allowanceByKey,
                  nftApprovalByKey,
                  nftTokenApprovalByPointKey,
                );
                const display = metadataFor(metadataByToken, row.chainId, row.tokenContract);
                const snapshotKey =
                  snapshot && "allowanceRaw" in snapshot
                    ? allowanceKey(snapshot)
                    : snapshot
                      ? nftApprovalKey(snapshot)
                      : null;
                const snapshotEntry =
                  snapshotKey && snapshot && "allowanceRaw" in snapshot
                    ? unfilteredAllowanceEntriesByKey.get(snapshotKey)
                    : snapshotKey
                      ? unfilteredNftApprovalEntriesByKey.get(snapshotKey)
                      : null;
                const revokeEligible = canBuildRevokeDraft(snapshot, snapshotEntry?.stale, snapshotEntry?.failure);
                const sanitizedRowLabel = sanitizeRevokeDraftDisplayText(row.label);
                return (
                  <tr key={`${row.chainId}:${row.owner}:${row.tokenContract}:${row.kind}:${row.spender ?? row.operator}:${row.tokenId ?? ""}`}>
                    <td>
                      <strong>{tokenDisplay(display, sanitizedRowLabel)}</strong>
                      <div className="mono">owner {row.owner}</div>
                      <div className="mono">contract {row.tokenContract}</div>
                      {row.spender && <div className="mono">spender {row.spender}</div>}
                      {row.operator && <div className="mono">operator {row.operator}</div>}
                      {row.tokenId && <div className="mono">tokenId {row.tokenId}</div>}
                      <div className="muted">{row.kind} · {row.enabled ? "enabled" : "disabled"}</div>
                    </td>
                    <td>
                      <div className="token-status-stack">
                        <span>{sourceLabel(row.source)}</span>
                        <span className="muted">
                          Not full-chain safety coverage; only configured candidate points are scanned.
                        </span>
                        {row.userNotes && (
                          <span className="muted">{sanitizeRevokeDraftDisplayText(row.userNotes)}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {snapshot ? (
                        <div className="token-status-stack">
                          <span className={statusClass(snapshot.status, snapshotEntry?.stale, snapshotEntry?.failure)}>
                            {visibleStatus(
                              "allowanceRaw" in snapshot
                                ? allowanceStatusLabels[snapshot.status]
                                : nftApprovalStatusLabels[snapshot.status],
                              snapshotEntry?.stale,
                            )}
                          </span>
                          {"allowanceRaw" in snapshot ? (
                            <span className="mono">allowance {snapshot.allowanceRaw}</span>
                          ) : (
                            <>
                              <span>approved {snapshot.approved === null || snapshot.approved === undefined ? "unknown" : String(snapshot.approved)}</span>
                              <span className="mono">actual operator {snapshot.operator}</span>
                            </>
                          )}
                          <span className="muted">Last scan {formatTimestamp(snapshot.lastScannedAt)}</span>
                          {snapshot.lastErrorSummary && (
                            <span className="token-error">{snapshot.lastErrorSummary}</span>
                          )}
                        </div>
                      ) : (
                        <span className="muted">No point-read snapshot yet.</span>
                      )}
                    </td>
                    <td>
                      <div className="token-status-stack">
                        <span>{approvalEligibility(snapshot, snapshotEntry?.stale, snapshotEntry?.failure)}</span>
                        <button
                          className="secondary-button"
                          disabled={!revokeEligible}
                          onClick={() =>
                            snapshot
                              ? selectRevokeSnapshot(snapshot, snapshotEntry, "watchlist candidate")
                              : undefined
                          }
                          type="button"
                        >
                          {revokeEligible ? "Build Revoke Draft" : "Revoke draft unavailable"}
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        disabled={busy || !rpcReady || !row.enabled}
                        onClick={() => void scanWatchlistRow(row)}
                        title={rpcReady ? undefined : "Validate an RPC before scanning approvals."}
                        type="button"
                      >
                        Scan
                      </button>
                    </td>
                  </tr>
                );
              })}
              {(state?.approvalWatchlist ?? []).length === 0 && (
                <tr>
                  <td colSpan={5}>
                    Approval source coverage is unknown/not configured. This is not a full-chain safety scan.
                  </td>
                </tr>
              )}
              {(state?.approvalWatchlist ?? []).length > 0 && watchlistRows.length === 0 && (
                <tr>
                  <td colSpan={5}>No approval candidates match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="token-panel" aria-label="ERC-20 balance snapshots">
        <header className="token-panel-header">
          <h3>ERC-20 balances</h3>
          <span className="section-subtitle">Raw balances remain visible even when metadata is unknown.</span>
        </header>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Identity</th>
                <th>Raw balance</th>
                <th>Readable balance</th>
                <th>Status / metadata</th>
              </tr>
            </thead>
            <tbody>
              {balanceRows.map((snapshot) => {
                const metadata = metadataFor(
                  metadataByToken,
                  snapshot.chainId,
                  snapshot.tokenContract,
                  snapshot.resolvedMetadata,
                );
                return (
                  <tr key={`${snapshot.account}:${snapshot.chainId}:${snapshot.tokenContract}`}>
                    <td>
                      <strong>{tokenDisplay(metadata)}</strong>
                      <div className="mono">owner {snapshot.account}</div>
                      <div className="mono">contract {snapshot.tokenContract}</div>
                      <div className="mono">chainId {snapshot.chainId}</div>
                    </td>
                    <td className="mono">{snapshot.balanceRaw}</td>
                    <td>{humanBalance(snapshot, metadata)}</td>
                    <td>
                      <div className="token-status-stack">
                        <span className={statusClass(snapshot.balanceStatus, snapshot.balanceStatus === "stale", balanceFailure(snapshot.balanceStatus))}>
                          {balanceStatusLabels[snapshot.balanceStatus]}
                        </span>
                        <span>
                          {metadata
                            ? `${metadata.symbol ?? "Unknown symbol"} · ${metadata.name ?? "Unknown name"}`
                            : "Unknown metadata"}
                        </span>
                        <span className="muted">
                          metadata source {metadata?.source ?? "unknown"} · decimals {metadata?.decimals ?? "unknown"}
                        </span>
                        <span className="muted">Last scan {formatTimestamp(snapshot.lastScannedAt)}</span>
                        {snapshot.lastErrorSummary && (
                          <span className="token-error">{snapshot.lastErrorSummary}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {balanceRows.length === 0 && (
                <tr>
                  <td colSpan={4}>No ERC-20 balance snapshots match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="token-panel" aria-label="Known NFT and asset snapshots">
        <header className="token-panel-header">
          <h3>Known NFT / asset holdings</h3>
          <span className="section-subtitle">Only configured or imported snapshot points are shown.</span>
        </header>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Identity</th>
                <th>Holding</th>
                <th>Status</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {assetRows.map((snapshot) => {
                const key = createApprovalIdentityKey({
                  chainId: snapshot.chainId,
                  owner: snapshot.owner,
                  contract: snapshot.tokenContract,
                  kind: snapshot.assetKind,
                  tokenId: snapshot.tokenId,
                });
                const entry = assetEntriesByKey.get(key);
                return (
                  <tr key={key}>
                    <td>
                      <strong>{snapshot.assetKind}</strong>
                      <div className="mono">owner {snapshot.owner}</div>
                      <div className="mono">contract {snapshot.tokenContract}</div>
                      {snapshot.tokenId && <div className="mono">tokenId {snapshot.tokenId}</div>}
                      <div className="mono">chainId {snapshot.chainId}</div>
                    </td>
                    <td className="mono">{snapshot.balanceRaw ?? "holding status only"}</td>
                    <td>
                      <div className="token-status-stack">
                        <span className={statusClass(snapshot.status, entry?.stale, entry?.failure)}>
                          {visibleStatus(assetStatusLabels[snapshot.status], entry?.stale)}
                        </span>
                        <span className="muted">Last scan {formatTimestamp(snapshot.lastScannedAt)}</span>
                        {snapshot.lastErrorSummary && (
                          <span className="token-error">{snapshot.lastErrorSummary}</span>
                        )}
                      </div>
                    </td>
                    <td>{sourceLabel(snapshot.source)}</td>
                  </tr>
                );
              })}
              {assetRows.length === 0 && (
                <tr>
                  <td colSpan={4}>No known NFT or asset snapshots match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="token-panel" aria-label="ERC-20 allowance snapshots">
        <header className="token-panel-header">
          <h3>ERC-20 allowances</h3>
          <span className="section-subtitle">Owner, contract, and spender remain the security identity.</span>
        </header>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Identity</th>
                <th>Allowance raw</th>
                <th>Status</th>
                <th>Source</th>
                <th>Revoke draft</th>
              </tr>
            </thead>
            <tbody>
              {allowanceRows.map((snapshot) => {
                const key = allowanceKey(snapshot);
                const entry = allowanceEntriesByKey.get(key);
                const metadata = metadataFor(metadataByToken, snapshot.chainId, snapshot.tokenContract);
                return (
                  <tr key={key}>
                    <td>
                      <strong>{tokenDisplay(metadata)}</strong>
                      <div className="mono">owner {snapshot.owner}</div>
                      <div className="mono">contract {snapshot.tokenContract}</div>
                      <div className="mono">spender {snapshot.spender}</div>
                      <div className="mono">chainId {snapshot.chainId}</div>
                    </td>
                    <td className="mono">{snapshot.allowanceRaw}</td>
                    <td>
                      <div className="token-status-stack">
                        <span className={statusClass(snapshot.status, entry?.stale, entry?.failure)}>
                          {visibleStatus(allowanceStatusLabels[snapshot.status], entry?.stale)}
                        </span>
                        <span>{approvalEligibility(snapshot, entry?.stale, entry?.failure)}</span>
                        <span className="muted">Last scan {formatTimestamp(snapshot.lastScannedAt)}</span>
                        {snapshot.lastErrorSummary && (
                          <span className="token-error">{snapshot.lastErrorSummary}</span>
                        )}
                      </div>
                    </td>
                    <td>{sourceLabel(snapshot.source)}</td>
                    <td>
                      <button
                        className="secondary-button"
                        disabled={!canBuildRevokeDraft(snapshot, entry?.stale, entry?.failure)}
                        onClick={() => selectRevokeSnapshot(snapshot, entry, "allowance snapshot")}
                        type="button"
                      >
                        {canBuildRevokeDraft(snapshot, entry?.stale, entry?.failure)
                          ? "Build Revoke Draft"
                          : "Revoke draft unavailable"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {allowanceRows.length === 0 && (
                <tr>
                  <td colSpan={5}>No ERC-20 allowance snapshots match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="token-panel" aria-label="NFT approval snapshots">
        <header className="token-panel-header">
          <h3>NFT approvals</h3>
          <span className="section-subtitle">Operator and token-specific approvals are point reads.</span>
        </header>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Identity</th>
                <th>Approval</th>
                <th>Status</th>
                <th>Source</th>
                <th>Revoke draft</th>
              </tr>
            </thead>
            <tbody>
              {nftApprovalRows.map((snapshot) => {
                const key = nftApprovalKey(snapshot);
                const entry = nftApprovalEntriesByKey.get(key);
                return (
                  <tr key={key}>
                    <td>
                      <strong>{snapshot.kind}</strong>
                      <div className="mono">owner {snapshot.owner}</div>
                      <div className="mono">contract {snapshot.tokenContract}</div>
                      <div className="mono">operator {snapshot.operator}</div>
                      {snapshot.tokenId && <div className="mono">tokenId {snapshot.tokenId}</div>}
                      <div className="mono">chainId {snapshot.chainId}</div>
                    </td>
                    <td>{snapshot.approved === null || snapshot.approved === undefined ? "unknown" : String(snapshot.approved)}</td>
                    <td>
                      <div className="token-status-stack">
                        <span className={statusClass(snapshot.status, entry?.stale, entry?.failure)}>
                          {visibleStatus(nftApprovalStatusLabels[snapshot.status], entry?.stale)}
                        </span>
                        <span>{approvalEligibility(snapshot, entry?.stale, entry?.failure)}</span>
                        <span className="muted">Last scan {formatTimestamp(snapshot.lastScannedAt)}</span>
                        {snapshot.lastErrorSummary && (
                          <span className="token-error">{snapshot.lastErrorSummary}</span>
                        )}
                      </div>
                    </td>
                    <td>{sourceLabel(snapshot.source)}</td>
                    <td>
                      <button
                        className="secondary-button"
                        disabled={!canBuildRevokeDraft(snapshot, entry?.stale, entry?.failure)}
                        onClick={() => selectRevokeSnapshot(snapshot, entry, "NFT approval snapshot")}
                        type="button"
                      >
                        {canBuildRevokeDraft(snapshot, entry?.stale, entry?.failure)
                          ? "Build Revoke Draft"
                          : "Revoke draft unavailable"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {nftApprovalRows.length === 0 && (
                <tr>
                  <td colSpan={5}>No NFT approval snapshots match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="token-panel" aria-label="Asset scan jobs">
        <header className="token-panel-header">
          <h3>Scan jobs</h3>
          <span className="section-subtitle">Jobs describe requested point reads and source coverage.</span>
        </header>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Coverage</th>
                <th>Timing</th>
              </tr>
            </thead>
            <tbody>
              {jobRows.map((job) => {
                const key = createApprovalIdentityKey({
                  chainId: job.chainId,
                  owner: job.owner,
                  contract: job.contractFilter,
                  kind: "scanJob",
                });
                const entry = jobEntriesByKey.get(key);
                return (
                  <tr key={job.jobId}>
                    <td>
                      <strong>{job.jobId}</strong>
                      <div className="mono">owner {job.owner}</div>
                      {job.contractFilter && <div className="mono">contract {job.contractFilter}</div>}
                      <div className="mono">chainId {job.chainId}</div>
                    </td>
                    <td>
                      <div className="token-status-stack">
                        <span className={statusClass(job.status, entry?.stale, entry?.failure)}>
                          {visibleStatus(jobStatusLabels[job.status], entry?.stale)}
                        </span>
                        {job.lastErrorSummary && (
                          <span className="token-error">{job.lastErrorSummary}</span>
                        )}
                      </div>
                    </td>
                    <td>{sourceLabel(job.source)}</td>
                    <td>
                      <div className="token-status-stack">
                        <span className="muted">Started {formatTimestamp(job.startedAt)}</span>
                        <span className="muted">Finished {formatTimestamp(job.finishedAt)}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {jobRows.length === 0 && (
                <tr>
                  <td colSpan={4}>No scan jobs match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
