-- 39 · Task assignment: notifications, time tracking, Work Hub.
-- Needs 18 and 21–23. Safe to run twice.
--
--  * sales_records (kind = 'task') gets assigned_to (a user), assigned_at, started_at, completed_at — filled by a trigger from the
--    assignee name and the status, so the existing save function needs no change.
--  * notifications: a task assigned to someone (or re-assigned) notifies them; a finished task notifies whoever created it.
--    The app shows what is unseen (while signed in, and on the next sign-in) and marks it seen once the person has dismissed it.
--  * v_tasks: the task list with who assigned it and the times; set_task_status(): the assignee (or a user with Write on Task
--    Assignment) moves a task Open → In Progress → Done.
--  * v_assignable_users: the people a task can be given to.
--  * the new "Work Hub" page (Main Menu).

-- ============================================================ 1. columns
alter table sales_records
  add column if not exists assigned_to  uuid references profiles (id) on delete set null,
  add column if not exists assigned_at  timestamptz,
  add column if not exists started_at   timestamptz,
  add column if not exists completed_at timestamptz;
create index if not exists sales_records_assigned_idx on sales_records (assigned_to) where kind = 'task';

-- ============================================================ 2. notifications
create table if not exists notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles (id) on delete cascade,
  kind       text not null default 'info',
  title      text not null,
  message    text not null default '',
  link       text not null default '',          -- the app route to open, e.g. task-assignment?edit=12&view=1
  urgency    text not null default '',
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists notifications_unseen_idx on notifications (user_id, created_at desc) where seen_at is null;
alter table notifications enable row level security;
revoke all on notifications from anon, authenticated;       -- clients use the two functions below

create or replace function my_notifications(p_unseen_only boolean default true) returns setof notifications
language sql stable security definer set search_path = public as $$
  select * from notifications
   where user_id = auth.uid() and (not p_unseen_only or seen_at is null)
   order by created_at desc, id desc
   limit 50
$$;

create or replace function mark_notifications_seen(p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update notifications set seen_at = now() where user_id = auth.uid() and seen_at is null and id = any (p_ids)
$$;

revoke all on function my_notifications(boolean), mark_notifications_seen(bigint[]) from public, anon;
grant execute on function my_notifications(boolean), mark_notifications_seen(bigint[]) to authenticated;

-- ============================================================ 3. task triggers
create or replace function trg_task_track() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_changed boolean := true;
begin
  if new.kind <> 'task' then return new; end if;

  -- the assignee name picks the user
  if tg_op = 'UPDATE' then v_changed := new.assignee is distinct from old.assignee; end if;
  if v_changed then
    new.assigned_to := case when btrim(new.assignee) = '' then null
                            else (select p.id from profiles p where p.active and lower(btrim(p.full_name)) = lower(btrim(new.assignee)) limit 1) end;
    if new.assigned_to is not null then new.assigned_at := now(); else new.assigned_at := null; end if;
  end if;

  -- the times follow the status
  if new.status = 'In Progress' and new.started_at is null then new.started_at := now(); end if;
  if new.status = 'Done' then
    if new.completed_at is null then new.completed_at := now(); end if;
  else
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists sales_records_task_track on sales_records;
create trigger sales_records_task_track before insert or update on sales_records
  for each row execute function trg_task_track();

create or replace function trg_task_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_who   text := coalesce((select full_name from profiles where id = v_me), 'Someone');
  v_title text := coalesce(nullif(new.title, ''), new.doc_no);
  v_urg   text := coalesce(nullif(new.priority, ''), '');
  v_link  text := 'task-assignment?edit=' || new.id || '&view=1';
  v_given boolean := true;
  v_done  boolean := false;
begin
  if new.kind <> 'task' then return new; end if;
  if tg_op = 'UPDATE' then
    v_given := new.assigned_to is distinct from old.assigned_to;
    v_done  := new.status = 'Done' and old.status is distinct from 'Done';
  end if;

  -- given to somebody (new task, or re-assigned)
  if new.assigned_to is not null and new.assigned_to is distinct from v_me and v_given then
    insert into notifications (user_id, kind, title, message, link, urgency)
    values (new.assigned_to, 'task_assigned',
            case when v_urg in ('High', 'Urgent') then v_urg || ' task assigned to you' else 'New task assigned to you' end,
            v_title || ' — by ' || v_who || case when new.due_date is not null then ' · due ' || to_char(new.due_date, 'DD-MM-YYYY') else '' end,
            v_link, v_urg);
  end if;

  -- finished: tell whoever created it
  if v_done
     and new.created_by is not null and new.created_by is distinct from v_me
     and exists (select 1 from profiles where id = new.created_by and active) then
    insert into notifications (user_id, kind, title, message, link, urgency)
    values (new.created_by, 'task_done', 'Task completed', v_title || ' — marked done by ' || v_who, v_link, v_urg);
  end if;
  return new;
end $$;

drop trigger if exists sales_records_task_notify on sales_records;
create trigger sales_records_task_notify after insert or update on sales_records
  for each row execute function trg_task_notify();

-- ============================================================ 4. views and the status function
create or replace view v_assignable_users as
select p.id, p.full_name, p.role::text as role
  from profiles p
 where p.active and btrim(p.full_name) <> '' and is_active_user();

create or replace view v_tasks as
select r.id, r.doc_no, r.doc_date, r.title, r.priority, r.status, r.assignee, r.assigned_to, r.ref_no, r.due_date, r.remarks,
       r.created_at, r.updated_at, r.assigned_at, r.started_at, r.completed_at,
       (select p.full_name from profiles p where p.id = r.created_by) as assigned_by,
       (r.assigned_to is not null and r.assigned_to = auth.uid()) as mine
  from sales_records r
 where r.kind = 'task' and is_active_user()
   and (r.assigned_to = auth.uid() or page_level('task_assignment') in ('read', 'write') or page_level('work_hub') = 'write');

grant select on v_assignable_users, v_tasks to authenticated;
revoke all on v_assignable_users, v_tasks from anon;

create or replace function set_task_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare t sales_records;
begin
  perform _require_user();
  if p_status not in ('Open', 'In Progress', 'Done', 'Cancelled') then raise exception 'Choose a valid status.'; end if;
  select * into t from sales_records where id = p_id and kind = 'task' for update;
  if not found then raise exception 'That task no longer exists.'; end if;
  if not (t.assigned_to is not null and t.assigned_to = auth.uid()) and page_level('task_assignment') <> 'write' then
    raise exception 'Only the person the task is assigned to, or someone with Write access to Task Assignment, can change it.' using errcode = '42501';
  end if;
  update sales_records set status = p_status, updated_at = now() where id = p_id;
end $$;

revoke all on function set_task_status(bigint, text) from public, anon;
grant execute on function set_task_status(bigint, text) to authenticated;

-- ============================================================ 5. the Work Hub page
-- everybody can open it (what they see inside still follows their own page access); only the viewer role is read-only.
-- Set once, when the page is first registered, so a later change in Settings → Access Control is kept.
do $$
declare v_new boolean := not exists (select 1 from app_resources where key = 'work_hub');
begin
  insert into app_resources (key, label, section, sort, writable) values
    ('work_hub', 'Work Hub', 'Main Menu', 12, true)
  on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;
  if v_new then
    update role_page_access set level = case when role = 'viewer' then 'read' else 'write' end where resource = 'work_hub';
  end if;
end $$;
