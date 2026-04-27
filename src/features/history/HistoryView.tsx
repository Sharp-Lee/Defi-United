export interface HistoryItem {
  txHash: string;
  state: "pending" | "confirmed" | "failed" | "replaced" | "cancelled" | "dropped";
}

export function HistoryView({ items }: { items: HistoryItem[] }) {
  return (
    <section>
      <h2>History</h2>
      <ul>
        {items.map((item) => (
          <li key={item.txHash}>
            {item.txHash} · {item.state}
          </li>
        ))}
      </ul>
    </section>
  );
}
