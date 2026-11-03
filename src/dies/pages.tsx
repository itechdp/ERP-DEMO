import { Conf, canSee, searchable, Write } from '../auth/access';
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeftRight, ChevronRight, FileText, Hammer, History, Layers, Pencil, Plus, Printer, Scissors, Undo2, Upload, Wrench, CheckCircle2, Eye } from 'lucide-react';
import { Empty, Kpi, PageHeader, Search, Tabs, FilterMenu } from '../components/ui';
import { fmtDate, matches } from '../components/format';
import { useDies } from './DieContext';
import { DemoChip, DIE_ROW, DieBadge, HistoryList, KindChip, RowMenu, Thumb } from './components';
import { diesDoc, fmtDims, fmtWt, mainDiesDoc, printDieCard } from './print';
import { ListButtons } from '../export/docOutput';
import { DIE_STATUSES, KIND_LABEL, METALS, type Die, type DieKind } from './types';
import { useTabAccess } from '../auth/tabs';

export const go = (route: string) => {
  window.location.hash = `/${route}`;
  window.scrollTo({ top: 0 });
};
export const KIND_ROUTE: Record<DieKind, string> = { forging: 'forging-die-master', trimming: 'trimming-die-master' };

function Crumbs({ items }: { items: { label: string; route?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <span key={c.label} className="crumb">
          {i > 0 && <ChevronRight size={13} />}
          {c.route ? <button onClick={() => go(c.route!)}>{c.label}</button> : <span className="cur">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** Counts shown on the summary cards, shared by every die screen. */
function useCounts() {
  const { data } = useDies();
  return useMemo(() => {
    const all = [...data.forgingDies, ...data.trimmingDies];
    return {
      mains: data.mainDies.length,
      forging: data.forgingDies.length,
      trimming: data.trimmingDies.length,
      available: all.filter((d) => d.status === 'Available').length,
      maint: all.filter((d) => d.status === 'Under Maintenance').length,
      bad: all.filter((d) => d.status === 'Damaged' || d.status === 'Retired').length,
    };
  }, [data]);
}

function SummaryCards() {
  const c = useCounts();
  return (
    <div className="grid mb" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))' }}>
      <Kpi label="Total Main Dies" value={c.mains} icon={Layers} tone="blue" />
      <Kpi label="Total Forging Dies" value={c.forging} icon={Hammer} tone="amber" />
      <Kpi label="Total Trimming Dies" value={c.trimming} icon={Scissors} tone="violet" />
      <Kpi label="Available Dies" value={c.available} icon={CheckCircle2} tone="green" />
      <Kpi label="Under Maintenance" value={c.maint} icon={Wrench} tone="teal" />
      <Kpi label="Damaged / Retired" value={c.bad} icon={AlertTriangle} tone="red" />
    </div>
  );
}

function ClickRow({ onOpen, tone, children }: { onOpen: () => void; tone: string; children: ReactNode }) {
  return (
    <tr className={`row-click ${tone}`} tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      {children}
    </tr>
  );
}

// ======================================================= 1. Die Master ===
export function DieMasterPage() {
  const { data, openUI } = useDies();
  const [q, setQ] = useState('');
  const [metal, setMetal] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [maker, setMaker] = useState('');

  const makers = useMemo(() => (canSee('party_names') ? [...new Set([...data.forgingDies, ...data.trimmingDies].map((d) => d.maker))].sort() : []), [data]);
  const rows = useMemo(
    () =>
      data.mainDies
        .map((m) => ({ m, f: data.forgingDies.filter((d) => d.mainCode === m.code), t: data.trimmingDies.filter((d) => d.mainCode === m.code) }))
        .filter(({ m, f, t }) => {
          if (metal && m.metal !== metal) return false;
          if (status && m.status !== status) return false;
          if (type === 'forging' && !f.length) return false;
          if (type === 'trimming' && !t.length) return false;
          if (maker && ![...f, ...t].some((d) => d.maker === maker)) return false;
          return matches(q, m.code, m.name, m.partCode, searchable(m.customer), ...f.map((d) => d.code), ...t.map((d) => d.code));
        }),
    [data, q, metal, status, type, maker],
  );
  const filtered = !!(q || metal || status || type || maker);

  return (
    <>
      <Crumbs items={[{ label: 'Die Management' }, { label: 'Die Master' }]} />
      <PageHeader
        eyebrow="Die Management"
        title="Die Master"
        actions={
          <>
            <ListButtons doc={() => mainDiesDoc(rows.map((r) => r.m), data)} />
            <Write res="die_master"><button className="btn btn-primary" onClick={() => openUI({ kind: 'main-form' })}>
              <Plus size={16} /> Add New Die
            </button></Write>
          </>
        }
      />
      <SummaryCards />
      <div className="card">
        <div className="card-head">
          <h3>Main Die Register</h3>
          <div className="right muted">{rows.length} of {data.mainDies.length} shown</div>
        </div>
        <div className="toolbar">
          <Search value={q} onChange={setQ} placeholder={canSee('party_names') ? 'Search die, part, customer, forging / trimming die code…' : 'Search die, part, forging / trimming die code…'} />
          <FilterMenu
            groups={[
              { label: 'Metal', value: metal, onChange: setMetal, options: [{ value: '', label: 'All metals' }, ...METALS.map((m) => ({ value: m, label: m }))] },
              { label: 'Die type', value: type, onChange: setType, options: [{ value: '', label: 'Any die type' }, { value: 'forging', label: 'Forging' }, { value: 'trimming', label: 'Trimming' }] },
              ...(makers.length ? [{ label: 'Die maker', value: maker, onChange: setMaker, options: [{ value: '', label: 'All die makers' }, ...makers.map((m) => ({ value: m, label: m }))] }] : []),
              { label: 'Status', value: status, onChange: setStatus, options: [{ value: '', label: 'All statuses' }, { value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }] },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <Empty
            icon={Layers}
            title={filtered ? 'No dies match these filters' : 'No dies yet'}
            text={filtered ? 'Try a different search or clear the filters.' : 'Add the first component to start building its die set.'}
            action={!filtered && <Write res="die_master"><button className="btn btn-primary" onClick={() => openUI({ kind: 'main-form' })}><Plus size={15} /> Add New Die</button></Write>}
          />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Sr.</th>
                  <th>Main Die Code</th>
                  <th>Die Name</th>
                  <th>Part Code</th>
                  <th>Metal</th>
                  <th className="c">Forging Dies</th>
                  <th className="c">Trimming Dies</th>
                  <th>Status</th>
                  <th className="act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ m, f, t }, i) => (
                  <ClickRow key={m.code} tone={DIE_ROW[m.status]} onOpen={() => go(`die-details?id=${m.code}`)}>
                    <td>{i + 1}</td>
                    <td>
                      <span className="mono strong">{m.code}</span> <DemoChip demo={m.demo} />
                    </td>
                    <td>
                      <div className="strong">{m.name}</div>
                      <Conf g="party_names">
                        <div className="sub">{m.customer || '—'}</div>
                      </Conf>
                    </td>
                    <td className="mono">{m.partCode}</td>
                    <td><span className={`chip metal-${m.metal.toLowerCase()}`}>{m.metal}</span></td>
                    <td className="c"><span className="count-pill kind-forging">{f.length}</span></td>
                    <td className="c"><span className="count-pill kind-trimming">{t.length}</span></td>
                    <td><DieBadge status={m.status} /></td>
                    <td className="r">
                      <RowMenu
                        actions={[
                          { label: 'Edit', icon: <Pencil size={15} />, tone: 'blue', onClick: () => openUI({ kind: 'main-form', code: m.code }) },
                          { label: 'View details', icon: <Eye size={15} />, tone: 'teal', onClick: () => go(`die-details?id=${m.code}`) },
                          { label: 'Die history', icon: <History size={15} />, tone: 'violet', onClick: () => go(`die-details?id=${m.code}&tab=history`) },
                          { label: 'Add forging die', icon: <Hammer size={15} />, tone: 'amber', onClick: () => openUI({ kind: 'die-form', dieKind: 'forging', mainCode: m.code }) },
                          { label: 'Add trimming die', icon: <Scissors size={15} />, tone: 'orange', onClick: () => openUI({ kind: 'die-form', dieKind: 'trimming', mainCode: m.code }) },
                          { label: 'Print die card', icon: <Printer size={15} />, tone: 'neutral', onClick: () => printDieCard(m, data) },
                        ]}
                      />
                    </td>
                  </ClickRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ============================================= 2 / 3. Forging & Trimming ===
export function DieRegisterPage({ kind }: { kind: DieKind }) {
  const { data, diesOf, openUI } = useDies();
  const [q, setQ] = useState('');
  const [metal, setMetal] = useState('');
  const [maker, setMaker] = useState('');
  const [status, setStatus] = useState('');
  const dies = diesOf(kind);
  const mainOf = (d: Die) => data.mainDies.find((m) => m.code === d.mainCode)!;
  const makers = useMemo(() => (canSee('party_names') ? [...new Set(dies.map((d) => d.maker))].sort() : []), [dies]);

  const rows = dies
    .filter((d) => (!metal || mainOf(d).metal === metal) && (!maker || d.maker === maker) && (!status || d.status === status))
    .filter((d) => matches(q, d.code, d.mainCode, mainOf(d).name, mainOf(d).partCode, d.material, searchable(d.maker), d.location))
    .sort((a, b) => a.makingDate.localeCompare(b.makingDate) || a.code.localeCompare(b.code));
  const filtered = !!(q || metal || maker || status);
  const label = KIND_LABEL[kind];
  const Ic = kind === 'forging' ? Hammer : Scissors;

  return (
    <>
      <Crumbs items={[{ label: 'Die Management' }, { label: `${label} Die Master` }]} />
      <PageHeader
        eyebrow="Die Management"
        title={`${label} Die Master`}
        actions={
          <>
            <ListButtons doc={() => diesDoc(kind, rows, data)} />
            <Write res={kind === 'forging' ? 'forging_dies' : 'trimming_dies'}><button className="btn btn-primary" onClick={() => openUI({ kind: 'die-form', dieKind: kind })} disabled={!data.mainDies.length}>
              <Plus size={16} /> Add {label} Die
            </button></Write>
          </>
        }
      />
      <SummaryCards />
      <div className="card">
        <div className="card-head">
          <h3>{label} Die Register</h3>
          <div className="right muted">{rows.length} of {dies.length} shown</div>
        </div>
        <div className="toolbar">
          <Search value={q} onChange={setQ} placeholder={`Search ${kind} die, main die, component, part code${canSee('party_names') ? ', maker' : ''}…`} />
          <FilterMenu
            groups={[
              { label: 'Metal', value: metal, onChange: setMetal, options: [{ value: '', label: 'All metals' }, ...METALS.map((m) => ({ value: m, label: m }))] },
              ...(makers.length ? [{ label: 'Die maker', value: maker, onChange: setMaker, options: [{ value: '', label: 'All die makers' }, ...makers.map((m) => ({ value: m, label: m }))] }] : []),
              { label: 'Status', value: status, onChange: setStatus, options: [{ value: '', label: 'All statuses' }, ...DIE_STATUSES.map((s) => ({ value: s, label: s }))] },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <Empty
            icon={Ic}
            title={filtered ? 'No dies match these filters' : `No ${kind} dies yet`}
            text={filtered ? 'Try a different search or clear the filters.' : data.mainDies.length ? `Add a ${kind} die.` : 'Create a Main Die first, then add its dies.'}
            action={!filtered && data.mainDies.length > 0 && <Write res={kind === 'forging' ? 'forging_dies' : 'trimming_dies'}><button className="btn btn-primary" onClick={() => openUI({ kind: 'die-form', dieKind: kind })}><Plus size={15} /> Add {label} Die</button></Write>}
          />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{label} Die</th>
                  <th>Main Die / Component</th>
                  <th>Material</th>
                  <th>Making Date</th>
                  <Conf g="party_names">
                    <th>Maker</th>
                  </Conf>
                  <Conf col="die.location">
                    <th>Location</th>
                  </Conf>
                  <th>Images</th>
                  <th>Status</th>
                  <th className="act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <ClickRow key={d.code} tone={DIE_ROW[d.status]} onOpen={() => openUI({ kind: 'die-view', dieKind: kind, code: d.code })}>
                    <td>
                      <span className="mono strong">{d.code}</span> <DemoChip demo={d.demo} />
                      {d.replacesCode && <div className="sub">replaces {d.replacesCode}</div>}
                    </td>
                    <td>
                      <div className="strong">{mainOf(d).name}</div>
                      <div className="sub mono">{d.mainCode} · {mainOf(d).partCode}</div>
                    </td>
                    <td>{d.material}</td>
                    <td>{fmtDate(d.makingDate)}</td>
                    <Conf g="party_names">
                      <td>{d.maker}</td>
                    </Conf>
                    <Conf col="die.location">
                      <td>{d.location || '—'}</td>
                    </Conf>
                    <td>
                      <div className="thumbs">
                        <Thumb id={d.topImg} label="Top die" />
                        <Thumb id={d.bottomImg} label="Bottom die" />
                      </div>
                    </td>
                    <td><DieBadge status={d.status} /></td>
                    <td className="r">
                      <RowMenu
                        actions={[
                          { label: 'Edit', icon: <Pencil size={15} />, tone: 'blue', onClick: () => openUI({ kind: 'die-form', dieKind: kind, code: d.code }) },
                          !d.replacedByCode && { label: 'Replace die', icon: <ArrowLeftRight size={15} />, tone: 'orange', onClick: () => openUI({ kind: 'replace', dieKind: kind, code: d.code }) },
                          d.status !== 'Retired' && { label: 'Maintenance', icon: <Wrench size={15} />, tone: 'amber', onClick: () => openUI({ kind: 'maintenance', dieKind: kind, code: d.code }) },
                          d.status === 'Available' && { label: 'Issue to production', icon: <Upload size={15} />, tone: 'green', onClick: () => openUI({ kind: 'issue', dieKind: kind, code: d.code }) },
                          d.status === 'In Production' && { label: 'Return from production', icon: <Undo2 size={15} />, tone: 'teal', onClick: () => openUI({ kind: 'return', dieKind: kind, code: d.code }) },
                          { label: 'History', icon: <History size={15} />, tone: 'violet', onClick: () => go(`die-details?id=${d.mainCode}&tab=history`) },
                          { label: 'Print die card', icon: <Printer size={15} />, tone: 'neutral', onClick: () => printDieCard(mainOf(d), data, d) },
                        ]}
                      />
                    </td>
                  </ClickRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ================================================== 4. Details / History ===
type Tab = 'forging' | 'trimming' | 'history' | 'images';

export function DieDetailsPage({ query }: { query: URLSearchParams }) {
  const { data, openUI } = useDies();
  const id = query.get('id') ?? '';
  const main = data.mainDies.find((m) => m.code === id);
  const [tab0, setTab] = useState<Tab>((['forging', 'trimming', 'history', 'images'] as const).find((t) => t === query.get('tab')) ?? 'forging');
  const ta = useTabAccess('die_details', ['forging', 'trimming', 'history', 'images'] as const);
  const tab = ta.pick(tab0);
  const [hq, setHq] = useState('');

  // ---- no component chosen: a picker
  if (!main) {
    const list = data.mainDies.filter((m) => matches(hq, m.code, m.name, m.partCode, searchable(m.customer)));
    return (
      <>
        <Crumbs items={[{ label: 'Die Management' }, { label: 'Die Details / Die History' }]} />
        <PageHeader eyebrow="Die Management" title="Die Details / Die History" />
        {id && <div className="banner-bad mb">No main die with code “{id}”. Pick one below.</div>}
        <div className="card">
          <div className="toolbar" style={{ paddingTop: 18 }}>
            <Search value={hq} onChange={setHq} placeholder="Search main die, component, part code…" />
          </div>
          {list.length === 0 ? (
            <Empty icon={Layers} title="No main dies" text="Add a die in Die Master first." action={<button className="btn btn-primary" onClick={() => go('die-master')}>Open Die Master</button>} />
          ) : (
            <div className="grid pick-grid">
              {list.map((m) => (
                <button key={m.code} className="pick" onClick={() => go(`die-details?id=${m.code}`)}>
                  <span className="mono strong">{m.code}</span>
                  <b>{m.name}</b>
                  <span className="muted">{m.partCode} · {m.metal}</span>
                  <span className="pick-counts">
                    <span className="count-pill kind-forging">{data.forgingDies.filter((d) => d.mainCode === m.code).length} forging</span>
                    <span className="count-pill kind-trimming">{data.trimmingDies.filter((d) => d.mainCode === m.code).length} trimming</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  const f = data.forgingDies.filter((d) => d.mainCode === main.code).sort((a, b) => a.makingDate.localeCompare(b.makingDate));
  const t = data.trimmingDies.filter((d) => d.mainCode === main.code).sort((a, b) => a.makingDate.localeCompare(b.makingDate));
  const events = data.history.filter((h) => h.mainCode === main.code);
  const info: [string, ReactNode][] = [
    ['Main Die Code', <span className="mono strong">{main.code}</span>],
    ['Component Name', main.name],
    ['Part Code', <span className="mono">{main.partCode}</span>],
    ['Part Description', main.description || '—'],
    ...(canSee('party_names') ? ([['Customer', main.customer || '—']] as [string, ReactNode][]) : []),
    ['Metal Type', main.metal],
    ['Creation Date', fmtDate(main.createdOn)],
    ['Status', <DieBadge status={main.status} />],
  ];

  return (
    <>
      <Crumbs items={[{ label: 'Die Management' }, { label: 'Die Master', route: 'die-master' }, { label: main.code }]} />
      <PageHeader
        eyebrow="Die Management · Component profile"
        title={main.name}
        subtitle={main.remarks || undefined}
        actions={
          <>
            <button className="btn" onClick={() => printDieCard(main, data)}>
              <Printer size={16} /> Print Die Card
            </button>
            <Write res="die_master"><button className="btn" onClick={() => openUI({ kind: 'main-form', code: main.code })}>
              <Pencil size={16} /> Edit
            </button></Write>
          </>
        }
      />
      <div className="card mb">
        <div className="card-head">
          <h3>Component Information</h3>
          <div className="right"><DemoChip demo={main.demo} /></div>
        </div>
        <div className="card-body">
          <div className="kv-grid">
            {info.map(([k, v]) => (
              <div className="kv" key={k}>
                <span>{k}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="toolbar" style={{ paddingTop: 18 }}>
          <Tabs
            value={tab}
            onChange={setTab}
            items={ta.only([
              { value: 'forging', label: 'Forging Dies', count: f.length, tone: 'amber' },
              { value: 'trimming', label: 'Trimming Dies', count: t.length, tone: 'violet' },
              { value: 'history', label: 'Die History', count: events.length, tone: 'blue' },
              { value: 'images', label: 'Images & Drawings', tone: 'teal' },
            ])}
          />
        </div>

        {(tab === 'forging' || tab === 'trimming') && (
          <DieList kind={tab} dies={tab === 'forging' ? f : t} mainCode={main.code} />
        )}

        {tab === 'history' && <HistoryTab f={f} t={t} events={events} />}

        {tab === 'images' && (
          <div className="card-body">
            {f.length + t.length === 0 ? (
              <Empty icon={FileText} title="No dies yet" text="Add a forging or trimming die to see its images and drawing details." />
            ) : (
              <div className="grid img-grid">
                {[...f, ...t].map((d) => (
                  <div className="img-card" key={d.code}>
                    <div className="img-card-head">
                      <KindChip kind={d.kind} /> <span className="mono strong">{d.code}</span> <DieBadge status={d.status} />
                    </div>
                    <div className="die-imgs">
                      <Thumb big id={d.topImg} label="Top die" />
                      <Thumb big id={d.bottomImg} label="Bottom die" />
                    </div>
                    <div className="kv-grid one">
                      <div className="kv"><span>Revision</span><b>{d.revision || '—'}</b></div>
                    </div>
                    <button className="btn btn-sm" onClick={() => openUI({ kind: 'die-view', dieKind: d.kind, code: d.code })}>Open die</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function DieList({ kind, dies, mainCode }: { kind: DieKind; dies: Die[]; mainCode: string }) {
  const { openUI } = useDies();
  const label = KIND_LABEL[kind];
  return (
    <>
      <div className="toolbar">
        <span className="muted">{dies.length === 1 ? '1 die' : `${dies.length} dies`} linked to this component.</span>
        <Write res={kind === 'forging' ? 'forging_dies' : 'trimming_dies'}><button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => openUI({ kind: 'die-form', dieKind: kind, mainCode })}>
          <Plus size={15} /> Add {label} Die
        </button></Write>
      </div>
      {dies.length === 0 ? (
        <Empty icon={kind === 'forging' ? Hammer : Scissors} title={`No ${kind} dies yet`} text={`Add a ${kind} die and it will appear here.`} />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>{label} Die</th>
                <th>Material</th>
                <th>Making Date</th>
                <Conf g="party_names">
                    <th>Maker</th>
                  </Conf>
                <th>Size (top)</th>
                <th>Images</th>
                <th>Status</th>
                <th className="act">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dies.map((d) => (
                <ClickRow key={d.code} tone={DIE_ROW[d.status]} onOpen={() => openUI({ kind: 'die-view', dieKind: kind, code: d.code })}>
                  <td>
                    <span className="mono strong">{d.code}</span> <DemoChip demo={d.demo} />
                    {d.replacesCode && <div className="sub">replaces {d.replacesCode}</div>}
                    {d.replacedByCode && <div className="sub">replaced by {d.replacedByCode}</div>}
                  </td>
                  <td>{d.material}</td>
                  <td>{fmtDate(d.makingDate)}</td>
                  <Conf g="party_names">
                      <td>{d.maker}</td>
                    </Conf>
                  <td>
                    <div>{fmtDims(d.top)}</div>
                    <div className="sub">{fmtWt(d.topWeight)}</div>
                  </td>
                  <td>
                    <div className="thumbs">
                      <Thumb id={d.topImg} label="Top die" />
                      <Thumb id={d.bottomImg} label="Bottom die" />
                    </div>
                  </td>
                  <td><DieBadge status={d.status} /></td>
                  <td className="r">
                    <RowMenu
                      actions={[
                        { label: 'Open', icon: <Eye size={15} />, tone: 'teal', onClick: () => openUI({ kind: 'die-view', dieKind: kind, code: d.code }) },
                        { label: 'Edit', icon: <Pencil size={15} />, tone: 'blue', onClick: () => openUI({ kind: 'die-form', dieKind: kind, code: d.code }) },
                        !d.replacedByCode && { label: 'Replace die', icon: <ArrowLeftRight size={15} />, tone: 'orange', onClick: () => openUI({ kind: 'replace', dieKind: kind, code: d.code }) },
                      ]}
                    />
                  </td>
                </ClickRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Forging and trimming histories side by side, never mixed. */
function HistoryTab({ f, t, events }: { f: Die[]; t: Die[]; events: ReturnType<typeof useDies>['data']['history'] }) {
  const [code, setCode] = useState('');
  const pick = (k: DieKind) => events.filter((h) => h.kind === k && (!code || h.dieCode === code));
  const codes = [...f, ...t].map((d) => d.code);
  return (
    <div className="card-body">
      <div className="toolbar" style={{ padding: '0 0 14px' }}>
        <FilterMenu groups={[{ label: 'Die', value: code, onChange: setCode, options: [{ value: '', label: 'All dies of this component' }, ...codes.map((c) => ({ value: c, label: c }))] }]} />
      </div>
      <div className="hist-cols">
        {(['forging', 'trimming'] as const).map((k) => (
          <section key={k} className={`hist-col kind-${k}`}>
            <h4>
              {k === 'forging' ? <Hammer size={16} /> : <Scissors size={16} />} {KIND_LABEL[k]} die history
              <span className="cnt">{pick(k).length}</span>
            </h4>
            <HistoryList events={pick(k)} />
          </section>
        ))}
      </div>
    </div>
  );
}
