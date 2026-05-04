import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createInitialBrowserVaultState, deriveBrowserVaultAccounts, getActiveBrowserVaultGroup } from "../../core/browserVault/accounts";
import { renderScreen } from "../../test/render";
import { PwaVaultWorkspace } from "./PwaVaultWorkspace";

function createWorkspaceState() {
  const state = createInitialBrowserVaultState({ mnemonicPhrase: "test test test test test test test test test test test junk" });
  const activeGroup = getActiveBrowserVaultGroup(state)!;
  return {
    activeGroup,
    groups: [activeGroup],
  };
}

describe("PwaVaultWorkspace", () => {
  it("shows the active group and derived account metadata", () => {
    const { activeGroup, groups } = createWorkspaceState();
    renderScreen(
      <PwaVaultWorkspace
        activeGroup={activeGroup}
        busy={false}
        groups={groups}
        onAddGroup={vi.fn()}
        onDeriveAccounts={vi.fn()}
        onExportVault={vi.fn()}
        onLock={vi.fn()}
        onRenameAccount={vi.fn()}
        onRenameGroup={vi.fn()}
        onSelectAccount={vi.fn()}
        onSelectGroup={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "账户与组" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出加密 vault" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "锁定" })).toBeInTheDocument();
    expect(screen.getByLabelText("组名")).toHaveValue("主账户组");
    expect(screen.getByText("账户 1")).toBeInTheDocument();
    expect(screen.getByText(/^0x[0-9a-fA-F]{40}$/)).toBeInTheDocument();
    expect(screen.getByText(/m\/44'\/60'\/0'\/0\/0/)).toBeInTheDocument();
  });

  it("derives and renames through workspace controls", () => {
    const { activeGroup, groups } = createWorkspaceState();
    const onDeriveAccounts = vi.fn();
    const onRenameGroup = vi.fn();
    const onRenameAccount = vi.fn();
    const onSelectAccount = vi.fn();
    const onSelectGroup = vi.fn();

    renderScreen(
      <PwaVaultWorkspace
        activeGroup={activeGroup}
        busy={false}
        groups={groups}
        onAddGroup={vi.fn()}
        onDeriveAccounts={onDeriveAccounts}
        onExportVault={vi.fn()}
        onLock={vi.fn()}
        onRenameAccount={onRenameAccount}
        onRenameGroup={onRenameGroup}
        onSelectAccount={onSelectAccount}
        onSelectGroup={onSelectGroup}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "派生 5 个账户" }));
    expect(onDeriveAccounts).toHaveBeenCalledWith(activeGroup.id, 5);

    fireEvent.change(screen.getByLabelText("组名"), { target: { value: "Work" } });
    expect(onRenameGroup).toHaveBeenCalledWith(activeGroup.id, "Work");

    fireEvent.click(screen.getAllByRole("button", { name: "选中" })[0]);
    expect(onSelectAccount).toHaveBeenCalledWith(activeGroup.id, activeGroup.accounts[0].id);

    fireEvent.click(screen.getAllByRole("button", { name: "改名" })[0]);
    expect(onRenameAccount).toHaveBeenCalledWith(activeGroup.id, activeGroup.accounts[0].id, `${activeGroup.accounts[0].label}*`);

    fireEvent.click(screen.getByRole("button", { name: activeGroup.name }));
    expect(onSelectGroup).toHaveBeenCalledWith(activeGroup.id);
  });

  it("keeps derived account indexes stable when more accounts are added", () => {
    const state = createInitialBrowserVaultState({ mnemonicPhrase: "test test test test test test test test test test test junk" });
    const activeGroup = getActiveBrowserVaultGroup(state)!;
    const nextState = deriveBrowserVaultAccounts(state, activeGroup.id, 2);
    expect(getActiveBrowserVaultGroup(nextState)?.accounts.map((account) => account.index)).toEqual([0, 1, 2]);
  });
});
