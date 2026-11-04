import { ClipboardCheck, FileSpreadsheet } from 'lucide-react';
import { withDocNo } from '../../db/client';
import { DocNoField, useDocNo } from '../../components/DocNoField';
import { openUrl } from '../../native/native';
import { Brief } from '../../components/Brief';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ExternalLink,
  Download,
  Eye,
  FileCheck,
  FileText,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Conf, Write, canSee, searchable, useAccess } from '../../auth/access';
import {
  Badge,
  Empty,
  Field,
  FilterMenu,
  Modal,
  PageHeader,
  Priority,
  Search,
  Tabs,
} from '../../components/ui';
import { MaterialPick, SizePick } from '../../masters/MaterialPick';
import { exportPurchaseOrderXlsx } from '../exportPO';
import { fetchPOBalance } from '../services/invoiceService';
import { fmtDate, fmtNum, matches } from '../../components/format';
import { useStore } from '../../store/StoreContext';
import { usePurchaseOrders, useSuppliers } from '../hooks/usePurchase';
import {
  amendPO,
  canSendPO,
  decidePO,
  fetchPODetail,
  getPOAttachmentUrl,
  getPOPdfUrl,
  getPOPrefillFromPR,
  getPOPrefillFromSQ,
  releasePO,
  savePO,
  submitPO,
  uploadPOAttachment,
} from '../services/poService';
import { printPoWithAttachments } from '../printPo';
import { fetchPOReceipts } from '../services/receiptService';
import { useTabAccess } from '../../auth/tabs';
import { usePaged } from '../../components/Pager';
import type {
  POBalance,
  POReceipt,
  PODetail,
  POAttachment,
  SavePOHeaderInput,
  SavePOItemInput,
  TaxType,
  Urgency,
} from '../types';

const inr = (v: number) => `₹ ${v.toLocaleString('en-IN')}`;

// ---------------------------------------------------------------------------------------------
// Root Router for 'purchase-orders': decides between List, Form (?new=1 / ?edit=:id), and Detail (?id=:id)
// ---------------------------------------------------------------------------------------------
export function PurchaseOrderRouter({
  query,
  navigate,
}: {
  query: URLSearchParams;
  navigate: (r: string) => void;
}) {
  const editId = Number(query.get('edit')) || undefined;
  const isNew = query.get('new') === '1';
  const detailId = Number(query.get('id')) || undefined;
  const fromPRId = Number(query.get('from_pr')) || undefined;
  const fromSQId = Number(query.get('from_sq')) || undefined;

  if (isNew || editId || fromPRId || fromSQId) {
    return (
      <PurchaseOrderFormPage
        editId={editId}
        fromPRId={fromPRId}
        fromSQId={fromSQId}
        navigate={navigate}
      />
    );
  }
  if (detailId) {
    return <PurchaseOrderDetailPage id={detailId} navigate={navigate} autoApprove={query.get('step') === 'approve'} autoAmend={query.get('step') === 'amend'} />;
  }
  return <PurchaseOrderListPage navigate={navigate} />;
}

// ---------------------------------------------------------------------------------------------
// 1. Purchase Order List Page
// ---------------------------------------------------------------------------------------------
export function PurchaseOrderListPage({ navigate }: { navigate: (r: string) => void }) {
  const { orders, loading, error, reload } = usePurchaseOrders();
  const { toast } = useStore();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [urgency, setUrgency] = useState('all');
  const [supplierId, setSupplierId] = useState('all');

  const showParty = canSee('party_names');

  const shown = orders
    .filter((o) => status === 'all' || o.status === status)
    .filter((o) => urgency === 'all' || o.urgency === urgency)
    .filter((o) => supplierId === 'all' || String(o.supplierId) === supplierId)
    .filter((o) =>
      matches(
        q,
        o.poNo,
        o.status,
        o.urgency,
        searchable(o.supplierName),
        searchable(o.supplierEmail),
        o.paymentTerms,
        o.deliveryTerms
      )
    );
  const pg = usePaged(shown, shown.length);

  const suppliersList = useMemo(() => {
    const map = new Map<number, string>();
    for (const o of orders) {
      if (o.supplierId && o.supplierName) {
        map.set(o.supplierId, o.supplierName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ value: String(id), label: name }));
  }, [orders]);

  const filterGroups = [
    {
      label: 'Status',
      value: status,
      onChange: setStatus,
      options: [
        { value: 'all', label: 'All Statuses', count: orders.length },
        { value: 'Draft', label: 'Draft', count: orders.filter((o) => o.status === 'Draft').length },
        { value: 'Approval Pending', label: 'Approval Pending', count: orders.filter((o) => o.status === 'Approval Pending').length },
        { value: 'Approved', label: 'Approved', count: orders.filter((o) => o.status === 'Approved').length },
        { value: 'Released', label: 'Released', count: orders.filter((o) => o.status === 'Released').length },
        { value: 'Sent to Supplier', label: 'Sent to Supplier', count: orders.filter((o) => o.status === 'Sent to Supplier').length },
        { value: 'Partially Received', label: 'Partially Received', count: orders.filter((o) => o.status === 'Partially Received').length },
        { value: 'Fully Received', label: 'Fully Received', count: orders.filter((o) => o.status === 'Fully Received').length },
      ],
    },
    {
      label: 'Urgency',
      value: urgency,
      onChange: setUrgency,
      options: [
        { value: 'all', label: 'All Urgencies' },
        { value: 'Normal', label: 'Normal' },
        { value: 'Urgent', label: 'Urgent' },
        { value: 'Critical', label: 'Critical' },
      ],
    },
    ...(showParty && suppliersList.length > 0
      ? [
          {
            label: 'Supplier',
            value: supplierId,
            onChange: setSupplierId,
            options: [{ value: 'all', label: 'All Suppliers' }, ...suppliersList],
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Purchase & Procurement"
        title="Purchase Orders"
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => reload()} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <Write res="procurement_po">
              <button className="btn btn-primary" onClick={() => navigate('purchase-orders?new=1')}>
                <Plus size={15} /> Create Purchase Order
              </button>
            </Write>
          </>
        }
      />

      <div className="card">
        {error ? (
          <Empty icon={FileText} title="Could not load Purchase Orders" text={error} />
        ) : loading ? (
          <Empty icon={FileText} title="Loading orders…" />
        ) : orders.length === 0 ? (
          <Empty
            icon={FileText}
            title="No Purchase Orders yet"
            text="Create your first PO to request materials from your suppliers."
            action={
              <Write res="procurement_po">
                <button className="btn btn-primary" onClick={() => navigate('purchase-orders?new=1')}>
                  <Plus size={15} /> Create Purchase Order
                </button>
              </Write>
            }
          />
        ) : (
          <>
            <div className="toolbar">
              <Search value={q} onChange={setQ} placeholder="Search POs by number, supplier, terms…" />
              <FilterMenu groups={filterGroups} />
            </div>

            {shown.length === 0 ? (
              <Empty icon={FileText} title="No matches found" text="Try resetting filters or search criteria." />
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>PO Number</th>
                      <th style={{ width: 90 }}>Date</th>
                      <Conf g="party_names">
                        <th>Supplier</th>
                      </Conf>
                      <th style={{ width: 90 }} className="center">Priority</th>
                      <th style={{ width: 100 }}>Delivery</th>
                      <th style={{ width: 90 }} className="r">Ordered Qty</th>
                      <th style={{ width: 90 }} className="r">Received</th>
                      <Conf g="purchase_rates">
                        <th style={{ width: 110 }} className="r">Total Amount</th>
                      </Conf>
                      <th style={{ width: 130 }} className="center">Status</th>
                      <th className="act">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.rows.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <div className="mono strong flex-center gap-1">
                            {o.poNo}
                            {o.revNo > 0 && <span className="chip text-xs">R{o.revNo}</span>}
                          </div>
                          {o.isOverdue && (
                            <span className="badge b-red text-xs mt-0.5">Overdue</span>
                          )}
                        </td>
                        <td className="nowrap">{fmtDate(o.poDate)}</td>
                        <Conf g="party_names">
                          <td className="strong">{o.supplierName || '—'}</td>
                        </Conf>
                        <td className="center">
                          <Priority p={o.urgency} />
                        </td>
                        <td className="nowrap">{o.deliveryDate ? fmtDate(o.deliveryDate) : '—'}</td>
                        <td className="r num">{fmtNum(o.orderedQty || 0)}</td>
                        <td className="r num">{fmtNum(o.receivedQty || 0)}</td>
                        <Conf g="purchase_rates">
                          <td className="r num strong nowrap">{inr(o.totalAmount)}</td>
                        </Conf>
                        <td className="center">
                          <Badge status={o.status} />
                        </td>
                        <td className="act nowrap">
                          <div className="icon-actions">
                            <button
                              className="icon-btn"
                              title="View PO Details"
                              aria-label={`View PO ${o.poNo}`}
                              onClick={() => navigate(`purchase-orders?id=${o.id}`)}
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              className="icon-btn"
                              title="Print Purchase Order"
                              aria-label={`Print PO ${o.poNo}`}
                              onClick={async () => {
                                try {
                                  const detail = await fetchPODetail(o.id);
                                  await printPoWithAttachments(detail, toast);
                                } catch (e) {
                                  toast({ kind: 'error', title: 'Could not load PO for print', message: String(e) });
                                }
                              }}
                            >
                              <Printer size={16} />
                            </button>
                            {['Draft', 'Approval Pending'].includes(o.status) && (
                              <Write res="procurement_po">
                                <button
                                  className="icon-btn"
                                  title={o.status === 'Draft' ? 'Edit Draft PO' : 'Edit PO (goes back to Draft for re-submission)'}
                                  aria-label={`Edit PO ${o.poNo}`}
                                  onClick={() => navigate(`purchase-orders?edit=${o.id}`)}
                                >
                                  <Pencil size={16} />
                                </button>
                              </Write>
                            )}
                            {['Released', 'Sent to Supplier', 'Partially Received'].includes(o.status) && (
                              <Write res="procurement_po">
                                <button className="icon-btn" title="Amend PO (creates a new revision)" aria-label={`Amend PO ${o.poNo}`} onClick={() => navigate(`purchase-orders?id=${o.id}&step=amend`)}>
                                  <Pencil size={16} />
                                </button>
                              </Write>
                            )}
                            {o.status === 'Approval Pending' && (
                              <Write res="purchase_approvals">
                                <button className="icon-btn" title="Review and approve" aria-label={`Decide PO ${o.poNo}`} onClick={() => navigate(`purchase-orders?id=${o.id}&step=approve`)}><ClipboardCheck size={16} /></button>
                              </Write>
                            )}
                            {o.status === 'Approved' && (
                              <Write res="procurement_po">
                                <button className="icon-btn" title="Release / send" aria-label={`Next step PO ${o.poNo}`} onClick={() => navigate(`purchase-orders?id=${o.id}`)}><ClipboardCheck size={16} /></button>
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
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Purchase Order Detail Page (Header, Items, Receipt Progress, Approvals, Revisions, Email Log)
// ---------------------------------------------------------------------------------------------
export function PurchaseOrderDetailPage({
  id,
  navigate,
  autoApprove = false,
  autoAmend = false,
}: {
  id: number;
  navigate: (r: string) => void;
  autoApprove?: boolean;
  autoAmend?: boolean;
}) {
  const [po, setPo] = useState<PODetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab0, setActiveTab] = useState<'items' | 'receipts' | 'approvals' | 'revisions'>('items');
  const ta = useTabAccess('procurement_po', ['items', 'receipts', 'approvals', 'revisions'] as const);
  const activeTab = ta.pick(activeTab0);
  const [receipts, setReceipts] = useState<POReceipt[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [balance, setBalance] = useState<POBalance | null>(null);

  // Modals & Action states
  const [rejectModal, setRejectModal] = useState(false);
  const [approveModal, setApproveModal] = useState(autoApprove);
  const [amendModal, setAmendModal] = useState(autoAmend);
  const [actionNote, setActionNote] = useState('');
  const [acting, setActing] = useState(false);

  const { toast } = useStore();
  const { user, canWrite } = useAccess();
  const showRates = canSee('purchase_rates');
  const showParty = canSee('party_names');

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await fetchPODetail(id);
      setPo(data);
      setError(null);
      // lots received against this PO; the list simply stays empty if it cannot be read
      fetchPOReceipts(id).then(setReceipts).catch(() => setReceipts([]));
      // may this person send / download the PDF, and what has been invoiced and paid (both stay empty if not available)
      canSendPO(id).then(setCanSend).catch(() => setCanSend(false));
      fetchPOBalance(id).then(setBalance).catch(() => setBalance(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useState(() => {
    void loadData();
  });

  const userName = user?.name || user?.email || 'User';

  const downloadPdf = async () => {
    try {
      setPdfBusy(true);
      await openUrl(await getPOPdfUrl(id));
    } catch (e) {
      toast({ kind: 'error', title: 'Could not create the PDF', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadExcel = async () => {
    if (!po) return;
    try {
      await exportPurchaseOrderXlsx(po, userName);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not create the Excel file', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleSubmit = async () => {
    if (!po) return;
    try {
      setActing(true);
      await submitPO(po.id, userName);
      toast({ kind: 'success', title: 'PO Submitted', message: `${po.poNo} is now pending approval.` });
      void loadData();
    } catch (e) {
      toast({ kind: 'error', title: 'Submission failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setActing(false);
    }
  };

  const handleApprove = async () => {
    if (!po) return;
    try {
      setActing(true);
      await decidePO(po.id, true, actionNote || 'Approved', userName);
      toast({ kind: 'success', title: 'PO Approved', message: `${po.poNo} approved successfully.` });
      setApproveModal(false);
      void loadData();
    } catch (e) {
      toast({ kind: 'error', title: 'Approval failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    if (!po) return;
    if (!actionNote.trim()) {
      toast({ kind: 'error', title: 'Reason required', message: 'Please provide a reason for rejection.' });
      return;
    }
    try {
      setActing(true);
      await decidePO(po.id, false, actionNote, userName);
      toast({ kind: 'info', title: 'PO Rejected', message: `${po.poNo} returned to Draft for correction.` });
      setRejectModal(false);
      setActionNote('');
      void loadData();
    } catch (e) {
      toast({ kind: 'error', title: 'Rejection failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setActing(false);
    }
  };

  const handleRelease = async () => {
    if (!po) return;
    try {
      setActing(true);
      await releasePO(po.id, userName);
      toast({ kind: 'success', title: 'PO Released', message: `${po.poNo} released and locked.` });
      void loadData();
    } catch (e) {
      toast({ kind: 'error', title: 'Release failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setActing(false);
    }
  };

  const handleAmend = async () => {
    if (!po) return;
    if (!actionNote.trim()) {
      toast({ kind: 'error', title: 'Reason required', message: 'Please state the reason for amendment.' });
      return;
    }
    try {
      setActing(true);
      const newRev = await amendPO(po.id, actionNote, userName);
      toast({ kind: 'success', title: 'Amendment Created', message: `${po.poNo} revision ${newRev} is open in Draft.` });
      setAmendModal(false);
      setActionNote('');
      navigate(`purchase-orders?edit=${po.id}`);
    } catch (e) {
      toast({ kind: 'error', title: 'Amendment failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setActing(false);
    }
  };

  if (loading) return <div className="card"><Empty icon={FileText} title="Loading Purchase Order…" /></div>;
  if (error || !po) {
    return (
      <div className="card">
        <Empty
          icon={AlertTriangle}
          title="Could not find Purchase Order"
          text={error || 'The requested order does not exist.'}
          action={<button className="btn btn-subtle" onClick={() => navigate('purchase-orders')}>Back to PO List</button>}
        />
      </div>
    );
  }

  const isLocked = po.status !== 'Draft';
  const canApprove = canWrite('purchase_approvals');
  const canManagePO = canWrite('procurement_po');

  return (
    <>
      <PageHeader
        eyebrow="Purchase & Procurement"
        title={`${po.poNo}${po.revNo > 0 ? ` (Rev ${po.revNo})` : ''}`}
        subtitle={
          <div className="flex-center gap-2 mt-1">
            <Badge status={po.status} />
            {isLocked && <span className="chip chip-subtle" title="Document locked"><Lock size={12} /> Locked</span>}
          </div>
        }
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => navigate('purchase-orders')}>
              <ArrowLeft size={15} /> Back
            </button>
            <button className="btn btn-subtle" onClick={() => void printPoWithAttachments(po, toast)}>
              <Printer size={15} /> Print
            </button>
            {canSend && ['Released', 'Sent to Supplier'].includes(po.status) && (
              <>
                <button className="btn btn-subtle" onClick={downloadPdf} disabled={pdfBusy}>
                  <Download size={15} /> {pdfBusy ? 'Preparing…' : 'Download PDF'}
                </button>
                <button className="btn btn-subtle" onClick={() => void downloadExcel()}>
                  <FileSpreadsheet size={15} /> Download Excel
                </button>
              </>
            )}

            {/* Action Bar driven by status */}
            {po.status === 'Draft' && canManagePO && (
              <>
                <button className="btn btn-subtle" onClick={() => navigate(`purchase-orders?edit=${po.id}`)}>
                  <Pencil size={15} /> Edit Draft
                </button>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={acting}>
                  <Send size={15} /> Submit for Approval
                </button>
              </>
            )}
            {po.status === 'Approval Pending' && canManagePO && (
              <button className="btn btn-subtle" onClick={() => navigate(`purchase-orders?edit=${po.id}`)} title="Saving moves it back to Draft; submit again afterwards">
                <Pencil size={15} /> Edit
              </button>
            )}

            {po.status === 'Approval Pending' && canApprove && (
              <>
                <button className="btn btn-danger" onClick={() => setRejectModal(true)} disabled={acting}>
                  <XCircle size={15} /> Reject to Draft
                </button>
                <button className="btn btn-primary" onClick={() => setApproveModal(true)} disabled={acting}>
                  <CheckCircle size={15} /> Approve PO
                </button>
              </>
            )}

            {po.status === 'Approved' && canApprove && (
              <button className="btn btn-primary" onClick={handleRelease} disabled={acting}>
                <FileCheck size={15} /> Release PO
              </button>
            )}

            {['Released', 'Sent to Supplier', 'Partially Received'].includes(po.status) && canManagePO && (
              <button className="btn btn-subtle" onClick={() => setAmendModal(true)} disabled={acting}>
                <Pencil size={15} /> Edit / Amend PO
              </button>
            )}
          </>
        }
      />

      {/* Summary strip: three compact blocks side by side */}
      <div className="card po-summary">
        <div>
          <div className="po-k">Vendor / Supplier</div>
          <div className="po-v">{showParty ? po.supplierName : '—'}</div>
          {showParty && po.supplierEmail && <div className="po-s">{po.supplierEmail}</div>}
          <div className="po-s">
            Priority: <Priority p={po.urgency} />
          </div>
        </div>
        <div>
          <div className="po-k">Dates &amp; Fulfillment</div>
          <div className="po-s">
            PO date: <b>{fmtDate(po.poDate)}</b>
          </div>
          <div className="po-s">
            Delivery due: <b>{po.deliveryDate ? fmtDate(po.deliveryDate) : 'Immediate'}</b>
          </div>
          <div className="po-s">
            Payment terms: <b>{po.paymentTerms || '30 Days'}</b>
          </div>
        </div>
        <div>
          <div className="po-k">Order Valuation</div>
          <div className="po-v po-total">{showRates ? inr(po.totalAmount) : '—'}</div>
          <div className="po-s">
            Taxable {showRates ? inr(po.taxableAmount) : '—'} · GST {showRates ? inr(po.gstAmount) : '—'} ({po.taxType === 'inter' ? 'IGST' : 'CGST+SGST'})
          </div>
          {showRates && balance && (
            <div className="po-s">
              Invoiced <b>{inr(balance.invoiced)}</b> · Paid <b>{inr(balance.paid)}</b> · Payable <b>{inr(balance.payable)}</b>
            </div>
          )}
        </div>
      </div>

      {/* Linked Source Section if present */}
      {(po.prId || po.sqId) && (
        <div className="card" style={{ marginBottom: 16, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <FileText size={16} className="text-accent" />
          <span className="text-xs font-semibold uppercase muted">Linked Upstream:</span>
          {po.prId && (
            <button
              className="btn btn-xs btn-subtle"
              onClick={() => navigate(`purchase-requisitions?id=${po.prId}`)}
            >
              View Linked Requisition (PR #{po.prId})
            </button>
          )}
          {po.sqId && (
            <button
              className="btn btn-xs btn-subtle"
              onClick={() => navigate(`supplier-quotations?id=${po.sqId}`)}
            >
              View Linked Quotation (SQ #{po.sqId})
            </button>
          )}
        </div>
      )}

      {/* Attachments Section if present */}
      {po.attachments.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: '10px 14px' }}>
          <div className="flex-center gap-2">
            <Paperclip size={14} className="muted" />
            <span className="text-xs font-semibold uppercase muted">Attachments:</span>
            {po.attachments.map((a, i) => (
              <button
                key={i}
                className="btn btn-sm btn-subtle"
                onClick={async () => {
                  try {
                    const url = await getPOAttachmentUrl(a.path);
                    await openUrl(url);
                  } catch (e) {
                    toast({ kind: 'error', title: 'Could not open attachment', message: String(e) });
                  }
                }}
              >
                {a.name} <ExternalLink size={11} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Detail Tabs */}
      <div className="card">
        <Tabs
          value={activeTab}
          onChange={(t) => setActiveTab(t as typeof activeTab)}
          items={ta.only([
            { value: 'items', label: 'Items & Receipt Progress', count: po.items.length },
            { value: 'receipts', label: 'Receipts', count: receipts.length },
            { value: 'approvals', label: 'Approval Trail', count: po.approvals.length },
            { value: 'revisions', label: 'Revision History', count: po.revisions.length },
          ])}
        />

        <div style={{ marginTop: 14 }}>
          {activeTab === 'items' && (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 40 }} className="center">#</th>
                    <th>Item Description & Specs</th>
                    <th style={{ width: 70 }} className="center">HSN</th>
                    <th style={{ width: 60 }} className="center">UOM</th>
                    <th style={{ width: 80 }} className="r">Ordered</th>
                    <Conf g="purchase_rates">
                      <th style={{ width: 90 }} className="r">Rate</th>
                      <th style={{ width: 60 }} className="center">GST %</th>
                      <th style={{ width: 110 }} className="r">Amount</th>
                    </Conf>
                    <th style={{ width: 80 }} className="r">Received</th>
                    <th style={{ width: 80 }} className="r">Accepted</th>
                    <th style={{ width: 80 }} className="r">Rejected</th>
                    <th style={{ width: 80 }} className="r">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {po.items.map((it) => {
                    const pending = Math.max(0, it.qty - it.receivedQty);
                    return (
                      <tr key={it.id}>
                        <td className="center">{it.lineNo}</td>
                        <td>
                          <div className="strong">{it.item}</div>
                          {(it.material || it.grade || it.size) && (
                            <div className="text-xs muted">
                              {[it.material, it.grade, it.size].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="center mono text-xs">{it.hsn || '—'}</td>
                        <td className="center">{it.uom}</td>
                        <td className="r num strong">{fmtNum(it.qty)}</td>
                        <Conf g="purchase_rates">
                          <td className="r num">{inr(it.rate)}</td>
                          <td className="center">{it.gstPct}%</td>
                          <td className="r num strong">{inr(it.amount)}</td>
                        </Conf>
                        <td className="r num">{fmtNum(it.receivedQty)}</td>
                        <td className="r num text-green font-medium">{fmtNum(it.acceptedQty)}</td>
                        <td className="r num text-red font-medium">{fmtNum(it.rejectedQty)}</td>
                        <td className="r num muted">{fmtNum(pending)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'receipts' &&
            (receipts.length === 0 ? (
              <Empty title="No material received against this PO yet." text="Book a raw-material inward against this order from Raw Inventory → Add Inward → Against Purchase Order." />
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Lot</th>
                      <th>Date</th>
                      <th>Material</th>
                      <th>Heat No.</th>
                      <Conf g="invoices">
                        <th>Invoice No.</th>
                      </Conf>
                      <th className="r">Qty (PCS)</th>
                      <th className="r">Weight</th>
                      <th>Incoming QC</th>
                      <th className="r">Accepted</th>
                      <th className="r">Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((r) => (
                      <tr key={r.lotId}>
                        <td className="strong">
                          <button className="link-btn" onClick={() => navigate(`raw-inventory?lot=${r.lotId}`)}>
                            {r.lotId}
                          </button>
                        </td>
                        <td className="nowrap">{fmtDate(r.inwardDate)}</td>
                        <td>
                          {[r.material, r.grade, r.od ? `OD ${r.od} mm` : ''].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="mono text-xs">{r.heatNo || '—'}</td>
                        <Conf g="invoices">
                          <td className="mono text-xs">{r.invoiceNo || '—'}</td>
                        </Conf>
                        <td className="r num">{fmtNum(r.inwardQty)}</td>
                        <td className="r num">{fmtNum(r.inwardWeight)} KG</td>
                        <td>
                          <Badge status={r.qcStatus === 'Pending' ? 'QC Pending' : r.qcStatus} />
                        </td>
                        <td className="r num text-green">{r.acceptedWeight == null ? '—' : fmtNum(r.acceptedWeight)}</td>
                        <td className="r num text-red">{r.rejectedWeight == null ? '—' : fmtNum(r.rejectedWeight)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {activeTab === 'approvals' && (
            po.approvals.length === 0 ? (
              <Empty title="No approval history recorded yet." />
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 80 }}>Rev</th>
                      <th style={{ width: 140 }}>Action</th>
                      <th>Performed By</th>
                      <th>Remarks / Note</th>
                      <th style={{ width: 160 }}>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.approvals.map((ap) => (
                      <tr key={ap.id}>
                        <td className="mono">R{ap.revNo}</td>
                        <td className="strong">{ap.action}</td>
                        <td>{ap.actor || 'System'}</td>
                        <td>{ap.note || '—'}</td>
                        <td className="nowrap text-xs muted">{fmtDate(ap.actedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {activeTab === 'revisions' && (
            po.revisions.length === 0 ? (
              <Empty title="Original baseline revision (R0). No amendments made." />
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Snapshot Rev</th>
                      <th>Reason for Amendment</th>
                      <th>Amended By</th>
                      <th style={{ width: 160 }}>Amended At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.revisions.map((rev) => (
                      <tr key={rev.id}>
                        <td className="strong">Revision {rev.revNo}</td>
                        <td className="strong">{rev.reason}</td>
                        <td>{rev.amendedBy || '—'}</td>
                        <td className="text-xs muted">{fmtDate(rev.amendedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

        </div>
      </div>

      {/* Approve Modal */}
      <Modal
        dialog
        open={approveModal}
        title="Approve purchase order"
        onClose={() => setApproveModal(false)}
        footer={
          <>
            <button className="btn btn-subtle" onClick={() => setApproveModal(false)} disabled={acting}>Cancel</button>
            <button className="btn btn-primary" onClick={handleApprove} disabled={acting}>Approve PO</button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <Brief
            rows={[
              ['Purchase order', po.poNo],
              ...(canSee('party_names') ? ([['Supplier', po.supplierName || '—']] as [string, React.ReactNode][]) : []),
              ['Items', String(po.items.length)],
              ...(showRates ? ([['Total (incl. GST)', `₹ ${po.totalAmount.toLocaleString('en-IN')}`]] as [string, React.ReactNode][]) : []),
              ['Delivery date', fmtDate(po.deliveryDate || undefined)],
              ['Urgency', po.urgency],
            ]}
          />
          <Field label="Note (optional)">
            <textarea rows={2} value={actionNote} onChange={(e) => setActionNote(e.target.value)} />
          </Field>
        </div>
      </Modal>

      {/* Reject Modal */}
      <Modal
        dialog
        open={rejectModal}
        title="Reject Purchase Order"
        onClose={() => setRejectModal(false)}
        footer={
          <>
            <button className="btn btn-subtle" onClick={() => setRejectModal(false)} disabled={acting}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleReject} disabled={acting}>
              {acting ? 'Rejecting…' : 'Confirm Rejection'}
            </button>
          </>
        }
      >
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          This will move the PO back to <b>Draft</b> status so the purchase team can correct quantities, items, or rates.
        </p>
        <Field label="Rejection Note / Comments" required>
          <textarea
            rows={3}
            value={actionNote}
            onChange={(e) => setActionNote(e.target.value)}
            placeholder="e.g. Rate is higher than quoted. Please verify quotation QT-0012."
          />
        </Field>
      </Modal>

      {/* Amend Modal */}
      <Modal
        dialog
        open={amendModal}
        title="Start PO Amendment"
        onClose={() => setAmendModal(false)}
        footer={
          <>
            <button className="btn btn-subtle" onClick={() => setAmendModal(false)} disabled={acting}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleAmend} disabled={acting}>
              {acting ? 'Creating Revision…' : 'Create Revision & Edit'}
            </button>
          </>
        }
      >
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          This will snapshot current version <b>R{po.revNo}</b> into the revision history, bump the revision to{' '}
          <b>R{po.revNo + 1}</b>, and reopen the PO as Draft. It must be re-approved and re-released before receiving.
        </p>
        <Field label="Reason for Amendment" required>
          <textarea
            rows={3}
            value={actionNote}
            onChange={(e) => setActionNote(e.target.value)}
            placeholder="e.g. Quantity revised due to change in production dispatch schedule."
          />
        </Field>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Purchase Order Create/Edit Form Page (Draft only)
// ---------------------------------------------------------------------------------------------
interface FormItemRow {
  id?: number;
  pr_item_id?: number | null;
  item: string;
  material: string;
  grade: string;
  size: string;
  hsn: string;
  uom: string;
  qty: number;
  rate: number;
  gst_pct: number;
  delivery_date: string;
}

export function PurchaseOrderFormPage({
  editId,
  fromPRId,
  fromSQId,
  navigate,
}: {
  editId?: number;
  fromPRId?: number;
  fromSQId?: number;
  navigate: (r: string) => void;
}) {
  const { suppliers } = useSuppliers();
  const { user } = useAccess();
  const { toast } = useStore();

  const [loading, setLoading] = useState(!!editId || !!fromPRId || !!fromSQId);
  const [saving, setSaving] = useState(false);
    const doc = useDocNo('po', !editId);

  // Upstream linkage
  const [prId, setPrId] = useState<number | null>(fromPRId || null);
  const [sqId, setSqId] = useState<number | null>(fromSQId || null);
  const [sourceBanner, setSourceBanner] = useState<{ type: 'PR' | 'SQ'; docNo: string } | null>(null);

  // Header form
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [urgency, setUrgency] = useState<Urgency>('Normal');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('30 Days');
  const [deliveryTerms, setDeliveryTerms] = useState('Door Delivery');
  const [otherTerms, setOtherTerms] = useState('');
  const [taxType, setTaxType] = useState<TaxType>('intra');
  const [attachments, setAttachments] = useState<POAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // Items multi-line
  const [items, setItems] = useState<FormItemRow[]>([
    {
      item: '',
      material: '',
      grade: '',
      size: '',
      hsn: '',
      uom: 'KG',
      qty: 0,
      rate: 0,
      gst_pct: 18,
      delivery_date: '',
    },
  ]);

  // Load existing for edit
  useEffect(() => {
    if (!editId) return;
    void (async () => {
      try {
        setLoading(true);
        const data = await fetchPODetail(editId);
        if (!['Draft', 'Approval Pending'].includes(data.status)) {
          toast({ kind: 'error', title: 'Locked Document', message: 'Only Draft or pending-approval POs can be edited. Use Amend PO after release.' });
          navigate(`purchase-orders?id=${editId}`);
          return;
        }
        setSupplierId(data.supplierId);
        setPrId(data.prId || null);
        setSqId(data.sqId || null);
        setUrgency(data.urgency);
        setDeliveryDate(data.deliveryDate || '');
        setPaymentTerms(data.paymentTerms || '');
        setDeliveryTerms(data.deliveryTerms || '');
        setOtherTerms(data.otherTerms || '');
        setTaxType(data.taxType);
        setAttachments(data.attachments || []);
        if (data.items.length > 0) {
          setItems(
            data.items.map((it) => ({
              id: it.id,
              pr_item_id: it.prItemId,
              item: it.item,
              material: it.material || '',
              grade: it.grade || '',
              size: it.size || '',
              hsn: it.hsn || '',
              uom: it.uom,
              qty: it.qty,
              rate: it.rate,
              gst_pct: it.gstPct,
              delivery_date: it.deliveryDate || '',
            }))
          );
        }
      } catch (e) {
        toast({ kind: 'error', title: 'Could not load PO', message: String(e) });
        navigate('purchase-orders');
      } finally {
        setLoading(false);
      }
    })();
  }, [editId]);

  // Load prefill from PR or SQ
  useEffect(() => {
    if (fromPRId) {
      void (async () => {
        try {
          setLoading(true);
          const data = await getPOPrefillFromPR(fromPRId);
          setPrId(data.prId || fromPRId);
          setSourceBanner({ type: 'PR', docNo: data.sourceDocNo });
          if (data.urgency) setUrgency(data.urgency);
          if (data.items.length > 0) {
            setItems(
              data.items.map((it) => ({
                pr_item_id: it.prItemId,
                item: it.item,
                material: it.material || '',
                grade: it.grade || '',
                size: it.size || '',
                hsn: '',
                uom: it.uom,
                qty: it.qty,
                rate: it.rate,
                gst_pct: it.gstPct,
                delivery_date: '',
              }))
            );
          }
        } catch (e) {
          toast({ kind: 'error', title: 'Could not load PR prefill', message: String(e) });
        } finally {
          setLoading(false);
        }
      })();
    } else if (fromSQId) {
      void (async () => {
        try {
          setLoading(true);
          const data = await getPOPrefillFromSQ(fromSQId);
          setSqId(data.sqId || fromSQId);
          if (data.prId) setPrId(data.prId);
          setSourceBanner({ type: 'SQ', docNo: data.sourceDocNo });
          if (data.supplierId) setSupplierId(data.supplierId);
          if (data.urgency) setUrgency(data.urgency);
          if (data.paymentTerms) setPaymentTerms(data.paymentTerms);
          if (data.deliveryTerms) setDeliveryTerms(data.deliveryTerms);
          if (data.items.length > 0) {
            setItems(
              data.items.map((it) => ({
                pr_item_id: it.prItemId,
                item: it.item,
                material: it.material || '',
                grade: it.grade || '',
                size: it.size || '',
                hsn: '',
                uom: it.uom,
                qty: it.qty,
                rate: it.rate,
                gst_pct: it.gstPct,
                delivery_date: '',
              }))
            );
          }
        } catch (e) {
          toast({ kind: 'error', title: 'Could not load quotation prefill', message: String(e) });
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [fromPRId, fromSQId]);

  // Dynamic calculations
  const totals = useMemo(() => {
    let taxable = 0;
    let gst = 0;
    for (const it of items) {
      const lineTaxable = (it.qty || 0) * (it.rate || 0);
      const lineGst = Math.round(((lineTaxable * (it.gst_pct || 0)) / 100) * 100) / 100;
      taxable += lineTaxable;
      gst += lineGst;
    }
    return { taxable, gst, total: taxable + gst };
  }, [items]);

  const addItemRow = () => {
    setItems((curr) => [
      ...curr,
      {
        item: '',
        material: '',
        grade: '',
        size: '',
        hsn: '',
        uom: 'KG',
        qty: 0,
        rate: 0,
        gst_pct: 18,
        delivery_date: deliveryDate || '',
      },
    ]);
  };

  const removeItemRow = (idx: number) => {
    if (items.length <= 1) {
      toast({ kind: 'error', title: 'At least one item required', message: 'PO must have at least one line item.' });
      return;
    }
    setItems((curr) => curr.filter((_, i) => i !== idx));
  };

  const updateItemRow = (idx: number, patch: Partial<FormItemRow>) => {
    setItems((curr) => curr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      const att = await uploadPOAttachment(file);
      setAttachments((curr) => [...curr, att]);
      toast({ kind: 'success', title: 'Attachment uploaded', message: file.name });
    } catch (err) {
      toast({ kind: 'error', title: 'Upload failed', message: String(err) });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async (submitAfter = false) => {
    if (!supplierId) {
      toast({ kind: 'error', title: 'Supplier required', message: 'Please select a supplier.' });
      return;
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.item.trim()) {
        toast({ kind: 'error', title: 'Item name required', message: `Row #${i + 1} item description is empty.` });
        return;
      }
      if (!it.qty || it.qty <= 0) {
        toast({ kind: 'error', title: 'Valid quantity required', message: `Row #${i + 1} quantity must be greater than zero.` });
        return;
      }
      if (it.rate < 0) {
        toast({ kind: 'error', title: 'Invalid rate', message: `Row #${i + 1} rate cannot be negative.` });
        return;
      }
    }

    try {
      setSaving(true);
      const headerInput: SavePOHeaderInput = {
        supplier_id: Number(supplierId),
        pr_id: prId,
        sq_id: sqId,
        urgency,
        delivery_date: deliveryDate || null,
        payment_terms: paymentTerms,
        delivery_terms: deliveryTerms,
        other_terms: otherTerms,
        tax_type: taxType,
        attachments,
      };

      const itemsInput: SavePOItemInput[] = items.map((it) => ({
        pr_item_id: it.pr_item_id || null,
        item: it.item.trim(),
        material: it.material.trim() || undefined,
        grade: it.grade.trim() || undefined,
        size: it.size.trim() || undefined,
        hsn: it.hsn.trim() || undefined,
        uom: it.uom.trim() || 'KG',
        qty: Number(it.qty),
        rate: Number(it.rate),
        gst_pct: Number(it.gst_pct),
        delivery_date: it.delivery_date || null,
      }));

      const userName = user?.name || user?.email || 'User';
      const savedId = await withDocNo(editId ? undefined : doc.custom, () => savePO(editId || null, headerInput, itemsInput, userName));

      if (submitAfter) {
        await submitPO(savedId, userName);
        toast({ kind: 'success', title: 'PO Saved & Submitted', message: 'Your PO is now pending approval.' });
      } else {
        toast({ kind: 'success', title: 'Draft PO Saved', message: 'Your draft has been saved successfully.' });
      }

      navigate(`purchase-orders?id=${savedId}`);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save PO', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="card"><Empty icon={FileText} title="Loading PO Form…" /></div>;

  return (
    <>
      <PageHeader
        eyebrow="Purchase & Procurement"
        title={editId ? 'Edit Draft Purchase Order' : 'Create Purchase Order'}
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => navigate('purchase-orders')} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-subtle" onClick={() => handleSave(false)} disabled={saving}>
              Save as Draft
            </button>
            <button className="btn btn-primary" onClick={() => handleSave(true)} disabled={saving}>
              Save & Submit
            </button>
          </>
        }
      />

      {sourceBanner && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 18px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid var(--accent)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <FileText size={18} className="text-accent" />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              Prefilled from {sourceBanner.type === 'PR' ? 'Purchase Requisition' : 'Supplier Quotation'} ({sourceBanner.docNo})
            </div>
            <div className="text-xs muted">
              Items and parameters prefilled from upstream document. Quantities will remain tracked against PR requirements upon release.
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body form-page" style={{ padding: '20px 24px' }}>
          <div className="section-label">Order Header & Conditions</div>
          <div className="form-grid three">
            {!editId && <DocNoField label="PO No." no={doc.no} setNo={doc.setNo} />}
            <Field label="Supplier / Vendor" required>
              <select
                value={supplierId}
                onChange={(e) => {
                  const sid = Number(e.target.value) || '';
                  setSupplierId(sid);
                  const sup = suppliers.find((s) => s.id === sid);
                  if (sup?.defaultPaymentTerms) setPaymentTerms(sup.defaultPaymentTerms);
                }}
              >
                <option value="">Select a supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.code ? `(${s.code})` : ''}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Priority / Urgency">
              <select value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)}>
                <option value="Normal">Normal</option>
                <option value="Urgent">Urgent</option>
                <option value="Critical">Critical</option>
              </select>
            </Field>

            <Field label="Delivery Required Date">
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </Field>

            <Field label="Taxation Type">
              <select value={taxType} onChange={(e) => setTaxType(e.target.value as TaxType)}>
                <option value="intra">Intra-State (CGST + SGST)</option>
                <option value="inter">Inter-State (IGST)</option>
              </select>
            </Field>

            <Field label="Payment Terms">
              <input
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="e.g. 30 Days Net"
              />
            </Field>

            <Field label="Delivery Terms">
              <input
                value={deliveryTerms}
                onChange={(e) => setDeliveryTerms(e.target.value)}
                placeholder="e.g. Door delivery / Ex-works"
              />
            </Field>

            <Field label="Special Terms & Instructions" full>
              <textarea
                rows={2}
                value={otherTerms}
                onChange={(e) => setOtherTerms(e.target.value)}
                placeholder="Material test certificate required, inspection guidelines, packing norms…"
              />
            </Field>
          </div>
        </div>
      </div>

      {/* Multi-line Items */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <div>
            <h3>Line Items</h3>
            <div className="sub">Add specifications, quantities, unit prices and applicable GST</div>
          </div>
          <div className="right">
            <button className="btn btn-sm btn-subtle" onClick={addItemRow}>
              <Plus size={14} /> Add Row
            </button>
          </div>
        </div>

        <div className="card-body" style={{ padding: '0 22px 20px' }}>
          <div className="table-wrap" style={{ borderRadius: 8, border: '1px solid var(--border)' }}>
            <table className="tbl form-tbl" style={{ minWidth: 1240 }}>
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>#</th>
                  <th style={{ minWidth: 200 }}>Item Description *</th>
                  <th style={{ width: 150 }}>Material / Grade</th>
                  <th style={{ width: 150 }}>Size</th>
                  <th style={{ width: 100 }}>HSN</th>
                  <th style={{ width: 90 }}>UOM</th>
                  <th style={{ width: 100 }} className="r">Qty *</th>
                  <th style={{ width: 110 }} className="r">Rate (₹)</th>
                  <th style={{ width: 90 }}>GST %</th>
                  <th style={{ width: 120 }} className="r">Amount (₹)</th>
                  <th style={{ width: 48, textAlign: 'center' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const lineAmount = (it.qty || 0) * (it.rate || 0);
                  return (
                    <tr key={idx}>
                      <td className="center muted text-xs">{idx + 1}</td>
                      <td>
                        <input
                          value={it.item}
                          onChange={(e) => updateItemRow(idx, { item: e.target.value })}
                          placeholder="Item description"
                        />
                      </td>
                      <td>
                        <MaterialPick material={it.material} grade={it.grade} onChange={(v) => updateItemRow(idx, { material: v.material, grade: v.grade })} />
                      </td>
                      <td>
                        <SizePick value={it.size} onChange={(v) => updateItemRow(idx, { size: v })} />
                      </td>
                      <td>
                        <input
                          value={it.hsn}
                          onChange={(e) => updateItemRow(idx, { hsn: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          value={it.uom}
                          onChange={(e) => updateItemRow(idx, { uom: e.target.value })}
                        >
                          <option value="KG">KG</option>
                          <option value="NOS">NOS</option>
                          <option value="PCS">PCS</option>
                          <option value="MTR">MTR</option>
                          <option value="TON">TON</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={it.qty || ''}
                          onChange={(e) => updateItemRow(idx, { qty: Number(e.target.value) })}
                          style={{ textAlign: 'right' }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={it.rate || ''}
                          onChange={(e) => updateItemRow(idx, { rate: Number(e.target.value) })}
                          style={{ textAlign: 'right' }}
                        />
                      </td>
                      <td>
                        <select
                          value={it.gst_pct}
                          onChange={(e) => updateItemRow(idx, { gst_pct: Number(e.target.value) })}
                        >
                          <option value="0">0%</option>
                          <option value="5">5%</option>
                          <option value="12">12%</option>
                          <option value="18">18%</option>
                          <option value="28">28%</option>
                        </select>
                      </td>
                      <td className="r num strong nowrap">{inr(lineAmount)}</td>
                      <td className="center">
                        <button
                          type="button"
                          className="btn-del-row"
                          onClick={() => removeItemRow(idx)}
                          title="Remove Line Item"
                          aria-label="Remove item"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Live-calculated Totals Card */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <div style={{ minWidth: 300, border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', background: 'var(--surface-2)' }}>
              <div className="flex-between text-xs" style={{ marginBottom: 6 }}>
                <span className="muted">Taxable Subtotal:</span>
                <span className="font-semibold">{inr(totals.taxable)}</span>
              </div>
              <div className="flex-between text-xs" style={{ marginBottom: 8 }}>
                <span className="muted">Estimated GST:</span>
                <span className="font-semibold">{inr(totals.gst)}</span>
              </div>
              <div
                className="flex-between font-bold"
                style={{ borderTop: '1px solid var(--border-strong)', paddingTop: 10, fontSize: 16, color: 'var(--primary)' }}
              >
                <span>Total Value:</span>
                <span className="num">{inr(totals.total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Attachments Upload Card */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <div>
            <h3>Document Attachments</h3>
            <div className="sub">Attach supplier quotations, technical drawings, or purchase specifications</div>
          </div>
        </div>
        <div className="card-body" style={{ padding: '0 22px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <label className="btn btn-subtle" style={{ cursor: 'pointer' }}>
              <Paperclip size={14} /> {uploading ? 'Uploading…' : 'Attach File (Quote / Spec)'}
              <input type="file" onChange={handleFileUpload} style={{ display: 'none' }} disabled={uploading} />
            </label>
            <span className="text-xs muted">Supported formats: PDF, Images, Word, Excel (Max 15MB)</span>
          </div>

          {attachments.length > 0 && (
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {attachments.map((att, i) => (
                <span key={i} className="chip" style={{ padding: '6px 12px', fontSize: 13 }}>
                  <Paperclip size={13} style={{ marginRight: 4, color: 'var(--primary)' }} />
                  {att.name}
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 8, color: 'var(--text-3)', fontSize: 14 }}
                    onClick={() => setAttachments((curr) => curr.filter((_, idx) => idx !== i))}
                    title="Remove attachment"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
