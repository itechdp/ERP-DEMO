-- ============================================================
-- 81 · Supervisor role — access rules (needs 80)
-- ============================================================
-- A Supervisor works on the shop floor (workflow, dies, QC, dispatch …) but is HARD-LOCKED out of:
--   * every page of  Sales & Orders,  Purchase & Procurement  and  Accounting
--   * all sensitive information: party (customer / supplier / die-maker) names, invoice numbers, purchase / sales rates and
--     amounts, die cost, costs & margins, and every custom protected column.
-- The lock lives in the database functions that every read policy, masking view and action function already call
-- (page_level / can_see_field / column_visible), so it holds for direct API calls and typed URLs, and it CANNOT be lifted from
-- Settings → Access Control (triggers below force the stored settings back, and the functions ignore them anyway).
-- Every other role behaves exactly as before: each change below starts with a `supervisor` branch and otherwise keeps the old body.

-- ------------------------------------------------------------ what is locked
-- a page key (or a "page__tab" key) the Supervisor can never open
create or replace function _supervisor_blocked(p_res text) returns boolean
language sql stable security definer set search_path = public as $$
  select split_part(p_res, '__', 1) = any (array[
           'customers', 'sales_dashboard', 'sales_quotation', 'quotation_approvals', 'sales_reports', 'inquiries',
           'purchase_orders', 'sales_orders', 'task_assignment',
           'purchase_dashboard', 'procurement_po', 'purchase_approvals', 'suppliers', 'purchase_requisitions', 'rfq',
           'supplier_quotations', 'purchase_reports', 'purchase_invoices', 'purchase_payments', 'supplier_payables', 'supplier_performance',
           'accounting_dashboard', 'account_vouchers', 'voucher_approvals', 'accounting_report'])
      or coalesce((select a.section in ('Sales & Orders', 'Purchase & Procurement', 'Accounting', 'Accounts')
                     from app_resources a where a.key = split_part(p_res, '__', 1)), false);
$$;

-- ------------------------------------------------------------ enforcement
create or replace function page_level(p_res text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when _is_full_access() then 'write'
    when current_app_role() = 'supervisor' and _supervisor_blocked(p_res) then 'hidden'
    else coalesce((select level from role_page_access where role = current_app_role() and resource = p_res), 'hidden')
  end;
$$;

create or replace function can_see_field(p_group text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when _is_full_access() then true
    when current_app_role() = 'supervisor' then false
    else coalesce((select visible from role_field_access where role = current_app_role() and field_group = p_group), false)
  end;
$$;

create or replace function column_visible(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when _is_full_access() then true
    when current_app_role() = 'supervisor' then false
    else coalesce((select visible from role_field_access where role = current_app_role() and field_group = 'col:' || p_key), true)
  end;
$$;

-- ------------------------------------------------------------ editable / defaults
-- the Director and Plant Head may configure the Supervisor's other pages; the locked part is forced by the triggers below
create or replace function _editable_role(p_role app_role) returns boolean
language sql immutable as $$
  select p_role in ('plant_head', 'accounts', 'qc', 'operator', 'viewer', 'supervisor');
$$;

create or replace function _default_level(p_role app_role, p_res text) returns text
language sql stable set search_path = public as $$
  select case
    when p_role = 'supervisor' and _supervisor_blocked(p_res) then 'hidden'
    when p_role = 'director' then 'write'
    when not coalesce((select writable from app_resources where key = p_res), true) then 'read'
    when p_role = 'viewer' then 'read'
    when p_res = 'products' and p_role not in ('plant_head', 'director') then 'read'
    else 'write' end;
$$;

create or replace function _default_field(p_role app_role, p_group text) returns boolean
language sql immutable as $$
  select case when p_role = 'supervisor' then false
              when p_group = 'margins' then p_role in ('director', 'plant_head')
              else p_role in ('director', 'plant_head', 'accounts') end;
$$;

-- a page added later: the Supervisor starts without it (like QC / Operator); the lock above applies to the locked sections anyway
create or replace function _new_page_level(p_role app_role, p_writable boolean) returns text
language sql immutable as $$
  select case
    when p_role in ('director', 'plant_head') then case when p_writable then 'write' else 'read' end
    when p_role = 'accounts' then case when p_writable then 'write' else 'read' end
    when p_role = 'viewer' then 'read'
    else 'hidden' end;
$$;

create or replace function trg_resource_role_rows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into role_page_access (role, resource, level)
    select r, new.key, _new_page_level(r, new.writable)
      from unnest(array['plant_head', 'accounts', 'qc', 'operator', 'viewer', 'supervisor']::app_role[]) r
  on conflict (role, resource) do nothing;
  return new;
end $$;

-- ------------------------------------------------------------ the stored settings can never unlock it
create or replace function trg_supervisor_lock_pages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'supervisor' and _supervisor_blocked(new.resource) then new.level := 'hidden'; end if;
  return new;
end $$;
drop trigger if exists role_page_access_supervisor_lock on role_page_access;
create trigger role_page_access_supervisor_lock before insert or update on role_page_access
  for each row execute function trg_supervisor_lock_pages();

create or replace function trg_supervisor_lock_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'supervisor' then new.visible := false; end if;
  return new;
end $$;
drop trigger if exists role_field_access_supervisor_lock on role_field_access;
create trigger role_field_access_supervisor_lock before insert or update on role_field_access
  for each row execute function trg_supervisor_lock_fields();

-- custom protected columns added later also get a (hidden) row for the Supervisor
create or replace function add_protected_columns(p_keys text[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  k text;
  c column_catalog;
  n int := 0;
begin
  perform _require_user();
  if not can_manage_masters() then raise exception 'Only the Director or Plant Head can change access settings.' using errcode = '42501'; end if;
  foreach k in array coalesce(p_keys, '{}') loop
    select * into c from column_catalog where key = k;
    if not found then raise exception 'Unknown column "%".', k; end if;
    insert into field_groups (key, label, description, sort, is_custom, catalog_key)
    values ('col:' || c.key, c.label, c.page_label, 100 + c.sort, true, c.key)
    on conflict (key) do nothing;
    if found then
      insert into role_field_access (role, field_group, visible)
        select r, 'col:' || c.key, (r = 'accounts') from unnest(array['accounts', 'qc', 'operator', 'viewer', 'supervisor']::app_role[]) r
      on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------ seed the Supervisor's rows
-- pages: locked ones hidden (trigger), view-only pages read, working pages write, product master read — set only once
insert into role_page_access (role, resource, level)
  select 'supervisor'::app_role, a.key, _default_level('supervisor', a.key) from app_resources a
on conflict (role, resource) do nothing;
-- fields: all hidden (trigger)
insert into role_field_access (role, field_group, visible)
  select 'supervisor'::app_role, g.key, false from field_groups g
on conflict (role, field_group) do nothing;
-- in case rows pre-exist
update role_page_access set level = 'hidden' where role = 'supervisor' and _supervisor_blocked(resource) and level <> 'hidden';
update role_field_access set visible = false where role = 'supervisor' and visible;

-- ------------------------------------------------------------ files outside the page checks
-- the purchase-order attachment bucket was readable by any active user; a RESTRICTIVE policy keeps the Supervisor out of it
-- (restrictive policies are ANDed with the existing ones, so nobody else is affected)
drop policy if exists po_attachments_no_supervisor on storage.objects;
create policy po_attachments_no_supervisor on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'po-attachments' or public.current_app_role() is distinct from 'supervisor')
  with check (bucket_id <> 'po-attachments' or public.current_app_role() is distinct from 'supervisor');

revoke all on function _supervisor_blocked(text), trg_supervisor_lock_pages(), trg_supervisor_lock_fields() from public, anon, authenticated;
grant execute on function _supervisor_blocked(text) to authenticated;
