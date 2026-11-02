import { BellRing, X } from 'lucide-react';
import { go } from '../components/ui';
import { UrgencyBadge } from './UrgencyBadge';
import { useNotifications } from './notifications';

/**
 * The popups. Whatever the person has not seen pops up — right after sign-in, and while they are in the app. A notification is
 * marked seen when it is dismissed or opened, so it never pops up again (it stays in the bell's history).
 */
export function NotificationHost() {
  const { popups, read } = useNotifications();
  if (!popups.length) return null;
  return (
    <div className="notif-stack" role="alert" aria-live="assertive">
      {popups.length > 1 && (
        <button className="btn btn-sm btn-subtle notif-all" onClick={() => read(popups.map((n) => n.id))}>
          Dismiss all ({popups.length})
        </button>
      )}
      {popups.map((n) => (
        <div key={n.id} className={`notif ${n.urgency === 'Urgent' ? 'urgent' : n.urgency === 'High' ? 'high' : ''}`}>
          <span className="ni"><BellRing size={18} /></span>
          <div className="nb">
            <div className="t">
              {n.title} {n.urgency && n.kind === 'task_assigned' && <UrgencyBadge urgency={n.urgency} />}
            </div>
            {n.message && <div className="m">{n.message}</div>}
            {n.link && (
              <button
                className="btn btn-sm btn-primary"
                style={{ marginTop: 8 }}
                onClick={() => {
                  read([n.id]);
                  go(n.link);
                }}
              >
                Open
              </button>
            )}
          </div>
          <button className="icon-btn" onClick={() => read([n.id])} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
