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
