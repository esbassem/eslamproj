create or replace function public.create_legacy_delivered_paperwork_request(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sale_id uuid,
  p_sale_line_id uuid default null,
  p_tracking_unit_id uuid default null,
  p_customer_id uuid default null,
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
  v_request_id uuid;
  v_now timestamptz := now();
  v_event_notes text;
begin
  if p_tenant_id is null or p_sale_id is null then
    raise exception 'تعذر تحديد الشركة أو الفاتورة المرتبطة بحالة الأوراق.';
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

  if not exists (
    select 1
    from public.showroom_sales ss
    where ss.id = p_sale_id
      and ss.tenant_id = p_tenant_id
  ) then
    raise exception 'الفاتورة المرتبطة بحالة الأوراق غير موجودة.';
  end if;

  if p_sale_line_id is not null and not exists (
    select 1
    from public.showroom_sale_lines ssl
    where ssl.id = p_sale_line_id
      and ssl.sale_id = p_sale_id
  ) then
    raise exception 'المنتج المحدد غير مرتبط بهذه الفاتورة.';
  end if;

  if p_tracking_unit_id is not null and not exists (
    select 1
    from public.stock_tracking_units stu
    where stu.id = p_tracking_unit_id
      and stu.tenant_id = p_tenant_id
  ) then
    raise exception 'القطعة الفريدة المحددة غير موجودة.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_tenant_id::text || ':legacy-delivered:' || coalesce(p_sale_line_id::text, p_sale_id::text),
      0
    )
  );

  if p_sale_line_id is not null then
    select pr.id
    into v_existing_request_id
    from public.paperwork_requests pr
    where pr.tenant_id = p_tenant_id
      and pr.sale_line_id = p_sale_line_id
      and pr.status <> 'cancelled'
    order by pr.created_at asc
    limit 1;

    if v_existing_request_id is not null then
      return query select v_existing_request_id;
      return;
    end if;
  end if;

  v_event_notes := concat_ws(
    E'\n\n',
    'تم تسجيل حالة بيع قديم: الأوراق تم تسليمها للعميل بالفعل قبل نظام تتبع الأوراق.',
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
    current_stage,
    stage_entered_at,
    status,
    closed_at,
    created_by,
    notes
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
    'delivered',
    v_now,
    'done',
    v_now,
    v_current_tenant_user_id,
    v_event_notes
  )
  returning paperwork_requests.id into v_request_id;

  insert into public.paperwork_request_events (
    tenant_id,
    request_id,
    event_type,
    new_status,
    new_stage,
    notes,
    created_by
  )
  values (
    p_tenant_id,
    v_request_id,
    'done',
    'done',
    'delivered',
    v_event_notes,
    v_current_tenant_user_id
  );

  return query select v_request_id;
end;
$$;

revoke all on function public.create_legacy_delivered_paperwork_request(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) from public, anon;

grant execute on function public.create_legacy_delivered_paperwork_request(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) to authenticated;

notify pgrst, 'reload schema';
