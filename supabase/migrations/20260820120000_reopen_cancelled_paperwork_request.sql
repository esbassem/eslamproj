begin;

alter table public.paperwork_request_events
  drop constraint if exists paperwork_request_events_event_type_check;

alter table public.paperwork_request_events
  add constraint paperwork_request_events_event_type_check
  check (event_type in (
    'created', 'stage_changed', 'assigned', 'supplier_selected',
    'sent_to_supplier', 'sent_to_processor', 'supplier_finished',
    'received_from_supplier', 'client_notified', 'customer_notified',
    'delivered_to_customer', 'blocked', 'unblocked', 'deferred', 'done',
    'cancelled', 'reopened', 'note',
    'processor_cancellation_required_by_sale_return',
    'processor_cancellation_confirmed',
    'paperwork_request_cancelled_by_sale_replacement',
    'paperwork_request_cancelled_by_sale_return',
    'created_from_sale_return_exchange'
  ));

create or replace function public.reopen_cancelled_paperwork_request(
  p_tenant_id uuid,
  p_request_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.tenant_users%rowtype;
  v_request public.paperwork_requests%rowtype;
  v_cancellation_event public.paperwork_request_events%rowtype;
  v_restore_stage text;
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
    raise exception 'التراجع عن إلغاء طلب الأوراق متاح لمالك الشركة فقط.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':reopen-paperwork-request:' || p_request_id::text, 0)
  );

  select * into v_request
  from public.paperwork_requests
  where tenant_id = p_tenant_id and id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'طلب الأوراق غير موجود داخل هذه الشركة.';
  end if;
  if v_request.status <> 'cancelled' or v_request.current_stage <> 'cancelled' then
    raise exception 'يمكن التراجع فقط عن طلب ملغي.';
  end if;

  select * into v_cancellation_event
  from public.paperwork_request_events
  where tenant_id = p_tenant_id
    and request_id = p_request_id
    and event_type = 'cancelled'
    and new_status = 'cancelled'
  order by created_at desc, id desc
  limit 1;

  if v_cancellation_event.id is null then
    raise exception 'لا يمكن التراجع عن هذا الإلغاء لأنه لم يتم من إجراء الإلغاء اليدوي.';
  end if;

  v_restore_stage := case v_cancellation_event.old_stage
    when 'owner_confirmation' then 'preparation'
    when 'processor_ready' then 'sent_to_processor'
    else v_cancellation_event.old_stage
  end;
  if v_restore_stage not in ('preparation', 'sent_to_processor') then
    raise exception 'المرحلة السابقة للطلب غير صالحة لإعادة الفتح.';
  end if;

  if v_request.sale_line_id is not null and exists (
    select 1
    from public.paperwork_requests other_request
    where other_request.tenant_id = p_tenant_id
      and other_request.sale_line_id = v_request.sale_line_id
      and other_request.id <> p_request_id
      and other_request.status <> 'cancelled'
  ) then
    raise exception 'لا يمكن إعادة فتح الطلب لوجود طلب أوراق نشط لنفس بند البيع.';
  end if;

  if exists (
    select 1 from public.paperwork_documents
    where tenant_id = p_tenant_id and paperwork_request_id = p_request_id
  ) then
    raise exception 'لا يمكن إعادة فتح الطلب لوجود مستند مرتبط به بعد الإلغاء.';
  end if;

  update public.paperwork_requests
  set status = 'open',
      current_stage = v_restore_stage,
      cancel_reason = null,
      processor_cancellation_confirmed_at = null,
      processor_cancellation_confirmed_by = null,
      processor_cancellation_confirmation_notes = null,
      closed_at = null,
      stage_entered_at = v_now,
      updated_at = v_now
  where tenant_id = p_tenant_id and id = p_request_id;

  insert into public.paperwork_request_events (
    tenant_id, request_id, event_type, old_stage, new_stage,
    old_status, new_status, notes, created_by
  ) values (
    p_tenant_id, p_request_id, 'reopened', 'cancelled', v_restore_stage,
    'cancelled', 'open',
    jsonb_build_object(
      'message', 'تم التراجع عن إلغاء طلب الأوراق وإعادة فتحه.',
      'restored_stage', v_restore_stage,
      'notes', v_notes,
      'reopened_at', v_now
    )::text,
    v_user.id
  ) returning id into v_event_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'event_id', v_event_id,
    'old_stage', 'cancelled',
    'current_stage', v_restore_stage,
    'status', 'open',
    'closed_at', null,
    'updated_at', v_now,
    'notes', v_notes
  );
end;
$$;

revoke all on function public.reopen_cancelled_paperwork_request(uuid, uuid, text) from public, anon;
grant execute on function public.reopen_cancelled_paperwork_request(uuid, uuid, text) to authenticated;

comment on function public.reopen_cancelled_paperwork_request(uuid, uuid, text) is
'Reopens a manually cancelled paperwork request at its pre-cancellation stage while preserving an audit event.';

notify pgrst, 'reload schema';

commit;
