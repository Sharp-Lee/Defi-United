import type { TransferDraft } from "../../core/transactions/draft";

export interface TransferViewProps {
  draft: TransferDraft | null;
}

export function TransferView({ draft }: TransferViewProps) {
  return (
    <section>
      <h2>Transfer</h2>
      {draft?.feeRisk === "high" && (
        <div role="alert">
          Gas settings are far above the live network reference. Review total cost before signing.
        </div>
      )}
    </section>
  );
}
