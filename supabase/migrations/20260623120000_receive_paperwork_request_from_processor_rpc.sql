create or replace function public.receive_paperwork_request_from_processor(
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
  v_old_stage text;
  v_now timestamptz := now();
  v_notes text := 'تم استلام الأوراق من الجهة وإيداعها بالخزنة.';
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

  if v_request.current_stage not in ('sent_to_processor', 'processor_ready') then
    raise exception 'لا يمكن استلام طلب ليس موجودًا لدى الجهة.';
  end if;

  if v_request.status <> 'open' then
    raise exception 'لا يمكن استلام طلب غير مفتوح.';
  end if;

  v_old_stage := v_request.current_stage;

  update public.paperwork_requests
  set current_stage = 'received_from_processor',
      updated_at = v_now
  where id = v_request.id;

  select pd.*
  into v_document
  from public.paperwork_documents pd
  where pd.tenant_id = p_tenant_id
    and pd.paperwork_request_id = v_request.id
  order by pd.created_at asc
  limit 1
  for update;

  if v_document.id is null then
    insert into public.paperwork_documents (
      tenant_id,
      branch_id,
      paperwork_request_id,
      tracking_unit_id,
      owner_partner_id,
      source_type,
      document_type,
      document_title,
      status,
      notes,
      created_by
    )
    values (
      p_tenant_id,
      v_request.branch_id,
      v_request.id,
      v_request.tracking_unit_id,
      v_request.document_owner_partner_id,
      'paperwork_request',
      'jawab',
      'جواب',
      'in_custody',
      v_notes,
      v_user_id
    )
    returning *
    into v_document;
  else
    update public.paperwork_documents
    set status = 'in_custody',
        updated_at = v_now
    where id = v_document.id
    returning *
    into v_document;
  end if;

  insert into public.paperwork_document_moves (
    tenant_id,
    document_id,
    move_direction,
    source_type,
    from_partner_id,
    to_user_id,
    to_location,
    moved_at,
    notes,
    created_by
  )
  values (
    p_tenant_id,
    v_document.id,
    'in',
    'from_processor',
    v_request.processor_partner_id,
    v_user_id,
    'vault',
    v_now,
    v_notes,
    v_user_id
  );

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
    'received_from_supplier',
    v_request.current_stage,
    'received_from_processor',
    v_notes,
    v_user_id
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'document_id', v_document.id,
    'old_stage', v_old_stage,
    'current_stage', 'received_from_processor',
    'updated_at', v_now
  );
end;
$$;

grant execute on function public.receive_paperwork_request_from_processor(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
