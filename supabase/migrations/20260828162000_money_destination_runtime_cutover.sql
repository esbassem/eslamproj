begin;

create or replace function public.list_allowed_money_destinations(
  p_tenant_id uuid,
  p_permission_code text,
  p_access_type text,
  p_branch_id uuid default null,
  p_destination_types text[] default null
)
returns table (
  destination_id uuid,
  destination_key text,
  destination_name text,
  destination_type text,
  branch_id uuid,
  responsible_user_id uuid,
  ledger_account_id uuid,
  journal_id uuid,
  is_own_custody boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select destination.id, destination.destination_key, destination.name,
    destination.destination_type, destination.branch_id,
    destination.responsible_user_id, destination.ledger_account_id,
    destination.journal_id,
    destination.destination_type = 'employee_cash_custody'
      and destination.responsible_user_id = public.current_tenant_user_id()
  from public.money_destinations destination
  join public.account_accounts account
    on account.id = destination.ledger_account_id
   and account.tenant_id = destination.tenant_id
   and account.money_destination_id = destination.id
   and account.account_origin = 'resource'
   and account.active and account.is_posting
  join public.account_journals journal
    on journal.id = destination.journal_id
   and journal.tenant_id = destination.tenant_id
   and journal.money_destination_id = destination.id
   and journal.journal_origin = 'resource'
   and journal.default_account_id = account.id
   and journal.is_active
  where destination.tenant_id = p_tenant_id
    and destination.status = 'active'
    and public.current_tenant_id() = p_tenant_id
    and p_permission_code like 'financial.%'
    and p_access_type in (
      'view', 'initiate', 'confirm', 'pay_out',
      'transfer_from', 'transfer_to', 'reconcile'
    )
    and (p_destination_types is null
      or destination.destination_type = any(p_destination_types))
    and (p_branch_id is null or destination.branch_id is null
      or destination.branch_id = p_branch_id)
    and public.can_perform_financial_action(
      p_tenant_id, p_permission_code, account.id, p_access_type,
      coalesce(p_branch_id, destination.branch_id), true
    )
  order by
    (destination.destination_type = 'employee_cash_custody'
      and destination.responsible_user_id = public.current_tenant_user_id()) desc,
    destination.name, destination.id
$$;

create or replace function public.get_money_destination_selection(
  p_tenant_id uuid,
  p_permission_code text,
  p_access_type text,
  p_branch_id uuid default null,
  p_destination_types text[] default null
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with allowed as materialized (
    select * from public.list_allowed_money_destinations(
      p_tenant_id, p_permission_code, p_access_type,
      p_branch_id, p_destination_types
    )
  ), summary as (
    select count(*)::integer allowed_count,
      (array_agg(destination_id order by destination_id))[1] single_id
    from allowed
  )
  select jsonb_build_object(
    'allowed_count', summary.allowed_count,
    'selection_state', case summary.allowed_count
      when 0 then 'none' when 1 then 'single' else 'multiple' end,
    'auto_selected_destination_id', case when summary.allowed_count = 1
      then summary.single_id else null end,
    'reason', case when summary.allowed_count = 0
      then 'NO_ALLOWED_MONEY_DESTINATION' else null end,
    'destinations', coalesce((select jsonb_agg(to_jsonb(item)
      order by item.is_own_custody desc, item.destination_name, item.destination_id)
      from allowed item), '[]'::jsonb)
  ) from summary
$$;

create or replace function public.resolve_money_destination_for_action(
  p_tenant_id uuid,
  p_destination_id uuid,
  p_permission_code text,
  p_access_type text,
  p_branch_id uuid default null,
  p_destination_types text[] default null
)
returns table (
  destination_id uuid,
  destination_name text,
  destination_type text,
  destination_branch_id uuid,
  ledger_account_id uuid,
  journal_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  select allowed.destination_id, allowed.destination_name,
    allowed.destination_type, allowed.branch_id,
    allowed.ledger_account_id, allowed.journal_id
  from public.list_allowed_money_destinations(
    p_tenant_id, p_permission_code, p_access_type,
    p_branch_id, p_destination_types
  ) allowed
  where allowed.destination_id = p_destination_id;
  if not found then
    raise exception using errcode = '42501', message = 'MONEY_DESTINATION_NOT_ALLOWED_FOR_ACTION';
  end if;
end
$$;

create or replace function public.settle_showroom_sale_balance_to_destination(
  p_sale_id uuid,
  p_amount numeric,
  p_money_destination_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.tenant_users%rowtype;
  sale public.showroom_sales%rowtype;
  sale_move_id uuid;
  receivable_account_id uuid;
  destination record;
  invoice_line_id uuid;
  settlement_move_id uuid := gen_random_uuid();
  settlement_receivable_line_id uuid := gen_random_uuid();
  amount_to_settle numeric := round(coalesce(p_amount, 0), 2);
  paid_amount numeric := 0;
  remaining_amount numeric := 0;
  effective_branch_id uuid;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  if amount_to_settle <= 0 then raise exception using errcode = '22023', message = 'SETTLEMENT_AMOUNT_MUST_BE_POSITIVE'; end if;
  if p_money_destination_id is null then raise exception using errcode = '22023', message = 'MONEY_DESTINATION_REQUIRED'; end if;

  select * into sale from public.showroom_sales
  where id = p_sale_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'SHOWROOM_SALE_NOT_FOUND'; end if;
  if sale.status <> 'confirmed' then
    raise exception using errcode = '23514', message = 'SHOWROOM_SALE_NOT_SETTLEABLE';
  end if;
  select tenant_user.* into actor from public.tenant_users tenant_user
  where tenant_user.auth_user_id = auth.uid()
    and tenant_user.tenant_id = sale.tenant_id and tenant_user.is_active
  order by tenant_user.created_at, tenant_user.id limit 1;
  if not found then raise exception using errcode = '42501', message = 'ACTIVE_TENANT_MEMBERSHIP_REQUIRED'; end if;

  effective_branch_id := sale.branch_id;
  if effective_branch_id is null then
    select config.branch_id into effective_branch_id
    from public.showroom_configs config
    where config.id = sale.showroom_config_id and config.tenant_id = sale.tenant_id;
  end if;

  select * into destination
  from public.resolve_money_destination_for_action(
    sale.tenant_id, p_money_destination_id,
    'financial.payment.create', 'initiate', effective_branch_id, null
  );

  receivable_account_id := public.resolve_functional_account(
    sale.tenant_id, 'customer_receivable', effective_branch_id
  );
  select move.id into sale_move_id from public.account_moves move
  where move.tenant_id = sale.tenant_id and move.move_type = 'sale'
    and move.state = 'posted'
    and (move.id = sale.account_move_id or move.ref = 'showroom_sale:' || sale.id)
  order by (move.id = sale.account_move_id) desc, move.created_at limit 1;
  if sale_move_id is null then raise exception using errcode = '23514', message = 'POSTED_SALE_MOVE_NOT_FOUND'; end if;

  select line.id into invoice_line_id from public.account_move_lines line
  where line.tenant_id = sale.tenant_id and line.move_id = sale_move_id
    and line.account_id = receivable_account_id and line.debit > 0
  order by line.debit desc limit 1 for update;
  if invoice_line_id is null then raise exception using errcode = '23514', message = 'SALE_RECEIVABLE_LINE_NOT_FOUND'; end if;

  select round(coalesce(sum(reconcile.amount), 0), 2) into paid_amount
  from public.account_partial_reconcile reconcile
  where reconcile.tenant_id = sale.tenant_id and reconcile.debit_move_id = invoice_line_id;
  remaining_amount := round(greatest(coalesce(sale.total_amount, 0) - paid_amount, 0), 2);
  if remaining_amount <= 0 then raise exception using errcode = '23514', message = 'SALE_ALREADY_SETTLED'; end if;
  if amount_to_settle > remaining_amount then raise exception using errcode = '23514', message = 'SETTLEMENT_EXCEEDS_RESIDUAL'; end if;

  insert into public.account_moves (
    id, tenant_id, branch_id, journal_id, name, move_type, partner_id,
    invoice_date, date, amount_total, state, ref, notes,
    pay_method, currency_code, created_by
  ) values (
    settlement_move_id, sale.tenant_id, effective_branch_id, destination.journal_id,
    'DESTINATION-RECEIPT-' || upper(left(replace(settlement_move_id::text, '-', ''), 12)),
    'cash_in', sale.customer_id, current_date, now(), amount_to_settle,
    'posted', 'showroom_sale:' || sale.id,
    nullif(btrim(coalesce(p_notes, '')), ''), 'destination_receipt', 'EGP', actor.id
  );
  insert into public.account_move_lines (
    id, tenant_id, move_id, account_id, partner_id, label, quantity,
    unit_price, debit, credit, line_type, is_reconciled,
    amount_residual, amount_residual_currency, parent_state,
    currency_code, created_by
  ) values
    (gen_random_uuid(), sale.tenant_id, settlement_move_id,
      destination.ledger_account_id, null,
      'تحصيل إلى ' || destination.destination_name, 1, amount_to_settle,
      amount_to_settle, 0, 'liquidity', true, 0, 0, 'posted', 'EGP', actor.id),
    (settlement_receivable_line_id, sale.tenant_id, settlement_move_id,
      receivable_account_id, sale.customer_id, 'تسوية ذمم فاتورة شو روم',
      1, amount_to_settle, 0, amount_to_settle, 'receivable',
      true, 0, 0, 'posted', 'EGP', actor.id);
  insert into public.account_partial_reconcile (
    tenant_id, debit_move_id, credit_move_id, amount, max_date, created_by
  ) values (
    sale.tenant_id, invoice_line_id, settlement_receivable_line_id,
    amount_to_settle, current_date, actor.id
  );

  paid_amount := round(paid_amount + amount_to_settle, 2);
  remaining_amount := round(greatest(sale.total_amount - paid_amount, 0), 2);
  update public.showroom_sales set account_move_id = sale_move_id,
    updated_at = now() where id = sale.id;

  return jsonb_build_object(
    'success', true, 'sale_id', sale.id,
    'settlement_move_id', settlement_move_id,
    'money_destination_id', destination.destination_id,
    'money_destination_name', destination.destination_name,
    'amount', amount_to_settle,
    'accounting_paid_amount', paid_amount,
    'accounting_remaining_amount', remaining_amount
  );
end
$$;

revoke all on function public.list_allowed_money_destinations(uuid,text,text,uuid,text[]) from public, anon;
revoke all on function public.get_money_destination_selection(uuid,text,text,uuid,text[]) from public, anon;
revoke all on function public.resolve_money_destination_for_action(uuid,uuid,text,text,uuid,text[]) from public, anon, authenticated;
revoke all on function public.settle_showroom_sale_balance_to_destination(uuid,numeric,uuid,text) from public, anon;
grant execute on function public.list_allowed_money_destinations(uuid,text,text,uuid,text[]) to authenticated;
grant execute on function public.get_money_destination_selection(uuid,text,text,uuid,text[]) to authenticated;
grant execute on function public.settle_showroom_sale_balance_to_destination(uuid,numeric,uuid,text) to authenticated;

comment on function public.settle_showroom_sale_balance(uuid,numeric,text,uuid,text) is
  'LEGACY RUNTIME ADAPTER: accepts/infer legacy ledger accounts for existing tenants with no Money Destinations. Canonical callers use settle_showroom_sale_balance_to_destination.';
comment on function public.settle_showroom_sale_balance_to_destination(uuid,numeric,uuid,text) is
  'Canonical Phase 3C Showroom settlement: accepts only Money Destination identity and resolves authorized account/journal server-side.';

commit;
