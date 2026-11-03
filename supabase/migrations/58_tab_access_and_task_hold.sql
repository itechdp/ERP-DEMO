-- ============================================================
-- 58 · Tab access in Access Control, Work Hub tabs, and "On Hold" for tasks
-- ============================================================
--  A. Every tab of a page is now an item of its own in Settings → Access Control (listed under its page as "Page › Tab"), so a role can be
--     given or refused each tab. A tab starts with the SAME access as its page, except the Work Hub tabs:
--       · Work Hub (overview of everybody's work) — Plant Head only (the Director always has everything); other roles do not see it
--       · My Tasks                                 — everybody
--       · Task Assignment                          — the roles that had the Task Assignment page
--  B. Tasks can be put On Hold. The time taken stops counting while a task is on hold (held_seconds / hold_started_at).
-- Needs 18 (access control) and 39 (tasks). Safe to run twice: existing settings are never overwritten.

-- ---------------------------------------------------------------- A. the tabs
insert into app_resources (key, label, section, sort, writable) values
  ('work_hub__overview', 'Work Hub › Work Hub', 'Main Menu', 12, true),
  ('work_hub__mytasks', 'Work Hub › My Tasks', 'Main Menu', 12, true),
  ('work_hub__assignment', 'Work Hub › Task Assignment', 'Main Menu', 12, true),
  ('quotation_approvals__pending', 'Quotation Approvals › Waiting for approval', 'Sales & Orders', 14, true),
  ('quotation_approvals__decided', 'Quotation Approvals › Decided', 'Sales & Orders', 14, true),
  ('procurement_po__items', 'Purchase Orders › Items & Receipt Progress', 'Purchase & Procurement', 20, true),
  ('procurement_po__receipts', 'Purchase Orders › Receipts', 'Purchase & Procurement', 20, true),
  ('procurement_po__approvals', 'Purchase Orders › Approval Trail', 'Purchase & Procurement', 20, true),
  ('procurement_po__revisions', 'Purchase Orders › Revision History', 'Purchase & Procurement', 20, true),
  ('purchase_invoices__lines', 'Purchase Invoices › Lines & Three-way Match', 'Purchase & Procurement', 28, true),
  ('purchase_invoices__payments', 'Purchase Invoices › Payments', 'Purchase & Procurement', 28, true),
  ('raw_inventory__stock', 'Raw Material Inventory › Raw Material Stock', 'Main Menu', 13, true),
  ('raw_inventory__inward', 'Raw Material Inventory › Inward Register', 'Main Menu', 13, true),
  ('raw_inventory__issues', 'Raw Material Inventory › Issues to Production', 'Main Menu', 13, true),
  ('qc__register', 'Quality Control (QC) › Inspection Register', 'Workflow', 80, true),
  ('qc__hardness', 'Quality Control (QC) › Hardness Reports', 'Workflow', 80, true),
  ('qc__dimension', 'Quality Control (QC) › Dimension Reports', 'Workflow', 80, true),
  ('job_work__batches', 'Job Work In › Job Work In', 'Workflow', 110, true),
  ('job_work__report', 'Job Work In › Job Card Report', 'Workflow', 110, true),
  ('die_details__forging', 'Die Analytics & History › Forging Dies', 'Die Management', 150, true),
  ('die_details__trimming', 'Die Analytics & History › Trimming Dies', 'Die Management', 150, true),
  ('die_details__history', 'Die Analytics & History › Die History', 'Die Management', 150, true),
  ('die_details__images', 'Die Analytics & History › Images & Drawings', 'Die Management', 150, true)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort;

with _tabs(parent, tab, tab_label) as (values
  ('work_hub', 'overview', 'Work Hub'), ('work_hub', 'mytasks', 'My Tasks'), ('work_hub', 'assignment', 'Task Assignment'),
  ('qc', 'register', 'Inspection Register'), ('qc', 'hardness', 'Hardness Reports'), ('qc', 'dimension', 'Dimension Reports'),
  ('job_work', 'batches', 'Job Work In'), ('job_work', 'report', 'Job Card Report'),
  ('raw_inventory', 'stock', 'Raw Material Stock'), ('raw_inventory', 'inward', 'Inward Register'), ('raw_inventory', 'issues', 'Issues to Production'),
  ('die_details', 'forging', 'Forging Dies'), ('die_details', 'trimming', 'Trimming Dies'), ('die_details', 'history', 'Die History'), ('die_details', 'images', 'Images & Drawings'),
  ('procurement_po', 'items', 'Items & Receipt Progress'), ('procurement_po', 'receipts', 'Receipts'), ('procurement_po', 'approvals', 'Approval Trail'), ('procurement_po', 'revisions', 'Revision History'),
  ('purchase_invoices', 'lines', 'Lines & Three-way Match'), ('purchase_invoices', 'payments', 'Payments'),
  ('quotation_approvals', 'pending', 'Waiting for approval'), ('quotation_approvals', 'decided', 'Decided'))
insert into role_page_access (role, resource, level)
select a.role, t.parent || '__' || t.tab,
       case
         when t.parent || '__' || t.tab = 'work_hub__overview'   then case when a.role = 'plant_head' then 'write' else 'hidden' end
         when t.parent || '__' || t.tab = 'work_hub__assignment' then coalesce((select b.level from role_page_access b where b.role = a.role and b.resource = 'task_assignment'), 'hidden')
         else a.level
       end
  from role_page_access a join _tabs t on t.parent = a.resource
on conflict (role, resource) do nothing;

-- ---------------------------------------------------------------- B. tasks: On Hold
alter table sales_records
  add column if not exists held_seconds    int not null default 0,
  add column if not exists hold_started_at timestamptz;

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

  -- on hold: the time on hold is counted so the time taken can leave it out
  if tg_op = 'UPDATE' then
    if new.status = 'On Hold' and old.status is distinct from 'On Hold' then
      new.hold_started_at := now();
    elsif old.status = 'On Hold' and new.status is distinct from 'On Hold' then
      new.held_seconds := coalesce(old.held_seconds, 0) + greatest(0, extract(epoch from (now() - coalesce(old.hold_started_at, now())))::int);
      new.hold_started_at := null;
    end if;
  end if;
  return new;
end $$;

create or replace function set_task_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare t sales_records;
begin
  perform _require_user();
  if p_status not in ('Open', 'In Progress', 'On Hold', 'Done', 'Cancelled') then raise exception 'Choose a valid status.'; end if;
  select * into t from sales_records where id = p_id and kind = 'task' for update;
  if not found then raise exception 'That task no longer exists.'; end if;
  if not (t.assigned_to is not null and t.assigned_to = auth.uid()) and page_level('task_assignment') <> 'write' then
    raise exception 'Only the person the task is assigned to, or someone with Write access to Task Assignment, can change it.' using errcode = '42501';
  end if;
  update sales_records set status = p_status, updated_at = now() where id = p_id;
end $$;

-- the same view as before plus the hold figures at the end (a view can only gain columns at the end)
create or replace view v_tasks as
select r.id, r.doc_no, r.doc_date, r.title, r.priority, r.status, r.assignee, r.assigned_to, r.ref_no, r.due_date, r.remarks,
       r.created_at, r.updated_at, r.assigned_at, r.started_at, r.completed_at,
       (select p.full_name from profiles p where p.id = r.created_by) as assigned_by,
       (r.assigned_to is not null and r.assigned_to = auth.uid()) as mine,
       r.held_seconds, r.hold_started_at
  from sales_records r
 where r.kind = 'task' and is_active_user()
   and (r.assigned_to = auth.uid() or page_level('task_assignment') in ('read', 'write') or page_level('work_hub') = 'write');
grant select on v_tasks to authenticated;
revoke all on v_tasks from anon;

-- ---------------------------------------------------------------- C. task notifications now open the Work Hub (My Tasks tab)
-- (the same function as in 39; only the link changed, so a person who has no Task Assignment page still lands where their task is)
create or replace function trg_task_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_who   text := coalesce((select full_name from profiles where id = v_me), 'Someone');
  v_title text := coalesce(nullif(new.title, ''), new.doc_no);
  v_urg   text := coalesce(nullif(new.priority, ''), '');
  v_link  text := 'work-hub?tab=mytasks';
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
    values (new.created_by, 'task_done', 'Task completed', v_title || ' — marked done by ' || v_who, 'work-hub', v_urg);
  end if;
  return new;
end $$;
