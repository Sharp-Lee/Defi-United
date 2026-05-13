import type { ReactNode } from "react";

export function NoticePanel({
  children,
  title,
  tone = "neutral",
}: {
  children: ReactNode;
  title: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <article className={`notice-panel notice-panel-${tone}`}>
      <h3>{title}</h3>
      <div>{children}</div>
    </article>
  );
}
