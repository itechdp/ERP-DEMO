// Journal Voucher — one account on one side (Credit or Debit), any number of accounts on the other; both sides must be equal.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Eye, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useAccess } from '../../auth/access';
import { Confirm, Empty, Field, PageHeader, Search, go } from '../../components/ui';
import { fmtDate, matches } from '../../components/format';
import { usePaged } from '../../components/Pager';
import { DocButtons, ListButtons } from '../../export/docOutput';
import { useStore } from '../../store/StoreContext';
import { earliestDate, inr, num, round2 } from '../engine';
import { dateOf, defaultVoucherDate, inFy, useFy } from '../fy';
import { ACC_FORMS, journalSpec } from '../print';
import { deleteEntry, saveJournal } from '../service';
import type { Journal } from '../types';
import { AccountPicker, BooksGate, FyDateHint, FySelector, av, goBack, useAccBooks } from '../components';

const VIEW = 'journal-voucher';

export function JournalList() {
  const { books, loading, error, reload } = useAccBooks();
  const { canWrite } = useAccess();
  const { toast } = useStore();
  const [fy] = useFy();
  const [q, setQ] = useState('');
  const [del, setDel] = useState<Journal | null>(null);
  const write = canWrite('account_vouchers');
  const names = useMemo(() => Object.fromEntries((books?.accounts ?? []).map((a) => [a.id, a.name])) as Record<number, string>, [books]);
  const rows = useMemo(
    () =>
      (books?.journals ?? [])
        .filter((j) => inFy(dateOf(j.date, j.createdAt), fy))
        .filter((j) => matches(q, j.no, names[j.primary], j.narration, j.refNo, ...j.lines.map((l) => names[l.account])))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    [books, fy, q, names],
  );
  const pg = usePaged(rows, `${q}${fy.startYear}`);
  return (
    <>
      <PageHeader
        eyebrow="Accounting · Account Vouchers"
        title="Journal Voucher"
        actions={
          <>
            <FySelector earliest={books ? earliestDate(books) : null} />
            <button className="btn btn-subtle" onClick={() => go(av())}>
              <ArrowLeft size={15} /> Vouchers
            </button>
            <ListButtons doc={() => ({ filename: 'Journal Vouchers', title: 'Journal Voucher Register', form: ACC_FORMS.report, info: [[`FY :- ${fy.label}`]], rows: rows.map((r) => ({ no: r.no, date: r.date, side: r.side === 'credit' ? 'Credit' : 'Debit', acc: names[r.primary], amount: r.amount })), cols: [{ label: 'Voucher No.', key: 'no' }, { label: 'Date', key: 'date', kind: 'date' }, { label: 'Entry Type', key: 'side' }, { label: 'Account', key: 'acc', width: 28 }, { label: 'Amount (₹)', key: 'amount', kind: 'money' }], totals: ['amount'] })} />
            {write && (
              <button className="btn btn-primary" onClick={() => go(av(VIEW, { new: 1 }))}>
                <Plus size={15} /> Add Journal Voucher
              </button>
            )}
          </>
        }
      />
      <BooksGate loading={loading && !books} error={error} reload={reload}>
        <div className="card">
          <div className="card-head">
            <div className="table-search-row">
              <Search value={q} onChange={setQ} placeholder="Search by voucher no., account or narration…" />
            </div>
            <div className="right text-xs muted">
              {rows.length} voucher{rows.length === 1 ? '' : 's'}
              <button className="btn btn-sm btn-subtle" onClick={() => void reload()} disabled={loading}>
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
          </div>
          {rows.length === 0 ? (
            <Empty icon={BookOpen} title="No journal vouchers found" text={q ? 'No voucher matches your search.' : `Nothing recorded in FY ${fy.label}.`} />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Voucher No.</th>
                    <th>Date</th>
                    <th>Entry Type</th>
                    <th>Account</th>
                    <th className="r">Amount</th>
                    <th className="act">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((r) => (
                    <tr key={r.id} className="row-click" onClick={() => go(av(VIEW, { id: r.id, mode: 'view' }))}>
                      <td className="acct-no jv">{r.no}</td>
                      <td className="nowrap">{fmtDate(r.date)}</td>
                      <td>
                        <span className={`badge ${r.side === 'credit' ? 'b-blue' : 'b-green'}`}>{r.side === 'credit' ? 'Credit' : 'Debit'}</span>
                      </td>
                      <td>
                        {names[r.primary] ?? '—'}
                        <div className="sub">↔ {r.lines.map((l) => names[l.account]).filter(Boolean).join(', ')}</div>
                      </td>
                      <td className="r num strong nowrap">{inr(r.amount)}</td>
                      <td className="act" onClick={(e) => e.stopPropagation()}>
                        <div className="icon-actions">
                          <button className="icon-btn" title="View" onClick={() => go(av(VIEW, { id: r.id, mode: 'view' }))}>
                            <Eye size={16} />
                          </button>
                          {write && (
                            <button className="icon-btn" title="Edit" onClick={() => go(av(VIEW, { id: r.id, mode: 'edit' }))}>
                              <Pencil size={16} />
                            </button>
                          )}
                          <DocButtons compact build={(u) => journalSpec(r, names, u)} />
                          {write && (
                            <button className="icon-btn danger" title="Delete" onClick={() => setDel(r)}>
                              <Trash2 size={16} />
                            </button>
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
        title={`Delete journal voucher ${del?.no ?? ''}?`}
        message="It will be removed from every account it is linked to. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onClose={() => setDel(null)}
        onConfirm={() => {
          const j = del!;
          deleteEntry('journal', j.id)
            .then(() => toast({ kind: 'success', title: `Journal voucher ${j.no} deleted` }))
            .catch((e) => toast({ kind: 'error', title: 'Could not delete', message: e instanceof Error ? e.message : String(e) }));
        }}
      />
    </>
  );
}

let keySeq = 0;
type LineRow = { key: string; account: number | null; amount: string };
const newLine = (): LineRow => ({ key: `l${++keySeq}`, account: null, amount: '' });

export function JournalForm({ query }: { query: URLSearchParams }) {
  const { books, loading, error, reload } = useAccBooks();
  const { canWrite } = useAccess();
  const { toast } = useStore();
  const [fy] = useFy();
  const id = Number(query.get('id')) || null;
  const back = query.get('back');
  const [mode, setMode] = useState<'new' | 'view' | 'edit'>(id ? (query.get('mode') === 'edit' ? 'edit' : 'view') : 'new');
  const isView = mode === 'view';
  const write = canWrite('account_vouchers');
  const leave = () => goBack(back, av(VIEW));
  const record = id ? books?.journals.find((j) => j.id === id) : undefined;

  const [side, setSide] = useState<'credit' | 'debit'>('credit');
  const [primary, setPrimary] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [lines, setLines] = useState<LineRow[]>([newLine()]);
  const [date, setDate] = useState(defaultVoucherDate(fy));
  const [narration, setNarration] = useState('');
  const [refNo, setRefNo] = useState('');
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!record || loaded) return;
    setSide(record.side);
    setPrimary(record.primary);
    setAmount(String(record.amount));
    setLines(record.lines.length ? record.lines.map((l) => ({ key: `l${++keySeq}`, account: l.account, amount: String(l.amount) })) : [newLine()]);
    setDate(record.date);
    setNarration(record.narration);
    setRefNo(record.refNo);
    setLoaded(true);
  }, [record, loaded]);

  const accounts = books?.accounts ?? [];
  const amountNum = num(amount);
  const linesTotal = round2(lines.reduce((s, l) => s + num(l.amount), 0));
  const diff = round2(amountNum - linesTotal);
  const balanced = amountNum > 0 && Math.abs(diff) < 0.005;
  const sideLabel = side === 'credit' ? 'Credit' : 'Debit';
  const opp = side === 'credit' ? 'Debit' : 'Credit';
  const update = (key: string, patch: Partial<LineRow>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!primary) return toast({ kind: 'error', title: `Please select the ${sideLabel} account` });
    if (!(amountNum > 0)) return toast({ kind: 'error', title: 'Amount must be greater than 0' });
    const valid = lines.filter((l) => l.account && num(l.amount) > 0);
    if (valid.length === 0) return toast({ kind: 'error', title: `Please add at least one ${opp} line` });
    if (valid.some((l) => l.account === primary)) return toast({ kind: 'error', title: `A ${opp} line can't use the same account as the ${sideLabel} account` });
    if (!balanced) return toast({ kind: 'error', title: `${opp} total (${inr(linesTotal)}) must equal the ${sideLabel} amount (${inr(amountNum)})` });
    setBusy(true);
    try {
      const r = await saveJournal(mode === 'edit' ? id : null, { side, primary, amount, date, narration, refNo, lines: valid.map((l) => ({ account: l.account, amount: l.amount })) });
      toast({ kind: 'success', title: `Journal voucher ${r.voucher_no} saved` });
      leave();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the journal voucher', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  const notFound = !!id && !!books && !record;
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.name])) as Record<number, string>;
  return (
    <>
      <PageHeader
        eyebrow="Accounting · Journal Voucher"
        title={`${isView ? 'View' : mode === 'edit' ? 'Edit' : 'Add'} Journal Voucher`}
        actions={
          <>
            {isView && record && <DocButtons build={(u) => journalSpec(record, names, u)} />}
            <button className="btn" onClick={leave}>
              <ArrowLeft size={15} /> Back
            </button>
          </>
        }
      />
      <BooksGate loading={(loading && !books) || (!loaded && !notFound)} error={error} reload={reload}>
        {notFound ? (
          <div className="card">
            <Empty title="Journal voucher not found" text="It may have been deleted." action={<button className="btn" onClick={() => go(av(VIEW))}>Back to the list</button>} />
          </div>
        ) : (
          <div className="card">
            <div className="card-body form-page">
              <fieldset disabled={isView} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <div className="acct-stack">
                  <div className="form-grid three">
                    <Field label="Entry Type" required>
                      <div className="acct-radio">
                        {(['credit', 'debit'] as const).map((v) => (
                          <label key={v}>
                            <input type="radio" name="jv-side" checked={side === v} onChange={() => setSide(v)} /> {v === 'credit' ? 'Credit' : 'Debit'}
                          </label>
                        ))}
                      </div>
                    </Field>
                    <Field label={`${sideLabel} Account`} required>
                      <AccountPicker accounts={accounts} value={primary} onChange={setPrimary} disabled={isView} />
                    </Field>
                    <Field label="Amount" required>
                      <input className="input" type="number" min={0} step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </Field>
                    <Field label="Date">
                      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                      <FyDateHint date={date} />
                    </Field>
                    <Field label="Voucher Number (Auto)">
                      <div className="acct-auto">{record ? record.no : 'Auto-generated on save'}</div>
                    </Field>
                    <Field label="Ref / Registration No.">
                      <input className="input" placeholder="e.g. GJ06AB1234" value={refNo} onChange={(e) => setRefNo(e.target.value.toUpperCase())} />
                    </Field>
                  </div>

                  <div>
                    <div className="acct-panel-h" style={{ justifyContent: 'space-between' }}>
                      <span>
                        {opp} Entries <span className="req" style={{ color: 'var(--crit)' }}>*</span>
                      </span>
                      {!isView && (
                        <button type="button" className="btn-link" onClick={() => setLines((ls) => [...ls, newLine()])}>
                          <Plus size={14} /> Add Line
                        </button>
                      )}
                    </div>
                    <div className="acct-lines">
                      {lines.map((l) => (
                        <div key={l.key} className="acct-line">
                          <AccountPicker accounts={accounts} value={l.account} onChange={(v) => update(l.key, { account: v })} placeholder={`Select ${opp.toLowerCase()} account`} exclude={primary} disabled={isView} />
                          <input className="input" type="number" min={0} step="0.01" placeholder="0.00" value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} aria-label="Line amount" />
                          {!isView ? (
                            <button type="button" className="icon-btn danger" disabled={lines.length === 1} title="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>
                              <Trash2 size={16} />
                            </button>
                          ) : (
                            <span />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className={`acct-balanced ${balanced ? 'yes' : 'no'}`}>
                      <span>
                        {sideLabel}: <b>{inr(amountNum)}</b> &nbsp;|&nbsp; {opp} Total: <b>{inr(linesTotal)}</b>
                      </span>
                      <b>{balanced ? 'Balanced ✓' : `Out of balance by ${inr(Math.abs(diff))}`}</b>
                    </div>
                  </div>

                  <Field label="Narration" full>
                    <textarea className="input" placeholder="Any notes about this journal entry…" value={narration} onChange={(e) => setNarration(e.target.value)} />
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
                      <Save size={15} /> {mode === 'edit' ? 'Save Changes' : 'Save Journal Voucher'}
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
