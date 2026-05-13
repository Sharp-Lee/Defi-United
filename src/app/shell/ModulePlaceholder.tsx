import { NoticePanel } from "../../shared/ui/NoticePanel";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import type { AppModuleDefinition } from "./navigation";

export function ModulePlaceholder({ module }: { module: AppModuleDefinition }) {
  return (
    <section className="pwa-panel module-placeholder" aria-labelledby={`app-module-${module.id}`}>
      <div className="pwa-panel-header">
        <div>
          <p className="pwa-kicker">P10d 控制台模块</p>
          <h2 id={`app-module-${module.id}`}>{module.label}</h2>
          <p>{module.summary}</p>
        </div>
        <StatusBadge tone="warning">未启用</StatusBadge>
      </div>

      <div className="pwa-card-grid">
        <article className="pwa-card">
          <h3>计划能力</h3>
          <ul>
            {module.planned.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <NoticePanel title="安全边界" tone="warning">
          <p>当前模块仅是 P10d 架构 shell 占位。</p>
          <p>不会运行签名、广播、RPC 提交、余额扫描或真实交易历史写入。</p>
        </NoticePanel>
      </div>
    </section>
  );
}
