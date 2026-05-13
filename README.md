# DeFi United PWA 钱包工作台

Browser-first PWA wallet workbench foundation for encrypted EVM account management, local chain/RPC settings, read-only asset visibility, and a professional console shell.

This repository is now PWA-only. The current tree contains only the browser runtime, console-shell architecture, vault workflow, local chain/RPC settings, read-only asset workspace, and PWA verification assets.

## Current capabilities

- Browser encrypted vault stored in IndexedDB.
- Create, unlock, password-verified import, export, lock, and persist encrypted vault sessions.
- Account groups and deterministic EVM account derivation.
- Account-library multi-select, select all / clear, and batch derivation controls inside the encrypted vault workspace.
- Chinese-first console shell with left navigation, top context, main workspace, and preview/risk rail.
- PWA vault workspace for group/account management.
- Read-only assets module wired into the PWA shell.
- Watched ERC-20 registry stored as non-secret token definitions in localStorage.
- Session-only native and watched ERC-20 balance snapshots for selected accounts.
- Chain-identity-validated balance refresh through enabled RPC endpoints only.
- Explicit asset states for locked vaults, no selected accounts, no enabled RPC, chain mismatch, failed/partial refreshes, and stale snapshots.
- Focused tests and browser smoke coverage for the current PWA console baseline.
- Browser-side chain/RPC settings and shared fee draft preview.

## Run

```bash
npm install
npm run dev
```

## Verify

```bash
npm test
npm run typecheck
npm run build
npm run smoke:browser
```

## Safety boundaries

- Secret-bearing wallet state is stored only as encrypted vault data in IndexedDB.
- Non-secret chain/RPC settings are persisted locally so the PWA can reopen with the selected network context.
- RPC URLs are stored verbatim in local browser storage and must not include API keys, bearer tokens, or other credentials.
- Watched ERC-20 definitions are non-secret local settings; balance snapshots are React session-only and reset on reload or lock.
- Passwords, mnemonics, private keys, and raw signed transactions must never be written to persistent storage or logs.
- Unlock state is a hot in-memory session only; lock or reload requires re-entry of the password.
- Imported encrypted vault files must pass password verification and current KDF policy before they can replace a local vault.
- Fee edits, base fee overrides, priority fee edits, multipliers, transaction drafts, and active queue drafts are session-only.
- Current asset refresh is read-only and does not sign, broadcast, submit transactions, manage nonces, approve, transfer, distribute, collect, execute calldata, or write execution history.
- Asset refresh errors must redact full RPC URLs and credentials before reaching the UI.
- 985monitor/wallet is a product breadth benchmark, not a security model to copy.

## Key paths

```text
src/App.tsx                      PWA app entry
src/app/PwaShell.tsx             Vault, chain, session, and feature orchestration
src/app/shell/                   Console shell layout
src/app/state/                   Pure app navigation/session helpers
src/features/accounts/           Account vault and local account library UI
src/features/assets/             Read-only asset workspace and watched token UI
src/features/settings/           Chain/RPC and fee draft UI
src/core/assets/                 Watched token registry and balance snapshot helpers
src/services/rpc/                Browser JSON-RPC client with redacted errors
src/shared/                      Shared UI, formatting, validation, constants
src/services/storage/            Browser storage service boundaries
src/styles/                      Split design tokens, layout, components, features
public/manifest.webmanifest      PWA manifest baseline
tests/browser/pwa-smoke.spec.ts  Browser smoke coverage
docs/                            Current overview, roadmap, workflow, status, and specs
```
