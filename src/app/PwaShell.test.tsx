import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PwaShell } from "./PwaShell";
import { renderScreen } from "../test/render";

const primaryNavLabels = ["账户", "资产", "分发/归集", "铭文刻录", "合约调用", "历史", "设置"];

describe("PwaShell", () => {
  it("renders the Chinese PWA shell baseline", () => {
    renderScreen(<PwaShell />);

    expect(screen.getByRole("heading", { name: "DeFi United PWA 钱包工作台" })).toBeInTheDocument();
    expect(screen.getByText(/Browser-first PWA mainline/i)).toBeInTheDocument();
    expect(screen.getByText(/Tauri desktop v1/)).toBeInTheDocument();
  });

  it("shows all primary navigation labels", () => {
    renderScreen(<PwaShell />);

    for (const label of primaryNavLabels) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("switches active section from accounts to contract calls", () => {
    renderScreen(<PwaShell />);

    expect(screen.getByRole("heading", { name: "账户" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "合约调用" }));

    expect(screen.getByRole("heading", { name: "合约调用" })).toBeInTheDocument();
    expect(screen.getByText(/ABI 管理/)).toBeInTheDocument();
  });

  it("marks sensitive wallet capabilities as unavailable in P10a", () => {
    renderScreen(<PwaShell />);

    expect(screen.getByText("当前未启用")).toBeInTheDocument();
    expect(screen.getByText(/当前不包含 vault 解锁/)).toBeInTheDocument();
    expect(screen.getByText(/签名、广播、RPC\s*提交/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unlock|sign|broadcast|解锁|签名|广播/i })).not.toBeInTheDocument();
  });

  it("shows the archived Tauri desktop baseline notice", () => {
    renderScreen(<PwaShell />);

    expect(screen.getByLabelText("归档桌面基线说明")).toHaveTextContent("归档基线");
    expect(screen.getByLabelText("归档桌面基线说明")).toHaveTextContent("Tauri desktop v1");
  });
});
