-- ============================================================
-- 78 · Quick Material Log: one log = a date, an item name and a list of bags
-- ============================================================
-- Needs 75. Still a standalone scratchpad: not linked to inventory, stock or accounting. Existing rows are kept as they are.
--
--   bags        the bags of the log: [{"no":1,"qty":10,"weight":25.5}, …]   (qty = pieces, a whole number; weight = kg, typed by hand)
--   total_qty   the pieces in all the bags
--   weight_kg   (already there) the total weight; for a log with bags it is the sum of the bags' weights
--   material_name  (already there) holds the Item name
--
-- A trigger works the totals out from the bags and renumbers them 1, 2, 3 …, so a screen (or anyone calling the API) cannot save totals that do
-- not match the bags. A log saved before this change has no bags: it keeps its single weight and shows no quantity.
-- Weight is never worked out from quantity anywhere. Safe to run twice.

alter table quick_material_logs add column if not exists bags      jsonb  not null default '[]'::jsonb;
alter table quick_material_logs add column if not exists total_qty bigint not null default 0;
-- bag weights can have 3 decimals (as on the Dispatch page), so the total keeps them too (widening only: nothing is rounded or lost)
alter table quick_material_logs alter column weight_kg type numeric(14,3);

create or replace function quick_material_logs_bags() returns trigger
language plpgsql set search_path = public as $$
declare
  v_bags jsonb;
  v_qty  numeric;
  v_wt   numeric;
  r      record;
begin
  if new.bags is null or jsonb_typeof(new.bags) <> 'array' then
    raise exception 'The bags must be a list.';
  end if;
  if jsonb_array_length(new.bags) = 0 then
    -- an older single-weight log (no bags): keep it as it is
    return new;
  end if;

  for r in
    select n, e from jsonb_array_elements(new.bags) with ordinality as t(e, n)
  loop
    if jsonb_typeof(r.e) <> 'object' then raise exception 'Bag %: not valid.', r.n; end if;
    if coalesce(r.e ->> 'qty', '') !~ '^[0-9]+$' or (r.e ->> 'qty')::numeric < 1 then
      raise exception 'Bag %: enter the quantity as a whole number of 1 or more.', r.n;
    end if;
    -- the weight is kept to 3 decimals, so it must still be more than 0 after rounding (0.0004 would become 0)
    if coalesce(r.e ->> 'weight', '') !~ '^[0-9]+(\.[0-9]+)?$' or round((r.e ->> 'weight')::numeric, 3) <= 0 then
      raise exception 'Bag %: enter the weight, more than 0.', r.n;
    end if;
  end loop;

  select jsonb_agg(jsonb_build_object('no', n, 'qty', q, 'weight', w) order by n), sum(q), sum(w)
    into v_bags, v_qty, v_wt
    from (select n, (e ->> 'qty')::bigint as q, round((e ->> 'weight')::numeric, 3) as w
            from jsonb_array_elements(new.bags) with ordinality as t(e, n)) s;

  new.bags      := v_bags;
  new.total_qty := v_qty;
  new.weight_kg := v_wt;
  return new;
end $$;

drop trigger if exists quick_material_logs_bags_trg on quick_material_logs;
create trigger quick_material_logs_bags_trg before insert or update on quick_material_logs
  for each row execute function quick_material_logs_bags();
