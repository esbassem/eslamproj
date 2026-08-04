begin;

alter table public.paperwork_document_moves
  drop constraint if exists paperwork_document_moves_source_type_check;

alter table public.paperwork_document_moves
  add constraint paperwork_document_moves_source_type_check
  check (source_type in (
    'opening_custody', 'from_customer', 'from_supplier', 'from_processor',
    'from_employee', 'purchase', 'manual', 'to_customer', 'to_supplier',
    'to_processor', 'to_employee', 'lost', 'cancelled',
    'retrospective_delivery', 'other'
  ));

create or replace function public.record_previous_paperwork_document_delivery(
  p_tenant_id uuid,
  p_document_id uuid,
  p_delivered_at timestamptz,
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
  v_document public.paperwork_documents%rowtype;
  v_latest_move public.paperwork_document_moves%rowtype;
  v_move public.paperwork_document_moves%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_now timestamptz := clock_timestamp();
  v_move_notes text;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;
  if p_tenant_id is null or p_document_id is null then
    raise exception 'تعذر تحديد الشركة أو المستند.';
  end if;
  if p_delivered_at is null then
    raise exception 'تاريخ ووقت التسليم إلزامي.';
  end if;
  if p_delivered_at > v_now then
    raise exception 'لا يمكن أن يكون تاريخ التسليم في المستقبل.';
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
    raise exception 'تسجيل الصرف السابق متاح لمالك الشركة فقط.';
  end if;

  select document.* into v_document
  from public.paperwork_documents document
  where document.tenant_id = p_tenant_id and document.id = p_document_id
  for update;

  if v_document.id is null then
    raise exception 'المستند غير موجود داخل هذه الشركة.';
  end if;
  if v_document.status <> 'in_custody' then
    raise exception 'المستند لم يعد موجودًا في العهدة أو تم تسجيل خروجه بالفعل.';
  end if;

  select movement.* into v_latest_move
  from public.paperwork_document_moves movement
  where movement.tenant_id = p_tenant_id and movement.document_id = v_document.id
  order by movement.moved_at desc, movement.created_at desc, movement.id desc
  limit 1
  for update;

  if v_latest_move.id is null or v_latest_move.move_direction <> 'in' then
    raise exception 'المستند لم يعد موجودًا في العهدة أو تم تسجيل خروجه بالفعل.';
  end if;
  if p_delivered_at < v_latest_move.moved_at then
    raise exception 'تاريخ التسليم لا يمكن أن يسبق آخر دخول للمستند إلى العهدة.';
  end if;

  v_move_notes := 'retrospective_reason=' || v_reason;
  if v_notes is not null then
    v_move_notes := v_move_notes || chr(10) || 'retrospective_notes=' || v_notes;
  end if;

  insert into public.paperwork_document_moves (
    tenant_id, document_id, move_direction, source_type,
    from_user_id, from_location, to_partner_id, to_location,
    moved_at, notes, created_by
  ) values (
    p_tenant_id, v_document.id, 'out', 'retrospective_delivery',
    v_latest_move.to_user_id,
    coalesce(nullif(v_latest_move.to_location, ''), 'vault'),
    v_document.owner_partner_id, 'customer',
    p_delivered_at, v_move_notes, v_tenant_user_id
  )
  returning * into v_move;

  update public.paperwork_documents
  set status = 'delivered', updated_at = v_now
  where id = v_document.id and tenant_id = p_tenant_id;

  return jsonb_build_object(
    'document_id', v_document.id,
    'status', 'delivered',
    'move_id', v_move.id,
    'delivered_at', v_move.moved_at,
    'recorded_at', v_move.created_at,
    'recorded_by', v_move.created_by,
    'reason', v_reason,
    'notes', v_notes
  );
end;
$$;

revoke all on function public.record_previous_paperwork_document_delivery(uuid, uuid, timestamptz, text, text) from public;
revoke all on function public.record_previous_paperwork_document_delivery(uuid, uuid, timestamptz, text, text) from anon;
grant execute on function public.record_previous_paperwork_document_delivery(uuid, uuid, timestamptz, text, text) to authenticated;

comment on function public.record_previous_paperwork_document_delivery(uuid, uuid, timestamptz, text, text) is
'Records an owner-authorized historical customer delivery for an in-custody paperwork document.';

notify pgrst, 'reload schema';

commit;
