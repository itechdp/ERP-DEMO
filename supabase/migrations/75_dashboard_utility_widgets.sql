-- ============================================================
-- 75 · Dashboard utility widgets: Petty Cash Tracker + Quick Material Log
-- ============================================================
-- Two STANDALONE scratch tables. They are deliberately not linked to inventory, accounting, ledger or any master.
-- Any active user except the read-only Viewer role may read, add and delete rows. Safe to run twice.

create table if not exists petty_cash_logs (
  id          bigint generated always as identity primary key,
  entry_date  date          not null default current_date,
  amount      numeric(12,2) not null check (amount > 0),
  description text          not null check (length(btrim(description)) > 0),
  created_by  uuid          default auth.uid(),
  created_at  timestamptz   not null default now()
);
create index if not exists petty_cash_logs_date_idx on petty_cash_logs (entry_date desc, id desc);

create table if not exists quick_material_logs (
  id            bigint generated always as identity primary key,
  entry_date    date          not null default current_date,
  weight_kg     numeric(12,2) not null check (weight_kg > 0),
  material_name text          not null check (length(btrim(material_name)) > 0),
  created_by    uuid          default auth.uid(),
  created_at    timestamptz   not null default now()
);
create index if not exists quick_material_logs_date_idx on quick_material_logs (entry_date desc, id desc);

do $$
declare t text;
begin
  foreach t in array array['petty_cash_logs', 'quick_material_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for select to authenticated using (is_active_user())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (is_active_user() and current_app_role() <> ''viewer'')', t || '_ins', t);
    execute format('create policy %I on public.%I for delete to authenticated using (is_active_user() and current_app_role() <> ''viewer'')', t || '_del', t);
  end loop;
end $$;
