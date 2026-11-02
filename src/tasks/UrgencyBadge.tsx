const TONE: Record<string, string> = { Low: 'b-neutral', Medium: 'b-blue', High: 'b-amber', Urgent: 'b-red' };

/** Task urgency as a coloured badge. */
export function UrgencyBadge({ urgency }: { urgency: string }) {
  if (!urgency) return <span className="muted">—</span>;
  return <span className={`badge ${TONE[urgency] ?? 'b-neutral'}`}>{urgency}</span>;
}
