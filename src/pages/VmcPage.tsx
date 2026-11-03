import { Cog } from 'lucide-react';
import { Empty, PageHeader } from '../components/ui';

/** Workflow → Machinery → VMC. The page is in place; what it holds is still to be decided. */
export function VmcPage() {
  return (
    <>
      <PageHeader eyebrow="Workflow · Machinery" title="VMC" />
      <div className="card">
        <Empty icon={Cog} title="VMC" text="This page is ready. Tell me what it should hold (for example machines, jobs on them, programs or running hours) and it will be added here." />
      </div>
    </>
  );
}
