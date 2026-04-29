import { AbiCoder, getAddress, id as ethersId } from "ethers";
import { createApprovalIdentityKey } from "./approvals";
import type {
  AllowanceSnapshotRecord,
  ApprovalSourceKind,
  ApprovalSourceMetadata,
  NftApprovalSnapshotRecord,
} from "../../lib/tauri";

export const ERC20_APPROVE_SELECTOR = "0x095ea7b3";
export const ERC721_APPROVE_SELECTOR = "0x095ea7b3";
export const SET_APPROVAL_FOR_ALL_SELECTOR = "0xa22cb465";
export const REVOKE_DRAFT_VERSION = 1;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const UINT256_UNLIMITED_THRESHOLD = (1n << 255n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const abiCoder = AbiCoder.defaultAbiCoder();

export type RevokeDraftSnapshot = AllowanceSnapshotRecord | NftApprovalSnapshotRecord;

export type RevokeDraftWarningCode =
  | "unlimitedErc20Allowance"
  | "nonRpcConfirmedSource"
  | "staleOrFailedSnapshot"
  | "externalCounterparty"
  | "manualFeeGas";

export type RevokeDraftBlockingCode =
  | "snapshotNotActive"
  | "zeroOrRevoked"
  | "staleOrFailedSnapshot"
  | "missingTokenId"
  | "invalidTokenId"
  | "missingCounterparty"
  | "invalidSnapshotIdentity"
  | "missingRpc"
  | "missingRpcChainId"
  | "missingRpcEndpointSummary"
  | "missingRpcEndpointFingerprint"
  | "chainMismatch"
  | "ownerNotLocal"
  | "nonce"
  | "gasLimit"
  | "latestBaseFee"
  | "baseFee"
  | "maxFee"
  | "priorityFee"
  | "maxFeeBelowPriorityFee";

export interface RevokeDraftStatus {
  level: "warning" | "blocking";
  code: RevokeDraftWarningCode | RevokeDraftBlockingCode;
  message: string;
  source: "snapshot" | "identity" | "rpc" | "account" | "fee" | "warning";
  requiresAcknowledgement?: boolean;
  acknowledged?: boolean;
}

export interface RevokeDraftRpcIdentityInput {
  chainId?: bigint | number | null;
  providerConfigId?: string | null;
  endpointId?: string | null;
  endpointName?: string | null;
  endpointSummary?: string | null;
  endpointFingerprint?: string | null;
}

export interface RevokeDraftRpcIdentity {
  chainId: number | null;
  providerConfigId: string | null;
  endpointId: string | null;
  endpointName: string | null;
  endpointSummary: string;
  endpointFingerprint: string;
}

export interface RevokeDraftLocalAccount {
  address: string;
  index?: number | null;
}

export interface RevokeDraftFeeInput {
  nonce: number | null;
  gasLimit: bigint | null;
  latestBaseFeePerGas?: bigint | null;
  baseFeePerGas?: bigint | null;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
}

export interface BuildRevokeDraftInput {
  chainId: bigint | number;
  selectedRpc?: RevokeDraftRpcIdentityInput | null;
  snapshot: RevokeDraftSnapshot;
  snapshotStale?: boolean;
  snapshotFailure?: boolean;
  now?: Date | number | string;
  localAccounts?: RevokeDraftLocalAccount[];
  fee: RevokeDraftFeeInput;
  warningAcknowledgements?: Partial<Record<RevokeDraftWarningCode, boolean>>;
  createdAt?: string;
}

export interface RevokeDraftCalldataArg {
  name: string;
  type: "address" | "uint256" | "bool";
  value: string | boolean;
}

export interface RevokeDraftIntent {
  transactionType: "assetApprovalRevoke";
  chainId: number;
  selectedRpc: RevokeDraftRpcIdentity;
  from: string;
  fromAccountIndex: number | null;
  to: string;
  valueWei: "0";
  method: string;
  selector: string;
  calldata: string;
  calldataArgs: RevokeDraftCalldataArg[];
  nonce: number;
  gasLimit: string;
  latestBaseFeePerGas: string | null;
  baseFeePerGas: string | null;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

export interface RevokeDraftSnapshotIdentity {
  identityKey: string;
  chainId: number;
  owner: string;
  contract: string;
  kind: "erc20Allowance" | "erc721ApprovalForAll" | "erc721TokenApproval";
  spender: string | null;
  operator: string | null;
  tokenId: string | null;
  status: string;
  sourceKind: ApprovalSourceKind;
  sourceSummary: string | null;
  source: {
    kind: ApprovalSourceKind;
    label: string | null;
    sourceId: string | null;
    summary: string | null;
    providerHint: string | null;
    observedAt: string | null;
  };
  stale: boolean;
  failure: boolean;
  ref: {
    createdAt: string;
    updatedAt: string;
    lastScannedAt: string | null;
    staleAfter: string | null;
    rpcIdentity: string | null;
    rpcProfileId: string | null;
  };
}

export interface RevokeDraft {
  draftId: string;
  frozenKey: string;
  frozenTimeKey: string;
  frozenPayload: unknown;
  frozenVersion: typeof REVOKE_DRAFT_VERSION;
  createdAt: string;
  frozenAt: string;
  selectedRpc: RevokeDraftRpcIdentity;
  approvalIdentity: RevokeDraftSnapshotIdentity | null;
  transactionTo: string | null;
  method: string | null;
  selector: string | null;
  calldata: string | null;
  calldataArgs: RevokeDraftCalldataArg[];
  warnings: RevokeDraftStatus[];
  blockingStatuses: RevokeDraftStatus[];
  ready: boolean;
  intent: RevokeDraftIntent | null;
}

export function getRevokeDraftEligibility(
  snapshot: RevokeDraftSnapshot | null,
  stale = false,
  failure = false,
  now?: Date | number | string,
) {
  if (!snapshot) return { eligible: false, reason: "Not eligible: scan required" };
  if (!normalizeAddress(snapshot.owner) || !normalizeAddress(snapshot.tokenContract)) {
    return { eligible: false, reason: "Not eligible: invalid approval identity" };
  }
  if ("allowanceRaw" in snapshot && !normalizeAddress(snapshot.spender)) {
    return { eligible: false, reason: "Not eligible: invalid approval identity" };
  }
  if (!("allowanceRaw" in snapshot) && !normalizeAddress(snapshot.operator)) {
    return { eligible: false, reason: "Not eligible: invalid approval identity" };
  }
  if (stale || failure || snapshotExpired(snapshot, now) || snapshot.status === "stale" || failureStatus(snapshot.status)) {
    return { eligible: false, reason: "Not eligible: rescan required" };
  }
  if ("allowanceRaw" in snapshot) {
    const allowance = parseBigint(snapshot.allowanceRaw);
    if (allowance === null) return { eligible: false, reason: "Not eligible: rescan required" };
    return snapshot.status === "active" && allowance > 0n
      ? { eligible: true, reason: "Eligible for revoke draft" }
      : { eligible: false, reason: "Not eligible: zero or inactive" };
  }
  if (snapshot.kind === "erc721TokenApproval" && !normalizeTokenId(snapshot.tokenId)) {
    return { eligible: false, reason: snapshot.tokenId ? "Not eligible: invalid tokenId" : "Not eligible: tokenId required" };
  }
  return snapshot.status === "active" && snapshot.approved === true
    ? { eligible: true, reason: "Eligible for revoke draft" }
    : { eligible: false, reason: "Not eligible: revoked or inactive" };
}

export function buildRevokeDraft(input: BuildRevokeDraftInput): RevokeDraft {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const frozenAt = createdAt;
  const chainId = numericChainId(input.chainId);
  const selectedRpc = sanitizeSelectedRpc(input.selectedRpc ?? null, chainId);
  const localAccounts = sanitizeLocalAccounts(input.localAccounts ?? []);
  const blockingStatuses: RevokeDraftStatus[] = [];
  const stale =
    input.snapshotStale === true || snapshotExpired(input.snapshot, input.now);
  const failure = input.snapshotFailure === true;
  const approvalIdentity = snapshotIdentity(input.snapshot, stale, failure);
  const eligibility = getRevokeDraftEligibility(
    input.snapshot,
    stale,
    failure,
    input.now,
  );

  if (!eligibility.eligible) {
    blockingStatuses.push(blocking(blockingCodeFromEligibility(eligibility.reason), eligibility.reason, "snapshot"));
  }
  validateSelectedRpc(input.selectedRpc ?? null, selectedRpc, blockingStatuses);
  if (selectedRpc.chainId !== null && selectedRpc.chainId !== chainId) {
    blockingStatuses.push(
      blocking("chainMismatch", `RPC returned chainId ${selectedRpc.chainId}; expected ${chainId}.`, "rpc"),
    );
  }

  const encoded = encodeRevokeCall(input.snapshot, blockingStatuses);
  if (encoded && encoded.chainId !== chainId) {
    blockingStatuses.push(blocking("chainMismatch", `Snapshot chainId ${encoded.chainId} does not match ${chainId}.`, "snapshot"));
  }

  const owner = encoded?.from ?? normalizeAddress("owner" in input.snapshot ? input.snapshot.owner : null);
  const ownerAccount = owner ? localAccounts.find((account) => account.address === owner) ?? null : null;
  if (!ownerAccount) {
    blockingStatuses.push(blocking("ownerNotLocal", "Approval owner must match a local account.", "account"));
  }
  validateFee(input.fee, blockingStatuses);

  const warnings = warningStatuses(
    input.snapshot,
    approvalIdentity,
    localAccounts,
    input.warningAcknowledgements ?? {},
    stale,
    failure,
  );
  const uniqueBlocking = uniqueStatuses(blockingStatuses);
  const uniqueWarnings = uniqueStatuses(warnings);
  const ready =
    uniqueBlocking.length === 0 &&
    uniqueWarnings.every((warning) => !warning.requiresAcknowledgement || warning.acknowledged === true);

  const intent =
    ready && encoded && owner && input.fee.nonce !== null && input.fee.gasLimit !== null &&
    input.fee.maxFeePerGas !== null && input.fee.maxPriorityFeePerGas !== null
      ? {
          transactionType: "assetApprovalRevoke" as const,
          chainId,
          selectedRpc,
          from: owner,
          fromAccountIndex: ownerAccount?.index ?? null,
          to: encoded.to,
          valueWei: "0" as const,
          method: encoded.method,
          selector: encoded.selector,
          calldata: encoded.calldata,
          calldataArgs: encoded.args,
          nonce: input.fee.nonce,
          gasLimit: input.fee.gasLimit.toString(),
          latestBaseFeePerGas: input.fee.latestBaseFeePerGas?.toString() ?? null,
          baseFeePerGas: input.fee.baseFeePerGas?.toString() ?? null,
          maxFeePerGas: input.fee.maxFeePerGas.toString(),
          maxPriorityFeePerGas: input.fee.maxPriorityFeePerGas.toString(),
        }
      : null;

  const semanticFrozen = semanticFrozenPayload({
    chainId,
    selectedRpc,
    approvalIdentity,
    encoded,
    owner,
    fromAccountIndex: ownerAccount?.index ?? null,
    fee: input.fee,
    warnings: uniqueWarnings,
    blockingStatuses: uniqueBlocking,
  });
  const frozenKey = compactHashKey(semanticFrozen);
  const frozenTimeKey = compactHashKeyWithPrefix("asset-revoke-time", {
    frozenKey,
    frozenVersion: REVOKE_DRAFT_VERSION,
    createdAt,
    frozenAt,
  });
  const frozen = {
    ...semanticFrozen,
    createdAt,
    frozenAt,
    frozenTimeKey,
  };

  return {
    draftId: compactHashKeyWithPrefix("asset-revoke-draft", { frozenKey, frozenTimeKey }),
    frozenKey,
    frozenTimeKey,
    frozenPayload: frozen,
    frozenVersion: REVOKE_DRAFT_VERSION,
    createdAt,
    frozenAt,
    selectedRpc,
    approvalIdentity,
    transactionTo: encoded?.to ?? null,
    method: encoded?.method ?? null,
    selector: encoded?.selector ?? null,
    calldata: encoded?.calldata ?? null,
    calldataArgs: encoded?.args ?? [],
    warnings: uniqueWarnings,
    blockingStatuses: uniqueBlocking,
    ready,
    intent,
  };
}

export function sanitizeRevokeDraftDisplayText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? sanitizeSecretText(trimmed) : null;
}

function encodeRevokeCall(snapshot: RevokeDraftSnapshot, statuses: RevokeDraftStatus[]) {
  const chainId = snapshot.chainId;
  const to = normalizeAddress(snapshot.tokenContract);
  const from = normalizeAddress(snapshot.owner);
  if (!to || !from) {
    statuses.push(blocking("invalidSnapshotIdentity", "Snapshot owner and contract must be valid addresses.", "identity"));
    return null;
  }
  if ("allowanceRaw" in snapshot) {
    const spender = normalizeAddress(snapshot.spender);
    if (!spender) {
      statuses.push(blocking("missingCounterparty", "ERC-20 allowance revoke requires a spender.", "identity"));
      return null;
    }
    const args: RevokeDraftCalldataArg[] = [
      { name: "spender", type: "address", value: spender },
      { name: "amount", type: "uint256", value: "0" },
    ];
    return {
      chainId,
      from,
      to,
      method: "approve(address,uint256)",
      selector: ERC20_APPROVE_SELECTOR,
      args,
      calldata: `${ERC20_APPROVE_SELECTOR}${abiCoder.encode(["address", "uint256"], [spender, 0n]).slice(2)}`,
    };
  }
  const operator = normalizeAddress(snapshot.operator);
  if (!operator) {
    statuses.push(blocking("missingCounterparty", "NFT approval revoke requires an operator/current approved address.", "identity"));
    return null;
  }
  if (snapshot.kind === "erc721TokenApproval") {
    const tokenId = normalizeTokenId(snapshot.tokenId);
    if (!tokenId) {
      statuses.push(blocking("invalidTokenId", "ERC-721 token-specific revoke requires a non-negative decimal uint256 tokenId.", "identity"));
      return null;
    }
    const args: RevokeDraftCalldataArg[] = [
      { name: "approved", type: "address", value: ZERO_ADDRESS },
      { name: "tokenId", type: "uint256", value: tokenId },
    ];
    return {
      chainId,
      from,
      to,
      method: "approve(address,uint256)",
      selector: ERC721_APPROVE_SELECTOR,
      args,
      calldata: `${ERC721_APPROVE_SELECTOR}${abiCoder.encode(["address", "uint256"], [ZERO_ADDRESS, BigInt(tokenId)]).slice(2)}`,
    };
  }
  const args: RevokeDraftCalldataArg[] = [
    { name: "operator", type: "address", value: operator },
    { name: "approved", type: "bool", value: false },
  ];
  return {
    chainId,
    from,
    to,
    method: "setApprovalForAll(address,bool)",
    selector: SET_APPROVAL_FOR_ALL_SELECTOR,
    args,
    calldata: `${SET_APPROVAL_FOR_ALL_SELECTOR}${abiCoder.encode(["address", "bool"], [operator, false]).slice(2)}`,
  };
}

function snapshotIdentity(snapshot: RevokeDraftSnapshot, stale: boolean, failure: boolean): RevokeDraftSnapshotIdentity | null {
  const owner = normalizeAddress(snapshot.owner);
  const contract = normalizeAddress(snapshot.tokenContract);
  if (!owner || !contract) return null;
  const spender = "allowanceRaw" in snapshot ? normalizeAddress(snapshot.spender) : null;
  const operator = "allowanceRaw" in snapshot ? null : normalizeAddress(snapshot.operator);
  const tokenId = "allowanceRaw" in snapshot ? null : normalizeTokenId(snapshot.tokenId);
  const kind = "allowanceRaw" in snapshot ? "erc20Allowance" : snapshot.kind;
  const source = sanitizeSourceRef(snapshot.source);
  return {
    identityKey: createApprovalIdentityKey({
      chainId: snapshot.chainId,
      owner,
      contract,
      kind,
      spender,
      operator,
      tokenId,
    }),
    chainId: snapshot.chainId,
    owner,
    contract,
    kind,
    spender,
    operator,
    tokenId,
    status: snapshot.status,
    sourceKind: snapshot.source.kind,
    sourceSummary: source.summary ?? source.label,
    source,
    stale: stale || snapshot.status === "stale",
    failure: failure || failureStatus(snapshot.status),
    ref: {
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      lastScannedAt: snapshot.lastScannedAt ?? null,
      staleAfter: snapshot.staleAfter ?? null,
      rpcIdentity: sanitizeText(snapshot.rpcIdentity ?? null),
      rpcProfileId: sanitizeText(snapshot.rpcProfileId ?? null),
    },
  };
}

function warningStatuses(
  snapshot: RevokeDraftSnapshot,
  identity: RevokeDraftSnapshotIdentity | null,
  localAccounts: Array<{ address: string; index: number | null }>,
  acknowledgements: Partial<Record<RevokeDraftWarningCode, boolean>>,
  stale: boolean,
  failure: boolean,
) {
  const warnings: RevokeDraftStatus[] = [];
  const push = (code: RevokeDraftWarningCode, message: string, source: RevokeDraftStatus["source"]) => {
    warnings.push({
      level: "warning",
      code,
      message,
      source,
      requiresAcknowledgement: true,
      acknowledged: acknowledgements[code] === true,
    });
  };
  if ("allowanceRaw" in snapshot) {
    const allowance = parseBigint(snapshot.allowanceRaw);
    if (allowance !== null && allowance >= UINT256_UNLIMITED_THRESHOLD) {
      push("unlimitedErc20Allowance", "ERC-20 allowance appears unlimited; confirm the revoke target carefully.", "snapshot");
    }
  }
  if (identity?.sourceKind !== "rpcPointRead") {
    push("nonRpcConfirmedSource", "Snapshot source is not RPC-confirmed; rescan before relying on it.", "snapshot");
  }
  if (stale || failure || identity?.stale || identity?.failure) {
    push("staleOrFailedSnapshot", "Snapshot is stale or failed and cannot be used without a fresh point read.", "snapshot");
  }
  const counterparty = counterpartyAddress(snapshot);
  if (counterparty && !localAccounts.some((account) => account.address === counterparty)) {
    push("externalCounterparty", "Spender/operator is not one of the local accounts.", "identity");
  }
  push("manualFeeGas", "Nonce, gas limit, and EIP-1559 fee fields are manual inputs.", "fee");
  return warnings;
}

function validateFee(fee: RevokeDraftFeeInput, statuses: RevokeDraftStatus[]) {
  if (fee.nonce === null || !Number.isSafeInteger(fee.nonce) || fee.nonce < 0) {
    statuses.push(blocking("nonce", "Nonce must be a non-negative safe integer.", "fee"));
  }
  if (fee.gasLimit === null || fee.gasLimit <= 0n) {
    statuses.push(blocking("gasLimit", "Gas limit must be greater than zero.", "fee"));
  }
  if (fee.latestBaseFeePerGas !== null && fee.latestBaseFeePerGas !== undefined && fee.latestBaseFeePerGas < 0n) {
    statuses.push(blocking("latestBaseFee", "Latest base fee must be non-negative when provided.", "fee"));
  }
  if (fee.baseFeePerGas !== null && fee.baseFeePerGas !== undefined && fee.baseFeePerGas < 0n) {
    statuses.push(blocking("baseFee", "Base fee must be non-negative when provided.", "fee"));
  }
  if (fee.maxFeePerGas === null || fee.maxFeePerGas < 0n) {
    statuses.push(blocking("maxFee", "Max fee must be a non-negative gwei value.", "fee"));
  }
  if (fee.maxPriorityFeePerGas === null || fee.maxPriorityFeePerGas < 0n) {
    statuses.push(blocking("priorityFee", "Priority fee must be a non-negative gwei value.", "fee"));
  }
  if (
    fee.maxFeePerGas !== null &&
    fee.maxPriorityFeePerGas !== null &&
    fee.maxFeePerGas < fee.maxPriorityFeePerGas
  ) {
    statuses.push(blocking("maxFeeBelowPriorityFee", "Max fee must be greater than or equal to priority fee.", "fee"));
  }
}

function sanitizeSourceRef(source: ApprovalSourceMetadata) {
  return {
    kind: source.kind,
    label: sanitizeText(source.label ?? null),
    sourceId: sanitizeText(source.sourceId ?? null),
    summary: sanitizeText(source.summary ?? null),
    providerHint: sanitizeText(source.providerHint ?? null),
    observedAt: sanitizeText(source.observedAt ?? null),
  };
}

function semanticFrozenPayload(input: {
  chainId: number;
  selectedRpc: RevokeDraftRpcIdentity;
  approvalIdentity: RevokeDraftSnapshotIdentity | null;
  encoded: ReturnType<typeof encodeRevokeCall>;
  owner: string | null;
  fromAccountIndex: number | null;
  fee: RevokeDraftFeeInput;
  warnings: RevokeDraftStatus[];
  blockingStatuses: RevokeDraftStatus[];
}) {
  return {
    kind: "assetApprovalRevokeDraft",
    frozenVersion: REVOKE_DRAFT_VERSION,
    expectedChainId: input.chainId,
    selectedRpc: input.selectedRpc,
    from: input.owner,
    fromAccountIndex: input.fromAccountIndex,
    approvalIdentity: input.approvalIdentity,
    approvalKind: input.approvalIdentity?.kind ?? null,
    tokenApprovalContract: input.encoded?.to ?? input.approvalIdentity?.contract ?? null,
    spender: input.approvalIdentity?.spender ?? null,
    operator: input.approvalIdentity?.operator ?? null,
    tokenId: input.approvalIdentity?.tokenId ?? null,
    method: input.encoded?.method ?? null,
    selector: input.encoded?.selector ?? null,
    calldataArgs: input.encoded?.args ?? [],
    calldata: input.encoded?.calldata ?? null,
    gas: {
      gasLimit: input.fee.gasLimit?.toString() ?? null,
      latestBaseFeePerGas: input.fee.latestBaseFeePerGas?.toString() ?? null,
      baseFeePerGas: input.fee.baseFeePerGas?.toString() ?? null,
      maxFeePerGas: input.fee.maxFeePerGas?.toString() ?? null,
      maxPriorityFeePerGas: input.fee.maxPriorityFeePerGas?.toString() ?? null,
    },
    nonce: input.fee.nonce,
    warningAcknowledgements: input.warnings
      .filter((warning) => warning.requiresAcknowledgement)
      .map((warning) => ({ code: warning.code, acknowledged: warning.acknowledged === true })),
    blockingStatuses: input.blockingStatuses.map((status) => ({ code: status.code, source: status.source })),
  };
}

function sanitizeSelectedRpc(input: RevokeDraftRpcIdentityInput | null, expectedChainId: number): RevokeDraftRpcIdentity {
  const chainId = input?.chainId === null || input?.chainId === undefined ? expectedChainId : numericChainId(input.chainId);
  const endpointSummary = sanitizeRpcEndpointSummary(input?.endpointSummary ?? null) ?? `selected-rpc-chain-${expectedChainId}`;
  return {
    chainId,
    providerConfigId: sanitizeText(input?.providerConfigId ?? null),
    endpointId: sanitizeText(input?.endpointId ?? null) ?? "selected-rpc",
    endpointName: sanitizeText(input?.endpointName ?? null) ?? "Selected RPC",
    endpointSummary,
    endpointFingerprint: sanitizeText(input?.endpointFingerprint ?? null) ?? compactHashKeyWithPrefix("rpc-endpoint", { rpc: endpointSummary }),
  };
}

function validateSelectedRpc(
  input: RevokeDraftRpcIdentityInput | null,
  selectedRpc: RevokeDraftRpcIdentity,
  statuses: RevokeDraftStatus[],
) {
  if (!input) {
    statuses.push(blocking("missingRpc", "Select and validate an RPC before building a revoke draft.", "rpc"));
    return;
  }
  if (input.chainId === null || input.chainId === undefined) {
    statuses.push(blocking("missingRpcChainId", "Selected RPC chainId is required for the frozen draft.", "rpc"));
  }
  if (!sanitizeRpcEndpointSummary(input.endpointSummary ?? null)) {
    statuses.push(blocking("missingRpcEndpointSummary", "Selected RPC endpoint summary is required for the frozen draft.", "rpc"));
  }
  if (!sanitizeText(input.endpointFingerprint ?? null)) {
    statuses.push(blocking("missingRpcEndpointFingerprint", "Selected RPC endpoint fingerprint is required for the frozen draft.", "rpc"));
  }
  if (selectedRpc.endpointSummary.startsWith("selected-rpc-chain-")) {
    statuses.push(blocking("missingRpcEndpointSummary", "Selected RPC endpoint summary is required for the frozen draft.", "rpc"));
  }
  if (selectedRpc.endpointFingerprint.startsWith("rpc-endpoint-") && !sanitizeText(input.endpointFingerprint ?? null)) {
    statuses.push(blocking("missingRpcEndpointFingerprint", "Selected RPC endpoint fingerprint is required for the frozen draft.", "rpc"));
  }
}

function sanitizeRpcEndpointSummary(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      return sanitizeSecretText(trimmed);
    }
    const query = Array.from(url.searchParams.keys())
      .sort()
      .map((key) => `${key}=[redacted]`)
      .join("&");
    const path = url.pathname && url.pathname !== "/" ? "/<redacted_path>" : "/";
    return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ""}`;
  } catch {
    return sanitizeSecretText(trimmed);
  }
}

function sanitizeLocalAccounts(accounts: RevokeDraftLocalAccount[]) {
  return accounts
    .map((account) => ({
      address: normalizeAddress(account.address),
      index:
        typeof account.index === "number" && Number.isSafeInteger(account.index) && account.index >= 0
          ? account.index
          : null,
    }))
    .filter((account): account is { address: string; index: number | null } => Boolean(account.address));
}

function counterpartyAddress(snapshot: RevokeDraftSnapshot) {
  return "allowanceRaw" in snapshot ? normalizeAddress(snapshot.spender) : normalizeAddress(snapshot.operator);
}

function blocking(
  code: RevokeDraftBlockingCode,
  message: string,
  source: RevokeDraftStatus["source"],
): RevokeDraftStatus {
  return { level: "blocking", code, message, source };
}

function uniqueStatuses(statuses: RevokeDraftStatus[]) {
  const seen = new Set<string>();
  return statuses.filter((status) => {
    const key = `${status.level}:${status.code}:${status.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function blockingCodeFromEligibility(reason: string): RevokeDraftBlockingCode {
  if (reason.includes("rescan")) return "staleOrFailedSnapshot";
  if (reason.includes("zero") || reason.includes("revoked")) return "zeroOrRevoked";
  if (reason.includes("invalid tokenId")) return "invalidTokenId";
  if (reason.includes("tokenId")) return "missingTokenId";
  return "snapshotNotActive";
}

function failureStatus(status: string) {
  return [
    "unknown",
    "readFailed",
    "sourceUnavailable",
    "rateLimited",
    "chainMismatch",
    "failed",
    "partial",
  ].includes(status);
}

function normalizeAddress(value: string | null | undefined) {
  if (!value) return null;
  try {
    return getAddress(value).toLowerCase();
  } catch {
    return null;
  }
}

function normalizeTokenId(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  try {
    const parsed = BigInt(trimmed);
    if (parsed > UINT256_MAX) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseBigint(value: string | null | undefined) {
  try {
    return BigInt(value ?? "");
  } catch {
    return null;
  }
}

function numericChainId(chainId: bigint | number) {
  return typeof chainId === "bigint" ? Number(chainId) : chainId;
}

function sanitizeText(value: string | null) {
  return sanitizeRevokeDraftDisplayText(value);
}

function sanitizeSecretText(trimmed: string): string {
  return trimmed
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>;,]+/gi, (match) => sanitizeRpcEndpointSummary(match) ?? "[redacted_url]")
    .replace(/\bBearer\s+[^\s"'<>;,]+/gi, "Bearer [redacted]")
    .replace(/\bBasic\s+[^\s"'<>;,]+/gi, "Basic [redacted]")
    .replace(/\bAuthorization\s*=\s*[^\s"'<>;,]+/gi, "Authorization=[redacted]")
    .replace(/\bAuthorization\s*:\s*[^\s"'<>;,]+/gi, "Authorization: [redacted]")
    .replace(SENSITIVE_PHRASE_DELIMITED_TEXT_RE, (_match, key: string, separator: string) =>
      separator === ":" ? `${key}: [redacted]` : `${key}=[redacted]`,
    )
    .replace(SENSITIVE_DELIMITED_TEXT_RE, (_match, key: string, separator: string) =>
      separator === ":" ? `${key}: [redacted]` : `${key}=[redacted]`,
    )
    .replace(SENSITIVE_PHRASE_SPACE_TEXT_RE, "$1 [redacted]")
    .replace(SENSITIVE_SPACE_TEXT_RE, "$1 [redacted]")
    .replace(/\b(rawCalldata|fullCalldata|canonicalCalldata|calldata)\s*[:=]\s*0x[a-f0-9]+/gi, "$1=[redacted_calldata]")
    .replace(/0x[a-f0-9]{64,}/gi, "[redacted_hex]")
    .slice(0, 200);
}

const SENSITIVE_TEXT_KEY_PATTERN =
  "(?:api[\\s_-]?key|access[\\s_-]?token|auth[\\s_-]?token|authorization|auth|private[\\s_-]?key|mnemonic|seed(?:[\\s_-]?phrase)?|recovery[\\s_-]?phrase|signature|raw[\\s_-]?tx|raw[\\s_-]?transaction|signed[\\s_-]?tx|signed[\\s_-]?transaction|token|password|pass[\\s_-]?phrase|secret|key)";
const SENSITIVE_PHRASE_TEXT_KEY_PATTERN =
  "(?:mnemonic|seed(?:[\\s_-]?phrase)?|recovery[\\s_-]?phrase|pass[\\s_-]?phrase)";
const SENSITIVE_SPACE_TEXT_KEY_PATTERN =
  "(?:api\\s+key|access\\s+token|auth[\\s_-]?token|authorization|auth|private[\\s_-]?key|mnemonic|seed(?:[\\s_-]?phrase)?|recovery[\\s_-]?phrase|signature|raw[\\s_-]?tx|raw\\s+transaction|signed[\\s_-]?tx|signed\\s+transaction|password|pass[\\s_-]?phrase|secret)";
const SENSITIVE_TEXT_KEY_LOOKAHEAD = `(?:\\s+(?:${SENSITIVE_TEXT_KEY_PATTERN}|Bearer|Basic)\\s*(?:[:=]|\\s+))`;
const SENSITIVE_PHRASE_DELIMITED_TEXT_RE = new RegExp(
  `\\b(${SENSITIVE_PHRASE_TEXT_KEY_PATTERN})\\s*([:=])\\s*(?:"[^"]*"|'[^']*'|[^,;)]*?)(?=${SENSITIVE_TEXT_KEY_LOOKAHEAD}|$|[,;)])`,
  "gi",
);
const SENSITIVE_DELIMITED_TEXT_RE = new RegExp(
  `\\b(${SENSITIVE_TEXT_KEY_PATTERN})\\s*([:=])\\s*(?:"[^"]*"|'[^']*'|[^\\s,;)]+)`,
  "gi",
);
const SENSITIVE_PHRASE_SPACE_TEXT_RE = new RegExp(
  `\\b(${SENSITIVE_PHRASE_TEXT_KEY_PATTERN})\\b\\s+(?:"[^"]*"|'[^']*'|[^,;)]*?)(?=${SENSITIVE_TEXT_KEY_LOOKAHEAD}|$|[,;)])`,
  "gi",
);
const SENSITIVE_SPACE_TEXT_RE = new RegExp(
  `\\b(${SENSITIVE_SPACE_TEXT_KEY_PATTERN})\\b\\s+(?:"[^"]*"|'[^']*'|[^\\s,;)]+)`,
  "gi",
);

function snapshotExpired(snapshot: RevokeDraftSnapshot, now: Date | number | string | undefined) {
  if (!snapshot.staleAfter) return false;
  const staleAtMs = Number(snapshot.staleAfter) * 1000;
  const nowMs = nowMsFrom(now);
  return Number.isFinite(staleAtMs) && staleAtMs <= nowMs;
}

function nowMsFrom(now: Date | number | string | undefined) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === "number") return now;
  if (typeof now === "string") {
    const parsed = Date.parse(now);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  return Date.now();
}

function stableStringify(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compactHashKey(value: unknown) {
  return compactHashKeyWithPrefix("asset-revoke", value);
}

function compactHashKeyWithPrefix(prefix: string, value: unknown) {
  return `${prefix}-${ethersId(stableStringify(value)).slice(2, 18)}`;
}
