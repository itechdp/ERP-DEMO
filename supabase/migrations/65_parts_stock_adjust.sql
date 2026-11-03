-- ============================================================
-- 65 · Parts-stock adjustments
-- ============================================================
-- A stock-count difference, scrap, or pieces given away for our own stock of parts (Product Master -> Stock).
-- Every adjustment needs a reason and is kept in semi_stock_adjustments with who and when; nothing is deleted.
--   count_up    more pieces found than the system shows (a new lot is added)
--   count_down  fewer pieces than the system shows (taken from the oldest lots)
--   scrap       damaged pieces thrown away (taken from the oldest lots)
-- Needs 54. Safe to run twice.

create table if not exists semi_stock_adjustments (
  id         bigint generated always as identity primary key,
  product_id text not null references products (id),
  stage      process_stage not null,
  kind       text not null check (kind in ('count_up', 'count_down', 'scrap')),
  qty        int  not null check (qty > 0),
  reason     text not null,
  by_name    text not null default '',
  at         timestamptz not null default now()
);
alter table semi_stock_adjustments enable row level security;
revoke all on semi_stock_adjustments from anon, authenticated;

create or replace function adjust_semi_stock(p_product text, p_stage text, p_kind text, p_qty int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  lot     semi_stock_lots;
  v_avail bigint;
  v_left  int := p_qty;
  v_take  int;
  v_note  text := btrim(coalesce(p_reason, ''));
begin
  perform _require_user();
  perform _require_write('products');
  if p_kind not in ('count_up', 'count_down', 'scrap') then raise exception 'Choose what happened to the stock.'; end if;
  if p_stage not in ('forging', 'trimming', 'heatTreatment') then raise exception 'Choose the process these parts are ready for.'; end if;
  if not exists (select 1 from products where id = p_product) then raise exception 'Select the product.'; end if;
  if not (coalesce(p_qty, 0) > 0) then raise exception 'Enter the quantity.'; end if;
  if v_note = '' then raise exception 'Write the reason.'; end if;

  if p_kind = 'count_up' then
    insert into semi_stock_lots (product_id, stage, qty, available_qty, note, received_by)
    values (p_product, p_stage::process_stage, p_qty, p_qty, 'Stock count: ' || v_note, _who());
  else
    select coalesce(sum(available_qty), 0) into v_avail from semi_stock_lots where product_id = p_product and stage = p_stage::process_stage and available_qty > 0;
    if p_qty > v_avail then raise exception 'Only % PCS are in stock.', v_avail; end if;
    for lot in select * from semi_stock_lots where product_id = p_product and stage = p_stage::process_stage and available_qty > 0 order by id for update loop
      exit when v_left = 0;
      v_take := least(lot.available_qty, v_left);
      update semi_stock_lots set available_qty = available_qty - v_take where id = lot.id;
      v_left := v_left - v_take;
    end loop;
  end if;
  insert into semi_stock_adjustments (product_id, stage, kind, qty, reason, by_name) values (p_product, p_stage::process_stage, p_kind, p_qty, v_note, _who());
end $$;

create or replace view v_semi_stock_adjustments as
select a.id, a.product_id, a.stage, a.kind, a.qty, a.reason, a.by_name, a.at
  from semi_stock_adjustments a
 where is_active_user();
grant select on v_semi_stock_adjustments to authenticated;
revoke all on v_semi_stock_adjustments from anon;

revoke all on function adjust_semi_stock(text, text, text, int, text) from public, anon;
grant execute on function adjust_semi_stock(text, text, text, int, text) to authenticated;
