begin;

alter table public.crm_leads enable row level security;
alter table public.crm_lead_sources enable row level security;
alter table public.crm_sales_users enable row level security;
alter table public.crm_lead_activities enable row level security;

create policy crm_leads_member_access on public.crm_leads for all to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
create policy crm_lead_sources_member_access on public.crm_lead_sources for all to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
create policy crm_sales_users_member_access on public.crm_sales_users for all to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
create policy crm_lead_activities_member_access on public.crm_lead_activities for all to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

create or replace function public.crm_create_lead(p_tenant_id uuid, p_payload jsonb)
returns public.crm_leads language plpgsql security invoker set search_path = public as $$
declare v_actor uuid; v_lead public.crm_leads; v_sales uuid := nullif(p_payload->>'assigned_sales_user_id','')::uuid;
begin
  select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active=true;
  if v_actor is null then raise exception 'CRM_ACCESS_DENIED'; end if;
  if v_sales is not null and not exists(select 1 from public.crm_sales_users where tenant_id=p_tenant_id and user_id=v_sales and active=true) then raise exception 'CRM_INVALID_SALES_USER'; end if;
  insert into public.crm_leads(tenant_id,branch_id,customer_name,phone,alternate_phone,source_id,interested_product_id,interested_product_name,purchase_type,priority,assigned_sales_user_id,assigned_at,assigned_by,status,next_followup_at,general_notes,created_by,last_activity_at)
  values(p_tenant_id,nullif(p_payload->>'branch_id','')::uuid,trim(p_payload->>'customer_name'),trim(p_payload->>'phone'),nullif(trim(p_payload->>'alternate_phone'),''),nullif(p_payload->>'source_id','')::uuid,nullif(p_payload->>'interested_product_id','')::uuid,nullif(trim(p_payload->>'interested_product_name'),''),coalesce(nullif(p_payload->>'purchase_type',''),'undecided'),coalesce(nullif(p_payload->>'priority',''),'normal'),v_sales,case when v_sales is null then null else now() end,case when v_sales is null then null else v_actor end,case when v_sales is null then 'new' else 'assigned' end,nullif(p_payload->>'next_followup_at','')::timestamptz,nullif(trim(p_payload->>'general_notes'),''),v_actor,now()) returning * into v_lead;
  insert into public.crm_lead_activities(tenant_id,lead_id,activity_type,notes,created_by) values(p_tenant_id,v_lead.id,'created','تم تسجيل العميل المحتمل',v_actor);
  if v_sales is not null then insert into public.crm_lead_activities(tenant_id,lead_id,activity_type,to_user_id,notes,created_by) values(p_tenant_id,v_lead.id,'assigned',v_sales,'تم إسناد العميل إلى موظف المبيعات',v_actor); end if;
  return v_lead;
end; $$;

create or replace function public.crm_update_lead_assignment(p_tenant_id uuid,p_lead_id uuid,p_sales_user_id uuid,p_notes text default null)
returns public.crm_leads language plpgsql security invoker set search_path=public as $$
declare v_actor uuid; v_lead public.crm_leads; v_previous uuid;
begin
  select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active=true;
  if v_actor is null then raise exception 'CRM_ACCESS_DENIED'; end if;
  if p_sales_user_id is not null and not exists(select 1 from public.crm_sales_users where tenant_id=p_tenant_id and user_id=p_sales_user_id and active=true) then raise exception 'CRM_INVALID_SALES_USER'; end if;
  select * into v_lead from public.crm_leads where id=p_lead_id and tenant_id=p_tenant_id for update;
  if v_lead.id is null then raise exception 'CRM_LEAD_NOT_FOUND'; end if;
  if v_lead.status in ('sold','cancelled') then raise exception 'CRM_FINAL_STATUS'; end if;
  v_previous := v_lead.assigned_sales_user_id;
  update public.crm_leads set assigned_sales_user_id=p_sales_user_id,assigned_at=case when p_sales_user_id is null then null else now() end,assigned_by=v_actor,status=case when status='new' and p_sales_user_id is not null then 'assigned' else status end,last_activity_at=now(),updated_at=now() where id=p_lead_id and tenant_id=p_tenant_id returning * into v_lead;
  insert into public.crm_lead_activities(tenant_id,lead_id,activity_type,from_user_id,to_user_id,notes,created_by) values(p_tenant_id,p_lead_id,case when v_previous is null and p_sales_user_id is not null then 'assigned' else 'reassigned' end,v_previous,p_sales_user_id,coalesce(nullif(trim(p_notes),''),'تم تغيير موظف المبيعات المسؤول'),v_actor);
  return v_lead;
end; $$;

revoke all on function public.crm_create_lead(uuid,jsonb) from public,anon;
grant execute on function public.crm_create_lead(uuid,jsonb) to authenticated;
revoke all on function public.crm_update_lead_assignment(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.crm_update_lead_assignment(uuid,uuid,uuid,text) to authenticated;

commit;
