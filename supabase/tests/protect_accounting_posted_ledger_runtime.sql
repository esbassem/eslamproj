begin;

do $$
declare
  v_tenant_id uuid;
  v_reconcile_account uuid;
  v_counter_account uuid;
  v_debit_move uuid := gen_random_uuid();
  v_credit_move uuid := gen_random_uuid();
  v_draft_move uuid := gen_random_uuid();
  v_debit_line uuid := gen_random_uuid();
  v_credit_line uuid := gen_random_uuid();
  v_counter_credit_line uuid := gen_random_uuid();
  v_draft_debit_line uuid := gen_random_uuid();
  v_partial_id uuid;
  v_unbalanced_move uuid;
  v_immutable_move uuid;
  v_immutable_line uuid;
  v_failed boolean;
  v_residual numeric;
  v_reconciled boolean;
begin
  select account.tenant_id, account.id
  into v_tenant_id, v_reconcile_account
  from public.account_accounts account
  where account.code = '114001' and account.active and account.reconcile
    and exists (
      select 1 from public.account_moves move
      where move.tenant_id = account.tenant_id and move.state = 'posted'
    )
  order by account.tenant_id
  limit 1;

  select account.id into v_counter_account
  from public.account_accounts account
  where account.tenant_id = v_tenant_id
    and account.id <> v_reconcile_account
    and account.active
  order by account.id
  limit 1;

  if v_tenant_id is null or v_counter_account is null then
    raise exception 'LEDGER_TEST_FIXTURE_UNAVAILABLE';
  end if;

  insert into public.account_moves(id, tenant_id, name, move_type, amount_total, state)
  values
    (v_debit_move, v_tenant_id, 'PHASE0-DEBIT', 'journal', 100, 'posted'),
    (v_credit_move, v_tenant_id, 'PHASE0-CREDIT', 'journal', 100, 'posted');

  insert into public.account_move_lines(
    id, tenant_id, move_id, account_id, debit, credit,
    amount_residual, amount_residual_currency, is_reconciled
  ) values
    (v_debit_line, v_tenant_id, v_debit_move, v_reconcile_account, 100, 0, 100, 100, false),
    (v_counter_credit_line, v_tenant_id, v_debit_move, v_counter_account, 0, 100, 0, 0, true),
    (gen_random_uuid(), v_tenant_id, v_credit_move, v_counter_account, 100, 0, 0, 0, true),
    (v_credit_line, v_tenant_id, v_credit_move, v_reconcile_account, 0, 100, 100, 100, false);

  set constraints account_move_lines_balance_deferred, account_moves_balance_deferred immediate;
  set constraints account_move_lines_balance_deferred, account_moves_balance_deferred deferred;

  v_failed := false;
  begin
    insert into public.account_moves(tenant_id, name, move_type, amount_total, state)
    values(v_tenant_id, 'PHASE0-UNBALANCED', 'journal', 50, 'posted')
    returning id into v_unbalanced_move;
    insert into public.account_move_lines(tenant_id, move_id, account_id, debit, credit)
    values(v_tenant_id, v_unbalanced_move, v_reconcile_account, 50, 0);
    set constraints account_move_lines_balance_deferred, account_moves_balance_deferred immediate;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'UNBALANCED_POSTED_MOVE_ACCEPTED'; end if;
  set constraints account_move_lines_balance_deferred, account_moves_balance_deferred deferred;

  insert into public.account_partial_reconcile(tenant_id, debit_move_id, credit_move_id, amount)
  values(v_tenant_id, v_debit_line, v_credit_line, 40)
  returning id into v_partial_id;

  select amount_residual, is_reconciled into v_residual, v_reconciled
  from public.account_move_lines where id = v_debit_line;
  if v_residual <> 60 or v_reconciled then raise exception 'PARTIAL_CACHE_SYNC_FAILED'; end if;

  v_failed := false;
  begin
    insert into public.account_partial_reconcile(tenant_id, debit_move_id, credit_move_id, amount)
    values(v_tenant_id, v_debit_line, v_credit_line, 61);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'OVER_RECONCILIATION_ACCEPTED'; end if;

  v_failed := false;
  begin
    insert into public.account_partial_reconcile(tenant_id, debit_move_id, credit_move_id, amount)
    values(v_tenant_id, v_debit_line, v_counter_credit_line, 1);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'CROSS_ACCOUNT_RECONCILIATION_ACCEPTED'; end if;

  v_failed := false;
  begin
    insert into public.account_partial_reconcile(tenant_id, debit_move_id, credit_move_id, amount)
    values(v_tenant_id, v_credit_line, v_debit_line, 1);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'WRONG_POLARITY_RECONCILIATION_ACCEPTED'; end if;

  v_failed := false;
  begin
    insert into public.account_partial_reconcile(tenant_id, debit_move_id, credit_move_id, amount)
    values(gen_random_uuid(), v_debit_line, v_credit_line, 1);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'CROSS_TENANT_RECONCILIATION_ACCEPTED'; end if;

  insert into public.account_moves(id, tenant_id, name, move_type, amount_total, state)
  values(v_draft_move, v_tenant_id, 'PHASE0-DRAFT', 'journal', 100, 'draft');
  insert into public.account_move_lines(
    id, tenant_id, move_id, account_id, debit, credit,
    amount_residual, amount_residual_currency, is_reconciled
  ) values
    (v_draft_debit_line, v_tenant_id, v_draft_move, v_reconcile_account, 100, 0, 100, 100, false),
    (gen_random_uuid(), v_tenant_id, v_draft_move, v_counter_account, 0, 100, 0, 0, true);

  v_failed := false;
  begin
    insert into public.account_partial_reconcile(tenant_id, debit_move_id, credit_move_id, amount)
    values(v_tenant_id, v_draft_debit_line, v_credit_line, 1);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'DRAFT_RECONCILIATION_ACCEPTED'; end if;

  insert into public.account_partial_reconcile(tenant_id, debit_move_id, credit_move_id, amount)
  values(v_tenant_id, v_debit_line, v_credit_line, 60);
  select amount_residual, is_reconciled into v_residual, v_reconciled
  from public.account_move_lines where id = v_debit_line;
  if v_residual <> 0 or not v_reconciled then raise exception 'FULL_CACHE_SYNC_FAILED'; end if;

  delete from public.account_partial_reconcile where id = v_partial_id;
  select amount_residual, is_reconciled into v_residual, v_reconciled
  from public.account_move_lines where id = v_debit_line;
  if v_residual <> 40 or v_reconciled then raise exception 'DEALLOCATION_CACHE_SYNC_FAILED'; end if;

  select move.id, line.id into v_immutable_move, v_immutable_line
  from public.account_moves move
  join lateral (
    select id from public.account_move_lines where move_id = move.id order by id limit 1
  ) line on true
  where move.state = 'posted'
    and move.tenant_id = v_tenant_id
    and pg_xact_status(move.xmin::text::xid8) = 'committed'
  order by move.created_at, move.id
  limit 1;
  if v_immutable_move is null then raise exception 'IMMUTABLE_FIXTURE_UNAVAILABLE'; end if;

  v_failed := false;
  begin update public.account_moves set ref = 'forbidden' where id = v_debit_move;
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'POSTED_MOVE_UPDATE_ACCEPTED'; end if;

  v_failed := false;
  begin update public.account_move_lines set debit = 99 where id = v_immutable_line;
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'POSTED_LINE_UPDATE_ACCEPTED'; end if;

  v_failed := false;
  begin
    insert into public.account_move_lines(tenant_id, move_id, account_id, debit, credit)
    values(v_tenant_id, v_immutable_move, v_reconcile_account, 1, 0);
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'POSTED_LINE_INSERT_ACCEPTED'; end if;

  v_failed := false;
  begin delete from public.account_move_lines where id = v_immutable_line;
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'POSTED_LINE_DELETE_ACCEPTED'; end if;

  v_failed := false;
  begin delete from public.account_moves where id = v_immutable_move;
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'POSTED_MOVE_DELETE_ACCEPTED'; end if;

  if has_table_privilege('authenticated', 'public.account_moves', 'INSERT')
     or has_table_privilege('authenticated', 'public.account_move_lines', 'UPDATE')
     or has_table_privilege('authenticated', 'public.account_partial_reconcile', 'DELETE') then
    raise exception 'AUTHENTICATED_LEDGER_WRITE_GRANT_REMAINS';
  end if;

  raise notice 'LEDGER_PHASE0_RUNTIME_TEST_PASSED';
end
$$;

rollback;
