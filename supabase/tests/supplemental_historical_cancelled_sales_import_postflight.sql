with target(id) as (values
 ('46efd2df-5097-4449-b5f9-3e23c7554fa9'::uuid),
 ('a09d1ff0-7491-4ae8-af74-b805cd667d02'::uuid)
), excluded(id) as (values
 ('05cdc68e-6e92-4371-84eb-fcb42758ac19'::uuid),('18fdf2ff-dc1d-40fd-ac01-029173790bf8'),
 ('6558b8b5-5b39-4801-8067-8bfee9aaefbb'),('8e607147-cea9-4dcf-b21f-1d300c51ba73'),
 ('0f92b2b8-a5cd-4de4-a1f3-fb03102f28a5'),('36efa3b4-12a1-4eff-b346-7467b08aa14d'),
 ('43c00089-d7dd-4119-b0e7-cd89c1d97343'),('67f4258b-b486-499a-83ed-fe43012bfcca')
)
select
 (select count(*) from public.sales s join target t on t.id=s.id where s.is_historical and s.status='cancelled') supplemental_sales,
 (select count(*) from public.sale_lines l join target t on t.id=l.sale_id) supplemental_lines,
 (select count(*) from public.sale_historical_sources where source_system='showroom') all_historical_sales,
 (select count(*) from public.sale_line_historical_sources where source_system='showroom') all_historical_lines,
 (select sum(s.total_amount) from public.sales s join public.sale_historical_sources h on h.sale_id=s.id and h.tenant_id=s.tenant_id where h.source_system='showroom') all_historical_total,
 (select count(*) from public.sales s join excluded e on e.id=s.id) excluded_imported,
 (select count(*) from public.sale_historical_sources group by tenant_id,source_system,source_sale_id having count(*)>1 limit 1) duplicate_sources,
 (select count(*) from public.sales where sale_number in ('SAL-2026-900000134','SAL-2026-900000186')) target_numbers,
 (select status from public.stock_tracking_units where id='b2bb9bea-ab04-4c58-bca2-0372d58fbfb6') reserved_serial_state,
 (select status from public.stock_tracking_units where id='c50c3fb2-287d-4138-a754-c55e099433d2') reused_serial_state,
 (select count(*) from public.account_moves) account_moves,
 (select count(*) from public.account_move_lines) account_move_lines,
 (select count(*) from public.financial_payments) financial_payments,
 (select count(*) from public.account_partial_reconcile) reconciliations,
 (select coalesce(sum(amount_residual),0) from public.account_move_lines) ar_residual,
 (select count(*) from public.stock_moves) stock_moves,
 (select count(*) from public.inventory_reservations) reservations,
 (select count(*) from public.sale_deliveries) deliveries;

select h.sale_id,h.source_sale_number,h.classification,h.financial_account_move_id,h.inventory_evidence_type,
 h.provenance->>'financial_reversal_move_id' reversal_move_id,
 h.provenance->>'subsequent_legacy_sale_id' subsequent_sale_id,
 lh.tracking_unit_id,lh.inventory_evidence_type line_evidence
from public.sale_historical_sources h
join public.sale_line_historical_sources lh on lh.tenant_id=h.tenant_id and lh.sale_line_id in
 (select id from public.sale_lines where sale_id=h.sale_id and tenant_id=h.tenant_id)
where h.sale_id in ('46efd2df-5097-4449-b5f9-3e23c7554fa9','a09d1ff0-7491-4ae8-af74-b805cd667d02')
order by h.source_sale_number;
