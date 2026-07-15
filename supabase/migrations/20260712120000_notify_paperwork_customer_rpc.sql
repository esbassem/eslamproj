create or replace function public.notify_paperwork_customer(
  p_tenant_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_request public.paperwork_requests;
  v_now timestamptz := now();
  v_notes text := 'تم إبلاغ العميل بوصول الأوراق وجاهزيتها للاستلام.';
begin
  if p_tenant_id is null or p_request_id is null then
    raise exception 'تعذر تحديد الشركة أو طلب الأوراق.';
  end if;

  select tu.id
  into v_user_id
  from public.tenant_users tu
  where tu.tenant_id = p_tenant_id
    and tu.auth_user_id = auth.uid()
    and tu.is_active = true
  limit 1;

  if v_user_id is null then
    raise exception 'Current user is not an active tenant user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_request_id::text, 0));

  select pr.*
  into v_request
  from public.paperwork_requests pr
  where pr.tenant_id = p_tenant_id
    and pr.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'طلب الأوراق غير موجود.';
  end if;

  if v_request.current_stage <> 'received_from_processor' then
    raise exception 'لا يمكن إبلاغ العميل قبل استلام الأوراق من الجهة.';
  end if;

  if v_request.status <> 'open' then
    raise exception 'لا يمكن إبلاغ العميل في طلب غير مفتوح.';
  end if;

  update public.paperwork_requests
  set current_stage = 'client_notified',
      updated_at = v_now
  where id = v_request.id;

  insert into public.paperwork_request_events (
    tenant_id,
    request_id,
    event_type,
    old_stage,
    new_stage,
    notes,
    created_by
  )
  values (
    p_tenant_id,
    v_request.id,
    'note',
    v_request.current_stage,
    'client_notified',
    v_notes,
    v_user_id
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'old_stage', v_request.current_stage,
    'current_stage', 'client_notified',
    'updated_at', v_now
  );
end;
$$;

grant execute on function public.notify_paperwork_customer(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
