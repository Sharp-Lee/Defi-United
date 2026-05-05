# Browser-First PWA Wallet Design

## 1. Purpose

This spec records the active browser-first PWA direction for EVM Wallet Workbench. It is the design input for the current PWA mainline and should stay aligned with README, status, workflow, and roadmap.

## 2. Product direction

- Browser-first PWA is the only active runtime.
- The UI is Chinese-first and optimized for desktop and mobile browsers.
- The initial product focus is the PWA shell, encrypted vault, and account-group workflow.
- All future feature work must keep the browser runtime as the primary execution environment.

## 3. Core goals

- Create and unlock an encrypted vault locally in the browser.
- Keep hot session state in memory only after unlock.
- Support deterministic EVM account derivation from a single vault.
- Provide a simple, stable navigation model for future PWA milestones.
- Preserve clear safety boundaries for any future send / history / chain-aware feature.

## 4. Security model

- Vault material must remain encrypted at rest.
- Plaintext passwords, mnemonics, private keys, and raw signed transactions must never be persisted.
- Unlock state should be tab-local and easy to clear with a manual lock action.
- Any future chain interaction must validate chain identity before use.

## 5. Information architecture

The shell reserves these areas for the PWA roadmap:

- 账户
- 资产
- 分发/归集
- 铭文刻录
- 合约调用
- 历史
- 设置

The current implementation only activates the account / vault workflow. The remaining areas stay as clear planned placeholders until their own milestones land.

## 6. PWA implementation notes

- Keep the shell simple and avoid premature routing abstractions.
- Reuse the browser vault and account-group model for all current account work.
- Keep installability metadata and responsive layout in the same PWA baseline.
- Add tests whenever shell wording, vault behavior, or navigation changes.

## 7. Alignment rules

- Do not let this spec drift away from the actual runtime.
- If implementation changes, update README, workflow, status, and roadmap together.
- Do not claim future capability as already shipped.
