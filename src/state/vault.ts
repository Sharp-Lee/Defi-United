import type { EncryptedVault } from "../types";

const KEY = "defi-united-vault-v1";

export function loadVault(): EncryptedVault | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EncryptedVault;
    if (parsed.v === 1 && parsed.saltB64 && parsed.ivB64 && parsed.ctB64) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveVault(vault: EncryptedVault): void {
  localStorage.setItem(KEY, JSON.stringify(vault));
}

export function clearVault(): void {
  localStorage.removeItem(KEY);
}

export function hasVault(): boolean {
  return loadVault() !== null;
}
