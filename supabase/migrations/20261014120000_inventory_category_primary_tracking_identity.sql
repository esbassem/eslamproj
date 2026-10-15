begin;

-- Preserve the deployed receiving implementation behind a private boundary. The
-- public signature remains unchanged and now validates the category-selected
-- primary identity before invoking the existing atomic/idempotent command.
alter function public.receive_inventory(uuid,uuid,text,text,jsonb,text)
  rename to receive_inventory_without_primary_identity_guard;

revoke all on function public.receive_inventory_without_primary_identity_guard(uuid,uuid,text,text,jsonb,text)
  from public,anon,authenticated,service_role;

create function public.receive_inventory(
  p_branch_id uuid,
  p_destination_location_id uuid,
  p_source_type text,
  p_source_id text,
  p_lines jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_tenant_id uuid:=public.current_tenant_id();
  v_actor_id uuid:=public.current_tenant_user_id();
  v_line jsonb;
  v_unit jsonb;
  v_product record;
  v_location record;
  v_primary_identifier_type_id uuid;
  v_primary_value text;
  v_tracking_number text;
  v_primary_count integer;
begin
  -- Preserve the canonical authorization order before reading category
  -- configuration; the private command repeats these checks before writing.
  if v_tenant_id is null or v_actor_id is null
    or not public.has_permission('inventory.receive',v_tenant_id) then
    raise exception using errcode='42501',message='INVENTORY_RECEIVE_DENIED';
  end if;
  if not exists(select 1 from public.tenants where id=v_tenant_id and status='active')
    or not exists(
      select 1 from public.tenant_modules tm
      join public.ir_modules m on m.id=tm.module_id
      where tm.tenant_id=v_tenant_id and tm.state='installed'
        and m.technical_name='inventory' and m.active
    ) then
    raise exception using errcode='42501',message='INVENTORY_APP_ACCESS_DENIED';
  end if;
  if not public.has_branch_access(p_branch_id) then
    raise exception using errcode='42501',message='INVENTORY_BRANCH_ACCESS_DENIED';
  end if;
  select * into v_location
  from public.stock_locations
  where id=p_destination_location_id and tenant_id=v_tenant_id
    and branch_id=p_branch_id and is_active
    and location_type in('internal','showroom');
  if not found or not public.has_stock_location_access(p_destination_location_id) then
    raise exception using errcode='42501',message='INVENTORY_LOCATION_ACCESS_DENIED';
  end if;

  -- A replay must be judged against the immutable original fingerprint/result,
  -- not against category ordering that may have changed after the receipt.
  if p_idempotency_key is not null and exists(
    select 1 from public.inventory_command_requests request
    where request.tenant_id=v_tenant_id
      and request.command_type='receive'
      and request.idempotency_key=btrim(p_idempotency_key)
  ) then
    return public.receive_inventory_without_primary_identity_guard(
      p_branch_id,p_destination_location_id,p_source_type,p_source_id,p_lines,p_idempotency_key
    );
  end if;

  -- The private command remains the authority for product, complete payload,
  -- uniqueness and idempotency validation. This guard adds only the
  -- category-driven primary-identity invariant.
  if jsonb_typeof(p_lines)='array' then
    for v_line in select value from jsonb_array_elements(p_lines) loop
      select p.id,t.category_id,coalesce(p.tracking,t.tracking) as tracking
        into v_product
      from public.product_products p
      join public.product_templates t
        on t.id=p.product_template_id and t.tenant_id=p.tenant_id
      where p.id=nullif(v_line->>'product_id','')::uuid
        and p.tenant_id=v_tenant_id;

      if found and v_product.tracking='serial'
        and jsonb_typeof(v_line->'units')='array' then
        select link.identifier_type_id
          into v_primary_identifier_type_id
        from public.product_category_tracking_identifiers link
        join public.product_tracking_identifier_types identifier_type
          on identifier_type.id=link.identifier_type_id
         and identifier_type.tenant_id=link.tenant_id
         and identifier_type.is_active
        where link.tenant_id=v_tenant_id
          and link.category_id=v_product.category_id
        order by link.sequence,link.identifier_type_id
        limit 1;

        if v_primary_identifier_type_id is not null then
          for v_unit in select value from jsonb_array_elements(v_line->'units') loop
            v_tracking_number:=nullif(upper(btrim(v_unit->>'tracking_number')),'');

            select count(*),min(nullif(upper(btrim(identifier->>'value')),''))
              into v_primary_count,v_primary_value
            from jsonb_array_elements(coalesce(v_unit->'identifiers','[]'::jsonb)) identifier
            where nullif(identifier->>'identifier_type_id','')::uuid=v_primary_identifier_type_id
              and not coalesce((identifier->>'is_not_available')::boolean,false)
              and nullif(btrim(identifier->>'value'),'') is not null;

            if v_primary_count<>1 or v_primary_value is null then
              raise exception using errcode='23514',message='INVENTORY_PRIMARY_TRACKING_IDENTITY_REQUIRED';
            end if;
            if v_tracking_number is null or v_tracking_number<>v_primary_value then
              raise exception using errcode='23514',message='INVENTORY_PRIMARY_TRACKING_IDENTITY_MISMATCH';
            end if;
          end loop;
        end if;
      end if;
    end loop;
  end if;

  return public.receive_inventory_without_primary_identity_guard(
    p_branch_id,p_destination_location_id,p_source_type,p_source_id,p_lines,p_idempotency_key
  );
end
$$;

-- Receiving renders the effective category attributes (nearest category wins),
-- so its server-side allow-list and required checks must resolve the same
-- hierarchy. This function is private to trusted database code.
create function public.inventory_effective_category_attributes(
  p_tenant_id uuid,
  p_category_id uuid
) returns table(attribute_id uuid,is_required boolean)
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  with recursive category_hierarchy as (
    select category.id,category.parent_id,0 as depth
    from public.product_categories category
    where category.tenant_id=p_tenant_id and category.id=p_category_id
    union all
    select parent.id,parent.parent_id,hierarchy.depth+1
    from category_hierarchy hierarchy
    join public.product_categories parent
      on parent.tenant_id=p_tenant_id and parent.id=hierarchy.parent_id
  ), ranked_attributes as (
    select link.attribute_id,link.is_required,
      row_number() over(partition by link.attribute_id order by hierarchy.depth,link.attribute_id) as precedence
    from category_hierarchy hierarchy
    join public.product_category_attributes link
      on link.tenant_id=p_tenant_id and link.category_id=hierarchy.id
  )
  select ranked.attribute_id,ranked.is_required
  from ranked_attributes ranked
  where ranked.precedence=1
$$;

revoke all on function public.inventory_effective_category_attributes(uuid,uuid)
  from public,anon,authenticated,service_role;

-- The implementation was created by the canonical Receiving migration and was
-- renamed above. Patch only its two category-attribute predicates, failing
-- closed if the deployed definition is not the audited implementation.
do $receiving_attribute_inheritance$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.receive_inventory_without_primary_identity_guard(uuid,uuid,text,text,jsonb,text)'::regprocedure
  ) into v_definition;

  v_updated:=replace(
    v_definition,
    $old$public.product_category_attributes ca where ca.tenant_id=v_tenant_id and ca.category_id=v_product.category_id and ca.attribute_id=nullif(v_attribute->>'attribute_id','')::uuid$old$,
    $new$public.inventory_effective_category_attributes(v_tenant_id,v_product.category_id) ca where ca.attribute_id=nullif(v_attribute->>'attribute_id','')::uuid$new$
  );
  if v_updated=v_definition then
    raise exception 'INVENTORY_RECEIVING_ATTRIBUTE_ALLOWLIST_PATCH_FAILED';
  end if;
  v_definition:=v_updated;

  v_updated:=replace(
    v_definition,
    $old$public.product_category_attributes req where req.tenant_id=v_tenant_id and req.category_id=v_product.category_id and req.is_required$old$,
    $new$public.inventory_effective_category_attributes(v_tenant_id,v_product.category_id) req where req.is_required$new$
  );
  if v_updated=v_definition then
    raise exception 'INVENTORY_RECEIVING_REQUIRED_ATTRIBUTE_PATCH_FAILED';
  end if;

  execute v_updated;
end
$receiving_attribute_inheritance$;

revoke all on function public.receive_inventory(uuid,uuid,text,text,jsonb,text) from public,anon;
grant execute on function public.receive_inventory(uuid,uuid,text,text,jsonb,text) to authenticated,service_role;

comment on function public.receive_inventory(uuid,uuid,text,text,jsonb,text) is
  'Canonical Receiving boundary; for serialized products the first active category identifier by sequence and identifier UUID is also the tracking number.';
comment on function public.receive_inventory_without_primary_identity_guard(uuid,uuid,text,text,jsonb,text) is
  'Private implementation behind the category-driven primary tracking identity guard.';
comment on function public.inventory_effective_category_attributes(uuid,uuid) is
  'Private nearest-category-wins attribute resolver shared by canonical Receiving validation.';

notify pgrst,'reload schema';
commit;
