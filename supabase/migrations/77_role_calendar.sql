-- ============================================================
-- 77 · Role-based Calendar (dashboard widget)
-- ============================================================
-- One new table. It reuses what the system already has: the app_role list, profiles (the signed-in user's role) and the
-- helper functions current_app_role() / is_active_user(). Nothing existing is changed. Safe to run twice.
--
--   role_id   the role the event belongs to (director, plant_head, accounts, qc, operator, viewer)
--   user_id   who created it
--
-- Who sees what is decided HERE, in the database, not in the screen:
--   * a person can only read the events of their OWN role (a Director never sees Plant Head events, and the other way round);
--   * a person can only add an event for their OWN role, as themselves;
--   * a person can change or delete only the events they created themselves.
-- The app also passes the role when it asks for events, but that is a convenience: the policies below are what protect the data.

create table if not exists calendar_events (
  id         bigint generated always as identity primary key,
  title      text      not null check (length(btrim(title)) > 0),
  date       date      not null,
  time       time      not null,
  kind       text      not null default 'meeting' check (kind in ('meeting', 'task')),
  role_id    app_role  not null default current_app_role(),
  user_id    uuid      not null default auth.uid() references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists calendar_events_role_date_idx on calendar_events (role_id, date, time);

alter table calendar_events enable row level security;
revoke all on calendar_events from anon, authenticated;
grant select, insert, update, delete on calendar_events to authenticated;

drop policy if exists calendar_events_read on calendar_events;
drop policy if exists calendar_events_ins  on calendar_events;
drop policy if exists calendar_events_upd  on calendar_events;
drop policy if exists calendar_events_del  on calendar_events;

create policy calendar_events_read on calendar_events for select to authenticated
  using (is_active_user() and role_id = current_app_role());

create policy calendar_events_ins on calendar_events for insert to authenticated
  with check (is_active_user() and role_id = current_app_role() and user_id = auth.uid());

create policy calendar_events_upd on calendar_events for update to authenticated
  using (is_active_user() and role_id = current_app_role() and user_id = auth.uid())
  with check (is_active_user() and role_id = current_app_role() and user_id = auth.uid());

create policy calendar_events_del on calendar_events for delete to authenticated
  using (is_active_user() and role_id = current_app_role() and user_id = auth.uid());
