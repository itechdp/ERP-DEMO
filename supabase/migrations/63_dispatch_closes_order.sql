-- ============================================================
-- 63 · Dispatch closes the sales order
-- ============================================================
-- A dispatch belongs to a sales order through its job card (62). When what has been dispatched on all of an order's job cards reaches
-- the quantity ordered, the order moves In Production -> Delivered by itself. Needs 62. Safe to run twice.

create or replace function _so_close_if_delivered() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_so      text;
  v_ordered numeric;
  v_sent    numeric;
begin
  if new.status::text <> 'Dispatched' then return new; end if;
  select sales_order_no into v_so from jobs where job_no = new.job_no;
  if v_so is null then return new; end if;
  select coalesce(sum(i.qty), 0) into v_ordered from sales_order_items i join sales_orders o on o.id = i.order_id where o.so_no = v_so;
  select coalesce(sum(d.qty), 0) into v_sent from dispatches d join jobs j on j.job_no = d.job_no where j.sales_order_no = v_so and d.status::text = 'Dispatched';
  if v_ordered > 0 and v_sent >= v_ordered then
    update sales_orders set status = 'Delivered' where so_no = v_so and status = 'In Production';
  end if;
  return new;
end $$;

drop trigger if exists dispatches_close_order on dispatches;
create trigger dispatches_close_order after insert or update of status on dispatches for each row execute function _so_close_if_delivered();
