begin;

alter table public.account_accounts
  add constraint account_accounts_type_reporting_category_check check (
    canonical_account_type is null or (
      (canonical_account_type = 'liquidity'
        and reporting_category = 'cash_and_cash_equivalents')
      or (canonical_account_type = 'receivable'
        and reporting_category in ('trade_receivables', 'other_receivables'))
      or (canonical_account_type = 'payable'
        and reporting_category = 'trade_payables')
      or (canonical_account_type = 'current_asset'
        and reporting_category in (
          'other_receivables', 'inventory', 'prepayments',
          'other_current_assets'
        ))
      or (canonical_account_type in ('non_current_asset', 'contra_asset')
        and reporting_category = 'non_current_assets')
      or (canonical_account_type = 'current_liability'
        and reporting_category in (
          'customer_advances', 'accruals', 'other_current_liabilities'
        ))
      or (canonical_account_type = 'non_current_liability'
        and reporting_category = 'non_current_liabilities')
      or (canonical_account_type in (
          'equity', 'retained_earnings', 'current_year_earnings'
        ) and reporting_category = 'equity')
      or (canonical_account_type = 'income' and reporting_category = 'revenue')
      or (canonical_account_type = 'contra_income'
        and reporting_category = 'contra_revenue')
      or (canonical_account_type = 'other_income'
        and reporting_category = 'other_income')
      or (canonical_account_type = 'cost_of_revenue'
        and reporting_category = 'cost_of_revenue')
      or (canonical_account_type = 'expense'
        and reporting_category = 'operating_expenses')
      or (canonical_account_type = 'finance_income'
        and reporting_category = 'finance_income')
      or (canonical_account_type = 'finance_expense'
        and reporting_category = 'finance_expenses')
      or (canonical_account_type = 'tax_expense'
        and reporting_category = 'income_tax')
      or (canonical_account_type = 'off_balance'
        and reporting_category = 'off_balance')
    )
  );

alter table public.canonical_chart_template_accounts
  add constraint canonical_chart_template_accounts_type_reporting_check check (
    (canonical_account_type = 'liquidity'
      and reporting_category = 'cash_and_cash_equivalents')
    or (canonical_account_type = 'receivable'
      and reporting_category in ('trade_receivables', 'other_receivables'))
    or (canonical_account_type = 'payable'
      and reporting_category = 'trade_payables')
    or (canonical_account_type = 'current_asset'
      and reporting_category in (
        'other_receivables', 'inventory', 'prepayments',
        'other_current_assets'
      ))
    or (canonical_account_type in ('non_current_asset', 'contra_asset')
      and reporting_category = 'non_current_assets')
    or (canonical_account_type = 'current_liability'
      and reporting_category in (
        'customer_advances', 'accruals', 'other_current_liabilities'
      ))
    or (canonical_account_type = 'non_current_liability'
      and reporting_category = 'non_current_liabilities')
    or (canonical_account_type in (
        'equity', 'retained_earnings', 'current_year_earnings'
      ) and reporting_category = 'equity')
    or (canonical_account_type = 'income' and reporting_category = 'revenue')
    or (canonical_account_type = 'contra_income'
      and reporting_category = 'contra_revenue')
    or (canonical_account_type = 'other_income'
      and reporting_category = 'other_income')
    or (canonical_account_type = 'cost_of_revenue'
      and reporting_category = 'cost_of_revenue')
    or (canonical_account_type = 'expense'
      and reporting_category = 'operating_expenses')
    or (canonical_account_type = 'finance_income'
      and reporting_category = 'finance_income')
    or (canonical_account_type = 'finance_expense'
      and reporting_category = 'finance_expenses')
    or (canonical_account_type = 'tax_expense'
      and reporting_category = 'income_tax')
    or (canonical_account_type = 'off_balance'
      and reporting_category = 'off_balance')
  );

create or replace function public.guard_account_group_hierarchy_cycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  cycle_found boolean;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception using errcode = '23514', message = 'ACCOUNT_GROUP_HIERARCHY_CYCLE';
  end if;

  with recursive ancestors as (
    select parent.id, parent.parent_id
    from public.account_groups parent
    where parent.id = new.parent_id
      and parent.tenant_id = new.tenant_id
    union all
    select parent.id, parent.parent_id
    from public.account_groups parent
    join ancestors child on child.parent_id = parent.id
    where parent.tenant_id = new.tenant_id
  )
  select exists(select 1 from ancestors where id = new.id)
  into cycle_found;

  if cycle_found then
    raise exception using errcode = '23514', message = 'ACCOUNT_GROUP_HIERARCHY_CYCLE';
  end if;
  return new;
end
$$;

drop trigger if exists account_groups_hierarchy_cycle_guard
  on public.account_groups;
create trigger account_groups_hierarchy_cycle_guard
before insert or update of parent_id, tenant_id on public.account_groups
for each row execute function public.guard_account_group_hierarchy_cycle();

commit;
