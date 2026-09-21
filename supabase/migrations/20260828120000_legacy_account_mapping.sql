begin;

-- Phase 2.5B is inventory metadata only. It does not modify accounts, move
-- lines, reconciliations, balances, or application cutover behavior.

create table public.account_legacy_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  legacy_account_id uuid not null,
  mapping_version integer not null default 1,
  disposition text not null,
  confidence text not null,
  canonical_semantic_key text,
  canonical_account_type text,
  statement_section text,
  reporting_category text,
  normal_balance text,
  pnl_category text,
  target_open_item_reconcile boolean,
  target_statement_reconcile boolean,
  canonical_template_account_id uuid references public.canonical_chart_template_accounts(id) on delete restrict,
  source_code_snapshot text not null,
  source_name_snapshot text not null,
  evidence jsonb not null,
  reason text not null,
  requires_owner_decision boolean not null default false,
  owner_question text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_legacy_mappings_account_tenant_fkey
    foreign key (legacy_account_id, tenant_id)
    references public.account_accounts(id, tenant_id) on delete restrict,
  constraint account_legacy_mappings_version_check check (mapping_version > 0),
  constraint account_legacy_mappings_disposition_check
    check (disposition in ('KEEP', 'MAP', 'DEPRECATE', 'REVIEW', 'SPLIT_FUTURE')),
  constraint account_legacy_mappings_confidence_check
    check (confidence in ('high', 'medium', 'low')),
  constraint account_legacy_mappings_semantic_key_check
    check (canonical_semantic_key is null or canonical_semantic_key ~ '^[a-z][a-z0-9_]*$'),
  constraint account_legacy_mappings_type_check check (
    canonical_account_type is null or canonical_account_type in (
      'liquidity', 'receivable', 'payable', 'current_asset',
      'non_current_asset', 'contra_asset', 'current_liability',
      'non_current_liability', 'equity', 'retained_earnings',
      'current_year_earnings', 'income', 'contra_income', 'other_income',
      'cost_of_revenue', 'expense', 'finance_income', 'finance_expense',
      'tax_expense', 'off_balance'
    )
  ),
  constraint account_legacy_mappings_statement_check
    check (statement_section is null or statement_section in ('balance_sheet', 'profit_and_loss', 'off_balance')),
  constraint account_legacy_mappings_reporting_check check (
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
  constraint account_legacy_mappings_normal_check
    check (normal_balance is null or normal_balance in ('debit', 'credit')),
  constraint account_legacy_mappings_pnl_check check (
    pnl_category is null or pnl_category in (
      'operating', 'investing', 'financing', 'income_tax', 'discontinued_operations'
    )
  ),
  constraint account_legacy_mappings_metadata_all_or_none_check check (
    (canonical_account_type is null and statement_section is null and reporting_category is null
      and normal_balance is null and pnl_category is null
      and target_open_item_reconcile is null and target_statement_reconcile is null)
    or
    (canonical_account_type is not null and statement_section is not null
      and reporting_category is not null and normal_balance is not null
      and target_open_item_reconcile is not null and target_statement_reconcile is not null
      and ((statement_section = 'profit_and_loss' and pnl_category is not null)
        or (statement_section <> 'profit_and_loss' and pnl_category is null)))
  ),
  constraint account_legacy_mappings_open_item_type_check check (
    target_open_item_reconcile is distinct from true or canonical_account_type in (
      'liquidity', 'receivable', 'payable', 'current_asset', 'current_liability'
    )
  ),
  constraint account_legacy_mappings_statement_reconcile_type_check check (
    target_statement_reconcile is distinct from true or canonical_account_type = 'liquidity'
  ),
  constraint account_legacy_mappings_evidence_object_check
    check (jsonb_typeof(evidence) = 'object'),
  constraint account_legacy_mappings_owner_decision_check check (
    (requires_owner_decision and disposition in ('REVIEW', 'SPLIT_FUTURE') and nullif(btrim(owner_question), '') is not null)
    or (not requires_owner_decision and owner_question is null)
  ),
  constraint account_legacy_mappings_effective_range_check
    check (effective_to is null or effective_to > effective_from),
  constraint account_legacy_mappings_account_version_key
    unique (tenant_id, legacy_account_id, mapping_version)
);

create unique index account_legacy_mappings_current_uidx
  on public.account_legacy_mappings (tenant_id, legacy_account_id)
  where effective_to is null;

create index account_legacy_mappings_reporting_idx
  on public.account_legacy_mappings (
    tenant_id, statement_section, reporting_category, canonical_account_type
  ) where effective_to is null;

create index account_legacy_mappings_disposition_idx
  on public.account_legacy_mappings (tenant_id, disposition, confidence)
  where effective_to is null;

create or replace function public.guard_legacy_account_mapping()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.account_accounts account
    where account.id = new.legacy_account_id
      and account.tenant_id = new.tenant_id
      and account.account_origin = 'legacy'
  ) then
    raise exception using errcode = '23514', message = 'MAPPING_REQUIRES_TENANT_LEGACY_ACCOUNT';
  end if;
  return new;
end
$$;

create trigger account_legacy_mappings_legacy_guard
before insert or update of tenant_id, legacy_account_id
on public.account_legacy_mappings
for each row execute function public.guard_legacy_account_mapping();

create trigger account_legacy_mappings_set_updated_at
before update on public.account_legacy_mappings
for each row execute function public.set_updated_at();

alter table public.account_legacy_mappings enable row level security;
create policy account_legacy_mappings_tenant_read
  on public.account_legacy_mappings for select to authenticated
  using (public.is_tenant_member(tenant_id));
revoke all on table public.account_legacy_mappings from anon, authenticated;
grant select on table public.account_legacy_mappings to authenticated;

with account_evidence as (
  select
    account.id,
    account.tenant_id,
    account.code,
    account.name,
    count(line.id) filter (where move.state = 'posted')::integer as posted_line_count,
    coalesce(sum(line.debit) filter (where move.state = 'posted'), 0) as posted_debit,
    coalesce(sum(line.credit) filter (where move.state = 'posted'), 0) as posted_credit,
    min(move.date) filter (where move.state = 'posted') as first_posted_at,
    max(move.date) filter (where move.state = 'posted') as last_posted_at,
    count(distinct line.partner_id) filter (where move.state = 'posted' and line.partner_id is not null)::integer as partner_count,
    count(distinct line.source_entity_id) filter (where move.state = 'posted' and line.source_entity_id is not null)::integer as source_entity_count,
    coalesce(jsonb_agg(distinct move.move_type) filter (where move.state = 'posted' and move.move_type is not null), '[]'::jsonb) as move_types,
    coalesce(jsonb_agg(distinct move.pay_method) filter (where move.state = 'posted' and move.pay_method is not null), '[]'::jsonb) as payment_methods
  from public.account_accounts account
  left join public.account_move_lines line on line.account_id = account.id and line.tenant_id = account.tenant_id
  left join public.account_moves move on move.id = line.move_id and move.tenant_id = line.tenant_id
  where account.account_origin = 'legacy'
  group by account.id, account.tenant_id, account.code, account.name
), enriched as (
  select evidence.*,
    coalesce((select jsonb_agg(distinct other_account.code order by other_account.code)
      from public.account_move_lines own_line
      join public.account_moves own_move on own_move.id = own_line.move_id and own_move.tenant_id = own_line.tenant_id and own_move.state = 'posted'
      join public.account_move_lines other_line on other_line.move_id = own_line.move_id and other_line.tenant_id = own_line.tenant_id and other_line.account_id <> own_line.account_id
      join public.account_accounts other_account on other_account.id = other_line.account_id and other_account.tenant_id = other_line.tenant_id
      where own_line.account_id = evidence.id and own_line.tenant_id = evidence.tenant_id), '[]'::jsonb) as counterpart_codes,
    coalesce((select jsonb_agg(config.functional_role order by config.functional_role)
      from public.account_functional_accounts config
      where config.account_id = evidence.id and config.tenant_id = evidence.tenant_id and config.is_active), '[]'::jsonb) as functional_roles,
    coalesce((select jsonb_agg(jsonb_build_object('journal_code', journal.code, 'field', dependency.field_name) order by journal.code, dependency.field_name)
      from public.account_journals journal
      cross join lateral (values
        ('default_account_id', journal.default_account_id),
        ('outstanding_receipts_account_id', journal.outstanding_receipts_account_id),
        ('outstanding_payments_account_id', journal.outstanding_payments_account_id),
        ('suspense_account_id', journal.suspense_account_id),
        ('profit_account_id', journal.profit_account_id),
        ('loss_account_id', journal.loss_account_id)
      ) dependency(field_name, account_id)
      where journal.tenant_id = evidence.tenant_id and dependency.account_id = evidence.id), '[]'::jsonb) as journal_dependencies,
    coalesce((select jsonb_agg(proc.proname order by proc.proname)
      from pg_catalog.pg_proc proc
      join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
      where namespace.nspname = 'public' and position(evidence.code in proc.prosrc) > 0), '[]'::jsonb) as rpc_dependencies
  from account_evidence evidence
)
insert into public.account_legacy_mappings (
  tenant_id, legacy_account_id, disposition, confidence,
  canonical_semantic_key, canonical_account_type, statement_section,
  reporting_category, normal_balance, pnl_category,
  target_open_item_reconcile, target_statement_reconcile,
  source_code_snapshot, source_name_snapshot, evidence, reason,
  requires_owner_decision, owner_question
)
select
  account.tenant_id,
  account.id,
  case
    when account.code in ('113001', '114001', '211001', '411000', '511000') then 'KEEP'
    when account.code in ('114002', '212001', '399001', '412000', '531000') then 'MAP'
    when account.code in ('111003', '512000') then 'DEPRECATE'
    when account.code = '119001' then 'SPLIT_FUTURE'
    else 'REVIEW'
  end,
  case
    when account.code in ('111001', '111002', '111004') then 'medium'
    when account.code in ('112001', '700001', '700002', '700003', '700004') then 'low'
    else 'high'
  end,
  case account.code
    when '113001' then 'merchandise_inventory'
    when '114001' then 'trade_receivable'
    when '114002' then 'payment_entity_receivable'
    when '211001' then 'trade_payable'
    when '212001' then 'customer_advances'
    when '399001' then 'opening_balance_clearing'
    when '411000' then 'merchandise_sales_revenue'
    when '412000' then 'sales_returns_allowances'
    when '511000' then 'merchandise_cogs'
    when '531000' then 'cash_over_short'
  end,
  case account.code
    when '113001' then 'current_asset' when '114001' then 'receivable'
    when '114002' then 'receivable' when '211001' then 'payable'
    when '212001' then 'current_liability' when '399001' then 'equity'
    when '411000' then 'income' when '412000' then 'contra_income'
    when '511000' then 'cost_of_revenue' when '531000' then 'expense'
  end,
  case when account.code in ('411000','412000','511000','531000') then 'profit_and_loss'
       when account.code in ('113001','114001','114002','211001','212001','399001') then 'balance_sheet' end,
  case account.code
    when '113001' then 'inventory' when '114001' then 'trade_receivables'
    when '114002' then 'other_receivables' when '211001' then 'trade_payables'
    when '212001' then 'customer_advances' when '399001' then 'equity'
    when '411000' then 'revenue' when '412000' then 'contra_revenue'
    when '511000' then 'cost_of_revenue' when '531000' then 'operating_expenses'
  end,
  case when account.code in ('113001','114001','114002','412000','511000','531000') then 'debit'
       when account.code in ('211001','212001','399001','411000') then 'credit' end,
  case when account.code in ('411000','412000','511000','531000') then 'operating' end,
  case when account.code in ('114001','114002','211001','212001') then true
       when account.code in ('113001','399001','411000','412000','511000','531000') then false end,
  case when account.code in ('113001','114001','114002','211001','212001','399001','411000','412000','511000','531000') then false end,
  account.code,
  account.name,
  jsonb_build_object(
    'ledger', jsonb_build_object(
      'used_in_posted_ledger', account.posted_line_count > 0,
      'posted_line_count', account.posted_line_count,
      'total_debit', account.posted_debit,
      'total_credit', account.posted_credit,
      'balance', account.posted_debit - account.posted_credit,
      'first_posted_at', account.first_posted_at,
      'last_posted_at', account.last_posted_at,
      'partner_count', account.partner_count,
      'source_entity_count', account.source_entity_count,
      'move_types', account.move_types,
      'payment_methods', account.payment_methods,
      'counterpart_account_codes', account.counterpart_codes
    ),
    'dependencies', jsonb_build_object(
      'functional_roles', account.functional_roles,
      'journals', account.journal_dependencies,
      'remote_rpcs', account.rpc_dependencies,
      'repository_search_required_at_cutover', true
    ),
    'assessment_basis', 'posted ledger patterns, counterpart accounts, source entities, configuration, journals, RPC source and repository audit'
  ),
  case account.code
    when '113001' then 'Inventory role is explicit and consistent with the canonical merchandise inventory concept.'
    when '114001' then 'Posted receivable activity and operational dependencies support Trade Receivable.'
    when '114002' then 'Functional configuration identifies receivables due from payment entities.'
    when '211001' then 'Supplier liability role maps to Trade Payable; absence of posted use is not deletion evidence.'
    when '212001' then 'Open customer credits belong to Customer Advances, a liability rather than receivable.'
    when '399001' then 'Legacy opening-balance clearing concept maps for reporting but must not define the canonical chart.'
    when '411000' then 'Posted sales activity supports Merchandise Sales Revenue.'
    when '412000' then 'Sales returns belong to contra revenue; no historical posting rewrite is required.'
    when '511000' then 'Merchandise cost role maps to Cost of Revenue.'
    when '531000' then 'Cash differences map to Cash Over/Short operating expense.'
    when '111003' then 'The generic employee-cash node should become structural; resource-specific accounts replace it after cutover.'
    when '512000' then 'A generic all-expenses posting account is too broad; detailed canonical expense accounts replace it after cutover.'
    when '119001' then 'Historical postings combine cash, wallet, card, Aman and Instapay; one canonical liquidity role would be false precision.'
    when '111001' then 'Data cannot prove whether each tenant row is a physical cashbox or a placeholder.'
    when '111002' then 'Data cannot prove whether each tenant row is a showroom vault, POS drawer, or placeholder.'
    when '111004' then 'Settlement postings do not prove physical employee custody versus employee receivable/advance.'
    when '112001' then 'Generic unused bank rows contain no bank-account identity or evidence of a real financial resource.'
    else 'Settlement history and account name do not prove the canonical accounting nature of this operational/intermediary account.'
  end,
  account.code in ('111001','111002','111004','112001','119001','700001','700002','700003','700004'),
  case
    when account.code = '111001' then 'Does this tenant account represent a real physical main cashbox, and who controls it?'
    when account.code = '111002' then 'Does this tenant account represent a physical showroom vault, a POS drawer, or only a legacy placeholder?'
    when account.code = '111004' then 'Was this balance physical cash held by the employee, or an employee receivable/advance?'
    when account.code = '112001' then 'Is there a real active bank account behind this row; if so, which bank account?'
    when account.code = '119001' then 'Which real destinations received each historical payment modality, and which remain operational?'
    when account.code in ('700001','700002','700003','700004') then 'What real obligation, asset, income, or expense did this operational settlement account represent?'
  end
from enriched account;

do $$
declare
  legacy_count integer;
  mapping_count integer;
begin
  select count(*) into legacy_count from public.account_accounts where account_origin = 'legacy';
  select count(*) into mapping_count from public.account_legacy_mappings where effective_to is null;
  if legacy_count <> mapping_count then
    raise exception 'LEGACY_MAPPING_INVENTORY_INCOMPLETE: accounts %, mappings %', legacy_count, mapping_count;
  end if;
  if exists (
    select 1 from public.account_legacy_mappings mapping
    join public.account_accounts account on account.id = mapping.legacy_account_id
    where mapping.tenant_id <> account.tenant_id
  ) then
    raise exception 'CROSS_TENANT_LEGACY_MAPPING_DETECTED';
  end if;
end
$$;

comment on table public.account_legacy_mappings is
  'Versioned, tenant-safe Phase 2.5B assessment inventory. It classifies legacy accounts without changing ledger history or enabling cutover.';
comment on column public.account_legacy_mappings.canonical_semantic_key is
  'Canonical reporting concept when evidence is sufficient; not an account code and not a provisioned tenant account.';
comment on column public.account_legacy_mappings.evidence is
  'Auditable evidence snapshot captured at assessment time, including ledger and dependency observations.';
comment on column public.account_legacy_mappings.disposition is
  'Target disposition only. DEPRECATE and SPLIT_FUTURE do not enforce operational cutover.';

commit;
