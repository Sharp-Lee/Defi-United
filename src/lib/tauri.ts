import { invoke } from "@tauri-apps/api/core";
import {
  normalizeHistoryRecord,
  normalizeAbiCallMetadata,
  normalizeBatchMetadata,
  normalizeRawCalldataMetadata,
  parseTransactionHistoryPayload,
  type AbiCallHistoryMetadata,
  type BatchHistoryMetadata,
  type HistoryRecord as NormalizedHistoryRecord,
  type NativeTransferIntent as NormalizedNativeTransferIntent,
  type RawCalldataHistoryMetadata,
} from "../core/history/schema";
import type {
  RawCalldataHumanPreview,
  RawCalldataInferenceInput,
  RawCalldataRpcIdentity,
  RawCalldataSelectorStatus,
  RawCalldataStatus,
} from "../core/rawCalldata/draft";
import {
  DISPERSE_ETHER_METHOD,
  DISPERSE_ETHER_SELECTOR,
  type FrozenNativeBatchPlan,
} from "../core/batch/nativeBatch";
import {
  DISPERSE_TOKEN_METHOD,
  DISPERSE_TOKEN_SELECTOR,
  type FrozenErc20BatchPlan,
} from "../core/batch/erc20Batch";
import { readAccountState } from "./rpc";

export type {
  AbiCallHistoryMetadata,
  BatchHistoryMetadata,
  ChainOutcomeState,
  HistoryRecord,
  NativeTransferIntent,
  RawCalldataHistoryMetadata,
  SubmissionKind,
  TransactionType,
} from "../core/history/schema";

export interface AccountRecord {
  index: number;
  address: string;
  label: string;
}

export interface StoredAccountRecord extends AccountRecord {
  snapshots: Array<{
    chainId: number;
    accountAddress: string;
    nativeBalanceWei: string;
    nonce: number;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
  }>;
}

export interface SessionSummary {
  status: "ready";
}

export interface RpcEndpointConfig {
  chainId: number;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  validatedAt: string;
}

export interface AppConfig {
  defaultChainId: number;
  idleLockMinutes: number;
  enabledBuiltinChainIds: number[];
  rpcEndpoints: RpcEndpointConfig[];
  displayPreferences: {
    fiatCurrency: string;
  };
}

export type AbiProviderKind =
  | "etherscanCompatible"
  | "blockscoutCompatible"
  | "customIndexer"
  | "localOnly";
export type AbiSourceKind = "explorerFetched" | "userImported" | "userPasted";
export type AbiFetchSourceStatus =
  | "ok"
  | "notConfigured"
  | "unsupportedChain"
  | "fetchFailed"
  | "rateLimited"
  | "notVerified"
  | "malformedResponse";
export type AbiValidationStatus =
  | "notValidated"
  | "parseFailed"
  | "malformedAbi"
  | "emptyAbiItems"
  | "payloadTooLarge"
  | "ok"
  | "selectorConflict";
export type AbiCacheStatus =
  | "cacheFresh"
  | "cacheStale"
  | "refreshing"
  | "refreshFailed"
  | "versionSuperseded";
export type AbiSelectionStatus =
  | "selected"
  | "unselected"
  | "sourceConflict"
  | "needsUserChoice";

export interface AbiDataSourceConfigRecord {
  id: string;
  chainId: number;
  providerKind: AbiProviderKind;
  baseUrl?: string | null;
  apiKeyRef?: string | null;
  enabled: boolean;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  failureCount: number;
  cooldownUntil?: string | null;
  rateLimited: boolean;
  lastErrorSummary?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AbiSelectorSummaryRecord {
  functionSelectorCount?: number | null;
  eventTopicCount?: number | null;
  errorSelectorCount?: number | null;
  duplicateSelectorCount?: number | null;
  conflictCount?: number | null;
  notes?: string | null;
}

export interface AbiCacheEntryRecord {
  chainId: number;
  contractAddress: string;
  sourceKind: AbiSourceKind;
  providerConfigId?: string | null;
  userSourceId?: string | null;
  versionId: string;
  attemptId: string;
  sourceFingerprint: string;
  abiHash: string;
  selected: boolean;
  fetchSourceStatus: AbiFetchSourceStatus;
  validationStatus: AbiValidationStatus;
  cacheStatus: AbiCacheStatus;
  selectionStatus: AbiSelectionStatus;
  functionCount?: number | null;
  eventCount?: number | null;
  errorCount?: number | null;
  selectorSummary?: AbiSelectorSummaryRecord | null;
  fetchedAt?: string | null;
  importedAt?: string | null;
  lastValidatedAt?: string | null;
  staleAfter?: string | null;
  lastErrorSummary?: string | null;
  providerProxyHint?: string | null;
  proxyDetected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AbiRegistryState {
  schemaVersion: number;
  dataSources: AbiDataSourceConfigRecord[];
  cacheEntries: AbiCacheEntryRecord[];
}

export interface UpsertAbiDataSourceConfigInput {
  id: string;
  chainId: number;
  providerKind: AbiProviderKind;
  baseUrl?: string | null;
  apiKeyRef?: string | null;
  enabled?: boolean | null;
  lastSuccessAt?: string | null;
  clearLastSuccessAt?: boolean;
  lastFailureAt?: string | null;
  clearLastFailureAt?: boolean;
  failureCount?: number | null;
  cooldownUntil?: string | null;
  clearCooldownUntil?: boolean;
  rateLimited?: boolean | null;
  lastErrorSummary?: string | null;
  clearLastErrorSummary?: boolean;
}

export interface RemoveAbiDataSourceConfigInput {
  id: string;
}

export interface UpsertAbiCacheEntryInput {
  chainId: number;
  contractAddress: string;
  sourceKind: AbiSourceKind;
  providerConfigId?: string | null;
  userSourceId?: string | null;
  versionId: string;
  attemptId: string;
  sourceFingerprint: string;
  abiHash: string;
  selected: boolean;
  fetchSourceStatus: AbiFetchSourceStatus;
  validationStatus: AbiValidationStatus;
  cacheStatus: AbiCacheStatus;
  selectionStatus: AbiSelectionStatus;
  functionCount?: number | null;
  eventCount?: number | null;
  errorCount?: number | null;
  selectorSummary?: AbiSelectorSummaryRecord | null;
  fetchedAt?: string | null;
  importedAt?: string | null;
  lastValidatedAt?: string | null;
  staleAfter?: string | null;
  lastErrorSummary?: string | null;
  providerProxyHint?: string | null;
  proxyDetected?: boolean;
}

export interface AbiCacheEntryIdentityInput {
  chainId: number;
  contractAddress: string;
  sourceKind: AbiSourceKind;
  providerConfigId?: string | null;
  userSourceId?: string | null;
  versionId: string;
}

export interface ValidateAbiPayloadInput {
  payload: string;
}

export interface UserAbiPayloadInput {
  chainId: number;
  contractAddress: string;
  payload: string;
  userSourceId?: string | null;
}

export interface FetchExplorerAbiInput {
  chainId: number;
  contractAddress: string;
  providerConfigId?: string | null;
}

export interface AbiProviderDiagnosticsRecord {
  providerKind?: AbiProviderKind | null;
  chainId?: number | null;
  providerConfigId?: string | null;
  host?: string | null;
  configSummary?: string | null;
  failureClass?: string | null;
  rateLimitHint?: string | null;
}

export interface AbiPayloadValidationReadModel {
  fetchSourceStatus: AbiFetchSourceStatus;
  validationStatus: AbiValidationStatus;
  abiHash?: string | null;
  sourceFingerprint?: string | null;
  functionCount: number;
  eventCount: number;
  errorCount: number;
  selectorSummary: AbiSelectorSummaryRecord;
  diagnostics: AbiProviderDiagnosticsRecord;
}

export interface AbiRegistryMutationResult {
  state: AbiRegistryState;
  validation: AbiPayloadValidationReadModel;
  cacheEntry?: AbiCacheEntryRecord | null;
}

export type AbiReadCallStatus =
  | "success"
  | "blocked"
  | "loading"
  | "recoverableBlocked"
  | "validationError"
  | "chainMismatch"
  | "artifactDrift"
  | "functionNotFound"
  | "functionNotCallable"
  | "emptyReturn"
  | "malformedReturn"
  | "reverted"
  | "rpcFailure"
  | "timeout"
  | "abiDecodeError";

export interface AbiReadCallInput {
  chainId: number;
  rpcUrl: string;
  contractAddress: string;
  sourceKind: AbiSourceKind;
  providerConfigId?: string | null;
  userSourceId?: string | null;
  versionId: string;
  abiHash: string;
  sourceFingerprint: string;
  functionSignature: string;
  canonicalParams?: unknown[];
  from?: string | null;
}

export interface AbiManagedEntryInput {
  chainId: number;
  contractAddress: string;
  sourceKind: AbiSourceKind;
  providerConfigId?: string | null;
  userSourceId?: string | null;
  versionId: string;
  abiHash: string;
  sourceFingerprint: string;
}

export interface AbiCalldataPreviewInput extends AbiManagedEntryInput {
  functionSignature: string;
  canonicalParams?: unknown[];
}

export interface AbiWriteSubmitInput extends AbiCalldataPreviewInput {
  rpcUrl: string;
  accountIndex: number;
  from: string;
  draftId?: string | null;
  createdAt?: string | null;
  frozenKey: string;
  selector?: string | null;
  calldataHash?: string | null;
  calldataByteLength?: number | null;
  argumentHash?: string | null;
  argumentSummary?: AbiDecodedValueSummary[];
  nativeValueWei: string;
  gasLimit: string;
  latestBaseFeePerGas?: string | null;
  baseFeeIsCustom: boolean;
  baseFeePerGas: string;
  baseFeeMultiplier: string;
  maxFeePerGas: string;
  maxFeeOverridePerGas?: string | null;
  maxPriorityFeePerGas: string;
  nonce: number;
  selectedRpc?: {
    chainId?: number | null;
    providerConfigId?: string | null;
    endpointId?: string | null;
    endpointName?: string | null;
    endpointSummary?: string | null;
    endpointFingerprint?: string | null;
  } | null;
  warnings?: Array<{ level: string; code: string; message?: string | null; source?: string | null }>;
  blockingStatuses?: Array<{ level: string; code: string; message?: string | null; source?: string | null }>;
  warningsAcknowledged?: boolean;
}

export interface RawCalldataWarningAcknowledgementInput {
  code: string;
  acknowledged: boolean;
}

export interface RawCalldataSubmitInput {
  rpcUrl: string;
  draftId?: string | null;
  frozenKey: string;
  createdAt?: string | null;
  chainId: number;
  selectedRpc: RawCalldataRpcIdentity | null;
  from: string;
  accountIndex: number;
  fromAccountIndex?: number | null;
  to: string;
  valueWei: string;
  calldata: string;
  calldataHashVersion: string;
  calldataHash: string;
  calldataByteLength: number;
  selector: string | null;
  selectorStatus: RawCalldataSelectorStatus;
  nonce: number;
  gasLimit: string;
  estimatedGasLimit?: string | null;
  manualGas: boolean;
  latestBaseFeePerGas?: string | null;
  baseFeePerGas: string;
  baseFeeMultiplier?: string | null;
  maxFeePerGas: string;
  maxFeeOverridePerGas?: string | null;
  maxPriorityFeePerGas: string;
  liveMaxFeePerGas?: string | null;
  liveMaxPriorityFeePerGas?: string | null;
  warnings: RawCalldataStatus[];
  warningAcknowledgements: RawCalldataWarningAcknowledgementInput[];
  blockingStatuses: RawCalldataStatus[];
  inference: RawCalldataInferenceInput;
  humanPreview: RawCalldataHumanPreview;
}

export interface AbiCallDataSummary {
  byteLength: number;
  hash: string;
}

export interface AbiReadRpcSummary {
  endpoint: string;
  expectedChainId?: number | null;
  actualChainId?: number | null;
}

export interface AbiDecodedFieldSummary {
  name?: string | null;
  value: AbiDecodedValueSummary;
}

export interface AbiDecodedValueSummary {
  kind: string;
  type: string;
  value?: string | null;
  byteLength?: number | null;
  hash?: string | null;
  items?: AbiDecodedValueSummary[] | null;
  fields?: AbiDecodedFieldSummary[] | null;
  truncated: boolean;
}

export interface AbiReadCallResult {
  status: AbiReadCallStatus;
  reasons: string[];
  functionSignature: string;
  selector?: string | null;
  contractAddress?: string | null;
  from?: string | null;
  sourceKind: AbiSourceKind;
  providerConfigId?: string | null;
  userSourceId?: string | null;
  versionId: string;
  abiHash: string;
  sourceFingerprint: string;
  calldata?: AbiCallDataSummary | null;
  outputs: AbiDecodedValueSummary[];
  rpc: AbiReadRpcSummary;
  errorSummary?: string | null;
}

export interface AbiParamSchema {
  name?: string | null;
  type: string;
  kind: string;
  arrayLength?: number | null;
  components?: AbiParamSchema[] | null;
}

export interface AbiFunctionSchema {
  name: string;
  signature: string;
  selector?: string | null;
  stateMutability: string;
  callKind: "read" | "writeDraft" | "unsupported" | string;
  supported: boolean;
  unsupportedReason?: string | null;
  inputs: AbiParamSchema[];
  outputs: AbiParamSchema[];
}

export interface AbiFunctionCatalogResult {
  status: AbiReadCallStatus;
  reasons: string[];
  contractAddress?: string | null;
  sourceKind: AbiSourceKind;
  providerConfigId?: string | null;
  userSourceId?: string | null;
  versionId: string;
  abiHash: string;
  sourceFingerprint: string;
  functions: AbiFunctionSchema[];
  unsupportedItemCount: number;
  errorSummary?: string | null;
}

export interface AbiCalldataPreviewResult {
  status: AbiReadCallStatus;
  reasons: string[];
  functionSignature: string;
  selector?: string | null;
  contractAddress?: string | null;
  sourceKind: AbiSourceKind;
  providerConfigId?: string | null;
  userSourceId?: string | null;
  versionId: string;
  abiHash: string;
  sourceFingerprint: string;
  parameterSummary: AbiDecodedValueSummary[];
  calldata?: AbiCallDataSummary | null;
  errorSummary?: string | null;
}

export type UserMetadataSource = "userConfirmed";
export type RawMetadataSource = "onChainCall";
export type RawMetadataStatus =
  | "ok"
  | "missingDecimals"
  | "malformed"
  | "callFailed"
  | "nonErc20"
  | "decimalsChanged";
export type ResolvedMetadataSource = "onChainCall" | "userConfirmed";
export type ResolvedMetadataStatus = RawMetadataStatus | "sourceConflict";
export type TokenScanStatus =
  | "idle"
  | "scanning"
  | "ok"
  | "partial"
  | "failed"
  | "chainMismatch"
  | "nonErc20"
  | "malformed";
export type BalanceStatus =
  | "ok"
  | "zero"
  | "balanceCallFailed"
  | "malformedBalance"
  | "rpcFailed"
  | "chainMismatch"
  | "stale";
export type ApprovalSourceKind =
  | "rpcPointRead"
  | "userWatchlist"
  | "historyDerivedCandidate"
  | "explorerCandidate"
  | "indexerCandidate"
  | "manualImport"
  | "unavailable";
export type ApprovalWatchKind =
  | "erc20Allowance"
  | "erc721ApprovalForAll"
  | "erc721TokenApproval";
export type AssetKind = "erc20" | "erc721" | "erc1155";
export type AssetSnapshotStatus =
  | "active"
  | "zero"
  | "unknown"
  | "stale"
  | "readFailed"
  | "sourceUnavailable"
  | "rateLimited"
  | "chainMismatch";
export type AllowanceSnapshotStatus =
  | "active"
  | "zero"
  | "unknown"
  | "stale"
  | "readFailed"
  | "sourceUnavailable"
  | "rateLimited"
  | "chainMismatch";
export type NftApprovalSnapshotStatus =
  | "active"
  | "revoked"
  | "unknown"
  | "stale"
  | "readFailed"
  | "sourceUnavailable"
  | "rateLimited"
  | "chainMismatch";
export type AssetScanJobStatus =
  | "idle"
  | "scanning"
  | "ok"
  | "partial"
  | "failed"
  | "chainMismatch"
  | "sourceUnavailable";

export interface MetadataOverride {
  symbol?: string | null;
  name?: string | null;
  decimals?: number | null;
  source: UserMetadataSource;
  confirmedAt: string;
}

export interface WatchlistTokenRecord {
  chainId: number;
  tokenContract: string;
  label?: string | null;
  userNotes?: string | null;
  pinned: boolean;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
  metadataOverride?: MetadataOverride | null;
}

export interface TokenMetadataCacheRecord {
  chainId: number;
  tokenContract: string;
  rawSymbol?: string | null;
  rawName?: string | null;
  rawDecimals?: number | null;
  source: RawMetadataSource;
  status: RawMetadataStatus;
  createdAt: string;
  updatedAt: string;
  lastScannedAt?: string | null;
  lastErrorSummary?: string | null;
  observedDecimals?: number | null;
  previousDecimals?: number | null;
}

export interface TokenScanStateRecord {
  chainId: number;
  tokenContract: string;
  status: TokenScanStatus;
  createdAt: string;
  lastStartedAt?: string | null;
  lastFinishedAt?: string | null;
  updatedAt: string;
  lastErrorSummary?: string | null;
  rpcIdentity?: string | null;
  rpcProfileId?: string | null;
}

export interface ResolvedTokenMetadataSnapshot {
  symbol?: string | null;
  name?: string | null;
  decimals?: number | null;
  source: ResolvedMetadataSource;
  status: ResolvedMetadataStatus;
}

export interface Erc20BalanceSnapshotRecord {
  account: string;
  chainId: number;
  tokenContract: string;
  balanceRaw: string;
  balanceStatus: BalanceStatus;
  createdAt: string;
  metadataStatusRef?: ResolvedMetadataStatus | null;
  lastScannedAt?: string | null;
  updatedAt: string;
  lastErrorSummary?: string | null;
  rpcIdentity?: string | null;
  rpcProfileId?: string | null;
  resolvedMetadata?: ResolvedTokenMetadataSnapshot | null;
}

export interface ApprovalSourceMetadata {
  kind: ApprovalSourceKind;
  label?: string | null;
  sourceId?: string | null;
  summary?: string | null;
  providerHint?: string | null;
  observedAt?: string | null;
}

export interface ApprovalWatchlistRecord {
  chainId: number;
  owner: string;
  tokenContract: string;
  kind: ApprovalWatchKind;
  spender?: string | null;
  operator?: string | null;
  tokenId?: string | null;
  enabled: boolean;
  label?: string | null;
  userNotes?: string | null;
  source: ApprovalSourceMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface AssetScanJobRecord {
  jobId: string;
  chainId: number;
  owner: string;
  status: AssetScanJobStatus;
  source: ApprovalSourceMetadata;
  contractFilter?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastErrorSummary?: string | null;
  rpcIdentity?: string | null;
  rpcProfileId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetSnapshotRecord {
  chainId: number;
  owner: string;
  tokenContract: string;
  assetKind: AssetKind;
  tokenId?: string | null;
  balanceRaw?: string | null;
  status: AssetSnapshotStatus;
  source: ApprovalSourceMetadata;
  lastScannedAt?: string | null;
  lastErrorSummary?: string | null;
  staleAfter?: string | null;
  rpcIdentity?: string | null;
  rpcProfileId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AllowanceSnapshotRecord {
  chainId: number;
  owner: string;
  tokenContract: string;
  spender: string;
  allowanceRaw: string;
  status: AllowanceSnapshotStatus;
  source: ApprovalSourceMetadata;
  lastScannedAt?: string | null;
  lastErrorSummary?: string | null;
  staleAfter?: string | null;
  rpcIdentity?: string | null;
  rpcProfileId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NftApprovalSnapshotRecord {
  chainId: number;
  owner: string;
  tokenContract: string;
  kind: ApprovalWatchKind;
  operator: string;
  tokenId?: string | null;
  approved?: boolean | null;
  status: NftApprovalSnapshotStatus;
  source: ApprovalSourceMetadata;
  lastScannedAt?: string | null;
  lastErrorSummary?: string | null;
  staleAfter?: string | null;
  rpcIdentity?: string | null;
  rpcProfileId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedTokenMetadataRecord extends ResolvedTokenMetadataSnapshot {
  chainId: number;
  tokenContract: string;
  updatedAt: string;
}

export interface TokenWatchlistState {
  schemaVersion: number;
  watchlistTokens: WatchlistTokenRecord[];
  tokenMetadataCache: TokenMetadataCacheRecord[];
  tokenScanState: TokenScanStateRecord[];
  erc20BalanceSnapshots: Erc20BalanceSnapshotRecord[];
  approvalWatchlist?: ApprovalWatchlistRecord[];
  assetScanJobs?: AssetScanJobRecord[];
  assetSnapshots?: AssetSnapshotRecord[];
  allowanceSnapshots?: AllowanceSnapshotRecord[];
  nftApprovalSnapshots?: NftApprovalSnapshotRecord[];
  resolvedTokenMetadata: ResolvedTokenMetadataRecord[];
}

export interface MetadataOverrideInput {
  symbol?: string | null;
  name?: string | null;
  decimals?: number | null;
  source?: UserMetadataSource | null;
  confirmedAt?: string | null;
}

export interface AddWatchlistTokenInput {
  chainId: number;
  tokenContract: string;
  label?: string | null;
  userNotes?: string | null;
  pinned?: boolean;
  hidden?: boolean;
  metadataOverride?: MetadataOverrideInput | null;
}

export interface EditWatchlistTokenInput {
  chainId: number;
  tokenContract: string;
  newChainId?: number;
  newTokenContract?: string;
  label?: string;
  clearLabel?: boolean;
  userNotes?: string;
  clearUserNotes?: boolean;
  pinned?: boolean;
  hidden?: boolean;
  metadataOverride?: MetadataOverrideInput;
  clearMetadataOverride?: boolean;
}

export interface RemoveWatchlistTokenInput {
  chainId: number;
  tokenContract: string;
  clearMetadataCache?: boolean;
  clearScanState?: boolean;
  clearSnapshots?: boolean;
}

export interface UpsertTokenMetadataCacheInput {
  chainId: number;
  tokenContract: string;
  rawSymbol?: string | null;
  rawName?: string | null;
  rawDecimals?: number | null;
  source?: RawMetadataSource | null;
  status: RawMetadataStatus;
  lastScannedAt?: string | null;
  lastErrorSummary?: string | null;
  observedDecimals?: number | null;
  previousDecimals?: number | null;
}

export interface UpsertTokenScanStateInput {
  chainId: number;
  tokenContract: string;
  status: TokenScanStatus;
  lastStartedAt?: string;
  clearLastStartedAt?: boolean;
  lastFinishedAt?: string;
  clearLastFinishedAt?: boolean;
  lastErrorSummary?: string;
  clearLastErrorSummary?: boolean;
  rpcIdentity?: string;
  clearRpcIdentity?: boolean;
  rpcProfileId?: string;
  clearRpcProfileId?: boolean;
}

export interface UpsertErc20BalanceSnapshotInput {
  account: string;
  chainId: number;
  tokenContract: string;
  balanceRaw?: string;
  balanceStatus: BalanceStatus;
  metadataStatusRef?: ResolvedMetadataStatus;
  clearMetadataStatusRef?: boolean;
  lastScannedAt?: string;
  clearLastScannedAt?: boolean;
  lastErrorSummary?: string;
  clearLastErrorSummary?: boolean;
  rpcIdentity?: string;
  clearRpcIdentity?: boolean;
  rpcProfileId?: string;
  clearRpcProfileId?: boolean;
  resolvedMetadata?: ResolvedTokenMetadataSnapshot;
  clearResolvedMetadata?: boolean;
}

export interface ApprovalSourceMetadataInput {
  kind: ApprovalSourceKind;
  label?: string | null;
  sourceId?: string | null;
  summary?: string | null;
  providerHint?: string | null;
  observedAt?: string | null;
}

export interface UpsertApprovalWatchlistEntryInput {
  chainId: number;
  owner: string;
  tokenContract: string;
  kind: ApprovalWatchKind;
  spender?: string | null;
  operator?: string | null;
  tokenId?: string | null;
  enabled?: boolean | null;
  label?: string | null;
  clearLabel?: boolean;
  userNotes?: string | null;
  clearUserNotes?: boolean;
  source?: ApprovalSourceMetadataInput | null;
}

export interface UpsertAssetScanJobInput {
  jobId?: string | null;
  chainId: number;
  owner: string;
  status: AssetScanJobStatus;
  source?: ApprovalSourceMetadataInput | null;
  contractFilter?: string | null;
  clearContractFilter?: boolean;
  startedAt?: string | null;
  clearStartedAt?: boolean;
  finishedAt?: string | null;
  clearFinishedAt?: boolean;
  lastErrorSummary?: string | null;
  clearLastErrorSummary?: boolean;
  rpcIdentity?: string | null;
  clearRpcIdentity?: boolean;
  rpcProfileId?: string | null;
  clearRpcProfileId?: boolean;
}

export interface UpsertAssetSnapshotInput {
  chainId: number;
  owner: string;
  tokenContract: string;
  assetKind: AssetKind;
  tokenId?: string | null;
  balanceRaw?: string | null;
  status: AssetSnapshotStatus;
  source?: ApprovalSourceMetadataInput | null;
  lastScannedAt?: string | null;
  clearLastScannedAt?: boolean;
  lastErrorSummary?: string | null;
  clearLastErrorSummary?: boolean;
  staleAfter?: string | null;
  clearStaleAfter?: boolean;
  rpcIdentity?: string | null;
  clearRpcIdentity?: boolean;
  rpcProfileId?: string | null;
  clearRpcProfileId?: boolean;
}

export interface UpsertAllowanceSnapshotInput {
  chainId: number;
  owner: string;
  tokenContract: string;
  spender: string;
  allowanceRaw?: string | null;
  status: AllowanceSnapshotStatus;
  source?: ApprovalSourceMetadataInput | null;
  lastScannedAt?: string | null;
  clearLastScannedAt?: boolean;
  lastErrorSummary?: string | null;
  clearLastErrorSummary?: boolean;
  staleAfter?: string | null;
  clearStaleAfter?: boolean;
  rpcIdentity?: string | null;
  clearRpcIdentity?: boolean;
  rpcProfileId?: string | null;
  clearRpcProfileId?: boolean;
}

export interface UpsertNftApprovalSnapshotInput {
  chainId: number;
  owner: string;
  tokenContract: string;
  kind: Exclude<ApprovalWatchKind, "erc20Allowance">;
  operator: string;
  tokenId?: string | null;
  approved?: boolean | null;
  status: NftApprovalSnapshotStatus;
  source?: ApprovalSourceMetadataInput | null;
  lastScannedAt?: string | null;
  clearLastScannedAt?: boolean;
  lastErrorSummary?: string | null;
  clearLastErrorSummary?: boolean;
  staleAfter?: string | null;
  clearStaleAfter?: boolean;
  rpcIdentity?: string | null;
  clearRpcIdentity?: boolean;
  rpcProfileId?: string | null;
  clearRpcProfileId?: boolean;
}

export interface ScanWatchlistTokenMetadataInput {
  rpcUrl: string;
  chainId: number;
  tokenContract: string;
  rpcProfileId?: string | null;
}

export interface ScanErc20BalanceInput {
  rpcUrl: string;
  chainId: number;
  account: string;
  tokenContract: string;
  rpcProfileId?: string | null;
}

export interface ScanWatchlistBalancesInput {
  rpcUrl: string;
  chainId: number;
  accounts?: string[] | null;
  tokenContracts?: string[] | null;
  retryFailedOnly?: boolean;
  rpcProfileId?: string | null;
}

export interface ScanErc20AllowanceInput {
  rpcUrl: string;
  chainId: number;
  owner: string;
  tokenContract: string;
  spender: string;
  rpcProfileId?: string | null;
}

export interface ScanNftOperatorApprovalInput {
  rpcUrl: string;
  chainId: number;
  owner: string;
  tokenContract: string;
  operator: string;
  rpcProfileId?: string | null;
}

export interface ScanErc721TokenApprovalInput {
  rpcUrl: string;
  chainId: number;
  owner: string;
  tokenContract: string;
  tokenId: string;
  operator?: string | null;
  rpcProfileId?: string | null;
}

export type DiagnosticLevel = "info" | "warn" | "error";

export interface DiagnosticEvent {
  timestamp: string;
  level: DiagnosticLevel;
  category: string;
  source: string;
  event: string;
  chainId?: number;
  accountIndex?: number;
  txHash?: string;
  message?: string;
  metadata: Record<string, unknown>;
}

export interface DiagnosticEventQuery {
  limit?: number;
  category?: string;
  sinceTimestamp?: number;
  untilTimestamp?: number;
  chainId?: number;
  account?: string;
  txHash?: string;
  level?: DiagnosticLevel;
  status?: string;
}

export interface DiagnosticExportResult {
  path: string;
  count: number;
  scope: DiagnosticEventQuery & { limit: number };
}

export type HistoryStorageStatus = "notFound" | "healthy" | "corrupted";
export type HistoryCorruptionType =
  | "permissionDenied"
  | "ioError"
  | "jsonParseFailed"
  | "schemaIncompatible"
  | "partialRecordsInvalid";

export interface HistoryStorageRawSummary {
  fileSizeBytes: number | null;
  modifiedAt: string | null;
  topLevel: string | null;
  arrayLen: number | null;
}

export interface HistoryStorageInspection {
  status: HistoryStorageStatus;
  path: string;
  corruptionType?: HistoryCorruptionType;
  readable: boolean;
  recordCount: number;
  invalidRecordCount: number;
  invalidRecordIndices: number[];
  errorSummary?: string;
  rawSummary: HistoryStorageRawSummary;
}

export interface HistoryStorageQuarantineResult {
  quarantinedPath: string;
  previous: HistoryStorageInspection;
  current: HistoryStorageInspection;
}

export type HistoryRecoveryIntentStatus = "active" | "recovered" | "dismissed";
export type HistoryRecoveryResultStatus =
  | "recovered"
  | "pendingRecovered"
  | "alreadyRecovered";

export interface HistoryRecoveryIntent {
  schemaVersion: number;
  id: string;
  status: HistoryRecoveryIntentStatus;
  createdAt: string;
  txHash: string;
  kind:
    | "legacy"
    | "nativeTransfer"
    | "erc20Transfer"
    | "abiWriteCall"
    | "rawCalldata"
    | "replacement"
    | "cancellation"
    | "unsupported";
  chainId: number | null;
  accountIndex: number | null;
  from: string | null;
  nonce: number | null;
  to: string | null;
  valueWei: string | null;
  tokenContract: string | null;
  recipient: string | null;
  amountRaw: string | null;
  decimals: number | null;
  tokenSymbol: string | null;
  tokenName: string | null;
  tokenMetadataSource: string | null;
  selector: string | null;
  methodName: string | null;
  nativeValueWei: string | null;
  frozenKey: string | null;
  gasLimit: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  replacesTxHash: string | null;
  batchMetadata?: BatchHistoryMetadata | null;
  abiCallMetadata?: AbiCallHistoryMetadata | null;
  rawCalldataMetadata?: RawCalldataHistoryMetadata | null;
  broadcastedAt: string;
  writeError: string;
  lastRecoveryError: string | null;
  recoveredAt: string | null;
  dismissedAt: string | null;
}

function normalizeHistoryRecoveryIntent(rawIntent: unknown): HistoryRecoveryIntent {
  const intent = rawIntent as HistoryRecoveryIntent & {
    abi_call_metadata?: unknown;
    abiCallMetadata?: unknown;
    batch_metadata?: unknown;
    batchMetadata?: unknown;
    raw_calldata_metadata?: unknown;
    rawCalldataMetadata?: unknown;
  };
  return {
    ...intent,
    abiCallMetadata: normalizeAbiCallMetadata(intent.abiCallMetadata ?? intent.abi_call_metadata),
    batchMetadata: normalizeBatchMetadata(intent.batchMetadata ?? intent.batch_metadata),
    rawCalldataMetadata: normalizeRawCalldataMetadata(
      intent.rawCalldataMetadata ?? intent.raw_calldata_metadata,
    ),
  };
}

export interface HistoryRecoveryResult {
  status: HistoryRecoveryResultStatus;
  intent: HistoryRecoveryIntent;
  record: NormalizedHistoryRecord;
  history: NormalizedHistoryRecord[];
  message: string;
}

export function createVault(password: string) {
  return invoke<void>("create_vault", { password });
}

export function unlockVault(password: string) {
  return invoke<SessionSummary>("unlock_vault", { password });
}

export function lockVault() {
  return invoke<void>("lock_vault");
}

export function deriveAccount(index: number) {
  return invoke<AccountRecord>("derive_account", { index });
}

export function loadAccounts() {
  return invoke<StoredAccountRecord[]>("load_accounts");
}

export function saveScannedAccount(
  index: number,
  chainId: number,
  nativeBalanceWei: bigint,
  nonce: number,
) {
  return invoke<StoredAccountRecord>("save_scanned_account", {
    index,
    chainId,
    nativeBalanceWei: nativeBalanceWei.toString(),
    nonce,
  });
}

export function saveAccountSyncError(index: number, chainId: number, error: string) {
  return invoke<StoredAccountRecord>("save_account_sync_error", {
    index,
    chainId,
    error,
  });
}

export function loadAppConfig() {
  return invoke<AppConfig>("load_app_config");
}

export function rememberValidatedRpc(endpoint: {
  chainId: number;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
}) {
  return invoke<AppConfig>("remember_validated_rpc", { endpoint });
}

export function loadAbiRegistryState() {
  return invoke<AbiRegistryState>("load_abi_registry_state");
}

export function upsertAbiDataSourceConfig(input: UpsertAbiDataSourceConfigInput) {
  return invoke<AbiRegistryState>("upsert_abi_data_source_config", { input });
}

export function removeAbiDataSourceConfig(input: RemoveAbiDataSourceConfigInput) {
  return invoke<AbiRegistryState>("remove_abi_data_source_config", { input });
}

export function upsertAbiCacheEntry(input: UpsertAbiCacheEntryInput) {
  return invoke<AbiRegistryState>("upsert_abi_cache_entry", { input });
}

export function markAbiCacheStale(input: AbiCacheEntryIdentityInput) {
  return invoke<AbiRegistryState>("mark_abi_cache_stale", { input });
}

export function deleteAbiCacheEntry(input: AbiCacheEntryIdentityInput) {
  return invoke<AbiRegistryState>("delete_abi_cache_entry", { input });
}

export function validateAbiPayload(input: ValidateAbiPayloadInput) {
  return invoke<AbiPayloadValidationReadModel>("validate_abi_payload", { input });
}

export function importAbiPayload(input: UserAbiPayloadInput) {
  return invoke<AbiRegistryMutationResult>("import_abi_payload", { input });
}

export function pasteAbiPayload(input: UserAbiPayloadInput) {
  return invoke<AbiRegistryMutationResult>("paste_abi_payload", { input });
}

export function fetchExplorerAbi(input: FetchExplorerAbiInput) {
  return invoke<AbiRegistryMutationResult>("fetch_explorer_abi", { input });
}

export function callReadOnlyAbiFunction(input: AbiReadCallInput) {
  return invoke<AbiReadCallResult>("call_read_only_abi_function", { input });
}

export function listManagedAbiFunctions(input: AbiManagedEntryInput) {
  return invoke<AbiFunctionCatalogResult>("list_managed_abi_functions", { input });
}

export function previewManagedAbiCalldata(input: AbiCalldataPreviewInput) {
  return invoke<AbiCalldataPreviewResult>("preview_managed_abi_calldata", { input });
}

export async function submitAbiWriteCall(input: AbiWriteSubmitInput) {
  const raw = await invoke<string>("submit_abi_write_call_command", { input });
  return normalizeHistoryRecord(JSON.parse(raw));
}

export async function submitRawCalldata(input: RawCalldataSubmitInput) {
  const raw = await invoke<string>("submit_raw_calldata_command", { input });
  return normalizeHistoryRecord(JSON.parse(raw));
}

export function loadTokenWatchlistState() {
  return invoke<TokenWatchlistState>("load_token_watchlist_state");
}

export function addWatchlistToken(input: AddWatchlistTokenInput) {
  return invoke<TokenWatchlistState>("add_watchlist_token", { input });
}

export function editWatchlistToken(input: EditWatchlistTokenInput) {
  return invoke<TokenWatchlistState>("edit_watchlist_token", { input });
}

export function removeWatchlistToken(input: RemoveWatchlistTokenInput) {
  return invoke<TokenWatchlistState>("remove_watchlist_token", { input });
}

export function upsertTokenMetadataCache(input: UpsertTokenMetadataCacheInput) {
  return invoke<TokenWatchlistState>("upsert_token_metadata_cache", { input });
}

export function upsertTokenScanState(input: UpsertTokenScanStateInput) {
  return invoke<TokenWatchlistState>("upsert_token_scan_state", { input });
}

export function upsertErc20BalanceSnapshot(input: UpsertErc20BalanceSnapshotInput) {
  return invoke<TokenWatchlistState>("upsert_erc20_balance_snapshot", { input });
}

export function upsertApprovalWatchlistEntry(input: UpsertApprovalWatchlistEntryInput) {
  return invoke<TokenWatchlistState>("upsert_approval_watchlist_entry", { input });
}

export function upsertAssetScanJob(input: UpsertAssetScanJobInput) {
  return invoke<TokenWatchlistState>("upsert_asset_scan_job", { input });
}

export function upsertAssetSnapshot(input: UpsertAssetSnapshotInput) {
  return invoke<TokenWatchlistState>("upsert_asset_snapshot", { input });
}

export function upsertAllowanceSnapshot(input: UpsertAllowanceSnapshotInput) {
  return invoke<TokenWatchlistState>("upsert_allowance_snapshot", { input });
}

export function upsertNftApprovalSnapshot(input: UpsertNftApprovalSnapshotInput) {
  return invoke<TokenWatchlistState>("upsert_nft_approval_snapshot", { input });
}

export function scanWatchlistTokenMetadata(input: ScanWatchlistTokenMetadataInput) {
  return invoke<TokenWatchlistState>("scan_watchlist_token_metadata", { input });
}

export function scanErc20Balance(input: ScanErc20BalanceInput) {
  return invoke<TokenWatchlistState>("scan_erc20_balance", { input });
}

export function scanWatchlistBalances(input: ScanWatchlistBalancesInput) {
  return invoke<TokenWatchlistState>("scan_watchlist_balances", { input });
}

export function scanErc20Allowance(input: ScanErc20AllowanceInput) {
  return invoke<TokenWatchlistState>("scan_erc20_allowance", { input });
}

export function scanNftOperatorApproval(input: ScanNftOperatorApprovalInput) {
  return invoke<TokenWatchlistState>("scan_nft_operator_approval", { input });
}

export function scanErc721TokenApproval(input: ScanErc721TokenApprovalInput) {
  return invoke<TokenWatchlistState>("scan_erc721_token_approval", { input });
}

export async function createAndScanAccount(index: number, chainId: number, rpcUrl: string) {
  const account = await deriveAccount(index);
  const snapshot = await readAccountState(rpcUrl, account.address);
  const nativeBalanceWei = snapshot.nativeBalanceWei ?? 0n;
  const nonce = snapshot.nonce ?? 0;
  const stored = await saveScannedAccount(index, chainId, nativeBalanceWei, nonce);
  return {
    index: stored.index,
    address: stored.address,
    label: stored.label,
    accountAddress: stored.address,
    nativeBalanceWei,
    nonce,
    lastSyncedAt:
      stored.snapshots.find((item) => item.chainId === chainId)?.lastSyncedAt ?? null,
    lastSyncError: null,
  };
}

function parseHistory(raw: string): NormalizedHistoryRecord[] {
  return parseTransactionHistoryPayload(raw);
}

export async function loadTransactionHistory() {
  const raw = await invoke<string>("load_transaction_history");
  return parseHistory(raw);
}

export async function inspectTransactionHistoryStorage() {
  const raw = await invoke<string>("inspect_transaction_history_storage");
  return JSON.parse(raw) as HistoryStorageInspection;
}

export async function quarantineTransactionHistory() {
  const raw = await invoke<string>("quarantine_transaction_history");
  return JSON.parse(raw) as HistoryStorageQuarantineResult;
}

export async function reconcilePendingHistory(rpcUrl: string, chainId: number) {
  const raw = await invoke<string>("reconcile_pending_history_command", { rpcUrl, chainId });
  return parseHistory(raw);
}

export async function reviewDroppedHistoryRecord(txHash: string, rpcUrl: string, chainId: number) {
  const raw = await invoke<string>("review_dropped_history_record_command", {
    txHash,
    rpcUrl,
    chainId,
  });
  return parseHistory(raw);
}

export async function loadHistoryRecoveryIntents() {
  const raw = await invoke<string>("load_history_recovery_intents_command");
  return (JSON.parse(raw) as unknown[]).map(normalizeHistoryRecoveryIntent);
}

export async function recoverBroadcastedHistoryRecord(
  recoveryId: string,
  rpcUrl: string,
  chainId: number,
) {
  const raw = await invoke<string>("recover_broadcasted_history_record_command", {
    recoveryId,
    rpcUrl,
    chainId,
  });
  const parsed = JSON.parse(raw) as Omit<HistoryRecoveryResult, "record" | "history"> & {
    record: unknown;
    history: unknown[];
  };
  return {
    ...parsed,
    intent: normalizeHistoryRecoveryIntent(parsed.intent),
    record: normalizeHistoryRecord(parsed.record),
    history: parseHistory(JSON.stringify(parsed.history)),
  };
}

export async function dismissHistoryRecoveryIntent(recoveryId: string) {
  const raw = await invoke<string>("dismiss_history_recovery_intent_command", { recoveryId });
  return (JSON.parse(raw) as unknown[]).map(normalizeHistoryRecoveryIntent);
}

export async function submitNativeTransfer(intent: NormalizedNativeTransferIntent) {
  const raw = await invoke<string>("submit_native_transfer_command", { intent });
  return normalizeHistoryRecord(JSON.parse(raw));
}

export interface NativeBatchSubmitChildResult {
  childId: string;
  childIndex: number;
  targetAddress?: string | null;
  targetKind?: string | null;
  amountWei?: string | null;
  record?: NormalizedHistoryRecord | null;
  error?: string | null;
  recoveryHint?: string | null;
}

export interface NativeBatchSubmitParentResult {
  record?: NormalizedHistoryRecord | null;
  error?: string | null;
  recoveryHint?: string | null;
}

export interface NativeBatchSubmitResult {
  batchId: string;
  batchKind: "distribute" | "collect";
  assetKind: "native";
  chainId: number;
  parent?: NativeBatchSubmitParentResult | null;
  children: NativeBatchSubmitChildResult[];
  summary: {
    childCount: number;
    submittedCount: number;
    failedCount: number;
  };
}

export interface Erc20BatchSubmitChildResult {
  childId: string;
  childIndex: number;
  targetAddress?: string | null;
  targetKind?: string | null;
  amountRaw?: string | null;
  record?: NormalizedHistoryRecord | null;
  error?: string | null;
  recoveryHint?: string | null;
}

export interface Erc20BatchSubmitParentResult {
  record?: NormalizedHistoryRecord | null;
  error?: string | null;
  recoveryHint?: string | null;
}

export interface Erc20BatchSubmitResult {
  batchId: string;
  batchKind: "distribute" | "collect";
  assetKind: "erc20";
  chainId: number;
  parent?: Erc20BatchSubmitParentResult | null;
  children: Erc20BatchSubmitChildResult[];
  summary: {
    childCount: number;
    submittedCount: number;
    failedCount: number;
  };
}

export async function submitNativeBatch(plan: FrozenNativeBatchPlan, rpcUrl: string) {
  const distributionParent =
    plan.batchKind === "distribute" && plan.distributionParent
      ? {
          contractAddress: plan.distributionParent.distributionContract,
          selector: plan.distributionParent.selector,
          methodName: plan.distributionParent.methodName,
          recipients: plan.distributionParent.recipients.map((recipient, index) => ({
            childId: recipient.childId,
            childIndex: index,
            targetKind: recipient.target.kind,
            targetAddress: recipient.targetAddress,
            valueWei: recipient.amountWei,
          })),
          totalValueWei: plan.distributionParent.totalValueWei,
          intent: {
            transaction_type: "contractCall",
            selector: plan.distributionParent.selector || DISPERSE_ETHER_SELECTOR,
            method_name: plan.distributionParent.methodName || DISPERSE_ETHER_METHOD,
            native_value_wei: plan.distributionParent.totalValueWei,
            rpc_url: rpcUrl,
            account_index: plan.distributionParent.source.accountIndex,
            chain_id: plan.distributionParent.chainId,
            from: plan.distributionParent.source.address,
            to: plan.distributionParent.distributionContract,
            value_wei: plan.distributionParent.totalValueWei,
            nonce: plan.distributionParent.nonce,
            gas_limit: plan.distributionParent.gasLimit,
            max_fee_per_gas: plan.distributionParent.maxFeePerGas,
            max_priority_fee_per_gas: plan.distributionParent.maxPriorityFeePerGas,
          },
        }
      : null;
  const input = {
    batchId: plan.batchId,
    batchKind: plan.batchKind,
    assetKind: plan.assetKind,
    chainId: plan.chainId,
    freezeKey: plan.freezeKey,
    distributionParent,
    children:
      plan.batchKind === "collect"
        ? plan.children
            .map((child, index) => ({ child, index }))
            .filter(({ child }) => child.status === "notSubmitted" && child.nonce !== null)
            .map(({ child, index }) => ({
              childId: child.childId,
              childIndex: index,
              batchKind: child.batchKind,
              assetKind: child.assetKind,
              freezeKey: plan.freezeKey,
              intent: {
                transaction_type: "nativeTransfer",
                native_value_wei: child.amountWei,
                rpc_url: rpcUrl,
                account_index: child.intentSnapshot.accountIndex,
                chain_id: child.intentSnapshot.chainId,
                from: child.intentSnapshot.from,
                to: child.intentSnapshot.to,
                value_wei: child.intentSnapshot.valueWei,
                nonce: child.nonce,
                gas_limit: child.intentSnapshot.gasLimit,
                max_fee_per_gas: child.intentSnapshot.maxFeePerGas,
                max_priority_fee_per_gas: child.intentSnapshot.maxPriorityFeePerGas,
              },
            }))
        : [],
  };
  const raw = await invoke<string>("submit_native_batch_command", { input });
  const parsed = JSON.parse(raw) as Omit<NativeBatchSubmitResult, "children" | "parent"> & {
    parent?: (Omit<NativeBatchSubmitParentResult, "record"> & { record?: unknown | null }) | null;
    children: Array<Omit<NativeBatchSubmitChildResult, "record"> & { record?: unknown | null }>;
  };
  return {
    ...parsed,
    parent: parsed.parent
      ? {
          ...parsed.parent,
          record: parsed.parent.record ? normalizeHistoryRecord(parsed.parent.record) : null,
        }
      : null,
    children: parsed.children.map((child) => ({
      ...child,
      record: child.record ? normalizeHistoryRecord(child.record) : null,
    })),
  } as NativeBatchSubmitResult;
}

export async function submitErc20Batch(plan: FrozenErc20BatchPlan, rpcUrl: string) {
  const distributionParent =
    plan.batchKind === "distribute" && plan.distributionParent
      ? {
          contractAddress: plan.distributionParent.distributionContract,
          selector: plan.distributionParent.selector,
          methodName: plan.distributionParent.methodName,
          tokenContract: plan.distributionParent.tokenContract,
          decimals: plan.distributionParent.decimals,
          tokenSymbol: plan.distributionParent.tokenSymbol,
          tokenName: plan.distributionParent.tokenName,
          tokenMetadataSource: plan.distributionParent.tokenMetadataSource,
          recipients: plan.distributionParent.recipients.map((recipient, index) => ({
            childId: recipient.childId,
            childIndex: index,
            targetKind: recipient.target.kind,
            targetAddress: recipient.targetAddress,
            amountRaw: recipient.amountRaw,
          })),
          totalAmountRaw: plan.distributionParent.totalAmountRaw,
          intent: {
            transaction_type: "contractCall",
            selector: plan.distributionParent.selector || DISPERSE_TOKEN_SELECTOR,
            method_name: plan.distributionParent.methodName || DISPERSE_TOKEN_METHOD,
            native_value_wei: "0",
            rpc_url: rpcUrl,
            account_index: plan.distributionParent.source.accountIndex,
            chain_id: plan.distributionParent.chainId,
            from: plan.distributionParent.source.address,
            to: plan.distributionParent.distributionContract,
            value_wei: "0",
            nonce: plan.distributionParent.nonce,
            gas_limit: plan.distributionParent.gasLimit,
            max_fee_per_gas: plan.distributionParent.maxFeePerGas,
            max_priority_fee_per_gas: plan.distributionParent.maxPriorityFeePerGas,
          },
        }
      : null;
  const input = {
    batchId: plan.batchId,
    batchKind: plan.batchKind,
    assetKind: plan.assetKind,
    chainId: plan.chainId,
    freezeKey: plan.freezeKey,
    distributionParent,
    children:
      plan.batchKind === "collect"
        ? plan.children
            .filter((child) => child.status === "notSubmitted" && child.nonce !== null && child.intentSnapshot)
            .map((child, index) => ({
              childId: child.childId,
              childIndex: index,
              batchKind: child.batchKind,
              assetKind: child.assetKind,
              freezeKey: plan.freezeKey,
              targetKind: child.target.kind,
              targetAddress: child.targetAddress,
              amountRaw: child.amountRaw,
              intent: {
                rpc_url: rpcUrl,
                account_index: child.intentSnapshot!.accountIndex,
                chain_id: child.intentSnapshot!.chainId,
                from: child.intentSnapshot!.from,
                token_contract: child.intentSnapshot!.tokenContract,
                recipient: child.intentSnapshot!.recipient,
                amount_raw: child.intentSnapshot!.amountRaw,
                decimals: child.intentSnapshot!.decimals,
                token_symbol: child.intentSnapshot!.tokenSymbol,
                token_name: child.intentSnapshot!.tokenName,
                token_metadata_source: child.intentSnapshot!.tokenMetadataSource,
                nonce: child.nonce,
                gas_limit: child.intentSnapshot!.gasLimit,
                max_fee_per_gas: child.intentSnapshot!.maxFeePerGas,
                max_priority_fee_per_gas: child.intentSnapshot!.maxPriorityFeePerGas,
                latest_base_fee_per_gas: null,
                base_fee_per_gas: "0",
                base_fee_multiplier: "batch",
                max_fee_override_per_gas: null,
                selector: "0xa9059cbb",
                method: "transfer(address,uint256)",
                native_value_wei: "0",
                frozen_key: [
                  `chainId=${child.intentSnapshot!.chainId}`,
                  `from=${child.intentSnapshot!.from}`,
                  `tokenContract=${child.intentSnapshot!.tokenContract}`,
                  `recipient=${child.intentSnapshot!.recipient}`,
                  `amountRaw=${child.intentSnapshot!.amountRaw}`,
                  `decimals=${child.intentSnapshot!.decimals}`,
                  `metadataSource=${child.intentSnapshot!.tokenMetadataSource}`,
                  `nonce=${child.nonce}`,
                  `gasLimit=${child.intentSnapshot!.gasLimit}`,
                  "latestBaseFee=unavailable",
                  "baseFee=0",
                  "baseFeeMultiplier=batch",
                  `maxFee=${child.intentSnapshot!.maxFeePerGas}`,
                  "maxFeeOverride=auto",
                  `priorityFee=${child.intentSnapshot!.maxPriorityFeePerGas}`,
                  "selector=0xa9059cbb",
                  "method=transfer(address,uint256)",
                  "nativeValueWei=0",
                ].join("|"),
              },
            }))
        : [],
  };
  const raw = await invoke<string>("submit_erc20_batch_command", { input });
  const parsed = JSON.parse(raw) as Omit<Erc20BatchSubmitResult, "children" | "parent"> & {
    parent?: (Omit<Erc20BatchSubmitParentResult, "record"> & { record?: unknown | null }) | null;
    children: Array<Omit<Erc20BatchSubmitChildResult, "record"> & { record?: unknown | null }>;
  };
  return {
    ...parsed,
    parent: parsed.parent
      ? {
          ...parsed.parent,
          record: parsed.parent.record ? normalizeHistoryRecord(parsed.parent.record) : null,
        }
      : null,
    children: parsed.children.map((child) => ({
      ...child,
      record: child.record ? normalizeHistoryRecord(child.record) : null,
    })),
  } as Erc20BatchSubmitResult;
}

export interface Erc20TransferIntent {
  rpc_url: string;
  account_index: number;
  chain_id: number;
  from: string;
  token_contract: string;
  recipient: string;
  amount_raw: string;
  decimals: number;
  token_symbol?: string | null;
  token_name?: string | null;
  token_metadata_source: string;
  nonce: number;
  gas_limit: string;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
  latest_base_fee_per_gas?: string | null;
  base_fee_per_gas: string;
  base_fee_multiplier: string;
  max_fee_override_per_gas?: string | null;
  selector: string;
  method: string;
  native_value_wei: string;
  frozen_key: string;
}

export async function submitErc20Transfer(intent: Erc20TransferIntent) {
  const raw = await invoke<string>("submit_erc20_transfer_command", { intent });
  return normalizeHistoryRecord(JSON.parse(raw));
}

export interface PendingMutationRequest {
  txHash: string;
  rpcUrl: string;
  accountIndex: number;
  chainId: number;
  from: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  to?: string;
  valueWei?: string;
}

export async function replacePendingTransfer(request: PendingMutationRequest) {
  const raw = await invoke<string>("replace_pending_transfer", { request });
  return normalizeHistoryRecord(JSON.parse(raw));
}

export async function cancelPendingTransfer(request: PendingMutationRequest) {
  const raw = await invoke<string>("cancel_pending_transfer", { request });
  return normalizeHistoryRecord(JSON.parse(raw));
}

export function loadDiagnosticEvents(query: DiagnosticEventQuery = {}) {
  return invoke<DiagnosticEvent[]>("load_diagnostic_events", { query });
}

export function exportDiagnosticEvents(query: DiagnosticEventQuery = {}) {
  return invoke<DiagnosticExportResult>("export_diagnostic_events", { query });
}
