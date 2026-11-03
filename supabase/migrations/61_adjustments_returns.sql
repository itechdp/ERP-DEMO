-- ============================================================
-- 61 · Manual stock adjustments and returns
-- ============================================================
--  · adjust_raw_stock   a raw-material lot: a stock-count difference (found / missing), scrap, or a return to the supplier
--  · return_finished_goods   goods a customer sent back come into Finished Goods again
--  Every one needs a reason, writes a line to the quantity ledger (with who and when — see 59), and follows the page permissions
--  (Write on Raw Inventory / Dispatch). Nothing is deleted; the lot and the ledger keep their history.
-- Needs 32 (lots) and 59 (ledger lines). Safe to run twice.

-- p_kind = count_up | count_down | scrap | supplier_return
create or replace function adjust_raw_stock(p_lot_id text, p_kind text, p_qty int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  lot     raw_material_lots;
  v_wt    numeric(12, 3);
  v_note  text := btrim(coalesce(p_reason, ''));
  v_label text;
begin
  perform _require_user();
  perform _require_write('raw_inventory');
  if p_kind not in ('count_up', 'count_down', 'scrap', 'supplier_return') then raise exception 'Choose what happened to the stock.'; end if;
  if not (coalesce(p_qty, 0) > 0) then raise exception 'Enter the quantity.'; end if;
  if v_note = '' then raise exception 'Write the reason — it goes on the ledger.'; end if;
  select * into lot from raw_material_lots where id = p_lot_id for update;
  if not found then raise exception 'Lot % does not exist.', p_lot_id; end if;

  -- the weight follows the pieces
  v_wt := round(lot.inward_weight * p_qty / lot.inward_qty, 3);
  if p_kind = 'count_up' then
    update raw_material_lots set inward_qty = inward_qty + p_qty, available_qty = available_qty + p_qty, inward_weight = inward_weight + v_wt where id = p_lot_id;
    perform _ledger_entry(now(), null, 'Stock count', 'Raw Inventory', p_qty, 0, format('Stock count: %s PCS found in lot %s — %s · lot %s', p_qty, p_lot_id, v_note, p_lot_id), 'correction');
  else
    if p_qty > lot.available_qty then raise exception 'Only % PCS of lot % are in stock (the rest is issued or held at QC).', lot.available_qty, p_lot_id; end if;
    if p_qty >= lot.inward_qty then raise exception 'That is the whole lot — delete the lot instead (only possible while none of it is used).'; end if;
    update raw_material_lots set inward_qty = inward_qty - p_qty, available_qty = available_qty - p_qty, inward_weight = inward_weight - v_wt where id = p_lot_id;
    if p_kind = 'count_down' then
      perform _ledger_entry(now(), null, 'Raw Inventory', 'Stock count', p_qty, 0, format('Stock count: %s PCS missing from lot %s — %s · lot %s', p_qty, p_lot_id, v_note, p_lot_id), 'correction');
    elsif p_kind = 'scrap' then
      perform _ledger_entry(now(), null, 'Raw Inventory', 'Scrap', 0, p_qty, format('Scrap: %s PCS of lot %s — %s · lot %s', p_qty, p_lot_id, v_note, p_lot_id), 'move');
    else
      perform _ledger_entry(now(), null, 'Raw Inventory', 'Supplier', p_qty, 0, format('Returned to supplier: %s PCS of lot %s — %s · lot %s', p_qty, p_lot_id, v_note, p_lot_id), 'reversal');
    end if;
  end if;
  v_label := case p_kind when 'count_up' then 'found in a stock count' when 'count_down' then 'missing in a stock count' when 'scrap' then 'scrapped' else 'returned to the supplier' end;
  perform _log(now(), 'inward', format('Lot %s: %s PCS %s — %s', p_lot_id, p_qty, v_label, v_note));
end $$;

-- goods a customer sent back: they leave "dispatched" and are available in Finished Goods again
create or replace function return_finished_goods(p_fg_id text, p_qty int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  fg     finished_goods;
  v_note text := btrim(coalesce(p_reason, ''));
begin
  perform _require_user();
  perform _require_write('dispatch');
  if not (coalesce(p_qty, 0) > 0) then raise exception 'Enter the quantity returned.'; end if;
  if v_note = '' then raise exception 'Write the reason for the return — it goes on the ledger.'; end if;
  select * into fg from finished_goods where id = p_fg_id for update;
  if not found then raise exception '% does not exist.', p_fg_id; end if;
  if p_qty > fg.dispatched_qty then raise exception 'Only % PCS of % have been dispatched, so no more than that can come back.', fg.dispatched_qty, p_fg_id; end if;
  update finished_goods set dispatched_qty = dispatched_qty - p_qty where id = p_fg_id;
  update jobs set current_stage = 'finishedGoods' where job_no = fg.job_no and current_stage = 'dispatched';
  perform _move(now(), fg.job_no, 'Customer', 'Finished Goods', p_qty, 0, format('Customer return: %s PCS of %s — %s', p_qty, p_fg_id, v_note));
  perform _log(now(), 'dispatch', format('%s: %s PCS came back from the customer — %s', p_fg_id, p_qty, v_note), fg.job_no);
end $$;

revoke all on function adjust_raw_stock(text, text, int, text), return_finished_goods(text, int, text) from public, anon;
grant execute on function adjust_raw_stock(text, text, int, text), return_finished_goods(text, int, text) to authenticated;
