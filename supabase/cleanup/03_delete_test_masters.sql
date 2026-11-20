-- ============================================================
-- STEP 3 · DELETE the four test master records you named:
--   products  with code '12' (brass) and 'SMP-45' (Sample Brass Bush)
--   main dies DIE-0001 (xyz) and DIE-0002 (BRASS), and any forging / trimming dies under them
-- Run this AFTER 02_delete_test_data.sql (02 removes the jobs, stock and logs that point at them; otherwise this stops with an error).
-- IRREVERSIBLE — take a backup first. One transaction: if anything still points at these records, it fails and NOTHING is deleted.
-- Check the "before" list below matches what you expect, then run the whole thing.
-- ============================================================
begin;

-- safety check: stops if the records are not exactly what was named
do $$
declare n int;
begin
  select count(*) into n from products where code in ('12', 'SMP-45');
  if n <> 2 then raise exception 'Expected 2 products with code 12 / SMP-45, found %. Nothing was deleted.', n; end if;
  select count(*) into n from main_dies where code in ('DIE-0001', 'DIE-0002');
  if n <> 2 then raise exception 'Expected 2 main dies DIE-0001 / DIE-0002, found %. Nothing was deleted.', n; end if;
end $$;

-- the database refuses to delete dies on purpose; lift that protection ONLY for this transaction and put it back before the commit
alter table die_history disable trigger die_history_no_delete;
alter table dies        disable trigger dies_no_delete;
alter table main_dies   disable trigger main_dies_no_delete;

-- dies: logs of those dies, then the forging / trimming dies under them (normally none), then the main dies
delete from die_history     where main_code in ('DIE-0001', 'DIE-0002') or die_code in (select code from dies where main_code in ('DIE-0001', 'DIE-0002'));
delete from die_issues      where die_code in (select code from dies where main_code in ('DIE-0001', 'DIE-0002'));
delete from die_maintenance where die_code in (select code from dies where main_code in ('DIE-0001', 'DIE-0002'));
update dies set replaces_code = null, replaced_by_code = null where main_code in ('DIE-0001', 'DIE-0002');
delete from dies            where main_code in ('DIE-0001', 'DIE-0002');
delete from main_dies       where code in ('DIE-0001', 'DIE-0002');

alter table die_history enable trigger die_history_no_delete;
alter table dies        enable trigger dies_no_delete;
alter table main_dies   enable trigger main_dies_no_delete;

-- products: their minimum-stock levels, then the products
delete from stock_levels where key in (select 'semi|' || id || '|' || s from products, unnest(array['forging', 'trimming', 'heatTreatment']) s where code in ('12', 'SMP-45'));
delete from products where code in ('12', 'SMP-45');   -- stops here if a job, stock lot, dispatch or work instruction still uses them

commit;
