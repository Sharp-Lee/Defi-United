import type { ChainRecord } from "../../core/chains/registry";

export interface SettingsViewProps {
  chains: ChainRecord[];
}

export function SettingsView({ chains }: SettingsViewProps) {
  return (
    <section>
      <h2>Settings</h2>
      <ul>
        {chains.map((chain) => (
          <li key={chain.id}>
            {chain.name} · chainId {chain.chainId.toString()}
          </li>
        ))}
      </ul>
    </section>
  );
}
