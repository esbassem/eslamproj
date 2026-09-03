begin;

do $$
declare
  lifecycle_source text;
  create_source text;
  tenant_id uuid;
  owner_user_id uuid;
  owner_auth_id uuid;
  branch_id uuid := gen_random_uuid();
  pos_id uuid := gen_random_uuid();
  cashbox_result jsonb;
  retry_result jsonb;
  bank_result jsonb;
  custody_result jsonb;
  pos_result jsonb;
  wallet_result jsonb;
  posted_moves_before bigint;
  posted_lines_before bigint;
  reconciliations_before bigint;
begin
  select pg_get_functiondef('public.set_money_destination_status(uuid,uuid,text)'::regprocedure)
  into lifecycle_source;
  select pg_get_functiondef('public.create_and_provision_money_destination(uuid,text,text,text,uuid,uuid,uuid,text,text,text,jsonb,boolean)'::regprocedure)
  into create_source;

  if lifecycle_source not like '%assert_financial_authorized%' or lifecycle_source not like '%for update%'
     or lifecycle_source not like '%money_destination_events%' then
    raise exception 'Lifecycle command is missing authorization, locking, or audit guarantees.';
  end if;
  if create_source not like '%pg_advisory_xact_lock%' or create_source not like '%MONEY_DESTINATION_IDEMPOTENCY_CONFLICT%'
     or create_source not like '%provision_money_destination%' then
    raise exception 'Creation command is missing idempotency or canonical provisioning.';
  end if;
  if has_function_privilege('anon', 'public.set_money_destination_status(uuid,uuid,text)', 'execute') then
    raise exception 'Anon must not execute Money Destination lifecycle.';
  end if;

  select tenant_user.tenant_id, tenant_user.id, tenant_user.auth_user_id
  into tenant_id, owner_user_id, owner_auth_id
  from public.tenant_users tenant_user
  where tenant_user.role = 'owner' and tenant_user.is_active and tenant_user.auth_user_id is not null
    and exists (select 1 from public.account_groups account_group where account_group.tenant_id = tenant_user.tenant_id and account_group.template_group_key = 'liquidity_resources')
    and exists (select 1 from public.account_groups account_group where account_group.tenant_id = tenant_user.tenant_id and account_group.template_group_key = 'receivables')
  order by tenant_user.created_at limit 1;
  if tenant_id is null then raise exception 'No rollback-test tenant has canonical resource groups.'; end if;

  perform set_config('request.jwt.claim.sub', owner_auth_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  select count(*) into posted_moves_before from public.account_moves where state = 'posted';
  select count(*) into posted_lines_before from public.account_move_lines where parent_state = 'posted';
  select count(*) into reconciliations_before from public.account_partial_reconcile;

  insert into public.branches(id, tenant_id, name, code, is_active)
  values(branch_id, tenant_id, 'Phase 2 rollback branch', 'P2RB', true);
  insert into public.pos_configs(id, tenant_id, branch_id, name, code, is_active)
  values(pos_id, tenant_id, branch_id, 'Phase 2 rollback POS', 'P2POS', true);

  cashbox_result := public.create_and_provision_money_destination(tenant_id, 'phase2_test_cashbox', 'Phase 2 Cashbox', 'cashbox', branch_id, null, null, null, null, null, '{}'::jsonb, true);
  bank_result := public.create_and_provision_money_destination(tenant_id, 'phase2_test_bank', 'Phase 2 Bank', 'bank', null, null, null, 'Test Bank', 'Main Account', '••01', '{}'::jsonb, true);
  custody_result := public.create_and_provision_money_destination(tenant_id, 'phase2_test_custody', 'Phase 2 Custody', 'employee_cash_custody', branch_id, owner_user_id, null, null, null, null, '{}'::jsonb, true);
  pos_result := public.create_and_provision_money_destination(tenant_id, 'phase2_test_pos', 'Phase 2 POS Drawer', 'pos_drawer', branch_id, null, pos_id, null, null, null, '{}'::jsonb, true);
  wallet_result := public.create_and_provision_money_destination(tenant_id, 'phase2_test_wallet', 'Phase 2 Wallet', 'wallet', null, null, null, null, null, null, '{}'::jsonb, true);

  if exists (
    select 1 from jsonb_array_elements(jsonb_build_array(cashbox_result, bank_result, custody_result, pos_result, wallet_result)) result
    where result->>'status' <> 'active' or result->>'account_id' is null or result->>'journal_id' is null
  ) then raise exception 'A canonical type was not fully provisioned.'; end if;
  if (select count(*) from public.money_destinations where id in (
    (cashbox_result->>'destination_id')::uuid, (bank_result->>'destination_id')::uuid,
    (custody_result->>'destination_id')::uuid, (pos_result->>'destination_id')::uuid,
    (wallet_result->>'destination_id')::uuid
  ) and status = 'active') <> 5 then raise exception 'Expected five active destination fixtures.'; end if;

  retry_result := public.create_and_provision_money_destination(tenant_id, 'phase2_test_cashbox', 'Phase 2 Cashbox', 'cashbox', branch_id, null, null, null, null, null, '{}'::jsonb, true);
  if retry_result->>'destination_id' <> cashbox_result->>'destination_id'
     or (select count(*) from public.account_accounts where money_destination_id = (cashbox_result->>'destination_id')::uuid) <> 1
     or (select count(*) from public.account_journals where money_destination_id = (cashbox_result->>'destination_id')::uuid) <> 1 then
    raise exception 'Creation retry duplicated destination resources.';
  end if;

  perform public.rename_money_destination(tenant_id, (cashbox_result->>'destination_id')::uuid, 'Phase 2 Renamed Cashbox');
  if not exists(select 1 from public.money_destinations where id = (cashbox_result->>'destination_id')::uuid and name = 'Phase 2 Renamed Cashbox') then raise exception 'Rename failed.'; end if;
  perform public.set_money_destination_status(tenant_id, (cashbox_result->>'destination_id')::uuid, 'inactive');
  perform public.set_money_destination_status(tenant_id, (cashbox_result->>'destination_id')::uuid, 'active');
  perform public.set_money_destination_status(tenant_id, (wallet_result->>'destination_id')::uuid, 'inactive');
  perform public.set_money_destination_status(tenant_id, (wallet_result->>'destination_id')::uuid, 'archived');

  begin
    perform public.set_money_destination_status(tenant_id, (bank_result->>'destination_id')::uuid, 'archived');
    raise exception 'Active to archived transition unexpectedly succeeded.';
  exception when check_violation then
    if sqlerrm <> 'MONEY_DESTINATION_STATUS_TRANSITION_INVALID' then raise; end if;
  end;
  begin
    delete from public.money_destinations where id = (bank_result->>'destination_id')::uuid;
    raise exception 'Activated destination delete unexpectedly succeeded.';
  exception when check_violation then
    if sqlerrm <> 'MONEY_DESTINATION_DELETE_REQUIRES_NEVER_ACTIVATED_UNUSED_DRAFT' then raise; end if;
  end;
  begin
    perform public.create_and_provision_money_destination(tenant_id, 'phase2_bad_branch', 'Bad Branch', 'cashbox', gen_random_uuid(), null, null, null, null, null, '{}'::jsonb, true);
    raise exception 'Invalid branch unexpectedly succeeded.';
  exception when foreign_key_violation or check_violation or insufficient_privilege then null;
  end;
  begin
    perform public.create_and_provision_money_destination(tenant_id, 'phase2_bad_employee', 'Bad Employee', 'employee_cash_custody', null, gen_random_uuid(), null, null, null, null, '{}'::jsonb, true);
    raise exception 'Invalid employee unexpectedly succeeded.';
  exception when foreign_key_violation or check_violation then null;
  end;
  begin
    perform public.create_and_provision_money_destination(tenant_id, 'phase2_bad_pos', 'Bad POS', 'pos_drawer', branch_id, null, gen_random_uuid(), null, null, null, '{}'::jsonb, true);
    raise exception 'Invalid POS unexpectedly succeeded.';
  exception when foreign_key_violation or check_violation then null;
  end;
  begin
    perform public.set_money_destination_status(gen_random_uuid(), (cashbox_result->>'destination_id')::uuid, 'inactive');
    raise exception 'Cross-tenant lifecycle unexpectedly succeeded.';
  exception when no_data_found then null;
  end;
  begin
    perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
    perform public.set_money_destination_status(tenant_id, (cashbox_result->>'destination_id')::uuid, 'inactive');
    raise exception 'Unauthorized lifecycle unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', owner_auth_id::text, true);

  if (select count(*) from public.money_destination_events where destination_id in ((cashbox_result->>'destination_id')::uuid, (wallet_result->>'destination_id')::uuid)) < 6 then raise exception 'Lifecycle audit events are incomplete.'; end if;
  if not exists(select 1 from public.account_accounts where money_destination_id = (wallet_result->>'destination_id')::uuid)
     or not exists(select 1 from public.account_journals where money_destination_id = (wallet_result->>'destination_id')::uuid) then raise exception 'Archive removed historical accounting resources.'; end if;
  if (select count(*) from public.account_moves where state = 'posted') <> posted_moves_before
     or (select count(*) from public.account_move_lines where parent_state = 'posted') <> posted_lines_before
     or (select count(*) from public.account_partial_reconcile) <> reconciliations_before then raise exception 'Destination configuration changed posted financial history.'; end if;
end
$$;

rollback;
