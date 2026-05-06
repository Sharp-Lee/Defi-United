# Project Overview

## Current summary

DeFi United is now a browser-first, PWA-only EVM wallet workbench. The repository now keeps only the browser runtime, PWA shell, browser encrypted vault, account-group model, and the tests/docs that support the active PWA mainline.

The current baseline is intentionally small and safety-focused: it supports local encrypted vault creation/unlock/import/export/lock, deterministic EVM account derivation, account groups, Chinese PWA navigation, responsive layout, manifest metadata, and focused verification. It does not yet sign, broadcast, submit RPC transactions, scan balances, or write real transaction history.

## Product direction

The active product is:

- Browser-first.
- PWA-only.
- Chinese-first in the default UI.
- Focused on advanced EVM account and workflow management.
- Built incrementally through P10+ milestones.

The project is not currently:

- A non-browser runtime.
- A backend application.
- A browser extension wallet.
- A consumer-simple wallet.
- A transaction submission product before the required chain, fee, signing, and history milestones land.

## Current implemented capabilities

The current shipped PWA baseline includes:

- Browser encrypted vault persisted in IndexedDB.
- Vault create, unlock, import, export, persist, and lock flows.
- Hot in-memory session semantics after unlock.
- Account groups.
- Deterministic EVM account derivation.
- Account selection and simple rename/group operations.
- Chinese PWA shell and primary navigation.
- Mobile-friendly layout baseline.
- Web manifest and installability metadata.
- Unit tests and browser smoke tests for the current baseline.

## Current safety boundaries

The current runtime follows these boundaries:

- Browser persistence stores encrypted vault data only for secret-bearing state.
- Passwords, mnemonic phrases, private keys, and raw signed transactions must not be written to persistent storage, logs, exports, diagnostics, or history.
- Unlock state is tab-local hot memory only.
- Lock, reload, tab close, or process recovery requires re-entry of the vault password.
- Current pages do not provide signing, broadcasting, RPC submission, balance scanning, or real transaction-history write paths.
- Future chain-aware features must validate chain identity before they are used for send or refresh workflows.

## Key runtime files

```text
src/App.tsx                       PWA app entry
src/app/PwaShell.tsx              Current shell, navigation, vault orchestration
src/features/pwaVault/            Vault access and account workspace UI
src/lib/browserVault.ts           IndexedDB encrypted vault persistence
src/core/browserVault/accounts.ts Account groups and deterministic derivation
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

The current mainline has been verified with the full sequence above after the PWA-only cleanup.

## Milestone status

- P10: PWA direction and docs convergence — complete.
- P10a: PWA shell and installability baseline — complete.
- P10b: Browser encrypted vault and account groups — complete.
- P10c: Chain / RPC config and shared fee panel — next.

## Next milestone: P10c

P10c should add browser-side chain/RPC config and a shared fee panel while preserving the current safety boundary.

Recommended scope:

- Add non-sensitive browser-side chain configuration outside the encrypted vault.
- Add active chain and RPC endpoint state.
- Add basic chain/RPC editing UI under `设置`.
- Add a reusable shared fee panel for future send flows.
- Keep fee state as draft/preview only.
- Do not add signing, broadcasting, nonce submission, or history writes.
- Keep the shell simple and avoid heavy routing/global-state abstractions.

## Current risks and watch points

- Do not claim future P10c+ capabilities as current runtime behavior.
- Do not mix chain settings into the encrypted vault unless a future migration explicitly requires it.
- Do not introduce signing or broadcast controls before chain identity, fee, confirmation, history, and security review milestones are ready.
- Keep docs, tests, and status synchronized with each milestone.
- Keep generated/local tooling directories out of product commits unless explicitly intended.

## Overall assessment

The repository is now in a healthy post-cleanup state: the active product path is clear, the runtime is small, the safety model is explicit, and the verification loop is established. The next best step is to implement P10c as a conservative browser-side settings and fee-preparation milestone, without opening any transaction execution path yet.
