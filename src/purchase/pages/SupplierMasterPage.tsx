import { useState } from 'react';
import { Building2, Pencil, Plus } from 'lucide-react';
import { Write } from '../../auth/access';
import { Badge, Empty, Field, FilterMenu, Modal, PageHeader, Search } from '../../components/ui';
import { matches } from '../../components/format';
import { useStore } from '../../store/StoreContext';
import { useSuppliers } from '../hooks/usePurchase';
import { saveSupplier } from '../services/supplierService';
import type { Supplier } from '../types';
import { ListButtons } from '../../export/docOutput';
import { FORM_FORMATS } from '../../export/xlsxSheet';

export function SupplierMasterPage() {
  const { suppliers, loading, error, reload } = useSuppliers();
  const [q, setQ] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useStore();

  // Form state
  const [form, setForm] = useState<Partial<Supplier>>({});

  const openNew = () => {
    setEditing(null);
    setForm({
      code: '',
      name: '',
      gstin: '',
      pan: '',
      state: 'Gujarat',
      contactPerson: '',
      phone: '',
      email: '',
      address: '',
      defaultPaymentTerms: '30 Days',
      isMsme: false,
      active: true,
    });
    setModalOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({ ...s });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name?.trim()) {
      toast({ kind: 'error', title: 'Supplier name required', message: 'Please enter a valid company name.' });
      return;
    }
    try {
      setSaving(true);
      await saveSupplier(form);
      toast({
        kind: 'success',
        title: editing ? 'Supplier updated' : 'Supplier added',
        message: form.name,
      });
      setModalOpen(false);
      void reload();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Could not save supplier',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const shown = suppliers
    .filter((s) => {
      if (activeFilter === 'active') return s.active;
      if (activeFilter === 'inactive') return !s.active;
      if (activeFilter === 'msme') return s.isMsme;
      return true;
    })
    .filter((s) => matches(q, s.code, s.name, s.gstin, s.pan, s.contactPerson, s.phone, s.email, s.state));

  const filterGroups = [
    {
      label: 'Status / Type',
      value: activeFilter,
      onChange: setActiveFilter,
      options: [
        { value: 'all', label: 'All Suppliers', count: suppliers.length },
        { value: 'active', label: 'Active', count: suppliers.filter((s) => s.active).length },
        { value: 'msme', label: 'MSME Registered', count: suppliers.filter((s) => s.isMsme).length },
        { value: 'inactive', label: 'Inactive', count: suppliers.filter((s) => !s.active).length },
      ],
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Purchase & Procurement"
        title="Supplier Master"
        actions={
          <>
            {shown.length > 0 && <ListButtons doc={() => ({ filename: 'Supplier-Master', title: 'Supplier Master', form: FORM_FORMATS.report, rows: shown.map((s) => ({ ...s, msme: s.isMsme ? 'Yes' : 'No', status: s.active ? 'Active' : 'Inactive' })), cols: [{ label: 'Code', key: 'code' }, { label: 'Supplier', key: 'name', width: 30 }, { label: 'GSTIN', key: 'gstin', width: 18 }, { label: 'PAN', key: 'pan' }, { label: 'State', key: 'state' }, { label: 'Contact', key: 'contactPerson' }, { label: 'Phone', key: 'phone' }, { label: 'E-mail', key: 'email', width: 26 }, { label: 'Payment Terms', key: 'defaultPaymentTerms', width: 22 }, { label: 'MSME', key: 'msme' }, { label: 'Status', key: 'status' }] })} />}
            <Write res="suppliers">
              <button className="btn btn-primary" onClick={openNew}>
                <Plus size={15} /> Add Supplier
              </button>
            </Write>
          </>
        }
      />

      <div className="card">
        {error ? (
          <Empty icon={Building2} title="Could not load suppliers" text={error} />
        ) : loading ? (
          <Empty icon={Building2} title="Loading suppliers…" />
        ) : suppliers.length === 0 ? (
          <Empty
            icon={Building2}
            title="No suppliers found"
            text="Add your first vendor or supplier to begin creating Purchase Orders."
            action={
              <Write res="suppliers">
                <button className="btn btn-primary" onClick={openNew}>
                  <Plus size={15} /> Add Supplier
                </button>
              </Write>
            }
          />
        ) : (
          <>
            <div className="toolbar">
              <Search value={q} onChange={setQ} placeholder="Search suppliers by name, code, GSTIN, city…" />
              <FilterMenu groups={filterGroups} />
            </div>

            {shown.length === 0 ? (
              <Empty icon={Building2} title="No matches" text="Try a different search query or filter." />
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Code</th>
                      <th>Supplier / Vendor Name</th>
                      <th>GSTIN / PAN</th>
                      <th>Contact Person</th>
                      <th>Phone & Email</th>
                      <th>Payment Terms</th>
                      <th style={{ width: 80 }} className="center">MSME</th>
                      <th style={{ width: 80 }} className="center">Status</th>
                      <th className="act">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s.id}>
                        <td className="strong">{s.code}</td>
                        <td className="strong">{s.name}</td>
                        <td>
                          {s.gstin ? <div className="mono text-xs">{s.gstin}</div> : null}
                          {s.pan ? <div className="mono text-xs muted">PAN: {s.pan}</div> : null}
                          {!s.gstin && !s.pan && '—'}
                        </td>
                        <td>{s.contactPerson || '—'}</td>
                        <td>
                          {s.phone && <div>{s.phone}</div>}
                          {s.email && <div className="text-xs muted">{s.email}</div>}
                          {!s.phone && !s.email && '—'}
                        </td>
                        <td>{s.defaultPaymentTerms || '30 Days'}</td>
                        <td className="center">
                          {s.isMsme ? <Badge status="OK" /> : <span className="muted">—</span>}
                        </td>
                        <td className="center">
                          <span className={`badge ${s.active ? 'b-green' : 'b-neutral'}`}>
                            {s.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="act nowrap">
                          <div className="icon-actions">
                            <Write res="suppliers">
                              <button
                                className="icon-btn"
                                title="Edit Supplier"
                                aria-label={`Edit ${s.name}`}
                                onClick={() => openEdit(s)}
                              >
                                <Pencil size={16} />
                              </button>
                            </Write>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        open={modalOpen}
        title={editing ? `Edit Supplier: ${editing.name}` : 'Add New Supplier'}
        onClose={() => !saving && setModalOpen(false)}
        footer={
          <>
            <button className="btn btn-subtle" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Supplier'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Supplier Name" required full>
            <input
              value={form.name ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Balaji Steel Rolling Mills"
            />
          </Field>

          <Field label="GSTIN">
            <input
              value={form.gstin ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))}
              placeholder="24AAACE1234A1Z1"
              maxLength={15}
            />
          </Field>
          <Field label="PAN">
            <input
              value={form.pan ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase() }))}
              placeholder="AAACE1234A"
              maxLength={10}
            />
          </Field>

          <Field label="Contact Person">
            <input
              value={form.contactPerson ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
              placeholder="Manager / Key Person"
            />
          </Field>
          <Field label="Phone">
            <input
              value={form.phone ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+91 98765 43210"
            />
          </Field>

          <Field label="Email">
            <input
              type="email"
              value={form.email ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="purchase@supplier.com"
            />
          </Field>
          <Field label="State">
            <input
              value={form.state ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              placeholder="Gujarat"
            />
          </Field>

          <Field label="Factory / Office Address" full>
            <textarea
              rows={2}
              value={form.address ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="Plot / GIDC address…"
            />
          </Field>

          <Field label="Default Payment Terms">
            <input
              value={form.defaultPaymentTerms ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, defaultPaymentTerms: e.target.value }))}
              placeholder="e.g. 30 Days Net / Advance"
            />
          </Field>

          <div className="field" style={{ justifyContent: 'flex-end', paddingTop: 26 }}>
            <div className="check-row">
              <label className={`check ${form.isMsme ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={!!form.isMsme}
                  onChange={(e) => setForm((f) => ({ ...f, isMsme: e.target.checked }))}
                />
                <span>MSME Registered</span>
              </label>
              <label className={`check ${form.active !== false ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={form.active !== false}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                <span>Active</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
