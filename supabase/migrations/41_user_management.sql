-- 41 · User management (Settings → Users): add people, change their name / role, switch them off, set a new password.
-- Needs 02 and 18. Safe to run twice.
--
--  * Who may: the Director and the Plant Head (can_manage_masters). Only the Director may create, change or reset a Director /
--    Plant Head account — so a Plant Head cannot promote anybody (or themselves) to a higher role.
--  * Nobody can change their own role or switch themselves off (that would lock the last administrator out).
--  * A login is created exactly like the demo seed does (auth.users + auth.identities); the profile row comes from the existing trigger.
--  * Names must be unique among active users: a task is assigned to a person by name.
--  * Users are switched off, never deleted — their history (who created / checked what) stays.

create extension if not exists pgcrypto with schema extensions;

create or replace function _require_user_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_user();
  if not can_manage_masters() then
    raise exception 'Only the Director or Plant Head can manage users.' using errcode = '42501';
  end if;
end $$;

-- the senior roles are the Director's to hand out
create or replace function _may_manage_role(p_role app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select _is_system() or current_app_role() = 'director' or p_role not in ('director', 'plant_head')
$$;

create or replace function list_users() returns table (
  id uuid, email text, full_name text, role text, active boolean, created_at timestamptz, last_sign_in_at timestamptz, is_me boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_user_admin();
  return query
    select p.id, u.email::text, p.full_name, p.role::text, p.active, p.created_at, u.last_sign_in_at, (p.id = auth.uid())
      from profiles p join auth.users u on u.id = p.id
     order by p.active desc, p.full_name;
end $$;

create or replace function create_user(p_email text, p_password text, p_full_name text, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name  text := btrim(coalesce(p_full_name, ''));
  v_role  app_role;
  v_id    uuid := gen_random_uuid();
begin
  perform _require_user_admin();
  if v_name = '' then raise exception 'Enter the name.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid e-mail address.'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'The password must have at least 8 characters.'; end if;
  begin v_role := p_role::app_role; exception when others then raise exception 'Choose a role.'; end;
  if not _may_manage_role(v_role) then raise exception 'Only the Director can create a % account.', replace(p_role, '_', ' ') using errcode = '42501'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then raise exception 'A user with the e-mail % already exists.', v_email; end if;
  if exists (select 1 from profiles where active and lower(btrim(full_name)) = lower(v_name)) then
    raise exception 'There is already a user named "%". Names must be different, because tasks are assigned by name.', v_name;
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v_name), now(), now(),
          '', '', '', '');
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', v_id::text, null, now(), now());

  -- the profile is created by the trigger on auth.users; give it the name and role
  insert into profiles (id, full_name, role, active) values (v_id, v_name, v_role, true)
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, active = true;
  return v_id;
end $$;

create or replace function update_user(p_id uuid, p_full_name text, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
  v_role app_role;
  cur    profiles;
begin
  perform _require_user_admin();
  select * into cur from profiles where id = p_id;
  if not found then raise exception 'That user does not exist.'; end if;
  if v_name = '' then raise exception 'Enter the name.'; end if;
  begin v_role := p_role::app_role; exception when others then raise exception 'Choose a role.'; end;
  if not (_may_manage_role(cur.role) and _may_manage_role(v_role)) then
    raise exception 'Only the Director can change a Director or Plant Head account.' using errcode = '42501';
  end if;
  if p_id = auth.uid() and (v_role <> cur.role or not p_active) then
    raise exception 'You cannot change your own role or switch yourself off.';
  end if;
  if p_active and exists (select 1 from profiles where id <> p_id and active and lower(btrim(full_name)) = lower(v_name)) then
    raise exception 'There is already a user named "%". Names must be different, because tasks are assigned by name.', v_name;
  end if;
  update profiles set full_name = v_name, role = v_role, active = coalesce(p_active, active) where id = p_id;
end $$;

create or replace function reset_user_password(p_id uuid, p_password text) returns void
language plpgsql security definer set search_path = public as $$
declare cur profiles;
begin
  perform _require_user_admin();
  select * into cur from profiles where id = p_id;
  if not found then raise exception 'That user does not exist.'; end if;
  if not _may_manage_role(cur.role) then raise exception 'Only the Director can reset the password of a Director or Plant Head.' using errcode = '42501'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'The password must have at least 8 characters.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_id;
end $$;

revoke all on function _require_user_admin(), _may_manage_role(app_role) from public, anon, authenticated;
revoke all on function list_users(), create_user(text, text, text, text), update_user(uuid, text, text, boolean), reset_user_password(uuid, text) from public, anon;
grant execute on function list_users(), create_user(text, text, text, text), update_user(uuid, text, text, boolean), reset_user_password(uuid, text) to authenticated;
