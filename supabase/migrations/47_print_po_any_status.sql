-- Print / PDF of a purchase order with its attachments is allowed in every status (Draft, pending, approved, released …).
-- Anyone who can open Purchase Orders or Purchase Approvals may print; sending-related checks (can_send_po) are unchanged.
create or replace function can_print_po(p_po_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select is_active_user()
     and (page_level('procurement_po') in ('read', 'write') or page_level('purchase_approvals') in ('read', 'write'))
     and exists (select 1 from purchase_orders where id = p_po_id)
$$;
revoke all on function can_print_po(bigint) from public, anon;
grant execute on function can_print_po(bigint) to authenticated;
