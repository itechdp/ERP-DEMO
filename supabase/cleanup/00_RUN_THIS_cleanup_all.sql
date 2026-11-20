-- ============================================================================================================
-- ONE-SHOT CLEANUP for going live. Paste this WHOLE file into a NEW empty Supabase SQL-editor tab and press Run once.
-- IRREVERSIBLE: create a backup first (Database -> Backups). It is ONE transaction: if anything fails, nothing is deleted.
--
-- DELETES   all test activity: jobs, stage records, raw inward / stock, QC, hardness, finished goods, dispatch, ledger, activity,
--           job work, CNC/VMC runs, die logs, sales, purchase, accounting entries, notifications, calendar, widgets
--           + the four test masters: products 12 and SMP-45, main dies DIE-0001 and DIE-0002
-- KEEPS     users, roles, permissions, settings, document formats, and every other master (other products/dies, customers,
--           suppliers, machines, furnaces, operators, inspectors, materials, lists, units, work instructions, ledger accounts)
-- ============================================================================================================
begin;

-- 1) test activity (no CASCADE on purpose: if a kept table points at one of these, it stops instead of deleting it)
truncate table
  jobs, stage_records, job_material_issues, job_semi_issues, qc_records, qc_rework,
  hardness_reports, hardness_readings, dimension_reports,
  finished_goods, dispatches, dispatch_bags,
  raw_material_lots, semi_stock_lots, semi_stock_adjustments, movements, activity,
  furnace_loads, production_plan, job_work, job_work_out, machining_runs,
  die_history, die_issues, die_maintenance,
  sales_quotations, sales_quotation_items, sales_quotation_actions, sales_quotation_emails, sales_quotation_followups,
  sales_orders, sales_order_items, sales_records,
  purchase_requisitions, purchase_requisition_items, rfqs, rfq_suppliers,
  supplier_quotations, supplier_quotation_items,
  purchase_orders, purchase_order_items, po_approvals, po_revisions, po_email_log,
  purchase_invoices, purchase_invoice_items, purchase_payments,
  acc_vouchers, acc_journals, acc_journal_lines, acc_bills, acc_bill_items, acc_cash_exchanges, acc_drafts,
  notifications, calendar_events, petty_cash_logs, quick_material_logs
  restart identity;

-- document numbers start again at 0001 (work instructions are kept, so their counter is kept)
delete from doc_counters where kind <> 'workinstr';
update machining_machines set status = 'Available' where status = 'Running';

-- 2) the four test masters. The database refuses to delete dies on purpose: lift that only inside this transaction, then restore it.
alter table die_history disable trigger die_history_no_delete;
alter table dies        disable trigger dies_no_delete;
alter table main_dies   disable trigger main_dies_no_delete;

update dies set replaces_code = null, replaced_by_code = null where main_code in ('DIE-0001', 'DIE-0002');
delete from dies      where main_code in ('DIE-0001', 'DIE-0002');
delete from main_dies where code in ('DIE-0001', 'DIE-0002');

alter table die_history enable trigger die_history_no_delete;
alter table dies        enable trigger dies_no_delete;
alter table main_dies   enable trigger main_dies_no_delete;

delete from stock_levels where key in (select 'semi|' || id || '|' || s from products, unnest(array['forging', 'trimming', 'heatTreatment']) s where code in ('12', 'SMP-45'));
delete from products where code in ('12', 'SMP-45');

commit;

-- 3) check: every number below should be 0 (the first four) and the protection count should be 3
select (select count(*) from jobs)              as jobs,
       (select count(*) from raw_material_lots) as raw_lots,
       (select count(*) from products where code in ('12', 'SMP-45'))        as test_products,
       (select count(*) from main_dies where code in ('DIE-0001', 'DIE-0002')) as test_main_dies,
       (select count(*) from pg_trigger where tgname in ('main_dies_no_delete', 'dies_no_delete', 'die_history_no_delete') and tgenabled = 'O') as die_protection_on,
       (select count(*) from profiles)          as users_kept;
