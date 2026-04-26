import type { EncryptedVault, VaultPlaintext } from "../types";
import { DEFAULTS } from "../types";

const enc = new TextEncoder();
const dec = new TextDecoder();

type SafeBytes = Uint8Array<ArrayBuffer>;

function randBytes(n: number): SafeBytes {
  const view = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(view);
  return view as SafeBytes;
}

function toB64(buf: SafeBytes | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64: string): SafeBytes {
  const s = atob(b64);
  const view = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i);
  return view as SafeBytes;
}

function encUtf8(s: string): SafeBytes {
  const v = enc.encode(s);
  const out = new Uint8Array(new ArrayBuffer(v.byteLength));
  out.set(v);
  return out as SafeBytes;
}

async function deriveKey(password: string, salt: SafeBytes, iter: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encUtf8(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iter },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptVault(plaintext: VaultPlaintext, password: string): Promise<EncryptedVault> {
  const salt = randBytes(16);
  const iv = randBytes(12);
  const iter = DEFAULTS.pbkdf2Iter;
  const key = await deriveKey(password, salt, iter);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encUtf8(JSON.stringify(plaintext)),
  );
  return { v: 1, saltB64: toB64(salt), ivB64: toB64(iv), ctB64: toB64(ct), iter };
}

export async function decryptVault(vault: EncryptedVault, password: string): Promise<VaultPlaintext> {
  if (vault.v !== 1) throw new Error("Unsupported vault version");
  const salt = fromB64(vault.saltB64);
  const iv = fromB64(vault.ivB64);
  const ct = fromB64(vault.ctB64);
  const key = await deriveKey(password, salt, vault.iter);
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  } catch {
    throw new Error("密码错误或数据损坏");
  }
  return JSON.parse(dec.decode(pt)) as VaultPlaintext;
}
