import type { HistoryErrorDisplay } from "../../core/history/errors";

export function HistoryErrorCard({
  error,
  meta,
  role,
}: {
  error: HistoryErrorDisplay;
  meta?: string;
  role?: "alert";
}) {
  return (
    <article className={`history-error-card history-error-card-${error.kind}`} role={role}>
      <div className="history-error-card-header">
        <span>{error.label}</span>
        <strong>{error.title}</strong>
      </div>
      <p>{error.summary}</p>
      <p>{error.suggestion}</p>
      <dl>
        {meta && (
          <div>
            <dt>Record</dt>
            <dd className="mono">{meta}</dd>
          </div>
        )}
        <div>
          <dt>Source</dt>
          <dd className="mono">{error.source}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd className="mono">{error.category}</dd>
        </div>
        {error.message && (
          <div>
            <dt>Message</dt>
            <dd className="mono">{error.message}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}
