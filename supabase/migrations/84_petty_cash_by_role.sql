-- ============================================================
-- 84 · Petty Cash Tracker: each role sees only its own entries
-- ============================================================
-- Needs 75 and 76. Before this, every role read the same petty cash list, so a Supervisor's expense showed on the Director's and the
-- Plant Head's dashboards. Now:
--  · every entry records the role of the person who added it (created_role, filled in by the database, not by the app)
--  · reading, editing and deleting are limited to entries of the reader's own role, so the list and the total on the dashboard card
--    are per role (every Supervisor shares the Supervisor list, every Director the Director list, and so on)
--  · entries saved before this migration get the role of the user who created them (created_by → profiles.role). An old entry
--    whose creator is unknown keeps created_role = null and is shown to no one (it stays in the table; nothing is deleted).
-- The Quick Material Log is not changed. Safe to run twice.

alter table petty_cash_logs add column if not exists created_role app_role;

update petty_cash_logs p
   set created_role = pr.role
  from profiles pr
 where p.created_by = pr.id
   and p.created_role is null;

alter table petty_cash_logs alter column created_role set default current_app_role();
create index if not exists petty_cash_logs_role_date_idx on petty_cash_logs (created_role, entry_date desc, id desc);

-- the role is always the saver's own role: it cannot be typed in by the app, and an entry cannot be moved to another role later
create or replace function _petty_cash_set_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_role := current_app_role();
    new.created_by := auth.uid();
  else
    new.created_role := old.created_role;
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
drop trigger if exists petty_cash_set_role on petty_cash_logs;
create trigger petty_cash_set_role before insert or update on petty_cash_logs
  for each row execute function _petty_cash_set_role();

drop policy if exists petty_cash_logs_read on petty_cash_logs;
drop policy if exists petty_cash_logs_ins on petty_cash_logs;
drop policy if exists petty_cash_logs_upd on petty_cash_logs;
drop policy if exists petty_cash_logs_del on petty_cash_logs;

create policy petty_cash_logs_read on petty_cash_logs for select to authenticated
  using (is_active_user() and created_role = current_app_role());
create policy petty_cash_logs_ins on petty_cash_logs for insert to authenticated
  with check (is_active_user() and current_app_role() <> 'viewer' and created_role = current_app_role());
create policy petty_cash_logs_upd on petty_cash_logs for update to authenticated
  using (is_active_user() and current_app_role() <> 'viewer' and created_role = current_app_role())
  with check (is_active_user() and current_app_role() <> 'viewer' and created_role = current_app_role());
create policy petty_cash_logs_del on petty_cash_logs for delete to authenticated
  using (is_active_user() and current_app_role() <> 'viewer' and created_role = current_app_role());
