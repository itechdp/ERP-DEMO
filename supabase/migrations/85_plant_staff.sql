-- ============================================================
-- 85 · Plant Staff (Settings → Drop-down Lists → Plant Staff)
-- ============================================================
-- Needs 42. The old "Operators" list becomes the plant staff list: the real names of the supervisors, forgers, operators and
-- helpers on the shop floor. They do NOT need a login (logins are Settings → Users, migration 41). These names are offered in the
-- Workflow stage forms: "Checked By" and "Manpower / Forger".
--  · every name gets a designation: Supervisor, Forger, Operator or Helper (existing names become "Operator"; change them on the page)
--  · save_staff: add or change a name (name, designation, in use)
--  · delete_staff: remove a name for good. Saved stage records keep the name as text, so nothing that was already recorded changes.
--  · Who may: the Director and the Plant Head (can_manage_masters), the same as the other lists.
-- The machines and inspectors lists are not changed. Safe to run twice.

alter table operators add column if not exists designation text not null default 'Operator';

create or replace function save_staff(p_id bigint, p_name text, p_designation text, p_active boolean) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_des  text := btrim(coalesce(p_designation, ''));
  v_id   bigint;
begin
  perform _require_user();
  if not can_manage_masters() then raise exception 'Only the Director or Plant Head can change the plant staff list.' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'Enter the name.'; end if;
  if v_des not in ('Supervisor', 'Forger', 'Operator', 'Helper') then raise exception 'Choose the designation (Supervisor, Forger, Operator or Helper).'; end if;
  if exists (select 1 from operators where lower(name) = lower(v_name) and (p_id is null or id <> p_id)) then
    raise exception 'There is already a staff member named "%".', v_name;
  end if;
  if p_id is null then
    insert into operators (name, designation, active) values (v_name, v_des, coalesce(p_active, true)) returning id into v_id;
  else
    update operators set name = v_name, designation = v_des, active = coalesce(p_active, active) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'That staff member no longer exists. Reload the page.'; end if;
  end if;
  return v_id;
end $$;

create or replace function delete_staff(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  if not can_manage_masters() then raise exception 'Only the Director or Plant Head can change the plant staff list.' using errcode = '42501'; end if;
  delete from operators where id = p_id;
  if not found then raise exception 'That staff member no longer exists. Reload the page.'; end if;
end $$;

revoke all on function save_staff(bigint, text, text, boolean), delete_staff(bigint) from public, anon;
grant execute on function save_staff(bigint, text, text, boolean), delete_staff(bigint) to authenticated;
