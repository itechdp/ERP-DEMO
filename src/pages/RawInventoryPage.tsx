import * as api from '../db/api';
import { Conf, searchable, useAccess, canSee, Write, searchableCol } from '../auth/access';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Boxes, Eye, Layers, PackagePlus, PackageX, Pencil, Send, ShieldCheck, Trash2 } from 'lucide-react';
import type { RawMaterialLot } from '../store/types';
import { lotDeleteReason } from '../store/deletable';
import { useStore } from '../store/StoreContext';
import { withDocNo } from '../db/client';
import { DocNoField, useDocNo } from '../components/DocNoField';
import { lotAvailableWeight, lotIssuedQty, lotStatus, materialKey } from '../store/engine';
import { ADD_NEW, useAddMaterial, useAddOption } from '../masters/AddItem';
import { findMaterial, MATERIAL_FAMILIES, MATERIAL_MASTER, pieceWeightKg, STANDARD_OD_MM } from '../store/materials';
import { Badge, Empty, Field, JobLink, Modal, NumInput, PageHeader, rowTone, Search, SummaryLine, Tabs, FilterMenu, Confirm } from '../components/ui';
import { fmtDate, fmtDateTime, fmtKg, fmtNum, matches, todayISO } from '../components/format';
import { InwardPoSection } from '../purchase/components/InwardPoSection';
import { LotQcModal } from './LotQcModal';
import { RawAdjustModal } from '../components/AdjustModals';
import { useTabAccess } from '../auth/tabs';
import { DocButtons } from '../export/docOutput';
import * as docs from '../export/documents';
import { ListButtons } from '../export/docOutput';
import { FORM_FORMATS } from '../export/xlsxSheet';

type View = 'stock' | 'inward' | 'issues';

export function RawInventoryPage() {
  const { state, openAction, run } = useStore();
  const [deleting, setDeleting] = useState<RawMaterialLot | null>(null);
  const [qcLot, setQcLot] = useState<RawMaterialLot | null>(null);
  const [adjusting, setAdjusting] = useState<RawMaterialLot | null>(null);
  const { canWrite } = useAccess();
  const canQc = canWrite('raw_inventory') || canWrite('qc');
  // #/raw-inventory?lot=RM-2026-001 opens the inward register filtered to that lot
  const lotParam = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('lot') ?? '';
  const [view0, setView] = useState<View>(lotParam ? 'inward' : 'stock');
  const ta = useTabAccess('raw_inventory', ['stock', 'inward', 'issues'] as const);
  const view = ta.pick(view0);
  const [q, setQ] = useState(lotParam);
  const [matF, setMatF] = useState('');
  const [statF, setStatF] = useState('');
  const [inMatF, setInMatF] = useState('');
  const [supF, setSupF] = useState('');
  const [toF, setToF] = useState('');
  const lots = state.rawMaterials;
  // the stock cards sit in one row with no visible scroll bar: the mouse wheel scrolls them sideways (trackpad / touch / Shift+wheel already do)
  const cardsRef = useRef<HTMLDivElement>(null);
  const cardCount = new Set(lots.map((l) => materialKey(l.material, l.od))).size;
  useEffect(() => {
    const el = cardsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0;
      if (atStart || atEnd) return; // at the ends the page scrolls as usual
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [cardCount]);

  const totalQty = lots.reduce((t, l) => t + l.availableQty, 0);
  const totalKg = lots.reduce((t, l) => t + lotAvailableWeight(l), 0);
  const issues = state.movements.filter((m) => m.from === 'Raw Inventory');
  const issuedQty = issues.reduce((t, m) => t + m.qty, 0);
  const low = lots.filter((l) => lotStatus(l) === 'Low Stock');

  // Summary per material + OD
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; material: string; od: number; avail: number; inward: number; kg: number }>();
    for (const l of lots) {
      const key = materialKey(l.material, l.od);
      const g = m.get(key) ?? { key, material: l.material, od: l.od, avail: 0, inward: 0, kg: 0 };
      g.avail += l.availableQty;
      g.inward += l.inwardQty;
      g.kg += lotAvailableWeight(l);
      m.set(key, g);
    }
    return [...m.values()];
  }, [lots]);
  const stockRows = lots
    .filter((l) => !matF || materialKey(l.material, l.od) === matF)
    .filter((l) => !statF || lotStatus(l) === statF)
    .filter((l) => matches(q, l.id, l.material, l.materialType, searchable(l.supplier), searchableCol(l.heatNo, 'raw.heat_no'), `${l.od}`))
    .slice()
    .sort((a, b) => a.inwardDate.localeCompare(b.inwardDate) || a.id.localeCompare(b.id));

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Step 1 of 8"
        title="Raw Inventory"
        flow="raw"
        actions={
          <>
            <ListButtons doc={() => ({ filename: 'Raw-Material-Stock', title: 'Raw Material Stock', form: FORM_FORMATS.report, rows: state.rawMaterials.map((l) => ({ id: l.id, date: l.inwardDate, material: l.material, grade: l.materialType, od: l.od, supplier: canSee('party_names') ? l.supplier : '', heat: l.heatNo, inward: l.inwardQty, available: l.availableQty, weight: l.inwardWeight, po: l.poNo ?? '' })), cols: [{ label: 'Lot', key: 'id' }, { label: 'Inward Date', key: 'date', kind: 'date' }, { label: 'Material', key: 'material', width: 28 }, { label: 'Grade', key: 'grade', width: 22 }, { label: 'OD (mm)', key: 'od', kind: 'num' }, { label: 'Supplier', key: 'supplier', width: 24 }, { label: 'Heat No.', key: 'heat' }, { label: 'Inward (PCS)', key: 'inward', kind: 'num' }, { label: 'Available (PCS)', key: 'available', kind: 'num' }, { label: 'Weight (KG)', key: 'weight', kind: 'num' }, { label: 'PO', key: 'po' }], totals: ['inward', 'available', 'weight'] })} />
            <Write res="raw_inventory"><button className="btn btn-primary" onClick={() => openAction({ kind: 'inward' })}>
              <PackagePlus size={16} /> Add Raw Material Inward
            </button></Write>
          </>
        }
      />
      <div className="card mb">
        <div className="card-head">
          <div>
            <h3>Stock by Material &amp; OD</h3>
          </div>
          {lots.length > 0 && (
            <div className="right">
              <SummaryLine
                items={[
                  { label: `PCS in stock (${fmtNum(Math.round(totalKg * 10) / 10)} KG)`, value: fmtNum(totalQty), tone: 'info' },
                  { label: 'PCS issued to production', value: fmtNum(issuedQty) },
                  ...(low.length ? [{ label: low.length === 1 ? 'lot low on stock' : 'lots low on stock', value: low.length, tone: 'bad' as const }] : []),
                ]}
              />
            </div>
          )}
        </div>
        <div className="card-body">
          {groups.length === 0 && (
            <Empty
              icon={Boxes}
              title="No raw material in stock"
              text="Record your first inward — material, OD / size, quantity and weight. Stock appears here by material and OD."
              action={
                <Write res="raw_inventory"><button className="btn btn-primary" onClick={() => openAction({ kind: 'inward' })}>
                  <PackagePlus size={15} /> Add Raw Material Inward
                </button></Write>
              }
            />
          )}
          {/* one compact row of cards, however many materials there are (it scrolls sideways only when they no longer fit) */}
          <div className="grid stock-cards" ref={cardsRef}>
            {groups.map((g) => (
              <button
                key={g.key}
                className="kpi"
                style={{ boxShadow: 'none', outline: matF === g.key ? '2px solid var(--primary)' : undefined }}
                onClick={() => {
                  setMatF(matF === g.key ? '' : g.key);
                  setView('stock');
                }}
              >
                <div className="kpi-top">
                  <span className="kpi-label">{g.material}</span>
                  <span className="chip">OD {g.od} mm</span>
                </div>
                <div className="kpi-value">
                  {fmtNum(g.avail)}
                  <small>PCS</small>
                </div>
                <div className="kpi-hint">{fmtKg(Math.round(g.kg * 1000) / 1000)}</div>
                <div style={{ height: 6, background: 'var(--neutral-bg)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
                  <div style={{ width: `${g.inward ? (g.avail / g.inward) * 100 : 0}%`, height: '100%', background: '#2a78d6', borderRadius: 3 }} />
                </div>
                <div className="kpi-hint">
                  {fmtNum(g.avail)} of {fmtNum(g.inward)} PCS received
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <Tabs
            value={view}
            onChange={setView}
            items={ta.only([
              { value: 'stock', label: 'Raw Material Stock', count: lots.length, tone: 'blue' },
              { value: 'inward', label: 'Inward Register', count: state.rawInwards.length, tone: 'violet' },
              { value: 'issues', label: 'Issues to Production', count: issues.length, tone: 'amber' },
            ])}
          />
          <Search value={q} onChange={setQ} placeholder={canSee('party_names') ? 'Search material, supplier, lot, heat no…' : 'Search material, lot, heat no…'} />
          <FilterMenu
            groups={
              view === 'stock'
                ? [
                    { label: 'Material', value: matF, onChange: setMatF, options: [{ value: '', label: 'All materials' }, ...groups.map((g) => ({ value: g.key, label: `${g.material} — OD ${g.od}` }))] },
                    { label: 'Status', value: statF, onChange: setStatF, options: [{ value: '', label: 'All' }, ...['Available', 'Low Stock', 'Consumed'].map((s) => ({ value: s, label: s, count: lots.filter((l) => lotStatus(l) === s).length }))] },
                  ]
                : view === 'inward'
                  ? [
                      { label: 'Material', value: inMatF, onChange: setInMatF, options: [{ value: '', label: 'All materials' }, ...[...new Set(state.rawInwards.map((i) => i.material))].sort().map((m) => ({ value: m, label: m }))] },
                      ...(canSee('party_names') ? [{ label: 'Supplier', value: supF, onChange: setSupF, options: [{ value: '', label: 'All suppliers' }, ...[...new Set(state.rawInwards.map((i) => i.supplier).filter(Boolean))].sort().map((s) => ({ value: s, label: s }))] }] : []),
                    ]
                  : [{ label: 'Issued to', value: toF, onChange: setToF, options: [{ value: '', label: 'All stages' }, ...[...new Set(issues.map((m) => m.to))].sort().map((s) => ({ value: s, label: s }))] }]
            }
          />
        </div>

        {view === 'stock' &&
          (stockRows.length === 0 ? (
            <Empty icon={Boxes} title="No raw material found" text="Add a raw material inward to create stock." />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Lot No.</th>
                    <th>Material</th>
                    <th>Material Type</th>
                    <th>OD / Size</th>
                    <Conf g="party_names">
                      <th>Supplier</th>
                    </Conf>
                    <Conf g="purchase_rates">
                      <th className="r">Purchase Rate</th>
                    </Conf>
                    <th>Inward Date</th>
                    <th className="r">Inward Qty</th>
                    <th className="r">Available Qty</th>
                    <th className="r">Available Weight</th>
                    <th>Unit</th>
                    <th>Status</th>
                    <th className="act">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stockRows.map((l) => (
                    <tr key={l.id} className={rowTone(lotStatus(l))}>
                      <td>
                        <div className="mono strong nowrap">{l.id}</div>
                        <Conf col="raw.heat_no">
                          <div className="sub">Heat {l.heatNo}</div>
                        </Conf>
                      </td>
                      <td className="strong">{l.material}</td>
                      <td>{l.materialType}</td>
                      <td className="nowrap">OD {l.od} mm</td>
                      <Conf g="party_names">
                        <td>{l.supplier}</td>
                      </Conf>
                      <Conf g="purchase_rates">
                        <td className="r num nowrap">{l.purchaseRate ? `₹ ${l.purchaseRate.toLocaleString('en-IN')} / kg` : '—'}</td>
                      </Conf>
                      <td className="nowrap">{fmtDate(l.inwardDate)}</td>
                      <td className="r num">
                        {fmtNum(l.inwardQty)}
                        <div className="sub">{fmtKg(l.inwardWeight)}</div>
                      </td>
                      <td className="r">
                        <span className="qty-cell" style={{ fontSize: 15 }}>
                          {fmtNum(l.availableQty)}
                        </span>
                        {lotIssuedQty(l) > 0 && <div className="sub loss">−{fmtNum(lotIssuedQty(l))} issued</div>}
                        {(l.blockedQty ?? 0) > 0 && <div className="sub loss">−{fmtNum(l.blockedQty ?? 0)} rejected at QC</div>}
                      </td>
                      <td className="r num nowrap">{fmtKg(lotAvailableWeight(l))}</td>
                      <td>{l.unit}</td>
                      <td>
                        <Badge status={lotStatus(l)} />
                        {l.qcStatus && (
                          <div style={{ marginTop: 4 }}>
                            <Badge status={l.qcStatus === 'Pending' ? 'QC Pending' : l.qcStatus} />
                          </div>
                        )}
                      </td>
                      <td className="r nowrap">
                        <div className="icon-actions">
                          <button className="icon-btn" title="View" aria-label={`View ${l.id}`} onClick={() => openAction({ kind: 'inward', id: l.id, view: true })}>
                            <Eye size={16} />
                          </button>
                          <DocButtons compact build={(u) => docs.goodsReceiptSpec(l, u)} />
                          {canQc && l.qcStatus !== undefined && (
                            <button className="icon-btn" title="Record incoming QC" aria-label={`Incoming QC ${l.id}`} onClick={() => setQcLot(l)}>
                              <ShieldCheck size={16} />
                            </button>
                          )}
                          <Write res="raw_inventory">
                            <button className="icon-btn" title="Adjust stock: count difference, scrap, return to supplier" aria-label={`Adjust ${l.id}`} disabled={l.availableQty <= 0} onClick={() => setAdjusting(l)}>
                              <PackageX size={16} />
                            </button>
                            <button className="icon-btn" title="Edit" aria-label={`Edit ${l.id}`} onClick={() => openAction({ kind: 'inward', id: l.id })}>
                              <Pencil size={16} />
                            </button>
                            <button className="icon-btn danger" title={lotDeleteReason(l) ?? 'Delete'} aria-label={`Delete ${l.id}`} disabled={!!lotDeleteReason(l)} onClick={() => setDeleting(l)}>
                              <Trash2 size={16} />
                            </button>
                          </Write>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {view === 'inward' && (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Inward Date</th>
                  <th>Lot No.</th>
                  <th>Material</th>
                  <th>OD / Size</th>
                  <Conf g="party_names">
                    <th>Supplier</th>
                  </Conf>
                  <Conf g="invoices">
                    <th>Invoice</th>
                  </Conf>
                  <th className="r">Quantity</th>
                  <th className="r">Weight</th>
                  <th className="act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.rawInwards
                  .filter((i) => (!inMatF || i.material === inMatF) && (!supF || i.supplier === supF))
                  .filter((i) => matches(q, i.lotId, i.material, searchable(i.supplier), searchable(i.invoiceNo, 'invoices')))
                  .map((i) => (
                    <tr key={i.id}>
                      <td className="nowrap">{fmtDate(i.date)}</td>
                      <td className="mono strong">{i.lotId}</td>
                      <td>
                        <div className="strong">{i.material}</div>
                        <div className="sub">{i.materialType}</div>
                      </td>
                      <td>OD {i.od} mm</td>
                      <Conf g="party_names">
                        <td>{i.supplier}</td>
                      </Conf>
                      <Conf g="invoices">
                        <td className="mono">{i.invoiceNo}</td>
                      </Conf>
                      <td className="r qty-cell">
                        <span className="gain">+{fmtNum(i.qty)}</span>
                      </td>
                      <td className="r num">{fmtKg(i.weight)}</td>
                      {(() => {
                        const lot = state.rawMaterials.find((x) => x.id === i.lotId);
                        return lot ? (
                          <td className="r nowrap">
                            <div className="icon-actions">
                              <button className="icon-btn" title="View" aria-label={`View ${lot.id}`} onClick={() => openAction({ kind: 'inward', id: lot.id, view: true })}>
                                <Eye size={16} />
                              </button>
                              {canQc && lot.qcStatus !== undefined && (
                                <button className="icon-btn" title="Record incoming QC" aria-label={`Incoming QC ${lot.id}`} onClick={() => setQcLot(lot)}>
                                  <ShieldCheck size={16} />
                                </button>
                              )}
                              <Write res="raw_inventory">
                                <button className="icon-btn" title="Edit" aria-label={`Edit ${lot.id}`} onClick={() => openAction({ kind: 'inward', id: lot.id })}>
                                  <Pencil size={16} />
                                </button>
                                <button className="icon-btn danger" title={lotDeleteReason(lot) ?? 'Delete'} aria-label={`Delete ${lot.id}`} disabled={!!lotDeleteReason(lot)} onClick={() => setDeleting(lot)}>
                                  <Trash2 size={16} />
                                </button>
                              </Write>
                            </div>
                          </td>
                        ) : (
                          <td />
                        );
                      })()}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {view === 'issues' &&
          (issues.length === 0 ? (
            <Empty icon={Send} title="No material issued yet" text="Material is issued when a Cutting job starts." />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date / Time</th>
                    <th>Job No.</th>
                    <th>Issued To</th>
                    <th>Lot / Note</th>
                    <th className="r">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {issues
                    .filter((m) => !toF || m.to === toF)
                    .filter((m) => matches(q, m.jobNo, m.note))
                    .map((m) => (
                      <tr key={m.id}>
                        <td className="nowrap">{fmtDateTime(m.ts)}</td>
                        <td>
                          <JobLink jobNo={m.jobNo} />
                        </td>
                        <td>{m.to}</td>
                        <td className="muted">{m.note}</td>
                        <td className="r qty-cell">
                          <span className="loss">−{fmtNum(m.qty)}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>
      {qcLot && <LotQcModal lot={qcLot} onClose={() => setQcLot(null)} />}
      {adjusting && <RawAdjustModal lot={adjusting} onClose={() => setAdjusting(null)} />}
      <Confirm
        open={!!deleting}
        title="Delete raw material inward"
        message={deleting ? `Delete lot ${deleting.id} — ${fmtNum(deleting.inwardQty)} PCS of ${deleting.material}? Nothing has been issued from it, so it is removed from stock and the quantity ledger.` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => deleting && void run((ts) => api.deleteInward(deleting.id, ts), { title: 'Inward deleted', message: `${deleting.id} · ${fmtNum(deleting.inwardQty)} PCS ${deleting.material}` })}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

export function InwardModal({ preset, onClose }: { preset?: { material?: string; od?: number; id?: string; view?: boolean }; onClose: () => void }) {
  const { state, run, masters, busy } = useStore();
  // editing an existing inward: every field can be corrected; what is already issued to production limits quantity, material and size
  const lot = preset?.id ? state.rawMaterials.find((l) => l.id === preset.id) : undefined;
  const issued = lot ? lotIssuedQty(lot) : 0;
  const blocked = lot?.blockedQty ?? 0;
  const first = findMaterial(lot?.material ?? preset?.material ?? '') ?? MATERIAL_MASTER[0];
  const [material, setMaterial] = useState(first.material);
  const [od, setOd] = useState(String(lot?.od ?? preset?.od ?? first.defaultOd));
  const [supplier, setSupplier] = useState(lot?.supplier ?? '');
  const [date, setDate] = useState(lot?.inwardDate ?? todayISO());
  const [invoice, setInvoice] = useState(lot?.invoiceNo ?? '');
  const [rate, setRate] = useState(lot?.purchaseRate ? String(lot.purchaseRate) : '');
  const { can } = useAccess();
  const [heatNo, setHeatNo] = useState(lot?.heatNo ?? '');
  const doc = useDocNo('inward', !lot);
  const [qty, setQty] = useState(lot ? String(lot.inwardQty) : '');
  const [pieceLength, setPieceLength] = useState('');
  const [weightOverride, setWeightOverride] = useState<string | null>(lot ? String(lot.inwardWeight) : null);
  // booking the receipt against a purchase order line (optional)
  const [poId, setPoId] = useState<number | null>(null);
  const [poItemId, setPoItemId] = useState<number | null>(null);
  const [unlinked, setUnlinked] = useState(false);
  const linkedPoNo = lot?.poId && !unlinked ? lot.poNo ?? 'a purchase order' : undefined;

  const spec = findMaterial(material) ?? first;
  const qN = Number(qty);
  const odN = Number(od);
  const lenN = Number(pieceLength);
  const perPiece = odN > 0 && lenN > 0 ? pieceWeightKg(odN, lenN, spec.density) : 0;
  const theoretical = perPiece && qN > 0 ? Math.round(perPiece * qN * 1000) / 1000 : 0;
  const weight = weightOverride ?? (theoretical ? String(theoretical) : '');
  const wN = Number(weight);

  const errQty = qty !== '' && (!(qN > 0) || !Number.isInteger(qN)) ? 'Enter a whole number of pieces' : qty !== '' && qN < issued + blocked ? `At least ${fmtNum(issued + blocked)} PCS — ${fmtNum(issued)} are issued to production${blocked ? ` and ${fmtNum(blocked)} were rejected at QC` : ''}` : null;
  // roles that cannot see supplier names type it write-only; when correcting a lot they may leave it empty (the stored name is kept)
  const valid = (!!supplier || !!poItemId || !!linkedPoNo || (!!lot && !can('party_names'))) && !errQty && odN > 0 && qN > 0 && Number.isInteger(qN) && wN > 0;

  const pickMaterial = (m: string) => {
    setMaterial(m);
    const next = findMaterial(m);
    if (next) setOd(String(next.defaultOd));
    setWeightOverride(null);
  };

  const addMaterial = useAddMaterial((n) => pickMaterial(n));
  const addSize = useAddOption('od_size', (v) => {
    setOd(v);
    setWeightOverride(null);
  });

  // PO fields sent with the receipt. New lot: only when a line is chosen. Editing: untouched unless the link is changed; null removes it.
  const poFields = (): { poId?: number | null; poItemId?: number | null } => {
    if (poItemId) return { poId, poItemId };
    if (lot && lot.poId !== undefined) return unlinked ? { poId: null, poItemId: null } : { poId: lot.poId, poItemId: lot.poItemId ?? null };
    return {};
  };

  const submit = async () => {
    if (lot) {
      if (await run((ts) => api.updateInward(lot.id, { material, materialType: spec.grade, od: odN, supplier, inwardDate: date, qty: qN, weight: wN, heatNo, invoiceNo: can('invoices') ? invoice : '', purchaseRate: can('purchase_rates') && Number(rate) > 0 ? Number(rate) : undefined, ...poFields() }, ts), { title: 'Inward updated', message: `${lot.id} · ${qN} PCS (${wN} KG) of ${material} OD ${od} mm.` })) onClose();
      return;
    }
    if (
      await withDocNo(doc.custom, () => run((ts) => api.addInward({ material, materialType: spec.grade, od: odN, supplier, inwardDate: date, qty: qN, weight: wN, heatNo, invoiceNo: can('invoices') ? invoice : '', purchaseRate: can('purchase_rates') && Number(rate) > 0 ? Number(rate) : undefined, ...poFields() }, ts), {
        title: 'Raw material received',
        message: `${qN} PCS (${wN} KG) of ${material} OD ${od} mm added to stock.`,
      }))
    )
      onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={PackagePlus}
      viewOnly={!!preset?.view && !!lot}
      title={lot ? `${preset?.view ? 'View' : 'Edit'} Raw Material Inward — ${lot.id}` : 'Add Raw Material Inward'}
      subtitle="Creates a new stock lot. Lots are consumed oldest-first (FIFO) when Cutting starts."
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
            <ArrowDownToLine size={15} /> {lot ? 'Save Changes' : 'Save Inward'}
          </button>
        </>
      }
    >
      {!lot && (
        <div className="form-grid three">
          <DocNoField label="Lot No." no={doc.no} setNo={doc.setNo} />
        </div>
      )}
      <div className="section-label">Material</div>
      <div className="form-grid three">
        <Field label="Material" required>
          <select value={material} disabled={issued > 0} onChange={(e) => (e.target.value === ADD_NEW ? addMaterial.open() : pickMaterial(e.target.value))}>
            {MATERIAL_FAMILIES.map((fam) => (
              <optgroup key={fam} label={fam}>
                {MATERIAL_MASTER.filter((m) => m.family === fam).map((m) => (
                  <option key={m.material} value={m.material}>
                    {m.material}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={ADD_NEW}>+ Add new material…</option>
          </select>
          {addMaterial.modal}
        </Field>
        <Field label="Grade / Specification" hint={`Density ${spec.density} g/cm³`}>
          <input className="input" readOnly value={spec.grade} />
        </Field>
        <Field label="OD / Size" required hint={issued > 0 ? 'Locked — some of this lot is already issued' : 'Standard bar diameters'}>
          <select
            value={od}
            disabled={issued > 0}
            onChange={(e) => {
              if (e.target.value === ADD_NEW) return addSize.open();
              setOd(e.target.value);
              setWeightOverride(null);
            }}
          >
            {[...new Set([...STANDARD_OD_MM, Number(od)])].sort((x, y) => x - y).map((d) => (
              <option key={d} value={String(d)}>
                {d} mm
              </option>
            ))}
            <option value={ADD_NEW}>+ Add new size…</option>
          </select>
          {addSize.modal}
        </Field>
      </div>

      <div className="section-label">Receipt</div>
      <div className="form-grid">
        <Field label="Supplier" required>
          {can('party_names') ? (
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">Select supplier…</option>
              {masters.suppliers.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          ) : (
            /* the supplier list is confidential and not offered; the name is required, so it is typed from the challan (write-only: never shown back) */
            <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="As on the delivery challan" autoComplete="off" />
          )}
        </Field>
        <Field label="Inward Date" required>
          <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {can('invoices') && (
          <Field label="Supplier Invoice No.">
            <input className="input mono" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="e.g. INV/2026/0412" />
          </Field>
        )}
        {can('purchase_rates') && (
          <Field label="Purchase Rate (₹ / KG)" hint="Confidential — only roles allowed to see purchase rates can enter it">
            <input className="input" type="number" min="0" step="any" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Optional" />
          </Field>
        )}
        <Field label="Heat No. / Mill Cert">
          <input className="input mono" value={heatNo} onChange={(e) => setHeatNo(e.target.value)} placeholder="As per mill test certificate" />
        </Field>
      </div>

      <InwardPoSection
        poId={poId}
        itemId={poItemId}
        supplier={supplier}
        canSeeParty={can('party_names')}
        weight={wN}
        linkedPoNo={linkedPoNo}
        onUnlink={preset?.view ? undefined : () => setUnlinked(true)}
        onPick={(po, item) => {
          setPoId(po?.id ?? null);
          setPoItemId(item?.id ?? null);
          if (!po) return;
          if (can('party_names')) setSupplier(po.supplierName);
          if (!item) return;
          const m = item.material ? findMaterial(item.material) : undefined;
          if (m && m.material !== material) pickMaterial(m.material);
          const d = Number((item.size ?? '').match(/\d+(\.\d+)?/)?.[0]);
          if (d > 0 && STANDARD_OD_MM.includes(d)) setOd(String(d));
          if (can('purchase_rates') && item.rate > 0 && !rate) setRate(String(item.rate));
        }}
      />

      <div className="section-label">Quantity &amp; weight</div>
      <div className="form-grid three">
        <Field label="Quantity" required error={errQty}>
          <NumInput value={qty} onChange={(v) => { setQty(v); if (!lot || lenN > 0) setWeightOverride(null); }} bad={!!errQty} autoFocus />
        </Field>
        <Field label="Piece Length" hint="Length of each bar / billet — used to calculate weight">
          <NumInput value={pieceLength} onChange={(v) => { setPieceLength(v); setWeightOverride(null); }} suffix="mm" step="any" />
        </Field>
        <Field
          label="Total Weight"
          required
          hint={
            theoretical
              ? weightOverride != null && Number(weightOverride) !== theoretical
                ? `Theoretical ${theoretical} KG — using entered weight`
                : `Auto: ${perPiece.toFixed(3)} kg/pc × ${qN} PCS`
              : 'Enter piece length to auto-calculate, or type the weighed weight'
          }
        >
          <NumInput value={weight} onChange={setWeightOverride} suffix="KG" step="any" />
        </Field>
      </div>

      {valid && !preset?.view && (
        <div className="callout info">
          <Layers size={16} />
          <div>
            Adds a new lot of <b>{qN} PCS</b> ({wN} KG, {(wN / qN).toFixed(3)} kg/pc) of <b>{material} · OD {od} mm</b>. It is issued after
            any older lots of the same material and size (FIFO).
          </div>
        </div>
      )}
    </Modal>
  );
}
