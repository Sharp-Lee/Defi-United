# P13 Execution Queue And History Design

## 1. Purpose

P13 adds the shared execution foundation needed before DeFi United can safely ship distribution, inscription, ABI write, and hot-transaction replay workflows. It defines a browser-side queue, same-account nonce ordering, cross-account concurrency, stop/retry/resume semantics, front-end signing/broadcast service boundaries, and durable redacted local history.

This milestone is the bridge between the current read-only P12 app and later send-capable pages. P13 may include an internal queue workbench and test harness for safe execution verification, but it must not turn distribution, collection, inscriptions, ABI writes, or reverse parsing into live user-facing send workflows. Those pages remain planned until P14+.

## 2. Product Scope

### In scope

- Enable the `队列/历史` module as a real queue and history workspace.
- Represent batch jobs separately from transaction records.
- Model prepared transaction drafts without storing private keys, mnemonics, passwords, or raw signed transactions.
- Validate chain identity before any queue run.
- Load latest nonce per sending account before execution starts.
- Preserve same-account nonce ordering.
- Allow cross-account concurrency with default concurrency `20`.
- Provide configurable concurrency, wallet interval, and RPC rate-limit settings.
- Keep queue settings and in-flight queue state session-only.
- Persist durable redacted transaction history to browser localStorage.
- Support stop, resume stopped, retry failed, and rerun-from-failed-nonce behavior.
- Export redacted queue/history JSON.
- Add signing and broadcasting service boundaries that can use the unlocked hot vault session without asking for the password repeatedly.
- Add tests proving redaction of raw signed transactions, private keys, mnemonics, passwords, RPC credentials, API tokens, and local absolute paths.

### Production UI hard boundary

P13 must not expose a production UI that lets users construct arbitrary transaction drafts and broadcast them. The milestone implements the queue engine, redacted history, signer/broadcaster interfaces, and injected test harnesses. The production `队列/历史` workspace can show queue status, history, settings, stop/retry/export controls, and empty/locked states, but real business jobs are submitted only by later P14+ workflow pages after their own specs land.

Any P13 demonstration or test job must be injectable in tests or development-only fixtures, not a visible production send form.

### Out of scope

- Live distribution or collection workflow.
- Live inscription or calldata page.
- Live ABI write or hot transaction replay page.
- Production UI for arbitrary transaction drafting or real broadcast.
- ERC-20 allowance/approval execution.
- NFT mint monitoring.
- Explorer ABI fetching.
- Backend queue processing.
- Persisting active queue drafts across reloads.
- Persisting raw signed transactions.
- Persisting decrypted private keys, mnemonic phrases, vault passwords, or RPC secrets.
- Sending with private-key-imported accounts before a separate imported-key safety spec exists.

## 3. User Experience

The `队列/历史` page becomes a real workspace with:

- queue status summary;
- configurable concurrency, wallet interval, and RPC rate-limit controls;
- current run table;
- redacted history table;
- stop button for active runs;
- resume button for stopped current-tab runs;
- retry failed button;
- rerun-from-failed-nonce control;
- redacted JSON export.

If no P14+ workflow has submitted a job, the page shows empty queue state and durable redacted history only. It must not include a free-form send, raw calldata, contract call, distribution, collection, approval, or replay form.

When the vault is locked, the page can show durable redacted history but cannot run jobs. It should clearly state that queue execution requires an unlocked vault hot session.

P13 must make the fast-operation path explicit: once the vault is unlocked, later send-capable pages can enqueue many transactions without prompting for the password for every transaction. The password is still required after reload, lock, or session loss.

The queue page must not contain distribution, collection, inscription, ABI write, or hot transaction replay forms. It is an execution foundation and observability surface.

## 4. Data Model

### Queue job

A queue job is a user-level batch. It groups one or more transaction records and stores the requested execution policy.

```ts
export type QueueJobStatus =
  | "draft"
  | "queued"
  | "running"
  | "stopping"
  | "stopped"
  | "completed"
  | "partial"
  | "failed";

export interface QueueJobRecord {
  id: string;
  chainId: number;
  title: string;
  sourceModule: "queue" | "distribution" | "inscription" | "contract-call" | "reverse-parse";
  status: QueueJobStatus;
  createdAt: string;
  updatedAt: string;
  executionPolicy: QueueExecutionPolicy;
  transactionIds: string[];
  summary: QueueJobSummary;
}
```

### Transaction record

A transaction record is a single EVM transaction draft or execution result.

```ts
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

export interface QueueTransactionRecord {
  id: string;
  jobId: string;
  chainId: number;
  accountId: string;
  accountAddress: string;
  nonce: number | null;
  status: QueueTransactionStatus;
  actionType: "native-transfer" | "erc20-transfer" | "contract-call" | "raw-calldata" | "approval" | "unknown";
  target: string | null;
  valueWei: string;
  calldataSummary: RedactedCalldataSummary;
  feeSummary: QueueFeeSummary;
  txHash: string | null;
  error: QueueExecutionError | null;
  createdAt: string;
  updatedAt: string;
}
```

### Prepared transaction draft

Prepared drafts are session-only execution inputs. They may contain target, value, calldata, gas, fee, and account references. They must not contain raw signed transactions, private keys, mnemonic phrases, or passwords.

```ts
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
  actionType: QueueTransactionRecord["actionType"];
  preview: QueueTransactionPreview;
}
```

### Execution policy

```ts
export interface QueueExecutionPolicy {
  concurrency: number;
  walletIntervalMs: number;
  rpcRequestsPerSecond: number;
  continueOnFailure: boolean;
  rerunFromFailedNonce: boolean;
}
```

Defaults:

- `concurrency`: `20`
- `walletIntervalMs`: `0`
- `rpcRequestsPerSecond`: `20`
- `continueOnFailure`: `true`
- `rerunFromFailedNonce`: `true`

All active execution policies are session-only. Durable history may store the policy values used by a completed job because they are not secret-bearing.

## 5. Persistence Boundary

### Session-only

- Prepared transaction drafts.
- Active queue state.
- Current execution policy edits.
- Nonce cursors.
- Stop signals.
- Raw unsigned transaction requests if they contain full calldata for pending execution.
- Raw signed transactions.
- Any decrypted key material.

### Durable localStorage

Only redacted history may be persisted:

- job metadata;
- transaction metadata;
- account address and account id;
- chain id;
- nonce;
- action type;
- target address;
- value summary;
- calldata selector and short summary;
- fee summary;
- tx hash;
- status;
- sanitized error category/message;
- timestamps.

Durable history must not store raw signed transactions, private keys, mnemonic phrases, passwords, serialized vault material, full secret-bearing RPC URLs, API tokens, bearer tokens, or local absolute paths.

## 6. Queue Execution Flow

1. Caller submits a `QueueJobInput` with prepared session-only transaction drafts.
2. Queue validates that the vault is unlocked and selected chain exists.
3. Queue validates `eth_chainId` against the active chain.
4. Queue groups transactions by `accountAddress`.
5. For each account, queue fetches `eth_getTransactionCount(address, "pending")`.
6. Queue assigns nonces monotonically per account.
7. Queue runs cross-account lanes up to `executionPolicy.concurrency`.
8. Within one account lane, transactions run sequentially by nonce.
9. For each transaction:
   - build unsigned transaction request;
   - sign through the unlocked vault session signer boundary;
   - broadcast through RPC;
   - immediately discard raw signed transaction material;
   - persist only redacted transaction history.
10. If a transaction fails:
   - record account, nonce, action summary, sanitized error category, and retry state;
   - stop that account lane at the failed nonce when continuing would create nonce gaps;
   - allow other account lanes to continue when `continueOnFailure` is true;
   - enable rerun from the failed nonce for that account.
11. Stop requests mark the job as `stopping`, prevent new broadcasts, let in-flight broadcast promises resolve, and then mark remaining queued transactions as `stopped`.

P13 should implement the execution engine against injected signer and broadcaster interfaces so tests can prove behavior without sending live transactions.

Production UI wiring must not connect a visible arbitrary-job form to this engine. Later workflow pages may call the engine after their own P14+ specs define transaction construction, preview, risk notices, and user confirmation.

### Scheduling semantics

- `concurrency` is the maximum number of account lanes that may be actively signing or broadcasting at the same time.
- Same-account transactions are never parallelized even when `concurrency` is greater than `1`.
- `walletIntervalMs` is the minimum delay between starting two transactions in the same account lane. It does not delay different account lanes.
- `rpcRequestsPerSecond` is a global token bucket for queue-owned RPC calls: chain validation, pending nonce reads, gas/fee reads added later, and broadcast calls. It does not count local signing because signing is not an RPC call.
- The token bucket has capacity equal to `rpcRequestsPerSecond` and refills once per second in tests through an injected clock. No queue-owned RPC call may start without a token.
- If both `concurrency` and `rpcRequestsPerSecond` constrain work, the stricter available condition wins: a lane may run only when a concurrency slot and required RPC token are both available.
- Retry and rerun operations use the same concurrency, wallet interval, and RPC token bucket policy as first-run execution.
- Chain validation runs once per queue run before any signing and consumes one RPC token.
- Pending nonce reads consume one RPC token per account lane before that lane signs its first transaction.

## 7. Signing And Broadcasting Boundary

P13 may introduce signing and broadcasting abstractions, but the default UI must keep live user-facing business workflows gated. Unit and component tests may run the engine with injected fake signer/broadcaster adapters. Production P13 UI must not expose a visible control that builds and broadcasts arbitrary prepared drafts.

Required interfaces:

```ts
export interface QueueSigner {
  signTransaction(accountId: string, request: QueueUnsignedTransactionRequest): Promise<string>;
}

export interface QueueBroadcaster {
  validateChainId(expectedChainId: number): Promise<number>;
  getPendingNonce(accountAddress: string): Promise<number>;
  broadcastSignedTransaction(rawSignedTransaction: string): Promise<string>;
}
```

Rules:

- `QueueSigner` can derive an account signer only from the hot unlocked vault session.
- The queue must not ask for the vault password per transaction.
- Raw signed transactions may exist only inside the call stack needed to broadcast and must be discarded immediately after use.
- Raw signed transactions must never be persisted, logged, exported, or rendered.
- Errors must not include raw signed transactions, private keys, mnemonic phrases, passwords, full RPC URLs, API tokens, local paths, or serialized vault material.

## 8. Nonce And Retry Semantics

P13 uses pending nonces for the selected chain and account.

Rules:

- Same account: strict sequential nonce order.
- Different accounts: concurrent lanes are allowed.
- A failed nonce blocks later nonces for the same account until retry, skip, or rerun-from-failed-nonce policy decides otherwise.
- `resume stopped` is a current-tab operation. It depends on session-only prepared drafts still being present, refetches pending nonce for affected accounts, moves safe `stopped` records back to `queued`, and then continues with the same scheduling policy.
- `retry failed` is a current-tab operation. It reuses the session-only prepared drafts still held by the active queue, refetches pending nonce for affected accounts, and puts failed records back into `queued` only when their nonce can still be used safely.
- `rerun-from-failed-nonce` is a current-tab operation for one failed account lane. It preserves completed lower nonces, marks later failed/queued/stopped records for that account as `skipped`, creates new transaction records from the session-only drafts starting at the refreshed pending nonce, and links them to the original job.
- If a nonce is externally consumed, retry must refetch the pending nonce and mark older stale records as `skipped` with `nonce-consumed`, not silently reuse the stale nonce.
- After reload, durable history alone cannot resume or retry because prepared drafts are session-only. The UI must explain that resume/retry requires the original active queue session.

P13 does not do receipt polling or confirmation tracking. Broadcast success moves a transaction to `pending` with a tx hash. The history model must remain extensible for future `replaced`, `cancelled`, and `confirmed` states, but those statuses are reserved for later milestones and are not part of the P13 status enum.

### Legal retry transitions

| Event | Allowed transition | Notes |
| --- | --- | --- |
| Chain validation fails before signing | `queued` -> `failed` | No raw signed transaction exists. |
| Nonce load fails | `queued` -> `failed` | Error category `nonce-load-failed`. |
| Signing fails | `signing` -> `failed` | Error category `signing-failed`; do not persist raw request if it contains full calldata. |
| Broadcast fails before tx hash | `broadcasting` -> `failed` | Error category `broadcast-failed`; raw signed transaction is discarded. |
| Stop before start | `queued` -> `stopped` | No signing or broadcast occurs. |
| Stop while in flight | `broadcasting` -> `pending` or `failed` | Let the in-flight broadcast resolve, then stop later records. |
| Resume stopped current-tab run | `stopped` -> `queued` | Refetch pending nonce first; requires session-only draft. |
| Retry while pending nonce still equals failed nonce | `failed` -> `queued` | Reuses active session draft. |
| Retry after external nonce consumption | `failed` -> `skipped` plus new record `queued` | New record receives refreshed pending nonce. |
| Rerun from failed nonce | later same-account `failed`/`queued`/`stopped` -> `skipped`; new records -> `queued` | Completed lower nonces are preserved. |

## 9. Error Categories

Queue errors use stable categories:

- `chain-mismatch`
- `no-rpc`
- `vault-locked`
- `account-not-found`
- `nonce-load-failed`
- `signing-failed`
- `broadcast-failed`
- `rpc-rate-limited`
- `user-stopped`
- `unknown`

User-facing messages must be sanitized. Raw provider errors can be summarized but not persisted verbatim unless they pass redaction.

## 10. UI Requirements

The `队列/历史` workspace should be dense and Chinese-first:

- top status: idle/running/stopping/stopped/partial/completed/failed;
- settings row: concurrency, wallet interval ms, RPC requests per second, continue-on-failure, rerun-from-failed-nonce;
- active job table;
- transaction table grouped or sortable by job, account, nonce, status;
- failure details with account, nonce, action, sanitized error category;
- stop/resume/retry/export controls;
- empty and locked states.

Buttons must be explicit about queue operations, not business sends. Avoid labels that imply distribution, inscription, ABI execution, or arbitrary live send is already available.

## 11. Tests

Focused tests must cover:

- job and transaction model validation;
- redaction removes raw signed transactions, private keys, mnemonics, passwords, API tokens, bearer tokens, full RPC URLs, and local absolute paths;
- durable history persists only redacted records;
- active queue state and prepared drafts are not persisted;
- same-account transactions receive sequential nonces and execute in order;
- cross-account lanes execute concurrently within configured concurrency;
- default concurrency is `20` and can be changed in session;
- wallet interval and RPC rate-limit scheduling are respected by injected clock tests;
- chain mismatch blocks execution before signing;
- stop prevents new broadcasts and records stopped transactions;
- resume requires current-tab drafts, refetches pending nonce, and cannot run from durable history alone;
- failure at nonce N blocks later same-account nonces and supports rerun-from-failed-nonce;
- raw signed transaction returned by signer is passed to broadcaster but never stored in history, logs, exports, or UI;
- locked vault state disables queue execution;
- browser smoke opens `队列/历史` on desktop and mobile and verifies redacted history/export surfaces without live RPC.
- production UI does not expose a generic arbitrary transaction send form or business workflow send form in P13.

## 12. Documentation Requirements

P13 docs must update:

- `README.md`
- `docs/specs/evm-wallet-workbench.md`
- `docs/superpowers/project-overview.md`
- `docs/superpowers/roadmap.md`
- `docs/superpowers/project-status.md`

README should describe only completed P13 behavior after merge. It must not claim distribution, inscription, ABI write, reverse parsing, approval, or collection are usable until their milestones land.

## 13. Acceptance Criteria

P13 is complete when:

- `队列/历史` is a real workspace on `main`.
- P13 production UI does not expose an arbitrary transaction constructor or live business send form.
- The queue model separates jobs from transaction records.
- Same-account nonce ordering and cross-account concurrency are implemented and tested.
- Default concurrency is `20` and session-editable.
- Stop, resume stopped, retry failed, and rerun-from-failed-nonce are modeled and test-covered.
- Durable local history stores only redacted data.
- Exported JSON is redacted.
- Raw signed transactions, mnemonics, private keys, passwords, API tokens, full secret-bearing RPC URLs, local absolute paths, and serialized vault material are not persisted or displayed.
- Chain identity validation blocks execution before signing.
- The signing/broadcasting interfaces are testable through injected adapters and do not require repeated password prompts during an unlocked hot session.
- Distribution, inscription, ABI write, reverse parsing, and collection pages remain gated for later milestones.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke:browser`, and `git diff --check` pass before milestone merge.
