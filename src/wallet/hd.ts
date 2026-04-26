import { Mnemonic, HDNodeWallet, Wallet } from "ethers";
import { DEFAULTS } from "../types";

export function generateMnemonic(): string {
  const wallet = Wallet.createRandom();
  if (!wallet.mnemonic) throw new Error("Failed to generate mnemonic");
  return wallet.mnemonic.phrase;
}

export function isValidMnemonic(phrase: string): boolean {
  try {
    Mnemonic.fromPhrase(phrase.trim());
    return true;
  } catch {
    return false;
  }
}

export function deriveAccount(mnemonic: string, index: number): HDNodeWallet {
  const m = Mnemonic.fromPhrase(mnemonic.trim());
  return HDNodeWallet.fromMnemonic(m, DEFAULTS.rootPath(index));
}

export function deriveRoot(mnemonic: string): HDNodeWallet {
  return deriveAccount(mnemonic, 0);
}

export function deriveChildren(mnemonic: string, fromIndex: number, count: number): HDNodeWallet[] {
  const out: HDNodeWallet[] = [];
  for (let i = 0; i < count; i++) {
    out.push(deriveAccount(mnemonic, fromIndex + i));
  }
  return out;
}
