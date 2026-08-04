begin;

do $$
declare
  v_owner_auth_id uuid;
  v_owner_tenant_id uuid;
  v_non_owner_auth_id uuid;
  v_other_owner_auth_id uuid;
  v_other_owner_tenant_id uuid;
  v_document_id uuid;
  v_request_id uuid;
  v_partner_id uuid;
  v_partner_name text;
  v_document_name text;
  v_result jsonb;
  v_rejected boolean;
  v_moves_before bigint;
  v_request_before jsonb;
begin
  select tu.auth_user_id, tu.tenant_id, pd.id, pd.paperwork_request_id, pd.document_owner_name
  into v_owner_auth_id, v_owner_tenant_id, v_document_id, v_request_id, v_document_name
  from public.tenant_users tu
  join public.paperwork_documents pd on pd.tenant_id=tu.tenant_id and pd.status='in_custody'
  where tu.role='owner' and tu.is_active=true
    and pd.release_authorized_at is null
    and exists(select 1 from public.tenant_users member where member.tenant_id=tu.tenant_id and member.role<>'owner' and member.is_active=true)
  order by pd.created_at, pd.id
  limit 1;
  if v_owner_auth_id is null then raise exception 'TEST_SETUP: no eligible document'; end if;

  select partner.id, partner.name into v_partner_id, v_partner_name
  from public.partners partner where partner.tenant_id=v_owner_tenant_id and nullif(btrim(coalesce(partner.name,'')),'') is not null limit 1;
  if v_partner_id is null then raise exception 'TEST_SETUP: no partner in document tenant'; end if;

  perform set_config('request.jwt.claim.sub', v_owner_auth_id::text, true);

  begin
    select count(*) into v_moves_before from public.paperwork_document_moves where document_id=v_document_id;
    select to_jsonb(pr) into v_request_before from public.paperwork_requests pr where pr.id=v_request_id;
    update public.paperwork_documents set paperwork_request_id=null,owner_partner_id=v_partner_id where id=v_document_id;
    v_result := public.authorize_paperwork_document_release(v_owner_tenant_id,v_document_id,'partner',null,'تعليمات اختبار');
    if v_result->>'status' <> 'in_custody' then raise exception 'TEST_FAILED: partner changed status'; end if;
    if (v_result->>'release_authorized_to_partner_id')::uuid <> v_partner_id then raise exception 'TEST_FAILED: partner recipient mismatch'; end if;
    if v_result->>'release_authorized_to_name' <> v_partner_name then raise exception 'TEST_FAILED: partner name mismatch'; end if;
    if (select count(*) from public.paperwork_document_moves where document_id=v_document_id) <> v_moves_before then raise exception 'TEST_FAILED: move created'; end if;
    if v_request_before is distinct from (select to_jsonb(pr) from public.paperwork_requests pr where pr.id=v_request_id) then raise exception 'TEST_FAILED: request changed'; end if;
    raise exception using errcode='ZX001',message='ROLLBACK_CASE';
  exception when sqlstate 'ZX001' then null;
  end;

  begin
    v_result := public.authorize_paperwork_document_release(v_owner_tenant_id,v_document_id,'document_name',null,'تعليمات اختبار');
    if v_result->>'release_authorized_to_partner_id' is not null then raise exception 'TEST_FAILED: document name linked partner'; end if;
    if v_result->>'release_authorized_to_name' <> btrim(v_document_name) then raise exception 'TEST_FAILED: document name mismatch'; end if;
    raise exception using errcode='ZX001',message='ROLLBACK_CASE';
  exception when sqlstate 'ZX001' then null;
  end;

  begin
    v_result := public.authorize_paperwork_document_release(v_owner_tenant_id,v_document_id,'other','مستلم اختباري','تعليمات اختبار');
    if v_result->>'release_authorized_to_partner_id' is not null or v_result->>'release_authorized_to_name'<>'مستلم اختباري' then raise exception 'TEST_FAILED: other recipient mismatch'; end if;
    raise exception using errcode='ZX001',message='ROLLBACK_CASE';
  exception when sqlstate 'ZX001' then null;
  end;

  v_rejected:=false;
  begin perform public.authorize_paperwork_document_release(v_owner_tenant_id,v_document_id,'other',null,'تعليمات');
  exception when others then v_rejected:=position('اسم المستلم إلزامي' in sqlerrm)>0; end;
  if not v_rejected then raise exception 'TEST_FAILED: other without name accepted'; end if;

  v_rejected:=false;
  begin perform public.authorize_paperwork_document_release(v_owner_tenant_id,v_document_id,'document_name',null,'   ');
  exception when others then v_rejected:=position('ملاحظة الصرف إلزامية' in sqlerrm)>0; end;
  if not v_rejected then raise exception 'TEST_FAILED: blank notes accepted'; end if;

  v_rejected:=false;
  begin perform public.authorize_paperwork_document_release(v_owner_tenant_id,v_document_id,'partner',null,'تعليمات');
  exception when others then v_rejected:=position('لا يوجد Partner' in sqlerrm)>0; end;
  if not v_rejected then raise exception 'TEST_FAILED: missing partner accepted'; end if;

  begin
    update public.paperwork_documents set document_owner_name=null where id=v_document_id;
    v_rejected:=false;
    begin perform public.authorize_paperwork_document_release(v_owner_tenant_id,v_document_id,'document_name',null,'تعليمات');
    exception when others then v_rejected:=position('لا يوجد اسم مكتوب' in sqlerrm)>0; end;
    if not v_rejected then raise exception 'TEST_FAILED: missing document name accepted'; end if;
    raise exception using errcode='ZX001',message='ROLLBACK_CASE';
  exception when sqlstate 'ZX001' then null;
  end;

  begin
    perform public.authorize_paperwork_document_release(v_owner_tenant_id,v_document_id,'document_name',null,'تعليمات أولى');
    v_rejected:=false;
    begin perform public.authorize_paperwork_document_release(v_owner_tenant_id,v_document_id,'document_name',null,'تعليمات ثانية');
    exception when others then v_rejected:=position('إتاحة صرف سارية بالفعل' in sqlerrm)>0; end;
    if not v_rejected then raise exception 'TEST_FAILED: duplicate authorization accepted'; end if;
    raise exception using errcode='ZX001',message='ROLLBACK_CASE';
  exception when sqlstate 'ZX001' then null;
  end;

  for v_document_name in select unnest(array['cancelled','delivered']) loop
    begin
      update public.paperwork_documents set status=v_document_name where id=v_document_id;
      v_rejected:=false;
      begin perform public.authorize_paperwork_document_release(v_owner_tenant_id,v_document_id,'document_name',null,'تعليمات');
      exception when others then v_rejected:=position('لم يعد موجودًا داخل الخزنة' in sqlerrm)>0; end;
      if not v_rejected then raise exception 'TEST_FAILED: status % accepted',v_document_name; end if;
      raise exception using errcode='ZX001',message='ROLLBACK_CASE';
    exception when sqlstate 'ZX001' then null;
    end;
  end loop;

  select tu.auth_user_id into v_non_owner_auth_id from public.tenant_users tu
  where tu.tenant_id=v_owner_tenant_id and tu.role<>'owner' and tu.is_active=true limit 1;
  perform set_config('request.jwt.claim.sub',v_non_owner_auth_id::text,true);
  v_rejected:=false;
  begin perform public.authorize_paperwork_document_release(v_owner_tenant_id,v_document_id,'document_name',null,'تعليمات');
  exception when others then v_rejected:=position('لمالك الشركة فقط' in sqlerrm)>0; end;
  if not v_rejected then raise exception 'TEST_FAILED: non-owner accepted'; end if;

  select tu.auth_user_id,tu.tenant_id into v_other_owner_auth_id,v_other_owner_tenant_id from public.tenant_users tu
  where tu.role='owner' and tu.is_active=true and tu.tenant_id<>v_owner_tenant_id limit 1;
  perform set_config('request.jwt.claim.sub',v_other_owner_auth_id::text,true);
  v_rejected:=false;
  begin perform public.authorize_paperwork_document_release(v_other_owner_tenant_id,v_document_id,'other','مستلم','تعليمات');
  exception when others then v_rejected:=position('غير موجود داخل هذه الشركة' in sqlerrm)>0; end;
  if not v_rejected then raise exception 'TEST_FAILED: cross-tenant accepted'; end if;

  raise notice 'authorize_paperwork_document_release runtime tests passed';
end;
$$;

rollback;
