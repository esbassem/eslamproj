begin;

-- Phase 2.5A is schema-only. Existing accounts remain legacy and no posted
-- accounting record is reclassified or rewritten by this migration.

alter table public.account_accounts
  add column canonical_account_type text,
  add column statement_section text,
  add column reporting_category text,
  add column normal_balance text,
  add column pnl_category text,
  add column open_item_reconcile boolean not null default false,
  add column statement_reconcile boolean not null default false,
  add column is_posting boolean not null default true,
  add column semantic_key text,
  add column template_account_key text,
  add column account_origin text not null default 'legacy';

update public.account_accounts
set open_item_reconcile = reconcile;

alter table public.account_accounts
  add constraint account_accounts_canonical_type_check check (
    canonical_account_type is null or canonical_account_type in (
      'liquidity', 'receivable', 'payable', 'current_asset',
      'non_current_asset', 'contra_asset', 'current_liability',
      'non_current_liability', 'equity', 'retained_earnings',
      'current_year_earnings', 'income', 'contra_income', 'other_income',
      'cost_of_revenue', 'expense', 'finance_income', 'finance_expense',
      'tax_expense', 'off_balance'
    )
  ),
  add constraint account_accounts_statement_section_check check (
    statement_section is null or statement_section in (
      'balance_sheet', 'profit_and_loss', 'off_balance'
    )
  ),
  add constraint account_accounts_reporting_category_check check (
    reporting_category is null or reporting_category in (
      'cash_and_cash_equivalents', 'trade_receivables', 'other_receivables',
      'inventory', 'prepayments', 'other_current_assets', 'non_current_assets',
      'trade_payables', 'customer_advances', 'accruals',
      'other_current_liabilities', 'non_current_liabilities', 'equity',
      'revenue', 'contra_revenue', 'other_income', 'cost_of_revenue',
      'operating_expenses', 'finance_income', 'finance_expenses',
      'income_tax', 'off_balance'
    )
  ),
  add constraint account_accounts_normal_balance_check check (
    normal_balance is null or normal_balance in ('debit', 'credit')
  ),
  add constraint account_accounts_pnl_category_check check (
    pnl_category is null or pnl_category in (
      'operating', 'investing', 'financing', 'income_tax',
      'discontinued_operations'
    )
  ),
  add constraint account_accounts_origin_check check (
    account_origin in ('legacy', 'template', 'manual', 'resource')
  ),
  add constraint account_accounts_semantic_key_format_check check (
    semantic_key is null or semantic_key ~ '^[a-z][a-z0-9_]*$'
  ),
  add constraint account_accounts_template_key_format_check check (
    template_account_key is null or template_account_key ~ '^[a-z][a-z0-9_]*$'
  ),
  add constraint account_accounts_canonical_metadata_complete_check check (
    canonical_account_type is null or (
      statement_section is not null
      and reporting_category is not null
      and normal_balance is not null
      and (
        (statement_section = 'profit_and_loss' and pnl_category is not null)
        or (statement_section <> 'profit_and_loss' and pnl_category is null)
      )
    )
  ),
  add constraint account_accounts_type_statement_check check (
    canonical_account_type is null or (
      (canonical_account_type in (
        'liquidity', 'receivable', 'payable', 'current_asset',
        'non_current_asset', 'contra_asset', 'current_liability',
        'non_current_liability', 'equity', 'retained_earnings',
        'current_year_earnings'
      ) and statement_section = 'balance_sheet')
      or
      (canonical_account_type in (
        'income', 'contra_income', 'other_income', 'cost_of_revenue',
        'expense', 'finance_income', 'finance_expense', 'tax_expense'
      ) and statement_section = 'profit_and_loss')
      or
      (canonical_account_type = 'off_balance' and statement_section = 'off_balance')
    )
  ),
  add constraint account_accounts_type_normal_balance_check check (
    canonical_account_type is null or (
      (canonical_account_type in (
        'liquidity', 'receivable', 'current_asset', 'non_current_asset',
        'contra_income', 'cost_of_revenue', 'expense', 'finance_expense',
        'tax_expense'
      ) and normal_balance = 'debit')
      or
      (canonical_account_type in (
        'payable', 'contra_asset', 'current_liability',
        'non_current_liability', 'equity', 'retained_earnings',
        'current_year_earnings', 'income', 'other_income', 'finance_income'
      ) and normal_balance = 'credit')
      or canonical_account_type = 'off_balance'
    )
  ),
  add constraint account_accounts_open_item_type_check check (
    not open_item_reconcile
    or canonical_account_type is null
    or canonical_account_type in (
      'liquidity', 'receivable', 'payable', 'current_asset',
      'current_liability'
    )
  ),
  add constraint account_accounts_statement_reconcile_type_check check (
    not statement_reconcile
    or canonical_account_type is null
    or canonical_account_type = 'liquidity'
  ),
  add constraint account_accounts_template_origin_check check (
    template_account_key is null or account_origin = 'template'
  );

create unique index account_accounts_semantic_key_uidx
  on public.account_accounts (tenant_id, semantic_key)
  where semantic_key is not null;

create unique index account_accounts_template_key_uidx
  on public.account_accounts (tenant_id, template_account_key)
  where template_account_key is not null and account_origin = 'template';

create index account_accounts_canonical_reporting_idx
  on public.account_accounts (
    tenant_id, statement_section, reporting_category, canonical_account_type
  ) where canonical_account_type is not null;

create index account_accounts_reconciliation_idx
  on public.account_accounts (tenant_id, open_item_reconcile, statement_reconcile)
  where open_item_reconcile or statement_reconcile;

create or replace function public.sync_account_reconciliation_compatibility()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.open_item_reconcile is distinct from new.reconcile then
      if new.open_item_reconcile then
        new.reconcile := true;
      else
        new.open_item_reconcile := new.reconcile;
      end if;
    end if;
    return new;
  end if;

  if new.open_item_reconcile is distinct from old.open_item_reconcile
     and new.reconcile is not distinct from old.reconcile then
    new.reconcile := new.open_item_reconcile;
  elsif new.reconcile is distinct from old.reconcile
        and new.open_item_reconcile is not distinct from old.open_item_reconcile then
    new.open_item_reconcile := new.reconcile;
  elsif new.reconcile is distinct from old.reconcile
        and new.open_item_reconcile is distinct from old.open_item_reconcile
        and new.reconcile is distinct from new.open_item_reconcile then
    raise exception using errcode = '23514',
      message = 'RECONCILIATION_COMPATIBILITY_VALUES_CONFLICT';
  end if;

  return new;
end
$$;

drop trigger if exists account_accounts_reconciliation_compatibility
  on public.account_accounts;
create trigger account_accounts_reconciliation_compatibility
before insert or update of reconcile, open_item_reconcile
on public.account_accounts
for each row execute function public.sync_account_reconciliation_compatibility();

create or replace function public.guard_account_posting_capability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_table_name = 'account_accounts' then
    if old.is_posting and not new.is_posting and exists (
      select 1 from public.account_move_lines line
      where line.account_id = old.id
      limit 1
    ) then
      raise exception using errcode = '23514',
        message = 'USED_ACCOUNT_CANNOT_BECOME_STRUCTURAL';
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from public.account_accounts account
    where account.id = new.account_id
      and account.tenant_id = new.tenant_id
      and account.active
      and account.is_posting
  ) then
    raise exception using errcode = '23514',
      message = 'MOVE_LINE_REQUIRES_ACTIVE_POSTING_ACCOUNT';
  end if;
  return new;
end
$$;

drop trigger if exists account_accounts_posting_capability_guard
  on public.account_accounts;
create trigger account_accounts_posting_capability_guard
before update of is_posting on public.account_accounts
for each row execute function public.guard_account_posting_capability();

drop trigger if exists account_move_lines_posting_account_guard
  on public.account_move_lines;
create trigger account_move_lines_posting_account_guard
before insert or update of tenant_id, account_id on public.account_move_lines
for each row execute function public.guard_account_posting_capability();

alter table public.account_groups
  add column semantic_key text,
  add column template_group_key text;

alter table public.account_groups
  add constraint account_groups_semantic_key_format_check check (
    semantic_key is null or semantic_key ~ '^[a-z][a-z0-9_]*$'
  ),
  add constraint account_groups_template_key_format_check check (
    template_group_key is null or template_group_key ~ '^[a-z][a-z0-9_]*$'
  ),
  add constraint account_groups_id_tenant_key unique (id, tenant_id);

create unique index account_groups_semantic_key_uidx
  on public.account_groups (tenant_id, semantic_key)
  where semantic_key is not null;

create unique index account_groups_template_key_uidx
  on public.account_groups (tenant_id, template_group_key)
  where template_group_key is not null;

alter table public.account_groups
  add constraint account_groups_parent_tenant_fkey
    foreign key (parent_id, tenant_id)
    references public.account_groups (id, tenant_id);

alter table public.account_accounts
  add constraint account_accounts_group_tenant_fkey
    foreign key (group_id, tenant_id)
    references public.account_groups (id, tenant_id),
  add constraint account_accounts_responsible_tenant_fkey
    foreign key (responsible_user_id, tenant_id)
    references public.tenant_users (id, tenant_id);

comment on table public.account_groups is
  'Structural Chart of Accounts hierarchy only. Account move lines reference posting accounts, never groups.';
comment on column public.account_accounts.account_type is
  'Legacy five-value account type retained temporarily for backward compatibility.';
comment on column public.account_accounts.canonical_account_type is
  'Canonical accounting behavior taxonomy; independent of account code and display name.';
comment on column public.account_accounts.semantic_key is
  'Stable tenant-local identity for an account concept; distinct from functional configuration and template provenance.';
comment on column public.account_accounts.template_account_key is
  'Stable source template key when account_origin=template; null for manual, legacy, and resource-derived accounts.';
comment on column public.account_accounts.reconcile is
  'Legacy compatibility alias for open_item_reconcile. New code must use explicit reconciliation semantics.';

create table public.canonical_chart_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  version integer not null,
  name text not null,
  description text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_chart_templates_key_format_check
    check (template_key ~ '^[a-z][a-z0-9_]*$'),
  constraint canonical_chart_templates_version_check check (version > 0),
  constraint canonical_chart_templates_status_check
    check (status in ('draft', 'active', 'retired')),
  constraint canonical_chart_templates_key_version_key
    unique (template_key, version),
  constraint canonical_chart_templates_id_key_key unique (id, template_key)
);

create unique index canonical_chart_templates_one_active_uidx
  on public.canonical_chart_templates (template_key)
  where status = 'active';

create table public.canonical_chart_template_groups (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.canonical_chart_templates(id) on delete cascade,
  group_key text not null,
  parent_group_key text,
  name text not null,
  suggested_code_prefix text,
  sort_order integer not null default 0,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  constraint canonical_chart_template_groups_key_format_check
    check (group_key ~ '^[a-z][a-z0-9_]*$'),
  constraint canonical_chart_template_groups_parent_format_check
    check (parent_group_key is null or parent_group_key ~ '^[a-z][a-z0-9_]*$'),
  constraint canonical_chart_template_groups_not_self_check
    check (parent_group_key is null or parent_group_key <> group_key),
  constraint canonical_chart_template_groups_template_key
    unique (template_id, group_key),
  constraint canonical_chart_template_groups_parent_fkey
    foreign key (template_id, parent_group_key)
    references public.canonical_chart_template_groups(template_id, group_key)
    deferrable initially deferred
);

create table public.canonical_chart_template_accounts (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.canonical_chart_templates(id) on delete cascade,
  template_account_key text not null,
  group_key text not null,
  name text not null,
  suggested_code text,
  canonical_account_type text not null,
  statement_section text not null,
  reporting_category text not null,
  normal_balance text not null,
  pnl_category text,
  open_item_reconcile boolean not null default false,
  statement_reconcile boolean not null default false,
  provisioning_policy text not null,
  feature_key text,
  functional_role text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint canonical_chart_template_accounts_key_format_check
    check (template_account_key ~ '^[a-z][a-z0-9_]*$'),
  constraint canonical_chart_template_accounts_feature_format_check
    check (feature_key is null or feature_key ~ '^[a-z][a-z0-9_]*$'),
  constraint canonical_chart_template_accounts_role_format_check
    check (functional_role is null or functional_role ~ '^[a-z][a-z0-9_]*$'),
  constraint canonical_chart_template_accounts_type_check check (
    canonical_account_type in (
      'liquidity', 'receivable', 'payable', 'current_asset',
      'non_current_asset', 'contra_asset', 'current_liability',
      'non_current_liability', 'equity', 'retained_earnings',
      'current_year_earnings', 'income', 'contra_income', 'other_income',
      'cost_of_revenue', 'expense', 'finance_income', 'finance_expense',
      'tax_expense', 'off_balance'
    )
  ),
  constraint canonical_chart_template_accounts_statement_check
    check (statement_section in ('balance_sheet', 'profit_and_loss', 'off_balance')),
  constraint canonical_chart_template_accounts_reporting_check check (
    reporting_category in (
      'cash_and_cash_equivalents', 'trade_receivables', 'other_receivables',
      'inventory', 'prepayments', 'other_current_assets', 'non_current_assets',
      'trade_payables', 'customer_advances', 'accruals',
      'other_current_liabilities', 'non_current_liabilities', 'equity',
      'revenue', 'contra_revenue', 'other_income', 'cost_of_revenue',
      'operating_expenses', 'finance_income', 'finance_expenses',
      'income_tax', 'off_balance'
    )
  ),
  constraint canonical_chart_template_accounts_normal_check
    check (normal_balance in ('debit', 'credit')),
  constraint canonical_chart_template_accounts_pnl_check check (
    pnl_category is null or pnl_category in (
      'operating', 'investing', 'financing', 'income_tax',
      'discontinued_operations'
    )
  ),
  constraint canonical_chart_template_accounts_metadata_check check (
    (
      canonical_account_type in (
        'liquidity', 'receivable', 'payable', 'current_asset',
        'non_current_asset', 'contra_asset', 'current_liability',
        'non_current_liability', 'equity', 'retained_earnings',
        'current_year_earnings'
      )
      and statement_section = 'balance_sheet'
      and pnl_category is null
    ) or (
      canonical_account_type in (
        'income', 'contra_income', 'other_income', 'cost_of_revenue',
        'expense', 'finance_income', 'finance_expense', 'tax_expense'
      )
      and statement_section = 'profit_and_loss'
      and pnl_category is not null
    ) or (
      canonical_account_type = 'off_balance'
      and statement_section = 'off_balance'
      and pnl_category is null
    )
  ),
  constraint canonical_chart_template_accounts_normal_type_check check (
    (
      canonical_account_type in (
        'liquidity', 'receivable', 'current_asset', 'non_current_asset',
        'contra_income', 'cost_of_revenue', 'expense', 'finance_expense',
        'tax_expense'
      ) and normal_balance = 'debit'
    ) or (
      canonical_account_type in (
        'payable', 'contra_asset', 'current_liability',
        'non_current_liability', 'equity', 'retained_earnings',
        'current_year_earnings', 'income', 'other_income', 'finance_income'
      ) and normal_balance = 'credit'
    ) or canonical_account_type = 'off_balance'
  ),
  constraint canonical_chart_template_accounts_open_item_check check (
    not open_item_reconcile or canonical_account_type in (
      'liquidity', 'receivable', 'payable', 'current_asset',
      'current_liability'
    )
  ),
  constraint canonical_chart_template_accounts_statement_reconcile_check check (
    not statement_reconcile or canonical_account_type = 'liquidity'
  ),
  constraint canonical_chart_template_accounts_policy_check
    check (provisioning_policy in ('required', 'conditional')),
  constraint canonical_chart_template_accounts_conditional_feature_check
    check (
      (provisioning_policy = 'required' and feature_key is null)
      or (provisioning_policy = 'conditional' and feature_key is not null)
    ),
  constraint canonical_chart_template_accounts_template_key
    unique (template_id, template_account_key),
  constraint canonical_chart_template_accounts_code_key
    unique (template_id, suggested_code),
  constraint canonical_chart_template_accounts_group_fkey
    foreign key (template_id, group_key)
    references public.canonical_chart_template_groups(template_id, group_key)
    deferrable initially deferred
);

create table public.tenant_chart_template_installations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null references public.canonical_chart_templates(id) on delete restrict,
  status text not null default 'planned',
  installed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_chart_template_installations_status_check
    check (status in ('planned', 'provisioning', 'installed', 'failed', 'retired')),
  constraint tenant_chart_template_installations_tenant_template_key
    unique (tenant_id, template_id)
);

create unique index tenant_chart_template_one_current_uidx
  on public.tenant_chart_template_installations (tenant_id)
  where status in ('planned', 'provisioning', 'installed');

create trigger canonical_chart_templates_set_updated_at
before update on public.canonical_chart_templates
for each row execute function public.set_updated_at();

create trigger tenant_chart_template_installations_set_updated_at
before update on public.tenant_chart_template_installations
for each row execute function public.set_updated_at();

alter table public.canonical_chart_templates enable row level security;
alter table public.canonical_chart_template_groups enable row level security;
alter table public.canonical_chart_template_accounts enable row level security;
alter table public.tenant_chart_template_installations enable row level security;

create policy canonical_chart_templates_authenticated_read
  on public.canonical_chart_templates for select to authenticated using (true);
create policy canonical_chart_template_groups_authenticated_read
  on public.canonical_chart_template_groups for select to authenticated using (true);
create policy canonical_chart_template_accounts_authenticated_read
  on public.canonical_chart_template_accounts for select to authenticated using (true);
create policy tenant_chart_template_installations_tenant_read
  on public.tenant_chart_template_installations for select to authenticated
  using (public.is_tenant_member(tenant_id));

revoke all on table public.canonical_chart_templates from anon, authenticated;
revoke all on table public.canonical_chart_template_groups from anon, authenticated;
revoke all on table public.canonical_chart_template_accounts from anon, authenticated;
revoke all on table public.tenant_chart_template_installations from anon, authenticated;
grant select on table public.canonical_chart_templates to authenticated;
grant select on table public.canonical_chart_template_groups to authenticated;
grant select on table public.canonical_chart_template_accounts to authenticated;
grant select on table public.tenant_chart_template_installations to authenticated;

comment on table public.canonical_chart_templates is
  'Versioned Chart of Accounts template foundation. Phase 2.5A creates no template data and provisions no tenant accounts.';
comment on table public.canonical_chart_template_groups is
  'Structural, non-posting hierarchy definitions belonging to a versioned canonical template.';
comment on table public.canonical_chart_template_accounts is
  'Canonical template account definitions; required accounts are distinct from feature-conditional accounts.';
comment on table public.tenant_chart_template_installations is
  'Tracks future safe provisioning; no installation is created by Phase 2.5A.';

commit;
