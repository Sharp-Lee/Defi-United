import { describe, expect, it } from "vitest";
import type { DiagnosticEvent } from "../../lib/tauri";
import {
  defaultDiagnosticFilters,
  diagnosticExportScopeSummary,
  diagnosticQueryFromFilters,
  diagnosticSensitiveExclusionText,
  selectDiagnosticEvents,
} from "./selectors";

function event(overrides: Partial<DiagnosticEvent> = {}): DiagnosticEvent {
  return {
    timestamp: "1700000000",
    level: "error",
    category: "transaction",
    source: "transactions",
    event: "nativeTransferBroadcastFailed",
    chainId: 1,
    accountIndex: 2,
    txHash: "0xabc",
    message: "replacement underpriced",
    metadata: {
      nonce: 7,
      stage: "broadcast",
      nextState: "Pending",
      from: "0x1111111111111111111111111111111111111111",
    },
    ...overrides,
  };
}

describe("diagnostic selectors", () => {
  it("filters by category, time, chainId, account, tx hash, level and status", () => {
    const filters = {
      ...defaultDiagnosticFilters(),
      category: "transaction",
      timeWindow: "day" as const,
      chainId: "1",
      account: "1111",
      txHash: "abc",
      level: "error",
      status: "broadcast",
    };

    const selected = selectDiagnosticEvents(
      [
        event(),
        event({ txHash: "0xdef", metadata: { stage: "provider" } }),
        event({ category: "rpc" }),
      ],
      filters,
      1_700_000_100_000,
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      accountLabel: "Account 2 · 0x11111111...1111",
      nonceLabel: "7",
      stageLabel: "broadcast",
      statusLabel: "Pending",
      summary: "replacement underpriced",
    });
  });

  it("builds export query and scope copy without sensitive material", () => {
    const query = diagnosticQueryFromFilters(
      {
        ...defaultDiagnosticFilters(),
        timeWindow: "hour",
        chainId: "11155111",
        account: "Account 1",
        txHash: "0xabc",
        level: "warn",
      },
      1_700_003_600_000,
    );
    const summary = diagnosticExportScopeSummary(query);
    const exclusionText = diagnosticSensitiveExclusionText();

    expect(query).toMatchObject({
      limit: 200,
      sinceTimestamp: 1_700_000_000,
      chainId: 11155111,
      account: "Account 1",
      txHash: "0xabc",
      level: "warn",
    });
    expect(summary).toContain("chainId 11155111");
    expect(exclusionText).toContain("mnemonics");
    expect(exclusionText).toContain("unredacted RPC URL secrets");
    expect(exclusionText).toContain("full logs");
    expect(exclusionText).toContain("local history match details");
    expect(exclusionText).toContain("classification truth");
    expect(exclusionText).toContain("analysis labels");
  });

  it("redacts sensitive filter values from the displayed export scope", () => {
    const summary = diagnosticExportScopeSummary({
      limit: 200,
      category: "rpc https://user:pass@example.invalid/rpc?token=scope-secret",
      account: "mnemonic=abandon abandon abandon",
      txHash: "seed=scope-seed private_key=scope-private-key",
      status: "password=hunter2 signature=scope-signature Authorization Bearer scope-auth-token",
    });

    expect(summary).toContain("[redacted filter]");
    expect(summary).not.toContain("user:pass");
    expect(summary).not.toContain("scope-secret");
    expect(summary).not.toContain("abandon");
    expect(summary).not.toContain("scope-seed");
    expect(summary).not.toContain("scope-private-key");
    expect(summary).not.toContain("hunter2");
    expect(summary).not.toContain("scope-signature");
    expect(summary).not.toContain("scope-auth-token");
    expect(summary).not.toContain("https://");
  });

  it("redacts endpoint-like filter values without a URL scheme from the displayed export scope", () => {
    const summary = diagnosticExportScopeSummary({
      limit: 200,
      category: "rpc user:pass@example.invalid/rpc?token=scope-secret",
    });

    expect(summary).toContain("[redacted filter]");
    expect(summary).not.toContain("scope-secret");
    expect(summary).not.toContain("user:pass");
    expect(summary).not.toContain("example.invalid");
  });

  it("redacts sensitive tx hash filter short words from the displayed export scope", () => {
    for (const sensitiveValue of [
      "password",
      "auth",
      "privatekey",
      "mnemonic",
      "signature",
    ]) {
      const summary = diagnosticExportScopeSummary({
        limit: 200,
        txHash: sensitiveValue,
      });

      expect(summary).toContain("[redacted filter]");
      expect(summary).not.toContain(`"${sensitiveValue}"`);
    }
  });

  it("redacts approval revoke diagnostic export scope secrets", () => {
    const summary = diagnosticExportScopeSummary({
      limit: 200,
      category: "assetApprovalRevoke",
      status:
        "allowance point read failed raw signed transaction 0xsigned private key 0xsecret api key scan-secret",
    });

    expect(summary).toContain("category assetApprovalRevoke");
    expect(summary).toContain("[redacted filter]");
    expect(summary).not.toContain("0xsigned");
    expect(summary).not.toContain("0xsecret");
    expect(summary).not.toContain("scan-secret");
  });
});
