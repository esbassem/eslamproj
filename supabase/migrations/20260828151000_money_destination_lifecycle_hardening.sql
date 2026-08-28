begin;

alter table public.money_destinations
  add column activated_at timestamptz;

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

  select * into definition from public.money_destination_types
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
  if definition.requires_bank_metadata and new.status = 'active'
     and (new.bank_name is null or new.bank_account_label is null) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_BANK_METADATA_REQUIRED';
  end if;

  if new.responsible_user_id is not null and not exists (
    select 1 from public.tenant_users u where u.id = new.responsible_user_id
      and u.tenant_id = new.tenant_id and u.is_active
  ) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_RESPONSIBLE_USER_INVALID_OR_INACTIVE';
  end if;
  if new.branch_id is not null and not exists (
    select 1 from public.branches b where b.id = new.branch_id
      and b.tenant_id = new.tenant_id and b.is_active
  ) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_BRANCH_INVALID_OR_INACTIVE';
  end if;
  if new.pos_config_id is not null and not exists (
    select 1 from public.pos_configs p where p.id = new.pos_config_id
      and p.tenant_id = new.tenant_id and p.branch_id = new.branch_id and p.is_active
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

  if tg_op = 'INSERT' then
    if new.activated_at is not null then
      raise exception using errcode = '23514', message = 'MONEY_DESTINATION_ACTIVATED_AT_SYSTEM_MANAGED';
    end if;
    if new.status = 'active' then new.activated_at := now(); end if;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_TENANT_IMMUTABLE';
  end if;
  if new.activated_at is distinct from old.activated_at then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_ACTIVATED_AT_SYSTEM_MANAGED';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status in ('configuring', 'active', 'archived'))
    or (old.status = 'configuring' and new.status in ('draft', 'active', 'archived'))
    or (old.status = 'active' and new.status = 'inactive')
    or (old.status = 'inactive' and new.status in ('active', 'archived'))
  ) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_STATUS_TRANSITION_INVALID';
  end if;
  if old.activated_at is null and new.status = 'active' then new.activated_at := now(); end if;

  if old.ledger_account_id is not null then
    select exists (
      select 1 from public.account_move_lines l
      where l.account_id = old.ledger_account_id and l.tenant_id = old.tenant_id
    ) into has_financial_use;
  end if;
  if (old.activated_at is not null or old.status = 'active' or has_financial_use) and (
    new.destination_type is distinct from old.destination_type
    or new.branch_id is distinct from old.branch_id
    or new.responsible_user_id is distinct from old.responsible_user_id
    or new.pos_config_id is distinct from old.pos_config_id
    or new.ledger_account_id is distinct from old.ledger_account_id
    or new.journal_id is distinct from old.journal_id
  ) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_ACCOUNTING_IDENTITY_IMMUTABLE';
  end if;
  return new;
end
$$;

create or replace function public.guard_money_destination_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status not in ('draft', 'configuring') or old.activated_at is not null or exists (
    select 1 from public.account_move_lines l
    where l.account_id = old.ledger_account_id and l.tenant_id = old.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_DELETE_REQUIRES_NEVER_ACTIVATED_UNUSED_DRAFT';
  end if;
  return old;
end
$$;

comment on column public.money_destinations.activated_at is
  'System-managed first activation timestamp; once set, the destination accounting identity remains immutable.';

commit;
