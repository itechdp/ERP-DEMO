-- Demo Supervisor login (matches src/auth/users.ts). Run AFTER migrations 80 and 81, in the Supabase SQL editor as the project owner.
-- Same inserts as create_user() (migration 41). Delete this user when the demo is over.
do $$
declare v_id uuid := gen_random_uuid();
begin
  if exists (select 1 from auth.users where lower(email) = 'supervisor@forgeflow.local') then return; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', 'supervisor@forgeflow.local',
          extensions.crypt('Super@12345', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Supervisor"}'::jsonb, now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, jsonb_build_object('sub', v_id::text, 'email', 'supervisor@forgeflow.local', 'email_verified', true),
          'email', v_id::text, null, now(), now());
  insert into profiles (id, full_name, role, active) values (v_id, 'Supervisor', 'supervisor', true)
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, active = true;
end $$;
