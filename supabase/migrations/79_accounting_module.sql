-- ============================================================
-- 79 · Accounting module (sidebar → Accounting): ledger accounts, vouchers, bills, journals, cash exchange,
--      voucher approvals and the accounting reports.
-- ============================================================
-- ADDITIVE ONLY. Every object here is new and starts with acc_ / _acc_; no existing table, view or function is changed.
-- The module only READS existing ERP data (customers, suppliers, purchase invoices / payments, dispatches) to link accounts and to
-- propose drafts on the Voucher Approvals page — nothing reaches the books until somebody approves it.
--
--   acc_accounts            ledger accounts (optionally linked to an ERP customer or supplier)
--   acc_vouchers            Cash Receipt / Cash Payment / Bank Receipt / Bank Payment / Contra Entry (one table, `kind` tells them apart)
--   acc_journals (+ _lines) Journal Vouchers: one primary account on one side, several accounts on the other
--   acc_bills (+ _items)    Sales Bills and Purchase Bills with GST lines
--   acc_items               the item list used on bills
--   acc_cash_exchanges      swapping currency notes inside a cash-in-hand drawer (no effect on any balance)
--   acc_account_map         payment mode / supplier / customer name → ledger account (used by the drafts)
--   acc_drafts              vouchers and bills proposed from ERP documents, waiting for approval
--   acc_settings            one row: from which date ERP documents are proposed as drafts
--
-- Pages (Settings → Access Control): Accounting Dashboard, Account Vouchers, Voucher Approvals, Accounting Report.
-- Reading any accounting table needs at least Read on one of them; every change goes through a function below that checks Write.
-- Sign rules are the same as the reference module: for every transfer voucher the FROM account is credited and the TO account debited;
-- a Debit-mode Sales Bill debits its account, a Debit-mode Purchase Bill credits it; a Journal Voucher posts its primary account on
-- primary_side and every line on the opposite side. Balances are worked out in the app from these rows (src/accounting/engine.ts).
-- Needs 18 (access control). Safe to run twice.

-- ============================================================ 1. pages
-- Accounts and Plant Head may work in the books; QC, Operator and Viewer do not see the module until a Director gives them access.
-- The levels are set only when the pages are first installed, so a later change in Settings → Access Control survives running this again.
do $$
declare v_new boolean := not exists (select 1 from app_resources where key = 'account_vouchers');
begin
  insert into app_resources (key, label, section, sort, writable) values
    ('accounting_dashboard', 'Accounting Dashboard', 'Accounting', 200, false),
    ('account_vouchers',     'Account Vouchers',     'Accounting', 201, true),
    ('voucher_approvals',    'Voucher Approvals',    'Accounting', 202, true),
    ('accounting_report',    'Accounting Report',    'Accounting', 203, false)
  on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;
  if v_new then
    insert into role_page_access (role, resource, level)
      select r, p.res,
             case when r in ('plant_head', 'accounts') then (case when p.writable then 'write' else 'read' end) else 'hidden' end
        from unnest(array['plant_head', 'accounts', 'qc', 'operator', 'viewer']::app_role[]) r
       cross join (values ('accounting_dashboard', false), ('account_vouchers', true), ('voucher_approvals', true), ('accounting_report', false)) p(res, writable)
    on conflict (role, resource) do update set level = excluded.level;
  end if;
end $$;

-- ============================================================ 2. helpers
-- may the signed-in user read the books? (Read on any accounting page)
create or replace function _acc_can_read() returns boolean
language sql stable security definer set search_path = public as $$
  select is_active_user()
     and exists (select 1 from unnest(array['accounting_dashboard', 'account_vouchers', 'voucher_approvals', 'accounting_report']) r
                  where page_level(r) <> 'hidden');
$$;

create or replace function _acc_user() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(full_name), '') from profiles where id = auth.uid()), '');
$$;

-- Indian financial year short code of a date: 2026-11-12 → '2627' (FY 01/04/2026 – 31/03/2027)
create or replace function _acc_fy_short(p_date date) returns text
language sql immutable as $$
  select lpad((y % 100)::text, 2, '0') || lpad(((y + 1) % 100)::text, 2, '0')
    from (select case when extract(month from p_date) >= 4 then extract(year from p_date)::int else extract(year from p_date)::int - 1 end as y) s;
$$;

-- next number of a series: _acc_next_no('acc_vouchers', 'voucher_no', 'CR-', date) → 'CR-2627-0001', 'CR-2627-0002' … (restarts every FY)
create or replace function _acc_next_no(p_table text, p_col text, p_base text, p_date date) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_prefix text := p_base || _acc_fy_short(p_date) || '-';
  v_max    int;
begin
  perform pg_advisory_xact_lock(hashtext('acc_no:' || v_prefix));
  execute format('select max(substr(%1$I, %2$s)::int) from %3$I where left(%1$I, %4$s) = $1 and substr(%1$I, %2$s) ~ ''^[0-9]+$''',
                 p_col, length(v_prefix) + 1, p_table, length(v_prefix))
    into v_max using v_prefix;
  return v_prefix || lpad((coalesce(v_max, 0) + 1)::text, 4, '0');
end $$;

create or replace function _acc_groups() returns text[]
language sql immutable as $$
  select array[
    'Advance Receipt', 'Bank Accounts (Banks)', 'Bank OCC a/c', 'Capital Account', 'Cash-in-Hand',
    'Current Assets', 'Current Liabilities', 'Deposits (Asset)', 'Duties & Taxes', 'Expense Account',
    'Expenses (Direct)', 'Fixed Assets', 'Income', 'Income (Other Than Sales)', 'Income (Trading)',
    'Investments', 'Jobwork Expense', 'Jobwork Income (Trading)', 'Loans & Advances (Asset)',
    'Loans (Liability)', 'Misc. Expenses (Asset)', 'Partner Interest', 'Partner Remuneration',
    'Provisions', 'Purchase Account', 'Reserves & Surplus', 'Revenue Accounts', 'Sales Account',
    'Secured Loans', 'Stock-in-hand', 'Sundry Creditors', 'Sundry Debtors', 'Suspense Account',
    'Unsecured Loans'];
$$;

-- total value of a note breakdown {"500": 3, "100": 2} → 1700. Only the nine Indian notes / coins the screens offer are allowed.
create or replace function _acc_denom_total(p jsonb) returns numeric
language plpgsql immutable as $$
declare k text; v numeric; t numeric := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 0; end if;
  for k, v in select key, (value #>> '{}')::numeric from jsonb_each(p) loop
    if k not in ('500', '200', '100', '50', '20', '10', '5', '2', '1') then raise exception 'Unknown currency note ₹%.', k; end if;
    if v < 0 or v <> trunc(v) then raise exception 'The number of ₹% notes must be a whole number.', k; end if;
    t := t + k::numeric * v;
  end loop;
  return t;
end $$;

-- a note breakdown as stored: only notes with a count > 0, or null when nothing was entered
create or replace function _acc_denom_clean(p jsonb) returns jsonb
language sql immutable as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then null
              else nullif((select coalesce(jsonb_object_agg(key, (value #>> '{}')::int), '{}'::jsonb)
                             from jsonb_each(p) where coalesce(nullif(value #>> '{}', ''), '0')::numeric > 0), '{}'::jsonb) end;
$$;

-- ============================================================ 3. tables
create table if not exists acc_accounts (
  id               bigint generated always as identity primary key,
  name             text not null check (btrim(name) <> ''),
  group_name       text not null,
  customer_id      bigint references customers (id) on delete set null,   -- "Existing Customer" accounts
  supplier_id      bigint references suppliers (id) on delete set null,   -- "Existing Supplier" accounts
  opening_balance  numeric(14, 2) not null default 0,                      -- + Debit (Dr) / − Credit (Cr)
  city             text not null default '',
  pincode          text not null default '',
  area             text not null default '',
  mobile_no        text not null default '',
  state            text not null default '',
  pan_no           text not null default '',
  aadhar_no        text not null default '',
  gstin_no         text not null default '',
  credit_days      int check (credit_days is null or credit_days >= 0),
  bank_name        text not null default '',
  bank_branch      text not null default '',
  ifsc_code        text not null default '',
  bank_account_no  text not null default '',
  other_details    text not null default '',
  created_by       text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists acc_accounts_name_key on acc_accounts (lower(btrim(name)));
create index if not exists acc_accounts_customer_idx on acc_accounts (customer_id);
create index if not exists acc_accounts_supplier_idx on acc_accounts (supplier_id);

create table if not exists acc_vouchers (
  id                  bigint generated always as identity primary key,
  kind                text not null check (kind in ('cash_receipt', 'cash_payment', 'bank_receipt', 'bank_payment', 'contra')),
  voucher_no          text not null unique,
  voucher_date        date not null default current_date,
  from_account_id     bigint not null references acc_accounts (id),
  to_account_id       bigint not null references acc_accounts (id),
  amount              numeric(14, 2) not null check (amount > 0),
  narration           text not null default '',
  ref_no              text not null default '',      -- Registration / reference no. (printed on the voucher)
  bill_no             text not null default '',      -- receipts
  cheque_no           text not null default '',      -- bank vouchers
  cheque_date         date,
  drawn_on            text not null default '',      -- bank receipts
  denomination        jsonb,                         -- cash vouchers: notes handed over {"500": 2}
  return_denomination jsonb,                         -- cash vouchers: notes given back as change
  change_amount       numeric(14, 2),
  created_by          text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create index if not exists acc_vouchers_kind_idx on acc_vouchers (kind, voucher_date desc);
create index if not exists acc_vouchers_from_idx on acc_vouchers (from_account_id);
create index if not exists acc_vouchers_to_idx on acc_vouchers (to_account_id);

create table if not exists acc_journals (
  id                 bigint generated always as identity primary key,
  voucher_no         text not null unique,
  voucher_date       date not null default current_date,
  primary_side       text not null check (primary_side in ('credit', 'debit')),
  primary_account_id bigint not null references acc_accounts (id),
  primary_amount     numeric(14, 2) not null check (primary_amount > 0),
  narration          text not null default '',
  ref_no             text not null default '',
  created_by         text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists acc_journals_primary_idx on acc_journals (primary_account_id);

create table if not exists acc_journal_lines (
  id          bigint generated always as identity primary key,
  journal_id  bigint not null references acc_journals (id) on delete cascade,
  account_id  bigint not null references acc_accounts (id),
  amount      numeric(14, 2) not null check (amount > 0),
  line_order  int not null default 0
);
create index if not exists acc_journal_lines_journal_idx on acc_journal_lines (journal_id);
create index if not exists acc_journal_lines_account_idx on acc_journal_lines (account_id);

create table if not exists acc_items (
  id             bigint generated always as identity primary key,
  name           text not null check (btrim(name) <> ''),
  hsn_code       text not null default '',
  unit           text not null default '',
  sell_rate      numeric(12, 2) not null default 0 check (sell_rate >= 0),
  purchase_rate  numeric(12, 2) not null default 0 check (purchase_rate >= 0),
  tax_rate       numeric(5, 2) not null default 0 check (tax_rate >= 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create unique index if not exists acc_items_name_key on acc_items (lower(btrim(name)));

create table if not exists acc_bills (
  id               bigint generated always as identity primary key,
  kind             text not null check (kind in ('sales', 'purchase')),
  bill_no          text not null unique,
  bill_date        date not null default current_date,
  payment_mode     text not null check (payment_mode in ('Cash', 'Debit')),
  account_id       bigint references acc_accounts (id),             -- Debit bills only
  party_name       text not null default '',
  ref_no           text not null default '',                         -- Registration / reference no.
  taxable_amount   numeric(14, 2) not null default 0,
  tax_amount       numeric(14, 2) not null default 0,
  discount_amount  numeric(14, 2) not null default 0,
  total_amount     numeric(14, 2) not null default 0,
  credit_days      int check (credit_days is null or credit_days >= 0),
  due_date         date,
  created_by       text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (payment_mode = 'Cash' or account_id is not null)
);
create index if not exists acc_bills_kind_idx on acc_bills (kind, bill_date desc);
create index if not exists acc_bills_account_idx on acc_bills (account_id);

create table if not exists acc_bill_items (
  id              bigint generated always as identity primary key,
  bill_id         bigint not null references acc_bills (id) on delete cascade,
  item_id         bigint references acc_items (id) on delete set null,
  item_name       text not null,
  hsn_code        text not null default '',
  qty             numeric(12, 3) not null default 1,
  rate            numeric(12, 2) not null default 0,
  gst_type        text not null default 'CGST/SGST' check (gst_type in ('CGST/SGST', 'IGST')),
  tax_rate        numeric(5, 2) not null default 0,
  taxable_amount  numeric(14, 2) not null default 0,
  tax_amount      numeric(14, 2) not null default 0,
  total_amount    numeric(14, 2) not null default 0,
  line_order      int not null default 0
);
create index if not exists acc_bill_items_bill_idx on acc_bill_items (bill_id);

create table if not exists acc_cash_exchanges (
  id                    bigint generated always as identity primary key,
  voucher_no            text not null unique,
  exchange_date         date not null default current_date,
  cash_account_id       bigint not null references acc_accounts (id),
  amount                numeric(14, 2) not null check (amount > 0),
  given_denomination    jsonb not null,
  received_denomination jsonb not null,
  narration             text not null default '',
  created_by            text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists acc_account_map (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('payment_mode', 'supplier', 'customer')),
  name        text not null,
  account_id  bigint not null references acc_accounts (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (kind, name)
);

create table if not exists acc_drafts (
  id               bigint generated always as identity primary key,
  source_type      text not null check (source_type in ('purchase_invoice', 'purchase_payment', 'dispatch')),
  source_id        text not null,
  source_ref       text not null default '',          -- e.g. the invoice / payment number, for display
  role             text not null check (role in ('purchase_bill', 'supplier_payment', 'sales_bill')),
  voucher_type     text not null check (voucher_type in ('cash_receipt', 'bank_receipt', 'cash_payment', 'bank_payment', 'sales_bill', 'purchase_bill')),
  voucher_date     date,
  from_account_id  bigint references acc_accounts (id) on delete set null,
  to_account_id    bigint references acc_accounts (id) on delete set null,
  account_id       bigint references acc_accounts (id) on delete set null,   -- bill drafts
  payment_mode     text not null default 'Debit' check (payment_mode in ('Cash', 'Debit')),
  amount           numeric(14, 2) not null default 0,
  discount         numeric(14, 2) not null default 0,
  items            jsonb not null default '[]',     -- bill drafts: [{itemId,itemName,hsnCode,qty,rate,gstType,taxRate}]
  narration        text not null default '',
  ref_no           text not null default '',
  cheque_no        text not null default '',
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  issue            text not null default '',        -- why an account is blank (e.g. 'No account mapped for "UPI"')
  reject_reason    text not null default '',
  posted_id        bigint,
  posted_no        text not null default '',
  created_by       text not null default '',
  decided_by       text not null default '',
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- one live draft per source document + role (a rejected one does not block a new one)
create unique index if not exists acc_drafts_source_role_key on acc_drafts (source_type, source_id, role) where status <> 'rejected';
create index if not exists acc_drafts_status_idx on acc_drafts (status, created_at desc);

create table if not exists acc_settings (
  id            int primary key default 1 check (id = 1),
  drafts_since  date                                     -- ERP documents dated on/after this are proposed as drafts (null = never)
);
-- start proposing drafts from the day the module is installed, so years of old invoices do not flood the approvals page
insert into acc_settings (id, drafts_since) values (1, current_date) on conflict (id) do nothing;

-- every accounting table: readable by anyone with Read on an accounting page, written only through the functions below
do $$
declare t text;
begin
  foreach t in array array['acc_accounts', 'acc_vouchers', 'acc_journals', 'acc_journal_lines', 'acc_items', 'acc_bills', 'acc_bill_items',
                           'acc_cash_exchanges', 'acc_account_map', 'acc_drafts', 'acc_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select _acc_can_read()))', t || '_read', t);
  end loop;
end $$;

-- ============================================================ 4. accounts
-- p = {account_type: customer|supplier|other, customer_id, supplier_id, name, group_name, opening_balance (+Dr / −Cr), city, pincode, area,
--      mobile_no, state, pan_no, aadhar_no, gstin_no, credit_days, bank_name, bank_branch, ifsc_code, bank_account_no, other_details}
create or replace function acc_save_account(p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id    bigint := p_id;
  v_type  text   := coalesce(nullif(p ->> 'account_type', ''), 'other');
  v_name  text   := btrim(coalesce(p ->> 'name', ''));
  v_group text   := btrim(coalesce(p ->> 'group_name', ''));
  v_cust  bigint := case when v_type = 'customer' then nullif(p ->> 'customer_id', '')::bigint end;
  v_supp  bigint := case when v_type = 'supplier' then nullif(p ->> 'supplier_id', '')::bigint end;
  v_days  numeric := nullif(btrim(coalesce(p ->> 'credit_days', '')), '')::numeric;
  v_bank  boolean;
begin
  perform _require_user();
  perform _require_write('account_vouchers');
  if v_type = 'customer' and v_cust is null then raise exception 'Please select a customer'; end if;
  if v_type = 'supplier' and v_supp is null then raise exception 'Please select a supplier'; end if;
  if v_name = '' then raise exception 'Please enter an account name'; end if;
  if v_group = '' then raise exception 'Please select a group name'; end if;
  if not (v_group = any (_acc_groups())) then raise exception 'Unknown group name "%".', v_group; end if;
  if v_days is not null and (v_days < 0 or v_days <> trunc(v_days)) then raise exception 'Credit Limit Days must be a whole number (0 or more)'; end if;
  if exists (select 1 from acc_accounts where lower(btrim(name)) = lower(v_name) and id is distinct from p_id) then
    raise exception 'An account named "%" already exists.', v_name;
  end if;
  v_bank := v_group in ('Bank Accounts (Banks)', 'Bank OCC a/c');

  if v_id is null then
    insert into acc_accounts (name, group_name, customer_id, supplier_id, opening_balance, city, pincode, area, mobile_no, state, pan_no, aadhar_no,
                              gstin_no, credit_days, bank_name, bank_branch, ifsc_code, bank_account_no, other_details, created_by)
    values (v_name, v_group, v_cust, v_supp, round(coalesce(nullif(p ->> 'opening_balance', '')::numeric, 0), 2),
            btrim(coalesce(p ->> 'city', '')), btrim(coalesce(p ->> 'pincode', '')), btrim(coalesce(p ->> 'area', '')), btrim(coalesce(p ->> 'mobile_no', '')),
            btrim(coalesce(p ->> 'state', '')), upper(btrim(coalesce(p ->> 'pan_no', ''))), btrim(coalesce(p ->> 'aadhar_no', '')), upper(btrim(coalesce(p ->> 'gstin_no', ''))),
            v_days::int,
            case when v_bank then btrim(coalesce(p ->> 'bank_name', '')) else '' end, case when v_bank then btrim(coalesce(p ->> 'bank_branch', '')) else '' end,
            case when v_bank then upper(btrim(coalesce(p ->> 'ifsc_code', ''))) else '' end, case when v_bank then btrim(coalesce(p ->> 'bank_account_no', '')) else '' end,
            btrim(coalesce(p ->> 'other_details', '')), _acc_user())
    returning id into v_id;
  else
    update acc_accounts set
           name = v_name, group_name = v_group, customer_id = v_cust, supplier_id = v_supp,
           opening_balance = round(coalesce(nullif(p ->> 'opening_balance', '')::numeric, 0), 2),
           city = btrim(coalesce(p ->> 'city', '')), pincode = btrim(coalesce(p ->> 'pincode', '')), area = btrim(coalesce(p ->> 'area', '')),
           mobile_no = btrim(coalesce(p ->> 'mobile_no', '')), state = btrim(coalesce(p ->> 'state', '')), pan_no = upper(btrim(coalesce(p ->> 'pan_no', ''))),
           aadhar_no = btrim(coalesce(p ->> 'aadhar_no', '')), gstin_no = upper(btrim(coalesce(p ->> 'gstin_no', ''))), credit_days = v_days::int,
           bank_name = case when v_bank then btrim(coalesce(p ->> 'bank_name', '')) else '' end,
           bank_branch = case when v_bank then btrim(coalesce(p ->> 'bank_branch', '')) else '' end,
           ifsc_code = case when v_bank then upper(btrim(coalesce(p ->> 'ifsc_code', ''))) else '' end,
           bank_account_no = case when v_bank then btrim(coalesce(p ->> 'bank_account_no', '')) else '' end,
           other_details = btrim(coalesce(p ->> 'other_details', '')), updated_at = now()
     where id = v_id;
    if not found then raise exception 'That account no longer exists.'; end if;
  end if;
  return v_id;
end $$;

create or replace function acc_delete_account(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_used int;
begin
  perform _require_user();
  perform _require_write('account_vouchers');
  select (select count(*) from acc_vouchers where from_account_id = p_id or to_account_id = p_id)
       + (select count(*) from acc_journals where primary_account_id = p_id)
       + (select count(*) from acc_journal_lines where account_id = p_id)
       + (select count(*) from acc_bills where account_id = p_id)
       + (select count(*) from acc_cash_exchanges where cash_account_id = p_id)
    into v_used;
  if v_used > 0 then
    raise exception 'This account is used in % entr% and cannot be deleted. Delete or change those entries first.', v_used, case when v_used = 1 then 'y' else 'ies' end;
  end if;
  delete from acc_accounts where id = p_id;
  if not found then raise exception 'That account does not exist.'; end if;
end $$;

-- ============================================================ 5. vouchers (cash / bank receipts and payments, contra)
create or replace function _acc_draft_done(p_draft bigint, p_type text, p_posted bigint, p_no text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_draft is null then return; end if;
  update acc_drafts set status = 'approved', voucher_type = p_type, posted_id = p_posted, posted_no = p_no, issue = '',
                        decided_by = _acc_user(), decided_at = now(), updated_at = now()
   where id = p_draft and status = 'pending';
  if not found then raise exception 'This draft is no longer pending.'; end if;
end $$;

-- p = {from_account_id, to_account_id, amount, voucher_date, narration, ref_no, bill_no, cheque_no, cheque_date, drawn_on, denomination, return_denomination}
-- p_draft_id: the voucher approves that pending draft (Voucher Approvals) — then Write on Voucher Approvals is what counts.
-- returns {id, voucher_no}
create or replace function acc_save_voucher(p_kind text, p_id bigint, p jsonb, p_draft_id bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id     bigint := p_id;
  v_from   bigint := nullif(p ->> 'from_account_id', '')::bigint;
  v_to     bigint := nullif(p ->> 'to_account_id', '')::bigint;
  v_amt    numeric := round(coalesce(nullif(p ->> 'amount', '')::numeric, 0), 2);
  v_date   date := coalesce(nullif(p ->> 'voucher_date', '')::date, current_date);
  v_gfrom  text;
  v_gto    text;
  v_cash   boolean := p_kind in ('cash_receipt', 'cash_payment');
  v_bank   boolean := p_kind in ('bank_receipt', 'bank_payment');
  v_rec    boolean := p_kind in ('cash_receipt', 'bank_receipt');
  v_den    jsonb;
  v_ret    jsonb;
  v_change numeric;
  v_no     text;
  v_bc     text[] := array['Bank Accounts (Banks)', 'Bank OCC a/c', 'Cash-in-Hand'];
begin
  perform _require_user();
  if p_kind not in ('cash_receipt', 'cash_payment', 'bank_receipt', 'bank_payment', 'contra') then raise exception 'Unknown voucher type.'; end if;
  if p_draft_id is null then perform _require_write('account_vouchers'); else perform _require_write('voucher_approvals'); end if;
  if v_from is null then raise exception 'Please select a From Account'; end if;
  if v_to is null then raise exception 'Please select a To Account'; end if;
  if v_from = v_to then raise exception 'From Account and To Account must be different'; end if;
  if v_amt <= 0 then raise exception '% amount must be greater than 0', case when v_rec then 'Received' when p_kind = 'contra' then 'Transfer' else 'Paid' end; end if;
  select group_name into v_gfrom from acc_accounts where id = v_from;
  select group_name into v_gto from acc_accounts where id = v_to;
  if v_gfrom is null or v_gto is null then raise exception 'The selected account no longer exists.'; end if;
  if p_kind = 'cash_receipt' and v_gto <> 'Cash-in-Hand' then raise exception 'The To Account of a Cash Receipt must be a Cash-in-Hand account.'; end if;
  if p_kind = 'cash_payment' and v_gfrom <> 'Cash-in-Hand' then raise exception 'The From Account of a Cash Payment must be a Cash-in-Hand account.'; end if;
  if p_kind = 'bank_receipt' and not (v_gto = any (v_bc)) then raise exception 'The To Account of a Bank Receipt must be a bank or cash account.'; end if;
  if p_kind = 'bank_payment' and not (v_gfrom = any (v_bc)) then raise exception 'The From Account of a Bank Payment must be a bank or cash account.'; end if;
  if p_kind = 'contra' and not (v_gfrom = any (v_bc) and v_gto = any (v_bc)) then raise exception 'Both accounts of a Contra Entry must be bank or cash accounts.'; end if;

  if v_cash then
    perform _acc_denom_total(p -> 'denomination');
    perform _acc_denom_total(p -> 'return_denomination');
    v_den := _acc_denom_clean(p -> 'denomination');
    v_change := greatest(_acc_denom_total(v_den) - v_amt, 0);
    v_ret := case when v_change > 0 then _acc_denom_clean(p -> 'return_denomination') end;
  end if;

  if v_id is null then
    v_no := _acc_next_no('acc_vouchers', 'voucher_no',
              case p_kind when 'cash_receipt' then 'CR-' when 'cash_payment' then 'CP-' when 'bank_receipt' then 'BR-' when 'bank_payment' then 'BP-' else 'CE-' end, v_date);
    insert into acc_vouchers (kind, voucher_no, voucher_date, from_account_id, to_account_id, amount, narration, ref_no, bill_no, cheque_no, cheque_date, drawn_on,
                              denomination, return_denomination, change_amount, created_by)
    values (p_kind, v_no, v_date, v_from, v_to, v_amt, btrim(coalesce(p ->> 'narration', '')), upper(btrim(coalesce(p ->> 'ref_no', ''))),
            case when v_rec then btrim(coalesce(p ->> 'bill_no', '')) else '' end,
            case when v_bank then btrim(coalesce(p ->> 'cheque_no', '')) else '' end,
            case when v_bank then nullif(p ->> 'cheque_date', '')::date end,
            case when p_kind = 'bank_receipt' then btrim(coalesce(p ->> 'drawn_on', '')) else '' end,
            v_den, v_ret, nullif(v_change, 0), _acc_user())
    returning id into v_id;
  else
    update acc_vouchers set
           voucher_date = v_date, from_account_id = v_from, to_account_id = v_to, amount = v_amt,
           narration = btrim(coalesce(p ->> 'narration', '')), ref_no = upper(btrim(coalesce(p ->> 'ref_no', ''))),
           bill_no = case when v_rec then btrim(coalesce(p ->> 'bill_no', '')) else '' end,
           cheque_no = case when v_bank then btrim(coalesce(p ->> 'cheque_no', '')) else '' end,
           cheque_date = case when v_bank then nullif(p ->> 'cheque_date', '')::date end,
           drawn_on = case when p_kind = 'bank_receipt' then btrim(coalesce(p ->> 'drawn_on', '')) else '' end,
           denomination = v_den, return_denomination = v_ret, change_amount = nullif(v_change, 0), updated_at = now()
     where id = v_id and kind = p_kind
    returning voucher_no into v_no;
    if not found then raise exception 'That voucher no longer exists.'; end if;
  end if;
  perform _acc_draft_done(p_draft_id, p_kind, v_id, v_no);
  return jsonb_build_object('id', v_id, 'voucher_no', v_no);
end $$;

-- ============================================================ 6. journal vouchers
-- p = {primary_side: credit|debit, primary_account_id, primary_amount, voucher_date, narration, ref_no, lines: [{account_id, amount}]}
create or replace function acc_save_journal(p_id bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id    bigint := p_id;
  v_side  text := coalesce(nullif(p ->> 'primary_side', ''), 'credit');
  v_acc   bigint := nullif(p ->> 'primary_account_id', '')::bigint;
  v_amt   numeric := round(coalesce(nullif(p ->> 'primary_amount', '')::numeric, 0), 2);
  v_date  date := coalesce(nullif(p ->> 'voucher_date', '')::date, current_date);
  v_side_l text;
  v_opp   text;
  v_total numeric;
  v_n     int;
  v_no    text;
begin
  perform _require_user();
  perform _require_write('account_vouchers');
  if v_side not in ('credit', 'debit') then raise exception 'Unknown entry type.'; end if;
  v_side_l := initcap(v_side);
  v_opp := case when v_side = 'credit' then 'Debit' else 'Credit' end;
  if v_acc is null then raise exception 'Please select the % account', v_side_l; end if;
  if v_amt <= 0 then raise exception 'Amount must be greater than 0'; end if;
  if not exists (select 1 from acc_accounts where id = v_acc) then raise exception 'The selected account no longer exists.'; end if;

  create temp table if not exists _acc_jl (account_id bigint, amount numeric, ord int) on commit drop;
  delete from _acc_jl;
  insert into _acc_jl
    select nullif(l ->> 'account_id', '')::bigint, round(coalesce(nullif(l ->> 'amount', '')::numeric, 0), 2), (o - 1)::int
      from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) with ordinality as x(l, o);
  delete from _acc_jl where account_id is null or amount <= 0;
  select count(*), coalesce(sum(amount), 0) into v_n, v_total from _acc_jl;
  if v_n = 0 then raise exception 'Please add at least one % line', v_opp; end if;
  if exists (select 1 from _acc_jl where account_id = v_acc) then raise exception 'A % line can''t use the same account as the % account', v_opp, v_side_l; end if;
  if exists (select 1 from _acc_jl j where not exists (select 1 from acc_accounts a where a.id = j.account_id)) then raise exception 'A selected account no longer exists.'; end if;
  if abs(v_total - v_amt) >= 0.005 then
    raise exception '% total (₹%) must equal the % amount (₹%)', v_opp, v_total, v_side_l, v_amt;
  end if;

  if v_id is null then
    v_no := _acc_next_no('acc_journals', 'voucher_no', 'JV-', v_date);
    insert into acc_journals (voucher_no, voucher_date, primary_side, primary_account_id, primary_amount, narration, ref_no, created_by)
    values (v_no, v_date, v_side, v_acc, v_amt, btrim(coalesce(p ->> 'narration', '')), upper(btrim(coalesce(p ->> 'ref_no', ''))), _acc_user())
    returning id into v_id;
  else
    update acc_journals set voucher_date = v_date, primary_side = v_side, primary_account_id = v_acc, primary_amount = v_amt,
                            narration = btrim(coalesce(p ->> 'narration', '')), ref_no = upper(btrim(coalesce(p ->> 'ref_no', ''))), updated_at = now()
     where id = v_id
    returning voucher_no into v_no;
    if not found then raise exception 'That journal voucher no longer exists.'; end if;
    delete from acc_journal_lines where journal_id = v_id;
  end if;
  insert into acc_journal_lines (journal_id, account_id, amount, line_order)
    select v_id, account_id, amount, row_number() over (order by ord) - 1 from _acc_jl;
  return jsonb_build_object('id', v_id, 'voucher_no', v_no);
end $$;

-- ============================================================ 7. sales / purchase bills
-- p = {payment_mode: Cash|Debit, account_id, bill_date, ref_no, discount, credit_days,
--      items: [{item_id, item_name, hsn_code, qty, rate, gst_type, tax_rate}]}
-- The totals are worked out here (per line: taxable = qty × rate, tax = taxable × rate %, both rounded to paise; the discount can not be more than
-- the bill) — the same arithmetic as the bill form, so the screen and the books always agree.
create or replace function acc_save_bill(p_kind text, p_id bigint, p jsonb, p_draft_id bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id      bigint := p_id;
  v_mode    text := coalesce(nullif(p ->> 'payment_mode', ''), 'Debit');
  v_acc     bigint := nullif(p ->> 'account_id', '')::bigint;
  v_date    date := coalesce(nullif(p ->> 'bill_date', '')::date, current_date);
  v_days    numeric := nullif(btrim(coalesce(p ->> 'credit_days', '')), '')::numeric;
  v_party   text := '';
  v_taxable numeric;
  v_tax     numeric;
  v_disc    numeric;
  v_total   numeric;
  v_n       int;
  v_no      text;
begin
  perform _require_user();
  if p_kind not in ('sales', 'purchase') then raise exception 'Unknown bill type.'; end if;
  if p_draft_id is null then perform _require_write('account_vouchers'); else perform _require_write('voucher_approvals'); end if;
  if v_mode not in ('Cash', 'Debit') then raise exception 'Unknown payment mode.'; end if;
  if v_mode = 'Debit' and v_acc is null then raise exception 'Please select an account for a Debit bill'; end if;
  if v_mode = 'Cash' then v_acc := null; v_days := null; end if;
  if v_acc is not null then
    select name into v_party from acc_accounts where id = v_acc;
    if v_party is null then raise exception 'The selected account no longer exists.'; end if;
  end if;
  if v_days is not null and (v_days < 0 or v_days <> trunc(v_days)) then raise exception 'Credit days must be a whole number (0 or more)'; end if;

  create temp table if not exists _acc_bi (item_id bigint, item_name text, hsn_code text, qty numeric, rate numeric, gst_type text, tax_rate numeric,
                                           taxable numeric, tax numeric, ord int) on commit drop;
  delete from _acc_bi;
  insert into _acc_bi (item_id, item_name, hsn_code, qty, rate, gst_type, tax_rate, ord)
    select nullif(i ->> 'item_id', '')::bigint, btrim(coalesce(i ->> 'item_name', '')), btrim(coalesce(i ->> 'hsn_code', '')),
           coalesce(nullif(i ->> 'qty', '')::numeric, 0), round(coalesce(nullif(i ->> 'rate', '')::numeric, 0), 2),
           case when i ->> 'gst_type' = 'IGST' then 'IGST' else 'CGST/SGST' end, coalesce(nullif(i ->> 'tax_rate', '')::numeric, 0), (o - 1)::int
      from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) with ordinality as x(i, o);
  delete from _acc_bi where item_name = '';
  select count(*) into v_n from _acc_bi;
  if v_n = 0 then raise exception 'Add at least one item'; end if;
  if exists (select 1 from _acc_bi where qty < 0 or rate < 0 or tax_rate < 0) then raise exception 'Quantity, rate and tax can not be negative.'; end if;
  update _acc_bi set taxable = round(qty * rate, 2);
  update _acc_bi set tax = round(taxable * tax_rate / 100, 2);
  select round(coalesce(sum(taxable), 0), 2), round(coalesce(sum(tax), 0), 2) into v_taxable, v_tax from _acc_bi;
  v_disc := round(least(greatest(coalesce(nullif(p ->> 'discount', '')::numeric, 0), 0), v_taxable + v_tax), 2);
  v_total := round(v_taxable + v_tax - v_disc, 2);

  if v_id is null then
    v_no := _acc_next_no('acc_bills', 'bill_no', case when p_kind = 'sales' then 'SB-' else 'PB-' end, v_date);
    insert into acc_bills (kind, bill_no, bill_date, payment_mode, account_id, party_name, ref_no, taxable_amount, tax_amount, discount_amount, total_amount,
                           credit_days, due_date, created_by)
    values (p_kind, v_no, v_date, v_mode, v_acc, coalesce(v_party, ''), upper(btrim(coalesce(p ->> 'ref_no', ''))), v_taxable, v_tax, v_disc, v_total,
            v_days::int, case when v_days is not null then v_date + v_days::int end, _acc_user())
    returning id into v_id;
  else
    update acc_bills set bill_date = v_date, payment_mode = v_mode, account_id = v_acc, party_name = coalesce(v_party, ''), ref_no = upper(btrim(coalesce(p ->> 'ref_no', ''))),
                         taxable_amount = v_taxable, tax_amount = v_tax, discount_amount = v_disc, total_amount = v_total,
                         credit_days = v_days::int, due_date = case when v_days is not null then v_date + v_days::int end, updated_at = now()
     where id = v_id and kind = p_kind
    returning bill_no into v_no;
    if not found then raise exception 'That bill no longer exists.'; end if;
    delete from acc_bill_items where bill_id = v_id;
  end if;
  insert into acc_bill_items (bill_id, item_id, item_name, hsn_code, qty, rate, gst_type, tax_rate, taxable_amount, tax_amount, total_amount, line_order)
    select v_id, case when exists (select 1 from acc_items it where it.id = b.item_id) then b.item_id end, b.item_name, b.hsn_code, b.qty, b.rate, b.gst_type, b.tax_rate,
           b.taxable, b.tax, b.taxable + b.tax, row_number() over (order by b.ord) - 1
      from _acc_bi b;
  perform _acc_draft_done(p_draft_id, p_kind || '_bill', v_id, v_no);
  return jsonb_build_object('id', v_id, 'voucher_no', v_no, 'total', v_total);
end $$;

-- ============================================================ 8. cash exchange
-- p = {cash_account_id, exchange_date, narration, given_denomination, received_denomination}
create or replace function acc_save_exchange(p_id bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id    bigint := p_id;
  v_acc   bigint := nullif(p ->> 'cash_account_id', '')::bigint;
  v_date  date := coalesce(nullif(p ->> 'exchange_date', '')::date, current_date);
  v_given numeric := _acc_denom_total(p -> 'given_denomination');
  v_recv  numeric := _acc_denom_total(p -> 'received_denomination');
  v_no    text;
begin
  perform _require_user();
  perform _require_write('account_vouchers');
  if v_acc is null then raise exception 'Please select a Cash Account'; end if;
  if not exists (select 1 from acc_accounts where id = v_acc and group_name = 'Cash-in-Hand') then raise exception 'The cash account must be a Cash-in-Hand account.'; end if;
  if v_given <= 0 then raise exception 'Enter the notes being exchanged away'; end if;
  if v_recv <= 0 then raise exception 'Enter the notes received back'; end if;
  if v_given <> v_recv then raise exception 'Given (₹%) and Received (₹%) must be equal', v_given, v_recv; end if;
  if v_id is null then
    v_no := _acc_next_no('acc_cash_exchanges', 'voucher_no', 'CX-', v_date);
    insert into acc_cash_exchanges (voucher_no, exchange_date, cash_account_id, amount, given_denomination, received_denomination, narration, created_by)
    values (v_no, v_date, v_acc, v_given, _acc_denom_clean(p -> 'given_denomination'), _acc_denom_clean(p -> 'received_denomination'),
            btrim(coalesce(p ->> 'narration', '')), _acc_user())
    returning id into v_id;
  else
    update acc_cash_exchanges set exchange_date = v_date, cash_account_id = v_acc, amount = v_given,
           given_denomination = _acc_denom_clean(p -> 'given_denomination'), received_denomination = _acc_denom_clean(p -> 'received_denomination'),
           narration = btrim(coalesce(p ->> 'narration', '')), updated_at = now()
     where id = v_id
    returning voucher_no into v_no;
    if not found then raise exception 'That cash exchange no longer exists.'; end if;
  end if;
  return jsonb_build_object('id', v_id, 'voucher_no', v_no);
end $$;

-- ============================================================ 9. delete any entry
-- p_type = voucher | journal | bill | exchange
create or replace function acc_delete_entry(p_type text, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('account_vouchers');
  if p_type = 'voucher' then delete from acc_vouchers where id = p_id;
  elsif p_type = 'journal' then delete from acc_journals where id = p_id;
  elsif p_type = 'bill' then delete from acc_bills where id = p_id;
  elsif p_type = 'exchange' then delete from acc_cash_exchanges where id = p_id;
  else raise exception 'Unknown entry type.';
  end if;
  if not found then raise exception 'That entry does not exist.'; end if;
end $$;

-- ============================================================ 10. bill items
create or replace function acc_save_item(p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := p_id; v_name text := btrim(coalesce(p ->> 'name', ''));
begin
  perform _require_user();
  perform _require_write('account_vouchers');
  if v_name = '' then raise exception 'Enter the item name.'; end if;
  if exists (select 1 from acc_items where lower(btrim(name)) = lower(v_name) and id is distinct from p_id) then raise exception 'An item named "%" already exists.', v_name; end if;
  if v_id is null then
    insert into acc_items (name, hsn_code, unit, sell_rate, purchase_rate, tax_rate, active)
    values (v_name, btrim(coalesce(p ->> 'hsn_code', '')), btrim(coalesce(p ->> 'unit', '')), round(coalesce(nullif(p ->> 'sell_rate', '')::numeric, 0), 2),
            round(coalesce(nullif(p ->> 'purchase_rate', '')::numeric, 0), 2), coalesce(nullif(p ->> 'tax_rate', '')::numeric, 0), coalesce((p ->> 'active')::boolean, true))
    returning id into v_id;
  else
    update acc_items set name = v_name, hsn_code = btrim(coalesce(p ->> 'hsn_code', '')), unit = btrim(coalesce(p ->> 'unit', '')),
           sell_rate = round(coalesce(nullif(p ->> 'sell_rate', '')::numeric, 0), 2), purchase_rate = round(coalesce(nullif(p ->> 'purchase_rate', '')::numeric, 0), 2),
           tax_rate = coalesce(nullif(p ->> 'tax_rate', '')::numeric, 0), active = coalesce((p ->> 'active')::boolean, true)
     where id = v_id;
    if not found then raise exception 'That item no longer exists.'; end if;
  end if;
  return v_id;
end $$;

create or replace function acc_delete_item(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('account_vouchers');
  delete from acc_items where id = p_id;     -- bills keep the item name; their link is cleared
  if not found then raise exception 'That item does not exist.'; end if;
end $$;

-- ============================================================ 11. voucher approvals
-- payment mode / supplier / customer name → ledger account. p_account_id null removes the mapping.
create or replace function acc_set_map(p_kind text, p_name text, p_account_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('voucher_approvals');
  if p_kind not in ('payment_mode', 'supplier', 'customer') then raise exception 'Unknown mapping.'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Enter the name to map.'; end if;
  if p_account_id is null then
    delete from acc_account_map where kind = p_kind and name = btrim(p_name);
  else
    insert into acc_account_map (kind, name, account_id) values (p_kind, btrim(p_name), p_account_id)
    on conflict (kind, name) do update set account_id = excluded.account_id;
  end if;
end $$;

create or replace function acc_set_drafts_since(p_date date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('voucher_approvals');
  insert into acc_settings (id, drafts_since) values (1, p_date) on conflict (id) do update set drafts_since = excluded.drafts_since;
end $$;

-- the ledger account of an ERP supplier / customer: the account linked to it, else the name mapping
create or replace function _acc_party_account(p_kind text, p_party_id bigint, p_name text) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from acc_accounts where p_party_id is not null and ((p_kind = 'supplier' and supplier_id = p_party_id) or (p_kind = 'customer' and customer_id = p_party_id)) order by id limit 1),
    (select account_id from acc_account_map where kind = p_kind and name = btrim(coalesce(p_name, '')) limit 1));
$$;

-- the bank / cash account a payment mode is paid from: the mapping, else (mode "Cash") the only Cash-in-Hand account if there is just one
create or replace function _acc_mode_account(p_mode text) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select account_id from acc_account_map where kind = 'payment_mode' and name = btrim(coalesce(p_mode, '')) limit 1),
    (select min(id) from acc_accounts where group_name = 'Cash-in-Hand' and lower(btrim(coalesce(p_mode, ''))) = 'cash'
      having count(*) = 1));
$$;

-- one proposed draft: insert it, refresh a still-pending one, or leave an approved / rejected one alone
create or replace function _acc_upsert_draft(d acc_drafts) returns void
language plpgsql security definer set search_path = public as $$
declare live acc_drafts;
begin
  if exists (select 1 from acc_drafts where source_type = d.source_type and source_id = d.source_id and role = d.role and status = 'approved') then return; end if;
  select * into live from acc_drafts where source_type = d.source_type and source_id = d.source_id and role = d.role and status = 'pending';
  if found then
    -- refresh what the document says now, but keep accounts / items somebody already chose when they can not be worked out
    update acc_drafts set
           voucher_date = d.voucher_date, amount = d.amount, narration = d.narration, ref_no = d.ref_no, cheque_no = d.cheque_no, source_ref = d.source_ref,
           voucher_type = case when live.voucher_type in ('sales_bill', 'purchase_bill') then live.voucher_type
                               when live.from_account_id is not null and d.from_account_id is null then live.voucher_type else d.voucher_type end,
           from_account_id = coalesce(d.from_account_id, live.from_account_id),
           to_account_id = coalesce(d.to_account_id, live.to_account_id),
           account_id = coalesce(d.account_id, live.account_id),
           items = case when jsonb_array_length(live.items) > 0 then live.items else d.items end,
           issue = case when coalesce(d.from_account_id, live.from_account_id) is not null and coalesce(d.to_account_id, live.to_account_id) is not null then ''
                        when live.voucher_type in ('sales_bill', 'purchase_bill') and coalesce(d.account_id, live.account_id) is not null then ''
                        else d.issue end,
           updated_at = now()
     where id = live.id
       and (voucher_date, amount, narration, ref_no, cheque_no, source_ref) is distinct from (d.voucher_date, d.amount, d.narration, d.ref_no, d.cheque_no, d.source_ref)
        or (id = live.id and ((d.from_account_id is not null and live.from_account_id is null) or (d.to_account_id is not null and live.to_account_id is null)
                              or (d.account_id is not null and live.account_id is null)));
    return;
  end if;
  if exists (select 1 from acc_drafts where source_type = d.source_type and source_id = d.source_id and role = d.role) then return; end if;  -- only rejected ones: respect that
  insert into acc_drafts (source_type, source_id, source_ref, role, voucher_type, voucher_date, from_account_id, to_account_id, account_id, payment_mode,
                          amount, items, narration, ref_no, cheque_no, issue, created_by)
  values (d.source_type, d.source_id, d.source_ref, d.role, d.voucher_type, d.voucher_date, d.from_account_id, d.to_account_id, d.account_id, d.payment_mode,
          d.amount, d.items, d.narration, d.ref_no, d.cheque_no, d.issue, 'System');
end $$;

-- Proposes drafts from the ERP documents dated on/after acc_settings.drafts_since:
--   posted Purchase Invoice → Purchase Bill draft (the supplier's account, the invoice lines)
--   Purchase Payment        → Bank / Cash Payment draft (from the payment mode's account to the supplier's account)
--   Dispatched dispatch     → Sales Bill draft (the customer's account, product × qty × rate, vehicle no.)
-- A pending draft whose document was cancelled / deleted is dropped. Called by the Voucher Approvals page. Returns the pending count.
create or replace function acc_sync_drafts() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_since date;
  r       record;
  d       acc_drafts;
  v_acc   bigint;
  v_mode  bigint;
  v_grp   text;
  v_n     int;
begin
  perform _require_user();
  if page_level('voucher_approvals') = 'hidden' then raise exception 'You do not have access to Voucher Approvals.' using errcode = '42501'; end if;
  select drafts_since into v_since from acc_settings where id = 1;

  if v_since is not null then
    -- ---------------------------------------------------- purchase invoices → purchase bills
    begin
      for r in
        select pi.id, pi.pinv_no, pi.supplier_inv_no, pi.inv_date, pi.supplier_id, pi.total_amount, coalesce(pi.tax_type, '') as tax_type, s.name as supplier
          from purchase_invoices pi join suppliers s on s.id = pi.supplier_id
         where pi.status = 'Posted' and pi.inv_date >= v_since
      loop
        v_acc := _acc_party_account('supplier', r.supplier_id, r.supplier);
        d := null;
        d.source_type := 'purchase_invoice'; d.source_id := r.id::text; d.source_ref := r.pinv_no; d.role := 'purchase_bill'; d.voucher_type := 'purchase_bill';
        d.voucher_date := r.inv_date; d.account_id := v_acc; d.payment_mode := 'Debit'; d.amount := round(r.total_amount, 2);
        d.ref_no := coalesce(r.supplier_inv_no, ''); d.narration := format('Purchase invoice %s (supplier invoice %s)', r.pinv_no, r.supplier_inv_no);
        d.cheque_no := '';
        d.items := coalesce((select jsonb_agg(jsonb_build_object('itemId', '', 'itemName', ii.item, 'hsnCode', coalesce(poi.hsn, ''), 'qty', ii.qty::text, 'rate', round(ii.rate, 2)::text,
                                                                 'gstType', case when r.tax_type ilike '%igst%' then 'IGST' else 'CGST/SGST' end, 'taxRate', ii.gst_pct::text) order by ii.line_no)
                               from purchase_invoice_items ii left join purchase_order_items poi on poi.id = ii.po_item_id
                              where ii.invoice_id = r.id), '[]'::jsonb);
        d.issue := case when v_acc is null then format('No account linked or mapped for supplier "%s"', r.supplier) else '' end;
        perform _acc_upsert_draft(d);
      end loop;
      delete from acc_drafts x where x.status = 'pending' and x.source_type = 'purchase_invoice'
         and not exists (select 1 from purchase_invoices pi where pi.id::text = x.source_id and pi.status = 'Posted');
    exception when undefined_table or undefined_column then null;
    end;

    -- ---------------------------------------------------- purchase payments → bank / cash payments
    begin
      for r in
        select pp.id, pp.pay_no, pp.pay_date, pp.amount, coalesce(pp.mode, '') as mode, coalesce(pp.reference, '') as reference,
               pi.pinv_no, pi.supplier_id, s.name as supplier
          from purchase_payments pp join purchase_invoices pi on pi.id = pp.pinv_id join suppliers s on s.id = pi.supplier_id
         where pp.pay_date >= v_since
      loop
        v_acc := _acc_party_account('supplier', r.supplier_id, r.supplier);
        v_mode := _acc_mode_account(r.mode);
        v_grp := (select group_name from acc_accounts where id = v_mode);
        d := null;
        d.source_type := 'purchase_payment'; d.source_id := r.id::text; d.source_ref := r.pay_no; d.role := 'supplier_payment';
        d.voucher_type := case when v_grp is not null then (case when v_grp = 'Cash-in-Hand' then 'cash_payment' else 'bank_payment' end)
                               when lower(r.mode) = 'cash' then 'cash_payment' else 'bank_payment' end;
        d.voucher_date := r.pay_date; d.from_account_id := v_mode; d.to_account_id := v_acc; d.payment_mode := 'Debit'; d.amount := round(r.amount, 2);
        d.items := '[]'::jsonb; d.ref_no := '';
        d.narration := format('Payment %s against %s – %s%s', r.pay_no, r.pinv_no, coalesce(nullif(r.mode, ''), 'payment'), case when r.reference <> '' then ' (' || r.reference || ')' else '' end);
        d.cheque_no := case when r.mode = 'Cheque' then r.reference else '' end;
        d.issue := concat_ws('; ', case when v_mode is null then format('No account mapped for payment mode "%s"', coalesce(nullif(r.mode, ''), '—')) end,
                                   case when v_acc is null then format('No account linked or mapped for supplier "%s"', r.supplier) end);
        perform _acc_upsert_draft(d);
      end loop;
      delete from acc_drafts x where x.status = 'pending' and x.source_type = 'purchase_payment'
         and not exists (select 1 from purchase_payments pp where pp.id::text = x.source_id);
    exception when undefined_table or undefined_column then null;
    end;

    -- ---------------------------------------------------- dispatches (sales invoices) → sales bills
    begin
      for r in
        select ds.dispatch_no, ds.invoice_no, ds.date, ds.customer, ds.customer_id, ds.qty, ds.sales_rate, ds.vehicle_no, p.name as product
          from dispatches ds left join products p on p.id = ds.product_id
         where ds.status::text = 'Dispatched' and ds.sales_rate is not null and ds.date >= v_since
      loop
        v_acc := _acc_party_account('customer', r.customer_id, r.customer);
        d := null;
        d.source_type := 'dispatch'; d.source_id := r.dispatch_no; d.source_ref := coalesce(nullif(r.invoice_no, ''), r.dispatch_no); d.role := 'sales_bill';
        d.voucher_type := 'sales_bill'; d.voucher_date := r.date; d.account_id := v_acc; d.payment_mode := 'Debit';
        d.amount := round(r.qty * r.sales_rate, 2); d.ref_no := coalesce(r.vehicle_no, ''); d.cheque_no := '';
        d.narration := format('Dispatch %s%s', r.dispatch_no, case when coalesce(r.invoice_no, '') <> '' then ' – invoice ' || r.invoice_no else '' end);
        d.items := jsonb_build_array(jsonb_build_object('itemId', '', 'itemName', coalesce(r.product, 'Goods'), 'hsnCode', '', 'qty', r.qty::text,
                                                        'rate', round(r.sales_rate, 2)::text, 'gstType', 'CGST/SGST', 'taxRate', '0'));
        d.issue := case when v_acc is null then format('No account linked or mapped for customer "%s"', coalesce(nullif(r.customer, ''), '—')) else '' end;
        perform _acc_upsert_draft(d);
      end loop;
      delete from acc_drafts x where x.status = 'pending' and x.source_type = 'dispatch'
         and not exists (select 1 from dispatches ds where ds.dispatch_no = x.source_id and ds.status::text = 'Dispatched');
    exception when undefined_table or undefined_column then null;
    end;
  end if;

  select count(*) into v_n from acc_drafts where status = 'pending';
  return v_n;
end $$;

-- "Save Draft" from Voucher Approvals: keeps the edits on the pending draft, posts nothing.
-- p = {voucher_type, voucher_date, from_account_id, to_account_id, account_id, payment_mode, amount, discount, items, narration, ref_no, cheque_no}
create or replace function acc_save_draft(p_id bigint, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v acc_drafts; v_type text;
begin
  perform _require_user();
  perform _require_write('voucher_approvals');
  select * into v from acc_drafts where id = p_id and status = 'pending' for update;
  if not found then raise exception 'This draft is no longer pending.'; end if;
  v_type := coalesce(nullif(p ->> 'voucher_type', ''), v.voucher_type);
  if (v.voucher_type in ('sales_bill', 'purchase_bill')) <> (v_type in ('sales_bill', 'purchase_bill')) then raise exception 'A bill draft stays a bill and a voucher draft stays a voucher.'; end if;
  if nullif(p ->> 'from_account_id', '') is not null and p ->> 'from_account_id' = p ->> 'to_account_id' then raise exception 'From and To account must be different.'; end if;
  update acc_drafts set
         voucher_type = v_type,
         voucher_date = coalesce(nullif(p ->> 'voucher_date', '')::date, voucher_date),
         from_account_id = nullif(p ->> 'from_account_id', '')::bigint,
         to_account_id = nullif(p ->> 'to_account_id', '')::bigint,
         account_id = nullif(p ->> 'account_id', '')::bigint,
         payment_mode = coalesce(nullif(p ->> 'payment_mode', ''), payment_mode),
         amount = round(coalesce(nullif(p ->> 'amount', '')::numeric, amount), 2),
         discount = round(coalesce(nullif(p ->> 'discount', '')::numeric, discount), 2),
         items = coalesce(p -> 'items', items),
         narration = coalesce(p ->> 'narration', narration),
         ref_no = upper(coalesce(p ->> 'ref_no', ref_no)),
         cheque_no = coalesce(p ->> 'cheque_no', cheque_no),
         issue = case when nullif(p ->> 'account_id', '') is not null or (nullif(p ->> 'from_account_id', '') is not null and nullif(p ->> 'to_account_id', '') is not null) then '' else issue end,
         updated_at = now()
   where id = p_id;
end $$;

create or replace function acc_reject_draft(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('voucher_approvals');
  update acc_drafts set status = 'rejected', reject_reason = btrim(coalesce(p_reason, '')), decided_by = _acc_user(), decided_at = now(), updated_at = now()
   where id = p_id and status = 'pending';
  if not found then raise exception 'This draft is no longer pending.'; end if;
end $$;

-- ============================================================ 12. grants
revoke all on function _acc_can_read(), _acc_user(), _acc_next_no(text, text, text, date), _acc_draft_done(bigint, text, bigint, text),
                       _acc_party_account(text, bigint, text), _acc_mode_account(text), _acc_upsert_draft(acc_drafts) from public, anon;
grant execute on function _acc_can_read() to authenticated;   -- used by the read policies
revoke all on function _acc_user(), _acc_next_no(text, text, text, date), _acc_draft_done(bigint, text, bigint, text),
                       _acc_party_account(text, bigint, text), _acc_mode_account(text), _acc_upsert_draft(acc_drafts) from authenticated;

revoke all on function acc_save_account(bigint, jsonb), acc_delete_account(bigint), acc_save_voucher(text, bigint, jsonb, bigint), acc_save_journal(bigint, jsonb),
                       acc_save_bill(text, bigint, jsonb, bigint), acc_save_exchange(bigint, jsonb), acc_delete_entry(text, bigint), acc_save_item(bigint, jsonb),
                       acc_delete_item(bigint), acc_set_map(text, text, bigint), acc_set_drafts_since(date), acc_sync_drafts(), acc_save_draft(bigint, jsonb),
                       acc_reject_draft(bigint, text) from public, anon;
grant execute on function acc_save_account(bigint, jsonb), acc_delete_account(bigint), acc_save_voucher(text, bigint, jsonb, bigint), acc_save_journal(bigint, jsonb),
                          acc_save_bill(text, bigint, jsonb, bigint), acc_save_exchange(bigint, jsonb), acc_delete_entry(text, bigint), acc_save_item(bigint, jsonb),
                          acc_delete_item(bigint), acc_set_map(text, text, bigint), acc_set_drafts_since(date), acc_sync_drafts(), acc_save_draft(bigint, jsonb),
                          acc_reject_draft(bigint, text) to authenticated;

notify pgrst, 'reload schema';
