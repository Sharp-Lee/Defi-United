# Wallet Benchmark Product Design

## 1. Purpose

DeFi United will become a browser-first PWA wallet workbench for fast EVM account operations. The product should match or exceed the operational breadth of `https://985monitor.xyz/wallet/` while keeping DeFi United's stricter security model.

This document is the long-lived product capability spec for the PWA wallet workbench. It is not a single implementation milestone. Individual milestones must write their own implementation plans against this spec.

## 2. Product Position

DeFi United is:

- browser-first and installable as a PWA;
- usable on PC and mobile browsers;
- Chinese-first in the interface;
- optimized for time-sensitive EVM operations;
- built around encrypted local wallet custody and front-end signing;
- organized as a professional control console, not a consumer-simple wallet.

DeFi United is not:

- a Tauri desktop product;
- a browser extension wallet;
- a backend-custody service;
- a plaintext-private-key localStorage wallet;
- a marketing landing page.

## 3. External Benchmark

The 985monitor wallet page is the product benchmark for breadth, speed, and workflow density. Its security model is not the benchmark.

Observed 985monitor capabilities to compete with:

- broad EVM chain presets and RPC switching;
- wallet groups, bulk private-key import, random wallet creation, vanity generation;
- selected-wallet batch contract calls in raw calldata and ABI modes;
- transaction-hash-based operation copying and sender/self address replacement;
- contract-based native distribution in one funding transaction;
- approve plus contract-based ERC-20 distribution;
- native and ERC-20 collection;
- live balance visibility;
- execution queue logs, stop controls, and JSON state export;
- NFT mint monitoring through server-push style data.

DeFi United should keep its own stronger baseline:

- encrypted vault in IndexedDB for secret-bearing wallet state;
- PBKDF2 policy enforcement and AES-GCM vault encryption;
- password-verified vault import with explicit overwrite confirmation;
- hot in-memory session after unlock;
- no plaintext private-key TXT export by default;
- no plaintext mnemonic, private key, password, or raw signed transaction in logs, localStorage, history, exports, or diagnostics;
- no dedicated RPC secret storage until a later encrypted or session-only secret design exists.

## 4. User Requirements

### 4.1 Account model

- One mnemonic group can derive many child accounts.
- The account library supports selecting all or part of local accounts for workflows.
- Account labels, groups, and derived account metadata are stored inside the encrypted vault.
- Future imported-private-key accounts require a dedicated safety spec before implementation.
- Random wallet creation and vanity generation are useful, but vanity generation is deferred until the main transaction workflows exist.

### 4.2 Chain, RPC, and fee model

- The app provides common EVM chain presets and custom chain configuration.
- RPC URL is a persisted local endpoint setting and must warn that URLs containing API keys or tokens are stored as-is.
- Users should not enter secret-bearing RPC URLs. Future API-key or token support requires a separate encrypted or session-only secret design.
- Before any send, refresh, or balance action, the app validates `eth_chainId` against the selected chain.
- Every transaction-sending page shows:
  - latest base fee when available;
  - editable base fee override;
  - priority fee;
  - max fee / multiplier controls;
  - gas limit or estimate;
  - estimated native cost.
- Fee edits, base fee overrides, priority fee edits, multipliers, transaction drafts, active queue drafts, and raw signed material are session-only and reset on page reload or reopen.
- Defaults are safe and fast. User edits apply only to the current page session.

### 4.3 Asset visibility

- Selected local accounts can display native balances.
- Watched ERC-20 balances are supported.
- Balance refresh validates chain identity first.
- Stale, failed, or partial data is shown explicitly and never silently becomes zero.
- Asset results are suitable for selecting accounts for distribution, collection, inscriptions, and contract calls.

### 4.4 Execution queue

- The PWA performs front-end transaction building, signing, and broadcasting after unlock.
- The user should not be asked for the vault password repeatedly during an active hot session.
- Each send-like workflow creates queue jobs before broadcasting.
- Same-account transactions are nonce-serialized.
- Different accounts can run concurrently.
- Default concurrency is `20`.
- Concurrency, wallet interval, and RPC rate-limit behavior are configurable.
- If one nonce fails, the queue continues where safe and can rerun from the failed nonce.
- Queue state supports stop, resume/retry, and redacted JSON export.
- History records must not persist raw signed transactions or secrets.

### 4.5 Distribution and collection

Distribution and collection live on one page.

Native distribution:

- A funding account calls the required distribution contract.
- The transaction sends native token to many local or external target accounts.
- The default allocation can average the total amount across selected targets.
- Per-target amounts remain editable.
- This should be one funding transaction when the contract supports it.

ERC-20 distribution:

- A funding account approves the required distribution contract when allowance is insufficient.
- The distribution contract then distributes token amounts to many local or external targets.
- Approval, allowance, and distribution steps are visible before execution.

Native collection:

- Selected local accounts collect native token to one target.
- The target can be a local account or an external address.
- Each source account sends its own transaction.
- Gas reserve and amount rules are configurable.

ERC-20 collection:

- Selected local accounts collect ERC-20 balances to one target.
- The target can be a local account or an external address.
- Each source account sends its own transaction.
- Default behavior can collect full token balance, with configurable partial or percentage modes.

The required distribution contract is:

```text
0xd15fe25ed0dba12fe05e7029c88b10C25e8880E3
```

Contract ABI, method names, chain coverage, allowance semantics, and failure categories must be verified in the implementation spec before live send is enabled.

### 4.6 Inscription and calldata page

The inscription page is a speed-focused specialization of raw calldata sending.

- User selects one or many local accounts.
- Target mode can be:
  - self-transfer, where each account sends to itself;
  - fixed target, where all selected accounts send to one chosen address.
- Calldata mode can be:
  - hex, such as `0x646174613a2c7b2270223a2265646d74222c226f70223a22656d742d6d696e74222c227469636b223a22656e6174222c22626c6b223a223139363730393631227d`;
  - text, such as `data:,{"p":"edmt","op":"emt-mint","tick":"enat","blk":"19670961"}`.
- Text mode converts UTF-8 text into hex calldata.
- User can configure repeat count per account.
- Expanded transactions are previewed before signing.
- Failed nonce continuation follows the shared execution queue rules.

### 4.7 Contract calls and ABI helpers

The contract call page supports selected-wallet multi-call workflows.

- User enters a contract address.
- The app attempts to fetch verified ABI through the configured explorer path when available.
- If ABI is unavailable, user can paste or import ABI JSON.
- If ABI is still unavailable, user can use raw calldata mode.
- Write methods generate transaction drafts.
- Read methods can run RPC calls without signing.
- Function forms must make array and tuple inputs practical.
- Address-array parameters can be filled by selecting local accounts.
- Parameters can use a `Self` placeholder where each selected sending account supplies its own address.
- All write calls share the global fee, nonce, preview, risk, and queue components.

### 4.8 Hot transaction reverse parsing

The app supports reverse parsing by transaction hash and, where useful, by contract address.

Transaction hash mode:

- Fetch transaction and receipt.
- Resolve contract address, sender, calldata, value, and status.
- Fetch ABI when possible.
- Decode calldata into function and parameters when ABI exists.
- Detect repeated addresses and sender-related fields.
- Offer `Self` replacement for fields that should become per-sender values.
- Generate an editable contract-call draft or raw-calldata draft.

Contract address mode:

- Fetch ABI when verified ABI is available.
- If ABI is unavailable, show a best-effort reverse-analysis entry point but keep confidence labels explicit.
- Never pretend selector-only guesses are verified ABI.

### 4.9 Queue logs and history

- Queue logs show real-time task progress.
- User can stop a running queue.
- User can export redacted queue status JSON.
- History distinguishes job status from transaction records.
- Records include account, chain, nonce, action type, target, value summary, calldata/function summary, fee summary, tx hash if broadcast, and error category.
- Logs and exports must redact or omit secrets, raw signed transactions, private keys, mnemonics, passwords, API tokens, and local absolute paths.

### 4.10 Mobile and PC UX

- PC layout favors high-density operation and side-by-side preview.
- Mobile layout keeps the same workflows usable through folded navigation and preview rails.
- Critical actions remain reachable on mobile.
- Text must fit inside controls at common mobile widths.
- The app must be tested through production-preview desktop and mobile browser smoke tests.

## 5. Required Shared Components

The following shared components must exist before feature pages start duplicating transaction logic:

- `ChainContextBar`: selected chain, RPC status, chainId validation, latest base fee.
- `FeeControls`: base fee, priority fee, multiplier, max fee, gas limit, estimated cost.
- `AccountSelector`: local account selection, all/partial select, group filters.
- `TransactionPreviewRail`: per-workflow transaction summary, risk notices, fee summary, queue summary.
- `RiskNotice`: explicit warnings for approvals, unknown ABI, chain mismatch, high fee, and persisted RPC URL secrets.
- `QueueController`: concurrency, rate-limit, stop, retry, resume, and export controls.
- `AddressInput`: local account picker plus external address input.
- `AbiInput`: fetch, paste, import, validation, and function selection.
- `CalldataInput`: hex and text modes with conversion preview.

## 6. Milestone Order

The intended order is:

1. P10d clean architecture rebase and professional shell.
2. P11 account library expansion.
3. P12 asset watchlist and balance snapshots.
4. P13 execution queue, nonce model, signing, broadcasting, and redacted history.
5. P14 distribution and collection.
6. P15 inscription and calldata.
7. P16 contract calls and ABI helpers.
8. P17 hot transaction reverse parsing.
9. P18 mobile polish and release wording.

This order is deliberate. Distribution, inscriptions, and contract calls should not ship live send buttons before the queue, nonce, chain validation, signing redaction, and history model exist.

## 7. Deferred Decisions

### 7.1 NFT mint monitoring

NFT mint monitoring is valuable but likely requires a backend, websocket gateway, or third-party stream. It needs a separate product decision spec covering latency, data source, server cost, privacy, API keys, filtering, and monetization.

### 7.2 Vanity generation

Vanity generation can be pure browser work with a Web Worker pool. It is deferred until account library and transaction workflows are stable.

### 7.3 Private-key import

Bulk private-key import is useful for parity with 985monitor. It must not use plaintext localStorage. A future safety spec must decide:

- encrypted storage format;
- import confirmation;
- export policy;
- whether plaintext private-key export is forbidden or gated;
- how to label high-risk imported accounts.

## 8. Verification Baseline

Every implementation milestone must at minimum run:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:browser
git diff --check
```

Security-sensitive milestones must add focused tests for redaction, chain identity, queue retry behavior, and persistence boundaries.

## 9. Acceptance Criteria For The Full Product

The full product target is met when:

- encrypted account groups can drive all major workflows;
- selected accounts can be inspected for native and ERC-20 balances;
- transaction-sending pages share fee, nonce, preview, risk, and queue controls;
- front-end signing and broadcasting work without repeated password prompts during a hot session;
- distribution and collection support native and ERC-20 flows;
- inscription workflows support hex and text calldata, self/fixed targets, and repeat counts;
- ABI workflows support fetch, paste/import, local-address parameter filling, and raw fallback;
- transaction reverse parsing can turn a tx hash into an editable batch draft when data is sufficient;
- queue/history can stop, retry, resume, and export status without leaking secrets;
- PC and mobile production-preview smoke tests pass;
- docs describe only completed runtime capabilities as current capabilities.

## 10. Review Notes

The user's 985monitor gap analysis is accepted with these refinements:

- 985monitor is a functional benchmark, not a security benchmark.
- Raw calldata is the substrate for inscriptions, but a dedicated inscription page is still required for speed.
- NFT mint monitoring is not part of the pure-PWA path until a backend/gateway decision is made.
- The next engineering priority is not copying every feature immediately. The priority is P10d architecture, then P11-P13 foundations, then the high-value P14-P17 workflows.
