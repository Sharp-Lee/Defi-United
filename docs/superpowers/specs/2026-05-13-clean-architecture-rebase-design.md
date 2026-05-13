# Clean Architecture Rebase Design

## 1. Purpose

The project will keep the browser-first PWA direction, but the current baseline should be reshaped before large wallet features are added.

This milestone is a clean architecture rebase: preserve the verified safety kernel, rebuild the upper application structure, and create a professional Chinese wallet workbench shell that can grow into account management, distribution / collection, inscriptions, contract calls, queue execution, and local history.

This is not a blank rewrite. Existing verified behavior remains valuable and should be migrated carefully.

The broader product target is defined in `docs/superpowers/specs/2026-05-13-wallet-benchmark-product-design.md`. This P10d spec only covers the architecture and shell foundation needed before those wallet workflows are implemented.

## 2. Goals

- Create a clean, elegant, long-lived source layout.
- Replace the temporary PWA baseline shell with a professional control-console shell.
- Make future modules easy to implement independently and test in isolation.
- Preserve current vault, KDF, import, chain config, fee draft, manifest, and smoke-test safety work.
- Establish clear state boundaries before signing or broadcast features exist.
- Keep all current and future UI Chinese-first, high-density, and optimized for fast operation.
- Shape the architecture so it can later support 985monitor-class wallet operations without adopting 985monitor's plaintext private-key storage model.
- Keep P10d scoped to the foundation layer; do not implement live transaction workflows during this milestone.

## 3. Non-goals

- Do not add signing, broadcasting, transaction submission, balance scanning, or real history writes in this milestone.
- Do not implement distribution / collection, inscriptions, ABI calls, or hot transaction reverse parsing yet.
- Do not implement vanity address generation or NFT mint monitoring in this milestone.
- Do not store plaintext mnemonics, private keys, passwords, raw signed transactions, or RPC secrets in persistent browser storage.
- Do not preserve temporary component names or placeholder UI if they conflict with the new architecture.
- Do not reintroduce Tauri, backend, browser extension, Anvil, Cargo, or desktop packaging paths.

## 4. 985monitor Benchmark And Product Gap

The 985monitor wallet page is the current external product benchmark for breadth and speed. It demonstrates the kind of advanced wallet console DeFi United should be able to grow into, but its plaintext private-key localStorage model must not be copied.

Observed 985monitor capabilities that influence the target architecture:

- broad EVM chain presets and RPC switching;
- wallet groups, bulk private-key import, random wallet creation, and vanity generation;
- raw calldata and ABI-based multi-wallet contract calls;
- transaction-hash-based operation copying and address replacement with `Self`;
- contract-based native distribution;
- approve plus contract-based ERC-20 distribution;
- native and ERC-20 collection;
- balance visibility;
- queue logs, queue stop, and state export;
- NFT mint monitoring through a server-push style feed.

DeFi United should preserve its security advantage:

- encrypted vault instead of plaintext localStorage private keys;
- KDF policy enforcement;
- password-verified vault import;
- hot session memory semantics;
- no plaintext private-key TXT export by default.

The architecture must therefore prepare feature lanes for 985monitor-class workflows while keeping a stricter safety boundary.

For complete product requirements across account library, assets, execution queue, distribution / collection, inscriptions, ABI calls, and hot transaction reverse parsing, see `docs/superpowers/specs/2026-05-13-wallet-benchmark-product-design.md`.

## 5. Product Shell

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

## 6. State And Security Boundaries

### 6.1 Encrypted vault

The encrypted vault stores secret-bearing wallet state:

- mnemonic groups;
- derived account metadata;
- account labels and groups;
- future encrypted imported-private-key accounts, if explicitly added by a later milestone.

Vault import must continue to require password verification, KDF policy validation, and explicit overwrite confirmation before replacing local vault storage.

### 6.2 Local storage

Local storage may hold non-secret configuration:

- chain list;
- RPC URL, with clear UI warning that URLs are persisted as-is and must not include API keys, tokens, or other secrets;
- UI preferences;
- recent page, chain, and group identifiers.

### 6.3 Session-only state

These values must reset when the page reloads or the app reopens:

- fee values;
- base fee overrides;
- priority fee;
- multipliers;
- transaction drafts;
- active execution queue draft;
- unlocked hot session;
- raw signed transaction material.

### 6.4 Future local history and queue

Durable queue and history storage is deferred to a future milestone. It must include redaction rules before implementation and must not store plaintext secrets or raw signed transactions.

## 7. Source Layout

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
    nonce/
    transactions/
    batch/
    calldata/
    abi/
    assets/
    queue/
    history/

  services/
    storage/
    crypto/
    rpc/
    explorers/
    workers/

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

## 8. Migration Map

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

## 9. Future Capability Lanes

This rebase does not implement transaction execution, but it must leave clear architectural lanes for the next product milestones.

### 9.1 P11 account library

- HD mnemonic groups with many derived accounts.
- Multi-select accounts across a group.
- Optional encrypted imported-private-key accounts, only after a dedicated safety spec.
- Random wallet batch creation if it fits the vault model.
- Vanity generation as a later worker-backed feature, not part of the rebase.

### 9.2 P12 asset visibility

- Native balance snapshots.
- Watched ERC-20 balances.
- Chain identity validation before refresh.
- Stale / failed / partial states instead of silently showing zero.

### 9.3 P13 execution and queue foundation

- Job model separate from transaction records.
- Same-account nonce serialization and cross-account concurrency.
- RPC rate limiting.
- Stop queue and resumable failure state.
- JSON status export without raw signed transactions or secrets.

### 9.4 P14 distribution and collection

- Native distribution through the required distribution contract.
- ERC-20 distribution through approve plus distribution contract flow.
- Native collection from many local accounts to a target account.
- ERC-20 collection from many local accounts to a target account.

The known distribution contract is:

```text
0xd15fe25ed0dba12fe05e7029c88b10c25e8880e3
```

Contract ABI, chain coverage, approval behavior, and failure semantics require their own implementation spec.

### 9.5 P15 calldata and inscriptions

- Raw calldata builder in hex mode.
- Text-to-calldata mode for inscription-like payloads.
- Self-target or fixed-target selection.
- Per-account repeat count and nonce continuation after failure.

Raw calldata is a lower-level substrate for inscription workflows, but a dedicated inscription page is still needed for speed and correctness.

### 9.6 P16 contract calls and ABI helpers

- ABI paste/import.
- Explorer ABI fetch by contract address.
- Function-specific parameter forms.
- Address-array parameters can be filled from local selected accounts.
- Raw calldata fallback when ABI is unavailable.

### 9.7 P17 hot transaction reverse parsing

- Input transaction hash.
- Fetch transaction, receipt, and ABI where possible.
- Decode calldata and identify repeated address parameters.
- Offer `Self` replacement for sender-specific address fields.
- Generate an editable batch-call draft.

### 9.8 Deferred backend decision: NFT mint monitoring

985monitor's NFT mint monitoring appears to depend on server-side or gateway-style real-time data. That is outside the current PWA-only architecture.

Before adding NFT mint monitoring, write a separate product decision spec covering:

- whether DeFi United remains pure PWA-only;
- whether to introduce a backend or websocket gateway;
- API key and rate-limit handling;
- filtering, latency, reliability, and monetization boundaries.

## 10. UI And Interaction Principles

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

## 11. Verification

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

## 12. Acceptance Criteria

- The app opens into the new professional control-console shell.
- The source tree follows the target layout or a documented first-step subset of it.
- Current implemented capabilities still work.
- Future modules are visible but clearly marked as unavailable until implemented.
- The architecture visibly reserves lanes for assets, distribution / collection, inscriptions, contract calls, queue / history, and future hot transaction reverse parsing.
- Fee edits remain session-only.
- RPC URL persistence warning remains visible.
- No secret-bearing state is introduced into local storage.
- The full verification gate passes.
- README, spec, roadmap, workflow, and status reflect the new architecture truthfully.

## 13. Risks

- Rebase scope can grow too large. Keep the milestone focused on architecture and shell, not new transaction execution features.
- Moving security-sensitive code can introduce regressions. Preserve tests before and after migration.
- A professional dense UI can become visually heavy. Use restrained layout, clear hierarchy, and reusable components.
- Mobile support can regress during shell rebuild. Keep mobile smoke coverage mandatory.
- 985monitor parity can distract from safety. Treat 985monitor as a product benchmark, not a security benchmark.
- Transaction execution work requires chain identity, nonce, signing redaction, broadcast, and history foundations before any real send button ships.

## 14. Recommended Implementation Strategy

Implement in small, reviewable steps:

1. Add the new directory skeleton and shared UI / style foundations.
2. Move pure core and storage modules while keeping behavior unchanged.
3. Build the new app shell with module navigation and placeholders.
4. Migrate account vault and settings pages into the new shell.
5. Split styles and remove obsolete PWA baseline naming.
6. Update docs and status, then run the full verification gate.

## 15. Relationship To Product Milestones

P10d is a foundation milestone. It should create the source boundaries and professional shell that make P11-P17 easier to build, but it should not ship the P11-P17 product behaviors.

After P10d, implementation should proceed in this order:

1. P11 account library expansion.
2. P12 asset visibility.
3. P13 execution queue, nonce model, signing, broadcasting, and redacted history.
4. P14 distribution and collection.
5. P15 inscription and calldata.
6. P16 contract calls and ABI helpers.
7. P17 hot transaction reverse parsing.
