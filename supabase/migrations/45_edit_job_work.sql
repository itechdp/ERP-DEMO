-- Edit a job-work batch after it was received: the challan, item description, weight, customer, due date and charges.
-- The quantity, processes and material source are NOT editable here — they drive stock and routing (delete and re-receive instead).
create or replace function edit_job_work(p_job_no text, p_payload jsonb, p_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_party boolean := can_see_field('party_names');
  v_rates boolean := can_see_field('sales_rates');
  v_basis text    := coalesce(nullif(p_payload ->> 'charge_basis', ''), 'none');
  v_wt    numeric := nullif(p_payload ->> 'received_weight', '')::numeric;
begin
  perform _require_user();
  perform _require_write('job_work');
  if not exists (select 1 from job_work where job_no = p_job_no) then raise exception 'Job-work batch % does not exist.', p_job_no; end if;
  if v_basis not in ('none', 'piece', 'kg', 'process') then raise exception 'Choose how this job is charged.'; end if;
  if v_wt is not null and v_wt < 0 then raise exception 'Weight cannot be negative.'; end if;
  if v_party and btrim(coalesce(p_payload ->> 'customer', '')) = '' then raise exception 'Enter the customer.'; end if;

  update job_work set
         challan_no       = btrim(coalesce(p_payload ->> 'challan_no', '')),
         challan_date     = nullif(p_payload ->> 'challan_date', '')::date,
         item_description = btrim(coalesce(p_payload ->> 'item_description', '')),
         received_weight  = v_wt,
         charge_basis     = case when v_rates then v_basis else charge_basis end,
         rate             = case when v_rates then nullif(p_payload ->> 'rate', '')::numeric else rate end,
         process_rates    = case when v_rates then coalesce(p_payload -> 'process_rates', '{}'::jsonb) else process_rates end
   where job_no = p_job_no;

  update jobs set
         customer = case when v_party then btrim(coalesce(p_payload ->> 'customer', '')) else customer end,
         due_date = nullif(p_payload ->> 'due_date', '')::date
   where job_no = p_job_no;

  perform _log(coalesce(p_ts, now()), 'job', format('%s job-work details edited', p_job_no), p_job_no);
end $$;

revoke all on function edit_job_work(text, jsonb, timestamptz) from public, anon;
grant execute on function edit_job_work(text, jsonb, timestamptz) to authenticated;
