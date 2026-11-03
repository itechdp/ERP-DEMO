-- ============================================================
-- 66 · Rework route
-- ============================================================
-- Pieces QC rejected can be sent back for another go: they go into our stock of parts, ready for the process chosen
-- (Forging / Trimming / Heat Treatment), and a new job card can then take them from that stock (54).
--   · the QC record keeps its accepted / rejected figures as they were (so the job's numbers still add up)
--   · qc_rework records how many rejected pieces were sent back, to which process, why, by whom and when
--   · the quantity ledger gets a line: QC rejected -> Parts stock
-- Needs 54 (parts stock), 59 (ledger). Safe to run twice.

create table if not exists qc_rework (
  id       bigint generated always as identity primary key,
  job_no   text not null references jobs (job_no),
  stage    process_stage not null check (stage in ('forging', 'trimming', 'heatTreatment')),
  qty      int  not null check (qty > 0),
  reason   text not null,
  by_name  text not null default '',
  at       timestamptz not null default now()
);
alter table qc_rework enable row level security;
revoke all on qc_rework from anon, authenticated;

create or replace view v_qc_rework as
select r.id, r.job_no, r.stage, r.qty, r.reason, r.by_name, r.at
  from qc_rework r
 where is_active_user();
grant select on v_qc_rework to authenticated;
revoke all on v_qc_rework from anon;

create or replace function send_for_rework(p_job_no text, p_stage text, p_qty int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  q       qc_records;
  j       jobs;
  v_done  int;
  v_note  text := btrim(coalesce(p_reason, ''));
begin
  perform _require_user();
  perform _require_write('qc');
  if p_stage not in ('forging', 'trimming', 'heatTreatment') then raise exception 'Choose the process the pieces go back to.'; end if;
  if not (coalesce(p_qty, 0) > 0) then raise exception 'Enter the quantity.'; end if;
  if v_note = '' then raise exception 'Write what is to be reworked.'; end if;
  select * into q from qc_records where job_no = p_job_no for update;
  if not found or q.status = 'QC Pending' then raise exception 'Job % has no inspected QC lot.', p_job_no; end if;
  select coalesce(sum(qty), 0) into v_done from qc_rework where job_no = p_job_no;
  if p_qty > q.rejected_qty - v_done then raise exception 'Only % rejected PCS of % are waiting for a decision.', q.rejected_qty - v_done, p_job_no; end if;
  select * into j from jobs where job_no = p_job_no;

  insert into semi_stock_lots (product_id, stage, qty, available_qty, note, received_by)
  values (j.product_id, p_stage::process_stage, p_qty, p_qty, 'Rework from ' || p_job_no || ': ' || v_note, _who());
  insert into qc_rework (job_no, stage, qty, reason, by_name) values (p_job_no, p_stage::process_stage, p_qty, v_note, _who());
  perform _move(now(), p_job_no, 'QC rejected', 'Parts stock', p_qty, 0, 'Sent for rework: ' || v_note);
end $$;

revoke all on function send_for_rework(text, text, int, text) from public, anon;
grant execute on function send_for_rework(text, text, int, text) to authenticated;
