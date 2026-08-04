begin;

alter table public.showroom_sales add column if not exists crm_lead_id uuid;
alter table public.showroom_sales add column if not exists crm_installment_application_id uuid;
create unique index if not exists uq_showroom_sales_id_tenant on public.showroom_sales(id,tenant_id);
create unique index if not exists uq_showroom_sales_crm_lead on public.showroom_sales(tenant_id,crm_lead_id) where crm_lead_id is not null;
create index if not exists idx_showroom_sales_crm_application on public.showroom_sales(tenant_id,crm_installment_application_id) where crm_installment_application_id is not null;
alter table public.showroom_sales drop constraint if exists showroom_sales_crm_lead_fk;
alter table public.showroom_sales add constraint showroom_sales_crm_lead_fk foreign key(crm_lead_id,tenant_id) references public.crm_leads(id,tenant_id) on delete restrict;
alter table public.showroom_sales drop constraint if exists showroom_sales_crm_application_fk;
alter table public.showroom_sales add constraint showroom_sales_crm_application_fk foreign key(crm_installment_application_id,tenant_id) references public.crm_installment_applications(id,tenant_id) on delete restrict;
alter table public.crm_leads drop constraint if exists crm_leads_sale_fk;
alter table public.crm_leads add constraint crm_leads_sale_fk foreign key(sale_id,tenant_id) references public.showroom_sales(id,tenant_id) on delete restrict;

create or replace function public.crm_list_installment_applications(p_tenant_id uuid,p_search text default '',p_filters jsonb default '{}'::jsonb,p_lead_id uuid default null,p_page integer default 1,p_page_size integer default 25)
returns jsonb language sql stable security invoker set search_path=public as $$
with filtered as(
 select a.id,a.lead_id,a.finance_company_id,a.finance_representative_id,a.status,a.notes,a.submitted_at,a.created_at,a.updated_at,a.is_selected_approval,a.approved_finance_amount,a.approved_down_payment,a.approved_term_months,a.approved_installment_amount,a.approval_expiry_date,a.company_reference,l.customer_name,l.phone,l.assigned_sales_user_id,l.branch_id,c.name company_name,c.active company_active,r.name representative_name,r.active representative_active,tu.full_name sales_user_name,b.name branch_name,ss.id linked_sale_id,ss.sale_number linked_sale_number
 from public.crm_installment_applications a join public.crm_leads l on l.id=a.lead_id and l.tenant_id=a.tenant_id join public.crm_finance_companies c on c.id=a.finance_company_id and c.tenant_id=a.tenant_id left join public.crm_finance_company_representatives r on r.id=a.finance_representative_id and r.tenant_id=a.tenant_id left join public.tenant_users tu on tu.id=l.assigned_sales_user_id and tu.tenant_id=a.tenant_id left join public.branches b on b.id=l.branch_id and b.tenant_id=a.tenant_id left join public.showroom_sales ss on ss.tenant_id=a.tenant_id and ss.crm_installment_application_id=a.id
 where a.tenant_id=p_tenant_id and public.is_tenant_member(p_tenant_id) and (p_lead_id is null or a.lead_id=p_lead_id) and (nullif(trim(p_search),'') is null or l.customer_name ilike '%'||trim(p_search)||'%' or l.phone ilike '%'||trim(p_search)||'%') and (coalesce(p_filters->>'company_id','')='' or a.finance_company_id=(p_filters->>'company_id')::uuid) and (coalesce(p_filters->>'representative_id','')='' or a.finance_representative_id=(p_filters->>'representative_id')::uuid) and (coalesce(p_filters->>'status','')='' or a.status=p_filters->>'status') and (coalesce(p_filters->>'sales_user_id','')='' or l.assigned_sales_user_id=(p_filters->>'sales_user_id')::uuid) and (coalesce(p_filters->>'branch_id','')='' or l.branch_id=(p_filters->>'branch_id')::uuid)
),paged as(select *,count(*) over() total_count from filtered order by created_at desc,id desc offset (greatest(p_page,1)-1)*least(greatest(p_page_size,1),100) limit least(greatest(p_page_size,1),100)) select jsonb_build_object('data',coalesce(jsonb_agg(to_jsonb(paged)-'total_count' order by created_at desc,id desc),'[]'::jsonb),'count',coalesce(max(total_count),0)) from paged;
$$;

create or replace function public.crm_get_installment_application(p_tenant_id uuid,p_application_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
select jsonb_build_object('application',to_jsonb(x)-'tenant_id','events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc) from(select ev.id,ev.event_type,ev.old_status,ev.new_status,ev.notes,ev.metadata,ev.created_at,tu.full_name created_by_name from public.crm_installment_application_events ev left join public.tenant_users tu on tu.id=ev.created_by and tu.tenant_id=ev.tenant_id where ev.tenant_id=p_tenant_id and ev.application_id=p_application_id order by ev.created_at desc,ev.id desc)e),'[]'::jsonb)) from(select a.*,l.customer_name,l.phone,l.status lead_status,c.name company_name,c.active company_active,r.name representative_name,r.active representative_active,tu.full_name sales_user_name,b.name branch_name,ss.id linked_sale_id,ss.sale_number linked_sale_number from public.crm_installment_applications a join public.crm_leads l on l.id=a.lead_id and l.tenant_id=a.tenant_id join public.crm_finance_companies c on c.id=a.finance_company_id and c.tenant_id=a.tenant_id left join public.crm_finance_company_representatives r on r.id=a.finance_representative_id and r.tenant_id=a.tenant_id left join public.tenant_users tu on tu.id=l.assigned_sales_user_id and tu.tenant_id=a.tenant_id left join public.branches b on b.id=l.branch_id and b.tenant_id=a.tenant_id left join public.showroom_sales ss on ss.tenant_id=a.tenant_id and ss.crm_installment_application_id=a.id where a.tenant_id=p_tenant_id and a.id=p_application_id and public.is_tenant_member(p_tenant_id))x;
$$;

create or replace function public.crm_select_installment_approval(p_tenant_id uuid,p_application_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_actor uuid;v_application public.crm_installment_applications;v_lead public.crm_leads;
begin
 select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active=true;
 if v_actor is null then raise exception 'CRM_ACCESS_DENIED';end if;
 select * into v_application from public.crm_installment_applications where tenant_id=p_tenant_id and id=p_application_id for update;
 if v_application.id is null then raise exception 'CRM_INSTALLMENT_APPLICATION_NOT_FOUND';end if;
 if v_application.status<>'approved' then raise exception 'CRM_INSTALLMENT_APPROVAL_REQUIRED';end if;
 select * into v_lead from public.crm_leads where tenant_id=p_tenant_id and id=v_application.lead_id for update;
 if v_lead.id is null then raise exception 'CRM_LEAD_NOT_FOUND';end if;
 if v_lead.status in('sold','cancelled') then raise exception 'CRM_FINAL_STATUS';end if;
 perform 1 from public.crm_installment_applications where tenant_id=p_tenant_id and lead_id=v_application.lead_id for update;
 update public.crm_installment_applications set is_selected_approval=false,updated_at=now() where tenant_id=p_tenant_id and lead_id=v_application.lead_id and id<>p_application_id and is_selected_approval;
 update public.crm_installment_applications set is_selected_approval=true,updated_at=now() where tenant_id=p_tenant_id and id=p_application_id returning * into v_application;
 update public.crm_leads set status='installment_approved',last_activity_at=now(),updated_at=now() where tenant_id=p_tenant_id and id=v_application.lead_id returning * into v_lead;
 insert into public.crm_installment_application_events(tenant_id,application_id,event_type,old_status,new_status,notes,metadata,created_by) values(p_tenant_id,p_application_id,'selected_for_sale','approved','approved','تم اختيار هذه الموافقة لإكمال البيع',jsonb_build_object('selected_for_sale',true),v_actor);
 insert into public.crm_lead_activities(tenant_id,lead_id,activity_type,notes,created_by) values(p_tenant_id,v_application.lead_id,'installment_approved','تم اختيار موافقة التقسيط لإكمال البيع',v_actor);
 return jsonb_build_object('application',to_jsonb(v_application),'lead',to_jsonb(v_lead));
end $$;

create or replace function public.crm_get_lead_sale_context(p_tenant_id uuid,p_lead_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
select jsonb_build_object('lead',jsonb_build_object('id',l.id,'customer_name',l.customer_name,'phone',l.phone,'purchase_type',l.purchase_type,'status',l.status,'branch_id',l.branch_id,'interested_product_id',l.interested_product_id,'interested_product_name',l.interested_product_name,'sale_id',l.sale_id),'selected_approval',case when a.id is null then null else jsonb_build_object('id',a.id,'finance_company_id',a.finance_company_id,'finance_representative_id',a.finance_representative_id,'company_name',c.name,'company_partner_id',c.partner_id,'representative_name',r.name,'approved_finance_amount',a.approved_finance_amount,'approved_down_payment',a.approved_down_payment,'approved_term_months',a.approved_term_months,'approved_installment_amount',a.approved_installment_amount,'approval_expiry_date',a.approval_expiry_date,'company_reference',a.company_reference) end)
from public.crm_leads l left join public.crm_installment_applications a on a.tenant_id=l.tenant_id and a.lead_id=l.id and a.is_selected_approval and a.status='approved' left join public.crm_finance_companies c on c.tenant_id=a.tenant_id and c.id=a.finance_company_id left join public.crm_finance_company_representatives r on r.tenant_id=a.tenant_id and r.id=a.finance_representative_id where l.tenant_id=p_tenant_id and l.id=p_lead_id and public.is_tenant_member(p_tenant_id);
$$;

create or replace function public.crm_mark_lead_sold(p_tenant_id uuid,p_lead_id uuid,p_sale_id uuid,p_application_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_actor uuid;v_lead public.crm_leads;v_sale public.showroom_sales;v_application public.crm_installment_applications;
begin
 select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active=true;
 if v_actor is null then raise exception 'CRM_ACCESS_DENIED';end if;
 select * into v_lead from public.crm_leads where tenant_id=p_tenant_id and id=p_lead_id for update;
 if v_lead.id is null then raise exception 'CRM_LEAD_NOT_FOUND';end if;
 if v_lead.status='cancelled' then raise exception 'CRM_CANCELLED_LEAD_CANNOT_BE_SOLD';end if;
 if v_lead.status='sold' and v_lead.sale_id is distinct from p_sale_id then raise exception 'CRM_LEAD_ALREADY_SOLD';end if;
 select * into v_sale from public.showroom_sales where tenant_id=p_tenant_id and id=p_sale_id for update;
 if v_sale.id is null then raise exception 'CRM_SHOWROOM_SALE_NOT_FOUND';end if;
 if v_sale.status<>'confirmed' then raise exception 'CRM_SHOWROOM_SALE_NOT_CONFIRMED';end if;
 if v_sale.crm_lead_id is not null and v_sale.crm_lead_id<>p_lead_id then raise exception 'CRM_SHOWROOM_SALE_ALREADY_LINKED';end if;
 if p_application_id is not null then
  select * into v_application from public.crm_installment_applications where tenant_id=p_tenant_id and id=p_application_id and lead_id=p_lead_id for update;
  if v_application.id is null or v_application.status<>'approved' or not v_application.is_selected_approval then raise exception 'CRM_SELECTED_APPROVAL_REQUIRED';end if;
 end if;
 update public.showroom_sales set crm_lead_id=p_lead_id,crm_installment_application_id=p_application_id,updated_at=now() where tenant_id=p_tenant_id and id=p_sale_id returning * into v_sale;
 update public.crm_leads set status='sold',sale_id=p_sale_id,sold_at=coalesce(sold_at,now()),sold_by=coalesce(sold_by,v_actor),next_followup_at=null,last_activity_at=now(),updated_at=now() where tenant_id=p_tenant_id and id=p_lead_id returning * into v_lead;
 if not exists(select 1 from public.crm_lead_activities where tenant_id=p_tenant_id and lead_id=p_lead_id and activity_type='sold' and notes like '%'||p_sale_id::text||'%') then insert into public.crm_lead_activities(tenant_id,lead_id,activity_type,notes,created_by) values(p_tenant_id,p_lead_id,'sold','تم البيع عبر الشو روم: '||coalesce(v_sale.sale_number,p_sale_id::text)||' ('||p_sale_id::text||')',v_actor);end if;
 if p_application_id is not null and not exists(select 1 from public.crm_installment_application_events where tenant_id=p_tenant_id and application_id=p_application_id and event_type='status_changed' and metadata->>'sale_id'=p_sale_id::text) then insert into public.crm_installment_application_events(tenant_id,application_id,event_type,old_status,new_status,notes,metadata,created_by) values(p_tenant_id,p_application_id,'status_changed','approved','approved','تم البيع باستخدام هذه الموافقة',jsonb_build_object('sale_id',p_sale_id,'sale_number',v_sale.sale_number),v_actor);end if;
 return jsonb_build_object('lead',to_jsonb(v_lead),'sale',to_jsonb(v_sale),'application',case when v_application.id is null then null else to_jsonb(v_application) end);
end $$;

create or replace function public.complete_showroom_sale(p_sale_id uuid,p_cash_amount numeric,p_cash_note text,p_open_credit_allocations jsonb,p_crm_lead_id uuid,p_crm_installment_application_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_result jsonb;v_tenant_id uuid;v_link jsonb;v_lead_id uuid;v_application_id uuid;
begin
 v_result:=public.complete_showroom_sale(p_sale_id,p_cash_amount,p_cash_note,p_open_credit_allocations);
 if p_crm_lead_id is not null then v_lead_id:=p_crm_lead_id;v_application_id:=p_crm_installment_application_id;
 else select tenant_id,crm_lead_id,crm_installment_application_id into v_tenant_id,v_lead_id,v_application_id from public.showroom_sales where id=p_sale_id;end if;
 if v_lead_id is not null then
  if v_tenant_id is null then select tenant_id into v_tenant_id from public.showroom_sales where id=p_sale_id;end if;
  v_link:=public.crm_mark_lead_sold(v_tenant_id,v_lead_id,p_sale_id,v_application_id);
  v_result:=v_result||jsonb_build_object('crm_link',v_link);
 end if;
 return v_result;
end $$;

revoke all on function public.crm_select_installment_approval(uuid,uuid) from public,anon;
revoke all on function public.crm_get_lead_sale_context(uuid,uuid) from public,anon;
revoke all on function public.crm_mark_lead_sold(uuid,uuid,uuid,uuid) from public,anon;
revoke all on function public.complete_showroom_sale(uuid,numeric,text,jsonb,uuid,uuid) from public,anon;
grant execute on function public.crm_select_installment_approval(uuid,uuid) to authenticated;
grant execute on function public.crm_get_lead_sale_context(uuid,uuid) to authenticated;
grant execute on function public.crm_mark_lead_sold(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.complete_showroom_sale(uuid,numeric,text,jsonb,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
