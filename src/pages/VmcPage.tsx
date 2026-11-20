import { useState } from 'react';
import { MachinePage } from '../machining/MachinePage';
import { StagePage } from './StagePage';
import { Tabs } from '../components/ui';

type Tab = 'jobs' | 'machines';

/** Workflow → Machinery → VMC. Step 6 of the job flow (after CNC, before QC): the job orders that arrive here, and the machines and runs. */
export function VmcPage() {
  const [tab, setTab] = useState<Tab>('jobs');
  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'jobs', label: 'Job Orders' }, { value: 'machines', label: 'Machines & Runs' }]} />
      </div>
      {tab === 'jobs' ? <StagePage stage="vmc" /> : <MachinePage kind="vmc" />}
    </>
  );
}
