-- ============================================================
-- 89 · Rename the old job card numbers: JOB-2026-0001 → EAF-2026-0001
-- ============================================================
-- Needs 88. A ONE-OFF data fix: every existing job card numbered JOB-<year>-<n> gets the same number as EAF-<year>-<n>.
-- Nothing else changes — quantities, dates, stock, QC, dispatches, ledger lines, who-did-what all stay exactly as they are.
--
-- The whole rename is ONE statement (the "do" block below), so it is all-or-nothing: if anything goes wrong, nothing is changed.
--  1. lists the job cards to rename and stops if any new number is already in use
--  2. finds EVERY place in the database that holds one of these numbers — job_no columns, links, notes, activity / notification
--     messages, and details stored as JSON — by looking at the data itself, so no table is missed
--  3. lifts, for the moment of the rename only, the links between tables (foreign keys) and the table triggers (the append-only lock on
--     the ledger, "updated at" stamps, roll-ups …) on exactly those tables, so the rename cannot set anything else in motion
--  4. replaces the numbers (whole numbers only: JOB-2026-0001 never touches JOB-2026-00010), then puts every link and trigger back;
--     the links are checked again when they are put back
--  5. keeps a record of every rename in job_number_renames (old number, new number, when) — so it can be undone — and of what was
--     changed in job_number_rename_report, shown at the end
-- Safe to run twice (the second run finds nothing to rename).

create table if not exists job_number_renames (
  old_no     text primary key,
  new_no     text not null unique,
  renamed_at timestamptz not null default now()
);
create table if not exists job_number_rename_report (
  run_at       timestamptz not null default now(),
  table_name   text not null,
  column_name  text not null,
  rows_changed bigint not null
);
alter table job_number_renames enable row level security;
alter table job_number_rename_report enable row level security;
revoke all on job_number_renames, job_number_rename_report from anon, authenticated;

do $$
declare
  c       record;
  v_old   text[];
  v_new   text[];
  v_pat   text;
  v_set   text;
  v_n     bigint;
  v_tbls  regclass[] := '{}';
  v_cols  text[] := '{}';
  v_fks   text[] := '{}';
  t       regclass;
  i       int;
begin
  select array_agg(job_no order by job_no), array_agg(regexp_replace(job_no, '^JOB-', 'EAF-') order by job_no)
    into v_old, v_new
    from jobs where job_no ~ '^JOB-\d{4}-\d+$';
  if v_old is null then
    raise notice 'No job card numbered JOB-… is left — nothing to rename.';
    return;
  end if;
  if exists (select 1 from jobs where job_no = any (v_new)) then
    raise exception 'Cannot rename: % already exists.', (select string_agg(job_no, ', ') from jobs where job_no = any (v_new));
  end if;

  -- any of the old numbers, as a whole word
  v_pat := '\m(' || array_to_string(v_old, '|') || ')\M';

  -- 2. every column (text / JSON / text list) in the app's tables that holds one of them
  for c in
    select a.attrelid::regclass as tbl, a.attname as col, a.atttypid::regtype::text as typ
      from pg_attribute a
      join pg_class cl on cl.oid = a.attrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname = 'public' and cl.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
       and a.atttypid in ('text'::regtype, 'character varying'::regtype, 'jsonb'::regtype, 'json'::regtype, 'text[]'::regtype)
       and cl.relname not in ('job_number_renames', 'job_number_rename_report')
  loop
    execute format('select count(*) from %s where %I::text ~ %L', c.tbl, c.col, v_pat) into v_n;
    if v_n > 0 then
      v_cols := v_cols || format('%s|%s|%s', c.tbl::text, c.col, c.typ);
      if not c.tbl = any (v_tbls) then v_tbls := v_tbls || c.tbl; end if;
    end if;
  end loop;

  -- 3a. the links (foreign keys) that point AT one of those columns — taken off now, put back (and re-checked) after the rename
  for c in
    select con.conrelid::regclass as tbl, con.conname, pg_get_constraintdef(con.oid) as def
      from pg_constraint con
     where con.contype = 'f'
       and exists (select 1 from unnest(con.confkey) k
                    join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k
                   where format('%s|%s|', con.confrelid::regclass::text, a.attname) = any (select regexp_replace(x, '[^|]*$', '') from unnest(v_cols) x))
  loop
    v_fks := v_fks || format('alter table %s add constraint %I %s', c.tbl, c.conname, c.def);
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;

  -- 3b. the table triggers (append-only ledger lock, updated-at stamps, roll-ups …) on the tables being changed
  foreach t in array v_tbls loop
    execute format('alter table %s disable trigger user', t);
  end loop;

  -- 4. the rename itself: every whole old number → its new number
  foreach v_set in array v_cols loop
    declare
      p_tbl  text := split_part(v_set, '|', 1);
      p_col  text := split_part(v_set, '|', 2);
      p_typ  text := split_part(v_set, '|', 3);
      v_rows bigint := 0;
      v_one  bigint;
    begin
      for i in 1 .. array_length(v_old, 1) loop
        execute format('update %s set %I = regexp_replace(%I::text, %L, %L, ''g'')::%s where %I::text ~ %L',
                       p_tbl, p_col, p_col, '\m' || v_old[i] || '\M', v_new[i], p_typ, p_col, '\m' || v_old[i] || '\M');
        get diagnostics v_one = row_count;
        v_rows := v_rows + v_one;
      end loop;
      insert into job_number_rename_report (table_name, column_name, rows_changed) values (p_tbl, p_col, v_rows);
    end;
  end loop;

  -- triggers and links back on (the links are checked again here — a broken link would stop everything)
  foreach t in array v_tbls loop
    execute format('alter table %s enable trigger user', t);
  end loop;
  foreach v_set in array v_fks loop
    execute v_set;
  end loop;

  insert into job_number_renames (old_no, new_no) select * from unnest(v_old, v_new) on conflict (old_no) do nothing;
end $$;

-- what was changed (the last run)
select r.table_name, r.column_name, r.rows_changed,
       (select string_agg(old_no || ' → ' || new_no, ', ' order by old_no) from job_number_renames) as renamed
  from job_number_rename_report r
 where r.run_at = (select max(run_at) from job_number_rename_report)
 order by r.table_name, r.column_name;
