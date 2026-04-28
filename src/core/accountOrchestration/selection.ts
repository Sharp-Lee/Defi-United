import { getAddress, id as ethersId, isAddress } from "ethers";
import type {
  AccountRecord,
  BalanceStatus,
  Erc20BalanceSnapshotRecord,
  TokenWatchlistState,
} from "../../lib/tauri";
import type { AccountChainState } from "../../lib/rpc";

export type AccountModel = AccountRecord & AccountChainState;
export type NativeAvailability = "present" | "missing";
export type NonceAvailability = "present" | "missing";
export type Erc20SnapshotBucket = "ok" | "zero" | "stale" | "failure" | "missing";

export interface ChainSnapshotStatus {
  chainId: number;
  nativeBalance: NativeAvailability;
  nonce: NonceAvailability;
  lastSyncError: string | null;
}

export interface LocalAccountReference {
  kind: "localAccount";
  accountIndex: number;
  address: string;
  label: string;
  chainSnapshotStatus: ChainSnapshotStatus;
}

export interface ExternalAddressReference {
  kind: "externalAddress";
  address: string;
  label?: string | null;
  notes?: string | null;
}

export interface ExternalAddressInput {
  address: string;
  label?: string | null;
  notes?: string | null;
}

export interface ExternalAddressValidationResult {
  ok: boolean;
  target?: ExternalAddressReference;
  error?: string;
}

export interface Erc20SnapshotCounts {
  total: number;
  ok: number;
  zero: number;
  stale: number;
  failure: number;
  missing: number;
}

export interface AccountOrchestrationPreview {
  account: LocalAccountReference;
  nativeBalance: NativeAvailability;
  nonce: NonceAvailability;
  lastSyncError: string | null;
  erc20SnapshotCounts: Erc20SnapshotCounts;
}

export interface OrchestrationDraft {
  chainId: number;
  sourceAccounts: LocalAccountReference[];
  localTargets: LocalAccountReference[];
  externalTargets: ExternalAddressReference[];
  previews: AccountOrchestrationPreview[];
  createdAt: string;
}

export interface FrozenOrchestrationSummary extends OrchestrationDraft {
  frozenAt: string;
  frozenKey: string;
}

export interface BuildOrchestrationDraftInput {
  chainId: bigint | number;
  accounts: AccountModel[];
  tokenWatchlistState: TokenWatchlistState | null;
  selectedSourceAddresses: string[];
  selectedLocalTargetAddresses: string[];
  externalTargets: ExternalAddressReference[];
  createdAt?: string;
}

const failureBalanceStatuses = new Set<BalanceStatus>([
  "balanceCallFailed",
  "malformedBalance",
  "rpcFailed",
  "chainMismatch",
]);

function numericChainId(chainId: bigint | number) {
  return typeof chainId === "bigint" ? Number(chainId) : chainId;
}

function addressKey(address: string) {
  return address.toLowerCase();
}

function compareAddress(left: string, right: string) {
  return addressKey(left).localeCompare(addressKey(right));
}

function compareLocalAccountReference(left: LocalAccountReference, right: LocalAccountReference) {
  const addressComparison = compareAddress(left.address, right.address);
  if (addressComparison !== 0) return addressComparison;
  return left.accountIndex - right.accountIndex;
}

function compareExternalAddressReference(
  left: ExternalAddressReference,
  right: ExternalAddressReference,
) {
  return compareAddress(left.address, right.address);
}

function tokenKey(chainId: number, tokenContract: string) {
  return `${chainId}:${addressKey(tokenContract)}`;
}

function balanceKey(account: string, chainId: number, tokenContract: string) {
  return `${addressKey(account)}:${tokenKey(chainId, tokenContract)}`;
}

function stableStringify(value: unknown): string {
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

function emptyCounts(): Erc20SnapshotCounts {
  return { total: 0, ok: 0, zero: 0, stale: 0, failure: 0, missing: 0 };
}

function bucketForSnapshot(snapshot: Erc20BalanceSnapshotRecord | undefined): Erc20SnapshotBucket {
  if (!snapshot) return "missing";
  if (snapshot.balanceStatus === "ok") return "ok";
  if (snapshot.balanceStatus === "zero") return "zero";
  if (snapshot.balanceStatus === "stale") return "stale";
  if (failureBalanceStatuses.has(snapshot.balanceStatus)) return "failure";
  return "failure";
}

function countErc20Snapshots(
  account: string,
  chainId: number,
  tokenWatchlistState: TokenWatchlistState | null,
): Erc20SnapshotCounts {
  const counts = emptyCounts();
  const visibleTokens =
    tokenWatchlistState?.watchlistTokens.filter(
      (token) => token.chainId === chainId && !token.hidden,
    ) ?? [];
  const balances = new Map<string, Erc20BalanceSnapshotRecord>();
  for (const snapshot of tokenWatchlistState?.erc20BalanceSnapshots ?? []) {
    balances.set(balanceKey(snapshot.account, snapshot.chainId, snapshot.tokenContract), snapshot);
  }

  for (const token of visibleTokens) {
    counts.total += 1;
    const bucket = bucketForSnapshot(
      balances.get(balanceKey(account, chainId, token.tokenContract)),
    );
    counts[bucket] += 1;
  }
  return counts;
}

function canonicalizeExternalTargets(targets: ExternalAddressReference[]) {
  const seen = new Set<string>();
  return [...targets]
    .filter((target) => {
      const key = addressKey(target.address);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareExternalAddressReference);
}

function makeChainSnapshotStatus(account: AccountModel, chainId: number): ChainSnapshotStatus {
  return {
    chainId,
    nativeBalance: account.nativeBalanceWei === null ? "missing" : "present",
    nonce: account.nonce === null ? "missing" : "present",
    lastSyncError: account.lastSyncError ?? null,
  };
}

export function makeLocalAccountReference(
  account: AccountModel,
  chainId: bigint | number,
): LocalAccountReference {
  return {
    kind: "localAccount",
    accountIndex: account.index,
    address: account.address,
    label: account.label,
    chainSnapshotStatus: makeChainSnapshotStatus(account, numericChainId(chainId)),
  };
}

export function normalizeExternalAddressTarget(
  input: ExternalAddressInput,
  existingTargets: ExternalAddressReference[] = [],
): ExternalAddressValidationResult {
  const rawAddress = input.address.trim();
  if (!isAddress(rawAddress)) {
    return { ok: false, error: "Enter a valid EVM address." };
  }

  const normalizedAddress = getAddress(rawAddress);
  if (
    existingTargets.some((target) => addressKey(target.address) === addressKey(normalizedAddress))
  ) {
    return { ok: false, error: "This external address is already in the target list." };
  }

  return {
    ok: true,
    target: {
      kind: "externalAddress",
      address: normalizedAddress,
      label: input.label?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  };
}

export function buildAccountOrchestrationPreviews(
  accounts: AccountModel[],
  chainId: bigint | number,
  tokenWatchlistState: TokenWatchlistState | null,
): AccountOrchestrationPreview[] {
  const resolvedChainId = numericChainId(chainId);
  return accounts.map((account) => {
    const reference = makeLocalAccountReference(account, resolvedChainId);
    return {
      account: reference,
      nativeBalance: reference.chainSnapshotStatus.nativeBalance,
      nonce: reference.chainSnapshotStatus.nonce,
      lastSyncError: reference.chainSnapshotStatus.lastSyncError,
      erc20SnapshotCounts: countErc20Snapshots(
        account.address,
        resolvedChainId,
        tokenWatchlistState,
      ),
    };
  });
}

export function buildOrchestrationDraft({
  chainId,
  accounts,
  tokenWatchlistState,
  selectedSourceAddresses,
  selectedLocalTargetAddresses,
  externalTargets,
  createdAt = new Date().toISOString(),
}: BuildOrchestrationDraftInput): OrchestrationDraft {
  const resolvedChainId = numericChainId(chainId);
  const accountsByAddress = new Map(accounts.map((account) => [addressKey(account.address), account]));
  const previews = buildAccountOrchestrationPreviews(accounts, resolvedChainId, tokenWatchlistState);
  const previewByAddress = new Map(
    previews.map((preview) => [addressKey(preview.account.address), preview]),
  );

  function selectedLocalReferences(addresses: string[]) {
    const seen = new Set<string>();
    return addresses.flatMap((address) => {
      const key = addressKey(address);
      if (seen.has(key)) return [];
      seen.add(key);
      const account = accountsByAddress.get(key);
      return account ? [makeLocalAccountReference(account, resolvedChainId)] : [];
    }).sort(compareLocalAccountReference);
  }

  const sourceAccounts = selectedLocalReferences(selectedSourceAddresses);
  const localTargets = selectedLocalReferences(selectedLocalTargetAddresses);
  const canonicalExternalTargets = canonicalizeExternalTargets(externalTargets);
  return {
    chainId: resolvedChainId,
    sourceAccounts,
    localTargets,
    externalTargets: canonicalExternalTargets,
    previews: sourceAccounts
      .map((account) => previewByAddress.get(addressKey(account.address)))
      .filter((preview): preview is AccountOrchestrationPreview => Boolean(preview)),
    createdAt,
  };
}

export function orchestrationFrozenPayload(draft: OrchestrationDraft) {
  const sourceAccounts = [...draft.sourceAccounts].sort(compareLocalAccountReference);
  const localTargets = [...draft.localTargets].sort(compareLocalAccountReference);
  const externalTargets = canonicalizeExternalTargets(draft.externalTargets);
  const previews = [...draft.previews].sort((left, right) =>
    compareAddress(left.account.address, right.account.address),
  );

  return {
    chainId: draft.chainId,
    sourceAccounts: sourceAccounts.map((account) => ({
      kind: account.kind,
      accountIndex: account.accountIndex,
      address: account.address,
      label: account.label,
      chainSnapshotStatus: account.chainSnapshotStatus,
    })),
    localTargets: localTargets.map((account) => ({
      kind: account.kind,
      accountIndex: account.accountIndex,
      address: account.address,
      label: account.label,
      chainSnapshotStatus: account.chainSnapshotStatus,
    })),
    externalTargets: externalTargets.map((target) => ({
      kind: target.kind,
      address: target.address,
      label: target.label ?? null,
      notes: target.notes ?? null,
    })),
    snapshotStatuses: previews.map((preview) => ({
      address: preview.account.address,
      nativeBalance: preview.nativeBalance,
      nonce: preview.nonce,
      lastSyncError: preview.lastSyncError,
      erc20SnapshotCounts: preview.erc20SnapshotCounts,
    })),
  };
}

export function computeFrozenKey(draft: OrchestrationDraft) {
  return ethersId(stableStringify(orchestrationFrozenPayload(draft)));
}

export function freezeOrchestrationDraft(
  draft: OrchestrationDraft,
  frozenAt = new Date().toISOString(),
): FrozenOrchestrationSummary {
  return {
    ...draft,
    frozenAt,
    frozenKey: computeFrozenKey(draft),
  };
}
