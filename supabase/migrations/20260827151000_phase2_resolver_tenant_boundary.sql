begin;

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
  if auth.uid() is not null and not public.is_tenant_member(p_tenant_id) then
    raise exception using errcode = '42501', message = 'FUNCTIONAL_ACCOUNT_TENANT_ACCESS_DENIED';
  end if;

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
  if auth.uid() is not null and not public.is_tenant_member(p_tenant_id) then
    raise exception using errcode = '42501', message = 'JOURNAL_TENANT_ACCESS_DENIED';
  end if;

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

  if resolved_journal_id is null then
    raise exception using errcode = '23514',
      message = format('FINANCIAL_JOURNAL_NOT_CONFIGURED: %s', p_journal_type);
  end if;
  return resolved_journal_id;
end
$$;

revoke all on function public.resolve_functional_account(uuid, text, uuid) from public, anon;
revoke all on function public.resolve_financial_journal(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.resolve_functional_account(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.resolve_financial_journal(uuid, text, uuid, uuid) to authenticated, service_role;

commit;
