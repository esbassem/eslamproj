create or replace function public.set_paperwork_document_owner_partner(
  p_tenant_id uuid,
  p_document_id uuid,
  p_partner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.paperwork_documents%rowtype;
  v_now timestamptz := now();
begin
  if p_tenant_id is null or p_document_id is null or p_partner_id is null then
    raise exception 'تعذر تحديد الشركة أو المستند أو الـPartner.';
  end if;

  if not public.is_tenant_owner(p_tenant_id) then
    raise exception 'تحديد Partner المستند متاح لمالك الشركة فقط.';
  end if;

  if not exists (
    select 1 from public.partners p
    where p.tenant_id = p_tenant_id
      and p.id = p_partner_id
      and p.active = true
  ) then
    raise exception 'الـPartner المحدد غير موجود أو غير نشط.';
  end if;

  select pd.* into v_document
  from public.paperwork_documents pd
  where pd.tenant_id = p_tenant_id and pd.id = p_document_id
  for update;

  if v_document.id is null then
    raise exception 'المستند غير موجود.';
  end if;

  update public.paperwork_documents
  set owner_partner_id = p_partner_id,
      updated_at = v_now
  where id = v_document.id;

  return jsonb_build_object(
    'document_id', v_document.id,
    'owner_partner_id', p_partner_id,
    'updated_at', v_now
  );
end;
$$;

revoke all on function public.set_paperwork_document_owner_partner(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_paperwork_document_owner_partner(uuid, uuid, uuid) to authenticated;

comment on function public.set_paperwork_document_owner_partner(uuid, uuid, uuid) is
'Allows only the tenant owner to manually assign an active tenant partner to a paperwork document.';

notify pgrst, 'reload schema';
