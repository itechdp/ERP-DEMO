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
