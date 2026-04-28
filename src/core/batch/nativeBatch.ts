import { id as ethersId } from "ethers";
import type {
  ExternalAddressReference,
  FrozenOrchestrationSummary,
  LocalAccountReference,
  OrchestrationDraft,
} from "../accountOrchestration/selection";
import { nextNonceWithLocalPending, type PendingNonceHistoryRecord } from "../history/reconciler";

export type NativeBatchKind = "distribute" | "collect";
export type NativeBatchAssetKind = "native";
export type NativeBatchChildStatus =
  | "notSubmitted"
  | "skipped"
  | "blocked"
  | "pending"
  | "confirmed"
  | "failed"
  | "replaced"
  | "cancelled"
  | "dropped";
export type NativeBatchTargetReference = LocalAccountReference | ExternalAddressReference;
export type NativeBatchPlanStatus = "ready" | "blocked" | "empty";

export const DEFAULT_NATIVE_DISTRIBUTION_CONTRACT =
  "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3";
export const DISPERSE_ETHER_SELECTOR = "0xe63d38ed";
export const DISPERSE_ETHER_METHOD = "disperseEther(address[],uint256[])";

export interface NativeBatchAccountSnapshot {
  address: string;
  nativeBalanceWei: bigint | null;
  nonce: number | null;
}

export interface NativeBatchFeeInput {
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

export interface NativeBatchPlanInput {
  batchKind: NativeBatchKind;
  chainId: bigint | number;
  orchestration: OrchestrationDraft | FrozenOrchestrationSummary;
  accountSnapshots: NativeBatchAccountSnapshot[];
  localPendingHistory?: PendingNonceHistoryRecord[];
  amountWei: string;
  fees: NativeBatchFeeInput;
  batchId?: string;
  createdAt?: string;
}

export interface NativeBatchIntentSnapshot {
  chainId: number;
  accountIndex: number;
  from: string;
  to: string;
  valueWei: string;
  nonce: number | null;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

export interface NativeBatchChild {
  childId: string;
  batchId: string;
  batchKind: NativeBatchKind;
  assetKind: NativeBatchAssetKind;
  chainId: number;
  source: LocalAccountReference;
  target: NativeBatchTargetReference;
  targetAddress: string;
  amountWei: string;
  nonce: number | null;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  status: NativeBatchChildStatus;
  intentSnapshot: NativeBatchIntentSnapshot;
  warnings: string[];
  errors: string[];
}

export interface NativeBatchDistributionRecipient {
  childId: string;
  target: NativeBatchTargetReference;
  targetAddress: string;
  amountWei: string;
}

export interface NativeBatchDistributionParent {
  batchId: string;
  batchKind: "distribute";
  assetKind: NativeBatchAssetKind;
  chainId: number;
  source: LocalAccountReference;
  distributionContract: string;
  selector: string;
  methodName: string;
  recipients: NativeBatchDistributionRecipient[];
  totalValueWei: string;
  nonce: number | null;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  warnings: string[];
  errors: string[];
}

export interface NativeBatchSummary {
  childCount: number;
  plannedCount: number;
  skippedCount: number;
  blockedCount: number;
  submittedCount: number;
  pendingCount: number;
  confirmedCount: number;
  failedCount: number;
  totalPlannedAmountWei: string;
  totalGasLimit: string;
  maxGasCostWei: string;
  warningCount: number;
  errorCount: number;
}

export interface NativeBatchPlan {
  batchId: string;
  batchKind: NativeBatchKind;
  assetKind: NativeBatchAssetKind;
  chainId: number;
  createdAt: string;
  frozenAt: string | null;
  freezeKey: string;
  orchestrationFrozenKey: string | null;
  sources: LocalAccountReference[];
  targets: NativeBatchTargetReference[];
  distributionParent: NativeBatchDistributionParent | null;
  children: NativeBatchChild[];
  summary: NativeBatchSummary;
  warnings: string[];
  errors: string[];
  status: NativeBatchPlanStatus;
}

export interface FrozenNativeBatchPlan extends NativeBatchPlan {
  frozenAt: string;
}

const submittedStatuses = new Set<NativeBatchChildStatus>([
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

function targetAddress(target: NativeBatchTargetReference) {
  return target.address;
}

function targetKey(target: NativeBatchTargetReference) {
  return `${target.kind}:${addressKey(target.address)}`;
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

function parseUnsignedWei(value: string, field: string, errors: string[]) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    errors.push(`${field} must be a non-negative integer wei value.`);
    return null;
  }
  return BigInt(trimmed);
}

function makeBatchId(chainId: number, createdAt: string) {
  return `native-batch-${chainId}-${ethersId(`${chainId}:${createdAt}`).slice(2, 14)}`;
}

function snapshotMap(snapshots: NativeBatchAccountSnapshot[]) {
  return new Map(snapshots.map((snapshot) => [addressKey(snapshot.address), snapshot]));
}

function nonceWithLocalPending(
  snapshotNonce: number | null | undefined,
  input: NativeBatchPlanInput,
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

function targetRefs(orchestration: OrchestrationDraft | FrozenOrchestrationSummary) {
  return [...orchestration.localTargets, ...orchestration.externalTargets];
}

function childId(batchId: string, index: number) {
  return `${batchId}:child-${String(index + 1).padStart(4, "0")}`;
}

function childPayload(child: NativeBatchChild) {
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
    amountWei: child.amountWei,
    nonce: child.nonce,
    gasLimit: child.gasLimit,
    maxFeePerGas: child.maxFeePerGas,
    maxPriorityFeePerGas: child.maxPriorityFeePerGas,
    status: child.status,
  };
}

function computeSummary(
  children: NativeBatchChild[],
  distributionParent: NativeBatchDistributionParent | null,
): NativeBatchSummary {
  const totals = children.reduce(
    (acc, child) => {
      const amount = BigInt(child.amountWei);
      acc.childCount += 1;
      if (child.status === "notSubmitted") {
        acc.plannedCount += 1;
        acc.totalPlannedAmountWei += amount;
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
      totalPlannedAmountWei: 0n,
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
    totalPlannedAmountWei: totals.totalPlannedAmountWei.toString(),
    totalGasLimit: totals.totalGasLimit.toString(),
    maxGasCostWei: totals.maxGasCostWei.toString(),
  };
}

function computePlanFreezeKey(plan: Omit<NativeBatchPlan, "freezeKey" | "summary" | "status">) {
  return ethersId(
    stableStringify({
      batchId: plan.batchId,
      batchKind: plan.batchKind,
      assetKind: plan.assetKind,
      chainId: plan.chainId,
      orchestrationFrozenKey: plan.orchestrationFrozenKey,
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
            batchId: plan.distributionParent.batchId,
            chainId: plan.distributionParent.chainId,
            source: {
              kind: plan.distributionParent.source.kind,
              accountIndex: plan.distributionParent.source.accountIndex,
              address: plan.distributionParent.source.address,
              chainSnapshotStatus: plan.distributionParent.source.chainSnapshotStatus,
            },
            distributionContract: plan.distributionParent.distributionContract,
            selector: plan.distributionParent.selector,
            methodName: plan.distributionParent.methodName,
            recipients: plan.distributionParent.recipients.map((recipient) => ({
              childId: recipient.childId,
              targetAddress: recipient.targetAddress,
              amountWei: recipient.amountWei,
            })),
            totalValueWei: plan.distributionParent.totalValueWei,
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
  batchKind: NativeBatchKind;
  chainId: number;
  source: LocalAccountReference;
  target: NativeBatchTargetReference;
  amountWei: bigint;
  nonce: number | null;
  fees: NativeBatchFeeInput;
  status: NativeBatchChildStatus;
  warnings?: string[];
  errors?: string[];
}): NativeBatchChild {
  const id = childId(input.batchId, input.index);
  const to = targetAddress(input.target);
  return {
    childId: id,
    batchId: input.batchId,
    batchKind: input.batchKind,
    assetKind: "native",
    chainId: input.chainId,
    source: input.source,
    target: input.target,
    targetAddress: to,
    amountWei: input.amountWei.toString(),
    nonce: input.nonce,
    gasLimit: input.fees.gasLimit,
    maxFeePerGas: input.fees.maxFeePerGas,
    maxPriorityFeePerGas: input.fees.maxPriorityFeePerGas,
    status: input.status,
    intentSnapshot: {
      chainId: input.chainId,
      accountIndex: input.source.accountIndex,
      from: input.source.address,
      to,
      valueWei: input.amountWei.toString(),
      nonce: input.nonce,
      gasLimit: input.fees.gasLimit,
      maxFeePerGas: input.fees.maxFeePerGas,
      maxPriorityFeePerGas: input.fees.maxPriorityFeePerGas,
    },
    warnings: input.warnings ?? [],
    errors: input.errors ?? [],
  };
}

function addDuplicateTargetWarnings(targets: NativeBatchTargetReference[], warnings: string[]) {
  const seen = new Set<string>();
  for (const target of targets) {
    const key = targetKey(target);
    if (seen.has(key)) warnings.push(`Duplicate target is present: ${target.kind} ${target.address}.`);
    seen.add(key);
  }
}

function buildDistributionChildren(
  input: NativeBatchPlanInput,
  batchId: string,
  chainId: number,
  amountWei: bigint,
  gasLimit: bigint,
  maxFeePerGas: bigint,
) {
  const source = input.orchestration.sourceAccounts[0] ?? null;
  const targets = targetRefs(input.orchestration);
  const snapshots = snapshotMap(input.accountSnapshots);
  const children: NativeBatchChild[] = [];
  if (!source) return { children, parent: null };
  const sourceSnapshot = snapshots.get(addressKey(source.address));
  const parentNonce = nonceWithLocalPending(sourceSnapshot?.nonce, input, chainId, source);
  const spendable = sourceSnapshot?.nativeBalanceWei ?? null;
  const totalValueWei = amountWei * BigInt(targets.length);
  const parentErrors: string[] = [];
  const parentWarnings: string[] = [];

  if (amountWei === 0n) parentErrors.push("Distribution amount must be greater than zero.");
  if (parentNonce === null) parentErrors.push("Source nonce snapshot is missing.");
  if (spendable === null) parentErrors.push("Source native balance snapshot is missing.");
  if (spendable !== null && spendable < totalValueWei + gasLimit * maxFeePerGas) {
    parentErrors.push("Source balance cannot cover total distribution value plus maximum gas reserve.");
  }

  targets.forEach((target, index) => {
    const childErrors: string[] = [];
    const childWarnings: string[] = [];
    let status: NativeBatchChildStatus = "notSubmitted";
    childErrors.push(...parentErrors);
    if (addressKey(source.address) === addressKey(target.address)) {
      childErrors.push("Source and target are the same account/address.");
    }
    if (childErrors.length > 0) status = "blocked";
    children.push(
      makeChild({
        batchId,
        index,
        batchKind: "distribute",
        chainId,
        source,
        target,
        amountWei,
        nonce: null,
        fees: input.fees,
        status,
        warnings: childWarnings,
        errors: childErrors,
      }),
    );
  });

  const parent: NativeBatchDistributionParent = {
    batchId,
    batchKind: "distribute",
    assetKind: "native",
    chainId,
    source,
    distributionContract: DEFAULT_NATIVE_DISTRIBUTION_CONTRACT,
    selector: DISPERSE_ETHER_SELECTOR,
    methodName: DISPERSE_ETHER_METHOD,
    recipients: children.map((child) => ({
      childId: child.childId,
      target: child.target,
      targetAddress: child.targetAddress,
      amountWei: child.amountWei,
    })),
    totalValueWei: totalValueWei.toString(),
    nonce: parentNonce,
    gasLimit: input.fees.gasLimit,
    maxFeePerGas: input.fees.maxFeePerGas,
    maxPriorityFeePerGas: input.fees.maxPriorityFeePerGas,
    warnings: parentWarnings,
    errors: parentErrors,
  };
  return { children, parent };
}

function buildCollectionChildren(
  input: NativeBatchPlanInput,
  batchId: string,
  chainId: number,
  gasLimit: bigint,
  maxFeePerGas: bigint,
) {
  const target = targetRefs(input.orchestration)[0] ?? null;
  const snapshots = snapshotMap(input.accountSnapshots);
  if (!target) return [];

  return input.orchestration.sourceAccounts.map((source, index) => {
    const sourceSnapshot = snapshots.get(addressKey(source.address));
    const errors: string[] = [];
    const warnings: string[] = [];
    const reserve = gasLimit * maxFeePerGas;
    const balance = sourceSnapshot?.nativeBalanceWei ?? null;
    const nonce = nonceWithLocalPending(sourceSnapshot?.nonce, input, chainId, source);
    let amountWei = 0n;
    let status: NativeBatchChildStatus = "notSubmitted";

    if (nonce === null) errors.push("Source nonce snapshot is missing.");
    if (balance === null) {
      errors.push("Source native balance snapshot is missing.");
    } else if (balance <= reserve) {
      status = "skipped";
      warnings.push("Source balance does not exceed the required maximum gas reserve.");
    } else {
      amountWei = balance - reserve;
    }
    if (addressKey(source.address) === addressKey(target.address)) {
      status = "skipped";
      warnings.push("Collection source is the same as the target; child is skipped.");
      amountWei = 0n;
    }
    if (errors.length > 0) status = "blocked";

    return makeChild({
      batchId,
      index,
      batchKind: "collect",
      chainId,
      source,
      target,
      amountWei,
      nonce,
      fees: input.fees,
      status,
      warnings,
      errors,
    });
  });
}

export function buildNativeBatchPlan(input: NativeBatchPlanInput): NativeBatchPlan {
  const chainId = numericChainId(input.chainId);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const batchId = input.batchId ?? makeBatchId(chainId, createdAt);
  const warnings: string[] = [];
  const errors: string[] = [];
  const targets = targetRefs(input.orchestration);
  const sources = input.orchestration.sourceAccounts;
  const amountWei = parseUnsignedWei(input.amountWei, "amountWei", errors) ?? 0n;
  const gasLimit = parseUnsignedWei(input.fees.gasLimit, "gasLimit", errors) ?? 0n;
  const maxFeePerGas = parseUnsignedWei(input.fees.maxFeePerGas, "maxFeePerGas", errors) ?? 0n;
  parseUnsignedWei(input.fees.maxPriorityFeePerGas, "maxPriorityFeePerGas", errors);
  addDuplicateTargetWarnings(targets, warnings);

  if (sources.length === 0) errors.push("Select at least one source account.");
  if (targets.length === 0) errors.push("Select at least one target.");
  if (input.batchKind === "distribute" && sources.length > 1) {
    errors.push(
      "Native contract distribution is blocked for multiple sources in this release. Use one source, or split into one batch per payer.",
    );
  }
  if (input.batchKind === "collect" && targets.length > 1) {
    errors.push("Native collection supports exactly one target in this release.");
  }

  const distribution =
    errors.length > 0 || input.batchKind !== "distribute"
      ? { children: [] as NativeBatchChild[], parent: null as NativeBatchDistributionParent | null }
      : buildDistributionChildren(input, batchId, chainId, amountWei, gasLimit, maxFeePerGas);
  const children =
    errors.length > 0
      ? []
      : input.batchKind === "distribute"
        ? distribution.children
        : buildCollectionChildren(input, batchId, chainId, gasLimit, maxFeePerGas);
  const distributionParent = input.batchKind === "distribute" ? distribution.parent : null;
  const summary = computeSummary(children, distributionParent);
  const basePlan = {
    batchId,
    batchKind: input.batchKind,
    assetKind: "native" as const,
    chainId,
    createdAt,
    frozenAt: null,
    orchestrationFrozenKey: "frozenKey" in input.orchestration ? input.orchestration.frozenKey : null,
    sources,
    targets,
    distributionParent,
    children,
    warnings,
    errors,
  };
  const allErrors = errors.length + summary.errorCount;
  const status: NativeBatchPlanStatus =
    children.length === 0 && allErrors === 0 ? "empty" : allErrors > 0 ? "blocked" : "ready";
  return {
    ...basePlan,
    freezeKey: computePlanFreezeKey(basePlan),
    summary,
    status,
  };
}

export function freezeNativeBatchPlan(
  plan: NativeBatchPlan,
  frozenAt = new Date().toISOString(),
): FrozenNativeBatchPlan {
  return {
    ...plan,
    frozenAt,
    freezeKey: computeNativeBatchFreezeKey(plan),
  };
}

export function computeNativeBatchFreezeKey(plan: NativeBatchPlan) {
  const basePlan = {
    batchId: plan.batchId,
    batchKind: plan.batchKind,
    assetKind: plan.assetKind,
    chainId: plan.chainId,
    createdAt: plan.createdAt,
    frozenAt: null,
    orchestrationFrozenKey: plan.orchestrationFrozenKey,
    sources: plan.sources,
    targets: plan.targets,
    distributionParent: plan.distributionParent,
    children: plan.children,
    warnings: plan.warnings,
    errors: plan.errors,
  };
  return computePlanFreezeKey(basePlan);
}

export function isFrozenNativeBatchPlanValid(
  frozenPlan: FrozenNativeBatchPlan | null,
  currentPlan: NativeBatchPlan,
) {
  return Boolean(frozenPlan && frozenPlan.freezeKey === computeNativeBatchFreezeKey(currentPlan));
}
