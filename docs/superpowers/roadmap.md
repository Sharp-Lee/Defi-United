# Roadmap

## Current baseline

- The active product mainline is browser-first PWA.
- The repository is PWA-only; active development targets the browser runtime and PWA workflow.
- The current delivered PWA baseline is the Chinese shell, manifest/installability metadata, browser encrypted vault, account groups, and deterministic account derivation.
- Current source of truth: `README.md`, `docs/specs/evm-wallet-workbench.md`, `docs/superpowers/project-overview.md`, `docs/superpowers/development-workflow.md`, and `docs/superpowers/project-status.md`.

## PWA roadmap

### P10 browser-first PWA direction

Keep the repository centered on the browser-first wallet workbench and keep the docs aligned with the PWA-only runtime.

**Done when**

- README, spec, workflow, status, and roadmap all describe the current PWA-only runtime.
- Active docs use PWA-only wording.
- Validation commands all target the browser-first stack.

### P10a PWA shell and installability baseline

The PWA shell, Chinese navigation, responsive layout, and manifest baseline are already in place.

**Done when**

- Browser opens the PWA shell directly.
- Primary navigation remains usable on desktop and mobile widths.
- Manifest and icon metadata are present and validated by tests.

### P10b Browser encrypted vault and account groups

The browser encrypted vault, hot session, account groups, and deterministic account derivation are already in place.

**Done when**

- Encrypted vault sessions can be created, unlocked, imported, exported, locked, and persisted locally.
- Account groups and derived accounts remain deterministic and test-covered.
- No plaintext mnemonic, password, private key, or raw signed transaction is stored persistently.

### P10c Chain / RPC config and shared fee panel

Build browser-side chain configuration and a shared fee model for future send flows, starting as local settings and fee draft preview without signing or broadcasting.

**Done when**

- RPC URL is treated as an access endpoint, not chain identity.
- Chain identity requirements are explicit before any future send or account-refresh flow.
- Shared fee panel exposes gas, fee, and estimated native cost clearly without submit actions.

### P10d Clean architecture rebase

Reshape the current PWA baseline into a professional control-console architecture before adding transaction execution features.

**Done when**

- The app shell uses the left-navigation, top-context, main-workspace, and right-preview structure.
- Source code is organized around `app`, `core`, `services`, `features`, and `shared` boundaries.
- Current vault, chain/RPC, fee draft, manifest, and smoke-tested behavior still works.
- Future modules are visible but clearly marked as unavailable.
- The architecture reserves lanes for 985monitor-class wallet workflows without adopting plaintext private-key storage.

### P11 Account library

Expand the encrypted-vault account model toward fast wallet-library operation.

**Done when**

- Mnemonic groups can derive and manage many child accounts.
- Local accounts can be multi-selected for future workflows.
- Account labels, groups, and selection state stay inside the encrypted vault where appropriate.
- Any imported-private-key support has a dedicated safety spec before implementation.

### P12 Asset watchlist and balance snapshots

Add browser-side asset visibility for native balances and watched ERC-20s.

**Done when**

- Selected accounts can display native and token balances.
- Balance refreshes validate chain identity.
- Failed or stale snapshots are never shown as zero without explicit status.

### P13 Execution queue and history model

Build browser-side job execution and durable local history.

**Done when**

- Batch jobs and transaction records are represented separately.
- Same-account nonce ordering is preserved.
- Failure records include account, nonce, transaction summary, error category, and retry state.
- Queue status can be stopped and exported without raw signed transactions or secrets.

### P14 Distribution and collection page

Implement the PWA distribution / collection page on top of the shared fee panel, queue, and history model.

**Done when**

- Native distribution uses the required distribution contract.
- ERC-20 distribution supports approve plus distribution contract flow.
- Native and ERC-20 collection can move funds from selected local accounts to a target account.
- Failure and retry behavior is routed through the queue model.

Known distribution contract:

```text
0xd15fe25ed0dba12fe05e7029c88b10c25e8880e3
```

### P15 Inscription and calldata page

Implement the PWA inscription workflow with multi-account planning and calldata preview.

**Done when**

- Raw calldata supports hex mode.
- Text payloads can be converted into calldata.
- Each account can self-target or use a fixed target address.
- Per-account repeat count and failed-nonce continuation are modeled.

### P16 Contract call page with ABI helpers

Implement the PWA contract call page with ABI import, validation, and read/write helpers.

**Done when**

- ABI can be pasted/imported.
- Explorer ABI fetch by contract address is supported where possible.
- Address-array parameters can be filled from selected local accounts.
- Raw calldata fallback remains available when ABI is unavailable.

### P17 Hot transaction reverse parsing

Build transaction-hash-based reverse parsing into editable batch-call drafts.

**Done when**

- Transaction hash lookup fetches transaction, receipt, and ABI where possible.
- Calldata is decoded into function and parameters where ABI exists.
- Repeated or sender-related address fields can be replaced with `Self`.
- The result can become an editable contract-call or raw-calldata draft.

### P18 Mobile polish and release wording

Polish the PWA install path, mobile UX, and documentation wording for release.

## Deferred backlog

- Portfolio / NFT discovery beyond watched assets.
- NFT mint monitoring and any required backend / websocket gateway decision.
- Vanity address generation with a worker pool.
- Expanded authorization discovery.
- Advisory risk scoring.
- Wallet recovery automation.
- Broader contract interaction tooling.

## Non-goals and safety boundaries

- Do not introduce non-PWA runtime assumptions.
- Do not store mnemonic phrases, private keys, passwords, raw signed transactions, or full RPC secrets in logs, exports, or history.
- Do not claim future capability as current runtime capability.
- Keep `git diff --check` green before closing any task.
