-- ============================================================
-- 68 · A die's piece count follows production
-- ============================================================
-- When the Forging of a job card is completed, the pieces it made are added to the die named on that job card (the die's
-- "Pieces Produced" total, with a line in the die's history). Returning the die no longer needs the figure typed again:
-- the pieces on the return form are only for pieces made OUTSIDE a job card (they are added on top).
-- Works with a trigger; no existing function changes. Needs 12 (dies) and 62 (not required). Safe to run twice.

create or replace function trg_die_count_forging() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_die text;
begin
  if new.stage <> 'forging' or new.status::text <> 'Completed' or old.status::text = 'Completed' or coalesce(new.output_qty, 0) <= 0 then return new; end if;
  select die_no into v_die from jobs where job_no = new.job_no;
  if v_die is null or btrim(v_die) = '' then return new; end if;
  if not exists (select 1 from dies where code = btrim(v_die)) then return new; end if;
  perform _die_ctx(current_date, format('Forging of %s finished: %s pieces.', new.job_no, new.output_qty), true);
  update dies set pieces = pieces + new.output_qty where code = btrim(v_die);
  perform _die_ctx();
  return new;
end $$;

drop trigger if exists stage_records_die_count on stage_records;
create trigger stage_records_die_count after update of status on stage_records for each row execute function trg_die_count_forging();
