# Project Overview

## Current summary

DeFi United is now a browser-first, PWA-only EVM wallet workbench. The repository now keeps only the browser runtime, P10d console-shell architecture, browser encrypted vault, account-group model, local chain/RPC settings, read-only asset workspace, and the tests/docs that support the active PWA mainline.

The current milestone branch baseline is intentionally small and safety-focused: it supports local encrypted vault creation/unlock/import/export/lock, deterministic EVM account derivation, account groups, account-library multi-select and batch derivation, Chinese console navigation, responsive layout, manifest metadata, local chain/RPC settings, session-only fee drafts, and read-only asset snapshots for selected accounts. P11 is merged to `main` and post-merge verified. P12 is complete on `codex/p12-asset-watchlist` through shell integration and browser smoke, and is awaiting the final release gate and merge before it becomes the `main` baseline. The app still does not sign, broadcast, submit RPC transactions, manage nonces, run distribution / collection, execute ABI or calldata workflows, reverse-parse hot transactions, scan NFT/portfolio holdings, scan/revoke authorizations, or write real transaction history.

## Product direction

The active product is:

- Browser-first.
- PWA-only.
- Chinese-first in the default UI.
- Focused on advanced EVM account and workflow management.
- Built incrementally through P10+ milestones.
- Guided by `https://985monitor.xyz/wallet/` as a product breadth benchmark, while keeping DeFi United's stricter encrypted-vault security model.

The project is not currently:

- A non-browser runtime.
- A backend application.
- A browser extension wallet.
- A consumer-simple wallet.
- A transaction submission product before the required chain, fee, signing, and history milestones land.

## Current implemented capabilities on this branch

The current PWA baseline on `codex/p12-asset-watchlist` includes:

- Browser encrypted vault persisted in IndexedDB.
- Vault create, unlock, password-verified import, export, persist, and lock flows.
- Hot in-memory session semantics after unlock.
- Account groups.
- Deterministic EVM account derivation.
- Account multi-select, select all / clear, batch derivation, and simple rename/group operations.
- Chinese console shell with left navigation, top context bar, main workspace, and right preview/risk rail.
- Mobile-friendly layout baseline.
- Web manifest and installability metadata.
- Browser-side chain/RPC settings.
- Shared fee draft preview with session-only fee edits.
- Read-only assets module wired into the PWA shell on `codex/p12-asset-watchlist`.
- Watched ERC-20 registry persisted as non-secret token definitions in localStorage.
- Session-only native and watched ERC-20 balance snapshots for selected accounts.
- Chain-identity-validated asset refresh through enabled RPC endpoints only.
- Explicit asset states for locked vaults, no selected accounts, no enabled RPC, chain mismatch, failed/partial refreshes, and stale snapshots.
- Planned future modules are visible as unavailable / planned surfaces only.
- Unit tests and browser smoke tests for the current branch baseline.

## Current safety boundaries

The current runtime follows these boundaries:

- Browser persistence stores encrypted vault data only for secret-bearing state.
- Passwords, mnemonic phrases, private keys, and raw signed transactions must not be written to persistent storage, logs, exports, diagnostics, or history.
- Vault import must decrypt with the imported vault password and satisfy the current KDF policy before it can overwrite browser storage.
- Unlock state is tab-local hot memory only.
- Lock, reload, tab close, or process recovery requires re-entry of the vault password.
- Watched ERC-20 definitions are non-secret local settings; balance snapshots are session-only and are cleared or invalidated on reload, lock, and context changes.
- Current pages do not provide signing, broadcasting, RPC transaction submission, nonce management, distribution / collection, ABI write calls, calldata inscription execution, reverse parsing, NFT/portfolio discovery, authorization scanning/revocation, or real transaction-history write paths.
- Future chain-aware features must validate chain identity before they are used for send or refresh workflows.

## Key runtime files

```text
src/App.tsx                       PWA app entry
src/app/PwaShell.tsx              Vault, chain, session, and feature orchestration
src/app/shell/                    Console shell layout and unavailable module surfaces
src/app/state/                    Pure app navigation and session summary helpers
src/features/accounts/            Account vault and local account library UI
src/features/assets/              Read-only asset workspace and watched token UI
src/features/settings/            Chain/RPC and fee draft settings UI
src/core/assets/                  Watched token registry and balance snapshot helpers
src/services/rpc/                 Browser JSON-RPC client with redacted errors
src/shared/                       Shared UI, formatting, validation, and constants
src/services/storage/             Browser storage service boundaries and re-exports
src/styles/                       Split design tokens, layout, components, and feature CSS
public/manifest.webmanifest       PWA manifest baseline
tests/browser/pwa-smoke.spec.ts   Browser smoke coverage
```

## Documentation map

```text
README.md                                      Current user-facing summary
docs/specs/evm-wallet-workbench.md            Current product spec and safety boundary
docs/superpowers/development-workflow.md      Workflow and verification rules
docs/superpowers/project-status.md            Milestone status table
docs/superpowers/roadmap.md                   PWA roadmap and non-goals
docs/superpowers/project-overview.md          This current-state overview
docs/superpowers/specs/2026-05-13-wallet-benchmark-product-design.md
                                                Long-term product capability target
docs/superpowers/specs/2026-05-13-clean-architecture-rebase-design.md
                                                P10d architecture rebase spec
```

## Verification baseline

Before closing PWA changes, run:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:browser
git diff --check
```

The current `main` branch was verified with the full sequence above after P11 was merged. P12 still needs the final full release gate on `codex/p12-asset-watchlist` before merge.

## Milestone status

- P10: PWA direction and docs convergence — complete.
- P10a: PWA shell and installability baseline — complete.
- P10b: Browser encrypted vault and account groups — complete.
- P10c: Chain / RPC config and shared fee panel — complete.
- P10d: Clean architecture rebase — merged to `main` and post-merge verified.
- P11: Account library expansion — merged to `main` and post-merge verified.
- P12: Asset watchlist and balance snapshots — complete on `codex/p12-asset-watchlist` through shell integration and browser smoke; awaiting Task 5 docs, full release gate, final review, and merge.

## Next milestone: P13 execution queue and history model

After P12 merges, P13 should add the execution queue and history model needed before any signing/broadcasting workflows can safely ship.

Recommended scope:

- Represent batch jobs separately from transaction records.
- Preserve same-account nonce ordering while allowing cross-account concurrency.
- Model durable redacted local history without storing raw signed transactions or secrets.
- Track failure categories, retry state, and rerun-from-failed-nonce behavior.
- Keep distribution, inscriptions, ABI write calls, reverse parsing, and live transaction execution behind later milestone gates.

## Current risks and watch points

- Do not claim P12 as merged to `main` until the milestone branch is release-gated and merged.
- Do not claim future P13+ capabilities as current runtime behavior.
- Do not mix chain settings into the encrypted vault unless a future migration explicitly requires it.
- Do not introduce signing or broadcast controls before chain identity, fee, confirmation, history, and security review milestones are ready.
- Keep asset refresh read-only; disabled RPC endpoints, chain mismatch, stale snapshots, and partial failures must stay explicit.
- Keep RPC refresh errors redacted before they reach the UI.
- Do not copy 985monitor's plaintext private-key localStorage model.
- Keep docs, tests, and status synchronized with each milestone.
- Keep generated/local tooling directories out of product commits unless explicitly intended.

## Overall assessment

The repository is in a healthy P11-on-main state, and the P12 milestone branch now adds the first read-only chain data surface without opening transaction execution paths. The active product path is clear: finish the P12 release gate and merge, then move to the P13 queue/history foundation before any send-capable workflow.
