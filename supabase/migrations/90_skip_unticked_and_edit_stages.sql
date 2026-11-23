-- ============================================================
-- 90 · Unticked processes are skipped for waiting jobs too · Completed stages can be corrected
-- ============================================================
-- Needs 59 and 83. Safe to run twice.
--
-- 1. SKIP UNTICKED PROCESSES. A job already skips every process its product does not tick (Product Master → Work to be done) when it
--    moves on. A job that was ALREADY WAITING at a process when that process was unticked stayed there. Now:
--      · unticking a process in Product Master moves every job of that product that is waiting at it straight on, the same way
--        (written down as "Not required — skipped"; nothing is counted as loss). Started or finished work is never touched.
--      · jobs waiting today at a process their product does not tick are moved on once, at the end of this file.
--    Job-work batches follow their own ticks (Job Work In), not the product's, and are left alone.
-- 2. CORRECT A COMPLETED STAGE (edit_stage). Rejection / OK quantity (Cutting: OK and rejection, so the total cut), Checked By,
--    Manpower, the date and the Heat Treatment temperatures can be corrected after saving. A changed OK quantity is passed on: every
--    later stage that is finished keeps its own rejection and its numbers move by the same amount; the first stage still waiting (or
--    QC still waiting) simply receives the corrected quantity. Once QC has inspected the batch the quantity can no longer change (the
--    QC result and finished goods depend on it) — the other fields can. The ledger keeps the original line and gets a CORRECTION line.

-- ============================================================ 1. skip unticked processes
create or replace function _skip_unneeded_stages(p_product text) returns int
language plpgsql security definer set search_path = public as $$
declare
  prod products;
  r    record;
  v_n  int := 0;
begin
  select * into prod from products where id = p_product;
  if not found then return 0; end if;
  for r in
    select s.job_no, s.stage
      from stage_records s join jobs j on j.job_no = s.job_no
     where j.product_id = p_product and s.status = 'Pending'
       and not exists (select 1 from job_work w where w.job_no = s.job_no)
       and (   (s.stage = 'forging'       and not coalesce(prod.do_forging, true))
            or (s.stage = 'trimming'      and not coalesce(prod.do_trimming, true))
            or (s.stage = 'heatTreatment' and not coalesce(prod.do_heat_treatment, true))
            or (s.stage = 'cnc'           and not coalesce(prod.do_cnc, true))
            or (s.stage = 'vmc'           and not coalesce(prod.do_vmc, true)))
  loop
    begin
      perform complete_stage(r.stage, r.job_no, 0, null, null, null, 'Not required — skipped', jsonb_build_object('skipped', 1, 'auto', 1), now());
      v_n := v_n + 1;
    exception when others then
      raise notice '% was not moved past % (%).', r.job_no, r.stage, sqlerrm;    -- the product is still saved; the job waits as before
    end;
  end loop;
  return v_n;
end $$;
revoke all on function _skip_unneeded_stages(text) from public, anon, authenticated;

create or replace function trg_products_flow_skip() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if    (coalesce(old.do_forging, true)        and not coalesce(new.do_forging, true))
     or (coalesce(old.do_trimming, true)       and not coalesce(new.do_trimming, true))
     or (coalesce(old.do_heat_treatment, true) and not coalesce(new.do_heat_treatment, true))
     or (coalesce(old.do_cnc, true)            and not coalesce(new.do_cnc, true))
     or (coalesce(old.do_vmc, true)            and not coalesce(new.do_vmc, true)) then
    perform _skip_unneeded_stages(new.id);
  end if;
  return null;
end $$;
drop trigger if exists products_flow_skip on products;
create trigger products_flow_skip after update of do_forging, do_trimming, do_heat_treatment, do_cnc, do_vmc on products
  for each row execute function trg_products_flow_skip();

-- ============================================================ 2. correct a completed stage
create or replace function edit_stage(
  p_stage     process_stage,
  p_job_no    text,
  p_loss      int,
  p_input_qty int   default null,              -- Cutting only: the total cut (OK + rejection)
  p_operator  text  default null,              -- Checked By
  p_params    jsonb default '{}'::jsonb,       -- manpower, T1–T4 … (a key sent as null clears it)
  p_ts        timestamptz default null         -- the corrected date of the entry
) returns void
language plpgsql security definer set search_path = public as $$
declare
  rec       stage_records;
  d         stage_records;
  q         qc_records;
  v_order   text[] := array['cutting', 'forging', 'trimming', 'heatTreatment', 'cnc', 'vmc'];
  v_label   text := stage_label(p_stage::text);
  v_input   int;
  v_loss    int;
  v_out     int;
  v_delta   int;
  v_waiting boolean := false;
  v_next    text := 'QC';
begin
  perform _require_user();
  perform _require_write(case p_stage when 'cutting' then 'cutting' when 'forging' then 'forging' when 'trimming' then 'trimming'
                                      when 'cnc' then 'cnc' when 'vmc' then 'vmc' else 'heat_treatment' end);
  select * into rec from stage_records where job_no = p_job_no and stage = p_stage for update;
  if not found or rec.status <> 'Completed' then raise exception '% has no finished % entry to correct.', p_job_no, v_label; end if;
  if rec.params ? 'skipped' then raise exception '% was skipped for %, so there is nothing to correct.', v_label, p_job_no; end if;
  if rec.output_qty = 0 then raise exception 'The whole % batch of % was rejected; it cannot be corrected here.', v_label, p_job_no; end if;

  v_loss  := _assert_qty(p_loss, 'Rejection', true);
  v_input := case when p_stage = 'cutting' and p_input_qty is not null then _assert_qty(p_input_qty, 'Total cut') else rec.input_qty end;
  if v_loss > v_input then raise exception 'Rejection (%) cannot be more than the quantity received (%).', v_loss, v_input; end if;
  v_out := v_input - v_loss;
  if v_out = 0 then raise exception 'The OK quantity cannot become 0 by a correction — enter at least 1 OK piece.'; end if;
  v_delta := v_out - rec.output_qty;

  -- the corrected OK quantity is passed on down the line
  if v_delta <> 0 then
    for d in
      select * from stage_records
       where job_no = p_job_no and array_position(v_order, stage::text) > array_position(v_order, p_stage::text)
       order by array_position(v_order, stage::text)
       for update
    loop
      if v_next = 'QC' and not d.params ? 'skipped' then v_next := stage_label(d.stage::text); end if;
      if d.status = 'Completed' then
        if d.input_qty + v_delta < d.loss_qty or d.output_qty + v_delta <= 0 then
          raise exception '% at % would have % PCS left after its rejection of % — correct % first.', p_job_no, stage_label(d.stage::text),
            d.input_qty + v_delta - d.loss_qty, d.loss_qty, stage_label(d.stage::text);
        end if;
        update stage_records set input_qty = input_qty + v_delta, output_qty = output_qty + v_delta where id = d.id;
      else
        if d.input_qty + v_delta <= 0 then raise exception '% at % would receive no pieces.', p_job_no, stage_label(d.stage::text); end if;
        update stage_records set input_qty = input_qty + v_delta where id = d.id;
        v_waiting := true;
        exit;                                   -- nothing after a stage that has not finished has received anything yet
      end if;
    end loop;
    if not v_waiting then
      select * into q from qc_records where job_no = p_job_no for update;
      if found then
        if q.status <> 'QC Pending' then
          raise exception '% has already been inspected at QC, so its quantity can no longer change. Correct the rejection through QC instead.', p_job_no;
        end if;
        if q.input_qty + v_delta <= 0 then raise exception '% would send no pieces to QC.', p_job_no; end if;
        update qc_records set input_qty = input_qty + v_delta where id = q.id;
      end if;
    end if;
  end if;

  update stage_records
     set input_qty    = v_input,
         loss_qty     = v_loss,
         output_qty   = v_out,
         operator     = coalesce(p_operator, operator),
         params       = jsonb_strip_nulls(params || coalesce(p_params, '{}'::jsonb)),
         completed_at = coalesce(p_ts, completed_at)
   where id = rec.id;

  if v_delta <> 0 or v_loss <> rec.loss_qty then
    perform _ledger_entry(now(), p_job_no,
      case when v_delta >= 0 then v_label else v_next end, case when v_delta >= 0 then v_next else v_label end,
      abs(v_delta), abs(v_loss - rec.loss_qty),
      format('Correction at %s: received %s → %s, rejection %s → %s, OK %s → %s', v_label, rec.input_qty, v_input, rec.loss_qty, v_loss, rec.output_qty, v_out),
      'correction');
  end if;
  perform _log(now(), 'complete',
    format('%s %s corrected — OK %s → %s PCS (rejection %s → %s)', p_job_no, v_label, rec.output_qty, v_out, rec.loss_qty, v_loss), p_job_no);
end $$;
revoke all on function edit_stage(process_stage, text, int, int, text, jsonb, timestamptz) from public, anon;
grant execute on function edit_stage(process_stage, text, int, int, text, jsonb, timestamptz) to authenticated;

-- ============================================================ 3. once: jobs waiting today at a process their product does not tick
select coalesce(sum(_skip_unneeded_stages(id)), 0) as jobs_moved_on from products;
