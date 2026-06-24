alter table public.paperwork_requests
  add column if not exists current_stage text;

alter table public.paperwork_request_events
  add column if not exists old_stage text,
  add column if not exists new_stage text;

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
  v_request_id uuid;
  v_event_notes text;
begin
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
    'done',
    now(),
    v_current_tenant_user_id,
    'Legacy sale: papers were already delivered to customer before paperwork tracking system.'
  )
  returning paperwork_requests.id into v_request_id;

  insert into public.paperwork_request_events (
    tenant_id,
    request_id,
    event_type,
    new_status,
    new_stage,
    created_by,
    notes
  )
  values (
    p_tenant_id,
    v_request_id,
    'done',
    'done',
    'delivered',
    v_current_tenant_user_id,
    v_event_notes
  );

  return query select v_request_id;
end;
$$;

grant execute on function public.create_legacy_delivered_paperwork_request(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) to authenticated;
