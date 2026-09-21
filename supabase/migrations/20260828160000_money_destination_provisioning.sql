begin;

alter table public.money_destination_types
  add column resource_template_account_key text,
  add column account_group_key text,
  add column account_code_min integer,
  add column account_code_max integer,
  add column required_statement_reconcile boolean not null default false;

update public.money_destination_types
set resource_template_account_key = case code
      when 'bank' then 'bank_account'
      when 'wallet' then 'wallet_account'
      else code
    end,
    account_group_key = case when code = 'employee_cash_custody'
      then 'receivables' else 'liquidity_resources' end,
    account_code_min = case code
      when 'cashbox' then 111100 when 'bank' then 111200
      when 'pos_drawer' then 111300 when 'wallet' then 111400
      when 'employee_cash_custody' then 121400 end,
    account_code_max = case code
      when 'cashbox' then 111199 when 'bank' then 111299
      when 'pos_drawer' then 111399 when 'wallet' then 111499
      when 'employee_cash_custody' then 121999 end,
    required_statement_reconcile = code in ('bank', 'wallet');

alter table public.money_destination_types
  alter column resource_template_account_key set not null,
  alter column account_group_key set not null,
  alter column account_code_min set not null,
  alter column account_code_max set not null,
  add constraint money_destination_types_code_range_check check (
    account_code_min between 100000 and 999999
    and account_code_max between account_code_min and 999999
  );

create unique index money_destinations_id_tenant_uidx
  on public.money_destinations (id, tenant_id);

alter table public.account_accounts add column money_destination_id uuid;
alter table public.account_journals add column money_destination_id uuid;

alter table public.account_accounts
  add constraint account_accounts_money_destination_fkey
    foreign key (money_destination_id, tenant_id)
    references public.money_destinations(id, tenant_id) on delete restrict;
alter table public.account_journals
  add constraint account_journals_money_destination_fkey
    foreign key (money_destination_id, tenant_id)
    references public.money_destinations(id, tenant_id) on delete restrict;

create unique index account_accounts_money_destination_uidx
  on public.account_accounts (tenant_id, money_destination_id)
  where money_destination_id is not null;
create unique index account_journals_money_destination_uidx
  on public.account_journals (tenant_id, money_destination_id)
  where money_destination_id is not null;

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
  if tg_op = 'UPDATE' and new.money_destination_id is distinct from old.money_destination_id then
    raise exception using errcode = '23514', message = 'RESOURCE_ACCOUNT_PROVENANCE_IMMUTABLE';
  end if;
  if current_user in ('anon', 'authenticated') and new.account_origin = 'resource' then
    raise exception using errcode = '42501', message = 'RESOURCE_ACCOUNT_CREATION_REQUIRES_PROVISIONING_CONTRACT';
  end if;
  return new;
end
$$;

create trigger account_accounts_money_destination_provenance_guard
before insert or update of money_destination_id, account_origin
on public.account_accounts
for each row execute function public.guard_money_destination_resource_provenance();

create or replace function public.guard_money_destination_journal_provenance()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.money_destination_id is not null and new.journal_origin <> 'resource' then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_JOURNAL_REQUIRES_RESOURCE_ORIGIN';
  end if;
  if new.journal_origin = 'resource' and new.money_destination_id is null then
    raise exception using errcode = '23514', message = 'RESOURCE_JOURNAL_REQUIRES_MONEY_DESTINATION_PROVENANCE';
  end if;
  if tg_op = 'UPDATE' and new.money_destination_id is distinct from old.money_destination_id then
    raise exception using errcode = '23514', message = 'RESOURCE_JOURNAL_PROVENANCE_IMMUTABLE';
  end if;
  if current_user in ('anon', 'authenticated') and new.journal_origin = 'resource' then
    raise exception using errcode = '42501', message = 'RESOURCE_JOURNAL_CREATION_REQUIRES_PROVISIONING_CONTRACT';
  end if;
  return new;
end
$$;

create trigger account_journals_money_destination_provenance_guard
before insert or update of money_destination_id, journal_origin
on public.account_journals
for each row execute function public.guard_money_destination_journal_provenance();

create or replace function public.validate_money_destination_provisioning_links()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.ledger_account_id is not null and not exists (
    select 1 from public.account_accounts account
    where account.id = new.ledger_account_id and account.tenant_id = new.tenant_id
      and account.money_destination_id = new.id and account.account_origin = 'resource'
  ) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_ACCOUNT_PROVENANCE_MISMATCH';
  end if;
  if new.journal_id is not null and not exists (
    select 1 from public.account_journals journal
    where journal.id = new.journal_id and journal.tenant_id = new.tenant_id
      and journal.money_destination_id = new.id and journal.journal_origin = 'resource'
  ) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_JOURNAL_PROVENANCE_MISMATCH';
  end if;
  return new;
end
$$;

create trigger money_destinations_provisioning_links_guard
before insert or update of tenant_id, ledger_account_id, journal_id
on public.money_destinations
for each row execute function public.validate_money_destination_provisioning_links();

create or replace function public.allocate_money_destination_account_code(
  p_tenant_id uuid,
  p_destination_type text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  definition public.money_destination_types%rowtype;
  allocated_code text;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'money_destination_code:' || p_tenant_id::text || ':' || p_destination_type, 0
  ));
  select * into definition from public.money_destination_types
  where code = p_destination_type and is_active;
  if not found then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_TYPE_INVALID_OR_INACTIVE';
  end if;
  select candidate::text into allocated_code
  from generate_series(definition.account_code_min, definition.account_code_max) candidate
  where not exists (
    select 1 from public.account_accounts account
    where account.tenant_id = p_tenant_id and account.code = candidate::text
  )
  order by candidate limit 1;
  if allocated_code is null then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_ACCOUNT_CODE_RANGE_EXHAUSTED';
  end if;
  return allocated_code;
end
$$;

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

  resource_code := public.allocate_money_destination_account_code(
    destination.tenant_id, destination.destination_type
  );
  stable_identity := replace(destination.id::text, '-', '');
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
    'status', case when p_activate then 'active' else 'configuring' end);
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
declare destination_id uuid;
begin
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.destination.manage', null, null, p_branch_id, true
  );
  insert into public.money_destinations (
    tenant_id, destination_key, name, destination_type, status, branch_id,
    responsible_user_id, pos_config_id, bank_name, bank_account_label,
    bank_identifier_masked, metadata, created_by
  ) values (
    p_tenant_id, p_destination_key, p_name, p_destination_type, 'draft', p_branch_id,
    p_responsible_user_id, p_pos_config_id, p_bank_name, p_bank_account_label,
    p_bank_identifier_masked, coalesce(p_metadata, '{}'::jsonb),
    public.current_tenant_user_id()
  ) returning id into destination_id;
  return public.provision_money_destination(p_tenant_id, destination_id, p_activate);
end
$$;

create or replace function public.rename_money_destination(
  p_tenant_id uuid, p_destination_id uuid, p_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare saved_id uuid; branch_scope uuid;
begin
  select branch_id into branch_scope from public.money_destinations
  where id = p_destination_id and tenant_id = p_tenant_id;
  if not found then raise exception using errcode = 'P0002', message = 'MONEY_DESTINATION_NOT_FOUND'; end if;
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.destination.manage', null, null, branch_scope, true
  );
  update public.money_destinations set name = p_name
  where id = p_destination_id and tenant_id = p_tenant_id returning id into saved_id;
  return saved_id;
end
$$;

revoke all on function public.allocate_money_destination_account_code(uuid, text) from public, anon, authenticated;
revoke all on function public.provision_money_destination(uuid, uuid, boolean) from public, anon;
revoke all on function public.create_and_provision_money_destination(uuid, text, text, text, uuid, uuid, uuid, text, text, text, jsonb, boolean) from public, anon;
revoke all on function public.rename_money_destination(uuid, uuid, text) from public, anon;
revoke execute on function public.save_money_destination(uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb) from authenticated;
grant execute on function public.provision_money_destination(uuid, uuid, boolean) to authenticated;
grant execute on function public.create_and_provision_money_destination(uuid, text, text, text, uuid, uuid, uuid, text, text, text, jsonb, boolean) to authenticated;
grant execute on function public.rename_money_destination(uuid, uuid, text) to authenticated;

comment on function public.provision_money_destination(uuid, uuid, boolean) is
  'Atomic, idempotent, concurrency-safe provisioning of one dedicated canonical resource account and journal for a Money Destination.';
comment on column public.account_accounts.money_destination_id is
  'Immutable resource provenance; populated only for accounts created by the Money Destination provisioning contract.';
comment on column public.account_journals.money_destination_id is
  'Immutable resource provenance; populated only for journals created by the Money Destination provisioning contract.';

commit;
