-- ============================================================
-- 69 · Dispatch invoice numbers: their own running sequence
-- ============================================================
-- When a dispatch is saved without an invoice number, the system used to make one from the dispatch count + 410. It now takes the
-- next number of its own sequence: INV-2026-0001, INV-2026-0002 ... (one sequence per year, never reused). A number typed in is kept as typed.
-- Needs 03 (next_doc_no). Safe to run twice.

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
    if position(p_to in d) > 0 then v_hit := true; continue; end if;
    if position(p_from in d) = 0 then continue; end if;
    execute replace(d, p_from, p_to);
    v_hit := true;
  end loop;
  if not v_hit then raise exception 'Could not patch function % (text not found).', p_name; end if;
end $$;

do $$ begin
  perform _patch_fn('create_dispatch',
    $f$format('INV-%s-%s', _year(v_ts), lpad((v_n + 410)::text, 4, '0'))$f$,
    $f$format('INV-%s-%s', _year(v_ts), lpad(next_doc_no('invoice', _year(v_ts))::text, 4, '0'))$f$);
end $$;
