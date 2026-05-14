import type { ReactNode } from "react";

export function QueueModule({ children }: { children: ReactNode }) {
  return <section className="queue-module">{children}</section>;
}
