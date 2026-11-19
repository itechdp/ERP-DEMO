// Cash Receipt · Cash Payment · Bank Receipt · Bank Payment · Contra Entry — one list and one form, configured per type.
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowLeftRight, ArrowUp, ArrowUpFromLine, Banknote, Eye, Landmark, Pencil, Plus, RefreshCw, Save, Trash2, Wallet } from 'lucide-react';
import { useAccess } from '../../auth/access';
import { Confirm, Empty, Field, PageHeader, Search, go, type Icon } from '../../components/ui';
import { fmtDate, matches } from '../../components/format';
import { usePaged } from '../../components/Pager';
import { DocButtons, ListButtons } from '../../export/docOutput';
import { useStore } from '../../store/StoreContext';
import { accountBalance, denominationFromPayload, denominationPayload, denominationTotal, inr, num, round2, type DenomInput } from '../engine';
import { dateOf, defaultVoucherDate, inFy, useFy } from '../fy';
import { ACC_FORMS, voucherSpec } from '../print';
import { deleteEntry, fetchDraft, saveDraftEdits, saveVoucher } from '../service';
import { BANK_CASH_GROUPS, CASH_GROUPS, KIND_SOURCE, type Account, type Draft, type Voucher, type VoucherKind } from '../types';
import { AccountPicker, BalanceCard, BooksGate, DenominationInput, FyDateHint, FySelector, av, goBack, useAccBooks } from '../components';
import { earliestDate } from '../engine';

interface KindCfg {
  title: string;
  view: string;
  icon: Icon;
  amountLabel: string;
  /** groups the From / To account must belong to (null = any account) */
  fromGroups: string[] | null;
  toGroups: string[] | null;
  fromPlaceholder: string;
  toPlaceholder: string;
  fromCard: string;
  toCard: string;
  verb: string;
  cash: boolean;
  bank: boolean;
  receipt: boolean;
  /** the colour of the voucher number in lists */
  tone: 'in' | 'out' | 'jv';
}

export const KIND_CFG: Record<VoucherKind, KindCfg> = {
  cash_receipt: { title: 'Cash Receipt', view: 'cash-receipt', icon: Wallet, amountLabel: 'Received Amount', fromGroups: null, toGroups: CASH_GROUPS, fromPlaceholder: 'Select party account', toPlaceholder: 'Select cash account', fromCard: 'From Account — Payable', toCard: 'To Account — Cash Balance', verb: 'receipt', cash: true, bank: false, receipt: true, tone: 'in' },
  cash_payment: { title: 'Cash Payment', view: 'cash-payment', icon: Banknote, amountLabel: 'Paid Amount', fromGroups: CASH_GROUPS, toGroups: null, fromPlaceholder: 'Select cash account', toPlaceholder: 'Select party account', fromCard: 'From Account — Cash Balance', toCard: 'To Account — Amount Owed', verb: 'payment', cash: true, bank: false, receipt: false, tone: 'out' },
  bank_receipt: { title: 'Bank Receipt', view: 'bank-receipt', icon: Landmark, amountLabel: 'Received Amount', fromGroups: null, toGroups: BANK_CASH_GROUPS, fromPlaceholder: 'Select party account', toPlaceholder: 'Select bank account', fromCard: 'From Account — Payable', toCard: 'To Account — Bank Balance', verb: 'receipt', cash: false, bank: true, receipt: true, tone: 'in' },
  bank_payment: { title: 'Bank Payment', view: 'bank-payment', icon: ArrowUpFromLine, amountLabel: 'Paid Amount', fromGroups: BANK_CASH_GROUPS, toGroups: null, fromPlaceholder: 'Select bank account', toPlaceholder: 'Select party account', fromCard: 'From Account — Bank Balance', toCard: 'To Account — Amount Owed', verb: 'payment', cash: false, bank: true, receipt: false, tone: 'out' },
  contra: { title: 'Contra Entry', view: 'contra-entry', icon: ArrowLeftRight, amountLabel: 'Transfer Amount', fromGroups: BANK_CASH_GROUPS, toGroups: BANK_CASH_GROUPS, fromPlaceholder: 'Select bank/cash account', toPlaceholder: 'Select bank/cash account', fromCard: 'From Account — Balance', toCard: 'To Account — Balance', verb: 'transfer', cash: false, bank: false, receipt: false, tone: 'jv' },
};

export const VIEW_KIND: Record<string, VoucherKind> = Object.fromEntries(Object.entries(KIND_CFG).map(([k, c]) => [c.view, k as VoucherKind]));

const nameMap = (accounts: Account[]) => Object.fromEntries(accounts.map((a) => [a.id, a.name])) as Record<number, string>;

// ------------------------------------------------------------------ list ---
export function VoucherList({ kind }: { kind: VoucherKind }) {
  const cfg = KIND_CFG[kind];
  const { books, loading, error, reload } = useAccBooks();
  const { canWrite } = useAccess();
  const { toast } = useStore();
  const [fy] = useFy();
  const [q, setQ] = useState('');
  const [del, setDel] = useState<Voucher | null>(null);
  const write = canWrite('account_vouchers');
  const names = useMemo(() => nameMap(books?.accounts ?? []), [books]);
  const rows = useMemo(
    () =>
      (books?.vouchers ?? [])
        .filter((v) => v.kind === kind && inFy(dateOf(v.date, v.createdAt), fy))
        .filter((v) => matches(q, v.no, names[v.from], names[v.to], v.refNo, v.narration))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    [books, kind, fy, q, names],
  );
  const pg = usePaged(rows, `${kind}${q}${fy.startYear}`);
  const total = rows.reduce((s, r) => s + r.amount, 0);

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
            <ListButtons doc={() => ({ filename: cfg.title, title: `${cfg.title} Register`, form: ACC_FORMS.report, info: [[`FY :- ${fy.label}`]], rows: rows.map((r) => ({ no: r.no, date: r.date, from: names[r.from], to: names[r.to], ref: r.refNo, amount: r.amount })), cols: [{ label: 'Voucher No.', key: 'no' }, { label: 'Date', key: 'date', kind: 'date' }, { label: 'From Account', key: 'from', width: 26 }, { label: 'To Account', key: 'to', width: 26 }, { label: 'Ref / Reg. No.', key: 'ref' }, { label: 'Amount (₹)', key: 'amount', kind: 'money' }], totals: ['amount'] })} />
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
              <Search value={q} onChange={setQ} placeholder="Search by voucher no., account name, or reference no…" />
            </div>
            <div className="right text-xs muted">
              {rows.length} voucher{rows.length === 1 ? '' : 's'} · {inr(total)}
              <button className="btn btn-sm btn-subtle" onClick={() => void reload()} disabled={loading}>
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
          </div>
          {rows.length === 0 ? (
            <Empty icon={cfg.icon} title={`No ${cfg.title.toLowerCase()}s found`} text={q ? 'No voucher matches your search.' : `Nothing recorded in FY ${fy.label}.`} />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Voucher No.</th>
                    <th>Date</th>
                    <th>From Account</th>
                    <th>To Account</th>
                    <th className="r">Amount</th>
                    <th className="act">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((r) => (
                    <tr key={r.id} className="row-click" onClick={() => go(av(cfg.view, { id: r.id, mode: 'view' }))}>
                      <td className={`acct-no ${cfg.tone}`}>{r.no}</td>
                      <td className="nowrap">{fmtDate(r.date)}</td>
                      <td>{names[r.from] ?? '—'}</td>
                      <td>{names[r.to] ?? '—'}</td>
                      <td className="r num strong nowrap">{inr(r.amount)}</td>
                      <td className="act" onClick={(e) => e.stopPropagation()}>
                        <div className="icon-actions">
                          <button className="icon-btn" title="View" aria-label={`View ${r.no}`} onClick={() => go(av(cfg.view, { id: r.id, mode: 'view' }))}>
                            <Eye size={16} />
                          </button>
                          {write && (
                            <button className="icon-btn" title="Edit" aria-label={`Edit ${r.no}`} onClick={() => go(av(cfg.view, { id: r.id, mode: 'edit' }))}>
                              <Pencil size={16} />
                            </button>
                          )}
                          <DocButtons compact build={(u) => voucherSpec(r, names, u)} />
                          {write && (
                            <button className="icon-btn danger" title="Delete" aria-label={`Delete ${r.no}`} onClick={() => setDel(r)}>
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
        message="It will be removed from every account it is linked to. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onClose={() => setDel(null)}
        onConfirm={() => {
          const v = del!;
          deleteEntry('voucher', v.id)
            .then(() => toast({ kind: 'success', title: `${cfg.title} ${v.no} deleted` }))
            .catch((e) => toast({ kind: 'error', title: 'Could not delete', message: e instanceof Error ? e.message : String(e) }));
        }}
      />
    </>
  );
}

// ------------------------------------------------------------------ form ---
export function VoucherForm({ kind, query }: { kind: VoucherKind; query: URLSearchParams }) {
  const cfg = KIND_CFG[kind];
  const { books, loading, error, reload } = useAccBooks();
  const { canWrite } = useAccess();
  const { toast } = useStore();
  const [fy] = useFy();
  const id = Number(query.get('id')) || null;
  const draftId = Number(query.get('draft')) || null;
  const back = query.get('back');
  const [mode, setMode] = useState<'new' | 'view' | 'edit'>(id ? (query.get('mode') === 'edit' ? 'edit' : 'view') : 'new');
  const isView = mode === 'view';
  const write = canWrite(draftId ? 'voucher_approvals' : 'account_vouchers');
  const listRoute = av(cfg.view);
  const leave = () => goBack(back, draftId ? 'voucher-approvals' : listRoute);

  const record = id ? books?.vouchers.find((v) => v.id === id && v.kind === kind) : undefined;
  const [f, setF] = useState({ from: null as number | null, to: null as number | null, amount: '', date: defaultVoucherDate(fy), narration: '', refNo: '', billNo: '', chequeNo: '', chequeDate: '', drawnOn: '' });
  const [den, setDen] = useState<DenomInput>({});
  const [ret, setRet] = useState<DenomInput>({});
  const [loaded, setLoaded] = useState(!id && !draftId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  // fill the form from the saved voucher
  useEffect(() => {
    if (!id || loaded || !books) return;
    if (!record) return;
    setF({ from: record.from, to: record.to, amount: String(record.amount), date: record.date, narration: record.narration, refNo: record.refNo, billNo: record.billNo, chequeNo: record.chequeNo, chequeDate: record.chequeDate, drawnOn: record.drawnOn });
    setDen(denominationFromPayload(record.denomination));
    setRet(denominationFromPayload(record.returnDenomination));
    setLoaded(true);
  }, [id, loaded, books, record]);

  // …or from the pending draft it approves (Voucher Approvals → Edit)
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
        setF((x) => ({ ...x, from: d.from, to: d.to, amount: d.amount ? String(d.amount) : '', date: d.date || x.date, narration: d.narration, refNo: d.refNo, chequeNo: d.chequeNo }));
        setLoaded(true);
      })
      .catch((e) => toast({ kind: 'error', title: 'Could not open the draft', message: e instanceof Error ? e.message : String(e) }));
  }, [draftId, toast]);

  const accounts = books?.accounts ?? [];
  const fromList = cfg.fromGroups ? accounts.filter((a) => cfg.fromGroups!.includes(a.group)) : accounts;
  const toList = cfg.toGroups ? accounts.filter((a) => cfg.toGroups!.includes(a.group)) : accounts;
  const amountNum = num(f.amount);
  const tendered = denominationTotal(den);
  const change = cfg.cash ? Math.max(tendered - amountNum, 0) : 0;
  const exclude = id ? { source: KIND_SOURCE[kind], id } : undefined;
  const fromBal = books && f.from ? accountBalance(books, f.from, exclude) : null;
  const toBal = books && f.to ? accountBalance(books, f.to, exclude) : null;
  const fromAcc = accounts.find((a) => a.id === f.from);
  const toAcc = accounts.find((a) => a.id === f.to);

  const payload = () => ({
    ...f,
    amount: f.amount,
    denomination: cfg.cash ? denominationPayload(den) : null,
    returnDenomination: cfg.cash && change > 0 ? denominationPayload(ret) : null,
  });

  const save = async () => {
    if (!f.from) return toast({ kind: 'error', title: 'Please select a From Account' });
    if (!f.to) return toast({ kind: 'error', title: 'Please select a To Account' });
    if (f.from === f.to) return toast({ kind: 'error', title: 'From Account and To Account must be different' });
    if (!(amountNum > 0)) return toast({ kind: 'error', title: `${cfg.amountLabel.split(' ')[0]} amount must be greater than 0` });
    setBusy(true);
    try {
      const r = await saveVoucher(kind, mode === 'edit' ? id : null, payload(), draftId);
      toast({ kind: 'success', title: `${cfg.title} ${r.voucher_no} saved`, message: draftId ? 'The draft is approved and recorded in the books.' : undefined });
      leave();
    } catch (e) {
      toast({ kind: 'error', title: `Could not save the ${cfg.title.toLowerCase()}`, message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  const saveDraftOnly = async () => {
    if (!draftId) return;
    if (f.from && f.to && f.from === f.to) return toast({ kind: 'error', title: 'From Account and To Account must be different' });
    setBusy(true);
    try {
      await saveDraftEdits(draftId, { voucherType: kind === 'contra' ? draft?.voucherType : kind, from: f.from, to: f.to, amount: round2(amountNum), date: f.date, narration: f.narration, refNo: f.refNo, chequeNo: f.chequeNo });
      toast({ kind: 'success', title: 'Draft saved', message: 'Approve it from the list when ready.' });
      leave();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the draft', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  const title = `${isView ? 'View' : mode === 'edit' ? 'Edit' : draftId ? 'Review & Approve' : 'Add'} ${cfg.title}`;
  const notFound = !!id && !!books && !record;

  return (
    <>
      <PageHeader
        eyebrow={`Accounting · ${cfg.title}`}
        title={title}
        subtitle={draft ? `Proposed from ${draft.sourceRef} — nothing is recorded until you save it.` : undefined}
        actions={
          <>
            {isView && record && <DocButtons build={(u) => voucherSpec(record, nameMap(accounts), u)} />}
            <button className="btn" onClick={leave}>
              <ArrowLeft size={15} /> Back
            </button>
          </>
        }
      />
      <BooksGate loading={(loading && !books) || (!loaded && !notFound)} error={error} reload={reload}>
        {notFound ? (
          <div className="card">
            <Empty title="Voucher not found" text="It may have been deleted." action={<button className="btn" onClick={() => go(listRoute)}>Back to the list</button>} />
          </div>
        ) : (
          <div className="card">
            <div className="card-body form-page">
              <fieldset className="ro-form" disabled={isView} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <div className="acct-stack">
                  <div className="form-grid three">
                    <Field label="From Account" required>
                      <AccountPicker accounts={fromList} value={f.from} onChange={(v) => set('from', v)} placeholder={cfg.fromPlaceholder} exclude={kind === 'contra' ? f.to : null} disabled={isView} emptyText={cfg.fromGroups ? 'No matching accounts — add a cash / bank account under Account Vouchers → Account' : undefined} />
                    </Field>
                    <Field label="To Account" required hint={cfg.toGroups === CASH_GROUPS && toList.length === 0 ? 'No Cash accounts yet — add one under Accounts with Group Name "Cash-in-Hand".' : undefined}>
                      <AccountPicker accounts={toList} value={f.to} onChange={(v) => set('to', v)} placeholder={cfg.toPlaceholder} exclude={kind === 'contra' ? f.from : null} disabled={isView} emptyText={cfg.toGroups ? 'No matching accounts — add a cash / bank account under Account Vouchers → Account' : undefined} />
                    </Field>
                    <Field label={cfg.amountLabel} required>
                      <input className="input" type="number" min={0} step="0.01" placeholder="0.00" value={f.amount} onChange={(e) => set('amount', e.target.value)} />
                    </Field>
                    <Field label="Date">
                      <input className="input" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
                      <FyDateHint date={f.date} />
                    </Field>
                    <Field label="Voucher Number (Auto)">
                      <div className="acct-auto">{record ? record.no : 'Auto-generated on save'}</div>
                    </Field>
                    {!cfg.bank && (
                      <Field label="Ref / Registration No.">
                        <input className="input" placeholder="e.g. GJ06AB1234" value={f.refNo} onChange={(e) => set('refNo', e.target.value.toUpperCase())} />
                      </Field>
                    )}
                    {cfg.bank && (
                      <>
                        <Field label="Cheque / D.D. No.">
                          <input className="input" placeholder="Optional" value={f.chequeNo} onChange={(e) => set('chequeNo', e.target.value)} />
                        </Field>
                        <Field label="Cheque Date">
                          <input className="input" type="date" value={f.chequeDate} onChange={(e) => set('chequeDate', e.target.value)} />
                        </Field>
                        {kind === 'bank_receipt' && (
                          <Field label="Drawn On">
                            <input className="input" placeholder="Bank name" value={f.drawnOn} onChange={(e) => set('drawnOn', e.target.value)} />
                          </Field>
                        )}
                      </>
                    )}
                    {cfg.receipt && (
                      <Field label="Bill No.">
                        <input className="input" placeholder="Optional" value={f.billNo} onChange={(e) => set('billNo', e.target.value)} />
                      </Field>
                    )}
                    {cfg.bank && (
                      <Field label="Ref / Registration No.">
                        <input className="input" placeholder="e.g. GJ06AB1234" value={f.refNo} onChange={(e) => set('refNo', e.target.value.toUpperCase())} />
                      </Field>
                    )}
                  </div>

                  {cfg.cash && (
                    <>
                      <DenominationInput value={den} onChange={setDen} amount={amountNum} disabled={isView} title="Cash Tendered" onFillAmount={(t) => set('amount', String(t))} />
                      {change > 0 && <DenominationInput value={ret} onChange={setRet} amount={change} disabled={isView} title="Return Currency" hint={`(${inr(change, 0)} change ${cfg.receipt ? 'to give back' : 'received back'})`} />}
                    </>
                  )}

                  <div className="acct-two">
                    <BalanceCard label={cfg.fromCard} icon={ArrowDown} account={fromAcc} current={fromBal} delta={-amountNum} verb={cfg.verb} />
                    <BalanceCard label={cfg.toCard} icon={ArrowUp} account={toAcc} current={toBal} delta={amountNum} verb={cfg.verb} />
                  </div>

                  <Field label="Narration" full>
                    <textarea className="input" placeholder={`Any notes about this ${cfg.verb}…`} value={f.narration} onChange={(e) => set('narration', e.target.value)} />
                  </Field>
                </div>
              </fieldset>
              <div className="form-actions">
                <button className="btn" onClick={leave}>
                  {isView ? 'Close' : 'Cancel'}
                </button>
                {isView
                  ? write && (
                      <button className="btn btn-primary" onClick={() => setMode('edit')}>
                        <Pencil size={15} /> Edit
                      </button>
                    )
                  : write && (
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
                    )}
              </div>
            </div>
          </div>
        )}
      </BooksGate>
    </>
  );
}
