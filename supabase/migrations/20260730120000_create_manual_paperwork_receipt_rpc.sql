create or replace function public.create_manual_paperwork_receipt(
  p_tenant_id uuid,
  p_tracking_unit_id uuid,
  p_paperwork_request_id uuid default null,
  p_document_title text default 'جواب',
  p_document_owner_name text default null,
  p_owner_partner_id uuid default null,
  p_initial_location text default null,
  p_notes text default null
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
  v_existing_document public.paperwork_documents;
  v_old_stage text;
  v_document_owner_name text;
  v_now timestamptz := now();
  v_should_advance boolean := false;
begin
  if p_tenant_id is null or p_tracking_unit_id is null then
    raise exception 'تعذر تحديد الشركة أو القطعة.';
  end if;

  select tu.id
  into v_user_id
  from public.tenant_users tu
  where tu.tenant_id = p_tenant_id
    and tu.auth_user_id = auth.uid()
    and tu.is_active = true
  limit 1;

  if v_user_id is null then
    raise exception 'تعذر تحديد مستخدم الشركة الحالي.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':manual-paperwork:' || p_tracking_unit_id::text, 0)
  );

  perform 1
  from public.stock_tracking_units stu
  where stu.tenant_id = p_tenant_id
    and stu.id = p_tracking_unit_id
  for update;

  if not found then
    raise exception 'القطعة المسجلة غير موجودة.';
  end if;

  if p_paperwork_request_id is not null then
    select pr.*
    into v_request
    from public.paperwork_requests pr
    where pr.tenant_id = p_tenant_id
      and pr.id = p_paperwork_request_id
    for update;

    if v_request.id is null
      or v_request.tracking_unit_id is distinct from p_tracking_unit_id
      or v_request.status <> 'open'
      or v_request.current_stage not in (
        'preparation',
        'owner_confirmation',
        'sent_to_processor',
        'processor_ready',
        'received_from_processor',
        'client_notified'
      )
    then
      raise exception 'تغيرت بيانات الطلب أو لم يعد مفتوحًا. حدّث البيانات وحاول مرة أخرى.';
    end if;

    select pd.*
    into v_existing_document
    from public.paperwork_documents pd
    where pd.tenant_id = p_tenant_id
      and pd.paperwork_request_id = p_paperwork_request_id
    order by pd.created_at asc
    limit 1
    for update;

    if v_existing_document.id is not null then
      raise exception 'تغيرت بيانات الطلب أو تم تسجيل جواب له بالفعل. حدّث البيانات وحاول مرة أخرى.';
    end if;
  end if;

  v_document_owner_name := case
    when v_request.id is not null
      then nullif(trim(coalesce(v_request.document_owner_name, '')), '')
    else nullif(trim(coalesce(p_document_owner_name, '')), '')
  end;

  if nullif(trim(coalesce(p_document_title, '')), '') is null then
    raise exception 'عنوان المستند مطلوب.';
  end if;

  if v_document_owner_name is null then
    raise exception 'اسم صاحب الجواب مطلوب.';
  end if;

  select pd.*
  into v_existing_document
  from public.paperwork_documents pd
  where pd.tenant_id = p_tenant_id
    and pd.tracking_unit_id = p_tracking_unit_id
    and pd.document_type = 'jawab'
    and pd.status = 'in_custody'
  order by pd.created_at asc
  limit 1
  for update;

  if v_existing_document.id is not null then
    raise exception 'تم تسجيل جواب فعّال لهذه القطعة بالفعل. حدّث البيانات وحاول مرة أخرى.';
  end if;

  insert into public.paperwork_documents (
    tenant_id,
    branch_id,
    document_type,
    document_title,
    document_owner_name,
    tracking_unit_id,
    paperwork_request_id,
    owner_partner_id,
    source_type,
    status,
    notes,
    created_by
  )
  values (
    p_tenant_id,
    v_request.branch_id,
    'jawab',
    coalesce(nullif(trim(coalesce(p_document_title, '')), ''), 'جواب'),
    v_document_owner_name,
    p_tracking_unit_id,
    p_paperwork_request_id,
    case
      when v_request.id is not null then v_request.customer_id
      else p_owner_partner_id
    end,
    'manual',
    'in_custody',
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user_id
  )
  returning *
  into v_document;

  insert into public.paperwork_document_moves (
    tenant_id,
    document_id,
    move_direction,
    source_type,
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
    'manual',
    v_user_id,
    nullif(trim(coalesce(p_initial_location, '')), ''),
    v_now,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user_id
  );

  if v_request.id is not null then
    v_old_stage := v_request.current_stage;
    v_should_advance := v_old_stage in (
      'preparation',
      'owner_confirmation',
      'sent_to_processor',
      'processor_ready'
    );

    if v_should_advance then
      update public.paperwork_requests
      set current_stage = 'received_from_processor',
          stage_entered_at = v_now,
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
        'stage_changed',
        v_old_stage,
        'received_from_processor',
        'تم استلام الجواب يدويًا وربطه بطلب الأوراق.',
        v_user_id
      );
    end if;
  end if;

  return jsonb_build_object(
    'document_id', v_document.id,
    'request_id', v_request.id,
    'old_stage', v_old_stage,
    'current_stage', case
      when v_should_advance then 'received_from_processor'
      else v_request.current_stage
    end,
    'updated_at', v_now
  );
end;
$$;

grant execute on function public.create_manual_paperwork_receipt(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text
) to authenticated;

notify pgrst, 'reload schema';
