-- ============================================================
-- 83 · CNC and VMC in the job flow (needs 82)
-- ============================================================
-- The job flow is now:  Cutting → Forging → Trimming → Heat Treatment → CNC → VMC → QC → Finished Goods → Dispatch.
-- Heat Treatment completes into CNC, CNC into VMC, VMC into QC (the QC lot is created when VMC completes). Each step receives exactly what
-- the one before produced, can record a loss, and is a normal stage record (start / complete, shown in Workflow Overview, traceability, ledger).
--
-- Product Master → Work to be done gets two new ticks, CNC and VMC. They are ON for every product (so every job flows through them); untick
-- one for a product that does not need it and the step is passed over ("Not required — skipped"), like Trimming / Heat Treatment.
-- Job work batches only do the processes ticked when the parts were received: CNC / VMC are OFF for them unless switched on.
-- Existing jobs: a job already past Heat Treatment (in QC, Finished Goods …) is untouched; a job still before it will flow through CNC / VMC.
-- Needs 26, 51, 54, 73. Safe to run twice.

alter table products  add column if not exists do_cnc boolean not null default true;
alter table products  add column if not exists do_vmc boolean not null default true;
alter table job_work  add column if not exists do_cnc boolean not null default false;
alter table job_work  add column if not exists do_vmc boolean not null default false;

-- do_cnc / do_vmc are appended at the END (create or replace view can only add columns at the end)
create or replace view v_product_flow as
select id, do_forging, do_trimming, do_heat_treatment, hardness_required, hardness_min, hardness_max, hardness_scale, do_cutting, do_cnc, do_vmc
  from products where is_active_user();
grant select on v_product_flow to authenticated;
revoke all on v_product_flow from anon;

CREATE OR REPLACE FUNCTION public.set_product_flow(p_id text, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req boolean := coalesce((p_payload ->> 'hardness_required')::boolean, false);
  v_min numeric := nullif(p_payload ->> 'hardness_min', '')::numeric;
  v_max numeric := nullif(p_payload ->> 'hardness_max', '')::numeric;
  v_c   boolean := coalesce((p_payload ->> 'do_cutting')::boolean, true);
  v_f   boolean := coalesce((p_payload ->> 'do_forging')::boolean, true);
  v_t   boolean := coalesce((p_payload ->> 'do_trimming')::boolean, true);
  v_h   boolean := coalesce((p_payload ->> 'do_heat_treatment')::boolean, true);
  v_cn  boolean := coalesce((p_payload ->> 'do_cnc')::boolean, (select do_cnc from products where id = p_id), true);
  v_vm  boolean := coalesce((p_payload ->> 'do_vmc')::boolean, (select do_vmc from products where id = p_id), true);
begin
  perform _require_user();
  perform _require_write('products');
  if not exists (select 1 from products where id = p_id) then raise exception 'Unknown product %.', p_id; end if;
  if not (v_c or v_f or v_t or v_h) then raise exception 'Tick at least one of Cutting, Forging, Trimming or Heat Treatment for this product.'; end if;
  if v_req and (coalesce(v_min, 0) <= 0 or coalesce(v_max, 0) <= 0) then raise exception 'Enter the required hardness range (both limits).'; end if;
  if v_min is not null and v_max is not null and v_min > v_max then raise exception 'Required hardness: the lower limit cannot be above the upper limit.'; end if;
  update products set
         do_cutting = v_c, do_forging = v_f, do_trimming = v_t, do_heat_treatment = v_h, do_cnc = v_cn, do_vmc = v_vm,
         hardness_required = v_req, hardness_min = v_min, hardness_max = v_max,
         hardness_scale    = coalesce(nullif(p_payload ->> 'hardness_scale', ''), 'HRB')::hardness_scale
   where id = p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.stage_label(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p
    when 'raw'           then 'Raw Inventory'
    when 'cutting'       then 'Cutting'
    when 'forging'       then 'Forging'
    when 'trimming'      then 'Trimming'
    when 'heatTreatment' then 'Heat Treatment'
    when 'cnc'           then 'CNC'
    when 'vmc'           then 'VMC'
    when 'qc'            then 'QC'
    when 'finishedGoods' then 'Finished Goods'
    when 'dispatched'    then 'Dispatch'
    when 'scrapped'      then 'Rejected'
    else p end;
$function$;

CREATE OR REPLACE FUNCTION public.start_stage(p_stage process_stage, p_job_no text, p_input_qty integer DEFAULT NULL::integer, p_machine text DEFAULT NULL::text, p_operator text DEFAULT NULL::text, p_params jsonb DEFAULT '{}'::jsonb, p_ts timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ts  timestamptz := coalesce(p_ts, now());
  rec   stage_records;
  j     jobs;
  v_qty int;
begin
  perform _require_user(); perform _require_plan(p_stage::text, p_job_no, p_params);
  perform _require_write(case p_stage when 'cutting' then 'cutting' when 'forging' then 'forging' when 'trimming' then 'trimming' when 'cnc' then 'cnc' when 'vmc' then 'vmc' else 'heat_treatment' end);
  select * into rec from stage_records where job_no = p_job_no and stage = p_stage and status <> 'Completed' for update;
  if not found then raise exception '% has no open % order.', p_job_no, stage_label(p_stage::text); end if;
  if rec.status <> 'Pending' then raise exception '% is already in progress at %.', p_job_no, stage_label(p_stage::text); end if;
  select * into j from jobs where job_no = p_job_no for update;

  v_qty := rec.input_qty;
  if p_stage = 'cutting' then
    v_qty := _assert_qty(coalesce(p_input_qty, rec.input_qty), 'Actual input quantity');
    -- job work on the CUSTOMER's material does not touch our raw inventory
    if not exists (select 1 from job_work where job_no = p_job_no and material_source = 'customer') then
      perform _issue_material(j, v_qty, v_ts);
    end if;
  end if;

  update stage_records
     set input_qty  = v_qty,
         status     = 'In Progress',
         started_at = v_ts,
         machine    = coalesce(p_machine, machine),
         operator   = coalesce(p_operator, operator),
         params     = params || coalesce(p_params, '{}'::jsonb)
   where id = rec.id;

  perform _log(v_ts, 'start', format('%s %s started — %s PCS', p_job_no, stage_label(p_stage::text), v_qty), p_job_no);
end $function$;

CREATE OR REPLACE FUNCTION public.complete_stage(p_stage process_stage, p_job_no text, p_loss integer, p_input_qty integer DEFAULT NULL::integer, p_machine text DEFAULT NULL::text, p_operator text DEFAULT NULL::text, p_remarks text DEFAULT NULL::text, p_params jsonb DEFAULT '{}'::jsonb, p_ts timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ts     timestamptz := coalesce(p_ts, now());
  rec      stage_records;
  j        jobs;
  prod     products;
  v_loss   int;
  v_input  int;
  v_next   job_stage;
  v_params jsonb;
  v_label  text := stage_label(p_stage::text);
  v_fp     jsonb;
  v_skip_t  boolean;
  v_skip_ht boolean;
  jw       job_work;
  v_pl_f   boolean;
  v_pl_t   boolean;
  v_pl_h   boolean;
  v_pl_c   boolean;
  v_pl_v   boolean;
  v_n      int;
  v_fg     text;
begin
  perform _require_user(); perform _require_plan(p_stage::text, p_job_no, p_params);
  perform _require_write(case p_stage when 'cutting' then 'cutting' when 'forging' then 'forging' when 'trimming' then 'trimming' when 'cnc' then 'cnc' when 'vmc' then 'vmc' else 'heat_treatment' end);
  select * into rec from stage_records where job_no = p_job_no and stage = p_stage and status <> 'Completed' for update;
  if not found then raise exception '% has no open % order.', p_job_no, v_label; end if;

  -- validate before anything is issued or moved
  v_loss  := _assert_qty(p_loss, 'Loss / rejection', true);
  v_input := case when rec.status = 'Pending' and p_stage = 'cutting' then coalesce(p_input_qty, rec.input_qty) else rec.input_qty end;
  if v_loss > v_input then raise exception 'Loss (%) cannot exceed input quantity (%).', v_loss, v_input; end if;

  if rec.status = 'Pending' then
    perform start_stage(p_stage, p_job_no, p_input_qty, p_machine, p_operator, p_params, v_ts);
  end if;

  update stage_records
     set loss_qty     = v_loss,
         output_qty   = input_qty - v_loss,
         status       = 'Completed',
         completed_at = v_ts,
         machine      = coalesce(p_machine, machine),
         operator     = coalesce(p_operator, operator),
         remarks      = coalesce(p_remarks, remarks),
         params       = params || coalesce(p_params, '{}'::jsonb)
   where id = rec.id
  returning * into rec;

  select * into j from jobs where job_no = p_job_no for update;
  select * into prod from products where id = j.product_id;
  v_next := (case p_stage when 'cutting' then 'forging' when 'forging' then 'trimming'
                          when 'trimming' then 'heatTreatment' when 'heatTreatment' then 'cnc' when 'cnc' then 'vmc' else 'qc' end)::job_stage;

  -- whole batch lost ⇒ job is scrapped
  if rec.output_qty = 0 then
    update jobs set current_stage = 'scrapped' where job_no = p_job_no;
    perform _move(v_ts, p_job_no, v_label, 'Rejection', 0, v_loss, 'Entire batch rejected');
    perform _log(v_ts, 'reject', format('%s fully rejected at %s (%s PCS)', p_job_no, v_label, v_loss), p_job_no);
    return;
  end if;

  -- Skip Trimming / Skip Heat Treatment are chosen in the FORGING form (stored with the forging record). A skipped stage is written
  -- down as "not required" and passed over: the batch goes straight to the next stage that applies.
  select params into v_fp from stage_records where job_no = p_job_no and stage = 'forging';
  v_skip_t  := coalesce((v_fp ->> 'skipTrimming')::boolean, false);
  v_skip_ht := coalesce((v_fp ->> 'skipHeatTreatment')::boolean, false);
  -- a JOB-WORK batch only does the processes that were ticked when the parts were received
  select * into jw from job_work where job_no = p_job_no;
  v_pl_f := coalesce(jw.do_forging, prod.do_forging, true);
  v_pl_t := coalesce(jw.do_trimming, prod.do_trimming, true) and not v_skip_t;
  v_pl_h := coalesce(jw.do_heat_treatment, prod.do_heat_treatment, true) and not v_skip_ht;
  v_pl_c := coalesce(jw.do_cnc, prod.do_cnc, true);
  v_pl_v := coalesce(jw.do_vmc, prod.do_vmc, true);
  loop
    if (v_next = 'forging' and not v_pl_f) or (v_next = 'trimming' and not v_pl_t) or (v_next = 'heatTreatment' and not v_pl_h)
       or (v_next = 'cnc' and not v_pl_c) or (v_next = 'vmc' and not v_pl_v) then
      insert into stage_records (job_no, stage, input_qty, loss_qty, output_qty, status, received_at, started_at, completed_at, remarks, params)
      values (p_job_no, v_next::text::process_stage, rec.output_qty, 0, rec.output_qty, 'Completed', v_ts, v_ts, v_ts, 'Not required — skipped',
              jsonb_build_object('skipped', 1, 'auto', 1));
      v_next := (case v_next when 'forging' then 'trimming' when 'trimming' then 'heatTreatment' when 'heatTreatment' then 'cnc' when 'cnc' then 'vmc' else 'qc' end)::job_stage;
    else
      exit;
    end if;
  end loop;

  perform _move(v_ts, p_job_no, v_label, stage_label(v_next::text), rec.output_qty, v_loss);
  perform _log(v_ts, 'complete',
    format('%s %s completed — %s in, %s loss, %s PCS moved to %s', p_job_no, v_label, rec.input_qty, v_loss, rec.output_qty, stage_label(v_next::text)),
    p_job_no);
  update jobs set current_stage = v_next where job_no = p_job_no;

  if v_next = 'qc' then
    if coalesce(jw.qc_required, true) then
      insert into qc_records (job_no, input_qty, status, received_at) values (p_job_no, rec.output_qty, 'QC Pending', v_ts);
      return;
    end if;
    -- QC switched off for this job-work batch: everything that came out goes straight to the customer's parts store
    insert into qc_records (job_no, input_qty, accepted_qty, rejected_qty, status, received_at, inspected_at, remarks)
    values (p_job_no, rec.output_qty, rec.output_qty, 0, 'Approved', v_ts, v_ts, 'QC not required for this job-work batch');
    v_n  := next_doc_no('fg', _year(v_ts));
    v_fg := format('FG-%s-%s', _year(v_ts), lpad(v_n::text, 4, '0'));
    insert into finished_goods (id, job_no, product_id, qty, received_at, location)
    values (v_fg, p_job_no, prod.id, rec.output_qty, v_ts, 'Customer parts · job work');
    update jobs set current_stage = 'finishedGoods' where job_no = p_job_no;
    perform _move(v_ts, p_job_no, 'QC', 'Finished Goods', rec.output_qty, 0, 'QC not required');
    perform _log(v_ts, 'fg', format('%s PCS %s ready to return to the customer (job work) — %s', rec.output_qty, prod.name, v_fg), p_job_no);
    return;
  end if;

  v_params := case v_next
    when 'forging'       then jsonb_build_object('dieNo', coalesce(nullif(j.die_no, ''), prod.die_no))
    when 'trimming'      then jsonb_build_object('trimDie', replace(prod.die_no, 'D-', 'T-'))
    when 'heatTreatment' then jsonb_build_object('temperature', prod.ht_temperature, 'soakMinutes', prod.ht_soak_minutes,
                                                 'process', prod.ht_process, 'quench', prod.ht_quench)
    else '{}'::jsonb end;

  -- next stage receives exactly what this stage produced
  insert into stage_records (job_no, stage, input_qty, status, received_at, params)
  values (p_job_no, v_next::text::process_stage, rec.output_qty, 'Pending', v_ts, v_params);
end $function$;

-- the job summary knows the two new stages (their quantity, status and position in the flow; QC / Finished Goods / Dispatch move down two places)
create or replace view v_job_summary as
SELECT j.job_no,
    j.product_id,
    p.code AS product_code,
    p.name AS product_name,
    mask_text(j.customer, 'party_names'::text) AS customer,
    j.priority,
    j.due_date,
    j.current_stage,
    j.planned_qty,
    j.created_at,
    (COALESCE(iss.qty, (0)::bigint))::integer AS issued_qty,
    COALESCE(iss.weight, (0)::numeric) AS issued_weight,
    (COALESCE(pl.loss, (0)::bigint))::integer AS process_loss,
    COALESCE(
        CASE
            WHEN (q.status <> 'QC Pending'::qc_status) THEN q.rejected_qty
            ELSE NULL::integer
        END, 0) AS qc_rejected,
    ((COALESCE(pl.loss, (0)::bigint))::integer + COALESCE(
        CASE
            WHEN (q.status <> 'QC Pending'::qc_status) THEN q.rejected_qty
            ELSE NULL::integer
        END, 0)) AS total_loss,
    (COALESCE(fg.dispatched, (0)::bigint))::integer AS dispatched_qty,
    (COALESCE(fg.available, (0)::bigint))::integer AS fg_available_qty,
        CASE j.current_stage
            WHEN 'cutting'::job_stage THEN (cs.input_qty)::bigint
            WHEN 'forging'::job_stage THEN (cs.input_qty)::bigint
            WHEN 'trimming'::job_stage THEN (cs.input_qty)::bigint
            WHEN 'heatTreatment'::job_stage THEN (cs.input_qty)::bigint
            WHEN 'cnc'::job_stage THEN (cs.input_qty)::bigint
            WHEN 'vmc'::job_stage THEN (cs.input_qty)::bigint
            WHEN 'qc'::job_stage THEN (q.input_qty)::bigint
            WHEN 'finishedGoods'::job_stage THEN COALESCE(fg.remaining, (0)::bigint)
            WHEN 'dispatched'::job_stage THEN COALESCE(fg.dispatched, (0)::bigint)
            ELSE (0)::bigint
        END AS current_qty,
        CASE j.current_stage
            WHEN 'cutting'::job_stage THEN
            CASE cs.status
                WHEN 'In Progress'::stage_status THEN 'In Progress'::text
                ELSE 'Pending'::text
            END
            WHEN 'forging'::job_stage THEN
            CASE cs.status
                WHEN 'In Progress'::stage_status THEN 'In Progress'::text
                ELSE 'Pending'::text
            END
            WHEN 'trimming'::job_stage THEN
            CASE cs.status
                WHEN 'In Progress'::stage_status THEN 'In Progress'::text
                ELSE 'Pending'::text
            END
            WHEN 'heatTreatment'::job_stage THEN
            CASE cs.status
                WHEN 'In Progress'::stage_status THEN 'In Progress'::text
                ELSE 'Pending'::text
            END
            WHEN 'cnc'::job_stage THEN
            CASE cs.status
                WHEN 'In Progress'::stage_status THEN 'In Progress'::text
                ELSE 'Pending'::text
            END
            WHEN 'vmc'::job_stage THEN
            CASE cs.status
                WHEN 'In Progress'::stage_status THEN 'In Progress'::text
                ELSE 'Pending'::text
            END
            WHEN 'qc'::job_stage THEN 'QC Pending'::text
            WHEN 'finishedGoods'::job_stage THEN 'Ready for Dispatch'::text
            WHEN 'dispatched'::job_stage THEN 'Dispatched'::text
            ELSE 'Rejected'::text
        END AS status,
        CASE j.current_stage
            WHEN 'cutting'::job_stage THEN 1
            WHEN 'forging'::job_stage THEN 2
            WHEN 'trimming'::job_stage THEN 3
            WHEN 'heatTreatment'::job_stage THEN 4
            WHEN 'cnc'::job_stage THEN 5
            WHEN 'vmc'::job_stage THEN 6
            WHEN 'qc'::job_stage THEN 7
            WHEN 'finishedGoods'::job_stage THEN 8
            WHEN 'dispatched'::job_stage THEN 9
            ELSE '-1'::integer
        END AS flow_index,
        CASE
            WHEN ((q.id IS NOT NULL) AND (q.status <> 'QC Pending'::qc_status) AND (COALESCE(iss.qty, (0)::bigint) > 0)) THEN round((((COALESCE(fg.total, (0)::bigint))::numeric / (iss.qty)::numeric) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS yield_pct
   FROM ((((((jobs j
     JOIN products p ON ((p.id = j.product_id)))
     LEFT JOIN qc_records q ON ((q.job_no = j.job_no)))
     LEFT JOIN LATERAL ( SELECT sum(i.qty) AS qty,
            sum(i.weight) AS weight
           FROM job_material_issues i
          WHERE (i.job_no = j.job_no)) iss ON (true))
     LEFT JOIN LATERAL ( SELECT sum(s.loss_qty) AS loss
           FROM stage_records s
          WHERE ((s.job_no = j.job_no) AND (s.status = 'Completed'::stage_status))) pl ON (true))
     LEFT JOIN LATERAL ( SELECT sum(f.qty) AS total,
            sum(f.dispatched_qty) AS dispatched,
            sum(((f.qty - f.reserved_qty) - f.dispatched_qty)) AS available,
            sum((f.qty - f.dispatched_qty)) AS remaining
           FROM finished_goods f
          WHERE (f.job_no = j.job_no)) fg ON (true))
     LEFT JOIN LATERAL ( SELECT s.input_qty,
            s.status
           FROM stage_records s
          WHERE ((s.job_no = j.job_no) AND ((s.stage)::text = (j.current_stage)::text))
          ORDER BY s.id DESC
         LIMIT 1) cs ON (true))
  WHERE is_active_user();
grant select on v_job_summary to authenticated;
revoke all on v_job_summary from anon;
