begin;

create or replace function public.get_sales_overview(
  p_period text default 'last_7_days',
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id uuid := public.current_tenant_user_id();
  v_period text := lower(btrim(coalesce(p_period, 'last_7_days')));
  v_date_from date;
  v_date_to date := current_date;
  v_default_branch_id uuid;
  v_result jsonb;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.view', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_OVERVIEW_DENIED';
  end if;

  if v_period = 'today' then
    v_date_from := current_date;
  elsif v_period = 'last_7_days' then
    v_date_from := current_date - 6;
  elsif v_period = 'this_month' then
    v_date_from := date_trunc('month', current_date)::date;
  else
    raise exception using errcode = '22023', message = 'SALES_OVERVIEW_PERIOD_INVALID';
  end if;

  if p_branch_id is not null and not exists (
    select 1
    from public.branches branch
    where branch.id = p_branch_id
      and branch.tenant_id = v_tenant_id
      and branch.is_active
      and public.has_branch_access(branch.id)
  ) then
    raise exception using errcode = '42501', message = 'SALES_OVERVIEW_BRANCH_SCOPE_DENIED';
  end if;

  select defaults.default_branch_id
  into v_default_branch_id
  from public.user_operational_defaults defaults
  where defaults.tenant_id = v_tenant_id
    and defaults.user_id = v_actor_id
    and defaults.default_branch_id is not null
    and public.has_branch_access(defaults.default_branch_id);

  with accessible_branches as materialized (
    select branch.id, branch.name
    from public.branches branch
    where branch.tenant_id = v_tenant_id
      and branch.is_active
      and public.has_branch_access(branch.id)
  ),
  line_products as materialized (
    select
      line.sale_id,
      line.quantity,
      template.product_type,
      product.display_name,
      row_number() over (
        partition by line.sale_id order by line.line_position, line.id
      ) as line_rank
    from public.sale_lines line
    join public.product_products product
      on product.id = line.product_id and product.tenant_id = line.tenant_id
    join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where line.tenant_id = v_tenant_id
  ),
  line_summaries as materialized (
    select
      line.sale_id,
      count(*)::integer as line_count,
      coalesce(sum(line.quantity) filter (where line.product_type = 'goods'), 0) as required_quantity,
      string_agg(line.display_name, '، ' order by line.line_rank)
        filter (where line.line_rank <= 2) as product_summary
    from line_products line
    group by line.sale_id
  ),
  selection_summaries as materialized (
    select selection.sale_id, sum(selection.quantity) as selected_quantity
    from public.sale_inventory_selections selection
    where selection.tenant_id = v_tenant_id
    group by selection.sale_id
  ),
  delivery_summaries as materialized (
    select delivery.sale_id, sum(delivery.quantity) as delivered_quantity
    from public.sale_delivery_lines delivery
    where delivery.tenant_id = v_tenant_id
    group by delivery.sale_id
  ),
  canonical_postings as materialized (
    select distinct on (posting.source_id)
      posting.source_id,
      posting.amount,
      posting.currency_code,
      greatest(least(posting.amount, receivable.amount_residual), 0)::numeric(18,2)
        as outstanding_amount
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
    select
      sale.id,
      sale.sale_number,
      sale.effective_sale_date,
      sale.status,
      sale.total_amount,
      sale.currency_code,
      sale.created_at,
      sale.updated_at,
      sale.created_by,
      creator.full_name as created_by_name,
      sale.customer_id,
      customer.name as customer_name,
      sale.branch_id,
      branch.name as branch_name,
      coalesce(lines.line_count, 0) as line_count,
      coalesce(lines.product_summary, '') as product_summary,
      coalesce(lines.required_quantity, 0) as required_quantity,
      coalesce(selections.selected_quantity, 0) as selected_quantity,
      coalesce(deliveries.delivered_quantity, 0) as delivered_quantity,
      posting.amount as posting_amount,
      posting.currency_code as posting_currency_code,
      coalesce(posting.outstanding_amount, 0)::numeric(18,2) as outstanding_amount,
      case
        when sale.status <> 'confirmed' then 'not_confirmed'
        when posting.source_id is null then 'unpaid'
        when posting.outstanding_amount <= 0 then 'paid'
        when posting.outstanding_amount < posting.amount then 'partially_paid'
        else 'unpaid'
      end as payment_status,
      case
        when sale.status <> 'confirmed' then 'unreserved'
        when coalesce(lines.required_quantity, 0) <= 0 then 'not_required'
        when coalesce(deliveries.delivered_quantity, 0) >= coalesce(lines.required_quantity, 0) then 'delivered'
        when coalesce(deliveries.delivered_quantity, 0) > 0 then 'partially_delivered'
        when coalesce(selections.selected_quantity, 0) > 0 then 'reserved'
        else 'unreserved'
      end as fulfillment_status
    from public.sales sale
    join accessible_branches branch on branch.id = sale.branch_id
    join public.partners customer
      on customer.id = sale.customer_id and customer.tenant_id = sale.tenant_id
    join public.tenant_users creator
      on creator.id = sale.created_by and creator.tenant_id = sale.tenant_id
    left join line_summaries lines on lines.sale_id = sale.id
    left join selection_summaries selections on selections.sale_id = sale.id
    left join delivery_summaries deliveries on deliveries.sale_id = sale.id
    left join canonical_postings posting on posting.source_id = sale.id::text
    where sale.tenant_id = v_tenant_id
      and (p_branch_id is null or sale.branch_id = p_branch_id)
  ),
  period_rows as materialized (
    select * from sale_rows row_data
    where row_data.effective_sale_date between v_date_from and v_date_to
  ),
  salesperson_counts as materialized (
    select
      row_data.created_by,
      row_data.created_by_name,
      count(*)::integer as confirmed_sales_count
    from period_rows row_data
    where row_data.status = 'confirmed'
    group by row_data.created_by, row_data.created_by_name
  ),
  salesperson_currency_values as materialized (
    select
      row_data.created_by,
      row_data.currency_code,
      sum(row_data.total_amount)::numeric(18,2) as amount
    from period_rows row_data
    where row_data.status = 'confirmed'
    group by row_data.created_by, row_data.currency_code
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'code', v_period,
      'date_from', v_date_from,
      'date_to', v_date_to
    ),
    'scope', jsonb_build_object(
      'selected_branch_id', p_branch_id,
      'default_branch_id', v_default_branch_id,
      'branches', coalesce((
        select jsonb_agg(
          jsonb_build_object('id', branch.id, 'name', branch.name)
          order by branch.name, branch.id
        ) from accessible_branches branch
      ), '[]'::jsonb)
    ),
    'kpis', jsonb_build_object(
      'confirmed_sales_count', (
        select count(*) from period_rows row_data where row_data.status = 'confirmed'
      ),
      'confirmed_sales_value_by_currency', coalesce((
        select jsonb_agg(
          jsonb_build_object('currency_code', totals.currency_code, 'amount', totals.amount)
          order by totals.currency_code
        )
        from (
          select row_data.currency_code, sum(row_data.total_amount)::numeric(18,2) as amount
          from period_rows row_data
          where row_data.status = 'confirmed'
          group by row_data.currency_code
        ) totals
      ), '[]'::jsonb),
      'outstanding_by_currency', coalesce((
        select jsonb_agg(
          jsonb_build_object('currency_code', totals.currency_code, 'amount', totals.amount)
          order by totals.currency_code
        )
        from (
          select row_data.posting_currency_code as currency_code,
            sum(row_data.outstanding_amount)::numeric(18,2) as amount
          from sale_rows row_data
          where row_data.status = 'confirmed'
            and row_data.posting_currency_code is not null
            and row_data.outstanding_amount > 0
          group by row_data.posting_currency_code
        ) totals
      ), '[]'::jsonb),
      'pending_delivery_count', (
        select count(*) from sale_rows row_data
        where row_data.status = 'confirmed'
          and row_data.required_quantity > row_data.delivered_quantity
      )
    ),
    'drafts_preview', coalesce((
      select jsonb_agg(row_data.item order by row_data.updated_at desc, row_data.id desc)
      from (
        select row_data.id, row_data.updated_at, jsonb_build_object(
          'id', row_data.id,
          'sale_number', row_data.sale_number,
          'effective_sale_date', row_data.effective_sale_date,
          'customer', jsonb_build_object('id', row_data.customer_id, 'name', row_data.customer_name),
          'branch', jsonb_build_object('id', row_data.branch_id, 'name', row_data.branch_name),
          'created_by', jsonb_build_object('id', row_data.created_by, 'name', row_data.created_by_name),
          'status', row_data.status,
          'total_amount', row_data.total_amount,
          'currency_code', row_data.currency_code,
          'updated_at', row_data.updated_at
        ) as item
        from sale_rows row_data
        where row_data.status = 'draft'
        order by row_data.updated_at desc, row_data.id desc
        limit 5
      ) row_data
    ), '[]'::jsonb),
    'outstanding_preview', coalesce((
      select jsonb_agg(row_data.item order by row_data.outstanding_amount desc, row_data.id desc)
      from (
        select row_data.id, row_data.outstanding_amount, jsonb_build_object(
          'id', row_data.id,
          'sale_number', row_data.sale_number,
          'effective_sale_date', row_data.effective_sale_date,
          'customer', jsonb_build_object('id', row_data.customer_id, 'name', row_data.customer_name),
          'branch', jsonb_build_object('id', row_data.branch_id, 'name', row_data.branch_name),
          'total_amount', row_data.posting_amount,
          'currency_code', row_data.posting_currency_code,
          'payment', jsonb_build_object(
            'status', row_data.payment_status,
            'settled_amount', greatest(row_data.posting_amount - row_data.outstanding_amount, 0),
            'outstanding_amount', row_data.outstanding_amount
          )
        ) as item
        from sale_rows row_data
        where row_data.status = 'confirmed'
          and row_data.posting_currency_code is not null
          and row_data.outstanding_amount > 0
        order by row_data.outstanding_amount desc, row_data.updated_at desc, row_data.id desc
        limit 5
      ) row_data
    ), '[]'::jsonb),
    'pending_delivery_preview', coalesce((
      select jsonb_agg(row_data.item order by row_data.updated_at desc, row_data.id desc)
      from (
        select row_data.id, row_data.updated_at, jsonb_build_object(
          'id', row_data.id,
          'sale_number', row_data.sale_number,
          'effective_sale_date', row_data.effective_sale_date,
          'customer', jsonb_build_object('id', row_data.customer_id, 'name', row_data.customer_name),
          'branch', jsonb_build_object('id', row_data.branch_id, 'name', row_data.branch_name),
          'product_summary', row_data.product_summary,
          'line_count', row_data.line_count,
          'fulfillment', jsonb_build_object(
            'status', row_data.fulfillment_status,
            'required_quantity', row_data.required_quantity,
            'delivered_quantity', row_data.delivered_quantity,
            'remaining_quantity', greatest(row_data.required_quantity - row_data.delivered_quantity, 0)
          )
        ) as item
        from sale_rows row_data
        where row_data.status = 'confirmed'
          and row_data.required_quantity > row_data.delivered_quantity
        order by row_data.updated_at desc, row_data.id desc
        limit 5
      ) row_data
    ), '[]'::jsonb),
    'recent_sales', coalesce((
      select jsonb_agg(row_data.item order by row_data.effective_sale_date desc, row_data.created_at desc, row_data.id desc)
      from (
        select row_data.id, row_data.effective_sale_date, row_data.created_at, jsonb_build_object(
          'id', row_data.id,
          'sale_number', row_data.sale_number,
          'effective_sale_date', row_data.effective_sale_date,
          'customer', jsonb_build_object('id', row_data.customer_id, 'name', row_data.customer_name),
          'branch', jsonb_build_object('id', row_data.branch_id, 'name', row_data.branch_name),
          'status', row_data.status,
          'total_amount', row_data.total_amount,
          'currency_code', row_data.currency_code,
          'payment', jsonb_build_object(
            'status', row_data.payment_status,
            'settled_amount', greatest(coalesce(row_data.posting_amount, 0) - row_data.outstanding_amount, 0),
            'outstanding_amount', row_data.outstanding_amount
          ),
          'fulfillment', jsonb_build_object('status', row_data.fulfillment_status)
        ) as item
        from period_rows row_data
        order by row_data.effective_sale_date desc, row_data.created_at desc, row_data.id desc
        limit 7
      ) row_data
    ), '[]'::jsonb),
    'salesperson_breakdown', case
      when (select count(*) from salesperson_counts) <= 1 then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object(
          'salesperson', jsonb_build_object('id', salesperson.created_by, 'name', salesperson.created_by_name),
          'confirmed_sales_count', salesperson.confirmed_sales_count,
          'sales_value_by_currency', coalesce((
            select jsonb_agg(jsonb_build_object(
              'currency_code', currency_value.currency_code,
              'amount', currency_value.amount
            ) order by currency_value.currency_code)
            from salesperson_currency_values currency_value
            where currency_value.created_by = salesperson.created_by
          ), '[]'::jsonb)
        ) order by salesperson.confirmed_sales_count desc, salesperson.created_by_name, salesperson.created_by)
        from salesperson_counts salesperson
      ), '[]'::jsonb)
    end
  ) into v_result;

  return v_result;
end
$$;

revoke all on function public.get_sales_overview(text, uuid)
  from public, anon, service_role;
grant execute on function public.get_sales_overview(text, uuid)
  to authenticated;

comment on function public.get_sales_overview(text, uuid) is
  'Single-request branch-scoped Canonical Sales overview with server-side KPIs, bounded operational queues, canonical financial residuals and fulfillment summaries.';

notify pgrst, 'reload schema';

commit;
