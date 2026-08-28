begin;

do $$
declare
  tenant_a uuid := '4ee5f357-8cf5-4770-8772-64de99532dac';
  tenant_b uuid := '7ab6db32-2e5b-4a8e-a1c1-810536da86db';
  branch_a uuid := '30000000-0000-4000-8000-000000000011';
  pos_a uuid := '30000000-0000-4000-8000-000000000012';
  liquidity_account uuid := '30000000-0000-4000-8000-000000000013';
  custody_account uuid := '30000000-0000-4000-8000-000000000014';
  structural_account uuid := '30000000-0000-4000-8000-000000000015';
  cash_journal uuid := '30000000-0000-4000-8000-000000000016';
  custody_journal uuid := '30000000-0000-4000-8000-000000000018';
  responsible uuid;
  active_destination uuid;
  kind text;
begin
  select id into responsible from public.tenant_users
  where tenant_id = tenant_a and is_active order by id limit 1;

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_a, tenant_a, 'Phase 3A Runtime Branch', 'P3ART', true);
  insert into public.pos_configs (id, tenant_id, branch_id, name, code, is_active)
  values (pos_a, tenant_a, branch_a, 'Phase 3A Runtime POS', 'P3ART', true);

  insert into public.account_accounts (
    id, tenant_id, code, name, account_type, reconcile, active,
    canonical_account_type, statement_section, reporting_category,
    normal_balance, open_item_reconcile, statement_reconcile, is_posting,
    semantic_key, account_origin
  ) values
    (liquidity_account, tenant_a, 'P3ART-LIQ', 'P3A Liquidity', 'asset', false, true,
      'liquidity', 'balance_sheet', 'cash_and_cash_equivalents', 'debit',
      false, false, true, 'p3art_liquidity_resource', 'resource'),
    (custody_account, tenant_a, 'P3ART-CUS', 'P3A Custody', 'asset', true, true,
      'current_asset', 'balance_sheet', 'other_receivables', 'debit',
      true, false, true, 'p3art_custody_resource', 'resource'),
    (structural_account, tenant_a, 'P3ART-STR', 'P3A Structural', 'asset', false, true,
      'liquidity', 'balance_sheet', 'cash_and_cash_equivalents', 'debit',
      false, false, false, 'p3art_structural_resource', 'resource');

  insert into public.account_journals (
    id, tenant_id, branch_id, name, code, type, default_account_id,
    is_active, semantic_key, journal_origin
  ) values
    (cash_journal, tenant_a, branch_a, 'P3A Cash', 'P3ARTC', 'cash', liquidity_account,
      true, 'p3art_cash_journal', 'resource'),
    (custody_journal, tenant_a, branch_a, 'P3A Custody', 'P3ARTU', 'cash', custody_account,
      true, 'p3art_custody_journal', 'resource');

  foreach kind in array array['cashbox','bank','employee_cash_custody','pos_drawer','wallet'] loop
    insert into public.money_destinations (
      tenant_id, destination_key, name, destination_type, status, branch_id,
      responsible_user_id, pos_config_id, bank_name, bank_account_label
    ) values (
      tenant_a, 'runtime_' || kind, 'Runtime ' || kind, kind, 'draft', branch_a,
      case when kind in ('employee_cash_custody','cashbox','pos_drawer') then responsible end,
      case when kind = 'pos_drawer' then pos_a end,
      case when kind = 'bank' then 'Runtime Bank' end,
      case when kind = 'bank' then 'Masked runtime account' end
    );
  end loop;

  if (select count(*) from public.money_destinations
      where tenant_id = tenant_a and destination_key like 'runtime_%') <> 5 then
    raise exception 'all five canonical destination types were not created';
  end if;

  update public.money_destinations
  set ledger_account_id = liquidity_account, journal_id = cash_journal, status = 'active'
  where tenant_id = tenant_a and destination_key = 'runtime_cashbox'
  returning id into active_destination;

  begin
    insert into public.money_destinations (
      tenant_id, destination_key, name, destination_type, status, branch_id
    ) values (tenant_a, 'invalid_custody', 'Invalid custody',
      'employee_cash_custody', 'draft', branch_a);
    raise exception 'invalid custody unexpectedly accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.money_destinations (
      tenant_id, destination_key, name, destination_type, status, branch_id
    ) values (tenant_b, 'cross_tenant', 'Cross tenant', 'cashbox', 'draft', branch_a);
    raise exception 'cross-tenant reference unexpectedly accepted';
  exception when foreign_key_violation or check_violation then null;
  end;

  begin
    update public.money_destinations set ledger_account_id = structural_account
    where tenant_id = tenant_a and destination_key = 'runtime_wallet';
    raise exception 'structural account unexpectedly accepted';
  exception when check_violation then null;
  end;

  begin
    update public.money_destinations
    set ledger_account_id = custody_account, journal_id = custody_journal, status = 'active'
    where tenant_id = tenant_a and destination_key = 'runtime_bank';
    raise exception 'incompatible account unexpectedly accepted';
  exception when check_violation then null;
  end;

  begin
    update public.money_destinations set destination_type = 'wallet'
    where id = active_destination;
    raise exception 'active accounting identity unexpectedly mutated';
  exception when check_violation then null;
  end;

  update public.money_destinations set status = 'inactive'
  where id = active_destination;
  if (select activated_at is null from public.money_destinations where id = active_destination) then
    raise exception 'first activation timestamp was not retained';
  end if;
  begin
    update public.money_destinations set journal_id = null where id = active_destination;
    raise exception 'inactive activated identity unexpectedly mutated';
  exception when check_violation then null;
  end;

  begin
    update public.account_accounts set active = false where id = liquidity_account;
    raise exception 'active destination account unexpectedly disabled';
  exception when check_violation then null;
  end;

  begin
    update public.account_journals set is_active = false where id = cash_journal;
    raise exception 'active destination journal unexpectedly disabled';
  exception when check_violation then null;
  end;
end
$$;

rollback;
