-- Main die codes are now EAF-0001, EAF-0002 … (earlier DIE-xxxx codes stay as they are; the numbering continues after the highest number).
create or replace function main_dies_before_insert() returns trigger
language plpgsql as $$
declare v_max int;
begin
  if new.code is null or btrim(new.code) = '' then
    perform pg_advisory_xact_lock(hashtext('main_die_code'));
    select coalesce(max(substr(code, 5)::int), 0) + 1 into v_max from main_dies;
    new.code := 'EAF-' || lpad(v_max::text, 4, '0');
  end if;
  return new;
end $$;
