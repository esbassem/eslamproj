begin;

-- F10A-01: settlement numbers are an internal implementation detail.
alter table public.financial_settlement_sequences enable row level security;
revoke all on table public.financial_settlement_sequences from public, anon, authenticated;
revoke all on function public.next_financial_settlement_number(uuid) from public, anon, authenticated;

-- F10A-02: account master data is readable by tenant RLS, but never directly mutable.
revoke insert, update, delete, truncate on table public.account_accounts from anon, authenticated;
drop policy if exists phase1_tenant_member_all on public.account_accounts;
drop policy if exists account_accounts_tenant_read on public.account_accounts;
create policy account_accounts_tenant_read
  on public.account_accounts for select to authenticated
  using (public.is_tenant_member(tenant_id));

create or replace function public.create_temporary_account(
  p_tenant_id uuid,
  p_group_id uuid,
  p_code text,
  p_name text,
  p_account_type text,
  p_reconcile boolean default true,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved public.account_accounts%rowtype;
  clean_code text := nullif(btrim(p_code), '');
  clean_name text := nullif(btrim(p_name), '');
begin
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.journal.manage', null, null, null, true
  );
  if clean_code is null or clean_name is null then
    raise exception using errcode = '23514', message = 'TEMPORARY_ACCOUNT_CODE_AND_NAME_REQUIRED';
  end if;
  if not exists (
    select 1 from public.account_groups
    where id = p_group_id and tenant_id = p_tenant_id and code = 'TEMP'
  ) then
    raise exception using errcode = '23514', message = 'TEMPORARY_ACCOUNT_GROUP_INVALID';
  end if;
  if not exists (
    select 1 from public.account_accounts
    where tenant_id = p_tenant_id and account_type = p_account_type
  ) then
    raise exception using errcode = '23514', message = 'TEMPORARY_ACCOUNT_TYPE_INVALID';
  end if;
  insert into public.account_accounts(
    tenant_id, group_id, code, name, account_type, reconcile,
    open_item_reconcile, active, responsible_user_id, account_origin
  ) values (
    p_tenant_id, p_group_id, clean_code, clean_name, p_account_type,
    coalesce(p_reconcile, true), coalesce(p_reconcile, true),
    coalesce(p_active, true), null, 'manual'
  ) returning * into saved;
  return jsonb_build_object(
    'id', saved.id, 'group_id', saved.group_id, 'code', saved.code,
    'name', saved.name, 'account_type', saved.account_type,
    'reconcile', saved.reconcile, 'active', saved.active
  );
end
$$;
revoke all on function public.create_temporary_account(uuid,uuid,text,text,text,boolean,boolean) from public, anon;
grant execute on function public.create_temporary_account(uuid,uuid,text,text,text,boolean,boolean) to authenticated;

-- F10A-03: one read-only validator is consumed by eligibility and execution.
create or replace function public.resolve_financial_settlement_context(
  p_tenant uuid, p_method uuid, p_items jsonb, p_destination uuid,
  p_gross numeric, p_fees numeric, p_net numeric, p_currency text,
  p_branch uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  cfg public.financial_payment_method_settlement_configs%rowtype;
  item jsonb;
  candidate record;
  selected_gross numeric := 0;
  line_id uuid;
  requested numeric;
  seen uuid[] := '{}';
  destination record;
begin
  if public.current_tenant_id() is distinct from p_tenant then
    raise exception using errcode = '42501', message = 'SETTLEMENT_TENANT_ACCESS_DENIED';
  end if;
  perform public.assert_financial_authorized(
    p_tenant, 'financial.settlement.create', null, null, p_branch, true
  );
  if p_currency is null or btrim(p_currency) = '' then
    raise exception using errcode = '23514', message = 'SETTLEMENT_CURRENCY_REQUIRED';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or p_gross is null or p_gross <= 0 or p_fees is null or p_fees < 0
     or p_net is null or p_net <= 0 or p_gross <> p_net + p_fees then
    raise exception using errcode = '23514', message = 'SETTLEMENT_AMOUNT_MISMATCH';
  end if;
  if not exists (
    select 1 from public.financial_payment_methods
    where id = p_method and tenant_id = p_tenant and is_active
      and settlement_mode = 'clearing'
  ) then
    raise exception using errcode = '23514', message = 'SETTLEMENT_METHOD_NOT_CLEARING';
  end if;
  select * into cfg
  from public.financial_payment_method_settlement_configs
  where tenant_id = p_tenant and payment_method_id = p_method and is_active;
  if not found or (cfg.branch_id is not null and cfg.branch_id is distinct from p_branch) then
    raise exception using errcode = '23514', message = 'SETTLEMENT_CONFIG_INVALID';
  end if;
  if not exists (
    select 1 from public.account_accounts
    where id = cfg.clearing_account_id and tenant_id = p_tenant and active
      and is_posting and open_item_reconcile
      and canonical_account_type in ('current_asset','receivable')
      and reporting_category = 'other_receivables'
  ) or not exists (
    select 1 from public.account_journals
    where id = cfg.clearing_journal_id and tenant_id = p_tenant and is_active
      and default_account_id = cfg.clearing_account_id
  ) then
    raise exception using errcode = '23514', message = 'SETTLEMENT_CONFIG_INVALID';
  end if;
  perform public.assert_financial_authorized(
    p_tenant, 'financial.settlement.create', cfg.clearing_account_id,
    'reconcile', p_branch, true
  );
  select * into destination from public.resolve_money_destination_for_action(
    p_tenant, p_destination, 'financial.settlement.create', 'reconcile',
    p_branch, array[cfg.destination_type]
  );
  if destination.journal_id is null then
    raise exception using errcode = '23514', message = 'SETTLEMENT_DESTINATION_JOURNAL_REQUIRED';
  end if;
  if p_fees > 0 and (cfg.fee_account_id is null or not exists (
    select 1 from public.account_accounts where id = cfg.fee_account_id
      and tenant_id = p_tenant and active and is_posting
      and canonical_account_type = 'expense'
      and reporting_category = 'operating_expenses'
  )) then
    raise exception using errcode = '23514', message = 'SETTLEMENT_FEE_ACCOUNT_REQUIRED';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    begin
      line_id := (item->>'clearing_line_id')::uuid;
      requested := (item->>'amount')::numeric;
    exception when others then
      raise exception using errcode = '23514', message = 'SETTLEMENT_ITEM_INVALID';
    end;
    if line_id = any(seen) then
      raise exception using errcode = '23514', message = 'SETTLEMENT_DUPLICATE_SOURCE_ITEM';
    end if;
    seen := array_append(seen, line_id);
    select q.* into candidate
    from public.list_settleable_clearing_items(
      p_tenant, p_method, upper(p_currency), p_branch
    ) q where q.clearing_line_id = line_id;
    if not found or requested is null or requested <= 0
       or requested > candidate.residual_amount
       or candidate.clearing_account_id <> cfg.clearing_account_id then
      raise exception using errcode = '23514', message = 'SETTLEMENT_ITEM_NOT_ELIGIBLE_OR_EXCEEDS_RESIDUAL';
    end if;
    selected_gross := selected_gross + requested;
  end loop;
  if selected_gross <> p_gross then
    raise exception using errcode = '23514', message = 'SETTLEMENT_ITEMS_GROSS_MISMATCH';
  end if;
  return jsonb_build_object(
    'eligible_at', statement_timestamp(), 'selected_gross', selected_gross,
    'config_id', cfg.id, 'clearing_account_id', cfg.clearing_account_id,
    'clearing_journal_id', cfg.clearing_journal_id,
    'fee_account_id', cfg.fee_account_id,
    'destination_id', p_destination, 'destination_account_id', destination.ledger_account_id,
    'destination_journal_id', destination.journal_id
  );
end
$$;
revoke all on function public.resolve_financial_settlement_context(uuid,uuid,jsonb,uuid,numeric,numeric,numeric,text,uuid) from public, anon, authenticated;

create or replace function public.get_financial_settlement_eligibility(
  p_tenant uuid, p_method uuid, p_items jsonb, p_destination uuid,
  p_gross numeric, p_fees numeric, p_net numeric, p_currency text,
  p_branch uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare context jsonb;
begin
  context := public.resolve_financial_settlement_context(
    p_tenant,p_method,p_items,p_destination,p_gross,p_fees,p_net,p_currency,p_branch
  );
  return context || jsonb_build_object(
    'eligible', true, 'blockers', '[]'::jsonb, 'gross_amount', p_gross,
    'fees_amount', p_fees, 'net_amount', p_net, 'currency_code', upper(p_currency),
    'payment_method_id', p_method, 'destination_id', p_destination
  );
exception when others then
  return jsonb_build_object(
    'eligible', false, 'eligible_at', statement_timestamp(),
    'blockers', jsonb_build_array(sqlerrm), 'gross_amount', p_gross,
    'fees_amount', p_fees, 'net_amount', p_net,
    'currency_code', upper(p_currency), 'payment_method_id', p_method,
    'destination_id', p_destination
  );
end
$$;

alter function public.create_financial_settlement(uuid,uuid,uuid,jsonb,numeric,numeric,numeric,text,date,text,uuid,text,text)
  rename to create_financial_settlement_validated_impl;
revoke all on function public.create_financial_settlement_validated_impl(uuid,uuid,uuid,jsonb,numeric,numeric,numeric,text,date,text,uuid,text,text) from public, anon, authenticated;

create function public.create_financial_settlement(
  p_tenant uuid, p_method uuid, p_destination uuid, p_items jsonb,
  p_gross numeric, p_fees numeric, p_net numeric, p_currency text,
  p_date date, p_idempotency text, p_branch uuid default null,
  p_reference text default null, p_external_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.resolve_financial_settlement_context(
    p_tenant,p_method,p_items,p_destination,p_gross,p_fees,p_net,p_currency,p_branch
  );
  return public.create_financial_settlement_validated_impl(
    p_tenant,p_method,p_destination,p_items,p_gross,p_fees,p_net,p_currency,
    p_date,p_idempotency,p_branch,p_reference,p_external_reference
  );
end
$$;
revoke all on function public.create_financial_settlement(uuid,uuid,uuid,jsonb,numeric,numeric,numeric,text,date,text,uuid,text,text) from public, anon;
grant execute on function public.create_financial_settlement(uuid,uuid,uuid,jsonb,numeric,numeric,numeric,text,date,text,uuid,text,text) to authenticated;

-- F10A-04: partner semantics are independent of direct versus clearing liquidity.
create or replace function public.assert_financial_payment_partner_role(
  p_tenant uuid, p_partner uuid, p_purpose text
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare purpose public.financial_payment_purposes%rowtype;
begin
  select * into purpose from public.financial_payment_purposes
  where code = p_purpose and is_active;
  if not found then
    raise exception using errcode = '23514', message = 'FINANCIAL_PAYMENT_PURPOSE_INVALID';
  end if;
  if purpose.requires_partner and p_partner is null then
    raise exception using errcode = '23514', message = 'PAYMENT_PARTNER_REQUIRED';
  end if;
  if p_partner is not null and not exists (
    select 1 from public.partners
    where id = p_partner and tenant_id = p_tenant
      and (
        purpose.partner_role is null
        or (purpose.partner_role = 'customer' and customer_rank > 0)
        or (purpose.partner_role = 'supplier' and supplier_rank > 0)
      )
  ) then
    raise exception using errcode = '23514', message = 'PARTNER_ROLE_MISMATCH';
  end if;
end
$$;
revoke all on function public.assert_financial_payment_partner_role(uuid,uuid,text) from public, anon, authenticated;

alter function public.post_financial_payment(uuid,uuid,text)
  rename to post_financial_payment_partner_validated_impl;
revoke all on function public.post_financial_payment_partner_validated_impl(uuid,uuid,text) from public, anon, authenticated;

create function public.post_financial_payment(
  p_tenant_id uuid, p_payment_id uuid, p_payment_purpose text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare payment public.financial_payments%rowtype;
begin
  select * into payment from public.financial_payments
  where id = p_payment_id and tenant_id = p_tenant_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'FINANCIAL_PAYMENT_NOT_FOUND';
  end if;
  perform public.assert_financial_payment_partner_role(
    p_tenant_id, payment.partner_id, p_payment_purpose
  );
  return public.post_financial_payment_partner_validated_impl(
    p_tenant_id, p_payment_id, p_payment_purpose
  );
end
$$;
revoke all on function public.post_financial_payment(uuid,uuid,text) from public, anon;
grant execute on function public.post_financial_payment(uuid,uuid,text) to authenticated;

commit;
