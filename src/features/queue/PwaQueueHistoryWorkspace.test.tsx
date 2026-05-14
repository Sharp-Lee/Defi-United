import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultQueueHistoryState, createDefaultQueuePolicy } from "../../core/queue";
import type { QueueHistoryState, QueueJobRecord, QueueTransactionRecord } from "../../core/queue";
import { renderScreen } from "../../test/render";
import { PwaQueueHistoryWorkspace } from "./PwaQueueHistoryWorkspace";
import { QueueModule } from "./QueueModule";

const createdAt = "2026-05-14T00:00:00.000Z";

function history(): QueueHistoryState {
  const job: QueueJobRecord = {
    id: "job-1",
    chainId: 1,
    title: "测试队列",
    sourceModule: "queue",
    status: "partial",
    createdAt,
    updatedAt: createdAt,
    executionPolicy: createDefaultQueuePolicy(),
    transactionIds: ["tx-1"],
    summary: { total: 1, pending: 0, failed: 1, stopped: 0, completed: 0 },
  };
  const transaction: QueueTransactionRecord = {
    id: "tx-1",
    jobId: "job-1",
    chainId: 1,
    accountId: "account-1",
    accountAddress: "0x0000000000000000000000000000000000000001",
    nonce: 7,
    status: "failed",
    actionType: "raw-calldata",
    target: "0x0000000000000000000000000000000000000002",
    valueWei: "0",
    calldataSummary: { selector: "0x64617461", byteLength: 16, summary: "脱敏调用数据 · 16 bytes" },
    feeSummary: {
      mode: "eip1559",
      gasLimit: "21000",
      maxFeePerGasGwei: "30",
      maxPriorityFeePerGasGwei: "1.5",
    },
    txHash: null,
    error: {
      category: "broadcast-failed",
      message: "RPC request failed: [redacted-url]",
      retryable: true,
    },
    createdAt,
    updatedAt: createdAt,
  };

  return {
    ...createDefaultQueueHistoryState(),
    updatedAt: createdAt,
    jobs: [job],
    transactions: [transaction],
  };
}

function workspaceProps(
  overrides: Partial<React.ComponentProps<typeof PwaQueueHistoryWorkspace>> = {},
): React.ComponentProps<typeof PwaQueueHistoryWorkspace> {
  return {
    activeRun: null,
    history: history(),
    policy: createDefaultQueuePolicy(),
    unlocked: true,
    onExport: vi.fn(),
    onPolicyChange: vi.fn(),
    onResume: vi.fn(),
    onRetryFailed: vi.fn(),
    onRerunFromFailedNonce: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof PwaQueueHistoryWorkspace>> = {}) {
  const props = workspaceProps(overrides);
  renderScreen(<PwaQueueHistoryWorkspace {...props} />);
  return props;
}

describe("PwaQueueHistoryWorkspace", () => {
  it("keeps a single queue history heading when wrapped by QueueModule", () => {
    renderScreen(
      <QueueModule>
        <PwaQueueHistoryWorkspace {...workspaceProps()} />
      </QueueModule>,
    );

    expect(screen.getAllByRole("heading", { name: "队列/历史" })).toHaveLength(1);
  });

  it("renders locked state, queue settings, and no arbitrary send form", () => {
    renderWorkspace({ unlocked: false });

    expect(screen.getByRole("heading", { name: "队列/历史" })).toBeInTheDocument();
    expect(screen.getByText("解锁 vault 后才能运行当前标签页队列。")).toBeInTheDocument();
    expect(screen.getByLabelText("并发数")).toHaveValue(20);
    expect(screen.getByLabelText("失败后继续其他账户")).toBeChecked();
    expect(screen.getByLabelText("从失败 nonce 续跑")).toBeChecked();
    expect(screen.queryByRole("button", { name: /签名|广播|提交|发送|分发|归集|approve|ABI|calldata/i })).not.toBeInTheDocument();
  });

  it("renders redacted history and calls onExport when export is clicked", () => {
    const onExport = vi.fn();
    renderWorkspace({ onExport });

    expect(screen.getByText("测试队列")).toBeInTheDocument();
    expect(screen.getByText("broadcast-failed")).toBeInTheDocument();
    expect(screen.getByText("RPC request failed: [redacted-url]")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "导出脱敏 JSON" }));

    expect(onExport).toHaveBeenCalledOnce();
    expect(screen.queryByText(/raw signed|private key|mnemonic|password/i)).not.toBeInTheDocument();
  });

  it("disables operation buttons without an unlocked active run and clamps policy input values", () => {
    const onPolicyChange = vi.fn();
    const props = renderWorkspace({ activeRun: null, onPolicyChange });

    expect(screen.getByRole("button", { name: "停止队列" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "恢复停止项" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重试失败" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "从失败 nonce 续跑" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("并发数"), { target: { value: "0" } });
    expect(onPolicyChange).toHaveBeenCalledWith({ ...props.policy, concurrency: 1 });

    fireEvent.change(screen.getByLabelText("RPC 请求/秒"), { target: { value: "0" } });
    expect(onPolicyChange).toHaveBeenCalledWith({ ...props.policy, rpcRequestsPerSecond: 1 });

    fireEvent.change(screen.getByLabelText("钱包间隔 ms"), { target: { value: "-1" } });
    expect(onPolicyChange).toHaveBeenCalledWith({ ...props.policy, walletIntervalMs: 0 });
  });
});
