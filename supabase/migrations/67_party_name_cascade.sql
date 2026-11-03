-- ============================================================
-- 67 · A customer or supplier is one record, however many documents name it
-- ============================================================
-- Documents keep the party's name as text, so renaming a customer or a supplier in its master used to leave the old name on
-- every earlier job card, dispatch, quotation, sales order, die, lot ... This makes the master the single source:
--   · renaming a customer / supplier changes the name on every document that carries it
--   · a customer / supplier that any document still names cannot be deleted (make it inactive instead)
-- Both work through triggers on the master tables; no existing function changes. Safe to run twice.

-- (table, column) pairs that hold a customer's / supplier's name as text
create or replace function _party_columns(p_kind text) returns table (tbl text, col text)
language sql immutable as $$
  select t.tbl, t.col from (values
    ('customer', 'products', 'default_customer'), ('customer', 'jobs', 'customer'), ('customer', 'dispatches', 'customer'),
    ('customer', 'main_dies', 'customer'), ('customer', 'sales_quotations', 'customer'), ('customer', 'sales_orders', 'customer'),
    ('customer', 'dimension_reports', 'customer'), ('customer', 'sales_records', 'party'),
    ('supplier', 'raw_material_lots', 'supplier'), ('supplier', 'job_work_out', 'vendor')
  ) as t (kind, tbl, col) where kind = p_kind
$$;

-- how many documents name this party (columns / tables that do not exist in this database are skipped)
create or replace function _party_uses(p_kind text, p_name text) returns bigint
language plpgsql security definer set search_path = public as $$
declare r record; n bigint; v_total bigint := 0;
begin
  for r in select * from _party_columns(p_kind) loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = r.tbl and column_name = r.col) then
      execute format('select count(*) from %I where %I = $1', r.tbl, r.col) into n using p_name;
      v_total := v_total + n;
    end if;
  end loop;
  return v_total;
end $$;

create or replace function trg_party_rename() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_kind text := tg_argv[0];
begin
  if new.name is distinct from old.name then
    for r in select * from _party_columns(v_kind) loop
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = r.tbl and column_name = r.col) then
        execute format('update %I set %I = $1 where %I = $2', r.tbl, r.col, r.col) using new.name, old.name;
      end if;
    end loop;
  end if;
  return new;
end $$;

create or replace function trg_party_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text := tg_argv[0]; v_n bigint;
begin
  v_n := _party_uses(v_kind, old.name);
  if v_n > 0 then
    raise exception '% is named on % document(s), so it cannot be deleted. Make it inactive instead.', old.name, v_n;
  end if;
  return old;
end $$;

drop trigger if exists customers_rename on customers;
create trigger customers_rename after update of name on customers for each row execute function trg_party_rename('customer');
drop trigger if exists suppliers_rename on suppliers;
create trigger suppliers_rename after update of name on suppliers for each row execute function trg_party_rename('supplier');
drop trigger if exists customers_no_delete_in_use on customers;
create trigger customers_no_delete_in_use before delete on customers for each row execute function trg_party_delete('customer');
drop trigger if exists suppliers_no_delete_in_use on suppliers;
create trigger suppliers_no_delete_in_use before delete on suppliers for each row execute function trg_party_delete('supplier');
