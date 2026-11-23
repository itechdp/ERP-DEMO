-- ============================================================
-- 86 · Fewer hard rules on receipts, invoices and products
-- ============================================================
-- Needs 32, 33 and 19. Nothing that is already saved changes. Safe to run twice.
--
-- 1. Receiving against a PO: any weight can be received — more or less than the order. The old rule refused a receipt that took a PO line
--    more than 5 % above the ordered weight (533 KG ordered → at most 559.65 KG). The other checks stay: the PO must be released, the
--    line must belong to it and be in KG.
-- 2. Purchase invoice: the quantity of a line is no longer capped at the received / accepted / ordered quantity. The rate check stays
--    (a rate more than the tolerance away from the PO rate still needs a variance note), and each line still needs a quantity above zero.
-- 3. Products: heat-treatment Temperature and Soak Time are optional (e.g. Brass parts that are not heat-treated). Empty = not set.
--    A value that is entered must still be above zero.

-- ------------------------------------------------------------ 1. receipt against a PO: no quantity limit
create or replace function _po_receipt_check(p_po_id bigint, p_item_id bigint, p_weight numeric, p_lot_id text default null)
returns table (supplier_id bigint, supplier_name text, rate numeric)
language plpgsql security definer set search_path = public as $$
declare
  po purchase_orders;
  it purchase_order_items;
begin
  if p_po_id is null and p_item_id is null then return; end if;
  if p_po_id is null or p_item_id is null then raise exception 'Choose both the purchase order and the line of the purchase order.'; end if;
  select * into po from purchase_orders where id = p_po_id;
  if not found then raise exception 'That purchase order does not exist.'; end if;
  if po.status not in ('Released', 'Sent to Supplier', 'Partially Received', 'Fully Received') then
    raise exception 'PO % is % — material can be received only against a released PO.', po.po_no, po.status;
  end if;
  select * into it from purchase_order_items where id = p_item_id;
  if not found or it.po_id <> p_po_id then raise exception 'That line does not belong to PO %.', po.po_no; end if;
  if upper(btrim(it.uom)) <> 'KG' then
    raise exception 'PO line % of % is ordered in %, but receipts are tracked in KG. Receive this one without a PO link.', it.line_no, po.po_no, it.uom;
  end if;
  -- any weight is accepted: suppliers rarely ship the exact ordered weight, and short / over deliveries are both normal
  return query select po.supplier_id, (select name from suppliers where id = po.supplier_id), it.rate;
end $$;

-- ------------------------------------------------------------ 2. invoice lines: no quantity cap, rate rule unchanged
create or replace function _check_invoice_lines(p_po_id bigint, p_lines jsonb, p_variance_note text, p_invoice_id bigint) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  it purchase_order_items;
  v_tol numeric := invoice_rate_tolerance_pct();
  v_needs_note boolean := false;
begin
  -- rate: a difference beyond the tolerance needs a variance note
  for r in select (x ->> 'po_item_id')::bigint as po_item_id, (x ->> 'rate')::numeric as rate from jsonb_array_elements(p_lines) x loop
    select * into it from purchase_order_items where id = r.po_item_id;
    if (it.rate = 0 and r.rate > 0) or (it.rate > 0 and abs(r.rate - it.rate) / it.rate * 100 > v_tol) then v_needs_note := true; end if;
  end loop;
  if v_needs_note and coalesce(btrim(p_variance_note), '') = '' then
    raise exception 'A rate differs from the PO rate by more than % %%. Enter a variance note explaining why.', trim_scale(v_tol);
  end if;
end $$;
revoke all on function _check_invoice_lines(bigint, jsonb, text, bigint) from public, anon, authenticated;

-- ------------------------------------------------------------ 3. products: heat treatment optional
alter table products alter column ht_temperature drop not null;
alter table products alter column ht_soak_minutes drop not null;
do $$
declare c record;
begin
  -- the old checks (ht_temperature > 0, ht_soak_minutes > 0) refuse an empty value; replace them with "empty, or above zero"
  for c in
    select conname from pg_constraint
     where conrelid = 'public.products'::regclass and contype = 'c'
       and (pg_get_constraintdef(oid) ilike '%ht_temperature%' or pg_get_constraintdef(oid) ilike '%ht_soak_minutes%')
  loop
    execute format('alter table public.products drop constraint %I', c.conname);
  end loop;
end $$;
alter table products add constraint products_ht_temperature_optional check (ht_temperature is null or ht_temperature > 0);
alter table products add constraint products_ht_soak_minutes_optional check (ht_soak_minutes is null or ht_soak_minutes > 0);
