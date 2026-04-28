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
    account_index: number | null;
    chain_id: number | null;
    from: string | null;
    nonce: number | null;
  };
  submission?: {
    account_index: number | null;
    chain_id: number | null;
    from: string | null;
    nonce: number | null;
  };
  nonce_thread?: {
    account_index: number | null;
    chain_id: number | null;
    from: string | null;
    nonce: number | null;
  };
  outcome: {
    state: string;
  };
}

function completeIdentity(
  identity: PendingNonceHistoryRecord["submission"] | PendingNonceHistoryRecord["nonce_thread"],
) {
  if (
    !identity ||
    identity.account_index === null ||
    identity.chain_id === null ||
    identity.from === null ||
    identity.nonce === null
  ) {
    return null;
  }
  return {
    accountIndex: identity.account_index,
    chainId: identity.chain_id,
    from: identity.from,
    nonce: identity.nonce,
  };
}

function pendingNonceIdentity(record: PendingNonceHistoryRecord) {
  return (
    completeIdentity(record.submission) ??
    completeIdentity(record.nonce_thread) ??
    completeIdentity(record.intent)
  );
}

export function nextNonceWithLocalPending(
  onChainNonce: number,
  history: PendingNonceHistoryRecord[],
  accountIndex: number,
  chainId: number,
  from: string,
) {
  return history.reduce((nextNonce, record) => {
    const identity = pendingNonceIdentity(record);
    if (
      identity === null ||
      record.outcome.state !== "Pending" ||
      identity.accountIndex !== accountIndex ||
      identity.chainId !== chainId ||
      identity.from.toLowerCase() !== from.toLowerCase()
    ) {
      return nextNonce;
    }
    return Math.max(nextNonce, identity.nonce + 1);
  }, onChainNonce);
}
