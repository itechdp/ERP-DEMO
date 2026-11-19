// Ledger — every account with its opening / closing balance, and one account's statement with a running balance.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ChevronRight, Eye, Pencil, RefreshCw, ScrollText, Trash2, X } from 'lucide-react';
import { useAccess } from '../../auth/access';
import { Empty, Field, Modal, PageHeader, Search, Tabs, go } from '../../components/ui';
import { fmtDate, matches } from '../../components/format';
import { usePaged } from '../../components/Pager';
import { DocButtons, ListButtons } from '../../export/docOutput';
import { useStore } from '../../store/StoreContext';
import { computeBalances, earliestDate, inr, ledgerEntries, ledgerStatement, narrationsByAccount, type LedgerEntry } from '../engine';
import { customDateRange, openingCutoff, useFy, type FyRange } from '../fy';
import { ACC_FORMS, ledgerSpec } from '../print';
import { deleteEntry } from '../service';
import { BANK_GROUPS, CASH_GROUPS, SOURCE_ENTRY, SOURCE_LABEL, SOURCE_VIEW } from '../types';
import { BooksGate, DrCr, FySelector, av, here, useAccBooks } from '../components';

type Tab = 'all' | 'bank' | 'cash';

/** the FY, or a custom from–to range when both dates are filled in */
function useRange() {
  const [fy] = useFy();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const custom = !!(from && to && from <= to);
  const range: FyRange = custom ? customDateRange(from, to) : fy;
  const picker = (
    <div className="rp-dates" style={{ padding: '0 22px 14px', marginTop: 0 }}>
      <Field label="From">
        <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field label="To">
        <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
      </Field>
      {(from || to) && (
        <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'end', marginBottom: 6 }} onClick={() => { setFrom(''); setTo(''); }}>
          <X size={13} /> Clear dates
        </button>
      )}
    </div>
  );
  return { range, custom, picker };
}

export function LedgerList() {
  const { books, loading, error, reload } = useAccBooks();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [sel, setSel] = useState(-1);
  const { range, custom, picker } = useRange();
  const accounts = books?.accounts ?? [];
  const { opening, closing } = useMemo(() => (books ? { opening: computeBalances(books, openingCutoff(range)), closing: computeBalances(books, range) } : { opening: {}, closing: {} }), [books, range]);
  const texts = useMemo(() => (books ? narrationsByAccount(books) : {}), [books]);
  const rows = useMemo(
    () =>
      accounts
        .filter((a) => tab === 'all' || (tab === 'bank' ? BANK_GROUPS.includes(a.group) : CASH_GROUPS.includes(a.group)))
        .filter((a) => matches(q, a.name, a.group, a.mobileNo, a.city, ...(texts[a.id] ?? []))),
    [accounts, tab, q, texts],
  );
  const pg = usePaged(rows, `${tab}${q}`);
  const open = (id: number) => go(av('ledger-view', { account: id, ...(custom ? { from: range.start, to: range.end } : {}) }));

  // ↑ / ↓ to move through the list, Enter to open the ledger
  useEffect(() => setSel(-1), [q, tab]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, select, textarea') && e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((i) => Math.min(i + 1, pg.rows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && sel >= 0 && pg.rows[sel]) {
        e.preventDefault();
        open(pg.rows[sel].id);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  return (
    <>
      <PageHeader
        eyebrow="Accounting · Account Vouchers"
        title="Ledger"
        subtitle={`Opening and closing balance of every account for ${custom ? `${fmtDate(range.start)} – ${fmtDate(range.end)}` : `FY ${range.label}`}. Pick an account to see its full statement.`}
        actions={
          <>
            <FySelector earliest={books ? earliestDate(books) : null} />
            <button className="btn btn-subtle" onClick={() => go(av())}>
              <ArrowLeft size={15} /> Vouchers
            </button>
            <ListButtons doc={() => ({ filename: 'Ledger Balances', title: 'Ledger Balances', form: ACC_FORMS.report, info: [[`Period :- ${fmtDate(range.start)} to ${fmtDate(range.end)}`]], rows: rows.map((a) => ({ name: a.name, group: a.group, opening: opening[a.id] ?? 0, closing: closing[a.id] ?? 0 })), cols: [{ label: 'Account Name', key: 'name', width: 30 }, { label: 'Group Name', key: 'group', width: 24 }, { label: 'Opening (₹, +Dr / −Cr)', key: 'opening', kind: 'money' }, { label: 'Closing (₹, +Dr / −Cr)', key: 'closing', kind: 'money' }] })} />
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
                { value: 'all' as Tab, label: 'All Accounts', count: accounts.length },
                { value: 'bank' as Tab, label: 'Bank Accounts', count: accounts.filter((a) => BANK_GROUPS.includes(a.group)).length },
                { value: 'cash' as Tab, label: 'Cash Accounts', count: accounts.filter((a) => CASH_GROUPS.includes(a.group)).length },
              ]}
            />
            <button className="btn btn-sm btn-subtle" onClick={() => void reload()} disabled={loading}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
          <div className="card-head">
            <div className="table-search-row">
              <Search value={q} onChange={setQ} placeholder="Search by account, group, narration or reference no…" />
            </div>
            <div className="right text-xs muted">{rows.length} accounts · ↑ ↓ Enter to open</div>
          </div>
          {picker}
          {rows.length === 0 ? (
            <Empty icon={ScrollText} title="No accounts found" text={accounts.length === 0 ? 'Add accounts under Account Vouchers → Account.' : 'No account matches your search.'} />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Account Name</th>
                    <th>Group Name</th>
                    <th className="r">Opening Balance</th>
                    <th className="r">Closing Balance</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((a, i) => (
                    <tr key={a.id} className={`row-click ${i === sel ? 'acct-row-sel' : ''}`} onClick={() => open(a.id)}>
                      <td className="strong">{a.name}</td>
                      <td>{a.group}</td>
                      <td className="r">
                        <DrCr amount={opening[a.id] ?? 0} />
                      </td>
                      <td className="r">
                        <DrCr amount={closing[a.id] ?? 0} />
                      </td>
                      <td className="muted">
                        <ChevronRight size={16} />
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
    </>
  );
}

/** The detail of one ledger / day-book line: View, Edit or Delete the voucher it came from. */
export function EntryActions({ entry, onClose }: { entry: Pick<LedgerEntry, 'sourceType' | 'sourceId' | 'voucherNo' | 'date' | 'particulars' | 'refNo' | 'debit' | 'credit'>; onClose: () => void }) {
  const { canWrite } = useAccess();
  const { toast } = useStore();
  const [confirm, setConfirm] = useState<'edit' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const label = SOURCE_LABEL[entry.sourceType];
  const write = canWrite('account_vouchers');
  const open = (mode: 'view' | 'edit') => go(av(SOURCE_VIEW[entry.sourceType], { id: entry.sourceId, mode, back: here() }));
  const del = async () => {
    setBusy(true);
    try {
      await deleteEntry(SOURCE_ENTRY[entry.sourceType], entry.sourceId);
      toast({ kind: 'success', title: `${label} ${entry.voucherNo} deleted` });
      onClose();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not delete', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };
  return (
    <Modal dialog open onClose={onClose} title={`${label} ${entry.voucherNo}`}>
      {confirm === null && (
        <>
          <table className="tbl compact" style={{ marginBottom: 14 }}>
            <tbody>
              <tr>
                <td className="muted">Date</td>
                <td className="r strong">{fmtDate(entry.date)}</td>
              </tr>
              <tr>
                <td className="muted">Particulars</td>
                <td className="r">{entry.particulars}</td>
              </tr>
              <tr>
                <td className="muted">Ref / Reg. No.</td>
                <td className="r">{entry.refNo || '—'}</td>
              </tr>
              <tr>
                <td className="muted">Debit</td>
                <td className="r num acct-in">{entry.debit > 0 ? inr(entry.debit) : '—'}</td>
              </tr>
              <tr>
                <td className="muted">Credit</td>
                <td className="r num" style={{ color: 'var(--info)' }}>{entry.credit > 0 ? inr(entry.credit) : '—'}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="btn btn-subtle" onClick={() => open('view')}>
              <Eye size={15} /> View
            </button>
            {write && (
              <>
                <button className="btn btn-subtle" onClick={() => setConfirm('edit')}>
                  <Pencil size={15} /> Edit
                </button>
                <button className="btn btn-subtle" style={{ color: 'var(--crit)' }} onClick={() => setConfirm('delete')}>
                  <Trash2 size={15} /> Delete
                </button>
              </>
            )}
          </div>
        </>
      )}
      {confirm === 'edit' && (
        <>
          <div className="callout warn" style={{ marginTop: 0 }}>
            <AlertTriangle size={14} /> Edit this {label.toLowerCase()}? Changes update the balance everywhere it is linked.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => open('edit')}>
              Yes, Edit
            </button>
          </div>
        </>
      )}
      {confirm === 'delete' && (
        <>
          <div className="callout err" style={{ marginTop: 0 }}>
            <AlertTriangle size={14} /> Delete this {label.toLowerCase()} permanently? It will be removed from every account it is linked to. This cannot be undone.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => void del()}>
              Yes, Delete
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function LedgerView({ query }: { query: URLSearchParams }) {
  const { books, loading, error, reload } = useAccBooks();
  const [fy] = useFy();
  const accountId = Number(query.get('account')) || 0;
  const [from, setFrom] = useState(query.get('from') ?? '');
  const [to, setTo] = useState(query.get('to') ?? '');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(-1);
  const [detail, setDetail] = useState<LedgerEntry | null>(null);
  const custom = !!(from && to && from <= to);
  const range = custom ? customDateRange(from, to) : fy;
  const account = books?.accounts.find((a) => a.id === accountId);
  const statement = useMemo(() => (books && account ? ledgerStatement(account, ledgerEntries(books, account.id), range) : null), [books, account, range]);
  const shown = useMemo(() => (statement ? statement.rows.filter((r) => matches(q, r.particulars, r.narration, r.refNo, r.voucherNo)) : []), [statement, q]);
  const scroller = useRef<HTMLDivElement>(null);

  // the newest entry in view first, like the reference: scroll the statement to its end
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [accountId, range.start, range.end, !!statement]);
  useEffect(() => setSel(-1), [q]);
  useEffect(() => {
    if (detail) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((i) => Math.min(i + 1, shown.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((i) => (i < 0 ? shown.length - 1 : Math.max(i - 1, 0)));
      } else if (e.key === 'Enter' && sel >= 0 && shown[sel]) {
        e.preventDefault();
        setDetail(shown[sel]);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const addr = account ? [account.area, account.city, account.state, account.pincode].filter(Boolean).join(', ') : '';
  return (
    <>
      <PageHeader
        eyebrow="Accounting · Ledger"
        title={account ? account.name : 'Ledger'}
        subtitle={account ? `${account.group}${addr ? ` · ${addr}` : ''} · ${custom ? `${fmtDate(range.start)} – ${fmtDate(range.end)}` : `FY ${range.label}`}` : undefined}
        actions={
          <>
            <FySelector earliest={books ? earliestDate(books) : null} />
            {account && statement && <DocButtons build={(u) => ledgerSpec(account, statement, range, u)} />}
            <button className="btn" onClick={() => go(av('ledger'))}>
              <ArrowLeft size={15} /> Back
            </button>
          </>
        }
      />
      <BooksGate loading={loading && !books} error={error} reload={reload}>
        {!account || !statement ? (
          <div className="card">
            <Empty icon={ScrollText} title="Account not found" text="Pick an account from the Ledger list." action={<button className="btn" onClick={() => go(av('ledger'))}>Open the Ledger</button>} />
          </div>
        ) : (
          <div className="card">
            <div className="card-head">
              <div className="table-search-row">
                <Search value={q} onChange={setQ} placeholder="Search particulars, narration or reference…" />
              </div>
              <div className="right text-xs muted">{shown.length} entries · ↑ ↓ Enter for details</div>
            </div>
            <div className="rp-dates" style={{ padding: '0 22px 14px', marginTop: 0 }}>
              <Field label="From">
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </Field>
              {(from || to) && (
                <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'end', marginBottom: 6 }} onClick={() => { setFrom(''); setTo(''); }}>
                  <X size={13} /> Clear dates
                </button>
              )}
            </div>
            <div className="table-wrap" ref={scroller} style={{ maxHeight: '62vh', overflow: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Particulars</th>
                    <th>Ref / Reg. No.</th>
                    <th className="r">Debit</th>
                    <th className="r">Credit</th>
                    <th className="r">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="total-row">
                    <td className="nowrap">{fmtDate(range.start)}</td>
                    <td className="strong" colSpan={4}>
                      Opening Balance
                    </td>
                    <td className="r">
                      <DrCr amount={statement.opening} />
                    </td>
                  </tr>
                  {shown.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                        {q ? 'No entry matches your search.' : 'No entries in this period.'}
                      </td>
                    </tr>
                  ) : (
                    shown.map((r, i) => (
                      <tr key={`${r.sourceType}-${r.sourceId}-${i}`} className={`row-click ${i === sel ? 'acct-row-sel' : ''}`} onClick={() => setDetail(r)}>
                        <td className="nowrap">{fmtDate(r.date)}</td>
                        <td>
                          {r.particulars}
                          {r.narration && <div className="sub">{r.narration}</div>}
                        </td>
                        <td>{r.refNo || '—'}</td>
                        <td className="r num acct-in nowrap">{r.debit > 0 ? inr(r.debit) : ''}</td>
                        <td className="r num nowrap" style={{ color: 'var(--info)' }}>{r.credit > 0 ? inr(r.credit) : ''}</td>
                        <td className="r">
                          <DrCr amount={r.balance} />
                        </td>
                      </tr>
                    ))
                  )}
                  <tr className="total-row">
                    <td />
                    <td className="strong" colSpan={2}>
                      Total
                    </td>
                    <td className="r num strong nowrap">{inr(statement.totalDebit)}</td>
                    <td className="r num strong nowrap">{inr(statement.totalCredit)}</td>
                    <td />
                  </tr>
                  <tr className="total-row">
                    <td className="nowrap">{fmtDate(range.end)}</td>
                    <td className="strong" colSpan={4}>
                      Closing Balance
                    </td>
                    <td className="r strong">
                      <DrCr amount={statement.closing} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </BooksGate>
      {detail && <EntryActions entry={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
