-- A sales order can now be corrected until production starts (Draft or Confirmed), not only while Draft.
do $$
begin
  perform _patch_fn('save_sales_order',
    $f$if o.status <> 'Draft' then raise exception 'Sales order % is % and can no longer be edited.', o.so_no, o.status; end if;$f$,
    $f$if o.status not in ('Draft', 'Confirmed') then raise exception 'Sales order % is % and can no longer be edited.', o.so_no, o.status; end if;$f$);
end $$;
