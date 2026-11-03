-- ============================================================
-- 62 · Job card ↔ sales order
-- ============================================================
--  · jobs.sales_order_no   which sales order a job card is for (optional)
--  · v_jobs                shows it
--  · set_job_sales_order   links a job card to a sales order; the order moves Confirmed -> In Production
-- The customer on a job card could already be set (create_job p_customer); the New Job Card form now sends it.
-- Safe to run twice.

alter table jobs add column if not exists sales_order_no text;
create index if not exists jobs_sales_order_idx on jobs (sales_order_no) where sales_order_no is not null;

create or replace view v_jobs as
select j.job_no, j.product_id, j.planned_qty, j.material, j.od, j.due_date, j.priority, j.current_stage,
       j.piece_weight_g, j.die_no, j.machine_no, j.created_at,
       mask_text(j.customer, 'party_names') as customer,
       j.sales_order_no
  from jobs j
 where is_active_user();

create or replace function set_job_sales_order(p_job_no text, p_so_no text) returns void
language plpgsql security definer set search_path = public as $$
declare
  o sales_orders;
begin
  perform _require_user();
  perform _require_write('cutting');
  if not exists (select 1 from jobs where job_no = p_job_no) then raise exception 'Job card % does not exist.', p_job_no; end if;
  if nullif(btrim(coalesce(p_so_no, '')), '') is null then
    update jobs set sales_order_no = null where job_no = p_job_no;
    return;
  end if;
  select * into o from sales_orders where so_no = p_so_no;
  if not found then raise exception 'Sales order % does not exist.', p_so_no; end if;
  if o.status in ('Cancelled', 'Delivered', 'Draft') then raise exception 'Sales order % is % — job cards can be made only for a Confirmed or In Production order.', p_so_no, o.status; end if;
  update jobs set sales_order_no = p_so_no where job_no = p_job_no;
  if o.status = 'Confirmed' then
    update sales_orders set status = 'In Production' where id = o.id;
  end if;
end $$;

revoke all on function set_job_sales_order(text, text) from public, anon;
grant execute on function set_job_sales_order(text, text) to authenticated;
