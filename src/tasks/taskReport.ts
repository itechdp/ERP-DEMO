// Task report → Excel (company form layout). Which columns go in is the user's choice; the list below is the catalogue,
// so a new column is one entry here. Other Work Hub sections get their own report the same way later.
import { FORM_FORMATS, downloadFormSheet, type SheetSpec, type SheetValue } from '../export/xlsxSheet';
import { fmtDuration, taskOverdueDays, taskTimeTaken, taskTimeToStart, taskTurnaround, type Task } from './service';

export interface ReportField {
  key: string;
  label: string;
  width: number;
  on: boolean; // ticked by default
  get: (t: Task) => SheetValue;
}

const dmyHm = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const dmy = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('-') : '');
const hrs = (ms: number | null) => (ms == null ? null : Math.round((ms / 3600000) * 100) / 100);

export const TASK_REPORT_FIELDS: ReportField[] = [
  { key: 'docNo', label: 'Task No.', width: 15, on: true, get: (t) => t.docNo },
  { key: 'title', label: 'Task', width: 36, on: true, get: (t) => t.title },
  { key: 'assignee', label: 'Assigned To', width: 18, on: true, get: (t) => t.assignee },
  { key: 'assignedBy', label: 'Assigned By', width: 18, on: true, get: (t) => t.assignedBy },
  { key: 'urgency', label: 'Urgency', width: 11, on: true, get: (t) => t.urgency },
  { key: 'status', label: 'Status', width: 13, on: true, get: (t) => t.status },
  { key: 'assignedAt', label: 'Assigned On', width: 18, on: true, get: (t) => dmyHm(t.assignedAt ?? t.createdAt) },
  { key: 'dueDate', label: 'Due Date', width: 12, on: true, get: (t) => dmy(t.dueDate) },
  { key: 'startedAt', label: 'Started On', width: 18, on: true, get: (t) => dmyHm(t.startedAt) },
  { key: 'completedAt', label: 'Completed On', width: 18, on: true, get: (t) => dmyHm(t.completedAt) },
  { key: 'timeTaken', label: 'Time Taken', width: 14, on: true, get: (t) => (taskTimeTaken(t) == null ? '' : fmtDuration(taskTimeTaken(t))) },
  { key: 'overdue', label: 'Days Overdue', width: 11, on: true, get: (t) => taskOverdueDays(t) || 0 },
  { key: 'timeTakenHrs', label: 'Time Taken (hrs)', width: 13, on: false, get: (t) => hrs(taskTimeTaken(t)) },
  { key: 'timeToStart', label: 'Time to Start', width: 14, on: false, get: (t) => (taskTimeToStart(t) == null ? '' : fmtDuration(taskTimeToStart(t))) },
  { key: 'turnaround', label: 'Total Turnaround', width: 16, on: false, get: (t) => (taskTurnaround(t) == null ? '' : fmtDuration(taskTurnaround(t))) },
  { key: 'refNo', label: 'Related To', width: 16, on: false, get: (t) => t.refNo },
  { key: 'remarks', label: 'Remarks', width: 30, on: false, get: (t) => t.remarks },
];

export function taskReportSpec(tasks: Task[], keys: string[], user: string, periodText: string, filterText: string): SheetSpec {
  const fields = TASK_REPORT_FIELDS.filter((f) => keys.includes(f.key));
  const done = tasks.filter((t) => t.status === 'Done');
  const taken = done.map((t) => taskTimeTaken(t)).filter((v): v is number => v != null);
  const avg = taken.length ? fmtDuration(taken.reduce((a, b) => a + b, 0) / taken.length) : '—';
  const today = dmy(new Date().toISOString());
  return {
    filename: `Task-Report-${new Date().toISOString().slice(0, 10)}`,
    sheet: 'Task Report',
    form: FORM_FORMATS.taskReport,
    title: 'Task Assignment Report',
    info: [[`Period :- ${periodText}`, `Filters :- ${filterText}`, `Generated On :- ${today}`]],
    widths: [8, ...fields.map((f) => f.width)],
    blocks: [{ headers: ['Sr. No.', ...fields.map((f) => f.label)], align: ['center'], rows: tasks.map((t, i) => ({ cells: [i + 1, ...fields.map((f) => f.get(t))] })) }],
    notes: [`Tasks : ${tasks.length}      Completed : ${done.length}      Open / In progress : ${tasks.filter((t) => t.status === 'Open' || t.status === 'In Progress').length}      Average time taken (completed) : ${avg}`],
    checkedBy: user,
  };
}

export const downloadTaskReport = (tasks: Task[], keys: string[], user: string, periodText: string, filterText: string) =>
  downloadFormSheet(taskReportSpec(tasks, keys, user, periodText, filterText));
