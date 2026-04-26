import { useState } from "react";
import { useApp } from "../state/store";
import { encryptVault } from "../state/crypto";
import { saveVault } from "../state/vault";
import { fmtGwei } from "../wallet/gas";
import { getFees } from "../wallet/gas";
import { useEffect } from "react";
import { isAddress } from "ethers";

export function SettingsPanel() {
  const { state, dispatch, getProvider } = useApp();
  const v = state.vault!;
  const [rpc, setRpc] = useState(v.rpcUrl);
  const [target, setTarget] = useState(v.donationTarget);
  const [disperseAddr, setDisperseAddr] = useState(v.disperseAddress);
  const [gasGwei, setGasGwei] = useState<string>("—");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = getProvider();
    if (!p) return;
    let cancelled = false;
    getFees(p)
      .then((f) => {
        if (!cancelled) setGasGwei(fmtGwei(f.maxFeePerGas));
      })
      .catch(() => {
        if (!cancelled) setGasGwei("—");
      });
    return () => {
      cancelled = true;
    };
  }, [getProvider, state.network?.blockNumber]);

  async function save() {
    setError(null);
    if (rpc.trim() === "") {
      setError("RPC URL 必填");
      return;
    }
    if (!isAddress(target)) {
      setError("目标捐款地址无效");
      return;
    }
    if (!isAddress(disperseAddr)) {
      setError("Disperse 合约地址无效");
      return;
    }
    const next = {
      ...v,
      rpcUrl: rpc.trim(),
      donationTarget: target.trim(),
      disperseAddress: disperseAddr.trim(),
    };
    if (state.password) {
      const enc = await encryptVault(next, state.password);
      saveVault(enc);
    }
    dispatch({ type: "VAULT_UPDATE", vault: next });
  }

  const chainOk = state.network?.chainId === 1n;

  return (
    <div className="panel">
      <h2>Settings</h2>
      <div className="col">
        <div>
          <label>主网 RPC URL</label>
          <input value={rpc} onChange={(e) => setRpc(e.target.value)} />
        </div>
        <div>
          <label>目标捐款地址</label>
          <input value={target} onChange={(e) => setTarget(e.target.value)} className="mono" />
        </div>
        <div>
          <label>Disperse 合约地址</label>
          <input
            value={disperseAddr}
            onChange={(e) => setDisperseAddr(e.target.value)}
            className="mono"
          />
        </div>
        {error && <div className="banner bad">{error}</div>}
        <div>
          <button onClick={save}>保存</button>
        </div>
      </div>

      <div style={{ marginTop: 16 }} className="kvs">
        <div>网络</div>
        <div>
          {state.networkError ? (
            <span className="tag bad">{state.networkError}</span>
          ) : state.network ? (
            <>
              <span className={`tag ${chainOk ? "ok" : "bad"}`}>
                chainId {state.network.chainId.toString()}
              </span>{" "}
              <span className="mono" style={{ color: "var(--muted)" }}>
                #{state.network.blockNumber}
              </span>
            </>
          ) : (
            <span className="tag warn">未连接</span>
          )}
        </div>
        <div>Gas</div>
        <div className="mono">{gasGwei} gwei (maxFee)</div>
        <div>Disperse</div>
        <div>
          {state.contractStatus === null ? (
            <span className="tag warn">未检测</span>
          ) : !state.contractStatus.exists ? (
            <span className="tag bad">合约不存在</span>
          ) : state.contractStatus.selectorMatches ? (
            <span className="tag ok">disperseEther selector 匹配</span>
          ) : (
            <span className="tag warn">selector 不匹配（可能 ABI 不同）</span>
          )}
        </div>
      </div>

      {!chainOk && state.network && (
        <div className="banner bad" style={{ marginTop: 12 }}>
          当前 chainId 不是 1（主网），所有广播按钮已禁用。请切换 RPC。
        </div>
      )}
    </div>
  );
}
