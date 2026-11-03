-- ============================================================
-- 53 · Furnaces: change the timer of a batch that is already in a furnace
-- ============================================================
-- set_furnace_timer(load, minutes) → the furnace is now busy for `minutes` more from this moment (longer or shorter than before).
-- Needs 52. Safe to run twice.
create or replace function set_furnace_timer(p_load_id bigint, p_minutes_from_now int) returns void
language plpgsql security definer set search_path = public as $$
declare l furnace_loads;
begin
  perform _require_user();
  perform _require_write('furnaces');
  if not (coalesce(p_minutes_from_now, 0) > 0) then raise exception 'Enter how long the furnace stays on from now.'; end if;
  select * into l from furnace_loads where id = p_load_id and released_at is null for update;
  if not found then raise exception 'That furnace is no longer running this batch.'; end if;
  update furnace_loads
     set ends_at          = now() + make_interval(mins => p_minutes_from_now),
         duration_minutes = greatest(1, ceil(extract(epoch from (now() - l.started_at)) / 60.0)::int + p_minutes_from_now)
   where id = p_load_id;
end $$;
revoke all on function set_furnace_timer(bigint, int) from public, anon;
grant execute on function set_furnace_timer(bigint, int) to authenticated;
