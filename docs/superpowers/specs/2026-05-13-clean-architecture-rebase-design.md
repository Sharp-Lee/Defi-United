# Clean Architecture Rebase Design

## 1. Purpose

The project will keep the browser-first PWA direction, but the current baseline should be reshaped before large wallet features are added.

This milestone is a clean architecture rebase: preserve the verified safety kernel, rebuild the upper application structure, and create a professional Chinese wallet workbench shell that can grow into account management, distribution / collection, inscriptions, contract calls, queue execution, and local history.

This is not a blank rewrite. Existing verified behavior remains valuable and should be migrated carefully.

## 2. Goals

- Create a clean, elegant, long-lived source layout.
- Replace the temporary PWA baseline shell with a professional control-console shell.
- Make future modules easy to implement independently and test in isolation.
- Preserve current vault, KDF, import, chain config, fee draft, manifest, and smoke-test safety work.
- Establish clear state boundaries before signing or broadcast features exist.
- Keep all current and future UI Chinese-first, high-density, and optimized for fast operation.

## 3. Non-goals

- Do not add signing, broadcasting, transaction submission, balance scanning, or real history writes in this milestone.
- Do not implement distribution / collection, inscriptions, ABI calls, or hot transaction reverse parsing yet.
- Do not store plaintext mnemonics, private keys, passwords, raw signed transactions, or RPC secrets in persistent browser storage.
- Do not preserve temporary component names or placeholder UI if they conflict with the new architecture.
- Do not reintroduce Tauri, backend, browser extension, Anvil, Cargo, or desktop packaging paths.

## 4. Product Shell

The global layout will use the selected professional control-console structure:

- Left navigation for stable product modules.
- Top context bar for chain, RPC, fee, base fee, priority fee, and selected wallet count.
- Main workspace for the active module.
- Right preview / risk / queue rail for transaction summaries and execution context.
- Mobile layout folds navigation and the right rail while preserving the main workflow.

The left navigation will include:

- 总览
- 账户库
- 资产
- 分发/归集
- 铭文刻录
- 合约调用
- 队列/历史
- 设置

Implemented modules may expose real controls. Future modules may have skeleton pages, but they must clearly show `未启用` / `规划中` and must not mimic live wallet actions.

## 5. State And Security Boundaries

### 5.1 Encrypted vault

The encrypted vault stores secret-bearing wallet state:

- mnemonic groups;
- derived account metadata;
- account labels and groups;
- future encrypted imported-private-key accounts, if explicitly added by a later milestone.

Vault import must continue to require password verification, KDF policy validation, and explicit overwrite confirmation before replacing local vault storage.

### 5.2 Local storage

Local storage may hold non-secret configuration:

- chain list;
- RPC URL, with clear UI warning that URLs are persisted as-is and must not include API keys, tokens, or other secrets;
- UI preferences;
- recent page, chain, and group identifiers.

### 5.3 Session-only state

These values must reset when the page reloads or the app reopens:

- fee values;
- base fee overrides;
- priority fee;
- multipliers;
- transaction drafts;
- active execution queue draft;
- unlocked hot session;
- raw signed transaction material.

### 5.4 Future local history and queue

Durable queue and history storage is deferred to a future milestone. It must include redaction rules before implementation and must not store plaintext secrets or raw signed transactions.

## 6. Source Layout

The target source layout is:

```text
src/
  app/
    App.tsx
    shell/
      AppShell.tsx
      AppNavigation.tsx
      AppTopBar.tsx
      AppWorkspace.tsx
      ModulePlaceholder.tsx
    state/
      appSession.ts
      appNavigation.ts

  core/
    vault/
    accounts/
    chains/
    fees/
    transactions/
    batch/
    calldata/
    abi/
    assets/
    queue/

  services/
    storage/
    crypto/
    rpc/
    explorers/

  features/
    dashboard/
    accounts/
    assets/
    distribution/
    inscriptions/
    contracts/
    queueHistory/
    settings/

  shared/
    ui/
    format/
    validation/
    constants/
```

Rules:

- `core/` contains pure business models and should avoid React.
- `services/` contains browser adapters for storage, WebCrypto, RPC, and explorer APIs.
- `features/` contains page-level product modules.
- `shared/ui/` contains reusable controls, panels, empty states, status badges, and risk notices.
- `app/shell/` owns global layout and navigation only.
- Shell files must not accumulate wallet business logic.

## 7. Migration Map

- `src/lib/browserVault.ts` becomes storage and vault service code under `services/storage/` and `core/vault/`.
- `src/core/browserVault/accounts.ts` becomes account and vault domain code under `core/vault/` and `core/accounts/`.
- `src/core/browserChainConfig.ts` becomes chain and fee domain code under `core/chains/` and `core/fees/`.
- `src/lib/browserChainConfig.ts` becomes `services/storage/chainConfigStorage.ts`.
- `src/app/PwaShell.tsx` is split into shell, navigation, top bar, workspace, and feature pages.
- `src/features/pwaVault/` is migrated into `features/accounts/`.
- `src/features/pwaSettings/` is migrated into `features/settings/`.
- `src/styles.css` is split into:
  - `src/styles/tokens.css`
  - `src/styles/layout.css`
  - `src/styles/components.css`
  - `src/styles/features.css`

## 8. UI And Interaction Principles

- Chinese-first UI and errors.
- Technical terms may remain English where natural: calldata, ABI, nonce, gas, base fee.
- Professional, dense, work-focused interface.
- No marketing homepage.
- No decorative card-heavy landing page.
- Fast operations after unlock; do not repeatedly ask for passwords within the hot session.
- Dangerous actions require explicit confirmation.
- Top context should keep chain, RPC, fee, and selected wallet information visible.
- Right preview rail should centralize transaction preview, risk notices, cost estimates, and queue status.
- PC efficiency takes priority, while mobile remains usable through folded navigation and rails.
- All send-like pages must share fee, nonce, queue, preview, and risk components.

## 9. Verification

The rebase must preserve or improve the existing PWA verification gate:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:browser
git diff --check
```

Focused tests must cover:

- vault creation, unlock, import verification, KDF rejection, export, and lock;
- account group and derivation behavior;
- chain / RPC persistence without fee draft persistence;
- shell navigation and unavailable module boundaries;
- desktop and mobile production-preview smoke;
- PWA manifest icon requirements.

## 10. Acceptance Criteria

- The app opens into the new professional control-console shell.
- The source tree follows the target layout or a documented first-step subset of it.
- Current implemented capabilities still work.
- Future modules are visible but clearly marked as unavailable until implemented.
- Fee edits remain session-only.
- RPC URL persistence warning remains visible.
- No secret-bearing state is introduced into local storage.
- The full verification gate passes.
- README, spec, roadmap, workflow, and status reflect the new architecture truthfully.

## 11. Risks

- Rebase scope can grow too large. Keep the milestone focused on architecture and shell, not new transaction execution features.
- Moving security-sensitive code can introduce regressions. Preserve tests before and after migration.
- A professional dense UI can become visually heavy. Use restrained layout, clear hierarchy, and reusable components.
- Mobile support can regress during shell rebuild. Keep mobile smoke coverage mandatory.

## 12. Recommended Implementation Strategy

Implement in small, reviewable steps:

1. Add the new directory skeleton and shared UI / style foundations.
2. Move pure core and storage modules while keeping behavior unchanged.
3. Build the new app shell with module navigation and placeholders.
4. Migrate account vault and settings pages into the new shell.
5. Split styles and remove obsolete PWA baseline naming.
6. Update docs and status, then run the full verification gate.
