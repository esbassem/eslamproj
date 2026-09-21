begin;

do $$
declare
  tenant_a uuid;
  tenant_b uuid;
  account_a uuid;
  account_b uuid;
  mapping_count integer;
  legacy_count integer;
  failed boolean;
begin
  select id into tenant_a from public.tenants order by id limit 1;
  select id into tenant_b from public.tenants where id <> tenant_a order by id limit 1;
  if tenant_a is null or tenant_b is null then
    raise exception 'PHASE25B_REQUIRES_TWO_TENANTS';
  end if;

  select id into account_a from public.account_accounts
  where tenant_id = tenant_a and account_origin = 'legacy' order by id limit 1;
  select id into account_b from public.account_accounts
  where tenant_id = tenant_b and account_origin = 'legacy' order by id limit 1;

  select count(*) into legacy_count from public.account_accounts where account_origin = 'legacy';
  select count(*) into mapping_count from public.account_legacy_mappings where effective_to is null;
  if mapping_count <> legacy_count then raise exception 'INCOMPLETE_MAPPING_INVENTORY'; end if;

  failed := false;
  begin
    insert into public.account_legacy_mappings(
      tenant_id, legacy_account_id, mapping_version, disposition, confidence,
      source_code_snapshot, source_name_snapshot, evidence, reason
    ) values (
      tenant_a, account_a, 2, 'KEEP', 'high', 'TEST', 'Duplicate current', '{}'::jsonb, 'test'
    );
  exception when unique_violation then failed := true;
  end;
  if not failed then raise exception 'DUPLICATE_CURRENT_MAPPING_ACCEPTED'; end if;

  failed := false;
  begin
    insert into public.account_legacy_mappings(
      tenant_id, legacy_account_id, mapping_version, disposition, confidence,
      source_code_snapshot, source_name_snapshot, evidence, reason
    ) values (
      tenant_a, account_b, 2, 'REVIEW', 'low', 'TEST', 'Cross tenant', '{}'::jsonb, 'test'
    );
  exception when foreign_key_violation or check_violation then failed := true;
  end;
  if not failed then raise exception 'CROSS_TENANT_MAPPING_ACCEPTED'; end if;

  failed := false;
  begin
    update public.account_legacy_mappings
    set disposition = 'REVIEW', requires_owner_decision = true, owner_question = null
    where tenant_id = tenant_a and legacy_account_id = account_a;
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'OWNER_DECISION_WITHOUT_QUESTION_ACCEPTED'; end if;

  failed := false;
  begin
    update public.account_legacy_mappings
    set canonical_semantic_key = 'invalid_taxonomy_test',
        canonical_account_type = 'income',
        statement_section = 'balance_sheet',
        reporting_category = 'revenue',
        normal_balance = 'credit',
        pnl_category = null,
        target_open_item_reconcile = false,
        target_statement_reconcile = false
    where tenant_id = tenant_a and legacy_account_id = account_a;
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'INVALID_CANONICAL_TAXONOMY_ACCEPTED'; end if;

  if exists (
    select 1 from public.account_legacy_mappings mapping
    join public.account_accounts account on account.id = mapping.legacy_account_id
    where mapping.tenant_id <> account.tenant_id or account.account_origin <> 'legacy'
  ) then raise exception 'INVALID_MAPPING_TARGET_FOUND'; end if;

  if exists (
    select 1 from public.account_legacy_mappings
    where effective_to is null and disposition in ('REVIEW', 'SPLIT_FUTURE')
      and (not requires_owner_decision or nullif(btrim(owner_question), '') is null)
  ) then raise exception 'UNEXPLAINED_REVIEW_MAPPING_FOUND'; end if;
end
$$;

rollback;
