# DeFi United PWA 钱包工作台

Browser-first PWA wallet workbench for EVM accounts, assets, batch workflows, ABI / contract calls, and auditable local history.

This repository is now PWA-only. The current tree contains only the browser runtime, PWA shell, vault workflow, and PWA verification assets.

## Current capabilities

- Browser encrypted vault stored in IndexedDB.
- Create, unlock, import, export, lock, and persist encrypted vault sessions.
- Account groups and deterministic EVM account derivation.
- Chinese-first PWA shell with mobile-friendly layout and manifest metadata.
- PWA vault workspace for group/account management.
- Focused tests and browser smoke coverage for the current PWA baseline.

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
- RPC and chain-specific features should continue to validate chain identity before any future send or history workflow is introduced.

## Key paths

```text
src/App.tsx                      PWA app entry
src/app/PwaShell.tsx             Current PWA shell
src/features/pwaVault/           PWA vault UI
src/lib/browserVault.ts          IndexedDB encrypted vault persistence
src/core/browserVault/accounts.ts PWA account group and derivation model
public/manifest.webmanifest      PWA manifest baseline
tests/browser/pwa-smoke.spec.ts  Browser smoke coverage
docs/                            Current overview, roadmap, workflow, status, and specs
```
