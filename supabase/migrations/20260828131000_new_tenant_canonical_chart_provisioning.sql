begin;

alter table public.account_functional_accounts
  drop constraint account_functional_accounts_role_check,
  add constraint account_functional_accounts_role_check check (
    functional_role in (
      'customer_receivable', 'payment_entity_receivable', 'sales_revenue',
      'default_cash', 'default_bank', 'legacy_customer_advance',
      'other_receivable', 'supplier_advance', 'inventory',
      'supplier_payable', 'customer_advance', 'accrued_expense',
      'opening_balance_clearing', 'sales_returns', 'cogs',
      'unidentified_receipts_suspense', 'rounding_differences'
    )
  );

create or replace function public.provision_tenant_canonical_chart(
  p_tenant_id uuid,
  p_template_key text default 'general_trading',
  p_template_version integer default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_template public.canonical_chart_templates%rowtype;
  installation_id uuid;
  group_definition record;
  account_definition record;
  target_group_id uuid;
  provisioned_account_id uuid;
  legacy_account_type text;
begin
  if not exists (select 1 from public.tenants tenant where tenant.id = p_tenant_id) then
    raise exception using errcode = 'P0002', message = 'TENANT_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('canonical_chart:' || p_tenant_id::text, 0));

  select * into selected_template
  from public.canonical_chart_templates template
  where template.template_key = p_template_key
    and template.status = 'active'
    and (p_template_version is null or template.version = p_template_version)
  order by template.version desc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002', message = 'ACTIVE_CANONICAL_CHART_TEMPLATE_NOT_FOUND';
  end if;

  insert into public.tenant_chart_template_installations (
    tenant_id, template_id, status
  ) values (p_tenant_id, selected_template.id, 'provisioning')
  on conflict (tenant_id, template_id) do update
    set status = 'provisioning', updated_at = now()
  returning id into installation_id;

  for group_definition in
    with recursive hierarchy as (
      select definition.*, 0 as depth
      from public.canonical_chart_template_groups definition
      where definition.template_id = selected_template.id
        and definition.parent_group_key is null
      union all
      select child.*, parent.depth + 1
      from public.canonical_chart_template_groups child
      join hierarchy parent
        on parent.template_id = child.template_id
       and parent.group_key = child.parent_group_key
    )
    select * from hierarchy order by depth, sort_order, group_key
  loop
    select groups.id into target_group_id
    from public.account_groups groups
    where groups.tenant_id = p_tenant_id
      and groups.template_group_key = group_definition.group_key;

    if target_group_id is null then
      insert into public.account_groups (
        tenant_id, parent_id, code, name, code_prefix_start,
        semantic_key, template_group_key
      ) values (
        p_tenant_id,
        (select parent.id from public.account_groups parent
          where parent.tenant_id = p_tenant_id
            and parent.template_group_key = group_definition.parent_group_key),
        group_definition.suggested_code_prefix,
        group_definition.name,
        group_definition.suggested_code_prefix,
        group_definition.group_key,
        group_definition.group_key
      );
    end if;
  end loop;

  for account_definition in
    select * from public.canonical_chart_template_accounts definition
    where definition.template_id = selected_template.id
      and definition.provisioning_policy = 'required'
    order by definition.sort_order, definition.template_account_key
  loop
    select account.id into provisioned_account_id
    from public.account_accounts account
    where account.tenant_id = p_tenant_id
      and account.template_account_key = account_definition.template_account_key;

    if provisioned_account_id is null then
      select groups.id into target_group_id
      from public.account_groups groups
      where groups.tenant_id = p_tenant_id
        and groups.template_group_key = account_definition.group_key;
      if target_group_id is null then
        raise exception using errcode = '23514', message = 'CANONICAL_TEMPLATE_GROUP_NOT_PROVISIONED';
      end if;

      legacy_account_type := case
        when account_definition.statement_section = 'balance_sheet'
             and account_definition.normal_balance = 'debit' then 'asset'
        when account_definition.statement_section = 'balance_sheet'
             and account_definition.canonical_account_type in (
               'equity', 'retained_earnings', 'current_year_earnings'
             ) then 'equity'
        when account_definition.statement_section = 'balance_sheet' then 'liability'
        when account_definition.normal_balance = 'credit' then 'income'
        else 'expense'
      end;

      insert into public.account_accounts (
        tenant_id, group_id, code, name, account_type, reconcile, active,
        canonical_account_type, statement_section, reporting_category,
        normal_balance, pnl_category, open_item_reconcile,
        statement_reconcile, is_posting, semantic_key,
        template_account_key, account_origin
      ) values (
        p_tenant_id, target_group_id, account_definition.suggested_code,
        account_definition.name, legacy_account_type,
        account_definition.open_item_reconcile, true,
        account_definition.canonical_account_type,
        account_definition.statement_section,
        account_definition.reporting_category,
        account_definition.normal_balance, account_definition.pnl_category,
        account_definition.open_item_reconcile,
        account_definition.statement_reconcile, true,
        account_definition.template_account_key,
        account_definition.template_account_key, 'template'
      ) returning id into provisioned_account_id;
    end if;

    if account_definition.functional_role is not null
       and not exists (
         select 1 from public.account_functional_accounts configuration
         where configuration.tenant_id = p_tenant_id
           and configuration.branch_id is null
           and configuration.functional_role = account_definition.functional_role
           and configuration.is_active
       ) then
      insert into public.account_functional_accounts (
        tenant_id, branch_id, functional_role, account_id
      ) values (
        p_tenant_id, null, account_definition.functional_role,
        provisioned_account_id
      );
    end if;
  end loop;

  update public.tenant_chart_template_installations installation
  set status = 'installed', installed_at = coalesce(installed_at, now()),
      updated_at = now()
  where installation.id = installation_id;

  return installation_id;
end
$$;

-- Replace the legacy signup chart/payment bootstrap for future tenants. The
-- existing AFTER INSERT trigger already calls this function. Existing tenants
-- are not backfilled by this migration.
create or replace function public.initialize_tenant_defaults(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.tenants
  set setup_status = 'running', updated_at = now()
  where id = p_tenant_id;

  perform public.provision_tenant_canonical_chart(
    p_tenant_id, 'general_trading', null
  );

  update public.tenants
  set is_initialized = true, initialized_at = coalesce(initialized_at, now()),
      setup_status = 'done', updated_at = now()
  where id = p_tenant_id;
exception when others then
  update public.tenants
  set setup_status = 'failed', updated_at = now()
  where id = p_tenant_id;
  raise;
end
$$;

revoke all on function public.provision_tenant_canonical_chart(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.provision_tenant_canonical_chart(uuid, text, integer)
  to service_role;
revoke all on function public.initialize_tenant_defaults(uuid)
  from public, anon, authenticated;
grant execute on function public.initialize_tenant_defaults(uuid)
  to service_role;

comment on function public.provision_tenant_canonical_chart(uuid, text, integer) is
  'Idempotently provisions structural groups, required template accounts, and basic semantic functional configuration. Conditional resources are never auto-created.';
comment on function public.initialize_tenant_defaults(uuid) is
  'Future-tenant canonical accounting bootstrap. Replaces legacy code-driven chart, liquidity journal, and POS payment-method signup provisioning.';

commit;
