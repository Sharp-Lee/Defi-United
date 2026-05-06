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

Build browser-side chain configuration and the shared fee model for all future send flows.

**Done when**

- RPC URL is treated as an access endpoint, not chain identity.
- Chain identity is validated before any future send or account-refresh flow.
- Shared fee panel exposes gas, fee, nonce, and total cost clearly.

### P10d Asset watchlist and balance snapshots

Add browser-side asset visibility for native balances and watched ERC-20s.

**Done when**

- Selected accounts can display native and token balances.
- Balance refreshes validate chain identity.
- Failed or stale snapshots are never shown as zero without explicit status.

### P10e Batch execution and history model

Build browser-side job execution and durable local history.

**Done when**

- Batch jobs and transaction records are represented separately.
- Same-account nonce ordering is preserved.
- Failure records include account, nonce, transaction summary, error category, and retry state.

### P10f Distribution and collection page

Implement the PWA distribution / collection page on top of the shared fee panel, queue, and history model.

### P10g Inscription minting page

Implement the PWA inscription workflow with multi-account planning and calldata preview.

### P10h Contract call page with ABI helpers

Implement the PWA contract call page with ABI import, validation, and read/write helpers.

### P10i Mobile polish and release wording

Polish the PWA install path, mobile UX, and documentation wording for release.

## Deferred backlog

- Portfolio / NFT discovery beyond watched assets.
- Expanded authorization discovery.
- Advisory risk scoring.
- Wallet recovery automation.
- Broader contract interaction tooling.

## Non-goals and safety boundaries

- Do not introduce non-PWA runtime assumptions.
- Do not store mnemonic phrases, private keys, passwords, raw signed transactions, or full RPC secrets in logs, exports, or history.
- Do not claim future capability as current runtime capability.
- Keep `git diff --check` green before closing any task.
