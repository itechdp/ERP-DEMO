import { useEffect, useRef, useState } from 'react';
import { BellRing, CheckCheck, Inbox } from 'lucide-react';
import { go } from '../components/ui';
import { timeAgo } from '../components/format';
import { UrgencyBadge } from './UrgencyBadge';
import { useNotifications } from './notifications';

/** The notification bell in the top bar: an unseen count, and the history (newest first) — unseen ones are highlighted. */
export function NotificationBell() {
  const { all, unseen, read, readAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div className="rel" ref={ref}>
      <button className="round-btn" onClick={() => setOpen((o) => !o)} aria-label="Notifications" title="Notifications">
        <Inbox size={18} />
        {unseen > 0 && <span className="ping">{unseen > 9 ? '9+' : unseen}</span>}
      </button>
      {open && (
        <div className="pop">
          <div className="pop-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <b>Notifications</b>
              <div>{unseen ? `${unseen} new` : 'You are all caught up'}</div>
            </div>
            {unseen > 0 && (
              <button className="btn btn-sm btn-subtle" onClick={readAll}>
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
          <div className="pop-list">
            {all.length === 0 && <div className="muted" style={{ padding: 16, fontSize: 13 }}>No notifications yet.</div>}
            {all.map((n) => (
              <button
                key={n.id}
                className="pop-item"
                style={n.seenAt ? undefined : { background: 'var(--primary-50)' }}
                onClick={() => {
                  read([n.id]);
                  setOpen(false);
                  if (n.link) go(n.link);
                }}
              >
                <span className="ic"><BellRing size={17} /></span>
                <span>
                  <span className="tt" style={{ fontWeight: n.seenAt ? 500 : 700 }}>
                    {n.title} {n.urgency && n.kind === 'task_assigned' && <UrgencyBadge urgency={n.urgency} />}
                  </span>
                  <div className="ss">{n.message}</div>
                  <div className="ss">{timeAgo(n.createdAt)}</div>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
