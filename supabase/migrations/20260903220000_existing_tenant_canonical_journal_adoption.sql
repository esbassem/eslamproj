begin;

create table public.canonical_journal_adoptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  journal_id uuid not null,
  semantic_key text not null,
  previous_semantic_key text,
  previous_journal_origin text not null,
  actor_kind text not null default 'system',
  actor_user_id uuid,
  adopted_at timestamptz not null default now(),
  constraint canonical_journal_adoptions_semantic_key_check
    check (semantic_key in ('general_journal', 'sales_journal', 'purchase_journal')),
  constraint canonical_journal_adoptions_actor_kind_check
    check (actor_kind in ('system', 'tenant_user')),
  constraint canonical_journal_adoptions_actor_consistency_check
    check ((actor_kind = 'system' and actor_user_id is null)
      or (actor_kind = 'tenant_user' and actor_user_id is not null)),
  constraint canonical_journal_adoptions_tenant_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint canonical_journal_adoptions_journal_tenant_fkey
    foreign key (journal_id, tenant_id)
    references public.account_journals(id, tenant_id) on delete restrict,
  constraint canonical_journal_adoptions_actor_tenant_fkey
    foreign key (actor_user_id, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint canonical_journal_adoptions_tenant_semantic_key
    unique (tenant_id, semantic_key),
  constraint canonical_journal_adoptions_tenant_journal
    unique (tenant_id, journal_id)
);

alter table public.canonical_journal_adoptions enable row level security;

create policy canonical_journal_adoptions_tenant_read
on public.canonical_journal_adoptions
for select to authenticated
using (public.is_tenant_member(tenant_id));

revoke all on table public.canonical_journal_adoptions from anon, authenticated;
grant select on table public.canonical_journal_adoptions to authenticated;

create or replace function public.ensure_tenant_canonical_foundation_journal(
  p_tenant_id uuid,
  p_semantic_key text,
  p_name text,
  p_code text,
  p_type text
)
returns table(journal_id uuid, provisioning_outcome text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  canonical_name text;
  canonical_code text;
  canonical_type text;
  semantic_match_count integer;
  code_match_count integer;
  candidate public.account_journals%rowtype;
  actor_id uuid := public.current_tenant_user_id();
begin
  select definition.name, definition.code, definition.type
  into canonical_name, canonical_code, canonical_type
  from (values
    ('general_journal'::text, 'General Journal'::text, 'GEN'::text, 'general'::text),
    ('sales_journal'::text, 'Sales Journal'::text, 'SAL'::text, 'sale'::text),
    ('purchase_journal'::text, 'Purchase Journal'::text, 'PUR'::text, 'purchase'::text)
  ) definition(semantic_key, name, code, type)
  where definition.semantic_key = p_semantic_key;

  if canonical_name is null
     or p_name is distinct from canonical_name
     or upper(btrim(p_code)) is distinct from canonical_code
     or p_type is distinct from canonical_type then
    raise exception using errcode = '22023',
      message = 'CANONICAL_FOUNDATION_JOURNAL_DEFINITION_INVALID';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception using errcode = 'P0002', message = 'TENANT_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('canonical_chart:' || p_tenant_id::text, 0)
  );

  select count(*) into semantic_match_count
  from public.account_journals journal
  where journal.tenant_id = p_tenant_id
    and journal.semantic_key = p_semantic_key;

  if semantic_match_count > 1 then
    raise exception using errcode = '23514',
      message = 'CANONICAL_JOURNAL_SEMANTIC_IDENTITY_AMBIGUOUS';
  end if;

  if semantic_match_count = 1 then
    select * into candidate
    from public.account_journals journal
    where journal.tenant_id = p_tenant_id
      and journal.semantic_key = p_semantic_key
    for update;

    if candidate.branch_id is not null then
      raise exception using errcode = '23514',
        message = 'CANONICAL_JOURNAL_BRANCH_SCOPE_CONFLICT';
    elsif not candidate.is_active then
      raise exception using errcode = '23514',
        message = 'CANONICAL_JOURNAL_INACTIVE';
    elsif candidate.type is distinct from canonical_type then
      raise exception using errcode = '23514',
        message = 'CANONICAL_JOURNAL_TYPE_CONFLICT';
    elsif upper(btrim(candidate.code)) is distinct from canonical_code then
      raise exception using errcode = '23514',
        message = 'CANONICAL_JOURNAL_CODE_CONFLICT';
    elsif candidate.default_account_id is not null
       or candidate.money_destination_id is not null then
      raise exception using errcode = '23514',
        message = 'CANONICAL_JOURNAL_CONFIGURATION_CONFLICT';
    end if;

    journal_id := candidate.id;
    provisioning_outcome := 'reused';
    return next;
    return;
  end if;

  select count(*) into code_match_count
  from public.account_journals journal
  where journal.tenant_id = p_tenant_id
    and upper(btrim(journal.code)) = canonical_code;

  if code_match_count > 1 then
    raise exception using errcode = '23514',
      message = 'CANONICAL_JOURNAL_CODE_CANDIDATE_AMBIGUOUS';
  end if;

  if code_match_count = 1 then
    select * into candidate
    from public.account_journals journal
    where journal.tenant_id = p_tenant_id
      and upper(btrim(journal.code)) = canonical_code
    for update;

    if candidate.branch_id is not null then
      raise exception using errcode = '23514',
        message = 'CANONICAL_JOURNAL_BRANCH_SCOPE_CONFLICT';
    elsif not candidate.is_active then
      raise exception using errcode = '23514',
        message = 'CANONICAL_JOURNAL_INACTIVE';
    elsif candidate.type is distinct from canonical_type then
      raise exception using errcode = '23514',
        message = 'CANONICAL_JOURNAL_TYPE_CONFLICT';
    elsif candidate.semantic_key is not null then
      raise exception using errcode = '23514',
        message = 'CANONICAL_JOURNAL_SEMANTIC_IDENTITY_CONFLICT';
    elsif candidate.journal_origin is distinct from 'legacy' then
      raise exception using errcode = '23514',
        message = 'CANONICAL_JOURNAL_ORIGIN_CONFLICT';
    elsif candidate.default_account_id is not null
       or candidate.money_destination_id is not null then
      raise exception using errcode = '23514',
        message = 'CANONICAL_JOURNAL_CONFIGURATION_CONFLICT';
    end if;

    update public.account_journals journal
    set semantic_key = p_semantic_key,
        journal_origin = 'template'
    where journal.id = candidate.id
      and journal.tenant_id = p_tenant_id;

    insert into public.canonical_journal_adoptions (
      tenant_id, journal_id, semantic_key, previous_semantic_key,
      previous_journal_origin, actor_kind, actor_user_id
    ) values (
      p_tenant_id, candidate.id, p_semantic_key, candidate.semantic_key,
      candidate.journal_origin,
      case when actor_id is null then 'system' else 'tenant_user' end,
      actor_id
    ) on conflict (tenant_id, semantic_key) do nothing;

    journal_id := candidate.id;
    provisioning_outcome := 'adopted';
    return next;
    return;
  end if;

  insert into public.account_journals (
    tenant_id, branch_id, name, code, type, default_account_id,
    is_active, semantic_key, journal_origin
  ) values (
    p_tenant_id, null, canonical_name, canonical_code, canonical_type, null,
    true, p_semantic_key, 'template'
  ) returning id into journal_id;

  provisioning_outcome := 'created';
  return next;
end
$$;

revoke all on function public.ensure_tenant_canonical_foundation_journal(
  uuid, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.sync_installed_template_non_liquidity_journals()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  definition record;
begin
  if new.status <> 'installed' then return new; end if;

  for definition in
    select * from (values
      ('general_journal'::text, 'General Journal'::text, 'GEN'::text, 'general'::text),
      ('sales_journal'::text, 'Sales Journal'::text, 'SAL'::text, 'sale'::text),
      ('purchase_journal'::text, 'Purchase Journal'::text, 'PUR'::text, 'purchase'::text)
    ) required_journal(semantic_key, name, code, type)
  loop
    perform public.ensure_tenant_canonical_foundation_journal(
      new.tenant_id, definition.semantic_key, definition.name,
      definition.code, definition.type
    );
  end loop;
  return new;
end
$$;

comment on table public.canonical_journal_adoptions is
  'Immutable provenance for compatible pre-existing journals adopted by canonical foundation provisioning.';
comment on function public.ensure_tenant_canonical_foundation_journal(uuid, text, text, text, text) is
  'Fail-closed, tenant-scoped canonical foundation journal reuse/adoption/creation. Never adopts liquidity journals or rewrites accounting history.';
comment on function public.sync_installed_template_non_liquidity_journals() is
  'Converges General, Sales, and Purchase foundation journals through strict reuse, compatible legacy adoption, or canonical creation.';

commit;
