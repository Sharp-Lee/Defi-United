import { NoticePanel } from "../../shared/ui/NoticePanel";

export function AppPreviewRail() {
  return (
    <aside className="app-preview-rail pwa-panel" aria-label="预览与风险">
      <NoticePanel title="交易预览">
        <p>P13 仅展示队列与脱敏历史预览；业务页面接入前不会构造、签名或广播交易。</p>
      </NoticePanel>

      <NoticePanel title="风险边界" tone="warning">
        <p>当前 shell 允许只读余额刷新和 P13 队列历史观察；仍不包含业务发送入口、分发归集执行或任意 calldata 提交。</p>
      </NoticePanel>

      <NoticePanel title="队列">
        <p>P13 队列/历史用于观察、停止、恢复、重试和脱敏导出；业务发送入口仍由 P14+ 页面接入。</p>
      </NoticePanel>
    </aside>
  );
}
