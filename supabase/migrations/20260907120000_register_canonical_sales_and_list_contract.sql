begin;

-- Canonical Sales already has a historical module identity. Refresh only its
-- catalog metadata; tenant_modules is intentionally not touched so every
-- tenant keeps its existing installed/uninstalled state.
insert into public.ir_modules (
  technical_name,
  name,
  summary,
  description,
  category,
  icon,
  icon_color,
  route_path,
  application,
  technical,
  installable,
  is_removable,
  state,
  active,
  sequence
)
values (
  'sales',
  'المبيعات',
  'إدارة دورة البيع الموحدة',
  'إنشاء المبيعات ومتابعة حالتها التجارية والمالية والتسليم من واجهة موحدة.',
  'Sales',
  'ReceiptText',
  '#7C3AED',
  '/app/sales',
  true,
  false,
  true,
  true,
  'uninstalled',
  true,
  20
)
on conflict (technical_name) do update
set
  name = excluded.name,
  summary = excluded.summary,
  description = excluded.description,
  category = excluded.category,
  icon = excluded.icon,
  icon_color = excluded.icon_color,
  route_path = excluded.route_path,
  application = excluded.application,
  technical = excluded.technical,
  installable = excluded.installable,
  is_removable = excluded.is_removable,
  active = excluded.active,
  sequence = excluded.sequence,
  updated_at = now();

-- Keep the historical menu identity usable while the frontend owns the
-- three-item Canonical Sales navigation introduced in Phase 6A.1.
update public.ir_ui_menus menu
set
  name = 'المبيعات',
  route_path = '/app/sales',
  icon = 'ReceiptText',
  active = true,
  updated_at = now()
from public.ir_modules module
where menu.module_id = module.id
  and module.technical_name = 'sales'
  and menu.code = 'sales.root';

create or replace function public.list_sales(
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default null,
  p_status text default null,
  p_branch_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_payment_status text default null,
  p_fulfillment_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_page integer := coalesce(p_page, 1);
  v_page_size integer := coalesce(p_page_size, 25);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_payment_status text := nullif(lower(btrim(coalesce(p_payment_status, ''))), '');
  v_fulfillment_status text := nullif(lower(btrim(coalesce(p_fulfillment_status, ''))), '');
  v_result jsonb;
begin
  if v_tenant_id is null
     or public.current_tenant_user_id() is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.view', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_VIEW_DENIED';
  end if;

  if v_page < 1 then
    raise exception using errcode = '22023', message = 'SALES_LIST_PAGE_INVALID';
  end if;
  if v_page_size < 1 or v_page_size > 100 then
    raise exception using errcode = '22023', message = 'SALES_LIST_PAGE_SIZE_INVALID';
  end if;
  if v_search is not null and length(v_search) > 120 then
    raise exception using errcode = '22023', message = 'SALES_LIST_SEARCH_TOO_LONG';
  end if;
  if v_status is not null and v_status not in ('draft', 'confirmed', 'cancelled') then
    raise exception using errcode = '22023', message = 'SALES_LIST_STATUS_INVALID';
  end if;
  if v_payment_status is not null
     and v_payment_status not in ('unpaid', 'partially_paid', 'paid') then
    raise exception using errcode = '22023', message = 'SALES_LIST_PAYMENT_STATUS_INVALID';
  end if;
  if v_fulfillment_status is not null
     and v_fulfillment_status not in (
       'unreserved', 'reserved', 'partially_delivered', 'delivered', 'not_required'
     ) then
    raise exception using errcode = '22023', message = 'SALES_LIST_FULFILLMENT_STATUS_INVALID';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception using errcode = '22023', message = 'SALES_LIST_DATE_RANGE_INVALID';
  end if;
  if p_branch_id is not null and not exists (
    select 1
    from public.branches branch
    where branch.id = p_branch_id
      and branch.tenant_id = v_tenant_id
      and public.has_branch_access(branch.id)
  ) then
    raise exception using errcode = '42501', message = 'SALES_BRANCH_SCOPE_DENIED';
  end if;

  with sale_rows as materialized (
    select
      sale.id,
      sale.sale_number,
      sale.effective_sale_date,
      sale.customer_id,
      customer.name as customer_name,
      sale.branch_id,
      branch.name as branch_name,
      sale.created_by,
      creator.full_name as created_by_name,
      coalesce((
        select string_agg(product_line.product_name, '، ' order by product_line.line_position)
        from (
          select coalesce(nullif(btrim(line.description), ''), product.display_name) as product_name,
                 line.line_position
          from public.sale_lines line
          join public.product_products product
            on product.id = line.product_id and product.tenant_id = line.tenant_id
          where line.tenant_id = sale.tenant_id and line.sale_id = sale.id
          order by line.line_position, line.id
          limit 2
        ) product_line
      ), '') as product_summary,
      sale.status,
      sale.total_amount,
      sale.currency_code,
      sale.version,
      sale.created_at,
      sale.updated_at,
      greatest(
        0::numeric,
        least(
          sale.total_amount,
          coalesce(receivable.amount_residual, sale.total_amount)
        )
      )::numeric(18,2) as outstanding_amount,
      case
        when sale.total_amount > 0
          and coalesce(receivable.amount_residual, sale.total_amount) <= 0 then 'paid'
        when coalesce(receivable.amount_residual, sale.total_amount) < sale.total_amount
          and coalesce(receivable.amount_residual, sale.total_amount) > 0 then 'partially_paid'
        else 'unpaid'
      end as payment_status,
      case
        when confirmation.id is null then 'unreserved'
        when confirmation.inventory_reservation_id is null then 'not_required'
        when reservation.state = 'partially_delivered' then 'partially_delivered'
        when reservation.state = 'delivered' then 'delivered'
        when reservation.state = 'active' then 'reserved'
        else 'unreserved'
      end as fulfillment_status
    from public.sales sale
    join public.branches branch
      on branch.id = sale.branch_id
     and branch.tenant_id = sale.tenant_id
    join public.partners customer
      on customer.id = sale.customer_id
     and customer.tenant_id = sale.tenant_id
    join public.tenant_users creator
      on creator.id = sale.created_by
     and creator.tenant_id = sale.tenant_id
    left join public.sale_confirmation_links confirmation
      on confirmation.sale_id = sale.id
     and confirmation.tenant_id = sale.tenant_id
    left join public.inventory_reservations reservation
      on reservation.id = confirmation.inventory_reservation_id
     and reservation.tenant_id = confirmation.tenant_id
    left join public.financial_sale_postings posting
      on posting.id = confirmation.financial_sale_posting_id
     and posting.tenant_id = confirmation.tenant_id
     and posting.source_app = 'sales_core'
     and posting.source_model = 'sale'
     and posting.source_id = sale.id::text
     and posting.state = 'posted'
    left join public.account_move_lines receivable
      on receivable.id = posting.receivable_line_id
     and receivable.tenant_id = posting.tenant_id
     and receivable.parent_state = 'posted'
     and receivable.line_type = 'open_item'
    where sale.tenant_id = v_tenant_id
      and public.has_branch_access(sale.branch_id)
  ),
  filtered_rows as materialized (
    select *
    from sale_rows row_data
    where (v_search is null
      or row_data.sale_number ilike '%' || v_search || '%'
      or row_data.customer_name ilike '%' || v_search || '%')
      and (v_status is null or row_data.status = v_status)
      and (p_branch_id is null or row_data.branch_id = p_branch_id)
      and (p_date_from is null or row_data.effective_sale_date >= p_date_from)
      and (p_date_to is null or row_data.effective_sale_date <= p_date_to)
      and (v_payment_status is null or row_data.payment_status = v_payment_status)
      and (v_fulfillment_status is null or row_data.fulfillment_status = v_fulfillment_status)
  ),
  paged_rows as (
    select *
    from filtered_rows
    order by effective_sale_date desc, created_at desc, id desc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', row_data.id,
          'sale_number', row_data.sale_number,
          'effective_sale_date', row_data.effective_sale_date,
          'customer', jsonb_build_object(
            'id', row_data.customer_id,
            'name', row_data.customer_name
          ),
          'branch', jsonb_build_object(
            'id', row_data.branch_id,
            'name', row_data.branch_name
          ),
          'product_summary', row_data.product_summary,
          'created_by', jsonb_build_object(
            'id', row_data.created_by,
            'name', row_data.created_by_name
          ),
          'status', row_data.status,
          'total_amount', row_data.total_amount,
          'currency_code', row_data.currency_code,
          'payment', jsonb_build_object(
            'status', row_data.payment_status,
            'settled_amount', greatest(row_data.total_amount - row_data.outstanding_amount, 0),
            'outstanding_amount', row_data.outstanding_amount
          ),
          'fulfillment', jsonb_build_object('status', row_data.fulfillment_status),
          'version', row_data.version,
          'created_at', row_data.created_at,
          'updated_at', row_data.updated_at
        )
        order by row_data.effective_sale_date desc, row_data.created_at desc, row_data.id desc
      )
      from paged_rows row_data
    ), '[]'::jsonb),
    'page', v_page,
    'page_size', v_page_size,
    'total_count', (select count(*) from filtered_rows),
    'page_count', case
      when (select count(*) from filtered_rows) = 0 then 0
      else ceil((select count(*) from filtered_rows)::numeric / v_page_size)::integer
    end,
    'filter_options', jsonb_build_object(
      'branches', coalesce((
        select jsonb_agg(
          jsonb_build_object('id', branch.id, 'name', branch.name)
          order by branch.name, branch.id
        )
        from public.branches branch
        where branch.tenant_id = v_tenant_id
          and branch.is_active
          and public.has_branch_access(branch.id)
      ), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end
$$;

revoke all on function public.list_sales(
  integer, integer, text, text, uuid, date, date, text, text
) from public, anon;
grant execute on function public.list_sales(
  integer, integer, text, text, uuid, date, date, text, text
) to authenticated;

comment on function public.list_sales(
  integer, integer, text, text, uuid, date, date, text, text
) is
  'Paginated branch-scoped Canonical Sales list DTO with business-only commercial, payment and fulfillment summaries.';

notify pgrst, 'reload schema';

commit;
