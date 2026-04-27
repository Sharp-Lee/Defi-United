import { useEffect, useState } from "react";
import { Mnemonic } from "ethers";

interface UnlockViewProps {
  onUnlock: (password: string) => Promise<void>;
  onCreateVault: (mnemonic: string, password: string) => Promise<void>;
  onGenerateMnemonic?: () => Promise<string>;
}

function isValidMnemonic(value: string) {
  try {
    Mnemonic.fromPhrase(value.trim());
    return true;
  } catch {
    return false;
  }
}

const fallbackMnemonic = "test test test test test test test test test test test junk";

export function UnlockView({
  onUnlock,
  onCreateVault,
  onGenerateMnemonic = async () => fallbackMnemonic,
}: UnlockViewProps) {
  const [mode, setMode] = useState<"unlock" | "create">("unlock");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerateMnemonic() {
    setError(null);
    setBusy(true);
    try {
      setMnemonic(await onGenerateMnemonic());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (mode === "create" && mnemonic.length === 0) void regenerateMnemonic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mnemonic.length]);

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
    const phrase = mnemonic.trim();
    if (!isValidMnemonic(phrase)) {
      setError("Mnemonic is invalid.");
      return;
    }
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
      await onCreateVault(phrase, password);
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

        {mode === "create" && (
          <label>
            Mnemonic
            <textarea
              onChange={(event) => setMnemonic(event.target.value)}
              rows={3}
              value={mnemonic}
            />
          </label>
        )}

        {mode === "create" && (
          <button className="secondary-button" onClick={() => void regenerateMnemonic()} type="button">
            Regenerate
          </button>
        )}

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
