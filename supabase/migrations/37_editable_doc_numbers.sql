-- 37 · Editable document numbers.
-- Every "add" form shows the next number (peek_doc_no) and lets the user change it. The chosen number travels in the
-- request header  x-doc-no; the create functions read it through _requested_doc_no(), which refuses a number that is
-- already used ("... already exists") and otherwise falls back to the automatic number. Nothing changes when no number is sent.
-- The existing create functions are patched in place (text replace on their current definition), so each keeps its own
-- validation, permissions and grants. Safe to run more than once.

-- ============================================================ 1. which numbers exist, and where they live
create table if not exists doc_no_kinds (
  key     text primary key,
  counter text not null,              -- doc_counters.kind
  prefix  text not null,
  pad     int  not null default 4,
  tbl     text not null,
  col     text not null,
  filter  text not null default 'true'
);

insert into doc_no_kinds (key, counter, prefix, pad, tbl, col, filter) values
  ('inward',         'lot',               'RM',  3, 'raw_material_lots',     'id',       'true'),
  ('job',            'job',               'JOB', 4, 'jobs',                  'job_no',   'true'),
  ('dispatch',       'dispatch',          'DSP', 4, 'dispatches',            'dispatch_no', 'true'),
  ('hardness',       'hardness',          'HIR', 4, 'hardness_reports',      'id',       'true'),
  ('sales_inquiry',  'sales_inquiry',     'INQ', 4, 'sales_records',         'doc_no',   $$kind = 'inquiry'$$),
  ('sales_task',     'sales_task',        'TSK', 4, 'sales_records',         'doc_no',   $$kind = 'task'$$),
  ('qt_draft',       'sales_qt_draft',    'QD',  4, 'sales_quotations',      'draft_no', 'true'),
  ('sales_order',    'sales_sales_order', 'SO',  4, 'sales_orders',          'so_no',    'true'),
  ('pr',             'PR',                'PR',  4, 'purchase_requisitions', 'pr_no',    'true'),
  ('rfq',            'RFQ',               'RFQ', 4, 'rfqs',                  'rfq_no',   'true'),
  ('sq',             'SQ',                'SQ',  4, 'supplier_quotations',   'sq_no',    'true'),
  ('po',             'PUR',               'PUR', 4, 'purchase_orders',       'po_no',    'true'),
  ('pinv',           'PINV',              'PINV',4, 'purchase_invoices',     'pinv_no',  'true'),
  ('pay',            'PAY',               'PAY', 4, 'purchase_payments',     'pay_no',   'true')
on conflict (key) do update set counter = excluded.counter, prefix = excluded.prefix, pad = excluded.pad,
  tbl = excluded.tbl, col = excluded.col, filter = excluded.filter;

alter table doc_no_kinds enable row level security;   -- only the functions below read it

-- ============================================================ 2. helpers
create or replace function _doc_no_taken(p_key text, p_no text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  k  doc_no_kinds;
  ex boolean;
begin
  select * into k from doc_no_kinds where key = p_key;
  if not found then raise exception 'Unknown number type "%".', p_key; end if;
  execute format('select exists (select 1 from %I where lower(%I::text) = lower($1) and (%s))', k.tbl, k.col, k.filter) into ex using p_no;
  return ex;
end $$;

-- the next automatic number, WITHOUT using it up (skips numbers that were typed by hand)
create or replace function peek_doc_no(p_key text) returns text
language plpgsql security definer set search_path = public as $$
declare
  k      doc_no_kinds;
  v_year int := extract(year from current_date)::int;
  v_n    int;
  v      text;
begin
  perform _require_user();
  select * into k from doc_no_kinds where key = p_key;
  if not found then raise exception 'Unknown number type "%".', p_key; end if;
  select coalesce((select last_value from doc_counters where kind = k.counter and year = v_year), 0) + 1 into v_n;
  loop
    v := k.prefix || '-' || v_year || '-' || lpad(v_n::text, k.pad, '0');
    exit when not _doc_no_taken(p_key, v);
    v_n := v_n + 1;
  end loop;
  return v;
end $$;

-- the number the user typed (header x-doc-no), or null for "number it automatically". Raises when it is already used.
create or replace function _requested_doc_no(p_key text) returns text
language plpgsql security definer set search_path = public as $$
declare
  k    doc_no_kinds;
  v    text;
  m    text[];
begin
  begin
    v := btrim(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-doc-no', ''));
  exception when others then
    v := '';
  end;
  if v = '' then return null; end if;
  select * into k from doc_no_kinds where key = p_key;
  if not found then raise exception 'Unknown number type "%".', p_key; end if;
  if length(v) > 40 or v !~ '^[A-Za-z0-9][A-Za-z0-9 ._/-]*$' then
    raise exception 'The number "%" is not valid. Use letters, digits and - / . only (up to 40 characters).', v;
  end if;
  if _doc_no_taken(p_key, v) then
    raise exception 'The number "%" already exists. Enter a different number.', v;
  end if;
  -- a number in the usual PREFIX-YEAR-NNNN form moves the counter on, so the automatic numbering never reaches it later
  m := regexp_match(v, '^' || k.prefix || '-(\d{4})-(\d+)$', 'i');
  if m is not null then
    insert into doc_counters (kind, year, last_value) values (k.counter, m[1]::int, m[2]::int)
    on conflict (kind, year) do update set last_value = greatest(doc_counters.last_value, excluded.last_value);
  end if;
  return v;
end $$;

revoke all on function _doc_no_taken(text, text), _requested_doc_no(text) from public, anon, authenticated;
revoke all on function peek_doc_no(text) from public, anon;
grant execute on function peek_doc_no(text) to authenticated;

-- replace text inside the CURRENT definition of every function with this name; refuses silently-wrong results
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

-- ============================================================ 3. patch the create functions
do $$
declare
  k text;
begin
  -- Raw inventory inward
  perform _patch_fn('add_inward',
    $f$v_id := format('RM-%s-%s', _year(v_ts), lpad(v_n::text, 3, '0'));$f$,
    $f$v_id := coalesce(_requested_doc_no('inward'), format('RM-%s-%s', _year(v_ts), lpad(v_n::text, 3, '0')));$f$);

  -- Jobs (both the production "new job" and the job-work screen)
  foreach k in array array['create_job', 'create_job_work'] loop
    perform _patch_fn(k,
      $f$format('JOB-%s-%s', _year(v_ts), lpad(next_doc_no('job', _year(v_ts))::text, 4, '0'))$f$,
      $f$coalesce(_requested_doc_no('job'), format('JOB-%s-%s', _year(v_ts), lpad(next_doc_no('job', _year(v_ts))::text, 4, '0')))$f$);
  end loop;

  -- Dispatch
  perform _patch_fn('create_dispatch',
    $f$v_no   := format('DSP-%s-%s', _year(v_ts), lpad(v_n::text, 4, '0'));$f$,
    $f$v_no   := coalesce(_requested_doc_no('dispatch'), format('DSP-%s-%s', _year(v_ts), lpad(v_n::text, 4, '0')));$f$);

  -- Hardness report
  perform _patch_fn('save_hardness_report',
    $f$format('HIR-%s-%s', _year(v_ts), lpad(next_doc_no('hardness', _year(v_ts))::text, 4, '0'))$f$,
    $f$coalesce(_requested_doc_no('hardness'), format('HIR-%s-%s', _year(v_ts), lpad(next_doc_no('hardness', _year(v_ts))::text, 4, '0')))$f$);

  -- Sales: inquiry / task
  perform _patch_fn('save_sales_record',
    $f$v_no := v_prefix || '-' || extract(year from v_date)::int || '-' || lpad(next_doc_no('sales_' || p_kind, extract(year from v_date)::int)::text, 4, '0');$f$,
    $f$v_no := coalesce(_requested_doc_no('sales_' || p_kind), v_prefix || '-' || extract(year from v_date)::int || '-' || lpad(next_doc_no('sales_' || p_kind, extract(year from v_date)::int)::text, 4, '0'));$f$);

  -- Sales: quotation (the draft number) and sales order
  perform _patch_fn('save_sales_quotation',
    $f$values ('QD-' || v_year || '-' || lpad(next_doc_no('sales_qt_draft', v_year)::text, 4, '0'),$f$,
    $f$values (coalesce(_requested_doc_no('qt_draft'), 'QD-' || v_year || '-' || lpad(next_doc_no('sales_qt_draft', v_year)::text, 4, '0')),$f$);
  perform _patch_fn('save_sales_order',
    $f$values (_next_so_no(v_year),$f$,
    $f$values (coalesce(_requested_doc_no('sales_order'), _next_so_no(v_year)),$f$);

  -- Purchase
  perform _patch_fn('save_pr',
    $f$v_pr_no := 'PR-' || v_year || '-' || LPAD(next_doc_no('PR', v_year)::TEXT, 4, '0');$f$,
    $f$v_pr_no := coalesce(_requested_doc_no('pr'), 'PR-' || v_year || '-' || LPAD(next_doc_no('PR', v_year)::TEXT, 4, '0'));$f$);
  perform _patch_fn('save_rfq',
    $f$v_rfq_no := 'RFQ-' || v_year || '-' || LPAD(next_doc_no('RFQ', v_year)::TEXT, 4, '0');$f$,
    $f$v_rfq_no := coalesce(_requested_doc_no('rfq'), 'RFQ-' || v_year || '-' || LPAD(next_doc_no('RFQ', v_year)::TEXT, 4, '0'));$f$);
  perform _patch_fn('save_sq',
    $f$v_sq_no := 'SQ-' || v_year || '-' || LPAD(next_doc_no('SQ', v_year)::TEXT, 4, '0');$f$,
    $f$v_sq_no := coalesce(_requested_doc_no('sq'), 'SQ-' || v_year || '-' || LPAD(next_doc_no('SQ', v_year)::TEXT, 4, '0'));$f$);
  perform _patch_fn('save_po',
    $f$v_po_no := 'PUR-' || v_year || '-' || LPAD(next_doc_no('PUR', v_year)::TEXT, 4, '0');$f$,
    $f$v_po_no := coalesce(_requested_doc_no('po'), 'PUR-' || v_year || '-' || LPAD(next_doc_no('PUR', v_year)::TEXT, 4, '0'));$f$);
  perform _patch_fn('save_purchase_invoice',
    $f$values ('PINV-' || v_year || '-' || lpad(next_doc_no('PINV', v_year)::text, 4, '0'),$f$,
    $f$values (coalesce(_requested_doc_no('pinv'), 'PINV-' || v_year || '-' || lpad(next_doc_no('PINV', v_year)::text, 4, '0')),$f$);
  perform _patch_fn('save_purchase_payment',
    $f$values ('PAY-' || v_year || '-' || lpad(next_doc_no('PAY', v_year)::text, 4, '0'),$f$,
    $f$values (coalesce(_requested_doc_no('pay'), 'PAY-' || v_year || '-' || lpad(next_doc_no('PAY', v_year)::text, 4, '0')),$f$);
end $$;

drop function _patch_fn(text, text, text);
