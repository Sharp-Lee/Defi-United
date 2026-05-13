import type { ReactNode } from "react";

export function SettingsModule({ children }: { children: ReactNode }) {
  return (
    <section className="settings-module" aria-labelledby="settings-module-title">
      <header className="module-header">
        <div>
          <p className="eyebrow">设置</p>
          <h2 id="settings-module-title">设置</h2>
          <p>链/RPC 配置保存在浏览器本地；fee 参数是当前页面 session-only 草稿。</p>
        </div>
      </header>
      {children}
    </section>
  );
}
