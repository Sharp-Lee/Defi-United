import { StatusBadge } from "../../shared/ui/StatusBadge";
import type { AppSessionSummary } from "../state/appSession";

export function AppTopBar({ sessionSummary }: { sessionSummary: AppSessionSummary }) {
  return (
    <header className="app-top-bar pwa-panel">
      <div>
        <p className="pwa-kicker">Browser-first PWA mainline</p>
        <h1>主工作区</h1>
      </div>

      <dl className="app-top-bar-metrics" aria-label="会话摘要">
        <div>
          <dt>Vault</dt>
          <dd>
            <StatusBadge tone={sessionSummary.vaultStateLabel === "已解锁" ? "success" : "neutral"}>
              {sessionSummary.vaultStateLabel}
            </StatusBadge>
          </dd>
        </div>
        <div>
          <dt>账户</dt>
          <dd>
            {sessionSummary.selectedAccountCount}/{sessionSummary.accountCount}
          </dd>
        </div>
        <div>
          <dt>链</dt>
          <dd>{sessionSummary.activeChainName}</dd>
        </div>
        <div>
          <dt>Gas</dt>
          <dd>{sessionSummary.nativeSymbol}</dd>
        </div>
      </dl>
    </header>
  );
}
