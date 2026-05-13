import type { BrowserChainRecord, BrowserFeeDraft } from "../../core/browserChainConfig";
import { formatEstimatedNativeCost } from "../../shared/format/number";

export interface PwaFeePanelProps {
  activeChain: BrowserChainRecord | null;
  busy?: boolean;
  onUpdateFeeDraft(chainId: string, updates: Partial<BrowserFeeDraft>): void;
}

export function PwaFeePanel({ activeChain, busy = false, onUpdateFeeDraft }: PwaFeePanelProps) {
  if (!activeChain) {
    return (
      <article className="pwa-card">
        <h3>共享 Fee Panel</h3>
        <p>当前没有可用链配置。</p>
      </article>
    );
  }

  const { feeDraft } = activeChain;
  const estimatedCost = formatEstimatedNativeCost(feeDraft.gasLimit, feeDraft.maxFeePerGasGwei);

  return (
    <article className="pwa-card pwa-fee-panel" aria-labelledby="pwa-fee-panel-title">
      <div className="pwa-card-heading-row">
        <div>
          <h3 id="pwa-fee-panel-title">共享 Fee Panel</h3>
          <p>为后续发送类页面准备的当前页面 fee 草稿；刷新或重新打开后恢复默认值，当前只预览，不签名、不广播。</p>
        </div>
        <span className="pwa-status-badge">预览模式</span>
      </div>

      <div className="pwa-form-grid">
        <label>
          Fee 模式
          <select
            aria-label="Fee 模式"
            disabled={busy}
            onChange={(event) => onUpdateFeeDraft(activeChain.id, { mode: event.target.value as BrowserFeeDraft["mode"] })}
            value={feeDraft.mode}
          >
            <option value="eip1559">EIP-1559</option>
            <option value="legacy">Legacy Gas Price</option>
          </select>
        </label>
        <label>
          Gas Limit
          <input
            aria-label="Gas Limit"
            disabled={busy}
            inputMode="decimal"
            onChange={(event) => onUpdateFeeDraft(activeChain.id, { gasLimit: event.target.value })}
            value={feeDraft.gasLimit}
          />
        </label>
        {feeDraft.mode === "legacy" ? (
          <label>
            Gas Price (gwei)
            <input
              aria-label="Gas Price gwei"
              disabled={busy}
              inputMode="decimal"
              onChange={(event) => onUpdateFeeDraft(activeChain.id, { gasPriceGwei: event.target.value })}
              value={feeDraft.gasPriceGwei}
            />
          </label>
        ) : (
          <>
            <label>
              Max Fee (gwei)
              <input
                aria-label="Max Fee gwei"
                disabled={busy}
                inputMode="decimal"
                onChange={(event) => onUpdateFeeDraft(activeChain.id, { maxFeePerGasGwei: event.target.value })}
                value={feeDraft.maxFeePerGasGwei}
              />
            </label>
            <label>
              Priority Fee (gwei)
              <input
                aria-label="Priority Fee gwei"
                disabled={busy}
                inputMode="decimal"
                onChange={(event) => onUpdateFeeDraft(activeChain.id, { maxPriorityFeePerGasGwei: event.target.value })}
                value={feeDraft.maxPriorityFeePerGasGwei}
              />
            </label>
            <label>
              Base Fee Multiplier
              <input
                aria-label="Base Fee Multiplier"
                disabled={busy}
                inputMode="decimal"
                onChange={(event) => onUpdateFeeDraft(activeChain.id, { baseFeeMultiplier: event.target.value })}
                value={feeDraft.baseFeeMultiplier}
              />
            </label>
          </>
        )}
      </div>

      <div className="pwa-fee-summary">
        <div>
          <span>活跃链</span>
          <strong>{activeChain.name}</strong>
        </div>
        <div>
          <span>估算上限</span>
          <strong>
            {estimatedCost} {activeChain.nativeCurrencySymbol}
          </strong>
        </div>
        <div>
          <span>状态</span>
          <strong>页面草稿，不提交交易</strong>
        </div>
      </div>
    </article>
  );
}
