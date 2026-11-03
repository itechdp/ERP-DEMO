-- ============================================================
-- 70 · Customers and suppliers are linked records
-- ============================================================
-- Every document that names a customer or a supplier now points to that record (customer_id / supplier_id, a real foreign key), not only
-- to a typed name. The name text stays on the document for display, and is kept equal to the master's name automatically:
--   · a name that is in the master -> the document is linked to it (spelling and capital letters are taken from the master)
--   · a name that is NOT in the master -> the customer / supplier is added to the master and the document is linked to it
--   · renaming a customer / supplier in its master changes the name on every linked document (67)
--   · a customer / supplier that documents point to cannot be deleted (the database refuses; make it inactive)
-- Customers: products (default), job cards, dispatches, dies, quotations, sales orders, dimension reports.   Suppliers: raw-material lots.
-- (Purchase orders, RFQs, quotations, invoices and payments already pointed to supplier_id.)
-- Needs 02, 42, 67. Safe to run twice.

alter table products          add column if not exists default_customer_id bigint references customers (id);
alter table jobs              add column if not exists customer_id bigint references customers (id);
alter table dispatches        add column if not exists customer_id bigint references customers (id);
alter table main_dies         add column if not exists customer_id bigint references customers (id);
alter table sales_quotations  add column if not exists customer_id bigint references customers (id);
alter table sales_orders      add column if not exists customer_id bigint references customers (id);
alter table dimension_reports add column if not exists customer_id bigint references customers (id);
alter table raw_material_lots add column if not exists supplier_id bigint references suppliers (id);

-- (kind, id column, name column) is given to the trigger as its arguments
create or replace function trg_link_party() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind   text := tg_argv[0];
  v_idcol  text := tg_argv[1];
  v_txtcol text := tg_argv[2];
  j        jsonb := to_jsonb(new);
  o        jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_id     bigint := nullif(j ->> v_idcol, '')::bigint;
  v_name   text := btrim(coalesce(j ->> v_txtcol, ''));
  v_by_txt boolean;
  v_found  text;
begin
  -- the typed name decides when there is no link yet or the name was just changed; otherwise the link decides
  v_by_txt := v_id is null or (tg_op = 'UPDATE' and v_name is distinct from btrim(coalesce(o ->> v_txtcol, '')));
  if v_by_txt then
    if v_name = '' then
      new := jsonb_populate_record(new, jsonb_build_object(v_idcol, null, v_txtcol, ''));
      return new;
    end if;
    v_id := null;
    if v_kind = 'customer' then
      select id, name into v_id, v_found from customers where lower(btrim(name)) = lower(v_name) order by id limit 1;
      if v_id is null then
        insert into customers (name) values (v_name) returning id into v_id;
      else
        v_name := v_found;
      end if;
    else
      select id, name into v_id, v_found from suppliers where lower(btrim(name)) = lower(v_name) order by id limit 1;
      if v_id is null then
        insert into suppliers (code, name) values ('SUP-' || lpad(((select coalesce(max(id), 0) from suppliers) + 1)::text, 4, '0'), v_name) returning id into v_id;
      else
        v_name := v_found;
      end if;
    end if;
  else
    if v_kind = 'customer' then select name into v_name from customers where id = v_id; else select name into v_name from suppliers where id = v_id; end if;
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(v_idcol, v_id, v_txtcol, v_name));
  return new;
end $$;

drop trigger if exists products_link_customer on products;
create trigger products_link_customer before insert or update of default_customer, default_customer_id on products for each row execute function trg_link_party('customer', 'default_customer_id', 'default_customer');
drop trigger if exists jobs_link_customer on jobs;
create trigger jobs_link_customer before insert or update of customer, customer_id on jobs for each row execute function trg_link_party('customer', 'customer_id', 'customer');
drop trigger if exists dispatches_link_customer on dispatches;
create trigger dispatches_link_customer before insert or update of customer, customer_id on dispatches for each row execute function trg_link_party('customer', 'customer_id', 'customer');
drop trigger if exists main_dies_link_customer on main_dies;
create trigger main_dies_link_customer before insert or update of customer, customer_id on main_dies for each row execute function trg_link_party('customer', 'customer_id', 'customer');
drop trigger if exists sales_quotations_link_customer on sales_quotations;
create trigger sales_quotations_link_customer before insert or update of customer, customer_id on sales_quotations for each row execute function trg_link_party('customer', 'customer_id', 'customer');
drop trigger if exists sales_orders_link_customer on sales_orders;
create trigger sales_orders_link_customer before insert or update of customer, customer_id on sales_orders for each row execute function trg_link_party('customer', 'customer_id', 'customer');
drop trigger if exists dimension_reports_link_customer on dimension_reports;
create trigger dimension_reports_link_customer before insert or update of customer, customer_id on dimension_reports for each row execute function trg_link_party('customer', 'customer_id', 'customer');
drop trigger if exists raw_lots_link_supplier on raw_material_lots;
create trigger raw_lots_link_supplier before insert or update of supplier, supplier_id on raw_material_lots for each row execute function trg_link_party('supplier', 'supplier_id', 'supplier');

-- job work out: its "given to" party is a subcontractor, not one of the material suppliers — leave it out of the supplier rename / delete rules
create or replace function _party_columns(p_kind text) returns table (tbl text, col text)
language sql immutable as $$
  select t.tbl, t.col from (values
    ('customer', 'products', 'default_customer'), ('customer', 'jobs', 'customer'), ('customer', 'dispatches', 'customer'),
    ('customer', 'main_dies', 'customer'), ('customer', 'sales_quotations', 'customer'), ('customer', 'sales_orders', 'customer'),
    ('customer', 'dimension_reports', 'customer'), ('customer', 'sales_records', 'party'),
    ('supplier', 'raw_material_lots', 'supplier')
  ) as t (kind, tbl, col) where kind = p_kind
$$;

-- link what is already there (the trigger does the work; the name is set to itself)
update products          set default_customer = default_customer where default_customer_id is null and btrim(default_customer) <> '';
update jobs              set customer = customer where customer_id is null and btrim(customer) <> '';
update dispatches        set customer = customer where customer_id is null and btrim(customer) <> '';
update main_dies         set customer = customer where customer_id is null and btrim(customer) <> '';
update sales_quotations  set customer = customer where customer_id is null and btrim(customer) <> '';
update sales_orders      set customer = customer where customer_id is null and btrim(customer) <> '';
update dimension_reports set customer = customer where customer_id is null and btrim(customer) <> '';
update raw_material_lots set supplier = supplier where supplier_id is null and btrim(supplier) <> '';

create index if not exists jobs_customer_idx on jobs (customer_id);
create index if not exists dispatches_customer_idx on dispatches (customer_id);
create index if not exists sales_orders_customer_idx on sales_orders (customer_id);
create index if not exists raw_lots_supplier_idx on raw_material_lots (supplier_id);
