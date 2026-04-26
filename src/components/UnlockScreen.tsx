import { useState } from "react";
import { useApp } from "../state/store";
import { decryptVault } from "../state/crypto";
import { clearVault, loadVault } from "../state/vault";
import { deriveRoot } from "../wallet/hd";

export function UnlockScreen() {
  const { dispatch } = useApp();
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onUnlock() {
    setError(null);
    setBusy(true);
    try {
      const enc = loadVault();
      if (!enc) {
        dispatch({ type: "SET_PHASE", phase: "setup" });
        return;
      }
      const vault = await decryptVault(enc, pwd);
      const root = deriveRoot(vault.mnemonic);
      dispatch({
        type: "UNLOCKED",
        vault,
        password: pwd,
        rootAddress: root.address,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onReset() {
    if (
      confirm(
        "这会删除本地加密包。如果你没备份助记词，资金将永久丢失。继续？",
      )
    ) {
      clearVault();
      dispatch({ type: "SET_PHASE", phase: "setup" });
    }
  }

  return (
    <div className="panel">
      <h2>解锁</h2>
      <p>本地已存在加密助记词，输入密码解锁。</p>
      <div className="col">
        <div>
          <label>密码</label>
          <input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onUnlock();
            }}
            autoFocus
          />
        </div>
        {error && <div className="banner bad">{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onUnlock} disabled={busy || !pwd}>
            {busy ? "解锁中…" : "解锁"}
          </button>
          <button className="secondary danger" onClick={onReset}>
            清空加密包并重新初始化
          </button>
        </div>
      </div>
    </div>
  );
}
