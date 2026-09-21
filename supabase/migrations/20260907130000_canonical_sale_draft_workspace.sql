begin;

-- Draft-only inventory intent. These rows do not reserve stock and are
-- replaced atomically by the canonical draft update command.
create table if not exists public.sale_draft_inventory_intents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  sale_line_id uuid not null,
  location_id uuid not null,
  tracking_unit_id uuid,
  quantity numeric(18,4) not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint sale_draft_inventory_intents_sale_fkey
    foreign key (sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete cascade,
  constraint sale_draft_inventory_intents_line_fkey
    foreign key (sale_line_id, tenant_id, sale_id)
    references public.sale_lines(id, tenant_id, sale_id) on delete cascade,
  constraint sale_draft_inventory_intents_location_fkey
    foreign key (location_id, tenant_id)
    references public.stock_locations(id, tenant_id) on delete restrict,
  constraint sale_draft_inventory_intents_tracking_fkey
    foreign key (tracking_unit_id, tenant_id)
    references public.stock_tracking_units(id, tenant_id) on delete restrict,
  constraint sale_draft_inventory_intents_actor_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sale_draft_inventory_intents_quantity_check
    check (quantity > 0 and quantity = round(quantity, 4)),
  constraint sale_draft_inventory_intents_line_unit_unique
    unique nulls not distinct (sale_id, sale_line_id, tracking_unit_id),
  constraint sale_draft_inventory_intents_id_tenant_unique unique (id, tenant_id)
);

create index if not exists sale_draft_inventory_intents_sale_idx
  on public.sale_draft_inventory_intents (tenant_id, sale_id, sale_line_id);
create unique index if not exists sale_draft_inventory_intents_serial_unique
  on public.sale_draft_inventory_intents (tenant_id, sale_id, tracking_unit_id)
  where tracking_unit_id is not null;

alter table public.sale_draft_inventory_intents enable row level security;
revoke all on public.sale_draft_inventory_intents from public, anon, authenticated, service_role;
grant select on public.sale_draft_inventory_intents to authenticated;

drop policy if exists sale_draft_inventory_intents_read on public.sale_draft_inventory_intents;
create policy sale_draft_inventory_intents_read on public.sale_draft_inventory_intents
for select to authenticated using (
  exists (
    select 1
    from public.sales sale
    where sale.id = public.sale_draft_inventory_intents.sale_id
      and sale.tenant_id = public.sale_draft_inventory_intents.tenant_id
      and sale.tenant_id = public.current_tenant_id()
      and public.has_permission('sales.access', sale.tenant_id)
      and public.has_permission('sales.view', sale.tenant_id)
      and public.has_branch_access(sale.branch_id)
  )
);

alter table public.sales_command_requests
  drop constraint sales_command_requests_type_check,
  add constraint sales_command_requests_type_check check (
    command_type in ('create', 'update_draft', 'update_draft_with_intent', 'confirm', 'deliver')
  );

create or replace function public.get_sale_draft_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id uuid := public.current_tenant_user_id();
  v_default_branch_id uuid;
  v_default_location_id uuid;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not (
       public.has_permission('sales.create', v_tenant_id)
       or public.has_permission('sales.update_draft', v_tenant_id)
       or public.has_permission('sales.view', v_tenant_id)
     ) then
    raise exception using errcode = '42501', message = 'SALES_DRAFT_OPTIONS_DENIED';
  end if;

  select defaults.default_branch_id, defaults.default_stock_location_id
  into v_default_branch_id, v_default_location_id
  from public.user_operational_defaults defaults
  where defaults.tenant_id = v_tenant_id and defaults.user_id = v_actor_id;

  if v_default_branch_id is not null and not exists (
    select 1 from public.branches branch
    where branch.id = v_default_branch_id
      and branch.tenant_id = v_tenant_id
      and branch.is_active
      and public.has_branch_access(branch.id)
  ) then
    v_default_branch_id := null;
    v_default_location_id := null;
  end if;

  if v_default_location_id is not null and not exists (
    select 1 from public.stock_locations location
    where location.id = v_default_location_id
      and location.tenant_id = v_tenant_id
      and location.branch_id = v_default_branch_id
      and location.is_active
      and public.has_stock_location_access(location.id)
  ) then
    v_default_location_id := null;
  end if;

  return jsonb_build_object(
    'default_branch_id', v_default_branch_id,
    'default_stock_location_id', v_default_location_id,
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', branch.id,
        'name', branch.name,
        'code', branch.code
      ) order by branch.name, branch.id)
      from public.branches branch
      where branch.tenant_id = v_tenant_id
        and branch.is_active
        and public.has_branch_access(branch.id)
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', location.id,
        'branch_id', location.branch_id,
        'name', location.name,
        'code', location.code,
        'location_type', location.location_type
      ) order by location.name, location.id)
      from public.stock_locations location
      where location.tenant_id = v_tenant_id
        and location.is_active
        and public.has_branch_access(location.branch_id)
        and public.has_stock_location_access(location.id)
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.search_sale_customers(
  p_search text,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_page integer := coalesce(p_page, 1);
  v_page_size integer := coalesce(p_page_size, 20);
begin
  if v_tenant_id is null or public.current_tenant_user_id() is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not (
       public.has_permission('sales.create', v_tenant_id)
       or public.has_permission('sales.update_draft', v_tenant_id)
     ) then
    raise exception using errcode = '42501', message = 'SALES_CUSTOMER_SEARCH_DENIED';
  end if;
  if v_page < 1 or v_page_size < 1 or v_page_size > 50 then
    raise exception using errcode = '22023', message = 'SALES_SEARCH_PAGE_INVALID';
  end if;
  if v_search is null or length(v_search) < 2 then
    return jsonb_build_object('items', '[]'::jsonb, 'page', v_page, 'page_size', v_page_size, 'has_more', false);
  end if;
  if length(v_search) > 120 then
    raise exception using errcode = '22023', message = 'SALES_SEARCH_TOO_LONG';
  end if;

  return (
    with matches as materialized (
      select partner.id, partner.name,
        coalesce(nullif(partner.mobile, ''), nullif(partner.phone1, ''), nullif(partner.phone2, '')) phone
      from public.partners partner
      where partner.tenant_id = v_tenant_id
        and partner.active
        and partner.customer_rank > 0
        and (
          partner.name ilike '%' || v_search || '%'
          or coalesce(partner.mobile, '') ilike '%' || v_search || '%'
          or coalesce(partner.phone1, '') ilike '%' || v_search || '%'
          or coalesce(partner.phone2, '') ilike '%' || v_search || '%'
        )
      order by partner.name, partner.id
      limit v_page_size + 1
      offset (v_page - 1) * v_page_size
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', item.id, 'name', item.name, 'phone', item.phone
      ) order by item.name, item.id) from (select * from matches limit v_page_size) item), '[]'::jsonb),
      'page', v_page,
      'page_size', v_page_size,
      'has_more', (select count(*) > v_page_size from matches)
    )
  );
end
$$;

create or replace function public.search_sale_products(
  p_search text,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_page integer := coalesce(p_page, 1);
  v_page_size integer := coalesce(p_page_size, 20);
begin
  if v_tenant_id is null or public.current_tenant_user_id() is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not (
       public.has_permission('sales.create', v_tenant_id)
       or public.has_permission('sales.update_draft', v_tenant_id)
     ) then
    raise exception using errcode = '42501', message = 'SALES_PRODUCT_SEARCH_DENIED';
  end if;
  if v_page < 1 or v_page_size < 1 or v_page_size > 50 then
    raise exception using errcode = '22023', message = 'SALES_SEARCH_PAGE_INVALID';
  end if;
  if v_search is null or length(v_search) < 2 then
    return jsonb_build_object('items', '[]'::jsonb, 'page', v_page, 'page_size', v_page_size, 'has_more', false);
  end if;
  if length(v_search) > 120 then
    raise exception using errcode = '22023', message = 'SALES_SEARCH_TOO_LONG';
  end if;

  return (
    with matches as materialized (
      select product.id, product.display_name, product.sku, product.barcode,
        product.tracking, template.product_type, product.sale_price
      from public.product_products product
      join public.product_templates template
        on template.id = product.product_template_id and template.tenant_id = product.tenant_id
      where product.tenant_id = v_tenant_id
        and product.is_active and template.is_active and template.can_be_sold
        and (
          template.product_type = 'service'
          or (template.product_type = 'goods' and product.tracking in ('none', 'serial'))
        )
        and (
          product.display_name ilike '%' || v_search || '%'
          or coalesce(product.sku, '') ilike '%' || v_search || '%'
          or coalesce(product.barcode, '') ilike '%' || v_search || '%'
        )
      order by product.display_name, product.id
      limit v_page_size + 1
      offset (v_page - 1) * v_page_size
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'name', item.display_name,
        'sku', item.sku,
        'barcode', item.barcode,
        'tracking', item.tracking,
        'product_type', item.product_type,
        'sale_price', item.sale_price
      ) order by item.display_name, item.id) from (select * from matches limit v_page_size) item), '[]'::jsonb),
      'page', v_page,
      'page_size', v_page_size,
      'has_more', (select count(*) > v_page_size from matches)
    )
  );
end
$$;

create or replace function public.get_sale_quantity_availability(
  p_branch_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_quantity numeric default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_available numeric := 0;
begin
  if v_tenant_id is null or public.current_tenant_user_id() is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not (
       public.has_permission('sales.create', v_tenant_id)
       or public.has_permission('sales.update_draft', v_tenant_id)
     ) then
    raise exception using errcode = '42501', message = 'SALES_AVAILABILITY_DENIED';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'SALES_QUANTITY_INVALID';
  end if;
  if not public.has_branch_access(p_branch_id)
     or not public.has_stock_location_access(p_location_id)
     or not exists (
       select 1 from public.stock_locations location
       where location.id = p_location_id and location.tenant_id = v_tenant_id
         and location.branch_id = p_branch_id and location.is_active
     ) then
    raise exception using errcode = '42501', message = 'SALES_INVENTORY_LOCATION_DENIED';
  end if;
  if not exists (
    select 1
    from public.product_products product
    join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where product.id = p_product_id and product.tenant_id = v_tenant_id
      and product.is_active and template.is_active and template.can_be_sold
      and template.product_type = 'goods' and product.tracking = 'none'
  ) then
    raise exception using errcode = '23514', message = 'SALES_QUANTITY_PRODUCT_INVALID';
  end if;

  select greatest(
    coalesce(quant.quantity_on_hand, 0) - coalesce(quant.reserved_quantity, 0) - coalesce((
      select sum(line.reserved_quantity - line.released_quantity - line.delivered_quantity)
      from public.inventory_reservation_lines line
      join public.inventory_reservations reservation
        on reservation.id = line.reservation_id and reservation.tenant_id = line.tenant_id
      where line.tenant_id = v_tenant_id
        and line.product_id = p_product_id
        and line.tracking_unit_id is null
        and reservation.location_id = p_location_id
        and reservation.state in ('active', 'partially_delivered')
    ), 0),
    0
  ) into v_available
  from (select 1) anchor
  left join public.stock_quants quant
    on quant.tenant_id = v_tenant_id
   and quant.product_product_id = p_product_id
   and quant.location_id = p_location_id;

  return jsonb_build_object(
    'branch_id', p_branch_id,
    'product_id', p_product_id,
    'location_id', p_location_id,
    'requested_quantity', p_quantity,
    'available_quantity', v_available,
    'is_available', v_available >= p_quantity
  );
end
$$;

create or replace function public.search_sale_tracking_units(
  p_branch_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_page integer := coalesce(p_page, 1);
  v_page_size integer := coalesce(p_page_size, 20);
begin
  if v_tenant_id is null or public.current_tenant_user_id() is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not (
       public.has_permission('sales.create', v_tenant_id)
       or public.has_permission('sales.update_draft', v_tenant_id)
     ) then
    raise exception using errcode = '42501', message = 'SALES_TRACKING_SEARCH_DENIED';
  end if;
  if v_page < 1 or v_page_size < 1 or v_page_size > 50
     or (v_search is not null and length(v_search) > 120) then
    raise exception using errcode = '22023', message = 'SALES_SEARCH_PAGE_INVALID';
  end if;
  if not public.has_branch_access(p_branch_id)
     or not public.has_stock_location_access(p_location_id)
     or not exists (
       select 1 from public.stock_locations location
       where location.id = p_location_id and location.tenant_id = v_tenant_id
         and location.branch_id = p_branch_id and location.is_active
     ) then
    raise exception using errcode = '42501', message = 'SALES_INVENTORY_LOCATION_DENIED';
  end if;
  if not exists (
    select 1
    from public.product_products product
    join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where product.id = p_product_id and product.tenant_id = v_tenant_id
      and product.is_active and template.is_active and template.can_be_sold
      and template.product_type = 'goods' and product.tracking = 'serial'
  ) then
    raise exception using errcode = '23514', message = 'SALES_SERIAL_PRODUCT_INVALID';
  end if;

  return (
    with candidates as materialized (
      select unit.id, unit.tracking_number,
        coalesce((
          select identifier.value
          from public.stock_tracking_unit_identifiers identifier
          join public.product_tracking_identifier_types identifier_type
            on identifier_type.id = identifier.identifier_type_id
           and identifier_type.tenant_id = identifier.tenant_id
          where identifier.tenant_id = unit.tenant_id
            and identifier.tracking_unit_id = unit.id
            and not identifier.is_not_available
            and (identifier_type.code || ' ' || identifier_type.name) ~* '(chassis|شاسيه)'
          order by identifier.created_at, identifier.id
          limit 1
        ), unit.tracking_number) chassis_number,
        (
          select identifier.value
          from public.stock_tracking_unit_identifiers identifier
          join public.product_tracking_identifier_types identifier_type
            on identifier_type.id = identifier.identifier_type_id
           and identifier_type.tenant_id = identifier.tenant_id
          where identifier.tenant_id = unit.tenant_id
            and identifier.tracking_unit_id = unit.id
            and not identifier.is_not_available
            and (identifier_type.code || ' ' || identifier_type.name) ~* '(engine|motor|موتور|محرك)'
          order by identifier.created_at, identifier.id
          limit 1
        ) engine_number,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', attribute.name,
            'value', coalesce(attribute_value.name, unit_attribute.value_text)
          ) order by attribute.name, unit_attribute.id)
          from public.stock_tracking_unit_attributes unit_attribute
          join public.product_attributes attribute
            on attribute.id = unit_attribute.attribute_id
           and attribute.tenant_id = unit_attribute.tenant_id
          left join public.product_attribute_values attribute_value
            on attribute_value.id = unit_attribute.attribute_value_id
           and attribute_value.tenant_id = unit_attribute.tenant_id
          where unit_attribute.tenant_id = unit.tenant_id
            and unit_attribute.tracking_unit_id = unit.id
        ), '[]'::jsonb) attributes
      from public.stock_tracking_units unit
      left join public.inventory_tracking_unit_states canonical_state
        on canonical_state.tenant_id = unit.tenant_id
       and canonical_state.tracking_unit_id = unit.id
      where unit.tenant_id = v_tenant_id
        and unit.product_product_id = p_product_id
        and unit.current_location_id = p_location_id
        and unit.tracking_type = 'serial'
        and unit.tracking_number is not null and btrim(unit.tracking_number) <> ''
        and unit.data_status = 'complete'
        and unit.status in ('in_stock', 'returned')
        and coalesce(canonical_state.state, 'available') = 'available'
        and not exists (
          select 1
          from public.inventory_reservation_lines line
          join public.inventory_reservations reservation
            on reservation.id = line.reservation_id and reservation.tenant_id = line.tenant_id
          where line.tenant_id = unit.tenant_id
            and line.tracking_unit_id = unit.id
            and line.reserved_quantity > line.released_quantity + line.delivered_quantity
            and reservation.state in ('active', 'partially_delivered')
        )
    ), filtered as materialized (
      select * from candidates candidate
      where v_search is null
        or candidate.tracking_number ilike '%' || v_search || '%'
        or coalesce(candidate.chassis_number, '') ilike '%' || v_search || '%'
        or coalesce(candidate.engine_number, '') ilike '%' || v_search || '%'
      order by candidate.chassis_number, candidate.id
      limit v_page_size + 1
      offset (v_page - 1) * v_page_size
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'tracking_number', item.tracking_number,
        'chassis_number', item.chassis_number,
        'engine_number', item.engine_number,
        'attributes', item.attributes,
        'location_id', p_location_id
      ) order by item.chassis_number, item.id) from (select * from filtered limit v_page_size) item), '[]'::jsonb),
      'page', v_page,
      'page_size', v_page_size,
      'has_more', (select count(*) > v_page_size from filtered)
    )
  );
end
$$;

create or replace function public.update_sale_draft(
  p_sale_id uuid,
  p_expected_version bigint,
  p_branch_id uuid,
  p_customer_id uuid,
  p_effective_sale_date date,
  p_currency_code text,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key text,
  p_inventory_intents jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id uuid := public.current_tenant_user_id();
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_line record;
  v_line_position integer;
  v_location_id uuid;
  v_one_location_id uuid;
  v_tracking_unit_id uuid;
  v_quantity numeric;
  v_normalized_intents jsonb := '[]'::jsonb;
  v_existing_intents jsonb := '[]'::jsonb;
  v_fingerprint text;
  v_command public.sales_command_requests%rowtype;
  v_command_id uuid := gen_random_uuid();
  v_claimed integer := 0;
  v_internal_key text;
  v_result jsonb;
  v_intents_changed boolean;
  v_new_version bigint;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.update_draft', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_UPDATE_DRAFT_DENIED';
  end if;
  if jsonb_typeof(p_inventory_intents) <> 'array'
     or jsonb_array_length(p_inventory_intents) > 200 then
    raise exception using errcode = '23514', message = 'SALE_DRAFT_INVENTORY_INTENTS_INVALID';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 160 then
    raise exception using errcode = '23514', message = 'SALES_IDEMPOTENCY_KEY_INVALID';
  end if;

  select * into v_sale
  from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = v_tenant_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'SALE_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_position', line.line_position,
    'location_id', intent.location_id,
    'tracking_unit_id', intent.tracking_unit_id,
    'quantity', intent.quantity
  ) order by line.line_position, intent.tracking_unit_id nulls first), '[]'::jsonb)
  into v_existing_intents
  from public.sale_draft_inventory_intents intent
  join public.sale_lines line
    on line.id = intent.sale_line_id and line.tenant_id = intent.tenant_id
  where intent.sale_id = p_sale_id and intent.tenant_id = v_tenant_id;

  for v_item in select item.value from jsonb_array_elements(p_inventory_intents) item
  loop
    begin
      v_line_position := (v_item ->> 'line_position')::integer;
      v_location_id := nullif(v_item ->> 'location_id', '')::uuid;
      v_tracking_unit_id := nullif(v_item ->> 'tracking_unit_id', '')::uuid;
      v_quantity := (v_item ->> 'quantity')::numeric;
    exception when others then
      raise exception using errcode = '23514', message = 'SALE_DRAFT_INVENTORY_INTENT_INVALID';
    end;
    if v_line_position is null or v_line_position < 1
       or v_location_id is null or v_quantity is null or v_quantity <= 0
       or v_quantity <> round(v_quantity, 4) then
      raise exception using errcode = '23514', message = 'SALE_DRAFT_INVENTORY_INTENT_INVALID';
    end if;
    if v_one_location_id is null then
      v_one_location_id := v_location_id;
    elsif v_one_location_id <> v_location_id then
      raise exception using errcode = '23514', message = 'SALE_MULTIPLE_RESERVATION_LOCATIONS_NOT_SUPPORTED';
    end if;
    v_normalized_intents := v_normalized_intents || jsonb_build_array(jsonb_build_object(
      'line_position', v_line_position,
      'location_id', v_location_id,
      'tracking_unit_id', v_tracking_unit_id,
      'quantity', v_quantity
    ));
  end loop;

  select coalesce(jsonb_agg(item order by (item ->> 'line_position')::integer,
    coalesce(item ->> 'tracking_unit_id', '')), '[]'::jsonb)
  into v_normalized_intents
  from jsonb_array_elements(v_normalized_intents) item;

  if exists (
    select 1 from jsonb_array_elements(v_normalized_intents) item
    group by item ->> 'line_position', coalesce(item ->> 'tracking_unit_id', '')
    having count(*) > 1
  ) then
    raise exception using errcode = '23514', message = 'SALE_DRAFT_INVENTORY_INTENT_DUPLICATE';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_normalized_intents) item
    where nullif(item ->> 'tracking_unit_id', '') is not null
    group by item ->> 'tracking_unit_id'
    having count(*) > 1
  ) then
    raise exception using errcode = '23514', message = 'SALE_DRAFT_TRACKING_UNIT_DUPLICATE';
  end if;

  v_fingerprint := public.sales_request_fingerprint(jsonb_build_object(
    'sale_id', p_sale_id,
    'expected_version', p_expected_version,
    'branch_id', p_branch_id,
    'customer_id', p_customer_id,
    'effective_sale_date', p_effective_sale_date,
    'currency_code', upper(btrim(coalesce(p_currency_code, ''))),
    'notes', nullif(btrim(p_notes), ''),
    'lines', p_lines,
    'inventory_intents', v_normalized_intents
  ));
  insert into public.sales_command_requests (
    id, tenant_id, command_type, idempotency_key, request_fingerprint, created_by
  ) values (
    v_command_id, v_tenant_id, 'update_draft_with_intent',
    btrim(p_idempotency_key), v_fingerprint, v_actor_id
  ) on conflict (tenant_id, command_type, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    select * into v_command
    from public.sales_command_requests request
    where request.tenant_id = v_tenant_id
      and request.command_type = 'update_draft_with_intent'
      and request.idempotency_key = btrim(p_idempotency_key)
    for update;
    if v_command.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23514', message = 'SALES_IDEMPOTENCY_CONFLICT';
    end if;
    if v_command.result is null then
      raise exception using errcode = '40001', message = 'SALES_IDEMPOTENCY_IN_PROGRESS';
    end if;
    return v_command.result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_internal_key := 'draft-editor-' || encode(extensions.digest(
    v_tenant_id::text || ':' || btrim(p_idempotency_key), 'sha256'
  ), 'hex');
  v_result := public.update_sale_draft(
    p_sale_id, p_expected_version, p_branch_id, p_customer_id,
    p_effective_sale_date, p_currency_code, p_notes, p_lines, v_internal_key
  );

  for v_item in select item.value from jsonb_array_elements(v_normalized_intents) item
  loop
    v_line_position := (v_item ->> 'line_position')::integer;
    v_location_id := (v_item ->> 'location_id')::uuid;
    v_tracking_unit_id := nullif(v_item ->> 'tracking_unit_id', '')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;

    select line.id sale_line_id, line.quantity line_quantity,
      product.id product_id, product.tracking,
      template.product_type
    into v_line
    from public.sale_lines line
    join public.product_products product
      on product.id = line.product_id and product.tenant_id = line.tenant_id
    join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
      and line.line_position = v_line_position;
    if not found then
      raise exception using errcode = '23514', message = 'SALE_DRAFT_INVENTORY_LINE_INVALID';
    end if;
    if not public.has_stock_location_access(v_location_id)
       or not exists (
         select 1 from public.stock_locations location
         where location.id = v_location_id and location.tenant_id = v_tenant_id
           and location.branch_id = p_branch_id and location.is_active
       ) then
      raise exception using errcode = '42501', message = 'SALES_INVENTORY_LOCATION_DENIED';
    end if;
    if v_line.product_type = 'service' or v_line.product_type <> 'goods'
       or v_line.tracking = 'lot' then
      raise exception using errcode = '23514', message = 'SALE_DRAFT_INVENTORY_PRODUCT_UNSUPPORTED';
    elsif v_line.tracking = 'serial' then
      if v_tracking_unit_id is null or v_quantity <> 1 then
        raise exception using errcode = '23514', message = 'SALE_DRAFT_SERIAL_INTENT_INVALID';
      end if;
      if not exists (
        select 1
        from public.stock_tracking_units unit
        left join public.inventory_tracking_unit_states canonical_state
          on canonical_state.tenant_id = unit.tenant_id
         and canonical_state.tracking_unit_id = unit.id
        where unit.id = v_tracking_unit_id and unit.tenant_id = v_tenant_id
          and unit.product_product_id = v_line.product_id
          and unit.current_location_id = v_location_id
          and unit.tracking_type = 'serial'
          and unit.data_status = 'complete'
          and unit.status in ('in_stock', 'returned')
          and coalesce(canonical_state.state, 'available') = 'available'
          and not exists (
            select 1
            from public.inventory_reservation_lines reservation_line
            join public.inventory_reservations reservation
              on reservation.id = reservation_line.reservation_id
             and reservation.tenant_id = reservation_line.tenant_id
            where reservation_line.tenant_id = unit.tenant_id
              and reservation_line.tracking_unit_id = unit.id
              and reservation_line.reserved_quantity
                > reservation_line.released_quantity + reservation_line.delivered_quantity
              and reservation.state in ('active', 'partially_delivered')
          )
      ) then
        raise exception using errcode = '23514', message = 'SALE_DRAFT_TRACKING_UNIT_UNAVAILABLE';
      end if;
    elsif v_line.tracking = 'none' then
      if v_tracking_unit_id is not null or v_quantity <> v_line.line_quantity then
        raise exception using errcode = '23514', message = 'SALE_DRAFT_QUANTITY_INTENT_INVALID';
      end if;
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(v_normalized_intents) item
    join public.sale_lines line
      on line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
     and line.line_position = (item ->> 'line_position')::integer
    join public.product_products product
      on product.id = line.product_id and product.tenant_id = line.tenant_id
    where product.tracking = 'serial'
    group by line.id, line.quantity
    having count(*) > line.quantity
  ) then
    raise exception using errcode = '23514', message = 'SALE_DRAFT_SERIAL_INTENT_EXCEEDS_QUANTITY';
  end if;

  v_intents_changed := v_existing_intents is distinct from v_normalized_intents;
  delete from public.sale_draft_inventory_intents intent
  where intent.sale_id = p_sale_id and intent.tenant_id = v_tenant_id;
  insert into public.sale_draft_inventory_intents (
    tenant_id, sale_id, sale_line_id, location_id,
    tracking_unit_id, quantity, created_by
  )
  select v_tenant_id, p_sale_id, line.id,
    (item ->> 'location_id')::uuid,
    nullif(item ->> 'tracking_unit_id', '')::uuid,
    (item ->> 'quantity')::numeric,
    v_actor_id
  from jsonb_array_elements(v_normalized_intents) item
  join public.sale_lines line
    on line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
   and line.line_position = (item ->> 'line_position')::integer;

  if not coalesce((v_result ->> 'changed')::boolean, false) and v_intents_changed then
    v_new_version := (v_result ->> 'version')::bigint + 1;
    update public.sales sale set version = v_new_version, updated_at = now()
    where sale.id = p_sale_id and sale.tenant_id = v_tenant_id
      and sale.status = 'draft' and sale.version = (v_result ->> 'version')::bigint;
    if not found then
      raise exception using errcode = '40001', message = 'SALES_VERSION_CONFLICT';
    end if;
    insert into public.sale_events (
      tenant_id, sale_id, event_type, sale_version, actor_id, payload
    ) values (
      v_tenant_id, p_sale_id, 'sale_draft_updated', v_new_version, v_actor_id,
      jsonb_build_object(
        'version', v_new_version,
        'line_count', jsonb_array_length(p_lines),
        'total_amount', (v_result ->> 'total_amount')::numeric,
        'inventory_intent_changed', true
      )
    );
    v_result := v_result || jsonb_build_object('version', v_new_version, 'changed', true);
  end if;

  v_result := v_result || jsonb_build_object(
    'inventory_intent_count', jsonb_array_length(v_normalized_intents),
    'idempotent_replay', false
  );
  update public.sales_command_requests request
  set result = v_result, completed_at = now()
  where request.id = v_command_id and request.tenant_id = v_tenant_id;
  return v_result;
end
$$;

create or replace function public.get_sale(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_sale record;
  v_inventory jsonb;
  v_financial jsonb;
begin
  if v_tenant_id is null or public.current_tenant_user_id() is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.view', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_VIEW_DENIED';
  end if;
  select sale.*, branch.name branch_name, customer.name customer_name,
    coalesce(nullif(customer.mobile, ''), nullif(customer.phone1, ''), nullif(customer.phone2, '')) customer_phone,
    creator.full_name created_by_name, confirmer.full_name confirmed_by_name,
    canceller.full_name cancelled_by_name
  into v_sale
  from public.sales sale
  join public.branches branch on branch.id = sale.branch_id and branch.tenant_id = sale.tenant_id
  join public.partners customer on customer.id = sale.customer_id and customer.tenant_id = sale.tenant_id
  join public.tenant_users creator on creator.id = sale.created_by and creator.tenant_id = sale.tenant_id
  left join public.tenant_users confirmer on confirmer.id = sale.confirmed_by and confirmer.tenant_id = sale.tenant_id
  left join public.tenant_users canceller on canceller.id = sale.cancelled_by and canceller.tenant_id = sale.tenant_id
  where sale.id = p_sale_id and sale.tenant_id = v_tenant_id;
  if not found or not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '23514', message = 'SALE_NOT_FOUND';
  end if;

  select jsonb_build_object(
    'state', case when link.inventory_reservation_id is null then 'not_required' else reservation.state end,
    'location', case when location.id is null then null else jsonb_build_object('id', location.id, 'name', location.name) end,
    'selection_count', (select count(*) from public.sale_inventory_selections selection
      where selection.sale_id = v_sale.id and selection.tenant_id = v_tenant_id),
    'reserved_quantity', coalesce((select sum(line.reserved_quantity - line.released_quantity - line.delivered_quantity)
      from public.inventory_reservation_lines line
      where line.reservation_id = link.inventory_reservation_id and line.tenant_id = v_tenant_id), 0)
  ) into v_inventory
  from public.sale_confirmation_links link
  left join public.inventory_reservations reservation
    on reservation.id = link.inventory_reservation_id and reservation.tenant_id = link.tenant_id
  left join public.stock_locations location
    on location.id = reservation.location_id and location.tenant_id = reservation.tenant_id
  where link.sale_id = v_sale.id and link.tenant_id = v_tenant_id;
  if v_inventory is null then
    v_inventory := jsonb_build_object('state', 'not_reserved', 'location', null, 'selection_count', 0, 'reserved_quantity', 0);
  end if;

  select jsonb_build_object(
    'state', posting.state,
    'original_amount', posting.amount,
    'current_receivable', receivable.amount_residual,
    'currency_code', posting.currency_code,
    'posting_date', posting.posting_date
  ) into v_financial
  from public.sale_confirmation_links link
  join public.financial_sale_postings posting
    on posting.id = link.financial_sale_posting_id and posting.tenant_id = link.tenant_id
  join public.account_move_lines receivable
    on receivable.id = posting.receivable_line_id and receivable.tenant_id = posting.tenant_id
  where link.sale_id = v_sale.id and link.tenant_id = v_tenant_id;
  if v_financial is null then
    v_financial := jsonb_build_object('state', 'not_posted');
  end if;

  return jsonb_build_object(
    'id', v_sale.id, 'sale_number', v_sale.sale_number,
    'branch', jsonb_build_object('id', v_sale.branch_id, 'name', v_sale.branch_name),
    'customer', jsonb_build_object('id', v_sale.customer_id, 'name', v_sale.customer_name, 'phone', v_sale.customer_phone),
    'effective_sale_date', v_sale.effective_sale_date,
    'currency_code', v_sale.currency_code, 'status', v_sale.status,
    'total_amount', v_sale.total_amount, 'notes', v_sale.notes,
    'version', v_sale.version, 'created_at', v_sale.created_at, 'updated_at', v_sale.updated_at,
    'created_by', jsonb_build_object('id', v_sale.created_by, 'name', v_sale.created_by_name),
    'confirmed_at', v_sale.confirmed_at, 'confirmed_by_name', v_sale.confirmed_by_name,
    'cancelled_at', v_sale.cancelled_at, 'cancelled_by_name', v_sale.cancelled_by_name,
    'inventory', v_inventory,
    'financial', v_financial,
    'draft_inventory_location_id', (
      select intent.location_id
      from public.sale_draft_inventory_intents intent
      where intent.sale_id = v_sale.id and intent.tenant_id = v_tenant_id
      order by intent.created_at, intent.id limit 1
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', line.id,
        'position', line.line_position,
        'product', jsonb_build_object(
          'id', product.id,
          'name', product.display_name,
          'sku', product.sku,
          'barcode', product.barcode,
          'tracking', product.tracking,
          'product_type', template.product_type,
          'sale_price', product.sale_price
        ),
        'product_id', line.product_id,
        'product_name', product.display_name,
        'description', line.description,
        'quantity', line.quantity,
        'unit_price', line.unit_price,
        'line_total', line.line_total,
        'tracking_requirement', line.tracking_requirement,
        'draft_inventory_intents', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', intent.id,
            'location_id', intent.location_id,
            'tracking_unit_id', intent.tracking_unit_id,
            'quantity', intent.quantity,
            'tracking_number', tracking_unit.tracking_number
          ) order by intent.tracking_unit_id nulls first, intent.id)
          from public.sale_draft_inventory_intents intent
          left join public.stock_tracking_units tracking_unit
            on tracking_unit.id = intent.tracking_unit_id and tracking_unit.tenant_id = intent.tenant_id
          where intent.sale_line_id = line.id and intent.tenant_id = v_tenant_id
        ), '[]'::jsonb)
      ) order by line.line_position)
      from public.sale_lines line
      join public.product_products product
        on product.id = line.product_id and product.tenant_id = line.tenant_id
      join public.product_templates template
        on template.id = product.product_template_id and template.tenant_id = product.tenant_id
      where line.sale_id = v_sale.id and line.tenant_id = v_tenant_id
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.get_sale_draft_options() from public, anon, service_role;
revoke all on function public.search_sale_customers(text, integer, integer) from public, anon, service_role;
revoke all on function public.search_sale_products(text, integer, integer) from public, anon, service_role;
revoke all on function public.get_sale_quantity_availability(uuid, uuid, uuid, numeric) from public, anon, service_role;
revoke all on function public.search_sale_tracking_units(uuid, uuid, uuid, text, integer, integer) from public, anon, service_role;
revoke all on function public.update_sale_draft(uuid, bigint, uuid, uuid, date, text, text, jsonb, text, jsonb) from public, anon, service_role;
grant execute on function public.get_sale_draft_options() to authenticated;
grant execute on function public.search_sale_customers(text, integer, integer) to authenticated;
grant execute on function public.search_sale_products(text, integer, integer) to authenticated;
grant execute on function public.get_sale_quantity_availability(uuid, uuid, uuid, numeric) to authenticated;
grant execute on function public.search_sale_tracking_units(uuid, uuid, uuid, text, integer, integer) to authenticated;
grant execute on function public.update_sale_draft(uuid, bigint, uuid, uuid, date, text, text, jsonb, text, jsonb) to authenticated;

comment on table public.sale_draft_inventory_intents is
  'Non-reserving stock selection intent for a Canonical Sale draft; confirmation remains authoritative.';
comment on function public.get_sale_draft_options() is
  'Business-safe accessible branch/location choices and valid operational defaults for the Sales draft editor.';
comment on function public.search_sale_customers(text, integer, integer) is
  'Paginated active-customer lookup for Canonical Sales draft entry.';
comment on function public.search_sale_products(text, integer, integer) is
  'Paginated sellable product lookup with canonical default sale price and supported tracking behavior.';
comment on function public.get_sale_quantity_availability(uuid, uuid, uuid, numeric) is
  'Read-only quantity availability hint for a Sales draft; confirmation rechecks availability.';
comment on function public.search_sale_tracking_units(uuid, uuid, uuid, text, integer, integer) is
  'Paginated available serial lookup for a Sales draft without creating a reservation.';
comment on function public.update_sale_draft(uuid, bigint, uuid, uuid, date, text, text, jsonb, text, jsonb) is
  'Atomic idempotent draft replacement including non-reserving Inventory selection intent.';

notify pgrst, 'reload schema';

commit;
