begin;

update public.crm_installment_applications set status=case status when 'documents_required' then 'waiting_documents' when 'waiting_decision' then 'under_review' when 'expired' then 'cancelled' else status end
where status in('documents_required','waiting_decision','expired');
update public.crm_installment_application_events set old_status=case old_status when 'documents_required' then 'waiting_documents' when 'waiting_decision' then 'under_review' when 'expired' then 'cancelled' else old_status end,
 new_status=case new_status when 'documents_required' then 'waiting_documents' when 'waiting_decision' then 'under_review' when 'expired' then 'cancelled' else new_status end
where old_status in('documents_required','waiting_decision','expired') or new_status in('documents_required','waiting_decision','expired');

alter table public.crm_installment_applications drop constraint if exists crm_installment_applications_status_valid;
alter table public.crm_installment_applications add constraint crm_installment_applications_status_valid check(status in('draft','submitted','waiting_documents','under_review','approved','rejected','cancelled'));
alter table public.crm_installment_application_events drop constraint if exists crm_installment_events_old_status_valid;
alter table public.crm_installment_application_events drop constraint if exists crm_installment_events_new_status_valid;
alter table public.crm_installment_application_events add constraint crm_installment_events_old_status_valid check(old_status is null or old_status in('draft','submitted','waiting_documents','under_review','approved','rejected','cancelled'));
alter table public.crm_installment_application_events add constraint crm_installment_events_new_status_valid check(new_status is null or new_status in('draft','submitted','waiting_documents','under_review','approved','rejected','cancelled'));

create unique index if not exists uq_crm_installment_open_company_per_lead
on public.crm_installment_applications(tenant_id,lead_id,finance_company_id)
where status in('draft','submitted','waiting_documents','under_review');

create or replace function public.crm_create_installment_application(p_tenant_id uuid,p_lead_id uuid,p_finance_company_id uuid,p_finance_representative_id uuid default null,p_notes text default null)
returns public.crm_installment_applications language plpgsql security invoker set search_path=public as $$
declare v_actor uuid;v_lead public.crm_leads;v_application public.crm_installment_applications;
begin
 select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active=true;
 if v_actor is null then raise exception 'CRM_ACCESS_DENIED';end if;
 select * into v_lead from public.crm_leads where tenant_id=p_tenant_id and id=p_lead_id for update;
 if v_lead.id is null then raise exception 'CRM_LEAD_NOT_FOUND';end if;
 if v_lead.status in('sold','cancelled') then raise exception 'CRM_FINAL_STATUS';end if;
 if not exists(select 1 from public.crm_finance_companies where tenant_id=p_tenant_id and id=p_finance_company_id and active=true) then raise exception 'CRM_FINANCE_COMPANY_NOT_FOUND';end if;
 if p_finance_representative_id is not null and not exists(select 1 from public.crm_finance_company_representatives where tenant_id=p_tenant_id and id=p_finance_representative_id and finance_company_id=p_finance_company_id and active=true) then raise exception 'CRM_INVALID_FINANCE_REPRESENTATIVE';end if;
 if exists(select 1 from public.crm_installment_applications where tenant_id=p_tenant_id and lead_id=p_lead_id and finance_company_id=p_finance_company_id and status in('draft','submitted','waiting_documents','under_review')) then raise exception 'CRM_OPEN_INSTALLMENT_APPLICATION_EXISTS';end if;
 begin
  insert into public.crm_installment_applications(tenant_id,branch_id,lead_id,finance_company_id,finance_representative_id,sales_user_id,product_id,product_name,status,submitted_at,submitted_by,notes,created_by)
  values(p_tenant_id,v_lead.branch_id,p_lead_id,p_finance_company_id,p_finance_representative_id,v_lead.assigned_sales_user_id,v_lead.interested_product_id,v_lead.interested_product_name,'submitted',now(),v_actor,nullif(trim(p_notes),''),v_actor) returning * into v_application;
 exception when unique_violation then raise exception 'CRM_OPEN_INSTALLMENT_APPLICATION_EXISTS';end;
 insert into public.crm_installment_application_events(tenant_id,application_id,event_type,old_status,new_status,notes,created_by)
 values(p_tenant_id,v_application.id,'submitted',null,'submitted',nullif(trim(p_notes),''),v_actor);
 insert into public.crm_lead_activities(tenant_id,lead_id,activity_type,notes,created_by)
 values(p_tenant_id,p_lead_id,'sent_to_installment',coalesce(nullif(trim(p_notes),''),'تم إنشاء تقديم لدى شركة تمويل'),v_actor);
 update public.crm_leads set status=case when status='installment_approved' then status else 'installment_processing' end,last_activity_at=now(),updated_at=now() where tenant_id=p_tenant_id and id=p_lead_id;
 return v_application;
end $$;

create or replace function public.crm_transition_installment_application(p_tenant_id uuid,p_application_id uuid,p_new_status text,p_notes text default null)
returns public.crm_installment_applications language plpgsql security invoker set search_path=public as $$
declare v_actor uuid;v_application public.crm_installment_applications;v_event_type text;v_old_status text;
begin
 select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active=true;
 if v_actor is null then raise exception 'CRM_ACCESS_DENIED';end if;
 if p_new_status not in('submitted','waiting_documents','under_review','approved','rejected','cancelled') then raise exception 'CRM_INSTALLMENT_STATUS_NOT_ALLOWED';end if;
 select * into v_application from public.crm_installment_applications where tenant_id=p_tenant_id and id=p_application_id for update;
 if v_application.id is null then raise exception 'CRM_INSTALLMENT_APPLICATION_NOT_FOUND';end if;
 if v_application.status in('approved','rejected','cancelled') then raise exception 'CRM_INSTALLMENT_APPLICATION_FINAL';end if;
 if v_application.status=p_new_status and p_new_status<>'submitted' then raise exception 'CRM_INSTALLMENT_STATUS_UNCHANGED';end if;
 v_old_status:=v_application.status;
 v_event_type:=case p_new_status when 'waiting_documents' then 'documents_requested' when 'approved' then 'approved' when 'rejected' then 'rejected' when 'cancelled' then 'cancelled' when 'submitted' then 'submitted' else 'status_changed' end;
 update public.crm_installment_applications set status=p_new_status,
  submitted_at=case when p_new_status='submitted' then now() else submitted_at end,submitted_by=case when p_new_status='submitted' then v_actor else submitted_by end,
  decided_at=case when p_new_status in('approved','rejected','cancelled') then now() else null end,decided_by=case when p_new_status in('approved','rejected','cancelled') then v_actor else null end,
  rejection_reason=case when p_new_status='rejected' then nullif(trim(p_notes),'') else rejection_reason end,updated_at=now()
 where tenant_id=p_tenant_id and id=p_application_id returning * into v_application;
 insert into public.crm_installment_application_events(tenant_id,application_id,event_type,old_status,new_status,notes,created_by)
 values(p_tenant_id,p_application_id,v_event_type,v_old_status,p_new_status,nullif(trim(p_notes),''),v_actor);
 if p_new_status='approved' then
  update public.crm_leads set status='installment_approved',last_activity_at=now(),updated_at=now() where tenant_id=p_tenant_id and id=v_application.lead_id and status not in('sold','cancelled');
  insert into public.crm_lead_activities(tenant_id,lead_id,activity_type,notes,created_by) values(p_tenant_id,v_application.lead_id,'installment_approved',coalesce(nullif(trim(p_notes),''),'تمت الموافقة على طلب التقسيط'),v_actor);
 elsif p_new_status='rejected' then
  update public.crm_leads set status='installment_processing',last_activity_at=now(),updated_at=now() where tenant_id=p_tenant_id and id=v_application.lead_id and status not in('sold','cancelled','installment_approved');
  insert into public.crm_lead_activities(tenant_id,lead_id,activity_type,notes,created_by) values(p_tenant_id,v_application.lead_id,'installment_rejected',coalesce(nullif(trim(p_notes),''),'تم رفض طلب التقسيط'),v_actor);
 end if;
 return v_application;
end $$;

create or replace function public.crm_list_installment_applications(p_tenant_id uuid,p_search text default '',p_filters jsonb default '{}'::jsonb,p_lead_id uuid default null,p_page integer default 1,p_page_size integer default 25)
returns jsonb language sql stable security invoker set search_path=public as $$
with filtered as(
 select a.id,a.lead_id,a.finance_company_id,a.finance_representative_id,a.status,a.notes,a.submitted_at,a.created_at,a.updated_at,l.customer_name,l.phone,l.assigned_sales_user_id,l.branch_id,c.name company_name,r.name representative_name,tu.full_name sales_user_name,b.name branch_name
 from public.crm_installment_applications a join public.crm_leads l on l.id=a.lead_id and l.tenant_id=a.tenant_id join public.crm_finance_companies c on c.id=a.finance_company_id and c.tenant_id=a.tenant_id
 left join public.crm_finance_company_representatives r on r.id=a.finance_representative_id and r.tenant_id=a.tenant_id left join public.tenant_users tu on tu.id=l.assigned_sales_user_id and tu.tenant_id=a.tenant_id left join public.branches b on b.id=l.branch_id and b.tenant_id=a.tenant_id
 where a.tenant_id=p_tenant_id and public.is_tenant_member(p_tenant_id) and (p_lead_id is null or a.lead_id=p_lead_id)
 and (nullif(trim(p_search),'') is null or l.customer_name ilike '%'||trim(p_search)||'%' or l.phone ilike '%'||trim(p_search)||'%')
 and (coalesce(p_filters->>'company_id','')='' or a.finance_company_id=(p_filters->>'company_id')::uuid)
 and (coalesce(p_filters->>'representative_id','')='' or a.finance_representative_id=(p_filters->>'representative_id')::uuid)
 and (coalesce(p_filters->>'status','')='' or a.status=p_filters->>'status')
 and (coalesce(p_filters->>'sales_user_id','')='' or l.assigned_sales_user_id=(p_filters->>'sales_user_id')::uuid)
 and (coalesce(p_filters->>'branch_id','')='' or l.branch_id=(p_filters->>'branch_id')::uuid)
),paged as(select *,count(*) over() total_count from filtered order by created_at desc,id desc offset (greatest(p_page,1)-1)*least(greatest(p_page_size,1),100) limit least(greatest(p_page_size,1),100))
select jsonb_build_object('data',coalesce(jsonb_agg(to_jsonb(paged)-'total_count' order by created_at desc,id desc),'[]'::jsonb),'count',coalesce(max(total_count),0)) from paged;
$$;

create or replace function public.crm_get_installment_application(p_tenant_id uuid,p_application_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
select jsonb_build_object('application',to_jsonb(x)-'tenant_id','events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc) from(select ev.id,ev.event_type,ev.old_status,ev.new_status,ev.notes,ev.created_at,tu.full_name created_by_name from public.crm_installment_application_events ev left join public.tenant_users tu on tu.id=ev.created_by and tu.tenant_id=ev.tenant_id where ev.tenant_id=p_tenant_id and ev.application_id=p_application_id order by ev.created_at desc,ev.id desc)e),'[]'::jsonb))
from(select a.*,l.customer_name,l.phone,l.status lead_status,c.name company_name,r.name representative_name,tu.full_name sales_user_name,b.name branch_name from public.crm_installment_applications a join public.crm_leads l on l.id=a.lead_id and l.tenant_id=a.tenant_id join public.crm_finance_companies c on c.id=a.finance_company_id and c.tenant_id=a.tenant_id left join public.crm_finance_company_representatives r on r.id=a.finance_representative_id and r.tenant_id=a.tenant_id left join public.tenant_users tu on tu.id=l.assigned_sales_user_id and tu.tenant_id=a.tenant_id left join public.branches b on b.id=l.branch_id and b.tenant_id=a.tenant_id where a.tenant_id=p_tenant_id and a.id=p_application_id and public.is_tenant_member(p_tenant_id))x;
$$;

revoke all on function public.crm_create_installment_application(uuid,uuid,uuid,uuid,text) from public,anon;
revoke all on function public.crm_transition_installment_application(uuid,uuid,text,text) from public,anon;
revoke all on function public.crm_list_installment_applications(uuid,text,jsonb,uuid,integer,integer) from public,anon;
revoke all on function public.crm_get_installment_application(uuid,uuid) from public,anon;
grant execute on function public.crm_create_installment_application(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.crm_transition_installment_application(uuid,uuid,text,text) to authenticated;
grant execute on function public.crm_list_installment_applications(uuid,text,jsonb,uuid,integer,integer) to authenticated;
grant execute on function public.crm_get_installment_application(uuid,uuid) to authenticated;
commit;
