begin;

alter table public.stock_tracking_units
  add column if not exists data_status text not null default 'complete',
  add column if not exists incomplete_reason text;

update public.stock_tracking_units
set data_status = case when product_product_id is null then 'incomplete' else 'complete' end,
    incomplete_reason = case when product_product_id is null then 'missing_product' else null end;

alter table public.stock_tracking_units
  drop constraint if exists stock_tracking_units_data_status_check,
  add constraint stock_tracking_units_data_status_check
    check (data_status in ('complete', 'incomplete', 'needs_review')),
  drop constraint if exists stock_tracking_units_incomplete_reason_check,
  add constraint stock_tracking_units_incomplete_reason_check
    check (incomplete_reason is null or incomplete_reason in ('missing_product', 'missing_identifiers', 'legacy_import', 'needs_review')),
  drop constraint if exists stock_tracking_units_data_completeness_check,
  add constraint stock_tracking_units_data_completeness_check
    check (
      (data_status = 'complete' and incomplete_reason is null)
      or (data_status in ('incomplete', 'needs_review') and incomplete_reason is not null)
    );

create index if not exists stock_tracking_units_tenant_data_status_status_idx
  on public.stock_tracking_units (tenant_id, data_status, status);

create index if not exists stock_tracking_units_incomplete_idx
  on public.stock_tracking_units (tenant_id, updated_at desc)
  where data_status in ('incomplete', 'needs_review');

create or replace function public.guard_incomplete_tracking_unit_operations()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in ('reserved', 'sold')
    and (new.data_status <> 'complete' or new.product_product_id is null)
  then
    raise exception 'لا يمكن حجز أو بيع القطعة قبل استكمال بيانات المنتج.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_incomplete_tracking_unit_operations on public.stock_tracking_units;
create trigger trg_guard_incomplete_tracking_unit_operations
before insert or update of status, data_status, product_product_id
on public.stock_tracking_units
for each row execute function public.guard_incomplete_tracking_unit_operations();

with inventory_module as (
  select id from public.ir_modules where technical_name = 'inventory' limit 1
)
insert into public.res_groups (
  tenant_id, module_id, name, code, description, category, is_system, active
)
select
  null,
  inventory_module.id,
  'استكمال بيانات القطع',
  'inventory_complete_tracking_unit',
  'اختيار المنتج واستكمال المعرفات والخصائص لقطعة غير مكتملة.',
  'Inventory',
  true,
  true
from inventory_module
where not exists (
  select 1 from public.res_groups
  where tenant_id is null and code = 'inventory_complete_tracking_unit'
);

create table if not exists public.stock_tracking_unit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tracking_unit_id uuid not null references public.stock_tracking_units(id) on delete cascade,
  event_type text not null,
  old_data_status text,
  new_data_status text,
  product_product_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.tenant_users(id),
  created_at timestamptz not null default now()
);

create index if not exists stock_tracking_unit_events_unit_created_idx
  on public.stock_tracking_unit_events (tenant_id, tracking_unit_id, created_at desc);

alter table public.stock_tracking_unit_events enable row level security;
drop policy if exists stock_tracking_unit_events_select_tenant_member on public.stock_tracking_unit_events;
create policy stock_tracking_unit_events_select_tenant_member
on public.stock_tracking_unit_events for select to authenticated
using (exists (
  select 1 from public.tenant_users tu
  where tu.tenant_id = stock_tracking_unit_events.tenant_id
    and tu.auth_user_id = auth.uid() and tu.is_active = true
));

create or replace function public.can_complete_tracking_unit(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.auth_user_id = auth.uid()
      and tu.is_active = true
      and (
        tu.role = 'owner'
        or exists (
          select 1
          from public.res_users_groups membership
          join public.res_groups permission_group on permission_group.id = membership.group_id
          where membership.tenant_id = p_tenant_id
            and membership.user_id = tu.id
            and permission_group.active = true
            and permission_group.code = 'inventory_complete_tracking_unit'
            and (permission_group.tenant_id is null or permission_group.tenant_id = p_tenant_id)
        )
      )
  );
$$;

create or replace function public.complete_incomplete_tracking_unit(
  p_tenant_id uuid,
  p_tracking_unit_id uuid,
  p_product_product_id uuid,
  p_identifier_values jsonb default '[]'::jsonb,
  p_attribute_values jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.tenant_users;
  v_unit public.stock_tracking_units;
  v_product public.product_products;
  v_template public.product_templates;
  v_identifier jsonb;
  v_attribute jsonb;
  v_required record;
  v_value text;
  v_not_available boolean;
  v_old_status text;
begin
  select * into v_user
  from public.tenant_users
  where tenant_id = p_tenant_id and auth_user_id = auth.uid() and is_active = true
  limit 1;

  if v_user.id is null then raise exception 'تعذر تحديد مستخدم الشركة الحالي.'; end if;
  if not public.can_complete_tracking_unit(p_tenant_id) then
    raise exception 'لا تملك صلاحية استكمال بيانات القطعة.';
  end if;

  select * into v_unit
  from public.stock_tracking_units
  where tenant_id = p_tenant_id and id = p_tracking_unit_id
  for update;

  if v_unit.id is null then raise exception 'القطعة غير موجودة داخل الشركة.'; end if;
  if v_unit.data_status not in ('incomplete', 'needs_review') then
    raise exception 'تم استكمال القطعة بالفعل أو لم تعد قابلة للاستكمال.';
  end if;

  select * into v_product
  from public.product_products
  where tenant_id = p_tenant_id and id = p_product_product_id and is_active = true;
  if v_product.id is null then raise exception 'المنتج غير موجود أو غير نشط.'; end if;

  select * into v_template
  from public.product_templates
  where tenant_id = p_tenant_id and id = v_product.product_template_id and is_active = true;
  if v_template.id is null then raise exception 'قالب المنتج غير موجود أو غير نشط.'; end if;
  if v_template.product_type = 'service' then raise exception 'لا يمكن ربط القطعة بمنتج خدمة.'; end if;
  if coalesce(v_product.tracking, v_template.tracking, 'none') not in ('serial', 'lot') then
    raise exception 'المنتج المختار لا يدعم تتبع القطع.';
  end if;

  for v_identifier in select value from jsonb_array_elements(coalesce(p_identifier_values, '[]'::jsonb)) loop
    if nullif(v_identifier->>'identifierTypeId', '') is null then continue; end if;
    v_value := nullif(trim(coalesce(v_identifier->>'value', '')), '');
    v_not_available := coalesce((v_identifier->>'isNotAvailable')::boolean, false);
    delete from public.stock_tracking_unit_identifiers
    where tenant_id = p_tenant_id and tracking_unit_id = v_unit.id
      and identifier_type_id = (v_identifier->>'identifierTypeId')::uuid;
    insert into public.stock_tracking_unit_identifiers (
      tenant_id, tracking_unit_id, identifier_type_id, value, is_not_available, created_by
    ) values (
      p_tenant_id, v_unit.id, (v_identifier->>'identifierTypeId')::uuid,
      case when v_not_available then null else v_value end, v_not_available, v_user.id
    );
  end loop;

  for v_required in
    select link.identifier_type_id, link.allow_not_available, typ.name
    from public.product_category_tracking_identifiers link
    join public.product_tracking_identifier_types typ on typ.id = link.identifier_type_id
    where link.tenant_id = p_tenant_id and link.category_id = v_template.category_id
      and link.is_required = true and typ.is_active = true
  loop
    if not exists (
      select 1 from public.stock_tracking_unit_identifiers identifier
      where identifier.tenant_id = p_tenant_id and identifier.tracking_unit_id = v_unit.id
        and identifier.identifier_type_id = v_required.identifier_type_id
        and (nullif(trim(coalesce(identifier.value, '')), '') is not null
          or (v_required.allow_not_available and identifier.is_not_available = true))
    ) then raise exception 'المعرف الإجباري "%" غير مكتمل.', v_required.name; end if;
  end loop;

  for v_attribute in select value from jsonb_array_elements(coalesce(p_attribute_values, '[]'::jsonb)) loop
    if nullif(v_attribute->>'attributeId', '') is null then continue; end if;
    delete from public.stock_tracking_unit_attributes
    where tenant_id = p_tenant_id and tracking_unit_id = v_unit.id
      and attribute_id = (v_attribute->>'attributeId')::uuid;
    insert into public.stock_tracking_unit_attributes (
      tenant_id, tracking_unit_id, attribute_id, attribute_value_id, value_text
    ) values (
      p_tenant_id, v_unit.id, (v_attribute->>'attributeId')::uuid,
      nullif(v_attribute->>'attributeValueId', '')::uuid,
      nullif(trim(coalesce(v_attribute->>'valueText', '')), '')
    );
  end loop;

  for v_required in
    select link.attribute_id, attribute.name
    from public.product_category_attributes link
    join public.product_attributes attribute on attribute.id = link.attribute_id
    where link.tenant_id = p_tenant_id and link.category_id = v_template.category_id
      and link.is_required = true and attribute.is_active = true
  loop
    if not exists (
      select 1 from public.stock_tracking_unit_attributes value
      where value.tenant_id = p_tenant_id and value.tracking_unit_id = v_unit.id
        and value.attribute_id = v_required.attribute_id
        and (value.attribute_value_id is not null or nullif(trim(coalesce(value.value_text, '')), '') is not null)
    ) then raise exception 'الخاصية الإجبارية "%" غير مكتملة.', v_required.name; end if;
  end loop;

  v_old_status := v_unit.data_status;
  update public.stock_tracking_units
  set product_product_id = v_product.id,
      product_template_id = v_product.product_template_id,
      tracking_type = coalesce(v_product.tracking, v_template.tracking),
      data_status = 'complete', incomplete_reason = null, updated_at = now()
  where id = v_unit.id;

  insert into public.stock_tracking_unit_events (
    tenant_id, tracking_unit_id, event_type, old_data_status, new_data_status,
    product_product_id, details, created_by
  ) values (
    p_tenant_id, v_unit.id, 'data_completed', v_old_status, 'complete', v_product.id,
    jsonb_build_object('incomplete_reason', v_unit.incomplete_reason), v_user.id
  );

  return jsonb_build_object(
    'id', v_unit.id, 'product_product_id', v_product.id,
    'product_template_id', v_product.product_template_id,
    'tracking_type', coalesce(v_product.tracking, v_template.tracking),
    'data_status', 'complete', 'incomplete_reason', null
  );
end;
$$;

grant execute on function public.can_complete_tracking_unit(uuid) to authenticated;
grant execute on function public.complete_incomplete_tracking_unit(uuid, uuid, uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
