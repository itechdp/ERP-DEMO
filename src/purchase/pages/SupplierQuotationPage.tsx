import { ClipboardCheck } from 'lucide-react';
import { withDocNo } from '../../db/client';
import { DocNoField, useDocNo } from '../../components/DocNoField';
import { openUrl } from '../../native/native';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle,
  Eye,
  FileCheck,
  FileSpreadsheet,
  Paperclip,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { Conf, Write, canSee, useAccess } from '../../auth/access';
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
import { MaterialPick, SizePick } from '../../masters/MaterialPick';
import { fmtDate, fmtNum, matches } from '../../components/format';
import { useStore } from '../../store/StoreContext';
import {
  usePurchaseRequisitions,
  useQuotationDetail,
  useQuotations,
  useRFQs,
  useSuppliers,
} from '../hooks/usePurchase';
import {
  getQuotationAttachmentUrl,
  saveQuotation,
  setQuotationStatus,
  uploadQuotationAttachment,
} from '../services/quotationService';
import { fetchPRDetail } from '../services/prService';
import { fetchRFQDetail } from '../services/rfqService';
import { DocButtons } from '../../export/docOutput';
import * as docs from '../../export/documents';
import { usePaged } from '../../components/Pager';
import type {
  SQStatus,
  SaveSQHeaderInput,
  SaveSQItemInput,
} from '../types';

const inr = (v: number) => `₹ ${v.toLocaleString('en-IN')}`;

interface FormItem {
  pr_item_id?: number | null;
  item: string;
  material: string;
  grade: string;
  size: string;
  uom: string;
  qty: number;
  rate: number;
}

export function SupplierQuotationPage({
  query,
  navigate,
}: {
  query?: URLSearchParams;
  navigate: (r: string) => void;
}) {
  const { quotations, loading, error, reload } = useQuotations();

  const detailIdParam = Number(query?.get('id')) || null;
  const isNewParam = query?.get('new') === '1';
  const rfqIdParam = Number(query?.get('rfq_id')) || null;
  const supplierIdParam = Number(query?.get('supplier_id')) || null;

  const [selectedSQId, setSelectedSQId] = useState<number | null>(detailIdParam);
  const [createModal, setCreateModal] = useState(isNewParam);

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const showParty = canSee('party_names');

  useEffect(() => {
    if (detailIdParam) setSelectedSQId(detailIdParam);
  }, [detailIdParam]);

  useEffect(() => {
    if (isNewParam || rfqIdParam || supplierIdParam) {
      setCreateModal(true);
    }
  }, [isNewParam, rfqIdParam, supplierIdParam]);

  const shown = useMemo(() => {
    return quotations
      .filter((s) => statusFilter === 'all' || s.status === statusFilter)
      .filter((s) =>
        matches(
          q,
          s.sqNo,
          s.supplierName,
          s.rfqNo,
          s.prNo,
          s.status,
          s.paymentTerms,
          s.deliveryTerms
        )
      );
  }, [quotations, statusFilter, q]);
  const pg = usePaged(shown, shown.length);

  const filterGroups = [
    {
      label: 'Status',
      value: statusFilter,
      onChange: setStatusFilter,
      options: [
        { value: 'all', label: 'All Statuses' },
        { value: 'Received', label: 'Received' },
        { value: 'Shortlisted', label: 'Shortlisted' },
        { value: 'Selected', label: 'Selected' },
        { value: 'Rejected', label: 'Rejected' },
      ],
    },
  ];

  // the entry form is a full page, not a pop-up
  if (createModal) {
    return (
      <PageFormCtx.Provider value={{ eyebrow: 'Upstream Procurement' }}>
        <CreateQuotationModal
          prefillRFQId={rfqIdParam}
          prefillSupplierId={supplierIdParam}
          onClose={() => {
            setCreateModal(false);
            if (isNewParam || rfqIdParam || supplierIdParam) navigate('supplier-quotations');
          }}
          onSaved={(newId) => {
            setCreateModal(false);
            void reload();
            setSelectedSQId(newId);
          }}
        />
      </PageFormCtx.Provider>
    );
  }

  if (selectedSQId) {
    return (
      <SQDetailView
        id={selectedSQId}
        onBack={() => {
          setSelectedSQId(null);
          navigate('supplier-quotations');
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
        title="Supplier Quotations"
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => reload()} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <Write res="supplier_quotations">
              <button
                className="btn btn-primary"
                onClick={() => setCreateModal(true)}
              >
                <Plus size={15} /> Enter Quotation
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
              placeholder="Search by Quote No, Supplier, RFQ No, PR No..."
            />
            <FilterMenu groups={filterGroups} />
          </div>
          <div className="right text-xs muted">
            Showing {shown.length} of {quotations.length} quotations
          </div>
        </div>

        {loading ? (
          <div className="card-center-msg">Loading supplier quotations…</div>
        ) : error ? (
          <div className="card-center-msg text-red">{error}</div>
        ) : shown.length === 0 ? (
          <Empty
            title="No supplier quotations recorded"
            text={
              quotations.length === 0
                ? 'Record quotations received from suppliers against RFQs or PRs to evaluate and compare pricing.'
                : 'No quotations match your search criteria.'
            }
            action={
              quotations.length === 0 ? (
                <Write res="supplier_quotations">
                  <button
                    className="btn btn-primary"
                    onClick={() => setCreateModal(true)}
                  >
                    <Plus size={15} /> Enter Supplier Quotation
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
                  <th style={{ width: 130 }}>Quote No</th>
                  <th>Supplier</th>
                  <th style={{ width: 130 }}>RFQ / PR</th>
                  <th style={{ width: 110 }}>Date</th>
                  <th className="center" style={{ width: 100 }}>Lead Time</th>
                  <th style={{ width: 130 }}>Payment Terms</th>
                  <Conf g="purchase_rates">
                    <th className="right" style={{ width: 130 }}>Total Amount</th>
                  </Conf>
                  <th className="center" style={{ width: 120 }}>Status</th>
                  <th className="act" style={{ width: 120 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((s) => (
                  <tr key={s.id}>
                    <td className="strong">
                      <button
                        className="link-btn"
                        onClick={() => setSelectedSQId(s.id)}
                        style={{ fontWeight: 600 }}
                      >
                        {s.sqNo}
                      </button>
                    </td>
                    <td>
                      {showParty ? (
                        <div className="strong">{s.supplierName || `Supplier #${s.supplierId}`}</div>
                      ) : (
                        <span className="text-xs muted">Supplier #{s.supplierId}</span>
                      )}
                    </td>
                    <td className="mono text-xs">
                      {s.rfqNo && <div>RFQ: {s.rfqNo}</div>}
                      {s.prNo && <div>PR: {s.prNo}</div>}
                      {!s.rfqNo && !s.prNo && '—'}
                    </td>
                    <td className="muted nowrap">{fmtDate(s.sqDate)}</td>
                    <td className="center mono">
                      {s.leadDays ? `${s.leadDays} days` : '—'}
                    </td>
                    <td className="text-xs">{s.paymentTerms || '—'}</td>
                    <Conf g="purchase_rates">
                      <td className="right mono strong text-green">
                        {inr(s.totalAmount || 0)}
                      </td>
                    </Conf>
                    <td className="center">
                      <Badge status={s.status} />
                    </td>
                    <td className="act nowrap">
                      <div className="icon-actions">
                        <button
                          className="icon-btn"
                          title="View quotation details"
                          onClick={() => setSelectedSQId(s.id)}
                        >
                          <Eye size={16} />
                        </button>
                        <Write res="procurement_po">
                          <button
                            className="icon-btn"
                            title="Create PO from this Quotation"
                            onClick={() => navigate(`purchase-orders?new=1&from_sq=${s.id}`)}
                          >
                            <FileCheck size={16} />
                          </button>
                        </Write>
                        {(s.status === 'Received' || s.status === 'Shortlisted') && (
                          <Write res="supplier_quotations">
                            <button className="icon-btn" title="Open to shortlist or select" aria-label={`Next step ${s.id}`} onClick={() => setSelectedSQId(s.id)}><ClipboardCheck size={16} /></button>
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
// Quotation Detail View
// ---------------------------------------------------------------------------------------------
function SQDetailView({
  id,
  onBack,
  navigate,
}: {
  id: number;
  onBack: () => void;
  navigate: (r: string) => void;
}) {
  const { quotation, loading, error, reload } = useQuotationDetail(id);
  const { user } = useAccess();
  const { toast } = useStore();
  const [acting, setActing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const userName = user?.name || user?.email || 'User';

  if (loading) {
    return (
      <div className="card">
        <div className="card-center-msg">Loading quotation details…</div>
      </div>
    );
  }

  if (error || !quotation) {
    return (
      <div className="card">
        <div className="card-center-msg text-red">{error || 'Quotation not found.'}</div>
        <div className="center mt-4">
          <button className="btn btn-subtle" onClick={onBack}>
            <ArrowLeft size={15} /> Back to Quotations
          </button>
        </div>
      </div>
    );
  }

  const handleStatusChange = async (status: SQStatus) => {
    try {
      setActing(true);
      await setQuotationStatus(quotation.id, status, userName);
      toast({
        kind: 'success',
        title: 'Status Updated',
        message: `Quotation status changed to ${status}.`,
      });
      void reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Update failed', message: String(e) });
    } finally {
      setActing(false);
    }
  };

  const handleDownloadDoc = async (path: string) => {
    try {
      setDownloading(true);
      const url = await getQuotationAttachmentUrl(path);
      await openUrl(url);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not open document', message: String(e) });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Supplier Quotation Detail"
        title={`${quotation.sqNo} — ${quotation.supplierName || `Supplier #${quotation.supplierId}`}`}
        actions={
          <>
            <button className="btn btn-subtle" onClick={onBack}>
              <ArrowLeft size={14} /> Back
            </button>
            <DocButtons build={(u) => docs.supplierQuotationSpec(quotation, u)} />
            <button className="btn btn-subtle" onClick={() => reload()} disabled={acting}>
              <RefreshCw size={14} /> Refresh
            </button>

            {/* Selection actions */}
            <Write res="supplier_quotations">
              {quotation.status !== 'Shortlisted' && quotation.status !== 'Selected' && (
                <button
                  className="btn btn-subtle"
                  onClick={() => handleStatusChange('Shortlisted')}
                  disabled={acting}
                >
                  Shortlist
                </button>
              )}
              {quotation.status !== 'Selected' && (
                <button
                  className="btn btn-subtle"
                  onClick={() => handleStatusChange('Selected')}
                  disabled={acting}
                >
                  <CheckCircle size={14} /> Mark Selected
                </button>
              )}
              {quotation.status !== 'Rejected' && (
                <button
                  className="btn btn-danger"
                  onClick={() => handleStatusChange('Rejected')}
                  disabled={acting}
                >
                  <XCircle size={14} /> Reject
                </button>
              )}
            </Write>

            {/* Create PO from this quotation button - Strictly guarded */}
            <Write res="procurement_po">
              <button
                className="btn btn-primary"
                onClick={() => navigate(`purchase-orders?new=1&from_sq=${quotation.id}`)}
              >
                <Plus size={14} /> Create PO from this Quotation
              </button>
            </Write>

            {(quotation.rfqId || quotation.prId) && (
              <button
                className="btn btn-subtle"
                onClick={() =>
                  navigate(
                    `quotation-comparison?rfq_id=${quotation.rfqId || ''}&pr_id=${quotation.prId || ''}`
                  )
                }
              >
                <FileSpreadsheet size={14} /> Compare with Others
              </button>
            )}
          </>
        }
      />

      {/* Meta Grid */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 20, padding: 20 }}>
          <div>
            <div className="text-xs muted">Status</div>
            <div style={{ marginTop: 6 }}>
              <Badge status={quotation.status} />
            </div>
          </div>
          <div>
            <div className="text-xs muted">Quote No</div>
            <div className="strong mono" style={{ marginTop: 6 }}>
              {quotation.sqNo}
            </div>
          </div>
          <div>
            <div className="text-xs muted">Quotation Date</div>
            <div className="strong" style={{ marginTop: 6 }}>
              {fmtDate(quotation.sqDate)}
            </div>
          </div>
          <div>
            <div className="text-xs muted">Lead Time</div>
            <div className="strong" style={{ marginTop: 6 }}>
              {quotation.leadDays ? `${quotation.leadDays} Days` : 'Not specified'}
            </div>
          </div>
          <div>
            <div className="text-xs muted">Payment Terms</div>
            <div className="strong" style={{ marginTop: 6 }}>
              {quotation.paymentTerms || '30 Days'}
            </div>
          </div>
          <div>
            <div className="text-xs muted">Delivery Terms</div>
            <div className="strong" style={{ marginTop: 6 }}>
              {quotation.deliveryTerms || 'Door Delivery'}
            </div>
          </div>
        </div>

        {/* Attachment link */}
        {quotation.attachmentPath && (
          <div style={{ padding: '0 20px 16px', borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <button
              className="btn btn-sm btn-subtle"
              onClick={() => handleDownloadDoc(quotation.attachmentPath!)}
              disabled={downloading}
            >
              <Paperclip size={14} /> View Attached Quotation PDF
            </button>
          </div>
        )}
      </div>

      {/* Items Table */}
      <div className="card">
        <div className="card-head">
          <h3>Quoted Line Items ({quotation.items.length})</h3>
          <Conf g="purchase_rates">
            <div className="right text-sm strong text-green">
              Total Quoted Amount: {inr(quotation.totalAmount || 0)}
            </div>
          </Conf>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th>Item Description</th>
                <th>Material / Grade / Size</th>
                <th className="center" style={{ width: 80 }}>UOM</th>
                <th className="right" style={{ width: 110 }}>Qty</th>
                <Conf g="purchase_rates">
                  <th className="right" style={{ width: 120 }}>Rate (INR)</th>
                  <th className="right" style={{ width: 130 }}>Line Amount</th>
                </Conf>
              </tr>
            </thead>
            <tbody>
              {quotation.items.map((it, idx) => (
                <tr key={it.id}>
                  <td className="mono muted">{idx + 1}</td>
                  <td className="strong">{it.item}</td>
                  <td>{[it.material, it.grade, it.size].filter(Boolean).join(' • ') || '—'}</td>
                  <td className="center mono">{it.uom}</td>
                  <td className="right mono">{fmtNum(it.qty)}</td>
                  <Conf g="purchase_rates">
                    <td className="right mono strong">{inr(it.rate)}</td>
                    <td className="right mono strong text-green">{inr(it.amount || it.qty * it.rate)}</td>
                  </Conf>
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
// Create Quotation Modal
// ---------------------------------------------------------------------------------------------
function CreateQuotationModal({
  prefillRFQId,
  prefillSupplierId,
  onClose,
  onSaved,
}: {
  prefillRFQId: number | null;
  prefillSupplierId: number | null;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const { suppliers } = useSuppliers();
  const { rfqs } = useRFQs();
  const { requisitions } = usePurchaseRequisitions();
  const { user } = useAccess();
  const { toast } = useStore();

  const [saving, setSaving] = useState(false);
  const doc = useDocNo('sq', true);
  const [uploading, setUploading] = useState(false);

  // Form states
  const [supplierId, setSupplierId] = useState<number | ''>(prefillSupplierId || '');
  const [rfqId, setRfqId] = useState<number | ''>(prefillRFQId || '');
  const [prId, setPrId] = useState<number | ''>('');
  const [quotationDate, setQuotationDate] = useState(new Date().toISOString().slice(0, 10));
  const [validTill, setValidTill] = useState('');
  const [leadDays, setLeadDays] = useState<number | ''>(7);
  const [paymentTerms, setPaymentTerms] = useState('30 Days');
  const [deliveryTerms, setDeliveryTerms] = useState('Door Delivery');
  const [documentUrl, setDocumentUrl] = useState('');
  const [attachedFileName, setAttachedFileName] = useState('');

  // Line items
  const [items, setItems] = useState<FormItem[]>([
    {
      item: '',
      material: '',
      grade: '',
      size: '',
      uom: 'KG',
      qty: 0,
      rate: 0,
    },
  ]);

  // When RFQ changes, auto load its PR items
  useEffect(() => {
    if (!rfqId) return;
    void (async () => {
      try {
        const detail = await fetchRFQDetail(Number(rfqId));
        if (detail.prId) {
          setPrId(detail.prId);
        }
        if (detail.pr?.items && detail.pr.items.length > 0) {
          setItems(
            detail.pr.items.map((it) => ({
              pr_item_id: it.id,
              item: it.item,
              material: it.material || '',
              grade: it.grade || '',
              size: it.size || '',
              uom: it.uom,
              qty: it.qty,
              rate: 0,
            }))
          );
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [rfqId]);

  // When PR is selected manually (without RFQ)
  const handlePRChange = async (selectedPRId: number | '') => {
    setPrId(selectedPRId);
    if (!selectedPRId) return;
    try {
      const detail = await fetchPRDetail(Number(selectedPRId));
      if (detail.items && detail.items.length > 0) {
        setItems(
          detail.items.map((it) => ({
            pr_item_id: it.id,
            item: it.item,
            material: it.material || '',
            grade: it.grade || '',
            size: it.size || '',
            uom: it.uom,
            qty: it.qty,
            rate: 0,
          }))
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      const res = await uploadQuotationAttachment(file);
      setDocumentUrl(res.path);
      setAttachedFileName(file.name);
      toast({ kind: 'success', title: 'Quotation file uploaded', message: file.name });
    } catch (err) {
      toast({ kind: 'error', title: 'Upload failed', message: String(err) });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

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
        rate: 0,
      },
    ]);
  };

  const removeRow = (index: number) => {
    if (items.length <= 1) {
      toast({ kind: 'error', title: 'At least one item required', message: 'Quote must have at least one line.' });
      return;
    }
    setItems((curr) => curr.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, patch: Partial<FormItem>) => {
    setItems((curr) => curr.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const handleSave = async () => {
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
        toast({ kind: 'error', title: 'Quantity required', message: `Row #${i + 1} quantity must be greater than zero.` });
        return;
      }
      if (it.rate <= 0) {
        toast({ kind: 'error', title: 'Rate required', message: `Row #${i + 1} quoted rate must be greater than zero.` });
        return;
      }
    }

    try {
      setSaving(true);
      const headerInput: SaveSQHeaderInput = {
        supplier_id: Number(supplierId),
        rfq_id: rfqId ? Number(rfqId) : null,
        pr_id: prId ? Number(prId) : null,
        sq_date: quotationDate || undefined,
        valid_till: validTill || null,
        lead_days: leadDays ? Number(leadDays) : null,
        payment_terms: paymentTerms,
        delivery_terms: deliveryTerms,
        attachment_path: documentUrl || null,
      };

      const itemsInput: SaveSQItemInput[] = items.map((it) => ({
        pr_item_id: it.pr_item_id || null,
        item: it.item.trim(),
        material: it.material.trim() || undefined,
        grade: it.grade.trim() || undefined,
        size: it.size.trim() || undefined,
        uom: it.uom.trim() || 'KG',
        qty: Number(it.qty),
        rate: Number(it.rate),
      }));

      const userName = user?.name || user?.email || 'User';
      const savedId = await withDocNo(doc.custom, () => saveQuotation(null, headerInput, itemsInput, userName));

      toast({ kind: 'success', title: 'Quotation Saved', message: 'Supplier quotation recorded successfully.' });
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
      title="Enter Supplier Quotation"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-subtle" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Quotation'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 14 }}>
          <DocNoField label="Quotation No." no={doc.no} setNo={doc.setNo} />
          <Field label="Supplier / Vendor" required>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">-- Select Supplier --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.state ? `(${s.state})` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Linked Procurement (Optional)">
            <select
              value={rfqId}
              onChange={(e) => setRfqId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">-- Direct / No RFQ --</option>
              {rfqs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.rfqNo} {r.prNo ? `(PR: ${r.prNo})` : ''} [{r.status}]
                </option>
              ))}
            </select>
          </Field>

          {!rfqId && (
            <Field label="Linked PR (Optional)">
              <select
                value={prId}
                onChange={(e) => handlePRChange(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">-- No PR Link --</option>
                {requisitions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.prNo} — {p.department} [{p.status}]
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Quotation Date" required>
            <input
              type="date"
              value={quotationDate}
              onChange={(e) => setQuotationDate(e.target.value)}
            />
          </Field>

          <Field label="Valid Till">
            <input type="date" value={validTill} onChange={(e) => setValidTill(e.target.value)} />
          </Field>

          <Field label="Lead Time (Days)">
            <input
              type="number"
              value={leadDays}
              onChange={(e) => setLeadDays(e.target.value ? Number(e.target.value) : '')}
              placeholder="e.g. 7"
            />
          </Field>

          <Field label="Payment Terms">
            <input
              type="text"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="e.g. 30 Days"
            />
          </Field>

          <Field label="Delivery Terms">
            <input
              type="text"
              value={deliveryTerms}
              onChange={(e) => setDeliveryTerms(e.target.value)}
              placeholder="e.g. Door Delivery / Ex-Works"
            />
          </Field>
        </div>

        {/* Attachment upload */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Field label="Attach Quotation File (PDF/Image)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label className="btn btn-sm btn-subtle" style={{ cursor: 'pointer' }}>
                <Upload size={14} /> {attachedFileName ? 'Replace File' : 'Upload File'}
                <input
                  type="file"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                  accept=".pdf,image/*"
                />
              </label>
              {attachedFileName && <span className="text-xs strong text-green">{attachedFileName}</span>}
              {uploading && <span className="text-xs muted">Uploading…</span>}
            </div>
          </Field>
        </div>

        {/* Quoted Items Multi-line */}
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h4 style={{ margin: 0 }}>Quoted Items &amp; Rates ({items.length})</h4>
            <button type="button" className="btn btn-sm btn-subtle" onClick={addRow}>
              <Plus size={14} /> Add Line
            </button>
          </div>

          <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
            <table className="tbl form-tbl" style={{ fontSize: 13, minWidth: 1120 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th style={{ minWidth: 200 }}>Item Description *</th>
                  <th style={{ width: 140 }}>Material</th>
                  <th style={{ width: 120 }}>Grade</th>
                  <th style={{ width: 150 }}>Size</th>
                  <th style={{ width: 90 }}>UOM</th>
                  <th style={{ width: 100 }} className="right">Qty *</th>
                  <th style={{ width: 110 }} className="right">Rate (₹) *</th>
                  <th style={{ width: 110 }} className="right">Total (₹)</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const lineTotal = (it.qty || 0) * (it.rate || 0);
                  return (
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
                        <input
                          type="text"
                          value={it.uom}
                          onChange={(e) => updateRow(idx, { uom: e.target.value })}
                        />
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
                          type="number"
                          step="any"
                          min="0"
                          className="right mono strong"
                          value={it.rate || ''}
                          onChange={(e) => updateRow(idx, { rate: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="right mono strong text-green">
                        {fmtNum(lineTotal)}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}
