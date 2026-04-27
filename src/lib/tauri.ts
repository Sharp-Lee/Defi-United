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
    nativeBalanceWei: string;
    nonce: number;
  }>;
}

export function deriveAccount(index: number) {
  return invoke<AccountRecord>("derive_account", { index });
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

export async function createAndScanAccount(index: number, chainId: number, rpcUrl: string) {
  const account = await deriveAccount(index);
  const snapshot = await readAccountState(rpcUrl, account.address);
  const stored = await saveScannedAccount(index, chainId, snapshot.nativeBalanceWei, snapshot.nonce);
  return {
    index: stored.index,
    address: stored.address,
    label: stored.label,
    nativeBalanceWei: snapshot.nativeBalanceWei,
    nonce: snapshot.nonce,
  };
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

export function replacePendingTransfer(request: PendingMutationRequest) {
  return invoke<string>("replace_pending_transfer", { request });
}

export function cancelPendingTransfer(request: PendingMutationRequest) {
  return invoke<string>("cancel_pending_transfer", { request });
}
