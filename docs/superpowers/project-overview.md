# Project Overview

## Current summary

DeFi United is now a browser-first, PWA-only EVM wallet workbench. The repository now keeps only the browser runtime, PWA shell, browser encrypted vault, account-group model, and the tests/docs that support the active PWA mainline.

The current baseline is intentionally small and safety-focused: it supports local encrypted vault creation/unlock/import/export/lock, deterministic EVM account derivation, account groups, Chinese PWA navigation, responsive layout, manifest metadata, local chain/RPC settings, and session-only fee drafts. The app still does not sign, broadcast, submit RPC transactions, scan balances, or write real transaction history.

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

## Current implemented capabilities

The current shipped PWA baseline includes:

- Browser encrypted vault persisted in IndexedDB.
- Vault create, unlock, password-verified import, export, persist, and lock flows.
- Hot in-memory session semantics after unlock.
- Account groups.
- Deterministic EVM account derivation.
- Account selection and simple rename/group operations.
- Chinese PWA shell and primary navigation.
- Mobile-friendly layout baseline.
- Web manifest and installability metadata.
- Browser-side chain/RPC settings.
- Shared fee draft preview with session-only fee edits.
- Unit tests and browser smoke tests for the current baseline.

## Current safety boundaries

The current runtime follows these boundaries:

- Browser persistence stores encrypted vault data only for secret-bearing state.
- Passwords, mnemonic phrases, private keys, and raw signed transactions must not be written to persistent storage, logs, exports, diagnostics, or history.
- Vault import must decrypt with the imported vault password and satisfy the current KDF policy before it can overwrite browser storage.
- Unlock state is tab-local hot memory only.
- Lock, reload, tab close, or process recovery requires re-entry of the vault password.
- Current pages do not provide signing, broadcasting, RPC submission, balance scanning, or real transaction-history write paths.
- Future chain-aware features must validate chain identity before they are used for send or refresh workflows.

## Key runtime files

```text
src/App.tsx                       PWA app entry
src/app/PwaShell.tsx              Current shell, navigation, vault orchestration
src/features/pwaVault/            Vault access and account workspace UI
src/features/pwaSettings/         Chain/RPC and fee draft settings UI
src/lib/browserVault.ts           IndexedDB encrypted vault persistence
src/lib/browserChainConfig.ts     Browser chain/RPC config persistence
src/core/browserVault/accounts.ts Account groups and deterministic derivation
src/core/browserChainConfig.ts    Chain/RPC and fee domain model
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

The current mainline has been verified with the full sequence above after P10c.

## Milestone status

- P10: PWA direction and docs convergence — complete.
- P10a: PWA shell and installability baseline — complete.
- P10b: Browser encrypted vault and account groups — complete.
- P10c: Chain / RPC config and shared fee panel — complete.
- P10d: Clean architecture rebase — spec written, implementation plan next.

## Next milestone: P10d

P10d should reshape the current PWA baseline into the professional control-console architecture before adding transaction execution features.

Recommended scope:

- Add the `app`, `core`, `services`, `features`, and `shared` source boundaries.
- Add the left navigation, top context bar, main workspace, and right preview/risk/queue rail.
- Migrate current vault and settings behavior without changing safety semantics.
- Show future modules as unavailable rather than pretending they work.
- Do not add signing, broadcasting, nonce submission, balance scanning, distribution, inscriptions, ABI calls, reverse parsing, or history writes.

## Current risks and watch points

- Do not claim future P10c+ capabilities as current runtime behavior.
- Do not mix chain settings into the encrypted vault unless a future migration explicitly requires it.
- Do not introduce signing or broadcast controls before chain identity, fee, confirmation, history, and security review milestones are ready.
- Do not copy 985monitor's plaintext private-key localStorage model.
- Keep docs, tests, and status synchronized with each milestone.
- Keep generated/local tooling directories out of product commits unless explicitly intended.

## Overall assessment

The repository is now in a healthy post-P10c state: the active product path is clear, the runtime is small, the safety model is explicit, and the verification loop is established. The next best step is to write the P10d implementation plan and execute the clean architecture rebase, without opening any transaction execution path yet.
