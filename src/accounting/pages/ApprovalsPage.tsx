// Voucher Approvals — vouchers and bills proposed from ERP documents (purchase invoices, purchase payments, dispatches).
// Nothing reaches the books until somebody approves it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ClipboardCheck, Link2, Pencil, RefreshCw, Settings2, Trash2, X } from 'lucide-react';
import { useAccess } from '../../auth/access';
import { Empty, Field, Modal, PageHeader, Search, Tabs, go } from '../../components/ui';
import { fmtDate, fmtDateTime, matches } from '../../components/format';
import { usePaged } from '../../components/Pager';
import { useStore } from '../../store/StoreContext';
import { inr, num } from '../engine';
import { fetchDrafts, fetchDraftsSince, fetchMaps, fetchSuppliers, rejectDraft, saveVoucher, setDraftsSince, setMap, syncDrafts } from '../service';
import { BANK_CASH_GROUPS, CASH_GROUPS, DRAFT_SOURCE_LABEL, DRAFT_TYPE_LABEL, type Account, type AccountMap, type Draft, type DraftStatus, type MapKind, type VoucherKind } from '../types';
import { AccountPicker, BooksGate, av, useAccBooks } from '../components';

const PAYMENT_MODES = ['Bank Transfer', 'Cheque', 'UPI', 'Cash'];
const isBill = (d: Draft) => d.voucherType === 'sales_bill' || d.voucherType === 'purchase_bill';
const BILL_VIEW = { sales_bill: 'sales-bill', purchase_bill: 'purchase-bill' } as const;
const VOUCHER_VIEW: Record<string, string> = { cash_receipt: 'cash-receipt', bank_receipt: 'bank-receipt', cash_payment: 'cash-payment', bank_payment: 'bank-payment' };

export function VoucherApprovalsPage() {
  const { books, loading: booksLoading, error: booksError, reload: reloadBooks } = useAccBooks();
  const { canWrite } = useAccess();
  const { toast } = useStore();
  const write = canWrite('voucher_approvals');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<DraftStatus>('pending');
  const [q, setQ] = useState('');
  const [approving, setApproving] = useState<Draft | null>(null);
  const [rejecting, setRejecting] = useState<Draft | null>(null);
  const [settings, setSettings] = useState(false);

  const load = useCallback(async (sync: boolean) => {
    setLoading(true);
    try {
      if (sync) await syncDrafts().catch((e) => toast({ kind: 'error', title: 'Could not check ERP documents for new drafts', message: e instanceof Error ? e.message : String(e) }));
      setDrafts(await fetchDrafts());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    void load(true);
  }, [load]);

  const names = useMemo(() => Object.fromEntries((books?.accounts ?? []).map((a) => [a.id, a.name])) as Record<number, string>, [books]);
  const counts = useMemo(() => {
    const c: Record<DraftStatus, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const d of drafts) c[d.status]++;
    return c;
  }, [drafts]);
  const shown = drafts.filter((d) => d.status === tab).filter((d) => matches(q, d.sourceRef, d.narration, d.refNo, DRAFT_TYPE_LABEL[d.voucherType], names[d.from ?? 0], names[d.to ?? 0], names[d.account ?? 0], d.postedNo));
  const pg = usePaged(shown, `${tab}${q}`);
  const notSet = <span style={{ color: 'var(--warn)', fontWeight: 600 }}>Not set</span>;
  const acc = (id: number | null) => (id != null && names[id] ? names[id] : notSet);

  return (
    <>
      <PageHeader
        eyebrow="Accounting"
        title="Voucher Approvals"
        subtitle="Vouchers and bills proposed automatically from purchase invoices, purchase payments and dispatches. Nothing is recorded in the books until you approve it."
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => void load(true)} disabled={loading}>
              <RefreshCw size={14} /> Check for new
            </button>
            {write && (
              <button className="btn btn-subtle" onClick={() => setSettings(true)}>
                <Settings2 size={15} /> Account Mapping
              </button>
            )}
          </>
        }
      />
      <BooksGate loading={booksLoading && !books} error={booksError} reload={reloadBooks}>
        <div className="card">
          <div className="card-head" style={{ flexWrap: 'wrap', gap: 12 }}>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: 'pending' as DraftStatus, label: 'Pending', count: counts.pending, tone: 'amber' },
                { value: 'approved' as DraftStatus, label: 'Approved', count: counts.approved, tone: 'green' },
                { value: 'rejected' as DraftStatus, label: 'Rejected', count: counts.rejected, tone: 'red' },
              ]}
            />
            <div className="table-search-row" style={{ marginLeft: 'auto' }}>
              <Search value={q} onChange={setQ} placeholder="Search document no., account, narration…" />
            </div>
          </div>
          {loading ? (
            <div className="card-center-msg">Loading drafts…</div>
          ) : err ? (
            <Empty title="Not available" text={err} action={<button className="btn" onClick={() => void load(false)}>Try again</button>} />
          ) : shown.length === 0 ? (
            <Empty icon={ClipboardCheck} title={`No ${tab} vouchers`} text={tab === 'pending' ? 'New drafts appear here when purchase invoices are posted, supplier payments are made and goods are dispatched (from the date set under Account Mapping).' : undefined} />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Voucher</th>
                    <th>Document</th>
                    <th>Date</th>
                    <th>From / Party Account</th>
                    <th>To Account</th>
                    <th className="r">Amount</th>
                    <th>{tab === 'pending' ? 'Actions' : 'Decision'}</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((d) => {
                    const bill = isBill(d);
                    return (
                      <tr key={d.id} style={{ verticalAlign: 'top' }}>
                        <td className="nowrap">
                          <div className="strong">{DRAFT_TYPE_LABEL[d.voucherType]}</div>
                          {d.postedNo && <div className="acct-no in">{d.postedNo}</div>}
                        </td>
                        <td>
                          <div className="strong nowrap">{d.sourceRef || '—'}</div>
                          <div className="sub">{DRAFT_SOURCE_LABEL[d.sourceType]}{d.refNo ? ` · ${d.refNo}` : ''}</div>
                        </td>
                        <td className="nowrap">{fmtDate(d.date)}</td>
                        <td>{bill ? (d.voucherType === 'sales_bill' ? acc(d.account) : '—') : acc(d.from)}</td>
                        <td>{bill ? (d.voucherType === 'purchase_bill' ? acc(d.account) : '—') : acc(d.to)}</td>
                        <td className="r num strong nowrap">{inr(d.amount)}</td>
                        <td>
                          {tab === 'pending' ? (
                            <>
                              {write ? (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  <button className="btn btn-sm btn-success" onClick={() => (bill ? go(av(BILL_VIEW[d.voucherType as 'sales_bill'], { draft: d.id })) : setApproving(d))}>
                                    <Check size={13} /> {bill ? 'Review & Approve' : 'Approve'}
                                  </button>
                                  <button className="btn btn-sm btn-subtle" onClick={() => go(av(bill ? BILL_VIEW[d.voucherType as 'sales_bill'] : VOUCHER_VIEW[d.voucherType], { draft: d.id }))}>
                                    <Pencil size={13} /> Edit
                                  </button>
                                  <button className="btn btn-sm btn-subtle" style={{ color: 'var(--crit)' }} onClick={() => setRejecting(d)}>
                                    <X size={13} /> Reject
                                  </button>
                                </div>
                              ) : (
                                <span className="muted text-xs">Waiting for approval</span>
                              )}
                              {bill && <div className="text-xs muted" style={{ marginTop: 6 }}>Check the items and tax on the bill page, then Save to approve.</div>}
                              {d.issue && <div className="acct-issue"><AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} /> {d.issue}</div>}
                            </>
                          ) : (
                            <div className="text-xs">
                              <div>
                                {d.decidedBy || '—'} · {fmtDateTime(d.decidedAt)}
                              </div>
                              {d.rejectReason && <div className="muted">“{d.rejectReason}”</div>}
                              {d.status === 'approved' && d.postedId && (
                                <button className="btn-link" onClick={() => go(av(bill ? BILL_VIEW[d.voucherType as 'sales_bill'] : VOUCHER_VIEW[d.voucherType], { id: d.postedId, mode: 'view', back: 'voucher-approvals' }))}>
                                  View {DRAFT_TYPE_LABEL[d.voucherType]}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {pg.pager}
            </div>
          )}
        </div>
      </BooksGate>
      {approving && books && (
        <ApproveModal
          draft={approving}
          onClose={() => setApproving(null)}
          onDone={() => {
            setApproving(null);
            void load(false);
          }}
        />
      )}
      {rejecting && (
        <RejectModal
          draft={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => {
            setRejecting(null);
            void load(false);
          }}
        />
      )}
      {settings && <MappingModal onClose={() => setSettings(false)} onSaved={() => void load(true)} />}
    </>
  );
}

/** Review & Approve one voucher draft: posts it as a real Cash / Bank voucher (same numbering as the voucher pages). */
function ApproveModal({ draft, onClose, onDone }: { draft: Draft; onClose: () => void; onDone: () => void }) {
  const { books } = useAccBooks();
  const { toast } = useStore();
  const receipt = draft.voucherType === 'cash_receipt' || draft.voucherType === 'bank_receipt';
  const [cash, setCash] = useState(draft.voucherType.startsWith('cash'));
  const [date, setDate] = useState(draft.date);
  const [amount, setAmount] = useState(String(draft.amount || ''));
  const [from, setFrom] = useState<number | null>(draft.from);
  const [to, setTo] = useState<number | null>(draft.to);
  const [cheque, setCheque] = useState(draft.chequeNo);
  const [narration, setNarration] = useState(draft.narration);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const kind: VoucherKind = receipt ? (cash ? 'cash_receipt' : 'bank_receipt') : cash ? 'cash_payment' : 'bank_payment';
  const accounts = books?.accounts ?? [];
  const moneyGroups = cash ? CASH_GROUPS : BANK_CASH_GROUPS;
  const moneyAccounts = accounts.filter((a) => moneyGroups.includes(a.group));
  const missing = [!date && 'Date', !(num(amount) > 0) && 'Amount', !from && 'From Account', !to && 'To Account'].filter(Boolean) as string[];

  const approve = async () => {
    setTried(true);
    if (missing.length) return toast({ kind: 'error', title: 'Please complete every field to approve', message: missing.join(' • ') });
    if (from === to) return toast({ kind: 'error', title: 'From and To account must be different' });
    setBusy(true);
    try {
      const r = await saveVoucher(kind, null, { from, to, amount, date, narration, refNo: draft.refNo, billNo: '', chequeNo: cash ? '' : cheque, chequeDate: '', drawnOn: '', denomination: null, returnDenomination: null }, draft.id);
      toast({ kind: 'success', title: `Approved — ${DRAFT_TYPE_LABEL[kind]} ${r.voucher_no} recorded` });
      onDone();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not approve', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  return (
    <Modal
      dialog
      open
      onClose={onClose}
      title={`Review & Approve ${DRAFT_TYPE_LABEL[kind]}`}
      subtitle={`${DRAFT_SOURCE_LABEL[draft.sourceType]} ${draft.sourceRef}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-success" disabled={busy} onClick={() => void approve()}>
            <Check size={15} /> Approve
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Mode" full>
          <div className="tabs">
            {[false, true].map((c) => (
              <button
                key={String(c)}
                type="button"
                className={`tab ${cash === c ? 'active' : ''}`}
                onClick={() => {
                  setCash(c);
                  // the bank / cash side must suit the new mode
                  const side = receipt ? to : from;
                  const ok = accounts.find((a) => a.id === side && (c ? CASH_GROUPS : BANK_CASH_GROUPS).includes(a.group));
                  if (!ok) (receipt ? setTo : setFrom)(null);
                }}
              >
                {c ? 'Cash' : 'Bank'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Date" required error={tried && !date ? 'Required' : null}>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Amount" required error={tried && !(num(amount) > 0) ? 'Required' : null}>
          <input className="input" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="From Account" required full>
          <AccountPicker accounts={receipt ? accounts : moneyAccounts} value={from} onChange={setFrom} bad={tried && !from} />
        </Field>
        <Field label="To Account" required full>
          <AccountPicker accounts={receipt ? moneyAccounts : accounts} value={to} onChange={setTo} bad={tried && !to} />
        </Field>
        {!cash && (
          <Field label="Cheque No. (optional)" full>
            <input className="input" value={cheque} onChange={(e) => setCheque(e.target.value)} />
          </Field>
        )}
        <Field label="Narration" full>
          <textarea className="input" value={narration} onChange={(e) => setNarration(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function RejectModal({ draft, onClose, onDone }: { draft: Draft; onClose: () => void; onDone: () => void }) {
  const { toast } = useStore();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const reject = async () => {
    setBusy(true);
    try {
      await rejectDraft(draft.id, reason.trim());
      toast({ kind: 'success', title: 'Draft rejected', message: 'It will not be proposed again.' });
      onDone();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not reject', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };
  return (
    <Modal
      dialog
      open
      onClose={onClose}
      title={`Reject ${DRAFT_TYPE_LABEL[draft.voucherType]} for ${draft.sourceRef}?`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={busy} onClick={() => void reject()}>
            Reject
          </button>
        </>
      }
    >
      <Field label="Reason (optional)" full>
        <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

/** Which ledger account each payment mode is paid from, and accounts for supplier / customer names not linked to an account; and the start date. */
function MappingModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { books } = useAccBooks();
  const { masters, toast } = useStore();
  const [maps, setMaps] = useState<AccountMap[]>([]);
  const [since, setSince] = useState('');
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState<{ kind: MapKind; name: string; account: number | null }>({ kind: 'supplier', name: '', account: null });
  const accounts = books?.accounts ?? [];
  const money = accounts.filter((a) => BANK_CASH_GROUPS.includes(a.group));
  const reload = useCallback(() => {
    void fetchMaps().then(setMaps).catch(() => setMaps([]));
  }, []);
  useEffect(() => {
    reload();
    void fetchDraftsSince().then(setSince).catch(() => undefined);
    void fetchSuppliers().then((s) => setSuppliers(s.map((x) => x.name)));
  }, [reload]);
  const mapped = (kind: MapKind, name: string) => maps.find((m) => m.kind === kind && m.name === name)?.account ?? null;
  const run = async (p: Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await p;
      toast({ kind: 'success', title: ok });
      reload();
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.name])) as Record<number, string>;
  const partyMaps = maps.filter((m) => m.kind !== 'payment_mode');
  const nameChoices = add.kind === 'supplier' ? suppliers : masters.customers;

  return (
    <Modal dialog open onClose={onClose} title="Account Mapping" subtitle="How drafts find their ledger accounts." footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="acct-stack">
        <div>
          <div className="acct-panel-h">Propose drafts for documents dated from</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="input" type="date" value={since} onChange={(e) => setSince(e.target.value)} style={{ maxWidth: 200 }} />
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run(setDraftsSince(since || null), since ? `Drafts are proposed from ${fmtDate(since)}` : 'Drafts are switched off')}>
              Save
            </button>
            <span className="text-xs muted">Empty = propose nothing.</span>
          </div>
        </div>

        <div>
          <div className="acct-panel-h">Payment mode → Bank / Cash account (supplier payments)</div>
          <div className="acct-map">
            {PAYMENT_MODES.map((m) => (
              <PayModeRow key={m} mode={m} value={mapped('payment_mode', m)} accounts={money} disabled={busy} onChange={(id) => void run(setMap('payment_mode', m, id), `${m} → ${id ? names[id] : 'not mapped'}`)} />
            ))}
          </div>
          <div className="text-xs muted" style={{ marginTop: 6 }}>Unmapped "Cash" uses your Cash-in-Hand account when you have exactly one.</div>
        </div>

        <div>
          <div className="acct-panel-h">
            <Link2 size={14} /> Supplier / customer names → account
            <span className="hint">Only needed when the account is not linked to the ERP supplier / customer (Account → Existing Supplier / Customer).</span>
          </div>
          {partyMaps.length > 0 && (
            <table className="tbl compact" style={{ marginBottom: 10 }}>
              <tbody>
                {partyMaps.map((m) => (
                  <tr key={`${m.kind}-${m.name}`}>
                    <td className="muted">{m.kind === 'supplier' ? 'Supplier' : 'Customer'}</td>
                    <td className="strong">{m.name}</td>
                    <td>→ {names[m.account] ?? '—'}</td>
                    <td className="r">
                      <button className="icon-btn danger" title="Remove" disabled={busy} onClick={() => void run(setMap(m.kind, m.name, null), 'Mapping removed')}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="form-grid">
            <Field label="Type">
              <select value={add.kind} onChange={(e) => setAdd({ kind: e.target.value as MapKind, name: '', account: add.account })}>
                <option value="supplier">Supplier</option>
                <option value="customer">Customer</option>
              </select>
            </Field>
            <Field label="Name">
              <select value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })}>
                <option value="">Select…</option>
                {nameChoices.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="Account" full>
              <AccountPicker accounts={accounts} value={add.account} onChange={(v) => setAdd({ ...add, account: v })} />
            </Field>
          </div>
          <button className="btn btn-subtle btn-sm" style={{ marginTop: 10 }} disabled={busy || !add.name || !add.account} onClick={() => void run(setMap(add.kind, add.name, add.account), 'Mapping saved').then(() => setAdd({ ...add, name: '', account: null }))}>
            Add mapping
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PayModeRow({ mode, value, accounts, disabled, onChange }: { mode: string; value: number | null; accounts: Account[]; disabled: boolean; onChange: (id: number | null) => void }) {
  return (
    <>
      <div className="lbl">{mode}</div>
      <AccountPicker accounts={accounts} value={value} onChange={onChange} placeholder="Not mapped" disabled={disabled} emptyText="No bank / cash accounts yet" />
    </>
  );
}
