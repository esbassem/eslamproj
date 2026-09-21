begin;

create or replace function public.get_historical_sales_read(p_sale_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_result jsonb;
begin
  if v_tenant_id is null or not public.has_permission('sales.view', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_VIEW_DENIED';
  end if;

  if coalesce(cardinality(p_sale_ids), 0) > 100 then
    raise exception using errcode = '22023', message = 'SALES_HISTORICAL_READ_LIMIT_EXCEEDED';
  end if;

  select coalesce(jsonb_agg(payload order by effective_sale_date desc, sale_id), '[]'::jsonb)
  into v_result
  from (
    select
      s.id sale_id,
      s.effective_sale_date,
      jsonb_build_object(
        'sale_id', s.id,
        'is_historical', true,
        'source_system', h.source_system,
        'source_sale_id', h.source_sale_id,
        'source_sale_number', h.source_sale_number,
        'canonical_sale_number', s.sale_number,
        'classification', h.classification,
        'inventory_evidence_type', h.inventory_evidence_type,
        'imported_at', h.imported_at,
        'payment', jsonb_build_object(
          'status', case
            when s.status = 'cancelled' then 'cancelled'
            when greatest(s.total_amount - coalesce(fin.paid_amount, 0), 0) = 0 then 'paid'
            when coalesce(fin.paid_amount, 0) > 0 then 'partially_paid'
            else 'unpaid'
          end,
          'total_amount', s.total_amount,
          'settled_amount', least(coalesce(fin.paid_amount, 0), s.total_amount),
          'outstanding_amount', greatest(s.total_amount - coalesce(fin.paid_amount, 0), 0),
          'currency_code', s.currency_code,
          'account_move_id', h.financial_account_move_id
        ),
        'fulfillment', jsonb_build_object(
          'status', case
            when s.status = 'cancelled' then 'not_required'
            when coalesce(inv.goods_quantity, 0) = 0 then 'not_required'
            when coalesce(inv.delivered_quantity, 0) >= inv.goods_quantity then 'delivered'
            when coalesce(inv.delivered_quantity, 0) > 0 then 'partially_delivered'
            else 'unreserved'
          end,
          'required_quantity', coalesce(inv.goods_quantity, 0),
          'selected_quantity', coalesce(inv.goods_quantity, 0),
          'reserved_quantity', 0,
          'delivered_quantity', coalesce(inv.delivered_quantity, 0),
          'remaining_quantity', greatest(coalesce(inv.goods_quantity, 0) - coalesce(inv.delivered_quantity, 0), 0),
          'evidence_type', h.inventory_evidence_type
        ),
        'lines', coalesce(inv.lines, '[]'::jsonb)
      ) payload
    from public.sales s
    join public.sale_historical_sources h on h.sale_id = s.id and h.tenant_id = s.tenant_id
    left join lateral (
      select round(coalesce(sum(r.amount), 0), 2) paid_amount
      from public.account_move_lines l
      join public.account_accounts a on a.id = l.account_id and a.tenant_id = l.tenant_id and a.code = '114001'
      left join public.account_partial_reconcile r on r.tenant_id = l.tenant_id and r.debit_move_id = l.id
      where l.tenant_id = h.tenant_id and l.move_id = h.financial_account_move_id and l.debit > 0
    ) fin on true
    left join lateral (
      select
        sum(case when pt.product_type = 'goods' then sl.quantity else 0 end) goods_quantity,
        sum(case when pt.product_type = 'goods' and u.status = 'sold' then sl.quantity else 0 end) delivered_quantity,
        jsonb_agg(jsonb_build_object(
          'sale_line_id', sl.id,
          'inventory', jsonb_build_object(
            'kind', case when pt.product_type = 'service' then 'service' when sl.tracking_requirement = 'serial' then 'serial' else 'quantity' end,
            'status', case when pt.product_type = 'service' then 'not_required' when u.status = 'sold' then 'delivered' else 'unreserved' end,
            'selected_quantity', case when lh.tracking_unit_id is null then 0 else sl.quantity end,
            'reserved_quantity', 0,
            'delivered_quantity', case when u.status = 'sold' then sl.quantity else 0 end,
            'remaining_quantity', case when u.status = 'sold' or pt.product_type = 'service' then 0 else sl.quantity end,
            'tracking_units', case when u.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
              'id', u.id, 'tracking_number', u.tracking_number,
              'chassis_number', u.tracking_number,
              'engine_number', '',
              'state', case when u.status = 'sold' then 'delivered' else 'selected' end,
              'attributes', '[]'::jsonb
            )) end
          )
        ) order by sl.line_position) lines
      from public.sale_lines sl
      join public.product_products pp on pp.id = sl.product_id and pp.tenant_id = sl.tenant_id
      join public.product_templates pt on pt.id = pp.product_template_id and pt.tenant_id = pp.tenant_id
      left join public.sale_line_historical_sources lh on lh.sale_line_id = sl.id and lh.tenant_id = sl.tenant_id
      left join public.stock_tracking_units u on u.id = lh.tracking_unit_id and u.tenant_id = lh.tenant_id
      where sl.sale_id = s.id and sl.tenant_id = s.tenant_id
    ) inv on true
    where s.tenant_id = v_tenant_id and s.is_historical and s.id = any(coalesce(p_sale_ids, '{}'::uuid[]))
  ) rows;
  return v_result;
end;
$$;

revoke all on function public.get_historical_sales_read(uuid[]) from public, anon;
grant execute on function public.get_historical_sales_read(uuid[]) to authenticated;
comment on function public.get_historical_sales_read(uuid[]) is 'Read-only adapter over immutable legacy provenance and existing financial/inventory evidence.';

commit;
