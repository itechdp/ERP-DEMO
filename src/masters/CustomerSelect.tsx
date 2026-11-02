import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { canSee } from '../auth/access';
import { Field, Modal } from '../components/ui';
import { useStore } from '../store/StoreContext';
import { ADD_NEW } from './AddItem';
import { saveCustomer } from './service';
import type { Customer } from './types';

/**
 * Pick a customer from the customer master instead of typing the name. `onChange` gets the name and, when it is a master customer,
 * the whole record — so a form can fill in contact, phone, e-mail and payment terms. The last line, "+ Add new customer…", opens a
 * small box to add one without leaving the form. A role that may not see customer names gets a plain text box, as before.
 */
export function CustomerSelect({ value, onChange, placeholder = 'Select a customer…', required }: { value: string; onChange: (name: string, customer?: Customer) => void; placeholder?: string; required?: boolean }) {
  const { masters } = useStore();
  const [adding, setAdding] = useState(false);
  const list = masters.customerList.filter((c) => c.active);
  if (!canSee('party_names')) return <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="As on the document" autoComplete="off" />;
  const known = list.some((c) => c.name === value);
  return (
    <>
      <select
        value={value}
        required={required}
        onChange={(e) => {
          if (e.target.value === ADD_NEW) return setAdding(true);
          onChange(e.target.value, list.find((c) => c.name === e.target.value));
        }}
      >
        <option value="">{placeholder}</option>
        {value && !known && <option value={value}>{value}</option>}
        {list.map((c) => (
          <option key={c.id} value={c.name}>
            {c.name}
            {c.city ? ` — ${c.city}` : ''}
          </option>
        ))}
        <option value={ADD_NEW}>+ Add new customer…</option>
      </select>
      {adding && (
        <QuickCustomerModal
          onClose={() => setAdding(false)}
          onAdded={(c) => {
            setAdding(false);
            onChange(c.name, c);
          }}
        />
      )}
    </>
  );
}

function QuickCustomerModal({ onClose, onAdded }: { onClose: () => void; onAdded: (c: Customer) => void }) {
  const { refresh, toast } = useStore();
  const [c, setC] = useState({ name: '', contact: '', phone: '', email: '', paymentTerms: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof c, v: string) => setC((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setBusy(true);
    try {
      const id = await saveCustomer(null, { name: c.name.trim(), contact: c.contact.trim(), phone: c.phone.trim(), email: c.email.trim(), paymentTerms: c.paymentTerms.trim() });
      await refresh();
      toast({ kind: 'success', title: 'Customer added', message: c.name.trim() });
      onAdded({ id, name: c.name.trim(), code: '', contact: c.contact.trim(), phone: c.phone.trim(), email: c.email.trim(), address: '', city: '', state: '', gstin: '', paymentTerms: c.paymentTerms.trim(), notes: '', active: true });
    } catch (e) {
      toast({ kind: 'error', title: 'Could not add the customer', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };
  return (
    <Modal
      dialog
      open
      onClose={onClose}
      icon={UserPlus}
      title="Add Customer"
      subtitle="More details (address, GSTIN …) can be added later on the Customers page."
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!c.name.trim() || busy} onClick={() => void submit()}>{busy ? 'Adding…' : 'Add Customer'}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Customer / company name" required><input className="input" value={c.name} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="Contact person"><input className="input" value={c.contact} onChange={(e) => set('contact', e.target.value)} /></Field>
        <Field label="Phone"><input className="input" value={c.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={c.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Payment terms"><input className="input" value={c.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="e.g. 30 days from invoice" /></Field>
      </div>
    </Modal>
  );
}
