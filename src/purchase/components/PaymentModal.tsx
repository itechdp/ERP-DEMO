import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { useAccess } from '../../auth/access';
import { Field, Modal, NumInput } from '../../components/ui';
import { fmtDate, todayISO } from '../../components/format';
import { useStore } from '../../store/StoreContext';
import { withDocNo } from '../../db/client';
import { ADD_NEW, useAddOption } from '../../masters/AddItem';
import { useOptions } from '../../masters/useOptions';
import { DocNoField, useDocNo } from '../../components/DocNoField';
import { savePayment } from '../services/invoiceService';
import type { PurchaseInvoice } from '../types';

const inr = (v: number) => '₹ ' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * Records a payment against a POSTED invoice. Pass `invoice` when it is already known (invoice page), or `choices` (posted invoices with a
 * balance) to pick one. The database refuses anything above the outstanding balance and a missing reference (except Cash).
 */
export function PaymentModal({ invoice, choices, onClose, onSaved }: { invoice?: PurchaseInvoice; choices?: PurchaseInvoice[]; onClose: () => void; onSaved: () => void }) {
  const { user } = useAccess();
  const { toast } = useStore();
  const [invoiceId, setInvoiceId] = useState<number | ''>(invoice?.invoiceId ?? '');
  const picked = invoice ?? choices?.find((c) => c.invoiceId === invoiceId);
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(invoice ? String(Math.round(invoice.balance * 100) / 100) : '');
  const modes = useOptions('payment_mode');
  const [mode, setMode] = useState<string>('Bank Transfer');
  const addMode = useAddOption('payment_mode', (v) => setMode(v));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const doc = useDocNo('pay', true);

  const amountN = Number(amount);
  const over = !!picked && amountN > picked.balance + 0.004;
  const needsRef = mode !== 'Cash';
  const valid = !!picked && amountN > 0 && !over && (!needsRef || reference.trim() !== '') && !!date;

  const pick = (id: number | '') => {
    setInvoiceId(id);
    const inv = choices?.find((c) => c.invoiceId === id);
    setAmount(inv ? String(Math.round(inv.balance * 100) / 100) : '');
  };

  const submit = async () => {
    if (!picked) return;
    try {
      setSaving(true);
      await withDocNo(doc.custom, () => savePayment(null, { pinv_id: picked.invoiceId, pay_date: date, amount: amountN, mode, reference: reference.trim() || null, notes: notes.trim() || null }, user?.name || user?.email || 'User'));
      toast({ kind: 'success', title: 'Payment recorded', message: `${inr(amountN)} against ${picked.pinvNo}.` });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not record the payment', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={Wallet}
      title="Record Payment"
      subtitle={picked ? `${picked.pinvNo} · ${picked.supplierName} · balance ${inr(picked.balance)}` : 'Choose the invoice this payment is for'}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || saving}>
            <Wallet size={15} /> {saving ? 'Saving…' : 'Record Payment'}
          </button>
        </>
      }
    >
      {!invoice && (
        <Field label="Invoice" required>
          <select value={invoiceId} onChange={(e) => pick(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Select a posted invoice…</option>
            {(choices ?? []).map((c) => (
              <option key={c.invoiceId} value={c.invoiceId}>
                {c.pinvNo} · {c.supplierName} · {inr(c.balance)} due{c.dueDate ? ` ${fmtDate(c.dueDate)}` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="form-grid">
        <DocNoField label="Payment No." no={doc.no} setNo={doc.setNo} />
        <Field label="Payment Date" required>
          <input type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Amount" required error={over ? `More than the ${inr(picked?.balance ?? 0)} outstanding` : null}>
          <NumInput value={amount} onChange={setAmount} suffix="₹" step="any" bad={over} />
        </Field>
        <Field label="Mode" required>
          <select value={mode} onChange={(e) => (e.target.value === ADD_NEW ? addMode.open() : setMode(e.target.value))}>
            {modes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={ADD_NEW}>+ Add new mode…</option>
          </select>
          {addMode.modal}
        </Field>
        <Field label={mode === 'Cheque' ? 'Cheque No.' : mode === 'UPI' ? 'UPI Transaction ID' : mode === 'Cash' ? 'Reference (optional)' : 'UTR / Reference No.'} required={needsRef}>
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
