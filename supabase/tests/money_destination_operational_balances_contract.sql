begin;

do $$
declare
  v_tenant_id uuid;
  v_owner_auth_id uuid;
  v_destination_id uuid;
  expected_balance numeric;
  actual_balance numeric;
begin
  select destination.tenant_id, tenant_user.auth_user_id, destination.id
    into v_tenant_id, v_owner_auth_id, v_destination_id
  from public.money_destinations destination
  join public.tenant_users tenant_user
    on tenant_user.tenant_id = destination.tenant_id
   and tenant_user.role = 'owner'
   and tenant_user.is_active
   and tenant_user.auth_user_id is not null
  where destination.status = 'active'
  order by destination.created_at
  limit 1;

  if v_tenant_id is null then
    raise notice 'SKIP: no active destination owned by an active tenant owner';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_auth_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select round(coalesce(sum(line.debit - line.credit), 0), 2)
    into expected_balance
  from public.money_destinations destination
  left join public.account_move_lines line
    on line.tenant_id = destination.tenant_id
   and line.account_id = destination.ledger_account_id
   and line.parent_state = 'posted'
  where destination.id = v_destination_id
  group by destination.id;

  select balance into actual_balance
  from public.list_money_destination_operational_balances(
    v_tenant_id, 'financial.destination.manage', 'view', null, null
  ) result
  where result.destination_id = v_destination_id;

  if actual_balance is distinct from expected_balance then
    raise exception 'BALANCE_READ_MISMATCH expected %, got %', expected_balance, actual_balance;
  end if;

  update public.money_destinations set status = 'inactive' where id = v_destination_id;
  if exists (
    select 1 from public.list_money_destination_operational_balances(
      v_tenant_id, 'financial.destination.manage', 'view', null, null
    ) result where result.destination_id = v_destination_id
  ) then
    raise exception 'INACTIVE_DESTINATION_WAS_EXPOSED';
  end if;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  if exists (
    select 1 from public.list_money_destination_operational_balances(
      v_tenant_id, 'financial.destination.manage', 'view', null, null
    )
  ) then
    raise exception 'CROSS_TENANT_BALANCE_WAS_EXPOSED';
  end if;
end
$$;

rollback;
