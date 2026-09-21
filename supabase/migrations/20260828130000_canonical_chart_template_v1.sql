begin;

-- Published template versions are immutable. Corrections are released as a
-- new version; active versions may only transition to retired.
create or replace function public.guard_published_chart_template()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent_status text;
begin
  if tg_table_name = 'canonical_chart_templates' then
    if tg_op = 'DELETE' and old.status <> 'draft' then
      raise exception using errcode = '23514', message = 'PUBLISHED_CHART_TEMPLATE_IS_IMMUTABLE';
    end if;
    if tg_op = 'UPDATE' and old.status <> 'draft' then
      if old.status = 'active'
         and new.status = 'retired'
         and new.id = old.id
         and new.template_key = old.template_key
         and new.version = old.version
         and new.name = old.name
         and new.description is not distinct from old.description
         and new.created_at = old.created_at then
        return new;
      end if;
      raise exception using errcode = '23514', message = 'PUBLISHED_CHART_TEMPLATE_IS_IMMUTABLE';
    end if;
    return coalesce(new, old);
  end if;

  select template.status into parent_status
  from public.canonical_chart_templates template
  where template.id = coalesce(new.template_id, old.template_id);
  if parent_status is distinct from 'draft' then
    raise exception using errcode = '23514', message = 'PUBLISHED_CHART_TEMPLATE_CONTENT_IS_IMMUTABLE';
  end if;
  return coalesce(new, old);
end
$$;

create trigger canonical_chart_templates_immutability_guard
before update or delete on public.canonical_chart_templates
for each row execute function public.guard_published_chart_template();
create trigger canonical_chart_template_groups_immutability_guard
before insert or update or delete on public.canonical_chart_template_groups
for each row execute function public.guard_published_chart_template();
create trigger canonical_chart_template_accounts_immutability_guard
before insert or update or delete on public.canonical_chart_template_accounts
for each row execute function public.guard_published_chart_template();

insert into public.canonical_chart_templates (
  template_key, version, name, description, status
) values (
  'general_trading', 1, 'General Trading — Canonical Chart',
  'General-purpose accrual accounting chart for a multi-tenant trading ERP. Liquidity and other real financial resources are conditional.',
  'draft'
);

with template as (
  select id from public.canonical_chart_templates
  where template_key = 'general_trading' and version = 1
)
insert into public.canonical_chart_template_groups (
  template_id, group_key, parent_group_key, name, suggested_code_prefix,
  sort_order, required
)
select template.id, definition.group_key, definition.parent_group_key,
       definition.name, definition.code_prefix, definition.sort_order, true
from template
cross join (values
  ('assets', null::text, 'Assets', '100000', 100),
  ('current_assets', 'assets', 'Current Assets', '110000', 110),
  ('liquidity_resources', 'current_assets', 'Liquidity Resources', '111000', 111),
  ('receivables', 'current_assets', 'Receivables and Advances', '120000', 120),
  ('settlement_clearing', 'current_assets', 'Settlement Clearing', '122000', 122),
  ('inventory_assets', 'current_assets', 'Inventory', '130000', 130),
  ('prepayments', 'current_assets', 'Prepayments', '140000', 140),
  ('liabilities', null::text, 'Liabilities', '200000', 200),
  ('current_liabilities', 'liabilities', 'Current Liabilities', '210000', 210),
  ('non_current_liabilities', 'liabilities', 'Non-current Liabilities', '220000', 220),
  ('equity', null::text, 'Equity', '300000', 300),
  ('income', null::text, 'Income', '400000', 400),
  ('operating_revenue', 'income', 'Operating Revenue', '410000', 410),
  ('expenses', null::text, 'Expenses', '500000', 500),
  ('cost_of_revenue', 'expenses', 'Cost of Revenue', '510000', 510),
  ('operating_expenses', 'expenses', 'Operating Expenses', '520000', 520)
) definition(group_key, parent_group_key, name, code_prefix, sort_order);

with template as (
  select id from public.canonical_chart_templates
  where template_key = 'general_trading' and version = 1
), definitions(
  template_account_key, group_key, name, suggested_code,
  canonical_account_type, statement_section, reporting_category,
  normal_balance, pnl_category, open_item_reconcile,
  statement_reconcile, provisioning_policy, feature_key, functional_role,
  sort_order
) as (values
  ('trade_receivable','receivables','Trade Receivable','121100','receivable','balance_sheet','trade_receivables','debit',null::text,true,false,'required',null::text,'customer_receivable',100),
  ('other_receivable','receivables','Other Receivable','121200','receivable','balance_sheet','other_receivables','debit',null,true,false,'required',null,'other_receivable',110),
  ('supplier_advances','receivables','Supplier Advances','121300','current_asset','balance_sheet','other_receivables','debit',null,true,false,'required',null,'supplier_advance',120),
  ('merchandise_inventory','inventory_assets','Merchandise Inventory','131100','current_asset','balance_sheet','inventory','debit',null,false,false,'required',null,'inventory',130),
  ('prepaid_expenses','prepayments','Prepaid Expenses','141100','current_asset','balance_sheet','prepayments','debit',null,false,false,'required',null,null,140),
  ('trade_payable','current_liabilities','Trade Payable','211100','payable','balance_sheet','trade_payables','credit',null,true,false,'required',null,'supplier_payable',200),
  ('customer_advances','current_liabilities','Customer Advances / Open Credits','212100','current_liability','balance_sheet','customer_advances','credit',null,true,false,'required',null,'customer_advance',210),
  ('accrued_expenses','current_liabilities','Accrued Expenses','213100','current_liability','balance_sheet','accruals','credit',null,true,false,'required',null,'accrued_expense',220),
  ('other_current_liabilities','current_liabilities','Other Current Liabilities','214100','current_liability','balance_sheet','other_current_liabilities','credit',null,true,false,'required',null,null,230),
  ('unidentified_receipts_suspense','current_liabilities','Unidentified Receipts / Suspense','215100','current_liability','balance_sheet','other_current_liabilities','credit',null,true,false,'required',null,'unidentified_receipts_suspense',240),
  ('capital','equity','Capital','311100','equity','balance_sheet','equity','credit',null,false,false,'required',null,null,300),
  ('retained_earnings','equity','Retained Earnings','312100','retained_earnings','balance_sheet','equity','credit',null,false,false,'required',null,null,310),
  ('current_year_earnings','equity','Current Year Earnings','313100','current_year_earnings','balance_sheet','equity','credit',null,false,false,'required',null,null,320),
  ('opening_balance_clearing','equity','Opening Balance Clearing','319900','equity','balance_sheet','equity','credit',null,false,false,'required',null,'opening_balance_clearing',390),
  ('merchandise_sales_revenue','operating_revenue','Merchandise Sales Revenue','411100','income','profit_and_loss','revenue','credit','operating',false,false,'required',null,'sales_revenue',400),
  ('sales_returns_allowances','operating_revenue','Sales Returns and Allowances','411200','contra_income','profit_and_loss','contra_revenue','debit','operating',false,false,'required',null,'sales_returns',410),
  ('other_operating_revenue','operating_revenue','Other Operating Revenue','419100','other_income','profit_and_loss','other_income','credit','operating',false,false,'required',null,null,420),
  ('merchandise_cogs','cost_of_revenue','Merchandise Cost of Goods Sold','511100','cost_of_revenue','profit_and_loss','cost_of_revenue','debit','operating',false,false,'required',null,'cogs',500),
  ('inventory_gain_loss','cost_of_revenue','Inventory Gain / Loss','512100','cost_of_revenue','profit_and_loss','cost_of_revenue','debit','operating',false,false,'required',null,null,510),
  ('payroll_expense','operating_expenses','Payroll Expense','521100','expense','profit_and_loss','operating_expenses','debit','operating',false,false,'required',null,null,600),
  ('rent_expense','operating_expenses','Rent Expense','522100','expense','profit_and_loss','operating_expenses','debit','operating',false,false,'required',null,null,610),
  ('utilities_expense','operating_expenses','Utilities Expense','523100','expense','profit_and_loss','operating_expenses','debit','operating',false,false,'required',null,null,620),
  ('selling_marketing_expense','operating_expenses','Selling and Marketing Expense','524100','expense','profit_and_loss','operating_expenses','debit','operating',false,false,'required',null,null,630),
  ('general_administrative_expense','operating_expenses','General and Administrative Expense','525100','expense','profit_and_loss','operating_expenses','debit','operating',false,false,'required',null,null,640),
  ('rounding_differences','operating_expenses','Rounding Differences','529900','expense','profit_and_loss','operating_expenses','debit','operating',false,false,'required',null,'rounding_differences',690),
  ('cashbox','liquidity_resources','Cashbox','111100','liquidity','balance_sheet','cash_and_cash_equivalents','debit',null,false,false,'conditional','cashbox_resource',null,700),
  ('bank_account','liquidity_resources','Bank Account','111200','liquidity','balance_sheet','cash_and_cash_equivalents','debit',null,false,true,'conditional','bank_account_resource',null,710),
  ('pos_drawer','liquidity_resources','POS Drawer','111300','liquidity','balance_sheet','cash_and_cash_equivalents','debit',null,false,false,'conditional','pos_drawer_resource',null,720),
  ('wallet_account','liquidity_resources','Wallet Account','111400','liquidity','balance_sheet','cash_and_cash_equivalents','debit',null,false,true,'conditional','wallet_resource',null,730),
  ('employee_cash_custody','receivables','Employee Cash Custody','121400','current_asset','balance_sheet','other_receivables','debit',null,true,false,'conditional','employee_custody_resource',null,740),
  ('owner_current_receivable','receivables','Owner Current — Receivable','121500','receivable','balance_sheet','other_receivables','debit',null,true,false,'conditional','owner_current_resource',null,750),
  ('card_settlement_clearing','settlement_clearing','Card Settlement Clearing','122100','current_asset','balance_sheet','other_receivables','debit',null,true,false,'conditional','card_clearing_resource',null,760),
  ('payment_provider_clearing','settlement_clearing','Payment Provider Clearing','122200','current_asset','balance_sheet','other_receivables','debit',null,true,false,'conditional','payment_provider_resource',null,770),
  ('owner_current_payable','current_liabilities','Owner Current — Payable','214200','current_liability','balance_sheet','other_current_liabilities','credit',null,true,false,'conditional','owner_current_resource',null,780),
  ('loan_payable','non_current_liabilities','Loan Payable','221100','non_current_liability','balance_sheet','non_current_liabilities','credit',null,false,false,'conditional','loan_resource',null,790)
)
insert into public.canonical_chart_template_accounts (
  template_id, template_account_key, group_key, name, suggested_code,
  canonical_account_type, statement_section, reporting_category,
  normal_balance, pnl_category, open_item_reconcile,
  statement_reconcile, provisioning_policy, feature_key, functional_role,
  sort_order
)
select template.id, definitions.* from template cross join definitions;

update public.canonical_chart_templates
set status = 'active'
where template_key = 'general_trading' and version = 1;

comment on function public.guard_published_chart_template() is
  'Makes active/retired chart versions immutable. Accounting template changes require a new version.';

commit;
