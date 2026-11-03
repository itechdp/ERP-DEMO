import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import * as api from '../db/api';
import { useAccess } from '../auth/access';
import { useStore } from '../store/StoreContext';
import type { RawMaterialLot } from '../store/types';
import { Field, Modal, NumInput } from '../components/ui';
import { fmtKg } from '../components/format';

type Status = 'Pending' | 'Accepted' | 'Rejected' | 'Partial';

const CHOICES: { value: Status; label: string; hint: string }[] = [
  { value: 'Accepted', label: 'Accepted', hint: 'The whole lot passed. It stays in stock.' },
  { value: 'Partial', label: 'Partly accepted', hint: 'Part passed, part failed. The failed share is taken out of usable stock.' },
  { value: 'Rejected', label: 'Rejected', hint: 'The whole lot failed. None of it can be used.' },
  { value: 'Pending', label: 'Pending', hint: 'Not checked yet (undo a previous result).' },
];

/** Incoming QC of one inward lot. The database moves rejected bars out of usable stock, so production can never be issued rejected material. */
export function LotQcModal({ lot, onClose }: { lot: RawMaterialLot; onClose: () => void }) {
  const { run, busy } = useStore();
  const { user } = useAccess();
  const [status, setStatus] = useState<Status>(lot.qcStatus && lot.qcStatus !== 'Pending' ? lot.qcStatus : 'Accepted');
  const [acc, setAcc] = useState(lot.qcStatus === 'Partial' && lot.acceptedWeight != null ? String(lot.acceptedWeight) : '');
  const [rej, setRej] = useState(lot.qcStatus === 'Partial' && lot.rejectedWeight != null ? String(lot.rejectedWeight) : '');

  const accN = Number(acc);
  const rejN = Number(rej);
  const issued = lot.inwardQty - lot.availableQty - (lot.blockedQty ?? 0);
  const errPartial =
    status !== 'Partial' ? null : !(accN > 0) || !(rejN > 0) ? 'Enter both an accepted and a rejected weight' : accN + rejN > lot.inwardWeight + 0.0005 ? `Together they are more than the ${fmtKg(lot.inwardWeight)} received` : null;

  const submit = async () => {
    const ok = await run(
      () => api.setLotQc(lot.id, status, status === 'Partial' ? accN : null, status === 'Partial' ? rejN : null, user?.name || user?.email || 'QC'),
      { title: 'Incoming QC recorded', message: `${lot.id} · ${status === 'Partial' ? 'partly accepted' : status.toLowerCase()}` },
    );
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={ShieldCheck}
      title={`Incoming QC — ${lot.id}`}
      subtitle={`${lot.material} · OD ${lot.od} mm · ${fmtKg(lot.inwardWeight)} received${lot.poNo ? ` · against ${lot.poNo}` : ''}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!!errPartial || busy} onClick={submit}>
            <ShieldCheck size={15} /> Save QC result
          </button>
        </>
      }
    >
      <div className="section-label">Result</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {CHOICES.map((c) => (
          <label key={c.value} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" name="qc" checked={status === c.value} onChange={() => setStatus(c.value)} style={{ marginTop: 4 }} />
            <span>
              <b>{c.label}</b>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {c.hint}
              </div>
            </span>
          </label>
        ))}
      </div>

      {status === 'Partial' && (
        <>
          <div className="section-label">Weights</div>
          <div className="form-grid">
            <Field label="Accepted weight" required error={errPartial}>
              <NumInput value={acc} onChange={setAcc} suffix="KG" step="any" bad={!!errPartial} />
            </Field>
            <Field label="Rejected weight" required>
              <NumInput value={rej} onChange={setRej} suffix="KG" step="any" bad={!!errPartial} />
            </Field>
          </div>
        </>
      )}
      {issued > 0 && (status === 'Rejected' || status === 'Partial') && (
        <div className="callout warn">
          <ShieldCheck size={16} />
          <div>{issued} PCS of this lot are already issued to production; rejection can only take out what is still in stock.</div>
        </div>
      )}
    </Modal>
  );
}
