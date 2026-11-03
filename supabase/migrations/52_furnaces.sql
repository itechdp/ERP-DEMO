-- ============================================================
-- 52 · Furnaces — how many furnaces the plant has, which batch is in which furnace, and for how long
-- ============================================================
--  · furnaces       the plant's furnaces (name, active)
--  · furnace_loads  one row per batch loaded: furnace, job, shift (AM / PM), cycle no., start time and duration. A furnace holds ONE batch
--                   at a time: it is busy until the timer ends or the load is released by hand (or Heat Treatment is completed).
--  · When at least one active furnace exists, Heat Treatment cannot start on a batch until a furnace has been assigned to it.
--    A batch with no free furnace is "on hold" (the page shows when the next furnace frees up).
-- Needs 50 (_require_plan, _plan_cleanup). Safe to run twice.

create table if not exists furnaces (
  id         bigint generated always as identity primary key,
  name       text not null unique check (btrim(name) <> ''),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists furnace_loads (
  id               bigint generated always as identity primary key,
  furnace_id       bigint not null references furnaces (id) on delete restrict,
  job_no           text not null references jobs (job_no) on delete cascade,
  shift            text not null default '' check (shift in ('', 'AM', 'PM')),
  cycle_no         text not null default '',
  started_at       timestamptz not null default now(),
  duration_minutes int  not null check (duration_minutes > 0),
  ends_at          timestamptz not null,
  released_at      timestamptz,
  loaded_by        text not null default ''
);
create unique index if not exists furnace_loads_one_open_per_furnace on furnace_loads (furnace_id) where released_at is null;
create unique index if not exists furnace_loads_one_open_per_job on furnace_loads (job_no) where released_at is null;
alter table furnaces enable row level security;
alter table furnace_loads enable row level security;
revoke all on furnaces, furnace_loads from anon, authenticated;

create or replace view v_furnaces as select id, name, active from furnaces where is_active_user();
create or replace view v_furnace_loads as
select id, furnace_id, job_no, shift, cycle_no, started_at, duration_minutes, ends_at, released_at, loaded_by from furnace_loads where is_active_user();
grant select on v_furnaces, v_furnace_loads to authenticated;
revoke all on v_furnaces, v_furnace_loads from anon;

-- the page in Access Control
insert into app_resources (key, label, section, sort, writable) values ('furnaces', 'Furnace Management', 'Workflow', 106, true)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;
insert into role_page_access (role, resource, level)
  select r, 'furnaces', case when r = 'plant_head' then 'write' else 'read' end
    from unnest(array['plant_head', 'accounts', 'qc', 'operator', 'viewer']::app_role[]) r
on conflict (role, resource) do nothing;

-- ---------------------------------------------------------------- the furnace list
create or replace function save_furnace(p_id bigint, p_name text, p_active boolean) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_id bigint := p_id;
begin
  perform _require_user();
  perform _require_write('furnaces');
  if v_name = '' then raise exception 'Enter the furnace name.'; end if;
  if exists (select 1 from furnaces where lower(name) = lower(v_name) and id is distinct from p_id) then raise exception 'The furnace "%" already exists.', v_name; end if;
  if v_id is null then insert into furnaces (name, active) values (v_name, coalesce(p_active, true)) returning id into v_id;
  else
    update furnaces set name = v_name, active = coalesce(p_active, true) where id = v_id;
    if not found then raise exception 'That furnace no longer exists.'; end if;
  end if;
  return v_id;
end $$;

create or replace function delete_furnace(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('furnaces');
  if exists (select 1 from furnace_loads where furnace_id = p_id) then raise exception 'This furnace has been used, so it cannot be deleted. Switch it off instead.'; end if;
  delete from furnaces where id = p_id;
end $$;

-- ---------------------------------------------------------------- load a batch / release a furnace
create or replace function assign_furnace(p_job_no text, p_furnace_id bigint, p_shift text, p_minutes int, p_cycle_no text, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform _require_user();
  perform _require_write('furnaces');
  if not exists (select 1 from furnaces where id = p_furnace_id and active) then raise exception 'That furnace is switched off or does not exist.'; end if;
  if not exists (select 1 from stage_records where job_no = p_job_no and stage = 'heatTreatment' and status <> 'Completed') then
    raise exception '% has no open Heat Treatment order — its pieces have not reached Heat Treatment yet.', p_job_no;
  end if;
  if not (coalesce(p_minutes, 0) > 0) then raise exception 'Enter how long the furnace is set for.'; end if;
  -- free any load whose timer has run out, so the furnace can be used again
  update furnace_loads set released_at = now() where released_at is null and ends_at <= now() and furnace_id = p_furnace_id;
  if exists (select 1 from furnace_loads where furnace_id = p_furnace_id and released_at is null) then raise exception 'That furnace is still running another batch.'; end if;
  update furnace_loads set released_at = now() where job_no = p_job_no and released_at is null;       -- moving the batch to another furnace
  insert into furnace_loads (furnace_id, job_no, shift, cycle_no, started_at, duration_minutes, ends_at, loaded_by)
  values (p_furnace_id, p_job_no, coalesce(p_shift, ''), btrim(coalesce(p_cycle_no, '')), now(), p_minutes, now() + make_interval(mins => p_minutes), coalesce(p_user, ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function release_furnace_load(p_load_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('furnaces');
  update furnace_loads set released_at = now() where id = p_load_id and released_at is null;
end $$;

revoke all on function save_furnace(bigint, text, boolean), delete_furnace(bigint), assign_furnace(text, bigint, text, int, text, text), release_furnace_load(bigint) from public, anon;
grant execute on function save_furnace(bigint, text, boolean), delete_furnace(bigint), assign_furnace(text, bigint, text, int, text, text), release_furnace_load(bigint) to authenticated;

-- ---------------------------------------------------------------- Heat Treatment also needs a furnace (when furnaces exist)
create or replace function _require_plan(p_stage text, p_job_no text, p_params jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if _is_system() then return; end if;
  if p_stage <> 'heatTreatment' then return; end if;                                        -- only Heat Treatment is gated
  if coalesce(p_params, '{}'::jsonb) ? 'skipped' then return; end if;                       -- only skipping the process: nothing to approve
  if not exists (select 1 from stage_records where job_no = p_job_no and stage = 'heatTreatment' and status = 'Pending') then return; end if;   -- already started or done
  if coalesce((select enforce from production_settings where id = 1), true)
     and not exists (select 1 from production_plan where job_no = p_job_no and stage = 'heatTreatment') then
    raise exception '% is not approved to start Heat Treatment yet. Heat Treatment Planning must approve it first.', p_job_no;
  end if;
  if exists (select 1 from furnaces where active)
     and not exists (select 1 from furnace_loads where job_no = p_job_no and released_at is null) then
    raise exception '% has no furnace yet. Assign a furnace in Heat Treatment Planning first (the batch is on hold until one is free).', p_job_no;
  end if;
end $$;
revoke all on function _require_plan(text, text, jsonb) from public, anon, authenticated;

-- when Heat Treatment is completed the furnace is free again
create or replace function _plan_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Completed' then
    delete from production_plan where job_no = new.job_no and stage = new.stage;
    if new.stage = 'heatTreatment' then update furnace_loads set released_at = now() where job_no = new.job_no and released_at is null; end if;
  end if;
  return new;
end $$;
