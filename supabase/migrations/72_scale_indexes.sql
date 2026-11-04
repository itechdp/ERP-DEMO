-- ============================================================
-- 72 · Indexes for when the data grows
-- ============================================================
-- Indexes the common filters, sorts and searches need so lists and the Ledger stay quick with years of records.
-- (The main ones already exist from the first migrations: movements by date and job, dispatches by job and date, lots for FIFO,
--  stage records by stage and status ...; this adds what was missing.)  Only adds indexes — no data changes. Safe to run twice.

create index if not exists stage_records_job_idx       on stage_records (job_no, stage);
create index if not exists movements_to_idx            on movements (to_loc);
create index if not exists movements_kind_idx          on movements (kind) where kind is not null;
create index if not exists movements_loss_idx          on movements (loss) where loss > 0;
create index if not exists jobs_due_idx                on jobs (due_date);
create index if not exists jobs_customer_name_idx      on jobs (customer);
create index if not exists dimension_reports_job_idx   on dimension_reports (job_no);
create index if not exists job_work_out_job_idx        on job_work_out (job_no);
create index if not exists job_work_out_status_idx     on job_work_out (status, due_date);
create index if not exists sales_orders_status_idx     on sales_orders (status);
create index if not exists finished_goods_received_idx on finished_goods (received_at desc);
create index if not exists raw_lots_inward_idx         on raw_material_lots (inward_date desc);

-- the Ledger search ("contains" on job, stage, note, who entered it) uses trigram indexes; if the extension cannot be switched on here,
-- the search still works, just slower on a very large ledger
do $$
begin
  create extension if not exists pg_trgm with schema extensions;
  execute 'create index if not exists movements_job_trgm   on movements using gin (job_no   extensions.gin_trgm_ops)';
  execute 'create index if not exists movements_note_trgm  on movements using gin (note     extensions.gin_trgm_ops)';
  execute 'create index if not exists movements_from_trgm  on movements using gin (from_loc extensions.gin_trgm_ops)';
  execute 'create index if not exists movements_to_trgm    on movements using gin (to_loc   extensions.gin_trgm_ops)';
exception when others then
  raise notice 'trigram search indexes skipped: %', sqlerrm;
end $$;
