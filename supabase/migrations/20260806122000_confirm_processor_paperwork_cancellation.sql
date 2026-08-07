begin;

create or replace function public.can_manage_paperwork_requests(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.tenant_users u
    where u.tenant_id=p_tenant_id and u.auth_user_id=auth.uid() and u.is_active=true
      and u.role in('owner','admin','staff')
  )
$$;

revoke all on function public.can_manage_paperwork_requests(uuid) from public,anon;
grant execute on function public.can_manage_paperwork_requests(uuid) to authenticated;

create or replace function public.guard_paperwork_processor_cancellation()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_blocker public.paperwork_requests%rowtype;
begin
  if old.current_stage='pending_processor_cancellation' and (
    new.current_stage<>'cancelled' or new.status<>'cancelled'
    or new.processor_cancellation_confirmed_at is null
    or new.processor_cancellation_confirmed_by is null
    or current_setting('app.processor_cancellation_confirmation',true) is distinct from 'allowed'
  ) then
    raise exception 'طلب الأوراق ينتظر تأكيد الإلغاء لدى جهة الإصدار ولا يقبل أي انتقال آخر.';
  end if;

  if new.current_stage='sent_to_processor' and old.current_stage is distinct from new.current_stage
     and new.processor_cancellation_blocking_request_id is not null then
    select * into v_blocker from public.paperwork_requests
      where tenant_id=new.tenant_id and id=new.processor_cancellation_blocking_request_id;
    if v_blocker.id is not null
       and v_blocker.processor_partner_id is not distinct from new.processor_partner_id
       and not (v_blocker.status='cancelled' and v_blocker.current_stage='cancelled') then
      raise exception 'يوجد طلب سابق لدى جهة الإصدار ينتظر تأكيد الإلغاء بسبب استبدال القطعة. أكد إلغاء الطلب السابق أولًا.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists paperwork_requests_guard_processor_cancellation on public.paperwork_requests;
create trigger paperwork_requests_guard_processor_cancellation
before update on public.paperwork_requests for each row
execute function public.guard_paperwork_processor_cancellation();

create or replace function public.confirm_processor_paperwork_cancellation(
  p_tenant_id uuid,p_request_id uuid,p_notes text default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_request public.paperwork_requests%rowtype;
  v_user public.tenant_users%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولًا.'; end if;
  if p_tenant_id is null or p_request_id is null then raise exception 'بيانات طلب الأوراق غير مكتملة.'; end if;
  if not public.can_manage_paperwork_requests(p_tenant_id) then
    raise exception 'ليس لديك صلاحية تأكيد إلغاء الطلب لدى جهة إصدار الأوراق.';
  end if;
  select * into v_user from public.tenant_users
    where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active=true limit 1;
  select * into v_request from public.paperwork_requests
    where tenant_id=p_tenant_id and id=p_request_id for update;
  if v_request.id is null then raise exception 'طلب الأوراق غير موجود.'; end if;
  if v_request.current_stage<>'pending_processor_cancellation' or v_request.status<>'open' then
    raise exception 'الطلب لا ينتظر تأكيد الإلغاء لدى جهة الإصدار.';
  end if;
  perform set_config('app.processor_cancellation_confirmation','allowed',true);

  update public.paperwork_requests set
    status='cancelled',current_stage='cancelled',cancel_reason='processor_cancellation_confirmed_after_sale_return',
    processor_cancellation_confirmed_at=v_now,processor_cancellation_confirmed_by=v_user.id,
    processor_cancellation_confirmation_notes=nullif(btrim(coalesce(p_notes,'')),''),
    closed_at=v_now,stage_entered_at=v_now,updated_at=v_now
  where tenant_id=p_tenant_id and id=p_request_id;

  insert into public.paperwork_request_events(
    tenant_id,request_id,event_type,old_stage,new_stage,old_status,new_status,notes,created_by
  ) values(
    p_tenant_id,p_request_id,'processor_cancellation_confirmed','pending_processor_cancellation','cancelled','open','cancelled',
    jsonb_build_object('message','تم تأكيد إلغاء الطلب لدى جهة إصدار الأوراق.','return_operation_id',v_request.sale_return_operation_id,
      'processor_partner_id',v_request.processor_partner_id,'notes',nullif(btrim(coalesce(p_notes,'')),''),'confirmed_by',v_user.id,'confirmed_at',v_now)::text,v_user.id
  );
  return jsonb_build_object('request_id',p_request_id,'status','cancelled','current_stage','cancelled',
    'confirmed_at',v_now,'confirmed_by',v_user.id);
end $$;

revoke all on function public.confirm_processor_paperwork_cancellation(uuid,uuid,text) from public,anon;
grant execute on function public.confirm_processor_paperwork_cancellation(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
