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
    where branch.tenant_id = v_tenant_id and branch.is_active
      and public.has_branch_access(branch.id)
  ),
  latest_postings as materialized (
    select distinct on (posting.source_id)
      posting.source_id, posting.currency_code,
      greatest(least(posting.amount, receivable.amount_residual), 0)::numeric(18,2) as outstanding_amount
    from public.financial_sale_postings posting
    join public.account_move_lines receivable
      on receivable.id = posting.receivable_line_id
     and receivable.tenant_id = posting.tenant_id
     and receivable.parent_state = 'posted' and receivable.line_type = 'open_item'
    where posting.tenant_id = v_tenant_id and posting.source_app = 'sales_core'
      and posting.source_model = 'sale' and posting.state = 'posted'
    order by posting.source_id, posting.event_version desc, posting.id desc
  ),
  confirmed_sales as materialized (
    select sale.id, sale.branch_id, sale.created_by, sale.effective_sale_date,
      coalesce(nullif(trim(creator.full_name), ''), 'موظف غير محدد') as salesperson_name,
      sale.currency_code, sale.total_amount,
      posting.currency_code as posting_currency_code,
      coalesce(posting.outstanding_amount, 0)::numeric(18,2) as outstanding_amount
    from public.sales sale
    join accessible_branches branch on branch.id = sale.branch_id
    left join public.tenant_users creator
      on creator.id = sale.created_by and creator.tenant_id = sale.tenant_id
    left join latest_postings posting on posting.source_id = sale.id::text
    where sale.tenant_id = v_tenant_id and sale.status = 'confirmed'
  ),
  monthly_sales as materialized (
    select * from confirmed_sales sale
    where sale.effective_sale_date >= v_month_start and sale.effective_sale_date < v_month_end
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'branch', jsonb_build_object('id', branch.id, 'name', branch.name),
      'confirmed_sales_count', (select count(*) from monthly_sales sale where sale.branch_id = branch.id),
      'sales_value_by_currency', coalesce((
        select jsonb_agg(jsonb_build_object('currency_code', totals.currency_code, 'amount', totals.amount) order by totals.currency_code)
        from (select sale.currency_code, sum(sale.total_amount)::numeric(18,2) amount
          from monthly_sales sale where sale.branch_id = branch.id group by sale.currency_code) totals
      ), '[]'::jsonb),
      'outstanding_by_currency', coalesce((
        select jsonb_agg(jsonb_build_object('currency_code', totals.currency_code, 'amount', totals.amount) order by totals.currency_code)
        from (select sale.posting_currency_code currency_code, sum(sale.outstanding_amount)::numeric(18,2) amount
          from monthly_sales sale where sale.branch_id = branch.id
            and sale.posting_currency_code is not null and sale.outstanding_amount > 0
          group by sale.posting_currency_code) totals
      ), '[]'::jsonb),
      'all_time_outstanding_by_currency', coalesce((
        select jsonb_agg(jsonb_build_object('currency_code', totals.currency_code, 'amount', totals.amount) order by totals.currency_code)
        from (select sale.posting_currency_code currency_code, sum(sale.outstanding_amount)::numeric(18,2) amount
          from confirmed_sales sale where sale.branch_id = branch.id
            and sale.posting_currency_code is not null and sale.outstanding_amount > 0
          group by sale.posting_currency_code) totals
      ), '[]'::jsonb),
      'pending_delivery_count', 0,
      'salespeople', coalesce((
        select jsonb_agg(jsonb_build_object(
          'salesperson', jsonb_build_object('id', person.created_by, 'name', person.salesperson_name),
          'confirmed_sales_count', person.confirmed_sales_count,
          'sales_value_by_currency', coalesce((
            select jsonb_agg(jsonb_build_object('currency_code', currency_values.currency_code, 'amount', currency_values.amount) order by currency_values.currency_code)
            from (select sale.currency_code, sum(sale.total_amount)::numeric(18,2) amount
              from monthly_sales sale where sale.branch_id = branch.id and sale.created_by = person.created_by
              group by sale.currency_code) currency_values
          ), '[]'::jsonb)
        ) order by person.confirmed_sales_count desc, person.salesperson_name)
        from (select sale.created_by, sale.salesperson_name, count(*)::integer confirmed_sales_count
          from monthly_sales sale where sale.branch_id = branch.id
          group by sale.created_by, sale.salesperson_name) person
      ), '[]'::jsonb)
    ) order by branch.name, branch.id
  ), '[]'::jsonb) into v_result
  from accessible_branches branch;
  return v_result;
end
$$;

revoke all on function public.get_sales_monthly_branch_reports(date) from public, anon, service_role;
grant execute on function public.get_sales_monthly_branch_reports(date) to authenticated;
comment on function public.get_sales_monthly_branch_reports(date) is
  'Monthly Sales totals and salesperson breakdowns with all-time outstanding balances per accessible branch.';
notify pgrst, 'reload schema';

commit;
