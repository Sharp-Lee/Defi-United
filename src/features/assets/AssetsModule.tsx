import type { ReactNode } from "react";

export function AssetsModule({ children }: { children: ReactNode }) {
  return (
    <section className="assets-module" aria-labelledby="assets-module-title">
      <header className="module-header">
        <div>
          <p className="eyebrow">资产</p>
          <h2 id="assets-module-title">资产</h2>
          <p>只读查看本地账户余额与关注 ERC-20 资产；刷新由上层会话传入，不在组件内发起 RPC。</p>
        </div>
      </header>
      {children}
    </section>
  );
}
