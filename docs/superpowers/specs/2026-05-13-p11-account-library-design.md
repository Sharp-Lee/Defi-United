# P11 Account Library Expansion Design

## 1. Purpose

P11 expands the encrypted browser account library so later asset, queue, distribution, inscription, and ABI workflows can operate on a selected set of local wallets. It is the first product milestone after the P10d clean architecture rebase.

P11 does not add signing, broadcasting, balance scanning, private-key import, raw calldata execution, distribution, collection, or history writes.

## 2. Product Scope

### In scope

- Multiple selected accounts per mnemonic group.
- Group-level select all / clear selection controls.
- Account-level toggle selection controls.
- Batch derivation by user-entered count.
- Account-library summary showing total accounts, selected accounts, active group, and next derivation index.
- Selection state persists inside the encrypted vault because it belongs to the user's local wallet workspace.
- Empty/invalid count inputs are rejected or normalized without corrupting vault state.
- Current compatibility re-exports under `features/pwaVault` remain working.

### Out of scope

- Private-key import and plaintext key export.
- Vanity account generation.
- Balance scanning or token watchlists.
- Transaction signing or broadcast.
- Queue/history execution.
- Cross-group workflow selection. P11 keeps selection scoped inside groups and exposes summary helpers for later milestones.

## 3. Data Model

The current `BrowserVaultAccountRecord.selected` boolean remains the source of truth. P11 changes semantics from single selected account to many selected accounts within a group.

New core helpers should live in `src/core/browserVault/accounts.ts` and be re-exported through `src/core/accounts/index.ts`:

- `toggleBrowserVaultAccountSelection(state, groupId, accountId)` flips one account's selection.
- `setBrowserVaultAccountSelection(state, groupId, accountId, selected)` sets one account explicitly.
- `selectAllBrowserVaultAccounts(state, groupId)` selects every account in the group.
- `clearBrowserVaultAccountSelection(state, groupId)` clears every account in the group.
- `deriveBrowserVaultAccounts` accepts larger user-entered counts through a UI wrapper and preserves current selections.
- `summarizeBrowserVaultAccountLibrary(state)` returns total groups, total accounts, selected accounts, active group name, active group account count, active group selected count, and active group next index.

Existing `selectBrowserVaultAccount` should remain available for compatibility, but may be implemented as a single-select wrapper if tests still need it. New P11 UI should use toggle/multi-select helpers.

## 4. UI Design

The `账户库` module remains the only enabled wallet workspace area.

When locked, the existing vault access flow remains unchanged.

When unlocked, `PwaVaultWorkspace` should show:

- A compact account-library summary at the top.
- Group list with each group's account and selected counts.
- Active group controls:
  - group name edit;
  - derive count input;
  - derive button;
  - quick derive buttons for 1, 5, and 20;
  - select all;
  - clear selection.
- Account rows with checkbox-style multi-selection, label, address, derivation path, and rename action.

The default derive count is 20 for fast operation, matching the user's desired default batch size. User edits are local component state and do not need persistence.

Text remains Chinese-first. Controls must remain usable at mobile widths through the existing responsive shell.

## 5. Persistence And Security

Account selection, labels, groups, and derived account metadata are stored only inside the encrypted vault envelope after save.

P11 must not persist plaintext mnemonic phrases, private keys, passwords, raw signed transactions, or RPC credentials outside the encrypted vault. Tests should continue to assert that serialized encrypted vault envelopes do not contain account labels or other plaintext state.

P11 must not add any localStorage key for account-library state.

## 6. Error Handling

- Derive counts below 1 are rejected in the UI by disabling the derive action; core helpers still return the original state unchanged for non-positive counts.
- Derive counts above 100 are clamped to 100 for a single click to prevent accidental browser freezes.
- Unknown group IDs and account IDs return the original state unchanged.
- If all accounts are deselected, later workflows will see zero selected accounts. P11 does not force at least one selected account.

## 7. Tests

Focused tests must cover:

- Multi-select core helpers preserve independent selections.
- Select all and clear selection operate only on the target group.
- Batch derivation preserves existing selections and increments `nextAccountIndex` correctly.
- Summary helper reports total and active-group counts.
- UI can derive 20 accounts from the default count control.
- UI can select all, clear selection, and toggle individual accounts.
- Existing create/unlock/import/export/lock tests still pass.
- No signing/broadcast buttons appear in P11.

## 8. Acceptance Criteria

P11 is complete when:

- A user can unlock a vault, derive a batch of accounts, select any subset of accounts, select all, clear selection, and see accurate selected/total counts.
- Selection state is saved in the encrypted vault and restored after lock/unlock.
- P11 does not introduce transaction-sending behavior.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke:browser`, and `git diff --check` pass before merge.
