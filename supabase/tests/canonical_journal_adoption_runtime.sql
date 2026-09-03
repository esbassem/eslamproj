begin;

do $$
declare
  fixture_tenant uuid := gen_random_uuid();
  scenario_tenant uuid := gen_random_uuid();
  other_tenant uuid := gen_random_uuid();
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 12);
  general_id uuid;
  sales_id uuid;
  purchase_id uuid;
  historical_move_id uuid;
  historical_move_journal_id uuid;
  installation_id uuid;
  repeated_installation_id uuid;
  journal_count integer;
  adoption_count integer;
  failed boolean;
  failure_message text;
begin
  insert into public.tenants(id, name, slug)
  values(fixture_tenant, 'Canonical Journal Adoption Fixture', 'journal-adoption-' || suffix);
  insert into public.tenants(id, name, slug)
  values(scenario_tenant, 'Canonical Journal Scenario Fixture', 'journal-scenario-' || suffix);
  insert into public.tenants(id, name, slug)
  values(other_tenant, 'Canonical Journal Cross Tenant Fixture', 'journal-cross-' || suffix);

  -- Turn the automatically initialized fixture back into a pre-canonical tenant.
  delete from public.account_functional_accounts where tenant_id = fixture_tenant;
  delete from public.tenant_chart_template_installations where tenant_id = fixture_tenant;
  delete from public.account_journals where tenant_id = fixture_tenant;
  delete from public.account_accounts where tenant_id = fixture_tenant;
  delete from public.account_groups where tenant_id = fixture_tenant;

  delete from public.account_functional_accounts where tenant_id = scenario_tenant;
  delete from public.tenant_chart_template_installations where tenant_id = scenario_tenant;
  delete from public.account_journals where tenant_id = scenario_tenant;
  delete from public.account_accounts where tenant_id = scenario_tenant;
  delete from public.account_groups where tenant_id = scenario_tenant;

  insert into public.account_journals(
    tenant_id, name, code, type, is_active, semantic_key, journal_origin
  ) values
    (fixture_tenant, 'Legacy General', 'GEN', 'general', true, null, 'legacy'),
    (fixture_tenant, 'Legacy Sales', 'SAL', 'sale', true, null, 'legacy'),
    (fixture_tenant, 'Legacy Purchase', 'PUR', 'purchase', true, null, 'legacy');

  select id into general_id from public.account_journals
  where tenant_id = fixture_tenant and code = 'GEN';
  select id into sales_id from public.account_journals
  where tenant_id = fixture_tenant and code = 'SAL';
  select id into purchase_id from public.account_journals
  where tenant_id = fixture_tenant and code = 'PUR';

  insert into public.account_moves(
    tenant_id, journal_id, name, move_type, amount_total, state
  ) values (
    fixture_tenant, general_id, 'Historical Journal Fixture', 'journal', 0, 'draft'
  ) returning id into historical_move_id;

  installation_id := public.provision_tenant_canonical_chart(
    fixture_tenant, 'general_trading', null
  );

  if (select id from public.account_journals where tenant_id = fixture_tenant
      and semantic_key = 'general_journal') is distinct from general_id
     or (select id from public.account_journals where tenant_id = fixture_tenant
      and semantic_key = 'sales_journal') is distinct from sales_id
     or (select id from public.account_journals where tenant_id = fixture_tenant
      and semantic_key = 'purchase_journal') is distinct from purchase_id then
    raise exception 'COMPATIBLE_LEGACY_FOUNDATION_JOURNAL_NOT_ADOPTED';
  end if;
  select journal_id into historical_move_journal_id
  from public.account_moves where id = historical_move_id;
  if historical_move_journal_id is distinct from general_id then
    raise exception 'HISTORICAL_MOVE_JOURNAL_REWRITTEN';
  end if;
  select count(*) into adoption_count
  from public.canonical_journal_adoptions where tenant_id = fixture_tenant;
  if adoption_count <> 3 then
    raise exception 'ADOPTION_PROVENANCE_COUNT_INVALID: %', adoption_count;
  end if;

  select count(*) into journal_count
  from public.account_journals where tenant_id = fixture_tenant;
  repeated_installation_id := public.provision_tenant_canonical_chart(
    fixture_tenant, 'general_trading', null
  );
  if repeated_installation_id is distinct from installation_id
     or (select count(*) from public.account_journals
         where tenant_id = fixture_tenant) <> journal_count
     or (select count(*) from public.canonical_journal_adoptions
         where tenant_id = fixture_tenant) <> adoption_count then
    raise exception 'CANONICAL_JOURNAL_RETRY_NOT_IDEMPOTENT';
  end if;

  -- No candidate: create the canonical journal normally.
  select ensured.journal_id into general_id
  from public.ensure_tenant_canonical_foundation_journal(
    scenario_tenant, 'general_journal', 'General Journal', 'GEN', 'general'
  ) ensured;
  if not exists (
    select 1 from public.account_journals
    where id = general_id and tenant_id = scenario_tenant
      and semantic_key = 'general_journal' and journal_origin = 'template'
  ) then raise exception 'MISSING_CANONICAL_JOURNAL_NOT_CREATED'; end if;

  -- Already canonical: reuse with no row mutation.
  if (select provisioning_outcome
      from public.ensure_tenant_canonical_foundation_journal(
        scenario_tenant, 'general_journal', 'General Journal', 'GEN', 'general'
      )) <> 'reused' then
    raise exception 'EXISTING_CANONICAL_JOURNAL_NOT_REUSED';
  end if;

  -- Wrong type fails closed.
  delete from public.account_journals where id = general_id;
  insert into public.account_journals(tenant_id, name, code, type, is_active)
  values(scenario_tenant, 'Wrong Type', 'GEN', 'sale', true);
  failed := false;
  begin
    perform public.ensure_tenant_canonical_foundation_journal(
      scenario_tenant, 'general_journal', 'General Journal', 'GEN', 'general'
    );
  exception when check_violation then
    failed := true; get stacked diagnostics failure_message = message_text;
  end;
  if not failed or failure_message <> 'CANONICAL_JOURNAL_TYPE_CONFLICT' then
    raise exception 'WRONG_TYPE_NOT_REJECTED: %', failure_message;
  end if;

  -- A conflicting semantic identity on the canonical code fails closed.
  delete from public.account_journals where tenant_id = scenario_tenant and code = 'GEN';
  insert into public.account_journals(
    tenant_id, name, code, type, is_active, semantic_key, journal_origin
  ) values (
    scenario_tenant, 'Different Purpose', 'GEN', 'general', true,
    'different_purpose', 'manual'
  );
  failed := false;
  begin
    perform public.ensure_tenant_canonical_foundation_journal(
      scenario_tenant, 'general_journal', 'General Journal', 'GEN', 'general'
    );
  exception when check_violation then
    failed := true; get stacked diagnostics failure_message = message_text;
  end;
  if not failed or failure_message <> 'CANONICAL_JOURNAL_SEMANTIC_IDENTITY_CONFLICT' then
    raise exception 'CONFLICTING_SEMANTIC_IDENTITY_NOT_REJECTED: %', failure_message;
  end if;

  -- Multiple branch-scoped semantic identities are ambiguous; one is a scope conflict.
  delete from public.account_journals where tenant_id = scenario_tenant and code = 'GEN';
  insert into public.branches(tenant_id, name, code)
  values(scenario_tenant, 'Journal Branch A', 'JBA' || left(suffix, 5)),
        (scenario_tenant, 'Journal Branch B', 'JBB' || left(suffix, 5));
  insert into public.account_journals(
    tenant_id, branch_id, name, code, type, is_active,
    semantic_key, journal_origin
  )
  select scenario_tenant, branch.id, branch.name || ' General',
         case when branch.name = 'Journal Branch A' then 'GNA' else 'GNB' end,
         'general', true, 'general_journal', 'manual'
  from public.branches branch
  where branch.tenant_id = scenario_tenant and branch.name like 'Journal Branch %';
  failed := false;
  begin
    perform public.ensure_tenant_canonical_foundation_journal(
      scenario_tenant, 'general_journal', 'General Journal', 'GEN', 'general'
    );
  exception when check_violation then
    failed := true; get stacked diagnostics failure_message = message_text;
  end;
  if not failed or failure_message <> 'CANONICAL_JOURNAL_SEMANTIC_IDENTITY_AMBIGUOUS' then
    raise exception 'AMBIGUOUS_CANDIDATES_NOT_REJECTED: %', failure_message;
  end if;
  delete from public.account_journals
  where tenant_id = scenario_tenant and branch_id = (
    select id from public.branches where tenant_id = scenario_tenant
      and name like 'Journal Branch %' order by id limit 1
  );
  failed := false;
  begin
    perform public.ensure_tenant_canonical_foundation_journal(
      scenario_tenant, 'general_journal', 'General Journal', 'GEN', 'general'
    );
  exception when check_violation then
    failed := true; get stacked diagnostics failure_message = message_text;
  end;
  if not failed or failure_message <> 'CANONICAL_JOURNAL_BRANCH_SCOPE_CONFLICT' then
    raise exception 'BRANCH_SCOPE_CONFLICT_NOT_REJECTED: %', failure_message;
  end if;

  -- The other tenant's canonical identity never participates in this tenant's lookup.
  delete from public.account_journals where tenant_id = scenario_tenant;
  select ensured.journal_id into general_id
  from public.ensure_tenant_canonical_foundation_journal(
    scenario_tenant, 'general_journal', 'General Journal', 'GEN', 'general'
  ) ensured;
  if exists (
    select 1 from public.account_journals other
    where other.tenant_id = other_tenant and other.id = general_id
  ) then raise exception 'CROSS_TENANT_JOURNAL_REUSED'; end if;

  if exists (
    select 1 from public.account_journals
    where tenant_id = scenario_tenant and type in ('cash', 'bank')
  ) or exists (
    select 1 from public.money_destinations where tenant_id = scenario_tenant
  ) or exists (
    select 1 from public.financial_payment_methods where tenant_id = scenario_tenant
  ) then raise exception 'LIQUIDITY_SIDE_EFFECT_DETECTED'; end if;
end
$$;

rollback;
