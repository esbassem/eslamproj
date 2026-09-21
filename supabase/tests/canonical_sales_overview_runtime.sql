-- Canonical Sales Overview read-contract runtime proof. All fixtures roll back.
begin;

create temporary table sales_overview_context as
select
  owner.tenant_id,
  owner.id as owner_id,
  owner.auth_user_id as owner_auth,
  unassigned.id as operator_auth,
  foreign_member.auth_user_id as foreign_auth
from public.tenant_users owner
join lateral (
  select auth_user.id
  from auth.users auth_user
  where not exists (
    select 1 from public.tenant_users member where member.auth_user_id = auth_user.id
  )
  order by auth_user.created_at, auth_user.id
  limit 1
) unassigned on true
join lateral (
  select member.auth_user_id
  from public.tenant_users member
  where member.tenant_id <> owner.tenant_id
    and member.is_active
    and member.auth_user_id is not null
    and not exists (
      select 1 from public.tenant_users target
      where target.tenant_id = owner.tenant_id
        and target.auth_user_id = member.auth_user_id
        and target.is_active
    )
  order by member.tenant_id, member.id
  limit 1
) foreign_member on true
where owner.role = 'owner'
  and owner.is_active
  and owner.auth_user_id is not null
  and exists (
    select 1 from public.account_functional_accounts configuration
    where configuration.tenant_id = owner.tenant_id
      and configuration.functional_role = 'customer_receivable'
      and configuration.is_active
  )
  and exists (
    select 1 from public.account_functional_accounts configuration
    where configuration.tenant_id = owner.tenant_id
      and configuration.functional_role = 'sales_revenue'
      and configuration.is_active
  )
order by owner.tenant_id
limit 1;

do $$ begin
  if not exists (select 1 from sales_overview_context) then
    raise exception 'SALES_OVERVIEW_RUNTIME_FIXTURE_UNAVAILABLE';
  end if;
end $$;

create temporary table sales_overview_resources (
  allowed_branch_id uuid,
  denied_branch_id uuid,
  customer_id uuid,
  denied_customer_id uuid,
  operator_id uuid,
  goods_product_id uuid,
  service_product_id uuid,
  goods_sale_id uuid,
  service_sale_id uuid,
  denied_sale_id uuid,
  draft_sale_ids uuid[]
);
grant select on sales_overview_context, sales_overview_resources to authenticated;

do $$
declare
  context sales_overview_context%rowtype;
  resources sales_overview_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  receivable_account_id uuid;
  revenue_account_id uuid;
  goods_template_id uuid := gen_random_uuid();
  service_template_id uuid := gen_random_uuid();
  draft_id uuid;
  draft_ids uuid[] := '{}';
  sale_number_prefix text := 'SAL-' || extract(year from current_date)::integer::text || '-';
begin
  select * into context from sales_overview_context;
  resources.allowed_branch_id := gen_random_uuid();
  resources.denied_branch_id := gen_random_uuid();
  resources.customer_id := gen_random_uuid();
  resources.denied_customer_id := gen_random_uuid();
  resources.operator_id := gen_random_uuid();
  resources.goods_product_id := gen_random_uuid();
  resources.service_product_id := gen_random_uuid();
  resources.goods_sale_id := gen_random_uuid();
  resources.service_sale_id := gen_random_uuid();
  resources.denied_sale_id := gen_random_uuid();

  receivable_account_id := public.resolve_functional_account(
    context.tenant_id, 'customer_receivable', null
  );
  revenue_account_id := public.resolve_functional_account(
    context.tenant_id, 'sales_revenue', null
  );

  insert into public.branches (id, tenant_id, name, code, is_active) values
    (resources.allowed_branch_id, context.tenant_id, 'Overview Allowed ' || suffix, 'OVA' || left(suffix, 5), true),
    (resources.denied_branch_id, context.tenant_id, 'Overview Denied ' || suffix, 'OVD' || left(suffix, 5), true);

  perform public.resolve_financial_journal(context.tenant_id, 'sale', resources.allowed_branch_id, null);
  insert into public.account_functional_accounts (
    tenant_id, branch_id, functional_role, account_id
  ) values
    (context.tenant_id, resources.allowed_branch_id, 'customer_receivable', receivable_account_id),
    (context.tenant_id, resources.allowed_branch_id, 'sales_revenue', revenue_account_id);

  insert into public.partners (
    id, tenant_id, branch_id, name, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values
    (resources.customer_id, context.tenant_id, resources.allowed_branch_id,
      'Overview Customer ' || suffix, 'person', false, true, 1, 0, 0, true),
    (resources.denied_customer_id, context.tenant_id, resources.denied_branch_id,
      'Overview Hidden ' || suffix, 'person', false, true, 1, 0, 0, true);

  insert into public.tenant_users (id, tenant_id, auth_user_id, full_name, role, is_active)
  values (
    resources.operator_id, context.tenant_id, context.operator_auth,
    'Overview Operator ' || suffix, 'staff', true
  );
  insert into public.user_branch_access (tenant_id, user_id, branch_id)
  values (context.tenant_id, resources.operator_id, resources.allowed_branch_id);

  insert into public.product_templates (
    id, tenant_id, name, internal_reference, product_type, tracking,
    can_be_sold, is_active, sale_price
  ) values
    (goods_template_id, context.tenant_id, 'Overview Goods ' || suffix,
      'OVG-' || suffix, 'goods', 'none', true, true, 50000),
    (service_template_id, context.tenant_id, 'Overview Service ' || suffix,
      'OVS-' || suffix, 'service', 'none', true, true, 10000);
  insert into public.product_products (
    id, tenant_id, product_template_id, display_name, sku, tracking,
    is_active, sale_price
  ) values
    (resources.goods_product_id, context.tenant_id, goods_template_id,
      'Overview Goods ' || suffix, 'OVG-' || suffix, 'none', true, 50000),
    (resources.service_product_id, context.tenant_id, service_template_id,
      'Overview Service ' || suffix, 'OVS-' || suffix, 'none', true, 10000);
  update public.product_templates template
  set default_product_product_id = product.id
  from public.product_products product
  where template.id in (goods_template_id, service_template_id)
    and product.product_template_id = template.id;

  insert into public.sales (
    id, tenant_id, branch_id, customer_id, effective_sale_date,
    currency_code, status, total_amount, version,
    create_idempotency_key, create_request_fingerprint, created_by
  ) values
    (resources.goods_sale_id, context.tenant_id, resources.allowed_branch_id,
      resources.customer_id, current_date, 'EGP', 'draft', 50000, 1,
      'overview-goods-' || suffix, repeat('a', 64), context.owner_id),
    (resources.service_sale_id, context.tenant_id, resources.allowed_branch_id,
      resources.customer_id, current_date, 'EGP', 'draft', 10000, 1,
      'overview-service-' || suffix, repeat('b', 64), resources.operator_id),
    (resources.denied_sale_id, context.tenant_id, resources.denied_branch_id,
      resources.denied_customer_id, current_date, 'EGP', 'draft', 90000, 1,
      'overview-hidden-' || suffix, repeat('c', 64), context.owner_id);

  insert into public.sale_lines (
    tenant_id, sale_id, line_position, product_id, description,
    quantity, unit_price, line_total, tracking_requirement
  ) values
    (context.tenant_id, resources.goods_sale_id, 1, resources.goods_product_id,
      'Overview goods', 1, 50000, 50000, 'none'),
    (context.tenant_id, resources.service_sale_id, 1, resources.service_product_id,
      'Overview service', 1, 10000, 10000, 'none');

  for index_value in 1..6 loop
    draft_id := gen_random_uuid();
    draft_ids := array_append(draft_ids, draft_id);
    insert into public.sales (
      id, tenant_id, branch_id, customer_id, effective_sale_date,
      currency_code, status, total_amount, version,
      create_idempotency_key, create_request_fingerprint, created_by,
      updated_at
    ) values (
      draft_id, context.tenant_id, resources.allowed_branch_id,
      resources.customer_id, current_date, 'EGP', 'draft', 9999, 1,
      'overview-draft-' || index_value::text || '-' || suffix,
      encode(digest('overview-draft-' || index_value::text || suffix, 'sha256'), 'hex'),
      context.owner_id, now() + make_interval(secs => index_value)
    );
  end loop;

  perform set_config('app.canonical_sales_transition', resources.goods_sale_id::text, true);
  update public.sales set
    status = 'confirmed', sale_number = sale_number_prefix || lpad((floor(random() * 800000) + 100000)::integer::text, 6, '0'),
    version = 2, confirmed_by = context.owner_id, confirmed_at = now(), updated_at = now()
  where id = resources.goods_sale_id;
  perform set_config('app.canonical_sales_transition', resources.service_sale_id::text, true);
  update public.sales set
    status = 'confirmed', sale_number = sale_number_prefix || lpad((floor(random() * 800000) + 100000)::integer::text, 6, '0'),
    version = 2, confirmed_by = resources.operator_id, confirmed_at = now(), updated_at = now()
  where id = resources.service_sale_id;
  perform set_config('app.canonical_sales_transition', resources.denied_sale_id::text, true);
  update public.sales set
    status = 'confirmed', sale_number = sale_number_prefix || lpad((floor(random() * 800000) + 100000)::integer::text, 6, '0'),
    version = 2, confirmed_by = context.owner_id, confirmed_at = now(), updated_at = now()
  where id = resources.denied_sale_id;
  perform set_config('app.canonical_sales_transition', '', true);

  resources.draft_sale_ids := draft_ids;
  insert into sales_overview_resources values (resources.*);
end
$$;

-- Create genuine Canonical Financial Core receivables as an authorized owner.
select set_config('request.jwt.claim.sub', owner_auth::text, true) from sales_overview_context;
set local role authenticated;
select public.set_financial_period_lock(
  tenant_id, current_date, false, 'Sales overview runtime: open current period'
) from sales_overview_context;
do $$
declare
  context sales_overview_context%rowtype;
  resources sales_overview_resources%rowtype;
begin
  select * into context from sales_overview_context;
  select * into resources from sales_overview_resources;
  perform public.post_financial_sale(
    context.tenant_id, 'sales_core', 'sale', resources.goods_sale_id::text, 2,
    'overview-post-goods-' || resources.goods_sale_id::text, repeat('d', 64),
    resources.customer_id, 50000, 'EGP', current_date,
    resources.allowed_branch_id, 'OVERVIEW-GOODS'
  );
  perform public.post_financial_sale(
    context.tenant_id, 'sales_core', 'sale', resources.service_sale_id::text, 2,
    'overview-post-service-' || resources.service_sale_id::text, repeat('e', 64),
    resources.customer_id, 10000, 'EGP', current_date,
    resources.allowed_branch_id, 'OVERVIEW-SERVICE'
  );
end
$$;
reset role;

-- Missing Sales permissions fail closed.
select set_config('request.jwt.claim.sub', operator_auth::text, true) from sales_overview_context;
set local role authenticated;
do $$
declare denied boolean := false;
begin
  begin
    perform public.get_sales_overview('today', null);
  exception when insufficient_privilege then
    denied := sqlerrm = 'SALES_OVERVIEW_DENIED';
  end;
  if not denied then raise exception 'SALES_OVERVIEW_MISSING_PERMISSION_NOT_REJECTED'; end if;
end
$$;
reset role;

do $$
declare
  context sales_overview_context%rowtype;
  resources sales_overview_resources%rowtype;
  group_id uuid := gen_random_uuid();
begin
  select * into context from sales_overview_context;
  select * into resources from sales_overview_resources;
  insert into public.res_groups (id, tenant_id, name, code, category, is_system, active)
  values (group_id, context.tenant_id, 'Sales Overview Runtime',
    'sales_overview_runtime_' || left(resources.operator_id::text, 8), 'sales', false, true);
  insert into public.auth_group_permissions (group_id, permission_id)
  select group_id, permission.id from public.auth_permissions permission
  where permission.code in ('sales.access', 'sales.view');
  insert into public.res_users_groups (tenant_id, user_id, group_id)
  values (context.tenant_id, resources.operator_id, group_id);
end
$$;

select set_config('request.jwt.claim.sub', operator_auth::text, true) from sales_overview_context;
set local role authenticated;
do $$
declare
  resources sales_overview_resources%rowtype;
  result jsonb;
  denied boolean := false;
begin
  select * into resources from sales_overview_resources;
  result := public.get_sales_overview('today', null);

  if (result #>> '{period,code}') <> 'today'
     or jsonb_array_length(result #> '{scope,branches}') <> 1
     or (result #>> '{kpis,confirmed_sales_count}')::integer <> 2
     or (result #>> '{kpis,confirmed_sales_value_by_currency,0,amount}')::numeric <> 60000
     or (result #>> '{kpis,outstanding_by_currency,0,amount}')::numeric <> 60000
     or (result #>> '{kpis,pending_delivery_count}')::integer <> 1
     or jsonb_array_length(result -> 'drafts_preview') <> 5
     or jsonb_array_length(result -> 'outstanding_preview') <> 2
     or jsonb_array_length(result -> 'pending_delivery_preview') <> 1
     or jsonb_array_length(result -> 'recent_sales') > 7
     or jsonb_array_length(result -> 'salesperson_breakdown') <> 2 then
    raise exception 'SALES_OVERVIEW_AGGREGATION_FAILED: %', result;
  end if;

  if (result #> '{pending_delivery_preview,0,fulfillment}' ->> 'status') <> 'unreserved'
     or (result #>> '{pending_delivery_preview,0,fulfillment,remaining_quantity}')::numeric <> 1 then
    raise exception 'SALES_OVERVIEW_CANONICAL_FULFILLMENT_FAILED: %', result;
  end if;

  if result::text ~ '(account_id|journal_id|move_id|receivable_line_id|inventory_reservation_id|event_payload)'
     or result::text like '%' || resources.denied_sale_id::text || '%' then
    raise exception 'SALES_OVERVIEW_INTERNAL_OR_CROSS_BRANCH_DATA_LEAKED: %', result;
  end if;

  begin
    perform public.get_sales_overview('today', resources.denied_branch_id);
  exception when insufficient_privilege then
    denied := sqlerrm = 'SALES_OVERVIEW_BRANCH_SCOPE_DENIED';
  end;
  if not denied then raise exception 'SALES_OVERVIEW_INVALID_BRANCH_NOT_REJECTED'; end if;
end
$$;
reset role;

-- A foreign tenant cannot observe the target tenant fixtures.
select set_config('request.jwt.claim.sub', foreign_auth::text, true) from sales_overview_context;
set local role authenticated;
do $$
declare
  resources sales_overview_resources%rowtype;
  result jsonb;
begin
  select * into resources from sales_overview_resources;
  begin
    result := public.get_sales_overview('today', null);
    if result::text like '%' || resources.goods_sale_id::text || '%'
       or result::text like '%' || resources.service_sale_id::text || '%' then
      raise exception 'SALES_OVERVIEW_TENANT_ISOLATION_FAILED';
    end if;
  exception when insufficient_privilege then
    if sqlerrm <> 'SALES_OVERVIEW_DENIED' then raise; end if;
  end;
end
$$;
reset role;

rollback;
