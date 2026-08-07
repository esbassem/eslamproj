begin;

create or replace function public.cancel_paperwork_request(
  p_tenant_id uuid,
  p_request_id uuid,
  p_reason text,
  p_notes text default null,
  p_processor_cancellation_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.tenant_users%rowtype;
  v_request public.paperwork_requests%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_now timestamptz := clock_timestamp();
  v_event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولًا.';
  end if;
  if p_tenant_id is null or p_request_id is null then
    raise exception 'تعذر تحديد الشركة أو طلب الأوراق.';
  end if;
  if v_reason is null or v_reason not in (
    'customer_request', 'request_created_by_mistake', 'duplicate_request',
    'sale_cancelled', 'other'
  ) then
    raise exception 'سبب إلغاء الطلب غير صالح.';
  end if;
  if v_reason = 'other' and v_notes is null then
    raise exception 'الملاحظات إلزامية عند اختيار سبب آخر.';
  end if;
  if not coalesce(p_processor_cancellation_confirmed, false) then
    raise exception 'يجب تأكيد أن الأوراق لم تُنجز لدى جهة الإصدار ويمكن إلغاؤها لديها.';
  end if;

  select * into v_user
  from public.tenant_users
  where tenant_id = p_tenant_id
    and auth_user_id = auth.uid()
    and is_active = true
  order by created_at, id
  limit 1;

  if v_user.id is null then
    raise exception 'لا تملك صلاحية الوصول إلى هذه الشركة.';
  end if;
  if not public.is_tenant_owner(p_tenant_id) then
    raise exception 'إلغاء طلب الأوراق متاح لمالك الشركة فقط.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':cancel-paperwork-request:' || p_request_id::text, 0)
  );

  select * into v_request
  from public.paperwork_requests
  where tenant_id = p_tenant_id and id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'طلب الأوراق غير موجود داخل هذه الشركة.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'لا يمكن إلغاء طلب غير مفتوح.';
  end if;
  if v_request.current_stage not in (
    'preparation', 'owner_confirmation', 'sent_to_processor'
  ) then
    raise exception 'لا يمكن إلغاء الطلب بعد تنفيذ الأوراق لدى جهة الإصدار أو استلامها منها.';
  end if;
  if exists (
    select 1 from public.paperwork_documents
    where tenant_id = p_tenant_id and paperwork_request_id = p_request_id
  ) then
    raise exception 'يوجد مستند مرتبط بالطلب؛ لا يمكن إلغاؤه من هذا المسار.';
  end if;

  update public.paperwork_requests
  set status = 'cancelled',
      current_stage = 'cancelled',
      cancel_reason = v_reason,
      processor_cancellation_confirmed_at = v_now,
      processor_cancellation_confirmed_by = v_user.id,
      processor_cancellation_confirmation_notes = v_notes,
      closed_at = v_now,
      stage_entered_at = v_now,
      updated_at = v_now
  where tenant_id = p_tenant_id and id = p_request_id;

  insert into public.paperwork_request_events (
    tenant_id, request_id, event_type, old_stage, new_stage,
    old_status, new_status, notes, created_by
  ) values (
    p_tenant_id, p_request_id, 'cancelled', v_request.current_stage, 'cancelled',
    v_request.status, 'cancelled',
    jsonb_build_object(
      'message', 'تم إلغاء طلب الأوراق.',
      'reason', v_reason,
      'notes', v_notes,
      'issuer_not_completed_confirmed', true,
      'processor_partner_id', v_request.processor_partner_id,
      'cancelled_at', v_now
    )::text,
    v_user.id
  ) returning id into v_event_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'event_id', v_event_id,
    'old_stage', v_request.current_stage,
    'current_stage', 'cancelled',
    'status', 'cancelled',
    'closed_at', v_now,
    'updated_at', v_now,
    'reason', v_reason,
    'notes', v_notes
  );
end;
$$;

revoke all on function public.cancel_paperwork_request(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.cancel_paperwork_request(uuid, uuid, text, text, boolean) to authenticated;

comment on function public.cancel_paperwork_request(uuid, uuid, text, text, boolean) is
'Atomically cancels an open paperwork request before issuer receipt after explicit confirmation that the issuer has not completed the paperwork.';

notify pgrst, 'reload schema';

commit;
