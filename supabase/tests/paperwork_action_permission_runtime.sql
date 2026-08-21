begin;

do $$
declare
  v_tenant_id uuid;
  v_user_id uuid;
  v_auth_user_id uuid;
  v_owner_auth_user_id uuid;
  v_access_group uuid := gen_random_uuid();
  v_send_group uuid := gen_random_uuid();
  v_deliver_group uuid := gen_random_uuid();
  v_receive_group uuid := gen_random_uuid();
  v_code text;
begin
  select tenant_user.tenant_id,tenant_user.id,tenant_user.auth_user_id
  into v_tenant_id,v_user_id,v_auth_user_id
  from public.tenant_users tenant_user
  where tenant_user.is_active and tenant_user.role<>'owner'
    and exists (
      select 1 from public.tenant_modules tenant_module
      join public.ir_modules module on module.id=tenant_module.module_id
      where tenant_module.tenant_id=tenant_user.tenant_id and tenant_module.state='installed'
        and module.technical_name='paperwork' and module.active
    )
  limit 1;
  if v_user_id is null then raise exception 'TEST_SETUP_FAILED: non-owner fixture missing'; end if;

  select auth_user_id into v_owner_auth_user_id from public.tenant_users
  where tenant_id=v_tenant_id and is_active and role='owner' limit 1;
  if v_owner_auth_user_id is null then raise exception 'TEST_SETUP_FAILED: owner fixture missing'; end if;

  insert into public.res_groups(id,tenant_id,name,code) values
    (v_access_group,v_tenant_id,'Paperwork test access','paperwork_test_access_'||v_access_group),
    (v_send_group,v_tenant_id,'Paperwork test send','paperwork_test_send_'||v_send_group),
    (v_deliver_group,v_tenant_id,'Paperwork test deliver','paperwork_test_deliver_'||v_deliver_group),
    (v_receive_group,v_tenant_id,'Paperwork test receive','paperwork_test_receive_'||v_receive_group);
  insert into public.auth_group_permissions(group_id,permission_id)
  select v_access_group,id from public.auth_permissions where code='paperwork.access'
  union all select v_send_group,id from public.auth_permissions where code='paperwork.send'
  union all select v_deliver_group,id from public.auth_permissions where code='paperwork.deliver'
  union all select v_receive_group,id from public.auth_permissions where code='paperwork.receive';

  insert into public.res_users_groups(tenant_id,user_id,group_id) values(v_tenant_id,v_user_id,v_access_group);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_auth_user_id,'role','authenticated')::text,true);
  if not public.can_access_paperwork(v_tenant_id) then raise exception 'TEST_FAILED: access-only user cannot read Paperwork'; end if;
  foreach v_code in array array['paperwork.send','paperwork.receive','paperwork.deliver','paperwork.cancel','paperwork.correct','paperwork.authorize_release'] loop
    begin
      perform public.require_paperwork_action(v_tenant_id,v_code);
      raise exception 'TEST_FAILED: access-only user received %',v_code;
    exception when sqlstate '42501' then null; end;
  end loop;

  insert into public.res_users_groups(tenant_id,user_id,group_id) values(v_tenant_id,v_user_id,v_send_group);
  perform public.require_paperwork_action(v_tenant_id,'paperwork.send');
  begin perform public.require_paperwork_action(v_tenant_id,'paperwork.receive'); raise exception 'TEST_FAILED: send inherited receive'; exception when sqlstate '42501' then null; end;

  insert into public.res_users_groups(tenant_id,user_id,group_id) values(v_tenant_id,v_user_id,v_deliver_group);
  perform public.require_paperwork_action(v_tenant_id,'paperwork.send');
  perform public.require_paperwork_action(v_tenant_id,'paperwork.deliver');

  delete from public.res_users_groups where user_id=v_user_id and group_id in(v_access_group,v_send_group,v_deliver_group);
  insert into public.res_users_groups(tenant_id,user_id,group_id) values(v_tenant_id,v_user_id,v_receive_group);
  if public.can_access_paperwork(v_tenant_id) then raise exception 'TEST_FAILED: action permission granted app access'; end if;
  begin perform public.require_paperwork_action(v_tenant_id,'paperwork.receive'); raise exception 'TEST_FAILED: action worked without app access'; exception when sqlstate '42501' then null; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner_auth_user_id,'role','authenticated')::text,true);
  foreach v_code in array array['paperwork.send','paperwork.receive','paperwork.deliver','paperwork.cancel','paperwork.correct','paperwork.authorize_release'] loop
    perform public.require_paperwork_action(v_tenant_id,v_code);
  end loop;
end
$$;

rollback;
