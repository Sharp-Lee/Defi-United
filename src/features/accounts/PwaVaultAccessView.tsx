import { useEffect, useState } from "react";

export interface PwaVaultAccessViewProps {
  hasVault: boolean;
  busy?: boolean;
  error?: string | null;
  onCreateVault(password: string): Promise<void> | void;
  onUnlock(password: string): Promise<void> | void;
  onImportVault(input: { password: string; serializedEnvelope: string; overwriteExisting: boolean }): Promise<void> | void;
}

export function PwaVaultAccessView({
  hasVault,
  busy = false,
  error = null,
  onCreateVault,
  onUnlock,
  onImportVault,
}: PwaVaultAccessViewProps) {
  const [mode, setMode] = useState<"unlock" | "create">(hasVault ? "unlock" : "create");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [confirmImportOverwrite, setConfirmImportOverwrite] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (hasVault) {
      setMode("unlock");
    }
  }, [hasVault]);

  async function submitUnlock() {
    setImportError(null);
    try {
      await onUnlock(password);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitCreate() {
    setImportError(null);
    if (password.length < 8) {
      setImportError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setImportError("Passwords do not match.");
      return;
    }
    try {
      await onCreateVault(password);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleImportFile(file: File | null) {
    setImportError(null);
    if (!file) return;
    if (importPassword.length === 0) {
      setImportError("Import password is required to verify the encrypted vault before saving.");
      return;
    }
    if (hasVault && !confirmImportOverwrite) {
      setImportError("Existing vault overwrite must be confirmed before import.");
      return;
    }
    try {
      await onImportVault({
        password: importPassword,
        serializedEnvelope: await file.text(),
        overwriteExisting: hasVault && confirmImportOverwrite,
      });
      setImportPassword("");
      setConfirmImportOverwrite(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="pwa-vault-access">
      <header className="section-header">
        <div>
          <h2>账户</h2>
          <p className="section-subtitle">浏览器本地加密 vault、当前标签页热会话和账户组入口。</p>
        </div>
      </header>
      <div className="pwa-vault-access-grid">
        <article className="pwa-card">
          <div className="segmented pwa-vault-access-tabs" role="tablist">
            <button
              aria-selected={mode === "unlock"}
              className={mode === "unlock" ? "active" : ""}
              onClick={() => setMode("unlock")}
              role="tab"
              type="button"
            >
              解锁
            </button>
            <button
              aria-selected={mode === "create"}
              className={mode === "create" ? "active" : ""}
              onClick={() => setMode("create")}
              role="tab"
              type="button"
            >
              创建
            </button>
          </div>

          <p>密码只在本地会话里用于解锁或创建加密 vault，不会写入持久化存储。</p>
          {(error || importError) && <div className="inline-error">{error ?? importError}</div>}

          <label>
            Vault 密码
            <input
              aria-label="Vault 密码"
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>

          {mode === "create" && (
            <label>
              确认密码
              <input
                aria-label="确认密码"
                disabled={busy}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
                value={confirmPassword}
              />
            </label>
          )}

          <div className="button-row">
            {mode === "unlock" ? (
              <button disabled={busy || password.length === 0} onClick={() => void submitUnlock()} type="button">
                解锁 vault
              </button>
            ) : (
              <button disabled={busy || password.length === 0} onClick={() => void submitCreate()} type="button">
                创建 vault
              </button>
            )}
          </div>
        </article>

        <article className="pwa-card">
          <h3>导入加密 vault</h3>
          <p>导入前会先用导入密码解密验证 vault 文件；验证失败不会覆盖浏览器里已有的 vault。</p>
          <label>
            导入 vault 密码
            <input
              aria-label="导入 vault 密码"
              disabled={busy}
              onChange={(event) => setImportPassword(event.target.value)}
              type="password"
              value={importPassword}
            />
          </label>
          {hasVault && (
            <label className="pwa-checkbox-row">
              <input
                aria-label="确认覆盖已有 vault"
                checked={confirmImportOverwrite}
                disabled={busy}
                onChange={(event) => setConfirmImportOverwrite(event.target.checked)}
                type="checkbox"
              />
              <span>我确认导入成功后覆盖当前浏览器里的已有 vault。</span>
            </label>
          )}
          <label className="secondary-button pwa-file-button" htmlFor="pwa-vault-import">
            选择并验证 vault 文件
            <input
              accept="application/json,.json"
              aria-label="导入加密 vault"
              disabled={busy || importPassword.length === 0 || (hasVault && !confirmImportOverwrite)}
              id="pwa-vault-import"
              onChange={(event) => void handleImportFile(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
        </article>

        <article className="pwa-card pwa-card-warning">
          <h3>安全边界</h3>
          <p>当前标签页关闭、刷新或手动锁定后，解密后的 vault 只保留在内存中的会话状态里。</p>
          <p>本阶段不展示明文助记词，不提供签名、广播或 RPC 提交。</p>
          <p>导入/导出仅限加密 vault envelope，不包含明文 seed、private key 或 password。</p>
        </article>
      </div>
    </section>
  );
}
