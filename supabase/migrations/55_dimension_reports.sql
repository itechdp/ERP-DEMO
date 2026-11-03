-- ============================================================
-- 55 · QC → Dimension Report (the final inspection sheet: parameters, specification, tolerances, 5 observations, result)
-- ============================================================
--  · one row per report with the header, the editable lines (jsonb) and the sign-off
--  · lines = [{kind: measure | text | gonogo, parameter, instrument, spec, usl, lsl, samples: [5 values], result}]
--  · the report number is typed (editable) or generated (DIR-2026-0001); a number that is already used is refused
--  · who may add / edit = Write on the page "Quality Control"; the customer name follows the "Party names" setting
-- Needs 18 (access control). Safe to run twice.

create table if not exists dimension_reports (
  id                bigint generated always as identity primary key,
  report_no         text not null unique check (btrim(report_no) <> ''),
  report_date       date not null default current_date,
  item_name         text not null default '',
  item_no           text not null default '',
  customer          text not null default '',
  invoice_date      date,
  invoice_qty       text not null default '',
  die_no            text not null default '',
  job_no            text,
  lines             jsonb not null default '[]'::jsonb,
  conclusion        text not null default '',
  customer_approval text not null default '',
  remarks           text not null default '',
  checked_by        text not null default '',
  reviewed_by       text not null default '',
  created_by        text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table dimension_reports enable row level security;
revoke all on dimension_reports from anon, authenticated;

create or replace view v_dimension_reports as
select id, report_no, report_date, item_name, item_no, mask_text(customer, 'party_names') as customer, invoice_date, invoice_qty, die_no, job_no,
       lines, conclusion, customer_approval, remarks, checked_by, reviewed_by, created_by, created_at, updated_at
  from dimension_reports where is_active_user();
grant select on v_dimension_reports to authenticated;
revoke all on v_dimension_reports from anon;

create or replace function save_dimension_report(p_id bigint, p_payload jsonb, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id    bigint := p_id;
  v_no    text   := btrim(coalesce(p_payload ->> 'report_no', ''));
  v_party boolean := can_see_field('party_names');
  v_lines jsonb  := coalesce(p_payload -> 'lines', '[]'::jsonb);
begin
  perform _require_user();
  perform _require_write('qc');
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then raise exception 'Add at least one inspection line.'; end if;
  if btrim(coalesce(p_payload ->> 'item_name', '')) = '' then raise exception 'Enter the item name.'; end if;

  if v_no = '' then
    perform pg_advisory_xact_lock(hashtext('dimension_report_no'));
    select format('DIR-%s-%s', extract(year from current_date)::int, lpad((coalesce(max(substr(report_no, length(format('DIR-%s-', extract(year from current_date)::int)) + 1)::int), 0) + 1)::text, 4, '0'))
      into v_no from dimension_reports where report_no ~ ('^DIR-' || extract(year from current_date)::int || '-[0-9]+$');
  end if;
  if exists (select 1 from dimension_reports where lower(report_no) = lower(v_no) and id is distinct from p_id) then
    raise exception 'The report number % already exists. Use a different number.', v_no;
  end if;

  if v_id is null then
    insert into dimension_reports (report_no, report_date, item_name, item_no, customer, invoice_date, invoice_qty, die_no, job_no, lines, conclusion, customer_approval, remarks, checked_by, reviewed_by, created_by)
    values (v_no, coalesce(nullif(p_payload ->> 'report_date', '')::date, current_date), btrim(p_payload ->> 'item_name'), btrim(coalesce(p_payload ->> 'item_no', '')),
            case when v_party then btrim(coalesce(p_payload ->> 'customer', '')) else '' end, nullif(p_payload ->> 'invoice_date', '')::date, btrim(coalesce(p_payload ->> 'invoice_qty', '')),
            btrim(coalesce(p_payload ->> 'die_no', '')), nullif(btrim(coalesce(p_payload ->> 'job_no', '')), ''), v_lines, btrim(coalesce(p_payload ->> 'conclusion', '')),
            btrim(coalesce(p_payload ->> 'customer_approval', '')), btrim(coalesce(p_payload ->> 'remarks', '')), btrim(coalesce(p_payload ->> 'checked_by', '')),
            btrim(coalesce(p_payload ->> 'reviewed_by', '')), coalesce(p_user, ''))
    returning id into v_id;
  else
    update dimension_reports set
           report_no = v_no, report_date = coalesce(nullif(p_payload ->> 'report_date', '')::date, report_date), item_name = btrim(p_payload ->> 'item_name'),
           item_no = btrim(coalesce(p_payload ->> 'item_no', '')), customer = case when v_party then btrim(coalesce(p_payload ->> 'customer', '')) else customer end,
           invoice_date = nullif(p_payload ->> 'invoice_date', '')::date, invoice_qty = btrim(coalesce(p_payload ->> 'invoice_qty', '')), die_no = btrim(coalesce(p_payload ->> 'die_no', '')),
           job_no = nullif(btrim(coalesce(p_payload ->> 'job_no', '')), ''), lines = v_lines, conclusion = btrim(coalesce(p_payload ->> 'conclusion', '')),
           customer_approval = btrim(coalesce(p_payload ->> 'customer_approval', '')), remarks = btrim(coalesce(p_payload ->> 'remarks', '')),
           checked_by = btrim(coalesce(p_payload ->> 'checked_by', '')), reviewed_by = btrim(coalesce(p_payload ->> 'reviewed_by', '')), updated_at = now()
     where id = v_id;
    if not found then raise exception 'That report no longer exists.'; end if;
  end if;
  return v_id;
end $$;

create or replace function delete_dimension_report(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('qc');
  delete from dimension_reports where id = p_id;
  if not found then raise exception 'That report does not exist.'; end if;
end $$;

revoke all on function save_dimension_report(bigint, jsonb, text), delete_dimension_report(bigint) from public, anon;
grant execute on function save_dimension_report(bigint, jsonb, text), delete_dimension_report(bigint) to authenticated;
