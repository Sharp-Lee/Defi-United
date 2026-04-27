export type HistoryState =
  | "pending"
  | "confirmed"
  | "failed"
  | "replaced"
  | "cancelled"
  | "dropped";

export interface NonceReservation {
  key: string;
  reservedNonce: number | null;
  historyState: HistoryState;
}

export function releaseNonceReservation(
  reservation: NonceReservation,
  nextState: HistoryState,
): NonceReservation {
  if (nextState === "pending") return reservation;
  return {
    ...reservation,
    historyState: nextState,
    reservedNonce: null,
  };
}

export interface PendingNonceHistoryRecord {
  intent: {
    account_index: number;
    chain_id: number;
    from: string;
    nonce: number;
  };
  outcome: {
    state: string;
  };
}

export function nextNonceWithLocalPending(
  onChainNonce: number,
  history: PendingNonceHistoryRecord[],
  accountIndex: number,
  chainId: number,
  from: string,
) {
  return history.reduce((nextNonce, record) => {
    if (
      record.outcome.state !== "Pending" ||
      record.intent.account_index !== accountIndex ||
      record.intent.chain_id !== chainId ||
      record.intent.from.toLowerCase() !== from.toLowerCase()
    ) {
      return nextNonce;
    }
    return Math.max(nextNonce, record.intent.nonce + 1);
  }, onChainNonce);
}
