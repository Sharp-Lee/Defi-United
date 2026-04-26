import { useApp } from "../state/store";
import { fmtEth } from "../wallet/gas";

export function ActivityLog() {
  const { state, dispatch } = useApp();
  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Activity Log ({state.txLog.length})</h2>
        <button className="secondary" onClick={() => dispatch({ type: "CLEAR_LOG" })}>
          清空
        </button>
      </div>
      <div style={{ marginTop: 12, maxHeight: 320, overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 80 }}>类型</th>
              <th style={{ width: 70 }}>状态</th>
              <th>From → To</th>
              <th style={{ width: 130 }}>Value</th>
              <th style={{ width: 150 }}>Tx Hash</th>
            </tr>
          </thead>
          <tbody>
            {state.txLog.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--muted)", padding: 12, textAlign: "center" }}>
                  无记录
                </td>
              </tr>
            )}
            {state.txLog.map((t) => (
              <tr key={t.id}>
                <td>
                  <span className="tag">{t.kind}</span>
                </td>
                <td>
                  <span
                    className={`tag ${
                      t.status === "mined" ? "ok" : t.status === "failed" ? "bad" : "warn"
                    }`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {short(t.from)} → {short(t.to)}
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {fmtEth(t.valueWei)}
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {t.hash ? (
                    <a
                      href={`https://etherscan.io/tx/${t.hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t.hash.slice(0, 10)}…
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function short(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
