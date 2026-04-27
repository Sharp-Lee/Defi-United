export interface SessionState {
  status: "locked" | "ready";
  lockedAt: number | null;
  idleLockMinutes: number;
}

export function shouldAutoLock(lastActiveAt: number, now: number, idleLockMinutes: number) {
  return now - lastActiveAt >= idleLockMinutes * 60_000;
}
