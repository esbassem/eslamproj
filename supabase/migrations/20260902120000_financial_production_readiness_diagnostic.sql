begin;

create or replace function public.get_financial_readiness(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  chart_ready boolean;
  journals_ready boolean;
  functional_accounts_ready boolean;
  destinations_ready boolean;
  payment_methods_ready boolean;
  clearing_ready boolean;
  missing jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
begin
  if public.current_tenant_id() is distinct from p_tenant_id
     or not (
       public.is_current_tenant_owner(p_tenant_id)
       or public.has_permission('financial.audit.view', p_tenant_id)
       or public.has_permission('financial.destination.manage', p_tenant_id)
       or public.has_permission('financial.journal.manage', p_tenant_id)
       or public.has_permission('financial.payment_method.manage', p_tenant_id)
     ) then
    raise exception using errcode = '42501', message = 'FINANCIAL_READINESS_ACCESS_DENIED';
  end if;

  select exists (
    select 1
    from public.tenant_chart_template_installations installation
    join public.canonical_chart_templates template on template.id = installation.template_id
    where installation.tenant_id = p_tenant_id
      and installation.status = 'installed'
      and template.status = 'active'
  ) into chart_ready;

  select exists (
    select 1 from public.account_journals journal
    where journal.tenant_id = p_tenant_id and journal.semantic_key = 'general_journal'
      and journal.type = 'general' and journal.is_active
  ) into journals_ready;

  select not exists (
    select 1
    from public.canonical_chart_template_accounts definition
    join public.canonical_chart_templates template on template.id = definition.template_id
    where template.status = 'active' and definition.provisioning_policy = 'required'
      and definition.functional_role is not null
      and not exists (
        select 1
        from public.account_functional_accounts configuration
        join public.account_accounts account
          on account.id = configuration.account_id
         and account.tenant_id = configuration.tenant_id
        where configuration.tenant_id = p_tenant_id
          and configuration.branch_id is null
          and configuration.functional_role = definition.functional_role
          and configuration.is_active and account.active and account.is_posting
      )
  ) into functional_accounts_ready;

  select exists (
    select 1
    from public.money_destinations destination
    join public.account_accounts account
      on account.id = destination.ledger_account_id and account.tenant_id = destination.tenant_id
    join public.account_journals journal
      on journal.id = destination.journal_id and journal.tenant_id = destination.tenant_id
    where destination.tenant_id = p_tenant_id and destination.status = 'active'
      and account.active and account.is_posting and journal.is_active
      and journal.default_account_id = account.id
  ) into destinations_ready;

  select exists (
    select 1
    from public.financial_payment_methods method
    where method.tenant_id = p_tenant_id and method.is_active
      and (
        (method.settlement_mode = 'direct' and exists (
          select 1
          from public.money_destinations destination
          join public.financial_payment_method_destination_types compatibility
            on compatibility.method_type = method.method_type
           and compatibility.destination_type = destination.destination_type
          where destination.tenant_id = method.tenant_id and destination.status = 'active'
        ))
        or (method.settlement_mode = 'clearing' and exists (
          select 1
          from public.financial_payment_method_settlement_configs configuration
          join public.account_accounts clearing_account
            on clearing_account.id = configuration.clearing_account_id
           and clearing_account.tenant_id = configuration.tenant_id
          join public.account_journals clearing_journal
            on clearing_journal.id = configuration.clearing_journal_id
           and clearing_journal.tenant_id = configuration.tenant_id
          where configuration.tenant_id = method.tenant_id
            and configuration.payment_method_id = method.id and configuration.is_active
            and clearing_account.active and clearing_account.is_posting
            and clearing_account.open_item_reconcile and clearing_journal.is_active
            and clearing_journal.default_account_id = clearing_account.id
        ))
      )
  ) into payment_methods_ready;

  select not exists (
    select 1
    from public.financial_payment_methods method
    where method.tenant_id = p_tenant_id and method.is_active
      and method.settlement_mode = 'clearing'
      and not exists (
        select 1
        from public.financial_payment_method_settlement_configs configuration
        join public.account_accounts clearing_account
          on clearing_account.id = configuration.clearing_account_id
         and clearing_account.tenant_id = configuration.tenant_id
        join public.account_journals clearing_journal
          on clearing_journal.id = configuration.clearing_journal_id
         and clearing_journal.tenant_id = configuration.tenant_id
        where configuration.tenant_id = method.tenant_id
          and configuration.payment_method_id = method.id and configuration.is_active
          and clearing_account.active and clearing_account.is_posting
          and clearing_account.open_item_reconcile and clearing_journal.is_active
          and clearing_journal.default_account_id = clearing_account.id
      )
  ) into clearing_ready;

  if not chart_ready then missing := missing || jsonb_build_array(jsonb_build_object('code','CANONICAL_CHART_NOT_INSTALLED','category','CONFIGURATION')); end if;
  if not journals_ready then missing := missing || jsonb_build_array(jsonb_build_object('code','GENERAL_JOURNAL_NOT_CONFIGURED','category','CONFIGURATION')); end if;
  if not functional_accounts_ready then missing := missing || jsonb_build_array(jsonb_build_object('code','REQUIRED_FUNCTIONAL_ACCOUNTS_NOT_CONFIGURED','category','CONFIGURATION')); end if;
  if not destinations_ready then missing := missing || jsonb_build_array(jsonb_build_object('code','ACTIVE_MONEY_DESTINATION_REQUIRED','category','CONFIGURATION')); end if;
  if not payment_methods_ready then missing := missing || jsonb_build_array(jsonb_build_object('code','USABLE_PAYMENT_METHOD_REQUIRED','category','CONFIGURATION')); end if;
  if not clearing_ready then warnings := warnings || jsonb_build_array(jsonb_build_object('code','ENABLED_CLEARING_METHOD_NOT_READY','category','CONFIGURATION')); end if;

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'overall_ready', chart_ready and journals_ready and functional_accounts_ready
      and destinations_ready and payment_methods_ready and clearing_ready,
    'chart_ready', chart_ready,
    'journals_ready', journals_ready,
    'functional_accounts_ready', functional_accounts_ready,
    'destinations_ready', destinations_ready,
    'payment_methods_ready', payment_methods_ready,
    'clearing_ready', clearing_ready,
    'missing_requirements', missing,
    'warnings', warnings
  );
end
$$;

revoke all on function public.get_financial_readiness(uuid) from public, anon;
grant execute on function public.get_financial_readiness(uuid) to authenticated;

comment on function public.get_financial_readiness(uuid) is
  'Read-only, tenant-scoped Production readiness diagnostic. Optional features become blockers only when enabled.';

commit;
