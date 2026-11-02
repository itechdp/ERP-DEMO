import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle,
  ClipboardCheck,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
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
  Priority,
  Search,
} from '../../components/ui';
import { MaterialPick, SizePick } from '../../masters/MaterialPick';
import { Brief } from '../../components/Brief';
import { fmtDate, fmtNum, matches } from '../../components/format';
import { useStore } from '../../store/StoreContext';
import { withDocNo } from '../../db/client';
import { ADD_NEW, useAddOption } from '../../masters/AddItem';
import { useOptions } from '../../masters/useOptions';
import { DocNoField, useDocNo } from '../../components/DocNoField';
import { usePRDetail, usePurchaseRequisitions } from '../hooks/usePurchase';
import {
  cancelPR,
  decidePR,
  savePR,
  submitPR,
} from '../services/prService';
import type {
  SavePRHeaderInput,
  SavePRItemInput,
  Urgency,
} from '../types';

const DEPARTMENTS = [
  'Forge Shop',
  'Machine Shop',
  'Tool Room & Dies',
  'Maintenance & Utilities',
  'Quality Control (QC)',
  'Stores & Raw Material',
  'Admin & Facilities',
  'Job Work & Heat Treatment',
];

const UOM_LIST = ['KG', 'PCS', 'SET', 'MTR', 'TON', 'NOS', 'PKT', 'LTR'];

interface FormItem {
  item: string;
  material: string;
  grade: string;
  size: string;
  uom: string;
  qty: number;
  required_date: string;
}

export function PurchaseRequisitionPage({
  query,
  navigate,
}: {
  query?: URLSearchParams;
  navigate: (r: string) => void;
}) {
  const { requisitions, loading, error, reload } = usePurchaseRequisitions();

  const detailIdParam = Number(query?.get('id')) || null;
  const isNewParam = query?.get('new') === '1';

  const [selectedPRId, setSelectedPRId] = useState<number | null>(detailIdParam);
  const [autoApprove, setAutoApprove] = useState(false);
  const [formOpen, setFormOpen] = useState(isNewParam);
  const [editId, setEditId] = useState<number | null>(null);

  // Filters
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');

  useEffect(() => {
    if (detailIdParam) setSelectedPRId(detailIdParam);
  }, [detailIdParam]);

  useEffect(() => {
    if (isNewParam) {
      setEditId(null);
      setFormOpen(true);
    }
  }, [isNewParam]);

  const shown = useMemo(() => {
    return requisitions
      .filter((r) => statusFilter === 'all' || r.status === statusFilter)
      .filter((r) => urgencyFilter === 'all' || r.urgency === urgencyFilter)
      .filter((r) =>
        matches(
          q,
          r.prNo,
          r.requestedBy,
          r.department,
          r.status,
          r.urgency,
          r.remarks
        )
      );
  }, [requisitions, statusFilter, urgencyFilter, q]);

  const filterGroups = [
    {
      label: 'Status',
      value: statusFilter,
      onChange: setStatusFilter,
      options: [
        { value: 'all', label: 'All Statuses' },
        { value: 'Draft', label: 'Draft' },
        { value: 'Approval Pending', label: 'Approval Pending' },
        { value: 'Approved', label: 'Approved' },
        { value: 'Partially Ordered', label: 'Partially Ordered' },
        { value: 'Closed', label: 'Closed' },
        { value: 'Rejected', label: 'Rejected' },
        { value: 'Cancelled', label: 'Cancelled' },
      ],
    },
    {
      label: 'Urgency',
      value: urgencyFilter,
      onChange: setUrgencyFilter,
      options: [
        { value: 'all', label: 'All Urgencies' },
        { value: 'Normal', label: 'Normal' },
        { value: 'Urgent', label: 'Urgent' },
        { value: 'Critical', label: 'Critical' },
      ],
    },
  ];

  // the create / edit form is a full page, not a pop-up
  if (formOpen) {
    return (
      <PageFormCtx.Provider value={{ eyebrow: 'Purchase & Procurement' }}>
        <PRFormModal
          editId={editId}
          onClose={() => {
            setFormOpen(false);
            setEditId(null);
            if (isNewParam) navigate('purchase-requisitions');
          }}
          onSaved={(newId) => {
            setFormOpen(false);
            setEditId(null);
            void reload();
            setSelectedPRId(newId);
          }}
        />
      </PageFormCtx.Provider>
    );
  }

  if (selectedPRId) {
    return (
      <PRDetailView
        id={selectedPRId}
        autoApprove={autoApprove}
        onBack={() => {
          setSelectedPRId(null);
          setAutoApprove(false);
          navigate('purchase-requisitions');
          void reload();
        }}
        onEdit={(id) => {
          setEditId(id);
          setFormOpen(true);
        }}
        navigate={navigate}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Upstream Procurement"
        title="Purchase Requisitions (PR)"
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => reload()} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <Write res="purchase_requisitions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setEditId(null);
                  setFormOpen(true);
                }}
              >
                <Plus size={15} /> New Requisition
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
              placeholder="Search by PR No, user, department..."
            />
            <FilterMenu groups={filterGroups} />
          </div>
          <div className="right text-xs muted">
            Showing {shown.length} of {requisitions.length} requisitions
          </div>
        </div>

        {loading ? (
          <div className="card-center-msg">Loading purchase requisitions…</div>
        ) : error ? (
          <div className="card-center-msg text-red">{error}</div>
        ) : shown.length === 0 ? (
          <Empty
            title="No purchase requisitions found"
            text={
              requisitions.length === 0
                ? 'Create a requisition to request raw materials, consumables, or tooling.'
                : 'No requisitions match your search criteria.'
            }
            action={
              requisitions.length === 0 ? (
                <Write res="purchase_requisitions">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setEditId(null);
                      setFormOpen(true);
                    }}
                  >
                    <Plus size={15} /> New Purchase Requisition
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
                  <th style={{ width: 130 }}>PR No</th>
                  <th style={{ width: 110 }}>Date</th>
                  <th>Department &amp; Requester</th>
                  <th style={{ width: 100 }} className="center">Urgency</th>
                  <th className="right" style={{ width: 100 }}>Items</th>
                  <th className="right" style={{ width: 120 }}>Total Qty</th>
                  <th className="right" style={{ width: 120 }}>Ordered Qty</th>
                  <th className="center" style={{ width: 140 }}>Status</th>
                  <th className="act" style={{ width: 120 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const pctOrdered =
                    r.totalQty && r.totalQty > 0
                      ? Math.min(100, Math.round(((r.totalOrderedQty || 0) / r.totalQty) * 100))
                      : 0;
                  return (
                    <tr key={r.id}>
                      <td className="strong">
                        <button
                          className="link-btn"
                          onClick={() => setSelectedPRId(r.id)}
                          style={{ fontWeight: 600 }}
                        >
                          {r.prNo}
                        </button>
                      </td>
                      <td className="muted nowrap">{fmtDate(r.prDate)}</td>
                      <td>
                        <div className="strong">{r.department || 'General'}</div>
                        <div className="text-xs muted">By {r.requestedBy}</div>
                      </td>
                      <td className="center">
                        <Priority p={r.urgency} />
                      </td>
                      <td className="right mono">{r.itemCount || 0}</td>
                      <td className="right mono">{fmtNum(r.totalQty || 0)}</td>
                      <td className="right">
                        <div className="mono">{fmtNum(r.totalOrderedQty || 0)}</div>
                        {(r.totalQty || 0) > 0 && r.status !== 'Draft' && r.status !== 'Approval Pending' && (
                          <div className="progress-bar-wrap" style={{ marginTop: 3 }}>
                            <div
                              className="progress-bar"
                              style={{
                                width: `${pctOrdered}%`,
                                background: pctOrdered >= 100 ? '#10b981' : '#3b82f6',
                              }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="center">
                        <Badge status={r.status} />
                      </td>
                      <td className="act nowrap">
                        <div className="icon-actions">
                          <button
                            className="icon-btn"
                            title="View Requisition"
                            onClick={() => setSelectedPRId(r.id)}
                          >
                            <Eye size={16} />
                          </button>
                          {['Draft', 'Approval Pending'].includes(r.status) && (
                            <Write res="purchase_requisitions">
                              <button
                                className="icon-btn"
                                title={r.status === 'Draft' ? 'Edit Draft PR' : 'Edit PR (goes back to Draft for re-submission)'}
                                onClick={() => {
                                  setEditId(r.id);
                                  setFormOpen(true);
                                }}
                              >
                                <Pencil size={16} />
                              </button>
                            </Write>
                          )}
                          {r.status === 'Approval Pending' && (
                            <Write res="purchase_approvals">
                              <button className="icon-btn" title="Review and approve" aria-label={`Decide ${r.prNo}`} onClick={() => { setAutoApprove(true); setSelectedPRId(r.id); }}><ClipboardCheck size={16} /></button>
                            </Write>
                          )}
                          {(r.status === 'Approved' || r.status === 'Partially Ordered') && (
                            <Write res="procurement_po">
                              <button className="icon-btn" title="Start procurement / PO" aria-label={`Next step ${r.prNo}`} onClick={() => setSelectedPRId(r.id)}><ClipboardCheck size={16} /></button>
                            </Write>
                          )}
                        </div>
                      </td>
                    </tr>
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

// ---------------------------------------------------------------------------------------------
// PR Detail View
// ---------------------------------------------------------------------------------------------
function PRDetailView({
  id,
  onBack,
  onEdit,
  navigate,
  autoApprove = false,
}: {
  id: number;
  onBack: () => void;
  onEdit: (id: number) => void;
  navigate: (r: string) => void;
  autoApprove?: boolean;
}) {
  const { pr, loading, error, reload } = usePRDetail(id);
  const { user, canWrite } = useAccess();
  const { toast } = useStore();
  const [acting, setActing] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [approveModal, setApproveModal] = useState(autoApprove);
  const [note, setNote] = useState('');

  const userName = user?.name || user?.email || 'User';
  const canApprove = canWrite('purchase_approvals');

  if (loading) {
    return (
      <div className="card">
        <div className="card-center-msg">Loading requisition details…</div>
      </div>
    );
  }

  if (error || !pr) {
    return (
      <div className="card">
        <div className="card-center-msg text-red">{error || 'Requisition not found.'}</div>
        <div className="center mt-4">
          <button className="btn btn-subtle" onClick={onBack}>
            <ArrowLeft size={15} /> Back to Requisitions
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    try {
      setActing(true);
      await submitPR(pr.id, userName);
      toast({
        kind: 'success',
        title: 'Requisition Submitted',
        message: `${pr.prNo} is now pending management approval.`,
      });
      void reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Submit failed', message: String(e) });
    } finally {
      setActing(false);
    }
  };

  const handleApprove = async () => {
    try {
      setActing(true);
      await decidePR(pr.id, true, note || 'Approved', userName);
      toast({
        kind: 'success',
        title: 'Requisition Approved',
        message: `${pr.prNo} is approved and ready for RFQ or PO creation.`,
      });
      setApproveModal(false);
      setNote('');
      void reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Approval failed', message: String(e) });
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    if (!note.trim()) {
      toast({ kind: 'error', title: 'Reason required', message: 'Please provide a rejection note.' });
      return;
    }
    try {
      setActing(true);
      await decidePR(pr.id, false, note, userName);
      toast({
        kind: 'info',
        title: 'Requisition Rejected',
        message: `${pr.prNo} has been rejected.`,
      });
      setRejectModal(false);
      setNote('');
      void reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Reject failed', message: String(e) });
    } finally {
      setActing(false);
    }
  };

  const handleCancel = async () => {
    if (!note.trim()) {
      toast({ kind: 'error', title: 'Reason required', message: 'Please provide a cancellation reason.' });
      return;
    }
    try {
      setActing(true);
      await cancelPR(pr.id, note, userName);
      toast({
        kind: 'info',
        title: 'Requisition Cancelled',
        message: `${pr.prNo} has been cancelled.`,
      });
      setCancelModal(false);
      setNote('');
      void reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Cancel failed', message: String(e) });
    } finally {
      setActing(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Purchase Requisition Detail"
        title={pr.prNo}
        actions={
          <>
            <button className="btn btn-subtle" onClick={onBack}>
              <ArrowLeft size={14} /> Back
            </button>
            <button className="btn btn-subtle" onClick={() => reload()} disabled={acting}>
              <RefreshCw size={14} /> Refresh
            </button>

            {/* Lifecycle Actions */}
            {pr.status === 'Draft' && (
              <Write res="purchase_requisitions">
                <button className="btn btn-subtle" onClick={() => onEdit(pr.id)} disabled={acting}>
                  <Pencil size={14} /> Edit Draft
                </button>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={acting}>
                  <Send size={14} /> Submit for Approval
                </button>
              </Write>
            )}

            {pr.status === 'Approval Pending' && (
              <Write res="purchase_requisitions">
                <button className="btn btn-subtle" onClick={() => onEdit(pr.id)} disabled={acting} title="Saving moves it back to Draft; submit again afterwards">
                  <Pencil size={14} /> Edit
                </button>
              </Write>
            )}

            {pr.status === 'Approval Pending' && canApprove && (
              <Write res="purchase_approvals">
                <button className="btn btn-danger" onClick={() => setRejectModal(true)} disabled={acting}>
                  <XCircle size={14} /> Reject
                </button>
                <button className="btn btn-primary" onClick={() => setApproveModal(true)} disabled={acting}>
                  <CheckCircle size={14} /> Approve Requisition
                </button>
              </Write>
            )}

            {(pr.status === 'Approved' || pr.status === 'Partially Ordered') && (
              <>
                <button
                  className="btn btn-subtle"
                  onClick={() => navigate(`quotation-comparison?pr_id=${pr.id}`)}
                >
                  <Eye size={14} /> Compare Quotes
                </button>
                <Write res="rfq">
                  <button
                    className="btn btn-subtle"
                    onClick={() => navigate(`rfqs?from_pr=${pr.id}`)}
                  >
                    <Send size={14} /> Create RFQ
                  </button>
                </Write>
                <Write res="procurement_po">
                  <button
                    className="btn btn-primary"
                    onClick={() => navigate(`purchase-orders?new=1&from_pr=${pr.id}`)}
                  >
                    <Plus size={14} /> Create PO
                  </button>
                </Write>
              </>
            )}

            {['Draft', 'Approval Pending', 'Approved'].includes(pr.status) && (
              <Write res="purchase_requisitions">
                <button className="btn btn-danger" onClick={() => setCancelModal(true)} disabled={acting}>
                  Cancel PR
                </button>
              </Write>
            )}
          </>
        }
      />

      {/* Requisition Meta Grid */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 20, padding: 20 }}>
          <div>
            <div className="text-xs muted">Status</div>
            <div style={{ marginTop: 6 }}>
              <Badge status={pr.status} />
            </div>
          </div>
          <div>
            <div className="text-xs muted">Urgency</div>
            <div style={{ marginTop: 6 }}>
              <Priority p={pr.urgency} />
            </div>
          </div>
          <div>
            <div className="text-xs muted">Requisition Date</div>
            <div className="strong" style={{ marginTop: 6 }}>
              {fmtDate(pr.prDate)}
            </div>
          </div>
          <div>
            <div className="text-xs muted">Department</div>
            <div className="strong" style={{ marginTop: 6 }}>
              {pr.department || 'Not specified'}
            </div>
          </div>
          <div>
            <div className="text-xs muted">Requested By</div>
            <div className="strong" style={{ marginTop: 6 }}>
              {pr.requestedBy}
            </div>
          </div>
          <div>
            <div className="text-xs muted">Approval Info</div>
            <div className="strong" style={{ marginTop: 6 }}>
              {pr.approvedBy ? `Approved by ${pr.approvedBy}` : pr.status === 'Approval Pending' ? 'Pending Approval' : '—'}
            </div>
          </div>
        </div>

        {pr.remarks && (
          <div style={{ padding: '0 20px 16px', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <span className="text-xs muted">Remarks: </span>
            <span className="text-sm">{pr.remarks}</span>
          </div>
        )}
      </div>

      {/* Items Table */}
      <div className="card">
        <div className="card-head">
          <h3>Requisition Line Items ({pr.items.length})</h3>
          <div className="right text-xs muted">
            Ordered: {fmtNum(pr.totalOrderedQty || 0)} / {fmtNum(pr.totalQty || 0)}
          </div>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th>Item Description</th>
                <th>Material / Grade / Size</th>
                <th className="center" style={{ width: 80 }}>UOM</th>
                <th className="right" style={{ width: 110 }}>Required Qty</th>
                <th className="right" style={{ width: 110 }}>Ordered Qty</th>
                <th className="right" style={{ width: 110 }}>Remaining</th>
                <th style={{ width: 130 }}>Required Date</th>
                <th className="center" style={{ width: 120 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {pr.items.map((it) => {
                const remaining = Math.max(0, it.qty - it.orderedQty);
                const isFullyOrdered = it.orderedQty >= it.qty;
                return (
                  <tr key={it.id}>
                    <td className="mono">{it.lineNo}</td>
                    <td className="strong">{it.item}</td>
                    <td>
                      <div>{[it.material, it.grade].filter(Boolean).join(' • ') || '—'}</div>
                      {it.size && <div className="text-xs muted">Size: {it.size}</div>}
                    </td>
                    <td className="center mono">{it.uom}</td>
                    <td className="right mono strong">{fmtNum(it.qty)}</td>
                    <td className="right mono">{fmtNum(it.orderedQty)}</td>
                    <td className="right mono" style={{ color: remaining === 0 ? 'var(--text-3)' : 'var(--text-1)' }}>
                      {fmtNum(remaining)}
                    </td>
                    <td className="muted nowrap">{fmtDate(it.requiredDate || undefined)}</td>
                    <td className="center">
                      {isFullyOrdered ? (
                        <span className="badge b-green">Ordered</span>
                      ) : it.orderedQty > 0 ? (
                        <span className="badge b-blue">Partial</span>
                      ) : (
                        <span className="badge b-gray">Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Approve Modal */}
      <Modal
        dialog
        open={approveModal}
        title="Approve purchase requisition"
        onClose={() => setApproveModal(false)}
        footer={
          <>
            <button className="btn btn-subtle" onClick={() => setApproveModal(false)} disabled={acting}>Cancel</button>
            <button className="btn btn-primary" onClick={handleApprove} disabled={acting}>Approve Requisition</button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <Brief
            rows={[
              ['Requisition', pr.prNo],
              ['Department', pr.department || '—'],
              ['Requested by', pr.requestedBy || '—'],
              ['Urgency', pr.urgency],
              ['Items', String(pr.items.length)],
              ['Total quantity', fmtNum(pr.totalQty || 0)],
            ]}
          />
          <Field label="Note (optional)">
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Modal>

      {/* Reject Modal */}
      <Modal
        dialog
        open={rejectModal}
        title="Reject Purchase Requisition"
        onClose={() => setRejectModal(false)}
        footer={
          <>
            <button className="btn btn-subtle" onClick={() => setRejectModal(false)} disabled={acting}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleReject} disabled={acting}>
              Confirm Rejection
            </button>
          </>
        }
      >
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          Rejecting this requisition will mark it as Rejected.
        </p>
        <Field label="Rejection Reason" required>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Current inventory levels are sufficient. Postpone request by 2 weeks."
          />
        </Field>
      </Modal>

      {/* Cancel Modal */}
      <Modal
        dialog
        open={cancelModal}
        title="Cancel Purchase Requisition"
        onClose={() => setCancelModal(false)}
        footer={
          <>
            <button className="btn btn-subtle" onClick={() => setCancelModal(false)} disabled={acting}>
              Keep Requisition
            </button>
            <button className="btn btn-danger" onClick={handleCancel} disabled={acting}>
              Confirm Cancellation
            </button>
          </>
        }
      >
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          Cancelling will revoke any further RFQ or PO creation against this PR.
        </p>
        <Field label="Reason for Cancellation" required>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Requirement cancelled by production head."
          />
        </Field>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PR Create / Edit Modal
// ---------------------------------------------------------------------------------------------
function PRFormModal({
  editId,
  onClose,
  onSaved,
}: {
  editId: number | null;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const { user } = useAccess();
  const { toast } = useStore();
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const doc = useDocNo('pr', !editId);

  // Header states
  const [prDate, setPrDate] = useState(new Date().toISOString().slice(0, 10));
  const departments = useOptions('department');
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const addDepartment = useAddOption('department', (v) => setDepartment(v));
  const [requestedBy, setRequestedBy] = useState(user?.name || user?.email || 'User');
  const [urgency, setUrgency] = useState<Urgency>('Normal');
  const [remarks, setRemarks] = useState('');

  // Items
  const [items, setItems] = useState<FormItem[]>([
    {
      item: '',
      material: '',
      grade: '',
      size: '',
      uom: 'KG',
      qty: 0,
      required_date: '',
    },
  ]);

  useEffect(() => {
    if (!editId) return;
    void (async () => {
      try {
        setLoading(true);
        const { fetchPRDetail } = await import('../services/prService');
        const data = await fetchPRDetail(editId);
        if (!['Draft', 'Approval Pending'].includes(data.status)) {
          toast({ kind: 'error', title: 'Cannot Edit', message: 'Only Draft or pending-approval PRs can be edited.' });
          onClose();
          return;
        }
        setPrDate(data.prDate || new Date().toISOString().slice(0, 10));
        setDepartment(data.department || DEPARTMENTS[0]);
        setRequestedBy(data.requestedBy || '');
        setUrgency(data.urgency);
        setRemarks(data.remarks || '');
        if (data.items.length > 0) {
          setItems(
            data.items.map((it) => ({
              item: it.item,
              material: it.material || '',
              grade: it.grade || '',
              size: it.size || '',
              uom: it.uom,
              qty: it.qty,
              required_date: it.requiredDate || '',
            }))
          );
        }
      } catch (e) {
        toast({ kind: 'error', title: 'Failed to load PR', message: String(e) });
        onClose();
      } finally {
        setLoading(false);
      }
    })();
  }, [editId]);

  const addRow = () => {
    setItems((curr) => [
      ...curr,
      {
        item: '',
        material: '',
        grade: '',
        size: '',
        uom: 'KG',
        qty: 0,
        required_date: '',
      },
    ]);
  };

  const removeRow = (index: number) => {
    if (items.length <= 1) {
      toast({ kind: 'error', title: 'At least one item required', message: 'PR must have at least one line.' });
      return;
    }
    setItems((curr) => curr.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, patch: Partial<FormItem>) => {
    setItems((curr) => curr.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const handleSave = async (submitAfter = false) => {
    if (!requestedBy.trim()) {
      toast({ kind: 'error', title: 'Requester required', message: 'Please enter requested by name.' });
      return;
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.item.trim()) {
        toast({ kind: 'error', title: 'Item name required', message: `Row #${i + 1} item name is empty.` });
        return;
      }
      if (!it.qty || it.qty <= 0) {
        toast({ kind: 'error', title: 'Quantity required', message: `Row #${i + 1} quantity must be greater than zero.` });
        return;
      }
    }

    try {
      setSaving(true);
      const headerInput: SavePRHeaderInput = {
        pr_date: prDate,
        department,
        requested_by: requestedBy,
        urgency,
        remarks,
      };

      const itemsInput: SavePRItemInput[] = items.map((it) => ({
        item: it.item.trim(),
        material: it.material.trim() || undefined,
        grade: it.grade.trim() || undefined,
        size: it.size.trim() || undefined,
        uom: it.uom.trim() || 'KG',
        qty: Number(it.qty),
        required_date: it.required_date || null,
      }));

      const userName = user?.name || user?.email || 'User';
      const savedId = await withDocNo(editId ? undefined : doc.custom, () => savePR(editId, headerInput, itemsInput, userName));

      if (submitAfter) {
        await submitPR(savedId, userName);
        toast({ kind: 'success', title: 'PR Submitted', message: 'Requisition submitted for approval.' });
      } else {
        toast({ kind: 'success', title: 'PR Saved', message: 'Requisition saved as Draft.' });
      }

      onSaved(savedId);
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={true}
      title={editId ? 'Edit Purchase Requisition' : 'Create Purchase Requisition'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-subtle" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-subtle" onClick={() => handleSave(false)} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save as Draft'}
          </button>
          <button className="btn btn-primary" onClick={() => handleSave(true)} disabled={saving || loading}>
            {saving ? 'Submitting…' : 'Save & Submit'}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="card-center-msg">Loading requisition…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 14 }}>
            {!editId && <DocNoField label="Requisition No." no={doc.no} setNo={doc.setNo} />}
            <Field label="Requisition Date" required>
              <input type="date" value={prDate} onChange={(e) => setPrDate(e.target.value)} />
            </Field>

            <Field label="Department" required>
              <select value={department} onChange={(e) => (e.target.value === ADD_NEW ? addDepartment.open() : setDepartment(e.target.value))}>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
                <option value={ADD_NEW}>+ Add new department…</option>
              </select>
              {addDepartment.modal}
            </Field>

            <Field label="Requested By" required>
              <input
                type="text"
                value={requestedBy}
                onChange={(e) => setRequestedBy(e.target.value)}
                placeholder="Requester name"
              />
            </Field>

            <Field label="Urgency" required>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)}>
                <option value="Normal">Normal</option>
                <option value="Urgent">Urgent</option>
                <option value="Critical">Critical</option>
              </select>
            </Field>
          </div>

          <Field label="Remarks / Requirement Justification">
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Required for urgent die tooling batch / monthly maintenance"
            />
          </Field>

          {/* Line items section */}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Line Items ({items.length})</h4>
              <button type="button" className="btn btn-sm btn-subtle" onClick={addRow}>
                <Plus size={14} /> Add Line
              </button>
            </div>

            <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="tbl form-tbl" style={{ fontSize: 13, minWidth: 1000 }}>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th style={{ minWidth: 200 }}>Item Name *</th>
                    <th style={{ width: 140 }}>Material</th>
                    <th style={{ width: 120 }}>Grade</th>
                    <th style={{ width: 150 }}>Size</th>
                    <th style={{ width: 90 }}>UOM</th>
                    <th style={{ width: 100 }} className="right">Qty *</th>
                    <th style={{ width: 150 }}>Req Date</th>
                    <th style={{ width: 50 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="mono muted">{idx + 1}</td>
                      <td>
                        <input
                          type="text"
                          value={it.item}
                          onChange={(e) => updateRow(idx, { item: e.target.value })}
                          placeholder="Item description"
                          required
                        />
                      </td>
                      <td>
                        <MaterialPick material={it.material} onChange={(v) => updateRow(idx, { material: v.material, grade: v.grade })} />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={it.grade}
                          onChange={(e) => updateRow(idx, { grade: e.target.value })}
                          placeholder="e.g. EN8D"
                        />
                      </td>
                      <td>
                        <SizePick value={it.size} onChange={(v) => updateRow(idx, { size: v })} />
                      </td>
                      <td>
                        <select
                          value={it.uom}
                          onChange={(e) => updateRow(idx, { uom: e.target.value })}
                        >
                          {UOM_LIST.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          min="0.001"
                          className="right mono"
                          value={it.qty || ''}
                          onChange={(e) => updateRow(idx, { qty: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          value={it.required_date}
                          onChange={(e) => updateRow(idx, { required_date: e.target.value })}
                        />
                      </td>
                      <td className="act">
                        <button
                          type="button"
                          className="icon-btn text-red"
                          onClick={() => removeRow(idx)}
                          title="Remove Line"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
