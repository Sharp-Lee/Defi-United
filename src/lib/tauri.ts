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
  account: AccountRecord,
  chainId: number,
  nativeBalanceWei: bigint,
  nonce: number,
) {
  return invoke<StoredAccountRecord>("save_scanned_account", {
    account,
    chainId,
    nativeBalanceWei: nativeBalanceWei.toString(),
    nonce,
  });
}

export async function createAndScanAccount(index: number, chainId: number, rpcUrl: string) {
  const account = await deriveAccount(index);
  const snapshot = await readAccountState(rpcUrl, account.address);
  const stored = await saveScannedAccount(account, chainId, snapshot.nativeBalanceWei, snapshot.nonce);
  return {
    index: stored.index,
    address: stored.address,
    label: stored.label,
    nativeBalanceWei: snapshot.nativeBalanceWei,
    nonce: snapshot.nonce,
  };
}
