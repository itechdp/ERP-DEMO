-- ============================================================
-- 76 · Dashboard utility widgets: allow editing a saved entry
-- ============================================================
-- Needs 75. Only adds UPDATE on the same two standalone tables (same rule as add / delete: active user, not the Viewer role).
-- Nothing else in the database is touched. Safe to run twice.

do $$
declare t text;
begin
  foreach t in array array['petty_cash_logs', 'quick_material_logs'] loop
    execute format('grant update on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (is_active_user() and current_app_role() <> ''viewer'') with check (is_active_user() and current_app_role() <> ''viewer'')', t || '_upd', t);
  end loop;
end $$;
