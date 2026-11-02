-- 38 · Quotation cost sheet ("detailed" quotation).
-- Each quotation line can carry an editable cost sheet: a numbered list of rows {label, basis, amount, bold}
-- (input weight, material, forging labour, rejection, machining, scrap recovery, packing, profit, final cost …).
-- It is only shown on the "detailed" printout / Excel, and is hidden from roles that may not see Costs & margins.
-- Safe to run more than once.

alter table sales_quotation_items add column if not exists costing jsonb;

-- appended at the end, so the view keeps all its existing columns in place
create or replace view v_sales_quotation_items as
select i.id, i.quotation_id, coalesce(q.qt_no, q.draft_no) as doc_no, q.qt_no, q.draft_no, q.status, q.qt_date, q.valid_until, q.salesperson,
       mask_text(q.customer, 'party_names') as customer,
       i.line_no, i.product, i.grade, i.size, i.uom, i.qty, i.discount_pct,
       mask_num(i.rate, 'sales_rates')                                                      as rate,
       mask_num(round(i.rate * (1 - i.discount_pct / 100), 4), 'sales_rates')               as net_rate,
       mask_num(round(i.qty * i.rate * (1 - i.discount_pct / 100), 2), 'sales_rates')       as amount,
       mask_num(i.material_cost,   'margins') as material_cost,
       mask_num(i.processing_cost, 'margins') as processing_cost,
       mask_num(i.other_cost,      'margins') as other_cost,
       mask_num(case when i.material_cost is null then null else i.material_cost + coalesce(i.processing_cost, 0) + coalesce(i.other_cost, 0) end, 'margins') as unit_cost,
       mask_num(case when i.material_cost is null then null
                     else round(i.rate * (1 - i.discount_pct / 100) - (i.material_cost + coalesce(i.processing_cost, 0) + coalesce(i.other_cost, 0)), 4) end, 'margins') as unit_profit,
       mask_num(case when i.material_cost is null or i.rate * (1 - i.discount_pct / 100) <= 0 then null
                     else round((i.rate * (1 - i.discount_pct / 100) - (i.material_cost + coalesce(i.processing_cost, 0) + coalesce(i.other_cost, 0)))
                                / (i.rate * (1 - i.discount_pct / 100)) * 100, 2) end, 'margins') as margin_pct,
       case when can_see_field('margins') then i.costing end as costing
  from sales_quotation_items i
  join sales_quotations q on q.id = i.quotation_id;

-- save_sales_quotation: also store the line's cost sheet (text patch on the current definition)
do $$
declare
  r record;
  d text;
  v_from_cols text := 'discount_pct, material_cost, processing_cost, other_cost)';
  v_from_vals text := $f$nullif(x ->> 'other_cost', '')::numeric);$f$;
  v_hit boolean := false;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_sales_quotation' loop
    d := pg_get_functiondef(r.oid);
    if position('costing' in d) > 0 then v_hit := true; continue; end if;
    if position(v_from_cols in d) = 0 or position(v_from_vals in d) = 0 then continue; end if;
    d := replace(d, v_from_cols, 'discount_pct, material_cost, processing_cost, other_cost, costing)');
    d := replace(d, v_from_vals, $f$nullif(x ->> 'other_cost', '')::numeric,
            case when jsonb_typeof(x -> 'costing') = 'array' and jsonb_array_length(x -> 'costing') > 0 then x -> 'costing' end);$f$);
    execute d;
    v_hit := true;
  end loop;
  if not v_hit then raise exception 'Could not patch save_sales_quotation (text not found).'; end if;
end $$;
