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

-- ============================================================
-- 51 · Product Master: "work to be done" and "hardness required"
-- ============================================================
--  · do_forging / do_trimming / do_heat_treatment   which processes this product goes through (Cutting always happens: every job starts there).
--    A job of a product that does not tick a process passes straight over it ("Not required — skipped"), exactly like a job-work batch.
--    All three default to TRUE, so existing products behave as before until somebody unticks something.
--  · hardness_required (+ range, scale)             does this product need a hardness check, and the required range for it.
-- Needs 26 (job_work) (it defines the _patch_fn helper itself). Safe to run twice.

alter table products
  add column if not exists do_forging        boolean not null default true,
  add column if not exists do_trimming       boolean not null default true,
  add column if not exists do_heat_treatment boolean not null default true,
  add column if not exists hardness_required boolean not null default false,
  add column if not exists hardness_min      numeric(6, 1),
  add column if not exists hardness_max      numeric(6, 1),
  add column if not exists hardness_scale    hardness_scale not null default 'HRB';

-- read model (the main v_products view is left alone)
create or replace view v_product_flow as
select id, do_forging, do_trimming, do_heat_treatment, hardness_required, hardness_min, hardness_max, hardness_scale
  from products where is_active_user();
grant select on v_product_flow to authenticated;
revoke all on v_product_flow from anon;

create or replace function set_product_flow(p_id text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req boolean := coalesce((p_payload ->> 'hardness_required')::boolean, false);
  v_min numeric := nullif(p_payload ->> 'hardness_min', '')::numeric;
  v_max numeric := nullif(p_payload ->> 'hardness_max', '')::numeric;
begin
  perform _require_user();
  perform _require_write('products');
  if not exists (select 1 from products where id = p_id) then raise exception 'Unknown product %.', p_id; end if;
  if v_req and (coalesce(v_min, 0) <= 0 or coalesce(v_max, 0) <= 0) then raise exception 'Enter the required hardness range (both limits).'; end if;
  if v_min is not null and v_max is not null and v_min > v_max then raise exception 'Required hardness: the lower limit cannot be above the upper limit.'; end if;
  update products set
         do_forging        = coalesce((p_payload ->> 'do_forging')::boolean, true),
         do_trimming       = coalesce((p_payload ->> 'do_trimming')::boolean, true),
         do_heat_treatment = coalesce((p_payload ->> 'do_heat_treatment')::boolean, true),
         hardness_required = v_req,
         hardness_min      = v_min,
         hardness_max      = v_max,
         hardness_scale    = coalesce(nullif(p_payload ->> 'hardness_scale', ''), 'HRB')::hardness_scale
   where id = p_id;
end $$;
revoke all on function set_product_flow(text, jsonb) from public, anon;
grant execute on function set_product_flow(text, jsonb) to authenticated;

-- the batch moves on only through the processes its product (or its job-work receipt) ticks
do $$
begin
  perform _patch_fn('complete_stage',
    $f$v_pl_f := coalesce(jw.do_forging, true);$f$,
    $f$v_pl_f := coalesce(jw.do_forging, prod.do_forging, true);$f$);
  perform _patch_fn('complete_stage',
    $f$v_pl_t := coalesce(jw.do_trimming, true) and not v_skip_t;$f$,
    $f$v_pl_t := coalesce(jw.do_trimming, prod.do_trimming, true) and not v_skip_t;$f$);
  perform _patch_fn('complete_stage',
    $f$v_pl_h := coalesce(jw.do_heat_treatment, true) and not v_skip_ht;$f$,
    $f$v_pl_h := coalesce(jw.do_heat_treatment, prod.do_heat_treatment, true) and not v_skip_ht;$f$);
end $$;
