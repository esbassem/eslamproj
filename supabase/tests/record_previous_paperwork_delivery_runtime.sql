begin;

do $$
declare
  v_owner_auth_id uuid;
  v_owner_tenant_id uuid;
  v_non_owner_auth_id uuid;
  v_other_owner_auth_id uuid;
  v_other_owner_tenant_id uuid;
  v_document_id uuid;
  v_latest_in_at timestamptz;
  v_reason text;
  v_result jsonb;
  v_rejected boolean;
  v_moves_before bigint;
  v_attachments_before bigint;
  v_request_id uuid;
  v_request_status text;
begin
  select tu.auth_user_id, tu.tenant_id, pd.id, latest_move.moved_at
  into v_owner_auth_id, v_owner_tenant_id, v_document_id, v_latest_in_at
  from public.tenant_users tu
  join public.paperwork_documents pd on pd.tenant_id = tu.tenant_id and pd.status = 'in_custody'
  join lateral (
    select movement.* from public.paperwork_document_moves movement
    where movement.tenant_id = pd.tenant_id and movement.document_id = pd.id
    order by movement.moved_at desc, movement.created_at desc, movement.id desc
    limit 1
  ) latest_move on latest_move.move_direction = 'in'
  where tu.role = 'owner' and tu.is_active = true
    and exists (
      select 1 from public.tenant_users member
      where member.tenant_id = tu.tenant_id and member.role <> 'owner' and member.is_active = true
    )
  order by pd.created_at, pd.id
  limit 1;

  if v_owner_auth_id is null then
    raise exception 'TEST_SETUP: no eligible document with owner and non-owner';
  end if;
  perform set_config('request.jwt.claim.sub', v_owner_auth_id::text, true);

  foreach v_reason in array array[
    'delivered_before_system_use', 'delivery_not_recorded',
    'owner_confirmed_previous_delivery', 'other'
  ] loop
    begin
      select count(*) into v_moves_before from public.paperwork_document_moves where document_id = v_document_id;
      select count(*) into v_attachments_before from public.ir_attachments
      where related_model = 'paperwork_documents' and related_id = v_document_id;
      select pr.id, pr.status into v_request_id, v_request_status
      from public.paperwork_requests pr
      where pr.id = (select paperwork_request_id from public.paperwork_documents where id = v_document_id);

      v_result := public.record_previous_paperwork_document_delivery(
        v_owner_tenant_id, v_document_id, v_latest_in_at + interval '1 minute', v_reason,
        case when v_reason = 'other' then 'ملاحظات اختبار' else null end
      );

      if v_result ->> 'status' <> 'delivered' then raise exception 'TEST_FAILED: document not delivered'; end if;
      if (select status from public.paperwork_documents where id = v_document_id) <> 'delivered' then raise exception 'TEST_FAILED: status not persisted'; end if;
      if (select count(*) from public.paperwork_document_moves where document_id = v_document_id) <> v_moves_before + 1 then raise exception 'TEST_FAILED: expected exactly one move'; end if;
      if not exists (
        select 1 from public.paperwork_document_moves movement
        where movement.id = (v_result ->> 'move_id')::uuid
          and movement.move_direction = 'out'
          and movement.source_type = 'retrospective_delivery'
          and movement.to_location = 'customer'
          and movement.created_by is not null
      ) then raise exception 'TEST_FAILED: historical out move values are invalid'; end if;
      if (select count(*) from public.ir_attachments where related_model='paperwork_documents' and related_id=v_document_id) <> v_attachments_before then raise exception 'TEST_FAILED: attachments changed'; end if;
      if v_request_id is not null and v_request_status = 'open' and not exists (
        select 1 from public.paperwork_requests pr
        where pr.id = v_request_id
          and pr.status = 'done'
          and pr.current_stage = 'delivered'
          and pr.closed_at is not null
      ) then raise exception 'TEST_FAILED: linked open request was not closed'; end if;
      if v_request_id is not null and v_request_status = 'open' and not exists (
        select 1 from public.paperwork_request_events event
        where event.request_id = v_request_id
          and event.new_status = 'done'
          and event.new_stage = 'delivered'
      ) then raise exception 'TEST_FAILED: linked request delivery event missing'; end if;

      raise exception using errcode='ZX001', message='ROLLBACK_CASE';
    exception when sqlstate 'ZX001' then null;
    end;
  end loop;

  v_rejected := false;
  begin
    perform public.record_previous_paperwork_document_delivery(v_owner_tenant_id, v_document_id, now() + interval '1 hour', 'delivery_not_recorded', null);
  exception when others then v_rejected := position('المستقبل' in sqlerrm) > 0;
  end;
  if not v_rejected then raise exception 'TEST_FAILED: future date accepted'; end if;

  v_rejected := false;
  begin
    perform public.record_previous_paperwork_document_delivery(v_owner_tenant_id, v_document_id, v_latest_in_at - interval '1 second', 'delivery_not_recorded', null);
  exception when others then v_rejected := position('يسبق آخر دخول' in sqlerrm) > 0;
  end;
  if not v_rejected then raise exception 'TEST_FAILED: pre-entry date accepted'; end if;

  v_rejected := false;
  begin
    perform public.record_previous_paperwork_document_delivery(v_owner_tenant_id, v_document_id, v_latest_in_at + interval '1 minute', 'other', null);
  exception when others then v_rejected := position('الملاحظات إلزامية' in sqlerrm) > 0;
  end;
  if not v_rejected then raise exception 'TEST_FAILED: other without notes accepted'; end if;

  begin
    perform public.record_previous_paperwork_document_delivery(v_owner_tenant_id, v_document_id, v_latest_in_at + interval '1 minute', 'delivery_not_recorded', null);
    v_rejected := false;
    begin
      perform public.record_previous_paperwork_document_delivery(v_owner_tenant_id, v_document_id, v_latest_in_at + interval '2 minutes', 'delivery_not_recorded', null);
    exception when others then v_rejected := position('تم تسجيل خروجه بالفعل' in sqlerrm) > 0;
    end;
    if not v_rejected then raise exception 'TEST_FAILED: repeated delivery accepted'; end if;
    raise exception using errcode='ZX001', message='ROLLBACK_CASE';
  exception when sqlstate 'ZX001' then null;
  end;

  foreach v_reason in array array['cancelled', 'delivered'] loop
    begin
      update public.paperwork_documents set status = v_reason where id = v_document_id;
      v_rejected := false;
      begin
        perform public.record_previous_paperwork_document_delivery(v_owner_tenant_id, v_document_id, v_latest_in_at + interval '1 minute', 'delivery_not_recorded', null);
      exception when others then v_rejected := position('تم تسجيل خروجه بالفعل' in sqlerrm) > 0;
      end;
      if not v_rejected then raise exception 'TEST_FAILED: status % accepted', v_reason; end if;
      raise exception using errcode='ZX001', message='ROLLBACK_CASE';
    exception when sqlstate 'ZX001' then null;
    end;
  end loop;

  select tu.auth_user_id into v_non_owner_auth_id from public.tenant_users tu
  where tu.tenant_id=v_owner_tenant_id and tu.role<>'owner' and tu.is_active=true limit 1;
  perform set_config('request.jwt.claim.sub', v_non_owner_auth_id::text, true);
  v_rejected := false;
  begin
    perform public.record_previous_paperwork_document_delivery(v_owner_tenant_id, v_document_id, v_latest_in_at + interval '1 minute', 'delivery_not_recorded', null);
  exception when others then v_rejected := position('لمالك الشركة فقط' in sqlerrm) > 0
    or position('PAPERWORK_APP_ACCESS_REQUIRED' in sqlerrm) > 0;
  end;
  if not v_rejected then raise exception 'TEST_FAILED: non-owner accepted'; end if;

  select tu.auth_user_id, tu.tenant_id into v_other_owner_auth_id, v_other_owner_tenant_id
  from public.tenant_users tu where tu.role='owner' and tu.is_active=true and tu.tenant_id<>v_owner_tenant_id limit 1;
  perform set_config('request.jwt.claim.sub', v_other_owner_auth_id::text, true);
  v_rejected := false;
  begin
    perform public.record_previous_paperwork_document_delivery(v_other_owner_tenant_id, v_document_id, v_latest_in_at + interval '1 minute', 'delivery_not_recorded', null);
  exception when others then v_rejected := position('غير موجود داخل هذه الشركة' in sqlerrm) > 0
    or position('PAPERWORK_APP_ACCESS_REQUIRED' in sqlerrm) > 0;
  end;
  if not v_rejected then raise exception 'TEST_FAILED: cross-tenant document accepted'; end if;

  raise notice 'record_previous_paperwork_document_delivery runtime tests passed';
end;
$$;

rollback;
