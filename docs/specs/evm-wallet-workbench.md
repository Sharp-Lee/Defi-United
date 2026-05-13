# EVM Wallet Workbench PWA Spec

## 1. Product direction

EVM Wallet Workbench is a browser-first, PWA-only wallet workbench for EVM users. The active product is the Chinese console shell plus browser encrypted vaults, account groups, local chain/RPC settings, and session-only transaction context previews. On the P12 milestone branch it also includes read-only asset visibility; that branch still requires the final release gate and merge before the P12 asset surface becomes the `main` baseline.

This document records the current product boundary, what is implemented, and what is intentionally not in scope yet.

## 2. Current baseline

The current shipped `main` baseline is:

- Chinese console shell with left navigation, stable top context, responsive layout, and manifest metadata.
- Browser encrypted vault stored locally in IndexedDB.
- Vault create, unlock, password-verified import, export, lock, and persist flows.
- Account groups and deterministic EVM account derivation.
- Browser-side chain/RPC settings persisted as non-secret local settings.
- Session-only shared fee draft surfaced in settings and the top context bar.

The current `codex/p12-asset-watchlist` milestone branch additionally includes:

- Read-only assets module wired into the PWA shell.
- Watched ERC-20 registry persisted as non-secret token definitions in localStorage.
- Session-only native and watched ERC-20 balance snapshots for selected accounts.
- Balance refresh validates chain identity through an enabled RPC endpoint before reading balances.
- Focused unit tests and browser smoke coverage for the PWA baseline.

## 3. Implemented capabilities

### 3.1 PWA shell

- Main entry renders the PWA shell by default.
- Primary navigation exposes the planned product areas:
  - 总览
  - 账户库
  - 资产
  - 分发/归集
  - 铭文刻录
  - 合约调用
  - 队列/历史
  - 设置
- Non-account sections currently show planned / unavailable state instead of fake wallet actions.
- The top context bar shows account counts, selected chain/RPC label, and session fee context without exposing the full RPC URL.

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

### 3.4 Chain/RPC settings

- Chain/RPC settings are browser-local, non-secret settings used to preserve selected network context across PWA reloads.
- RPC URLs are stored verbatim in local browser storage and must not include API keys, bearer tokens, or other credentials.
- Runtime surfaces show the RPC label, not the full RPC URL.
- These settings do not imply transaction submission, chain history writes, or RPC safety validation in the current scope.

### 3.5 Shared fee draft and top context

- Max fee, priority fee, base fee override, and multiplier edits are session-only drafts.
- The top context bar mirrors the current session fee context so users can see Max, Tip, and Base assumptions while navigating modules.
- Fee drafts reset when the session resets and are not persisted to local storage.

### 3.6 Assets

- The `资产` module is ready in the PWA shell as a read-only workspace.
- Watched ERC-20 definitions persist in localStorage as non-secret token metadata.
- Native and ERC-20 balance snapshots are React session-only and reset on reload, lock, or session replacement.
- Refresh requires unlocked vault state, selected accounts, a selected chain, and an enabled RPC endpoint.
- Refresh validates the live RPC chain identity before native or ERC-20 balance reads.
- Disabled RPC endpoints cannot be used for asset refresh.
- Lock clears existing snapshots and invalidates in-flight refresh results.
- The UI surfaces explicit locked, no selected accounts, no enabled RPC, chain mismatch, failed, partial, and stale snapshot states.
- RPC refresh errors shown in the UI must redact full RPC URLs, tokens, and credential-bearing details.
- Browser smoke opens the asset module on desktop and mobile without depending on live RPC.
- The asset module does not sign, broadcast, submit transactions, manage nonces, approve tokens, transfer tokens, distribute/collect funds, execute calldata, run ABI write calls, or write execution history.

### 3.7 PWA manifest and smoke coverage

- The app ships with PWA manifest metadata for the browser-first runtime.
- Browser smoke coverage verifies the PWA baseline on desktop and mobile Chromium viewports.

## 4. Security model

- Secret-bearing wallet state is stored only as encrypted vault material in IndexedDB.
- Browser persistence may also store non-secret chain/RPC settings.
- Browser persistence may store non-secret watched ERC-20 definitions.
- RPC URLs are stored verbatim in local browser storage and must not contain API keys, tokens, or other credentials.
- Fee/base fee/priority fee/multiplier edits are session-only.
- Balance snapshots are session-only and must be cleared or invalidated when lock/session context changes.
- Plaintext mnemonic phrases, passwords, private keys, and raw signed transactions must not be written to logs, export files, or persistent storage.
- The current product boundary does not include signing, broadcasting, RPC submission, or chain history writes.
- Future chain-aware features must continue to validate chain identity before any send or refresh workflow.
- 985monitor/wallet is a product breadth benchmark for module coverage and workflow inspiration; it is not a security model.

## 5. Product boundaries

### In scope for the active PWA mainline

- Shell navigation
- Browser encrypted vault
- Account groups and derivation
- Chain/RPC settings as non-secret local settings
- Session-only shared fee draft and top context display
- Manifest / installability metadata
- PWA-focused tests and smoke coverage

### In scope on `codex/p12-asset-watchlist` pending final gate and merge

- Read-only native and watched ERC-20 balance snapshots
- Watched ERC-20 token definitions as non-secret local settings

### Not yet in scope

- Signing, broadcasting, or RPC transaction submission
- Batch execution or history write paths
- Distribution / collection workflows
- Inscriptions or calldata execution
- ABI contract calls
- Hot transaction reverse parsing
- NFT / portfolio discovery beyond the watched ERC-20 list
- Authorization scanning or revocation

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
