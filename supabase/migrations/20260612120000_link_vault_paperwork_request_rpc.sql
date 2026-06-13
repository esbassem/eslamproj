create or replace function public.link_vault_paperwork_request(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sale_id uuid,
  p_sale_line_id uuid,
  p_tracking_unit_id uuid,
  p_customer_id uuid,
  p_confirmation_note text default ''
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_tenant_user_id uuid;
  v_existing_request_id uuid;
  v_stage_id uuid;
  v_document_id uuid;
  v_request_id uuid;
  v_request_notes text;
  v_event_notes text;
begin
  if p_sale_line_id is null then
    raise exception 'تعذر تحديد سطر المنتج المطلوب.';
  end if;

  if p_tracking_unit_id is null then
    raise exception 'تعذر تحديد القطعة الفريدة المرتبطة بالورق.';
  end if;

  select tu.id
    into v_current_tenant_user_id
  from public.tenant_users tu
  where tu.tenant_id = p_tenant_id
    and tu.auth_user_id = auth.uid()
    and tu.is_active = true
  limit 1;

  if v_current_tenant_user_id is null then
    raise exception 'تعذر تحديد مستخدم الشركة الحالي.';
  end if;

  perform 1
  from public.showroom_sale_lines sl
  where sl.tenant_id = p_tenant_id
    and sl.id = p_sale_line_id
  for update;

  select pr.id
    into v_existing_request_id
  from public.paperwork_requests pr
  where pr.tenant_id = p_tenant_id
    and pr.sale_line_id = p_sale_line_id
  order by pr.created_at desc
  limit 1;

  if v_existing_request_id is not null then
    return query select v_existing_request_id;
    return;
  end if;

  select pd.id
    into v_document_id
  from public.paperwork_documents pd
  where pd.tenant_id = p_tenant_id
    and pd.tracking_unit_id = p_tracking_unit_id
    and pd.status = 'in_custody'
  order by
    case when pd.paperwork_request_id is null then 0 else 1 end,
    pd.updated_at desc nulls last,
    pd.created_at desc nulls last
  limit 1;

  if v_document_id is null then
    raise exception 'لا يوجد ورق مسجل بالخزنة لهذا المنتج.';
  end if;

  select ps.id
    into v_stage_id
  from public.paperwork_stages ps
  where ps.tenant_id = p_tenant_id
    and ps.code = 'received_from_processor'
  order by ps.active desc, ps.sequence asc
  limit 1;

  if v_stage_id is null then
    raise exception 'تعذر العثور على مرحلة استلام الورق من جهة التخليص.';
  end if;

  v_request_notes := concat_ws(
    E'\n\n',
    'تمت تسوية بيع قديم: الورق موجود بالفعل في الخزنة وتم ربطه بهذا الطلب.',
    nullif(trim(coalesce(p_confirmation_note, '')), '')
  );

  v_event_notes := concat_ws(
    E'\n\n',
    'تم تحديد حالة الورق: الورق موجود بالفعل في الخزنة وتم ربط الطلب بالمستند الموجود.',
    nullif(trim(coalesce(p_confirmation_note, '')), '')
  );

  insert into public.paperwork_requests (
    tenant_id,
    branch_id,
    request_source,
    request_type,
    sale_id,
    sale_line_id,
    tracking_unit_id,
    customer_id,
    document_owner_partner_id,
    current_stage_id,
    stage_entered_at,
    status,
    closed_at,
    notes,
    created_by
  )
  values (
    p_tenant_id,
    p_branch_id,
    'sale',
    'new_document',
    p_sale_id,
    p_sale_line_id,
    p_tracking_unit_id,
    p_customer_id,
    p_customer_id,
    v_stage_id,
    now(),
    'open',
    null,
    v_request_notes,
    v_current_tenant_user_id
  )
  returning paperwork_requests.id into v_request_id;

  update public.paperwork_documents
  set paperwork_request_id = v_request_id
  where tenant_id = p_tenant_id
    and id = v_document_id;

  insert into public.paperwork_request_events (
    tenant_id,
    request_id,
    event_type,
    new_stage_id,
    new_status,
    notes,
    created_by
  )
  values (
    p_tenant_id,
    v_request_id,
    'received_from_supplier',
    v_stage_id,
    'open',
    v_event_notes,
    v_current_tenant_user_id
  );

  return query select v_request_id;
end;
$$;

grant execute on function public.link_vault_paperwork_request(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) to authenticated;
