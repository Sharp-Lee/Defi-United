import type { ChainRecord } from "../../core/chains/registry";

export interface SettingsViewProps {
  chains: ChainRecord[];
  selectedChainId: bigint;
  rpcUrl: string;
  statusMessage?: string | null;
  statusKind?: "idle" | "ok" | "error";
  busy?: boolean;
  onChainChange: (chainId: bigint) => void;
  onRpcUrlChange: (rpcUrl: string) => void;
  onValidateRpc: () => Promise<void> | void;
}

export function SettingsView({
  chains,
  selectedChainId,
  rpcUrl,
  statusMessage = null,
  statusKind = "idle",
  busy = false,
  onChainChange,
  onRpcUrlChange,
  onValidateRpc,
}: SettingsViewProps) {
  return (
    <section className="workspace-section settings-grid">
      <header className="section-header">
        <h2>Settings</h2>
        <button disabled={busy || rpcUrl.trim().length === 0} onClick={onValidateRpc} type="button">
          Validate RPC
        </button>
      </header>
      <label>
        Chain
        <select
          disabled={busy}
          onChange={(event) => onChainChange(BigInt(event.target.value))}
          value={selectedChainId.toString()}
        >
          {chains.map((chain) => (
            <option key={chain.id} value={chain.chainId.toString()}>
              {chain.name} ({chain.nativeSymbol})
            </option>
          ))}
        </select>
      </label>
      <label>
        RPC URL
        <input
          disabled={busy}
          onChange={(event) => onRpcUrlChange(event.target.value)}
          placeholder="https://..."
          value={rpcUrl}
        />
      </label>
      {statusMessage && (
        <div className={statusKind === "ok" ? "inline-success" : "inline-error"}>
          {statusMessage}
        </div>
      )}
    </section>
  );
}
