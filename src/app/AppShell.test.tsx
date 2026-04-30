import { fireEvent, screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import { renderScreen } from "../test/render";
import type { AbiRegistryState } from "../lib/tauri";

function abiRegistryState(
  dataSources: AbiRegistryState["dataSources"],
): AbiRegistryState {
  return { schemaVersion: 1, dataSources, cacheEntries: [] };
}

function abiDataSource(
  overrides: Partial<AbiRegistryState["dataSources"][number]> & { id: string },
): AbiRegistryState["dataSources"][number] {
  const { id, ...rest } = overrides;
  return {
    id,
    chainId: 1,
    providerKind: "etherscanCompatible",
    baseUrl: "https://api.etherscan.io/api",
    apiKeyRef: null,
    enabled: true,
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
    cooldownUntil: null,
    rateLimited: false,
    lastErrorSummary: null,
    createdAt: "2026-04-30T00:00:00Z",
    updatedAt: "2026-04-30T00:00:00Z",
    ...rest,
  };
}

describe("AppShell", () => {
  it("renders the locked workspace when no session is active", () => {
    renderScreen(
      <AppShell
        activeTab="accounts"
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "locked" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "EVM Wallet Workbench" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock Vault" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Accounts" })).not.toBeInTheDocument();
  });

  it("renders the workspace tabs when a session is ready", () => {
    renderScreen(
      <AppShell
        activeTab="accounts"
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    expect(screen.getByRole("tab", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "ABI Library" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tokens" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Assets & Approvals" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Orchestration" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Transfer" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Raw Calldata" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Hot Contract" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlock Vault" })).not.toBeInTheDocument();
  });

  it("renders ABI Library when the workspace tab is active", () => {
    renderScreen(
      <AppShell
        activeTab="abi"
        abiRegistryState={{ schemaVersion: 1, dataSources: [], cacheEntries: [] }}
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    expect(screen.getByRole("tab", { name: "ABI Library" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("heading", { name: "ABI Library" })).toBeInTheDocument();
    expect(screen.getByText("No ABI data sources configured.")).toBeInTheDocument();
  });

  it("locks settings inputs while the workspace is busy", () => {
    renderScreen(
      <AppShell
        activeTab="settings"
        busy={true}
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Chain" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "RPC URL" })).toBeDisabled();
  });

  it("sanitizes long global app errors before displaying them", () => {
    const rawBlob = "0x".padEnd(132, "a");
    renderScreen(
      <AppShell
        activeTab="history"
        appError={`RPC failed with payload ${rawBlob} ${"x".repeat(300)}`}
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    const banner = document.querySelector(".inline-error");
    expect(banner).not.toBeNull();
    expect(banner).toHaveTextContent("RPC unavailable or rejected");
    expect(banner).toHaveTextContent(/0xaaaaaaaa\.\.\.aaaaaaaa/);
    expect(banner).not.toHaveTextContent(new RegExp("a{80}"));
    expect(screen.queryByText(new RegExp("a{80}"))).not.toBeInTheDocument();
  });

  it("does not show non-history global errors as manual history refresh failures", () => {
    renderScreen(
      <AppShell
        activeTab="history"
        appError="Account refresh failed: RPC timeout"
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    expect(document.querySelector(".inline-error")).toHaveTextContent("RPC unavailable or rejected");
    const historySection = within(screen.getByRole("heading", { name: "History" }).closest("section") as HTMLElement);
    expect(historySection.queryByText("Manual refresh")).not.toBeInTheDocument();
    expect(historySection.queryByText("manual history refresh")).not.toBeInTheDocument();
  });

  it("passes history refresh errors into HistoryView classification", () => {
    renderScreen(
      <AppShell
        activeTab="history"
        appError="RPC returned chainId 8453; expected 1."
        historyError="RPC returned chainId 8453; expected 1."
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    const historySection = within(screen.getByRole("heading", { name: "History" }).closest("section") as HTMLElement);
    expect(historySection.getByText("Manual refresh")).toBeInTheDocument();
    expect(historySection.getByText("Chain identity mismatch")).toBeInTheDocument();
    expect(historySection.getByText(/chainId is the stable chain identity/)).toBeInTheDocument();
  });

  it("passes corrupted history storage into transfer gating", () => {
    renderScreen(
      <AppShell
        activeTab="transfer"
        accounts={[
          {
            address: "0x1111111111111111111111111111111111111111",
            index: 1,
            label: "Account 1",
            nativeBalanceWei: 1n,
            nonce: 0,
          },
        ]}
        historyStorage={{
          status: "corrupted",
          path: "/tmp/tx-history.json",
          corruptionType: "jsonParseFailed",
          readable: true,
          recordCount: 0,
          invalidRecordCount: 0,
          invalidRecordIndices: [],
          errorSummary: "expected value",
          rawSummary: {
            fileSizeBytes: 12,
            modifiedAt: null,
            topLevel: null,
            arrayLen: null,
          },
        }}
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Build Draft" })).toBeDisabled();
    expect(screen.getByText(/Local transaction history is unreadable/)).toBeInTheDocument();
  });

  it("renders the desktop raw calldata workspace tab", () => {
    renderScreen(
      <AppShell
        activeTab="rawCalldata"
        accounts={[
          {
            address: "0x1111111111111111111111111111111111111111",
            index: 1,
            label: "Account 1",
            nativeBalanceWei: 1n,
            nonce: 0,
          },
        ]}
        abiRegistryState={{ schemaVersion: 1, dataSources: [], cacheEntries: [] }}
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    expect(screen.getByRole("tab", { name: "Raw Calldata" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Raw Calldata" })).toBeInTheDocument();
    expect(screen.getByLabelText("Calldata")).toHaveValue("0x");
  });

  it("renders the desktop hot contract workspace tab", () => {
    renderScreen(
      <AppShell
        activeTab="hotContract"
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
      />,
    );

    expect(screen.getByRole("tab", { name: "Hot Contract" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Hot Contract Analysis" })).toBeInTheDocument();
    expect(screen.getByLabelText("Contract address")).toHaveValue("");
  });

  it("passes ABI registry state into the hot contract workspace tab", () => {
    renderScreen(
      <AppShell
        abiRegistryState={abiRegistryState([
          abiDataSource({ id: "configured-mainnet", chainId: 1 }),
          abiDataSource({ id: "configured-base", chainId: 8453 }),
        ])}
        activeTab="hotContract"
        onTabChange={() => {}}
        onUnlock={async () => {}}
        rpcUrl="https://rpc.example.invalid"
        selectedChainId={1n}
        session={{ status: "ready" }}
      />,
    );

    const sourceSelect = screen.getByLabelText("Source provider");
    expect(within(sourceSelect).getByRole("option", { name: /configured-mainnet/ })).toBeInTheDocument();
    expect(within(sourceSelect).queryByRole("option", { name: /configured-base/ })).not.toBeInTheDocument();
  });

  it("renders the desktop assets and approvals workspace tab", () => {
    renderScreen(
      <AppShell
        activeTab="assets"
        onTabChange={() => {}}
        onUnlock={async () => {}}
        session={{ status: "ready" }}
        tokenWatchlistState={{
          schemaVersion: 1,
          watchlistTokens: [],
          tokenMetadataCache: [],
          tokenScanState: [],
          erc20BalanceSnapshots: [],
          approvalWatchlist: [],
          assetScanJobs: [],
          assetSnapshots: [],
          allowanceSnapshots: [],
          nftApprovalSnapshots: [],
          resolvedTokenMetadata: [],
        }}
      />,
    );

    expect(screen.getByRole("tab", { name: "Assets & Approvals" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Assets & Approvals" })).toBeInTheDocument();
    expect(screen.getByText(/coverage is unknown\/not configured/)).toBeInTheDocument();
  });

  it("passes a sanitized current RPC identity into asset revoke drafts", () => {
    const owner = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const token = "0x1111111111111111111111111111111111111111";
    const spender = "0x2222222222222222222222222222222222222222";
    renderScreen(
      <AppShell
        accounts={[
          {
            address: owner,
            index: 1,
            label: "Account 1",
            nativeBalanceWei: 1n,
            nonce: 0,
          },
        ]}
        activeTab="assets"
        onTabChange={() => {}}
        onUnlock={async () => {}}
        rpcUrl="https://rpc.example.invalid/mainnet?apikey=secret-token"
        selectedChainId={1n}
        session={{ status: "ready" }}
        settingsStatusKind="ok"
        tokenWatchlistState={{
          schemaVersion: 1,
          watchlistTokens: [],
          tokenMetadataCache: [],
          tokenScanState: [],
          erc20BalanceSnapshots: [],
          approvalWatchlist: [],
          assetScanJobs: [],
          assetSnapshots: [],
          allowanceSnapshots: [
            {
              chainId: 1,
              owner,
              tokenContract: token,
              spender,
              allowanceRaw: "100",
              status: "active",
              source: { kind: "rpcPointRead" },
              createdAt: "1",
              updatedAt: "2",
            },
          ],
          nftApprovalSnapshots: [],
          resolvedTokenMetadata: [],
        }}
      />,
    );

    fireEvent.click(
      within(screen.getByLabelText("ERC-20 allowance snapshots")).getByRole("button", {
        name: "Build Revoke Draft",
      }),
    );

    const confirmation = screen.getByLabelText("Revoke draft confirmation");
    expect(confirmation).toHaveTextContent("https://rpc.example.invalid");
    expect(confirmation).toHaveTextContent(/rpc-endpoint-/);
    expect(confirmation).not.toHaveTextContent("secret-token");
    expect(confirmation).not.toHaveTextContent("selected-rpc-chain-1");
  });

  it("does not pass an unvalidated RPC identity into asset revoke drafts", () => {
    const owner = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const token = "0x1111111111111111111111111111111111111111";
    const spender = "0x2222222222222222222222222222222222222222";
    renderScreen(
      <AppShell
        accounts={[
          {
            address: owner,
            index: 1,
            label: "Account 1",
            nativeBalanceWei: 1n,
            nonce: 0,
          },
        ]}
        activeTab="assets"
        onTabChange={() => {}}
        onUnlock={async () => {}}
        rpcUrl="https://rpc.example.invalid/mainnet?apikey=secret-token"
        selectedChainId={1n}
        session={{ status: "ready" }}
        settingsStatusKind="error"
        tokenWatchlistState={{
          schemaVersion: 1,
          watchlistTokens: [],
          tokenMetadataCache: [],
          tokenScanState: [],
          erc20BalanceSnapshots: [],
          approvalWatchlist: [],
          assetScanJobs: [],
          assetSnapshots: [],
          allowanceSnapshots: [
            {
              chainId: 1,
              owner,
              tokenContract: token,
              spender,
              allowanceRaw: "100",
              status: "active",
              source: { kind: "rpcPointRead" },
              createdAt: "1",
              updatedAt: "2",
            },
          ],
          nftApprovalSnapshots: [],
          resolvedTokenMetadata: [],
        }}
      />,
    );

    fireEvent.click(
      within(screen.getByLabelText("ERC-20 allowance snapshots")).getByRole("button", {
        name: "Build Revoke Draft",
      }),
    );

    const confirmation = screen.getByLabelText("Revoke draft confirmation");
    expect(confirmation).toHaveTextContent("Blocked until required fields and acknowledgements are complete");
    expect(confirmation).toHaveTextContent("Select and validate an RPC before building a revoke draft.");
    expect(confirmation).toHaveTextContent("selected-rpc-chain-1");
    expect(confirmation).not.toHaveTextContent("https://rpc.example.invalid");
    expect(confirmation).not.toHaveTextContent("secret-token");
  });
});
