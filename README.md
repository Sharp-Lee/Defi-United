# DeFi United PWA 钱包工作台

Browser-first PWA wallet workbench foundation for encrypted EVM account management, local chain/RPC settings, and a professional console shell.

This repository is now PWA-only. The current tree contains only the browser runtime, console-shell architecture, vault workflow, local chain/RPC settings, and PWA verification assets.

## Current capabilities

- Browser encrypted vault stored in IndexedDB.
- Create, unlock, password-verified import, export, lock, and persist encrypted vault sessions.
- Account groups and deterministic EVM account derivation.
- Chinese-first console shell with left navigation, top context, main workspace, and preview/risk rail.
- PWA vault workspace for group/account management.
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

- The browser persistent layer only stores encrypted vault data.
- Passwords, mnemonics, private keys, and raw signed transactions must never be written to persistent storage or logs.
- Unlock state is a hot in-memory session only; lock or reload requires re-entry of the password.
- Imported encrypted vault files must pass password verification and current KDF policy before they can replace a local vault.
- RPC and chain-specific settings remain local drafts until future send/history workflows add chain identity validation and confirmation gates.
- Fee edits, base fee overrides, priority fee edits, multipliers, transaction drafts, and active queue drafts are session-only.
- 985monitor/wallet is a product breadth benchmark, not a security model to copy.

## Key paths

```text
src/App.tsx                      PWA app entry
src/app/PwaShell.tsx             Vault, chain, session, and feature orchestration
src/app/shell/                   Console shell layout
src/app/state/                   Pure app navigation/session helpers
src/features/accounts/           Account vault and local account library UI
src/features/settings/           Chain/RPC and fee draft UI
src/shared/                      Shared UI, formatting, validation, constants
src/services/storage/            Browser storage service boundaries
src/styles/                      Split design tokens, layout, components, features
public/manifest.webmanifest      PWA manifest baseline
tests/browser/pwa-smoke.spec.ts  Browser smoke coverage
docs/                            Current overview, roadmap, workflow, status, and specs
```
