-- ============================================================
-- 92 · Dispatch: Save as Draft, continue another day
-- ============================================================
-- Needs 07 / 10 (dispatches, create_dispatch, mark_dispatched). Safe to run twice. Dispatches already made are not changed.
--
-- A draft is a dispatch in the status "Ready for Dispatch" (it already existed): its bags are saved and its pieces are held back
-- (reserved) in Finished Goods, so they cannot be packed twice — but nothing has left the plant and the vehicle is not needed yet.
--  · save_dispatch_draft(null, …)            makes a new draft (create_dispatch with status "Ready for Dispatch")
--  · save_dispatch_draft('DSP-2026-0007', …) replaces the draft's bags, date and vehicle with what is on the form now (e.g. 1,500 PCS
--                                             weighed yesterday + 500 today) and moves the reserved quantity with it
--  · mark_dispatched (unchanged) sends it: reserved → dispatched, with the vehicle. A dispatched one can no longer be changed.

create or replace function save_dispatch_draft(
  p_dispatch_no text,
  p_fg_id       text,
  p_vehicle_no  text,
  p_date        date,
  p_bags        jsonb,
  p_ts          timestamptz default now()
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ts    timestamptz := coalesce(p_ts, now());
  d       dispatches;
  fg      finished_goods;
  prod    products;
  v_bags  jsonb := '[]'::jsonb;
  b       jsonb;
  i       int := 0;
  q       int;
  w       numeric;
  v_tot_q int;
  v_tot_w numeric;
  v_avail int;
begin
  perform _require_user();
  perform _require_write('dispatch');

  -- a new draft
  if coalesce(btrim(p_dispatch_no), '') = '' then
    return create_dispatch(p_fg_id, p_vehicle_no, p_date, 'Ready for Dispatch'::dispatch_status, p_bags, null, null, null, null, null, null, v_ts);
  end if;

  -- an existing draft: its bags are replaced by the ones on the form
  select * into d from dispatches where dispatch_no = p_dispatch_no for update;
  if not found then raise exception '% was not found.', p_dispatch_no; end if;
  if d.status <> 'Ready for Dispatch' then raise exception '% has already been dispatched, so it can no longer be changed.', p_dispatch_no; end if;
  if p_date is null then raise exception 'Dispatch date is required.'; end if;
  if p_bags is null or jsonb_typeof(p_bags) <> 'array' or jsonb_array_length(p_bags) = 0 then raise exception 'Add at least one bag.'; end if;
  select * into fg from finished_goods where id = d.fg_id for update;
  if not found then raise exception 'Finished goods lot missing.'; end if;
  select * into prod from products where id = fg.product_id;

  for b in select * from jsonb_array_elements(p_bags) loop
    i := i + 1;
    q := _assert_qty((b ->> 'qty')::numeric, format('Bag %s quantity', i));
    w := case when coalesce((b ->> 'weight')::numeric, 0) > 0 then round((b ->> 'weight')::numeric, 3) else round(q * coalesce(prod.finished_weight, 0), 3) end;
    v_bags := v_bags || jsonb_build_object('no', i, 'qty', q, 'weight', w);
  end loop;
  select coalesce(sum((x ->> 'qty')::int), 0), round(coalesce(sum((x ->> 'weight')::numeric), 0), 3)
    into v_tot_q, v_tot_w from jsonb_array_elements(v_bags) x;

  -- what this draft may hold: the free stock plus what it holds already
  v_avail := fg.qty - fg.reserved_qty - fg.dispatched_qty + d.qty;
  if v_tot_q > v_avail then
    raise exception 'Dispatch quantity (%) exceeds the finished goods available for it (% PCS).', v_tot_q, v_avail;
  end if;

  update finished_goods set reserved_qty = reserved_qty - d.qty + v_tot_q where id = fg.id;
  delete from dispatch_bags where dispatch_no = d.dispatch_no;
  insert into dispatch_bags (dispatch_no, bag_no, qty, weight)
  select d.dispatch_no, (x ->> 'no')::int, (x ->> 'qty')::int, (x ->> 'weight')::numeric from jsonb_array_elements(v_bags) x;
  update dispatches
     set qty        = v_tot_q,
         weight     = v_tot_w,
         date       = p_date,
         vehicle_no = case when btrim(coalesce(p_vehicle_no, '')) = '' then vehicle_no else upper(btrim(p_vehicle_no)) end
   where dispatch_no = d.dispatch_no;
  perform _log(v_ts, 'dispatch', format('%s draft saved — %s PCS in %s bags (%s KG), not dispatched yet', d.dispatch_no, v_tot_q, jsonb_array_length(v_bags), trim_scale(v_tot_w)), d.job_no);
  return d.dispatch_no;
end $$;
revoke all on function save_dispatch_draft(text, text, text, date, jsonb, timestamptz) from public, anon;
grant execute on function save_dispatch_draft(text, text, text, date, jsonb, timestamptz) to authenticated;
