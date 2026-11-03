import { useMemo, useState } from 'react';
import { Pencil, Plus, Users } from 'lucide-react';
import { Write } from '../auth/access';
import { Empty, Field, Modal, PageHeader, Search } from '../components/ui';
import { saveCustomer } from '../masters/service';
import type { Customer } from '../masters/types';
import { useStore } from '../store/StoreContext';
import { matches } from '../components/format';
import { ListButtons } from '../export/docOutput';
import { FORM_FORMATS } from '../export/xlsxSheet';

const BLANK: Customer = { id: 0, name: '', code: '', contact: '', phone: '', email: '', address: '', city: '', state: '', gstin: '', paymentTerms: '', notes: '', active: true };

/** Customers: the customer master. Forms pick from this list (no retyping), and reports can group and filter by customer. */
export function CustomersPage() {
  const { masters, refresh, toast } = useStore();
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'active' | 'all'>('active');
  const [editing, setEditing] = useState<Customer | null>(null);
  const list = masters.customerList;
  const shown = useMemo(
    () => list.filter((c) => (show === 'all' ? true : c.active)).filter((c) => matches(q, c.name, c.code, c.contact, c.phone, c.email, c.city, c.gstin)),
    [list, q, show],
  );

  const add = (
    <Write res="customers">
      <button className="btn btn-primary" onClick={() => setEditing({ ...BLANK })}>
        <Plus size={15} /> Add Customer
      </button>
    </Write>
  );

  return (
    <>
      <PageHeader eyebrow="Sales & Orders" title="Customers" subtitle="Everyone you sell to. Pick a customer in the forms instead of typing the name." actions={<>{list.length > 0 && <ListButtons doc={() => ({ filename: 'Customers', title: 'Customers', form: FORM_FORMATS.report, rows: list.map((c) => ({ ...c, active: c.active ? 'Active' : 'Inactive' })), cols: [{ label: 'Customer', key: 'name', width: 30 }, { label: 'Code', key: 'code' }, { label: 'Contact', key: 'contact' }, { label: 'Phone', key: 'phone' }, { label: 'E-mail', key: 'email', width: 26 }, { label: 'City', key: 'city' }, { label: 'State', key: 'state' }, { label: 'GSTIN', key: 'gstin', width: 18 }, { label: 'Payment Terms', key: 'paymentTerms', width: 22 }, { label: 'Status', key: 'active' }] })} />}{add}</>} />
      <div className="card">
        {list.length === 0 ? (
          <Empty icon={Users} title="No customers yet" text="Add your first customer, or add one straight from a quotation or order form." action={add} />
        ) : (
          <>
            <div className="card-head" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Search value={q} onChange={setQ} placeholder="Search name, code, contact, city, GSTIN…" />
              <select value={show} onChange={(e) => setShow(e.target.value as 'active' | 'all')} className="input" style={{ width: 'auto' }} aria-label="Show">
                <option value="active">Active only</option>
                <option value="all">All (incl. switched off)</option>
              </select>
              <span className="text-xs muted" style={{ marginLeft: 'auto' }}>{shown.length} of {list.length}</span>
            </div>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Customer</th>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th>E-mail</th>
                    <th>City</th>
                    <th>GSTIN</th>
                    <th>Status</th>
                    <th className="act">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.id} style={c.active ? undefined : { opacity: 0.6 }}>
                      <td className="mono nowrap">{c.code || '—'}</td>
                      <td className="strong">{c.name}</td>
                      <td>{c.contact || '—'}</td>
                      <td className="nowrap">{c.phone || '—'}</td>
                      <td>{c.email || '—'}</td>
                      <td>{c.city || '—'}</td>
                      <td className="mono">{c.gstin || '—'}</td>
                      <td>{c.active ? <span className="badge b-green">Active</span> : <span className="badge b-neutral">Switched off</span>}</td>
                      <td className="r nowrap">
                        <Write res="customers">
                          <button className="icon-btn" title="Edit" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                            <Pencil size={17} />
                          </button>
                        </Write>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {editing && (
        <CustomerModal
          customer={editing}
          onClose={() => setEditing(null)}
          onSaved={async (name, isNew) => {
            await refresh();
            toast({ kind: 'success', title: isNew ? 'Customer added' : 'Customer updated', message: name });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function CustomerModal({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: (name: string, isNew: boolean) => void | Promise<void> }) {
  const { toast } = useStore();
  const [c, setC] = useState(customer);
  const [busy, setBusy] = useState(false);
  const isNew = customer.id === 0;
  const set = <K extends keyof Customer>(k: K, v: Customer[K]) => setC((x) => ({ ...x, [k]: v }));
  const gstOk = c.gstin.trim() === '' || /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z]Z[0-9A-Za-z]$/.test(c.gstin.trim());
  const valid = c.name.trim() !== '' && gstOk;

  const submit = async () => {
    setBusy(true);
    try {
      await saveCustomer(isNew ? null : c.id, { ...c, name: c.name.trim() });
      await onSaved(c.name.trim(), isNew);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the customer', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      icon={Users}
      title={isNew ? 'Add Customer' : 'Edit Customer'}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void submit()}>{busy ? 'Saving…' : isNew ? 'Add Customer' : 'Save Changes'}</button>
        </>
      }
    >
      <div className="section-label">Customer</div>
      <div className="form-grid three">
        <Field label="Customer / company name" required><input className="input" value={c.name} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="Code" hint="Your own short code, if you use one"><input className="input" value={c.code} onChange={(e) => set('code', e.target.value)} /></Field>
        <Field label="GSTIN" error={gstOk ? null : 'Not a valid GSTIN (15 characters)'}><input className="input mono" value={c.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} /></Field>
      </div>
      <div className="section-label">Contact</div>
      <div className="form-grid three">
        <Field label="Contact person"><input className="input" value={c.contact} onChange={(e) => set('contact', e.target.value)} /></Field>
        <Field label="Phone"><input className="input" value={c.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={c.email} onChange={(e) => set('email', e.target.value)} /></Field>
      </div>
      <div className="section-label">Address & terms</div>
      <div className="form-grid three">
        <Field label="Address" full><input className="input" value={c.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="City"><input className="input" value={c.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="State"><input className="input" value={c.state} onChange={(e) => set('state', e.target.value)} /></Field>
        <Field label="Payment terms" hint="Filled into new quotations and orders"><input className="input" value={c.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="e.g. 30 days from invoice" /></Field>
      </div>
      <Field label="Notes"><textarea rows={2} value={c.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      {!isNew && (
        <Field label="Status" hint="A switched-off customer is not offered in the forms; their old documents stay">
          <select value={c.active ? 'on' : 'off'} onChange={(e) => set('active', e.target.value === 'on')}>
            <option value="on">Active</option>
            <option value="off">Switched off</option>
          </select>
        </Field>
      )}
    </Modal>
  );
}
