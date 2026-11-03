-- ============================================================
-- 57 · Job Work Out — work we give to somebody else (the page is "Workflow → Job Work Out"; the earlier Job Work page is now "Job Work In")
-- ============================================================
--  · only ENTRIES: who we gave it to, what, how many, challan, due date, status — our own inventory is never touched
--  · a reminder goes out as the due date gets close (job_work_out_reminders(), called by the app) and again once it is late
--  · who may add / edit = Write on the page "Job Work Out"; the vendor name follows the "Party names" setting, the charges follow "Purchase rates"
-- Needs 18 (access control) and 39 (notifications). Safe to run twice.

create table if not exists job_work_out (
  id            bigint generated always as identity primary key,
  out_no        text not null unique check (btrim(out_no) <> ''),
  out_date      date not null default current_date,
  vendor        text not null check (btrim(vendor) <> ''),
  contact       text not null default '',
  phone         text not null default '',
  job_no        text,                                              -- optional: the job card the work belongs to
  item          text not null check (btrim(item) <> ''),
  process       text not null default '',
  qty           numeric(12, 3) not null check (qty > 0),
  uom           text not null default 'PCS',
  challan_no    text not null default '',
  due_date      date,
  remind_days   int not null default 2 check (remind_days >= 0),   -- remind this many days before the due date
  charges       numeric(12, 2) check (charges is null or charges >= 0),
  status        text not null default 'Sent' check (status in ('Sent', 'Received', 'Cancelled')),
  received_on   date,
  received_qty  numeric(12, 3),
  remarks       text not null default '',
  created_by    text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table job_work_out enable row level security;
revoke all on job_work_out from anon, authenticated;

create or replace view v_job_work_out as
select id, out_no, out_date, mask_text(vendor, 'party_names') as vendor, contact, phone, job_no, item, process, qty, uom, challan_no, due_date, remind_days,
       mask_num(charges, 'purchase_rates') as charges, status, received_on, received_qty, remarks, created_by, created_at, updated_at
  from job_work_out where is_active_user();
grant select on v_job_work_out to authenticated;
revoke all on v_job_work_out from anon;

-- the page in Access Control, and the new name of the earlier page
insert into app_resources (key, label, section, sort, writable) values ('job_work_out', 'Job Work Out', 'Workflow', 111, true)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;
update app_resources set label = 'Job Work In' where key = 'job_work';
insert into role_page_access (role, resource, level)
  select r, 'job_work_out', case when r = 'plant_head' then 'write' else 'read' end
    from unnest(array['plant_head', 'accounts', 'qc', 'operator', 'viewer']::app_role[]) r
on conflict (role, resource) do nothing;

-- ---------------------------------------------------------------- save / receive / delete
create or replace function save_job_work_out(p_id bigint, p_payload jsonb, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id    bigint := p_id;
  v_no    text   := btrim(coalesce(p_payload ->> 'out_no', ''));
  v_party boolean := can_see_field('party_names');
  v_cost  boolean := can_see_field('purchase_rates');
  v_qty   numeric := nullif(p_payload ->> 'qty', '')::numeric;
  v_due   date    := nullif(p_payload ->> 'due_date', '')::date;
  v_date  date    := coalesce(nullif(p_payload ->> 'out_date', '')::date, current_date);
begin
  perform _require_user();
  perform _require_write('job_work_out');
  if btrim(coalesce(p_payload ->> 'vendor', '')) = '' then raise exception 'Enter who the work is given to.'; end if;
  if btrim(coalesce(p_payload ->> 'item', '')) = '' then raise exception 'Enter the item.'; end if;
  if not (coalesce(v_qty, 0) > 0) then raise exception 'Enter the quantity.'; end if;
  if v_due is not null and v_due < v_date then raise exception 'The due date cannot be before the date the work was given.'; end if;

  if v_no = '' then
    perform pg_advisory_xact_lock(hashtext('job_work_out_no'));
    select format('JWO-%s-%s', extract(year from current_date)::int, lpad((coalesce(max(substr(out_no, length(format('JWO-%s-', extract(year from current_date)::int)) + 1)::int), 0) + 1)::text, 4, '0'))
      into v_no from job_work_out where out_no ~ ('^JWO-' || extract(year from current_date)::int || '-[0-9]+$');
  end if;
  if exists (select 1 from job_work_out where lower(out_no) = lower(v_no) and id is distinct from p_id) then
    raise exception 'The number % already exists. Use a different number.', v_no;
  end if;

  if v_id is null then
    insert into job_work_out (out_no, out_date, vendor, contact, phone, job_no, item, process, qty, uom, challan_no, due_date, remind_days, charges, remarks, created_by)
    values (v_no, v_date, btrim(p_payload ->> 'vendor'), btrim(coalesce(p_payload ->> 'contact', '')), btrim(coalesce(p_payload ->> 'phone', '')),
            nullif(btrim(coalesce(p_payload ->> 'job_no', '')), ''), btrim(p_payload ->> 'item'), btrim(coalesce(p_payload ->> 'process', '')), v_qty,
            coalesce(nullif(btrim(p_payload ->> 'uom'), ''), 'PCS'), btrim(coalesce(p_payload ->> 'challan_no', '')), v_due,
            coalesce(nullif(p_payload ->> 'remind_days', '')::int, 2), case when v_cost then nullif(p_payload ->> 'charges', '')::numeric end,
            btrim(coalesce(p_payload ->> 'remarks', '')), coalesce(p_user, ''))
    returning id into v_id;
  else
    update job_work_out set
           out_no = v_no, out_date = v_date, vendor = case when v_party then btrim(p_payload ->> 'vendor') else vendor end,
           contact = btrim(coalesce(p_payload ->> 'contact', '')), phone = btrim(coalesce(p_payload ->> 'phone', '')),
           job_no = nullif(btrim(coalesce(p_payload ->> 'job_no', '')), ''), item = btrim(p_payload ->> 'item'), process = btrim(coalesce(p_payload ->> 'process', '')),
           qty = v_qty, uom = coalesce(nullif(btrim(p_payload ->> 'uom'), ''), 'PCS'), challan_no = btrim(coalesce(p_payload ->> 'challan_no', '')), due_date = v_due,
           remind_days = coalesce(nullif(p_payload ->> 'remind_days', '')::int, 2),
           charges = case when v_cost then nullif(p_payload ->> 'charges', '')::numeric else charges end,
           remarks = btrim(coalesce(p_payload ->> 'remarks', '')), updated_at = now()
     where id = v_id;
    if not found then raise exception 'That entry no longer exists.'; end if;
  end if;
  return v_id;
end $$;

-- p_status = Sent | Received | Cancelled
create or replace function set_job_work_out_status(p_id bigint, p_status text, p_received_on date, p_received_qty numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('job_work_out');
  if p_status not in ('Sent', 'Received', 'Cancelled') then raise exception 'Unknown status.'; end if;
  update job_work_out set
         status = p_status,
         received_on = case when p_status = 'Received' then coalesce(p_received_on, current_date) else null end,
         received_qty = case when p_status = 'Received' then coalesce(p_received_qty, qty) else null end,
         updated_at = now()
   where id = p_id;
  if not found then raise exception 'That entry no longer exists.'; end if;
end $$;

create or replace function delete_job_work_out(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('job_work_out');
  delete from job_work_out where id = p_id;
  if not found then raise exception 'That entry does not exist.'; end if;
end $$;

-- ---------------------------------------------------------------- reminders: as the due date gets close, and when it is late
-- Everyone who may change the page (Director, Plant Head and any role with Write on it) gets one notification per day per entry.
-- The vendor name is left out of the text (it is a party name).
create or replace function job_work_out_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare
  j  job_work_out;
  u  record;
  n  int := 0;
  v_late boolean;
  v_days int;
  v_title text;
  v_msg text;
begin
  perform _require_user();
  for j in select * from job_work_out where status = 'Sent' and due_date is not null and due_date - current_date <= remind_days loop
    v_days := j.due_date - current_date;
    v_late := v_days < 0;
    v_title := format('%s: %s', case when v_late then 'Job work out is late' else 'Job work out is due' end, j.out_no);
    v_msg := format('%s — %s %s%s. %s', j.item, trim_scale(j.qty), j.uom, case when j.process <> '' then ' (' || j.process || ')' else '' end,
                    case when v_late then format('%s day%s overdue', -v_days, case when v_days = -1 then '' else 's' end)
                         when v_days = 0 then 'Due today'
                         else format('Due in %s day%s', v_days, case when v_days = 1 then '' else 's' end) end);
    for u in
      select p.id from profiles p
       where p.active and (p.role in ('director', 'plant_head')
             or exists (select 1 from role_page_access a where a.role = p.role and a.resource = 'job_work_out' and a.level = 'write'))
    loop
      if not exists (select 1 from notifications x where x.user_id = u.id and x.kind = 'reminder' and x.title = v_title and x.created_at::date = current_date) then
        insert into notifications (user_id, kind, title, message, link, urgency) values (u.id, 'reminder', v_title, v_msg, 'job-work-out', case when v_late then 'Urgent' else 'High' end);
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
exception when undefined_table then return 0;
end $$;

revoke all on function save_job_work_out(bigint, jsonb, text), set_job_work_out_status(bigint, text, date, numeric), delete_job_work_out(bigint), job_work_out_reminders() from public, anon;
grant execute on function save_job_work_out(bigint, jsonb, text), set_job_work_out_status(bigint, text, date, numeric), delete_job_work_out(bigint), job_work_out_reminders() to authenticated;
