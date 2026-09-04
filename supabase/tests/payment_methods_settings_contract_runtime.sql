begin;

create temporary table phase3a_context as
select owner.tenant_id, owner.auth_user_id owner_auth
from public.tenant_users owner
where owner.role = 'owner' and owner.is_active and owner.auth_user_id is not null
  and exists (
    select 1 from public.financial_payment_method_settlement_configs configuration
    where configuration.tenant_id = owner.tenant_id and configuration.is_active
  )
  and exists (
    select 1 from public.account_groups account_group
    where account_group.tenant_id = owner.tenant_id
      and account_group.template_group_key = 'liquidity_resources'
  )
order by owner.created_at
limit 1;

do $$ begin
  if not exists (select 1 from phase3a_context) then
    raise exception 'PHASE3A_ROLLBACK_CONTEXT_MISSING';
  end if;
end $$;

create temporary table phase3a_financial_baseline as
select
  (select count(*) from public.account_moves) move_count,
  (select count(*) from public.account_move_lines) line_count,
  (select count(*) from public.account_partial_reconcile) reconcile_count,
  (select coalesce(sum(debit), 0) from public.account_move_lines) total_debit,
  (select coalesce(sum(credit), 0) from public.account_move_lines) total_credit,
  (select count(*) from (
    select move_id from public.account_move_lines
    group by move_id having sum(debit) <> sum(credit)
  ) unbalanced) unbalanced_count;

grant select on phase3a_context, phase3a_financial_baseline to authenticated;

select set_config('request.jwt.claim.sub', owner_auth::text, true) from phase3a_context;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  context phase3a_context%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 16);
  cash_destination jsonb;
  bank_destination jsonb;
  wallet_destination jsonb;
  cash_method jsonb;
  bank_method jsonb;
  wallet_method jsonb;
  card_method jsonb;
  replay jsonb;
  option_key text;
  readiness jsonb;
begin
  select * into context from phase3a_context;

  cash_destination := public.create_and_provision_money_destination(
    context.tenant_id, 'phase3a_cash_' || suffix, 'Phase 3A Cashbox', 'cashbox',
    null, null, null, null, null, null, '{}'::jsonb, true
  );
  bank_destination := public.create_and_provision_money_destination(
    context.tenant_id, 'phase3a_bank_' || suffix, 'Phase 3A Bank', 'bank',
    null, null, null, 'Phase 3A Bank', 'Rollback account', '••31', '{}'::jsonb, true
  );
  wallet_destination := public.create_and_provision_money_destination(
    context.tenant_id, 'phase3a_wallet_' || suffix, 'Phase 3A Wallet', 'wallet',
    null, null, null, null, null, null, '{}'::jsonb, true
  );

  cash_method := public.create_financial_payment_method_for_settings(
    context.tenant_id, 'Phase 3A Cash', 'cash', 'direct', 'phase3a-cash-' || suffix, null
  );
  bank_method := public.create_financial_payment_method_for_settings(
    context.tenant_id, 'Phase 3A Bank Transfer', 'bank_transfer', 'direct', 'phase3a-bank-' || suffix, null
  );
  wallet_method := public.create_financial_payment_method_for_settings(
    context.tenant_id, 'Phase 3A Wallet', 'wallet', 'direct', 'phase3a-wallet-' || suffix, null
  );

  if exists (
    select 1 from public.financial_payment_methods method
    where method.id in (
      (cash_method->>'payment_method_id')::uuid,
      (bank_method->>'payment_method_id')::uuid,
      (wallet_method->>'payment_method_id')::uuid
    ) and method.settlement_mode <> 'direct'
  ) then raise exception 'DIRECT_METHOD_MODE_INVALID'; end if;
  if exists (
    select 1 from public.financial_payment_method_settlement_configs configuration
    where configuration.payment_method_id in (
      (cash_method->>'payment_method_id')::uuid,
      (bank_method->>'payment_method_id')::uuid,
      (wallet_method->>'payment_method_id')::uuid
    )
  ) then raise exception 'DIRECT_METHOD_PERSISTED_CONFIGURATION'; end if;

  replay := public.create_financial_payment_method_for_settings(
    context.tenant_id, 'Phase 3A Cash', 'cash', 'direct', 'phase3a-cash-' || suffix, null
  );
  if replay->>'payment_method_id' <> cash_method->>'payment_method_id'
     or not (replay->>'idempotent_replay')::boolean then
    raise exception 'PAYMENT_METHOD_SAME_KEY_REPLAY_FAILED';
  end if;
  if (select count(*) from public.financial_payment_methods
         where tenant_id = context.tenant_id
           and id = (cash_method->>'payment_method_id')::uuid) <> 1 then
    raise exception 'PAYMENT_METHOD_IDEMPOTENCY_CREATED_MULTIPLE_ROWS';
  end if;
  begin
    perform public.create_financial_payment_method_for_settings(
      context.tenant_id, 'Different payload', 'cash', 'direct', 'phase3a-cash-' || suffix, null
    );
    raise exception 'PAYMENT_METHOD_PAYLOAD_MISMATCH_ACCEPTED';
  exception when unique_violation then
    if sqlerrm <> 'PAYMENT_METHOD_IDEMPOTENCY_PAYLOAD_MISMATCH' then raise; end if;
  end;

  if not exists (
    select 1 from public.list_allowed_payment_destinations(
      context.tenant_id, (cash_method->>'payment_method_id')::uuid,
      'financial.payment.create', 'initiate', null
    ) allowed
    where allowed.destination_id = (cash_destination->>'destination_id')::uuid
  ) then raise exception 'COMPATIBLE_CASH_DESTINATION_NOT_RESOLVED'; end if;
  if exists (
    select 1 from public.list_allowed_payment_destinations(
      context.tenant_id, (cash_method->>'payment_method_id')::uuid,
      'financial.payment.create', 'initiate', null
    ) allowed
    where allowed.destination_id = (bank_destination->>'destination_id')::uuid
  ) then raise exception 'INCOMPATIBLE_DESTINATION_WAS_ALLOWED'; end if;

  perform public.set_money_destination_status(
    context.tenant_id, (cash_destination->>'destination_id')::uuid, 'inactive'
  );
  if exists (
    select 1 from public.list_allowed_payment_destinations(
      context.tenant_id, (cash_method->>'payment_method_id')::uuid,
      'financial.payment.create', 'initiate', null
    ) allowed
    where allowed.destination_id = (cash_destination->>'destination_id')::uuid
  ) then raise exception 'INACTIVE_DESTINATION_WAS_ALLOWED'; end if;
  perform public.set_money_destination_status(
    context.tenant_id, (cash_destination->>'destination_id')::uuid, 'active'
  );

  select configuration_key into option_key
  from public.list_financial_payment_method_clearing_options(context.tenant_id)
  order by configuration_key limit 1;
  if option_key is null then raise exception 'CLEARING_SAFE_OPTION_MISSING'; end if;
  card_method := public.create_financial_payment_method_for_settings(
    context.tenant_id, 'Phase 3A Card', 'card', 'clearing',
    'phase3a-card-' || suffix, option_key
  );
  if not exists (
    select 1 from public.financial_payment_method_settlement_configs configuration
    where configuration.tenant_id = context.tenant_id
      and configuration.payment_method_id = (card_method->>'payment_method_id')::uuid
      and configuration.is_active
  ) or not public.is_financial_payment_method_usable(
    context.tenant_id, (card_method->>'payment_method_id')::uuid
  ) then raise exception 'ATOMIC_CLEARING_CONFIGURATION_FAILED'; end if;

  begin
    perform public.create_financial_payment_method_for_settings(
      context.tenant_id, 'Invalid Card', 'card', 'clearing',
      'phase3a-invalid-card-' || suffix, null
    );
    raise exception 'CLEARING_WITHOUT_CONFIGURATION_ACCEPTED';
  exception when check_violation then
    if sqlerrm <> 'PAYMENT_METHOD_CLEARING_CONFIGURATION_INVALID' then raise; end if;
  end;
  begin
    perform public.create_financial_payment_method_for_settings(
      context.tenant_id, 'Unknown Card Configuration', 'card', 'clearing',
      'phase3a-unknown-card-' || suffix, repeat('0', 64)
    );
    raise exception 'UNKNOWN_CLEARING_CONFIGURATION_ACCEPTED';
  exception when check_violation then
    if sqlerrm <> 'PAYMENT_METHOD_CLEARING_CONFIGURATION_INVALID' then raise; end if;
  end;
  begin
    perform public.create_financial_payment_method_for_settings(
      context.tenant_id, 'Cheque', 'cheque', 'direct', 'phase3a-cheque-' || suffix, null
    );
    raise exception 'CHEQUE_SETTINGS_CREATION_ACCEPTED';
  exception when check_violation then
    if sqlerrm <> 'PAYMENT_METHOD_TYPE_NOT_AVAILABLE_IN_SETTINGS' then raise; end if;
  end;
  begin
    perform public.create_financial_payment_method_for_settings(
      context.tenant_id, 'Wrong mode', 'cash', 'clearing', 'phase3a-wrong-mode-' || suffix, option_key
    );
    raise exception 'INVALID_SETTLEMENT_MODE_ACCEPTED';
  exception when check_violation then
    if sqlerrm <> 'PAYMENT_METHOD_SETTLEMENT_MODE_INVALID' then raise; end if;
  end;
  begin
    perform public.create_financial_payment_method_for_settings(
      gen_random_uuid(), 'Cross tenant', 'cash', 'direct', 'phase3a-cross-' || suffix, null
    );
    raise exception 'CROSS_TENANT_CREATE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;

  perform public.rename_financial_payment_method(
    context.tenant_id, (cash_method->>'payment_method_id')::uuid, 'Phase 3A Cash Renamed'
  );
  perform public.set_financial_payment_method_status(
    context.tenant_id, (cash_method->>'payment_method_id')::uuid, false
  );
  perform public.set_financial_payment_method_status(
    context.tenant_id, (cash_method->>'payment_method_id')::uuid, true
  );
  if (select count(*) from public.financial_payment_method_events
      where payment_method_id = (cash_method->>'payment_method_id')::uuid) < 3 then
    raise exception 'PAYMENT_METHOD_LIFECYCLE_AUDIT_INCOMPLETE';
  end if;

  readiness := public.get_financial_readiness(context.tenant_id);
  if not (readiness->>'payment_methods_ready')::boolean then
    raise exception 'PAYMENT_METHOD_READINESS_NOT_UPDATED';
  end if;
end
$$;

do $$
declare context phase3a_context%rowtype;
begin
  select * into context from phase3a_context;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.rename_financial_payment_method(
      context.tenant_id,
      (select id from public.financial_payment_methods where tenant_id = context.tenant_id limit 1),
      'Unauthorized rename'
    );
    raise exception 'UNAUTHORIZED_RENAME_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;

do $$
declare baseline phase3a_financial_baseline%rowtype;
begin
  select * into baseline from phase3a_financial_baseline;
  if (select count(*) from public.account_moves) <> baseline.move_count
     or (select count(*) from public.account_move_lines) <> baseline.line_count
     or (select count(*) from public.account_partial_reconcile) <> baseline.reconcile_count
     or (select coalesce(sum(debit), 0) from public.account_move_lines) <> baseline.total_debit
     or (select coalesce(sum(credit), 0) from public.account_move_lines) <> baseline.total_credit
     or (select count(*) from (
       select move_id from public.account_move_lines
       group by move_id having sum(debit) <> sum(credit)
     ) unbalanced) <> baseline.unbalanced_count then
    raise exception 'PHASE3A_CHANGED_FINANCIAL_LEDGER';
  end if;
end
$$;

rollback;
