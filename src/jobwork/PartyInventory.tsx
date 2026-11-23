import { Fragment, useMemo, useState } from 'react';
import { Boxes } from 'lucide-react';
import { canSee } from '../auth/access';
import { matches } from '../components/format';
import { useStore } from '../store/StoreContext';
import { Empty, Kpi, Search } from '../components/ui';
import { fmtNum } from '../components/format';
import { ListButtons } from '../export/docOutput';
import { FORM_FORMATS } from '../export/xlsxSheet';
import type { ERPState } from '../store/types';

export { lineText } from './lineText';

const kg = (v: number) => `${fmtNum(Math.round(v * 1000) / 1000)} KG`;

interface Row {
  party: string;
  material: string;
  size?: number;
  item: string;
  jobs: string[];
  recvKg: number;
  recvPcs: number;
  retKg: number;
  retPcs: number;
}

/**
 * The customers' material we hold for job work, per party and material: received (Job Work In, the customer's material) − returned
 * (dispatched back to the customer) = pending. It is its own ledger — nothing here is in, or comes from, our Raw Material Inventory.
 * Batches on OUR material are left out (that stock is ours and is in Raw Inventory).
 */
export function buildPartyInventory(s: ERPState): Row[] {
  const m = new Map<string, Row>();
  for (const w of s.jobWork) {
    if (w.materialSource !== 'customer') continue;
    const job = s.jobs.find((j) => j.jobNo === w.jobNo);
    const p = s.products.find((x) => x.id === job?.productId);
    const party = job?.customer || '—';
    const material = w.material || p?.material || '—';
    const size = w.sizeMm ?? (w.material ? undefined : p?.od);
    const key = `${party.toLowerCase()}|${material.toLowerCase()}|${size ?? ''}`;
    const r = m.get(key) ?? { party, material, size, item: w.itemName || '', jobs: [], recvKg: 0, recvPcs: 0, retKg: 0, retPcs: 0 };
    r.jobs.push(w.jobNo);
    r.recvKg += w.receivedWeight ?? 0;
    r.recvPcs += w.receivedQty;
    for (const d of s.dispatches) {
      if (d.jobNo !== w.jobNo || d.status !== 'Dispatched') continue;
      r.retKg += d.weight || 0;
      r.retPcs += d.qty || 0;
    }
    if (!r.item && w.itemName) r.item = w.itemName;
    m.set(key, r);
  }
  return [...m.values()].sort((a, b) => a.party.localeCompare(b.party) || a.material.localeCompare(b.material) || (a.size ?? 0) - (b.size ?? 0));
}

export function PartyInventory() {
  const { state, openTrace } = useStore();
  const [q, setQ] = useState('');
  const [onlyPending, setOnlyPending] = useState(true);
  const party = canSee('party_names');
  const all = useMemo(() => buildPartyInventory(state), [state]);
  const rows = all
    .filter((r) => !onlyPending || r.recvKg - r.retKg > 0.0005 || r.recvPcs - r.retPcs > 0)
    .filter((r) => matches(q, party ? r.party : '', r.material, r.item, r.size ? String(r.size) : '', ...r.jobs));
  const byParty = useMemo(() => {
    const g = new Map<string, Row[]>();
    for (const r of rows) g.set(r.party, [...(g.get(r.party) ?? []), r]);
    return [...g.entries()];
  }, [rows]);
  const sum = (f: (r: Row) => number, list: Row[] = rows) => list.reduce((t, r) => t + f(r), 0);
  const totRecv = sum((r) => r.recvKg);
  const totRet = sum((r) => r.retKg);

  return (
    <>
      <div className="kpis k4" style={{ marginBottom: 16 }}>
        <Kpi label="Parties with material" value={new Set(rows.map((r) => r.party)).size} icon={Boxes} tone="blue" hint={`${rows.length} material line${rows.length === 1 ? '' : 's'}`} />
        <Kpi label="Received" value={fmtNum(Math.round(totRecv))} unit="KG" icon={Boxes} tone="violet" hint={`${fmtNum(sum((r) => r.recvPcs))} PCS`} />
        <Kpi label="Returned" value={fmtNum(Math.round(totRet))} unit="KG" icon={Boxes} tone="green" hint={`${fmtNum(sum((r) => r.retPcs))} PCS dispatched back`} />
        <Kpi label="Pending with us" value={fmtNum(Math.round(totRecv - totRet))} unit="KG" icon={Boxes} tone="amber" hint="Received − Returned" />
      </div>
      <div className="card">
        <div className="card-head" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0 }}>Job Work Party Inventory</h3>
            <div className="text-xs muted">The customers' material we hold — kept apart from our own Raw Material Inventory</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className={`check ${onlyPending ? 'on' : ''}`}>
              <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Only with pending
            </label>
            <Search value={q} onChange={setQ} placeholder={party ? 'Search party, material, size, job…' : 'Search material, size, job…'} />
            {rows.length > 0 && (
              <ListButtons
                doc={() => ({
                  filename: 'Job-Work-Party-Inventory',
                  title: 'Job Work Party Inventory',
                  form: FORM_FORMATS.report,
                  rows: rows.map((r) => ({ party: party ? r.party : '', material: r.material, item: r.item, size: r.size ?? '', recvPcs: r.recvPcs, recvKg: r.recvKg, retPcs: r.retPcs, retKg: r.retKg, pendKg: Math.round((r.recvKg - r.retKg) * 1000) / 1000, jobs: r.jobs.join(', ') })),
                  cols: [
                    { label: 'Party', key: 'party', width: 24 },
                    { label: 'Material', key: 'material', width: 18 },
                    { label: 'Item', key: 'item', width: 14 },
                    { label: 'Size (mm)', key: 'size', kind: 'num' },
                    { label: 'Received (PCS)', key: 'recvPcs', kind: 'num' },
                    { label: 'Received (KG)', key: 'recvKg', kind: 'num' },
                    { label: 'Returned (PCS)', key: 'retPcs', kind: 'num' },
                    { label: 'Returned (KG)', key: 'retKg', kind: 'num' },
                    { label: 'Pending (KG)', key: 'pendKg', kind: 'num' },
                    { label: 'Job cards', key: 'jobs', width: 30 },
                  ],
                  totals: ['recvPcs', 'recvKg', 'retPcs', 'retKg', 'pendKg'],
                })}
              />
            )}
          </div>
        </div>
        {all.length === 0 ? (
          <Empty icon={Boxes} title="No customer material yet" text="Material received on Job Work In as the customer's material is listed here, party by party." />
        ) : rows.length === 0 ? (
          <Empty icon={Boxes} title={onlyPending ? 'Nothing pending' : 'No matches'} text={onlyPending ? 'Every party’s material has been returned. Untick “Only with pending” to see the history.' : 'Try a different search.'} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {party && <th>Party</th>}
                  <th>Material</th>
                  <th className="r">Received</th>
                  <th className="r">Returned</th>
                  <th className="r">Pending</th>
                  <th>Job cards</th>
                </tr>
              </thead>
              <tbody>
                {byParty.map(([name, list]) => {
                  const pend = sum((r) => r.recvKg - r.retKg, list);
                  return (
                    <Fragment key={name}>
                      {list.map((r, k) => {
                        const pKg = r.recvKg - r.retKg;
                        return (
                          <tr key={`${r.material}|${r.size}`}>
                            {party && <td className="strong">{k === 0 ? name : ''}</td>}
                            <td>
                              <div className="strong">{r.material}{r.size ? ` · Ø${fmtNum(r.size)} mm` : ''}</div>
                              {r.item && <div className="sub">{r.item}</div>}
                            </td>
                            <td className="r num nowrap">{kg(r.recvKg)}<div className="sub">{fmtNum(r.recvPcs)} PCS</div></td>
                            <td className="r num nowrap">{kg(r.retKg)}<div className="sub">{fmtNum(r.retPcs)} PCS</div></td>
                            <td className="r num nowrap strong" style={{ color: pKg < -0.0005 ? 'var(--crit)' : pKg > 0.0005 ? 'var(--warn)' : undefined }}>
                              {kg(pKg)}
                              {pKg < -0.0005 && <div className="sub">more returned than received — check the weights</div>}
                            </td>
                            <td>
                              {r.jobs.map((j, i) => (
                                <span key={j}>
                                  {i > 0 && ', '}
                                  <button type="button" className="link-btn mono" onClick={() => openTrace(j)}>{j}</button>
                                </span>
                              ))}
                            </td>
                          </tr>
                        );
                      })}
                      {list.length > 1 && (
                        <tr className="sub-total">
                          {party && <td className="muted">Total {name}</td>}
                          <td />
                          <td className="r num strong">{kg(sum((r) => r.recvKg, list))}</td>
                          <td className="r num strong">{kg(sum((r) => r.retKg, list))}</td>
                          <td className="r num strong">{kg(pend)}</td>
                          <td />
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
