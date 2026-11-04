import { ClipboardCheck } from 'lucide-react';
import { withDocNo } from '../../db/client';
import { DocNoField, useDocNo } from '../../components/DocNoField';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Eye,
  FileCheck,
  Plus,
  RefreshCw,
  Send,
} from 'lucide-react';
import { Write, useAccess } from '../../auth/access';
import {
  Badge,
  Empty,
  Field,
  FilterMenu,
  Modal,
  PageFormCtx,
  PageHeader,
  Search,
} from '../../components/ui';
import { fmtDate, fmtNum, matches } from '../../components/format';
import { useStore } from '../../store/StoreContext';
import { usePRDetail, usePurchaseRequisitions, useRFQDetail, useRFQs, useSuppliers } from '../hooks/usePurchase';
import { markRFQSent, saveRFQ } from '../services/rfqService';
import type { PurchaseRequisition } from '../types';
import { DocButtons } from '../../export/docOutput';
import * as docs from '../../export/documents';
import { usePaged } from '../../components/Pager';

/** one line that says what a requisition is for: number, department, the item(s) and the quantity */
const prLabel = (p: PurchaseRequisition) => {
  const first = p.items?.[0];
  const what = first ? `${first.item}${[first.material, first.size].filter(Boolean).length ? ` (${[first.material, first.size].filter(Boolean).join(' ')})` : ''}${(p.itemCount ?? 0) > 1 ? ` +${(p.itemCount ?? 1) - 1} more` : ''}` : `${p.itemCount ?? 0} items`;
  const qty = first && (p.itemCount ?? 0) === 1 ? ` · ${first.qty} ${first.uom}` : p.totalQty ? ` · total qty ${p.totalQty}` : '';
  return `${p.prNo} — ${p.department || 'Stores'} — ${what}${qty} [${p.status}]`;
};

export function RFQPage({
  query,
  navigate,
}: {
  query?: URLSearchParams;
  navigate: (r: string) => void;
}) {
  const { rfqs, loading, error, reload } = useRFQs();

  const detailIdParam = Number(query?.get('id')) || null;
  const fromPRParam = Number(query?.get('from_pr')) || null;
  const isNewParam = query?.get('new') === '1' || !!fromPRParam;

  const [selectedRFQId, setSelectedRFQId] = useState<number | null>(detailIdParam);
  const [createModal, setCreateModal] = useState(isNewParam);
  const [prefillPRId, setPrefillPRId] = useState<number | null>(fromPRParam);

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    if (detailIdParam) setSelectedRFQId(detailIdParam);
  }, [detailIdParam]);

  useEffect(() => {
    if (fromPRParam) {
      setPrefillPRId(fromPRParam);
      setCreateModal(true);
    }
  }, [fromPRParam]);

  const shown = useMemo(() => {
    return rfqs
      .filter((r) => statusFilter === 'all' || r.status === statusFilter)
      .filter((r) =>
        matches(q, r.rfqNo, r.prNo, r.status)
      );
  }, [rfqs, statusFilter, q]);
  const pg = usePaged(shown, shown.length);

  const filterGroups = [
    {
      label: 'Status',
      value: statusFilter,
      onChange: setStatusFilter,
      options: [
        { value: 'all', label: 'All Statuses' },
        { value: 'Draft', label: 'Draft' },
        { value: 'Open', label: 'Open' },
        { value: 'Closed', label: 'Closed' },
        { value: 'Cancelled', label: 'Cancelled' },
      ],
    },
  ];

  // the create form is a full page, not a pop-up
  if (createModal) {
    return (
      <PageFormCtx.Provider value={{ eyebrow: 'Upstream Procurement' }}>
        <CreateRFQModal
          initialPRId={prefillPRId}
          onClose={() => {
            setCreateModal(false);
            setPrefillPRId(null);
            if (isNewParam) navigate('rfqs');
          }}
          onSaved={(newId) => {
            setCreateModal(false);
            setPrefillPRId(null);
            void reload();
            setSelectedRFQId(newId);
          }}
        />
      </PageFormCtx.Provider>
    );
  }

  if (selectedRFQId) {
    return (
      <RFQDetailView
        id={selectedRFQId}
        onBack={() => {
          setSelectedRFQId(null);
          navigate('rfqs');
          void reload();
        }}
        navigate={navigate}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Upstream Procurement"
        title="Procurement of Material"
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => reload()} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <Write res="rfq">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setPrefillPRId(null);
                  setCreateModal(true);
                }}
              >
                <Plus size={15} /> Create Procurement
              </button>
            </Write>
          </>
        }
      />

      <div className="card">
        <div className="card-head">
          <div className="table-search-row">
            <Search
              value={q}
              onChange={setQ}
              placeholder="Search by Procurement No, PR No, notes..."
            />
            <FilterMenu groups={filterGroups} />
          </div>
          <div className="right text-xs muted">
            Showing {shown.length} of {rfqs.length} procurements
          </div>
        </div>

        {loading ? (
          <div className="card-center-msg">Loading requests for quotation…</div>
        ) : error ? (
          <div className="card-center-msg text-red">{error}</div>
        ) : shown.length === 0 ? (
          <Empty
            title="No procurements found"
            text={
              rfqs.length === 0
                ? 'Start a procurement of material to ask several suppliers for competitive price quotations against an approved requisition.'
                : 'No procurements match your search criteria.'
            }
            action={
              rfqs.length === 0 ? (
                <Write res="rfq">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setPrefillPRId(null);
                      setCreateModal(true);
                    }}
                  >
                    <Plus size={15} /> Create Procurement
                  </button>
                </Write>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Procurement No</th>
                  <th style={{ width: 140 }}>Requisition</th>
                  <th style={{ width: 120 }}>Due Date</th>
                  <th className="center" style={{ width: 130 }}>Suppliers Invited</th>
                  <th className="center" style={{ width: 120 }}>Responses</th>
                  <th className="center" style={{ width: 120 }}>Status</th>
                  <th className="muted nowrap" style={{ width: 120 }}>Created</th>
                  <th className="act" style={{ width: 120 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="strong">
                      <button
                        className="link-btn"
                        onClick={() => setSelectedRFQId(r.id)}
                        style={{ fontWeight: 600 }}
                      >
                        {r.rfqNo}
                      </button>
                    </td>
                    <td className="mono">
                      {r.prNo ? (
                        <button
                          className="link-btn"
                          onClick={() => navigate(`purchase-requisitions?id=${r.prId}`)}
                        >
                          {r.prNo}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="muted nowrap">{fmtDate(r.dueDate || undefined)}</td>
                    <td className="center mono strong">{r.supplierCount || 0}</td>
                    <td className="center mono">
                      <span className={r.responseCount && r.responseCount > 0 ? 'text-green strong' : 'muted'}>
                        {r.responseCount || 0}
                      </span>
                    </td>
                    <td className="center">
                      <Badge status={r.status} />
                    </td>
                    <td className="text-xs muted nowrap">{fmtDate(r.createdAt)}</td>
                    <td className="act nowrap">
                      <div className="icon-actions">
                        <button
                          className="icon-btn"
                          title="View procurement details"
                          onClick={() => setSelectedRFQId(r.id)}
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Compare Quotations"
                          onClick={() => navigate(`quotation-comparison?rfq_id=${r.id}&pr_id=${r.prId}`)}
                        >
                          <FileCheck size={16} />
                        </button>
                        {(r.status === 'Open' || r.status === 'Quotes Received') && (
                          <Write res="rfq">
                            <button className="icon-btn" title="Open to update this procurement" aria-label={`Next step ${r.rfqNo}`} onClick={() => setSelectedRFQId(r.id)}><ClipboardCheck size={16} /></button>
                          </Write>
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

    </>
  );
}

// ---------------------------------------------------------------------------------------------
// RFQ Detail View
// ---------------------------------------------------------------------------------------------
function RFQDetailView({
  id,
  onBack,
  navigate,
}: {
  id: number;
  onBack: () => void;
  navigate: (r: string) => void;
}) {
  const { rfq, loading, error, reload } = useRFQDetail(id);
  const { user } = useAccess();
  const { toast } = useStore();
  const [acting, setActing] = useState(false);

  const userName = user?.name || user?.email || 'User';

  if (loading) {
    return (
      <div className="card">
        <div className="card-center-msg">Loading procurement details…</div>
      </div>
    );
  }

  if (error || !rfq) {
    return (
      <div className="card">
        <div className="card-center-msg text-red">{error || 'Procurement not found.'}</div>
        <div className="center mt-4">
          <button className="btn btn-subtle" onClick={onBack}>
            <ArrowLeft size={15} /> Back to Procurement of Material
          </button>
        </div>
      </div>
    );
  }

  const handleMarkSent = async (supplierId: number, supName: string) => {
    try {
      setActing(true);
      await markRFQSent(rfq.id, supplierId, userName);
      toast({
        kind: 'success',
        title: 'Marked as Sent',
        message: `Sent status recorded for ${supName}.`,
      });
      void reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Action failed', message: String(e) });
    } finally {
      setActing(false);
    }
  };

  const suppliers = rfq.suppliers || [];
  const prItems = rfq.pr?.items || [];

  return (
    <>
      <PageHeader
        eyebrow="Procurement of Material Detail"
        title={rfq.rfqNo}
        actions={
          <>
            <button className="btn btn-subtle" onClick={onBack}>
              <ArrowLeft size={14} /> Back
            </button>
            <DocButtons build={(u) => docs.procurementRequestSpec(rfq, u)} />
            <button className="btn btn-subtle" onClick={() => reload()} disabled={acting}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button
              className="btn btn-subtle"
              onClick={() => navigate(`quotation-comparison?rfq_id=${rfq.id}&pr_id=${rfq.prId}`)}
            >
              <FileCheck size={14} /> Compare Quotations
            </button>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`supplier-quotations?new=1&rfq_id=${rfq.id}`)}
            >
              <Plus size={14} /> Enter Quotation
            </button>
          </>
        }
      />

      {/* Meta Grid */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 20, padding: 20 }}>
          <div>
            <div className="text-xs muted">Status</div>
            <div style={{ marginTop: 6 }}>
              <Badge status={rfq.status} />
            </div>
          </div>
          <div>
            <div className="text-xs muted">Linked Requisition</div>
            <div style={{ marginTop: 6 }}>
              {rfq.prNo ? (
                <button
                  className="link-btn mono strong"
                  onClick={() => navigate(`purchase-requisitions?id=${rfq.prId}`)}
                >
                  {rfq.prNo}
                </button>
              ) : (
                '—'
              )}
            </div>
          </div>
          <div>
            <div className="text-xs muted">Submission Due Date</div>
            <div className="strong" style={{ marginTop: 6 }}>
              {fmtDate(rfq.dueDate || undefined)}
            </div>
          </div>
          <div>
            <div className="text-xs muted">Invited Suppliers</div>
            <div className="strong mono" style={{ marginTop: 6 }}>
              {suppliers.length} vendors
            </div>
          </div>
        </div>
      </div>

      {/* Requisition Items Summary */}
      {prItems.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <h3>Items to Quote from {rfq.prNo} ({prItems.length})</h3>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>#</th>
                  <th>Item Description</th>
                  <th>Material / Grade / Size</th>
                  <th className="center" style={{ width: 100 }}>UOM</th>
                  <th className="right" style={{ width: 120 }}>Required Qty</th>
                  <th style={{ width: 140 }}>Required Date</th>
                </tr>
              </thead>
              <tbody>
                {prItems.map((it) => (
                  <tr key={it.id}>
                    <td className="mono muted">{it.lineNo}</td>
                    <td className="strong">{it.item}</td>
                    <td>{[it.material, it.grade, it.size].filter(Boolean).join(' • ') || '—'}</td>
                    <td className="center mono">{it.uom}</td>
                    <td className="right mono strong">{fmtNum(it.qty)}</td>
                    <td className="muted nowrap">{fmtDate(it.requiredDate || undefined)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invited Suppliers Table */}
      <div className="card">
        <div className="card-head">
          <h3>Invited Suppliers &amp; Quotation Responses ({suppliers.length})</h3>
          <div className="right text-xs muted">
            Responded: {suppliers.filter((s) => s.respondedAt).length} / {suppliers.length}
          </div>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Supplier / Vendor</th>
                <th>Contact Email</th>
                <th style={{ width: 160 }}>Sent Status</th>
                <th style={{ width: 160 }}>Quotation Response</th>
                <th className="act" style={{ width: 180 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td className="strong">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Building2 size={16} className="text-accent" />
                      <span>{s.supplierName || `Supplier #${s.supplierId}`}</span>
                    </div>
                  </td>
                  <td className="muted">{s.supplierEmail || '—'}</td>
                  <td>
                    {s.sentAt ? (
                      <span className="badge b-green">
                        Sent on {fmtDate(s.sentAt)}
                      </span>
                    ) : (
                      <span className="badge b-gray">Not Sent</span>
                    )}
                  </td>
                  <td>
                    {s.respondedAt ? (
                      <span className="badge b-blue">
                        Responded {fmtDate(s.respondedAt)}
                      </span>
                    ) : (
                      <span className="badge b-amber">Awaiting Quote</span>
                    )}
                  </td>
                  <td className="act nowrap">
                    <div className="icon-actions">
                      {!s.sentAt && (
                        <button
                          className="btn btn-xs btn-subtle"
                          title="Record that the inquiry was sent to this supplier"
                          onClick={() => handleMarkSent(s.supplierId, s.supplierName || 'Supplier')}
                          disabled={acting}
                        >
                          <Send size={13} /> Mark Sent
                        </button>
                      )}
                      <button
                        className="btn btn-xs btn-primary"
                        onClick={() =>
                          navigate(
                            `supplier-quotations?new=1&rfq_id=${rfq.id}&supplier_id=${s.supplierId}`
                          )
                        }
                      >
                        Enter Quote
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Create RFQ Modal
// ---------------------------------------------------------------------------------------------
function CreateRFQModal({
  initialPRId,
  onClose,
  onSaved,
}: {
  initialPRId: number | null;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const { requisitions } = usePurchaseRequisitions();
  const { suppliers } = useSuppliers();
  const { user } = useAccess();
  const { toast } = useStore();

  const [saving, setSaving] = useState(false);
  const doc = useDocNo('rfq', true);
  const [prId, setPrId] = useState<number | ''>(initialPRId || '');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<number[]>([]);

  const { pr: prDetail } = usePRDetail(prId === '' ? null : prId);

  // Eligible PRs for RFQ: Approved or Partially Ordered
  const eligiblePRs = useMemo(() => {
    return requisitions.filter(
      (r) => r.status === 'Approved' || r.status === 'Partially Ordered' || r.id === initialPRId
    );
  }, [requisitions, initialPRId]);

  const toggleSupplier = (supId: number) => {
    setSelectedSupplierIds((curr) =>
      curr.includes(supId) ? curr.filter((id) => id !== supId) : [...curr, supId]
    );
  };

  const selectAllSuppliers = () => {
    setSelectedSupplierIds(suppliers.map((s) => s.id));
  };

  const clearSuppliers = () => {
    setSelectedSupplierIds([]);
  };

  const handleCreate = async () => {
    if (!prId) {
      toast({ kind: 'error', title: 'Requisition required', message: 'Please select an approved PR.' });
      return;
    }
    if (selectedSupplierIds.length === 0) {
      toast({
        kind: 'error',
        title: 'Suppliers required',
        message: 'Select at least one supplier to invite to this procurement.',
      });
      return;
    }

    try {
      setSaving(true);
      const userName = user?.name || user?.email || 'User';
      const newId = await withDocNo(doc.custom, () =>
        saveRFQ(
          null,
          {
            pr_id: Number(prId),
            due_date: dueDate || null,
            supplier_ids: selectedSupplierIds,
          },
          userName
        )
      );

      toast({
        kind: 'success',
        title: 'Procurement Created',
        message: 'Procurement of material started with the invited suppliers.',
      });
      onSaved(newId);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not create the procurement', message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={true}
      title="Create Procurement of Material"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-subtle" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating…' : 'Create & Invite Suppliers'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 14 }}>
          <DocNoField label="Procurement No." no={doc.no} setNo={doc.setNo} />
          <Field label="Approved Purchase Requisition" required>
            <select
              value={prId}
              onChange={(e) => setPrId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">-- Select Requisition --</option>
              {eligiblePRs.map((p) => (
                <option key={p.id} value={p.id}>
                  {prLabel(p)}
                </option>
              ))}
            </select>
          </Field>

          {prId !== '' && prDetail && (
            <div className="card" style={{ gridColumn: '1 / -1', padding: 12 }}>
              <div className="text-xs muted" style={{ marginBottom: 6 }}>
                <b>{prDetail.prNo}</b> · Department: <b>{prDetail.department || '—'}</b> · Requested by: <b>{prDetail.requestedBy || '—'}</b> · {prDetail.urgency}
              </div>
              <table className="tbl" style={{ fontSize: 13 }}>
                <thead>
                  <tr><th style={{ width: 36 }}>#</th><th>Item</th><th>Material / grade / size</th><th className="r">Qty</th><th className="r">Still to order</th></tr>
                </thead>
                <tbody>
                  {prDetail.items.map((it, i) => (
                    <tr key={it.id}>
                      <td className="mono muted">{i + 1}</td>
                      <td className="strong">{it.item}</td>
                      <td>{[it.material, it.grade, it.size].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="r num">{it.qty} {it.uom}</td>
                      <td className="r num">{Math.max(0, it.qty - it.orderedQty)} {it.uom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Field label="Quotation Due Date">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        {/* Supplier Invitation Selection */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label className="field-lbl" style={{ margin: 0 }}>
              Select Suppliers to Invite * ({selectedSupplierIds.length} selected)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-xs btn-subtle" onClick={selectAllSuppliers}>
                Select All
              </button>
              <button type="button" className="btn btn-xs btn-subtle" onClick={clearSuppliers}>
                Clear
              </button>
            </div>
          </div>

          <div
            style={{
              maxHeight: 240,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '6px 12px',
              background: 'var(--surface)',
            }}
          >
            {suppliers.length === 0 ? (
              <div className="p-4 muted text-center text-sm">
                No active suppliers found in master. Add suppliers first in Supplier Master.
              </div>
            ) : (
              suppliers.map((s) => {
                const checked = selectedSupplierIds.includes(s.id);
                return (
                  <label
                    key={s.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 4px',
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSupplier(s.id)}
                    />
                    <div style={{ flex: 1 }}>
                      <span className="strong text-sm">{s.name}</span>
                      {s.state && <span className="text-xs muted"> — {s.state}</span>}
                    </div>
                    {s.contactPerson && (
                      <span className="text-xs muted">{s.contactPerson}</span>
                    )}
                  </label>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
