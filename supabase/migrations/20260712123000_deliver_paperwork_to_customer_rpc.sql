create or replace function public.deliver_paperwork_to_customer(
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
  v_document public.paperwork_documents;
  v_now timestamptz := now();
  v_notes text := 'تم تسليم الأوراق للعميل وإخراجها من الخزنة.';
begin
  if p_tenant_id is null or p_request_id is null then
    raise exception 'تعذر تحديد الشركة أو طلب الأوراق.';
  end if;

  select tu.id into v_user_id
  from public.tenant_users tu
  where tu.tenant_id = p_tenant_id
    and tu.auth_user_id = auth.uid()
    and tu.is_active = true
  limit 1;

  if v_user_id is null then
    raise exception 'Current user is not an active tenant user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_request_id::text, 0));

  select pr.* into v_request
  from public.paperwork_requests pr
  where pr.tenant_id = p_tenant_id and pr.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'طلب الأوراق غير موجود.';
  end if;
  if v_request.current_stage <> 'client_notified' then
    raise exception 'لا يمكن التسليم قبل إبلاغ العميل.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'لا يمكن التسليم في طلب غير مفتوح.';
  end if;

  select pd.* into v_document
  from public.paperwork_documents pd
  where pd.tenant_id = p_tenant_id
    and pd.paperwork_request_id = v_request.id
    and pd.status = 'in_custody'
  order by pd.created_at asc
  limit 1
  for update;

  if v_document.id is null then
    raise exception 'لا توجد ورقة في الخزنة مرتبطة بهذا الطلب.';
  end if;

  update public.paperwork_requests
  set current_stage = 'delivered', status = 'done', closed_at = v_now, updated_at = v_now
  where id = v_request.id;

  update public.paperwork_documents
  set status = 'delivered_to_customer', updated_at = v_now
  where id = v_document.id;

  insert into public.paperwork_document_moves (
    tenant_id, document_id, move_direction, source_type,
    from_user_id, from_location, to_partner_id, moved_at, notes, created_by
  ) values (
    p_tenant_id, v_document.id, 'out', 'to_customer',
    v_user_id, 'vault', v_request.customer_id, v_now, v_notes, v_user_id
  );

  insert into public.paperwork_request_events (
    tenant_id, request_id, event_type, old_stage, new_stage,
    new_status, notes, created_by
  ) values (
    p_tenant_id, v_request.id, 'done', v_request.current_stage, 'delivered',
    'done', v_notes, v_user_id
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'document_id', v_document.id,
    'old_stage', v_request.current_stage,
    'current_stage', 'delivered',
    'status', 'done',
    'updated_at', v_now
  );
end;
$$;

grant execute on function public.deliver_paperwork_to_customer(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
