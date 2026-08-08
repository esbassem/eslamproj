create or replace function public.link_existing_vault_document_to_request(
  p_tenant_id uuid,
  p_request_id uuid,
  p_document_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_request public.paperwork_requests%rowtype;
  v_document public.paperwork_documents%rowtype;
  v_old_stage text;
  v_now timestamptz := now();
  v_event_id uuid;
begin
  if p_tenant_id is null or p_request_id is null or p_document_id is null then
    raise exception 'تعذر تحديد الشركة أو الطلب أو الورقة.';
  end if;

  if nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception 'ملاحظة التسوية إلزامية.';
  end if;

  select tu.id into v_user_id
  from public.tenant_users tu
  where tu.tenant_id = p_tenant_id
    and tu.auth_user_id = auth.uid()
    and tu.is_active = true
  limit 1;

  if v_user_id is null then
    raise exception 'تعذر تحديد مستخدم الشركة الحالي.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':link-vault-document:' || p_request_id::text, 0)
  );

  select pr.* into v_request
  from public.paperwork_requests pr
  where pr.tenant_id = p_tenant_id and pr.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'طلب الأوراق غير موجود.';
  end if;
  if v_request.status <> 'open'
    or v_request.current_stage not in ('preparation', 'owner_confirmation', 'sent_to_processor', 'processor_ready') then
    raise exception 'لا يمكن تنفيذ التسوية على طلب غير مفتوح أو تم استلام أوراقه بالفعل.';
  end if;

  select pd.* into v_document
  from public.paperwork_documents pd
  where pd.tenant_id = p_tenant_id and pd.id = p_document_id
  for update;

  if v_document.id is null then
    raise exception 'الورقة المحددة غير موجودة.';
  end if;
  if v_document.status <> 'in_custody' then
    raise exception 'الورقة المحددة ليست موجودة حاليًا بالخزنة.';
  end if;
  if v_document.tracking_unit_id is distinct from v_request.tracking_unit_id then
    raise exception 'أرقام تتبع الورقة لا تطابق القطعة المرتبطة بالطلب.';
  end if;
  if v_document.paperwork_request_id is not null
    and v_document.paperwork_request_id <> v_request.id then
    raise exception 'الورقة المحددة مرتبطة بطلب أوراق آخر.';
  end if;
  if exists (
    select 1 from public.paperwork_documents pd
    where pd.tenant_id = p_tenant_id
      and pd.paperwork_request_id = v_request.id
      and pd.id <> v_document.id
      and pd.cancelled_at is null
  ) then
    raise exception 'يوجد مستند آخر مرتبط بهذا الطلب بالفعل.';
  end if;

  v_old_stage := v_request.current_stage;

  update public.paperwork_documents
  set paperwork_request_id = v_request.id,
      owner_partner_id = coalesce(owner_partner_id, v_request.customer_id),
      updated_at = v_now
  where id = v_document.id;

  update public.paperwork_requests
  set current_stage = 'received_from_processor',
      stage_entered_at = v_now,
      updated_at = v_now
  where id = v_request.id;

  insert into public.paperwork_request_events (
    tenant_id, request_id, event_type, old_stage, new_stage, old_status, new_status,
    notes, created_by
  ) values (
    p_tenant_id, v_request.id, 'stage_changed', v_old_stage,
    'received_from_processor', v_request.status, v_request.status,
    concat('تم ربط ورقة مستلمة سابقًا وموجودة حاليًا بالخزنة بالطلب. ', trim(p_notes)),
    v_user_id
  ) returning id into v_event_id;

  return jsonb_build_object(
    'request_id', v_request.id,
    'document_id', v_document.id,
    'event_id', v_event_id,
    'old_stage', v_old_stage,
    'current_stage', 'received_from_processor',
    'status', v_request.status,
    'updated_at', v_now
  );
end;
$$;

revoke all on function public.link_existing_vault_document_to_request(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.link_existing_vault_document_to_request(uuid, uuid, uuid, text) to authenticated;

comment on function public.link_existing_vault_document_to_request(uuid, uuid, uuid, text) is
'Links an existing in-custody document to an open paperwork request without creating a duplicate document or vault-in movement.';

notify pgrst, 'reload schema';
