-- Canonical Sales module and list runtime proof. All fixtures roll back.
begin;

do $$
declare
  v_module public.ir_modules%rowtype;
begin
  if (select count(*) from public.ir_modules where technical_name = 'sales') <> 1 then
    raise exception 'SALES_MODULE_DUPLICATE_OR_MISSING';
  end if;
  select * into strict v_module from public.ir_modules where technical_name = 'sales';
  if v_module.name <> 'المبيعات'
     or v_module.route_path <> '/app/sales'
     or not v_module.application
     or v_module.technical
     or not v_module.installable
     or not v_module.active then
    raise exception 'SALES_MODULE_METADATA_INVALID';
  end if;
  if exists (
    select 1 from public.tenant_modules tenant_module
    where tenant_module.module_id = v_module.id
    group by tenant_module.tenant_id, tenant_module.module_id
    having count(*) > 1
  ) then
    raise exception 'SALES_TENANT_INSTALLATION_DUPLICATE';
  end if;
end
$$;

create temporary table sales_list_context as
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
    select 1 from public.tenant_users member
    where member.auth_user_id = auth_user.id
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
order by owner.tenant_id
limit 1;

do $$
begin
  if not exists (select 1 from sales_list_context) then
    raise exception 'SALES_LIST_RUNTIME_FIXTURE_UNAVAILABLE';
  end if;
end
$$;

create temporary table sales_list_resources (
  allowed_branch_id uuid,
  denied_branch_id uuid,
  allowed_customer_id uuid,
  denied_customer_id uuid,
  operator_id uuid,
  draft_sale_id uuid,
  confirmed_sale_id uuid,
  denied_branch_sale_id uuid,
  unique_term text
);
grant select on sales_list_context to authenticated;
grant select on sales_list_resources to authenticated;

do $$
declare
  context sales_list_context%rowtype;
  resources sales_list_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  confirmed_number text := 'SAL-2099-' || lpad((floor(random() * 900000000) + 100000000)::bigint::text, 9, '0');
begin
  select * into context from sales_list_context;
  resources.allowed_branch_id := gen_random_uuid();
  resources.denied_branch_id := gen_random_uuid();
  resources.allowed_customer_id := gen_random_uuid();
  resources.denied_customer_id := gen_random_uuid();
  resources.operator_id := gen_random_uuid();
  resources.draft_sale_id := gen_random_uuid();
  resources.confirmed_sale_id := gen_random_uuid();
  resources.denied_branch_sale_id := gen_random_uuid();
  resources.unique_term := 'SalesList' || suffix;

  insert into public.branches (id, tenant_id, name, code, is_active) values
    (resources.allowed_branch_id, context.tenant_id, 'Sales List Allowed ' || suffix, 'SLA' || left(suffix, 5), true),
    (resources.denied_branch_id, context.tenant_id, 'Sales List Denied ' || suffix, 'SLD' || left(suffix, 5), true);

  insert into public.partners (
    id, tenant_id, branch_id, name, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values
    (resources.allowed_customer_id, context.tenant_id, resources.allowed_branch_id,
      resources.unique_term || ' Customer', 'person', false, true, 1, 0, 0, true),
    (resources.denied_customer_id, context.tenant_id, resources.denied_branch_id,
      resources.unique_term || ' Hidden', 'person', false, true, 1, 0, 0, true);

  insert into public.tenant_users (
    id, tenant_id, auth_user_id, full_name, role, is_active
  ) values (
    resources.operator_id, context.tenant_id, context.operator_auth,
    'Sales List Operator', 'staff', true
  );

  insert into public.user_branch_access (tenant_id, user_id, branch_id)
  values (context.tenant_id, resources.operator_id, resources.allowed_branch_id);

  insert into public.sales (
    id, tenant_id, branch_id, customer_id, effective_sale_date,
    currency_code, status, total_amount, version,
    create_idempotency_key, create_request_fingerprint, created_by
  ) values
    (resources.draft_sale_id, context.tenant_id, resources.allowed_branch_id,
      resources.allowed_customer_id, date '2099-01-10', 'EGP', 'draft', 50000, 1,
      'sales-list-draft-' || suffix, repeat('a', 64), context.owner_id),
    (resources.confirmed_sale_id, context.tenant_id, resources.allowed_branch_id,
      resources.allowed_customer_id, date '2099-01-11', 'EGP', 'draft', 20000, 1,
      'sales-list-confirmed-' || suffix, repeat('b', 64), context.owner_id),
    (resources.denied_branch_sale_id, context.tenant_id, resources.denied_branch_id,
      resources.denied_customer_id, date '2099-01-12', 'EGP', 'draft', 10000, 1,
      'sales-list-hidden-' || suffix, repeat('c', 64), context.owner_id);

  perform set_config('app.canonical_sales_transition', resources.confirmed_sale_id::text, true);
  update public.sales
  set status = 'confirmed', sale_number = confirmed_number,
      version = 2, confirmed_by = context.owner_id, confirmed_at = now(), updated_at = now()
  where id = resources.confirmed_sale_id;
  perform set_config('app.canonical_sales_transition', '', true);

  insert into sales_list_resources values (resources.*);
end
$$;

-- Missing sales permissions fail closed.
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_list_context;
set local role authenticated;
do $$
declare denied boolean := false;
begin
  begin
    perform public.list_sales();
  exception when insufficient_privilege then
    denied := sqlerrm = 'SALES_VIEW_DENIED';
  end;
  if not denied then
    raise exception 'SALES_LIST_MISSING_PERMISSION_NOT_REJECTED';
  end if;
end
$$;
reset role;

-- Grant only the canonical application/view capabilities to the operator.
do $$
declare
  context sales_list_context%rowtype;
  resources sales_list_resources%rowtype;
  group_id uuid := gen_random_uuid();
begin
  select * into context from sales_list_context;
  select * into resources from sales_list_resources;
  insert into public.res_groups (
    id, tenant_id, name, code, category, is_system, active
  ) values (
    group_id, context.tenant_id, 'Sales List Runtime',
    'sales_list_runtime_' || resources.unique_term, 'sales', false, true
  );
  insert into public.auth_group_permissions (group_id, permission_id)
  select group_id, permission.id
  from public.auth_permissions permission
  where permission.code in ('sales.access', 'sales.view');
  insert into public.res_users_groups (tenant_id, user_id, group_id)
  values (context.tenant_id, resources.operator_id, group_id);
end
$$;

select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_list_context;
set local role authenticated;

-- Branch scope, empty search, business search, status and pagination.
do $$
declare
  resources sales_list_resources%rowtype;
  result jsonb;
  item jsonb;
  denied boolean := false;
begin
  select * into resources from sales_list_resources;

  result := public.list_sales(1, 25, resources.unique_term, null, null, null, null, null, null);
  if (result ->> 'total_count')::integer <> 2
     or jsonb_array_length(result -> 'items') <> 2
     or jsonb_array_length(result #> '{filter_options,branches}') <> 1 then
    raise exception 'SALES_LIST_BRANCH_SCOPE_OR_SEARCH_FAILED: %', result;
  end if;
  if exists (
    select 1 from jsonb_array_elements(result -> 'items') value
    where value #>> '{branch,id}' = resources.denied_branch_id::text
  ) then
    raise exception 'SALES_LIST_DENIED_BRANCH_LEAKED';
  end if;

  result := public.list_sales(1, 25, 'no-match-' || resources.unique_term, null, null, null, null, null, null);
  if (result ->> 'total_count')::integer <> 0 or jsonb_array_length(result -> 'items') <> 0 then
    raise exception 'SALES_LIST_EMPTY_RESULT_FAILED';
  end if;

  result := public.list_sales(1, 25, null, 'confirmed', resources.allowed_branch_id, date '2099-01-01', date '2099-01-31', 'unpaid', 'unreserved');
  if (result ->> 'total_count')::integer <> 1 then
    raise exception 'SALES_LIST_FILTERS_FAILED: %', result;
  end if;
  item := result -> 'items' -> 0;
  if item ->> 'status' <> 'confirmed'
     or item #>> '{payment,status}' <> 'unpaid'
     or (item #>> '{payment,settled_amount}')::numeric <> 0
     or (item #>> '{payment,outstanding_amount}')::numeric <> 20000
     or item #>> '{fulfillment,status}' <> 'unreserved'
     or item ? 'receivable_line_id'
     or item ? 'account_id'
     or item ? 'journal_id' then
    raise exception 'SALES_LIST_BUSINESS_DTO_FAILED: %', item;
  end if;

  result := public.list_sales(1, 1, resources.unique_term, null, null, null, null, null, null);
  if (result ->> 'total_count')::integer <> 2
     or (result ->> 'page_count')::integer <> 2
     or jsonb_array_length(result -> 'items') <> 1 then
    raise exception 'SALES_LIST_PAGINATION_PAGE_ONE_FAILED: %', result;
  end if;
  result := public.list_sales(2, 1, resources.unique_term, null, null, null, null, null, null);
  if (result ->> 'page')::integer <> 2 or jsonb_array_length(result -> 'items') <> 1 then
    raise exception 'SALES_LIST_PAGINATION_PAGE_TWO_FAILED: %', result;
  end if;

  begin
    perform public.list_sales(1, 25, null, null, resources.denied_branch_id, null, null, null, null);
  exception when insufficient_privilege then
    denied := sqlerrm = 'SALES_BRANCH_SCOPE_DENIED';
  end;
  if not denied then
    raise exception 'SALES_LIST_EXPLICIT_BRANCH_SCOPE_NOT_REJECTED';
  end if;
end
$$;
reset role;

-- A member of another tenant cannot search the target tenant fixtures.
select set_config('request.jwt.claim.sub', foreign_auth::text, true)
from sales_list_context;
set local role authenticated;
do $$
declare
  resources sales_list_resources%rowtype;
  result jsonb;
begin
  select * into resources from sales_list_resources;
  begin
    result := public.list_sales(1, 25, resources.unique_term, null, null, null, null, null, null);
    if (result ->> 'total_count')::integer <> 0 then
      raise exception 'SALES_LIST_TENANT_ISOLATION_FAILED: %', result;
    end if;
  exception when insufficient_privilege then
    -- A foreign tenant without Sales access is also an acceptable fail-closed result.
    if sqlerrm <> 'SALES_VIEW_DENIED' then raise; end if;
  end;
end
$$;
reset role;

rollback;
