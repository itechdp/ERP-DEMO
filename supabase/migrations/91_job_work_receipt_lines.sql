-- ============================================================
-- 91 · Job Work In: several items on one receipt · what each line is (Round Bar, material, size)
-- ============================================================
-- Needs 26 (and 37 / 87 / 88 for the job numbers). Safe to run twice. Existing batches are not changed.
--
--  · A receipt (one customer challan) can now hold several lines — e.g. 70 mm Round Bar 100 KG and 25 mm Round Bar 150 KG.
--    Each line becomes its own job card (as before: one batch = one job card, so every size is cut and processed on its own);
--    the lines of one receipt share the challan, the processes, QC, due date and charges, and are tied together by receipt_no
--    (the job number of the first line).
--  · Each line records what came in: item (e.g. "Round Bar"), material (e.g. Brass), size (mm), pieces and KG.
--    The Job Work Party Inventory (Job Work In → Party Inventory) is built from these lines and the job-work dispatches:
--    the customer's material is never added to our own Raw Material Inventory.
--  · receive_job_work saves the whole receipt in ONE statement: if any line is refused, no job card is created.

alter table job_work
  add column if not exists receipt_no text,
  add column if not exists item_name  text,
  add column if not exists material   text,
  add column if not exists size_mm    numeric(8, 2);
create index if not exists job_work_receipt_idx on job_work (receipt_no) where receipt_no is not null;

-- the read model: the four new columns are added at the END (a view can only grow at the end)
create or replace view v_job_work as
select w.job_no, w.challan_no, w.challan_date, w.item_description, w.received_qty, w.received_weight, w.material_source,
       w.do_cutting, w.do_forging, w.do_trimming, w.do_heat_treatment, w.qc_required, w.charge_basis, w.created_at,
       coalesce((select sum(f.qty) from finished_goods f where f.job_no = w.job_no), w.received_qty) as billable_qty,
       mask_num(w.rate, 'sales_rates')                                                              as rate,
       case when can_see_field('sales_rates') then w.process_rates end                              as process_rates,
       mask_num(case w.charge_basis
         when 'piece'   then round(coalesce((select sum(f.qty) from finished_goods f where f.job_no = w.job_no), w.received_qty) * coalesce(w.rate, 0), 2)
         when 'kg'      then round(coalesce(w.received_weight, 0) * coalesce(w.rate, 0), 2)
         when 'process' then round(coalesce((select sum(f.qty) from finished_goods f where f.job_no = w.job_no), w.received_qty) * (
                (case when w.do_cutting        then coalesce((w.process_rates ->> 'cutting')::numeric, 0)       else 0 end) +
                (case when w.do_forging        then coalesce((w.process_rates ->> 'forging')::numeric, 0)       else 0 end) +
                (case when w.do_trimming       then coalesce((w.process_rates ->> 'trimming')::numeric, 0)      else 0 end) +
                (case when w.do_heat_treatment then coalesce((w.process_rates ->> 'heatTreatment')::numeric, 0) else 0 end)), 2)
         end, 'sales_rates')                                                                        as amount,
       w.receipt_no, w.item_name, w.material, w.size_mm
  from job_work w
 where is_active_user();
grant select on v_job_work to authenticated;
revoke all on v_job_work from anon;

-- one receipt, several lines. p_header: customer, challan, processes, material_source, QC, charges, due date (as create_job_work).
-- p_lines: [{ item_name, material, size_mm, product_id, received_qty, received_weight }, …]. Returns the job numbers, in line order.
create or replace function receive_job_work(p_header jsonb, p_lines jsonb, p_ts timestamptz default now()) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  l         jsonb;
  i         bigint;
  v_job     text;
  v_jobs    text[] := '{}';
  v_receipt text;
  v_src     text := coalesce(nullif(p_header ->> 'material_source', ''), 'customer');
  v_wt      numeric;
begin
  perform _require_user();
  perform _require_write('job_work');
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item.'; end if;
  for l, i in select value, ordinality from jsonb_array_elements(p_lines) with ordinality loop
    if btrim(coalesce(l ->> 'item_name', '')) = '' then raise exception 'Line %: enter the item (e.g. Round Bar).', i; end if;
    v_wt := nullif(l ->> 'received_weight', '')::numeric;
    if v_src = 'customer' and not coalesce(v_wt > 0, false) then
      raise exception 'Line %: enter the weight received (KG) — the party''s material is kept in KG.', i;
    end if;
    v_job := create_job_work(
      p_header || jsonb_build_object('product_id', l ->> 'product_id', 'received_qty', l -> 'received_qty',
                                     'received_weight', l -> 'received_weight', 'item_description', ''),
      p_ts);
    v_receipt := coalesce(v_receipt, v_job);
    update job_work
       set receipt_no = v_receipt,
           item_name  = btrim(l ->> 'item_name'),
           material   = nullif(btrim(coalesce(l ->> 'material', '')), ''),
           size_mm    = nullif(l ->> 'size_mm', '')::numeric
     where job_no = v_job;
    v_jobs := v_jobs || v_job;
  end loop;
  return v_jobs;
end $$;
revoke all on function receive_job_work(jsonb, jsonb, timestamptz) from public, anon;
grant execute on function receive_job_work(jsonb, jsonb, timestamptz) to authenticated;

-- the new tab, Job Work In › Party Inventory, in Settings → Access Control: every role starts with the same level it has on Job Work In
insert into app_resources (key, label, section, sort, writable) values
  ('job_work__party', 'Job Work In › Party Inventory', 'Workflow', 110, true)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort;
insert into role_page_access (role, resource, level)
select a.role, 'job_work__party', a.level from role_page_access a where a.resource = 'job_work'
on conflict (role, resource) do nothing;
