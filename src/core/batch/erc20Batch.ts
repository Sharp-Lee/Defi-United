import { id as ethersId } from "ethers";
import type {
  ExternalAddressReference,
  FrozenOrchestrationSummary,
  LocalAccountReference,
  OrchestrationDraft,
} from "../accountOrchestration/selection";
import { nextNonceWithLocalPending, type PendingNonceHistoryRecord } from "../history/reconciler";
import type {
  Erc20BalanceSnapshotRecord,
  ResolvedMetadataStatus,
  ResolvedTokenMetadataRecord,
  TokenWatchlistState,
} from "../../lib/tauri";

export type Erc20BatchKind = "distribute" | "collect";
export type Erc20BatchAssetKind = "erc20";
export type Erc20BatchTargetReference = LocalAccountReference | ExternalAddressReference;
export type Erc20BatchChildStatus =
  | "notSubmitted"
  | "skipped"
  | "blocked"
  | "pending"
  | "confirmed"
  | "failed"
  | "replaced"
  | "cancelled"
  | "dropped";
export type Erc20BatchPlanStatus = "ready" | "blocked" | "empty";
export type Erc20AllowanceStatus = "unknown" | "ok" | "insufficient" | "readFailed";

export const DEFAULT_ERC20_DISTRIBUTION_CONTRACT =
  "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3";
export const DISPERSE_TOKEN_SELECTOR = "0xc73a2d60";
export const DISPERSE_TOKEN_METHOD = "disperseToken(address,address[],uint256[])";

export interface Erc20BatchAccountSnapshot {
  address: string;
  nativeBalanceWei: bigint | null;
  nonce: number | null;
}

export interface Erc20BatchFeeInput {
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

export interface Erc20BatchAllowanceInput {
  status: Erc20AllowanceStatus;
  allowanceRaw: string | null;
  checkedAt?: string | null;
  error?: string | null;
}

export interface Erc20BatchPlanInput {
  batchKind: Erc20BatchKind;
  chainId: bigint | number;
  orchestration: OrchestrationDraft | FrozenOrchestrationSummary;
  accountSnapshots: Erc20BatchAccountSnapshot[];
  tokenWatchlistState: TokenWatchlistState | null;
  localPendingHistory?: PendingNonceHistoryRecord[];
  tokenContract: string;
  distributionAmountsRaw?: Record<string, string>;
  defaultDistributionAmountRaw?: string;
  allowance?: Erc20BatchAllowanceInput | null;
  fees: Erc20BatchFeeInput;
  batchId?: string;
  createdAt?: string;
}

export interface Erc20BatchTokenMetadata {
  tokenContract: string;
  decimals: number | null;
  symbol: string | null;
  name: string | null;
  source: string | null;
  status: ResolvedMetadataStatus | "missing";
  updatedAt: string | null;
}

export interface Erc20BatchSnapshotRef {
  account: string;
  chainId: number;
  tokenContract: string;
  balanceRaw: string | null;
  balanceStatus: Erc20BalanceSnapshotRecord["balanceStatus"] | "missing";
  updatedAt: string | null;
  lastScannedAt: string | null;
  metadataStatusRef: ResolvedMetadataStatus | null;
  lastErrorSummary: string | null;
}

export interface Erc20BatchIntentSnapshot {
  chainId: number;
  accountIndex: number;
  from: string;
  tokenContract: string;
  recipient: string;
  amountRaw: string;
  decimals: number;
  tokenSymbol: string | null;
  tokenName: string | null;
  tokenMetadataSource: string;
  nonce: number | null;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

export interface Erc20BatchChild {
  childId: string;
  batchId: string;
  batchKind: Erc20BatchKind;
  assetKind: Erc20BatchAssetKind;
  chainId: number;
  source: LocalAccountReference;
  target: Erc20BatchTargetReference;
  targetAddress: string;
  tokenContract: string;
  amountRaw: string;
  decimals: number | null;
  tokenSymbol: string | null;
  tokenName: string | null;
  tokenMetadataSource: string | null;
  sourceTokenSnapshot: Erc20BatchSnapshotRef;
  nonce: number | null;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  status: Erc20BatchChildStatus;
  intentSnapshot: Erc20BatchIntentSnapshot | null;
  warnings: string[];
  errors: string[];
}

export interface Erc20BatchDistributionRecipient {
  childId: string;
  target: Erc20BatchTargetReference;
  targetAddress: string;
  amountRaw: string;
}

export interface Erc20BatchDistributionParent {
  batchId: string;
  batchKind: "distribute";
  assetKind: Erc20BatchAssetKind;
  chainId: number;
  source: LocalAccountReference;
  distributionContract: string;
  selector: string;
  methodName: string;
  tokenContract: string;
  decimals: number;
  tokenSymbol: string | null;
  tokenName: string | null;
  tokenMetadataSource: string;
  sourceTokenSnapshot: Erc20BatchSnapshotRef;
  allowance: Erc20BatchAllowanceInput;
  recipients: Erc20BatchDistributionRecipient[];
  totalAmountRaw: string;
  nativeValueWei: "0";
  nonce: number | null;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  warnings: string[];
  errors: string[];
}

export interface Erc20BatchSummary {
  childCount: number;
  plannedCount: number;
  skippedCount: number;
  blockedCount: number;
  submittedCount: number;
  pendingCount: number;
  confirmedCount: number;
  failedCount: number;
  totalPlannedAmountRaw: string;
  totalGasLimit: string;
  maxGasCostWei: string;
  warningCount: number;
  errorCount: number;
}

export interface Erc20BatchPlan {
  batchId: string;
  batchKind: Erc20BatchKind;
  assetKind: Erc20BatchAssetKind;
  chainId: number;
  createdAt: string;
  frozenAt: string | null;
  freezeKey: string;
  orchestrationFrozenKey: string | null;
  token: Erc20BatchTokenMetadata | null;
  sources: LocalAccountReference[];
  targets: Erc20BatchTargetReference[];
  distributionParent: Erc20BatchDistributionParent | null;
  children: Erc20BatchChild[];
  summary: Erc20BatchSummary;
  warnings: string[];
  errors: string[];
  status: Erc20BatchPlanStatus;
}

export interface FrozenErc20BatchPlan extends Erc20BatchPlan {
  frozenAt: string;
}

const submittedStatuses = new Set<Erc20BatchChildStatus>([
  "pending",
  "confirmed",
  "failed",
  "replaced",
  "cancelled",
  "dropped",
]);

function numericChainId(chainId: bigint | number) {
  return typeof chainId === "bigint" ? Number(chainId) : chainId;
}

function addressKey(address: string) {
  return address.toLowerCase();
}

function targetAddress(target: Erc20BatchTargetReference) {
  return target.address;
}

export function erc20BatchTargetAmountKey(target: Erc20BatchTargetReference) {
  return `${target.kind}:${addressKey(target.address)}`;
}

function stableStringify(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseUnsignedRaw(value: string, field: string, errors: string[]) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    errors.push(`${field} must be a non-negative integer raw token value.`);
    return null;
  }
  return BigInt(trimmed);
}

function makeBatchId(chainId: number, createdAt: string) {
  return `erc20-batch-${chainId}-${ethersId(`${chainId}:${createdAt}`).slice(2, 14)}`;
}

function targetRefs(orchestration: OrchestrationDraft | FrozenOrchestrationSummary) {
  return [...orchestration.localTargets, ...orchestration.externalTargets];
}

function childId(batchId: string, index: number) {
  return `${batchId}:child-${String(index + 1).padStart(4, "0")}`;
}

function snapshotMap(snapshots: Erc20BatchAccountSnapshot[]) {
  return new Map(snapshots.map((snapshot) => [addressKey(snapshot.address), snapshot]));
}

function tokenSnapshotMap(state: TokenWatchlistState | null) {
  return new Map(
    (state?.erc20BalanceSnapshots ?? []).map((snapshot) => [
      `${addressKey(snapshot.account)}:${snapshot.chainId}:${addressKey(snapshot.tokenContract)}`,
      snapshot,
    ]),
  );
}

function metadataFor(
  state: TokenWatchlistState | null,
  chainId: number,
  tokenContract: string,
): Erc20BatchTokenMetadata | null {
  if (!tokenContract.trim()) return null;
  const metadata = (state?.resolvedTokenMetadata ?? []).find(
    (item: ResolvedTokenMetadataRecord) =>
      item.chainId === chainId && addressKey(item.tokenContract) === addressKey(tokenContract),
  );
  if (!metadata) {
    return {
      tokenContract,
      decimals: null,
      symbol: null,
      name: null,
      source: null,
      status: "missing",
      updatedAt: null,
    };
  }
  return {
    tokenContract: metadata.tokenContract,
    decimals: metadata.decimals ?? null,
    symbol: metadata.symbol ?? null,
    name: metadata.name ?? null,
    source: metadata.source,
    status: metadata.status,
    updatedAt: metadata.updatedAt,
  };
}

function tokenSnapshotRef(
  state: TokenWatchlistState | null,
  chainId: number,
  tokenContract: string,
  account: string,
): Erc20BatchSnapshotRef {
  const snapshot = tokenSnapshotMap(state).get(
    `${addressKey(account)}:${chainId}:${addressKey(tokenContract)}`,
  );
  if (!snapshot) {
    return {
      account,
      chainId,
      tokenContract,
      balanceRaw: null,
      balanceStatus: "missing",
      updatedAt: null,
      lastScannedAt: null,
      metadataStatusRef: null,
      lastErrorSummary: null,
    };
  }
  return {
    account: snapshot.account,
    chainId: snapshot.chainId,
    tokenContract: snapshot.tokenContract,
    balanceRaw: snapshot.balanceRaw,
    balanceStatus: snapshot.balanceStatus,
    updatedAt: snapshot.updatedAt,
    lastScannedAt: snapshot.lastScannedAt ?? null,
    metadataStatusRef: snapshot.metadataStatusRef ?? snapshot.resolvedMetadata?.status ?? null,
    lastErrorSummary: snapshot.lastErrorSummary ?? null,
  };
}

function nonceWithLocalPending(
  snapshotNonce: number | null | undefined,
  input: Erc20BatchPlanInput,
  chainId: number,
  source: LocalAccountReference,
) {
  if (snapshotNonce === null || snapshotNonce === undefined) return null;
  return nextNonceWithLocalPending(
    snapshotNonce,
    input.localPendingHistory ?? [],
    source.accountIndex,
    chainId,
    source.address,
  );
}

function childPayload(child: Erc20BatchChild) {
  return {
    childId: child.childId,
    source: {
      kind: child.source.kind,
      accountIndex: child.source.accountIndex,
      address: child.source.address,
      label: child.source.label,
      chainSnapshotStatus: child.source.chainSnapshotStatus,
    },
    target:
      child.target.kind === "localAccount"
        ? {
            kind: child.target.kind,
            accountIndex: child.target.accountIndex,
            address: child.target.address,
            label: child.target.label,
            chainSnapshotStatus: child.target.chainSnapshotStatus,
          }
        : {
            kind: child.target.kind,
            address: child.target.address,
            label: child.target.label ?? null,
            notes: child.target.notes ?? null,
          },
    tokenContract: child.tokenContract,
    amountRaw: child.amountRaw,
    decimals: child.decimals,
    tokenMetadataSource: child.tokenMetadataSource,
    sourceTokenSnapshot: child.sourceTokenSnapshot,
    nonce: child.nonce,
    gasLimit: child.gasLimit,
    maxFeePerGas: child.maxFeePerGas,
    maxPriorityFeePerGas: child.maxPriorityFeePerGas,
    status: child.status,
    warnings: child.warnings,
    errors: child.errors,
  };
}

function computeSummary(
  children: Erc20BatchChild[],
  distributionParent: Erc20BatchDistributionParent | null,
): Erc20BatchSummary {
  const totals = children.reduce(
    (acc, child) => {
      const amount = BigInt(child.amountRaw);
      acc.childCount += 1;
      if (child.status === "notSubmitted") {
        acc.plannedCount += 1;
        acc.totalPlannedAmountRaw += amount;
        if (!distributionParent) {
          const gasLimit = BigInt(child.gasLimit);
          const maxFeePerGas = BigInt(child.maxFeePerGas);
          acc.totalGasLimit += gasLimit;
          acc.maxGasCostWei += gasLimit * maxFeePerGas;
        }
      }
      if (child.status === "skipped") acc.skippedCount += 1;
      if (child.status === "blocked") acc.blockedCount += 1;
      if (submittedStatuses.has(child.status)) acc.submittedCount += 1;
      if (child.status === "pending") acc.pendingCount += 1;
      if (child.status === "confirmed") acc.confirmedCount += 1;
      if (child.status === "failed" || child.status === "dropped") acc.failedCount += 1;
      acc.warningCount += child.warnings.length;
      acc.errorCount += child.errors.length;
      return acc;
    },
    {
      childCount: 0,
      plannedCount: 0,
      skippedCount: 0,
      blockedCount: 0,
      submittedCount: 0,
      pendingCount: 0,
      confirmedCount: 0,
      failedCount: 0,
      totalPlannedAmountRaw: 0n,
      totalGasLimit: 0n,
      maxGasCostWei: 0n,
      warningCount: 0,
      errorCount: 0,
    },
  );

  if (distributionParent) {
    totals.warningCount += distributionParent.warnings.length;
    totals.errorCount += distributionParent.errors.length;
    if (distributionParent.errors.length === 0 && children.some((child) => child.status === "notSubmitted")) {
      const gasLimit = BigInt(distributionParent.gasLimit);
      const maxFeePerGas = BigInt(distributionParent.maxFeePerGas);
      totals.totalGasLimit = gasLimit;
      totals.maxGasCostWei = gasLimit * maxFeePerGas;
    }
  }

  return {
    ...totals,
    totalPlannedAmountRaw: totals.totalPlannedAmountRaw.toString(),
    totalGasLimit: totals.totalGasLimit.toString(),
    maxGasCostWei: totals.maxGasCostWei.toString(),
  };
}

function computePlanFreezeKey(plan: Omit<Erc20BatchPlan, "freezeKey" | "summary" | "status">) {
  return ethersId(
    stableStringify({
      batchId: plan.batchId,
      batchKind: plan.batchKind,
      assetKind: plan.assetKind,
      chainId: plan.chainId,
      orchestrationFrozenKey: plan.orchestrationFrozenKey,
      token: plan.token,
      sourceRefs: plan.sources.map((source) => ({
        kind: source.kind,
        accountIndex: source.accountIndex,
        address: source.address,
        chainSnapshotStatus: source.chainSnapshotStatus,
      })),
      targetRefs: plan.targets.map((target) =>
        target.kind === "localAccount"
          ? {
              kind: target.kind,
              accountIndex: target.accountIndex,
              address: target.address,
              chainSnapshotStatus: target.chainSnapshotStatus,
            }
          : {
              kind: target.kind,
              address: target.address,
              label: target.label ?? null,
              notes: target.notes ?? null,
            },
      ),
      distributionParent: plan.distributionParent
        ? {
            source: {
              kind: plan.distributionParent.source.kind,
              accountIndex: plan.distributionParent.source.accountIndex,
              address: plan.distributionParent.source.address,
              chainSnapshotStatus: plan.distributionParent.source.chainSnapshotStatus,
            },
            distributionContract: plan.distributionParent.distributionContract,
            selector: plan.distributionParent.selector,
            methodName: plan.distributionParent.methodName,
            tokenContract: plan.distributionParent.tokenContract,
            decimals: plan.distributionParent.decimals,
            tokenSymbol: plan.distributionParent.tokenSymbol,
            tokenName: plan.distributionParent.tokenName,
            tokenMetadataSource: plan.distributionParent.tokenMetadataSource,
            sourceTokenSnapshot: plan.distributionParent.sourceTokenSnapshot,
            allowance: plan.distributionParent.allowance,
            recipients: plan.distributionParent.recipients.map((recipient) => ({
              childId: recipient.childId,
              targetKind: recipient.target.kind,
              targetAddress: recipient.targetAddress,
              amountRaw: recipient.amountRaw,
            })),
            totalAmountRaw: plan.distributionParent.totalAmountRaw,
            nativeValueWei: plan.distributionParent.nativeValueWei,
            nonce: plan.distributionParent.nonce,
            gasLimit: plan.distributionParent.gasLimit,
            maxFeePerGas: plan.distributionParent.maxFeePerGas,
            maxPriorityFeePerGas: plan.distributionParent.maxPriorityFeePerGas,
            warnings: plan.distributionParent.warnings,
            errors: plan.distributionParent.errors,
          }
        : null,
      children: plan.children.map(childPayload),
      childCount: plan.children.length,
      childOrdering: plan.children.map((child) => child.childId),
    }),
  );
}

function makeChild(input: {
  batchId: string;
  index: number;
  batchKind: Erc20BatchKind;
  chainId: number;
  source: LocalAccountReference;
  target: Erc20BatchTargetReference;
  token: Erc20BatchTokenMetadata;
  sourceTokenSnapshot: Erc20BatchSnapshotRef;
  amountRaw: bigint;
  nonce: number | null;
  fees: Erc20BatchFeeInput;
  status: Erc20BatchChildStatus;
  warnings?: string[];
  errors?: string[];
}): Erc20BatchChild {
  const id = childId(input.batchId, input.index);
  const to = targetAddress(input.target);
  const tokenReady =
    input.token.decimals !== null && input.token.source !== null && input.token.status !== "missing";
  return {
    childId: id,
    batchId: input.batchId,
    batchKind: input.batchKind,
    assetKind: "erc20",
    chainId: input.chainId,
    source: input.source,
    target: input.target,
    targetAddress: to,
    tokenContract: input.token.tokenContract,
    amountRaw: input.amountRaw.toString(),
    decimals: input.token.decimals,
    tokenSymbol: input.token.symbol,
    tokenName: input.token.name,
    tokenMetadataSource: input.token.source,
    sourceTokenSnapshot: input.sourceTokenSnapshot,
    nonce: input.nonce,
    gasLimit: input.fees.gasLimit,
    maxFeePerGas: input.fees.maxFeePerGas,
    maxPriorityFeePerGas: input.fees.maxPriorityFeePerGas,
    status: input.status,
    intentSnapshot: tokenReady
      ? {
          chainId: input.chainId,
          accountIndex: input.source.accountIndex,
          from: input.source.address,
          tokenContract: input.token.tokenContract,
          recipient: to,
          amountRaw: input.amountRaw.toString(),
          decimals: input.token.decimals!,
          tokenSymbol: input.token.symbol,
          tokenName: input.token.name,
          tokenMetadataSource: input.token.source!,
          nonce: input.nonce,
          gasLimit: input.fees.gasLimit,
          maxFeePerGas: input.fees.maxFeePerGas,
          maxPriorityFeePerGas: input.fees.maxPriorityFeePerGas,
        }
      : null,
    warnings: input.warnings ?? [],
    errors: input.errors ?? [],
  };
}

function snapshotBlocksTransfer(snapshot: Erc20BatchSnapshotRef, errors: string[], warnings: string[]) {
  switch (snapshot.balanceStatus) {
    case "ok":
    case "zero":
      return false;
    case "missing":
      errors.push("Source ERC-20 balance snapshot is missing; missing is not treated as zero.");
      return true;
    case "stale":
      errors.push("Source ERC-20 balance snapshot is stale; rescan before batching.");
      return true;
    default:
      errors.push(`Source ERC-20 balance snapshot is ${snapshot.balanceStatus}; rescan before batching.`);
      if (snapshot.lastErrorSummary) warnings.push(snapshot.lastErrorSummary);
      return true;
  }
}

function metadataErrors(token: Erc20BatchTokenMetadata | null) {
  if (!token) return ["Choose an ERC-20 token from the watchlist."];
  if (token.decimals === null) return [`Token decimals are unavailable (${token.status}); rescan or confirm metadata.`];
  if (token.status === "missing") return ["Token metadata is missing from the watchlist resolved metadata."];
  if (token.status === "missingDecimals" || token.status === "malformed" || token.status === "sourceConflict") {
    return [`Token metadata status ${token.status} blocks ERC-20 batching.`];
  }
  return [];
}

function buildDistributionChildren(
  input: Erc20BatchPlanInput,
  batchId: string,
  chainId: number,
  token: Erc20BatchTokenMetadata,
  gasLimit: bigint,
  maxFeePerGas: bigint,
) {
  const source = input.orchestration.sourceAccounts[0] ?? null;
  const targets = targetRefs(input.orchestration);
  const snapshots = snapshotMap(input.accountSnapshots);
  const children: Erc20BatchChild[] = [];
  if (!source) return { children, parent: null };

  const sourceSnapshot = snapshots.get(addressKey(source.address));
  const sourceTokenSnapshot = tokenSnapshotRef(input.tokenWatchlistState, chainId, token.tokenContract, source.address);
  const parentNonce = nonceWithLocalPending(sourceSnapshot?.nonce, input, chainId, source);
  const nativeBalance = sourceSnapshot?.nativeBalanceWei ?? null;
  const parentErrors = metadataErrors(token);
  const parentSummaryErrors: string[] = [];
  const parentWarnings: string[] = [];
  if (parentNonce === null) parentErrors.push("Source nonce snapshot is missing.");
  if (nativeBalance === null) parentErrors.push("Source native balance snapshot is missing.");
  if (nativeBalance !== null && nativeBalance < gasLimit * maxFeePerGas) {
    parentErrors.push("Source native balance cannot cover distribution parent maximum gas reserve.");
  }
  snapshotBlocksTransfer(sourceTokenSnapshot, parentErrors, parentWarnings);

  let totalAmountRaw = 0n;
  const recipientAddressCounts = targets.reduce((counts, target) => {
    const key = addressKey(target.address);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const duplicateRecipientAddresses = [...recipientAddressCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([address]) => address);
  if (duplicateRecipientAddresses.length > 0) {
    parentSummaryErrors.push(
      `Duplicate recipient address is present: ${duplicateRecipientAddresses.join(", ")}.`,
    );
  }
  targets.forEach((target, index) => {
    const errors = [...parentErrors];
    const warnings: string[] = [];
    const field = `amountRaw for target ${index + 1}`;
    const amountRaw = parseUnsignedRaw(
      input.distributionAmountsRaw?.[erc20BatchTargetAmountKey(target)] ??
        input.defaultDistributionAmountRaw ??
        "0",
      field,
      errors,
    ) ?? 0n;
    totalAmountRaw += amountRaw;
    if (amountRaw === 0n) errors.push("Distribution recipient amountRaw must be greater than zero.");
    if (addressKey(source.address) === addressKey(target.address)) {
      errors.push("Source and target are the same account/address.");
    }
    if ((recipientAddressCounts.get(addressKey(target.address)) ?? 0) > 1) {
      errors.push(`Duplicate recipient address is present: ${target.address}.`);
    }
    const status: Erc20BatchChildStatus = errors.length > 0 ? "blocked" : "notSubmitted";
    children.push(
      makeChild({
        batchId,
        index,
        batchKind: "distribute",
        chainId,
        source,
        target,
        token,
        sourceTokenSnapshot,
        amountRaw,
        nonce: null,
        fees: input.fees,
        status,
        warnings,
        errors,
      }),
    );
  });

  if (
    (sourceTokenSnapshot.balanceStatus === "ok" || sourceTokenSnapshot.balanceStatus === "zero") &&
    sourceTokenSnapshot.balanceRaw !== null &&
    BigInt(sourceTokenSnapshot.balanceRaw) < totalAmountRaw
  ) {
    parentErrors.push("Source ERC-20 balance snapshot cannot cover total distribution amount.");
    for (const child of children) {
      child.errors.push("Source ERC-20 balance snapshot cannot cover total distribution amount.");
      child.status = "blocked";
    }
  }

  const allowance = input.allowance ?? { status: "unknown" as const, allowanceRaw: null };
  if (allowance.status === "insufficient") {
    parentErrors.push("Disperse allowance is insufficient for the total ERC-20 distribution amount.");
  } else if (allowance.status === "readFailed") {
    parentErrors.push("Disperse allowance could not be read; retry allowance preflight before submitting.");
  } else if (allowance.status === "ok" && allowance.allowanceRaw !== null) {
    const allowanceRaw = parseUnsignedRaw(allowance.allowanceRaw, "allowanceRaw", parentErrors);
    if (allowanceRaw !== null && allowanceRaw < totalAmountRaw) {
      parentErrors.push("Disperse allowance is below the total ERC-20 distribution amount.");
    }
  } else if (allowance.status === "unknown") {
    parentWarnings.push("Disperse allowance has not been preflighted in the UI; Rust will check allowance before broadcast.");
  }

  if (parentErrors.length > 0) {
    for (const child of children) {
      child.errors = [...new Set([...child.errors, ...parentErrors])];
      child.status = "blocked";
    }
  }

  const parent: Erc20BatchDistributionParent | null =
    token.decimals !== null && token.source !== null
      ? {
          batchId,
          batchKind: "distribute",
          assetKind: "erc20",
          chainId,
          source,
          distributionContract: DEFAULT_ERC20_DISTRIBUTION_CONTRACT,
          selector: DISPERSE_TOKEN_SELECTOR,
          methodName: DISPERSE_TOKEN_METHOD,
          tokenContract: token.tokenContract,
          decimals: token.decimals,
          tokenSymbol: token.symbol,
          tokenName: token.name,
          tokenMetadataSource: token.source,
          sourceTokenSnapshot,
          allowance,
          recipients: children.map((child) => ({
            childId: child.childId,
            target: child.target,
            targetAddress: child.targetAddress,
            amountRaw: child.amountRaw,
          })),
          totalAmountRaw: totalAmountRaw.toString(),
          nativeValueWei: "0",
          nonce: parentNonce,
          gasLimit: input.fees.gasLimit,
          maxFeePerGas: input.fees.maxFeePerGas,
          maxPriorityFeePerGas: input.fees.maxPriorityFeePerGas,
          warnings: parentWarnings,
          errors: [...parentErrors, ...parentSummaryErrors],
        }
      : null;
  return { children, parent };
}

function buildCollectionChildren(
  input: Erc20BatchPlanInput,
  batchId: string,
  chainId: number,
  token: Erc20BatchTokenMetadata,
  gasLimit: bigint,
  maxFeePerGas: bigint,
) {
  const target = targetRefs(input.orchestration)[0] ?? null;
  const snapshots = snapshotMap(input.accountSnapshots);
  if (!target) return [];

  return input.orchestration.sourceAccounts.map((source, index) => {
    const sourceSnapshot = snapshots.get(addressKey(source.address));
    const sourceTokenSnapshot = tokenSnapshotRef(input.tokenWatchlistState, chainId, token.tokenContract, source.address);
    const errors = metadataErrors(token);
    const warnings: string[] = [];
    const nativeBalance = sourceSnapshot?.nativeBalanceWei ?? null;
    const nonce = nonceWithLocalPending(sourceSnapshot?.nonce, input, chainId, source);
    const reserve = gasLimit * maxFeePerGas;
    let amountRaw = 0n;
    let status: Erc20BatchChildStatus = "notSubmitted";

    if (nonce === null) errors.push("Source nonce snapshot is missing.");
    if (nativeBalance === null) {
      errors.push("Source native balance snapshot is missing.");
    } else if (nativeBalance < reserve) {
      errors.push("Source native balance cannot cover ERC-20 transfer maximum gas reserve.");
    }
    const snapshotBlocked = snapshotBlocksTransfer(sourceTokenSnapshot, errors, warnings);
    if (!snapshotBlocked) {
      amountRaw = BigInt(sourceTokenSnapshot.balanceRaw ?? "0");
      if (sourceTokenSnapshot.balanceStatus === "zero" || amountRaw === 0n) {
        status = "skipped";
        warnings.push("Source token balance snapshot is zero; collection child is skipped.");
      }
    }
    if (addressKey(source.address) === addressKey(target.address)) {
      status = "skipped";
      warnings.push("Collection source is the same as the target; child is skipped.");
      amountRaw = 0n;
    }
    if (errors.length > 0) status = "blocked";

    return makeChild({
      batchId,
      index,
      batchKind: "collect",
      chainId,
      source,
      target,
      token,
      sourceTokenSnapshot,
      amountRaw,
      nonce,
      fees: input.fees,
      status,
      warnings,
      errors,
    });
  });
}

export function buildErc20BatchPlan(input: Erc20BatchPlanInput): Erc20BatchPlan {
  const chainId = numericChainId(input.chainId);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const batchId = input.batchId ?? makeBatchId(chainId, createdAt);
  const warnings: string[] = [];
  const errors: string[] = [];
  const targets = targetRefs(input.orchestration);
  const sources = input.orchestration.sourceAccounts;
  const token = metadataFor(input.tokenWatchlistState, chainId, input.tokenContract);
  const gasLimit = parseUnsignedRaw(input.fees.gasLimit, "gasLimit", errors) ?? 0n;
  const maxFeePerGas = parseUnsignedRaw(input.fees.maxFeePerGas, "maxFeePerGas", errors) ?? 0n;
  parseUnsignedRaw(input.fees.maxPriorityFeePerGas, "maxPriorityFeePerGas", errors);

  if (sources.length === 0) errors.push("Select at least one source account.");
  if (targets.length === 0) errors.push("Select at least one target.");
  if (input.batchKind === "distribute" && sources.length > 1) {
    errors.push("ERC-20 contract distribution is blocked for multiple sources in this release.");
  }
  if (input.batchKind === "collect" && targets.length > 1) {
    errors.push("ERC-20 collection supports exactly one target in this release.");
  }
  errors.push(...metadataErrors(token));

  const canBuildChildren = errors.length === 0 && token !== null;
  const distribution =
    canBuildChildren && input.batchKind === "distribute"
      ? buildDistributionChildren(input, batchId, chainId, token, gasLimit, maxFeePerGas)
      : { children: [] as Erc20BatchChild[], parent: null as Erc20BatchDistributionParent | null };
  const children =
    canBuildChildren && input.batchKind === "collect"
      ? buildCollectionChildren(input, batchId, chainId, token, gasLimit, maxFeePerGas)
      : distribution.children;
  const distributionParent = input.batchKind === "distribute" ? distribution.parent : null;
  const summary = computeSummary(children, distributionParent);
  const basePlan = {
    batchId,
    batchKind: input.batchKind,
    assetKind: "erc20" as const,
    chainId,
    createdAt,
    frozenAt: null,
    orchestrationFrozenKey: "frozenKey" in input.orchestration ? input.orchestration.frozenKey : null,
    token,
    sources,
    targets,
    distributionParent,
    children,
    warnings,
    errors,
  };
  const allErrors = errors.length + summary.errorCount;
  const status: Erc20BatchPlanStatus =
    children.length === 0 && allErrors === 0 ? "empty" : allErrors > 0 ? "blocked" : "ready";
  return {
    ...basePlan,
    freezeKey: computePlanFreezeKey(basePlan),
    summary,
    status,
  };
}

export function computeErc20BatchFreezeKey(plan: Erc20BatchPlan) {
  const basePlan = {
    batchId: plan.batchId,
    batchKind: plan.batchKind,
    assetKind: plan.assetKind,
    chainId: plan.chainId,
    createdAt: plan.createdAt,
    frozenAt: null,
    orchestrationFrozenKey: plan.orchestrationFrozenKey,
    token: plan.token,
    sources: plan.sources,
    targets: plan.targets,
    distributionParent: plan.distributionParent,
    children: plan.children,
    warnings: plan.warnings,
    errors: plan.errors,
  };
  return computePlanFreezeKey(basePlan);
}

export function freezeErc20BatchPlan(
  plan: Erc20BatchPlan,
  frozenAt = new Date().toISOString(),
): FrozenErc20BatchPlan {
  return {
    ...plan,
    frozenAt,
    freezeKey: computeErc20BatchFreezeKey(plan),
  };
}

export function isFrozenErc20BatchPlanValid(
  frozenPlan: FrozenErc20BatchPlan | null,
  currentPlan: Erc20BatchPlan,
) {
  return Boolean(frozenPlan && frozenPlan.freezeKey === computeErc20BatchFreezeKey(currentPlan));
}
