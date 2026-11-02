import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { useAccess } from '../auth/access';
import { PageHeader, Tabs, type Icon } from '../components/ui';
import { TaskPanel } from '../tasks/TaskPanel';
import { NoAccess } from './NoAccess';

/**
 * The Work Hub: one place to browse the works of several sections. Each section is one entry below — to add a section later,
 * add an entry (its page access key, a label, and what to show). A section only appears for people who may open its page.
 */
const SECTIONS: { key: string; resource: string; label: string; icon: Icon; render: () => JSX.Element }[] = [
  { key: 'tasks', resource: 'task_assignment', label: 'Task Assignment', icon: ListChecks, render: () => <TaskPanel /> },
];

export function WorkHubPage() {
  const { canRead } = useAccess();
  // everybody who can open the hub sees their own tasks, even without the Task Assignment page
  const visible = SECTIONS.filter((s) => s.key === 'tasks' || canRead(s.resource));
  const [active, setActive] = useState(visible[0]?.key ?? '');
  const cur = visible.find((s) => s.key === active) ?? visible[0];
  if (!cur) return <NoAccess />;
  return (
    <>
      <PageHeader eyebrow="Main Menu" title="Work Hub" subtitle="Browse and update the work of the different sections in one place." />
      <div style={{ marginBottom: 14 }}>
        <Tabs value={cur.key} onChange={setActive} items={visible.map((s) => ({ value: s.key, label: s.label }))} />
      </div>
      {cur.render()}
    </>
  );
}
