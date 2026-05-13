# P11 Account Library Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the encrypted browser account library so users can derive many local accounts and select any subset for later asset, queue, distribution, inscription, and contract-call workflows.

**Architecture:** Keep account state inside the encrypted vault model. Add small pure helpers in `src/core/browserVault/accounts.ts`, then wire the existing `账户库` workspace UI to those helpers through `PwaShell`. Do not add signing, broadcasting, balance scanning, private-key import, new localStorage keys, or transaction history. Per this project's workflow, subagents implement or review only; the controller performs fresh verification, commit, and push after each reviewed task.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, Playwright smoke tests, ethers HD wallet derivation, existing IndexedDB encrypted vault storage.

---

## File Structure

- Modify: `src/core/browserVault/accounts.ts`
  - Add multi-selection helpers and account-library summary helpers.
  - Keep existing exports and compatibility behavior.
- Modify: `src/core/browserVault/accounts.test.ts`
  - Add pure unit tests for multi-select, select all, clear selection, derivation preservation, and summary counts.
- Modify: `src/features/accounts/PwaVaultWorkspace.tsx`
  - Add summary UI, derive count input, quick derive buttons, select all / clear controls, and checkbox-like account rows.
- Modify: `src/features/pwaVault/PwaVaultWorkspace.test.tsx`
  - Test the public compatibility entrypoint, which re-exports the migrated accounts workspace.
- Modify: `src/app/PwaShell.tsx`
  - Wire new multi-select helpers and count-based derivation callbacks.
- Modify: `src/app/PwaShell.test.tsx`
  - Cover create -> derive default 20 -> select all / clear / toggle -> lock/unlock persistence, without signing/broadcast controls.
- Modify: `tests/browser/pwa-smoke.spec.ts`
  - Update account vault smoke to exercise P11 quick account derivation and multi-select basics.
- Modify: `docs/superpowers/project-status.md`, `docs/superpowers/project-overview.md`, `docs/superpowers/roadmap.md`, `README.md` if needed at milestone close.
  - Keep current capability wording truthful after P11 lands.

---

### Task 1: Core Account Library Helpers

**Files:**
- Modify: `src/core/browserVault/accounts.ts`
- Modify: `src/core/browserVault/accounts.test.ts`

- [ ] **Step 1: Write failing tests for multi-selection helpers**

Add imports in `src/core/browserVault/accounts.test.ts`:

```ts
import {
  addBrowserVaultGroup,
  clearBrowserVaultAccountSelection,
  createInitialBrowserVaultState,
  deriveBrowserVaultAccounts,
  getActiveBrowserVaultGroup,
  renameBrowserVaultAccount,
  renameBrowserVaultGroup,
  selectAllBrowserVaultAccounts,
  selectBrowserVaultAccount,
  selectBrowserVaultGroup,
  summarizeBrowserVaultAccountLibrary,
  toggleBrowserVaultAccountSelection,
} from "./accounts";
```

Add these tests:

```ts
  it("supports multi-select, select-all, and clear selection within one group", () => {
    const state = createInitialBrowserVaultState({
      mnemonicPhrase: "test test test test test test test test test test test junk",
      initialAccountCount: 3,
    });
    const group = getActiveBrowserVaultGroup(state)!;

    const toggledSecond = toggleBrowserVaultAccountSelection(state, group.id, group.accounts[1].id);
    const toggledGroup = getActiveBrowserVaultGroup(toggledSecond)!;
    expect(toggledGroup.accounts.map((account) => account.selected)).toEqual([true, true, false]);

    const allSelected = selectAllBrowserVaultAccounts(toggledSecond, group.id);
    expect(getActiveBrowserVaultGroup(allSelected)?.accounts.map((account) => account.selected)).toEqual([true, true, true]);

    const cleared = clearBrowserVaultAccountSelection(allSelected, group.id);
    expect(getActiveBrowserVaultGroup(cleared)?.accounts.map((account) => account.selected)).toEqual([false, false, false]);
  });

  it("keeps selection scoped to the target group", () => {
    const state = createInitialBrowserVaultState({
      mnemonicPhrase: "test test test test test test test test test test test junk",
      initialAccountCount: 2,
    });
    const firstGroup = getActiveBrowserVaultGroup(state)!;
    const withSecondGroup = addBrowserVaultGroup(state, "Second", {
      mnemonicPhrase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      initialAccountCount: 2,
    });
    const secondGroup = getActiveBrowserVaultGroup(withSecondGroup)!;

    const clearedSecond = clearBrowserVaultAccountSelection(withSecondGroup, secondGroup.id);

    expect(clearedSecond.groups.find((group) => group.id === firstGroup.id)?.accounts.map((account) => account.selected)).toEqual([
      true,
      false,
    ]);
    expect(clearedSecond.groups.find((group) => group.id === secondGroup.id)?.accounts.map((account) => account.selected)).toEqual([
      false,
      false,
    ]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/core/browserVault/accounts.test.ts
```

Expected: FAIL because `toggleBrowserVaultAccountSelection`, `selectAllBrowserVaultAccounts`, `clearBrowserVaultAccountSelection`, and `summarizeBrowserVaultAccountLibrary` do not exist yet.

- [ ] **Step 3: Implement multi-selection helpers**

In `src/core/browserVault/accounts.ts`, add this helper near the existing selection functions:

```ts
function updateAccountSelection(
  state: BrowserVaultState,
  groupId: string,
  predicate: (account: BrowserVaultAccountRecord) => boolean,
  selected: (account: BrowserVaultAccountRecord) => boolean,
): BrowserVaultState {
  let changed = false;
  const timestamp = nowIso();

  const groups = state.groups.map((group) => {
    if (group.id !== groupId) return group;

    const accounts = group.accounts.map((account) => {
      if (!predicate(account)) return account;
      const nextSelected = selected(account);
      if (account.selected === nextSelected) return account;
      changed = true;
      return {
        ...account,
        selected: nextSelected,
        updatedAt: timestamp,
      };
    });

    return changed
      ? {
          ...group,
          accounts,
          updatedAt: timestamp,
        }
      : group;
  });

  return changed ? { ...state, groups } : state;
}

export function setBrowserVaultAccountSelection(
  state: BrowserVaultState,
  groupId: string,
  accountId: string,
  selected: boolean,
): BrowserVaultState {
  return updateAccountSelection(state, groupId, (account) => account.id === accountId, () => selected);
}

export function toggleBrowserVaultAccountSelection(
  state: BrowserVaultState,
  groupId: string,
  accountId: string,
): BrowserVaultState {
  return updateAccountSelection(state, groupId, (account) => account.id === accountId, (account) => !account.selected);
}

export function selectAllBrowserVaultAccounts(state: BrowserVaultState, groupId: string): BrowserVaultState {
  return updateAccountSelection(state, groupId, () => true, () => true);
}

export function clearBrowserVaultAccountSelection(state: BrowserVaultState, groupId: string): BrowserVaultState {
  return updateAccountSelection(state, groupId, () => true, () => false);
}
```

- [ ] **Step 4: Add summary helper and tests**

Add this test in `src/core/browserVault/accounts.test.ts`:

```ts
  it("summarizes account library counts for the shell", () => {
    const state = createInitialBrowserVaultState({
      mnemonicPhrase: "test test test test test test test test test test test junk",
      initialAccountCount: 2,
    });
    const group = getActiveBrowserVaultGroup(state)!;
    const selectedAll = selectAllBrowserVaultAccounts(state, group.id);
    const summary = summarizeBrowserVaultAccountLibrary(selectedAll);

    expect(summary).toMatchObject({
      activeGroupAccountCount: 2,
      activeGroupName: "主账户组",
      activeGroupNextAccountIndex: 2,
      activeGroupSelectedAccountCount: 2,
      totalAccountCount: 2,
      totalGroupCount: 1,
      totalSelectedAccountCount: 2,
    });
  });
```

Add the exported interfaces and function in `src/core/browserVault/accounts.ts`:

```ts
export interface BrowserVaultAccountLibrarySummary {
  activeGroupAccountCount: number;
  activeGroupName: string;
  activeGroupNextAccountIndex: number;
  activeGroupSelectedAccountCount: number;
  totalAccountCount: number;
  totalGroupCount: number;
  totalSelectedAccountCount: number;
}

export function summarizeBrowserVaultAccountLibrary(state: BrowserVaultState): BrowserVaultAccountLibrarySummary {
  const activeGroup = getActiveBrowserVaultGroup(state);
  const allAccounts = state.groups.flatMap((group) => group.accounts);
  const activeGroupAccounts = activeGroup?.accounts ?? [];

  return {
    activeGroupAccountCount: activeGroupAccounts.length,
    activeGroupName: activeGroup?.name ?? "未选择账户组",
    activeGroupNextAccountIndex: activeGroup?.nextAccountIndex ?? 0,
    activeGroupSelectedAccountCount: activeGroupAccounts.filter((account) => account.selected).length,
    totalAccountCount: allAccounts.length,
    totalGroupCount: state.groups.length,
    totalSelectedAccountCount: allAccounts.filter((account) => account.selected).length,
  };
}
```

- [ ] **Step 5: Verify core behavior**

Run:

```bash
npm test -- src/core/browserVault/accounts.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Controller commit gate for Task 1**

```bash
git add src/core/browserVault/accounts.ts src/core/browserVault/accounts.test.ts
git diff --cached --check
git commit -m "feat: add account library selection helpers"
```

---

### Task 2: Account Workspace Multi-Select UI

**Files:**
- Modify: `src/features/accounts/PwaVaultWorkspace.tsx`
- Modify: `src/features/pwaVault/PwaVaultWorkspace.test.tsx`
- Modify: `src/app/PwaShell.tsx`
- Modify: `src/app/PwaShell.test.tsx`

- [ ] **Step 1: Write failing workspace tests**

Update `src/features/pwaVault/PwaVaultWorkspace.test.tsx` props to include new handlers:

```ts
        onClearAccountSelection={vi.fn()}
        onSelectAllAccounts={vi.fn()}
        onToggleAccountSelection={vi.fn()}
```

Replace the old "derives and renames through workspace controls" test with:

```ts
  it("derives, selects, clears, toggles, and renames through workspace controls", () => {
    const { activeGroup, groups } = createWorkspaceState();
    const onDeriveAccounts = vi.fn();
    const onRenameGroup = vi.fn();
    const onRenameAccount = vi.fn();
    const onSelectAllAccounts = vi.fn();
    const onClearAccountSelection = vi.fn();
    const onToggleAccountSelection = vi.fn();
    const onSelectGroup = vi.fn();

    renderScreen(
      <PwaVaultWorkspace
        activeGroup={activeGroup}
        busy={false}
        groups={groups}
        onAddGroup={vi.fn()}
        onClearAccountSelection={onClearAccountSelection}
        onDeriveAccounts={onDeriveAccounts}
        onExportVault={vi.fn()}
        onLock={vi.fn()}
        onRenameAccount={onRenameAccount}
        onRenameGroup={onRenameGroup}
        onSelectAllAccounts={onSelectAllAccounts}
        onSelectGroup={onSelectGroup}
        onToggleAccountSelection={onToggleAccountSelection}
      />,
    );

    expect(screen.getByText("已选 1 / 1")).toBeInTheDocument();
    expect(screen.getByLabelText("派生数量")).toHaveValue(20);

    fireEvent.click(screen.getByRole("button", { name: "派生账户" }));
    expect(onDeriveAccounts).toHaveBeenCalledWith(activeGroup.id, 20);

    fireEvent.change(screen.getByLabelText("派生数量"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "派生账户" }));
    expect(onDeriveAccounts).toHaveBeenLastCalledWith(activeGroup.id, 3);

    fireEvent.click(screen.getByRole("button", { name: "派生 5" }));
    expect(onDeriveAccounts).toHaveBeenLastCalledWith(activeGroup.id, 5);

    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    expect(onSelectAllAccounts).toHaveBeenCalledWith(activeGroup.id);

    fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
    expect(onClearAccountSelection).toHaveBeenCalledWith(activeGroup.id);

    fireEvent.click(screen.getByLabelText(`${activeGroup.accounts[0].label} 选择状态`));
    expect(onToggleAccountSelection).toHaveBeenCalledWith(activeGroup.id, activeGroup.accounts[0].id);

    fireEvent.change(screen.getByLabelText("组名"), { target: { value: "Work" } });
    expect(onRenameGroup).toHaveBeenCalledWith(activeGroup.id, "Work");

    fireEvent.click(screen.getAllByRole("button", { name: "改名" })[0]);
    expect(onRenameAccount).toHaveBeenCalledWith(activeGroup.id, activeGroup.accounts[0].id, `${activeGroup.accounts[0].label}*`);

    fireEvent.click(screen.getByRole("button", { name: /主账户组/ }));
    expect(onSelectGroup).toHaveBeenCalledWith(activeGroup.id);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/features/pwaVault/PwaVaultWorkspace.test.tsx
```

Expected: FAIL because the new props and controls do not exist.

- [ ] **Step 3: Update workspace props and account row**

In `src/features/accounts/PwaVaultWorkspace.tsx`, update `PwaVaultWorkspaceProps`:

```ts
  onClearAccountSelection(groupId: string): void;
  onSelectAllAccounts(groupId: string): void;
  onToggleAccountSelection(groupId: string, accountId: string): void;
```

Remove `onSelectAccount` from props and `AccountRow`. In `AccountRow`, replace the "选中" button with:

```tsx
        <label className="pwa-account-select-control">
          <input
            aria-label={`${account.label} 选择状态`}
            checked={account.selected}
            disabled={busy}
            onChange={() => onToggleAccountSelection(groupId, account.id)}
            type="checkbox"
          />
          <span>{account.selected ? "已选" : "未选"}</span>
        </label>
```

- [ ] **Step 4: Add summary and derive controls**

At the top of `PwaVaultWorkspace`, add local state:

```ts
import { useMemo, useState } from "react";
import { summarizeBrowserVaultAccountLibrary, type BrowserVaultAccountLibrarySummary } from "../../core/accounts";

const DEFAULT_DERIVE_COUNT = 20;
const MAX_DERIVE_COUNT = 100;

function normalizeDeriveCount(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(MAX_DERIVE_COUNT, Math.max(0, parsed));
}
```

Inside the component:

```ts
  const [deriveCountInput, setDeriveCountInput] = useState(String(DEFAULT_DERIVE_COUNT));
  const summary = useMemo<BrowserVaultAccountLibrarySummary | null>(() => {
    if (!activeGroup) return null;
    return summarizeBrowserVaultAccountLibrary({
      schemaVersion: 1,
      activeGroupId: activeGroup.id,
      groups,
    });
  }, [activeGroup, groups]);
  const deriveCount = normalizeDeriveCount(deriveCountInput);
```

Add a summary block under the header:

```tsx
      {summary && (
        <dl className="pwa-account-library-summary" aria-label="账户库摘要">
          <div>
            <dt>账户组</dt>
            <dd>{summary.totalGroupCount}</dd>
          </div>
          <div>
            <dt>总账户</dt>
            <dd>{summary.totalAccountCount}</dd>
          </div>
          <div>
            <dt>总已选</dt>
            <dd>{summary.totalSelectedAccountCount}</dd>
          </div>
          <div>
            <dt>当前组</dt>
            <dd>{summary.activeGroupName}</dd>
          </div>
        </dl>
      )}
```

In the active group controls, add:

```tsx
              <p className="section-subtitle">已选 {activeGroup.accounts.filter((account) => account.selected).length} / {activeGroup.accounts.length}</p>
              <label>
                派生数量
                <input
                  aria-label="派生数量"
                  disabled={busy}
                  min={1}
                  max={MAX_DERIVE_COUNT}
                  onChange={(event) => setDeriveCountInput(event.target.value)}
                  type="number"
                  value={deriveCountInput}
                />
              </label>
              <button className="secondary-button" disabled={busy || deriveCount < 1} onClick={() => onDeriveAccounts(activeGroup.id, deriveCount)} type="button">
                派生账户
              </button>
              {[1, 5, 20].map((count) => (
                <button className="secondary-button" disabled={busy} key={count} onClick={() => onDeriveAccounts(activeGroup.id, count)} type="button">
                  派生 {count}
                </button>
              ))}
              <button className="secondary-button" disabled={busy || activeGroup.accounts.length === 0} onClick={() => onSelectAllAccounts(activeGroup.id)} type="button">
                全选
              </button>
              <button className="secondary-button" disabled={busy || activeGroup.accounts.length === 0} onClick={() => onClearAccountSelection(activeGroup.id)} type="button">
                清空选择
              </button>
```

Remove old fixed "派生 1 个账户" and "派生 5 个账户" buttons.

- [ ] **Step 5: Wire PwaShell to new helpers**

In `src/app/PwaShell.tsx`, import:

```ts
  clearBrowserVaultAccountSelection,
  selectAllBrowserVaultAccounts,
  toggleBrowserVaultAccountSelection,
```

Remove `selectBrowserVaultAccount` import if no longer used.

In `<PwaVaultWorkspace />`, replace `onSelectAccount` with:

```tsx
          onClearAccountSelection={(groupId) => void persistVaultState(clearBrowserVaultAccountSelection(session.state, groupId))}
          onSelectAllAccounts={(groupId) => void persistVaultState(selectAllBrowserVaultAccounts(session.state, groupId))}
          onToggleAccountSelection={(groupId, accountId) =>
            void persistVaultState(toggleBrowserVaultAccountSelection(session.state, groupId, accountId))
          }
```

- [ ] **Step 6: Update shell tests**

In `src/app/PwaShell.test.tsx`, update the account creation test:

```ts
    fireEvent.click(screen.getByRole("button", { name: "派生 20" }));

    await waitFor(() => expect(screen.getByText("账户 21")).toBeInTheDocument());
    expect(screen.getAllByText(/^0x[0-9a-fA-F]{40}$/)).toHaveLength(21);

    fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
    await waitFor(() => expect(screen.getByText("已选 0 / 21")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    await waitFor(() => expect(screen.getByText("已选 21 / 21")).toBeInTheDocument());
```

Add a locked/unlocked persistence assertion by locking, unlocking with the same password, and checking `已选 21 / 21` appears again.

- [ ] **Step 7: Verify UI behavior**

Run:

```bash
npm test -- src/features/pwaVault/PwaVaultWorkspace.test.tsx src/app/PwaShell.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Controller commit gate for Task 2**

```bash
git add src/features/accounts/PwaVaultWorkspace.tsx src/features/pwaVault/PwaVaultWorkspace.test.tsx src/app/PwaShell.tsx src/app/PwaShell.test.tsx
git diff --cached --check
git commit -m "feat: add account library multi-select UI"
```

---

### Task 3: P11 Smoke, Docs, And Status Closeout

**Files:**
- Modify: `tests/browser/pwa-smoke.spec.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/project-overview.md`
- Modify: `docs/superpowers/roadmap.md`
- Modify: `docs/superpowers/project-status.md`

- [ ] **Step 1: Update browser smoke for P11 account operations**

In `tests/browser/pwa-smoke.spec.ts`, update the account vault test from deriving one account to deriving 20 accounts:

```ts
  await page.getByRole("button", { name: "派生 20" }).click();
  await expect(page.getByText("账户 21")).toBeVisible();
  await expect(page.getByText(/^0x[0-9a-fA-F]{40}$/)).toHaveCount(21);

  await page.getByRole("button", { name: "清空选择" }).click();
  await expect(page.getByText("已选 0 / 21")).toBeVisible();

  await page.getByRole("button", { name: "全选" }).click();
  await expect(page.getByText("已选 21 / 21")).toBeVisible();
```

Keep the existing assertion that no signing/broadcast controls exist.

- [ ] **Step 2: Update current capability docs**

README current capabilities should add:

```md
- Account-library multi-select, select all / clear, and batch derivation controls inside the encrypted vault workspace.
```

Project overview current baseline should mention P11 account-library expansion once Task 3 is closing. Roadmap should mark P11 complete only at closeout. Project status should add rows for:

```md
| P11 | Account library expansion spec | `codex/p11-account-library` | `b4408c3` | spec passed | `git diff --check` | yes | no | Defines multi-select, batch derivation, encrypted-vault persistence, and no-send boundaries. |
```

Then run:

```bash
TASK2_COMMIT=$(git rev-parse --short HEAD)
printf '%s\n' "$TASK2_COMMIT"
```

Replace `value of TASK2_COMMIT` below with the printed value, then add the implementation status row:

```md
| P11 | Account library multi-select implementation | `codex/p11-account-library` | value of TASK2_COMMIT | spec passed; quality passed | `npm test`; `npm run typecheck`; `npm run build`; `npm run smoke:browser`; `git diff --check` | no | no | Adds multi-select account helpers, account-library UI, and smoke coverage without signing or broadcast behavior. |
```

- [ ] **Step 3: Run full P11 release gate**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:browser
git diff --check
```

Expected: all PASS. Clean up `test-results/` if Playwright creates it.

- [ ] **Step 4: Controller commit gate for Task 3**

```bash
git add tests/browser/pwa-smoke.spec.ts README.md docs/superpowers/project-overview.md docs/superpowers/roadmap.md docs/superpowers/project-status.md
git diff --cached --check
git commit -m "docs: record P11 account library status"
```

---

## Final Milestone Gate

After Task 3:

1. Request final whole-branch spec review.
2. Request final whole-branch code quality review.
3. Fix any Critical or Important findings and re-review until PASS.
4. Controller runs:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:browser
git diff --check
```

5. Push `codex/p11-account-library`.
6. Merge to `main` with `--no-ff` only after full verification remains green.
7. Run the same full gate on `main`.
8. Update `docs/superpowers/project-status.md` on `main` with the P11 merge commit and post-merge verification.
9. Push `main`.
