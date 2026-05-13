import { describe, expect, it } from "vitest";
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
  setBrowserVaultAccountSelection,
  summarizeBrowserVaultAccountLibrary,
  toggleBrowserVaultAccountSelection,
} from "./accounts";

describe("browserVault accounts", () => {
  it("creates a default group with a selected derived account", () => {
    const state = createInitialBrowserVaultState({ mnemonicPhrase: "test test test test test test test test test test test junk" });
    const activeGroup = getActiveBrowserVaultGroup(state);

    expect(activeGroup?.accounts).toHaveLength(1);
    expect(activeGroup?.accounts[0].selected).toBe(true);
    expect(activeGroup?.name).toBe("主账户组");
  });

  it("derives deterministic accounts within a group", () => {
    const state = createInitialBrowserVaultState({ mnemonicPhrase: "test test test test test test test test test test test junk" });
    const group = getActiveBrowserVaultGroup(state);

    expect(group).not.toBeNull();
    expect(group?.accounts[0].address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const nextState = deriveBrowserVaultAccounts(state, group!.id, 2);
    const nextGroup = getActiveBrowserVaultGroup(nextState);

    expect(nextGroup?.accounts).toHaveLength(3);
    expect(nextGroup?.accounts[1].index).toBe(1);
    expect(nextGroup?.accounts[2].index).toBe(2);
  });

  it("supports group and account selection updates", () => {
    const state = createInitialBrowserVaultState({ mnemonicPhrase: "test test test test test test test test test test test junk" });
    const group = getActiveBrowserVaultGroup(state)!;
    const renamedGroupState = renameBrowserVaultGroup(state, group.id, "Secondary");
    const derivedState = deriveBrowserVaultAccounts(renamedGroupState, group.id, 1);
    const derivedGroup = getActiveBrowserVaultGroup(derivedState)!;
    const renamedAccountState = renameBrowserVaultAccount(derivedState, group.id, derivedGroup.accounts[0].id, "Primary One");
    const selectedAccountState = selectBrowserVaultAccount(renamedAccountState, group.id, derivedGroup.accounts[0].id);
    const selectedGroupState = selectBrowserVaultGroup(selectedAccountState, group.id);

    expect(getActiveBrowserVaultGroup(selectedGroupState)?.name).toBe("Secondary");
    expect(getActiveBrowserVaultGroup(selectedGroupState)?.accounts[0].label).toBe("Primary One");
    expect(getActiveBrowserVaultGroup(selectedGroupState)?.accounts[0].selected).toBe(true);
  });

  it("adds a new group and keeps it active", () => {
    const state = createInitialBrowserVaultState({ mnemonicPhrase: "test test test test test test test test test test test junk" });
    const nextState = addBrowserVaultGroup(state, "Work");

    expect(nextState.groups).toHaveLength(2);
    expect(getActiveBrowserVaultGroup(nextState)?.name).toBe("Work");
  });

  it("supports multi-select, select-all, and clear selection within one group", () => {
    const state = createInitialBrowserVaultState({
      mnemonicPhrase: "test test test test test test test test test test test junk",
      initialAccountCount: 3,
    });
    const group = getActiveBrowserVaultGroup(state)!;

    const toggledSecond = toggleBrowserVaultAccountSelection(state, group.id, group.accounts[1].id);
    expect(getActiveBrowserVaultGroup(toggledSecond)?.accounts.map((account) => account.selected)).toEqual([
      true,
      true,
      false,
    ]);

    const setThird = setBrowserVaultAccountSelection(toggledSecond, group.id, group.accounts[2].id, true);
    expect(getActiveBrowserVaultGroup(setThird)?.accounts.map((account) => account.selected)).toEqual([
      true,
      true,
      true,
    ]);

    const toggledSecondOff = toggleBrowserVaultAccountSelection(setThird, group.id, group.accounts[1].id);
    expect(getActiveBrowserVaultGroup(toggledSecondOff)?.accounts.map((account) => account.selected)).toEqual([
      true,
      false,
      true,
    ]);

    const allSelected = selectAllBrowserVaultAccounts(toggledSecondOff, group.id);
    expect(getActiveBrowserVaultGroup(allSelected)?.accounts.map((account) => account.selected)).toEqual([
      true,
      true,
      true,
    ]);

    const cleared = clearBrowserVaultAccountSelection(allSelected, group.id);
    expect(getActiveBrowserVaultGroup(cleared)?.accounts.map((account) => account.selected)).toEqual([
      false,
      false,
      false,
    ]);
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

    const selectedSecondGroup = selectAllBrowserVaultAccounts(withSecondGroup, secondGroup.id);
    const clearedSecond = clearBrowserVaultAccountSelection(selectedSecondGroup, secondGroup.id);

    expect(clearedSecond.groups.find((group) => group.id === firstGroup.id)?.accounts.map((account) => account.selected)).toEqual([
      true,
      false,
    ]);
    expect(
      clearedSecond.groups.find((group) => group.id === secondGroup.id)?.accounts.map((account) => account.selected),
    ).toEqual([false, false]);
  });

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

  it("preserves existing selections and next account index when deriving accounts", () => {
    const state = createInitialBrowserVaultState({
      mnemonicPhrase: "test test test test test test test test test test test junk",
      initialAccountCount: 3,
    });
    const group = getActiveBrowserVaultGroup(state)!;
    const selectedSubset = setBrowserVaultAccountSelection(state, group.id, group.accounts[2].id, true);

    const derived = deriveBrowserVaultAccounts(selectedSubset, group.id, 2);
    const derivedGroup = getActiveBrowserVaultGroup(derived)!;

    expect(derivedGroup.nextAccountIndex).toBe(5);
    expect(derivedGroup.accounts.map((account) => account.index)).toEqual([0, 1, 2, 3, 4]);
    expect(derivedGroup.accounts.map((account) => account.selected)).toEqual([true, false, true, false, false]);
  });

  it("does not force a selected account when deriving after all selections are cleared", () => {
    const state = createInitialBrowserVaultState({
      mnemonicPhrase: "test test test test test test test test test test test junk",
      initialAccountCount: 2,
    });
    const group = getActiveBrowserVaultGroup(state)!;
    const cleared = clearBrowserVaultAccountSelection(state, group.id);

    const derived = deriveBrowserVaultAccounts(cleared, group.id, 2);
    const derivedGroup = getActiveBrowserVaultGroup(derived)!;
    const summary = summarizeBrowserVaultAccountLibrary(derived);

    expect(derivedGroup.nextAccountIndex).toBe(4);
    expect(derivedGroup.accounts.map((account) => account.selected)).toEqual([false, false, false, false]);
    expect(summary.activeGroupSelectedAccountCount).toBe(0);
    expect(summary.totalSelectedAccountCount).toBe(0);
  });

  it("returns the original state when selection targets are unknown", () => {
    const state = createInitialBrowserVaultState({
      mnemonicPhrase: "test test test test test test test test test test test junk",
      initialAccountCount: 2,
    });
    const group = getActiveBrowserVaultGroup(state)!;

    expect(setBrowserVaultAccountSelection(state, group.id, "missing-account", true)).toBe(state);
    expect(toggleBrowserVaultAccountSelection(state, group.id, "missing-account")).toBe(state);
    expect(selectAllBrowserVaultAccounts(state, "missing-group")).toBe(state);
    expect(clearBrowserVaultAccountSelection(state, "missing-group")).toBe(state);
    expect(deriveBrowserVaultAccounts(state, "missing-group", 1)).toBe(state);
    expect(deriveBrowserVaultAccounts(state, group.id, 0)).toBe(state);
  });
});
