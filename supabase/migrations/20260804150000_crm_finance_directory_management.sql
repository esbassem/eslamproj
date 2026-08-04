begin;

create or replace function public.crm_set_primary_finance_representative(p_tenant_id uuid,p_representative_id uuid)
returns setof public.crm_finance_company_representatives language plpgsql security invoker set search_path=public as $$
declare v_actor uuid;v_rep public.crm_finance_company_representatives;
begin
 select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active=true;
 if v_actor is null then raise exception 'CRM_ACCESS_DENIED';end if;
 select * into v_rep from public.crm_finance_company_representatives where tenant_id=p_tenant_id and id=p_representative_id for update;
 if v_rep.id is null then raise exception 'CRM_FINANCE_REPRESENTATIVE_NOT_FOUND';end if;
 if not v_rep.active then raise exception 'CRM_FINANCE_REPRESENTATIVE_INACTIVE';end if;
 if not exists(select 1 from public.crm_finance_companies where tenant_id=p_tenant_id and id=v_rep.finance_company_id and active=true) then raise exception 'CRM_FINANCE_COMPANY_INACTIVE';end if;
 perform 1 from public.crm_finance_company_representatives where tenant_id=p_tenant_id and finance_company_id=v_rep.finance_company_id for update;
 update public.crm_finance_company_representatives set is_primary=false,updated_at=now() where tenant_id=p_tenant_id and finance_company_id=v_rep.finance_company_id and id<>p_representative_id and is_primary;
 update public.crm_finance_company_representatives set is_primary=true,updated_at=now() where tenant_id=p_tenant_id and id=p_representative_id;
 return query select * from public.crm_finance_company_representatives where tenant_id=p_tenant_id and finance_company_id=v_rep.finance_company_id order by is_primary desc,name;
end $$;

create or replace function public.crm_create_finance_representative(p_tenant_id uuid,p_payload jsonb)
returns public.crm_finance_company_representatives language plpgsql security invoker set search_path=public as $$
declare v_actor uuid;v_company uuid;v_rep public.crm_finance_company_representatives;v_primary boolean:=coalesce((p_payload->>'is_primary')::boolean,false);
begin
 select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active=true;
 if v_actor is null then raise exception 'CRM_ACCESS_DENIED';end if;
 v_company:=nullif(p_payload->>'finance_company_id','')::uuid;
 if nullif(trim(p_payload->>'name'),'') is null then raise exception 'CRM_FINANCE_REPRESENTATIVE_NAME_REQUIRED';end if;
 if v_company is null or not exists(select 1 from public.crm_finance_companies where tenant_id=p_tenant_id and id=v_company and active=true) then raise exception 'CRM_FINANCE_COMPANY_INACTIVE';end if;
 if v_primary and not coalesce((p_payload->>'active')::boolean,true) then raise exception 'CRM_PRIMARY_REPRESENTATIVE_REQUIRES_ACTIVE';end if;
 if v_primary then perform 1 from public.crm_finance_company_representatives where tenant_id=p_tenant_id and finance_company_id=v_company for update;update public.crm_finance_company_representatives set is_primary=false,updated_at=now() where tenant_id=p_tenant_id and finance_company_id=v_company and is_primary;end if;
 insert into public.crm_finance_company_representatives(tenant_id,finance_company_id,name,phone,whatsapp_phone,email,job_title,branch_id,is_primary,active,notes,created_by)
 values(p_tenant_id,v_company,trim(p_payload->>'name'),nullif(trim(p_payload->>'phone'),''),nullif(trim(p_payload->>'whatsapp_phone'),''),nullif(trim(p_payload->>'email'),''),nullif(trim(p_payload->>'job_title'),''),nullif(p_payload->>'branch_id','')::uuid,v_primary,coalesce((p_payload->>'active')::boolean,true),nullif(trim(p_payload->>'notes'),''),v_actor) returning * into v_rep;
 return v_rep;
end $$;

create or replace function public.crm_update_finance_representative(p_tenant_id uuid,p_representative_id uuid,p_payload jsonb)
returns public.crm_finance_company_representatives language plpgsql security invoker set search_path=public as $$
declare v_actor uuid;v_current public.crm_finance_company_representatives;v_company uuid;v_rep public.crm_finance_company_representatives;v_primary boolean;
begin
 select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active=true;
 if v_actor is null then raise exception 'CRM_ACCESS_DENIED';end if;
 select * into v_current from public.crm_finance_company_representatives where tenant_id=p_tenant_id and id=p_representative_id for update;
 if v_current.id is null then raise exception 'CRM_FINANCE_REPRESENTATIVE_NOT_FOUND';end if;
 v_company:=nullif(p_payload->>'finance_company_id','')::uuid;v_primary:=coalesce((p_payload->>'is_primary')::boolean,false);
 if nullif(trim(p_payload->>'name'),'') is null then raise exception 'CRM_FINANCE_REPRESENTATIVE_NAME_REQUIRED';end if;
 if v_company is null or not exists(select 1 from public.crm_finance_companies where tenant_id=p_tenant_id and id=v_company) then raise exception 'CRM_FINANCE_COMPANY_NOT_FOUND';end if;
 if v_company<>v_current.finance_company_id and not exists(select 1 from public.crm_finance_companies where tenant_id=p_tenant_id and id=v_company and active=true) then raise exception 'CRM_FINANCE_COMPANY_INACTIVE';end if;
 if v_primary and (not coalesce((p_payload->>'active')::boolean,v_current.active) or not exists(select 1 from public.crm_finance_companies where tenant_id=p_tenant_id and id=v_company and active=true)) then raise exception 'CRM_PRIMARY_REPRESENTATIVE_REQUIRES_ACTIVE';end if;
 if v_primary then perform 1 from public.crm_finance_company_representatives where tenant_id=p_tenant_id and finance_company_id=v_company for update;update public.crm_finance_company_representatives set is_primary=false,updated_at=now() where tenant_id=p_tenant_id and finance_company_id=v_company and id<>p_representative_id and is_primary;end if;
 update public.crm_finance_company_representatives set finance_company_id=v_company,name=trim(p_payload->>'name'),phone=nullif(trim(p_payload->>'phone'),''),whatsapp_phone=nullif(trim(p_payload->>'whatsapp_phone'),''),email=nullif(trim(p_payload->>'email'),''),job_title=nullif(trim(p_payload->>'job_title'),''),branch_id=nullif(p_payload->>'branch_id','')::uuid,is_primary=v_primary,active=coalesce((p_payload->>'active')::boolean,active),notes=nullif(trim(p_payload->>'notes'),''),updated_at=now() where tenant_id=p_tenant_id and id=p_representative_id returning * into v_rep;
 return v_rep;
end $$;

create or replace function public.crm_set_finance_representative_active(p_tenant_id uuid,p_representative_id uuid,p_active boolean)
returns public.crm_finance_company_representatives language plpgsql security invoker set search_path=public as $$
declare v_actor uuid;v_rep public.crm_finance_company_representatives;
begin
 select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active=true;
 if v_actor is null then raise exception 'CRM_ACCESS_DENIED';end if;
 select * into v_rep from public.crm_finance_company_representatives where tenant_id=p_tenant_id and id=p_representative_id for update;
 if v_rep.id is null then raise exception 'CRM_FINANCE_REPRESENTATIVE_NOT_FOUND';end if;
 if p_active and not exists(select 1 from public.crm_finance_companies where tenant_id=p_tenant_id and id=v_rep.finance_company_id and active=true) then raise exception 'CRM_FINANCE_COMPANY_INACTIVE';end if;
 update public.crm_finance_company_representatives set active=p_active,is_primary=case when p_active then is_primary else false end,updated_at=now() where tenant_id=p_tenant_id and id=p_representative_id returning * into v_rep;
 return v_rep;
end $$;

create or replace function public.crm_list_installment_applications(p_tenant_id uuid,p_search text default '',p_filters jsonb default '{}'::jsonb,p_lead_id uuid default null,p_page integer default 1,p_page_size integer default 25)
returns jsonb language sql stable security invoker set search_path=public as $$
with filtered as(
 select a.id,a.lead_id,a.finance_company_id,a.finance_representative_id,a.status,a.notes,a.submitted_at,a.created_at,a.updated_at,l.customer_name,l.phone,l.assigned_sales_user_id,l.branch_id,c.name company_name,c.active company_active,r.name representative_name,r.active representative_active,tu.full_name sales_user_name,b.name branch_name
 from public.crm_installment_applications a join public.crm_leads l on l.id=a.lead_id and l.tenant_id=a.tenant_id join public.crm_finance_companies c on c.id=a.finance_company_id and c.tenant_id=a.tenant_id
 left join public.crm_finance_company_representatives r on r.id=a.finance_representative_id and r.tenant_id=a.tenant_id left join public.tenant_users tu on tu.id=l.assigned_sales_user_id and tu.tenant_id=a.tenant_id left join public.branches b on b.id=l.branch_id and b.tenant_id=a.tenant_id
 where a.tenant_id=p_tenant_id and public.is_tenant_member(p_tenant_id) and (p_lead_id is null or a.lead_id=p_lead_id)
 and (nullif(trim(p_search),'') is null or l.customer_name ilike '%'||trim(p_search)||'%' or l.phone ilike '%'||trim(p_search)||'%')
 and (coalesce(p_filters->>'company_id','')='' or a.finance_company_id=(p_filters->>'company_id')::uuid) and (coalesce(p_filters->>'representative_id','')='' or a.finance_representative_id=(p_filters->>'representative_id')::uuid) and (coalesce(p_filters->>'status','')='' or a.status=p_filters->>'status') and (coalesce(p_filters->>'sales_user_id','')='' or l.assigned_sales_user_id=(p_filters->>'sales_user_id')::uuid) and (coalesce(p_filters->>'branch_id','')='' or l.branch_id=(p_filters->>'branch_id')::uuid)
),paged as(select *,count(*) over() total_count from filtered order by created_at desc,id desc offset (greatest(p_page,1)-1)*least(greatest(p_page_size,1),100) limit least(greatest(p_page_size,1),100))
select jsonb_build_object('data',coalesce(jsonb_agg(to_jsonb(paged)-'total_count' order by created_at desc,id desc),'[]'::jsonb),'count',coalesce(max(total_count),0)) from paged;
$$;

create or replace function public.crm_get_installment_application(p_tenant_id uuid,p_application_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
select jsonb_build_object('application',to_jsonb(x)-'tenant_id','events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc) from(select ev.id,ev.event_type,ev.old_status,ev.new_status,ev.notes,ev.created_at,tu.full_name created_by_name from public.crm_installment_application_events ev left join public.tenant_users tu on tu.id=ev.created_by and tu.tenant_id=ev.tenant_id where ev.tenant_id=p_tenant_id and ev.application_id=p_application_id order by ev.created_at desc,ev.id desc)e),'[]'::jsonb))
from(select a.*,l.customer_name,l.phone,l.status lead_status,c.name company_name,c.active company_active,r.name representative_name,r.active representative_active,tu.full_name sales_user_name,b.name branch_name from public.crm_installment_applications a join public.crm_leads l on l.id=a.lead_id and l.tenant_id=a.tenant_id join public.crm_finance_companies c on c.id=a.finance_company_id and c.tenant_id=a.tenant_id left join public.crm_finance_company_representatives r on r.id=a.finance_representative_id and r.tenant_id=a.tenant_id left join public.tenant_users tu on tu.id=l.assigned_sales_user_id and tu.tenant_id=a.tenant_id left join public.branches b on b.id=l.branch_id and b.tenant_id=a.tenant_id where a.tenant_id=p_tenant_id and a.id=p_application_id and public.is_tenant_member(p_tenant_id))x;
$$;

revoke all on function public.crm_set_primary_finance_representative(uuid,uuid) from public,anon;
revoke all on function public.crm_create_finance_representative(uuid,jsonb) from public,anon;
revoke all on function public.crm_update_finance_representative(uuid,uuid,jsonb) from public,anon;
revoke all on function public.crm_set_finance_representative_active(uuid,uuid,boolean) from public,anon;
grant execute on function public.crm_set_primary_finance_representative(uuid,uuid) to authenticated;
grant execute on function public.crm_create_finance_representative(uuid,jsonb) to authenticated;
grant execute on function public.crm_update_finance_representative(uuid,uuid,jsonb) to authenticated;
grant execute on function public.crm_set_finance_representative_active(uuid,uuid,boolean) to authenticated;
commit;
