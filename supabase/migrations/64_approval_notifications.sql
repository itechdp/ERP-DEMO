-- ============================================================
-- 64 · Approval notifications — both ways
-- ============================================================
-- SENT:    when a purchase order, a purchase requisition or a sales quotation is sent for approval, everybody who may approve it
--          (the Director, the Plant Head, and every role with Write on the approvals page in Access Control) gets a notification that
--          opens the approvals page. The person who sent it is not notified of their own request.
-- DECIDED: when the approver approves or rejects (or sends it back), the person who sent it is notified with the outcome,
--          and the notification opens the document.
-- Works with triggers, so none of the existing functions change. Needs 27 (purchase), 34 (sales), 39 (notifications). Safe to run twice.

-- who sent each document for approval (taken from the signed-in user at the moment it went to "pending")
create table if not exists approval_submitters (
  kind    text not null check (kind in ('po', 'pr', 'quotation')),
  doc_id  bigint not null,
  user_id uuid not null,
  at      timestamptz not null default now(),
  primary key (kind, doc_id)
);
alter table approval_submitters enable row level security;
revoke all on approval_submitters from anon, authenticated;

create or replace function _notify_approvers(p_resource text, p_title text, p_message text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, kind, title, message, link, urgency)
  select p.id, 'approval', p_title, p_message, p_link, ''
    from profiles p
   where p.active
     and p.id is distinct from auth.uid()
     and (p.role::text in ('director', 'plant_head')
          or exists (select 1 from role_page_access a where a.role = p.role and a.resource = p_resource and a.level = 'write'));
end $$;

-- remember the sender; tell the sender how it went
create or replace function _approval_sent(p_kind text, p_id bigint) returns void
language sql security definer set search_path = public as $$
  insert into approval_submitters (kind, doc_id, user_id) values (p_kind, p_id, auth.uid())
  on conflict (kind, doc_id) do update set user_id = excluded.user_id, at = now()
  where auth.uid() is not null
$$;

create or replace function _notify_sender(p_kind text, p_id bigint, p_title text, p_message text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare v_to uuid;
begin
  select user_id into v_to from approval_submitters where kind = p_kind and doc_id = p_id;
  if v_to is null or v_to is not distinct from auth.uid() then return; end if;
  if not exists (select 1 from profiles where id = v_to and active) then return; end if;
  insert into notifications (user_id, kind, title, message, link, urgency) values (v_to, 'approval', p_title, p_message, p_link, '');
end $$;

create or replace function trg_notify_po_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Approval Pending' and old.status is distinct from 'Approval Pending' then
    perform _approval_sent('po', new.id);
    perform _notify_approvers('purchase_approvals', 'Purchase order waiting for approval', new.po_no, 'purchase-approvals');
  elsif old.status = 'Approval Pending' and new.status = 'Approved' then
    perform _notify_sender('po', new.id, 'Purchase order approved', new.po_no, 'purchase-orders');
  elsif old.status = 'Approval Pending' and new.status = 'Draft' then
    perform _notify_sender('po', new.id, 'Purchase order sent back — not approved', new.po_no, 'purchase-orders');
  end if;
  return new;
end $$;

create or replace function trg_notify_pr_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Approval Pending' and old.status is distinct from 'Approval Pending' then
    perform _approval_sent('pr', new.id);
    perform _notify_approvers('purchase_approvals', 'Purchase requisition waiting for approval', new.pr_no, 'purchase-approvals');
  elsif old.status = 'Approval Pending' and new.status = 'Approved' then
    perform _notify_sender('pr', new.id, 'Purchase requisition approved', new.pr_no, 'purchase-requisitions');
  elsif old.status = 'Approval Pending' and new.status = 'Rejected' then
    perform _notify_sender('pr', new.id, 'Purchase requisition rejected', new.pr_no, 'purchase-requisitions');
  end if;
  return new;
end $$;

create or replace function trg_notify_quotation_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_no text := coalesce(new.qt_no, new.draft_no);
begin
  if new.status = 'Pending Approval' and old.status is distinct from 'Pending Approval' then
    perform _approval_sent('quotation', new.id);
    perform _notify_approvers('quotation_approvals', 'Quotation waiting for approval', v_no, 'quotation-approvals');
  elsif old.status = 'Pending Approval' and new.status = 'Approved' then
    perform _notify_sender('quotation', new.id, 'Quotation approved', v_no, 'sales-quotation');
  elsif old.status = 'Pending Approval' and new.status = 'Rejected' then
    perform _notify_sender('quotation', new.id, 'Quotation rejected', v_no || coalesce(' — ' || nullif(new.decision_note, ''), ''), 'sales-quotation');
  elsif old.status = 'Pending Approval' and new.status = 'Revision Required' then
    perform _notify_sender('quotation', new.id, 'Quotation needs changes', v_no || coalesce(' — ' || nullif(new.decision_note, ''), ''), 'sales-quotation');
  end if;
  return new;
end $$;

drop trigger if exists po_notify_approval on purchase_orders;
create trigger po_notify_approval after update of status on purchase_orders for each row execute function trg_notify_po_approval();
drop trigger if exists pr_notify_approval on purchase_requisitions;
create trigger pr_notify_approval after update of status on purchase_requisitions for each row execute function trg_notify_pr_approval();
drop trigger if exists quotation_notify_approval on sales_quotations;
create trigger quotation_notify_approval after update of status on sales_quotations for each row execute function trg_notify_quotation_approval();
