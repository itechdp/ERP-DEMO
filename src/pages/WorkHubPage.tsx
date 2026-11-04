import { useState } from 'react';
import { useTabAccess } from '../auth/tabs';
import { PageHeader, Tabs } from '../components/ui';
import { TaskPanel } from '../tasks/TaskPanel';
import { NoAccess } from './NoAccess';

type Tab = 'overview' | 'mytasks';
const TABS = ['overview', 'mytasks'] as const;

/**
 * The Work Hub: two tabs on one page (each one is its own item in Settings → Access Control).
 *  · Work Hub         — everybody's work at a glance, the report, New Task. For the administrators only, unless Access Control says otherwise.
 *  · My Tasks         — the tasks given to me: Start, Hold, Resume, Complete. Everybody has it.
 * Task Assignment (the task list and the form to give a task to somebody) is its own page, listed under the Work Hub in the menu.
 */
export function WorkHubPage({ query, initialTab }: { query: URLSearchParams; initialTab?: Tab }) {
  const ta = useTabAccess('work_hub', TABS);
  const fromUrl = TABS.find((t) => t === query.get('tab'));
  const [tab0, setTab] = useState<Tab>(initialTab ?? fromUrl ?? 'overview');
  const allowed = ta.allowed;
  const tab: Tab | undefined = allowed.includes(tab0) ? tab0 : allowed[0];
  if (!tab) return <NoAccess />;
  const labels: Record<Tab, string> = { overview: 'Work Hub', mytasks: 'My Tasks' };

  return (
    <>
      <PageHeader eyebrow="Main Menu" title="Work Hub" subtitle="Everybody's work and your own tasks. Giving out tasks is on the Task Assignment page." />
      <div style={{ marginBottom: 14 }}>
        <Tabs value={tab} onChange={setTab} items={allowed.map((k) => ({ value: k, label: labels[k] }))} />
      </div>
      {tab === 'overview' && <TaskPanel mode="overview" />}
      {tab === 'mytasks' && <TaskPanel mode="mine" />}
    </>
  );
}
