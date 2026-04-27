import { useState } from "react";

export function UnlockView({ onUnlock }: { onUnlock: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");

  return (
    <main className="locked-panel">
      <input
        aria-label="Vault password"
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        value={password}
      />
      <button className="unlock-button" onClick={() => void onUnlock(password)} type="button">
        Unlock Vault
      </button>
    </main>
  );
}
