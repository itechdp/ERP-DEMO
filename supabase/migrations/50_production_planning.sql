-- helper (same as in 37): replace text inside the CURRENT definition of every function with this name
create or replace function _patch_fn(p_name text, p_from text, p_to text) returns void
language plpgsql as $$
declare
  r      record;
  d      text;
  v_hit  boolean := false;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = p_name loop
    d := pg_get_functiondef(r.oid);
    if position(p_to in d) > 0 then v_hit := true; continue; end if;     -- already patched
    if position(p_from in d) = 0 then continue; end if;
    execute replace(d, p_from, p_to);
    v_hit := true;
  end loop;
  if not v_hit then raise exception 'Could not patch function % (text not found).', p_name; end if;
end $$;

-- ============================================================
-- 50 · Heat Treatment Planning — the planner approves which batch goes into heat treatment next, and in which order (rank 1, 2, 3 …)
-- ============================================================
--  · production_plan      one row per job approved for HEAT TREATMENT, with its rank, who approved and when (other processes are not gated)
--  · production_settings  one switch: "heat treatment cannot start until the batch is approved" (on by default)
--  · start_stage / complete_stage refuse to start Heat Treatment on a batch that is not approved while the switch is on
--    (Cutting, Forging and Trimming are never blocked; skipping Heat Treatment is never blocked; the SQL editor / system calls are never blocked)
--  · who may approve = Write on the page "Production Planning" (Access Control); everybody else can only see the order
-- Needs 18 and 26 (it defines the _patch_fn helper itself). Safe to run twice.

create table if not exists production_plan (
  job_no      text not null references jobs (job_no) on delete cascade,
  stage       process_stage not null,
  rank        int  not null check (rank > 0),
  note        text not null default '',
  approved_by text not null default '',
  approved_at timestamptz not null default now(),
  primary key (job_no, stage)
);
alter table production_plan enable row level security;
revoke all on production_plan from anon, authenticated;

create table if not exists production_settings (
  id      int primary key default 1 check (id = 1),
  enforce boolean not null default true
);
insert into production_settings (id, enforce) values (1, true) on conflict (id) do nothing;
alter table production_settings enable row level security;
revoke all on production_settings from anon, authenticated;

create or replace view v_production_plan as
select job_no, stage, rank, note, approved_by, approved_at from production_plan where is_active_user();
create or replace view v_production_settings as
select enforce from production_settings where id = 1 and is_active_user();
grant select on v_production_plan, v_production_settings to authenticated;
revoke all on v_production_plan, v_production_settings from anon;

-- (if an earlier version of this file was run: only heat treatment is planned, so drop approvals of the other processes)
delete from production_plan where stage <> 'heatTreatment';

-- the page in Access Control
insert into app_resources (key, label, section, sort, writable) values ('production_planning', 'Heat Treatment Planning', 'Workflow', 105, true)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;
insert into role_page_access (role, resource, level)
  select r, 'production_planning', case when r in ('plant_head') then 'write' else 'read' end
    from unnest(array['plant_head', 'accounts', 'qc', 'operator', 'viewer']::app_role[]) r
on conflict (role, resource) do nothing;

-- ---------------------------------------------------------------- approve / withdraw
-- p_items = [{job_no, stage, rank, note?}]   (an approved process keeps its place until it is withdrawn or done)
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
    insert into production_plan (job_no, stage, rank, note, approved_by, approved_at)
    values (x ->> 'job_no', (x ->> 'stage')::process_stage, (x ->> 'rank')::int, btrim(coalesce(x ->> 'note', '')), coalesce(p_user, ''), now())
    on conflict (job_no, stage) do update set rank = excluded.rank, note = excluded.note, approved_by = excluded.approved_by, approved_at = now();
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
  delete from production_plan where job_no = p_job_no and stage = p_stage::process_stage;
end $$;

create or replace function set_production_enforcement(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('production_planning');
  update production_settings set enforce = coalesce(p_on, true) where id = 1;
end $$;

revoke all on function approve_production_plan(jsonb, text), withdraw_production_plan(text, text), set_production_enforcement(boolean) from public, anon;
grant execute on function approve_production_plan(jsonb, text), withdraw_production_plan(text, text), set_production_enforcement(boolean) to authenticated;

-- ---------------------------------------------------------------- the block
create or replace function _require_plan(p_stage text, p_job_no text, p_params jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if _is_system() then return; end if;
  if p_stage <> 'heatTreatment' then return; end if;                                        -- only Heat Treatment is gated
  if not coalesce((select enforce from production_settings where id = 1), true) then return; end if;
  if coalesce(p_params, '{}'::jsonb) ? 'skipped' then return; end if;                       -- only skipping a process: nothing to approve
  if not exists (select 1 from stage_records where job_no = p_job_no and stage = p_stage::process_stage and status = 'Pending') then return; end if;   -- already started or done
  if not exists (select 1 from production_plan where job_no = p_job_no and stage = p_stage::process_stage) then
    raise exception '% is not approved to start at % yet. Heat Treatment Planning must approve it (with its rank) first.', p_job_no, stage_label(p_stage);
  end if;
end $$;
revoke all on function _require_plan(text, text, jsonb) from public, anon, authenticated;

-- a finished process no longer needs its approval row
create or replace function _plan_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Completed' then delete from production_plan where job_no = new.job_no and stage = new.stage; end if;
  return new;
end $$;
drop trigger if exists stage_records_plan_cleanup on stage_records;
create trigger stage_records_plan_cleanup after update of status on stage_records for each row execute function _plan_cleanup();

do $$
begin
  perform _patch_fn('start_stage',
    $f$perform _require_user();$f$,
    $f$perform _require_user(); perform _require_plan(p_stage::text, p_job_no, p_params);$f$);
  perform _patch_fn('complete_stage',
    $f$perform _require_user();$f$,
    $f$perform _require_user(); perform _require_plan(p_stage::text, p_job_no, p_params);$f$);
end $$;
