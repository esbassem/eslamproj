begin;

alter table public.paperwork_documents
  add column if not exists cancelled_at timestamptz null,
  add column if not exists cancelled_by uuid null references public.tenant_users(id),
  add column if not exists cancellation_reason text null,
  add column if not exists cancellation_notes text null;

create or replace function public.cancel_paperwork_document(
  p_tenant_id uuid,
  p_document_id uuid,
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
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;
  if p_tenant_id is null or p_document_id is null then
    raise exception 'تعذر تحديد الشركة أو المستند.';
  end if;
  if v_reason is null or v_reason not in (
    'test_record', 'registered_by_mistake', 'duplicate_document',
    'not_physically_received', 'other'
  ) then
    raise exception 'سبب إلغاء المستند غير صالح.';
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
    raise exception 'إلغاء صلاحية المستند متاح لمالك الشركة فقط.';
  end if;

  select document.* into v_document
  from public.paperwork_documents document
  where document.tenant_id = p_tenant_id and document.id = p_document_id
  for update;

  if v_document.id is null then
    raise exception 'المستند غير موجود داخل هذه الشركة.';
  end if;
  if v_document.status = 'cancelled' then
    raise exception 'تم إلغاء صلاحية المستند بالفعل.';
  end if;
  if v_document.status <> 'in_custody' then
    raise exception 'لم يعد المستند في حالة تسمح بالإلغاء.';
  end if;

  update public.paperwork_documents
  set status = 'cancelled',
      cancelled_at = v_now,
      cancelled_by = v_tenant_user_id,
      cancellation_reason = v_reason,
      cancellation_notes = v_notes,
      updated_at = v_now
  where id = v_document.id and tenant_id = p_tenant_id
  returning * into v_document;

  return to_jsonb(v_document);
end;
$$;

revoke all on function public.cancel_paperwork_document(uuid, uuid, text, text) from public;
revoke all on function public.cancel_paperwork_document(uuid, uuid, text, text) from anon;
grant execute on function public.cancel_paperwork_document(uuid, uuid, text, text) to authenticated;

comment on function public.cancel_paperwork_document(uuid, uuid, text, text) is
'Cancels an in-custody paperwork document for the tenant owner without deleting history or creating a custody move.';

notify pgrst, 'reload schema';

commit;
