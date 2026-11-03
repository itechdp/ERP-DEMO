import type { Job } from '../store/types';

/**
 * Priority is the order Heat Treatment runs in: 1 = Urgent first, 2 = High, 3 = Normal.
 * It is saved as the approval's number, so the database and the furnace queue sort by it directly.
 */
export const PRIORITY_LEVELS = [
  { n: 1, label: 'Urgent' },
  { n: 2, label: 'High' },
  { n: 3, label: 'Normal' },
] as const;

export const priorityName = (n: number) => PRIORITY_LEVELS.find((p) => p.n === n)?.label ?? 'Normal';
/** an approval saved with a number above 3 (older versions used free ranks) counts as Normal */
export const clampPriority = (n: number) => (n >= 1 && n <= 3 ? n : 3);
/** the priority a job was created with: Urgent / High / Normal → 1 / 2 / 3 */
export const jobPriority = (j: Pick<Job, 'priority'>) => (j.priority === 'Urgent' ? 1 : j.priority === 'High' ? 2 : 3);
export const priorityChip = (n: number) => (n === 1 ? 'chip chip-hot' : n === 2 ? 'chip chip-high' : 'chip');
