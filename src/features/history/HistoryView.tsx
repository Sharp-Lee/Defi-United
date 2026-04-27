import type { HistoryRecord, PendingMutationRequest } from "../../lib/tauri";

function short(value: string) {
  return value.length > 14 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value;
}

function bumpWei(value: string) {
  const wei = BigInt(value);
  return ((wei * 125n) / 100n + 1n).toString();
}

function pendingRequestFromRecord(record: HistoryRecord): PendingMutationRequest {
  return {
    txHash: record.submission.tx_hash,
    rpcUrl: record.intent.rpc_url,
    accountIndex: record.intent.account_index,
    chainId: record.intent.chain_id,
    from: record.intent.from,
    nonce: record.intent.nonce,
    gasLimit: record.intent.gas_limit,
    maxFeePerGas: bumpWei(record.intent.max_fee_per_gas),
    maxPriorityFeePerGas: bumpWei(record.intent.max_priority_fee_per_gas),
    to: record.intent.to,
    valueWei: record.intent.value_wei,
  };
}

export function HistoryView({
  items,
  onRefresh,
  onReplace,
  onCancelPending,
  disabled = false,
}: {
  items: HistoryRecord[];
  onRefresh: () => Promise<void> | void;
  onReplace?: (request: PendingMutationRequest) => Promise<void> | void;
  onCancelPending?: (request: PendingMutationRequest) => Promise<void> | void;
  disabled?: boolean;
}) {
  return (
    <section className="workspace-section">
      <header className="section-header">
        <h2>History</h2>
        <button className="secondary-button" disabled={disabled} onClick={onRefresh} type="button">
          Refresh
        </button>
      </header>
      <div className="data-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Hash</th>
              <th>From</th>
              <th>To</th>
              <th>Value</th>
              <th>Nonce</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7}>No local transaction history.</td>
              </tr>
            )}
            {items.map((item) => {
              const isPending = item.outcome.state === "Pending";
              return (
                <tr key={`${item.outcome.tx_hash}-${item.intent.nonce}`}>
                  <td>{item.outcome.state}</td>
                  <td className="mono">{short(item.outcome.tx_hash)}</td>
                  <td className="mono">{short(item.intent.from)}</td>
                  <td className="mono">{short(item.intent.to)}</td>
                  <td className="mono">{item.intent.value_wei} wei</td>
                  <td className="mono">{item.intent.nonce}</td>
                  <td>
                    {isPending && (
                      <div className="button-row">
                        <button
                          className="secondary-button"
                          disabled={disabled}
                          onClick={() => onReplace?.(pendingRequestFromRecord(item))}
                          type="button"
                        >
                          Replace
                        </button>
                        <button
                          className="secondary-button"
                          disabled={disabled}
                          onClick={() => onCancelPending?.(pendingRequestFromRecord(item))}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
