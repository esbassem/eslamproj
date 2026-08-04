begin;

alter table public.paperwork_documents
  add column if not exists release_authorized_at timestamptz null,
  add column if not exists release_authorized_by uuid null references public.tenant_users(id),
  add column if not exists release_authorized_to_partner_id uuid null references public.partners(id),
  add column if not exists release_authorized_to_name text null,
  add column if not exists release_authorization_notes text null,
  add column if not exists release_authorization_consumed_at timestamptz null;

create or replace function public.authorize_paperwork_document_release(
  p_tenant_id uuid,
  p_document_id uuid,
  p_recipient_type text,
  p_recipient_name text default null,
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
  v_recipient_type text := nullif(btrim(coalesce(p_recipient_type, '')), '');
  v_requested_name text := nullif(btrim(coalesce(p_recipient_name, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_recipient_partner_id uuid;
  v_recipient_name text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;
  if p_tenant_id is null or p_document_id is null then
    raise exception 'تعذر تحديد الشركة أو المستند.';
  end if;
  if v_recipient_type is null or v_recipient_type not in ('partner', 'document_name', 'other') then
    raise exception 'نوع المستلم المعتمد غير صالح.';
  end if;
  if v_notes is null then
    raise exception 'ملاحظة الصرف إلزامية.';
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
    raise exception 'إتاحة صرف المستند متاحة لمالك الشركة فقط.';
  end if;

  select document.* into v_document
  from public.paperwork_documents document
  where document.tenant_id = p_tenant_id and document.id = p_document_id
  for update;

  if v_document.id is null then
    raise exception 'المستند غير موجود داخل هذه الشركة.';
  end if;
  if v_document.status <> 'in_custody' then
    raise exception 'المستند لم يعد موجودًا داخل الخزنة ولا يمكن إتاحة صرفه.';
  end if;
  if v_document.release_authorized_at is not null
     and v_document.release_authorization_consumed_at is null then
    raise exception 'توجد إتاحة صرف سارية بالفعل لهذا المستند.';
  end if;

  if v_recipient_type = 'partner' then
    if v_document.owner_partner_id is null then
      raise exception 'لا يوجد Partner مرتبط بالمستند.';
    end if;
    select partner.id, nullif(btrim(coalesce(partner.name, '')), '')
    into v_recipient_partner_id, v_recipient_name
    from public.partners partner
    where partner.id = v_document.owner_partner_id
      and partner.tenant_id = p_tenant_id;
    if v_recipient_partner_id is null or v_recipient_name is null then
      raise exception 'الـPartner المرتبط غير صالح داخل هذه الشركة.';
    end if;
  elsif v_recipient_type = 'document_name' then
    v_recipient_name := nullif(btrim(coalesce(v_document.document_owner_name, '')), '');
    if v_recipient_name is null then
      raise exception 'لا يوجد اسم مكتوب على المستند.';
    end if;
    v_recipient_partner_id := null;
  else
    if v_requested_name is null then
      raise exception 'اسم المستلم إلزامي عند اختيار شخص آخر.';
    end if;
    v_recipient_name := v_requested_name;
    v_recipient_partner_id := null;
  end if;

  update public.paperwork_documents
  set release_authorized_at = v_now,
      release_authorized_by = v_tenant_user_id,
      release_authorized_to_partner_id = v_recipient_partner_id,
      release_authorized_to_name = v_recipient_name,
      release_authorization_notes = v_notes,
      release_authorization_consumed_at = null,
      updated_at = v_now
  where id = v_document.id and tenant_id = p_tenant_id
  returning * into v_document;

  return jsonb_build_object(
    'document_id', v_document.id,
    'status', v_document.status,
    'release_authorized_at', v_document.release_authorized_at,
    'release_authorized_by', v_document.release_authorized_by,
    'release_authorized_to_partner_id', v_document.release_authorized_to_partner_id,
    'release_authorized_to_name', v_document.release_authorized_to_name,
    'release_authorization_notes', v_document.release_authorization_notes,
    'release_authorization_consumed_at', v_document.release_authorization_consumed_at
  );
end;
$$;

revoke all on function public.authorize_paperwork_document_release(uuid, uuid, text, text, text) from public;
revoke all on function public.authorize_paperwork_document_release(uuid, uuid, text, text, text) from anon;
grant execute on function public.authorize_paperwork_document_release(uuid, uuid, text, text, text) to authenticated;

comment on function public.authorize_paperwork_document_release(uuid, uuid, text, text, text) is
'Creates one active owner-authorized release permission for an in-custody paperwork document without moving it.';

notify pgrst, 'reload schema';

commit;
