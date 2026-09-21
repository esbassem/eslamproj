begin;

create table public.account_functional_role_definitions (
  functional_role text primary key,
  resolution_kind text not null,
  expected_semantic_key text,
  allowed_canonical_types text[] not null default '{}',
  allowed_reporting_categories text[] not null default '{}',
  requires_open_item_reconcile boolean not null default false,
  description text not null,
  created_at timestamptz not null default now(),
  constraint account_functional_role_definitions_role_format_check
    check (functional_role ~ '^[a-z][a-z0-9_]*$'),
  constraint account_functional_role_definitions_kind_check
    check (resolution_kind in ('functional', 'resource_derived')),
  constraint account_functional_role_definitions_semantic_format_check
    check (expected_semantic_key is null or expected_semantic_key ~ '^[a-z][a-z0-9_]*$'),
  constraint account_functional_role_definitions_contract_check check (
    (resolution_kind = 'functional'
      and expected_semantic_key is not null
      and cardinality(allowed_canonical_types) > 0
      and cardinality(allowed_reporting_categories) > 0)
    or
    (resolution_kind = 'resource_derived'
      and expected_semantic_key is null
      and cardinality(allowed_canonical_types) = 0
      and cardinality(allowed_reporting_categories) = 0
      and not requires_open_item_reconcile)
  )
);

insert into public.account_functional_role_definitions (
  functional_role, resolution_kind, expected_semantic_key,
  allowed_canonical_types, allowed_reporting_categories,
  requires_open_item_reconcile, description
) values
  ('customer_receivable','functional','trade_receivable',array['receivable'],array['trade_receivables'],true,'Trade receivable used by customer invoicing and settlement.'),
  ('payment_entity_receivable','functional','payment_entity_receivable',array['receivable'],array['other_receivables'],true,'Amounts receivable from financing/payment entities.'),
  ('other_receivable','functional','other_receivable',array['receivable'],array['other_receivables'],true,'General non-trade open-item receivable.'),
  ('supplier_advance','functional','supplier_advances',array['current_asset'],array['other_receivables'],true,'Advances paid to suppliers.'),
  ('supplier_payable','functional','trade_payable',array['payable'],array['trade_payables'],true,'Trade payable used by supplier invoicing and settlement.'),
  ('customer_advance','functional','customer_advances',array['current_liability'],array['customer_advances'],true,'Customer advances and open credits.'),
  ('accrued_expense','functional','accrued_expenses',array['current_liability'],array['accruals'],true,'Accrued operating obligations.'),
  ('inventory','functional','merchandise_inventory',array['current_asset'],array['inventory'],false,'Merchandise inventory control account.'),
  ('sales_revenue','functional','merchandise_sales_revenue',array['income'],array['revenue'],false,'Merchandise sales revenue.'),
  ('sales_returns','functional','sales_returns_allowances',array['contra_income'],array['contra_revenue'],false,'Sales returns and allowances.'),
  ('cogs','functional','merchandise_cogs',array['cost_of_revenue'],array['cost_of_revenue'],false,'Merchandise cost of goods sold.'),
  ('inventory_gain_loss','functional','inventory_gain_loss',array['cost_of_revenue'],array['cost_of_revenue'],false,'Inventory gains and losses.'),
  ('opening_balance_clearing','functional','opening_balance_clearing',array['equity'],array['equity'],false,'Migration-controlled opening balance clearing.'),
  ('unidentified_receipts_suspense','functional','unidentified_receipts_suspense',array['current_liability'],array['other_current_liabilities'],true,'Short-lived unidentified receipt suspense open items.'),
  ('rounding_differences','functional','rounding_differences',array['expense'],array['operating_expenses'],false,'Immaterial posting rounding differences.'),
  ('default_cash','resource_derived',null,'{}','{}',false,'LEGACY adapter role only; canonical cash requires a Money Destination.'),
  ('default_bank','resource_derived',null,'{}','{}',false,'LEGACY adapter role only; canonical bank requires a Money Destination.'),
  ('employee_cash_custody','resource_derived',null,'{}','{}',false,'Employee custody is a resource-derived account, never a tenant default.'),
  ('pos_drawer','resource_derived',null,'{}','{}',false,'POS drawer is resolved from a future Money Destination.'),
  ('wallet_account','resource_derived',null,'{}','{}',false,'Wallet account is resolved from a future Money Destination.'),
  ('card_settlement_clearing','resource_derived',null,'{}','{}',false,'Card clearing is resolved from a future payment destination.'),
  ('payment_provider_clearing','resource_derived',null,'{}','{}',false,'Provider clearing is resolved from a future payment destination.');

update public.account_functional_accounts
set functional_role = 'customer_advance', updated_at = now()
where functional_role = 'legacy_customer_advance';

alter table public.account_functional_accounts
  drop constraint account_functional_accounts_role_check,
  add constraint account_functional_accounts_role_fkey
    foreign key (functional_role)
    references public.account_functional_role_definitions(functional_role)
    on update restrict on delete restrict;

alter table public.account_functional_role_definitions enable row level security;
create policy account_functional_role_definitions_authenticated_read
  on public.account_functional_role_definitions for select to authenticated using (true);
revoke all on table public.account_functional_role_definitions from anon, authenticated;
grant select on table public.account_functional_role_definitions to authenticated;

create or replace function public.resolve_functional_account(
  p_tenant_id uuid,
  p_functional_role text,
  p_branch_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  role_definition public.account_functional_role_definitions%rowtype;
  resolved_account_id uuid;
begin
  if p_tenant_id is null or nullif(btrim(p_functional_role), '') is null then
    raise exception using errcode = '22023', message = 'FUNCTIONAL_ACCOUNT_RESOLUTION_ARGUMENTS_REQUIRED';
  end if;
  if auth.uid() is not null and not public.is_tenant_member(p_tenant_id) then
    raise exception using errcode = '42501', message = 'FUNCTIONAL_ACCOUNT_TENANT_ACCESS_DENIED';
  end if;

  select * into role_definition
  from public.account_functional_role_definitions definition
  where definition.functional_role = p_functional_role;
  if not found then
    raise exception using errcode = '22023', message = 'UNKNOWN_FUNCTIONAL_ACCOUNT_ROLE';
  end if;
  if role_definition.resolution_kind = 'resource_derived' then
    raise exception using errcode = '0A000',
      message = 'RESOURCE_DERIVED_ACCOUNT_REQUIRES_MONEY_DESTINATION';
  end if;

  select configuration.account_id
  into resolved_account_id
  from public.account_functional_accounts configuration
  join public.account_accounts account
    on account.id = configuration.account_id
   and account.tenant_id = configuration.tenant_id
  left join public.account_legacy_mappings legacy_mapping
    on legacy_mapping.legacy_account_id = account.id
   and legacy_mapping.tenant_id = account.tenant_id
   and legacy_mapping.effective_to is null
  where configuration.tenant_id = p_tenant_id
    and configuration.functional_role = p_functional_role
    and configuration.is_active
    and (configuration.branch_id = p_branch_id or configuration.branch_id is null)
    and account.active
    and account.is_posting
    and coalesce(account.semantic_key, legacy_mapping.canonical_semantic_key)
        = role_definition.expected_semantic_key
    and coalesce(account.canonical_account_type, legacy_mapping.canonical_account_type)
        = any(role_definition.allowed_canonical_types)
    and coalesce(account.reporting_category, legacy_mapping.reporting_category)
        = any(role_definition.allowed_reporting_categories)
    and (
      not role_definition.requires_open_item_reconcile
      or coalesce(
        case when account.canonical_account_type is not null
          then account.open_item_reconcile end,
        legacy_mapping.target_open_item_reconcile,
        false
      )
    )
  order by (configuration.branch_id = p_branch_id) desc, configuration.id
  limit 1;

  if resolved_account_id is null then
    raise exception using errcode = '23514',
      message = format('FUNCTIONAL_ACCOUNT_NOT_CONFIGURED_OR_INCOMPATIBLE: %s', p_functional_role);
  end if;
  return resolved_account_id;
end
$$;

create or replace function public.account_matches_functional_role(
  p_tenant_id uuid,
  p_account_id uuid,
  p_functional_role text,
  p_branch_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_account_id = public.resolve_functional_account(
    p_tenant_id, p_functional_role, p_branch_id
  )
$$;

create or replace function public.resolve_functional_accounts(
  p_tenant_id uuid,
  p_functional_roles text[],
  p_branch_id uuid default null
)
returns table(functional_role text, account_id uuid)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  requested_role text;
begin
  if p_functional_roles is null or cardinality(p_functional_roles) = 0 then
    raise exception using errcode = '22023', message = 'FUNCTIONAL_ACCOUNT_ROLES_REQUIRED';
  end if;
  foreach requested_role in array p_functional_roles loop
    functional_role := requested_role;
    account_id := public.resolve_functional_account(
      p_tenant_id, requested_role, p_branch_id
    );
    return next;
  end loop;
end
$$;

create or replace function public.sync_installed_template_functional_accounts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status <> 'installed' then return new; end if;

  insert into public.account_functional_accounts (
    tenant_id, branch_id, functional_role, account_id
  )
  select new.tenant_id, null, definition.functional_role, account.id
  from public.account_functional_role_definitions definition
  join public.account_accounts account
    on account.tenant_id = new.tenant_id
   and account.account_origin = 'template'
   and account.semantic_key = definition.expected_semantic_key
   and account.canonical_account_type = any(definition.allowed_canonical_types)
   and account.reporting_category = any(definition.allowed_reporting_categories)
   and account.active
   and account.is_posting
  where definition.resolution_kind = 'functional'
    and not exists (
      select 1 from public.account_functional_accounts existing
      where existing.tenant_id = new.tenant_id
        and existing.branch_id is null
        and existing.functional_role = definition.functional_role
        and existing.is_active
    );
  return new;
end
$$;

create trigger tenant_chart_installation_functional_account_sync
after insert or update of status on public.tenant_chart_template_installations
for each row execute function public.sync_installed_template_functional_accounts();

revoke all on function public.resolve_functional_account(uuid, text, uuid) from public, anon;
revoke all on function public.account_matches_functional_role(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.resolve_functional_accounts(uuid, text[], uuid) from public, anon;
grant execute on function public.resolve_functional_account(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.account_matches_functional_role(uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.resolve_functional_accounts(uuid, text[], uuid) to authenticated, service_role;

comment on table public.account_functional_role_definitions is
  'Canonical resolver contract. Functional roles define accounting meaning; resource-derived roles fail closed until Money Destinations exist.';
comment on function public.resolve_functional_account(uuid, text, uuid) is
  'Tenant-safe, taxonomy-validating central account resolver. Legacy compatibility is allowed only through explicit configuration plus current Legacy Mapping.';

commit;
