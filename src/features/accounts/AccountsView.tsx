import type { AccountRecord } from "../../lib/tauri";
import type { AccountChainState } from "../../lib/rpc";

export interface AccountsViewProps {
  accounts: Array<AccountRecord & AccountChainState>;
  onAddAccount: () => void;
}

export function AccountsView({ accounts, onAddAccount }: AccountsViewProps) {
  return (
    <section>
      <header>
        <h2>Accounts</h2>
        <button onClick={onAddAccount} type="button">
          Add Account
        </button>
      </header>
      <ul>
        {accounts.map((account) => (
          <li key={account.index}>
            <strong>{account.label}</strong>
            <span>{account.address}</span>
            <span>{account.nativeBalanceWei.toString()} wei</span>
            <span>nonce {account.nonce}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
