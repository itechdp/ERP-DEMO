// Calendar rules: month grid, ordering, time format and the reminder timing. Run: npm run test:calendar
import { dueEvents, groupByDate, hhmm, isoOf, monthGrid, REMIND_GRACE_MIN, startOf, time12, type CalEvent } from '../src/calendar/logic';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
};
const ev = (id: number, date: string, time: string, kind: 'meeting' | 'task' = 'meeting'): CalEvent => ({ id, title: `e${id}`, date, time, kind, roleId: 'director', userId: 'u' });
const at = (s: string) => new Date(s); // local time

// ---- month grid
const nov = monthGrid(2026, 10);
check('grid always has 42 cells', nov.length === 42, nov.length);
check('Nov 2026 (starts on a Sunday) begins on Monday 26 Oct', nov[0].iso === '2026-10-26' && !nov[0].inMonth, nov[0]);
check('Nov 2026 has 30 days in the month', nov.filter((c) => c.inMonth).length === 30);
check('1 Nov sits in the Sunday column (7th cell)', nov[6].iso === '2026-11-01' && nov[6].inMonth, nov[6]);
const feb = monthGrid(2028, 1);
check('Feb 2028 (leap year) has 29 days', feb.filter((c) => c.inMonth).length === 29);
check('Dec → Jan crosses the year', monthGrid(2026, 11).some((c) => c.iso === '2027-01-03'));
check('a month starting on Monday has no leading days', monthGrid(2026, 5)[0].iso === '2026-06-01'); // 1 Jun 2026 is a Monday
check('isoOf pads month and day', isoOf(new Date(2026, 0, 5)) === '2026-01-05');

// ---- time text
check('hhmm cuts seconds', hhmm('09:30:00') === '09:30');
check('time12 morning', time12('09:05') === '09:05 am', time12('09:05'));
check('time12 noon', time12('12:00') === '12:00 pm', time12('12:00'));
check('time12 midnight', time12('00:15') === '12:15 am', time12('00:15'));
check('time12 evening', time12('18:45:00') === '06:45 pm', time12('18:45:00'));

// ---- grouping
const g = groupByDate([ev(3, '2026-11-20', '14:00'), ev(1, '2026-11-20', '09:00'), ev(2, '2026-11-21', '08:00'), ev(4, '2026-11-20', '09:00')]);
check('events are grouped by day', g.get('2026-11-20')?.length === 3 && g.get('2026-11-21')?.length === 1);
check('earliest first, then by id', g.get('2026-11-20')!.map((e) => e.id).join() === '1,4,3', g.get('2026-11-20')!.map((e) => e.id));

// ---- reminders
const e1 = ev(1, '2026-11-20', '10:00');
check('start time is read as local time', startOf(e1).getHours() === 10 && startOf(e1).getMinutes() === 0);
check('not due one minute before', dueEvents([e1], at('2026-11-20T09:59:00'), new Set()).length === 0);
check('due exactly at the scheduled time', dueEvents([e1], at('2026-11-20T10:00:00'), new Set()).length === 1);
check('still due a few minutes late (tab was in the background)', dueEvents([e1], at('2026-11-20T10:05:00'), new Set()).length === 1);
check(`not due after the ${REMIND_GRACE_MIN}-minute grace period (app was closed)`, dueEvents([e1], at('2026-11-20T10:31:00'), new Set()).length === 0);
check('an event already reminded is not shown again', dueEvents([e1], at('2026-11-20T10:00:30'), new Set([1])).length === 0);
check('another day is not due', dueEvents([e1], at('2026-11-19T10:00:00'), new Set()).length === 0);
const late = ev(9, '2026-11-20', '23:50');
check('a late-night event is still due just after midnight', dueEvents([late], at('2026-11-21T00:10:00'), new Set()).length === 1);
const due = dueEvents([ev(5, '2026-11-20', '10:10'), ev(6, '2026-11-20', '10:00'), ev(7, '2026-11-20', '10:30')], at('2026-11-20T10:20:00'), new Set());
check('only the arrived ones, earliest first', due.map((e) => e.id).join() === '6,5', due.map((e) => e.id));

console.log(failed ? `\n${failed} FAILED` : '\nAll calendar checks passed');
process.exit(failed ? 1 : 0);
