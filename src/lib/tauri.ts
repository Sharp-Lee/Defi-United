import { invoke } from "@tauri-apps/api/core";
import {
  normalizeHistoryRecord,
  parseTransactionHistoryPayload,
  type HistoryRecord as NormalizedHistoryRecord,
  type NativeTransferIntent as NormalizedNativeTransferIntent,
} from "../core/history/schema";
import { readAccountState } from "./rpc";

export type {
  ChainOutcomeState,
  HistoryRecord,
  NativeTransferIntent,
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

export async function submitNativeTransfer(intent: NormalizedNativeTransferIntent) {
  const raw = await invoke<string>("submit_native_transfer_command", { intent });
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
