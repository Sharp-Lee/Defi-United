import { getPrimaryRpcEndpoint, type BrowserChainRecord, type BrowserChainRecordInput, type BrowserRpcEndpoint } from "../../core/browserChainConfig";
import { PwaFeePanel } from "./PwaFeePanel";
import type { BrowserFeeDraft } from "../../core/browserChainConfig";

export interface PwaChainSettingsPanelProps {
  activeChain: BrowserChainRecord | null;
  chains: BrowserChainRecord[];
  busy?: boolean;
  error?: string | null;
  onAddChain(input: BrowserChainRecordInput): void;
  onSelectChain(chainId: string): void;
  onUpdateChain(chainId: string, updates: Partial<Pick<BrowserChainRecord, "name" | "nativeCurrencySymbol" | "explorerUrl" | "enabled">>): void;
  onUpdatePrimaryRpc(chainId: string, updates: Partial<Pick<BrowserRpcEndpoint, "label" | "url" | "enabled">>): void;
  onUpdateFeeDraft(chainId: string, updates: Partial<BrowserFeeDraft>): void;
}

export function PwaChainSettingsPanel({
  activeChain,
  chains,
  busy = false,
  error = null,
  onAddChain,
  onSelectChain,
  onUpdateChain,
  onUpdatePrimaryRpc,
  onUpdateFeeDraft,
}: PwaChainSettingsPanelProps) {
  const primaryRpc = getPrimaryRpcEndpoint(activeChain);

  function addBaseChain() {
    onAddChain({
      name: "Base",
      chainId: 8453,
      nativeCurrencySymbol: "ETH",
      rpcUrl: "https://mainnet.base.org",
      rpcLabel: "Base public RPC",
      explorerUrl: "https://basescan.org",
    });
  }

  return (
    <section className="pwa-settings-panel" aria-labelledby="pwa-settings-title">
      <header className="section-header">
        <div>
          <h2 id="pwa-settings-title">设置</h2>
          <p className="section-subtitle">浏览器本地链配置、RPC endpoint 和当前页面内的共享 fee 草稿。P10c 仍不包含签名、广播或 RPC 提交。</p>
        </div>
        <button disabled={busy} onClick={addBaseChain} type="button">
          添加 Base 示例链
        </button>
      </header>

      {error && <div className="inline-error">{error}</div>}

      <div className="pwa-settings-grid">
        <aside className="pwa-card pwa-chain-list-card">
          <h3>链列表</h3>
          <div className="pwa-group-list">
            {chains.map((chain) => (
              <button
                key={chain.id}
                className={chain.id === activeChain?.id ? "pwa-group-pill pwa-group-pill-active" : "pwa-group-pill"}
                disabled={busy}
                onClick={() => onSelectChain(chain.id)}
                type="button"
              >
                {chain.name} · #{chain.chainId}
              </button>
            ))}
          </div>
          <p className="pwa-muted-note">RPC URL 是访问端点，不是链身份；未来发送或刷新前仍必须校验 chainId。</p>
        </aside>

        <article className="pwa-card pwa-chain-editor-card">
          <div className="pwa-card-heading-row">
            <div>
              <h3>Chain / RPC Config</h3>
              <p>链名称、Chain ID、Explorer 和 RPC URL 会保存在浏览器本地，不写入 encrypted vault。</p>
            </div>
            <span className="pwa-status-badge">P10c</span>
          </div>

          {activeChain ? (
            <div className="pwa-form-grid">
              <label>
                链名称
                <input
                  aria-label="链名称"
                  disabled={busy}
                  onChange={(event) => onUpdateChain(activeChain.id, { name: event.target.value })}
                  value={activeChain.name}
                />
              </label>
              <label>
                Chain ID
                <input aria-label="Chain ID" disabled readOnly value={activeChain.chainId} />
              </label>
              <label>
                Native Symbol
                <input
                  aria-label="Native Symbol"
                  disabled={busy}
                  onChange={(event) => onUpdateChain(activeChain.id, { nativeCurrencySymbol: event.target.value })}
                  value={activeChain.nativeCurrencySymbol}
                />
              </label>
              <label>
                Explorer URL
                <input
                  aria-label="Explorer URL"
                  disabled={busy}
                  onChange={(event) => onUpdateChain(activeChain.id, { explorerUrl: event.target.value })}
                  value={activeChain.explorerUrl}
                />
              </label>
              <label>
                RPC Label
                <input
                  aria-label="RPC Label"
                  disabled={busy || !primaryRpc}
                  onChange={(event) => onUpdatePrimaryRpc(activeChain.id, { label: event.target.value })}
                  value={primaryRpc?.label ?? ""}
                />
              </label>
              <label>
                RPC URL
                <input
                  aria-label="RPC URL"
                  disabled={busy || !primaryRpc}
                  onChange={(event) => onUpdatePrimaryRpc(activeChain.id, { url: event.target.value })}
                  value={primaryRpc?.url ?? ""}
                />
              </label>
            </div>
          ) : (
            <p>当前没有链配置。</p>
          )}
        </article>

        <PwaFeePanel activeChain={activeChain} busy={busy} onUpdateFeeDraft={onUpdateFeeDraft} />

        <article className="pwa-card pwa-card-warning">
          <h3>安全边界</h3>
          <p>RPC URL 会原样保存在浏览器 localStorage；请勿填写包含 API key、token 或其他 secret 的 RPC URL。</p>
          <p>Fee 草稿只在当前页面会话内保留，刷新或重新打开后恢复默认值；私钥、签名材料和交易历史都不写入这里。</p>
          <p>当前没有签名、广播、余额扫描、nonce 提交或真实交易历史写入入口。</p>
        </article>
      </div>
    </section>
  );
}
