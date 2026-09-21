begin;

do $$
declare
  tenant_a uuid := gen_random_uuid();
  tenant_b uuid := gen_random_uuid();
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 12);
  resolved_id uuid;
  account_row public.account_accounts%rowtype;
  legacy_tenant uuid;
  legacy_account uuid;
  failed boolean;
  role text;
begin
  insert into public.tenants(id, name, slug)
  values(tenant_a, 'Phase 2.5D Tenant A', 'phase25d-a-' || suffix);
  insert into public.tenants(id, name, slug)
  values(tenant_b, 'Phase 2.5D Tenant B', 'phase25d-b-' || suffix);

  foreach role in array array[
    'customer_receivable','supplier_payable','sales_revenue',
    'customer_advance','inventory','cogs','inventory_gain_loss',
    'unidentified_receipts_suspense','rounding_differences'
  ] loop
    resolved_id := public.resolve_functional_account(tenant_a, role, null);
    select * into account_row from public.account_accounts where id = resolved_id;
    if account_row.tenant_id <> tenant_a or account_row.account_origin <> 'template'
       or not account_row.active or not account_row.is_posting then
      raise exception 'CANONICAL_ROLE_RESOLUTION_INVALID: %', role;
    end if;
  end loop;

  if (select count(*) from public.resolve_functional_accounts(
    tenant_a, array['customer_receivable','sales_revenue','inventory'], null
  )) <> 3 then raise exception 'BATCH_FUNCTIONAL_RESOLUTION_FAILED'; end if;

  if exists (select 1 from public.account_accounts
    where tenant_id = tenant_a and canonical_account_type = 'liquidity'
      and template_account_key <> 'cash_in_transit') then
    raise exception 'NON_CANONICAL_LIQUIDITY_RESOURCE_PROVISIONED';
  end if;
  if not exists (select 1 from public.account_accounts account
    join public.account_functional_accounts configuration
      on configuration.tenant_id = account.tenant_id
     and configuration.account_id = account.id
     and configuration.functional_role = 'cash_in_transit'
     and configuration.is_active
    where account.tenant_id = tenant_a
      and account.template_account_key = 'cash_in_transit'
      and account.canonical_account_type = 'liquidity'
      and account.account_origin = 'template') then
    raise exception 'CASH_IN_TRANSIT_NOT_CANONICALLY_PROVISIONED';
  end if;
  failed := false;
  begin
    perform public.resolve_functional_account(tenant_a, 'default_cash', null);
  exception when feature_not_supported then failed := true;
  end;
  if not failed then raise exception 'RESOURCE_ROLE_RESOLVED_AS_GENERIC_FUNCTIONAL_ACCOUNT'; end if;

  if public.resolve_financial_journal(tenant_a, 'sale', null, null) is null
     or public.resolve_financial_journal(tenant_a, 'purchase', null, null) is null
     or public.resolve_financial_journal(tenant_a, 'general', null, null) is null then
    raise exception 'NON_LIQUIDITY_JOURNAL_RESOLUTION_FAILED';
  end if;

  failed := false;
  begin
    perform public.resolve_functional_account(tenant_a, 'payment_entity_receivable', null);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'MISSING_CONFIGURATION_DID_NOT_FAIL_CLOSED'; end if;

  resolved_id := public.resolve_functional_account(tenant_a, 'inventory', null);
  update public.account_accounts set active = false where id = resolved_id;
  failed := false;
  begin
    perform public.resolve_functional_account(tenant_a, 'inventory', null);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'INACTIVE_ACCOUNT_RESOLVED'; end if;
  update public.account_accounts set active = true where id = resolved_id;

  resolved_id := public.resolve_functional_account(tenant_a, 'sales_revenue', null);
  update public.account_accounts set is_posting = false where id = resolved_id;
  failed := false;
  begin
    perform public.resolve_functional_account(tenant_a, 'sales_revenue', null);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'STRUCTURAL_ACCOUNT_RESOLVED'; end if;
  update public.account_accounts set is_posting = true where id = resolved_id;

  resolved_id := public.resolve_functional_account(tenant_a, 'inventory', null);
  update public.account_functional_accounts
  set account_id = public.resolve_functional_account(tenant_a, 'sales_revenue', null)
  where tenant_id = tenant_a and functional_role = 'inventory' and is_active;
  failed := false;
  begin
    perform public.resolve_functional_account(tenant_a, 'inventory', null);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'INCOMPATIBLE_TAXONOMY_RESOLVED'; end if;

  select tenant_id, account_id into legacy_tenant, legacy_account
  from public.account_functional_accounts
  where functional_role = 'customer_receivable' and is_active
    and tenant_id not in (tenant_a, tenant_b)
  order by tenant_id limit 1;
  if legacy_tenant is null then raise exception 'LEGACY_FUNCTIONAL_CONFIGURATION_MISSING'; end if;
  if public.resolve_functional_account(legacy_tenant, 'customer_receivable', null) <> legacy_account then
    raise exception 'LEGACY_ADAPTER_RESOLUTION_FAILED';
  end if;

  if public.account_matches_functional_role(
    tenant_b,
    public.resolve_functional_account(tenant_a, 'customer_receivable', null),
    'customer_receivable', null
  ) then raise exception 'CROSS_TENANT_ACCOUNT_MATCH_ACCEPTED'; end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname not in (
        'migrate_old_showroom_sale_payments',
        'migrate_old_showroom_sales_invoice_moves'
      )
      and procedure.prosrc ~ '(\\.code|credit_account_code)[[:space:]]*(=|is distinct from)[[:space:]]*''(114001|114002|212001|411000)'''
  ) then raise exception 'RUNTIME_FUNCTIONAL_ACCOUNT_CODE_DECISION_REMAINS'; end if;
end
$$;

rollback;
