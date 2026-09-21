begin;

create or replace function public.get_sales_branch_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id uuid := public.current_tenant_user_id();
  v_month_start date := date_trunc('month', current_date)::date;
  v_result jsonb;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.view', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_BRANCH_REPORTS_DENIED';
  end if;

  with accessible_branches as materialized (
    select branch.id, branch.name
    from public.branches branch
    where branch.tenant_id = v_tenant_id
      and branch.is_active
      and public.has_branch_access(branch.id)
  ),
  required_quantities as materialized (
    select line.sale_id,
      coalesce(sum(line.quantity) filter (where template.product_type = 'goods'), 0) as required_quantity
    from public.sale_lines line
    join public.product_products product
      on product.id = line.product_id and product.tenant_id = line.tenant_id
    join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where line.tenant_id = v_tenant_id
    group by line.sale_id
  ),
  delivered_quantities as materialized (
    select delivery.sale_id, coalesce(sum(delivery.quantity), 0) as delivered_quantity
    from public.sale_delivery_lines delivery
    where delivery.tenant_id = v_tenant_id
    group by delivery.sale_id
  ),
  canonical_postings as materialized (
    select distinct on (posting.source_id)
      posting.source_id,
      posting.currency_code,
      greatest(least(posting.amount, receivable.amount_residual), 0)::numeric(18,2) as outstanding_amount
    from public.financial_sale_postings posting
    join public.account_move_lines receivable
      on receivable.id = posting.receivable_line_id
     and receivable.tenant_id = posting.tenant_id
     and receivable.parent_state = 'posted'
     and receivable.line_type = 'open_item'
    where posting.tenant_id = v_tenant_id
      and posting.source_app = 'sales_core'
      and posting.source_model = 'sale'
      and posting.state = 'posted'
    order by posting.source_id, posting.event_version desc, posting.id desc
  ),
  sale_rows as materialized (
    select sale.id, sale.branch_id, sale.status, sale.effective_sale_date,
      sale.total_amount, sale.currency_code,
      posting.currency_code as posting_currency_code,
      coalesce(posting.outstanding_amount, 0)::numeric(18,2) as outstanding_amount,
      coalesce(required.required_quantity, 0) as required_quantity,
      coalesce(delivered.delivered_quantity, 0) as delivered_quantity
    from public.sales sale
    join accessible_branches branch on branch.id = sale.branch_id
    left join required_quantities required on required.sale_id = sale.id
    left join delivered_quantities delivered on delivered.sale_id = sale.id
    left join canonical_postings posting on posting.source_id = sale.id::text
    where sale.tenant_id = v_tenant_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'branch', jsonb_build_object('id', branch.id, 'name', branch.name),
      'confirmed_sales_count', (
        select count(*) from sale_rows sale
        where sale.branch_id = branch.id
          and sale.status = 'confirmed'
          and sale.effective_sale_date between v_month_start and current_date
      ),
      'sales_value_by_currency', coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency_code', totals.currency_code,
          'amount', totals.amount
        ) order by totals.currency_code)
        from (
          select sale.currency_code, sum(sale.total_amount)::numeric(18,2) as amount
          from sale_rows sale
          where sale.branch_id = branch.id
            and sale.status = 'confirmed'
            and sale.effective_sale_date between v_month_start and current_date
          group by sale.currency_code
        ) totals
      ), '[]'::jsonb),
      'outstanding_by_currency', coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency_code', totals.currency_code,
          'amount', totals.amount
        ) order by totals.currency_code)
        from (
          select sale.posting_currency_code as currency_code,
            sum(sale.outstanding_amount)::numeric(18,2) as amount
          from sale_rows sale
          where sale.branch_id = branch.id
            and sale.status = 'confirmed'
            and sale.posting_currency_code is not null
            and sale.outstanding_amount > 0
          group by sale.posting_currency_code
        ) totals
      ), '[]'::jsonb),
      'pending_delivery_count', (
        select count(*) from sale_rows sale
        where sale.branch_id = branch.id
          and sale.status = 'confirmed'
          and sale.required_quantity > sale.delivered_quantity
      )
    ) order by branch.name, branch.id
  ), '[]'::jsonb)
  into v_result
  from accessible_branches branch;

  return v_result;
end
$$;

revoke all on function public.get_sales_branch_reports()
  from public, anon, service_role;
grant execute on function public.get_sales_branch_reports()
  to authenticated;

comment on function public.get_sales_branch_reports() is
  'One-request, access-scoped branch sales cards with current-month commercial totals and current outstanding and delivery indicators.';

notify pgrst, 'reload schema';

commit;
