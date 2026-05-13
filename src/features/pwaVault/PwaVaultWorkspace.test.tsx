import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  addBrowserVaultGroup,
  createInitialBrowserVaultState,
  deriveBrowserVaultAccounts,
  getActiveBrowserVaultGroup,
  selectAllBrowserVaultAccounts,
  summarizeBrowserVaultAccountLibrary,
} from "../../core/browserVault/accounts";
import { renderScreen } from "../../test/render";
import { PwaVaultWorkspace } from "./PwaVaultWorkspace";

function createWorkspaceState() {
  const state = createInitialBrowserVaultState({ mnemonicPhrase: "test test test test test test test test test test test junk" });
  const activeGroup = getActiveBrowserVaultGroup(state)!;
  return {
    activeGroup,
    groups: [activeGroup],
    summary: summarizeBrowserVaultAccountLibrary(state),
  };
}

describe("PwaVaultWorkspace", () => {
  it("shows the active group and derived account metadata", () => {
    const { activeGroup, groups, summary } = createWorkspaceState();
    renderScreen(
      <PwaVaultWorkspace
        activeGroup={activeGroup}
        busy={false}
        groups={groups}
        librarySummary={summary}
        onAddGroup={vi.fn()}
        onClearAccountSelection={vi.fn()}
        onDeriveAccounts={vi.fn()}
        onExportVault={vi.fn()}
        onLock={vi.fn()}
        onRenameAccount={vi.fn()}
        onRenameGroup={vi.fn()}
        onSelectAllAccounts={vi.fn()}
        onSelectGroup={vi.fn()}
        onToggleAccountSelection={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "账户与组" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出加密 vault" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "锁定" })).toBeInTheDocument();
    expect(screen.getByLabelText("组名")).toHaveValue("主账户组");
    expect(screen.getByText("账户库摘要")).toBeInTheDocument();
    expect(screen.getByText("1 组 / 1 账户")).toBeInTheDocument();
    expect(screen.getByText("已选 1 / 全部 1")).toBeInTheDocument();
    expect(screen.getByText("当前组 主账户组")).toBeInTheDocument();
    expect(screen.getByText("下一个 index 1")).toBeInTheDocument();
    expect(screen.getAllByText("当前组已选 1 / 1")).toHaveLength(2);
    expect(screen.getByLabelText("派生数量")).toHaveValue(20);
    expect(screen.getByRole("button", { name: "派生账户" })).toBeInTheDocument();
    expect(screen.getByText("账户 1")).toBeInTheDocument();
    expect(screen.getByText(/^0x[0-9a-fA-F]{40}$/)).toBeInTheDocument();
    expect(screen.getByText(/m\/44'\/60'\/0'\/0\/0/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /账户 1/ })).toBeChecked();
    expect(screen.queryByRole("button", { name: "选中" })).not.toBeInTheDocument();
  });

  it("shows per-group account and selected counts in group pills", () => {
    const state = createInitialBrowserVaultState({
      initialAccountCount: 2,
      mnemonicPhrase: "test test test test test test test test test test test junk",
    });
    const firstGroup = getActiveBrowserVaultGroup(state)!;
    const withSecondGroup = addBrowserVaultGroup(state, "Work", {
      initialAccountCount: 3,
      mnemonicPhrase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    });
    const secondGroup = getActiveBrowserVaultGroup(withSecondGroup)!;
    const selectedSecondGroup = selectAllBrowserVaultAccounts(withSecondGroup, secondGroup.id);
    const activeSelectedSecondGroup = getActiveBrowserVaultGroup(selectedSecondGroup)!;

    renderScreen(
      <PwaVaultWorkspace
        activeGroup={activeSelectedSecondGroup}
        busy={false}
        groups={selectedSecondGroup.groups}
        librarySummary={summarizeBrowserVaultAccountLibrary(selectedSecondGroup)}
        onAddGroup={vi.fn()}
        onClearAccountSelection={vi.fn()}
        onDeriveAccounts={vi.fn()}
        onExportVault={vi.fn()}
        onLock={vi.fn()}
        onRenameAccount={vi.fn()}
        onRenameGroup={vi.fn()}
        onSelectAllAccounts={vi.fn()}
        onSelectGroup={vi.fn()}
        onToggleAccountSelection={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: `${firstGroup.name} 已选 1 / 2` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Work 已选 3 / 3" })).toBeInTheDocument();
    expect(screen.getByText("当前组 Work")).toBeInTheDocument();
    expect(screen.getByText("下一个 index 3")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);
  });

  it("derives, selects, clears, and renames through workspace controls", () => {
    const { activeGroup, groups, summary } = createWorkspaceState();
    const onDeriveAccounts = vi.fn();
    const onRenameGroup = vi.fn();
    const onRenameAccount = vi.fn();
    const onToggleAccountSelection = vi.fn();
    const onSelectAllAccounts = vi.fn();
    const onClearAccountSelection = vi.fn();
    const onSelectGroup = vi.fn();

    renderScreen(
      <PwaVaultWorkspace
        activeGroup={activeGroup}
        busy={false}
        groups={groups}
        librarySummary={summary}
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

    fireEvent.click(screen.getByRole("button", { name: "派生 1" }));
    expect(onDeriveAccounts).toHaveBeenCalledWith(activeGroup.id, 1);

    fireEvent.click(screen.getByRole("button", { name: "派生 5" }));
    expect(onDeriveAccounts).toHaveBeenCalledWith(activeGroup.id, 5);

    fireEvent.click(screen.getByRole("button", { name: "派生 20" }));
    expect(onDeriveAccounts).toHaveBeenCalledWith(activeGroup.id, 20);

    fireEvent.change(screen.getByLabelText("派生数量"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "派生账户" }));
    expect(onDeriveAccounts).toHaveBeenCalledWith(activeGroup.id, 100);

    fireEvent.change(screen.getByLabelText("派生数量"), { target: { value: "101" } });
    expect(screen.getByLabelText("派生数量")).toHaveValue(100);

    fireEvent.change(screen.getByLabelText("派生数量"), { target: { value: "2.8" } });
    fireEvent.click(screen.getByRole("button", { name: "派生账户" }));
    expect(onDeriveAccounts).toHaveBeenCalledWith(activeGroup.id, 2);

    fireEvent.change(screen.getByLabelText("派生数量"), { target: { value: "-1" } });
    expect(screen.getByLabelText("派生数量")).toHaveValue(0);
    expect(screen.getByRole("button", { name: "派生账户" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("派生数量"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "派生账户" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("组名"), { target: { value: "Work" } });
    expect(onRenameGroup).toHaveBeenCalledWith(activeGroup.id, "Work");

    fireEvent.click(screen.getByRole("checkbox", { name: /账户 1/ }));
    expect(onToggleAccountSelection).toHaveBeenCalledWith(activeGroup.id, activeGroup.accounts[0].id);

    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    expect(onSelectAllAccounts).toHaveBeenCalledWith(activeGroup.id);

    fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
    expect(onClearAccountSelection).toHaveBeenCalledWith(activeGroup.id);

    fireEvent.click(screen.getAllByRole("button", { name: "改名" })[0]);
    expect(onRenameAccount).toHaveBeenCalledWith(activeGroup.id, activeGroup.accounts[0].id, `${activeGroup.accounts[0].label}*`);

    fireEvent.click(screen.getByRole("button", { name: `${activeGroup.name} 已选 1 / 1` }));
    expect(onSelectGroup).toHaveBeenCalledWith(activeGroup.id);
  });

  it("keeps derived account indexes stable when more accounts are added", () => {
    const state = createInitialBrowserVaultState({ mnemonicPhrase: "test test test test test test test test test test test junk" });
    const activeGroup = getActiveBrowserVaultGroup(state)!;
    const nextState = deriveBrowserVaultAccounts(state, activeGroup.id, 2);
    expect(getActiveBrowserVaultGroup(nextState)?.accounts.map((account) => account.index)).toEqual([0, 1, 2]);
  });
});
