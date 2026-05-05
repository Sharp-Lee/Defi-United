import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { renderScreen } from "./test/render";

describe("App", () => {
  it("renders the PWA shell by default", async () => {
    renderScreen(<App />);

    expect(screen.getByRole("heading", { name: "DeFi United PWA 钱包工作台" })).toBeInTheDocument();
    expect(screen.getByText(/仓库现在只保留 PWA runtime/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Vault 密码")).toBeInTheDocument());
  });
});
