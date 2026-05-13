import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { renderScreen } from "./test/render";

describe("App", () => {
  it("renders the PWA shell by default", async () => {
    renderScreen(<App />);

    expect(screen.getByText("PWA 控制台")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "主工作区" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "总览" })).toBeInTheDocument();
    expect(screen.getByLabelText("预览与风险")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "账户库" }));

    expect(screen.getByRole("heading", { name: "账户库" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Vault 密码")).toBeInTheDocument());
  });
});
