// Cross-device sync: after a save, every other open copy of the app (another tab, browser, tablet or phone) is told "this changed"
// over a Supabase Realtime broadcast channel and reads that data again. The message carries only the kind of data that changed —
// never the data itself — so nothing confidential travels over the channel; each device re-reads through its own login and the
// database's own rules. If Realtime is unreachable the app still works: pages fall back to re-reading on focus and on their timers.
import { supabase } from './client';

/** what changed: the main ERP data (store), the furnaces, or one of the dashboard scratch tools */
export type SyncScope = 'erp' | 'furnaces' | 'petty' | 'material' | 'notify';
type Listener = (scope: SyncScope) => void;

const listeners = new Set<Listener>();
let channel: ReturnType<typeof supabase.channel> | null = null;

function ensureChannel() {
  if (channel) return channel;
  // self: false — the device that saved already re-reads on its own
  channel = supabase.channel('erp-sync', { config: { broadcast: { self: false } } });
  channel
    .on('broadcast', { event: 'changed' }, ({ payload }) => {
      const scope = (payload as { scope?: SyncScope } | undefined)?.scope;
      if (scope) listeners.forEach((l) => l(scope));
    })
    .subscribe();
  return channel;
}

/** Tell the other devices that `scope` was just saved. Never throws: a missed message only means they catch up on focus / timer. */
export function announceChange(scope: SyncScope) {
  try {
    void ensureChannel()
      .send({ type: 'broadcast', event: 'changed', payload: { scope } })
      .catch(() => undefined);
  } catch {
    /* Realtime not available — the focus / timer fallbacks still apply */
  }
}

/** Run `fn` whenever another device saves something. Returns the unsubscribe function (use it as an effect cleanup). */
export function onRemoteChange(fn: Listener): () => void {
  try {
    ensureChannel();
  } catch {
    /* Realtime not available */
  }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Run `fn` when this window or tab is looked at again (tab switch, app brought back to the front, window focused). */
export function onWindowBack(fn: () => void): () => void {
  const back = () => {
    if (document.visibilityState === 'visible') fn();
  };
  document.addEventListener('visibilitychange', back);
  window.addEventListener('focus', back);
  return () => {
    document.removeEventListener('visibilitychange', back);
    window.removeEventListener('focus', back);
  };
}
