-- helper (same as in 37): replace text inside the CURRENT definition of every function with this name
create or replace function _patch_fn(p_name text, p_from text, p_to text) returns void
language plpgsql as $$
declare
  r      record;
  d      text;
  v_hit  boolean := false;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = p_name loop
    d := pg_get_functiondef(r.oid);
    if position(p_to in d) > 0 then v_hit := true; continue; end if;     -- already patched
    if position(p_from in d) = 0 then continue; end if;
    execute replace(d, p_from, p_to);
    v_hit := true;
  end loop;
  if not v_hit then raise exception 'Could not patch function % (text not found).', p_name; end if;
end $$;

-- A sales order can now be corrected until production starts (Draft or Confirmed), not only while Draft.
do $$
begin
  perform _patch_fn('save_sales_order',
    $f$if o.status <> 'Draft' then raise exception 'Sales order % is % and can no longer be edited.', o.so_no, o.status; end if;$f$,
    $f$if o.status not in ('Draft', 'Confirmed') then raise exception 'Sales order % is % and can no longer be edited.', o.so_no, o.status; end if;$f$);
end $$;
