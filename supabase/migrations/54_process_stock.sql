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
-- 54 · Stock — where each job's pieces come from, and low-stock warnings
-- ============================================================
-- A product can START at any process (Product Master → Work to be done; the first ticked process is where it starts):
--   · starts at Cutting                    → the raw bar in Raw Inventory is used (as before) — and now RESERVED when the job card is created,
--                                            so two jobs can no longer both count the same bar
--   · starts at Forging / Trimming / Heat  → the pieces come from OUR OWN STOCK of parts that are already cut / forged / trimmed (added from the Product Master),
--     Treatment                              taken oldest-first when the job card is created
--   · job work on the CUSTOMER's material  → no stock of ours is used (unchanged)
--   · job work on OUR material that starts after Cutting → our stock of parts is used too
-- Minimum levels (per bar size and per part + process) raise a notification to the Director / Plant Head when stock falls to the minimum.
-- Needs 26 (job work), 39 (notifications), 51 (product flow). Safe to run twice.

-- ---------------------------------------------------------------- products: Cutting can be unticked too
alter table products add column if not exists do_cutting boolean not null default true;

create or replace view v_product_flow as
-- do_cutting is the LAST column: create or replace view can only add columns at the end
select id, do_forging, do_trimming, do_heat_treatment, hardness_required, hardness_min, hardness_max, hardness_scale, do_cutting
  from products where is_active_user();
grant select on v_product_flow to authenticated;
revoke all on v_product_flow from anon;

create or replace function set_product_flow(p_id text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req boolean := coalesce((p_payload ->> 'hardness_required')::boolean, false);
  v_min numeric := nullif(p_payload ->> 'hardness_min', '')::numeric;
  v_max numeric := nullif(p_payload ->> 'hardness_max', '')::numeric;
  v_c   boolean := coalesce((p_payload ->> 'do_cutting')::boolean, true);
  v_f   boolean := coalesce((p_payload ->> 'do_forging')::boolean, true);
  v_t   boolean := coalesce((p_payload ->> 'do_trimming')::boolean, true);
  v_h   boolean := coalesce((p_payload ->> 'do_heat_treatment')::boolean, true);
begin
  perform _require_user();
  perform _require_write('products');
  if not exists (select 1 from products where id = p_id) then raise exception 'Unknown product %.', p_id; end if;
  if not (v_c or v_f or v_t or v_h) then raise exception 'Tick at least one process for this product.'; end if;
  if v_req and (coalesce(v_min, 0) <= 0 or coalesce(v_max, 0) <= 0) then raise exception 'Enter the required hardness range (both limits).'; end if;
  if v_min is not null and v_max is not null and v_min > v_max then raise exception 'Required hardness: the lower limit cannot be above the upper limit.'; end if;
  update products set
         do_cutting = v_c, do_forging = v_f, do_trimming = v_t, do_heat_treatment = v_h,
         hardness_required = v_req, hardness_min = v_min, hardness_max = v_max,
         hardness_scale    = coalesce(nullif(p_payload ->> 'hardness_scale', ''), 'HRB')::hardness_scale
   where id = p_id;
end $$;

-- ---------------------------------------------------------------- our stock of parts (cut / forged / trimmed), by the process they are ready for
create table if not exists semi_stock_lots (
  id            bigint generated always as identity primary key,
  product_id    text not null references products (id),
  stage         process_stage not null check (stage in ('forging', 'trimming', 'heatTreatment')),
  qty           int  not null check (qty > 0),
  available_qty int  not null check (available_qty >= 0 and available_qty <= qty),
  supplier      text not null default '',
  received_on   date not null default current_date,
  note          text not null default '',
  received_by   text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists semi_lots_idx on semi_stock_lots (product_id, stage) where available_qty > 0;
create table if not exists job_semi_issues (
  id        bigint generated always as identity primary key,
  job_no    text not null references jobs (job_no) on delete cascade,
  lot_id    bigint not null references semi_stock_lots (id),
  qty       int not null check (qty > 0),
  issued_at timestamptz not null default now()
);
create table if not exists stock_levels (
  key     text primary key,                       -- 'raw|<material>|<od>'  or  'semi|<product id>|<stage>'
  min_qty int  not null check (min_qty >= 0)
);
alter table semi_stock_lots enable row level security;
alter table job_semi_issues enable row level security;
alter table stock_levels enable row level security;
revoke all on semi_stock_lots, job_semi_issues, stock_levels from anon, authenticated;

-- (an earlier version of this file made a separate "Process Stock" page; stock is added from the Product Master instead, so remove it if it exists)
delete from role_page_access where resource = 'process_stock';
delete from app_resources where key = 'process_stock';

-- ---------------------------------------------------------------- reserved bar: planned by job cards whose Cutting has not started
create or replace function _reserved_raw(p_material text, p_od numeric) returns int
language sql stable as $$
  select coalesce(sum(r.input_qty), 0)::int
    from stage_records r join jobs j on j.job_no = r.job_no
   where r.stage = 'cutting' and r.status = 'Pending' and j.material = p_material and j.od = p_od
     and not exists (select 1 from job_work w where w.job_no = j.job_no and w.material_source = 'customer')
$$;

-- ---------------------------------------------------------------- low-stock notifications (never allowed to break a stock movement)
create or replace function _notify_stock(p_key text, p_title text, p_msg text, p_free int) returns void
language plpgsql security definer set search_path = public as $$
declare v_min int; u record;
begin
  select min_qty into v_min from stock_levels where key = p_key;
  if coalesce(v_min, 0) <= 0 or p_free > v_min then return; end if;
  for u in select id from profiles where active and role in ('director', 'plant_head') loop
    if not exists (select 1 from notifications n where n.user_id = u.id and n.kind = 'stock' and n.title = p_title and n.seen_at is null) then
      insert into notifications (user_id, kind, title, message, link, urgency)
      values (u.id, 'stock', p_title, p_msg, 'products', case when p_free <= 0 then 'Urgent' else 'High' end);
    end if;
  end loop;
exception when others then null;
end $$;

create or replace function _check_low_raw(p_material text, p_od numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_free int;
begin
  select coalesce(sum(available_qty), 0)::int - _reserved_raw(p_material, p_od) into v_free from raw_material_lots where material = p_material and od = p_od;
  perform _notify_stock(format('raw|%s|%s', p_material, trim_scale(p_od)), format('%s: %s Ø%s mm', case when v_free <= 0 then 'Out of stock' else 'Low stock' end, p_material, trim_scale(p_od)),
                        format('%s PCS of bar left after the job cards already planned.', greatest(v_free, 0)), v_free);
exception when others then null;
end $$;

create or replace function _check_low_semi(p_product text, p_stage text) returns void
language plpgsql security definer set search_path = public as $$
declare v_free int; v_name text;
begin
  select coalesce(sum(available_qty), 0)::int into v_free from semi_stock_lots where product_id = p_product and stage = p_stage::process_stage;
  select name into v_name from products where id = p_product;
  perform _notify_stock(format('semi|%s|%s', p_product, p_stage), format('%s: %s for %s', case when v_free <= 0 then 'Out of stock' else 'Low stock' end, v_name, stage_label(p_stage)),
                        format('%s PCS of %s left, ready for %s.', greatest(v_free, 0), v_name, stage_label(p_stage)), v_free);
exception when others then null;
end $$;

create or replace function trg_raw_stock_low() returns trigger language plpgsql as $$
begin
  if new.available_qty < old.available_qty then perform _check_low_raw(new.material, new.od); end if;
  return new;
end $$;
drop trigger if exists raw_lots_low_stock on raw_material_lots;
create trigger raw_lots_low_stock after update of available_qty on raw_material_lots for each row execute function trg_raw_stock_low();

create or replace function trg_semi_stock_low() returns trigger language plpgsql as $$
begin
  if new.available_qty < old.available_qty then perform _check_low_semi(new.product_id, new.stage::text); end if;
  return new;
end $$;
drop trigger if exists semi_lots_low_stock on semi_stock_lots;
create trigger semi_lots_low_stock after update of available_qty on semi_stock_lots for each row execute function trg_semi_stock_low();

-- ---------------------------------------------------------------- read models
create or replace view v_stock_raw as
select x.material, x.od, x.available, x.reserved, x.available - x.reserved as free, x.min_qty,
       case when x.available - x.reserved <= 0 then 'out' when x.min_qty > 0 and x.available - x.reserved <= x.min_qty then 'low' else 'ok' end as status
  from (
    select k.material, k.od,
           coalesce((select sum(l.available_qty) from raw_material_lots l where l.material = k.material and l.od = k.od), 0)::int as available,
           _reserved_raw(k.material, k.od) as reserved,
           coalesce((select s.min_qty from stock_levels s where s.key = format('raw|%s|%s', k.material, trim_scale(k.od))), 0) as min_qty
      from (select material, od from raw_material_lots group by material, od
            union select split_part(key, '|', 2), split_part(key, '|', 3)::numeric from stock_levels where key like 'raw|%') k
  ) x
 where is_active_user();

create or replace view v_stock_semi as
select x.product_id, x.stage, x.available, x.min_qty,
       case when x.available <= 0 then 'out' when x.min_qty > 0 and x.available <= x.min_qty then 'low' else 'ok' end as status
  from (
    select k.product_id, k.stage,
           coalesce((select sum(l.available_qty) from semi_stock_lots l where l.product_id = k.product_id and l.stage::text = k.stage), 0)::int as available,
           coalesce((select s.min_qty from stock_levels s where s.key = format('semi|%s|%s', k.product_id, k.stage)), 0) as min_qty
      from (select product_id, stage::text as stage from semi_stock_lots group by product_id, stage
            union select split_part(key, '|', 2), split_part(key, '|', 3) from stock_levels where key like 'semi|%') k
  ) x
 where is_active_user();
grant select on v_stock_raw, v_stock_semi to authenticated;
revoke all on v_stock_raw, v_stock_semi from anon;

-- ---------------------------------------------------------------- receive parts / set a minimum / remove a lot nobody used
create or replace function add_semi_stock(p_product text, p_stage text, p_qty int, p_supplier text, p_note text, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform _require_user();
  perform _require_write('products');
  if not exists (select 1 from products where id = p_product) then raise exception 'Select the product.'; end if;
  if p_stage not in ('forging', 'trimming', 'heatTreatment') then raise exception 'Choose the process these parts are ready for.'; end if;
  if not (coalesce(p_qty, 0) > 0) then raise exception 'Enter the quantity received.'; end if;
  insert into semi_stock_lots (product_id, stage, qty, available_qty, supplier, note, received_by)
  values (p_product, p_stage::process_stage, p_qty, p_qty, btrim(coalesce(p_supplier, '')), btrim(coalesce(p_note, '')), coalesce(p_user, ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function set_stock_min(p_key text, p_min int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  if not (page_level('products') = 'write' or page_level('raw_inventory') = 'write') then raise exception 'You do not have permission to change stock levels.' using errcode = '42501'; end if;
  if p_key !~ '^(raw|semi)\|' then raise exception 'Unknown stock item.'; end if;
  if coalesce(p_min, -1) < 0 then raise exception 'The minimum cannot be negative.'; end if;
  insert into stock_levels (key, min_qty) values (p_key, p_min) on conflict (key) do update set min_qty = excluded.min_qty;
end $$;

create or replace function delete_semi_lot(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare l semi_stock_lots;
begin
  perform _require_user();
  perform _require_write('products');
  select * into l from semi_stock_lots where id = p_id for update;
  if not found then raise exception 'That lot does not exist.'; end if;
  if l.available_qty <> l.qty or exists (select 1 from job_semi_issues where lot_id = p_id) then raise exception 'Some of this lot is already used by a job card, so it cannot be deleted.'; end if;
  delete from semi_stock_lots where id = p_id;
end $$;
revoke all on function add_semi_stock(text, text, int, text, text, text), set_stock_min(text, int), delete_semi_lot(bigint) from public, anon;
grant execute on function add_semi_stock(text, text, int, text, text, text), set_stock_min(text, int), delete_semi_lot(bigint) to authenticated;

-- ---------------------------------------------------------------- take parts from our stock (oldest first)
create or replace function _issue_semi(p_product text, p_stage process_stage, p_qty int, p_job text, p_ts timestamptz) returns void
language plpgsql as $$
declare lot semi_stock_lots; v_avail bigint; v_left int := p_qty; v_take int;
begin
  select coalesce(sum(available_qty), 0) into v_avail from semi_stock_lots where product_id = p_product and stage = p_stage and available_qty > 0;
  if p_qty > v_avail then
    raise exception 'Only % PCS of % are in stock ready for %. Add the stock on this product in the Product Master first.', v_avail, (select name from products where id = p_product), stage_label(p_stage::text);
  end if;
  for lot in select * from semi_stock_lots where product_id = p_product and stage = p_stage and available_qty > 0 order by id for update loop
    exit when v_left = 0;
    v_take := least(lot.available_qty, v_left);
    update semi_stock_lots set available_qty = available_qty - v_take where id = lot.id;
    insert into job_semi_issues (job_no, lot_id, qty, issued_at) values (p_job, lot.id, v_take, p_ts);
    v_left := v_left - v_take;
  end loop;
  perform _move(p_ts, p_job, 'Parts stock', stage_label(p_stage::text), p_qty, 0, 'Issued from our stock of parts');
end $$;

-- ---------------------------------------------------------------- a new job card starts at its product's FIRST ticked process
create or replace function _apply_entry_stage(p_job text, p_ts timestamptz) returns void
language plpgsql as $$
declare
  j        jobs;
  prod     products;
  v_first  text;
  s        text;
  v_params jsonb;
begin
  select * into j from jobs where job_no = p_job;
  select * into prod from products where id = j.product_id;
  v_first := case when prod.do_cutting then 'cutting' when prod.do_forging then 'forging' when prod.do_trimming then 'trimming' else 'heatTreatment' end;
  if v_first = 'cutting' then
    perform _check_low_raw(j.material, j.od);
    return;
  end if;
  perform _issue_semi(prod.id, v_first::process_stage, j.planned_qty, p_job, p_ts);
  delete from stage_records where job_no = p_job and stage = 'cutting' and status = 'Pending';
  foreach s in array array['cutting', 'forging', 'trimming', 'heatTreatment'] loop
    exit when s = v_first;
    insert into stage_records (job_no, stage, input_qty, loss_qty, output_qty, status, received_at, started_at, completed_at, remarks, params)
    values (p_job, s::process_stage, j.planned_qty, 0, j.planned_qty, 'Completed', p_ts, p_ts, p_ts, 'Not required — skipped', jsonb_build_object('skipped', 1, 'auto', 1));
  end loop;
  v_params := case v_first
    when 'forging'  then jsonb_build_object('dieNo', coalesce(nullif(j.die_no, ''), prod.die_no))
    when 'trimming' then jsonb_build_object('trimDie', replace(prod.die_no, 'D-', 'T-'))
    else jsonb_build_object('temperature', prod.ht_temperature, 'soakMinutes', prod.ht_soak_minutes, 'process', prod.ht_process, 'quench', prod.ht_quench) end;
  insert into stage_records (job_no, stage, input_qty, status, received_at, params) values (p_job, v_first::process_stage, j.planned_qty, 'Pending', p_ts, v_params);
  update jobs set current_stage = v_first::job_stage where job_no = p_job;
end $$;

do $$
begin
  -- create_job: reserve the bar, skip the bar check when the product does not start at Cutting, and place the job at its first process
  perform _patch_fn('create_job',
    $f$from raw_material_lots where material = p_material and od = p_od and available_qty > 0;$f$,
    $f$from raw_material_lots where material = p_material and od = p_od and available_qty > 0; v_avail := v_avail - _reserved_raw(p_material, p_od);$f$);
  perform _patch_fn('create_job',
    $f$if v_planned > v_avail then$f$,
    $f$if v_planned > v_avail and coalesce(prod.do_cutting, true) then$f$);
  perform _patch_fn('create_job',
    $f$perform _log(v_ts, 'job', format('%s created — %s PCS %s', v_job, v_planned, prod.name), v_job);$f$,
    $f$perform _apply_entry_stage(v_job, v_ts); perform _log(v_ts, 'job', format('%s created — %s PCS %s', v_job, v_planned, prod.name), v_job);$f$);
  -- job work on OUR material may start after Cutting: it then uses our stock of parts
  perform _patch_fn('create_job_work',
    $f$if v_src = 'own' and not v_pc then raise exception 'Our own material is only used by Cutting — tick Cutting, or choose the customer''s material.'; end if;$f$,
    $f$-- our own stock: raw bar when Cutting is ticked, otherwise our stock of parts (Product Master)$f$);
  perform _patch_fn('create_job_work',
    $f$if v_src = 'own' then$f$,
    $f$if v_src = 'own' and v_pc then$f$);
  perform _patch_fn('create_job_work',
    $f$perform _log(v_ts, 'job', format('%s job work received — %s PCS %s', v_job, v_qty, prod.name), v_job);$f$,
    $f$if v_src = 'own' and not v_pc then perform _issue_semi(prod.id, v_first::process_stage, v_qty, v_job, v_ts); end if; perform _log(v_ts, 'job', format('%s job work received — %s PCS %s', v_job, v_qty, prod.name), v_job);$f$);
end $$;

-- ---------------------------------------------------------------- delete a job card that has not started — and give back the parts it took
create or replace function delete_job(p_job_no text, p_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare
  j jobs;
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
  update semi_stock_lots l set available_qty = l.available_qty + i.qty from job_semi_issues i where i.lot_id = l.id and i.job_no = p_job_no;
  delete from job_semi_issues where job_no = p_job_no;
  delete from movements where job_no = p_job_no;
  delete from activity where job_no = p_job_no;
  delete from stage_records where job_no = p_job_no;
  delete from jobs where job_no = p_job_no;
  perform _log(coalesce(p_ts, now()), 'job', format('Job card %s deleted before production started', p_job_no));
end $$;
