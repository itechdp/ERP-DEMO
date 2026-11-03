import { Cpu } from 'lucide-react';
import { Empty, PageHeader } from '../components/ui';

/** Workflow → Machinery → CNC. The page is in place; what it holds is still to be decided. */
export function CncPage() {
  return (
    <>
      <PageHeader eyebrow="Workflow · Machinery" title="CNC" />
      <div className="card">
        <Empty icon={Cpu} title="CNC" text="This page is ready. Tell me what it should hold (for example machines, jobs on them, programs or running hours) and it will be added here." />
      </div>
    </>
  );
}
