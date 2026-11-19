// Account master — the ledger accounts. An account can be linked to an ERP customer or supplier (its details are filled in from there).
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, Pencil, Plus, RefreshCw, Save, ScrollText, Trash2, UserPlus } from 'lucide-react';
import { useAccess } from '../../auth/access';
import { Confirm, Empty, Field, PageHeader, Search, Tabs, go } from '../../components/ui';
import { matches } from '../../components/format';
import { usePaged } from '../../components/Pager';
import { ListButtons } from '../../export/docOutput';
import { useStore } from '../../store/StoreContext';
import { num } from '../engine';
import { ACC_FORMS } from '../print';
import { deleteAccount, fetchSuppliers, saveAccount, type AccountInput } from '../service';
import { BANK_GROUPS, GROUP_NAMES, STATES, type Account } from '../types';
import { BooksGate, DrCr, av, goBack, useAccBooks } from '../components';

type Tab = 'all' | 'customer' | 'supplier' | 'other';

export function AccountsList() {
  const { books, loading, error, reload } = useAccBooks();
  const { canWrite } = useAccess();
  const { toast } = useStore();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [group, setGroup] = useState('');
  const [del, setDel] = useState<Account | null>(null);
  const write = canWrite('account_vouchers');
  const all = books?.accounts ?? [];
  const typeOf = (a: Account): Tab => (a.customerId ? 'customer' : a.supplierId ? 'supplier' : 'other');
  const rows = useMemo(
    () =>
      all
        .filter((a) => tab === 'all' || typeOf(a) === tab)
        .filter((a) => !group || a.group === group)
        .filter((a) => matches(q, a.name, a.group, a.mobileNo, a.city, a.state, a.gstinNo, a.panNo, a.area, a.pincode)),
    [all, tab, group, q],
  );
  const pg = usePaged(rows, `${tab}${group}${q}`);
  const count = (t: Tab) => (t === 'all' ? all.length : all.filter((a) => typeOf(a) === t).length);
  return (
    <>
      <PageHeader
        eyebrow="Accounting · Account Vouchers"
        title="Accounts"
        subtitle="Every ledger account — customers, suppliers, banks, cash, income and expense heads."
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => go(av())}>
              <ArrowLeft size={15} /> Vouchers
            </button>
            <ListButtons doc={() => ({ filename: 'Accounts', title: 'Account List', form: ACC_FORMS.report, rows: rows.map((a) => ({ name: a.name, group: a.group, opening: a.opening, mobile: a.mobileNo, city: a.city, state: a.state, gstin: a.gstinNo })), cols: [{ label: 'Account Name', key: 'name', width: 30 }, { label: 'Group', key: 'group', width: 22 }, { label: 'Opening (₹, +Dr / −Cr)', key: 'opening', kind: 'money' }, { label: 'Mobile', key: 'mobile' }, { label: 'City', key: 'city' }, { label: 'State', key: 'state' }, { label: 'GSTIN', key: 'gstin', width: 18 }] })} />
            {write && (
              <button className="btn btn-primary" onClick={() => go(av('account', { new: 1 }))}>
                <Plus size={15} /> Add Account
              </button>
            )}
          </>
        }
      />
      <BooksGate loading={loading && !books} error={error} reload={reload}>
        <div className="card">
          <div className="card-head" style={{ flexWrap: 'wrap', gap: 12 }}>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: 'all' as Tab, label: 'All Accounts', count: count('all') },
                { value: 'customer' as Tab, label: 'Customers', count: count('customer') },
                { value: 'supplier' as Tab, label: 'Suppliers', count: count('supplier') },
                { value: 'other' as Tab, label: 'Other Accounts', count: count('other') },
              ]}
            />
          </div>
          <div className="card-head">
            <div className="table-search-row">
              <Search value={q} onChange={setQ} placeholder="Search by name, group, mobile, city, GSTIN…" />
              <select className="filter" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group">
                <option value="">All groups</option>
                {GROUP_NAMES.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </div>
            <div className="right text-xs muted">
              {rows.length} of {all.length} accounts
              <button className="btn btn-sm btn-subtle" onClick={() => void reload()} disabled={loading}>
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
          </div>
          {rows.length === 0 ? (
            <Empty icon={UserPlus} title="No accounts found" text={all.length === 0 ? 'Start with a Cash-in-Hand account, your bank accounts, and your customers and suppliers.' : 'No account matches your search or filter.'} action={write && all.length === 0 ? <button className="btn btn-primary" onClick={() => go(av('account', { new: 1 }))}><Plus size={15} /> Add Account</button> : undefined} />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Account Name</th>
                    <th>Group Name</th>
                    <th className="r">Opening Balance</th>
                    <th>Mobile No.</th>
                    <th>City</th>
                    <th>State</th>
                    <th>GSTIN No.</th>
                    <th className="act">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((a) => (
                    <tr key={a.id} className="row-click" onClick={() => go(av('account', { id: a.id, mode: 'view' }))}>
                      <td className="strong">
                        {a.name}
                        {a.customerId ? <span className="chip" style={{ marginLeft: 8 }}>Customer</span> : a.supplierId ? <span className="chip" style={{ marginLeft: 8 }}>Supplier</span> : null}
                      </td>
                      <td>{a.group}</td>
                      <td className="r">
                        <DrCr amount={a.opening} />
                      </td>
                      <td>{a.mobileNo || '—'}</td>
                      <td>{a.city || '—'}</td>
                      <td>{a.state || '—'}</td>
                      <td className="mono">{a.gstinNo || '—'}</td>
                      <td className="act" onClick={(e) => e.stopPropagation()}>
                        <div className="icon-actions">
                          <button className="icon-btn" title="Ledger" onClick={() => go(av('ledger-view', { account: a.id }))}>
                            <ScrollText size={16} />
                          </button>
                          <button className="icon-btn" title="View" onClick={() => go(av('account', { id: a.id, mode: 'view' }))}>
                            <Eye size={16} />
                          </button>
                          {write && (
                            <>
                              <button className="icon-btn" title="Edit" onClick={() => go(av('account', { id: a.id, mode: 'edit' }))}>
                                <Pencil size={16} />
                              </button>
                              <button className="icon-btn danger" title="Delete" onClick={() => setDel(a)}>
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pg.pager}
            </div>
          )}
        </div>
      </BooksGate>
      <Confirm
        open={!!del}
        title={`Delete account "${del?.name ?? ''}"?`}
        message="An account that already has vouchers or bills cannot be deleted."
        confirmLabel="Delete"
        tone="danger"
        onClose={() => setDel(null)}
        onConfirm={() => {
          const a = del!;
          deleteAccount(a.id)
            .then(() => toast({ kind: 'success', title: `Account ${a.name} deleted` }))
            .catch((e) => toast({ kind: 'error', title: 'Could not delete the account', message: e instanceof Error ? e.message : String(e) }));
        }}
      />
    </>
  );
}

type Supplier = Awaited<ReturnType<typeof fetchSuppliers>>[number];
const blank = (): AccountInput => ({ accountType: 'other', customerId: null, supplierId: null, name: '', group: '', opening: 0, city: '', pincode: '', area: '', mobileNo: '', state: '', panNo: '', aadharNo: '', gstinNo: '', creditDays: '7', bankName: '', bankBranch: '', ifscCode: '', bankAccountNo: '', otherDetails: '' });

export function AccountForm({ query }: { query: URLSearchParams }) {
  const { books, loading, error, reload } = useAccBooks();
  const { masters, toast } = useStore();
  const { canWrite } = useAccess();
  const id = Number(query.get('id')) || null;
  const back = query.get('back');
  const [mode, setMode] = useState<'new' | 'view' | 'edit'>(id ? (query.get('mode') === 'edit' ? 'edit' : 'view') : 'new');
  const isView = mode === 'view';
  const write = canWrite('account_vouchers');
  const leave = () => goBack(back, av('accounts'));
  const record = id ? books?.accounts.find((a) => a.id === id) : undefined;
  const [f, setF] = useState<AccountInput>(blank);
  const [openAmt, setOpenAmt] = useState('');
  const [openType, setOpenType] = useState<'debit' | 'credit'>('debit');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AccountInput>(k: K, v: AccountInput[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    void fetchSuppliers().then(setSuppliers);
  }, []);
  useEffect(() => {
    if (!record || loaded) return;
    setF({
      accountType: record.customerId ? 'customer' : record.supplierId ? 'supplier' : 'other', customerId: record.customerId, supplierId: record.supplierId, name: record.name, group: record.group, opening: record.opening,
      city: record.city, pincode: record.pincode, area: record.area, mobileNo: record.mobileNo, state: record.state, panNo: record.panNo, aadharNo: record.aadharNo, gstinNo: record.gstinNo,
      creditDays: record.creditDays != null ? String(record.creditDays) : '', bankName: record.bankName, bankBranch: record.bankBranch, ifscCode: record.ifscCode, bankAccountNo: record.bankAccountNo, otherDetails: record.otherDetails,
    });
    setOpenAmt(record.opening ? String(Math.abs(record.opening)) : '');
    setOpenType(record.opening < 0 ? 'credit' : 'debit');
    setLoaded(true);
  }, [record, loaded]);

  const customers = masters.customerList.filter((c) => c.active || c.id === f.customerId);
  // a customer / supplier already linked to another account is not offered again
  const linkedC = new Set((books?.accounts ?? []).filter((a) => a.id !== id && a.customerId).map((a) => a.customerId));
  const linkedS = new Set((books?.accounts ?? []).filter((a) => a.id !== id && a.supplierId).map((a) => a.supplierId));

  const pickCustomer = (cid: string) => {
    const c = masters.customerList.find((x) => x.id === Number(cid));
    if (!c) return set('customerId', null);
    setF((x) => ({ ...x, customerId: c.id, name: c.name, group: x.group || 'Sundry Debtors', city: c.city || x.city, state: c.state || x.state, gstinNo: c.gstin || x.gstinNo, mobileNo: c.phone || x.mobileNo, area: c.address || x.area }));
  };
  const pickSupplier = (sid: string) => {
    const s = suppliers.find((x) => x.id === Number(sid));
    if (!s) return set('supplierId', null);
    setF((x) => ({ ...x, supplierId: s.id, name: s.name, group: x.group || 'Sundry Creditors', state: s.state || x.state, gstinNo: s.gstin || x.gstinNo, panNo: s.pan || x.panNo, mobileNo: s.phone || x.mobileNo, area: s.address || x.area }));
  };
  const isBank = BANK_GROUPS.includes(f.group);

  const save = async () => {
    if (f.accountType === 'customer' && !f.customerId) return toast({ kind: 'error', title: 'Please select a customer' });
    if (f.accountType === 'supplier' && !f.supplierId) return toast({ kind: 'error', title: 'Please select a supplier' });
    if (!f.name.trim()) return toast({ kind: 'error', title: 'Please enter an account name' });
    if (!f.group) return toast({ kind: 'error', title: 'Please select a group name' });
    const cd = f.creditDays.trim();
    if (cd && (!/^\d+$/.test(cd))) return toast({ kind: 'error', title: 'Credit Limit Days must be a whole number (0 or more)' });
    setBusy(true);
    try {
      const amt = Math.abs(num(openAmt));
      await saveAccount(mode === 'edit' ? id : null, { ...f, opening: openType === 'credit' ? -amt : amt });
      toast({ kind: 'success', title: `Account for ${f.name.trim()} saved` });
      leave();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the account', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  const notFound = !!id && !!books && !record;
  return (
    <>
      <PageHeader
        eyebrow="Accounting · Accounts"
        title={`${isView ? 'View' : mode === 'edit' ? 'Edit' : 'Add'} Account`}
        actions={
          <>
            {record && (
              <button className="btn btn-subtle" onClick={() => go(av('ledger-view', { account: record.id }))}>
                <ScrollText size={15} /> Ledger
              </button>
            )}
            <button className="btn" onClick={leave}>
              <ArrowLeft size={15} /> Back
            </button>
          </>
        }
      />
      <BooksGate loading={(loading && !books) || (!loaded && !notFound)} error={error} reload={reload}>
        {notFound ? (
          <div className="card">
            <Empty title="Account not found" text="It may have been deleted." action={<button className="btn" onClick={() => go(av('accounts'))}>Back to the list</button>} />
          </div>
        ) : (
          <div className="card">
            <div className="card-body form-page">
              <fieldset disabled={isView} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <div className="acct-stack">
                  <div className="form-grid three">
                    <Field label="Account Type">
                      <div className="acct-radio">
                        {(
                          [
                            ['customer', 'Existing Customer'],
                            ['supplier', 'Existing Supplier'],
                            ['other', 'Other Account'],
                          ] as const
                        ).map(([v, l]) => (
                          <label key={v}>
                            <input type="radio" name="acc-type" checked={f.accountType === v} onChange={() => setF((x) => ({ ...x, accountType: v, customerId: v === 'customer' ? x.customerId : null, supplierId: v === 'supplier' ? x.supplierId : null }))} /> {l}
                          </label>
                        ))}
                      </div>
                    </Field>
                    <Field label="Group Name" required>
                      <select value={f.group} onChange={(e) => set('group', e.target.value)}>
                        <option value="">Select group</option>
                        {GROUP_NAMES.map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Opening Balance" hint="Debit = they owe us / an asset · Credit = we owe them / a liability">
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: 8 }}>
                        <input className="input" type="number" min={0} step="0.01" placeholder="0.00" value={openAmt} onChange={(e) => setOpenAmt(e.target.value)} />
                        <select value={openType} onChange={(e) => setOpenType(e.target.value as 'debit' | 'credit')} aria-label="Debit or credit">
                          <option value="debit">Debit</option>
                          <option value="credit">Credit</option>
                        </select>
                      </div>
                    </Field>
                    {f.accountType === 'customer' && (
                      <Field label="Select Customer" required hint={customers.length === 0 ? 'No customers you may see — add them under Sales & Orders → Customers.' : undefined}>
                        <select value={f.customerId ?? ''} onChange={(e) => pickCustomer(e.target.value)}>
                          <option value="">Select Customer</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id} disabled={linkedC.has(c.id)}>
                              {c.name}
                              {linkedC.has(c.id) ? ' (already has an account)' : ''}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {f.accountType === 'supplier' && (
                      <Field label="Select Supplier" required hint={suppliers.length === 0 ? 'No suppliers you may see — add them under Purchase → Supplier Master.' : undefined}>
                        <select value={f.supplierId ?? ''} onChange={(e) => pickSupplier(e.target.value)}>
                          <option value="">Select Supplier</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id} disabled={linkedS.has(s.id)}>
                              {s.name}
                              {linkedS.has(s.id) ? ' (already has an account)' : ''}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    <Field label="Account Name" required>
                      <input className="input" placeholder="Enter account name" value={f.name} onChange={(e) => set('name', e.target.value)} />
                    </Field>
                    <Field label="Mobile No.">
                      <input className="input" value={f.mobileNo} onChange={(e) => set('mobileNo', e.target.value)} />
                    </Field>
                    <Field label="Area">
                      <input className="input" value={f.area} onChange={(e) => set('area', e.target.value)} />
                    </Field>
                    <Field label="City">
                      <input className="input" value={f.city} onChange={(e) => set('city', e.target.value)} />
                    </Field>
                    <Field label="Pincode">
                      <input className="input" inputMode="numeric" value={f.pincode} onChange={(e) => set('pincode', e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} />
                    </Field>
                    <Field label="State">
                      <select value={f.state} onChange={(e) => set('state', e.target.value)}>
                        <option value="">Select state</option>
                        {[...new Set([...STATES, ...(f.state ? [f.state] : [])])].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="PAN No.">
                      <input className="input" value={f.panNo} onChange={(e) => set('panNo', e.target.value.toUpperCase())} />
                    </Field>
                    <Field label="Aadhar No.">
                      <input className="input" inputMode="numeric" value={f.aadharNo} onChange={(e) => set('aadharNo', e.target.value)} />
                    </Field>
                    <Field label="GSTIN No.">
                      <input className="input" value={f.gstinNo} onChange={(e) => set('gstinNo', e.target.value.toUpperCase())} />
                    </Field>
                    <Field label="Credit Limit Days" hint="Default credit period for this account's Debit bills">
                      <input className="input" type="number" min={0} step={1} value={f.creditDays} onChange={(e) => set('creditDays', e.target.value)} />
                    </Field>
                    {isBank && (
                      <>
                        <Field label="Bank Name">
                          <input className="input" value={f.bankName} onChange={(e) => set('bankName', e.target.value)} />
                        </Field>
                        <Field label="Bank Branch">
                          <input className="input" value={f.bankBranch} onChange={(e) => set('bankBranch', e.target.value)} />
                        </Field>
                        <Field label="IFSC Code">
                          <input className="input" value={f.ifscCode} onChange={(e) => set('ifscCode', e.target.value.toUpperCase())} />
                        </Field>
                        <Field label="Account No.">
                          <input className="input" value={f.bankAccountNo} onChange={(e) => set('bankAccountNo', e.target.value)} />
                        </Field>
                      </>
                    )}
                  </div>
                  <Field label="Other Details" full>
                    <textarea className="input" value={f.otherDetails} onChange={(e) => set('otherDetails', e.target.value)} />
                  </Field>
                </div>
              </fieldset>
              <div className="form-actions">
                <button className="btn" onClick={leave}>
                  {isView ? 'Close' : 'Cancel'}
                </button>
                {write &&
                  (isView ? (
                    <button className="btn btn-primary" onClick={() => setMode('edit')}>
                      <Pencil size={15} /> Edit
                    </button>
                  ) : (
                    <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
                      <Save size={15} /> {mode === 'edit' ? 'Save Changes' : 'Save Account'}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}
      </BooksGate>
    </>
  );
}
