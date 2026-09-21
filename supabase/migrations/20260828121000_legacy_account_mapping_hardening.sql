begin;

alter table public.account_legacy_mappings
  add constraint account_legacy_mappings_type_statement_check check (
    canonical_account_type is null or (
      (canonical_account_type in (
        'liquidity', 'receivable', 'payable', 'current_asset',
        'non_current_asset', 'contra_asset', 'current_liability',
        'non_current_liability', 'equity', 'retained_earnings',
        'current_year_earnings'
      ) and statement_section = 'balance_sheet')
      or (canonical_account_type in (
        'income', 'contra_income', 'other_income', 'cost_of_revenue',
        'expense', 'finance_income', 'finance_expense', 'tax_expense'
      ) and statement_section = 'profit_and_loss')
      or (canonical_account_type = 'off_balance' and statement_section = 'off_balance')
    )
  ),
  add constraint account_legacy_mappings_type_normal_check check (
    canonical_account_type is null or (
      (canonical_account_type in (
        'liquidity', 'receivable', 'current_asset', 'non_current_asset',
        'contra_income', 'cost_of_revenue', 'expense', 'finance_expense',
        'tax_expense'
      ) and normal_balance = 'debit')
      or (canonical_account_type in (
        'payable', 'contra_asset', 'current_liability',
        'non_current_liability', 'equity', 'retained_earnings',
        'current_year_earnings', 'income', 'other_income', 'finance_income'
      ) and normal_balance = 'credit')
      or canonical_account_type = 'off_balance'
    )
  ),
  add constraint account_legacy_mappings_type_reporting_check check (
    canonical_account_type is null
    or (canonical_account_type = 'liquidity' and reporting_category = 'cash_and_cash_equivalents')
    or (canonical_account_type = 'receivable' and reporting_category in ('trade_receivables', 'other_receivables'))
    or (canonical_account_type = 'payable' and reporting_category = 'trade_payables')
    or (canonical_account_type = 'current_asset' and reporting_category in ('inventory', 'prepayments', 'other_current_assets'))
    or (canonical_account_type in ('non_current_asset', 'contra_asset') and reporting_category = 'non_current_assets')
    or (canonical_account_type = 'current_liability' and reporting_category in ('customer_advances', 'accruals', 'other_current_liabilities'))
    or (canonical_account_type = 'non_current_liability' and reporting_category = 'non_current_liabilities')
    or (canonical_account_type in ('equity', 'retained_earnings', 'current_year_earnings') and reporting_category = 'equity')
    or (canonical_account_type = 'income' and reporting_category = 'revenue')
    or (canonical_account_type = 'contra_income' and reporting_category = 'contra_revenue')
    or (canonical_account_type = 'other_income' and reporting_category = 'other_income')
    or (canonical_account_type = 'cost_of_revenue' and reporting_category = 'cost_of_revenue')
    or (canonical_account_type = 'expense' and reporting_category = 'operating_expenses')
    or (canonical_account_type = 'finance_income' and reporting_category = 'finance_income')
    or (canonical_account_type = 'finance_expense' and reporting_category = 'finance_expenses')
    or (canonical_account_type = 'tax_expense' and reporting_category = 'income_tax')
    or (canonical_account_type = 'off_balance' and reporting_category = 'off_balance')
  );

create or replace function public.guard_legacy_account_mapping()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  template_account public.canonical_chart_template_accounts%rowtype;
begin
  if not exists (
    select 1 from public.account_accounts account
    where account.id = new.legacy_account_id
      and account.tenant_id = new.tenant_id
      and account.account_origin = 'legacy'
  ) then
    raise exception using errcode = '23514', message = 'MAPPING_REQUIRES_TENANT_LEGACY_ACCOUNT';
  end if;

  if new.canonical_template_account_id is not null then
    select * into template_account
    from public.canonical_chart_template_accounts
    where id = new.canonical_template_account_id;

    if not found
       or new.canonical_semantic_key is distinct from template_account.template_account_key
       or new.canonical_account_type is distinct from template_account.canonical_account_type
       or new.statement_section is distinct from template_account.statement_section
       or new.reporting_category is distinct from template_account.reporting_category
       or new.normal_balance is distinct from template_account.normal_balance
       or new.pnl_category is distinct from template_account.pnl_category
       or new.target_open_item_reconcile is distinct from template_account.open_item_reconcile
       or new.target_statement_reconcile is distinct from template_account.statement_reconcile then
      raise exception using errcode = '23514', message = 'MAPPING_TEMPLATE_METADATA_MISMATCH';
    end if;
  end if;
  return new;
end
$$;

commit;
