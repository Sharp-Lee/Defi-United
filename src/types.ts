export type Hex = `0x${string}`;

export interface ChildAccount {
  index: number;
  address: string;
  balanceWei: bigint | null;
  status: "idle" | "funded" | "donated" | "swept" | "error";
}

export type TxKind = "distribute" | "donate" | "sweep";

export interface TxRecord {
  id: string;
  kind: TxKind;
  hash?: string;
  from: string;
  to: string;
  valueWei: bigint;
  status: "pending" | "mined" | "failed";
  error?: string;
  createdAt: number;
}

export interface EncryptedVault {
  v: 1;
  saltB64: string;
  ivB64: string;
  ctB64: string;
  iter: number;
}

export interface VaultPlaintext {
  mnemonic: string;
  nextChildIndex: number;
  rpcUrl: string;
  donationTarget: string;
  disperseAddress: string;
}

export const DEFAULTS = {
  donationTarget: "0x0fCa5194baA59a362a835031d9C4A25970effE68",
  disperseAddress: "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3",
  pbkdf2Iter: 200_000,
  rootPath: (i: number) => `m/44'/60'/0'/0/${i}`,
};
