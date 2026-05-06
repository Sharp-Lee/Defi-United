# EVM Wallet Workbench PWA Spec

## 1. Product direction

EVM Wallet Workbench is a browser-first, PWA-only wallet workbench for EVM users. The active product is the Chinese PWA shell plus the browser encrypted vault and account-group model.

This document records the current product boundary, what is implemented, and what is intentionally not in scope yet.

## 2. Current baseline

The current shipped baseline is:

- Chinese PWA shell with responsive layout and manifest metadata.
- Browser encrypted vault stored locally in IndexedDB.
- Vault create, unlock, password-verified import, export, lock, and persist flows.
- Account groups and deterministic EVM account derivation.
- Focused unit tests and browser smoke coverage for the PWA baseline.

## 3. Implemented capabilities

### 3.1 PWA shell

- Main entry renders the PWA shell by default.
- Primary navigation exposes the planned product areas:
  - 账户
  - 资产
  - 分发/归集
  - 铭文刻录
  - 合约调用
  - 历史
  - 设置
- Non-account sections currently show planned / unavailable state instead of fake wallet actions.

### 3.2 Browser vault

- Vault data is encrypted before being persisted.
- Passwords, mnemonics, private keys, and raw signed transactions must never be written to persistent storage.
- Unlock state lives only in the current tab session.
- Manual lock clears hot state and returns the shell to the access view.
- Import / export works on encrypted vault envelopes only.
- Import must decrypt with the imported vault password before saving and must require explicit overwrite confirmation when a local vault already exists.
- Imported envelopes must satisfy the current PBKDF2 policy before they are accepted.

### 3.3 Account groups

- One vault maps to one account group model.
- Groups can be selected, renamed, and extended with derived accounts.
- Derived accounts are deterministic and remain tied to the active vault state.
- Account state is managed entirely in the browser runtime.

## 4. Security model

- Browser persistence stores only encrypted vault material and other non-sensitive PWA state.
- Plaintext mnemonic phrases, passwords, private keys, and raw signed transactions must not be written to logs, export files, or persistent storage.
- The current product boundary does not include signing, broadcasting, RPC submission, or chain history writes.
- Future chain-aware features must continue to validate chain identity before any send or refresh workflow.

## 5. Product boundaries

### In scope for the active PWA mainline

- Shell navigation
- Browser encrypted vault
- Account groups and derivation
- Manifest / installability metadata
- PWA-focused tests and smoke coverage

### Not yet in scope

- Chain configuration and shared fee panel
- Native asset scanning
- Token watchlists
- Batch execution and local history
- Distribution / collection workflows
- Inscription workflows
- Contract call workflows

## 6. Source of truth

Keep these docs aligned with the current runtime:

- `README.md`
- `docs/superpowers/project-overview.md`
- `docs/superpowers/development-workflow.md`
- `docs/superpowers/project-status.md`
- `docs/superpowers/roadmap.md`

## 7. Verification

Before closing PWA changes, run:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:browser
```

The browser smoke command uses the production preview server and covers both desktop Chromium and a mobile Chromium viewport. It is still a smoke gate, not a substitute for future send/signing safety tests.

Then confirm the working tree is clean with:

```bash
git diff --check
```
