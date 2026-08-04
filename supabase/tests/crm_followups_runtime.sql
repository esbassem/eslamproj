begin;
create temporary table crm_followup_context as select tenant_id,id tenant_user_id,auth_user_id from public.tenant_users where auth_user_id is not null and is_active limit 1;grant select on crm_followup_context to authenticated;
select set_config('request.jwt.claim.sub',auth_user_id::text,true)from crm_followup_context;set local role authenticated;
insert into public.crm_sales_users(tenant_id,user_id,active)select tenant_id,tenant_user_id,true from crm_followup_context on conflict(tenant_id,user_id)do update set active=true;
do $$declare t uuid:=(select tenant_id from crm_followup_context);u uuid:=(select tenant_user_id from crm_followup_context);d0 timestamptz:=(date_trunc('day',now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo');d1 timestamptz;d2 timestamptz;s uuid;l_over uuid;l_today uuid;l_tomorrow uuid;l_upcoming uuid;l_sold uuid;l_cancelled uuid;l_order_low uuid;l_order_urgent uuid;r jsonb;c jsonb;begin
 d1:=d0+interval '1 day';d2:=d0+interval '2 days';
 begin
  perform public.crm_list_lead_followups(gen_random_uuid(),u,'all','all','','{}'::jsonb,d0,d1,d2,1,25);
  raise exception 'tenant isolation failed';
 exception when others then
  if sqlerrm='tenant isolation failed' then raise;end if;
 end;
 insert into public.crm_lead_sources(tenant_id,name,active,created_by)values(t,'مصدر متابعة اختبار',true,u)returning id into s;
 l_over:=(public.crm_create_lead(t,jsonb_build_object('customer_name','اختبار متأخر','phone','01110000001','source_id',s,'purchase_type','cash','assigned_sales_user_id',u,'next_followup_at',(d0-interval '3 hours')::text))).id;
 l_today:=(public.crm_create_lead(t,jsonb_build_object('customer_name','اختبار اليوم','phone','01110000002','source_id',s,'next_followup_at',(d0+interval '4 hours')::text))).id;
 l_tomorrow:=(public.crm_create_lead(t,jsonb_build_object('customer_name','اختبار غدًا','phone','01110000003','next_followup_at',(d1+interval '5 hours')::text))).id;
 l_upcoming:=(public.crm_create_lead(t,jsonb_build_object('customer_name','اختبار القادم','phone','01110000004','next_followup_at',(d2+interval '2 hours')::text))).id;
 l_sold:=(public.crm_create_lead(t,jsonb_build_object('customer_name','اختبار مباع متابعة','phone','01110000005','next_followup_at',(d0+interval '2 hours')::text))).id;update public.crm_leads set status='sold' where id=l_sold;
 l_cancelled:=(public.crm_create_lead(t,jsonb_build_object('customer_name','اختبار ملغي متابعة','phone','01110000006','next_followup_at',(d0+interval '2 hours')::text))).id;update public.crm_leads set status='cancelled' where id=l_cancelled;
 l_order_low:=(public.crm_create_lead(t,jsonb_build_object('customer_name','اختبار ترتيب منخفض','phone','01110000007','priority','low','next_followup_at',(d1+interval '7 hours')::text))).id;
 l_order_urgent:=(public.crm_create_lead(t,jsonb_build_object('customer_name','اختبار ترتيب عاجل','phone','01110000008','priority','urgent','next_followup_at',(d1+interval '7 hours')::text))).id;
 r:=public.crm_list_lead_followups(t,u,'all','overdue','', '{}'::jsonb,d0,d1,d2,1,25);if not (r->'data' @> jsonb_build_array(jsonb_build_object('id',l_over)))then raise exception 'overdue missing';end if;
 r:=public.crm_list_lead_followups(t,u,'all','today','', '{}'::jsonb,d0,d1,d2,1,25);if not (r->'data' @> jsonb_build_array(jsonb_build_object('id',l_today)))then raise exception 'today missing';end if;if r->'data' @> jsonb_build_array(jsonb_build_object('id',l_sold)) or r->'data' @> jsonb_build_array(jsonb_build_object('id',l_cancelled))then raise exception 'terminal visible';end if;
 r:=public.crm_list_lead_followups(t,u,'all','tomorrow','', '{}'::jsonb,d0,d1,d2,1,25);if not (r->'data' @> jsonb_build_array(jsonb_build_object('id',l_tomorrow)))then raise exception 'tomorrow missing';end if;
 r:=public.crm_list_lead_followups(t,u,'all','upcoming','', '{}'::jsonb,d0,d1,d2,1,25);if not (r->'data' @> jsonb_build_array(jsonb_build_object('id',l_upcoming)))then raise exception 'upcoming missing';end if;
 r:=public.crm_list_lead_followups(t,u,'mine','all','اختبار متأخر','{}'::jsonb,d0,d1,d2,1,25);if (r->>'count')::int<>1 then raise exception 'mine/search failed';end if;
 r:=public.crm_list_lead_followups(t,u,'all','all','اختبار متأخر',jsonb_build_object('sales_user_id',u),d0,d1,d2,1,25);if (r->>'count')::int<>1 then raise exception 'sales filter failed';end if;
 r:=public.crm_list_lead_followups(t,u,'all','all','01110000002',jsonb_build_object('source_id',s,'purchase_type','undecided'),d0,d1,d2,1,25);if (r->>'count')::int<>1 then raise exception 'phone/source/purchase filter failed';end if;
 r:=public.crm_list_lead_followups(t,u,'all','all','اختبار ترتيب','{}'::jsonb,d0,d1,d2,1,1);if (r->>'count')::int<>2 or (r->'data'->0->>'id')::uuid<>l_order_urgent then raise exception 'pagination/priority ordering failed';end if;
 c:=public.crm_get_lead_followup_counts(t,u,'all','اختبار','{}'::jsonb,d0,d1,d2);if (c->>'overdue')::int<1 or (c->>'today')::int<1 or (c->>'tomorrow')::int<1 or (c->>'totalOpen')::int<4 then raise exception 'counts failed';end if;
 perform public.crm_add_lead_activity(t,l_over,'call','تم','نقل لغدًا',d1+interval '3 hours');
 r:=public.crm_list_lead_followups(t,u,'all','overdue','اختبار متأخر','{}'::jsonb,d0,d1,d2,1,25);if (r->>'count')::int<>0 then raise exception 'overdue transition failed';end if;
 r:=public.crm_list_lead_followups(t,u,'all','tomorrow','اختبار متأخر','{}'::jsonb,d0,d1,d2,1,25);if (r->>'count')::int<>1 then raise exception 'tomorrow transition failed';end if;
 c:=public.crm_get_lead_followup_counts(t,u,'all','اختبار متأخر','{}'::jsonb,d0,d1,d2);if (c->>'overdue')::int<>0 or (c->>'tomorrow')::int<>1 then raise exception 'counts transition failed';end if;
end $$;
rollback;
