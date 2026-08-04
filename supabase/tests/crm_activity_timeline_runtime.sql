begin;

create temporary table crm_test_context as select tenant_id,id tenant_user_id,auth_user_id from public.tenant_users where auth_user_id is not null and is_active limit 1;
grant select on crm_test_context to authenticated;
create temporary table crm_other_lead as with inserted as (insert into public.crm_leads(tenant_id,customer_name,phone) values(gen_random_uuid(),'عميل Tenant آخر','09999999999') returning id) select id from inserted;
grant select on crm_other_lead to authenticated;
select set_config('request.jwt.claim.sub',auth_user_id::text,true) from crm_test_context;
set local role authenticated;

insert into public.crm_sales_users(tenant_id,user_id,active) select tenant_id,tenant_user_id,true from crm_test_context on conflict(tenant_id,user_id) do update set active=true;
create temporary table crm_test_leads(kind text,id uuid);
grant select,insert on crm_test_leads to authenticated;
insert into crm_test_leads select 'new',(public.crm_create_lead((select tenant_id from crm_test_context),jsonb_build_object('customer_name','اختبار New','phone','01000000001'))).id;
insert into crm_test_leads select 'assigned',(public.crm_create_lead((select tenant_id from crm_test_context),jsonb_build_object('customer_name','اختبار Assigned','phone','01000000002','assigned_sales_user_id',(select tenant_user_id from crm_test_context)))).id;
insert into crm_test_leads select 'installment',(public.crm_create_lead((select tenant_id from crm_test_context),jsonb_build_object('customer_name','اختبار Installment','phone','01000000003'))).id;
insert into crm_test_leads select 'sold',(public.crm_create_lead((select tenant_id from crm_test_context),jsonb_build_object('customer_name','اختبار Sold','phone','01000000004'))).id;
insert into crm_test_leads select 'cancelled',(public.crm_create_lead((select tenant_id from crm_test_context),jsonb_build_object('customer_name','اختبار Cancelled','phone','01000000005'))).id;

update public.crm_leads set status='installment_processing' where id=(select id from crm_test_leads where kind='installment');
update public.crm_leads set status='sold' where id=(select id from crm_test_leads where kind='sold');
update public.crm_leads set status='cancelled' where id=(select id from crm_test_leads where kind='cancelled');

select public.crm_add_lead_activity((select tenant_id from crm_test_context),(select id from crm_test_leads where kind='new'),'call','مهتم','اختبار مكالمة',now()+interval '2 days');
select public.crm_add_lead_activity((select tenant_id from crm_test_context),(select id from crm_test_leads where kind='assigned'),'whatsapp',null,'اختبار واتساب',null);
select public.crm_add_lead_activity((select tenant_id from crm_test_context),(select id from crm_test_leads where kind='installment'),'comment',null,'ملاحظة تقسيط',null);

do $$ declare v_tenant uuid:=(select tenant_id from crm_test_context);v_user uuid:=(select tenant_user_id from crm_test_context);v_id uuid;v_before integer;v_at timestamptz; begin
 select id into v_id from crm_test_leads where kind='new';
 if not exists(select 1 from public.crm_lead_activities where tenant_id=v_tenant and lead_id=v_id and activity_type='call') then raise exception 'call missing'; end if;
 if not exists(select 1 from public.crm_leads where id=v_id and status='in_followup' and last_activity_at is not null and last_contact_at is not null and next_followup_at is not null) then raise exception 'new followup update failed'; end if;
 if not exists(select 1 from public.crm_leads where id=(select id from crm_test_leads where kind='assigned') and status='in_followup') then raise exception 'assigned transition failed'; end if;
 if not exists(select 1 from public.crm_leads where id=(select id from crm_test_leads where kind='installment') and status='installment_processing') then raise exception 'installment status changed'; end if;
 begin perform public.crm_add_lead_activity(v_tenant,(select id from crm_test_leads where kind='sold'),'call',null,null,null);raise exception 'sold accepted';exception when others then if sqlerrm='sold accepted' then raise;end if;end;
 begin perform public.crm_add_lead_activity(v_tenant,(select id from crm_test_leads where kind='cancelled'),'call',null,null,null);raise exception 'cancelled accepted';exception when others then if sqlerrm='cancelled accepted' then raise;end if;end;
 begin perform public.crm_add_lead_activity(v_tenant,v_id,'created',null,null,null);raise exception 'invalid type accepted';exception when others then if sqlerrm='invalid type accepted' then raise;end if;end;
 if exists(select 1 from public.crm_leads where id=(select id from crm_other_lead)) then raise exception 'cross tenant row visible';end if;
 select id,assigned_at into v_id,v_at from public.crm_leads where id=(select id from crm_test_leads where kind='assigned');
 select count(*) into v_before from public.crm_lead_activities where lead_id=v_id;
 perform public.crm_update_lead_assignment(v_tenant,v_id,v_user,'same');
 if (select count(*) from public.crm_lead_activities where lead_id=v_id)<>v_before or (select assigned_at from public.crm_leads where id=v_id) is distinct from v_at then raise exception 'same assignment mutated';end if;
 update public.crm_leads set status='assigned' where id=v_id;
 perform public.crm_update_lead_assignment(v_tenant,v_id,null,'unassign');
 if not exists(select 1 from public.crm_leads where id=v_id and status='new' and assigned_sales_user_id is null) then raise exception 'unassignment transition failed';end if;
 if not exists(select 1 from public.crm_lead_activities where lead_id=v_id and activity_type='reassigned' and to_user_id is null) then raise exception 'unassignment activity missing';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('crm_leads','crm_lead_sources','crm_lead_cancel_reasons','crm_sales_users','crm_finance_companies','crm_finance_company_representatives','crm_lead_activities','crm_installment_applications','crm_installment_application_events') and not c.relrowsecurity) then raise exception 'RLS missing';end if;
end $$;

rollback;
