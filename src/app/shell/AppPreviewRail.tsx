import { NoticePanel } from "../../shared/ui/NoticePanel";

export function AppPreviewRail() {
  return (
    <aside className="app-preview-rail pwa-panel" aria-label="预览与风险">
      <NoticePanel title="交易预览">
        <p>P13 前仅占位，不运行签名或广播队列。</p>
      </NoticePanel>

      <NoticePanel title="风险边界" tone="warning">
        <p>当前 shell 只允许 P12 只读余额刷新；仍不包含签名、广播、RPC 提交交易、分发归集执行或真实历史写入。</p>
      </NoticePanel>

      <NoticePanel title="队列">
        <p>队列只展示未来入口；P13 前仅占位，不运行签名或广播队列。</p>
      </NoticePanel>
    </aside>
  );
}
