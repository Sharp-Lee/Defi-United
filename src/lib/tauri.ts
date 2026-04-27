import { invoke } from "@tauri-apps/api/core";
import { readAccountState } from "./rpc";

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

export function generateMnemonicPhrase() {
  return invoke<string>("generate_mnemonic");
}

export function createVault(mnemonic: string, password: string) {
  return invoke<void>("create_vault", { mnemonic, password });
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

export type ChainOutcomeState =
  | "Pending"
  | "Confirmed"
  | "Failed"
  | "Replaced"
  | "Cancelled"
  | "Dropped";

export interface NativeTransferIntent {
  rpc_url: string;
  account_index: number;
  chain_id: number;
  from: string;
  to: string;
  value_wei: string;
  nonce: number;
  gas_limit: string;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
}

export interface HistoryRecord {
  intent: NativeTransferIntent;
  submission: {
    frozen_key: string;
    tx_hash: string;
  };
  outcome: {
    state: ChainOutcomeState;
    tx_hash: string;
  };
}

function parseHistory(raw: string): HistoryRecord[] {
  return JSON.parse(raw) as HistoryRecord[];
}

export async function loadTransactionHistory() {
  const raw = await invoke<string>("load_transaction_history");
  return parseHistory(raw);
}

export async function reconcilePendingHistory(rpcUrl: string, chainId: number) {
  const raw = await invoke<string>("reconcile_pending_history_command", { rpcUrl, chainId });
  return parseHistory(raw);
}

export async function submitNativeTransfer(intent: NativeTransferIntent) {
  const raw = await invoke<string>("submit_native_transfer_command", { intent });
  return JSON.parse(raw) as HistoryRecord;
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
  return JSON.parse(raw) as HistoryRecord;
}

export async function cancelPendingTransfer(request: PendingMutationRequest) {
  const raw = await invoke<string>("cancel_pending_transfer", { request });
  return JSON.parse(raw) as HistoryRecord;
}
