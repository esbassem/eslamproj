begin;

do $$
declare
  v_module_id uuid;
  v_root_id uuid;
begin
  select id into v_module_id
  from public.ir_modules
  where technical_name = 'paperwork'
  order by created_at, id
  limit 1;

  if v_module_id is null then
    raise exception 'Paperwork module is required before canonicalizing its requests destination';
  end if;

  select id into v_root_id
  from public.ir_ui_menus
  where module_id = v_module_id and code = 'paperwork.root'
  order by created_at, id
  limit 1;

  if v_root_id is null then
    raise exception 'paperwork.root is required before canonicalizing its requests destination';
  end if;

  if not exists (
    select 1 from public.tenant_modules
    where module_id = v_module_id and state = 'installed'
  ) then
    raise exception 'Paperwork must be installed for at least one tenant';
  end if;

  update public.ir_ui_menus
  set parent_id = v_root_id,
      name = 'طلبات الأوراق',
      route_path = '/apps/paperwork',
      sequence = 10,
      active = true,
      updated_at = now()
  where module_id = v_module_id
    and code = 'paperwork.requests';

  update public.ir_ui_menus
  set parent_id = v_root_id,
      name = 'المستندات',
      route_path = '/apps/paperwork/documents',
      sequence = 20,
      active = true,
      updated_at = now()
  where module_id = v_module_id
    and code = 'paperwork.documents';

  if not exists (
    select 1 from public.ir_ui_menus
    where module_id = v_module_id
      and code = 'paperwork.requests'
      and parent_id = v_root_id
      and route_path = '/apps/paperwork'
      and active
  ) then
    raise exception 'Canonical Paperwork requests menu metadata could not be verified';
  end if;

  if not exists (
    select 1 from public.ir_ui_menus
    where module_id = v_module_id
      and code = 'paperwork.documents'
      and parent_id = v_root_id
      and route_path = '/apps/paperwork/documents'
      and active
  ) then
    raise exception 'Canonical Paperwork documents menu metadata could not be verified';
  end if;
end
$$;

commit;
