begin;

create temporary table crm_test_context as
select tenant_id, id as tenant_user_id, auth_user_id
from public.tenant_users
where auth_user_id is not null and is_active = true
limit 1;

grant select on crm_test_context to authenticated;

select set_config('request.jwt.claim.sub', auth_user_id::text, true) from crm_test_context;
set local role authenticated;

insert into public.crm_sales_users (tenant_id, user_id, active)
select tenant_id, tenant_user_id, true from crm_test_context
on conflict (tenant_id, user_id) do update set active = true;

create temporary table crm_created_lead as
select (public.crm_create_lead(
  (select tenant_id from crm_test_context),
  jsonb_build_object('customer_name','اختبار CRM مؤقت','phone','01000000000','purchase_type','undecided','priority','normal')
)).*;

grant select on crm_created_lead to authenticated;

do $$
declare v_lead uuid; v_tenant uuid; v_user uuid;
begin
  select id, tenant_id into v_lead, v_tenant from crm_created_lead;
  select tenant_user_id into v_user from crm_test_context;
  if not exists (select 1 from public.crm_lead_activities where tenant_id=v_tenant and lead_id=v_lead and activity_type='created') then raise exception 'created activity missing'; end if;
  perform public.crm_update_lead_assignment(v_tenant,v_lead,v_user,'اختبار تعيين مؤقت');
  if not exists (select 1 from public.crm_lead_activities where tenant_id=v_tenant and lead_id=v_lead and activity_type='assigned' and to_user_id=v_user) then raise exception 'assigned activity missing'; end if;
end $$;

rollback;
