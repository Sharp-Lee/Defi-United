import type { ReactNode } from "react";

export function AccountsModule({ children }: { children: ReactNode }) {
  return (
    <section className="accounts-module" aria-labelledby="accounts-module-title">
      <header className="module-header">
        <div>
          <p className="eyebrow">账户库</p>
          <h2 id="accounts-module-title">账户库</h2>
          <p>一套助记词一个组，组内可派生多个本地账户；当前只启用加密 vault 与账户派生。</p>
        </div>
      </header>
      {children}
    </section>
  );
}
