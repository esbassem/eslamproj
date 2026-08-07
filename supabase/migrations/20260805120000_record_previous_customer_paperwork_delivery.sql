begin;

create or replace function public.record_previous_customer_paperwork_delivery(
  p_tenant_id uuid,
  p_request_id uuid,
  p_reason text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_user_id uuid;
  v_request public.paperwork_requests%rowtype;
  v_document public.paperwork_documents%rowtype;
  v_document_count integer := 0;
  v_latest_move public.paperwork_document_moves%rowtype;
  v_move_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_now timestamptz := clock_timestamp();
  v_event_notes text;
  v_event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;
  if p_tenant_id is null or p_request_id is null then
    raise exception 'تعذر تحديد الشركة أو طلب الأوراق.';
  end if;
  if v_reason is null or v_reason not in (
    'delivered_before_system_use',
    'delivery_not_recorded',
    'owner_confirmed_previous_delivery',
    'other'
  ) then
    raise exception 'سبب التسجيل المتأخر غير صالح.';
  end if;
  if v_reason = 'other' and v_notes is null then
    raise exception 'الملاحظات إلزامية عند اختيار سبب آخر.';
  end if;

  select tenant_user.id into v_tenant_user_id
  from public.tenant_users tenant_user
  where tenant_user.tenant_id = p_tenant_id
    and tenant_user.auth_user_id = auth.uid()
    and tenant_user.is_active = true
  order by tenant_user.created_at, tenant_user.id
  limit 1;

  if v_tenant_user_id is null then
    raise exception 'لا تملك صلاحية الوصول إلى هذه الشركة.';
  end if;
  if not public.is_tenant_owner(p_tenant_id) then
    raise exception 'هذا الإجراء الاستثنائي متاح لمالك الشركة فقط.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':previous-customer-delivery:' || p_request_id::text, 0));

  select request.* into v_request
  from public.paperwork_requests request
  where request.tenant_id = p_tenant_id and request.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'طلب الأوراق غير موجود داخل هذه الشركة.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'لا يمكن تنفيذ الإجراء على طلب غير مفتوح.';
  end if;
  if v_request.current_stage = 'delivered' then
    raise exception 'تم تسجيل تسليم هذا الطلب بالفعل.';
  end if;

  select count(*) into v_document_count
  from public.paperwork_documents document
  where document.tenant_id = p_tenant_id
    and document.paperwork_request_id = p_request_id;

  if v_document_count > 1 then
    raise exception 'يوجد أكثر من مستند مرتبط بالطلب ويجب مراجعة البيانات قبل تنفيذ الإجراء.';
  end if;

  select document.* into v_document
  from public.paperwork_documents document
  where document.tenant_id = p_tenant_id
    and document.paperwork_request_id = p_request_id
  order by document.created_at, document.id
  limit 1
  for update;

  if v_document.id is not null then
    if v_document.status <> 'in_custody' then
      raise exception 'المستند المرتبط بالطلب ليس داخل العهدة ولا يمكن تسجيل خروجه.';
    end if;

    select movement.* into v_latest_move
    from public.paperwork_document_moves movement
    where movement.tenant_id = p_tenant_id
      and movement.document_id = v_document.id
    order by movement.moved_at desc, movement.created_at desc, movement.id desc
    limit 1
    for update;

    if v_latest_move.id is null or v_latest_move.move_direction <> 'in' then
      raise exception 'آخر حركة للمستند لا تثبت وجوده داخل العهدة.';
    end if;
    insert into public.paperwork_document_moves (
      tenant_id, document_id, move_direction, source_type,
      from_user_id, from_location, to_partner_id, to_location,
      moved_at, notes, created_by
    ) values (
      p_tenant_id, v_document.id, 'out', 'retrospective_delivery',
      v_latest_move.to_user_id,
      coalesce(nullif(v_latest_move.to_location, ''), 'vault'),
      coalesce(v_request.customer_id, v_document.owner_partner_id),
      'customer', v_now,
      concat_ws(chr(10), 'retrospective_reason=' || v_reason, v_notes),
      v_tenant_user_id
    ) returning id into v_move_id;

    update public.paperwork_documents
    set status = 'delivered_to_customer', updated_at = v_now
    where tenant_id = p_tenant_id and id = v_document.id;
  end if;

  v_event_notes := concat_ws(
    chr(10),
    'تم تسجيل أن العميل استلم الأوراق سابقًا.',
    'retrospective_reason=' || v_reason,
    'recorded_at=' || v_now::text,
    case when v_document.id is null then 'linked_document=none' else 'linked_document=' || v_document.id::text end,
    v_notes
  );

  update public.paperwork_requests
  set current_stage = 'delivered',
      stage_entered_at = v_now,
      status = 'done',
      closed_at = v_now,
      updated_at = v_now
  where tenant_id = p_tenant_id and id = p_request_id;

  insert into public.paperwork_request_events (
    tenant_id, request_id, event_type, old_stage, new_stage,
    new_status, notes, created_by
  ) values (
    p_tenant_id, p_request_id, 'done', v_request.current_stage, 'delivered',
    'done', v_event_notes, v_tenant_user_id
  ) returning id into v_event_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'document_id', v_document.id,
    'document_move_id', v_move_id,
    'event_id', v_event_id,
    'old_stage', v_request.current_stage,
    'current_stage', 'delivered',
    'status', 'done',
    'delivered_at', v_now,
    'closed_at', v_now,
    'updated_at', v_now,
    'reason', v_reason,
    'notes', v_notes
  );
end;
$$;

revoke all on function public.record_previous_customer_paperwork_delivery(uuid, uuid, text, text) from public, anon;
grant execute on function public.record_previous_customer_paperwork_delivery(uuid, uuid, text, text) to authenticated;

comment on function public.record_previous_customer_paperwork_delivery(uuid, uuid, text, text) is
'Atomically closes an existing paperwork request as previously delivered and releases its linked in-custody document when present.';

notify pgrst, 'reload schema';

commit;
