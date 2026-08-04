begin;

alter table public.crm_leads enable row level security;
alter table public.crm_lead_sources enable row level security;
alter table public.crm_lead_cancel_reasons enable row level security;
alter table public.crm_sales_users enable row level security;
alter table public.crm_finance_companies enable row level security;
alter table public.crm_finance_company_representatives enable row level security;
alter table public.crm_lead_activities enable row level security;
alter table public.crm_installment_applications enable row level security;
alter table public.crm_installment_application_events enable row level security;

do $$ declare t text; begin
 foreach t in array array['crm_leads','crm_lead_sources','crm_lead_cancel_reasons','crm_sales_users','crm_finance_companies','crm_finance_company_representatives','crm_lead_activities','crm_installment_applications','crm_installment_application_events'] loop
  execute format('drop policy if exists %I on public.%I',t||'_member_access',t);
  execute format('create policy %I on public.%I for all to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id))',t||'_member_access',t);
 end loop;
end $$;

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
 v_previous:=v_lead.assigned_sales_user_id;
 if v_previous is not distinct from p_sales_user_id then return v_lead; end if;
 update public.crm_leads set assigned_sales_user_id=p_sales_user_id,
  assigned_at=case when p_sales_user_id is null then null else now() end,assigned_by=v_actor,
  status=case when status='new' and p_sales_user_id is not null then 'assigned' when status='assigned' and p_sales_user_id is null then 'new' else status end,
  last_activity_at=now(),updated_at=now() where id=p_lead_id and tenant_id=p_tenant_id returning * into v_lead;
 insert into public.crm_lead_activities(tenant_id,lead_id,activity_type,from_user_id,to_user_id,notes,created_by)
 values(p_tenant_id,p_lead_id,case when v_previous is null then 'assigned' else 'reassigned' end,v_previous,p_sales_user_id,coalesce(nullif(trim(p_notes),''),'تم تغيير موظف المبيعات المسؤول'),v_actor);
 return v_lead;
end $$;

create or replace function public.crm_add_lead_activity(p_tenant_id uuid,p_lead_id uuid,p_activity_type text,p_outcome text default null,p_notes text default null,p_next_followup_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_actor uuid; v_lead public.crm_leads; v_activity public.crm_lead_activities; v_contact boolean;
begin
 select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active=true;
 if v_actor is null then raise exception 'CRM_ACCESS_DENIED'; end if;
 if p_activity_type not in('call','whatsapp','message','visit','comment','no_answer') then raise exception 'CRM_ACTIVITY_TYPE_NOT_ALLOWED'; end if;
 if p_activity_type='comment' and nullif(trim(p_notes),'') is null then raise exception 'CRM_COMMENT_NOTES_REQUIRED'; end if;
 select * into v_lead from public.crm_leads where id=p_lead_id and tenant_id=p_tenant_id for update;
 if v_lead.id is null then raise exception 'CRM_LEAD_NOT_FOUND'; end if;
 if v_lead.status in('sold','cancelled') then raise exception 'CRM_FINAL_STATUS'; end if;
 v_contact:=p_activity_type in('call','whatsapp','message','visit','no_answer');
 insert into public.crm_lead_activities(tenant_id,lead_id,activity_type,outcome,notes,next_followup_at,created_by)
 values(p_tenant_id,p_lead_id,p_activity_type,nullif(trim(p_outcome),''),nullif(trim(p_notes),''),p_next_followup_at,v_actor) returning * into v_activity;
 update public.crm_leads set last_activity_at=now(),last_contact_at=case when v_contact then now() else last_contact_at end,
  next_followup_at=coalesce(p_next_followup_at,next_followup_at),
  status=case when status in('new','assigned') and v_contact then 'in_followup' else status end,updated_at=now()
 where id=p_lead_id and tenant_id=p_tenant_id returning * into v_lead;
 return jsonb_build_object('activity',to_jsonb(v_activity),'lead',to_jsonb(v_lead));
end $$;

revoke all on function public.crm_add_lead_activity(uuid,uuid,text,text,text,timestamptz) from public,anon;
grant execute on function public.crm_add_lead_activity(uuid,uuid,text,text,text,timestamptz) to authenticated;
commit;
