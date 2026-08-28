begin;

create temporary table phase3c_context as
select owner_user.tenant_id, owner_user.id owner_user_id,
  owner_user.auth_user_id owner_auth_user_id,
  employee.id employee_user_id, employee.auth_user_id employee_auth_user_id,
  manager.id manager_user_id, manager.auth_user_id manager_auth_user_id
from public.tenant_users owner_user
join lateral (
  select candidate.* from public.tenant_users candidate
  where candidate.tenant_id=owner_user.tenant_id and candidate.is_active
    and candidate.role<>'owner' and candidate.auth_user_id is not null
    and not exists(select 1 from public.account_accounts account
      where account.tenant_id=candidate.tenant_id
        and account.responsible_user_id=candidate.id and account.active)
  order by candidate.id limit 1
) employee on true
join lateral (
  select candidate.* from public.tenant_users candidate
  where candidate.tenant_id=owner_user.tenant_id and candidate.is_active
    and candidate.role<>'owner' and candidate.auth_user_id is not null
    and candidate.id<>employee.id
  order by candidate.id limit 1
) manager on true
where owner_user.role='owner' and owner_user.is_active
  and owner_user.auth_user_id is not null
order by owner_user.tenant_id limit 1;

do $$ begin
  if not exists(select 1 from phase3c_context) then
    raise exception 'PHASE3C_AUTH_FIXTURE_UNAVAILABLE';
  end if;
end $$;

create temporary table phase3c_resources(
  branch_a uuid, branch_b uuid, cashbox_id uuid, cashbox_account uuid,
  bank_id uuid, bank_account uuid, custody_id uuid, custody_account uuid,
  branch_b_cashbox_id uuid, branch_b_cashbox_account uuid
);

do $$
declare c phase3c_context%rowtype; r phase3c_resources%rowtype;
  permission_group uuid; result jsonb; suffix text:=left(replace(gen_random_uuid()::text,'-',''),10);
begin
  select * into c from phase3c_context;
  r.branch_a:=gen_random_uuid(); r.branch_b:=gen_random_uuid();
  insert into public.branches(id,tenant_id,name,code,is_active) values
    (r.branch_a,c.tenant_id,'Phase 3C Branch A','P3CA'||left(suffix,4),true),
    (r.branch_b,c.tenant_id,'Phase 3C Branch B','P3CB'||left(suffix,4),true);
  insert into public.user_branch_access(tenant_id,user_id,branch_id) values
    (c.tenant_id,c.employee_user_id,r.branch_a),
    (c.tenant_id,c.manager_user_id,r.branch_a)
  on conflict do nothing;

  insert into public.res_groups(tenant_id,name,code,category,is_system,active)
  values(c.tenant_id,'Phase 3C payment creators','phase3c_payment_'||suffix,'Tenant',false,true)
  returning id into permission_group;
  insert into public.auth_group_permissions(group_id,permission_id)
  select permission_group,id from public.auth_permissions
  where code='financial.payment.create';
  insert into public.res_users_groups(tenant_id,user_id,group_id) values
    (c.tenant_id,c.employee_user_id,permission_group),
    (c.tenant_id,c.manager_user_id,permission_group);
  insert into phase3c_resources values(r.*);
end $$;

grant select,update on phase3c_resources to authenticated;
grant select on phase3c_context to authenticated;
select set_config('request.jwt.claim.sub',owner_auth_user_id::text,true) from phase3c_context;
set local role authenticated;

do $$
declare c phase3c_context%rowtype; r phase3c_resources%rowtype; result jsonb;
begin
  select * into c from phase3c_context; select * into r from phase3c_resources;
  result:=public.create_and_provision_money_destination(c.tenant_id,'phase3c_cashbox','Phase 3C Main Cashbox','cashbox',r.branch_a,null,null,null,null,null,'{}',true);
  r.cashbox_id:=(result->>'destination_id')::uuid; r.cashbox_account:=(result->>'account_id')::uuid;
  result:=public.create_and_provision_money_destination(c.tenant_id,'phase3c_bank','Phase 3C Bank','bank',r.branch_a,null,null,'Phase 3C Bank','Masked',null,'{}',true);
  r.bank_id:=(result->>'destination_id')::uuid; r.bank_account:=(result->>'account_id')::uuid;
  result:=public.create_and_provision_money_destination(c.tenant_id,'phase3c_custody','عهدة موظف Phase 3C','employee_cash_custody',r.branch_a,c.employee_user_id,null,null,null,null,'{}',true);
  r.custody_id:=(result->>'destination_id')::uuid; r.custody_account:=(result->>'account_id')::uuid;
  result:=public.create_and_provision_money_destination(c.tenant_id,'phase3c_branch_b_cashbox','Phase 3C Branch B Cashbox','cashbox',r.branch_b,null,null,null,null,null,'{}',true);
  r.branch_b_cashbox_id:=(result->>'destination_id')::uuid; r.branch_b_cashbox_account:=(result->>'account_id')::uuid;
  update phase3c_resources set cashbox_id=r.cashbox_id,cashbox_account=r.cashbox_account,
    bank_id=r.bank_id,bank_account=r.bank_account,custody_id=r.custody_id,
    custody_account=r.custody_account,branch_b_cashbox_id=r.branch_b_cashbox_id,
    branch_b_cashbox_account=r.branch_b_cashbox_account;
end $$;
reset role;

do $$
declare c phase3c_context%rowtype; r phase3c_resources%rowtype;
begin
  select * into c from phase3c_context; select * into r from phase3c_resources;
  insert into public.user_financial_account_access(
    tenant_id,user_id,account_id,branch_id,access_type,created_by
  ) values
    (c.tenant_id,c.manager_user_id,r.cashbox_account,r.branch_a,'initiate',c.owner_user_id),
    (c.tenant_id,c.manager_user_id,r.bank_account,r.branch_a,'initiate',c.owner_user_id),
    (c.tenant_id,c.manager_user_id,r.custody_account,r.branch_a,'initiate',c.owner_user_id),
    (c.tenant_id,c.manager_user_id,r.branch_b_cashbox_account,null,'initiate',c.owner_user_id);
end $$;

select set_config('request.jwt.claim.sub',employee_auth_user_id::text,true) from phase3c_context;
set local role authenticated;
do $$
declare c phase3c_context%rowtype; r phase3c_resources%rowtype; selection jsonb; blocked boolean:=false;
begin
  select * into c from phase3c_context; select * into r from phase3c_resources;
  selection:=public.get_money_destination_selection(
    c.tenant_id,'financial.payment.create','initiate',r.branch_a,
    array['cashbox','employee_cash_custody','pos_drawer']
  );
  if selection->>'selection_state'<>'single'
     or (selection->>'auto_selected_destination_id')::uuid<>r.custody_id
     or jsonb_array_length(selection->'destinations')<>1 then
    raise exception 'EMPLOYEE_OWN_CUSTODY_SELECTION_INVALID: %',selection;
  end if;
  begin
    perform * from public.resolve_money_destination_for_action(
      c.tenant_id,r.cashbox_id,'financial.payment.create','initiate',r.branch_a,null
    );
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'EMPLOYEE_BYPASSED_CASHBOX_SCOPE'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',manager_auth_user_id::text,true) from phase3c_context;
set local role authenticated;
do $$
declare c phase3c_context%rowtype; r phase3c_resources%rowtype; selection jsonb; blocked boolean:=false;
begin
  select * into c from phase3c_context; select * into r from phase3c_resources;
  selection:=public.get_money_destination_selection(
    c.tenant_id,'financial.payment.create','initiate',r.branch_a,null
  );
  if selection->>'selection_state'<>'multiple'
     or jsonb_array_length(selection->'destinations')<>3
     or selection->'auto_selected_destination_id'<>'null'::jsonb then
    raise exception 'MANAGER_MULTI_DESTINATION_SELECTION_INVALID: %',selection;
  end if;
  begin
    perform * from public.resolve_money_destination_for_action(
      c.tenant_id,r.branch_b_cashbox_id,'financial.payment.create','initiate',r.branch_b,null
    );
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'BRANCH_SCOPE_BYPASS_ACCEPTED'; end if;
  blocked:=false;
  begin
    perform * from public.resolve_money_destination_for_action(
      gen_random_uuid(),r.cashbox_id,'financial.payment.create','initiate',r.branch_a,null
    );
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'CROSS_TENANT_DESTINATION_ACCEPTED'; end if;
end $$;
reset role;

do $$
declare c phase3c_context%rowtype; r phase3c_resources%rowtype; failed boolean:=false;
begin
  select * into c from phase3c_context; select * into r from phase3c_resources;
  begin
    update public.money_destinations set ledger_account_id=r.bank_account where id=r.cashbox_id;
  exception when check_violation or unique_violation then failed:=true; end;
  if not failed then raise exception 'DESTINATION_ACCOUNT_MISMATCH_ACCEPTED'; end if;
  if exists(
    select 1 from pg_proc function join pg_namespace namespace on namespace.oid=function.pronamespace
    where namespace.nspname='public' and function.proname='settle_showroom_sale_balance_to_destination'
      and pg_get_function_arguments(function.oid) ilike '%account_id%'
  ) then raise exception 'CANONICAL_SETTLEMENT_EXPOSES_FORGEABLE_ACCOUNT_ID'; end if;
end $$;

rollback;
