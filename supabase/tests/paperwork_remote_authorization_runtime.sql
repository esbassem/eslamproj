begin;

select set_config('paperwork_test.tenant_id', tenant_module.tenant_id::text, false)
from public.tenant_modules tenant_module
join public.ir_modules module on module.id=tenant_module.module_id
where module.technical_name='paperwork' and tenant_module.state='installed'
limit 1;

select set_config('paperwork_test.owner_auth_id', tenant_user.auth_user_id::text, false)
from public.tenant_users tenant_user
where tenant_user.tenant_id=current_setting('paperwork_test.tenant_id')::uuid
  and tenant_user.role='owner' and tenant_user.is_active and tenant_user.auth_user_id is not null
limit 1;

select set_config('paperwork_test.normal_auth_id', tenant_user.auth_user_id::text, false),
       set_config('paperwork_test.normal_user_id', tenant_user.id::text, false)
from public.tenant_users tenant_user
where tenant_user.tenant_id=current_setting('paperwork_test.tenant_id')::uuid
  and tenant_user.role<>'owner' and tenant_user.is_active and tenant_user.auth_user_id is not null
limit 1;

select set_config('request.jwt.claim.sub',current_setting('paperwork_test.owner_auth_id'),false);
set local role authenticated;
do $$ begin
  if not public.can_access_paperwork(current_setting('paperwork_test.tenant_id')::uuid) then
    raise exception 'TEST_FAILED: owner override did not grant Paperwork access';
  end if;
  perform count(*) from public.paperwork_requests
  where tenant_id=current_setting('paperwork_test.tenant_id')::uuid;
end $$;
set local role postgres;

select set_config('request.jwt.claim.sub',current_setting('paperwork_test.normal_auth_id'),false);
set local role authenticated;
do $$
declare visible_rows bigint;
begin
  if public.can_access_paperwork(current_setting('paperwork_test.tenant_id')::uuid) then
    raise exception 'TEST_FAILED: normal user unexpectedly has Paperwork access';
  end if;
  select count(*) into visible_rows from public.paperwork_requests
  where tenant_id=current_setting('paperwork_test.tenant_id')::uuid;
  if visible_rows<>0 then
    raise exception 'TEST_FAILED: restrictive Paperwork table boundary was bypassed';
  end if;
  begin
    perform public.require_paperwork_access(current_setting('paperwork_test.tenant_id')::uuid);
    raise exception 'TEST_FAILED: protected RPC boundary did not reject normal user';
  exception when insufficient_privilege then
    if sqlerrm<>'PAPERWORK_APP_ACCESS_REQUIRED' then raise; end if;
  end;
end $$;
set local role postgres;

create temporary table paperwork_test_group(id uuid) on commit drop;
with inserted as (
  insert into public.res_groups(tenant_id,module_id,name,code,description,is_system,active)
  select current_setting('paperwork_test.tenant_id')::uuid,module.id,
    'Paperwork temporary runtime test','paperwork_runtime_test_'||substr(gen_random_uuid()::text,1,8),
    'Rolled back by paperwork_remote_authorization_runtime.sql',false,true
  from public.ir_modules module where module.technical_name='paperwork'
  returning id
)
insert into paperwork_test_group select id from inserted;

insert into public.auth_group_permissions(group_id,permission_id)
select test_group.id,permission.id
from paperwork_test_group test_group
join public.auth_permissions permission on permission.code='paperwork.access';

insert into public.res_users_groups(tenant_id,user_id,group_id)
select current_setting('paperwork_test.tenant_id')::uuid,
  current_setting('paperwork_test.normal_user_id')::uuid,test_group.id
from paperwork_test_group test_group;

select set_config('request.jwt.claim.sub',current_setting('paperwork_test.normal_auth_id'),false);
set local role authenticated;
do $$ begin
  if not public.can_access_paperwork(current_setting('paperwork_test.tenant_id')::uuid) then
    raise exception 'TEST_FAILED: temporary paperwork.access grant was not honored';
  end if;
  perform public.require_paperwork_access(current_setting('paperwork_test.tenant_id')::uuid);
  if public.is_tenant_owner(current_setting('paperwork_test.tenant_id')::uuid) then
    raise exception 'TEST_FAILED: paperwork.access elevated normal user to owner';
  end if;
  perform count(*) from public.paperwork_requests
  where tenant_id=current_setting('paperwork_test.tenant_id')::uuid;
end $$;
set local role postgres;

rollback;
