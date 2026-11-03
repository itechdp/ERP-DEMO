import type { Tone } from '../components/ui';
import { useAccess } from './access';

/**
 * Which tabs of a page the signed-in person may open (Settings → Access Control lists every tab as "Page › Tab").
 * A tab with no setting yet follows its page. `pick(v)` is the tab to show: v if it is allowed, else the first allowed one ('' when none).
 */
export function useTabAccess<T extends string>(page: string, keys: readonly T[]) {
  const { user, canRead } = useAccess();
  const ok = (k: T) => {
    const lvl = user?.pages?.[`${page}__${k}`];
    return lvl === undefined ? canRead(page) : lvl !== 'hidden';
  };
  const allowed = keys.filter(ok);
  const pick = (v: T): T => (allowed.includes(v) ? v : allowed[0] ?? ('' as T));
  /** the tab items this person may open */
  const only = <I extends { value: T; label: string; count?: number; tone?: Tone }>(items: I[]): I[] => items.filter((i) => ok(i.value));
  return { allowed, ok, pick, only };
}
