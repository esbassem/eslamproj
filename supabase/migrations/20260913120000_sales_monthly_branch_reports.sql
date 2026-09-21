begin;

create or replace function public.get_sales_monthly_branch_reports(p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id uuid := public.current_tenant_user_id();
  v_month_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_month_end date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month')::date;
  v_result jsonb;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.view', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_BRANCH_REPORTS_DENIED';
  end if;

  if v_month_start > date_trunc('month', current_date)::date then
    raise exception using errcode = '22023', message = 'SALES_REPORT_MONTH_INVALID';
  end if;

  with accessible_branches as materialized (
    select branch.id, branch.name
    from public.branches branch
    where branch.tenant_id = v_tenant_id
      and branch.is_active
      and public.has_branch_access(branch.id)
  ),
  monthly_sales as materialized (
    select sale.branch_id, sale.currency_code, sale.total_amount
    from public.sales sale
    join accessible_branches branch on branch.id = sale.branch_id
    where sale.tenant_id = v_tenant_id
      and sale.status = 'confirmed'
      and sale.effective_sale_date >= v_month_start
      and sale.effective_sale_date < v_month_end
  ),
  branch_counts as (
    select sale.branch_id, count(*)::integer as confirmed_sales_count
    from monthly_sales sale
    group by sale.branch_id
  ),
  branch_currency_totals as (
    select sale.branch_id, sale.currency_code, sum(sale.total_amount)::numeric(18,2) as amount
    from monthly_sales sale
    group by sale.branch_id, sale.currency_code
  ),
  branch_values as (
    select totals.branch_id,
      jsonb_agg(
        jsonb_build_object('currency_code', totals.currency_code, 'amount', totals.amount)
        order by totals.currency_code
      ) as sales_value_by_currency
    from branch_currency_totals totals
    group by totals.branch_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'branch', jsonb_build_object('id', branch.id, 'name', branch.name),
      'confirmed_sales_count', coalesce(counts.confirmed_sales_count, 0),
      'sales_value_by_currency', coalesce(value_rows.sales_value_by_currency, '[]'::jsonb),
      'outstanding_by_currency', '[]'::jsonb,
      'pending_delivery_count', 0
    ) order by branch.name, branch.id
  ), '[]'::jsonb)
  into v_result
  from accessible_branches branch
  left join branch_counts counts on counts.branch_id = branch.id
  left join branch_values value_rows on value_rows.branch_id = branch.id;

  return v_result;
end
$$;

revoke all on function public.get_sales_monthly_branch_reports(date)
  from public, anon, service_role;
grant execute on function public.get_sales_monthly_branch_reports(date)
  to authenticated;

comment on function public.get_sales_monthly_branch_reports(date) is
  'Access-scoped Sales branch totals for one selected calendar month.';

notify pgrst, 'reload schema';

commit;
