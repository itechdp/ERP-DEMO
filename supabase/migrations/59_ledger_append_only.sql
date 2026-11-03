-- ============================================================
-- 59 · The quantity ledger becomes APPEND-ONLY, and says who entered each line and when
-- ============================================================
--  · a ledger line can no longer be edited or deleted (a database trigger refuses it)
--  · fixing a quantity adds a CORRECTION line; deleting something adds a REVERSAL line — the original line stays
--  · every line records who entered it and when it was entered (the date typed on the form stays in "ts")
--  · history survives a deleted job: the ledger and the activity log no longer depend on the job card still existing
--  · parts added to / removed from our stock (Product Master) are now in the ledger, and deleting an unstarted job-work batch gives its parts back
-- Needs 8, 10, 24/32 (inward), 25, 26 (job work), 54 (parts stock) — run it AFTER them (and again after re-running 54). Safe to run twice.

-- ---------------------------------------------------------------- 1. the columns
alter table movements
  add column if not exists entered_by text not null default '',
  add column if not exists entered_at timestamptz not null default now(),
  add column if not exists kind       text not null default 'move' check (kind in ('move', 'correction', 'reversal'));
-- lines that already exist: entered when they happened, by an unknown person
update movements set entered_at = ts, entered_by = 'Earlier record' where entered_by = '';

-- history must outlive a deleted job: drop the links from the ledger and the activity log to the job card
do $$
declare c record;
begin
  for c in select conrelid::regclass::text as t, conname from pg_constraint
            where contype = 'f' and confrelid = 'jobs'::regclass and conrelid in ('movements'::regclass, 'activity'::regclass) loop
    execute format('alter table %s drop constraint %I', c.t, c.conname);
  end loop;
end $$;

-- ---------------------------------------------------------------- 2. who entered it
create or replace function _who() returns text
language sql stable as $$
  select coalesce((select nullif(btrim(full_name), '') from profiles where id = auth.uid()), 'System')
$$;

create or replace function _ledger_entry(p_ts timestamptz, p_job text, p_from text, p_to text, p_qty int, p_loss int, p_note text, p_kind text) returns void
language sql as $$
  insert into movements (ts, job_no, from_loc, to_loc, qty, loss, note, kind, entered_by, entered_at)
  values (p_ts, p_job, p_from, p_to, p_qty, p_loss, coalesce(p_note, ''), p_kind, _who(), now());
$$;

create or replace function _move(p_ts timestamptz, p_job text, p_from text, p_to text, p_qty int, p_loss int, p_note text default '') returns void
language sql as $$
  select _ledger_entry(p_ts, p_job, p_from, p_to, p_qty, p_loss, p_note, 'move');
$$;

-- ---------------------------------------------------------------- 3. the lock
-- Nothing may change or remove a ledger line. The two things the app does to an INWARD line are turned into new lines instead:
--   · correcting a lot's quantity (update_inward rewrites its line)  → a signed CORRECTION line; the original stays
--   · deleting an untouched lot (delete_inward removes its line)       → a REVERSAL line; the original stays
-- Everything else is refused.
create or replace function trg_movements_append_only() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('erp.ledger_unlock', true), '') = 'on' then return coalesce(new, old); end if;   -- only for a deliberate repair run in the SQL editor
  if tg_op = 'UPDATE' and old.from_loc = 'Supplier' and old.to_loc = 'Raw Inventory' then
    if new.qty is distinct from old.qty then
      perform _ledger_entry(old.ts, old.job_no, case when new.qty > old.qty then 'Supplier' else 'Raw Inventory' end, case when new.qty > old.qty then 'Raw Inventory' else 'Supplier' end,
                            abs(new.qty - old.qty), 0, format('Correction: %s PCS became %s PCS · %s', old.qty, new.qty, old.note), 'correction');
    end if;
    return null;                     -- the original line is left exactly as it was
  end if;
  if tg_op = 'DELETE' and old.from_loc = 'Supplier' and old.to_loc = 'Raw Inventory' then
    perform _ledger_entry(now(), old.job_no, 'Raw Inventory', 'Supplier', old.qty, 0, format('Reversal: deleted · %s', old.note), 'reversal');
    return null;
  end if;
  raise exception 'The quantity ledger cannot be changed or deleted — a correction adds a new line instead.' using errcode = '42501';
end $$;
drop trigger if exists movements_append_only on movements;
create trigger movements_append_only before update or delete on movements for each row execute function trg_movements_append_only();

-- ---------------------------------------------------------------- 4. deletes add lines instead of removing them
-- a job card that never started: its ledger lines stay, and the parts it took go back with a reversal line
create or replace function delete_job(p_job_no text, p_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare
  j       jobs;
  v_parts int;
  v_stage text;
begin
  perform _require_user();
  perform _require_write('cutting');
  select * into j from jobs where job_no = p_job_no for update;
  if not found then raise exception 'Job card % does not exist.', p_job_no; end if;
  if exists (select 1 from job_material_issues where job_no = p_job_no)
     or exists (select 1 from stage_records where job_no = p_job_no and status <> 'Pending' and coalesce(params ->> 'auto', '') <> '1')
     or (select count(*) from stage_records where job_no = p_job_no and status = 'Pending') <> 1
     or exists (select 1 from qc_records where job_no = p_job_no)
     or exists (select 1 from hardness_reports where job_no = p_job_no) then
    raise exception 'Job card % cannot be deleted — it has already started in production.', p_job_no;
  end if;
  select coalesce(sum(qty), 0) into v_parts from job_semi_issues where job_no = p_job_no;
  if v_parts > 0 then
    select stage_label(stage::text) into v_stage from stage_records where job_no = p_job_no and status = 'Pending' limit 1;
    update semi_stock_lots l set available_qty = l.available_qty + i.qty from job_semi_issues i where i.lot_id = l.id and i.job_no = p_job_no;
    delete from job_semi_issues where job_no = p_job_no;
    perform _ledger_entry(coalesce(p_ts, now()), p_job_no, coalesce(v_stage, 'Process'), 'Parts stock', v_parts, 0, format('Reversal: job card %s deleted — parts returned to stock', p_job_no), 'reversal');
  end if;
  delete from stage_records where job_no = p_job_no;
  delete from jobs where job_no = p_job_no;
  perform _log(coalesce(p_ts, now()), 'job', format('Job card %s deleted before production started', p_job_no));
end $$;

-- the same for a job-work batch (and the parts it took from our stock are now given back too)
create or replace function delete_job_work(p_job_no text, p_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare
  w       job_work;
  v_parts int;
  v_stage text;
begin
  perform _require_user();
  perform _require_write('job_work');
  select * into w from job_work where job_no = p_job_no;
  if not found then raise exception 'Job-work batch % does not exist.', p_job_no; end if;
  if exists (select 1 from job_material_issues where job_no = p_job_no)
     or exists (select 1 from stage_records where job_no = p_job_no and status <> 'Pending' and coalesce(params ->> 'auto', '') <> '1')
     or exists (select 1 from qc_records where job_no = p_job_no)
     or exists (select 1 from finished_goods where job_no = p_job_no)
     or exists (select 1 from hardness_reports where job_no = p_job_no) then
    raise exception 'Job-work batch % cannot be deleted — work on it has already started.', p_job_no;
  end if;
  select stage_label(stage::text) into v_stage from stage_records where job_no = p_job_no and status = 'Pending' limit 1;
  select coalesce(sum(qty), 0) into v_parts from job_semi_issues where job_no = p_job_no;
  if v_parts > 0 then
    update semi_stock_lots l set available_qty = l.available_qty + i.qty from job_semi_issues i where i.lot_id = l.id and i.job_no = p_job_no;
    delete from job_semi_issues where job_no = p_job_no;
    perform _ledger_entry(coalesce(p_ts, now()), p_job_no, coalesce(v_stage, 'Process'), 'Parts stock', v_parts, 0, format('Reversal: job-work batch %s deleted — parts returned to stock', p_job_no), 'reversal');
  end if;
  -- the customer's parts go back to the customer
  perform _ledger_entry(coalesce(p_ts, now()), p_job_no, coalesce(v_stage, 'Process'), 'Customer', w.received_qty, 0, format('Reversal: job-work batch %s deleted before work started', p_job_no), 'reversal');
  delete from stage_records where job_no = p_job_no;
  delete from job_work where job_no = p_job_no;
  delete from jobs where job_no = p_job_no;
  perform _log(coalesce(p_ts, now()), 'job', format('Job-work batch %s deleted before work started', p_job_no));
end $$;

-- ---------------------------------------------------------------- 5. our stock of parts is in the ledger too
create or replace function add_semi_stock(p_product text, p_stage text, p_qty int, p_supplier text, p_note text, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_name text;
begin
  perform _require_user();
  perform _require_write('products');
  select name into v_name from products where id = p_product;
  if v_name is null then raise exception 'Select the product.'; end if;
  if p_stage not in ('forging', 'trimming', 'heatTreatment') then raise exception 'Choose the process these parts are ready for.'; end if;
  if not (coalesce(p_qty, 0) > 0) then raise exception 'Enter the quantity received.'; end if;
  insert into semi_stock_lots (product_id, stage, qty, available_qty, supplier, note, received_by)
  values (p_product, p_stage::process_stage, p_qty, p_qty, btrim(coalesce(p_supplier, '')), btrim(coalesce(p_note, '')), coalesce(p_user, ''))
  returning id into v_id;
  perform _move(now(), null, 'Supplier', 'Parts stock', p_qty, 0, format('%s ready for %s · parts lot %s', v_name, stage_label(p_stage), v_id));
  return v_id;
end $$;

create or replace function delete_semi_lot(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare l semi_stock_lots; v_name text;
begin
  perform _require_user();
  perform _require_write('products');
  select * into l from semi_stock_lots where id = p_id for update;
  if not found then raise exception 'That lot does not exist.'; end if;
  if l.available_qty <> l.qty or exists (select 1 from job_semi_issues where lot_id = p_id) then raise exception 'Some of this lot is already used by a job card, so it cannot be deleted.'; end if;
  select name into v_name from products where id = l.product_id;
  perform _ledger_entry(now(), null, 'Parts stock', 'Supplier', l.qty, 0, format('Reversal: parts lot %s deleted — %s ready for %s', p_id, v_name, stage_label(l.stage::text)), 'reversal');
  delete from semi_stock_lots where id = p_id;
end $$;
