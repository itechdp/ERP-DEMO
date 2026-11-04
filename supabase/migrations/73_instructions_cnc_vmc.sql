-- ============================================================
-- 73 · Instruction, CNC and VMC pages
-- ============================================================
--  · Workflow → Instruction   work instructions: what to do, with which tools and settings, what to check, what to watch out for —
--                             per process and (optionally) per product, with a number, a revision, a date and a status (Draft / Active / Obsolete)
--  · Workflow → Machinery → CNC and VMC
--       - machining_machines  the machines of each kind (name, make / model, controller, axes) and what each one is doing now
--                             (Available / Running / Maintenance / Breakdown)
--       - machining_runs      the log of jobs run on them: part, job card, program number, operator, quantity planned / done, start, end, cycle time
-- Who may change what = Write on the page (Instruction, CNC, VMC); everybody with access to the page may read it.
-- Needs 03 (next_doc_no), 18 (access control), 56 (the three pages are registered). Safe to run twice.

-- ---------------------------------------------------------------- work instructions
create table if not exists work_instructions (
  id             bigint generated always as identity primary key,
  doc_no         text not null unique check (btrim(doc_no) <> ''),
  title          text not null check (btrim(title) <> ''),
  process        text not null default 'General',
  product_id     text references products (id),
  rev_no         text not null default '00',
  effective_date date,
  status         text not null default 'Draft' check (status in ('Draft', 'Active', 'Obsolete')),
  tools          text not null default '',
  steps          text not null default '',
  parameters     jsonb not null default '[]'::jsonb,           -- [{ "name": "Temperature", "value": "550 °C" }, ...]
  checks         text not null default '',
  safety         text not null default '',
  remarks        text not null default '',
  created_by     text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists work_instructions_process_idx on work_instructions (process, status);
create index if not exists work_instructions_product_idx on work_instructions (product_id) where product_id is not null;
alter table work_instructions enable row level security;
revoke all on work_instructions from anon, authenticated;

create or replace view v_work_instructions as
select w.id, w.doc_no, w.title, w.process, w.product_id, p.name as product_name, w.rev_no, w.effective_date, w.status, w.tools, w.steps, w.parameters,
       w.checks, w.safety, w.remarks, w.created_by, w.created_at, w.updated_at
  from work_instructions w left join products p on p.id = w.product_id
 where is_active_user();
grant select on v_work_instructions to authenticated;
revoke all on v_work_instructions from anon;

create or replace function save_work_instruction(p_id bigint, p_payload jsonb, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id   bigint := p_id;
  v_no   text   := btrim(coalesce(p_payload ->> 'doc_no', ''));
  v_stat text   := coalesce(nullif(p_payload ->> 'status', ''), 'Draft');
  v_prod text   := nullif(btrim(coalesce(p_payload ->> 'product_id', '')), '');
  v_n    int;
begin
  perform _require_user();
  perform _require_write('instruction');
  if btrim(coalesce(p_payload ->> 'title', '')) = '' then raise exception 'Enter the title of the instruction.'; end if;
  if v_stat not in ('Draft', 'Active', 'Obsolete') then raise exception 'Unknown status.'; end if;
  if v_prod is not null and not exists (select 1 from products where id = v_prod) then raise exception 'That product does not exist.'; end if;
  if v_no = '' then
    v_n := next_doc_no('workinstr', extract(year from current_date)::int);
    v_no := format('WI-%s-%s', extract(year from current_date)::int, lpad(v_n::text, 4, '0'));
  end if;
  if exists (select 1 from work_instructions where lower(doc_no) = lower(v_no) and id is distinct from p_id) then
    raise exception 'The number % already exists. Use a different number.', v_no;
  end if;

  if v_id is null then
    insert into work_instructions (doc_no, title, process, product_id, rev_no, effective_date, status, tools, steps, parameters, checks, safety, remarks, created_by)
    values (v_no, btrim(p_payload ->> 'title'), coalesce(nullif(btrim(p_payload ->> 'process'), ''), 'General'), v_prod, coalesce(nullif(btrim(p_payload ->> 'rev_no'), ''), '00'),
            nullif(p_payload ->> 'effective_date', '')::date, v_stat, btrim(coalesce(p_payload ->> 'tools', '')), coalesce(p_payload ->> 'steps', ''),
            coalesce(p_payload -> 'parameters', '[]'::jsonb), coalesce(p_payload ->> 'checks', ''), coalesce(p_payload ->> 'safety', ''), btrim(coalesce(p_payload ->> 'remarks', '')), coalesce(p_user, ''))
    returning id into v_id;
  else
    update work_instructions set
           doc_no = v_no, title = btrim(p_payload ->> 'title'), process = coalesce(nullif(btrim(p_payload ->> 'process'), ''), 'General'), product_id = v_prod,
           rev_no = coalesce(nullif(btrim(p_payload ->> 'rev_no'), ''), '00'), effective_date = nullif(p_payload ->> 'effective_date', '')::date, status = v_stat,
           tools = btrim(coalesce(p_payload ->> 'tools', '')), steps = coalesce(p_payload ->> 'steps', ''), parameters = coalesce(p_payload -> 'parameters', '[]'::jsonb),
           checks = coalesce(p_payload ->> 'checks', ''), safety = coalesce(p_payload ->> 'safety', ''), remarks = btrim(coalesce(p_payload ->> 'remarks', '')), updated_at = now()
     where id = v_id;
    if not found then raise exception 'That instruction no longer exists.'; end if;
  end if;
  return v_id;
end $$;

create or replace function set_work_instruction_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('instruction');
  if p_status not in ('Draft', 'Active', 'Obsolete') then raise exception 'Unknown status.'; end if;
  update work_instructions set status = p_status, updated_at = now() where id = p_id;
  if not found then raise exception 'That instruction no longer exists.'; end if;
end $$;

create or replace function delete_work_instruction(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('instruction');
  delete from work_instructions where id = p_id;
end $$;

-- ---------------------------------------------------------------- CNC / VMC machines and runs
create table if not exists machining_machines (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('cnc', 'vmc')),
  name       text not null check (btrim(name) <> ''),
  make_model text not null default '',
  controller text not null default '',                          -- e.g. Fanuc 0i, Siemens 828D
  axes       text not null default '',                          -- e.g. 3-axis, 4-axis
  status     text not null default 'Available' check (status in ('Available', 'Running', 'Maintenance', 'Breakdown')),
  notes      text not null default '',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, name)
);
create table if not exists machining_runs (
  id            bigint generated always as identity primary key,
  machine_id    bigint not null references machining_machines (id),
  job_no        text,                                            -- optional: the job card the work belongs to
  part          text not null check (btrim(part) <> ''),
  program_no    text not null default '',
  operator      text not null default '',
  qty_planned   int not null default 0 check (qty_planned >= 0),
  qty_done      int not null default 0 check (qty_done >= 0),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  cycle_sec     numeric(10, 1),                                  -- worked out when the run is finished: seconds per piece
  status        text not null default 'Running' check (status in ('Running', 'Done', 'Stopped')),
  remarks       text not null default '',
  created_by    text not null default ''
);
create index if not exists machining_runs_machine_idx on machining_runs (machine_id, started_at desc);
create index if not exists machining_runs_status_idx on machining_runs (status);
create index if not exists machining_runs_job_idx on machining_runs (job_no) where job_no is not null;
alter table machining_machines enable row level security;
alter table machining_runs enable row level security;
revoke all on machining_machines, machining_runs from anon, authenticated;

create or replace view v_machining_machines as
select m.id, m.kind, m.name, m.make_model, m.controller, m.axes, m.status, m.notes, m.active, m.created_at
  from machining_machines m where is_active_user();
create or replace view v_machining_runs as
select r.id, r.machine_id, m.kind, m.name as machine_name, r.job_no, r.part, r.program_no, r.operator, r.qty_planned, r.qty_done, r.started_at, r.ended_at,
       r.cycle_sec, r.status, r.remarks, r.created_by
  from machining_runs r join machining_machines m on m.id = r.machine_id where is_active_user();
grant select on v_machining_machines, v_machining_runs to authenticated;
revoke all on v_machining_machines, v_machining_runs from anon;

create or replace function _machining_res(p_kind text) returns text
language sql immutable as $$ select case when p_kind = 'cnc' then 'cnc' else 'vmc' end $$;

create or replace function save_machining_machine(p_id bigint, p_payload jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id   bigint := p_id;
  v_kind text   := coalesce(p_payload ->> 'kind', '');
  v_name text   := btrim(coalesce(p_payload ->> 'name', ''));
begin
  perform _require_user();
  if v_kind not in ('cnc', 'vmc') then raise exception 'Unknown machine kind.'; end if;
  perform _require_write(_machining_res(v_kind));
  if v_name = '' then raise exception 'Enter the machine name.'; end if;
  if exists (select 1 from machining_machines where kind = v_kind and lower(name) = lower(v_name) and id is distinct from p_id) then
    raise exception 'A % machine called % already exists.', upper(v_kind), v_name;
  end if;
  if v_id is null then
    insert into machining_machines (kind, name, make_model, controller, axes, notes, active)
    values (v_kind, v_name, btrim(coalesce(p_payload ->> 'make_model', '')), btrim(coalesce(p_payload ->> 'controller', '')), btrim(coalesce(p_payload ->> 'axes', '')),
            btrim(coalesce(p_payload ->> 'notes', '')), coalesce((p_payload ->> 'active')::boolean, true))
    returning id into v_id;
  else
    update machining_machines set name = v_name, make_model = btrim(coalesce(p_payload ->> 'make_model', '')), controller = btrim(coalesce(p_payload ->> 'controller', '')),
           axes = btrim(coalesce(p_payload ->> 'axes', '')), notes = btrim(coalesce(p_payload ->> 'notes', '')), active = coalesce((p_payload ->> 'active')::boolean, true)
     where id = v_id and kind = v_kind;
    if not found then raise exception 'That machine no longer exists.'; end if;
  end if;
  return v_id;
end $$;

-- p_status = Available | Maintenance | Breakdown  (Running is set by starting a run)
create or replace function set_machining_machine_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare m machining_machines;
begin
  perform _require_user();
  select * into m from machining_machines where id = p_id for update;
  if not found then raise exception 'That machine no longer exists.'; end if;
  perform _require_write(_machining_res(m.kind));
  if p_status not in ('Available', 'Maintenance', 'Breakdown') then raise exception 'Choose Available, Maintenance or Breakdown.'; end if;
  if exists (select 1 from machining_runs where machine_id = p_id and status = 'Running') then
    raise exception '% has a job running. Finish the run first.', m.name;
  end if;
  update machining_machines set status = p_status where id = p_id;
end $$;

create or replace function delete_machining_machine(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare m machining_machines;
begin
  perform _require_user();
  select * into m from machining_machines where id = p_id;
  if not found then return; end if;
  perform _require_write(_machining_res(m.kind));
  if exists (select 1 from machining_runs where machine_id = p_id) then
    raise exception '% has runs on record, so it cannot be deleted. Mark it inactive instead.', m.name;
  end if;
  delete from machining_machines where id = p_id;
end $$;

create or replace function start_machining_run(p_payload jsonb, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  m    machining_machines;
  v_id bigint;
  v_job text := nullif(btrim(coalesce(p_payload ->> 'job_no', '')), '');
begin
  perform _require_user();
  select * into m from machining_machines where id = nullif(p_payload ->> 'machine_id', '')::bigint for update;
  if not found then raise exception 'Choose the machine.'; end if;
  perform _require_write(_machining_res(m.kind));
  if not m.active then raise exception '% is inactive.', m.name; end if;
  if m.status <> 'Available' then raise exception '% is % — it must be Available to start a job.', m.name, lower(m.status); end if;
  if btrim(coalesce(p_payload ->> 'part', '')) = '' then raise exception 'Enter the part.'; end if;
  if v_job is not null and not exists (select 1 from jobs where job_no = v_job) then raise exception 'Job card % does not exist.', v_job; end if;
  insert into machining_runs (machine_id, job_no, part, program_no, operator, qty_planned, remarks, created_by)
  values (m.id, v_job, btrim(p_payload ->> 'part'), btrim(coalesce(p_payload ->> 'program_no', '')), btrim(coalesce(p_payload ->> 'operator', '')),
          coalesce(nullif(p_payload ->> 'qty_planned', '')::int, 0), btrim(coalesce(p_payload ->> 'remarks', '')), coalesce(p_user, ''))
  returning id into v_id;
  update machining_machines set status = 'Running' where id = m.id;
  return v_id;
end $$;

-- p_status = Done | Stopped
create or replace function finish_machining_run(p_id bigint, p_qty_done int, p_status text, p_remarks text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r machining_runs;
  m machining_machines;
begin
  perform _require_user();
  select * into r from machining_runs where id = p_id for update;
  if not found then raise exception 'That run no longer exists.'; end if;
  select * into m from machining_machines where id = r.machine_id for update;
  perform _require_write(_machining_res(m.kind));
  if r.status <> 'Running' then raise exception 'That run is already finished.'; end if;
  if p_status not in ('Done', 'Stopped') then raise exception 'Choose Done or Stopped.'; end if;
  if coalesce(p_qty_done, 0) < 0 then raise exception 'The quantity cannot be negative.'; end if;
  update machining_runs set status = p_status, qty_done = coalesce(p_qty_done, 0), ended_at = now(),
         cycle_sec = case when coalesce(p_qty_done, 0) > 0 then round(extract(epoch from (now() - started_at)) / p_qty_done, 1) end,
         remarks = case when btrim(coalesce(p_remarks, '')) <> '' then btrim(p_remarks) else remarks end
   where id = p_id;
  if not exists (select 1 from machining_runs where machine_id = m.id and status = 'Running') then
    update machining_machines set status = 'Available' where id = m.id and status = 'Running';
  end if;
end $$;

create or replace function delete_machining_run(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r machining_runs; m machining_machines;
begin
  perform _require_user();
  select * into r from machining_runs where id = p_id for update;
  if not found then return; end if;
  select * into m from machining_machines where id = r.machine_id for update;
  perform _require_write(_machining_res(m.kind));
  delete from machining_runs where id = p_id;
  if r.status = 'Running' and not exists (select 1 from machining_runs where machine_id = m.id and status = 'Running') then
    update machining_machines set status = 'Available' where id = m.id and status = 'Running';
  end if;
end $$;

revoke all on function save_work_instruction(bigint, jsonb, text), set_work_instruction_status(bigint, text), delete_work_instruction(bigint),
  save_machining_machine(bigint, jsonb), set_machining_machine_status(bigint, text), delete_machining_machine(bigint),
  start_machining_run(jsonb, text), finish_machining_run(bigint, int, text, text), delete_machining_run(bigint) from public, anon;
grant execute on function save_work_instruction(bigint, jsonb, text), set_work_instruction_status(bigint, text), delete_work_instruction(bigint),
  save_machining_machine(bigint, jsonb), set_machining_machine_status(bigint, text), delete_machining_machine(bigint),
  start_machining_run(jsonb, text), finish_machining_run(bigint, int, text, text), delete_machining_run(bigint) to authenticated;
