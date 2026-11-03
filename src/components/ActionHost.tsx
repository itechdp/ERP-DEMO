import type { ReactNode } from 'react';
import { useStore } from '../store/StoreContext';
import { PageFormCtx } from './ui';
import { NewJobModal } from './NewJobModal';
import { StageModal } from '../pages/StagePage';
import { InspectModal } from '../pages/QCPage';
import { HardnessForm } from '../pages/HardnessPage';
import { NewDispatchModal } from '../pages/DispatchPage';
import { InwardModal } from '../pages/RawInventoryPage';
import { ProductModal } from '../pages/ReportPages';
import { JobWorkForm } from '../pages/JobWorkPage';

const EYEBROW: Record<string, string> = {
  newJob: 'Workflow · Cutting',
  jobWork: 'Workflow · Job Work In',
  product: 'Masters · Product Master',
  inward: 'Workflow · Raw Inventory',
  qc: 'Workflow · Quality Control',
  hardness: 'Workflow · Quality Control',
  dispatch: 'Workflow · Dispatch',
};
const stageEyebrow = (s: string) => `Workflow · ${s === 'heatTreatment' ? 'Heat Treatment' : s[0].toUpperCase() + s.slice(1)}`;

/**
 * Renders the shop-floor form that the address (or a pop-up request) asks for.
 * Every form (and its read-only view) is a full page: <ActionHost page /> sits inside the page area.
 */
export function ActionHost({ page }: { page?: boolean }) {
  const { action, openAction } = useStore();
  if (!action) return null;
  if (!page) return null;
  const close = () => openAction(null);
  let body: ReactNode = null;
  switch (action.kind) {
    case 'newJob':
      body = <NewJobModal open onClose={close} />;
      break;
    case 'jobWork':
      body = <JobWorkForm onClose={close} />;
      break;
    case 'product':
      body = <ProductModal key={(action.id ?? 'new') + (action.view ? '-v' : '')} id={action.id} viewOnly={action.view} onClose={close} />;
      break;
    case 'inward':
      body = <InwardModal preset={action} onClose={close} />;
      break;
    case 'stage':
      body = <StageModal key={action.jobNo + action.stage} stage={action.stage} jobNo={action.jobNo} onClose={close} />;
      break;
    case 'qc':
      body = <InspectModal key={action.jobNo} jobNo={action.jobNo} onClose={close} />;
      break;
    case 'hardness':
      body = <HardnessForm key={(action.id ?? action.jobNo ?? 'new') + (action.view ? '-v' : '')} id={action.id} jobNo={action.jobNo} viewOnly={action.view} onClose={close} />;
      break;
    case 'dispatch':
      body = <NewDispatchModal key={action.fgId} fgId={action.fgId} onClose={close} />;
      break;
  }
  return <PageFormCtx.Provider value={{ eyebrow: action.kind === 'stage' ? stageEyebrow(action.stage) : EYEBROW[action.kind] }}>{body}</PageFormCtx.Provider>;
}
