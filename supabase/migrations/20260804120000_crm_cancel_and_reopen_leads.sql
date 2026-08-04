begin;

create or replace function public.crm_cancel_lead(p_tenant_id uuid,p_lead_id uuid,p_cancel_reason_id uuid,p_cancel_notes text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_actor uuid;v_lead public.crm_leads;v_reason public.crm_lead_cancel_reasons;v_activity public.crm_lead_activities;
begin
 select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active;
 if v_actor is null then raise exception 'CRM_ACCESS_DENIED';end if;
 if p_cancel_reason_id is null then raise exception 'CRM_CANCEL_REASON_REQUIRED';end if;
 select * into v_reason from public.crm_lead_cancel_reasons where id=p_cancel_reason_id and tenant_id=p_tenant_id and active;
 if v_reason.id is null then raise exception 'CRM_INVALID_CANCEL_REASON';end if;
 select * into v_lead from public.crm_leads where id=p_lead_id and tenant_id=p_tenant_id for update;
 if v_lead.id is null then raise exception 'CRM_LEAD_NOT_FOUND';end if;
 if v_lead.status in('sold','cancelled') then raise exception 'CRM_FINAL_STATUS';end if;
 update public.crm_leads set status='cancelled',cancel_reason_id=v_reason.id,cancel_notes=nullif(trim(p_cancel_notes),''),cancelled_at=now(),cancelled_by=v_actor,next_followup_at=null,last_activity_at=now(),updated_at=now() where id=p_lead_id and tenant_id=p_tenant_id returning * into v_lead;
 insert into public.crm_lead_activities(tenant_id,lead_id,activity_type,outcome,notes,created_by) values(p_tenant_id,p_lead_id,'cancelled',v_reason.name,nullif(trim(p_cancel_notes),''),v_actor) returning * into v_activity;
 return jsonb_build_object('lead',to_jsonb(v_lead),'activity',to_jsonb(v_activity));
end $$;

create or replace function public.crm_reopen_lead(p_tenant_id uuid,p_lead_id uuid,p_notes text,p_next_followup_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_actor uuid;v_lead public.crm_leads;v_activity public.crm_lead_activities;
begin
 select id into v_actor from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active;
 if v_actor is null then raise exception 'CRM_ACCESS_DENIED';end if;
 if nullif(trim(p_notes),'') is null then raise exception 'CRM_REOPEN_NOTES_REQUIRED';end if;
 select * into v_lead from public.crm_leads where id=p_lead_id and tenant_id=p_tenant_id for update;
 if v_lead.id is null then raise exception 'CRM_LEAD_NOT_FOUND';end if;
 if v_lead.status<>'cancelled' then raise exception 'CRM_NOT_CANCELLED';end if;
 update public.crm_leads set status=case when assigned_sales_user_id is null then 'new' else 'in_followup' end,cancel_reason_id=null,cancel_notes=null,cancelled_at=null,cancelled_by=null,next_followup_at=p_next_followup_at,last_activity_at=now(),updated_at=now() where id=p_lead_id and tenant_id=p_tenant_id returning * into v_lead;
 insert into public.crm_lead_activities(tenant_id,lead_id,activity_type,notes,next_followup_at,created_by) values(p_tenant_id,p_lead_id,'reopened',trim(p_notes),p_next_followup_at,v_actor) returning * into v_activity;
 return jsonb_build_object('lead',to_jsonb(v_lead),'activity',to_jsonb(v_activity));
end $$;

revoke all on function public.crm_cancel_lead(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.crm_cancel_lead(uuid,uuid,uuid,text) to authenticated;
revoke all on function public.crm_reopen_lead(uuid,uuid,text,timestamptz) from public,anon;
grant execute on function public.crm_reopen_lead(uuid,uuid,text,timestamptz) to authenticated;
commit;
