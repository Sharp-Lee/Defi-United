import type {
  QueueExecutionPolicy,
  QueueHistoryState,
  QueueJobRecord,
  QueueJobStatus,
  QueueTransactionRecord,
  QueueTransactionStatus,
} from "../../core/queue";

export type PwaQueueActiveRunStatus =
  | "idle"
  | "running"
  | "stopping"
  | "stopped"
  | "partial"
  | "completed"
  | "failed";

export interface PwaQueueActiveRun {
  status: PwaQueueActiveRunStatus;
  jobs: QueueJobRecord[];
  transactions: QueueTransactionRecord[];
}

export interface PwaQueueHistoryWorkspaceProps {
  activeRun: PwaQueueActiveRun | null;
  history: QueueHistoryState;
  policy: QueueExecutionPolicy;
  unlocked: boolean;
  onPolicyChange(policy: QueueExecutionPolicy): void;
  onStop(): void;
  onResume(): void;
  onRetryFailed(): void;
  onRerunFromFailedNonce(): void;
  onExport(): void;
}

const RUN_STATUS_LABELS: Record<PwaQueueActiveRunStatus, string> = {
  idle: "空闲",
  running: "运行中",
  stopping: "停止中",
  stopped: "已停止",
  partial: "部分完成",
  completed: "已完成",
  failed: "失败",
};

const JOB_STATUS_LABELS: Record<QueueJobStatus, string> = {
  draft: "草稿",
  queued: "排队中",
  running: "运行中",
  stopping: "停止中",
  stopped: "已停止",
  completed: "已完成",
  partial: "部分完成",
  failed: "失败",
};

const TRANSACTION_STATUS_LABELS: Record<QueueTransactionStatus, string> = {
  draft: "草稿",
  queued: "排队中",
  "nonce-ready": "Nonce 就绪",
  signing: "准备中",
  broadcasting: "处理中",
  pending: "等待确认",
  failed: "失败",
  skipped: "已跳过",
  stopped: "已停止",
};

function clampInteger(value: number, min: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.trunc(value));
}

function summarizeTransactions(transactions: QueueTransactionRecord[]) {
  return transactions.reduce(
    (summary, transaction) => {
      if (transaction.status === "failed") summary.failed += 1;
      if (transaction.status === "stopped") summary.stopped += 1;
      if (transaction.status === "pending") summary.pending += 1;
      if (transaction.status !== "failed" && transaction.status !== "stopped" && transaction.status !== "pending") {
        summary.other += 1;
      }
      return summary;
    },
    { failed: 0, other: 0, pending: 0, stopped: 0 },
  );
}

function shortAddress(value: string | null) {
  if (!value) return "无";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatNonce(nonce: number | null) {
  return nonce === null ? "未分配" : nonce.toString();
}

function policyNumberValue(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function PwaQueueHistoryWorkspace({
  activeRun,
  history,
  policy,
  unlocked,
  onPolicyChange,
  onStop,
  onResume,
  onRetryFailed,
  onRerunFromFailedNonce,
  onExport,
}: PwaQueueHistoryWorkspaceProps) {
  const activeTransactions = activeRun?.transactions ?? [];
  const activeSummary = summarizeTransactions(activeTransactions);
  const operationDisabled = !unlocked || !activeRun;

  function updatePolicy(patch: Partial<QueueExecutionPolicy>) {
    onPolicyChange({ ...policy, ...patch });
  }

  return (
    <section className="queue-section" aria-labelledby="queue-workspace-title">
      <header className="section-header">
        <div>
          <h2 id="queue-workspace-title">队列/历史</h2>
          <p className="section-subtitle">查看当前标签页执行状态与 durable redacted history；策略仅作用于本次会话。</p>
        </div>
        <button className="secondary-button" onClick={onExport} type="button">
          导出脱敏 JSON
        </button>
      </header>

      <div className="pwa-card asset-status-strip">
        <span className="status-badge">Vault {unlocked ? "已解锁" : "已锁定"}</span>
        <span className="status-badge">当前队列 {activeRun ? RUN_STATUS_LABELS[activeRun.status] : "无 active run"}</span>
        <span className="status-badge">历史任务 {history.jobs.length}</span>
        <span className="status-badge">历史交易 {history.transactions.length}</span>
      </div>

      {!unlocked && <p className="notice-panel notice-panel-warning">解锁 vault 后才能运行当前标签页队列。</p>}
      {unlocked && !activeRun && <p className="notice-panel">当前标签页没有 active run；仍可查看 durable redacted history。</p>}

      <article className="pwa-card">
        <div className="pwa-card-heading-row">
          <div>
            <h3>执行策略</h3>
            <p className="pwa-muted-note">session-only 设置，不写入 durable history。</p>
          </div>
        </div>
        <div className="pwa-form-grid">
          <label>
            并发数
            <input
              aria-label="并发数"
              min={1}
              onChange={(event) => updatePolicy({ concurrency: clampInteger(event.target.valueAsNumber, 1) })}
              type="number"
              value={policyNumberValue(policy.concurrency)}
            />
          </label>
          <label>
            钱包间隔 ms
            <input
              aria-label="钱包间隔 ms"
              min={0}
              onChange={(event) => updatePolicy({ walletIntervalMs: clampInteger(event.target.valueAsNumber, 0) })}
              type="number"
              value={policyNumberValue(policy.walletIntervalMs)}
            />
          </label>
          <label>
            RPC 请求/秒
            <input
              aria-label="RPC 请求/秒"
              min={1}
              onChange={(event) => updatePolicy({ rpcRequestsPerSecond: clampInteger(event.target.valueAsNumber, 1) })}
              type="number"
              value={policyNumberValue(policy.rpcRequestsPerSecond)}
            />
          </label>
          <label className="pwa-checkbox-row">
            <input
              checked={policy.continueOnFailure}
              onChange={(event) => updatePolicy({ continueOnFailure: event.target.checked })}
              type="checkbox"
            />
            失败后继续其他账户
          </label>
          <label className="pwa-checkbox-row">
            <input
              checked={policy.rerunFromFailedNonce}
              onChange={(event) => updatePolicy({ rerunFromFailedNonce: event.target.checked })}
              type="checkbox"
            />
            从失败 nonce 续跑
          </label>
        </div>
      </article>

      <article className="pwa-card">
        <div className="pwa-card-heading-row">
          <div>
            <h3>当前标签页队列</h3>
            <p className="pwa-muted-note">恢复、重试和续跑必须依赖当前标签页 active run。</p>
          </div>
        </div>
        <div className="queue-actions">
          <button disabled={operationDisabled} onClick={onStop} type="button">
            停止队列
          </button>
          <button className="secondary-button" disabled={operationDisabled} onClick={onResume} type="button">
            恢复停止项
          </button>
          <button className="secondary-button" disabled={operationDisabled} onClick={onRetryFailed} type="button">
            重试失败
          </button>
          <button className="secondary-button" disabled={operationDisabled} onClick={onRerunFromFailedNonce} type="button">
            从失败 nonce 续跑
          </button>
        </div>
        <div className="pwa-card asset-status-strip">
          <span className="status-badge">任务 {activeRun?.jobs.length ?? 0}</span>
          <span className="status-badge">交易 {activeTransactions.length}</span>
          <span className="status-badge">失败 {activeSummary.failed}</span>
          <span className="status-badge">停止 {activeSummary.stopped}</span>
          <span className="status-badge">等待 {activeSummary.pending}</span>
        </div>
      </article>

      <article className="pwa-card">
        <div className="pwa-card-heading-row">
          <div>
            <h3>任务表</h3>
            <p className="pwa-muted-note">durable redacted history，仅展示安全摘要。</p>
          </div>
        </div>
        <div className="asset-table-wrap">
          <table>
            <thead>
              <tr>
                <th>任务</th>
                <th>状态</th>
                <th>链</th>
                <th>摘要</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {history.jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <strong>{job.title}</strong>
                    <div className="pwa-muted-note">{job.sourceModule}</div>
                  </td>
                  <td>
                    <span className="status-badge">{JOB_STATUS_LABELS[job.status]}</span>
                  </td>
                  <td>{job.chainId}</td>
                  <td>
                    总数 {job.summary.total} / 完成 {job.summary.completed} / 失败 {job.summary.failed} / 停止{" "}
                    {job.summary.stopped}
                  </td>
                  <td className="mono">{job.updatedAt}</td>
                </tr>
              ))}
              {history.jobs.length === 0 && (
                <tr>
                  <td colSpan={5}>暂无队列历史。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="pwa-card">
        <div className="pwa-card-heading-row">
          <div>
            <h3>交易历史</h3>
            <p className="pwa-muted-note">只显示脱敏后的执行记录和错误摘要。</p>
          </div>
        </div>
        <div className="asset-table-wrap">
          <table>
            <thead>
              <tr>
                <th>账户</th>
                <th>Nonce</th>
                <th>状态</th>
                <th>目标</th>
                <th>摘要</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {history.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>
                    <span className="mono">{shortAddress(transaction.accountAddress)}</span>
                  </td>
                  <td>{formatNonce(transaction.nonce)}</td>
                  <td>
                    <span className="status-badge">{TRANSACTION_STATUS_LABELS[transaction.status]}</span>
                  </td>
                  <td className="mono">{shortAddress(transaction.target)}</td>
                  <td>
                    <div>{transaction.calldataSummary.summary}</div>
                    {transaction.txHash && <div className="mono">{transaction.txHash}</div>}
                  </td>
                  <td>
                    {transaction.error ? (
                      <div>
                        <strong>{transaction.error.category}</strong>
                        <div>{transaction.error.message}</div>
                      </div>
                    ) : (
                      "无"
                    )}
                  </td>
                </tr>
              ))}
              {history.transactions.length === 0 && (
                <tr>
                  <td colSpan={6}>暂无交易历史。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
