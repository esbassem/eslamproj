begin;
create or replace function public.set_tenant_group_members(p_group_id uuid,p_user_ids uuid[])
returns table(user_id uuid) language plpgsql security definer set search_path=pg_catalog,public as $$
declare tid uuid:=public.current_tenant_id(); ids uuid[]:=coalesce(p_user_ids,array[]::uuid[]);
begin
 if tid is null or not public.is_current_tenant_owner(tid) then raise exception using errcode='42501',message='Only the tenant owner can manage group members.'; end if;
 if not exists(select 1 from public.res_groups g where g.id=p_group_id and g.tenant_id=tid and not g.is_system) then raise exception using errcode='42501',message='Tenant group not found or protected.'; end if;
 if exists(select 1 from unnest(ids) x(id) left join public.tenant_users u on u.id=x.id and u.tenant_id=tid where u.id is null) then raise exception using errcode='42501',message='Cross-tenant membership is not allowed.'; end if;
 delete from public.res_users_groups m where m.tenant_id=tid and m.group_id=p_group_id and not(m.user_id=any(ids));
 insert into public.res_users_groups(tenant_id,user_id,group_id) select tid,x.id,p_group_id from unnest(ids)x(id) on conflict do nothing;
 return query select m.user_id from public.res_users_groups m where m.tenant_id=tid and m.group_id=p_group_id order by m.user_id;
end $$;
revoke all on function public.set_tenant_group_members(uuid,uuid[]) from public,anon;
grant execute on function public.set_tenant_group_members(uuid,uuid[]) to authenticated;
commit;
