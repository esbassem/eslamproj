begin;

do $$
declare
  tenant_a uuid := gen_random_uuid();
  tenant_b uuid := gen_random_uuid();
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 12);
  v_template_id uuid;
  required_count integer;
  conditional_count integer;
  group_count integer;
  account_count integer;
  functional_count integer;
  installation_id uuid;
  repeated_installation_id uuid;
  move_id uuid;
  group_id uuid;
  version_two_id uuid;
  failed boolean;
begin
  select id into v_template_id from public.canonical_chart_templates
  where template_key = 'general_trading' and version = 1 and status = 'active';
  if v_template_id is null then raise exception 'CANONICAL_TEMPLATE_V1_MISSING'; end if;

  select count(*) into required_count from public.canonical_chart_template_accounts
  where template_id = v_template_id and provisioning_policy = 'required';
  select count(*) into conditional_count from public.canonical_chart_template_accounts
  where template_id = v_template_id and provisioning_policy = 'conditional';
  if required_count <> 25 or conditional_count <> 10 then
    raise exception 'UNEXPECTED_TEMPLATE_POLICY_COUNTS: required %, conditional %', required_count, conditional_count;
  end if;

  if not exists (
    select 1 from public.canonical_chart_template_accounts
    where template_id = v_template_id
      and template_account_key = 'unidentified_receipts_suspense'
      and canonical_account_type = 'current_liability'
      and reporting_category = 'other_current_liabilities'
      and normal_balance = 'credit'
      and open_item_reconcile and not statement_reconcile
      and provisioning_policy = 'required'
  ) then raise exception 'SUSPENSE_CLASSIFICATION_INVALID'; end if;

  failed := false;
  begin
    update public.canonical_chart_template_accounts
    set name = name || ' mutation'
    where template_id = v_template_id and template_account_key = 'trade_receivable';
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'ACTIVE_TEMPLATE_MUTATION_ACCEPTED'; end if;

  insert into public.canonical_chart_templates(
    template_key, version, name, status
  ) values (
    'general_trading', 2, 'General Trading — Test Version 2', 'draft'
  ) returning id into version_two_id;
  if version_two_id is null then raise exception 'TEMPLATE_VERSION_TWO_DRAFT_FAILED'; end if;
  failed := false;
  begin
    update public.canonical_chart_templates set status = 'active'
    where id = version_two_id;
  exception when unique_violation then failed := true;
  end;
  if not failed then raise exception 'MULTIPLE_ACTIVE_TEMPLATE_VERSIONS_ACCEPTED'; end if;

  insert into public.tenants(id, name, slug)
  values(tenant_a, 'Phase 2.5C Tenant A', 'phase25c-a-' || suffix);
  insert into public.tenants(id, name, slug)
  values(tenant_b, 'Phase 2.5C Tenant B', 'phase25c-b-' || suffix);

  select count(*) into group_count from public.account_groups
  where tenant_id = tenant_a and template_group_key is not null;
  select count(*) into account_count from public.account_accounts
  where tenant_id = tenant_a and account_origin = 'template';
  select count(*) into functional_count from public.account_functional_accounts
  where tenant_id = tenant_a and is_active;
  if group_count <> 16 then raise exception 'PROVISIONED_GROUP_COUNT_INVALID: %', group_count; end if;
  if account_count <> required_count then raise exception 'PROVISIONED_REQUIRED_COUNT_INVALID: %', account_count; end if;
  if functional_count <> 14 then raise exception 'FUNCTIONAL_CONFIGURATION_COUNT_INVALID: %', functional_count; end if;

  if exists (
    select 1 from public.account_accounts account
    join public.canonical_chart_template_accounts definition
      on definition.template_id = v_template_id
     and definition.template_account_key = account.template_account_key
    where account.tenant_id = tenant_a
      and definition.provisioning_policy = 'conditional'
  ) then raise exception 'CONDITIONAL_RESOURCE_AUTO_PROVISIONED'; end if;

  if exists (
    select 1 from public.account_accounts
    where tenant_id = tenant_a and canonical_account_type = 'liquidity'
  ) then raise exception 'LIQUIDITY_RESOURCE_AUTO_PROVISIONED'; end if;
  if (select count(*) from public.account_journals
      where tenant_id = tenant_a and type in ('general', 'sale', 'purchase')
         and journal_origin = 'template' and default_account_id is null) <> 3 then
    raise exception 'NON_LIQUIDITY_JOURNALS_NOT_PROVISIONED';
  end if;
  if exists (select 1 from public.account_journals
    where tenant_id = tenant_a and type in ('cash', 'bank')) then
    raise exception 'LIQUIDITY_JOURNAL_AUTO_PROVISIONED';
  end if;
  if exists (select 1 from public.pos_payment_methods where tenant_id = tenant_a) then
    raise exception 'PAYMENT_METHOD_AUTO_PROVISIONED';
  end if;

  select id into installation_id from public.tenant_chart_template_installations
  where tenant_id = tenant_a and template_id = v_template_id and status = 'installed';
  repeated_installation_id := public.provision_tenant_canonical_chart(tenant_a, 'general_trading', 1);
  if repeated_installation_id <> installation_id then raise exception 'PROVISIONING_NOT_IDEMPOTENT'; end if;
  if (select count(*) from public.account_groups where tenant_id = tenant_a and template_group_key is not null) <> group_count
     or (select count(*) from public.account_accounts where tenant_id = tenant_a and account_origin = 'template') <> account_count
     or (select count(*) from public.account_functional_accounts where tenant_id = tenant_a and is_active) <> functional_count then
    raise exception 'REPROVISIONING_CREATED_DUPLICATES';
  end if;

  if exists (
    select 1 from public.account_accounts account
    where account.tenant_id = tenant_a and exists (
      select 1 from public.account_accounts other
      where other.tenant_id = tenant_b and other.id = account.id
    )
  ) then raise exception 'TENANT_ACCOUNT_IDENTITY_COLLISION'; end if;

  select id into group_id from public.account_groups
  where tenant_id = tenant_a and template_group_key = 'assets';
  insert into public.account_moves(tenant_id, name, move_type, state)
  values(tenant_a, 'PHASE25C-DRAFT-' || suffix, 'journal', 'draft') returning id into move_id;
  failed := false;
  begin
    insert into public.account_move_lines(tenant_id, move_id, account_id, debit, credit)
    values(tenant_a, move_id, group_id, 1, 0);
  exception when foreign_key_violation or check_violation then failed := true;
  end;
  if not failed then raise exception 'STRUCTURAL_GROUP_ACCEPTED_POSTING'; end if;
end
$$;

rollback;
