import { computeHmac, pbkdf2, sha256, sha512 } from "ethers/crypto";
import { HDNodeWallet } from "ethers/wallet";

function bytesLikeToHex(value: unknown) {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) {
    return `0x${Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return `0x${Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  throw new Error("Unsupported ethers crypto output.");
}

sha256.register((data) => bytesLikeToHex(sha256._(data)));
sha512.register((data) => bytesLikeToHex(sha512._(data)));
pbkdf2.register((password, salt, iterations, keylen, algo) =>
  bytesLikeToHex(pbkdf2._(password, salt, iterations, keylen, algo)),
);
computeHmac.register((algorithm, key, data) => bytesLikeToHex(computeHmac._(algorithm, key, data)));

export const BROWSER_VAULT_SCHEMA_VERSION = 1;
export const DEFAULT_DERIVATION_PATH_BASE = "m/44'/60'/0'/0";
export const DEFAULT_BROWSER_VAULT_GROUP_NAME = "主账户组";

export interface BrowserVaultAccountRecord {
  id: string;
  index: number;
  label: string;
  address: string;
  derivationPath: string;
  selected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserVaultGroupRecord {
  id: string;
  name: string;
  mnemonicPhrase: string;
  derivationPathBase: string;
  nextAccountIndex: number;
  accounts: BrowserVaultAccountRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface BrowserVaultState {
  schemaVersion: typeof BROWSER_VAULT_SCHEMA_VERSION;
  activeGroupId: string;
  groups: BrowserVaultGroupRecord[];
}

export interface BrowserVaultStateOptions {
  groupName?: string;
  mnemonicPhrase?: string;
  initialAccountCount?: number;
  derivationPathBase?: string;
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizePathBase(pathBase: string) {
  return pathBase.endsWith("/") ? pathBase.slice(0, -1) : pathBase;
}

function requireMnemonicPhrase(mnemonicPhrase?: string) {
  if (!mnemonicPhrase) {
    const wallet = HDNodeWallet.createRandom();
    if (!wallet.mnemonic?.phrase) {
      throw new Error("Unable to create browser vault mnemonic.");
    }
    return wallet.mnemonic.phrase;
  }
  return mnemonicPhrase;
}

function deriveAccountRecord(group: BrowserVaultGroupRecord, index: number, selected = false) {
  const derivationPath = `${normalizePathBase(group.derivationPathBase)}/${index}`;
  const wallet = HDNodeWallet.fromPhrase(group.mnemonicPhrase, undefined, derivationPath);
  const timestamp = nowIso();
  return {
    id: createId("browser-vault-account"),
    index,
    label: `账户 ${index + 1}`,
    address: wallet.address,
    derivationPath: wallet.path ?? derivationPath,
    selected,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies BrowserVaultAccountRecord;
}

export function createVaultGroupRecord(
  name: string,
  options: BrowserVaultStateOptions = {},
): BrowserVaultGroupRecord {
  const timestamp = nowIso();
  const mnemonicPhrase = requireMnemonicPhrase(options.mnemonicPhrase);
  const derivationPathBase = normalizePathBase(options.derivationPathBase ?? DEFAULT_DERIVATION_PATH_BASE);
  const initialAccountCount = Math.max(1, options.initialAccountCount ?? 1);
  const group: BrowserVaultGroupRecord = {
    id: createId("browser-vault-group"),
    name,
    mnemonicPhrase,
    derivationPathBase,
    nextAccountIndex: 0,
    accounts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const accounts = Array.from({ length: initialAccountCount }, (_, offset) =>
    deriveAccountRecord(group, offset, offset === 0),
  );

  return {
    ...group,
    nextAccountIndex: initialAccountCount,
    accounts,
  };
}

export function createInitialBrowserVaultState(options: BrowserVaultStateOptions = {}): BrowserVaultState {
  const group = createVaultGroupRecord(options.groupName ?? DEFAULT_BROWSER_VAULT_GROUP_NAME, {
    mnemonicPhrase: options.mnemonicPhrase,
    initialAccountCount: options.initialAccountCount,
    derivationPathBase: options.derivationPathBase,
  });

  return {
    schemaVersion: BROWSER_VAULT_SCHEMA_VERSION,
    activeGroupId: group.id,
    groups: [group],
  };
}

export function getActiveBrowserVaultGroup(state: BrowserVaultState) {
  return state.groups.find((group) => group.id === state.activeGroupId) ?? state.groups[0] ?? null;
}

export function addBrowserVaultGroup(state: BrowserVaultState, name: string, options: BrowserVaultStateOptions = {}) {
  const group = createVaultGroupRecord(name, options);
  return {
    ...state,
    activeGroupId: group.id,
    groups: [...state.groups, group],
  } satisfies BrowserVaultState;
}

export function renameBrowserVaultGroup(
  state: BrowserVaultState,
  groupId: string,
  name: string,
): BrowserVaultState {
  return {
    ...state,
    groups: state.groups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            name,
            updatedAt: nowIso(),
          }
        : group,
    ),
  };
}

export function selectBrowserVaultGroup(state: BrowserVaultState, groupId: string): BrowserVaultState {
  if (!state.groups.some((group) => group.id === groupId)) {
    return state;
  }
  return {
    ...state,
    activeGroupId: groupId,
  };
}

export function deriveBrowserVaultAccounts(
  state: BrowserVaultState,
  groupId: string,
  count: number,
): BrowserVaultState {
  if (count <= 0) {
    return state;
  }

  return {
    ...state,
    groups: state.groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      const nextIndex = group.nextAccountIndex;
      const newAccounts = Array.from({ length: count }, (_, offset) =>
        deriveAccountRecord(group, nextIndex + offset, group.accounts.length === 0 && offset === 0),
      );
      const hasSelectedAccount = group.accounts.some((account) => account.selected);

      return {
        ...group,
        accounts: [
          ...group.accounts.map((account) => ({
            ...account,
            selected: account.selected || (!hasSelectedAccount && newAccounts.length > 0 && false),
          })),
          ...newAccounts.map((account, index) => ({
            ...account,
            selected: index === 0 && !hasSelectedAccount,
          })),
        ],
        nextAccountIndex: nextIndex + count,
        updatedAt: nowIso(),
      };
    }),
  };
}

export function selectBrowserVaultAccount(
  state: BrowserVaultState,
  groupId: string,
  accountId: string,
): BrowserVaultState {
  return {
    ...state,
    groups: state.groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      const accountExists = group.accounts.some((account) => account.id === accountId);
      if (!accountExists) {
        return group;
      }

      return {
        ...group,
        accounts: group.accounts.map((account) => ({
          ...account,
          selected: account.id === accountId,
          updatedAt: account.id === accountId ? nowIso() : account.updatedAt,
        })),
        updatedAt: nowIso(),
      };
    }),
  };
}

export function renameBrowserVaultAccount(
  state: BrowserVaultState,
  groupId: string,
  accountId: string,
  label: string,
): BrowserVaultState {
  return {
    ...state,
    groups: state.groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      return {
        ...group,
        accounts: group.accounts.map((account) =>
          account.id === accountId
            ? {
                ...account,
                label,
                updatedAt: nowIso(),
              }
            : account,
        ),
        updatedAt: nowIso(),
      };
    }),
  };
}
