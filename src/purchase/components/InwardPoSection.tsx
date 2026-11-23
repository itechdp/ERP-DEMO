import { useEffect, useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import { Field } from '../../components/ui';
import { fmtKg } from '../../components/format';
import { fetchReceivablePOs } from '../services/receiptService';
import type { ReceivablePO, ReceivablePOItem } from '../types';


/**
 * "Against Purchase Order" part of the inward form. Optional: with nothing chosen the receipt is booked without a PO exactly as before.
 * If the list of receivable POs cannot be loaded (for example migration 32 is not installed yet) the section simply does not appear.
 */
export function InwardPoSection({
  poId,
  itemId,
  onPick,
  supplier,
  canSeeParty,
  weight,
  linkedPoNo,
  onUnlink,
}: {
  poId: number | null;
  itemId: number | null;
  /** po / item are null when the choice is cleared */
  onPick: (po: ReceivablePO | null, item: ReceivablePOItem | null) => void;
  /** supplier currently chosen on the form (narrows the PO list) */
  supplier: string;
  canSeeParty: boolean;
  /** weight typed on the form, to warn before saving an over-receipt */
  weight: number;
  /** editing a lot that is already booked against a PO */
  linkedPoNo?: string;
  onUnlink?: () => void;
}) {
  const [pos, setPos] = useState<ReceivablePO[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchReceivablePOs()
      .then((r) => alive && setPos(r))
      .catch(() => alive && setPos(null));
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => (pos ?? []).filter((p) => !supplier || !canSeeParty || p.supplierName === supplier || p.id === poId), [pos, supplier, canSeeParty, poId]);
  const po = pos?.find((p) => p.id === poId) ?? null;
  const item = po?.items.find((i) => i.id === itemId) ?? null;

  if (linkedPoNo) {
    return (
      <>
        <div className="section-label">Against Purchase Order</div>
        <div className="callout info">
          <Link2 size={16} />
          <div>
            This lot is booked against <b>{linkedPoNo}</b>.{' '}
            {onUnlink && (
              <button type="button" className="link-btn" onClick={onUnlink}>
                Remove the link
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  if (pos == null || pos.length === 0) return null;

  const pending = item ? Math.max(item.qty - item.receivedQty, 0) : 0;
  // any weight may be received against the line — more or less than ordered (migration 86); the totals are shown for information only
  const after = item ? item.receivedQty + (weight > 0 ? weight : 0) : 0;

  return (
    <>
      <div className="section-label">Against Purchase Order (optional)</div>
      <div className="form-grid">
        <Field label="Purchase Order" hint="Only released orders that still have material to receive">
          <select
            value={poId ?? ''}
            onChange={(e) => {
              const next = pos.find((p) => p.id === Number(e.target.value)) ?? null;
              // a single open line is picked for the person
              onPick(next, next && next.items.length === 1 ? next.items[0] : null);
            }}
          >
            <option value="">Not against a PO</option>
            {shown.map((p) => (
              <option key={p.id} value={p.id}>
                {p.poNo}
                {canSeeParty ? ` · ${p.supplierName}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="PO Line" hint={po ? undefined : 'Choose a purchase order first'}>
          <select value={itemId ?? ''} disabled={!po} onChange={(e) => onPick(po, po?.items.find((i) => i.id === Number(e.target.value)) ?? null)}>
            <option value="">{po ? 'Select the line…' : '—'}</option>
            {po?.items.map((i) => (
              <option key={i.id} value={i.id}>
                {`${i.lineNo}. ${i.item}${i.grade ? ' · ' + i.grade : ''}${i.size ? ' · ' + i.size : ''}`}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {item && (
        <div className="callout info">
          <Link2 size={16} />
          <div>
            Ordered <b>{fmtKg(item.qty)}</b> · already received <b>{fmtKg(item.receivedQty)}</b> · pending <b>{fmtKg(pending)}</b>.
            {weight > 0 && after !== item.qty && ` With this lot: ${fmtKg(after)} received, ${after > item.qty ? `${fmtKg(after - item.qty)} more` : `${fmtKg(item.qty - after)} less`} than ordered.`}
          </div>
        </div>
      )}
    </>
  );
}
