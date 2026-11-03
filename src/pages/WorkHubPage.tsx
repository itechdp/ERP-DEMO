import { useState } from 'react';
import { useAccess } from '../auth/access';
import { useTabAccess } from '../auth/tabs';
import { PageHeader, Tabs } from '../components/ui';
import { TaskPanel } from '../tasks/TaskPanel';
import { NoAccess } from './NoAccess';
import { SalesListPage } from './SalesPages';

type Tab = 'overview' | 'mytasks' | 'assignment';
const TABS = ['overview', 'mytasks', 'assignment'] as const;

/**
 * The Work Hub: three tabs on one page (each one is its own item in Settings → Access Control).
 *  · Work Hub         — everybody's work at a glance, the report, New Task. For the administrators only, unless Access Control says otherwise.
 *  · My Tasks         — the tasks given to me: Start, Hold, Resume, Complete. Everybody has it.
 *  · Task Assignment  — the task list and the form to give a task to somebody (needs the Task Assignment page as well).
 * The old Task Assignment address opens this page on its tab, so the forms and the notification links keep working.
 */
export function WorkHubPage({ query, initialTab }: { query: URLSearchParams; initialTab?: Tab }) {
  const { canRead } = useAccess();
  const ta = useTabAccess('work_hub', TABS);
  const fromUrl = TABS.find((t) => t === query.get('tab'));
  const [tab0, setTab] = useState<Tab>(initialTab ?? fromUrl ?? 'overview');
  // the assignment tab also needs the Task Assignment page itself
  const allowed = ta.allowed.filter((k) => k !== 'assignment' || canRead('task_assignment'));
  const tab: Tab | undefined = allowed.includes(tab0) ? tab0 : allowed[0];
  if (!tab) return <NoAccess />;
  const labels: Record<Tab, string> = { overview: 'Work Hub', mytasks: 'My Tasks', assignment: 'Task Assignment' };

  return (
    <>
      <PageHeader eyebrow="Main Menu" title="Work Hub" subtitle="Everybody's work, your own tasks and giving out tasks, in one place." />
      <div style={{ marginBottom: 14 }}>
        <Tabs value={tab} onChange={setTab} items={allowed.map((k) => ({ value: k, label: labels[k] }))} />
      </div>
      {tab === 'overview' && <TaskPanel mode="overview" />}
      {tab === 'mytasks' && <TaskPanel mode="mine" />}
      {tab === 'assignment' && <SalesListPage route="task-assignment" query={query} />}
    </>
  );
}
