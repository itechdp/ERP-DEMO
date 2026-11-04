import { useMemo, useState } from 'react';
import { ArrowRight, BellRing, RefreshCw } from 'lucide-react';
import { Empty, FilterMenu, PageHeader, Search, Tabs } from '../components/ui';
import { fmtDate, fmtNum, matches } from '../components/format';
import { useFollowups } from './useFollowups';
import { DUE_LABEL, KIND_LABEL, KIND_ORDER, dueState, dueText, type DueState, type FollowupKind } from './types';
import { ListButtons } from '../export/docOutput';
import { FORM_FORMATS } from '../export/xlsxSheet';
import { usePaged } from '../components/Pager';

const TONE: Record<DueState, string> = { overdue: 'b-red', today: 'b-amber', tomorrow: 'b-amber', soon: 'b-blue', later: 'b-neutral', none: 'b-neutral' };

type Tab = 'all' | FollowupKind;

/** Everything that needs a follow-up, from every part of the system, in one place. */
export function FollowupsPage({ navigate }: { navigate: (r: string) => void }) {
  const { items, kinds, loading, reload } = useFollowups();
  const [tab, setTab] = useState<Tab>('all');
  const [when, setWhen] = useState('all');
  const [q, setQ] = useState('');

  const inTab = useMemo(() => (tab === 'all' ? items : items.filter((i) => i.kind === tab)), [items, tab]);
  const shown = useMemo(
    () =>
      inTab
        .filter((i) => when === 'all' || dueState(i.due) === when)
        .filter((i) => matches(q, i.ref, i.party, i.what, i.detail))
        .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')),
    [inTab, when, q],
  );
  const pg = usePaged(shown, shown.length);
  const attention = items.filter((i) => i.due && ['overdue', 'today', 'tomorrow'].includes(dueState(i.due))).length;

  return (
    <>
      <PageHeader eyebrow="Main Menu" title="Follow-ups" actions={<><ListButtons doc={() => ({ filename: 'Follow-ups', title: 'Follow-ups', form: FORM_FORMATS.report, rows: shown.map((i) => ({ type: KIND_LABEL[i.kind], ref: i.ref, party: i.party, what: i.what, detail: i.detail, due: i.due, state: DUE_LABEL[dueState(i.due)], amount: i.amount })), cols: [{ label: 'Type', key: 'type' }, { label: 'Reference', key: 'ref' }, { label: 'Party', key: 'party', width: 24 }, { label: 'To Do', key: 'what', width: 28 }, { label: 'Detail', key: 'detail', width: 34 }, { label: 'Due', key: 'due', kind: 'date' }, { label: 'When', key: 'state' }, { label: 'Amount (₹)', key: 'amount', kind: 'money' }] })} /><button className="btn btn-subtle" onClick={() => reload()} disabled={loading}><RefreshCw size={14} /> Refresh</button></>} />

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 12 }}>
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'all' as Tab, label: 'All', count: items.length },
              ...KIND_ORDER.filter((k) => kinds.includes(k)).map((k) => ({ value: k as Tab, label: KIND_LABEL[k], count: items.filter((i) => i.kind === k).length })),
            ]}
          />
        </div>
        <div className="card-head">
          <div className="table-search-row">
            <Search value={q} onChange={setQ} placeholder="Search by number, customer, supplier or task…" />
            <FilterMenu
              groups={[{
                label: 'When',
                value: when,
                onChange: setWhen,
                options: [{ value: 'all', label: 'Any time' }, ...(['overdue', 'today', 'tomorrow', 'soon', 'later', 'none'] as DueState[]).map((v) => ({ value: v, label: DUE_LABEL[v] }))],
              }]}
            />
          </div>
          <div className="right text-xs muted">{attention ? `${attention} due tomorrow or earlier · ` : ''}{shown.length} shown</div>
        </div>

        {loading ? (
          <div className="card-center-msg">Loading follow-ups…</div>
        ) : shown.length === 0 ? (
          <Empty icon={BellRing} title="Nothing to follow up" text={items.length === 0 ? 'Follow-ups appear here as quotations are sent, orders are due and payments fall due.' : 'No follow-up matches your search or filter.'} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Due</th>
                  <th>Type</th>
                  <th>Customer / Supplier</th>
                  <th>What to do</th>
                  <th className="right">Amount</th>
                  <th className="act">Open</th>
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((i) => {
                  const st = dueState(i.due);
                  return (
                    <tr key={i.key}>
                      <td className="strong mono nowrap"><button className="link-btn" style={{ fontWeight: 600 }} onClick={() => navigate(i.route)}>{i.ref}</button></td>
                      <td className="nowrap">
                        <span className={`badge ${TONE[st]}`}>{dueText(i.due)}</span>
                        {i.due && <div className="text-xs muted" style={{ marginTop: 3 }}>{fmtDate(i.due)}</div>}
                      </td>
                      <td className="muted nowrap">{KIND_LABEL[i.kind]}</td>
                      <td className="strong">{i.party || '—'}</td>
                      <td>
                        <div className="strong">{i.what}</div>
                        <div className="text-xs muted">{i.detail}</div>
                      </td>
                      <td className="right mono nowrap">{i.amount == null ? '—' : `₹ ${fmtNum(Math.round(i.amount))}`}</td>
                      <td className="act">
                        <button className="icon-btn" title="Open" aria-label={`Open ${i.ref}`} onClick={() => navigate(i.route)}><ArrowRight size={16} /></button>
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
    </>
  );
}
