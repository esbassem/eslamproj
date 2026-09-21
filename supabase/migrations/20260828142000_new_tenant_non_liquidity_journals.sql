begin;

alter table public.account_journals
  add column semantic_key text,
  add column journal_origin text not null default 'legacy',
  add constraint account_journals_semantic_key_format_check
    check (semantic_key is null or semantic_key ~ '^[a-z][a-z0-9_]*$'),
  add constraint account_journals_origin_check
    check (journal_origin in ('legacy', 'template', 'manual', 'resource')),
  add constraint account_journals_template_identity_check
    check (journal_origin <> 'template' or semantic_key is not null);

create unique index account_journals_semantic_scope_uidx
  on public.account_journals (
    tenant_id,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    semantic_key
  ) where semantic_key is not null;

create or replace function public.sync_installed_template_non_liquidity_journals()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status <> 'installed' then return new; end if;

  insert into public.account_journals (
    tenant_id, branch_id, name, code, type, default_account_id,
    is_active, semantic_key, journal_origin
  )
  select new.tenant_id, null, definition.name, definition.code,
         definition.type, null, true, definition.semantic_key, 'template'
  from (values
    ('general_journal'::text, 'General Journal'::text, 'GEN'::text, 'general'::text),
    ('sales_journal'::text, 'Sales Journal'::text, 'SAL'::text, 'sale'::text),
    ('purchase_journal'::text, 'Purchase Journal'::text, 'PUR'::text, 'purchase'::text)
  ) definition(semantic_key, name, code, type)
  where not exists (
    select 1 from public.account_journals existing
    where existing.tenant_id = new.tenant_id
      and existing.branch_id is null
      and existing.semantic_key = definition.semantic_key
  );
  return new;
end
$$;

create trigger tenant_chart_installation_non_liquidity_journal_sync
after insert or update of status on public.tenant_chart_template_installations
for each row execute function public.sync_installed_template_non_liquidity_journals();

comment on column public.account_journals.semantic_key is
  'Stable tenant journal identity. Journal codes remain display/reference values, never accounting behavior.';
comment on function public.sync_installed_template_non_liquidity_journals() is
  'Provisions only General, Sales, and Purchase journals. Liquidity journals require a real Money Destination.';

commit;
