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

-- A purchase requisition, purchase order or sales quotation that is waiting for approval can still be corrected.
-- Saving the change takes it out of the approval queue (back to Draft) so nobody approves the old figures; submit it again afterwards.
do $$
begin
  perform _patch_fn('save_pr',
    $f$IF v_status <> 'Draft' THEN$f$,
    $f$IF v_status = 'Approval Pending' THEN UPDATE purchase_requisitions SET status = 'Draft' WHERE id = v_id; v_status := 'Draft'; END IF; IF v_status <> 'Draft' THEN$f$);
  perform _patch_fn('save_po',
    $f$IF v_status <> 'Draft' THEN$f$,
    $f$IF v_status = 'Approval Pending' THEN UPDATE purchase_orders SET status = 'Draft' WHERE id = v_id; v_status := 'Draft'; END IF; IF v_status <> 'Draft' THEN$f$);
  perform _patch_fn('save_sales_quotation',
    $f$if q.status not in ('Draft', 'Revision Required') then$f$,
    $f$if q.status = 'Pending Approval' then update sales_quotations set status = 'Draft' where id = v_id; q.status := 'Draft'; end if; if q.status not in ('Draft', 'Revision Required') then$f$);
end $$;
