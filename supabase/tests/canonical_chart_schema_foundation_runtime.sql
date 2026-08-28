begin;

do $$
declare
  tenant_a uuid;
  tenant_b uuid;
  group_a uuid;
  group_b uuid;
  group_child uuid;
  posting_account uuid;
  structural_account uuid;
  move_id uuid;
  template_id uuid;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  failed boolean;
begin
  select id into tenant_a from public.tenants order by id limit 1;
  select id into tenant_b from public.tenants where id <> tenant_a order by id limit 1;
  if tenant_a is null or tenant_b is null then
    raise exception 'PHASE25A_REQUIRES_TWO_TENANTS';
  end if;

  insert into public.account_groups(tenant_id, code, name, semantic_key)
  values(tenant_a, 'TA' || suffix, 'Phase 2.5A Group A ' || suffix, 'phase25a_group_' || suffix)
  returning id into group_a;
  insert into public.account_groups(tenant_id, code, name, semantic_key)
  values(tenant_b, 'TB' || suffix, 'Phase 2.5A Group B ' || suffix, 'phase25a_group_' || suffix)
  returning id into group_b;

  failed := false;
  begin
    update public.account_groups set parent_id = group_b where id = group_a;
  exception when foreign_key_violation then failed := true;
  end;
  if not failed then raise exception 'CROSS_TENANT_GROUP_PARENT_ACCEPTED'; end if;

  insert into public.account_groups(tenant_id, parent_id, code, name, semantic_key)
  values(
    tenant_a, group_a, 'TC' || suffix, 'Phase 2.5A Child ' || suffix,
    'phase25a_child_' || suffix
  ) returning id into group_child;
  failed := false;
  begin
    update public.account_groups set parent_id = group_child where id = group_a;
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'ACCOUNT_GROUP_HIERARCHY_CYCLE_ACCEPTED'; end if;

  failed := false;
  begin
    insert into public.account_accounts(
      tenant_id, group_id, code, name, account_type, reconcile
    ) values(
      tenant_a, group_b, 'XC' || suffix, 'Cross tenant account ' || suffix,
      'asset', false
    );
  exception when foreign_key_violation then failed := true;
  end;
  if not failed then raise exception 'CROSS_TENANT_ACCOUNT_GROUP_ACCEPTED'; end if;

  insert into public.account_accounts(
    tenant_id, group_id, code, name, account_type,
    canonical_account_type, statement_section, reporting_category,
    normal_balance, pnl_category, open_item_reconcile,
    statement_reconcile, semantic_key, account_origin, is_posting
  ) values(
    tenant_a, group_a, 'PA' || suffix, 'Canonical receivable ' || suffix, 'asset',
    'receivable', 'balance_sheet', 'trade_receivables',
    'debit', null, true, false, 'phase25a_receivable_' || suffix,
    'manual', true
  ) returning id into posting_account;

  if not (select reconcile and open_item_reconcile from public.account_accounts where id = posting_account) then
    raise exception 'OPEN_ITEM_TO_LEGACY_RECONCILE_SYNC_FAILED';
  end if;

  update public.account_accounts set reconcile = false where id = posting_account;
  if (select open_item_reconcile from public.account_accounts where id = posting_account) then
    raise exception 'LEGACY_TO_OPEN_ITEM_RECONCILE_SYNC_FAILED';
  end if;
  update public.account_accounts set open_item_reconcile = true where id = posting_account;

  failed := false;
  begin
    insert into public.account_accounts(
      tenant_id, group_id, code, name, account_type,
      canonical_account_type, statement_section, reporting_category,
      normal_balance, pnl_category, account_origin
    ) values(
      tenant_a, group_a, 'IV' || suffix, 'Invalid taxonomy ' || suffix, 'income',
      'income', 'balance_sheet', 'revenue', 'debit', null, 'manual'
    );
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'INVALID_CANONICAL_TAXONOMY_ACCEPTED'; end if;

  failed := false;
  begin
    insert into public.account_accounts(
      tenant_id, group_id, code, name, account_type,
      canonical_account_type, statement_section, reporting_category,
      normal_balance, pnl_category, account_origin
    ) values(
      tenant_a, group_a, 'IR' || suffix, 'Invalid reporting ' || suffix, 'asset',
      'receivable', 'balance_sheet', 'revenue', 'debit', null, 'manual'
    );
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'TYPE_REPORTING_MISMATCH_ACCEPTED'; end if;

  failed := false;
  begin
    insert into public.account_accounts(
      tenant_id, group_id, code, name, account_type, semantic_key
    ) values(
      tenant_a, group_a, 'DU' || suffix, 'Duplicate semantic ' || suffix,
      'asset', 'phase25a_receivable_' || suffix
    );
  exception when unique_violation then failed := true;
  end;
  if not failed then raise exception 'DUPLICATE_ACCOUNT_SEMANTIC_KEY_ACCEPTED'; end if;

  insert into public.account_accounts(
    tenant_id, group_id, code, name, account_type, is_posting
  ) values(
    tenant_a, group_a, 'SA' || suffix, 'Non posting account ' || suffix,
    'asset', false
  ) returning id into structural_account;

  insert into public.account_moves(tenant_id, name, move_type, state)
  values(tenant_a, 'PHASE25A-DRAFT-' || suffix, 'journal', 'draft')
  returning id into move_id;

  failed := false;
  begin
    insert into public.account_move_lines(
      tenant_id, move_id, account_id, debit, credit
    ) values(tenant_a, move_id, structural_account, 1, 0);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'POSTING_TO_NON_POSTING_ACCOUNT_ACCEPTED'; end if;

  insert into public.account_move_lines(
    tenant_id, move_id, account_id, debit, credit
  ) values(tenant_a, move_id, posting_account, 1, 0);

  failed := false;
  begin
    update public.account_accounts set is_posting = false where id = posting_account;
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'USED_ACCOUNT_BECAME_STRUCTURAL'; end if;

  insert into public.canonical_chart_templates(template_key, version, name)
  values('phase25a_' || suffix, 1, 'Phase 2.5A Test Template')
  returning id into template_id;
  insert into public.canonical_chart_template_groups(
    template_id, group_key, name, required
  ) values(template_id, 'assets', 'Assets', true);
  insert into public.canonical_chart_template_accounts(
    template_id, template_account_key, group_key, name, suggested_code,
    canonical_account_type, statement_section, reporting_category,
    normal_balance, open_item_reconcile, statement_reconcile,
    provisioning_policy
  ) values(
    template_id, 'trade_receivable', 'assets', 'Trade Receivable', '121100',
    'receivable', 'balance_sheet', 'trade_receivables', 'debit', true, false,
    'required'
  );

  failed := false;
  begin
    insert into public.canonical_chart_template_accounts(
      template_id, template_account_key, group_key, name, suggested_code,
      canonical_account_type, statement_section, reporting_category,
      normal_balance, open_item_reconcile, statement_reconcile,
      provisioning_policy
    ) values(
      template_id, 'trade_receivable', 'assets', 'Duplicate Trade Receivable',
      '121101', 'receivable', 'balance_sheet', 'trade_receivables', 'debit',
      true, false, 'required'
    );
  exception when unique_violation then failed := true;
  end;
  if not failed then raise exception 'DUPLICATE_TEMPLATE_ACCOUNT_KEY_ACCEPTED'; end if;

  failed := false;
  begin
    insert into public.canonical_chart_template_accounts(
      template_id, template_account_key, group_key, name, suggested_code,
      canonical_account_type, statement_section, reporting_category,
      normal_balance, open_item_reconcile, statement_reconcile,
      provisioning_policy, feature_key
    ) values(
      template_id, 'bank_account', 'assets', 'Bank Account', '112100',
      'liquidity', 'balance_sheet', 'cash_and_cash_equivalents', 'debit',
      false, true, 'conditional', null
    );
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'CONDITIONAL_TEMPLATE_WITHOUT_FEATURE_ACCEPTED'; end if;
end
$$;

rollback;
