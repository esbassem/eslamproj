begin;

create or replace function public.crm_list_lead_followups(
 p_tenant_id uuid,p_current_user_id uuid,p_scope text,p_view text,p_search text,p_filters jsonb,
 p_day_start timestamptz,p_tomorrow_start timestamptz,p_day_after_tomorrow_start timestamptz,p_page integer default 1,p_page_size integer default 25)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_result jsonb;
begin
 if not public.is_tenant_member(p_tenant_id) then raise exception 'CRM_ACCESS_DENIED';end if;
 if p_scope not in('mine','all') or p_view not in('all','overdue','today','tomorrow','upcoming') then raise exception 'CRM_INVALID_FOLLOWUP_FILTER';end if;
 with filtered as (
  select l.*,s.name source_name,u.full_name sales_user_name,count(*) over() total_count
  from public.crm_leads l left join public.crm_lead_sources s on s.id=l.source_id and s.tenant_id=l.tenant_id
  left join public.tenant_users u on u.id=l.assigned_sales_user_id and u.tenant_id=l.tenant_id
  where l.tenant_id=p_tenant_id and l.next_followup_at is not null and l.status not in('sold','cancelled')
   and (p_scope='all' or l.assigned_sales_user_id=p_current_user_id)
   and (p_view='all' or (p_view='overdue' and l.next_followup_at<p_day_start) or (p_view='today' and l.next_followup_at>=p_day_start and l.next_followup_at<p_tomorrow_start) or (p_view='tomorrow' and l.next_followup_at>=p_tomorrow_start and l.next_followup_at<p_day_after_tomorrow_start) or (p_view='upcoming' and l.next_followup_at>=p_day_after_tomorrow_start))
   and (coalesce(trim(p_search),'')='' or l.customer_name ilike '%'||trim(p_search)||'%' or l.phone ilike '%'||trim(p_search)||'%' or coalesce(l.alternate_phone,'') ilike '%'||trim(p_search)||'%')
   and case when coalesce(p_filters->>'sales_user_id','')='' then true when p_filters->>'sales_user_id'='unassigned' then l.assigned_sales_user_id is null else l.assigned_sales_user_id=(p_filters->>'sales_user_id')::uuid end
   and (coalesce(p_filters->>'source_id','')='' or l.source_id=nullif(p_filters->>'source_id','')::uuid)
   and (coalesce(p_filters->>'purchase_type','')='' or l.purchase_type=p_filters->>'purchase_type')
   and (coalesce(p_filters->>'priority','')='' or l.priority=p_filters->>'priority')
  order by l.next_followup_at asc,case l.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,l.id asc
  offset greatest(p_page-1,0)*p_page_size limit p_page_size
 ) select jsonb_build_object('data',coalesce(jsonb_agg(to_jsonb(filtered)-'total_count'),'[]'::jsonb),'count',coalesce(max(total_count),0)) into v_result from filtered;
 return v_result;
end $$;

create or replace function public.crm_get_lead_followup_counts(
 p_tenant_id uuid,p_current_user_id uuid,p_scope text,p_search text,p_filters jsonb,
 p_day_start timestamptz,p_tomorrow_start timestamptz,p_day_after_tomorrow_start timestamptz)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_result jsonb;
begin
 if not public.is_tenant_member(p_tenant_id) then raise exception 'CRM_ACCESS_DENIED';end if;
 with filtered as (
  select l.next_followup_at from public.crm_leads l where l.tenant_id=p_tenant_id and l.next_followup_at is not null and l.status not in('sold','cancelled')
   and (p_scope='all' or l.assigned_sales_user_id=p_current_user_id)
   and (coalesce(trim(p_search),'')='' or l.customer_name ilike '%'||trim(p_search)||'%' or l.phone ilike '%'||trim(p_search)||'%' or coalesce(l.alternate_phone,'') ilike '%'||trim(p_search)||'%')
   and case when coalesce(p_filters->>'sales_user_id','')='' then true when p_filters->>'sales_user_id'='unassigned' then l.assigned_sales_user_id is null else l.assigned_sales_user_id=(p_filters->>'sales_user_id')::uuid end
   and (coalesce(p_filters->>'source_id','')='' or l.source_id=nullif(p_filters->>'source_id','')::uuid)
   and (coalesce(p_filters->>'purchase_type','')='' or l.purchase_type=p_filters->>'purchase_type')
   and (coalesce(p_filters->>'priority','')='' or l.priority=p_filters->>'priority')
 ) select jsonb_build_object('overdue',count(*) filter(where next_followup_at<p_day_start),'today',count(*) filter(where next_followup_at>=p_day_start and next_followup_at<p_tomorrow_start),'tomorrow',count(*) filter(where next_followup_at>=p_tomorrow_start and next_followup_at<p_day_after_tomorrow_start),'totalOpen',count(*)) into v_result from filtered;
 return v_result;
end $$;

revoke all on function public.crm_list_lead_followups(uuid,uuid,text,text,text,jsonb,timestamptz,timestamptz,timestamptz,integer,integer) from public,anon;
grant execute on function public.crm_list_lead_followups(uuid,uuid,text,text,text,jsonb,timestamptz,timestamptz,timestamptz,integer,integer) to authenticated;
revoke all on function public.crm_get_lead_followup_counts(uuid,uuid,text,text,jsonb,timestamptz,timestamptz,timestamptz) from public,anon;
grant execute on function public.crm_get_lead_followup_counts(uuid,uuid,text,text,jsonb,timestamptz,timestamptz,timestamptz) to authenticated;
commit;
