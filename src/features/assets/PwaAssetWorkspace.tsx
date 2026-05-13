import { useState, type FormEvent } from "react";
import { formatUnits } from "ethers";
import type { BrowserChainRecord, BrowserRpcEndpoint } from "../../core/chains";
import type {
  BrowserAssetRegistryState,
  BrowserWatchedErc20AssetInput,
} from "../../core/assets/browserAssetRegistry";
import { getEnabledWatchedErc20AssetsForChain } from "../../core/assets/browserAssetRegistry";
import type {
  AssetBalanceAccount,
  AssetBalanceSnapshotState,
  AssetRefreshStatus,
} from "../../core/assets/balanceSnapshots";
import { sanitizeRpcErrorMessage } from "../../services/rpc/browserJsonRpcClient";

export interface PwaAssetWorkspaceProps {
  activeChain: BrowserChainRecord | null;
  primaryRpc: BrowserRpcEndpoint | null;
  assetRegistry: BrowserAssetRegistryState;
  refreshState: AssetBalanceSnapshotState;
  selectedAccounts: AssetBalanceAccount[];
  totalAccountCount: number;
  unlocked: boolean;
  busy?: boolean;
  error?: string | null;
  onAddWatchedAsset(input: BrowserWatchedErc20AssetInput): void;
  onRemoveWatchedAsset(assetId: string): void;
  onRefreshBalances(): void;
}

const STATUS_LABELS: Record<AssetRefreshStatus, string> = {
  idle: "未刷新",
  "validating-chain": "校验链",
  refreshing: "刷新中",
  success: "已刷新",
  partial: "部分失败",
  failed: "刷新失败",
  "chain-mismatch": "链不匹配",
  "no-rpc": "无 RPC",
  "no-selected-accounts": "未选择账户",
};

function formatTokenAmount(value: string, decimals: number) {
  const formatted = formatUnits(value, decimals);
  if (!formatted.includes(".")) return `${formatted}.0`;
  return formatted.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0*$/, ".0");
}

function accountName(account: AssetBalanceAccount) {
  return account.label?.trim() || account.address;
}

function chainMismatchCopy(refreshState: AssetBalanceSnapshotState) {
  const { expectedChainId, actualChainId } = refreshState.chainValidation;
  if (expectedChainId === null || actualChainId === null) return null;
  return `Chain ID 不匹配：期望 ${expectedChainId}，实际 ${actualChainId}`;
}

function failureKey(failure: AssetBalanceSnapshotState["failures"][number]) {
  return [
    failure.kind,
    failure.accountId ?? "no-account-id",
    failure.accountAddress ?? "no-account-address",
    failure.assetId ?? "native",
    failure.tokenAddress ?? "no-token-address",
    sanitizeRpcErrorMessage(failure.message),
  ].join(":");
}

function failureAccountCopy(failure: AssetBalanceSnapshotState["failures"][number]) {
  return failure.accountAddress ? `账户 ${failure.accountAddress}` : null;
}

function failureTokenCopy(
  failure: AssetBalanceSnapshotState["failures"][number],
  watchedAssets: ReturnType<typeof getEnabledWatchedErc20AssetsForChain>,
) {
  if (!failure.tokenAddress) return null;
  const asset = watchedAssets.find((item) => item.id === failure.assetId || item.contractAddress === failure.tokenAddress);
  return asset?.symbol ? `Token ${failure.tokenAddress} (${asset.symbol})` : `Token ${failure.tokenAddress}`;
}

export function PwaAssetWorkspace({
  activeChain,
  primaryRpc,
  assetRegistry,
  refreshState,
  selectedAccounts,
  totalAccountCount,
  unlocked,
  busy = false,
  error = null,
  onAddWatchedAsset,
  onRemoveWatchedAsset,
  onRefreshBalances,
}: PwaAssetWorkspaceProps) {
  const [contractAddress, setContractAddress] = useState("");
  const [symbol, setSymbol] = useState("");
  const [decimals, setDecimals] = useState(18);
  const [label, setLabel] = useState("");
  const selectedAccountCount = selectedAccounts.length;
  const watchedAssets = activeChain
    ? getEnabledWatchedErc20AssetsForChain(assetRegistry, activeChain.chainId)
    : [];
  const refreshDisabled = !unlocked || !activeChain || !primaryRpc || selectedAccountCount === 0 || busy;
  const mismatchCopy = refreshState.status === "chain-mismatch" ? chainMismatchCopy(refreshState) : null;

  function handleAddWatchedAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChain) return;
    onAddWatchedAsset({
      chainId: activeChain.chainId,
      contractAddress,
      symbol,
      decimals,
      label,
    });
  }

  return (
    <section className="assets-section" aria-labelledby="asset-workspace-title">
      <header className="section-header">
        <div>
          <h2 id="asset-workspace-title">资产</h2>
          <p className="section-subtitle">只读刷新当前选中本地账户的原生资产与关注 ERC-20 余额。</p>
        </div>
        <button disabled={refreshDisabled} onClick={onRefreshBalances} type="button">
          刷新余额
        </button>
      </header>

      <div className="pwa-card asset-status-strip">
        <span className="status-badge">{STATUS_LABELS[refreshState.status]}</span>
        <span className="status-badge">账户 {selectedAccountCount} / {totalAccountCount}</span>
        <span className="status-badge">链 {activeChain ? `${activeChain.name} (${activeChain.chainId})` : "未选择"}</span>
        <span className="status-badge">RPC {primaryRpc?.label ?? "未配置"}</span>
        {refreshState.stale && <span className="status-badge status-badge-warning">旧快照</span>}
      </div>

      {!unlocked && <p className="notice-panel notice-panel-warning">解锁 vault 后才能刷新本地账户余额</p>}
      {unlocked && selectedAccountCount === 0 && (
        <p className="notice-panel notice-panel-warning">请选择至少一个本地账户后再刷新余额。</p>
      )}
      {mismatchCopy && <p className="notice-panel notice-panel-warning">{mismatchCopy}</p>}
      {error && <p className="notice-panel notice-panel-warning">{sanitizeRpcErrorMessage(error)}</p>}

      <div className="pwa-card">
        <div className="pwa-card-heading-row">
          <div>
            <h3>关注资产</h3>
            <p className="pwa-muted-note">按当前链过滤，只保存上层传入的资产清单。</p>
          </div>
        </div>

        <form className="asset-watchlist-form" onSubmit={handleAddWatchedAsset}>
          <label>
            合约地址
            <input
              aria-label="合约地址"
              onChange={(event) => setContractAddress(event.target.value)}
              placeholder="0x..."
              value={contractAddress}
            />
          </label>
          <label>
            符号
            <input aria-label="符号" onChange={(event) => setSymbol(event.target.value)} value={symbol} />
          </label>
          <label>
            精度
            <input
              aria-label="精度"
              max={36}
              min={0}
              onChange={(event) => setDecimals(Math.max(0, Math.min(36, Math.trunc(event.target.valueAsNumber || 0))))}
              type="number"
              value={decimals}
            />
          </label>
          <label>
            标签
            <input aria-label="标签" onChange={(event) => setLabel(event.target.value)} value={label} />
          </label>
          <button disabled={!activeChain || busy} type="submit">
            添加资产
          </button>
        </form>

        <div className="asset-table-wrap">
          <table>
            <thead>
              <tr>
                <th>资产</th>
                <th>合约</th>
                <th>精度</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {watchedAssets.map((asset) => (
                <tr key={asset.id}>
                  <td>
                    <strong>{asset.symbol}</strong>
                    <div>{asset.label}</div>
                  </td>
                  <td className="mono">{asset.contractAddress}</td>
                  <td>{asset.decimals}</td>
                  <td>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => onRemoveWatchedAsset(asset.id)}
                      type="button"
                    >
                      移除 {asset.symbol}
                    </button>
                  </td>
                </tr>
              ))}
              {watchedAssets.length === 0 && (
                <tr>
                  <td colSpan={4}>当前链还没有关注 ERC-20 资产。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="asset-summary-strip">
        <span className="status-badge">原生余额 {refreshState.nativeBalances.length}</span>
        <span className="status-badge">ERC-20 余额 {refreshState.erc20Balances.length}</span>
        <span className="status-badge">失败 {refreshState.failures.length}</span>
      </div>

      <div className="asset-table-grid">
        <article className="pwa-card">
          <h3>原生余额</h3>
          <div className="asset-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>账户</th>
                  <th>余额</th>
                  <th>区块</th>
                </tr>
              </thead>
              <tbody>
                {refreshState.nativeBalances.map((snapshot) => (
                  <tr key={`${snapshot.chainId}:${snapshot.accountAddress}`}>
                    <td>
                      <strong>{snapshot.accountLabel}</strong>
                      <div className="mono">{snapshot.accountAddress}</div>
                    </td>
                    <td>
                      {formatTokenAmount(snapshot.balanceWei, 18)} {activeChain?.nativeCurrencySymbol ?? "ETH"}
                    </td>
                    <td>{snapshot.blockNumber ?? "-"}</td>
                  </tr>
                ))}
                {refreshState.nativeBalances.length === 0 && (
                  <tr>
                    <td colSpan={3}>还没有原生余额快照。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="pwa-card">
          <h3>ERC-20 余额</h3>
          <div className="asset-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>账户</th>
                  <th>资产</th>
                  <th>余额</th>
                  <th>区块</th>
                </tr>
              </thead>
              <tbody>
                {refreshState.erc20Balances.map((snapshot) => (
                  <tr key={`${snapshot.chainId}:${snapshot.tokenAddress}:${snapshot.accountAddress}`}>
                    <td>
                      <strong>{snapshot.accountLabel}</strong>
                      <div className="mono">{snapshot.accountAddress}</div>
                    </td>
                    <td>
                      <strong>{snapshot.tokenSymbol}</strong>
                      <div className="mono">{snapshot.tokenAddress}</div>
                    </td>
                    <td>
                      {formatTokenAmount(snapshot.balanceRaw, snapshot.tokenDecimals)} {snapshot.tokenSymbol}
                    </td>
                    <td>{snapshot.blockNumber ?? "-"}</td>
                  </tr>
                ))}
                {refreshState.erc20Balances.length === 0 && (
                  <tr>
                    <td colSpan={4}>还没有 ERC-20 余额快照。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      {selectedAccounts.length > 0 && (
        <div className="pwa-card">
          <h3>本次账户</h3>
          <div className="asset-summary-strip">
            {selectedAccounts.map((account) => (
              <span className="status-badge" key={account.id}>
                {accountName(account)}
              </span>
            ))}
          </div>
        </div>
      )}

      {refreshState.failures.length > 0 && (
        <div className="pwa-card">
          <h3>失败详情</h3>
          <ul className="asset-failure-list">
            {refreshState.failures.map((failure) => (
              <li key={failureKey(failure)}>
                {failureAccountCopy(failure) && <div>{failureAccountCopy(failure)}</div>}
                {failureTokenCopy(failure, watchedAssets) && <div>{failureTokenCopy(failure, watchedAssets)}</div>}
                <div>{sanitizeRpcErrorMessage(failure.message)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
