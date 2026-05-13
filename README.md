# DeFi United PWA 钱包工作台

Browser-first PWA wallet workbench for EVM accounts, assets, batch workflows, ABI / contract calls, and auditable local history.

This repository is now PWA-only. The current tree contains only the browser runtime, PWA shell, vault workflow, and PWA verification assets.

## Current capabilities

- Browser encrypted vault stored in IndexedDB.
- Create, unlock, password-verified import, export, lock, and persist encrypted vault sessions.
- Account groups and deterministic EVM account derivation.
- Chinese-first PWA shell with mobile-friendly layout and manifest metadata.
- PWA vault workspace for group/account management.
- Focused tests and browser smoke coverage for the current PWA baseline.
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
src/app/PwaShell.tsx             Current PWA shell
src/features/pwaVault/           PWA vault UI
src/features/pwaSettings/        Chain/RPC and fee draft UI
src/lib/browserVault.ts          IndexedDB encrypted vault persistence
src/lib/browserChainConfig.ts    Browser chain/RPC config persistence
src/core/browserVault/accounts.ts PWA account group and derivation model
src/core/browserChainConfig.ts   Chain/RPC and fee domain model
public/manifest.webmanifest      PWA manifest baseline
tests/browser/pwa-smoke.spec.ts  Browser smoke coverage
docs/                            Current overview, roadmap, workflow, status, and specs
```
