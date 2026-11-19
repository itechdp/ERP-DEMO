// Sales Bill · Purchase Bill (GST lines, discount, credit days) and the Bill Items list they pick from.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, Package, Pencil, Plus, RefreshCw, Save, ShoppingBag, ShoppingCart, Trash2 } from 'lucide-react';
import { useAccess } from '../../auth/access';
import { Confirm, Empty, Field, Modal, PageHeader, Search, go } from '../../components/ui';
import { fmtDate, matches } from '../../components/format';
import { usePaged } from '../../components/Pager';
import { DocButtons, ListButtons } from '../../export/docOutput';
import { useStore } from '../../store/StoreContext';
import { billTotals, earliestDate, inr, lineExclTax, lineInclTax, lineTax, num, rateFromInclTax } from '../engine';
import { addDays, dateOf, defaultVoucherDate, inFy, useFy } from '../fy';
import { ACC_FORMS, billSpec } from '../print';
import { deleteEntry, deleteItem, fetchBillItems, fetchDraft, saveBill, saveDraftEdits, saveItem, useItems } from '../service';
import type { Bill, BillKind, Draft, Item } from '../types';
import { AccountPicker, BooksGate, FyDateHint, FySelector, av, goBack, useAccBooks } from '../components';

const CFG: Record<BillKind, { title: string; view: string; party: string; icon: typeof ShoppingCart; rateOf: (i: Item) => number }> = {
  sales: { title: 'Sales Bill', view: 'sales-bill', party: 'Customer Name', icon: ShoppingCart, rateOf: (i) => i.sellRate },
  purchase: { title: 'Purchase Bill', view: 'purchase-bill', party: 'Supplier Name', icon: ShoppingBag, rateOf: (i) => i.purchaseRate },
};
const TAX_RATES = ['0', '5', '12', '18', '28'];

const partyOf = (b: Bill, names: Record<number, string>) => (b.mode === 'Cash' ? (b.kind === 'sales' ? 'Cash Customer' : 'Cash Purchase') : (b.account != null ? names[b.account] : '') || b.partyName || '—');

// ------------------------------------------------------------------ list ---
export function BillList({ kind }: { kind: BillKind }) {
  const cfg = CFG[kind];
  const { books, loading, error, reload } = useAccBooks();
  const { canWrite } = useAccess();
  const { toast } = useStore();
  const [fy] = useFy();
  const [q, setQ] = useState('');
  const [del, setDel] = useState<Bill | null>(null);
  const write = canWrite('account_vouchers');
  const names = useMemo(() => Object.fromEntries((books?.accounts ?? []).map((a) => [a.id, a.name])) as Record<number, string>, [books]);
  const rows = useMemo(
    () =>
      (books?.bills ?? [])
        .filter((b) => b.kind === kind && inFy(dateOf(b.date, b.createdAt), fy))
        .filter((b) => matches(q, b.no, partyOf(b, names), b.refNo, b.mode))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    [books, kind, fy, q, names],
  );
  const pg = usePaged(rows, `${kind}${q}${fy.startYear}`);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const printOf = async (b: Bill, u: string) => billSpec(b, await fetchBillItems(b.id), books?.accounts.find((a) => a.id === b.account), u);
  return (
    <>
      <PageHeader
        eyebrow="Accounting · Account Vouchers"
        title={cfg.title}
        actions={
          <>
            <FySelector earliest={books ? earliestDate(books) : null} />
            <button className="btn btn-subtle" onClick={() => go(av())}>
              <ArrowLeft size={15} /> Vouchers
            </button>
            <button className="btn btn-subtle" onClick={() => go(av('items'))}>
              <Package size={15} /> Bill Items
            </button>
            <ListButtons doc={() => ({ filename: cfg.title, title: `${cfg.title} Register`, form: ACC_FORMS.report, info: [[`FY :- ${fy.label}`]], rows: rows.map((r) => ({ no: r.no, date: r.date, party: partyOf(r, names), mode: r.mode, taxable: r.taxable, tax: r.tax, discount: r.discount, total: r.total })), cols: [{ label: 'Bill No.', key: 'no' }, { label: 'Bill Date', key: 'date', kind: 'date' }, { label: cfg.party, key: 'party', width: 28 }, { label: 'Mode', key: 'mode' }, { label: 'Taxable (₹)', key: 'taxable', kind: 'money' }, { label: 'Tax (₹)', key: 'tax', kind: 'money' }, { label: 'Discount (₹)', key: 'discount', kind: 'money' }, { label: 'Amount (₹)', key: 'total', kind: 'money' }], totals: ['taxable', 'tax', 'discount', 'total'] })} />
            {write && (
              <button className="btn btn-primary" onClick={() => go(av(cfg.view, { new: 1 }))}>
                <Plus size={15} /> Add {cfg.title}
              </button>
            )}
          </>
        }
      />
      <BooksGate loading={loading && !books} error={error} reload={reload}>
        <div className="card">
          <div className="card-head">
            <div className="table-search-row">
              <Search value={q} onChange={setQ} placeholder="Search by bill no., party or reference no…" />
            </div>
            <div className="right text-xs muted">
              {rows.length} bill{rows.length === 1 ? '' : 's'} · {inr(total)}
              <button className="btn btn-sm btn-subtle" onClick={() => void reload()} disabled={loading}>
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
          </div>
          {rows.length === 0 ? (
            <Empty icon={cfg.icon} title={`No ${cfg.title.toLowerCase()}s found`} text={q ? 'No bill matches your search.' : `Nothing recorded in FY ${fy.label}.`} />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Bill No.</th>
                    <th>Bill Date</th>
                    <th>{cfg.party}</th>
                    <th>Mode</th>
                    <th className="r">Amount</th>
                    <th className="act">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((r) => (
                    <tr key={r.id} className="row-click" onClick={() => go(av(cfg.view, { id: r.id, mode: 'view' }))}>
                      <td className={`acct-no ${kind === 'sales' ? 'in' : 'out'}`}>{r.no}</td>
                      <td className="nowrap">{fmtDate(r.date)}</td>
                      <td>{partyOf(r, names)}</td>
                      <td>
                        <span className={`badge ${r.mode === 'Debit' ? 'b-blue' : 'b-neutral'}`}>{r.mode}</span>
                      </td>
                      <td className="r num strong nowrap">{inr(r.total)}</td>
                      <td className="act" onClick={(e) => e.stopPropagation()}>
                        <div className="icon-actions">
                          <button className="icon-btn" title="View" onClick={() => go(av(cfg.view, { id: r.id, mode: 'view' }))}>
                            <Eye size={16} />
                          </button>
                          {write && (
                            <button className="icon-btn" title="Edit" onClick={() => go(av(cfg.view, { id: r.id, mode: 'edit' }))}>
                              <Pencil size={16} />
                            </button>
                          )}
                          <DocButtons compact build={(u) => printOf(r, u)} />
                          {write && (
                            <button className="icon-btn danger" title="Delete" onClick={() => setDel(r)}>
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={4} className="strong">
                      Total
                    </td>
                    <td className="r num strong nowrap">{inr(total)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              {pg.pager}
            </div>
          )}
        </div>
      </BooksGate>
      <Confirm
        open={!!del}
        title={`Delete ${cfg.title.toLowerCase()} ${del?.no ?? ''}?`}
        message="The bill and its items will be removed from the books. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onClose={() => setDel(null)}
        onConfirm={() => {
          const b = del!;
          deleteEntry('bill', b.id)
            .then(() => toast({ kind: 'success', title: `${cfg.title} ${b.no} deleted` }))
            .catch((e) => toast({ kind: 'error', title: 'Could not delete', message: e instanceof Error ? e.message : String(e) }));
        }}
      />
    </>
  );
}

// ------------------------------------------------------------------ form ---
type Row = { key: string; itemId: number | null; itemName: string; hsnCode: string; qty: string; rate: string; gstType: 'CGST/SGST' | 'IGST'; taxRate: string };
let seq = 0;
const emptyRow = (): Row => ({ key: `r${++seq}`, itemId: null, itemName: '', hsnCode: '', qty: '1', rate: '', gstType: 'CGST/SGST', taxRate: '0' });
const DEFAULT_CREDIT_DAYS = 7;

export function BillForm({ kind, query }: { kind: BillKind; query: URLSearchParams }) {
  const cfg = CFG[kind];
  const { books, loading, error, reload } = useAccBooks();
  const { items: itemList } = useItems();
  const { canWrite } = useAccess();
  const { toast } = useStore();
  const [fy] = useFy();
  const id = Number(query.get('id')) || null;
  const draftId = Number(query.get('draft')) || null;
  const back = query.get('back');
  const [mode, setMode] = useState<'new' | 'view' | 'edit'>(id ? (query.get('mode') === 'edit' ? 'edit' : 'view') : 'new');
  const isView = mode === 'view';
  const write = canWrite(draftId ? 'voucher_approvals' : 'account_vouchers');
  const leave = () => goBack(back, draftId ? 'voucher-approvals' : av(cfg.view));
  const record = id ? books?.bills.find((b) => b.id === id && b.kind === kind) : undefined;

  const [payMode, setPayMode] = useState<'Cash' | 'Debit'>('Debit');
  const [account, setAccount] = useState<number | null>(null);
  const [date, setDate] = useState(defaultVoucherDate(fy));
  const [refNo, setRefNo] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [discount, setDiscount] = useState('');
  const [creditDays, setCreditDays] = useState(id ? '' : String(DEFAULT_CREDIT_DAYS));
  const [inclDraft, setInclDraft] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(!id && !draftId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!record || loaded) return;
    let alive = true;
    fetchBillItems(record.id)
      .then((its) => {
        if (!alive) return;
        setPayMode(record.mode);
        setAccount(record.account);
        setDate(record.date);
        setRefNo(record.refNo);
        setDiscount(record.discount ? String(record.discount) : '');
        setCreditDays(record.creditDays != null ? String(record.creditDays) : '');
        setRows(its.length ? its.map((i) => ({ key: `r${++seq}`, itemId: i.itemId, itemName: i.itemName, hsnCode: i.hsnCode, qty: String(i.qty), rate: String(i.rate), gstType: i.gstType, taxRate: String(i.taxRate) })) : [emptyRow()]);
        setLoaded(true);
      })
      .catch((e) => toast({ kind: 'error', title: 'Could not load the bill', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [record, loaded, toast]);

  useEffect(() => {
    if (!draftId) return;
    fetchDraft(draftId)
      .then((d) => {
        if (!d || d.status !== 'pending') {
          toast({ kind: 'error', title: 'This draft is no longer pending' });
          go('voucher-approvals');
          return;
        }
        setDraft(d);
        setPayMode(d.paymentMode);
        setAccount(d.account);
        if (d.date) setDate(d.date);
        setRefNo(d.refNo);
        setDiscount(d.discount ? String(d.discount) : '');
        if (d.items.length) setRows(d.items.map((i) => ({ key: `r${++seq}`, itemId: Number(i.itemId) || null, itemName: i.itemName, hsnCode: i.hsnCode || '', qty: String(i.qty ?? '1'), rate: String(i.rate ?? ''), gstType: i.gstType === 'IGST' ? 'IGST' : 'CGST/SGST', taxRate: String(i.taxRate ?? '0') })));
        setLoaded(true);
      })
      .catch((e) => toast({ kind: 'error', title: 'Could not open the draft', message: e instanceof Error ? e.message : String(e) }));
  }, [draftId, toast]);

  const accounts = books?.accounts ?? [];
  const accountObj = accounts.find((a) => a.id === account);
  const totals = billTotals(rows, discount);
  const creditNum = creditDays.trim() === '' ? null : Math.max(0, Math.floor(Number(creditDays) || 0));
  const due = payMode === 'Debit' && creditNum != null && date ? addDays(date, creditNum) : '';
  const activeItems = itemList.filter((i) => i.active);

  const setRow = (key: string, patch: Partial<Row>, keepIncl = false) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    if (!keepIncl) setInclDraft(({ [key]: _, ...rest }) => rest);
  };
  const pickAccount = (v: number | null) => {
    setAccount(v);
    const a = accounts.find((x) => x.id === v);
    if (a && a.creditDays != null && mode === 'new') setCreditDays(String(a.creditDays));
  };
  const pickItem = (key: string, itemId: string) => {
    const it = itemList.find((i) => i.id === Number(itemId));
    if (!it) return setRow(key, { itemId: null });
    setRow(key, { itemId: it.id, itemName: it.name, hsnCode: it.hsnCode, rate: String(cfg.rateOf(it)), taxRate: String(it.taxRate) });
  };
  const setIncl = (r: Row, v: string) => {
    setInclDraft((d) => ({ ...d, [r.key]: v }));
    const rate = rateFromInclTax(v, r.qty, r.taxRate);
    if (rate != null) setRow(r.key, { rate }, true);
  };

  const payload = () => ({ mode: payMode, account: payMode === 'Debit' ? account : null, date, refNo, discount, creditDays: payMode === 'Debit' ? creditDays : '', items: rows.filter((r) => r.itemName.trim()).map((r) => ({ itemId: r.itemId, itemName: r.itemName.trim(), hsnCode: r.hsnCode, qty: r.qty, rate: r.rate, gstType: r.gstType, taxRate: r.taxRate })) });

  const save = async () => {
    if (payMode === 'Debit' && !account) return toast({ kind: 'error', title: 'Please select an account for a Debit bill' });
    if (!rows.some((r) => r.itemName.trim())) return toast({ kind: 'error', title: 'Add at least one item' });
    setBusy(true);
    try {
      const r = await saveBill(kind, mode === 'edit' ? id : null, payload(), draftId);
      toast({ kind: 'success', title: `${cfg.title} ${r.voucher_no} saved`, message: draftId ? 'The draft is approved and recorded in the books.' : undefined });
      leave();
    } catch (e) {
      toast({ kind: 'error', title: `Could not save the ${cfg.title.toLowerCase()}`, message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };
  const saveDraftOnly = async () => {
    if (!draftId) return;
    setBusy(true);
    try {
      await saveDraftEdits(draftId, {
        paymentMode: payMode, account: payMode === 'Debit' ? account : null, date, refNo, discount: num(discount),
        items: rows.filter((r) => r.itemName.trim()).map((r) => ({ itemId: r.itemId ? String(r.itemId) : '', itemName: r.itemName, hsnCode: r.hsnCode, qty: r.qty, rate: r.rate, gstType: r.gstType, taxRate: r.taxRate })),
        amount: totals.total > 0 ? totals.total : undefined,
      });
      toast({ kind: 'success', title: 'Draft saved', message: 'Approve it from the list when ready.' });
      leave();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the draft', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  const notFound = !!id && !!books && !record;
  return (
    <>
      <PageHeader
        eyebrow={`Accounting · ${cfg.title}`}
        title={`${isView ? 'View' : mode === 'edit' ? 'Edit' : draftId ? 'Review & Approve' : 'Add'} ${cfg.title}`}
        subtitle={draft ? `Proposed from ${draft.sourceRef} (expected total ${inr(draft.amount)}) — check the items and tax, then save to approve.` : undefined}
        actions={
          <>
            {isView && record && <DocButtons build={async (u) => billSpec(record, await fetchBillItems(record.id), accountObj, u)} />}
            <button className="btn" onClick={leave}>
              <ArrowLeft size={15} /> Back
            </button>
          </>
        }
      />
      <BooksGate loading={(loading && !books) || (!loaded && !notFound)} error={error} reload={reload}>
        {notFound ? (
          <div className="card">
            <Empty title="Bill not found" text="It may have been deleted." action={<button className="btn" onClick={() => go(av(cfg.view))}>Back to the list</button>} />
          </div>
        ) : (
          <div className="card">
            <div className="card-body form-page">
              <fieldset disabled={isView} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <div className="acct-stack">
                  <div className="form-grid three">
                    <Field label="Payment Mode" required hint={payMode === 'Cash' ? 'A Cash bill is recorded and printed but does not post to any ledger account.' : undefined}>
                      <div className="acct-radio">
                        {(['Debit', 'Cash'] as const).map((v) => (
                          <label key={v}>
                            <input type="radio" name="bill-mode" checked={payMode === v} onChange={() => setPayMode(v)} /> {v}
                          </label>
                        ))}
                      </div>
                    </Field>
                    <Field label="Bill Date">
                      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                      <FyDateHint date={date} />
                    </Field>
                    <Field label="Bill Number (Auto)">
                      <div className="acct-auto">{record ? record.no : 'Auto-generated on save'}</div>
                    </Field>
                    {payMode === 'Debit' && (
                      <Field label={kind === 'sales' ? 'Select Customer Account' : 'Select Supplier Account'} required hint={accountObj ? [accountObj.gstinNo && `GSTIN ${accountObj.gstinNo}`, [accountObj.city, accountObj.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || undefined : undefined}>
                        <AccountPicker accounts={accounts} value={account} onChange={pickAccount} disabled={isView} />
                      </Field>
                    )}
                    <Field label="Ref / Registration No.">
                      <input className="input" placeholder="e.g. vehicle / reference no." value={refNo} onChange={(e) => setRefNo(e.target.value.toUpperCase())} />
                    </Field>
                    {payMode === 'Debit' && (
                      <Field label="Credit Days" hint={due ? `Due on ${fmtDate(due)}` : undefined}>
                        <input className="input" type="number" min={0} step={1} value={creditDays} onChange={(e) => setCreditDays(e.target.value)} />
                      </Field>
                    )}
                  </div>

                  <div>
                    <div className="acct-panel-h" style={{ justifyContent: 'space-between' }}>
                      <span>Items</span>
                      {!isView && (
                        <button type="button" className="btn-link" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
                          <Plus size={14} /> Add Item
                        </button>
                      )}
                    </div>
                    <div className="table-wrap">
                      <table className="tbl form-tbl compact">
                        <thead>
                          <tr>
                            <th style={{ minWidth: 200 }}>Item</th>
                            <th>HSN</th>
                            <th className="r">Qty</th>
                            <th className="r">Rate (Excl. Tax)</th>
                            <th>GST</th>
                            <th>Tax %</th>
                            <th className="r">Taxable</th>
                            <th className="r">Tax</th>
                            <th className="r">Incl. Tax</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.key}>
                              <td>
                                <div style={{ display: 'grid', gap: 6 }}>
                                  {activeItems.length > 0 && (
                                    <select value={r.itemId ?? ''} onChange={(e) => pickItem(r.key, e.target.value)} aria-label="Pick from Bill Items">
                                      <option value="">Pick an item…</option>
                                      {activeItems.map((i) => (
                                        <option key={i.id} value={i.id}>
                                          {i.name}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                  <input placeholder="Item name" value={r.itemName} onChange={(e) => setRow(r.key, { itemName: e.target.value, itemId: null })} aria-label="Item name" />
                                </div>
                              </td>
                              <td>
                                <input style={{ width: 90 }} value={r.hsnCode} onChange={(e) => setRow(r.key, { hsnCode: e.target.value })} aria-label="HSN code" />
                              </td>
                              <td>
                                <input style={{ width: 80, textAlign: 'right' }} type="number" min={0} step="any" value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} aria-label="Quantity" />
                              </td>
                              <td>
                                <input style={{ width: 110, textAlign: 'right' }} type="number" min={0} step="0.01" value={r.rate} onChange={(e) => setRow(r.key, { rate: e.target.value })} aria-label="Rate" />
                              </td>
                              <td>
                                <select value={r.gstType} onChange={(e) => setRow(r.key, { gstType: e.target.value as Row['gstType'] })} aria-label="GST type">
                                  <option>CGST/SGST</option>
                                  <option>IGST</option>
                                </select>
                              </td>
                              <td>
                                <select value={r.taxRate} onChange={(e) => setRow(r.key, { taxRate: e.target.value })} aria-label="Tax rate">
                                  {[...new Set([...TAX_RATES, r.taxRate])].map((t) => (
                                    <option key={t} value={t}>
                                      {t}%
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="r num nowrap">{inr(lineExclTax(r))}</td>
                              <td className="r num nowrap">{inr(lineTax(r))}</td>
                              <td>
                                <input style={{ width: 120, textAlign: 'right' }} type="number" min={0} step="0.01" value={inclDraft[r.key] ?? String(lineInclTax(r))} onChange={(e) => setIncl(r, e.target.value)} aria-label="Amount including tax" title="Type the tax-inclusive amount to work out the rate" />
                              </td>
                              <td>
                                {!isView && (
                                  <button type="button" className="icon-btn danger" disabled={rows.length === 1} title="Remove item" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}>
                                    <Trash2 size={15} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {activeItems.length === 0 && !isView && <div className="text-xs muted" style={{ marginTop: 8 }}>No Bill Items yet — type the item name, or add items with the Bill Items button on the {cfg.title} list.</div>}
                  </div>

                  <div className="acct-totals">
                    <div>
                      <span className="muted">Taxable Amount</span>
                      <b className="num">{inr(totals.taxable)}</b>
                    </div>
                    <div>
                      <span className="muted">Tax Amount</span>
                      <b className="num">{inr(totals.tax)}</b>
                    </div>
                    <div style={{ alignItems: 'center' }}>
                      <span className="muted">Discount</span>
                      <input className="input" type="number" min={0} step="0.01" placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-label="Discount" />
                    </div>
                    <div className="big">
                      <span>Total Amount</span>
                      <span className="num">{inr(totals.total)}</span>
                    </div>
                  </div>
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
                    <>
                      {draftId && (
                        <button className="btn btn-subtle" disabled={busy} onClick={() => void saveDraftOnly()}>
                          Save Draft
                        </button>
                      )}
                      <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
                        <Save size={15} /> {mode === 'edit' ? 'Save Changes' : draftId ? `Approve & Save ${cfg.title}` : `Save ${cfg.title}`}
                      </button>
                    </>
                  ))}
              </div>
            </div>
          </div>
        )}
      </BooksGate>
    </>
  );
}

// ------------------------------------------------------------ bill items ---
export function ItemsPage() {
  const { items, loading, error, reload } = useItems();
  const { canWrite } = useAccess();
  const { toast } = useStore();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [del, setDel] = useState<Item | null>(null);
  const write = canWrite('account_vouchers');
  const rows = items.filter((i) => matches(q, i.name, i.hsnCode, i.unit));
  return (
    <>
      <PageHeader
        eyebrow="Accounting · Account Vouchers"
        title="Bill Items"
        subtitle="The items offered on Sales and Purchase Bills, with their HSN code, rates and GST %."
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => go(av())}>
              <ArrowLeft size={15} /> Vouchers
            </button>
            {write && (
              <button className="btn btn-primary" onClick={() => setEdit('new')}>
                <Plus size={15} /> Add Item
              </button>
            )}
          </>
        }
      />
      <div className="card">
        <div className="card-head">
          <div className="table-search-row">
            <Search value={q} onChange={setQ} placeholder="Search items…" />
          </div>
          <div className="right text-xs muted">{rows.length} items</div>
        </div>
        {loading ? (
          <div className="card-center-msg">Loading items…</div>
        ) : error ? (
          <Empty title="Not available" text={error} action={<button className="btn" onClick={() => void reload()}>Try again</button>} />
        ) : rows.length === 0 ? (
          <Empty icon={Package} title="No items yet" text="Add the goods and services you bill." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>HSN</th>
                  <th>Unit</th>
                  <th className="r">Sell Rate</th>
                  <th className="r">Purchase Rate</th>
                  <th className="r">GST %</th>
                  <th>Status</th>
                  {write && <th className="act">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td className="strong">{i.name}</td>
                    <td>{i.hsnCode || '—'}</td>
                    <td>{i.unit || '—'}</td>
                    <td className="r num">{inr(i.sellRate)}</td>
                    <td className="r num">{inr(i.purchaseRate)}</td>
                    <td className="r num">{i.taxRate}%</td>
                    <td>
                      <span className={`badge ${i.active ? 'b-green' : 'b-neutral'}`}>{i.active ? 'Active' : 'Off'}</span>
                    </td>
                    {write && (
                      <td className="act">
                        <div className="icon-actions">
                          <button className="icon-btn" title="Edit" onClick={() => setEdit(i)}>
                            <Pencil size={16} />
                          </button>
                          <button className="icon-btn danger" title="Delete" onClick={() => setDel(i)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <ItemModal item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
      <Confirm
        open={!!del}
        title={`Delete item "${del?.name ?? ''}"?`}
        message="Bills that used it keep the item name."
        confirmLabel="Delete"
        tone="danger"
        onClose={() => setDel(null)}
        onConfirm={() => {
          const i = del!;
          deleteItem(i.id)
            .then(() => {
              toast({ kind: 'success', title: `${i.name} deleted` });
              void reload();
            })
            .catch((e) => toast({ kind: 'error', title: 'Could not delete', message: e instanceof Error ? e.message : String(e) }));
        }}
      />
    </>
  );
}

function ItemModal({ item, onClose, onSaved }: { item: Item | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useStore();
  const [f, setF] = useState({ name: item?.name ?? '', hsnCode: item?.hsnCode ?? '', unit: item?.unit ?? '', sellRate: String(item?.sellRate ?? ''), purchaseRate: String(item?.purchaseRate ?? ''), taxRate: String(item?.taxRate ?? '18'), active: item?.active ?? true });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await saveItem(item?.id ?? null, { name: f.name, hsnCode: f.hsnCode, unit: f.unit, sellRate: num(f.sellRate), purchaseRate: num(f.purchaseRate), taxRate: num(f.taxRate), active: f.active });
      toast({ kind: 'success', title: item ? 'Item updated' : 'Item added', message: f.name });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the item', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };
  return (
    <Modal
      dialog
      open
      onClose={onClose}
      title={item ? `Edit ${item.name}` : 'Add Bill Item'}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !f.name.trim()} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Item Name" required full>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="HSN / SAC Code">
          <input className="input" value={f.hsnCode} onChange={(e) => setF({ ...f, hsnCode: e.target.value })} />
        </Field>
        <Field label="Unit">
          <input className="input" placeholder="PCS, KG, NOS…" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
        </Field>
        <Field label="Sell Rate (₹)">
          <input className="input" type="number" min={0} step="0.01" value={f.sellRate} onChange={(e) => setF({ ...f, sellRate: e.target.value })} />
        </Field>
        <Field label="Purchase Rate (₹)">
          <input className="input" type="number" min={0} step="0.01" value={f.purchaseRate} onChange={(e) => setF({ ...f, purchaseRate: e.target.value })} />
        </Field>
        <Field label="GST %">
          <select value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: e.target.value })}>
            {[...new Set([...TAX_RATES, f.taxRate])].map((t) => (
              <option key={t} value={t}>
                {t}%
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}>
            <option value="1">Active</option>
            <option value="0">Off (not offered on bills)</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}
