-- ============================================================
-- 87 · Cutting: bars and weight counted separately · EAF document numbers
-- ============================================================
-- Needs 32, 37, 54 and 83. Runs as ONE transaction: if any step fails, nothing is changed. Safe to run twice.
-- Existing job cards, lots, issues and reports keep their numbers and history.
--
-- 1. RAW STOCK BY WEIGHT. A lot now keeps its real weight left (available_weight), next to its bars / pieces left (available_qty).
--    Until now one cut piece took one bar, so 5,000 pieces could not be cut from 100 bars. Now Cutting takes from raw stock:
--      · the WEIGHT that was cut (KG)                    → from available_weight   (500 KG − 50 KG = 450 KG left)
--      · the BARS / PIECES CONSUMED typed by the worker  → from available_qty      (100 bars − 20 = 80 bars left)
--    both oldest lot first (FIFO). The quantity to cut is no longer limited by the bar count.
--    Every other change to a lot's bars (stock adjustment, return to supplier, QC rejection, editing an inward) moves its weight in
--    step (bars × KG per bar), so none of those functions had to change. Existing lots start with weight left = bars left × KG per bar.
-- 2. The job card can note the bars it plans to use (set_cutting_bars). They are what the job holds back from the free stock, and the
--    Cutting form starts with them.
-- 3. DOCUMENT NUMBERS. New job cards: EAF/2026-0001. New hardness (heat-treatment) reports: EAF-HT-2026-0001. The year is the year of
--    the document, so it moves on by itself every 1st January (each year starts again at 0001). Numbers already given are not changed.

begin;

create or replace function _patch_fn_87(p_name text, p_from text, p_to text, p_required boolean default true) returns boolean
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
  if not v_hit and p_required then raise exception 'Could not patch function % (text not found).', p_name; end if;
  return v_hit;
end $$;

-- ============================================================ 1. weight left on every lot
alter table raw_material_lots add column if not exists available_weight numeric(12, 3);
update raw_material_lots set available_weight = round(available_qty * (inward_weight / inward_qty), 3) where available_weight is null;
do $$ begin
  alter table raw_material_lots add constraint lot_available_weight_ok check (available_weight is null or available_weight >= 0);
exception when duplicate_object then null; end $$;

-- keeps available_weight in step when a lot's bars change through any function other than the Cutting issue below
create or replace function _lot_weight_follow() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.available_weight is null then new.available_weight := round(new.available_qty * (new.inward_weight / new.inward_qty), 3); end if;
    return new;
  end if;
  if coalesce(current_setting('app.lot_weight_explicit', true), '') = 'on' then return new; end if;   -- the Cutting issue sets it itself
  if new.available_weight is distinct from old.available_weight then return new; end if;               -- set on purpose
  if new.available_qty is distinct from old.available_qty or new.inward_weight is distinct from old.inward_weight
     or new.inward_qty is distinct from old.inward_qty then
    new.available_weight := least(new.inward_weight, greatest(0, round(
        coalesce(old.available_weight, old.available_qty * (old.inward_weight / old.inward_qty))
      + new.available_qty * (new.inward_weight / new.inward_qty) - old.available_qty * (old.inward_weight / old.inward_qty), 3)));
  end if;
  return new;
end $$;
drop trigger if exists lot_weight_follow on raw_material_lots;
create trigger lot_weight_follow before insert or update on raw_material_lots for each row execute function _lot_weight_follow();

-- an issue line may now take only weight from a lot (0 bars), or only bars
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.job_material_issues'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%qty > 0%'
  loop
    execute format('alter table public.job_material_issues drop constraint %I', c.conname);
  end loop;
end $$;
do $$ begin
  alter table job_material_issues add constraint issue_takes_something check (qty >= 0 and (qty > 0 or weight > 0));
exception when duplicate_object then null; end $$;

-- ============================================================ 2. the Cutting issue: weight and bars, each oldest lot first
-- p_bars:   bars / pieces consumed (typed by the worker)
-- p_weight: KG cut. NULL = the old rule (weight follows the bars), for a request that does not send a weight.
create or replace function _issue_raw(p_job jobs, p_bars int, p_weight numeric, p_ts timestamptz) returns void
language plpgsql as $$
declare
  lot       raw_material_lots;
  v_by_bars boolean := p_weight is null;
  v_left_b  int := coalesce(p_bars, 0);
  v_left_w  numeric := coalesce(p_weight, 0);
  v_take_b  int;
  v_take_w  numeric(12, 3);
  v_avail_b bigint;
  v_avail_w numeric;
begin
  if v_left_b < 0 then raise exception 'Bars / pieces consumed cannot be negative.'; end if;
  if v_left_w < 0 then raise exception 'Weight consumed cannot be negative.'; end if;
  select coalesce(sum(available_qty), 0), coalesce(sum(available_weight), 0) into v_avail_b, v_avail_w
    from raw_material_lots where material = p_job.material and od = p_job.od;
  if v_left_b > v_avail_b then
    raise exception 'Only % bars / pieces of % OD %mm are in Raw Inventory — % entered as consumed.', v_avail_b, p_job.material, trim_scale(p_job.od), v_left_b;
  end if;
  if not v_by_bars and v_left_w > v_avail_w + 0.0005 then
    raise exception 'Only % KG of % OD %mm is in Raw Inventory — % KG entered as consumed.', trim_scale(round(v_avail_w, 3)), p_job.material, trim_scale(p_job.od), trim_scale(v_left_w);
  end if;

  perform set_config('app.lot_weight_explicit', 'on', true);
  for lot in
    select * from raw_material_lots
     where material = p_job.material and od = p_job.od and (available_qty > 0 or coalesce(available_weight, 0) > 0)
     order by inward_date, id
     for update                                  -- two users cannot issue the same stock
  loop
    exit when v_left_b = 0 and (v_by_bars or v_left_w <= 0);
    v_take_b := least(lot.available_qty, v_left_b);
    v_take_w := case when v_by_bars then least(coalesce(lot.available_weight, 0), round(v_take_b * (lot.inward_weight / lot.inward_qty), 3))
                     else least(coalesce(lot.available_weight, 0), v_left_w) end;
    continue when v_take_b = 0 and v_take_w <= 0;
    update raw_material_lots set available_qty = available_qty - v_take_b, available_weight = coalesce(available_weight, 0) - v_take_w where id = lot.id;
    v_left_b := v_left_b - v_take_b;
    v_left_w := v_left_w - v_take_w;
    insert into job_material_issues (job_no, lot_id, qty, weight, issued_at) values (p_job.job_no, lot.id, v_take_b, v_take_w, p_ts);
    perform _move(p_ts, p_job.job_no, 'Raw Inventory', 'Cutting', v_take_b, 0,
                  format('Issue from lot %s: %s bars / pieces, %s KG', lot.id, v_take_b, trim_scale(v_take_w)));
  end loop;
  perform set_config('app.lot_weight_explicit', 'off', true);
end $$;

-- Cutting takes "barsConsumed" and "weightKg" from the form (stored with the cutting record too). A request without them works as before.
select _patch_fn_87('start_stage',
  $f$perform _issue_material(j, v_qty, v_ts);$f$,
  $f$perform _issue_raw(j, coalesce(nullif(p_params ->> 'barsConsumed', '')::int, v_qty), nullif(p_params ->> 'weightKg', '')::numeric, v_ts);$f$);

-- ============================================================ 3. the quantity to cut is not limited by the bar count
select _patch_fn_87('create_job', $f$if v_planned > v_avail$f$, $f$if false and v_planned > v_avail$f$);
select _patch_fn_87('create_job_work', $f$if v_qty > v_avail then$f$, $f$if false and v_qty > v_avail then$f$, false);

-- bars held back by job cards whose Cutting has not started: the bars they plan to use (older job cards: their quantity, as before)
create or replace function _reserved_raw(p_material text, p_od numeric) returns int
language sql stable as $$
  select coalesce(sum(case when r.params ? 'barsPlanned' then coalesce(nullif(r.params ->> 'barsPlanned', '')::int, 0) else r.input_qty end), 0)::int
    from stage_records r join jobs j on j.job_no = r.job_no
   where r.stage = 'cutting' and r.status = 'Pending' and j.material = p_material and j.od = p_od
     and not exists (select 1 from job_work w where w.job_no = j.job_no and w.material_source = 'customer')
$$;

-- the bars / pieces a new job card plans to use (shown in the Cutting form, which can still change it)
create or replace function set_cutting_bars(p_job_no text, p_bars int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('cutting');
  if p_bars is null or p_bars < 0 then raise exception 'Bars / pieces consumed cannot be negative.'; end if;
  update stage_records set params = params || jsonb_build_object('barsPlanned', p_bars)
   where job_no = p_job_no and stage = 'cutting' and status = 'Pending';
  if not found then raise exception '% has no Cutting waiting to start.', p_job_no; end if;
end $$;
revoke all on function set_cutting_bars(text, int) from public, anon;
grant execute on function set_cutting_bars(text, int) to authenticated;
revoke all on function _issue_raw(jobs, int, numeric, timestamptz) from public, anon, authenticated;

-- ============================================================ 4. views: the real weight left
create or replace view v_lots as
select l.id, l.material, l.material_type, l.od, l.inward_date, case when (select column_visible('raw.heat_no')) then l.heat_no end as heat_no, l.inward_qty, l.inward_weight, l.available_qty,
       l.unit, l.created_at,
       l.material || '|' || trim_scale(l.od)::text                          as material_key,
       coalesce(l.available_weight, round(l.available_qty * (l.inward_weight / l.inward_qty), 3)) as available_weight,
       case when l.available_qty = 0 and l.blocked_qty > 0 and l.blocked_qty >= l.inward_qty then 'Rejected'
            when l.available_qty = 0                 then 'Consumed'
            when l.available_qty < l.inward_qty * 0.2 then 'Low Stock'
            else 'Available' end                                              as status,
       mask_text(l.supplier, 'party_names')      as supplier,
       mask_text(l.invoice_no, 'invoices')       as invoice_no,
       mask_num(l.purchase_rate, 'purchase_rates')  as purchase_rate,
       mask_num(round(coalesce(l.available_weight, l.available_qty * (l.inward_weight / l.inward_qty)) * l.purchase_rate, 2), 'purchase_rates') as stock_value,
       l.blocked_qty, l.qc_status, l.accepted_weight, l.rejected_weight, l.po_id, l.po_item_id,
       (select po.po_no from purchase_orders po where po.id = l.po_id) as po_no
  from raw_material_lots l
 where is_active_user();

create or replace view v_raw_stock as
select l.material, l.od,
       l.material || '|' || trim_scale(l.od)::text                              as material_key,
       count(*) filter (where l.available_qty > 0)                              as open_lots,
       sum(l.inward_qty)::int                                                   as inward_qty,
       sum(l.available_qty)::int                                                as available_qty,
       round(sum(coalesce(l.available_weight, l.available_qty * (l.inward_weight / l.inward_qty))), 3) as available_weight
  from raw_material_lots l
 where is_active_user()
 group by l.material, l.od;

-- ============================================================ 5. EAF document numbers
-- fmt: the shape of an automatic number; {Y} = the year, {N} = the running number (padded). Empty fmt = PREFIX-YEAR-NNNN as before.
alter table doc_no_kinds add column if not exists fmt text;
update doc_no_kinds set prefix = 'EAF',    fmt = 'EAF/{Y}-{N}'    where key = 'job';
update doc_no_kinds set prefix = 'EAF-HT', fmt = 'EAF-HT-{Y}-{N}' where key = 'hardness';

create or replace function _doc_no_text(p_key text, p_year int, p_n int) returns text
language sql stable security definer set search_path = public as $$
  select case when coalesce(k.fmt, '') <> '' then replace(replace(k.fmt, '{Y}', p_year::text), '{N}', lpad(p_n::text, k.pad, '0'))
              else k.prefix || '-' || p_year || '-' || lpad(p_n::text, k.pad, '0') end
    from doc_no_kinds k where k.key = p_key
$$;

-- the next automatic number, used up (a number typed by hand earlier is skipped)
create or replace function _next_doc_no_text(p_key text, p_ts timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare
  k      doc_no_kinds;
  v_year int := extract(year from coalesce(p_ts, now()))::int;
  v      text;
begin
  select * into k from doc_no_kinds where key = p_key;
  if not found then raise exception 'Unknown number type "%".', p_key; end if;
  loop
    v := _doc_no_text(p_key, v_year, next_doc_no(k.counter, v_year));
    exit when not _doc_no_taken(p_key, v);
  end loop;
  return v;
end $$;

-- the next automatic number, WITHOUT using it up (shown in the "add" forms)
create or replace function peek_doc_no(p_key text) returns text
language plpgsql security definer set search_path = public as $$
declare
  k      doc_no_kinds;
  v_year int := extract(year from current_date)::int;
  v_n    int;
  v      text;
begin
  perform _require_user();
  select * into k from doc_no_kinds where key = p_key;
  if not found then raise exception 'Unknown number type "%".', p_key; end if;
  select coalesce((select last_value from doc_counters where kind = k.counter and year = v_year), 0) + 1 into v_n;
  loop
    v := _doc_no_text(p_key, v_year, v_n);
    exit when not _doc_no_taken(p_key, v);
    v_n := v_n + 1;
  end loop;
  return v;
end $$;

-- the number the user typed (header x-doc-no), or null for "number it automatically". Raises when it is already used.
create or replace function _requested_doc_no(p_key text) returns text
language plpgsql security definer set search_path = public as $$
declare
  k    doc_no_kinds;
  v    text;
  m    text[];
  pat  text;
begin
  begin
    v := btrim(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-doc-no', ''));
  exception when others then
    v := '';
  end;
  if v = '' then return null; end if;
  select * into k from doc_no_kinds where key = p_key;
  if not found then raise exception 'Unknown number type "%".', p_key; end if;
  if length(v) > 40 or v !~ '^[A-Za-z0-9][A-Za-z0-9 ._/-]*$' then
    raise exception 'The number "%" is not valid. Use letters, digits and - / . only (up to 40 characters).', v;
  end if;
  if _doc_no_taken(p_key, v) then
    raise exception 'The number "%" already exists. Enter a different number.', v;
  end if;
  -- a number in the usual automatic shape moves the counter on, so the automatic numbering never reaches it later
  pat := case when coalesce(k.fmt, '') <> '' then '^' || replace(replace(k.fmt, '{Y}', '(\d{4})'), '{N}', '(\d+)') || '$'
              else '^' || k.prefix || '-(\d{4})-(\d+)$' end;
  m := regexp_match(v, pat, 'i');
  if m is not null then
    insert into doc_counters (kind, year, last_value) values (k.counter, m[1]::int, m[2]::int)
    on conflict (kind, year) do update set last_value = greatest(doc_counters.last_value, excluded.last_value);
  end if;
  return v;
end $$;

revoke all on function _doc_no_text(text, int, int), _next_doc_no_text(text, timestamptz), _requested_doc_no(text) from public, anon, authenticated;
revoke all on function peek_doc_no(text) from public, anon;
grant execute on function peek_doc_no(text) to authenticated;

-- the functions that number new job cards and hardness reports
select _patch_fn_87('create_job',
  $f$format('JOB-%s-%s', _year(v_ts), lpad(next_doc_no('job', _year(v_ts))::text, 4, '0'))$f$,
  $f$_next_doc_no_text('job', v_ts)$f$);
select _patch_fn_87('create_job_work',
  $f$format('JOB-%s-%s', _year(v_ts), lpad(next_doc_no('job', _year(v_ts))::text, 4, '0'))$f$,
  $f$_next_doc_no_text('job', v_ts)$f$, false);
select _patch_fn_87('save_hardness_report',
  $f$format('HIR-%s-%s', _year(v_ts), lpad(next_doc_no('hardness', _year(v_ts))::text, 4, '0'))$f$,
  $f$_next_doc_no_text('hardness', v_ts)$f$);

drop function _patch_fn_87(text, text, text, boolean);

commit;
