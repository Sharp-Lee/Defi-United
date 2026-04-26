import { useEffect } from "react";
import { useApp } from "../state/store";
import { fmtEth } from "../wallet/gas";

export function RootPanel() {
  const { state, dispatch, getProvider } = useApp();
  const root = state.rootAddress;

  async function refresh() {
    if (!root) return;
    const p = getProvider();
    if (!p) return;
    try {
      const bal = await p.getBalance(root);
      dispatch({ type: "SET_ROOT_BALANCE", balanceWei: bal });
    } catch {
      dispatch({ type: "SET_ROOT_BALANCE", balanceWei: null });
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, state.network?.blockNumber]);

  if (!root) return null;

  return (
    <div className="panel">
      <h2>Root 账户 (m/44'/60'/0'/0/0)</h2>
      <div className="kvs">
        <div>地址</div>
        <div className="mono">
          {root}{" "}
          <button
            className="secondary"
            style={{ padding: "2px 8px", fontSize: 11, marginLeft: 4 }}
            onClick={() => navigator.clipboard.writeText(root)}
          >
            复制
          </button>{" "}
          <a
            href={`https://etherscan.io/address/${root}`}
            target="_blank"
            rel="noreferrer"
          >
            Etherscan ↗
          </a>
        </div>
        <div>余额</div>
        <div className="mono">
          {state.rootBalanceWei === null ? "—" : `${fmtEth(state.rootBalanceWei)} ETH`}{" "}
          <button
            className="secondary"
            style={{ padding: "2px 8px", fontSize: 11, marginLeft: 4 }}
            onClick={() => void refresh()}
          >
            刷新
          </button>
        </div>
      </div>
    </div>
  );
}
