-- 42 · Customer master, editable drop-down lists and materials.
-- Needs 02, 14 and 18. Safe to run twice.
--
--  * customers gets the details a customer page needs (code, contact, phone, e-mail, address, GSTIN, payment terms …).
--    The list follows the "Party names" setting like before. Pages pick a customer from this list instead of typing the name.
--  * dropdown_lists: the editable lists (bar sizes, lost reasons, payment modes, departments …). One row per list, the items in order.
--  * save_material / delete_material: add or change a raw material (the Material drop-down), save_master_name: machines, operators, inspectors.
--  * Who may edit: the Director / Plant Head always; others only the list that belongs to a page they have Write access to.

-- ============================================================ 1. customers
alter table customers
  add column if not exists code          text not null default '',
  add column if not exists contact       text not null default '',
  add column if not exists phone         text not null default '',
  add column if not exists email         text not null default '',
  add column if not exists address       text not null default '',
  add column if not exists city          text not null default '',
  add column if not exists state         text not null default '',
  add column if not exists gstin         text not null default '',
  add column if not exists payment_terms text not null default '',
  add column if not exists notes         text not null default '',
  add column if not exists updated_at    timestamptz not null default now();

-- the customer page (Sales & Orders); everybody who may see party names can read the list
do $$
declare v_new boolean := not exists (select 1 from app_resources where key = 'customers');
begin
  insert into app_resources (key, label, section, sort, writable) values
    ('customers', 'Customers', 'Sales & Orders', 10, true)
  on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;
  if v_new then
    update role_page_access set level = case when role in ('qc', 'operator') then 'hidden' when role = 'viewer' then 'read' else 'write' end
     where resource = 'customers' and role not in ('director', 'plant_head');
  end if;
end $$;

-- may this person add / change customers? (the customer page, or any page that picks a customer)
create or replace function _may_edit_customers() returns boolean
language sql stable security definer set search_path = public as $$
  select can_see_field('party_names') and (
    can_manage_masters()
    or page_level('customers') = 'write' or page_level('sales_quotation') = 'write' or page_level('sales_orders') = 'write'
    or page_level('inquiries') = 'write' or page_level('job_work') = 'write' or page_level('products') = 'write'
  )
$$;

create or replace function save_customer(p_id bigint, p_payload jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_id   bigint := p_id;
begin
  perform _require_user();
  if not _may_edit_customers() then raise exception 'You do not have permission to change customers.' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'Enter the customer name.'; end if;
  if exists (select 1 from customers where lower(btrim(name)) = lower(v_name) and id is distinct from p_id) then
    raise exception 'A customer named "%" already exists.', v_name;
  end if;
  if v_id is null then
    insert into customers (name, code, contact, phone, email, address, city, state, gstin, payment_terms, notes, active)
    values (v_name, btrim(coalesce(p_payload ->> 'code', '')), btrim(coalesce(p_payload ->> 'contact', '')), btrim(coalesce(p_payload ->> 'phone', '')),
            btrim(coalesce(p_payload ->> 'email', '')), btrim(coalesce(p_payload ->> 'address', '')), btrim(coalesce(p_payload ->> 'city', '')),
            btrim(coalesce(p_payload ->> 'state', '')), upper(btrim(coalesce(p_payload ->> 'gstin', ''))), btrim(coalesce(p_payload ->> 'payment_terms', '')),
            btrim(coalesce(p_payload ->> 'notes', '')), coalesce((p_payload ->> 'active')::boolean, true))
    returning id into v_id;
  else
    update customers set name = v_name, code = btrim(coalesce(p_payload ->> 'code', '')), contact = btrim(coalesce(p_payload ->> 'contact', '')),
           phone = btrim(coalesce(p_payload ->> 'phone', '')), email = btrim(coalesce(p_payload ->> 'email', '')), address = btrim(coalesce(p_payload ->> 'address', '')),
           city = btrim(coalesce(p_payload ->> 'city', '')), state = btrim(coalesce(p_payload ->> 'state', '')), gstin = upper(btrim(coalesce(p_payload ->> 'gstin', ''))),
           payment_terms = btrim(coalesce(p_payload ->> 'payment_terms', '')), notes = btrim(coalesce(p_payload ->> 'notes', '')),
           active = coalesce((p_payload ->> 'active')::boolean, active), updated_at = now()
     where id = v_id;
    if not found then raise exception 'That customer no longer exists.'; end if;
  end if;
  return v_id;
end $$;

-- ============================================================ 2. editable drop-down lists
create table if not exists dropdown_lists (
  list_key   text primary key,
  items      jsonb not null default '[]'::jsonb,        -- ["Price High", "Delivery Time High", …] in the order shown
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table dropdown_lists enable row level security;
grant select on dropdown_lists to authenticated;
drop policy if exists dropdown_lists_read on dropdown_lists;
create policy dropdown_lists_read on dropdown_lists for select to authenticated using (is_active_user());
revoke insert, update, delete on dropdown_lists from authenticated;

-- which page's Write access lets a person add to a list from its own form
create or replace function _list_resource(p_key text) returns text
language sql immutable as $$
  select case p_key when 'od_size' then 'raw_inventory' when 'lost_reason' then 'sales_quotation' when 'payment_mode' then 'purchase_payments' when 'department' then 'purchase_requisitions' end
$$;

create or replace function save_dropdown_list(p_key text, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res   text := _list_resource(p_key);
  v_clean jsonb;
begin
  perform _require_user();
  if v_res is null then raise exception 'Unknown list "%".', p_key; end if;
  if not (can_manage_masters() or page_level(v_res) = 'write') then
    raise exception 'You do not have permission to change this list.' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'The list must be an array.'; end if;
  -- trimmed, not empty, no repeats (any case), in the order given
  select coalesce(jsonb_agg(v order by o), '[]'::jsonb) into v_clean
    from (select distinct on (lower(btrim(x.value))) btrim(x.value) as v, x.ord as o
            from jsonb_array_elements_text(p_items) with ordinality as x(value, ord)
           where btrim(x.value) <> '' and length(btrim(x.value)) <= 80
           order by lower(btrim(x.value)), x.ord) s;
  if jsonb_array_length(v_clean) = 0 then raise exception 'A list needs at least one item.'; end if;
  if p_key = 'od_size' and exists (select 1 from jsonb_array_elements_text(v_clean) e where e !~ '^[0-9]+(\.[0-9]+)?$') then
    raise exception 'Bar sizes must be numbers (mm).';
  end if;
  insert into dropdown_lists (list_key, items, updated_at, updated_by) values (p_key, v_clean, now(), auth.uid())
  on conflict (list_key) do update set items = excluded.items, updated_at = now(), updated_by = auth.uid();
end $$;

-- ============================================================ 3. materials, machines, operators, inspectors
create or replace function save_material(p_old text, p_family text, p_material text, p_grade text, p_density numeric, p_default_od numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_material, ''));
begin
  perform _require_user();
  if not (can_manage_masters() or page_level('raw_inventory') = 'write' or page_level('products') = 'write') then
    raise exception 'You do not have permission to change materials.' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'Enter the material name.'; end if;
  if btrim(coalesce(p_family, '')) = '' then raise exception 'Choose or enter the material family.'; end if;
  if btrim(coalesce(p_grade, '')) = '' then raise exception 'Enter the grade / specification.'; end if;
  if coalesce(p_density, 0) <= 0 then raise exception 'Enter the density (g/cm³).'; end if;
  if coalesce(p_default_od, 0) <= 0 then raise exception 'Enter the usual bar size (mm).'; end if;
  if exists (select 1 from material_master where lower(material) = lower(v_name) and material is distinct from p_old) then
    raise exception 'The material "%" already exists.', v_name;
  end if;
  if p_old is null or p_old = '' then
    insert into material_master (material, family, grade, density, default_od) values (v_name, btrim(p_family), btrim(p_grade), p_density, p_default_od);
  else
    update material_master set material = v_name, family = btrim(p_family), grade = btrim(p_grade), density = p_density, default_od = p_default_od where material = p_old;
    if not found then raise exception 'That material no longer exists.'; end if;
  end if;
end $$;

create or replace function delete_material(p_material text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  if not can_manage_masters() then raise exception 'Only the Director or Plant Head can delete a material.' using errcode = '42501'; end if;
  if exists (select 1 from raw_material_lots where material = p_material) or exists (select 1 from products where material = p_material) or exists (select 1 from jobs where material = p_material) then
    raise exception 'The material "%" is already used by stock, products or jobs, so it cannot be deleted.', p_material;
  end if;
  delete from hardness_specs where material = p_material;
  delete from material_master where material = p_material;
end $$;

-- p_kind: machine | operator | inspector     (machines belong to a process stage)
create or replace function save_master_name(p_kind text, p_id bigint, p_name text, p_stage text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  perform _require_user();
  if not can_manage_masters() then raise exception 'Only the Director or Plant Head can change these lists.' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'Enter the name.'; end if;
  if p_kind = 'machine' then
    if p_stage is null or p_stage not in ('cutting', 'forging', 'trimming', 'heatTreatment') then raise exception 'Choose the process the machine belongs to.'; end if;
    if p_id is null then insert into machines (name, stage, active) values (v_name, p_stage::process_stage, coalesce(p_active, true));
    else update machines set name = v_name, stage = p_stage::process_stage, active = coalesce(p_active, active) where id = p_id; end if;
  elsif p_kind = 'operator' then
    if p_id is null then insert into operators (name, active) values (v_name, coalesce(p_active, true));
    else update operators set name = v_name, active = coalesce(p_active, active) where id = p_id; end if;
  elsif p_kind = 'inspector' then
    if p_id is null then insert into inspectors (name, active) values (v_name, coalesce(p_active, true));
    else update inspectors set name = v_name, active = coalesce(p_active, active) where id = p_id; end if;
  else
    raise exception 'Unknown list "%".', p_kind;
  end if;
exception when unique_violation then
  raise exception 'There is already an entry named "%".', v_name;
end $$;

revoke all on function _may_edit_customers(), _list_resource(text) from public, anon, authenticated;
revoke all on function save_customer(bigint, jsonb), save_dropdown_list(text, jsonb), save_material(text, text, text, text, numeric, numeric),
                       delete_material(text), save_master_name(text, bigint, text, text, boolean) from public, anon;
grant execute on function save_customer(bigint, jsonb), save_dropdown_list(text, jsonb), save_material(text, text, text, text, numeric, numeric),
                          delete_material(text), save_master_name(text, bigint, text, text, boolean) to authenticated;
