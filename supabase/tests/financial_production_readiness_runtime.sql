begin;

create temporary table phase10b5_context as
select owner.tenant_id, owner.auth_user_id owner_auth,
  (select auth_user_id from public.tenant_users member
   where member.tenant_id=owner.tenant_id and member.is_active and member.role<>'owner'
     and member.auth_user_id is not null order by member.id limit 1) member_auth
from public.tenant_users owner
where owner.role='owner' and owner.is_active and owner.auth_user_id is not null
order by (owner.tenant_id='10b40000-0000-4000-8000-000000000002'::uuid) desc, owner.tenant_id limit 1;

do $$ begin if not exists(select 1 from phase10b5_context) then raise exception 'PHASE10B5_CONTEXT_MISSING'; end if; end $$;
grant select on phase10b5_context to authenticated;

select set_config('request.jwt.claim.sub',owner_auth::text,true) from phase10b5_context;
set local role authenticated;

do $$
declare c phase10b5_context%rowtype; result jsonb;
begin
  select * into c from phase10b5_context;
  result:=public.get_financial_readiness(c.tenant_id);
  if result is null or not(result ? 'overall_ready') or not(result ? 'missing_requirements')
     or not(result ? 'warnings') then raise exception 'READINESS_SHAPE_INVALID'; end if;
end $$;

reset role;

do $$
declare c phase10b5_context%rowtype; other_tenant uuid;
begin
  select * into c from phase10b5_context;
  select id into other_tenant from public.tenants where id<>c.tenant_id order by id limit 1;
  if other_tenant is null then return; end if;
  perform set_config('request.jwt.claim.sub',c.owner_auth::text,true);
  set local role authenticated;
  begin
    perform public.get_financial_readiness(other_tenant);
    raise exception 'CROSS_TENANT_READINESS_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

do $$
declare c phase10b5_context%rowtype; result jsonb; functional_id uuid; journal_id uuid;
  destination_id uuid; method_id uuid; settlement_config_id uuid;
begin
  select * into c from phase10b5_context;
  if c.tenant_id<>'10b40000-0000-4000-8000-000000000002'::uuid then return; end if;

  select id into functional_id from public.account_functional_accounts
    where tenant_id=c.tenant_id and branch_id is null and is_active order by id limit 1;
  update public.account_functional_accounts set is_active=false where id=functional_id;
  perform set_config('request.jwt.claim.sub',c.owner_auth::text,true); set local role authenticated;
  result:=public.get_financial_readiness(c.tenant_id);
  if (result->>'functional_accounts_ready')::boolean
     or not result->'missing_requirements' @> '[{"code":"REQUIRED_FUNCTIONAL_ACCOUNTS_NOT_CONFIGURED","category":"CONFIGURATION"}]'::jsonb then
    raise exception 'FUNCTIONAL_READINESS_FAILURE_NOT_DIAGNOSED';
  end if;
  reset role; update public.account_functional_accounts set is_active=true where id=functional_id;

  select id into journal_id from public.account_journals
    where tenant_id=c.tenant_id and semantic_key='general_journal' and is_active limit 1;
  update public.account_journals set is_active=false where id=journal_id;
  perform set_config('request.jwt.claim.sub',c.owner_auth::text,true); set local role authenticated;
  result:=public.get_financial_readiness(c.tenant_id);
  if (result->>'journals_ready')::boolean then raise exception 'INACTIVE_JOURNAL_NOT_DIAGNOSED'; end if;
  reset role; update public.account_journals set is_active=true where id=journal_id;

  select id into destination_id from public.money_destinations
    where tenant_id=c.tenant_id and status='active' order by id limit 1;
  update public.money_destinations set status='inactive' where tenant_id=c.tenant_id and status='active';
  perform set_config('request.jwt.claim.sub',c.owner_auth::text,true); set local role authenticated;
  result:=public.get_financial_readiness(c.tenant_id);
  if (result->>'destinations_ready')::boolean then raise exception 'INACTIVE_DESTINATION_NOT_DIAGNOSED'; end if;
  reset role; update public.money_destinations set status='active' where tenant_id=c.tenant_id and status='inactive';

  select id into method_id from public.financial_payment_methods
    where tenant_id=c.tenant_id and is_active order by id limit 1;
  update public.financial_payment_methods set is_active=false where tenant_id=c.tenant_id and is_active;
  perform set_config('request.jwt.claim.sub',c.owner_auth::text,true); set local role authenticated;
  result:=public.get_financial_readiness(c.tenant_id);
  if (result->>'payment_methods_ready')::boolean then raise exception 'INACTIVE_PAYMENT_METHOD_NOT_DIAGNOSED'; end if;
  reset role; update public.financial_payment_methods set is_active=true where tenant_id=c.tenant_id and not is_active;

  select id into settlement_config_id from public.financial_payment_method_settlement_configs
    where tenant_id=c.tenant_id and is_active limit 1;
  if settlement_config_id is not null then
    update public.financial_payment_method_settlement_configs set is_active=false where id=settlement_config_id;
    perform set_config('request.jwt.claim.sub',c.owner_auth::text,true); set local role authenticated;
    result:=public.get_financial_readiness(c.tenant_id);
    if (result->>'clearing_ready')::boolean then raise exception 'INACTIVE_CLEARING_CONFIG_NOT_DIAGNOSED'; end if;
    reset role; update public.financial_payment_method_settlement_configs set is_active=true where id=settlement_config_id;
  end if;
end $$;

do $$
declare tenant_a uuid:=gen_random_uuid(); suffix text:=left(replace(gen_random_uuid()::text,'-',''),12);
  installation uuid; repeated uuid; required_count int; account_count int;
begin
  insert into public.tenants(id,name,slug) values(tenant_a,'Phase 10B.5 Clean Tenant','phase10b5-'||suffix);
  select id into installation from public.tenant_chart_template_installations
    where tenant_id=tenant_a and status='installed';
  repeated:=public.provision_tenant_canonical_chart(tenant_a,'general_trading',null);
  if repeated<>installation then raise exception 'CHART_REPROVISION_NOT_IDEMPOTENT'; end if;
  select count(*) into required_count from public.canonical_chart_template_accounts definition
    join public.canonical_chart_templates template on template.id=definition.template_id
    where template.status='active' and definition.provisioning_policy='required';
  select count(*) into account_count from public.account_accounts
    where tenant_id=tenant_a and account_origin='template';
  if account_count<>required_count then raise exception 'CLEAN_TENANT_REQUIRED_ACCOUNT_COUNT_INVALID'; end if;
  if exists(select 1 from public.account_accounts where tenant_id=tenant_a and account_origin='resource')
     or exists(select 1 from public.money_destinations where tenant_id=tenant_a)
     or exists(select 1 from public.financial_payment_methods where tenant_id=tenant_a)
     or exists(select 1 from public.account_journals where tenant_id=tenant_a and type in('cash','bank')) then
    raise exception 'CLEAN_TENANT_FABRICATED_OPERATIONAL_CONFIGURATION';
  end if;
end $$;

rollback;
