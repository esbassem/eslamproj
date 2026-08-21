begin;

insert into public.auth_permissions (
  code, name, description, resource, action, active,
  permission_type, module_code, sort_order
)
values
  ('paperwork.send', 'إرسال طلبات الأوراق', 'إرسال طلب أوراق إلى جهة الإصدار وبدء دورة تجهيزه من المعرض.', 'paperwork', 'send', true, 'action', 'paperwork', 20),
  ('paperwork.receive', 'استلام الأوراق', 'استلام الأوراق إلى حيازة الشركة من الجهة أو بالاستلام المجمع أو اليدوي.', 'paperwork', 'receive', true, 'action', 'paperwork', 30),
  ('paperwork.deliver', 'تسليم الأوراق للعملاء', 'تسليم المستند للعميل ضمن دورة العمل الطبيعية مع تطبيق ضوابط التسليم.', 'paperwork', 'deliver', true, 'action', 'paperwork', 40),
  ('paperwork.cancel', 'إدارة إلغاء الأوراق', 'إلغاء طلبات ومستندات الأوراق وتأكيد الإلغاء لدى الجهة وإعادة فتح الطلب المسموح به.', 'paperwork', 'cancel', true, 'action', 'paperwork', 50),
  ('paperwork.correct', 'التصحيحات والاستثناءات', 'تنفيذ التسويات التاريخية وتصحيح المالك وربط المستندات القائمة بالطلبات.', 'paperwork', 'correct', true, 'action', 'paperwork', 60),
  ('paperwork.authorize_release', 'اعتماد إخراج المستند', 'اعتماد إخراج مستند من حيازة الشركة قبل تنفيذ التسليم أو الصرف.', 'paperwork', 'authorize_release', true, 'action', 'paperwork', 70)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  resource = excluded.resource,
  action = excluded.action,
  active = true,
  permission_type = 'action',
  module_code = 'paperwork',
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace function public.require_paperwork_action(
  p_tenant_id uuid,
  p_permission_code text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_paperwork_access(p_tenant_id);

  if p_permission_code is null or p_permission_code <> all(array[
    'paperwork.send',
    'paperwork.receive',
    'paperwork.deliver',
    'paperwork.cancel',
    'paperwork.correct',
    'paperwork.authorize_release'
  ]::text[]) then
    raise exception 'PAPERWORK_ACTION_PERMISSION_INVALID' using errcode = '42501';
  end if;

  if not public.has_permission(p_permission_code, p_tenant_id) then
    raise exception 'ليس لديك صلاحية لتنفيذ هذا الإجراء.'
      using errcode = '42501', hint = 'PAPERWORK_ACTION_PERMISSION_REQUIRED';
  end if;
end
$$;

revoke all on function public.require_paperwork_action(uuid,text) from public, anon, authenticated;

do $$
declare
  v_mapping record;
  v_function record;
  v_definition text;
  v_rewritten text;
  v_expected integer := 0;
  v_updated integer := 0;
begin
  for v_mapping in
    select * from (values
      ('send_paperwork_request_to_processor', 'paperwork.send'),
      ('confirm_sale_paperwork_request', 'paperwork.send'),
      ('confirm_sale_paperwork_request_with_processor', 'paperwork.send'),
      ('receive_paperwork_request_from_processor', 'paperwork.receive'),
      ('receive_paperwork_request_from_processor_with_owner', 'paperwork.receive'),
      ('create_manual_paperwork_receipt', 'paperwork.receive'),
      ('deliver_paperwork_to_customer', 'paperwork.deliver'),
      ('cancel_paperwork_request', 'paperwork.cancel'),
      ('reopen_cancelled_paperwork_request', 'paperwork.cancel'),
      ('confirm_processor_paperwork_cancellation', 'paperwork.cancel'),
      ('cancel_paperwork_document', 'paperwork.cancel'),
      ('link_existing_vault_document_to_request', 'paperwork.correct'),
      ('record_previous_customer_paperwork_delivery', 'paperwork.correct'),
      ('record_previous_customer_paperwork_delivery_bulk', 'paperwork.correct'),
      ('record_previous_paperwork_document_delivery', 'paperwork.correct'),
      ('set_paperwork_document_owner_partner', 'paperwork.correct'),
      ('create_legacy_delivered_paperwork_request', 'paperwork.correct'),
      ('link_vault_paperwork_request', 'paperwork.correct'),
      ('authorize_paperwork_document_release', 'paperwork.authorize_release')
    ) mapping(function_name, permission_code)
  loop
    for v_function in
      select procedure.oid, pg_get_functiondef(procedure.oid) definition
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.prokind = 'f'
        and procedure.proname = v_mapping.function_name
        and pg_get_function_identity_arguments(procedure.oid) ilike '%p_tenant_id uuid%'
    loop
      v_expected := v_expected + 1;
      v_definition := v_function.definition;

      -- Remove the temporary baseline owner-only authorization block. Business
      -- validation and all other owner-owned cross-domain commands remain intact.
      v_rewritten := regexp_replace(
        v_definition,
        E'\\s+if not public\\.is_tenant_owner\\(p_tenant_id\\) then\\s+raise exception [^;]+;\\s+end if;',
        '',
        'i'
      );

      if v_rewritten not ilike '%require_paperwork_action(p_tenant_id,%' then
        v_rewritten := regexp_replace(
          v_rewritten,
          E'(perform public\\.require_paperwork_access\\(p_tenant_id\\);)',
          E'\\1\n  perform public.require_paperwork_action(p_tenant_id, ''' || v_mapping.permission_code || E''');',
          'i'
        );
      end if;

      if v_rewritten = v_definition
         or v_rewritten not ilike '%require_paperwork_action(p_tenant_id, ''' || v_mapping.permission_code || ''')%' then
        raise exception 'Could not install % on %', v_mapping.permission_code, v_function.oid::regprocedure;
      end if;

      execute v_rewritten;
      v_updated := v_updated + 1;
    end loop;
  end loop;

  if v_expected <> 20 or v_updated <> v_expected then
    raise exception 'Paperwork RPC mapping assertion failed: expected 20 signatures, found %, updated %', v_expected, v_updated;
  end if;
end
$$;

do $$
declare
  v_expected_codes constant text[] := array[
    'paperwork.send', 'paperwork.receive', 'paperwork.deliver',
    'paperwork.cancel', 'paperwork.correct', 'paperwork.authorize_release'
  ];
begin
  if (select count(*) from public.auth_permissions
      where code = 'paperwork.access' and active and permission_type = 'app_access') <> 1 then
    raise exception 'Paperwork app access assertion failed.';
  end if;

  if (select count(*) from public.auth_permissions
      where module_code = 'paperwork' and active and permission_type = 'action') <> 6
     or exists (
       select 1 from public.auth_permissions
       where module_code = 'paperwork' and active and permission_type = 'action'
         and not (code = any(v_expected_codes))
     )
     or exists (
       select 1 from unnest(v_expected_codes) expected(code)
       where not exists (
         select 1 from public.auth_permissions permission
         where permission.code = expected.code and permission.active
           and permission.permission_type = 'action' and permission.module_code = 'paperwork'
       )
     ) then
    raise exception 'Paperwork action permission catalog assertion failed.';
  end if;

  if exists (
    select 1
    from public.auth_group_permissions grant_row
    join public.auth_permissions permission on permission.id = grant_row.permission_id
    where permission.code = any(v_expected_codes)
  ) then
    raise exception 'Paperwork action permissions must not be granted automatically.';
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;
