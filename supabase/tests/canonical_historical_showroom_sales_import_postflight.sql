do $$
declare
  v_held uuid[] := array[
    '36efa3b4-12a1-4eff-b346-7467b08aa14d','67f4258b-b486-499a-83ed-fe43012bfcca',
    '43c00089-d7dd-4119-b0e7-cd89c1d97343','46efd2df-5097-4449-b5f9-3e23c7554fa9',
    'a09d1ff0-7491-4ae8-af74-b805cd667d02','05cdc68e-6e92-4371-84eb-fcb42758ac19',
    '18fdf2ff-dc1d-40fd-ac01-029173790bf8','6558b8b5-5b39-4801-8067-8bfee9aaefbb',
    '8e607147-cea9-4dcf-b21f-1d300c51ba73','0f92b2b8-a5cd-4de4-a1f3-fb03102f28a5'
  ]::uuid[];
begin
  if (select count(*) from public.sale_historical_sources where source_system='showroom') <> 215 then raise exception 'expected 215 sources'; end if;
  if (select count(*) from public.sale_line_historical_sources where source_system='showroom') <> 215 then raise exception 'expected 215 source lines'; end if;
  if (select count(*) from public.sale_historical_sources where classification='A') <> 59 then raise exception 'expected 59 A'; end if;
  if (select count(*) from public.sale_historical_sources where classification='B') <> 156 then raise exception 'expected 156 B'; end if;
  if (select sum(s.total_amount) from public.sales s join public.sale_historical_sources h on h.sale_id=s.id and h.tenant_id=s.tenant_id) <> 11369400 then raise exception 'total mismatch'; end if;
  if exists(select 1 from public.sales where id=any(v_held)) then raise exception 'held C/D sale imported'; end if;
  if exists(select 1 from public.sales s join public.sale_historical_sources h on h.sale_id=s.id and h.tenant_id=s.tenant_id where not s.is_historical or s.status not in('confirmed','cancelled')) then raise exception 'historical state mismatch'; end if;
  if (select count(*) from public.account_moves)<>460 or (select count(*) from public.account_move_lines)<>920
    or (select count(*) from public.financial_payments)<>11 or (select count(*) from public.account_partial_reconcile)<>220
    or (select coalesce(sum(amount_residual),0) from public.account_move_lines)<>3573100
    or (select count(*) from public.stock_moves)<>136 or (select count(*) from public.inventory_reservations)<>0
    or (select count(*) from public.sale_deliveries)<>0
    or (select md5(string_agg(id::text||':'||status,',' order by id)) from public.stock_tracking_units)<>'05b3817abbcb346dd967cf151057e386'
  then raise exception 'financial or inventory side effect'; end if;
end $$;

select count(*) legacy_total,
  count(*) filter(where h.classification='A') class_a,
  count(*) filter(where h.classification='B') class_b,
  count(sl.id) lines,
  sum(s.total_amount) total_amount
from public.sales s join public.sale_historical_sources h on h.sale_id=s.id and h.tenant_id=s.tenant_id
join public.sale_lines sl on sl.sale_id=s.id and sl.tenant_id=s.tenant_id
where h.source_system='showroom';

select
  (select count(*) from public.account_moves) account_moves,
  (select count(*) from public.account_move_lines) account_move_lines,
  (select count(*) from public.financial_payments) financial_payments,
  (select count(*) from public.account_partial_reconcile) reconciliations,
  (select coalesce(sum(amount_residual),0) from public.account_move_lines) ar_residual,
  (select count(*) from public.stock_moves) stock_moves,
  (select count(*) from public.inventory_reservations) reservations,
  (select count(*) from public.sale_deliveries) deliveries,
  (select count(*) from public.sale_historical_sources group by tenant_id,source_system,source_sale_id having count(*)>1 limit 1) duplicate_sources,
  (select count(*) from public.sales s left join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id where s.is_historical and b.id is null) orphan_branches,
  (select count(*) from public.sales s left join public.partners p on p.id=s.customer_id and p.tenant_id=s.tenant_id where s.is_historical and p.id is null) orphan_customers,
  (select count(*) from public.sale_lines l join public.sales s on s.id=l.sale_id and s.tenant_id=l.tenant_id left join public.product_products p on p.id=l.product_id and p.tenant_id=l.tenant_id where s.is_historical and p.id is null) orphan_products;
