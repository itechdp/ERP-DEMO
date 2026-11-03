import { BookOpen } from 'lucide-react';
import { Empty, PageHeader } from '../components/ui';

/** Workflow → Instruction (sits just above Heat Treatment). The page is in place; what it holds is still to be decided. */
export function InstructionPage() {
  return (
    <>
      <PageHeader eyebrow="Workflow" title="Instruction" />
      <div className="card">
        <Empty icon={BookOpen} title="Instruction" text="This page is ready. Tell me what it should hold (for example work instructions per product or per process) and it will be added here." />
      </div>
    </>
  );
}
