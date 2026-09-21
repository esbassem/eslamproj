begin;

-- Employee custody is company cash held by a responsible employee, not an
-- employee receivable. Fail closed if Production started using the old policy.
do $$
begin
  if exists (
    select 1 from public.money_destinations destination
    where destination.destination_type = 'employee_cash_custody'
  ) or exists (
    select 1 from public.account_accounts account
    join public.money_destinations destination
      on destination.id = account.money_destination_id
     and destination.tenant_id = account.tenant_id
    where destination.destination_type = 'employee_cash_custody'
  ) then
    raise exception using errcode = '23514',
      message = 'EMPLOYEE_CASH_CUSTODY_CLASSIFICATION_CHANGE_REQUIRES_EXPLICIT_DATA_MIGRATION';
  end if;
end
$$;

update public.money_destination_types
set required_account_type = 'liquidity',
    required_reporting_category = 'cash_and_cash_equivalents',
    required_open_item_reconcile = false,
    required_statement_reconcile = false,
    required_journal_type = 'cash',
    account_group_key = 'liquidity_resources',
    account_code_min = 111500,
    account_code_max = 111599
where code = 'employee_cash_custody';

-- Published chart content is immutable. Version 2 is a corrected copy of v1.
insert into public.canonical_chart_templates (
  template_key, version, name, description, status
)
select template_key, 2, 'General Trading — Canonical Chart v2',
  'General-purpose accrual accounting chart. Employee cash custody is classified as company liquidity held by an accountable employee.',
  'draft'
from public.canonical_chart_templates
where template_key = 'general_trading' and version = 1;

insert into public.canonical_chart_template_groups (
  template_id, group_key, parent_group_key, name,
  suggested_code_prefix, sort_order, required
)
select target.id, source.group_key, source.parent_group_key, source.name,
  source.suggested_code_prefix, source.sort_order, source.required
from public.canonical_chart_template_groups source
join public.canonical_chart_templates original
  on original.id = source.template_id
 and original.template_key = 'general_trading' and original.version = 1
join public.canonical_chart_templates target
  on target.template_key = 'general_trading' and target.version = 2;

insert into public.canonical_chart_template_accounts (
  template_id, template_account_key, group_key, name, suggested_code,
  canonical_account_type, statement_section, reporting_category,
  normal_balance, pnl_category, open_item_reconcile,
  statement_reconcile, provisioning_policy, feature_key, functional_role,
  sort_order
)
select target.id, source.template_account_key, source.group_key, source.name,
  source.suggested_code, source.canonical_account_type, source.statement_section,
  source.reporting_category, source.normal_balance, source.pnl_category,
  source.open_item_reconcile, source.statement_reconcile,
  source.provisioning_policy, source.feature_key, source.functional_role,
  source.sort_order
from public.canonical_chart_template_accounts source
join public.canonical_chart_templates original
  on original.id = source.template_id
 and original.template_key = 'general_trading' and original.version = 1
join public.canonical_chart_templates target
  on target.template_key = 'general_trading' and target.version = 2;

update public.canonical_chart_template_accounts account
set group_key = 'liquidity_resources',
    suggested_code = '111500',
    canonical_account_type = 'liquidity',
    reporting_category = 'cash_and_cash_equivalents',
    open_item_reconcile = false,
    statement_reconcile = false
from public.canonical_chart_templates template
where template.id = account.template_id
  and template.template_key = 'general_trading' and template.version = 2
  and account.template_account_key = 'employee_cash_custody';

update public.canonical_chart_templates
set status = 'retired'
where template_key = 'general_trading' and version = 1 and status = 'active';

update public.canonical_chart_templates
set status = 'active'
where template_key = 'general_trading' and version = 2;

alter table public.financial_payments
  add column accounting_state text not null default 'unposted',
  add constraint financial_payments_accounting_state_check
    check (accounting_state in ('unposted', 'posted', 'reversed'));

create table public.financial_payment_accounting_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  payment_id uuid not null,
  account_move_id uuid not null,
  entry_type text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint financial_payment_accounting_links_payment_fkey
    foreign key (payment_id, tenant_id)
    references public.financial_payments(id, tenant_id) on delete restrict,
  constraint financial_payment_accounting_links_move_fkey
    foreign key (account_move_id, tenant_id)
    references public.account_moves(id, tenant_id) on delete restrict,
  constraint financial_payment_accounting_links_created_by_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_payment_accounting_links_entry_type_check
    check (entry_type in ('posting', 'reversal', 'clearing')),
  constraint financial_payment_accounting_links_unique
    unique (tenant_id, payment_id, account_move_id, entry_type)
);

create index financial_payment_accounting_links_payment_idx
  on public.financial_payment_accounting_links
  (tenant_id, payment_id, created_at, id);
create unique index financial_payment_accounting_links_move_role_uidx
  on public.financial_payment_accounting_links
  (tenant_id, account_move_id, entry_type);

create or replace function public.guard_financial_payment_accounting_state()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.accounting_state <> 'unposted' then
      raise exception using errcode = '23514',
        message = 'FINANCIAL_PAYMENT_MUST_START_UNPOSTED';
    end if;
    return new;
  end if;
  if new.accounting_state is distinct from old.accounting_state then
    raise exception using errcode = '42501',
      message = 'FINANCIAL_PAYMENT_ACCOUNTING_STATE_REQUIRES_POSTING_CONTRACT';
  end if;
  return new;
end
$$;

create trigger financial_payments_accounting_boundary_guard
before insert or update of accounting_state on public.financial_payments
for each row execute function public.guard_financial_payment_accounting_state();

create or replace function public.guard_financial_payment_accounting_link()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = '42501',
    message = 'FINANCIAL_PAYMENT_ACCOUNTING_LINK_REQUIRES_POSTING_CONTRACT';
end
$$;

create trigger financial_payment_accounting_links_boundary_guard
before insert or update or delete on public.financial_payment_accounting_links
for each row execute function public.guard_financial_payment_accounting_link();

create or replace function public.reverse_financial_payment(
  p_tenant_id uuid, p_payment_id uuid, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payment public.financial_payments%rowtype;
  actor_id uuid := public.current_tenant_user_id();
  reason text := nullif(btrim(p_reason), '');
begin
  select * into payment from public.financial_payments item
  where item.id = p_payment_id and item.tenant_id = p_tenant_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'FINANCIAL_PAYMENT_NOT_FOUND';
  end if;
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.payment.reverse', null, null,
    payment.branch_id, payment.status = 'confirmed'
  );
  if payment.status <> 'confirmed' then
    raise exception using errcode = '23514', message = 'FINANCIAL_PAYMENT_REVERSE_STATE_INVALID';
  end if;
  if payment.accounting_state <> 'unposted' then
    raise exception using errcode = '23514',
      message = 'POSTED_FINANCIAL_PAYMENT_REQUIRES_ACCOUNTING_REVERSAL_CONTRACT';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'FINANCIAL_PAYMENT_REVERSAL_REASON_REQUIRED';
  end if;
  update public.financial_payments
  set status = 'reversed', reversed_by = actor_id,
      reversed_at = now(), reversal_reason = reason
  where id = payment.id;
  insert into public.financial_payment_events (
    tenant_id, payment_id, event_type, from_status,
    to_status, actor_user_id, reason, metadata
  ) values (
    p_tenant_id, payment.id, 'reversed', 'confirmed',
    'reversed', actor_id, reason,
    jsonb_build_object('accounting_state', payment.accounting_state)
  );
  return jsonb_build_object(
    'payment_id', payment.id, 'status', 'reversed',
    'accounting_state', payment.accounting_state, 'ledger_effect', false
  );
end
$$;

alter table public.financial_payment_accounting_links enable row level security;
revoke all on public.financial_payment_accounting_links from public, anon, authenticated;
grant select on public.financial_payment_accounting_links to authenticated;

create policy financial_payment_accounting_links_read
on public.financial_payment_accounting_links for select to authenticated
using (
  financial_payment_accounting_links.tenant_id = public.current_tenant_id()
  and exists (
    select 1 from public.financial_payments payment
    where payment.id = financial_payment_accounting_links.payment_id
      and payment.tenant_id = financial_payment_accounting_links.tenant_id
  )
);

comment on column public.financial_payments.status is
  'Operational lifecycle only. Confirmed means the payment fact was operationally verified; it does not mean posted, allocated, reconciled or invoice-paid.';
comment on column public.financial_payments.accounting_state is
  'Independent ledger representation state. Phase 4B.1 permits only unposted; future posted/reversed transitions require a central accounting contract.';
comment on table public.financial_payment_accounting_links is
  'Future many-move accounting linkage for posting, reversal and clearing stages. Phase 4B.1 rejects all mutations and creates no links.';
comment on table public.financial_payment_events is
  'Immutable operational payment lifecycle history; it is not an accounting posting or allocation log.';
comment on function public.reverse_financial_payment(uuid, uuid, text) is
  'Operational reversal for unposted payments only. Posted payments fail closed until an accounting reversal contract exists.';
comment on column public.money_destination_types.required_open_item_reconcile is
  'Open-item matching follows account substance. Employee cash custody is liquidity and is not an employee receivable.';

commit;
