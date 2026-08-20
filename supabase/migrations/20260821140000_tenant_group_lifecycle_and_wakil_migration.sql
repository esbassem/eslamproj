begin;

create or replace function public.create_tenant_group(p_name text,p_description text default null,p_active boolean default true)
returns public.res_groups language plpgsql security definer set search_path=pg_catalog,public as $$
declare tid uuid:=public.current_tenant_id(); result public.res_groups;
begin
 if tid is null or not public.is_current_tenant_owner(tid) then raise exception using errcode='42501',message='Only the tenant owner can create groups.'; end if;
 if nullif(btrim(p_name),'') is null then raise exception using errcode='22023',message='Group name is required.'; end if;
 insert into public.res_groups(tenant_id,module_id,name,code,description,category,is_system,active)
 values(tid,null,btrim(p_name),'tenant_group_'||replace(gen_random_uuid()::text,'-',''),nullif(btrim(p_description),''),'Tenant',false,coalesce(p_active,true)) returning * into result;
 return result;
end $$;

create or replace function public.update_tenant_group(p_group_id uuid,p_name text,p_description text,p_active boolean)
returns public.res_groups language plpgsql security definer set search_path=pg_catalog,public as $$
declare tid uuid:=public.current_tenant_id(); result public.res_groups;
begin
 if tid is null or not public.is_current_tenant_owner(tid) then raise exception using errcode='42501',message='Only the tenant owner can update groups.'; end if;
 if nullif(btrim(p_name),'') is null then raise exception using errcode='22023',message='Group name is required.'; end if;
 update public.res_groups set name=btrim(p_name),description=nullif(btrim(p_description),''),active=coalesce(p_active,true),updated_at=now()
 where id=p_group_id and tenant_id=tid and is_system=false returning * into result;
 if not found then raise exception using errcode='42501',message='Tenant group not found or protected.'; end if; return result;
end $$;

create or replace function public.set_tenant_group_members(p_group_id uuid,p_user_ids uuid[])
returns table(user_id uuid) language plpgsql security definer set search_path=pg_catalog,public as $$
declare tid uuid:=public.current_tenant_id(); ids uuid[]:=coalesce(p_user_ids,array[]::uuid[]);
begin
 if tid is null or not public.is_current_tenant_owner(tid) then raise exception using errcode='42501',message='Only the tenant owner can manage group members.'; end if;
 if not exists(select 1 from public.res_groups g where g.id=p_group_id and g.tenant_id=tid and not g.is_system) then raise exception using errcode='42501',message='Tenant group not found or protected.'; end if;
 if exists(select 1 from unnest(ids) x(id) left join public.tenant_users u on u.id=x.id and u.tenant_id=tid where u.id is null) then raise exception using errcode='42501',message='Cross-tenant membership is not allowed.'; end if;
 delete from public.res_users_groups m where m.tenant_id=tid and m.group_id=p_group_id and not(m.user_id=any(ids));
 insert into public.res_users_groups(tenant_id,user_id,group_id) select tid,x.id,p_group_id from unnest(ids)x(id) on conflict(tenant_id,user_id,group_id) do nothing;
 return query select m.user_id from public.res_users_groups m where m.tenant_id=tid and m.group_id=p_group_id order by m.user_id;
end $$;

create or replace function public.delete_tenant_group(p_group_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare tid uuid:=public.current_tenant_id();
begin
 if tid is null or not public.is_current_tenant_owner(tid) then raise exception using errcode='42501',message='Only the tenant owner can delete groups.'; end if;
 if not exists(select 1 from public.res_groups g where g.id=p_group_id and g.tenant_id=tid and not g.is_system for update) then raise exception using errcode='42501',message='Tenant group not found or protected.'; end if;
 if exists(select 1 from public.res_users_groups m where m.tenant_id=tid and m.group_id=p_group_id) then raise exception using errcode='23503',message='Remove all users from the group before deleting it.'; end if;
 if exists(select 1 from public.ir_model_access a where a.group_id=p_group_id) then raise exception using errcode='23503',message='The group has model access dependencies and cannot be deleted.'; end if;
 delete from public.auth_group_permissions where group_id=p_group_id; delete from public.res_groups where id=p_group_id and tenant_id=tid; return true;
end $$;

create or replace function public.provision_default_tenant_groups(p_tenant_id uuid)
returns table(group_id uuid,group_code text) language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_tenant_id is null or not exists(select 1 from public.tenants where id=p_tenant_id) then raise exception using errcode='22023',message='Tenant not found.'; end if;
 if auth.uid() is not null and not public.is_current_tenant_owner(p_tenant_id) then raise exception using errcode='42501',message='Only the tenant owner can provision groups.'; end if;
 insert into public.res_groups(tenant_id,module_id,name,code,description,category,is_system,active)
 values(p_tenant_id,null,'فريق العمل','tenant_team_members','مجموعة تنظيمية أولية بلا صلاحيات؛ يضيف المالك الصلاحيات المناسبة لاحقًا.','Tenant',false,true)
 on conflict do nothing;
 return query select g.id,g.code from public.res_groups g where g.tenant_id=p_tenant_id and g.code='tenant_team_members';
end $$;

do $$ declare sig regprocedure; begin
 foreach sig in array array['public.create_tenant_group(text,text,boolean)'::regprocedure,'public.update_tenant_group(uuid,text,text,boolean)'::regprocedure,'public.set_tenant_group_members(uuid,uuid[])'::regprocedure,'public.delete_tenant_group(uuid)'::regprocedure,'public.provision_default_tenant_groups(uuid)'::regprocedure] loop
  execute format('revoke all on function %s from public, anon',sig); execute format('grant execute on function %s to authenticated',sig);
 end loop;
end $$;

-- Atomic migration for the only operational company with legacy memberships.
do $$
declare tid constant uuid:='4ee5f357-8cf5-4770-8772-64de99532dac'; mismatch bigint;
begin
 create temporary table old_effective on commit drop as
 select u.id user_id,coalesce(array_agg(distinct p.code order by p.code) filter(where p.code is not null),array[]::text[]) permissions
 from public.tenant_users u left join public.res_users_groups m on m.tenant_id=u.tenant_id and m.user_id=u.id left join public.auth_group_permissions gp on gp.group_id=m.group_id left join public.auth_permissions p on p.id=gp.permission_id and p.active
 where u.tenant_id=tid and u.is_active group by u.id;

 insert into public.res_groups(tenant_id,module_id,name,code,description,category,is_system,active) values
 (tid,null,'موظفو الأوراق','wakil_paperwork_staff','متابعة أوراق العملاء وتسليمها.','Tenant',false,true),
 (tid,null,'موظفو المخزون','wakil_inventory_staff','العمل على المخزون وعملياته الحالية.','Tenant',false,true),
 (tid,null,'مبيعات المعرض','wakil_showroom_sales','العمل على مبيعات نقطة المعرض.','Tenant',false,true),
 (tid,null,'محتوى وصور المعرض','wakil_showroom_media','إدارة صور ومحتوى المعرض.','Tenant',false,true)
 on conflict do nothing;

 insert into public.auth_group_permissions(group_id,permission_id)
 select ng.id,gp.permission_id from public.res_groups ng join (values
 ('wakil_paperwork_staff','moto_customer_care_user'),('wakil_inventory_staff','inventory_user'),('wakil_showroom_sales','showroom_point_user'),('wakil_showroom_media','photos_user')
 ) map(new_code,old_code) on map.new_code=ng.code join public.res_groups oldg on oldg.code=map.old_code and oldg.tenant_id is null join public.auth_group_permissions gp on gp.group_id=oldg.id
 where ng.tenant_id=tid on conflict(group_id,permission_id) do nothing;

 insert into public.res_users_groups(tenant_id,user_id,group_id)
 select tid,m.user_id,ng.id from public.res_users_groups m join public.res_groups oldg on oldg.id=m.group_id join (values
 ('moto_customer_care_user','wakil_paperwork_staff'),('inventory_user','wakil_inventory_staff'),('showroom_point_user','wakil_showroom_sales'),('photos_user','wakil_showroom_media')
 ) map(old_code,new_code) on map.old_code=oldg.code join public.res_groups ng on ng.tenant_id=tid and ng.code=map.new_code
 where m.tenant_id=tid on conflict(tenant_id,user_id,group_id) do nothing;

 create temporary table new_effective on commit drop as
 select u.id user_id,coalesce(array_agg(distinct p.code order by p.code) filter(where p.code is not null),array[]::text[]) permissions
 from public.tenant_users u left join public.res_users_groups m on m.tenant_id=u.tenant_id and m.user_id=u.id left join public.auth_group_permissions gp on gp.group_id=m.group_id left join public.auth_permissions p on p.id=gp.permission_id and p.active
 where u.tenant_id=tid and u.is_active and (m.group_id is null or exists(select 1 from public.res_groups g where g.id=m.group_id and g.tenant_id=tid)) group by u.id;
 select count(*) into mismatch from old_effective o full join new_effective n using(user_id) where o.permissions is distinct from n.permissions;
 if mismatch<>0 then raise exception 'Wakil tenant group migration aborted: % permission mismatches.',mismatch; end if;
 delete from public.res_users_groups m using public.res_groups g where m.group_id=g.id and m.tenant_id=tid and g.tenant_id is null;
end $$;

commit;
