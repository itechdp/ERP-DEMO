import { useEffect, useState } from 'react';
import { PackageX, Undo2, Wrench } from 'lucide-react';
import * as api from '../db/api';
import { useStore } from '../store/StoreContext';
import type { FinishedGood, RawMaterialLot } from '../store/types';
import { Field, Modal, NumInput } from './ui';
import { fmtNum } from './format';
import { supabase } from '../db/client';
import { STAGE_LABEL } from '../store/engine';
import type { QCRecord } from '../store/types';

const KINDS: { value: api.RawAdjustKind; label: string; hint: string }[] = [
  { value: 'count_up', label: 'Stock count — found more', hint: 'More pieces on the shelf than the system shows' },
  { value: 'count_down', label: 'Stock count — missing', hint: 'Fewer pieces on the shelf than the system shows' },
  { value: 'scrap', label: 'Scrap / damaged', hint: 'Pieces thrown away; counted as a loss' },
  { value: 'supplier_return', label: 'Returned to supplier', hint: 'Pieces sent back to the supplier' },
];

/** Raw Inventory → a lot: a stock-count difference, scrap, or a return to the supplier. Writes a ledger line with the reason. */
export function RawAdjustModal({ lot, onClose }: { lot: RawMaterialLot; onClose: () => void }) {
  const { run, busy } = useStore();
  const [kind, setKind] = useState<api.RawAdjustKind>('count_down');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const n = Number(qty);
  const decrease = kind !== 'count_up';
  const err = qty === '' ? null : !(n > 0) || !Number.isInteger(n) ? 'Enter a whole number' : decrease && n > lot.availableQty ? `Only ${fmtNum(lot.availableQty)} PCS are in stock` : null;
  const valid = n > 0 && Number.isInteger(n) && !err && reason.trim() !== '';
  const submit = async () => {
    if (await run(() => api.adjustRawStock(lot.id, kind, n, reason), { title: 'Stock adjusted', message: `${lot.id} · ${KINDS.find((k) => k.value === kind)?.label} · ${n} PCS` })) onClose();
  };
  return (
    <Modal
      dialog
      open
      onClose={onClose}
      icon={PackageX}
      title={`Adjust stock — ${lot.id}`}
      subtitle={`${lot.material} Ø${lot.od} mm · ${fmtNum(lot.availableQty)} PCS in stock`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
            Save adjustment
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="What happened" required hint={KINDS.find((k) => k.value === kind)?.hint}>
          <select value={kind} onChange={(e) => setKind(e.target.value as api.RawAdjustKind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity" required error={err}>
          <NumInput value={qty} onChange={setQty} suffix="PCS" bad={!!err} autoFocus />
        </Field>
        <Field label="Reason" required full hint="Goes on the quantity ledger with your name and the time">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Counted on 3 Nov — 4 bars short" />
        </Field>
      </div>
    </Modal>
  );
}

/** Finished Goods → goods a customer sent back. They leave "dispatched" and are available again. */
export function ReturnGoodsModal({ fg, onClose }: { fg: FinishedGood; onClose: () => void }) {
  const { run, busy } = useStore();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const n = Number(qty);
  const err = qty === '' ? null : !(n > 0) || !Number.isInteger(n) ? 'Enter a whole number' : n > fg.dispatchedQty ? `Only ${fmtNum(fg.dispatchedQty)} PCS were dispatched` : null;
  const valid = n > 0 && Number.isInteger(n) && !err && reason.trim() !== '';
  const submit = async () => {
    if (await run(() => api.returnFinishedGoods(fg.id, n, reason), { title: 'Return recorded', message: `${fg.id} · ${n} PCS back in Finished Goods` })) onClose();
  };
  return (
    <Modal
      dialog
      open
      onClose={onClose}
      icon={Undo2}
      title={`Customer return — ${fg.id}`}
      subtitle={`${fmtNum(fg.dispatchedQty)} PCS dispatched so far`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
            Record return
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Quantity returned" required error={err}>
          <NumInput value={qty} onChange={setQty} suffix="PCS" bad={!!err} autoFocus />
        </Field>
        <Field label="Reason" required full hint="Goes on the quantity ledger with your name and the time">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer rejected — thread damage" />
        </Field>
      </div>
    </Modal>
  );
}

const PARTS_KINDS: { value: api.PartsAdjustKind; label: string }[] = [
  { value: 'count_up', label: 'Stock count — found more' },
  { value: 'count_down', label: 'Stock count — missing' },
  { value: 'scrap', label: 'Scrap / damaged' },
];

/** Product Master → our stock of parts: a count difference or scrap. */
export function PartsAdjustModal({ productId, stage, name, stageLabel, available, onClose }: { productId: string; stage: string; name: string; stageLabel: string; available: number; onClose: () => void }) {
  const { run, busy } = useStore();
  const [kind, setKind] = useState<api.PartsAdjustKind>('count_down');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const n = Number(qty);
  const err = qty === '' ? null : !(n > 0) || !Number.isInteger(n) ? 'Enter a whole number' : kind !== 'count_up' && n > available ? `Only ${fmtNum(available)} PCS are in stock` : null;
  const valid = n > 0 && Number.isInteger(n) && !err && reason.trim() !== '';
  const submit = async () => {
    if (await run(() => api.adjustSemiStock(productId, stage, kind, n, reason), { title: 'Stock adjusted', message: `${name} · ${PARTS_KINDS.find((k) => k.value === kind)?.label} · ${n} PCS` })) onClose();
  };
  return (
    <Modal
      dialog
      open
      onClose={onClose}
      icon={PackageX}
      title={`Adjust parts stock — ${name}`}
      subtitle={`${fmtNum(available)} PCS ready for ${stageLabel}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>Save adjustment</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="What happened" required>
          <select value={kind} onChange={(e) => setKind(e.target.value as api.PartsAdjustKind)}>
            {PARTS_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Quantity" required error={err}>
          <NumInput value={qty} onChange={setQty} suffix="PCS" bad={!!err} autoFocus />
        </Field>
        <Field label="Reason" required full hint="Kept with your name and the time">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Counted on 3 Nov — 20 pieces short" />
        </Field>
      </div>
    </Modal>
  );
}

const REWORK_STAGES = ['forging', 'trimming', 'heatTreatment'] as const;

/** QC → pieces that were rejected: send them back to our stock of parts for another process. */
export function ReworkModal({ rec, onClose }: { rec: QCRecord; onClose: () => void }) {
  const { run, busy } = useStore();
  const [done, setDone] = useState<number | null>(null);
  const [stage, setStage] = useState<(typeof REWORK_STAGES)[number]>('forging');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    void supabase.from('v_qc_rework').select('qty').eq('job_no', rec.jobNo).then(({ data, error }) => setDone(error ? 0 : (data ?? []).reduce((t, r) => t + Number(r.qty), 0)));
  }, [rec.jobNo]);
  const waiting = rec.rejected - (done ?? 0);
  const n = Number(qty);
  const err = qty === '' ? null : !(n > 0) || !Number.isInteger(n) ? 'Enter a whole number' : n > waiting ? `Only ${fmtNum(waiting)} rejected PCS are waiting` : null;
  const valid = done !== null && n > 0 && Number.isInteger(n) && !err && reason.trim() !== '';
  const submit = async () => {
    if (await run(() => api.sendForRework(rec.jobNo, stage, n, reason), { title: 'Sent for rework', message: `${n} PCS of ${rec.jobNo} are in parts stock for ${STAGE_LABEL[stage]}. Make a new job card to take them.` })) onClose();
  };
  return (
    <Modal
      dialog
      open
      onClose={onClose}
      icon={Wrench}
      title={`Send for rework — ${rec.jobNo}`}
      subtitle={done === null ? 'Checking…' : `${fmtNum(waiting)} rejected PCS waiting for a decision`}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>Send for rework</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Back to which process" required hint="The pieces wait in our stock of parts for this process">
          <select value={stage} onChange={(e) => setStage(e.target.value as (typeof REWORK_STAGES)[number])}>
            {REWORK_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Quantity" required error={err}>
          <NumInput value={qty} onChange={setQty} suffix="PCS" bad={!!err} autoFocus />
        </Field>
        <Field label="What is to be reworked" required full>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Undersize on OD — re-forge" />
        </Field>
      </div>
    </Modal>
  );
}
