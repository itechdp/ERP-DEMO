-- ============================================================
-- STEP 1 · PREVIEW — READ ONLY. Deletes nothing. Run in the Supabase SQL editor and send / check the result.
-- Shows how many rows each group holds, then lists the master data and users so you can spot test entries.
-- ============================================================

-- A) Rows that would be DELETED (test activity)   B) Rows that are KEPT (masters / settings / users)
with t(grp, tbl, why) as (values
  -- ---- A · DELETE: production activity
  ('A delete','jobs','job cards'),('A delete','stage_records','cutting / forging / trimming / heat treatment / CNC / VMC steps'),
  ('A delete','job_material_issues','raw bar issued to jobs'),('A delete','job_semi_issues','parts stock issued to jobs'),
  ('A delete','qc_records','QC inspections'),('A delete','qc_rework','rework decisions'),
  ('A delete','hardness_reports','hardness reports'),('A delete','hardness_readings','hardness readings'),('A delete','dimension_reports','dimension reports'),
  ('A delete','finished_goods','finished goods lots'),('A delete','dispatches','dispatches'),('A delete','dispatch_bags','dispatch bag weights'),
  ('A delete','raw_material_lots','raw material inward / stock lots'),('A delete','semi_stock_lots','parts (semi-finished) stock'),('A delete','semi_stock_adjustments','parts stock adjustments'),
  ('A delete','movements','quantity ledger'),('A delete','activity','activity feed'),
  ('A delete','furnace_loads','furnace loads'),('A delete','production_plan','heat treatment plan'),
  ('A delete','job_work','job work in'),('A delete','job_work_out','job work out'),
  ('A delete','machining_runs','CNC / VMC run log'),
  ('A delete','die_history','die history'),('A delete','die_issues','die issue log'),('A delete','die_maintenance','die maintenance log'),
  -- ---- A · DELETE: sales
  ('A delete','sales_quotations','quotations'),('A delete','sales_quotation_items','quotation lines'),('A delete','sales_quotation_actions','quotation approvals trail'),
  ('A delete','sales_quotation_emails','quotation e-mail log'),('A delete','sales_quotation_followups','quotation follow-ups'),
  ('A delete','sales_orders','sales orders'),('A delete','sales_order_items','sales order lines'),
  ('A delete','sales_records','enquiries / customer POs / follow-ups / tasks'),
  -- ---- A · DELETE: purchase
  ('A delete','purchase_requisitions','purchase requisitions'),('A delete','purchase_requisition_items','requisition lines'),
  ('A delete','rfqs','RFQs'),('A delete','rfq_suppliers','RFQ suppliers'),
  ('A delete','supplier_quotations','supplier quotations'),('A delete','supplier_quotation_items','supplier quotation lines'),
  ('A delete','purchase_orders','purchase orders'),('A delete','purchase_order_items','PO lines'),('A delete','po_approvals','PO approvals'),('A delete','po_revisions','PO revisions'),('A delete','po_email_log','PO e-mail log'),
  ('A delete','purchase_invoices','purchase invoices'),('A delete','purchase_invoice_items','invoice lines'),('A delete','purchase_payments','supplier payments'),
  -- ---- A · DELETE: accounting entries
  ('A delete','acc_vouchers','vouchers'),('A delete','acc_journals','journal vouchers'),('A delete','acc_journal_lines','journal lines'),
  ('A delete','acc_bills','bills'),('A delete','acc_bill_items','bill lines'),('A delete','acc_cash_exchanges','cash exchanges'),('A delete','acc_drafts','proposed vouchers'),
  -- ---- A · DELETE: misc
  ('A delete','notifications','notifications'),('A delete','calendar_events','calendar events'),('A delete','petty_cash_logs','petty cash widget'),('A delete','quick_material_logs','quick material log widget'),
  -- ---- B · KEPT: masters
  ('B keep','products','Product Master'),('B keep','customers','customers'),('B keep','suppliers','suppliers'),
  ('B keep','dies','dies'),('B keep','main_dies','main dies'),('B keep','machines','stage machine list'),('B keep','machining_machines','CNC / VMC machines'),
  ('B keep','furnaces','furnaces'),('B keep','operators','operators'),('B keep','inspectors','inspectors'),
  ('B keep','material_master','materials'),('B keep','hardness_specs','hardness specs'),('B keep','dropdown_lists','drop-down lists'),('B keep','units','units'),
  ('B keep','work_instructions','work instructions'),('B keep','stock_levels','minimum stock levels'),
  ('B keep','acc_accounts','ledger accounts'),('B keep','acc_items','bill item list'),('B keep','acc_account_map','account mapping'),
  -- ---- B · KEPT: users / permissions / settings
  ('B keep','profiles','users'),('B keep','role_page_access','page permissions'),('B keep','role_field_access','field permissions'),
  ('B keep','company_settings','company settings'),('B keep','production_settings','production settings'),('B keep','sales_settings','sales settings'),
  ('B keep','acc_settings','accounting settings'),('B keep','doc_no_kinds','document number formats'),('B keep','approval_submitters','approval settings')
)
select grp as "group", tbl as "table", why as "what it is",
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', tbl), false, true, '')))[1]::text::int as "rows"
  from t order by grp, tbl;

-- B) The master data to review — are any of these test entries that should go too?
select 'product'  as kind, code as ref, name as label from products order by code;
select 'customer' as kind, name as label from customers order by name;
select 'supplier' as kind, name as label from suppliers order by name;
select 'die'      as kind, code as ref, status::text as label from dies order by code;

-- C) The users that are kept (look for demo accounts such as *@forgeflow.local)
select u.email, p.full_name, p.role, p.active from profiles p join auth.users u on u.id = p.id order by p.role, u.email;
