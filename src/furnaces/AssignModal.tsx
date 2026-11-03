import { useState } from 'react';
import { currentUserName } from '../auth/access';
import { Field, Modal, NumInput } from '../components/ui';
import { useStore } from '../store/StoreContext';
import { assignFurnace, fmtTime, setFurnaceTimer, type FurnaceLoad, type useFurnaces } from './service';

type Fu = ReturnType<typeof useFurnaces>;
export interface WaitingBatch {
  jobNo: string;
  label: string;
}

/**
 * Load a batch into a furnace: which batch (when not fixed), which furnace (when not fixed), the shift, how long it is set for and a cycle number.
 * Only free furnaces are offered; a furnace holds one batch at a time.
 */
export function AssignModal({ jobNo, furnaceId, batches, fu, onClose, onDone }: { jobNo?: string; furnaceId?: number; batches?: WaitingBatch[]; fu: Fu; onClose: () => void; onDone: () => void | Promise<void> }) {
  const { toast } = useStore();
  const [job, setJob] = useState(jobNo ?? batches?.[0]?.jobNo ?? '');
  const [fid, setFid] = useState(String(furnaceId ?? fu.free[0]?.id ?? ''));
  const [shift, setShift] = useState<'' | 'AM' | 'PM'>(new Date().getHours() < 12 ? 'AM' : 'PM');
  const [hours, setHours] = useState('8');
  const [cycle, setCycle] = useState('');
  const [busy, setBusy] = useState(false);
  const mins = Math.round(Number(hours) * 60);
  const valid = !!job && !!fid && mins > 0;
  const furnaceName = fu.furnaces.find((f) => f.id === Number(fid))?.name;

  const save = async () => {
    setBusy(true);
    try {
      await assignFurnace(job, Number(fid), shift, mins, cycle, currentUserName());
      toast({ kind: 'success', title: 'Batch loaded', message: `${job} · ${furnaceName}` });
      await onDone();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not load the furnace', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  return (
    <Modal
      dialog
      open
      onClose={onClose}
      title={jobNo ? `Assign furnace — ${jobNo}` : `Load ${furnaceName ?? 'furnace'}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>
            Start furnace
          </button>
        </>
      }
    >
      <div className="form-grid">
        {!jobNo && (
          <Field label="Batch" required hint={batches?.length ? 'Batches whose pieces are waiting at Heat Treatment' : 'No batch is waiting at Heat Treatment'}>
            <select value={job} onChange={(e) => setJob(e.target.value)}>
              {(batches ?? []).map((b) => (
                <option key={b.jobNo} value={b.jobNo}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {furnaceId === undefined && (
          <Field label="Furnace" required hint="Only free furnaces are listed">
            <select value={fid} onChange={(e) => setFid(e.target.value)}>
              {fu.free.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Shift">
          <select value={shift} onChange={(e) => setShift(e.target.value as '' | 'AM' | 'PM')}>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
            <option value="">—</option>
          </select>
        </Field>
        <Field label="Furnace timer" required hint={mins > 0 ? `Free again at ${fmtTime(Date.now() + mins * 60000)}` : undefined}>
          <NumInput value={hours} onChange={setHours} suffix="hours" step="any" />
        </Field>
        <Field label="Cycle no." hint="Optional — for the hardness report">
          <input className="input" value={cycle} onChange={(e) => setCycle(e.target.value)} placeholder="e.g. C-0123" />
        </Field>
      </div>
    </Modal>
  );
}

/** change how long a running furnace stays on, counted from now */
export function TimerModal({ load, furnaceName, onClose, onDone }: { load: FurnaceLoad; furnaceName: string; onClose: () => void; onDone: () => void | Promise<void> }) {
  const { toast } = useStore();
  const left = Math.max(1, Math.round((Date.parse(load.endsAt) - Date.now()) / 60000));
  const [hours, setHours] = useState(String(Math.round((left / 60) * 100) / 100));
  const [busy, setBusy] = useState(false);
  const mins = Math.round(Number(hours) * 60);

  const save = async () => {
    setBusy(true);
    try {
      await setFurnaceTimer(load.id, mins);
      toast({ kind: 'success', title: 'Timer updated', message: `${furnaceName} · ${load.jobNo} · until ${fmtTime(Date.now() + mins * 60000)}` });
      await onDone();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not change the timer', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  return (
    <Modal
      dialog
      open
      onClose={onClose}
      title={`Timer — ${furnaceName}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!(mins > 0) || busy} onClick={() => void save()}>
            Update timer
          </button>
        </>
      }
    >
      <Field label="Stays on for (from now)" required hint={mins > 0 ? `${load.jobNo} · free again at ${fmtTime(Date.now() + mins * 60000)}` : undefined}>
        <NumInput value={hours} onChange={setHours} suffix="hours" step="any" />
      </Field>
    </Modal>
  );
}
