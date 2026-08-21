begin;

do $$
declare
  v_owner_auth_id uuid;
  v_owner_tenant_id uuid;
  v_non_owner_auth_id uuid;
  v_other_owner_auth_id uuid;
  v_other_owner_tenant_id uuid;
  v_document_id uuid;
  v_reason text;
  v_result jsonb;
  v_rejected boolean;
  v_moves_before bigint;
  v_attachments_before bigint;
  v_request_before jsonb;
begin
  select tu.auth_user_id, tu.tenant_id
  into v_owner_auth_id, v_owner_tenant_id
  from public.tenant_users tu
  where tu.role = 'owner' and tu.is_active = true
    and exists (
      select 1 from public.paperwork_documents pd
      where pd.tenant_id = tu.tenant_id and pd.status = 'in_custody'
    )
    and exists (
      select 1 from public.tenant_users member
      where member.tenant_id = tu.tenant_id and member.role <> 'owner' and member.is_active = true
    )
  order by tu.created_at, tu.id
  limit 1;

  if v_owner_auth_id is null then
    raise exception 'TEST_SETUP: no owner with an in-custody document';
  end if;

  select pd.id into v_document_id
  from public.paperwork_documents pd
  where pd.tenant_id = v_owner_tenant_id and pd.status = 'in_custody'
  order by pd.created_at, pd.id
  limit 1;

  perform set_config('request.jwt.claim.sub', v_owner_auth_id::text, true);

  foreach v_reason in array array[
    'test_record', 'registered_by_mistake', 'duplicate_document',
    'not_physically_received', 'other'
  ] loop
    begin
      select count(*) into v_moves_before
      from public.paperwork_document_moves where document_id = v_document_id;
      select count(*) into v_attachments_before
      from public.ir_attachments
      where related_model = 'paperwork_documents' and related_id = v_document_id;
      select to_jsonb(pr) into v_request_before
      from public.paperwork_requests pr
      where pr.id = (select paperwork_request_id from public.paperwork_documents where id = v_document_id);

      v_result := public.cancel_paperwork_document(
        v_owner_tenant_id,
        v_document_id,
        v_reason,
        case when v_reason = 'other' then 'ملاحظات اختبار' else null end
      );

      if v_result ->> 'status' <> 'cancelled' then
        raise exception 'TEST_FAILED: reason % did not cancel', v_reason;
      end if;
      if (select count(*) from public.paperwork_document_moves where document_id = v_document_id) <> v_moves_before then
        raise exception 'TEST_FAILED: cancellation created or removed a move';
      end if;
      if (select count(*) from public.ir_attachments where related_model = 'paperwork_documents' and related_id = v_document_id) <> v_attachments_before then
        raise exception 'TEST_FAILED: cancellation changed attachments';
      end if;
      if v_request_before is distinct from (
        select to_jsonb(pr) from public.paperwork_requests pr
        where pr.id = (select paperwork_request_id from public.paperwork_documents where id = v_document_id)
      ) then
        raise exception 'TEST_FAILED: cancellation changed paperwork request';
      end if;

      raise exception using errcode = 'ZX001', message = 'ROLLBACK_CASE';
    exception when sqlstate 'ZX001' then
      null;
    end;
  end loop;

  v_rejected := false;
  begin
    perform public.cancel_paperwork_document(v_owner_tenant_id, v_document_id, 'other', null);
  exception when others then
    v_rejected := position('الملاحظات إلزامية' in sqlerrm) > 0;
  end;
  if not v_rejected then raise exception 'TEST_FAILED: other without notes was not rejected'; end if;

  begin
    perform public.cancel_paperwork_document(v_owner_tenant_id, v_document_id, 'test_record', null);
    v_rejected := false;
    begin
      perform public.cancel_paperwork_document(v_owner_tenant_id, v_document_id, 'test_record', null);
    exception when others then
      v_rejected := position('بالفعل' in sqlerrm) > 0;
    end;
    if not v_rejected then raise exception 'TEST_FAILED: repeated cancellation was not rejected'; end if;
    raise exception using errcode = 'ZX001', message = 'ROLLBACK_CASE';
  exception when sqlstate 'ZX001' then
    null;
  end;

  begin
    update public.paperwork_documents set status = 'delivered' where id = v_document_id;
    v_rejected := false;
    begin
      perform public.cancel_paperwork_document(v_owner_tenant_id, v_document_id, 'test_record', null);
    exception when others then
      v_rejected := position('لم يعد المستند' in sqlerrm) > 0;
    end;
    if not v_rejected then raise exception 'TEST_FAILED: delivered document was not rejected'; end if;
    raise exception using errcode = 'ZX001', message = 'ROLLBACK_CASE';
  exception when sqlstate 'ZX001' then
    null;
  end;

  select tu.auth_user_id into v_non_owner_auth_id
  from public.tenant_users tu
  where tu.tenant_id = v_owner_tenant_id and tu.role <> 'owner' and tu.is_active = true
  order by tu.created_at, tu.id
  limit 1;
  if v_non_owner_auth_id is null then raise exception 'TEST_SETUP: no non-owner in document tenant'; end if;
  perform set_config('request.jwt.claim.sub', v_non_owner_auth_id::text, true);
  v_rejected := false;
  begin
    perform public.cancel_paperwork_document(v_owner_tenant_id, v_document_id, 'test_record', null);
  exception when others then
    v_rejected := position('لمالك الشركة فقط' in sqlerrm) > 0
      or position('PAPERWORK_APP_ACCESS_REQUIRED' in sqlerrm) > 0;
  end;
  if not v_rejected then raise exception 'TEST_FAILED: non-owner was not rejected'; end if;

  select tu.auth_user_id, tu.tenant_id
  into v_other_owner_auth_id, v_other_owner_tenant_id
  from public.tenant_users tu
  where tu.role = 'owner' and tu.is_active = true and tu.tenant_id <> v_owner_tenant_id
  order by tu.created_at, tu.id
  limit 1;
  if v_other_owner_auth_id is null then raise exception 'TEST_SETUP: no owner in another tenant'; end if;
  perform set_config('request.jwt.claim.sub', v_other_owner_auth_id::text, true);
  v_rejected := false;
  begin
    perform public.cancel_paperwork_document(v_other_owner_tenant_id, v_document_id, 'test_record', null);
  exception when others then
    v_rejected := position('غير موجود داخل هذه الشركة' in sqlerrm) > 0
      or position('PAPERWORK_APP_ACCESS_REQUIRED' in sqlerrm) > 0;
  end;
  if not v_rejected then raise exception 'TEST_FAILED: cross-tenant document was not rejected'; end if;

  raise notice 'cancel_paperwork_document runtime tests passed';
end;
$$;

rollback;
