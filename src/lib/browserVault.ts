import type { BrowserVaultState } from "../core/browserVault/accounts";

const DB_NAME = "defi-united-pwa-vault";
const DB_VERSION = 1;
const STORE_NAME = "vaults";
const PRIMARY_VAULT_ID = "primary";
export const BROWSER_VAULT_KDF_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface BrowserVaultEnvelope {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  cipher: {
    name: "AES-GCM";
    iv: string;
  };
  ciphertext: string;
}

export interface BrowserVaultStorage {
  loadEnvelope(): Promise<BrowserVaultEnvelope | null>;
  saveEnvelope(envelope: BrowserVaultEnvelope): Promise<void>;
  clearEnvelope(): Promise<void>;
}

export interface BrowserVaultSession {
  state: BrowserVaultState;
  envelope: BrowserVaultEnvelope;
  key: CryptoKey;
}

function timestamp() {
  return new Date().toISOString();
}

function getCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable in this browser context.");
  }
  return globalThis.crypto;
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  getCrypto().getRandomValues(bytes);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveVaultKey(password: string, salt: Uint8Array, iterations: number) {
  const crypto = getCrypto();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations,
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptState(
  state: BrowserVaultState,
  key: CryptoKey,
  envelopeBase: Omit<BrowserVaultEnvelope, "cipher" | "ciphertext" | "updatedAt">,
): Promise<BrowserVaultEnvelope> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await getCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    new TextEncoder().encode(JSON.stringify(state)),
  );

  return {
    ...envelopeBase,
    updatedAt: timestamp(),
    cipher: {
      name: "AES-GCM",
      iv: bytesToBase64(iv),
    },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

function validateEnvelope(value: unknown): BrowserVaultEnvelope {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid encrypted vault envelope.");
  }

  const envelope = value as BrowserVaultEnvelope;
  if (
    envelope.id !== PRIMARY_VAULT_ID ||
    envelope.schemaVersion !== 1 ||
    envelope.kdf?.name !== "PBKDF2" ||
    envelope.kdf.hash !== "SHA-256" ||
    !Number.isSafeInteger(envelope.kdf.iterations) ||
    envelope.kdf.iterations < BROWSER_VAULT_KDF_ITERATIONS ||
    typeof envelope.kdf.salt !== "string" ||
    base64ToBytes(envelope.kdf.salt).byteLength !== SALT_BYTES ||
    envelope.cipher?.name !== "AES-GCM" ||
    typeof envelope.cipher.iv !== "string" ||
    base64ToBytes(envelope.cipher.iv).byteLength !== IV_BYTES ||
    typeof envelope.ciphertext !== "string" ||
    base64ToBytes(envelope.ciphertext).byteLength === 0
  ) {
    throw new Error("Invalid encrypted vault envelope.");
  }

  return envelope;
}

function validateVaultState(value: unknown): BrowserVaultState {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid decrypted vault state.");
  }

  const state = value as BrowserVaultState;
  if (state.schemaVersion !== 1 || !Array.isArray(state.groups) || typeof state.activeGroupId !== "string") {
    throw new Error("Invalid decrypted vault state.");
  }

  return state;
}

async function decryptEnvelope(envelope: BrowserVaultEnvelope, key: CryptoKey) {
  try {
    const plaintext = await getCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(envelope.cipher.iv),
      },
      key,
      base64ToBytes(envelope.ciphertext),
    );
    return validateVaultState(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw new Error("Unable to unlock encrypted vault. Check the password or vault file.");
  }
}

export async function createBrowserVaultSession(
  password: string,
  state: BrowserVaultState,
  storage: BrowserVaultStorage = indexedDbBrowserVaultStorage,
): Promise<BrowserVaultSession> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveVaultKey(password, salt, BROWSER_VAULT_KDF_ITERATIONS);
  const createdAt = timestamp();
  const envelope = await encryptState(state, key, {
    id: PRIMARY_VAULT_ID,
    schemaVersion: 1,
    createdAt,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: BROWSER_VAULT_KDF_ITERATIONS,
      salt: bytesToBase64(salt),
    },
  });

  await storage.saveEnvelope(envelope);
  return { state, envelope, key };
}

export async function unlockBrowserVaultSession(
  password: string,
  storage: BrowserVaultStorage = indexedDbBrowserVaultStorage,
): Promise<BrowserVaultSession> {
  const loadedEnvelope = await storage.loadEnvelope();
  if (!loadedEnvelope) {
    throw new Error("No encrypted browser vault is stored in this browser.");
  }

  const envelope = validateEnvelope(loadedEnvelope);
  const key = await deriveVaultKey(
    password,
    base64ToBytes(envelope.kdf.salt),
    envelope.kdf.iterations,
  );
  const state = await decryptEnvelope(envelope, key);
  return { state, envelope, key };
}

export async function saveBrowserVaultSession(
  session: BrowserVaultSession,
  nextState: BrowserVaultState,
  storage: BrowserVaultStorage = indexedDbBrowserVaultStorage,
): Promise<BrowserVaultSession> {
  const envelope = await encryptState(nextState, session.key, {
    id: session.envelope.id,
    schemaVersion: session.envelope.schemaVersion,
    createdAt: session.envelope.createdAt,
    kdf: session.envelope.kdf,
  });

  await storage.saveEnvelope(envelope);
  return { state: nextState, envelope, key: session.key };
}

export async function hasBrowserVault(storage: BrowserVaultStorage = indexedDbBrowserVaultStorage) {
  return (await storage.loadEnvelope()) !== null;
}

export function serializeBrowserVaultEnvelope(envelope: BrowserVaultEnvelope) {
  return JSON.stringify(envelope, null, 2);
}

export function parseBrowserVaultEnvelope(serialized: string) {
  return validateEnvelope(JSON.parse(serialized));
}

export async function importBrowserVaultEnvelope(
  envelope: BrowserVaultEnvelope,
  password: string,
  storage: BrowserVaultStorage = indexedDbBrowserVaultStorage,
  options: { overwriteExisting?: boolean } = {},
): Promise<BrowserVaultSession> {
  const validatedEnvelope = validateEnvelope(envelope);
  const existingEnvelope = await storage.loadEnvelope();
  if (existingEnvelope && !options.overwriteExisting) {
    throw new Error("A browser vault already exists. Confirm overwrite before importing another encrypted vault.");
  }

  const key = await deriveVaultKey(
    password,
    base64ToBytes(validatedEnvelope.kdf.salt),
    validatedEnvelope.kdf.iterations,
  );
  const state = await decryptEnvelope(validatedEnvelope, key);
  await storage.saveEnvelope(validatedEnvelope);
  return { state, envelope: validatedEnvelope, key };
}

export function createMemoryBrowserVaultStorage(initialEnvelope: BrowserVaultEnvelope | null = null) {
  let envelope = initialEnvelope;
  return {
    async loadEnvelope() {
      return envelope;
    },
    async saveEnvelope(nextEnvelope: BrowserVaultEnvelope) {
      envelope = nextEnvelope;
    },
    async clearEnvelope() {
      envelope = null;
    },
  } satisfies BrowserVaultStorage;
}

function openVaultDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Unable to open browser vault storage."));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

export const indexedDbBrowserVaultStorage = {
  async loadEnvelope() {
    const database = await openVaultDatabase();
    try {
      return await new Promise<BrowserVaultEnvelope | null>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(PRIMARY_VAULT_ID);
        request.onerror = () => reject(request.error ?? new Error("Unable to read browser vault."));
        request.onsuccess = () => resolve(request.result ? validateEnvelope(request.result) : null);
      });
    } finally {
      database.close();
    }
  },
  async saveEnvelope(envelope: BrowserVaultEnvelope) {
    const database = await openVaultDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Unable to save browser vault."));
        transaction.objectStore(STORE_NAME).put(validateEnvelope(envelope));
      });
    } finally {
      database.close();
    }
  },
  async clearEnvelope() {
    const database = await openVaultDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Unable to clear browser vault."));
        transaction.objectStore(STORE_NAME).delete(PRIMARY_VAULT_ID);
      });
    } finally {
      database.close();
    }
  },
} satisfies BrowserVaultStorage;
