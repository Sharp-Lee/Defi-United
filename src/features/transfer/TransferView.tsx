import type { TransferDraft } from "../../core/transactions/draft";
import type { PendingMutationRequest } from "../../lib/tauri";

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

export interface PendingActionProps {
  pendingRequest?: PendingMutationRequest;
  onReplace?: (request: PendingMutationRequest) => void;
  onCancelPending?: (request: PendingMutationRequest) => void;
}

export function PendingActions({
  pendingRequest,
  onReplace,
  onCancelPending,
}: PendingActionProps) {
  if (!pendingRequest) return null;
  return (
    <div>
      <button type="button" onClick={() => onReplace?.(pendingRequest)}>
        Replace Pending
      </button>
      <button type="button" onClick={() => onCancelPending?.(pendingRequest)}>
        Cancel Pending
      </button>
    </div>
  );
}
