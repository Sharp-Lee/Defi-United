# P13 Execution Queue And History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P13 queue/history foundation: redacted durable history, session-only active queue state, nonce-ordered execution engine with injected signer/broadcaster, and a real `队列/历史` workspace without exposing arbitrary production send forms.

**Architecture:** Implement pure queue/history domain code first, then localStorage adapters, then the execution scheduler, then React UI integration. The queue engine is testable with injected fake signer/broadcaster/clock adapters; production P13 UI shows queue/history controls and redacted export surfaces, but no business send workflow or arbitrary transaction constructor.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, Playwright production-preview smoke tests, ethers v6 address utilities, existing browser vault/session, existing chain/RPC config, existing PWA shell.

---

## File Structure

- Create: `src/core/queue/queueTypes.ts`
  - Queue job, transaction, policy, draft, redaction, and history types.
- Create: `src/core/queue/queueRedaction.ts`
  - Sanitizers for RPC URLs, API tokens, private keys, mnemonics, raw signed tx, local paths, and serialized vault material.
- Create: `src/core/queue/queueHistory.ts`
  - Pure helpers for default history state, validation, append/update/export, and no-secret canonical persistence.
- Create: `src/core/queue/queueExecution.ts`
  - Pure/injected queue runner, nonce assignment, lane scheduling, stop/resume/retry/rerun transitions, signer/broadcaster interfaces.
- Create: `src/core/queue/index.ts`
  - Public re-exports.
- Create: `src/core/queue/queueRedaction.test.ts`
- Create: `src/core/queue/queueHistory.test.ts`
- Create: `src/core/queue/queueExecution.test.ts`
- Create: `src/lib/browserQueueHistory.ts`
  - localStorage and memory adapters for redacted durable history only.
- Create: `src/lib/browserQueueHistory.test.ts`
- Create: `src/features/queue/QueueModule.tsx`
  - Feature wrapper.
- Create: `src/features/queue/PwaQueueHistoryWorkspace.tsx`
  - Queue/history UI, session policy controls, stop/resume/retry/export controls, tables, locked/empty states.
- Create: `src/features/queue/PwaQueueHistoryWorkspace.test.tsx`
- Modify: `src/app/PwaShell.tsx`
  - Load/persist queue history, own session-only active queue state/policy, render queue workspace.
- Modify: `src/app/PwaShell.test.tsx`
  - Shell integration tests for queue page, locked state, no arbitrary send controls, redacted export.
- Modify: `src/app/shell/navigation.ts`
  - Mark `queueHistory` as `ready`.
- Modify: `src/app/shell/AppShell.tsx`
  - Accept and forward `queueContent`.
- Modify: `src/app/shell/AppWorkspace.tsx`
  - Render `queueContent` for `queueHistory`.
- Modify: `src/app/shell/AppPreviewRail.tsx`
  - Update P13 wording: queue/history is available, business send workflows still gated.
- Modify: `tests/browser/pwa-smoke.spec.ts`
  - Production-preview desktop/mobile smoke opens `队列/历史` and verifies no arbitrary send form.
- Modify at milestone close: `README.md`, `docs/specs/evm-wallet-workbench.md`, `docs/superpowers/project-overview.md`, `docs/superpowers/roadmap.md`, `docs/superpowers/project-status.md`
  - Current capability wording and P13 status.

---

## Task 1: Queue Types, Redaction, And History Model

**Files:**
- Create: `src/core/queue/queueTypes.ts`
- Create: `src/core/queue/queueRedaction.ts`
- Create: `src/core/queue/queueHistory.ts`
- Create: `src/core/queue/index.ts`
- Create: `src/core/queue/queueRedaction.test.ts`
- Create: `src/core/queue/queueHistory.test.ts`

- [ ] **Step 1: Write failing redaction tests**

Create `src/core/queue/queueRedaction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeQueueMessage, summarizeCalldata, summarizeSignedMaterial } from "./queueRedaction";

describe("queue redaction", () => {
  it("removes URLs, API tokens, bearer tokens, passwords, vault material, private keys, mnemonics, raw signed tx, and local paths", () => {
    const sensitive = [
      "https://rpc.example.com/project/secret-token?apiKey=abc123",
      "Authorization: Bearer eyJhbGciOiJsecret",
      "x-api-key: sk_live_1234567890",
      "password hunter2",
      "{\"ciphertext\":\"vault-ciphertext-secret\",\"iv\":\"vault-iv-secret\",\"salt\":\"vault-salt-secret\"}",
      "private key 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "mnemonic abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      "raw signed tx 0xf86c808504a817c80082520894aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa880de0b6b3a76400008025a0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbba0cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "/Users/wukong/mylife/Defi-United/.secret/file.json",
    ].join(" ");

    const sanitized = sanitizeQueueMessage(sensitive);

    expect(sanitized).toContain("[redacted-url]");
    expect(sanitized).toContain("[redacted-bearer]");
    expect(sanitized).toContain("[redacted-token]");
    expect(sanitized).toContain("[redacted-password]");
    expect(sanitized).toContain("[redacted-vault-material]");
    expect(sanitized).toContain("[redacted-hex-secret]");
    expect(sanitized).toContain("[redacted-mnemonic]");
    expect(sanitized).toContain("[redacted-path]");
    expect(sanitized).not.toContain("secret-token");
    expect(sanitized).not.toContain("apiKey");
    expect(sanitized).not.toContain("hunter2");
    expect(sanitized).not.toContain("vault-ciphertext-secret");
    expect(sanitized).not.toContain("sk_live");
    expect(sanitized).not.toContain("abandon abandon");
    expect(sanitized).not.toContain("/Users/wukong");
    expect(sanitized).not.toMatch(/0x[0-9a-f]{64,}/i);
  });

  it("keeps only selector and byte length for calldata summaries", () => {
    expect(summarizeCalldata("0xa9059cbb0000000000000000000000001111111111111111111111111111111111111111")).toEqual({
      byteLength: 36,
      selector: "0xa9059cbb",
      summary: "0xa9059cbb · 36 bytes",
    });
    expect(summarizeCalldata("0x")).toEqual({ byteLength: 0, selector: null, summary: "empty calldata" });
  });

  it("never exposes signed material in summaries", () => {
    const summary = summarizeSignedMaterial("0xf86c808504a817c80082520894aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    expect(summary).toBe("[redacted-signed-transaction]");
    expect(summary).not.toContain("f86c");
  });
});
```

- [ ] **Step 2: Write failing history model tests**

Create `src/core/queue/queueHistory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  appendQueueHistoryRecords,
  createDefaultQueueHistoryState,
  createDefaultQueuePolicy,
  exportRedactedQueueHistory,
  validateQueueHistoryState,
} from "./queueHistory";
import type { QueueTransactionRecord } from "./queueTypes";

function tx(overrides: Partial<QueueTransactionRecord> = {}): QueueTransactionRecord {
  return {
    id: "tx-1",
    jobId: "job-1",
    chainId: 1,
    accountId: "account-1",
    accountAddress: "0x0000000000000000000000000000000000000001",
    nonce: 7,
    status: "pending",
    actionType: "raw-calldata",
    target: "0x0000000000000000000000000000000000000002",
    valueWei: "0",
    calldataSummary: { selector: "0x64617461", byteLength: 16, summary: "0x64617461 · 16 bytes" },
    feeSummary: { mode: "eip1559", gasLimit: "21000", maxFeePerGasGwei: "30", maxPriorityFeePerGasGwei: "1.5" },
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    error: null,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("queue history model", () => {
  it("uses safe defaults for queue policy", () => {
    expect(createDefaultQueuePolicy()).toEqual({
      concurrency: 20,
      continueOnFailure: true,
      rerunFromFailedNonce: true,
      rpcRequestsPerSecond: 20,
      walletIntervalMs: 0,
    });
  });

  it("appends redacted transaction records without persisting raw signed material", () => {
    const state = appendQueueHistoryRecords(createDefaultQueueHistoryState(), {
      jobs: [
        {
          id: "job-1",
          chainId: 1,
          title: "测试任务",
          sourceModule: "queue",
          status: "partial",
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z",
          executionPolicy: createDefaultQueuePolicy(),
          transactionIds: ["tx-1"],
          summary: { total: 1, pending: 1, failed: 0, stopped: 0, completed: 0 },
        },
      ],
      transactions: [
        tx({
          error: {
            category: "broadcast-failed",
            message: "failed at https://rpc.example.com/key/secret?apiKey=abc raw 0xf86c808504a817c80082520894aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            retryable: true,
          },
        }),
      ],
    });

    const serialized = JSON.stringify(state);
    expect(serialized).toContain("[redacted-url]");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("f86c8085");
    expect(validateQueueHistoryState(state).transactions).toHaveLength(1);
  });

  it("exports redacted JSON only", () => {
    const state = appendQueueHistoryRecords(createDefaultQueueHistoryState(), {
      jobs: [],
      transactions: [
        tx({
          error: {
            category: "signing-failed",
            message: "private key 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            retryable: false,
          },
        }),
      ],
    });

    const exported = exportRedactedQueueHistory(state);

    expect(exported).toContain("signing-failed");
    expect(exported).toContain("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(exported).not.toContain("private key");
    expect(exported).not.toContain("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/core/queue/queueRedaction.test.ts src/core/queue/queueHistory.test.ts
```

Expected: FAIL because the new modules do not exist yet.

- [ ] **Step 4: Implement queue types**

Create `src/core/queue/queueTypes.ts`:

```ts
export type QueueJobStatus = "draft" | "queued" | "running" | "stopping" | "stopped" | "completed" | "partial" | "failed";

export type QueueTransactionStatus =
  | "draft"
  | "queued"
  | "nonce-ready"
  | "signing"
  | "broadcasting"
  | "pending"
  | "failed"
  | "skipped"
  | "stopped";

export type QueueSourceModule = "queue" | "distribution" | "inscription" | "contract-call" | "reverse-parse";

export type QueueActionType = "native-transfer" | "erc20-transfer" | "contract-call" | "raw-calldata" | "approval" | "unknown";

export type QueueErrorCategory =
  | "chain-mismatch"
  | "no-rpc"
  | "vault-locked"
  | "account-not-found"
  | "nonce-load-failed"
  | "session-drafts-unavailable"
  | "signing-failed"
  | "broadcast-failed"
  | "rpc-rate-limited"
  | "user-stopped"
  | "nonce-consumed"
  | "unknown";

export interface QueueExecutionPolicy {
  concurrency: number;
  walletIntervalMs: number;
  rpcRequestsPerSecond: number;
  continueOnFailure: boolean;
  rerunFromFailedNonce: boolean;
}

export interface QueueJobSummary {
  total: number;
  pending: number;
  failed: number;
  stopped: number;
  completed: number;
}

export interface QueueJobRecord {
  id: string;
  chainId: number;
  title: string;
  sourceModule: QueueSourceModule;
  status: QueueJobStatus;
  createdAt: string;
  updatedAt: string;
  executionPolicy: QueueExecutionPolicy;
  transactionIds: string[];
  summary: QueueJobSummary;
}

export interface RedactedCalldataSummary {
  selector: string | null;
  byteLength: number;
  summary: string;
}

export type QueueFeeSummary =
  | {
      mode: "eip1559";
      gasLimit: string;
      maxFeePerGasGwei: string;
      maxPriorityFeePerGasGwei: string;
    }
  | {
      mode: "legacy";
      gasLimit: string;
      gasPriceGwei: string;
    };

export interface QueueExecutionError {
  category: QueueErrorCategory;
  message: string;
  retryable: boolean;
}

export interface QueueTransactionRecord {
  id: string;
  jobId: string;
  chainId: number;
  accountId: string;
  accountAddress: string;
  nonce: number | null;
  status: QueueTransactionStatus;
  actionType: QueueActionType;
  target: string | null;
  valueWei: string;
  calldataSummary: RedactedCalldataSummary;
  feeSummary: QueueFeeSummary;
  txHash: string | null;
  error: QueueExecutionError | null;
  retryOfTransactionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueHistoryState {
  schemaVersion: 1;
  updatedAt: string;
  jobs: QueueJobRecord[];
  transactions: QueueTransactionRecord[];
}

export interface QueueFeeDraft {
  mode: "eip1559" | "legacy";
  gasLimit: string;
  gasPriceGwei?: string;
  maxFeePerGasGwei?: string;
  maxPriorityFeePerGasGwei?: string;
}

export interface QueueTransactionPreview {
  title: string;
  description: string;
  calldata: RedactedCalldataSummary;
}

export interface PreparedQueueTransactionDraft {
  id: string;
  chainId: number;
  accountId: string;
  accountAddress: string;
  to: string | null;
  valueWei: string;
  data: string;
  gasLimit: string;
  fee: QueueFeeDraft;
  actionType: QueueActionType;
  preview: QueueTransactionPreview;
  retryOfTransactionId?: string | null;
}
```

- [ ] **Step 5: Implement redaction helpers**

Create `src/core/queue/queueRedaction.ts`:

```ts
import type { RedactedCalldataSummary } from "./queueTypes";

const HEX_SECRET_PATTERN = /0x[0-9a-fA-F]{64,}/g;
const MNEMONIC_PATTERN =
  /\b(?:abandon|ability|able|about|above|absent|absorb|abstract|absurd|abuse|access|accident)(?:\s+(?:abandon|ability|able|about|above|absent|absorb|abstract|absurd|abuse|access|accident)){5,}\b/gi;
const TOKEN_PATTERN = /\b(?:x-api-key|api[_-]?key|rpc[_-]?token|token|secret)\s*[:=]\s*[A-Za-z0-9._~+/=-]{8,}/gi;
const PASSWORD_PATTERN = /\b(?:password|passphrase|vault password)\s*(?:[:=]|\s+is\s+|\s+)[^\s"'<>]+/gi;
const VAULT_MATERIAL_PATTERN = /"?(?:ciphertext|privateKey|mnemonic|password|salt|iv)"?\s*:\s*"[^"]+"/gi;

export function sanitizeQueueMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return raw
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted-bearer]")
    .replace(TOKEN_PATTERN, "[redacted-token]")
    .replace(PASSWORD_PATTERN, "[redacted-password]")
    .replace(VAULT_MATERIAL_PATTERN, "[redacted-vault-material]")
    .replace(/[?&][A-Za-z0-9_.~-]*(?:api|token|key|secret)[A-Za-z0-9_.~-]*=[^\s"'<>]+/gi, "[redacted-query]")
    .replace(/\/Users\/[^\s"'<>]+/g, "[redacted-path]")
    .replace(/\/home\/[^\s"'<>]+/g, "[redacted-path]")
    .replace(MNEMONIC_PATTERN, "[redacted-mnemonic]")
    .replace(HEX_SECRET_PATTERN, "[redacted-hex-secret]")
    .trim();
}

export function summarizeCalldata(data: string): RedactedCalldataSummary {
  const normalized = data.trim();
  if (!/^0x[0-9a-fA-F]*$/.test(normalized) || normalized.length % 2 !== 0) {
    return { selector: null, byteLength: 0, summary: "invalid calldata" };
  }
  const byteLength = (normalized.length - 2) / 2;
  if (byteLength === 0) {
    return { selector: null, byteLength: 0, summary: "empty calldata" };
  }
  const selector = byteLength >= 4 ? normalized.slice(0, 10).toLowerCase() : null;
  return {
    selector,
    byteLength,
    summary: `${selector ?? "0x"} · ${byteLength} bytes`,
  };
}

export function summarizeSignedMaterial(_rawSignedTransaction: string) {
  return "[redacted-signed-transaction]";
}
```

- [ ] **Step 6: Implement queue history model**

Create `src/core/queue/queueHistory.ts`:

```ts
import { getAddress, isAddress } from "ethers/address";
import { sanitizeQueueMessage, summarizeCalldata } from "./queueRedaction";
import type {
  QueueExecutionPolicy,
  QueueHistoryState,
  QueueJobRecord,
  QueueTransactionRecord,
} from "./queueTypes";

export const QUEUE_HISTORY_SCHEMA_VERSION = 1;
const INVALID_QUEUE_HISTORY = "Invalid queue history state.";

function nowIso() {
  return new Date().toISOString();
}

function assertIso(value: string) {
  if (value.trim() !== value || new Date(Date.parse(value)).toISOString() !== value) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
}

function normalizeAddressOrNull(value: string | null) {
  if (value === null) return null;
  if (!isAddress(value)) throw new Error(INVALID_QUEUE_HISTORY);
  return getAddress(value);
}

export function createDefaultQueuePolicy(): QueueExecutionPolicy {
  return {
    concurrency: 20,
    continueOnFailure: true,
    rerunFromFailedNonce: true,
    rpcRequestsPerSecond: 20,
    walletIntervalMs: 0,
  };
}

export function createDefaultQueueHistoryState(): QueueHistoryState {
  return {
    schemaVersion: QUEUE_HISTORY_SCHEMA_VERSION,
    updatedAt: nowIso(),
    jobs: [],
    transactions: [],
  };
}

function sanitizeTransaction(record: QueueTransactionRecord): QueueTransactionRecord {
  return {
    ...record,
    accountAddress: getAddress(record.accountAddress),
    target: normalizeAddressOrNull(record.target),
    calldataSummary: {
      ...record.calldataSummary,
      summary: sanitizeQueueMessage(record.calldataSummary.summary),
    },
    error: record.error
      ? {
          ...record.error,
          message: sanitizeQueueMessage(record.error.message),
        }
      : null,
  };
}

function validatePolicy(policy: QueueExecutionPolicy): QueueExecutionPolicy {
  if (
    !Number.isInteger(policy.concurrency) ||
    policy.concurrency < 1 ||
    policy.concurrency > 100 ||
    !Number.isInteger(policy.walletIntervalMs) ||
    policy.walletIntervalMs < 0 ||
    policy.walletIntervalMs > 60_000 ||
    !Number.isInteger(policy.rpcRequestsPerSecond) ||
    policy.rpcRequestsPerSecond < 1 ||
    policy.rpcRequestsPerSecond > 500 ||
    typeof policy.continueOnFailure !== "boolean" ||
    typeof policy.rerunFromFailedNonce !== "boolean"
  ) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  return policy;
}

function validateJob(job: QueueJobRecord): QueueJobRecord {
  if (
    typeof job.id !== "string" ||
    typeof job.chainId !== "number" ||
    !Number.isInteger(job.chainId) ||
    job.chainId <= 0 ||
    typeof job.title !== "string" ||
    !Array.isArray(job.transactionIds)
  ) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  assertIso(job.createdAt);
  assertIso(job.updatedAt);
  return {
    ...job,
    executionPolicy: validatePolicy(job.executionPolicy),
    title: sanitizeQueueMessage(job.title),
  };
}

function validateTransaction(record: QueueTransactionRecord): QueueTransactionRecord {
  if (
    typeof record.id !== "string" ||
    typeof record.jobId !== "string" ||
    typeof record.chainId !== "number" ||
    !Number.isInteger(record.chainId) ||
    record.chainId <= 0 ||
    typeof record.accountId !== "string" ||
    typeof record.accountAddress !== "string" ||
    (record.nonce !== null && (!Number.isInteger(record.nonce) || record.nonce < 0)) ||
    typeof record.valueWei !== "string" ||
    typeof record.txHash !== "string" && record.txHash !== null
  ) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  assertIso(record.createdAt);
  assertIso(record.updatedAt);
  return sanitizeTransaction(record);
}

export function validateQueueHistoryState(value: unknown): QueueHistoryState {
  if (!value || typeof value !== "object") throw new Error(INVALID_QUEUE_HISTORY);
  const state = value as QueueHistoryState;
  if (
    state.schemaVersion !== QUEUE_HISTORY_SCHEMA_VERSION ||
    typeof state.updatedAt !== "string" ||
    !Array.isArray(state.jobs) ||
    !Array.isArray(state.transactions)
  ) {
    throw new Error(INVALID_QUEUE_HISTORY);
  }
  assertIso(state.updatedAt);
  return {
    schemaVersion: QUEUE_HISTORY_SCHEMA_VERSION,
    updatedAt: state.updatedAt,
    jobs: state.jobs.map(validateJob),
    transactions: state.transactions.map(validateTransaction),
  };
}

export function appendQueueHistoryRecords(
  state: QueueHistoryState,
  records: { jobs: QueueJobRecord[]; transactions: QueueTransactionRecord[] },
): QueueHistoryState {
  return validateQueueHistoryState({
    schemaVersion: QUEUE_HISTORY_SCHEMA_VERSION,
    updatedAt: nowIso(),
    jobs: [...state.jobs, ...records.jobs],
    transactions: [...state.transactions, ...records.transactions],
  });
}

export function createQueueTransactionRecord(input: Omit<QueueTransactionRecord, "calldataSummary"> & { data: string }) {
  const { data, ...record } = input;
  return validateTransaction({
    ...record,
    calldataSummary: summarizeCalldata(data),
  });
}

export function exportRedactedQueueHistory(state: QueueHistoryState) {
  return JSON.stringify(validateQueueHistoryState(state), null, 2);
}
```

- [ ] **Step 7: Add public re-export**

Create `src/core/queue/index.ts`:

```ts
export * from "./queueHistory";
export * from "./queueRedaction";
export * from "./queueTypes";
```

- [ ] **Step 8: Verify Task 1**

Run:

```bash
npm test -- src/core/queue/queueRedaction.test.ts src/core/queue/queueHistory.test.ts
npm run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 9: Controller commit gate for Task 1**

Controller only, after spec and quality review pass:

```bash
git add src/core/queue docs/superpowers/project-status.md
git diff --cached --check
git commit -m "feat: add queue history model"
git push
```

---

## Task 2: Queue History Browser Storage

**Files:**
- Create: `src/lib/browserQueueHistory.ts`
- Create: `src/lib/browserQueueHistory.test.ts`
- Modify: `src/core/queue/index.ts`

- [ ] **Step 1: Write failing storage tests**

Create `src/lib/browserQueueHistory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  appendQueueHistoryRecords,
  createDefaultQueueHistoryState,
  createDefaultQueuePolicy,
  type QueueTransactionRecord,
} from "../core/queue";
import {
  createMemoryBrowserQueueHistoryStorage,
  loadBrowserQueueHistoryState,
  saveBrowserQueueHistoryState,
} from "./browserQueueHistory";

function tx(): QueueTransactionRecord {
  return {
    id: "tx-1",
    jobId: "job-1",
    chainId: 1,
    accountId: "account-1",
    accountAddress: "0x0000000000000000000000000000000000000001",
    nonce: 1,
    status: "failed",
    actionType: "raw-calldata",
    target: "0x0000000000000000000000000000000000000002",
    valueWei: "0",
    calldataSummary: { selector: "0x64617461", byteLength: 4, summary: "0x64617461 · 4 bytes" },
    feeSummary: { mode: "eip1559", gasLimit: "21000", maxFeePerGasGwei: "30", maxPriorityFeePerGasGwei: "1.5" },
    txHash: null,
    error: { category: "broadcast-failed", message: "raw 0xf86c808504a817c80082520894aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", retryable: true },
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
  };
}

describe("browser queue history storage", () => {
  it("loads an empty default state", async () => {
    const storage = createMemoryBrowserQueueHistoryStorage();

    await expect(loadBrowserQueueHistoryState(storage)).resolves.toMatchObject({
      schemaVersion: 1,
      jobs: [],
      transactions: [],
    });
  });

  it("persists redacted history but not active drafts or signed transactions", async () => {
    const storage = createMemoryBrowserQueueHistoryStorage();
    const state = appendQueueHistoryRecords(createDefaultQueueHistoryState(), {
      jobs: [
        {
          id: "job-1",
          chainId: 1,
          title: "History job",
          sourceModule: "queue",
          status: "failed",
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z",
          executionPolicy: createDefaultQueuePolicy(),
          transactionIds: ["tx-1"],
          summary: { total: 1, pending: 0, failed: 1, stopped: 0, completed: 0 },
        },
      ],
      transactions: [tx()],
    });

    await saveBrowserQueueHistoryState(state, storage);
    const reloaded = await loadBrowserQueueHistoryState(storage);
    const serialized = JSON.stringify(reloaded);

    expect(reloaded.transactions).toHaveLength(1);
    expect(serialized).not.toContain("f86c8085");
    expect(serialized).not.toContain("preparedDraft");
    expect(serialized).not.toContain("rawUnsignedTransaction");
    expect(serialized).not.toMatch(/private|mnemonic|password|signedTransaction/i);
  });
});
```

- [ ] **Step 2: Run storage tests to verify they fail**

Run:

```bash
npm test -- src/lib/browserQueueHistory.test.ts
```

Expected: FAIL because `browserQueueHistory` does not exist.

- [ ] **Step 3: Implement browser history storage**

Create `src/lib/browserQueueHistory.ts`:

```ts
import {
  createDefaultQueueHistoryState,
  validateQueueHistoryState,
  type QueueHistoryState,
} from "../core/queue";

const STORAGE_KEY = "defi-united-pwa-queue-history";

export interface BrowserQueueHistoryStorage {
  loadState(): Promise<QueueHistoryState>;
  saveState(state: QueueHistoryState): Promise<void>;
  clearState(): Promise<void>;
}

function getLocalStorage() {
  if (!globalThis.localStorage) {
    throw new Error("Browser queue history storage is unavailable in this browser context.");
  }
  return globalThis.localStorage;
}

function toPersistedState(state: QueueHistoryState): QueueHistoryState {
  return validateQueueHistoryState(state);
}

export const localStorageBrowserQueueHistoryStorage = {
  async loadState() {
    const serialized = getLocalStorage().getItem(STORAGE_KEY);
    if (!serialized) return createDefaultQueueHistoryState();
    return toPersistedState(JSON.parse(serialized));
  },
  async saveState(state: QueueHistoryState) {
    getLocalStorage().setItem(STORAGE_KEY, JSON.stringify(toPersistedState(state)));
  },
  async clearState() {
    getLocalStorage().removeItem(STORAGE_KEY);
  },
} satisfies BrowserQueueHistoryStorage;

export function createMemoryBrowserQueueHistoryStorage(initialState?: QueueHistoryState) {
  let state = initialState ? toPersistedState(initialState) : createDefaultQueueHistoryState();
  return {
    async loadState() {
      return toPersistedState(state);
    },
    async saveState(nextState: QueueHistoryState) {
      state = toPersistedState(nextState);
    },
    async clearState() {
      state = createDefaultQueueHistoryState();
    },
  } satisfies BrowserQueueHistoryStorage;
}

export async function loadBrowserQueueHistoryState(
  storage: BrowserQueueHistoryStorage = localStorageBrowserQueueHistoryStorage,
) {
  return storage.loadState();
}

export async function saveBrowserQueueHistoryState(
  state: QueueHistoryState,
  storage: BrowserQueueHistoryStorage = localStorageBrowserQueueHistoryStorage,
) {
  await storage.saveState(state);
}
```

- [ ] **Step 4: Verify Task 2**

Run:

```bash
npm test -- src/lib/browserQueueHistory.test.ts src/core/queue/queueHistory.test.ts src/core/queue/queueRedaction.test.ts
npm run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Controller commit gate for Task 2**

Controller only, after spec and quality review pass:

```bash
git add src/lib/browserQueueHistory.ts src/lib/browserQueueHistory.test.ts src/core/queue/index.ts docs/superpowers/project-status.md
git diff --cached --check
git commit -m "feat: persist redacted queue history"
git push
```

---

## Task 3: Queue Execution Engine

**Files:**
- Create: `src/core/queue/queueExecution.ts`
- Create: `src/core/queue/queueExecution.test.ts`
- Modify: `src/core/queue/index.ts`

- [ ] **Step 1: Write failing queue execution tests**

Create `src/core/queue/queueExecution.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createDefaultQueuePolicy } from "./queueHistory";
import {
  rerunQueueFromFailedNonce,
  resumeStoppedQueueJob,
  retryFailedQueueJob,
  runQueueJob,
  type QueueBroadcaster,
  type QueueClock,
  type QueueSigner,
} from "./queueExecution";
import type { PreparedQueueTransactionDraft, QueueTransactionRecord } from "./queueTypes";

const baseDraft = {
  chainId: 1,
  to: "0x00000000000000000000000000000000000000AA",
  valueWei: "0",
  data: "0x64617461",
  gasLimit: "21000",
  fee: { mode: "eip1559", gasLimit: "21000", maxFeePerGasGwei: "30", maxPriorityFeePerGasGwei: "1.5" },
  actionType: "raw-calldata",
  preview: { title: "测试", description: "测试 calldata", calldata: { selector: "0x64617461", byteLength: 4, summary: "0x64617461 · 4 bytes" } },
} satisfies Omit<PreparedQueueTransactionDraft, "id" | "accountId" | "accountAddress">;

function draft(id: string, accountId: string, accountAddress: string): PreparedQueueTransactionDraft {
  return { ...baseDraft, id, accountId, accountAddress };
}

function signer(): QueueSigner {
  return {
    signTransaction: vi.fn(async (_accountId, request) => `0xsigned-${request.nonce}-${request.from}`),
  };
}

function deterministicClock(): QueueClock & { sleeps: number[] } {
  let nowMs = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => nowMs,
    sleep: vi.fn(async (ms) => {
      sleeps.push(ms);
      nowMs += ms;
    }),
  };
}

function historicalTx(overrides: Partial<QueueTransactionRecord>): QueueTransactionRecord {
  return {
    id: "old-a1",
    jobId: "old-job",
    chainId: 1,
    accountId: "account-1",
    accountAddress: "0x0000000000000000000000000000000000000001",
    nonce: 10,
    status: "failed",
    actionType: "raw-calldata",
    target: "0x00000000000000000000000000000000000000AA",
    valueWei: "0",
    calldataSummary: { selector: "0x64617461", byteLength: 4, summary: "0x64617461 · 4 bytes" },
    feeSummary: { mode: "eip1559", gasLimit: "21000", maxFeePerGasGwei: "30", maxPriorityFeePerGasGwei: "1.5" },
    txHash: null,
    error: { category: "broadcast-failed", message: "RPC failed", retryable: true },
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    ...overrides,
  };
}

function broadcaster(overrides: Partial<QueueBroadcaster> = {}): QueueBroadcaster {
  return {
    validateChainId: vi.fn(async () => 1),
    getPendingNonce: vi.fn(async (account) => (account.endsWith("1") ? 10 : 20)),
    broadcastSignedTransaction: vi.fn(async (raw) => `0xhash-${raw}`),
    ...overrides,
  };
}

describe("queue execution engine", () => {
  it("assigns sequential nonces per account and runs different accounts through injected signer/broadcaster", async () => {
    const queueSigner = signer();
    const queueBroadcaster = broadcaster();
    const result = await runQueueJob({
      chainId: 1,
      title: "测试队列",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("a2", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("b1", "account-2", "0x0000000000000000000000000000000000000002"),
      ],
      policy: createDefaultQueuePolicy(),
      signer: queueSigner,
      broadcaster: queueBroadcaster,
    });

    expect(result.job.status).toBe("completed");
    expect(result.transactions.map((tx) => [tx.accountId, tx.nonce, tx.status])).toEqual([
      ["account-1", 10, "pending"],
      ["account-1", 11, "pending"],
      ["account-2", 20, "pending"],
    ]);
    expect(JSON.stringify(result)).not.toContain("0xsigned");
  });

  it("blocks signing when chain validation mismatches", async () => {
    const queueSigner = signer();
    const result = await runQueueJob({
      chainId: 1,
      title: "wrong chain",
      sourceModule: "queue",
      drafts: [draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      policy: createDefaultQueuePolicy(),
      signer: queueSigner,
      broadcaster: broadcaster({ validateChainId: vi.fn(async () => 8453) }),
    });

    expect(result.job.status).toBe("failed");
    expect(result.transactions[0].status).toBe("failed");
    expect(result.transactions[0].error?.category).toBe("chain-mismatch");
    expect(queueSigner.signTransaction).not.toHaveBeenCalled();
  });

  it("records signing failures separately from broadcast failures", async () => {
    const queueSigner: QueueSigner = {
      signTransaction: vi.fn(async () => {
        throw new Error("password hunter2 raw request should be sanitized");
      }),
    };

    const result = await runQueueJob({
      chainId: 1,
      title: "signing failure",
      sourceModule: "queue",
      drafts: [draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      policy: createDefaultQueuePolicy(),
      signer: queueSigner,
      broadcaster: broadcaster(),
    });

    expect(result.transactions[0].status).toBe("failed");
    expect(result.transactions[0].error?.category).toBe("signing-failed");
    expect(result.transactions[0].error?.message).toContain("[redacted-password]");
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("stops later same-account nonces after a failed nonce while allowing other accounts to continue", async () => {
    const result = await runQueueJob({
      chainId: 1,
      title: "partial",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("a2", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("b1", "account-2", "0x0000000000000000000000000000000000000002"),
      ],
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: broadcaster({
        broadcastSignedTransaction: vi.fn(async (raw) => {
          if (raw.includes("10-")) throw new Error("https://rpc.example.com/key/secret-token failed");
          return `0xhash-${raw}`;
        }),
      }),
    });

    expect(result.job.status).toBe("partial");
    expect(result.transactions.map((tx) => [tx.accountId, tx.nonce, tx.status, tx.error?.category ?? null])).toEqual([
      ["account-1", 10, "failed", "broadcast-failed"],
      ["account-1", 11, "stopped", "user-stopped"],
      ["account-2", 20, "pending", null],
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("stops queued work when continueOnFailure is false", async () => {
    const result = await runQueueJob({
      chainId: 1,
      title: "stop on first failure",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("b1", "account-2", "0x0000000000000000000000000000000000000002"),
      ],
      policy: { ...createDefaultQueuePolicy(), concurrency: 1, continueOnFailure: false },
      signer: signer(),
      broadcaster: broadcaster({
        broadcastSignedTransaction: vi.fn(async (raw) => {
          if (raw.includes("10-")) throw new Error("first account failed");
          return `0xhash-${raw}`;
        }),
      }),
    });

    expect(result.transactions.map((tx) => [tx.accountId, tx.status, tx.error?.category ?? null])).toEqual([
      ["account-1", "failed", "broadcast-failed"],
      ["account-2", "stopped", "user-stopped"],
    ]);
  });

  it("honors stop signals before starting new broadcasts", async () => {
    let checks = 0;
    const result = await runQueueJob({
      chainId: 1,
      title: "stopped",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("a2", "account-1", "0x0000000000000000000000000000000000000001"),
      ],
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: broadcaster(),
      shouldStop: () => {
        checks += 1;
        return checks > 1;
      },
    });

    expect(result.transactions.map((tx) => [tx.nonce, tx.status, tx.error?.category ?? null])).toEqual([
      [10, "pending", null],
      [11, "stopped", "user-stopped"],
    ]);
  });

  it("limits active account lanes by concurrency", async () => {
    let activeSigners = 0;
    let maxActiveSigners = 0;
    const releases: Array<() => void> = [];
    const queueSigner: QueueSigner = {
      signTransaction: vi.fn(
        async (_accountId, request) =>
          new Promise<string>((resolve) => {
            activeSigners += 1;
            maxActiveSigners = Math.max(maxActiveSigners, activeSigners);
            releases.push(() => {
              activeSigners -= 1;
              resolve(`0xsigned-${request.nonce}-${request.from}`);
            });
          }),
      ),
    };

    const resultPromise = runQueueJob({
      chainId: 1,
      title: "concurrency",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("b1", "account-2", "0x0000000000000000000000000000000000000002"),
        draft("c1", "account-3", "0x0000000000000000000000000000000000000003"),
      ],
      policy: { ...createDefaultQueuePolicy(), concurrency: 2, rpcRequestsPerSecond: 100 },
      signer: queueSigner,
      broadcaster: broadcaster({ getPendingNonce: vi.fn(async () => 1) }),
    });

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(maxActiveSigners).toBe(2);
    releases.shift()?.();
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();

    const result = await resultPromise;
    expect(result.job.status).toBe("completed");
    expect(maxActiveSigners).toBe(2);
  });

  it("applies global RPC token bucket to chain validation, nonce reads, and broadcasts", async () => {
    const clock = deterministicClock();
    const queueBroadcaster = broadcaster();

    await runQueueJob({
      chainId: 1,
      title: "rate limited",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("a2", "account-1", "0x0000000000000000000000000000000000000001"),
      ],
      policy: { ...createDefaultQueuePolicy(), concurrency: 1, rpcRequestsPerSecond: 2 },
      signer: signer(),
      broadcaster: queueBroadcaster,
      clock,
    });

    expect(queueBroadcaster.validateChainId).toHaveBeenCalledTimes(1);
    expect(queueBroadcaster.getPendingNonce).toHaveBeenCalledTimes(1);
    expect(queueBroadcaster.broadcastSignedTransaction).toHaveBeenCalledTimes(2);
    expect(clock.sleeps).toContain(1000);
  });

  it("applies walletIntervalMs between same-account transaction starts only", async () => {
    const clock = deterministicClock();
    const signStarts: number[] = [];
    const queueSigner: QueueSigner = {
      signTransaction: vi.fn(async (_accountId, request) => {
        signStarts.push(clock.now());
        return `0xsigned-${request.nonce}-${request.from}`;
      }),
    };

    await runQueueJob({
      chainId: 1,
      title: "wallet interval",
      sourceModule: "queue",
      drafts: [
        draft("a1", "account-1", "0x0000000000000000000000000000000000000001"),
        draft("a2", "account-1", "0x0000000000000000000000000000000000000001"),
      ],
      policy: { ...createDefaultQueuePolicy(), concurrency: 1, walletIntervalMs: 250, rpcRequestsPerSecond: 100 },
      signer: queueSigner,
      broadcaster: broadcaster(),
      clock,
    });

    expect(signStarts).toEqual([0, 250]);
    expect(clock.sleeps).toContain(250);
  });

  it("cannot resume stopped durable history without current-tab prepared drafts", async () => {
    await expect(
      resumeStoppedQueueJob({
        chainId: 1,
        title: "resume",
        historyTransactions: [historicalTx({ id: "old-a2", nonce: 11, status: "stopped" })],
        sessionDraftsByTransactionId: new Map(),
        policy: createDefaultQueuePolicy(),
        signer: signer(),
        broadcaster: broadcaster(),
      }),
    ).rejects.toThrow(/current-tab prepared drafts/i);
  });

  it("resumes stopped transactions from current-tab drafts and refetches pending nonce", async () => {
    const queueBroadcaster = broadcaster({ getPendingNonce: vi.fn(async () => 42) });
    const result = await resumeStoppedQueueJob({
      chainId: 1,
      title: "resume",
      historyTransactions: [historicalTx({ id: "old-a2", nonce: 11, status: "stopped" })],
      sessionDraftsByTransactionId: new Map([
        ["old-a2", draft("a2", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    expect(queueBroadcaster.getPendingNonce).toHaveBeenCalledWith("0x0000000000000000000000000000000000000001");
    expect(result.transactions.map((tx) => [tx.nonce, tx.status])).toEqual([[42, "pending"]]);
  });

  it("retries failed transactions in place when pending nonce still equals failed nonce", async () => {
    const queueBroadcaster = broadcaster({ getPendingNonce: vi.fn(async () => 10) });
    const result = await retryFailedQueueJob({
      chainId: 1,
      title: "retry same nonce",
      historyTransactions: [historicalTx({ id: "old-a1", nonce: 10, status: "failed" })],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    expect(result.historyUpdates).toEqual([]);
    expect(result.transactions[0].retryOfTransactionId).toBe("old-a1");
    expect(result.transactions[0].nonce).toBe(10);
    expect(result.transactions[0].status).toBe("pending");
  });

  it("retries failed transactions with fresh pending nonce and marks stale failed nonce as consumed", async () => {
    const queueBroadcaster = broadcaster({ getPendingNonce: vi.fn(async () => 43) });
    const result = await retryFailedQueueJob({
      chainId: 1,
      title: "retry",
      historyTransactions: [historicalTx({ id: "old-a1", nonce: 10, status: "failed" })],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    expect(result.historyUpdates.map((tx) => [tx.id, tx.status, tx.error?.category])).toEqual([
      ["old-a1", "skipped", "nonce-consumed"],
    ]);
    expect(result.transactions[0].retryOfTransactionId).toBe("old-a1");
    expect(result.transactions[0].nonce).toBe(43);
    expect(result.transactions[0].status).toBe("pending");
  });

  it("reruns from the first failed nonce and skips later stale history records", async () => {
    const oldFailed = historicalTx({ id: "old-a1", nonce: 10, status: "failed" });
    const oldStopped = historicalTx({ id: "old-a2", nonce: 11, status: "stopped" });
    const queueBroadcaster = broadcaster({ getPendingNonce: vi.fn(async () => 50) });

    const result = await rerunQueueFromFailedNonce({
      chainId: 1,
      title: "rerun",
      historyTransactions: [oldFailed, oldStopped, historicalTx({ id: "old-b1", accountId: "account-2", nonce: 7, status: "pending" })],
      sessionDraftsByTransactionId: new Map([
        ["old-a1", draft("a1", "account-1", "0x0000000000000000000000000000000000000001")],
        ["old-a2", draft("a2", "account-1", "0x0000000000000000000000000000000000000001")],
      ]),
      policy: createDefaultQueuePolicy(),
      signer: signer(),
      broadcaster: queueBroadcaster,
    });

    expect(result.historyUpdates.map((tx) => [tx.id, tx.status, tx.error?.category])).toEqual([
      ["old-a1", "skipped", "nonce-consumed"],
      ["old-a2", "skipped", "nonce-consumed"],
    ]);
    expect(result.transactions.map((tx) => [tx.accountId, tx.nonce, tx.status, tx.retryOfTransactionId])).toEqual([
      ["account-1", 50, "pending", "old-a1"],
      ["account-1", 51, "pending", "old-a2"],
    ]);
    expect(result.transactions.map((tx) => tx.id)).not.toContain("old-a1");
    expect(result.transactions.map((tx) => tx.id)).not.toContain("old-a2");
  });
});
```

- [ ] **Step 2: Run execution tests to verify they fail**

Run:

```bash
npm test -- src/core/queue/queueExecution.test.ts
```

Expected: FAIL because `queueExecution` does not exist.

- [ ] **Step 3: Implement execution engine interfaces and runQueueJob**

Create `src/core/queue/queueExecution.ts` with the injected scheduler, recovery helpers, and no signed-material persistence:

```ts
import { getAddress } from "ethers/address";
import { createDefaultQueuePolicy } from "./queueHistory";
import { sanitizeQueueMessage, summarizeCalldata } from "./queueRedaction";
import type {
  PreparedQueueTransactionDraft,
  QueueActionType,
  QueueErrorCategory,
  QueueExecutionPolicy,
  QueueJobRecord,
  QueueSourceModule,
  QueueTransactionRecord,
} from "./queueTypes";

export interface QueueUnsignedTransactionRequest {
  chainId: number;
  from: string;
  to: string | null;
  valueWei: string;
  data: string;
  gasLimit: string;
  nonce: number;
}

export interface QueueSigner {
  signTransaction(accountId: string, request: QueueUnsignedTransactionRequest): Promise<string>;
}

export interface QueueBroadcaster {
  validateChainId(expectedChainId: number): Promise<number>;
  getPendingNonce(accountAddress: string): Promise<number>;
  broadcastSignedTransaction(rawSignedTransaction: string): Promise<string>;
}

export interface QueueClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface RunQueueJobInput {
  chainId: number;
  title: string;
  sourceModule: QueueSourceModule;
  drafts: PreparedQueueTransactionDraft[];
  policy?: QueueExecutionPolicy;
  signer: QueueSigner;
  broadcaster: QueueBroadcaster;
  clock?: QueueClock;
  shouldStop?: () => boolean;
}

export interface RunQueueJobResult {
  job: QueueJobRecord;
  transactions: QueueTransactionRecord[];
  historyUpdates: QueueTransactionRecord[];
}

class QueueStopSignal {
  stopped = false;

  stop() {
    this.stopped = true;
  }

  isStopped() {
    return this.stopped;
  }
}

export interface QueueRecoveryInput {
  chainId: number;
  title: string;
  historyTransactions: QueueTransactionRecord[];
  sessionDraftsByTransactionId: Map<string, PreparedQueueTransactionDraft>;
  policy?: QueueExecutionPolicy;
  signer: QueueSigner;
  broadcaster: QueueBroadcaster;
  clock?: QueueClock;
}

export interface QueueRecoveryRunResult extends RunQueueJobResult {
  historyUpdates: QueueTransactionRecord[];
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createError(category: QueueErrorCategory, message: unknown, retryable: boolean) {
  return { category, message: sanitizeQueueMessage(message), retryable };
}

const systemClock: QueueClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
};

class QueueRpcTokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly requestsPerSecond: number,
    private readonly clock: QueueClock,
  ) {
    this.tokens = Math.max(1, Math.floor(requestsPerSecond));
    this.lastRefillMs = clock.now();
  }

  async take() {
    this.refill();
    if (this.tokens <= 0) {
      await this.clock.sleep(1000);
      this.refill(true);
    }
    this.tokens -= 1;
  }

  private refill(force = false) {
    const limit = Math.max(1, Math.floor(this.requestsPerSecond));
    const elapsed = this.clock.now() - this.lastRefillMs;
    if (!force && elapsed < 1000) return;
    const periods = force ? 1 : Math.floor(elapsed / 1000);
    this.tokens = Math.min(limit, this.tokens + periods * limit);
    this.lastRefillMs += periods * 1000;
  }
}

interface DraftEntry {
  draft: PreparedQueueTransactionDraft;
  inputIndex: number;
}

function baseTransaction(jobId: string, draft: PreparedQueueTransactionDraft, nonce: number | null): QueueTransactionRecord {
  const timestamp = nowIso();
  return {
    id: createId("queue-tx"),
    jobId,
    chainId: draft.chainId,
    accountId: draft.accountId,
    accountAddress: getAddress(draft.accountAddress),
    nonce,
    status: "queued",
    actionType: draft.actionType as QueueActionType,
    target: draft.to ? getAddress(draft.to) : null,
    valueWei: draft.valueWei,
    calldataSummary: summarizeCalldata(draft.data),
    feeSummary:
      draft.fee.mode === "legacy"
        ? { mode: "legacy", gasLimit: draft.gasLimit, gasPriceGwei: draft.fee.gasPriceGwei ?? "0" }
        : {
            mode: "eip1559",
            gasLimit: draft.gasLimit,
            maxFeePerGasGwei: draft.fee.maxFeePerGasGwei ?? "0",
            maxPriorityFeePerGasGwei: draft.fee.maxPriorityFeePerGasGwei ?? "0",
          },
    txHash: null,
    error: null,
    retryOfTransactionId: draft.retryOfTransactionId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function cloneDraftForRetry(draft: PreparedQueueTransactionDraft, retryOfTransactionId: string): PreparedQueueTransactionDraft {
  return { ...draft, id: createId("queue-retry-draft"), retryOfTransactionId };
}

function markSkipped(record: QueueTransactionRecord, category: QueueErrorCategory): QueueTransactionRecord {
  return {
    ...record,
    status: "skipped",
    error: createError(category, category === "nonce-consumed" ? "stale nonce skipped after pending nonce refetch" : "skipped", true),
    updatedAt: nowIso(),
  };
}

function summarize(transactions: QueueTransactionRecord[]) {
  return {
    total: transactions.length,
    pending: transactions.filter((tx) => tx.status === "pending").length,
    failed: transactions.filter((tx) => tx.status === "failed").length,
    stopped: transactions.filter((tx) => tx.status === "stopped").length,
    completed: transactions.filter((tx) => tx.status === "pending").length,
  };
}

function jobStatus(transactions: QueueTransactionRecord[]): QueueJobRecord["status"] {
  if (transactions.every((tx) => tx.status === "pending")) return "completed";
  if (transactions.some((tx) => tx.status === "pending") && transactions.some((tx) => tx.status !== "pending")) {
    return "partial";
  }
  if (transactions.some((tx) => tx.status === "stopped")) return "stopped";
  return "failed";
}

export async function runQueueJob(input: RunQueueJobInput): Promise<RunQueueJobResult> {
  const policy = input.policy ?? createDefaultQueuePolicy();
  const clock = input.clock ?? systemClock;
  const tokenBucket = new QueueRpcTokenBucket(policy.rpcRequestsPerSecond, clock);
  const timestamp = nowIso();
  const jobId = createId("queue-job");
  const transactionSlots: QueueTransactionRecord[] = [];
  const stopSignal = new QueueStopSignal();
  const grouped = new Map<string, DraftEntry[]>();
  input.drafts.forEach((draft, inputIndex) => {
    const account = getAddress(draft.accountAddress);
    grouped.set(account, [...(grouped.get(account) ?? []), { draft, inputIndex }]);
  });

  let actualChainId: number;
  try {
    await tokenBucket.take();
    actualChainId = await input.broadcaster.validateChainId(input.chainId);
  } catch (error) {
    actualChainId = -1;
    const failure = createError("chain-mismatch", error, true);
    input.drafts.forEach((draft, inputIndex) => {
      transactionSlots[inputIndex] = { ...baseTransaction(jobId, draft, null), status: "failed", error: failure };
    });
  }
  if (transactionSlots.length === 0 && actualChainId !== input.chainId) {
    const failure = createError("chain-mismatch", `expected ${input.chainId}, actual ${actualChainId}`, true);
    input.drafts.forEach((draft, inputIndex) => {
      transactionSlots[inputIndex] = { ...baseTransaction(jobId, draft, null), status: "failed", error: failure };
    });
  }

  async function runLane(accountAddress: string, entries: DraftEntry[]) {
    let nonce: number;
    try {
      await tokenBucket.take();
      nonce = await input.broadcaster.getPendingNonce(accountAddress);
    } catch (error) {
      for (const { draft, inputIndex } of entries) {
        transactionSlots[inputIndex] = {
          ...baseTransaction(jobId, draft, null),
          status: "failed",
          error: createError("nonce-load-failed", error, true),
        };
      }
      return;
    }

    let laneBlocked = false;
    for (let laneIndex = 0; laneIndex < entries.length; laneIndex += 1) {
      const { draft, inputIndex } = entries[laneIndex];
      const transaction = baseTransaction(jobId, draft, nonce);
      nonce += 1;
      if (laneIndex > 0 && policy.walletIntervalMs > 0) {
        await clock.sleep(policy.walletIntervalMs);
      }
      if (laneBlocked || input.shouldStop?.()) {
        transactionSlots[inputIndex] = {
          ...transaction,
          status: "stopped",
          error: createError("user-stopped", "stopped before broadcast", true),
        };
        continue;
      }
      let rawSignedTransaction: string;
      try {
        rawSignedTransaction = await input.signer.signTransaction(draft.accountId, {
          chainId: input.chainId,
          from: getAddress(draft.accountAddress),
          to: draft.to ? getAddress(draft.to) : null,
          valueWei: draft.valueWei,
          data: draft.data,
          gasLimit: draft.gasLimit,
          nonce: transaction.nonce ?? 0,
        });
      } catch (error) {
        laneBlocked = true;
        transactionSlots[inputIndex] = {
          ...transaction,
          status: "failed",
          error: createError("signing-failed", error, true),
          updatedAt: nowIso(),
        };
        if (!policy.continueOnFailure) stopSignal.stop();
        continue;
      }
      try {
        await tokenBucket.take();
        const txHash = await input.broadcaster.broadcastSignedTransaction(rawSignedTransaction);
        transactionSlots[inputIndex] = { ...transaction, status: "pending", txHash, updatedAt: nowIso() };
      } catch (error) {
        laneBlocked = true;
        transactionSlots[inputIndex] = {
          ...transaction,
          status: "failed",
          error: createError("broadcast-failed", error, true),
          updatedAt: nowIso(),
        };
        if (!policy.continueOnFailure) stopSignal.stop();
      }
    }
  }

  if (transactionSlots.length === 0) {
    const lanes = [...grouped.entries()];
    let nextLaneIndex = 0;
    const workerCount = Math.min(Math.max(1, Math.floor(policy.concurrency)), lanes.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextLaneIndex < lanes.length) {
          const [accountAddress, entries] = lanes[nextLaneIndex];
          nextLaneIndex += 1;
          if (stopSignal.isStopped()) {
            for (const { draft, inputIndex } of entries) {
              transactionSlots[inputIndex] = {
                ...baseTransaction(jobId, draft, null),
                status: "stopped",
                error: createError("user-stopped", "stopped before account lane started", true),
              };
            }
            continue;
          }
          await runLane(accountAddress, entries);
        }
      }),
    );
  }

  const transactions = transactionSlots.filter(Boolean);
  const job: QueueJobRecord = {
    id: jobId,
    chainId: input.chainId,
    title: sanitizeQueueMessage(input.title),
    sourceModule: input.sourceModule,
    status: transactions.length > 0 ? jobStatus(transactions) : "completed",
    createdAt: timestamp,
    updatedAt: nowIso(),
    executionPolicy: policy,
    transactionIds: transactions.map((tx) => tx.id),
    summary: summarize(transactions),
  };

  return { historyUpdates: [], job, transactions };
}

function requireCurrentTabDrafts(
  transactions: QueueTransactionRecord[],
  sessionDraftsByTransactionId: Map<string, PreparedQueueTransactionDraft>,
) {
  const drafts = transactions.map((transaction) => sessionDraftsByTransactionId.get(transaction.id));
  if (drafts.some((draft) => !draft)) {
    throw new Error("current-tab prepared drafts are required for resume, retry, or rerun");
  }
  return drafts as PreparedQueueTransactionDraft[];
}

export async function resumeStoppedQueueJob(input: QueueRecoveryInput) {
  const stopped = input.historyTransactions.filter((transaction) => transaction.status === "stopped");
  const result = await runQueueJob({
    chainId: input.chainId,
    title: input.title,
    sourceModule: "queue",
    drafts: requireCurrentTabDrafts(stopped, input.sessionDraftsByTransactionId),
    policy: input.policy,
    signer: input.signer,
    broadcaster: input.broadcaster,
    clock: input.clock,
  });
  return { ...result, historyUpdates: [] };
}

export async function retryFailedQueueJob(input: QueueRecoveryInput) {
  const failed = input.historyTransactions.filter((transaction) => transaction.status === "failed" && transaction.error?.retryable);
  const retryDrafts = requireCurrentTabDrafts(failed, input.sessionDraftsByTransactionId).map((draft, index) =>
    cloneDraftForRetry(draft, failed[index].id),
  );
  const firstFailedNonce = failed
    .map((transaction) => transaction.nonce)
    .filter((nonce): nonce is number => nonce !== null)
    .sort((left, right) => left - right)[0] ?? null;
  const result = await runQueueJob({
    chainId: input.chainId,
    title: input.title,
    sourceModule: "queue",
    drafts: retryDrafts,
    policy: input.policy,
    signer: input.signer,
    broadcaster: input.broadcaster,
    clock: input.clock,
  });
  const firstRetriedNonce = result.transactions
    .map((transaction) => transaction.nonce)
    .filter((nonce): nonce is number => nonce !== null)
    .sort((left, right) => left - right)[0] ?? null;
  const nonceConsumed = firstFailedNonce !== null && firstRetriedNonce !== null && firstRetriedNonce > firstFailedNonce;
  return {
    ...result,
    historyUpdates: nonceConsumed ? failed.map((record) => markSkipped(record, "nonce-consumed")) : [],
  };
}

export async function rerunQueueFromFailedNonce(input: QueueRecoveryInput) {
  const firstFailed = input.historyTransactions
    .filter((transaction) => transaction.status === "failed" && transaction.nonce !== null)
    .sort((left, right) => (left.nonce ?? 0) - (right.nonce ?? 0))[0];
  if (!firstFailed || firstFailed.nonce === null) {
    return runQueueJob({ ...input, sourceModule: "queue", drafts: [] });
  }
  const rerunRecords = input.historyTransactions.filter(
    (transaction) =>
      transaction.accountId === firstFailed.accountId &&
      transaction.nonce !== null &&
      transaction.nonce >= firstFailed.nonce,
  );
  const drafts = requireCurrentTabDrafts(rerunRecords, input.sessionDraftsByTransactionId).map((draft, index) =>
    cloneDraftForRetry(draft, rerunRecords[index].id),
  );
  const result = await runQueueJob({
    chainId: input.chainId,
    title: input.title,
    sourceModule: "queue",
    drafts,
    policy: input.policy,
    signer: input.signer,
    broadcaster: input.broadcaster,
    clock: input.clock,
  });
  return { ...result, historyUpdates: rerunRecords.map((record) => markSkipped(record, "nonce-consumed")) };
}
```

Then modify `src/core/queue/index.ts`:

```ts
export * from "./queueExecution";
export * from "./queueHistory";
export * from "./queueRedaction";
export * from "./queueTypes";
```

- [ ] **Step 4: Verify Task 3**

Run:

```bash
npm test -- src/core/queue/queueExecution.test.ts src/core/queue/queueHistory.test.ts src/core/queue/queueRedaction.test.ts
npm run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Controller commit gate for Task 3**

Controller only, after spec and quality review pass:

```bash
git add src/core/queue/queueExecution.ts src/core/queue/queueExecution.test.ts src/core/queue/index.ts docs/superpowers/project-status.md
git diff --cached --check
git commit -m "feat: add injected queue execution engine"
git push
```

---

## Task 4: Queue History Workspace UI

**Files:**
- Create: `src/features/queue/QueueModule.tsx`
- Create: `src/features/queue/PwaQueueHistoryWorkspace.tsx`
- Create: `src/features/queue/PwaQueueHistoryWorkspace.test.tsx`
- Modify: `src/styles/features.css`

- [ ] **Step 1: Write failing UI tests**

Create `src/features/queue/PwaQueueHistoryWorkspace.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultQueueHistoryState, createDefaultQueuePolicy, type QueueHistoryState } from "../../core/queue";
import { renderScreen } from "../../test/render";
import { PwaQueueHistoryWorkspace } from "./PwaQueueHistoryWorkspace";

function history(): QueueHistoryState {
  return {
    ...createDefaultQueueHistoryState(),
    jobs: [
      {
        id: "job-1",
        chainId: 1,
        title: "测试队列",
        sourceModule: "queue",
        status: "partial",
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
        executionPolicy: createDefaultQueuePolicy(),
        transactionIds: ["tx-1"],
        summary: { total: 1, pending: 0, failed: 1, stopped: 0, completed: 0 },
      },
    ],
    transactions: [
      {
        id: "tx-1",
        jobId: "job-1",
        chainId: 1,
        accountId: "account-1",
        accountAddress: "0x0000000000000000000000000000000000000001",
        nonce: 7,
        status: "failed",
        actionType: "raw-calldata",
        target: "0x0000000000000000000000000000000000000002",
        valueWei: "0",
        calldataSummary: { selector: "0x64617461", byteLength: 4, summary: "0x64617461 · 4 bytes" },
        feeSummary: { mode: "eip1559", gasLimit: "21000", maxFeePerGasGwei: "30", maxPriorityFeePerGasGwei: "1.5" },
        txHash: null,
        error: { category: "broadcast-failed", message: "RPC request failed: [redacted-url]", retryable: true },
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
      },
    ],
  };
}

describe("PwaQueueHistoryWorkspace", () => {
  it("shows locked state, queue settings, and no arbitrary send form", () => {
    renderScreen(
      <PwaQueueHistoryWorkspace
        activeRun={null}
        history={history()}
        policy={createDefaultQueuePolicy()}
        unlocked={false}
        onExport={vi.fn()}
        onPolicyChange={vi.fn()}
        onResume={vi.fn()}
        onRetryFailed={vi.fn()}
        onRerunFromFailedNonce={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "队列/历史" })).toBeInTheDocument();
    expect(screen.getByText("解锁 vault 后才能运行当前标签页队列。")).toBeInTheDocument();
    expect(screen.getByLabelText("并发数")).toHaveValue(20);
    expect(screen.getByLabelText("失败后继续其他账户")).toBeChecked();
    expect(screen.getByLabelText("从失败 nonce 续跑")).toBeChecked();
    expect(screen.queryByRole("button", { name: /签名|广播|提交|发送|分发|归集|approve|ABI|calldata/i })).not.toBeInTheDocument();
  });

  it("renders redacted history and exports without leaking raw material", () => {
    const onExport = vi.fn();
    renderScreen(
      <PwaQueueHistoryWorkspace
        activeRun={null}
        history={history()}
        policy={createDefaultQueuePolicy()}
        unlocked
        onExport={onExport}
        onPolicyChange={vi.fn()}
        onResume={vi.fn()}
        onRetryFailed={vi.fn()}
        onRerunFromFailedNonce={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByText("测试队列")).toBeInTheDocument();
    expect(screen.getByText("broadcast-failed")).toBeInTheDocument();
    expect(screen.getByText("RPC request failed: [redacted-url]")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出脱敏 JSON" }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/raw signed|private key|mnemonic|password/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run UI tests to verify they fail**

Run:

```bash
npm test -- src/features/queue/PwaQueueHistoryWorkspace.test.tsx
```

Expected: FAIL because queue workspace does not exist.

- [ ] **Step 3: Implement QueueModule**

Create `src/features/queue/QueueModule.tsx`:

```tsx
import type { ReactNode } from "react";

export function QueueModule({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
```

- [ ] **Step 4: Implement PwaQueueHistoryWorkspace**

Create `src/features/queue/PwaQueueHistoryWorkspace.tsx`:

```tsx
import type { QueueExecutionPolicy, QueueHistoryState, QueueJobRecord, QueueTransactionRecord } from "../../core/queue";

export interface PwaQueueActiveRun {
  status: "idle" | "running" | "stopping" | "stopped" | "partial" | "completed" | "failed";
  jobs: QueueJobRecord[];
  transactions: QueueTransactionRecord[];
}

export interface PwaQueueHistoryWorkspaceProps {
  activeRun: PwaQueueActiveRun | null;
  history: QueueHistoryState;
  policy: QueueExecutionPolicy;
  unlocked: boolean;
  onPolicyChange(updates: Partial<QueueExecutionPolicy>): void;
  onStop(): void;
  onResume(): void;
  onRetryFailed(): void;
  onRerunFromFailedNonce(): void;
  onExport(): void;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    completed: "队列完成",
    failed: "失败",
    idle: "空闲",
    partial: "部分完成",
    pending: "Pending",
    queued: "排队中",
    running: "运行中",
    stopped: "已停止",
    stopping: "停止中",
  };
  return labels[status] ?? status;
}

export function PwaQueueHistoryWorkspace({
  activeRun,
  history,
  policy,
  unlocked,
  onExport,
  onPolicyChange,
  onResume,
  onRetryFailed,
  onRerunFromFailedNonce,
  onStop,
}: PwaQueueHistoryWorkspaceProps) {
  const jobs = activeRun?.jobs.length ? activeRun.jobs : history.jobs;
  const transactions = activeRun?.transactions.length ? activeRun.transactions : history.transactions;
  const canOperateActiveRun = unlocked && Boolean(activeRun);

  return (
    <section className="queue-section" aria-labelledby="queue-workspace-title">
      <header className="section-header">
        <div>
          <h2 id="queue-workspace-title">队列/历史</h2>
          <p className="section-subtitle">P13 队列底座：观察、停止、恢复、重试和脱敏历史；不提供任意交易发送表单。</p>
        </div>
        <button onClick={onExport} type="button">
          导出脱敏 JSON
        </button>
      </header>

      {!unlocked && <p className="notice-panel notice-panel-warning">解锁 vault 后才能运行当前标签页队列。</p>}

      <div className="pwa-card asset-status-strip">
        <span className="status-badge">状态 {statusLabel(activeRun?.status ?? "idle")}</span>
        <span className="status-badge">任务 {jobs.length}</span>
        <span className="status-badge">交易 {transactions.length}</span>
      </div>

      <article className="pwa-card">
        <h3>执行策略</h3>
        <div className="pwa-form-grid">
          <label>
            并发数
            <input
              aria-label="并发数"
              min={1}
              max={100}
              onChange={(event) => onPolicyChange({ concurrency: Math.max(1, Math.trunc(event.target.valueAsNumber || 1)) })}
              type="number"
              value={policy.concurrency}
            />
          </label>
          <label>
            钱包间隔 ms
            <input
              aria-label="钱包间隔 ms"
              min={0}
              onChange={(event) => onPolicyChange({ walletIntervalMs: Math.max(0, Math.trunc(event.target.valueAsNumber || 0)) })}
              type="number"
              value={policy.walletIntervalMs}
            />
          </label>
          <label>
            RPC 每秒请求
            <input
              aria-label="RPC 每秒请求"
              min={1}
              onChange={(event) => onPolicyChange({ rpcRequestsPerSecond: Math.max(1, Math.trunc(event.target.valueAsNumber || 1)) })}
              type="number"
              value={policy.rpcRequestsPerSecond}
            />
          </label>
          <label className="inline-toggle">
            <input
              aria-label="失败后继续其他账户"
              checked={policy.continueOnFailure}
              onChange={(event) => onPolicyChange({ continueOnFailure: event.target.checked })}
              type="checkbox"
            />
            失败后继续其他账户
          </label>
          <label className="inline-toggle">
            <input
              aria-label="从失败 nonce 续跑"
              checked={policy.rerunFromFailedNonce}
              onChange={(event) => onPolicyChange({ rerunFromFailedNonce: event.target.checked })}
              type="checkbox"
            />
            从失败 nonce 续跑
          </label>
        </div>
        <div className="queue-actions">
          <button disabled={!canOperateActiveRun} onClick={onStop} type="button">停止队列</button>
          <button disabled={!canOperateActiveRun} onClick={onResume} type="button">恢复停止项</button>
          <button disabled={!canOperateActiveRun} onClick={onRetryFailed} type="button">重试失败</button>
          <button disabled={!canOperateActiveRun} onClick={onRerunFromFailedNonce} type="button">从失败 nonce 续跑</button>
        </div>
      </article>

      <article className="pwa-card">
        <h3>任务</h3>
        <div className="asset-table-wrap">
          <table>
            <thead>
              <tr><th>任务</th><th>状态</th><th>链</th><th>交易数</th></tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.title}</td>
                  <td>{statusLabel(job.status)}</td>
                  <td>{job.chainId}</td>
                  <td>{job.summary.total}</td>
                </tr>
              ))}
              {jobs.length === 0 && <tr><td colSpan={4}>当前没有队列任务。</td></tr>}
            </tbody>
          </table>
        </div>
      </article>

      <article className="pwa-card">
        <h3>交易历史</h3>
        <div className="asset-table-wrap">
          <table>
            <thead>
              <tr><th>账户</th><th>Nonce</th><th>状态</th><th>错误</th></tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="mono">{tx.accountAddress}</td>
                  <td>{tx.nonce ?? "-"}</td>
                  <td>{statusLabel(tx.status)}</td>
                  <td>
                    {tx.error ? (
                      <>
                        <strong>{tx.error.category}</strong>
                        <div>{tx.error.message}</div>
                      </>
                    ) : "-"}
                  </td>
                </tr>
              ))}
              {transactions.length === 0 && <tr><td colSpan={4}>当前没有交易历史。</td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
```

- [ ] **Step 5: Add queue styles**

Modify `src/styles/features.css` and add:

```css
.queue-section {
  display: grid;
  gap: 16px;
}

.queue-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
```

- [ ] **Step 6: Verify Task 4**

Run:

```bash
npm test -- src/features/queue/PwaQueueHistoryWorkspace.test.tsx
npm run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Controller commit gate for Task 4**

Controller only, after spec and quality review pass:

```bash
git add src/features/queue src/styles/features.css docs/superpowers/project-status.md
git diff --cached --check
git commit -m "feat: add queue history workspace"
git push
```

---

## Task 5: Shell Integration And Browser Smoke

**Files:**
- Modify: `src/app/PwaShell.tsx`
- Modify: `src/app/PwaShell.test.tsx`
- Modify: `src/app/shell/navigation.ts`
- Modify: `src/app/shell/AppShell.tsx`
- Modify: `src/app/shell/AppWorkspace.tsx`
- Modify: `src/app/shell/AppPreviewRail.tsx`
- Modify: `tests/browser/pwa-smoke.spec.ts`

- [ ] **Step 1: Write failing shell integration tests**

Modify `src/app/PwaShell.test.tsx` and add:

```tsx
it("renders queue history workspace without arbitrary send controls", async () => {
  renderPwaShell();

  fireEvent.click(screen.getByRole("button", { name: "队列/历史" }));

  expect(await screen.findByRole("heading", { name: "队列/历史" })).toBeInTheDocument();
  expect(screen.getByText(/不提供任意交易发送表单/)).toBeInTheDocument();
  expect(screen.getByLabelText("并发数")).toHaveValue(20);
  expect(screen.getByLabelText("失败后继续其他账户")).toBeChecked();
  expect(screen.getByLabelText("从失败 nonce 续跑")).toBeChecked();
  expect(screen.queryByRole("button", { name: /签名|广播|提交|发送|分发|归集|approve|ABI|calldata/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run shell test to verify it fails**

Run:

```bash
npm test -- src/app/PwaShell.test.tsx
```

Expected: FAIL because queue page still renders placeholder.

- [ ] **Step 3: Wire queue history into PwaShell**

Modify `src/app/PwaShell.tsx`:

- import queue history storage and workspace:

```ts
import {
  createDefaultQueueHistoryState,
  createDefaultQueuePolicy,
  exportRedactedQueueHistory,
  appendQueueHistoryRecords,
  resumeStoppedQueueJob,
  retryFailedQueueJob,
  rerunQueueFromFailedNonce,
  type PreparedQueueTransactionDraft,
  type QueueExecutionPolicy,
  type QueueHistoryState,
  type QueueJobRecord,
  type QueueTransactionRecord,
  type QueueBroadcaster,
  type QueueSigner,
} from "../core/queue";
import { loadBrowserQueueHistoryState, saveBrowserQueueHistoryState, type BrowserQueueHistoryStorage } from "../lib/browserQueueHistory";
import { QueueModule } from "../features/queue/QueueModule";
import { PwaQueueHistoryWorkspace, type PwaQueueActiveRun } from "../features/queue/PwaQueueHistoryWorkspace";
```

- extend props:

```ts
queueHistoryStorage?: BrowserQueueHistoryStorage;
queueSigner?: QueueSigner;
queueBroadcaster?: QueueBroadcaster;
```

- destructure the new optional props in `PwaShell`:

```ts
export function PwaShell({
  assetRegistryStorage,
  chainConfigStorage,
  createAssetRpcClient,
  queueBroadcaster,
  queueHistoryStorage,
  queueSigner,
  vaultStorage,
}: PwaShellProps = {}) {
```

- add state:

```ts
const [queueHistory, setQueueHistory] = useState<QueueHistoryState>(createDefaultQueueHistoryState());
const [queuePolicy, setQueuePolicy] = useState<QueueExecutionPolicy>(createDefaultQueuePolicy());
const [queueError, setQueueError] = useState<string | null>(null);
const [queueHistoryLoaded, setQueueHistoryLoaded] = useState(false);
const [queueActiveRun, setQueueActiveRun] = useState<PwaQueueActiveRun | null>(null);
const [queueSessionDrafts] = useState<Map<string, PreparedQueueTransactionDraft>>(new Map());
```

P13 does not expose a visible production form that fills `queueSessionDrafts`. Later P14+ pages will populate this map through a submit-to-queue boundary. The P13 handlers below are real current-tab recovery handlers and are covered through injected tests, but remain inert in normal production UI until a later workflow supplies drafts and signer/broadcaster adapters.

- load history in an effect:

```ts
useEffect(() => {
  let cancelled = false;
  void loadBrowserQueueHistoryState(queueHistoryStorage)
    .then((state) => {
      if (!cancelled) {
        setQueueHistory(state);
        setQueueError(null);
        setQueueHistoryLoaded(true);
      }
    })
    .catch((err) => {
      if (!cancelled) {
        setQueueError(err instanceof Error ? err.message : String(err));
        setQueueHistoryLoaded(true);
      }
    });
  return () => {
    cancelled = true;
  };
}, [queueHistoryStorage]);
```

- persist redacted history after the initial load has completed:

```ts
useEffect(() => {
  if (!queueHistoryLoaded) return;
  void saveBrowserQueueHistoryState(queueHistory, queueHistoryStorage).catch((err) => {
    setQueueError(err instanceof Error ? err.message : String(err));
  });
}, [queueHistory, queueHistoryLoaded, queueHistoryStorage]);
```

- add export handler that does not create URLs containing secrets:

```ts
function handleExportQueueHistory() {
  const serialized = exportRedactedQueueHistory(queueHistory);
  const blob = new Blob([serialized], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "defi-united-redacted-queue-history.json";
  anchor.click();
  URL.revokeObjectURL(url);
}
```

- add current-tab recovery handlers. These handlers must not reconstruct drafts from durable history. They use only `queueSessionDrafts`, and when no active run/drafts are available they show a user-facing message instead of attempting recovery:

```ts
function mergeQueueRunResult(result: { historyUpdates: QueueTransactionRecord[]; job: QueueJobRecord; transactions: QueueTransactionRecord[] }) {
  setQueueHistory((previous) => {
    const updateById = new Map(result.historyUpdates.map((transaction) => [transaction.id, transaction]));
    const updatedTransactions = previous.transactions.map((transaction) => updateById.get(transaction.id) ?? transaction);
    return appendQueueHistoryRecords(
      { ...previous, transactions: updatedTransactions },
      { jobs: [result.job], transactions: result.transactions },
    );
  });
  setQueueActiveRun({ status: result.job.status, jobs: [result.job], transactions: result.transactions });
}

type QueueRecoveryRunner = typeof resumeStoppedQueueJob | typeof retryFailedQueueJob | typeof rerunQueueFromFailedNonce;

async function runQueueRecovery(
  operation: "resume" | "retry" | "rerun",
  runner: QueueRecoveryRunner,
) {
  if (!session || !queueSigner || !queueBroadcaster || !activeChain || !queueActiveRun || queueSessionDrafts.size === 0) {
    setQueueError("恢复、重试和续跑需要当前标签页的未关闭队列草稿；仅凭本地历史不能继续。");
    return;
  }
  setQueueError(null);
  const input = {
    chainId: activeChain.chainId,
    title: operation === "resume" ? "恢复停止队列" : operation === "retry" ? "重试失败队列" : "从失败 nonce 续跑",
    historyTransactions: queueActiveRun.transactions,
    sessionDraftsByTransactionId: queueSessionDrafts,
    policy: queuePolicy,
    signer: queueSigner,
    broadcaster: queueBroadcaster,
  };
  const result = await runner(input);
  mergeQueueRunResult(result);
}
```

`queueSigner` and `queueBroadcaster` are optional injected production boundaries from Task 3. P13 does not create a visible business job submitter; when those boundaries or session drafts are absent, recovery controls explain that current-tab drafts are required. They must never log or persist raw signed transactions.

- add queue renderer:

```tsx
function renderQueueSection() {
  return (
    <QueueModule>
      <PwaQueueHistoryWorkspace
        activeRun={queueActiveRun}
        history={queueHistory}
        policy={queuePolicy}
        unlocked={Boolean(session)}
        onExport={handleExportQueueHistory}
        onPolicyChange={(updates) => setQueuePolicy((previous) => ({ ...previous, ...updates }))}
        onResume={() => void runQueueRecovery("resume", resumeStoppedQueueJob)}
        onRetryFailed={() => void runQueueRecovery("retry", retryFailedQueueJob)}
        onRerunFromFailedNonce={() => void runQueueRecovery("rerun", rerunQueueFromFailedNonce)}
        onStop={() => setQueueActiveRun((previous) => previous ? { ...previous, status: "stopped" } : previous)}
      />
      {queueError && <p className="notice-panel notice-panel-warning">{queueError}</p>}
    </QueueModule>
  );
}
```

- pass `queueContent={renderQueueSection()}` to `AppShell`.

- [ ] **Step 4: Wire shell components**

Modify `src/app/shell/navigation.ts`:

```ts
{
  id: "queueHistory",
  label: "队列/历史",
  summary: "本地任务队列、脱敏交易历史、停止/恢复/重试和可恢复诊断。",
  status: "ready",
  planned: ["队列策略", "脱敏历史", "停止/恢复/重试"],
}
```

Modify `src/app/shell/AppShell.tsx`, props:

```ts
queueContent: ReactNode;
```

Forward to `AppWorkspace`.

Modify `src/app/shell/AppWorkspace.tsx`:

```ts
queueContent: ReactNode;
...
if (activeModuleId === "queueHistory") return <>{queueContent}</>;
```

Modify `src/app/shell/AppPreviewRail.tsx` wording:

```tsx
<NoticePanel title="队列">
  <p>P13 队列/历史用于观察、停止、恢复、重试和脱敏导出；业务发送入口仍由 P14+ 页面接入。</p>
</NoticePanel>
```

- [ ] **Step 5: Update browser smoke**

Modify `tests/browser/pwa-smoke.spec.ts` and add assertions in baseline smoke or a new test:

```ts
test("PWA queue history opens without arbitrary send forms", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "队列/历史" }).click();
  await expect(page.getByRole("heading", { name: "队列/历史" })).toBeVisible();
  await expect(page.getByText("不提供任意交易发送表单")).toBeVisible();
  await expect(page.getByRole("button", { name: /签名|广播|提交|发送|分发|归集|approve|ABI|calldata/i })).toHaveCount(0);
});
```

- [ ] **Step 6: Verify Task 5**

Run:

```bash
npm test -- src/app/PwaShell.test.tsx src/features/queue/PwaQueueHistoryWorkspace.test.tsx
npm run typecheck
npm run smoke:browser
git diff --check
```

Expected: PASS. Remove `test-results/` if Playwright creates it.

- [ ] **Step 7: Controller commit gate for Task 5**

Controller only, after spec and quality review pass:

```bash
git add src/app/PwaShell.tsx src/app/PwaShell.test.tsx src/app/shell/navigation.ts src/app/shell/AppShell.tsx src/app/shell/AppWorkspace.tsx src/app/shell/AppPreviewRail.tsx tests/browser/pwa-smoke.spec.ts docs/superpowers/project-status.md
git diff --cached --check
git commit -m "feat: wire queue history workspace"
git push
```

---

## Task 6: Documentation, Final Review, And Release Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/specs/evm-wallet-workbench.md`
- Modify: `docs/superpowers/project-overview.md`
- Modify: `docs/superpowers/roadmap.md`
- Modify: `docs/superpowers/project-status.md`

- [ ] **Step 1: Update current capability docs**

Update docs to say P13 on the milestone branch provides:

- real `队列/历史` workspace;
- redacted durable local history;
- session-only queue policy/state;
- job/transaction model;
- injected signer/broadcaster queue engine;
- default concurrency `20`;
- stop/resume/retry/rerun model;
- redacted export;
- no production arbitrary transaction constructor or business send form.

Do not claim distribution, inscription, ABI write, reverse parsing, approval, collection, receipt polling, confirmation tracking, replacement, or cancel flows are current capabilities.

- [ ] **Step 2: Verify docs formatting**

Run:

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 3: Controller commit gate for docs**

Controller only, after spec and quality review pass:

```bash
git add README.md docs/specs/evm-wallet-workbench.md docs/superpowers/project-overview.md docs/superpowers/roadmap.md docs/superpowers/project-status.md
git diff --cached --check
git commit -m "docs: record P13 queue history status"
git push
```

- [ ] **Step 4: Final full release gate**

Run on `codex/p13-execution-queue-history`:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:browser
git diff --check
git status --short --branch --untracked-files=all
```

Expected: PASS, clean except ignored build artifacts. Remove `test-results/` if generated.

- [ ] **Step 5: Final review**

Dispatch final spec reviewer and final code quality reviewer over `origin/main...HEAD`.

Review must check:

- production UI has no arbitrary send form;
- no business workflow was enabled;
- no raw signed transactions or secrets are persisted/exported/rendered;
- queue/history docs match actual runtime;
- default concurrency/rate limit/nonce/retry semantics are test-covered;
- browser smoke covers queue page desktop/mobile.

- [ ] **Step 6: Merge to main after reviews pass**

Controller only:

```bash
cd /Users/wukong/mylife/Defi-United
git fetch origin
git pull --ff-only origin main
git merge --no-ff codex/p13-execution-queue-history -m "merge: land P13 execution queue history"
npm test
npm run typecheck
npm run build
npm run smoke:browser
git diff --check
```

Then update `docs/superpowers/project-status.md` on `main` with the merge commit, commit, and push:

```bash
git add docs/superpowers/project-status.md
git diff --cached --check
git commit -m "docs: record P13 main merge status"
git push origin main
```

---

## Self-Review Checklist

- Spec coverage: Tasks 1-5 cover queue model, redaction, storage, execution engine, UI, shell integration, smoke, and docs.
- Production boundary: Plan explicitly tests no arbitrary send form and keeps business workflows gated.
- Security boundary: Redaction and storage tests block raw signed tx, private keys, mnemonics, passwords, RPC tokens, and local paths.
- Persistence boundary: Task 2 persists only redacted history; active drafts/state remain session-only.
- Verification: Every task has focused tests plus typecheck/diff check; release gate uses full commands.
