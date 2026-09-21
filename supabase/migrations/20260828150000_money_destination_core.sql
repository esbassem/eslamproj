begin;

create table public.money_destination_types (
  code text primary key,
  name text not null,
  requires_responsible_user boolean not null default false,
  allows_responsible_user boolean not null default false,
  allows_pos_config boolean not null default false,
  requires_bank_metadata boolean not null default false,
  required_account_type text not null,
  required_reporting_category text not null,
  required_open_item_reconcile boolean not null default false,
  required_journal_type text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint money_destination_types_code_format_check
    check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint money_destination_types_journal_type_check
    check (required_journal_type in ('cash', 'bank'))
);

insert into public.money_destination_types (
  code, name, requires_responsible_user, allows_responsible_user,
  allows_pos_config, requires_bank_metadata, required_account_type,
  required_reporting_category, required_open_item_reconcile,
  required_journal_type
)
values
  ('cashbox', 'Cashbox', false, true, false, false,
    'liquidity', 'cash_and_cash_equivalents', false, 'cash'),
  ('bank', 'Bank Account', false, false, false, true,
    'liquidity', 'cash_and_cash_equivalents', false, 'bank'),
  ('employee_cash_custody', 'Employee Cash Custody', true, true, false, false,
    'current_asset', 'other_receivables', true, 'cash'),
  ('pos_drawer', 'POS Drawer', false, true, true, false,
    'liquidity', 'cash_and_cash_equivalents', false, 'cash'),
  ('wallet', 'Wallet', false, false, false, false,
    'liquidity', 'cash_and_cash_equivalents', false, 'bank');

create table public.money_destinations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  destination_key text not null,
  name text not null,
  destination_type text not null,
  status text not null default 'draft',
  branch_id uuid,
  responsible_user_id uuid,
  pos_config_id uuid,
  ledger_account_id uuid,
  journal_id uuid,
  bank_name text,
  bank_account_label text,
  bank_identifier_masked text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint money_destinations_tenant_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint money_destinations_type_fkey
    foreign key (destination_type) references public.money_destination_types(code) on delete restrict,
  constraint money_destinations_branch_fkey
    foreign key (branch_id, tenant_id) references public.branches(id, tenant_id) on delete restrict,
  constraint money_destinations_responsible_user_fkey
    foreign key (responsible_user_id, tenant_id) references public.tenant_users(id, tenant_id) on delete restrict,
  constraint money_destinations_pos_config_fkey
    foreign key (pos_config_id, tenant_id, branch_id) references public.pos_configs(id, tenant_id, branch_id) on delete restrict,
  constraint money_destinations_ledger_account_fkey
    foreign key (ledger_account_id, tenant_id) references public.account_accounts(id, tenant_id) on delete restrict,
  constraint money_destinations_journal_fkey
    foreign key (journal_id, tenant_id) references public.account_journals(id, tenant_id) on delete restrict,
  constraint money_destinations_created_by_fkey
    foreign key (created_by, tenant_id) references public.tenant_users(id, tenant_id) on delete set null,
  constraint money_destinations_key_format_check
    check (destination_key ~ '^[a-z][a-z0-9_]*$'),
  constraint money_destinations_name_not_blank check (btrim(name) <> ''),
  constraint money_destinations_status_check
    check (status in ('draft', 'configuring', 'active', 'inactive', 'archived')),
  constraint money_destinations_pos_requires_branch
    check (pos_config_id is null or branch_id is not null),
  constraint money_destinations_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint money_destinations_bank_fields_check check (
    destination_type = 'bank'
    or (bank_name is null and bank_account_label is null and bank_identifier_masked is null)
  )
);

create unique index money_destinations_scope_key_uidx
  on public.money_destinations (tenant_id, destination_key);
create unique index money_destinations_ledger_account_uidx
  on public.money_destinations (tenant_id, ledger_account_id)
  where ledger_account_id is not null;
create unique index money_destinations_pos_config_uidx
  on public.money_destinations (tenant_id, pos_config_id)
  where pos_config_id is not null;
create index money_destinations_scope_status_idx
  on public.money_destinations (tenant_id, status, destination_type);
create index money_destinations_responsible_user_idx
  on public.money_destinations (tenant_id, responsible_user_id)
  where responsible_user_id is not null;

create or replace function public.validate_money_destination()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  definition public.money_destination_types%rowtype;
  account public.account_accounts%rowtype;
  journal public.account_journals%rowtype;
  has_financial_use boolean := false;
begin
  new.destination_key := lower(btrim(new.destination_key));
  new.name := btrim(new.name);
  new.bank_name := nullif(btrim(new.bank_name), '');
  new.bank_account_label := nullif(btrim(new.bank_account_label), '');
  new.bank_identifier_masked := nullif(btrim(new.bank_identifier_masked), '');
  new.updated_at := now();

  select * into definition
  from public.money_destination_types
  where code = new.destination_type and is_active;
  if not found then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_TYPE_INVALID_OR_INACTIVE';
  end if;

  if definition.requires_responsible_user and new.responsible_user_id is null then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_RESPONSIBLE_USER_REQUIRED';
  end if;
  if not definition.allows_responsible_user and new.responsible_user_id is not null then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_RESPONSIBLE_USER_NOT_ALLOWED';
  end if;
  if not definition.allows_pos_config and new.pos_config_id is not null then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_POS_CONFIG_NOT_ALLOWED';
  end if;
  if definition.requires_bank_metadata
     and new.status = 'active'
     and (new.bank_name is null or new.bank_account_label is null) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_BANK_METADATA_REQUIRED';
  end if;

  if new.responsible_user_id is not null and not exists (
    select 1 from public.tenant_users u
    where u.id = new.responsible_user_id and u.tenant_id = new.tenant_id and u.is_active
  ) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_RESPONSIBLE_USER_INVALID_OR_INACTIVE';
  end if;
  if new.branch_id is not null and not exists (
    select 1 from public.branches b
    where b.id = new.branch_id and b.tenant_id = new.tenant_id and b.is_active
  ) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_BRANCH_INVALID_OR_INACTIVE';
  end if;
  if new.pos_config_id is not null and not exists (
    select 1 from public.pos_configs p
    where p.id = new.pos_config_id and p.tenant_id = new.tenant_id
      and p.branch_id = new.branch_id and p.is_active
  ) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_POS_CONFIG_INVALID_OR_INACTIVE';
  end if;

  if new.ledger_account_id is not null then
    select * into account from public.account_accounts a
    where a.id = new.ledger_account_id and a.tenant_id = new.tenant_id;
    if not found or not account.active or not account.is_posting
       or account.account_origin <> 'resource'
       or account.canonical_account_type is distinct from definition.required_account_type
       or account.reporting_category is distinct from definition.required_reporting_category
       or account.normal_balance is distinct from 'debit'
       or account.open_item_reconcile is distinct from definition.required_open_item_reconcile then
      raise exception using errcode = '23514', message = 'MONEY_DESTINATION_LEDGER_ACCOUNT_INCOMPATIBLE';
    end if;
  end if;

  if new.journal_id is not null then
    select * into journal from public.account_journals j
    where j.id = new.journal_id and j.tenant_id = new.tenant_id;
    if not found or not journal.is_active
       or journal.type <> definition.required_journal_type
       or journal.default_account_id is distinct from new.ledger_account_id
       or (journal.branch_id is not null and journal.branch_id is distinct from new.branch_id) then
      raise exception using errcode = '23514', message = 'MONEY_DESTINATION_JOURNAL_INCOMPATIBLE';
    end if;
  end if;

  if new.status = 'active' and (new.ledger_account_id is null or new.journal_id is null) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_ACTIVE_REQUIRES_LEDGER_ACCOUNT_AND_JOURNAL';
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception using errcode = '23514', message = 'MONEY_DESTINATION_TENANT_IMMUTABLE';
    end if;
    if old.ledger_account_id is not null then
      select exists (
        select 1 from public.account_move_lines l
        join public.account_moves m on m.id = l.move_id and m.tenant_id = l.tenant_id
        where l.account_id = old.ledger_account_id and m.state = 'posted'
      ) into has_financial_use;
    end if;
    if (old.status = 'active' or has_financial_use) and (
      new.destination_type is distinct from old.destination_type
      or new.branch_id is distinct from old.branch_id
      or new.responsible_user_id is distinct from old.responsible_user_id
      or new.pos_config_id is distinct from old.pos_config_id
      or new.ledger_account_id is distinct from old.ledger_account_id
      or new.journal_id is distinct from old.journal_id
    ) then
      raise exception using errcode = '23514', message = 'MONEY_DESTINATION_ACCOUNTING_IDENTITY_IMMUTABLE';
    end if;
    if old.status = 'archived' and new.status <> 'archived' then
      raise exception using errcode = '23514', message = 'MONEY_DESTINATION_ARCHIVE_FINAL';
    end if;
  end if;
  return new;
end
$$;

create trigger money_destinations_validation_guard
before insert or update on public.money_destinations
for each row execute function public.validate_money_destination();

create or replace function public.guard_money_destination_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status not in ('draft', 'configuring') or exists (
    select 1 from public.account_move_lines l
    join public.account_moves m on m.id = l.move_id and m.tenant_id = l.tenant_id
    where l.account_id = old.ledger_account_id and m.state = 'posted'
  ) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_DELETE_REQUIRES_UNUSED_DRAFT';
  end if;
  return old;
end
$$;

create trigger money_destinations_delete_guard
before delete on public.money_destinations
for each row execute function public.guard_money_destination_delete();

create or replace function public.guard_active_money_destination_dependencies()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_table_name = 'account_accounts' then
    if exists (
      select 1 from public.money_destinations d
      where d.ledger_account_id = old.id and d.tenant_id = old.tenant_id and d.status = 'active'
    ) and (
      not new.active or not new.is_posting
      or new.account_origin <> 'resource'
      or new.canonical_account_type is distinct from old.canonical_account_type
      or new.reporting_category is distinct from old.reporting_category
      or new.normal_balance is distinct from old.normal_balance
      or new.open_item_reconcile is distinct from old.open_item_reconcile
    ) then
      raise exception using errcode = '23514', message = 'ACTIVE_MONEY_DESTINATION_ACCOUNT_CONFIGURATION_IMMUTABLE';
    end if;
  end if;
  if tg_table_name = 'account_journals' then
    if exists (
      select 1 from public.money_destinations d
      where d.journal_id = old.id and d.tenant_id = old.tenant_id and d.status = 'active'
    ) and (
      not new.is_active or new.type is distinct from old.type
      or new.default_account_id is distinct from old.default_account_id
      or new.branch_id is distinct from old.branch_id
    ) then
      raise exception using errcode = '23514', message = 'ACTIVE_MONEY_DESTINATION_JOURNAL_CONFIGURATION_IMMUTABLE';
    end if;
  end if;
  return new;
end
$$;

create trigger account_accounts_money_destination_guard
before update of active, is_posting, account_origin, canonical_account_type,
  reporting_category, normal_balance, open_item_reconcile
on public.account_accounts
for each row execute function public.guard_active_money_destination_dependencies();

create trigger account_journals_money_destination_guard
before update of is_active, type, default_account_id, branch_id
on public.account_journals
for each row execute function public.guard_active_money_destination_dependencies();

create or replace function public.has_money_destination_access(
  p_tenant_id uuid,
  p_destination_id uuid,
  p_access_type text,
  p_branch_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.money_destinations d
    where d.id = p_destination_id and d.tenant_id = p_tenant_id
      and d.status = 'active'
      and (p_branch_id is null or d.branch_id is null or d.branch_id = p_branch_id)
      and public.has_financial_resource_access(
        p_tenant_id, d.ledger_account_id, p_access_type, coalesce(p_branch_id, d.branch_id)
      )
  )
$$;

create or replace function public.save_money_destination(
  p_tenant_id uuid,
  p_destination_id uuid,
  p_destination_key text,
  p_name text,
  p_destination_type text,
  p_status text default 'draft',
  p_branch_id uuid default null,
  p_responsible_user_id uuid default null,
  p_pos_config_id uuid default null,
  p_ledger_account_id uuid default null,
  p_journal_id uuid default null,
  p_bank_name text default null,
  p_bank_account_label text default null,
  p_bank_identifier_masked text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_id uuid;
begin
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.destination.manage', null, null, p_branch_id, true
  );
  if p_destination_id is null then
    insert into public.money_destinations (
      tenant_id, destination_key, name, destination_type, status, branch_id,
      responsible_user_id, pos_config_id, ledger_account_id, journal_id,
      bank_name, bank_account_label, bank_identifier_masked, metadata, created_by
    ) values (
      p_tenant_id, p_destination_key, p_name, p_destination_type, p_status, p_branch_id,
      p_responsible_user_id, p_pos_config_id, p_ledger_account_id, p_journal_id,
      p_bank_name, p_bank_account_label, p_bank_identifier_masked,
      coalesce(p_metadata, '{}'::jsonb), public.current_tenant_user_id()
    ) returning id into saved_id;
  else
    update public.money_destinations set
      destination_key = p_destination_key, name = p_name,
      destination_type = p_destination_type, status = p_status,
      branch_id = p_branch_id, responsible_user_id = p_responsible_user_id,
      pos_config_id = p_pos_config_id, ledger_account_id = p_ledger_account_id,
      journal_id = p_journal_id, bank_name = p_bank_name,
      bank_account_label = p_bank_account_label,
      bank_identifier_masked = p_bank_identifier_masked,
      metadata = coalesce(p_metadata, '{}'::jsonb)
    where id = p_destination_id and tenant_id = p_tenant_id
    returning id into saved_id;
    if saved_id is null then
      raise exception using errcode = 'P0002', message = 'MONEY_DESTINATION_NOT_FOUND';
    end if;
  end if;
  return saved_id;
end
$$;

alter table public.money_destination_types enable row level security;
alter table public.money_destinations enable row level security;
revoke all on public.money_destination_types from public, anon, authenticated;
revoke all on public.money_destinations from public, anon, authenticated;
grant select on public.money_destination_types to authenticated;
grant select on public.money_destinations to authenticated;

create policy money_destination_types_read
on public.money_destination_types for select to authenticated
using (is_active);

create policy money_destinations_read
on public.money_destinations for select to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    public.has_permission('financial.destination.manage', tenant_id)
    or (ledger_account_id is not null and public.has_financial_resource_access(
      tenant_id, ledger_account_id, 'view', branch_id
    ))
  )
);

revoke all on function public.has_money_destination_access(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.save_money_destination(uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.has_money_destination_access(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.save_money_destination(uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb) to authenticated;

comment on table public.money_destinations is
  'Canonical money-resource identity. Balances are derived exclusively from posted ledger lines on ledger_account_id; this table stores no mutable balance.';
comment on column public.money_destinations.ledger_account_id is
  'Nullable while draft/configuring; active destinations require one unique compatible canonical resource account.';
comment on column public.money_destinations.bank_identifier_masked is
  'Display-only masked identifier. Credentials, secrets, and full bank account identifiers are prohibited.';
comment on function public.has_money_destination_access(uuid, uuid, text, uuid) is
  'Phase 3A compatibility bridge to the Phase 1 account-backed financial resource scope.';

commit;
