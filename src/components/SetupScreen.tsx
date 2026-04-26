import { useState } from "react";
import { generateMnemonic, isValidMnemonic, deriveRoot } from "../wallet/hd";
import { encryptVault } from "../state/crypto";
import { saveVault } from "../state/vault";
import { useApp } from "../state/store";
import { DEFAULTS } from "../types";

export function SetupScreen() {
  const { dispatch } = useApp();
  const [mode, setMode] = useState<"generate" | "import">("generate");
  const [mnemonic, setMnemonic] = useState<string>(() => generateMnemonic());
  const [importPhrase, setImportPhrase] = useState("");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [rpc, setRpc] = useState("");
  const [acked, setAcked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phrase = mode === "generate" ? mnemonic : importPhrase.trim();

  async function onConfirm() {
    setError(null);
    try {
      if (!isValidMnemonic(phrase)) {
        setError("助记词无效");
        return;
      }
      if (pwd.length < 8) {
        setError("密码至少 8 位");
        return;
      }
      if (pwd !== pwd2) {
        setError("两次密码不一致");
        return;
      }
      if (!acked) {
        setError("必须确认已离线备份助记词");
        return;
      }
      const plaintext = {
        mnemonic: phrase,
        nextChildIndex: 1,
        rpcUrl: rpc.trim(),
        donationTarget: DEFAULTS.donationTarget,
        disperseAddress: DEFAULTS.disperseAddress,
      };
      const encrypted = await encryptVault(plaintext, pwd);
      saveVault(encrypted);
      const root = deriveRoot(plaintext.mnemonic);
      dispatch({
        type: "UNLOCKED",
        vault: plaintext,
        password: pwd,
        rootAddress: root.address,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="panel">
      <h2>初始化</h2>
      <div className="banner warn">
        助记词只保存在本浏览器，加密后存 localStorage。<strong>请离线备份</strong>，丢失无法找回。
      </div>

      <div className="tabs">
        <button
          className={`tab ${mode === "generate" ? "active" : ""}`}
          onClick={() => setMode("generate")}
        >
          生成新助记词
        </button>
        <button
          className={`tab ${mode === "import" ? "active" : ""}`}
          onClick={() => setMode("import")}
        >
          导入已有助记词
        </button>
      </div>

      {mode === "generate" ? (
        <div>
          <label>助记词（12 词）</label>
          <div className="mnemonic-display">{mnemonic}</div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button className="secondary" onClick={() => setMnemonic(generateMnemonic())}>
              重新生成
            </button>
            <button
              className="secondary"
              onClick={() => navigator.clipboard.writeText(mnemonic)}
            >
              复制
            </button>
          </div>
        </div>
      ) : (
        <div>
          <label>助记词（用空格分隔的 12 / 24 词）</label>
          <textarea
            rows={3}
            value={importPhrase}
            onChange={(e) => setImportPhrase(e.target.value)}
            placeholder="word1 word2 word3 ..."
          />
        </div>
      )}

      <div style={{ marginTop: 16 }} className="col">
        <div>
          <label>设置加密密码（≥8 位，每次解锁要用）</label>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
        </div>
        <div>
          <label>再次输入密码</label>
          <input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
        </div>
        <div>
          <label>主网 RPC URL（可稍后在 Settings 里改）</label>
          <input
            type="text"
            value={rpc}
            onChange={(e) => setRpc(e.target.value)}
            placeholder="https://eth-mainnet.g.alchemy.com/v2/<key>"
          />
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={acked}
            onChange={(e) => setAcked(e.target.checked)}
          />
          我已离线备份助记词，理解丢失不可找回
        </label>
        {error && <div className="banner bad">{error}</div>}
        <button onClick={onConfirm}>完成初始化</button>
      </div>
    </div>
  );
}
