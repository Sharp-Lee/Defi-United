import { useState } from "react";

interface UnlockViewProps {
  onUnlock: (password: string) => Promise<void>;
  onCreateVault: (password: string) => Promise<void>;
}

export function UnlockView({
  onUnlock,
  onCreateVault,
}: UnlockViewProps) {
  const [mode, setMode] = useState<"unlock" | "create">("unlock");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitUnlock() {
    setError(null);
    setBusy(true);
    try {
      await onUnlock(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate() {
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await onCreateVault(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="locked-panel">
      <div className="auth-card">
        <div className="segmented" role="tablist">
          <button
            aria-selected={mode === "unlock"}
            className={mode === "unlock" ? "active" : ""}
            onClick={() => setMode("unlock")}
            role="tab"
            type="button"
          >
            Unlock
          </button>
          <button
            aria-selected={mode === "create"}
            className={mode === "create" ? "active" : ""}
            onClick={() => setMode("create")}
            role="tab"
            type="button"
          >
            Create
          </button>
        </div>

        <label>
          Vault password
          <input
            aria-label="Vault password"
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && mode === "unlock") void submitUnlock();
            }}
            type="password"
            value={password}
          />
        </label>

        {mode === "create" && (
          <label>
            Confirm password
            <input
              aria-label="Confirm password"
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              value={confirmPassword}
            />
          </label>
        )}

        {error && <div className="inline-error">{error}</div>}

        {mode === "unlock" ? (
          <button
            className="unlock-button"
            disabled={busy || password.length === 0}
            onClick={() => void submitUnlock()}
            type="button"
          >
            Unlock Vault
          </button>
        ) : (
          <button
            className="unlock-button"
            disabled={busy || password.length === 0}
            onClick={() => void submitCreate()}
            type="button"
          >
            Create Vault
          </button>
        )}
      </div>
    </main>
  );
}
