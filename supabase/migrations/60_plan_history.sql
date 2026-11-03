-- ============================================================
-- 60 · Keep the Heat Treatment approval after the process is done (so the job's trace can show it)
-- ============================================================
--  · until now a Heat Treatment approval was deleted when the process finished; it is now kept and marked done_at
--  · v_production_plan still shows only OPEN approvals (the planning page and the block are unchanged);
--    v_production_plan_history shows all of them, for the job trace
-- Needs 50 and 52. Safe to run twice.

alter table production_plan add column if not exists done_at timestamptz;

create or replace view v_production_plan as
select job_no, stage, rank, note, approved_by, approved_at from production_plan where is_active_user() and done_at is null;
create or replace view v_production_plan_history as
select job_no, stage, rank, note, approved_by, approved_at, done_at from production_plan where is_active_user();
grant select on v_production_plan, v_production_plan_history to authenticated;
revoke all on v_production_plan, v_production_plan_history from anon;

-- an approval is re-opened if the same process is approved again
create or replace function approve_production_plan(p_items jsonb, p_user text) returns int
language plpgsql security definer set search_path = public as $$
declare
  x jsonb;
  n int := 0;
begin
  perform _require_user();
  perform _require_write('production_planning');
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Select at least one process to approve.'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    if not (coalesce(nullif(x ->> 'rank', '')::int, 0) > 0) then raise exception 'Give every process a rank of 1 or more.'; end if;
    if x ->> 'stage' <> 'heatTreatment' then raise exception 'Only Heat Treatment is planned here.'; end if;
    if not exists (select 1 from stage_records where job_no = x ->> 'job_no' and stage = (x ->> 'stage')::process_stage and status <> 'Completed') then
      raise exception '% has no open % order to approve.', x ->> 'job_no', stage_label(x ->> 'stage');
    end if;
    insert into production_plan (job_no, stage, rank, note, approved_by, approved_at, done_at)
    values (x ->> 'job_no', (x ->> 'stage')::process_stage, (x ->> 'rank')::int, btrim(coalesce(x ->> 'note', '')), coalesce(p_user, ''), now(), null)
    on conflict (job_no, stage) do update set rank = excluded.rank, note = excluded.note, approved_by = excluded.approved_by, approved_at = now(), done_at = null;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function withdraw_production_plan(p_job_no text, p_stage text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('production_planning');
  if exists (select 1 from stage_records where job_no = p_job_no and stage = p_stage::process_stage and status = 'In Progress') then
    raise exception '% is already in progress at %, so its approval cannot be withdrawn.', p_job_no, stage_label(p_stage);
  end if;
  delete from production_plan where job_no = p_job_no and stage = p_stage::process_stage and done_at is null;
end $$;

-- the block: only an OPEN approval counts
create or replace function _require_plan(p_stage text, p_job_no text, p_params jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if _is_system() then return; end if;
  if p_stage <> 'heatTreatment' then return; end if;                                        -- only Heat Treatment is gated
  if coalesce(p_params, '{}'::jsonb) ? 'skipped' then return; end if;                       -- only skipping the process: nothing to approve
  if not exists (select 1 from stage_records where job_no = p_job_no and stage = 'heatTreatment' and status = 'Pending') then return; end if;   -- already started or done
  if coalesce((select enforce from production_settings where id = 1), true)
     and not exists (select 1 from production_plan where job_no = p_job_no and stage = 'heatTreatment' and done_at is null) then
    raise exception '% is not approved to start Heat Treatment yet. Heat Treatment Planning must approve it first.', p_job_no;
  end if;
  if exists (select 1 from furnaces where active)
     and not exists (select 1 from furnace_loads where job_no = p_job_no and released_at is null) then
    raise exception '% has no furnace yet. Assign a furnace in Heat Treatment Planning first (the batch is on hold until one is free).', p_job_no;
  end if;
end $$;
revoke all on function _require_plan(text, text, jsonb) from public, anon, authenticated;

-- when a process is completed: its approval is marked done (kept for the trace) and, for Heat Treatment, the furnace is free again
create or replace function _plan_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Completed' then
    update production_plan set done_at = now() where job_no = new.job_no and stage = new.stage and done_at is null;
    if new.stage = 'heatTreatment' then update furnace_loads set released_at = now() where job_no = new.job_no and released_at is null; end if;
  end if;
  return new;
end $$;
