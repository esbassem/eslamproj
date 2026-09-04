begin;

create table public.money_destination_account_adoptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  destination_id uuid not null,
  account_id uuid not null,
  responsible_user_id uuid not null,
  legacy_mapping_id uuid,
  previous_account_origin text not null,
  previous_group_id uuid,
  previous_code text not null,
  previous_semantic_key text,
  previous_canonical_account_type text,
  previous_statement_section text,
  previous_reporting_category text,
  previous_normal_balance text,
  previous_open_item_reconcile boolean not null,
  previous_statement_reconcile boolean not null,
  compatibility_evidence jsonb not null,
  actor_user_id uuid not null,
  adopted_at timestamptz not null default now(),
  constraint money_destination_account_adoptions_destination_fkey
    foreign key (destination_id, tenant_id)
    references public.money_destinations(id, tenant_id) on delete restrict,
  constraint money_destination_account_adoptions_account_fkey
    foreign key (account_id, tenant_id)
    references public.account_accounts(id, tenant_id) on delete restrict,
  constraint money_destination_account_adoptions_responsible_user_fkey
    foreign key (responsible_user_id, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint money_destination_account_adoptions_mapping_fkey
    foreign key (legacy_mapping_id) references public.account_legacy_mappings(id) on delete restrict,
  constraint money_destination_account_adoptions_actor_fkey
    foreign key (actor_user_id, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint money_destination_account_adoptions_evidence_object_check
    check (jsonb_typeof(compatibility_evidence) = 'object'),
  constraint money_destination_account_adoptions_destination_key
    unique (tenant_id, destination_id),
  constraint money_destination_account_adoptions_account_key
    unique (tenant_id, account_id)
);

alter table public.money_destination_account_adoptions enable row level security;
create policy money_destination_account_adoptions_tenant_read
on public.money_destination_account_adoptions
for select to authenticated
using (public.is_tenant_member(tenant_id));
revoke all on public.money_destination_account_adoptions from public, anon, authenticated;
grant select on public.money_destination_account_adoptions to authenticated;

create or replace function public.guard_money_destination_account_adoption_audit()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = '23514',
    message = 'MONEY_DESTINATION_ACCOUNT_ADOPTION_AUDIT_IMMUTABLE';
end
$$;

create trigger money_destination_account_adoptions_immutable
before update or delete on public.money_destination_account_adoptions
for each row execute function public.guard_money_destination_account_adoption_audit();

create unique index money_destinations_employee_custody_user_uidx
  on public.money_destinations (tenant_id, responsible_user_id)
  where destination_type = 'employee_cash_custody';

create or replace function public.guard_money_destination_resource_provenance()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.money_destination_id is not null and new.account_origin <> 'resource' then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_ACCOUNT_REQUIRES_RESOURCE_ORIGIN';
  end if;
  if new.account_origin = 'resource' and new.money_destination_id is null then
    raise exception using errcode = '23514', message = 'RESOURCE_ACCOUNT_REQUIRES_MONEY_DESTINATION_PROVENANCE';
  end if;
  if tg_op = 'UPDATE' and new.money_destination_id is distinct from old.money_destination_id
     and not (
       old.money_destination_id is null
       and old.account_origin = 'legacy'
       and new.account_origin = 'resource'
       and current_setting('app.money_destination_account_adoption', true)
         = new.money_destination_id::text
     ) then
    raise exception using errcode = '23514', message = 'RESOURCE_ACCOUNT_PROVENANCE_IMMUTABLE';
  end if;
  if current_user in ('anon', 'authenticated') and new.account_origin = 'resource' then
    raise exception using errcode = '42501', message = 'RESOURCE_ACCOUNT_CREATION_REQUIRES_PROVISIONING_CONTRACT';
  end if;
  return new;
end
$$;

create or replace function public.adopt_legacy_employee_custody_account(
  p_tenant_id uuid,
  p_destination_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  destination public.money_destinations%rowtype;
  candidate public.account_accounts%rowtype;
  current_mapping public.account_legacy_mappings%rowtype;
  candidate_count integer;
  historical_move_count bigint;
  historical_line_count bigint;
  historical_debit numeric;
  historical_credit numeric;
  actor_id uuid := public.current_tenant_user_id();
begin
  select * into destination
  from public.money_destinations
  where id = p_destination_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'MONEY_DESTINATION_NOT_FOUND';
  end if;
  if destination.destination_type <> 'employee_cash_custody'
     or destination.responsible_user_id is null then
    raise exception using errcode = '23514',
      message = 'MONEY_DESTINATION_LEGACY_CUSTODY_INCOMPATIBLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'money_destination_employee_custody:' || p_tenant_id::text || ':'
      || destination.responsible_user_id::text, 0
  ));

  select count(*) into candidate_count
  from public.account_accounts account
  where account.tenant_id = p_tenant_id
    and account.responsible_user_id = destination.responsible_user_id
    and account.active;

  if candidate_count = 0 then return null; end if;
  if candidate_count > 1 then
    raise exception using errcode = '23514',
      message = 'MONEY_DESTINATION_LEGACY_CUSTODY_AMBIGUOUS';
  end if;

  select * into candidate
  from public.account_accounts account
  where account.tenant_id = p_tenant_id
    and account.responsible_user_id = destination.responsible_user_id
    and account.active
  for update;

  select * into current_mapping
  from public.account_legacy_mappings mapping
  where mapping.tenant_id = p_tenant_id
    and mapping.legacy_account_id = candidate.id
    and mapping.effective_to is null;

  if candidate.account_origin <> 'legacy'
     or candidate.money_destination_id is not null
     or candidate.account_type <> 'asset'
     or not candidate.is_posting
     or candidate.reconcile
     or candidate.open_item_reconcile
     or candidate.statement_reconcile
     or candidate.template_account_key is not null
     or candidate.semantic_key is not null
     or candidate.pnl_category is not null
     or candidate.canonical_account_type not in ('liquidity')
     or candidate.statement_section not in ('balance_sheet')
     or candidate.reporting_category not in ('cash_and_cash_equivalents')
     or candidate.normal_balance not in ('debit') then
    raise exception using errcode = '23514',
      message = 'MONEY_DESTINATION_LEGACY_CUSTODY_INCOMPATIBLE';
  end if;

  if not exists (
    with recursive ancestry as (
      select groups.id, groups.parent_id, groups.code,
        groups.semantic_key, groups.template_group_key
      from public.account_groups groups
      where groups.id = candidate.group_id and groups.tenant_id = p_tenant_id
      union all
      select parent.id, parent.parent_id, parent.code,
        parent.semantic_key, parent.template_group_key
      from public.account_groups parent
      join ancestry child on child.parent_id = parent.id
      where parent.tenant_id = p_tenant_id
    )
    select 1 from ancestry
    where code = 'CASH'
       or semantic_key = 'liquidity_resources'
       or template_group_key = 'liquidity_resources'
  ) then
    raise exception using errcode = '23514',
      message = 'MONEY_DESTINATION_LEGACY_CUSTODY_INCOMPATIBLE';
  end if;

  if current_mapping.id is not null and (
       current_mapping.disposition in ('DEPRECATE', 'SPLIT_FUTURE')
       or current_mapping.canonical_account_type not in ('liquidity')
       or current_mapping.statement_section not in ('balance_sheet')
       or current_mapping.reporting_category not in ('cash_and_cash_equivalents')
       or current_mapping.normal_balance not in ('debit')
       or current_mapping.target_open_item_reconcile is true
       or current_mapping.target_statement_reconcile is true
       or (current_mapping.requires_owner_decision
           and not public.is_current_tenant_owner(p_tenant_id))
     ) then
    raise exception using errcode = '23514',
      message = 'MONEY_DESTINATION_LEGACY_CUSTODY_INCOMPATIBLE';
  end if;

  if exists (
      select 1 from public.account_functional_accounts configuration
      where configuration.tenant_id = p_tenant_id
        and configuration.account_id = candidate.id and configuration.is_active
    ) or exists (
      select 1 from public.account_journals journal
      where journal.tenant_id = p_tenant_id and candidate.id in (
        journal.default_account_id, journal.outstanding_receipts_account_id,
        journal.outstanding_payments_account_id, journal.suspense_account_id,
        journal.profit_account_id, journal.loss_account_id
      )
    ) or exists (
      select 1 from public.financial_payment_method_settlement_configs configuration
      where configuration.tenant_id = p_tenant_id
        and candidate.id in (configuration.clearing_account_id, configuration.fee_account_id)
    ) or exists (
      select 1 from public.pos_payment_methods method
      where method.tenant_id = p_tenant_id and method.clearing_account_id = candidate.id
    ) or exists (
      select 1 from public.partners partner
      where partner.tenant_id = p_tenant_id
        and candidate.id in (partner.property_account_receivable_id, partner.property_account_payable_id)
    ) then
    raise exception using errcode = '23514',
      message = 'MONEY_DESTINATION_LEGACY_CUSTODY_INCOMPATIBLE';
  end if;

  if exists (
      select 1 from public.account_move_lines line
      where line.tenant_id = p_tenant_id and line.account_id = candidate.id
        and (line.partner_id is not null or line.line_type = 'open_item'
             or coalesce(line.amount_residual, 0) <> 0
             or coalesce(line.amount_residual_currency, 0) <> 0)
    ) or exists (
      select 1 from public.account_partial_reconcile reconciliation
      join public.account_move_lines debit_line on debit_line.id = reconciliation.debit_move_id
      join public.account_move_lines credit_line on credit_line.id = reconciliation.credit_move_id
      where debit_line.account_id = candidate.id or credit_line.account_id = candidate.id
    ) or (
      destination.branch_id is not null and exists (
        select 1 from public.account_move_lines line
        join public.account_moves move
          on move.id = line.move_id and move.tenant_id = line.tenant_id
        where line.tenant_id = p_tenant_id and line.account_id = candidate.id
          and move.branch_id is distinct from destination.branch_id
      )
    ) then
    raise exception using errcode = '23514',
      message = 'MONEY_DESTINATION_LEGACY_CUSTODY_INCOMPATIBLE';
  end if;

  select count(distinct line.move_id), count(*),
    coalesce(sum(line.debit), 0), coalesce(sum(line.credit), 0)
  into historical_move_count, historical_line_count,
    historical_debit, historical_credit
  from public.account_move_lines line
  where line.tenant_id = p_tenant_id and line.account_id = candidate.id;

  if current_mapping.id is not null then
    update public.account_legacy_mappings
    set effective_to = now()
    where id = current_mapping.id and effective_to is null;
  end if;

  insert into public.money_destination_account_adoptions (
    tenant_id, destination_id, account_id, responsible_user_id,
    legacy_mapping_id, previous_account_origin, previous_group_id,
    previous_code, previous_semantic_key, previous_canonical_account_type,
    previous_statement_section, previous_reporting_category,
    previous_normal_balance, previous_open_item_reconcile,
    previous_statement_reconcile, compatibility_evidence, actor_user_id
  ) values (
    p_tenant_id, destination.id, candidate.id, destination.responsible_user_id,
    current_mapping.id, candidate.account_origin, candidate.group_id,
    candidate.code, candidate.semantic_key, candidate.canonical_account_type,
    candidate.statement_section, candidate.reporting_category,
    candidate.normal_balance, candidate.open_item_reconcile,
    candidate.statement_reconcile,
    jsonb_build_object(
      'policy', 'employee_cash_custody_legacy_v1',
      'liquidity_group_ancestry', true,
      'historical_move_count', historical_move_count,
      'historical_line_count', historical_line_count,
      'historical_debit', historical_debit,
      'historical_credit', historical_credit,
      'owner_confirmation_required', coalesce(current_mapping.requires_owner_decision, false),
      'owner_confirmed', public.is_current_tenant_owner(p_tenant_id)
    ), actor_id
  );

  perform set_config('app.money_destination_account_adoption', destination.id::text, true);
  update public.account_accounts
  set account_origin = 'resource',
      money_destination_id = destination.id,
      canonical_account_type = 'liquidity',
      statement_section = 'balance_sheet',
      reporting_category = 'cash_and_cash_equivalents',
      normal_balance = 'debit',
      pnl_category = null,
      reconcile = false,
      open_item_reconcile = false,
      statement_reconcile = false,
      is_posting = true,
      semantic_key = 'money_destination_' || replace(destination.id::text, '-', '')
  where id = candidate.id and tenant_id = p_tenant_id;
  perform set_config('app.money_destination_account_adoption', '', true);

  return candidate.id;
end
$$;

revoke all on function public.adopt_legacy_employee_custody_account(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.provision_money_destination(
  p_tenant_id uuid,
  p_destination_id uuid,
  p_activate boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  destination public.money_destinations%rowtype;
  definition public.money_destination_types%rowtype;
  resource_account_id uuid;
  resource_journal_id uuid;
  resource_group_id uuid;
  resource_code text;
  account_name text;
  stable_identity text;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'money_destination:' || p_tenant_id::text || ':' || p_destination_id::text, 0
  ));
  select * into destination from public.money_destinations
  where id = p_destination_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'MONEY_DESTINATION_NOT_FOUND'; end if;

  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.destination.manage', null, null, destination.branch_id, true
  );
  if destination.status in ('inactive', 'archived') then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_NOT_PROVISIONABLE_IN_CURRENT_STATE';
  end if;

  select * into definition from public.money_destination_types
  where code = destination.destination_type and is_active;
  if not found then raise exception using errcode = '23514', message = 'MONEY_DESTINATION_TYPE_INVALID_OR_INACTIVE'; end if;

  if destination.destination_type = 'employee_cash_custody' then
    perform pg_advisory_xact_lock(hashtextextended(
      'money_destination_employee_custody:' || p_tenant_id::text || ':'
        || destination.responsible_user_id::text, 0
    ));
    if exists (
      select 1 from public.money_destinations existing
      where existing.tenant_id = p_tenant_id
        and existing.destination_type = 'employee_cash_custody'
        and existing.responsible_user_id = destination.responsible_user_id
        and existing.id <> destination.id
    ) then
      raise exception using errcode = '23514',
        message = 'MONEY_DESTINATION_EMPLOYEE_CUSTODY_ALREADY_EXISTS';
    end if;
  end if;

  if destination.ledger_account_id is not null or destination.journal_id is not null then
    if destination.ledger_account_id is null or destination.journal_id is null
       or not exists (select 1 from public.account_accounts a
         where a.id = destination.ledger_account_id and a.tenant_id = p_tenant_id
           and a.money_destination_id = destination.id and a.account_origin = 'resource')
       or not exists (select 1 from public.account_journals j
         where j.id = destination.journal_id and j.tenant_id = p_tenant_id
           and j.money_destination_id = destination.id and j.journal_origin = 'resource') then
      raise exception using errcode = '23514', message = 'MONEY_DESTINATION_PARTIAL_OR_INVALID_PROVISIONING_STATE';
    end if;
    if p_activate and destination.status <> 'active' then
      update public.money_destinations set status = 'active'
      where id = destination.id and tenant_id = destination.tenant_id;
    end if;
    return jsonb_build_object('destination_id', destination.id,
      'account_id', destination.ledger_account_id, 'journal_id', destination.journal_id,
      'status', case when p_activate then 'active' else destination.status end);
  end if;

  if destination.status = 'draft' then
    update public.money_destinations set status = 'configuring'
    where id = destination.id and tenant_id = destination.tenant_id;
  end if;

  if destination.destination_type = 'employee_cash_custody' then
    resource_account_id := public.adopt_legacy_employee_custody_account(
      destination.tenant_id, destination.id
    );
  end if;

  stable_identity := replace(destination.id::text, '-', '');
  if resource_account_id is null then
    resource_code := public.allocate_money_destination_account_code(
      destination.tenant_id, destination.destination_type
    );
    account_name := destination.name || ' [' || left(stable_identity, 8) || ']';
    select groups.id into resource_group_id from public.account_groups groups
    where groups.tenant_id = destination.tenant_id
      and groups.template_group_key = definition.account_group_key
    order by groups.id limit 1;

    insert into public.account_accounts (
      tenant_id, group_id, code, name, account_type, reconcile, active,
      responsible_user_id, canonical_account_type, statement_section,
      reporting_category, normal_balance, pnl_category, open_item_reconcile,
      statement_reconcile, is_posting, semantic_key, account_origin,
      money_destination_id
    ) values (
      destination.tenant_id, resource_group_id, resource_code, account_name, 'asset',
      definition.required_open_item_reconcile, true,
      case when destination.destination_type = 'employee_cash_custody'
        then destination.responsible_user_id end,
      definition.required_account_type, 'balance_sheet',
      definition.required_reporting_category, 'debit', null,
      definition.required_open_item_reconcile,
      definition.required_statement_reconcile, true,
      'money_destination_' || stable_identity, 'resource', destination.id
    ) returning id into resource_account_id;
  end if;

  insert into public.account_journals (
    tenant_id, branch_id, name, code, type, default_account_id,
    is_active, semantic_key, journal_origin, money_destination_id
  ) values (
    destination.tenant_id, destination.branch_id,
    destination.name || ' Journal [' || left(stable_identity, 8) || ']',
    'MD' || upper(left(stable_identity, 12)), definition.required_journal_type,
    resource_account_id, true, 'money_destination_' || stable_identity,
    'resource', destination.id
  ) returning id into resource_journal_id;

  update public.money_destinations
  set ledger_account_id = resource_account_id, journal_id = resource_journal_id,
      status = case when p_activate then 'active' else 'configuring' end
  where id = destination.id and tenant_id = destination.tenant_id;

  return jsonb_build_object('destination_id', destination.id,
    'account_id', resource_account_id, 'journal_id', resource_journal_id,
    'status', case when p_activate then 'active' else 'configuring' end,
    'account_provisioning', case when exists (
      select 1 from public.money_destination_account_adoptions adoption
      where adoption.tenant_id = destination.tenant_id
        and adoption.destination_id = destination.id
    ) then 'adopted' else 'created' end);
end
$$;

create or replace function public.create_and_provision_money_destination(
  p_tenant_id uuid, p_destination_key text, p_name text,
  p_destination_type text, p_branch_id uuid default null,
  p_responsible_user_id uuid default null, p_pos_config_id uuid default null,
  p_bank_name text default null, p_bank_account_label text default null,
  p_bank_identifier_masked text default null, p_metadata jsonb default '{}'::jsonb,
  p_activate boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  destination public.money_destinations%rowtype;
  result jsonb;
begin
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.destination.manage', null, null, p_branch_id, true
  );
  if p_destination_type = 'employee_cash_custody' then
    if p_responsible_user_id is null then
      raise exception using errcode = '23514',
        message = 'MONEY_DESTINATION_RESPONSIBLE_USER_REQUIRED';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'money_destination_employee_custody:' || p_tenant_id::text || ':'
        || p_responsible_user_id::text, 0
    ));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'money_destination_create:' || p_tenant_id::text || ':' || lower(btrim(p_destination_key)), 0
  ));

  select * into destination
  from public.money_destinations
  where tenant_id = p_tenant_id and destination_key = lower(btrim(p_destination_key))
  for update;

  if found then
    if destination.name is distinct from btrim(p_name)
       or destination.destination_type is distinct from p_destination_type
       or destination.branch_id is distinct from p_branch_id
       or destination.responsible_user_id is distinct from p_responsible_user_id
       or destination.pos_config_id is distinct from p_pos_config_id
       or destination.bank_name is distinct from nullif(btrim(p_bank_name), '')
       or destination.bank_account_label is distinct from nullif(btrim(p_bank_account_label), '')
       or destination.bank_identifier_masked is distinct from nullif(btrim(p_bank_identifier_masked), '')
       or destination.metadata is distinct from coalesce(p_metadata, '{}'::jsonb) then
      raise exception using errcode = '23505', message = 'MONEY_DESTINATION_IDEMPOTENCY_CONFLICT';
    end if;
    return public.provision_money_destination(p_tenant_id, destination.id, p_activate);
  end if;

  if p_destination_type = 'employee_cash_custody' and exists (
    select 1 from public.money_destinations existing
    where existing.tenant_id = p_tenant_id
      and existing.destination_type = 'employee_cash_custody'
      and existing.responsible_user_id = p_responsible_user_id
  ) then
    raise exception using errcode = '23514',
      message = 'MONEY_DESTINATION_EMPLOYEE_CUSTODY_ALREADY_EXISTS';
  end if;

  insert into public.money_destinations (
    tenant_id, destination_key, name, destination_type, status, branch_id,
    responsible_user_id, pos_config_id, bank_name, bank_account_label,
    bank_identifier_masked, metadata, created_by
  ) values (
    p_tenant_id, p_destination_key, p_name, p_destination_type, 'draft', p_branch_id,
    p_responsible_user_id, p_pos_config_id, p_bank_name, p_bank_account_label,
    p_bank_identifier_masked, coalesce(p_metadata, '{}'::jsonb),
    public.current_tenant_user_id()
  ) returning * into destination;

  result := public.provision_money_destination(p_tenant_id, destination.id, p_activate);
  insert into public.money_destination_events (
    tenant_id, destination_id, event_type, from_status, to_status, actor_user_id,
    metadata
  ) values (
    p_tenant_id, destination.id, 'created', null, result->>'status',
    public.current_tenant_user_id(),
    jsonb_build_object('account_provisioning', coalesce(result->>'account_provisioning', 'existing'))
  );
  return result;
end
$$;

revoke all on function public.provision_money_destination(uuid, uuid, boolean)
  from public, anon;
revoke all on function public.create_and_provision_money_destination(
  uuid, text, text, text, uuid, uuid, uuid, text, text, text, jsonb, boolean
) from public, anon;
grant execute on function public.provision_money_destination(uuid, uuid, boolean)
  to authenticated;
grant execute on function public.create_and_provision_money_destination(
  uuid, text, text, text, uuid, uuid, uuid, text, text, text, jsonb, boolean
) to authenticated;

comment on table public.money_destination_account_adoptions is
  'Immutable evidence for compatible legacy employee-custody accounts adopted without changing account identity or ledger history.';
comment on function public.adopt_legacy_employee_custody_account(uuid, uuid) is
  'Internal fail-closed compatibility and adoption contract for one active legacy employee custody account.';

commit;
