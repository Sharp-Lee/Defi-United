import { describe, expect, it } from "vitest";
import {
  addBrowserVaultGroup,
  createInitialBrowserVaultState,
  deriveBrowserVaultAccounts,
  getActiveBrowserVaultGroup,
  renameBrowserVaultAccount,
  renameBrowserVaultGroup,
  selectBrowserVaultAccount,
  selectBrowserVaultGroup,
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
});
