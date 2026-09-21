begin;

-- Phase 2 keeps the existing journal table as the single source of truth.
-- Existing posted moves are deliberately not backfilled: their journal context
-- cannot be inferred with certainty, and Phase 0 makes that history immutable.

alter table public.account_journals
  alter column code set not null;

alter table public.account_journals
  drop constraint if exists account_journals_code_not_blank,
  add constraint account_journals_code_not_blank check (btrim(code) <> '');

create unique index if not exists account_journals_id_tenant_uidx
  on public.account_journals (id, tenant_id);

create unique index if not exists account_journals_scope_code_uidx
  on public.account_journals (tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), upper(code));

alter table public.account_journals
  drop constraint if exists account_journals_branch_id_fkey,
  drop constraint if exists account_journals_default_account_id_fkey;

alter table public.account_journals
  add constraint account_journals_branch_tenant_fkey
    foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict,
  add constraint account_journals_default_account_tenant_fkey
    foreign key (default_account_id, tenant_id)
    references public.account_accounts (id, tenant_id) on delete restrict;

alter table public.account_moves
  drop constraint if exists account_moves_journal_id_fkey;

alter table public.account_moves
  add constraint account_moves_journal_tenant_fkey
    foreign key (journal_id, tenant_id)
    references public.account_journals (id, tenant_id) on delete restrict;

insert into public.account_journals (tenant_id, branch_id, name, code, type, is_active)
select distinct journal.tenant_id, null::uuid, 'القيود العامة', 'GEN', 'general', true
from public.account_journals journal
where not exists (
  select 1
  from public.account_journals existing
  where existing.tenant_id = journal.tenant_id
    and existing.branch_id is null
    and existing.type = 'general'
    and existing.is_active = true
);

create table public.account_functional_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid,
  functional_role text not null,
  account_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_functional_accounts_role_check check (
    functional_role in (
      'customer_receivable',
      'payment_entity_receivable',
      'sales_revenue',
      'default_cash',
      'default_bank',
      'legacy_customer_advance'
    )
  ),
  constraint account_functional_accounts_tenant_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint account_functional_accounts_branch_tenant_fkey
    foreign key (branch_id, tenant_id) references public.branches(id, tenant_id) on delete cascade,
  constraint account_functional_accounts_account_tenant_fkey
    foreign key (account_id, tenant_id) references public.account_accounts(id, tenant_id) on delete restrict
);

create unique index account_functional_accounts_scope_role_uidx
  on public.account_functional_accounts (
    tenant_id,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    functional_role
  ) where is_active;

create index account_functional_accounts_account_idx
  on public.account_functional_accounts (tenant_id, account_id);

insert into public.account_functional_accounts (tenant_id, functional_role, account_id)
select account.tenant_id, mapping.functional_role, account.id
from public.account_accounts account
join (values
  ('114001'::text, 'customer_receivable'::text),
  ('114002'::text, 'payment_entity_receivable'::text),
  ('411000'::text, 'sales_revenue'::text),
  ('111001'::text, 'default_cash'::text),
  ('112001'::text, 'default_bank'::text),
  ('212001'::text, 'legacy_customer_advance'::text)
) mapping(account_code, functional_role)
  on mapping.account_code = account.code::text
where account.active = true
on conflict do nothing;

create or replace function public.resolve_functional_account(
  p_tenant_id uuid,
  p_functional_role text,
  p_branch_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved_account_id uuid;
begin
  select config.account_id
  into resolved_account_id
  from public.account_functional_accounts config
  join public.account_accounts account
    on account.id = config.account_id
   and account.tenant_id = config.tenant_id
   and account.active = true
  where config.tenant_id = p_tenant_id
    and config.functional_role = p_functional_role
    and config.is_active = true
    and (config.branch_id = p_branch_id or config.branch_id is null)
  order by (config.branch_id = p_branch_id) desc
  limit 1;

  if resolved_account_id is null then
    raise exception using errcode = '23514',
      message = format('FUNCTIONAL_ACCOUNT_NOT_CONFIGURED: %s', p_functional_role);
  end if;
  return resolved_account_id;
end
$$;

create or replace function public.resolve_financial_journal(
  p_tenant_id uuid,
  p_journal_type text,
  p_branch_id uuid default null,
  p_default_account_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved_journal_id uuid;
begin
  if p_journal_type not in ('sale', 'purchase', 'cash', 'bank', 'general') then
    raise exception using errcode = '22023', message = 'INVALID_JOURNAL_TYPE';
  end if;

  select journal.id
  into resolved_journal_id
  from public.account_journals journal
  where journal.tenant_id = p_tenant_id
    and journal.type = p_journal_type
    and journal.is_active = true
    and (journal.branch_id = p_branch_id or journal.branch_id is null)
    and (p_default_account_id is null or journal.default_account_id = p_default_account_id)
  order by
    (journal.branch_id = p_branch_id) desc,
    (journal.default_account_id = p_default_account_id) desc,
    journal.code,
    journal.id
  limit 1;

  -- Account-specific lookup is strict. This prevents silently attaching a cash
  -- or bank event to a journal for a different financial resource.
  if resolved_journal_id is null then
    raise exception using errcode = '23514',
      message = format('FINANCIAL_JOURNAL_NOT_CONFIGURED: %s', p_journal_type);
  end if;
  return resolved_journal_id;
end
$$;

create or replace function public.enforce_account_journal_configuration()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.code := upper(btrim(new.code));
  if new.branch_id is not null and not exists (
    select 1 from public.branches branch
    where branch.id = new.branch_id
      and branch.tenant_id = new.tenant_id
      and branch.is_active = true
  ) then
    raise exception using errcode = '23514', message = 'JOURNAL_BRANCH_INVALID';
  end if;
  if new.default_account_id is not null and not exists (
    select 1 from public.account_accounts account
    where account.id = new.default_account_id
      and account.tenant_id = new.tenant_id
      and account.active = true
  ) then
    raise exception using errcode = '23514', message = 'JOURNAL_DEFAULT_ACCOUNT_INVALID';
  end if;
  if new.type in ('cash', 'bank') and new.default_account_id is null then
    raise exception using errcode = '23514', message = 'LIQUIDITY_JOURNAL_REQUIRES_DEFAULT_ACCOUNT';
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists account_journals_configuration_guard on public.account_journals;
create trigger account_journals_configuration_guard
before insert or update on public.account_journals
for each row execute function public.enforce_account_journal_configuration();

create or replace function public.enforce_move_journal()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  required_journal_type text;
  selected_journal_type text;
begin
  if new.state <> 'posted' then
    return new;
  end if;

  required_journal_type := case
    when new.move_type in ('sale', 'refund') then 'sale'
    when new.move_type = 'purchase' then 'purchase'
    when new.move_type in ('journal', 'opening') then 'general'
    when new.move_type in ('cash_in', 'cash_out') then 'cash'
    when new.move_type = 'payment' and lower(coalesce(new.pay_method, '')) = 'cash' then 'cash'
    when new.move_type = 'payment' then 'general'
    else null
  end;

  if new.journal_id is null then
    new.journal_id := public.resolve_financial_journal(
      new.tenant_id, required_journal_type, new.branch_id, null
    );
  end if;

  select journal.type
  into selected_journal_type
  from public.account_journals journal
  where journal.id = new.journal_id
    and journal.tenant_id = new.tenant_id
    and journal.is_active = true
    and (journal.branch_id is null or journal.branch_id = new.branch_id);

  if selected_journal_type is null then
    raise exception using errcode = '23514', message = 'MOVE_JOURNAL_INVALID_OR_INACTIVE';
  end if;

  if required_journal_type in ('sale', 'purchase', 'general')
     and selected_journal_type <> required_journal_type then
    raise exception using errcode = '23514', message = 'MOVE_JOURNAL_TYPE_MISMATCH';
  end if;
  if required_journal_type = 'cash'
     and selected_journal_type not in ('cash', 'bank') then
    raise exception using errcode = '23514', message = 'LIQUIDITY_MOVE_JOURNAL_TYPE_MISMATCH';
  end if;
  return new;
end
$$;

drop trigger if exists account_moves_journal_guard on public.account_moves;
create trigger account_moves_journal_guard
before insert or update of state, journal_id, tenant_id, branch_id, move_type, pay_method
on public.account_moves
for each row execute function public.enforce_move_journal();

create or replace function public.save_account_journal(
  p_tenant_id uuid,
  p_journal_id uuid,
  p_name text,
  p_code text,
  p_type text,
  p_branch_id uuid default null,
  p_default_account_id uuid default null,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_journal_id uuid;
begin
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.journal.manage', null, null, p_branch_id, true
  );

  if p_journal_id is null then
    insert into public.account_journals (
      tenant_id, branch_id, name, code, type, default_account_id, is_active
    ) values (
      p_tenant_id, p_branch_id, btrim(p_name), p_code, p_type,
      p_default_account_id, p_is_active
    ) returning id into saved_journal_id;
  else
    if exists (
      select 1 from public.account_moves move
      where move.journal_id = p_journal_id
        and move.tenant_id = p_tenant_id
    ) and exists (
      select 1 from public.account_journals journal
      where journal.id = p_journal_id
        and journal.tenant_id = p_tenant_id
        and (journal.type <> p_type or journal.branch_id is distinct from p_branch_id)
    ) then
      raise exception using errcode = '23514', message = 'USED_JOURNAL_CONTEXT_IS_IMMUTABLE';
    end if;

    update public.account_journals journal
    set name = btrim(p_name),
        code = p_code,
        type = p_type,
        branch_id = p_branch_id,
        default_account_id = p_default_account_id,
        is_active = p_is_active
    where journal.id = p_journal_id
      and journal.tenant_id = p_tenant_id
    returning journal.id into saved_journal_id;

    if saved_journal_id is null then
      raise exception using errcode = 'P0002', message = 'JOURNAL_NOT_FOUND';
    end if;
  end if;
  return saved_journal_id;
end
$$;

create or replace function public.set_functional_account_configuration(
  p_tenant_id uuid,
  p_functional_role text,
  p_account_id uuid,
  p_branch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  config_id uuid;
begin
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.journal.manage', null, null, p_branch_id, true
  );
  if not exists (
    select 1 from public.account_accounts account
    where account.id = p_account_id
      and account.tenant_id = p_tenant_id
      and account.active = true
  ) then
    raise exception using errcode = '23514', message = 'FUNCTIONAL_ACCOUNT_INVALID';
  end if;

  update public.account_functional_accounts config
  set is_active = false, updated_at = now()
  where config.tenant_id = p_tenant_id
    and config.functional_role = p_functional_role
    and config.branch_id is not distinct from p_branch_id
    and config.is_active;

  insert into public.account_functional_accounts (
    tenant_id, branch_id, functional_role, account_id
  ) values (
    p_tenant_id, p_branch_id, p_functional_role, p_account_id
  ) returning id into config_id;
  return config_id;
end
$$;

alter table public.account_functional_accounts enable row level security;

create policy account_functional_accounts_tenant_read
on public.account_functional_accounts
for select to authenticated
using (public.is_tenant_member(tenant_id));

drop policy if exists phase1_tenant_member_all on public.account_journals;
create policy account_journals_tenant_read
on public.account_journals
for select to authenticated
using (public.is_tenant_member(tenant_id));

revoke all on table public.account_journals from anon, authenticated;
grant select on table public.account_journals to authenticated;
revoke all on table public.account_functional_accounts from anon, authenticated;
grant select on table public.account_functional_accounts to authenticated;

revoke all on function public.resolve_functional_account(uuid, text, uuid) from public, anon;
revoke all on function public.resolve_financial_journal(uuid, text, uuid, uuid) from public, anon;
revoke all on function public.save_account_journal(uuid, uuid, text, text, text, uuid, uuid, boolean) from public, anon;
revoke all on function public.set_functional_account_configuration(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.resolve_functional_account(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.resolve_financial_journal(uuid, text, uuid, uuid) to authenticated, service_role;
grant execute on function public.save_account_journal(uuid, uuid, text, text, text, uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.set_functional_account_configuration(uuid, text, uuid, uuid) to authenticated, service_role;

comment on table public.account_functional_accounts is
  'Canonical tenant/branch functional account configuration. Initial rows adapt legacy account codes; new financial core code resolves roles, not codes.';
comment on function public.resolve_financial_journal(uuid, text, uuid, uuid) is
  'Canonical branch-aware journal resolver. Prefers branch scope and falls back to the tenant-wide journal.';

commit;
