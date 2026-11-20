-- ============================================================
-- STEP 2 · DELETE test activity.  *** DO NOT RUN until the preview (01) has been checked and approved. IRREVERSIBLE. ***
-- Take a backup first (Supabase → Database → Backups; or Settings → Backups → create one).
-- Keeps: users, roles, permissions, settings, document formats, and ALL master data (products, customers, suppliers, dies, machines,
-- furnaces, operators, inspectors, materials, lists, units, work instructions, minimum stock levels, ledger accounts).
-- Runs as one transaction: if anything fails, nothing is deleted.
-- ============================================================
begin;

truncate table
  -- production
  jobs, stage_records, job_material_issues, job_semi_issues, qc_records, qc_rework,
  hardness_reports, hardness_readings, dimension_reports,
  finished_goods, dispatches, dispatch_bags,
  raw_material_lots, semi_stock_lots, semi_stock_adjustments, movements, activity,
  furnace_loads, production_plan, job_work, job_work_out, machining_runs,
  die_history, die_issues, die_maintenance,
  -- sales
  sales_quotations, sales_quotation_items, sales_quotation_actions, sales_quotation_emails, sales_quotation_followups,
  sales_orders, sales_order_items, sales_records,
  -- purchase
  purchase_requisitions, purchase_requisition_items, rfqs, rfq_suppliers,
  supplier_quotations, supplier_quotation_items,
  purchase_orders, purchase_order_items, po_approvals, po_revisions, po_email_log,
  purchase_invoices, purchase_invoice_items, purchase_payments,
  -- accounting entries (ledger accounts are kept)
  acc_vouchers, acc_journals, acc_journal_lines, acc_bills, acc_bill_items, acc_cash_exchanges, acc_drafts,
  -- misc
  notifications, calendar_events, petty_cash_logs, quick_material_logs
  restart identity;      -- no CASCADE on purpose: if a kept table points at one of these, the statement stops instead of deleting it

-- document numbers start again at 0001 for the things that were deleted (work instructions are kept, so their counter is kept)
delete from doc_counters where kind <> 'workinstr';

-- dies / machines / furnaces show their last state: put them back to idle
update machining_machines set status = 'Available' where status = 'Running';

commit;
