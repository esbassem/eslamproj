begin;

-- Minimum Canonical Inventory Core. This is intentionally parallel to the
-- legacy inventory write path; existing Showroom/POS behavior is not changed.

insert into public.auth_permissions (code, name, description, resource, action, active)
values
  ('inventory.availability', 'عرض الإتاحة الفعلية', 'قراءة إتاحة المخزون Canonically ضمن نطاق الفرع والموقع.', 'inventory', 'availability', true),
  ('inventory.reserve', 'حجز المخزون', 'إنشاء حجز مخزون Canonical.', 'inventory', 'reserve', true),
  ('inventory.release', 'تحرير حجز المخزون', 'تحرير الكمية غير المسلمة من حجز Canonical.', 'inventory', 'release', true),
  ('inventory.deliver', 'تسليم المخزون', 'تسجيل الخروج الفيزيائي من حجز Canonical.', 'inventory', 'deliver', true),
  ('inventory.return', 'استلام مرتجع المخزون', 'تسجيل الاستلام الفيزيائي لمرتجع Canonical.', 'inventory', 'return', true)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  resource = excluded.resource,
  action = excluded.action,
  active = true,
  updated_at = now();

with mappings(group_code, permission_code) as (
  values
    ('products_user', 'inventory.availability'),
    ('inventory_user', 'inventory.availability'),
    ('inventory_user', 'inventory.reserve'),
    ('inventory_user', 'inventory.release'),
    ('inventory_user', 'inventory.deliver'),
    ('inventory_user', 'inventory.return')
)
insert into public.auth_group_permissions (group_id, permission_id)
select permission_group.id, permission.id
from mappings
join public.res_groups permission_group
  on permission_group.code = mappings.group_code
 and permission_group.active = true
join public.auth_permissions permission
  on permission.code = mappings.permission_code
on conflict (group_id, permission_id) do nothing;

create unique index if not exists product_products_id_tenant_unique
  on public.product_products (id, tenant_id);
create unique index if not exists stock_tracking_units_id_tenant_unique
  on public.stock_tracking_units (id, tenant_id);
create unique index if not exists stock_moves_id_tenant_unique
  on public.stock_moves (id, tenant_id);

create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null,
  location_id uuid not null,
  source_type text not null,
  source_id text not null,
  state text not null default 'active',
  idempotency_key text not null,
  request_fingerprint text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  released_at timestamptz,
  completed_at timestamptz,
  constraint inventory_reservations_branch_fkey
    foreign key (branch_id, tenant_id)
    references public.branches(id, tenant_id) on delete restrict,
  constraint inventory_reservations_location_fkey
    foreign key (location_id, tenant_id, branch_id)
    references public.stock_locations(id, tenant_id, branch_id) on delete restrict,
  constraint inventory_reservations_created_by_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint inventory_reservations_source_type_check
    check (source_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  constraint inventory_reservations_source_id_check
    check (length(btrim(source_id)) between 1 and 200),
  constraint inventory_reservations_state_check
    check (state in ('active', 'partially_delivered', 'delivered', 'released', 'closed')),
  constraint inventory_reservations_idempotency_key_check
    check (length(btrim(idempotency_key)) between 1 and 200),
  constraint inventory_reservations_tenant_source_unique
    unique (tenant_id, source_type, source_id),
  constraint inventory_reservations_tenant_idempotency_unique
    unique (tenant_id, idempotency_key),
  constraint inventory_reservations_id_tenant_unique unique (id, tenant_id)
);

create table public.inventory_reservation_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  reservation_id uuid not null,
  product_id uuid not null,
  tracking_unit_id uuid,
  quantity numeric not null,
  reserved_quantity numeric not null,
  released_quantity numeric not null default 0,
  delivered_quantity numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_reservation_lines_reservation_fkey
    foreign key (reservation_id, tenant_id)
    references public.inventory_reservations(id, tenant_id) on delete restrict,
  constraint inventory_reservation_lines_product_fkey
    foreign key (product_id, tenant_id)
    references public.product_products(id, tenant_id) on delete restrict,
  constraint inventory_reservation_lines_tracking_fkey
    foreign key (tracking_unit_id, tenant_id)
    references public.stock_tracking_units(id, tenant_id) on delete restrict,
  constraint inventory_reservation_lines_quantities_check check (
    quantity > 0
    and reserved_quantity > 0
    and reserved_quantity <= quantity
    and released_quantity >= 0
    and delivered_quantity >= 0
    and released_quantity + delivered_quantity <= reserved_quantity
  ),
  constraint inventory_reservation_lines_tracking_quantity_check
    check (tracking_unit_id is null or (quantity = 1 and reserved_quantity = 1)),
  constraint inventory_reservation_lines_id_tenant_unique unique (id, tenant_id),
  constraint inventory_reservation_lines_reservation_tracking_unique
    unique nulls not distinct (reservation_id, product_id, tracking_unit_id)
);

create table public.inventory_tracking_unit_states (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  tracking_unit_id uuid not null,
  state text not null,
  current_location_id uuid,
  version bigint not null default 1,
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, tracking_unit_id),
  constraint inventory_tracking_states_unit_fkey
    foreign key (tracking_unit_id, tenant_id)
    references public.stock_tracking_units(id, tenant_id) on delete restrict,
  constraint inventory_tracking_states_location_fkey
    foreign key (current_location_id, tenant_id)
    references public.stock_locations(id, tenant_id) on delete restrict,
  constraint inventory_tracking_states_actor_fkey
    foreign key (updated_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint inventory_tracking_states_state_check
    check (state in ('available', 'reserved', 'issued', 'blocked')),
  constraint inventory_tracking_states_location_check
    check ((state in ('available', 'reserved') and current_location_id is not null)
      or (state in ('issued', 'blocked')))
);

create table public.inventory_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  reservation_id uuid not null,
  branch_id uuid not null,
  source_location_id uuid not null,
  source_type text not null,
  source_id text not null,
  state text not null default 'committed',
  idempotency_key text not null,
  request_fingerprint text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_deliveries_reservation_fkey
    foreign key (reservation_id, tenant_id)
    references public.inventory_reservations(id, tenant_id) on delete restrict,
  constraint inventory_deliveries_branch_fkey
    foreign key (branch_id, tenant_id)
    references public.branches(id, tenant_id) on delete restrict,
  constraint inventory_deliveries_location_fkey
    foreign key (source_location_id, tenant_id, branch_id)
    references public.stock_locations(id, tenant_id, branch_id) on delete restrict,
  constraint inventory_deliveries_actor_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint inventory_deliveries_state_check
    check (state in ('committed', 'partially_returned', 'returned')),
  constraint inventory_deliveries_idempotency_key_check
    check (length(btrim(idempotency_key)) between 1 and 200),
  constraint inventory_deliveries_tenant_idempotency_unique
    unique (tenant_id, idempotency_key),
  constraint inventory_deliveries_id_tenant_unique unique (id, tenant_id)
);

create table public.inventory_delivery_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  delivery_id uuid not null,
  reservation_line_id uuid not null,
  product_id uuid not null,
  tracking_unit_id uuid,
  quantity numeric not null check (quantity > 0),
  stock_move_id uuid not null,
  created_at timestamptz not null default now(),
  constraint inventory_delivery_lines_delivery_fkey
    foreign key (delivery_id, tenant_id)
    references public.inventory_deliveries(id, tenant_id) on delete restrict,
  constraint inventory_delivery_lines_reservation_line_fkey
    foreign key (reservation_line_id, tenant_id)
    references public.inventory_reservation_lines(id, tenant_id) on delete restrict,
  constraint inventory_delivery_lines_product_fkey
    foreign key (product_id, tenant_id)
    references public.product_products(id, tenant_id) on delete restrict,
  constraint inventory_delivery_lines_tracking_fkey
    foreign key (tracking_unit_id, tenant_id)
    references public.stock_tracking_units(id, tenant_id) on delete restrict,
  constraint inventory_delivery_lines_move_fkey
    foreign key (stock_move_id, tenant_id)
    references public.stock_moves(id, tenant_id) on delete restrict,
  constraint inventory_delivery_lines_tracking_quantity_check
    check (tracking_unit_id is null or quantity = 1),
  constraint inventory_delivery_lines_delivery_reservation_line_unique
    unique (delivery_id, reservation_line_id),
  constraint inventory_delivery_lines_id_tenant_unique unique (id, tenant_id)
);

create table public.inventory_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  delivery_id uuid not null,
  branch_id uuid not null,
  destination_location_id uuid not null,
  source_type text not null,
  source_id text not null,
  state text not null default 'received',
  idempotency_key text not null,
  request_fingerprint text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint inventory_returns_delivery_fkey
    foreign key (delivery_id, tenant_id)
    references public.inventory_deliveries(id, tenant_id) on delete restrict,
  constraint inventory_returns_branch_fkey
    foreign key (branch_id, tenant_id)
    references public.branches(id, tenant_id) on delete restrict,
  constraint inventory_returns_location_fkey
    foreign key (destination_location_id, tenant_id, branch_id)
    references public.stock_locations(id, tenant_id, branch_id) on delete restrict,
  constraint inventory_returns_actor_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint inventory_returns_source_type_check
    check (source_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  constraint inventory_returns_source_id_check
    check (length(btrim(source_id)) between 1 and 200),
  constraint inventory_returns_state_check check (state = 'received'),
  constraint inventory_returns_idempotency_key_check
    check (length(btrim(idempotency_key)) between 1 and 200),
  constraint inventory_returns_tenant_source_unique
    unique (tenant_id, source_type, source_id),
  constraint inventory_returns_tenant_idempotency_unique
    unique (tenant_id, idempotency_key),
  constraint inventory_returns_id_tenant_unique unique (id, tenant_id)
);

create table public.inventory_return_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  return_id uuid not null,
  delivery_line_id uuid not null,
  product_id uuid not null,
  tracking_unit_id uuid,
  quantity numeric not null check (quantity > 0),
  stock_move_id uuid not null,
  created_at timestamptz not null default now(),
  constraint inventory_return_lines_return_fkey
    foreign key (return_id, tenant_id)
    references public.inventory_returns(id, tenant_id) on delete restrict,
  constraint inventory_return_lines_delivery_line_fkey
    foreign key (delivery_line_id, tenant_id)
    references public.inventory_delivery_lines(id, tenant_id) on delete restrict,
  constraint inventory_return_lines_product_fkey
    foreign key (product_id, tenant_id)
    references public.product_products(id, tenant_id) on delete restrict,
  constraint inventory_return_lines_tracking_fkey
    foreign key (tracking_unit_id, tenant_id)
    references public.stock_tracking_units(id, tenant_id) on delete restrict,
  constraint inventory_return_lines_move_fkey
    foreign key (stock_move_id, tenant_id)
    references public.stock_moves(id, tenant_id) on delete restrict,
  constraint inventory_return_lines_tracking_quantity_check
    check (tracking_unit_id is null or quantity = 1),
  constraint inventory_return_lines_return_delivery_line_unique
    unique (return_id, delivery_line_id)
);

create table public.inventory_command_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  command_type text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  result jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint inventory_command_requests_actor_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint inventory_command_requests_type_check
    check (command_type in ('reserve', 'release', 'deliver', 'return')),
  constraint inventory_command_requests_key_check
    check (length(btrim(idempotency_key)) between 1 and 200),
  constraint inventory_command_requests_unique
    unique (tenant_id, command_type, idempotency_key)
);

create table public.inventory_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  event_type text not null,
  reservation_id uuid,
  delivery_id uuid,
  return_id uuid,
  source_type text not null,
  source_id text not null,
  product_id uuid not null,
  tracking_unit_id uuid,
  quantity numeric not null check (quantity > 0),
  from_location_id uuid,
  to_location_id uuid,
  created_by uuid not null,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  constraint inventory_events_type_check
    check (event_type in ('reserved', 'reservation_released', 'delivered', 'returned')),
  constraint inventory_events_reservation_fkey
    foreign key (reservation_id, tenant_id)
    references public.inventory_reservations(id, tenant_id) on delete restrict,
  constraint inventory_events_delivery_fkey
    foreign key (delivery_id, tenant_id)
    references public.inventory_deliveries(id, tenant_id) on delete restrict,
  constraint inventory_events_return_fkey
    foreign key (return_id, tenant_id)
    references public.inventory_returns(id, tenant_id) on delete restrict,
  constraint inventory_events_product_fkey
    foreign key (product_id, tenant_id)
    references public.product_products(id, tenant_id) on delete restrict,
  constraint inventory_events_tracking_fkey
    foreign key (tracking_unit_id, tenant_id)
    references public.stock_tracking_units(id, tenant_id) on delete restrict,
  constraint inventory_events_from_location_fkey
    foreign key (from_location_id, tenant_id)
    references public.stock_locations(id, tenant_id) on delete restrict,
  constraint inventory_events_to_location_fkey
    foreign key (to_location_id, tenant_id)
    references public.stock_locations(id, tenant_id) on delete restrict,
  constraint inventory_events_actor_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict
);

create index inventory_reservations_scope_idx
  on public.inventory_reservations (tenant_id, branch_id, location_id, state);
create index inventory_reservation_lines_active_idx
  on public.inventory_reservation_lines (tenant_id, product_id, reservation_id);
create index inventory_reservation_lines_tracking_idx
  on public.inventory_reservation_lines (tenant_id, tracking_unit_id)
  where tracking_unit_id is not null;
create index inventory_deliveries_reservation_idx
  on public.inventory_deliveries (tenant_id, reservation_id, created_at);
create index inventory_delivery_lines_reservation_line_idx
  on public.inventory_delivery_lines (tenant_id, reservation_line_id);
create index inventory_return_lines_delivery_line_idx
  on public.inventory_return_lines (tenant_id, delivery_line_id);
create index inventory_events_source_idx
  on public.inventory_events (tenant_id, source_type, source_id, occurred_at, id);
create index inventory_events_reservation_idx
  on public.inventory_events (tenant_id, reservation_id, occurred_at, id);

create or replace function public.guard_inventory_event_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = '42501', message = 'INVENTORY_EVENT_IMMUTABLE';
end
$$;

create trigger inventory_events_immutable
before update or delete on public.inventory_events
for each row execute function public.guard_inventory_event_immutability();

create or replace function public.guard_canonical_inventory_stock_move()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_reference_type text := case when tg_op = 'DELETE' then old.reference_type else new.reference_type end;
begin
  if v_reference_type in ('canonical_inventory_delivery', 'canonical_inventory_return')
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'CANONICAL_INVENTORY_MOVE_WRITE_DENIED';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger canonical_inventory_stock_move_guard
before insert or update or delete on public.stock_moves
for each row execute function public.guard_canonical_inventory_stock_move();

create or replace function public.inventory_request_fingerprint(p_payload jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select encode(extensions.digest(coalesce(p_payload, '{}'::jsonb)::text, 'sha256'), 'hex')
$$;

create or replace function public.get_inventory_availability(
  p_branch_id uuid,
  p_product_id uuid,
  p_quantity numeric default 1,
  p_location_id uuid default null,
  p_tracking_unit_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_product record;
  v_available numeric := 0;
  v_locations jsonb := '[]'::jsonb;
  v_units jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
begin
  if v_tenant_id is null
     or not (public.has_permission('inventory.availability', v_tenant_id)
       or public.has_permission('inventory.read', v_tenant_id)) then
    raise exception using errcode = '42501', message = 'INVENTORY_AVAILABILITY_DENIED';
  end if;
  if p_branch_id is null or not public.has_branch_access(p_branch_id) then
    raise exception using errcode = '42501', message = 'INVENTORY_BRANCH_ACCESS_DENIED';
  end if;
  if p_location_id is not null and (
    not public.has_stock_location_access(p_location_id)
    or not exists (
      select 1 from public.stock_locations l
      where l.id = p_location_id and l.tenant_id = v_tenant_id
        and l.branch_id = p_branch_id and l.is_active
    )
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_LOCATION_ACCESS_DENIED';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '23514', message = 'INVENTORY_QUANTITY_INVALID';
  end if;

  select pp.id, pp.tracking, pp.is_active product_active,
    pt.is_active template_active, pt.can_be_sold, pt.product_type
  into v_product
  from public.product_products pp
  join public.product_templates pt
    on pt.id = pp.product_template_id and pt.tenant_id = pp.tenant_id
  where pp.id = p_product_id and pp.tenant_id = v_tenant_id;

  if not found then
    v_blockers := v_blockers || '"PRODUCT_NOT_FOUND"'::jsonb;
  elsif not v_product.product_active or not v_product.template_active
        or not v_product.can_be_sold or v_product.product_type <> 'goods' then
    v_blockers := v_blockers || '"PRODUCT_NOT_SELLABLE"'::jsonb;
  elsif v_product.tracking = 'lot' then
    v_blockers := v_blockers || '"LOT_TRACKING_NOT_SUPPORTED"'::jsonb;
  elsif v_product.tracking = 'serial' then
    if p_quantity <> trunc(p_quantity) then
      v_blockers := v_blockers || '"SERIAL_QUANTITY_MUST_BE_WHOLE"'::jsonb;
    end if;
    select count(*)::numeric,
      coalesce(jsonb_agg(jsonb_build_object(
        'tracking_unit_id', candidate.id,
        'tracking_number', candidate.tracking_number,
        'location_id', candidate.current_location_id
      ) order by candidate.tracking_number, candidate.id), '[]'::jsonb)
    into v_available, v_units
    from (
      select unit.id, unit.tracking_number, unit.current_location_id
      from public.stock_tracking_units unit
      join public.stock_locations location
        on location.id = unit.current_location_id
       and location.tenant_id = unit.tenant_id
       and location.branch_id = p_branch_id
       and location.is_active
      left join public.inventory_tracking_unit_states canonical_state
        on canonical_state.tenant_id = unit.tenant_id
       and canonical_state.tracking_unit_id = unit.id
      where unit.tenant_id = v_tenant_id
        and unit.product_product_id = p_product_id
        and unit.tracking_type = 'serial'
        and unit.tracking_number is not null
        and btrim(unit.tracking_number) <> ''
        and unit.data_status = 'complete'
        and unit.status in ('in_stock', 'returned')
        and coalesce(canonical_state.state, 'available') = 'available'
        and (p_location_id is null or unit.current_location_id = p_location_id)
        and (p_tracking_unit_id is null or unit.id = p_tracking_unit_id)
        and public.has_stock_location_access(unit.current_location_id)
        and not exists (
          select 1
          from public.inventory_reservation_lines line
          join public.inventory_reservations reservation
            on reservation.id = line.reservation_id
           and reservation.tenant_id = line.tenant_id
          where line.tenant_id = unit.tenant_id
            and line.tracking_unit_id = unit.id
            and line.reserved_quantity > line.released_quantity + line.delivered_quantity
            and reservation.state in ('active', 'partially_delivered')
        )
      order by unit.tracking_number, unit.id
    ) candidate;
  elsif v_product.tracking = 'none' then
    if p_tracking_unit_id is not null then
      v_blockers := v_blockers || '"TRACKING_UNIT_NOT_ALLOWED"'::jsonb;
    end if;
    select coalesce(sum(location_available), 0),
      coalesce(jsonb_agg(jsonb_build_object(
        'location_id', location_id,
        'available_quantity', location_available
      ) order by location_id), '[]'::jsonb)
    into v_available, v_locations
    from (
      select q.location_id,
        greatest(q.quantity_on_hand - q.reserved_quantity - coalesce((
          select sum(line.reserved_quantity - line.released_quantity - line.delivered_quantity)
          from public.inventory_reservation_lines line
          join public.inventory_reservations reservation
            on reservation.id = line.reservation_id
           and reservation.tenant_id = line.tenant_id
          where line.tenant_id = q.tenant_id
            and line.product_id = q.product_product_id
            and line.tracking_unit_id is null
            and reservation.location_id = q.location_id
            and reservation.state in ('active', 'partially_delivered')
        ), 0), 0) location_available
      from public.stock_quants q
      join public.stock_locations location
        on location.id = q.location_id
       and location.tenant_id = q.tenant_id
       and location.branch_id = p_branch_id
       and location.is_active
      where q.tenant_id = v_tenant_id
        and q.product_product_id = p_product_id
        and (p_location_id is null or q.location_id = p_location_id)
        and public.has_stock_location_access(q.location_id)
    ) availability_by_location;
  end if;

  if v_available < p_quantity then
    v_blockers := v_blockers || '"INSUFFICIENT_INVENTORY"'::jsonb;
  end if;
  return jsonb_build_object(
    'branch_id', p_branch_id,
    'product_id', p_product_id,
    'location_id', p_location_id,
    'tracking', coalesce(v_product.tracking, 'unknown'),
    'requested_quantity', p_quantity,
    'available_quantity', greatest(v_available, 0),
    'is_available', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'locations', v_locations,
    'tracking_units', v_units
  );
end
$$;

create or replace function public.reserve_inventory(
  p_branch_id uuid,
  p_location_id uuid,
  p_source_type text,
  p_source_id text,
  p_lines jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id uuid := public.current_tenant_user_id();
  v_fingerprint text;
  v_command record;
  v_claimed integer := 0;
  v_reservation_id uuid := gen_random_uuid();
  v_item jsonb;
  v_product record;
  v_unit record;
  v_quant record;
  v_product_id uuid;
  v_tracking_unit_id uuid;
  v_quantity numeric;
  v_active_reserved numeric;
  v_line_id uuid;
  v_result jsonb;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('inventory.reserve', v_tenant_id) then
    raise exception using errcode = '42501', message = 'INVENTORY_RESERVE_DENIED';
  end if;
  if not public.has_branch_access(p_branch_id) then
    raise exception using errcode = '42501', message = 'INVENTORY_BRANCH_ACCESS_DENIED';
  end if;
  if not public.has_stock_location_access(p_location_id)
     or not exists (
       select 1 from public.stock_locations location
       where location.id = p_location_id and location.tenant_id = v_tenant_id
         and location.branch_id = p_branch_id and location.is_active
     ) then
    raise exception using errcode = '42501', message = 'INVENTORY_LOCATION_ACCESS_DENIED';
  end if;
  if p_source_type is null or p_source_type !~ '^[a-z][a-z0-9_]{1,62}$'
     or p_source_id is null or length(btrim(p_source_id)) not between 1 and 200 then
    raise exception using errcode = '23514', message = 'INVENTORY_SOURCE_INVALID';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception using errcode = '23514', message = 'INVENTORY_IDEMPOTENCY_KEY_INVALID';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0
     or jsonb_array_length(p_lines) > 100 then
    raise exception using errcode = '23514', message = 'INVENTORY_RESERVATION_LINES_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) item
    group by item ->> 'product_id', coalesce(item ->> 'tracking_unit_id', '')
    having count(*) > 1
  ) then
    raise exception using errcode = '23514', message = 'INVENTORY_RESERVATION_LINES_DUPLICATE';
  end if;

  v_fingerprint := public.inventory_request_fingerprint(jsonb_build_object(
    'branch_id', p_branch_id, 'location_id', p_location_id,
    'source_type', p_source_type, 'source_id', p_source_id, 'lines', p_lines
  ));
  insert into public.inventory_command_requests (
    tenant_id, command_type, idempotency_key, request_fingerprint, created_by
  ) values (
    v_tenant_id, 'reserve', p_idempotency_key, v_fingerprint, v_actor_id
  ) on conflict (tenant_id, command_type, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    select * into v_command
    from public.inventory_command_requests command_request
    where command_request.tenant_id = v_tenant_id
      and command_request.command_type = 'reserve'
      and command_request.idempotency_key = p_idempotency_key
    for update;
    if v_command.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23514', message = 'INVENTORY_IDEMPOTENCY_CONFLICT';
    end if;
    if v_command.result is null then
      raise exception using errcode = '40001', message = 'INVENTORY_IDEMPOTENCY_IN_PROGRESS';
    end if;
    return v_command.result;
  end if;

  insert into public.inventory_reservations (
    id, tenant_id, branch_id, location_id, source_type, source_id,
    idempotency_key, request_fingerprint, created_by
  ) values (
    v_reservation_id, v_tenant_id, p_branch_id, p_location_id,
    p_source_type, btrim(p_source_id), p_idempotency_key, v_fingerprint, v_actor_id
  );

  for v_item in
    select item.value
    from jsonb_array_elements(p_lines) item
    order by item.value ->> 'product_id', coalesce(item.value ->> 'tracking_unit_id', '')
  loop
    begin
      v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
      v_tracking_unit_id := nullif(v_item ->> 'tracking_unit_id', '')::uuid;
      v_quantity := (v_item ->> 'quantity')::numeric;
    exception when others then
      raise exception using errcode = '23514', message = 'INVENTORY_RESERVATION_LINE_INVALID';
    end;
    if v_product_id is null or v_quantity is null or v_quantity <= 0 then
      raise exception using errcode = '23514', message = 'INVENTORY_RESERVATION_LINE_INVALID';
    end if;

    select pp.id, pp.tracking, pp.is_active product_active,
      pp.product_template_id, pt.is_active template_active,
      pt.can_be_sold, pt.product_type
    into v_product
    from public.product_products pp
    join public.product_templates pt
      on pt.id = pp.product_template_id and pt.tenant_id = pp.tenant_id
    where pp.id = v_product_id and pp.tenant_id = v_tenant_id;
    if not found then
      raise exception using errcode = '23514', message = 'INVENTORY_PRODUCT_NOT_FOUND';
    end if;
    if not v_product.product_active or not v_product.template_active
       or not v_product.can_be_sold or v_product.product_type <> 'goods' then
      raise exception using errcode = '23514', message = 'INVENTORY_PRODUCT_NOT_SELLABLE';
    end if;
    if v_product.tracking = 'lot' then
      raise exception using errcode = '23514', message = 'INVENTORY_LOT_TRACKING_NOT_SUPPORTED';
    elsif v_product.tracking = 'serial' then
      if v_tracking_unit_id is null or v_quantity <> 1 then
        raise exception using errcode = '23514', message = 'INVENTORY_SERIAL_LINE_INVALID';
      end if;
      select unit.* into v_unit
      from public.stock_tracking_units unit
      where unit.id = v_tracking_unit_id
      for update;
      if not found or v_unit.tenant_id <> v_tenant_id
         or v_unit.product_product_id <> v_product_id
         or v_unit.tracking_type <> 'serial'
         or v_unit.tracking_number is null or btrim(v_unit.tracking_number) = ''
         or v_unit.data_status <> 'complete'
         or v_unit.status not in ('in_stock', 'returned')
         or v_unit.current_location_id <> p_location_id then
        raise exception using errcode = '23514', message = 'INVENTORY_TRACKING_UNIT_UNAVAILABLE';
      end if;
      if exists (
        select 1 from public.inventory_tracking_unit_states canonical_state
        where canonical_state.tenant_id = v_tenant_id
          and canonical_state.tracking_unit_id = v_tracking_unit_id
          and canonical_state.state <> 'available'
      ) or exists (
        select 1
        from public.inventory_reservation_lines line
        join public.inventory_reservations reservation
          on reservation.id = line.reservation_id and reservation.tenant_id = line.tenant_id
        where line.tenant_id = v_tenant_id
          and line.tracking_unit_id = v_tracking_unit_id
          and line.reserved_quantity > line.released_quantity + line.delivered_quantity
          and reservation.state in ('active', 'partially_delivered')
      ) then
        raise exception using errcode = '23514', message = 'INVENTORY_TRACKING_UNIT_ALREADY_RESERVED';
      end if;
      insert into public.inventory_tracking_unit_states (
        tenant_id, tracking_unit_id, state, current_location_id, updated_by
      ) values (
        v_tenant_id, v_tracking_unit_id, 'reserved', p_location_id, v_actor_id
      ) on conflict (tenant_id, tracking_unit_id) do update set
        state = 'reserved', current_location_id = excluded.current_location_id,
        version = public.inventory_tracking_unit_states.version + 1,
        updated_by = excluded.updated_by, updated_at = now();
      update public.stock_tracking_units
      set status = 'reserved', updated_at = now()
      where id = v_tracking_unit_id and tenant_id = v_tenant_id;
    else
      if v_tracking_unit_id is not null then
        raise exception using errcode = '23514', message = 'INVENTORY_TRACKING_UNIT_NOT_ALLOWED';
      end if;
      select q.* into v_quant
      from public.stock_quants q
      where q.tenant_id = v_tenant_id and q.location_id = p_location_id
        and q.product_product_id = v_product_id
      for update;
      if not found then
        raise exception using errcode = '23514', message = 'INVENTORY_QUANT_NOT_FOUND';
      end if;
      select coalesce(sum(line.reserved_quantity - line.released_quantity - line.delivered_quantity), 0)
      into v_active_reserved
      from public.inventory_reservation_lines line
      join public.inventory_reservations reservation
        on reservation.id = line.reservation_id and reservation.tenant_id = line.tenant_id
      where line.tenant_id = v_tenant_id and line.product_id = v_product_id
        and line.tracking_unit_id is null and reservation.location_id = p_location_id
        and reservation.state in ('active', 'partially_delivered');
      if v_quant.quantity_on_hand - v_quant.reserved_quantity - v_active_reserved < v_quantity then
        raise exception using errcode = '23514', message = 'INVENTORY_INSUFFICIENT_QUANTITY';
      end if;
    end if;

    v_line_id := gen_random_uuid();
    insert into public.inventory_reservation_lines (
      id, tenant_id, reservation_id, product_id, tracking_unit_id,
      quantity, reserved_quantity
    ) values (
      v_line_id, v_tenant_id, v_reservation_id, v_product_id,
      v_tracking_unit_id, v_quantity, v_quantity
    );
    insert into public.inventory_events (
      tenant_id, event_type, reservation_id, source_type, source_id,
      product_id, tracking_unit_id, quantity, from_location_id, created_by
    ) values (
      v_tenant_id, 'reserved', v_reservation_id, p_source_type, btrim(p_source_id),
      v_product_id, v_tracking_unit_id, v_quantity, p_location_id, v_actor_id
    );
  end loop;

  v_result := jsonb_build_object(
    'reservation_id', v_reservation_id, 'state', 'active',
    'source_type', p_source_type, 'source_id', btrim(p_source_id),
    'branch_id', p_branch_id, 'location_id', p_location_id,
    'line_count', jsonb_array_length(p_lines)
  );
  update public.inventory_command_requests
  set result = v_result, completed_at = now()
  where tenant_id = v_tenant_id and command_type = 'reserve'
    and idempotency_key = p_idempotency_key;
  return v_result;
end
$$;

create or replace function public.release_inventory_reservation(
  p_reservation_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id uuid := public.current_tenant_user_id();
  v_reservation public.inventory_reservations%rowtype;
  v_line record;
  v_release_quantity numeric;
  v_fingerprint text;
  v_command record;
  v_claimed integer := 0;
  v_result jsonb;
  v_new_state text;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('inventory.release', v_tenant_id) then
    raise exception using errcode = '42501', message = 'INVENTORY_RELEASE_DENIED';
  end if;
  select * into v_reservation
  from public.inventory_reservations reservation
  where reservation.id = p_reservation_id and reservation.tenant_id = v_tenant_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'INVENTORY_RESERVATION_NOT_FOUND';
  end if;
  if not public.has_branch_access(v_reservation.branch_id)
     or not public.has_stock_location_access(v_reservation.location_id) then
    raise exception using errcode = '42501', message = 'INVENTORY_RESERVATION_SCOPE_DENIED';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception using errcode = '23514', message = 'INVENTORY_IDEMPOTENCY_KEY_INVALID';
  end if;
  v_fingerprint := public.inventory_request_fingerprint(jsonb_build_object(
    'reservation_id', p_reservation_id
  ));
  insert into public.inventory_command_requests (
    tenant_id, command_type, idempotency_key, request_fingerprint, created_by
  ) values (v_tenant_id, 'release', p_idempotency_key, v_fingerprint, v_actor_id)
  on conflict (tenant_id, command_type, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    select * into v_command from public.inventory_command_requests command_request
    where command_request.tenant_id = v_tenant_id and command_request.command_type = 'release'
      and command_request.idempotency_key = p_idempotency_key for update;
    if v_command.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23514', message = 'INVENTORY_IDEMPOTENCY_CONFLICT';
    end if;
    return v_command.result;
  end if;
  if v_reservation.state not in ('active', 'partially_delivered') then
    raise exception using errcode = '23514', message = 'INVENTORY_RESERVATION_NOT_RELEASABLE';
  end if;

  for v_line in
    select line.* from public.inventory_reservation_lines line
    where line.tenant_id = v_tenant_id and line.reservation_id = p_reservation_id
    order by line.id for update
  loop
    v_release_quantity := v_line.reserved_quantity - v_line.released_quantity - v_line.delivered_quantity;
    if v_release_quantity > 0 then
      update public.inventory_reservation_lines
      set released_quantity = released_quantity + v_release_quantity, updated_at = now()
      where id = v_line.id;
      if v_line.tracking_unit_id is not null then
        update public.inventory_tracking_unit_states
        set state = 'available', current_location_id = v_reservation.location_id,
          version = version + 1, updated_by = v_actor_id, updated_at = now()
        where tenant_id = v_tenant_id and tracking_unit_id = v_line.tracking_unit_id
          and state = 'reserved';
        if not found then
          raise exception using errcode = '23514', message = 'INVENTORY_TRACKING_STATE_INVALID';
        end if;
        update public.stock_tracking_units
        set status = 'in_stock', current_location_id = v_reservation.location_id, updated_at = now()
        where id = v_line.tracking_unit_id and tenant_id = v_tenant_id and status = 'reserved';
        if not found then
          raise exception using errcode = '23514', message = 'INVENTORY_TRACKING_STATE_INVALID';
        end if;
      end if;
      insert into public.inventory_events (
        tenant_id, event_type, reservation_id, source_type, source_id,
        product_id, tracking_unit_id, quantity, from_location_id, created_by
      ) values (
        v_tenant_id, 'reservation_released', p_reservation_id,
        v_reservation.source_type, v_reservation.source_id,
        v_line.product_id, v_line.tracking_unit_id, v_release_quantity,
        v_reservation.location_id, v_actor_id
      );
    end if;
  end loop;
  if exists (
    select 1 from public.inventory_reservation_lines line
    where line.reservation_id = p_reservation_id and line.delivered_quantity > 0
  ) then v_new_state := 'closed'; else v_new_state := 'released'; end if;
  update public.inventory_reservations
  set state = v_new_state, released_at = now(), completed_at = now(), updated_at = now()
  where id = p_reservation_id;
  v_result := jsonb_build_object('reservation_id', p_reservation_id, 'state', v_new_state);
  update public.inventory_command_requests set result = v_result, completed_at = now()
  where tenant_id = v_tenant_id and command_type = 'release'
    and idempotency_key = p_idempotency_key;
  return v_result;
end
$$;

create or replace function public.commit_inventory_delivery(
  p_reservation_id uuid,
  p_lines jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id uuid := public.current_tenant_user_id();
  v_reservation public.inventory_reservations%rowtype;
  v_item jsonb;
  v_line public.inventory_reservation_lines%rowtype;
  v_product record;
  v_quantity numeric;
  v_remaining numeric;
  v_quant public.stock_quants%rowtype;
  v_active_reserved numeric;
  v_delivery_id uuid := gen_random_uuid();
  v_delivery_line_id uuid;
  v_move_id uuid;
  v_fingerprint text;
  v_command record;
  v_claimed integer := 0;
  v_result jsonb;
  v_new_state text;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('inventory.deliver', v_tenant_id) then
    raise exception using errcode = '42501', message = 'INVENTORY_DELIVERY_DENIED';
  end if;
  select * into v_reservation from public.inventory_reservations reservation
  where reservation.id = p_reservation_id and reservation.tenant_id = v_tenant_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'INVENTORY_RESERVATION_NOT_FOUND';
  end if;
  if not public.has_branch_access(v_reservation.branch_id)
     or not public.has_stock_location_access(v_reservation.location_id) then
    raise exception using errcode = '42501', message = 'INVENTORY_RESERVATION_SCOPE_DENIED';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0
     or jsonb_array_length(p_lines) > 100 then
    raise exception using errcode = '23514', message = 'INVENTORY_DELIVERY_LINES_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) item
    group by item ->> 'reservation_line_id' having count(*) > 1
  ) then
    raise exception using errcode = '23514', message = 'INVENTORY_DELIVERY_LINES_DUPLICATE';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception using errcode = '23514', message = 'INVENTORY_IDEMPOTENCY_KEY_INVALID';
  end if;
  v_fingerprint := public.inventory_request_fingerprint(jsonb_build_object(
    'reservation_id', p_reservation_id, 'lines', p_lines
  ));
  insert into public.inventory_command_requests (
    tenant_id, command_type, idempotency_key, request_fingerprint, created_by
  ) values (v_tenant_id, 'deliver', p_idempotency_key, v_fingerprint, v_actor_id)
  on conflict (tenant_id, command_type, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    select * into v_command from public.inventory_command_requests command_request
    where command_request.tenant_id = v_tenant_id and command_request.command_type = 'deliver'
      and command_request.idempotency_key = p_idempotency_key for update;
    if v_command.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23514', message = 'INVENTORY_IDEMPOTENCY_CONFLICT';
    end if;
    return v_command.result;
  end if;
  if v_reservation.state not in ('active', 'partially_delivered') then
    raise exception using errcode = '23514', message = 'INVENTORY_RESERVATION_NOT_DELIVERABLE';
  end if;

  insert into public.inventory_deliveries (
    id, tenant_id, reservation_id, branch_id, source_location_id,
    source_type, source_id, idempotency_key, request_fingerprint, created_by
  ) values (
    v_delivery_id, v_tenant_id, p_reservation_id, v_reservation.branch_id,
    v_reservation.location_id, v_reservation.source_type, v_reservation.source_id,
    p_idempotency_key, v_fingerprint, v_actor_id
  );

  for v_item in
    select item.value from jsonb_array_elements(p_lines) item
    order by item.value ->> 'reservation_line_id'
  loop
    begin
      select * into v_line from public.inventory_reservation_lines line
      where line.id = nullif(v_item ->> 'reservation_line_id', '')::uuid
        and line.tenant_id = v_tenant_id and line.reservation_id = p_reservation_id
      for update;
      v_quantity := (v_item ->> 'quantity')::numeric;
    exception when others then
      raise exception using errcode = '23514', message = 'INVENTORY_DELIVERY_LINE_INVALID';
    end;
    if not found or v_quantity is null or v_quantity <= 0 then
      raise exception using errcode = '23514', message = 'INVENTORY_DELIVERY_LINE_INVALID';
    end if;
    v_remaining := v_line.reserved_quantity - v_line.released_quantity - v_line.delivered_quantity;
    if v_quantity > v_remaining then
      raise exception using errcode = '23514', message = 'INVENTORY_OVER_DELIVERY';
    end if;
    select pp.product_template_id, pp.cost_price, pp.tracking into v_product
    from public.product_products pp
    where pp.id = v_line.product_id and pp.tenant_id = v_tenant_id;
    v_move_id := gen_random_uuid();
    if v_line.tracking_unit_id is not null then
      if v_quantity <> 1 then
        raise exception using errcode = '23514', message = 'INVENTORY_SERIAL_DELIVERY_INVALID';
      end if;
      perform 1 from public.stock_tracking_units unit
      where unit.id = v_line.tracking_unit_id and unit.tenant_id = v_tenant_id
        and unit.status = 'reserved' and unit.current_location_id = v_reservation.location_id
      for update;
      if not found or not exists (
        select 1 from public.inventory_tracking_unit_states canonical_state
        where canonical_state.tenant_id = v_tenant_id
          and canonical_state.tracking_unit_id = v_line.tracking_unit_id
          and canonical_state.state = 'reserved'
          and canonical_state.current_location_id = v_reservation.location_id
      ) then
        raise exception using errcode = '23514', message = 'INVENTORY_TRACKING_STATE_INVALID';
      end if;
    else
      select * into v_quant from public.stock_quants quant
      where quant.tenant_id = v_tenant_id
        and quant.location_id = v_reservation.location_id
        and quant.product_product_id = v_line.product_id for update;
      if not found then
        raise exception using errcode = '23514', message = 'INVENTORY_NEGATIVE_STOCK_DENIED';
      end if;
      select coalesce(sum(line.reserved_quantity - line.released_quantity - line.delivered_quantity), 0)
      into v_active_reserved
      from public.inventory_reservation_lines line
      join public.inventory_reservations reservation
        on reservation.id = line.reservation_id and reservation.tenant_id = line.tenant_id
      where line.tenant_id = v_tenant_id and line.product_id = v_line.product_id
        and line.tracking_unit_id is null
        and reservation.location_id = v_reservation.location_id
        and reservation.state in ('active', 'partially_delivered');
      if v_quant.quantity_on_hand < v_quantity
         or v_quant.quantity_on_hand - v_quant.reserved_quantity - v_active_reserved < 0 then
        raise exception using errcode = '23514', message = 'INVENTORY_NEGATIVE_STOCK_DENIED';
      end if;
      update public.stock_quants
      set quantity_on_hand = quantity_on_hand - v_quantity, updated_at = now()
      where id = v_quant.id and quantity_on_hand >= v_quantity;
      if not found then
        raise exception using errcode = '23514', message = 'INVENTORY_NEGATIVE_STOCK_DENIED';
      end if;
    end if;

    insert into public.stock_moves (
      id, tenant_id, product_product_id, product_template_id,
      tracking_unit_id, move_type, quantity, unit_cost, unit_price,
      reference_type, reference_id, source_location_id, created_by, notes
    ) values (
      v_move_id, v_tenant_id, v_line.product_id, v_product.product_template_id,
      v_line.tracking_unit_id, 'out', v_quantity, coalesce(v_product.cost_price, 0), 0,
      'canonical_inventory_delivery', v_delivery_id,
      v_reservation.location_id, v_actor_id, 'Canonical physical delivery'
    );
    if v_line.tracking_unit_id is not null then
      update public.inventory_tracking_unit_states
      set state = 'issued', current_location_id = null, version = version + 1,
        updated_by = v_actor_id, updated_at = now()
      where tenant_id = v_tenant_id and tracking_unit_id = v_line.tracking_unit_id
        and state = 'reserved';
      update public.stock_tracking_units
      set status = 'sold', current_location_id = null, last_move_id = v_move_id, updated_at = now()
      where id = v_line.tracking_unit_id and tenant_id = v_tenant_id and status = 'reserved';
    end if;
    update public.inventory_reservation_lines
    set delivered_quantity = delivered_quantity + v_quantity, updated_at = now()
    where id = v_line.id;
    v_delivery_line_id := gen_random_uuid();
    insert into public.inventory_delivery_lines (
      id, tenant_id, delivery_id, reservation_line_id, product_id,
      tracking_unit_id, quantity, stock_move_id
    ) values (
      v_delivery_line_id, v_tenant_id, v_delivery_id, v_line.id,
      v_line.product_id, v_line.tracking_unit_id, v_quantity, v_move_id
    );
    insert into public.inventory_events (
      tenant_id, event_type, reservation_id, delivery_id, source_type, source_id,
      product_id, tracking_unit_id, quantity, from_location_id, created_by
    ) values (
      v_tenant_id, 'delivered', p_reservation_id, v_delivery_id,
      v_reservation.source_type, v_reservation.source_id, v_line.product_id,
      v_line.tracking_unit_id, v_quantity, v_reservation.location_id, v_actor_id
    );
  end loop;

  if exists (
    select 1 from public.inventory_reservation_lines line
    where line.reservation_id = p_reservation_id
      and line.reserved_quantity > line.released_quantity + line.delivered_quantity
  ) then v_new_state := 'partially_delivered';
  elsif exists (
    select 1 from public.inventory_reservation_lines line
    where line.reservation_id = p_reservation_id and line.released_quantity > 0
  ) then v_new_state := 'closed';
  else v_new_state := 'delivered'; end if;
  update public.inventory_reservations
  set state = v_new_state, completed_at = case when v_new_state in ('delivered', 'closed') then now() else null end,
    updated_at = now()
  where id = p_reservation_id;
  v_result := jsonb_build_object(
    'delivery_id', v_delivery_id, 'reservation_id', p_reservation_id,
    'reservation_state', v_new_state, 'line_count', jsonb_array_length(p_lines)
  );
  update public.inventory_command_requests set result = v_result, completed_at = now()
  where tenant_id = v_tenant_id and command_type = 'deliver'
    and idempotency_key = p_idempotency_key;
  return v_result;
end
$$;

create or replace function public.receive_inventory_return(
  p_delivery_id uuid,
  p_destination_location_id uuid,
  p_source_type text,
  p_source_id text,
  p_lines jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id uuid := public.current_tenant_user_id();
  v_delivery public.inventory_deliveries%rowtype;
  v_item jsonb;
  v_line public.inventory_delivery_lines%rowtype;
  v_product record;
  v_quantity numeric;
  v_returned numeric;
  v_return_id uuid := gen_random_uuid();
  v_move_id uuid;
  v_fingerprint text;
  v_command record;
  v_claimed integer := 0;
  v_result jsonb;
  v_delivery_state text;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('inventory.return', v_tenant_id) then
    raise exception using errcode = '42501', message = 'INVENTORY_RETURN_DENIED';
  end if;
  select * into v_delivery from public.inventory_deliveries delivery
  where delivery.id = p_delivery_id and delivery.tenant_id = v_tenant_id for update;
  if not found then
    raise exception using errcode = '23514', message = 'INVENTORY_DELIVERY_NOT_FOUND';
  end if;
  if not public.has_branch_access(v_delivery.branch_id)
     or not public.has_stock_location_access(p_destination_location_id)
     or not exists (
       select 1 from public.stock_locations location
       where location.id = p_destination_location_id and location.tenant_id = v_tenant_id
         and location.branch_id = v_delivery.branch_id and location.is_active
     ) then
    raise exception using errcode = '42501', message = 'INVENTORY_RETURN_SCOPE_DENIED';
  end if;
  if p_source_type is null or p_source_type !~ '^[a-z][a-z0-9_]{1,62}$'
     or p_source_id is null or length(btrim(p_source_id)) not between 1 and 200 then
    raise exception using errcode = '23514', message = 'INVENTORY_SOURCE_INVALID';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0
     or jsonb_array_length(p_lines) > 100 then
    raise exception using errcode = '23514', message = 'INVENTORY_RETURN_LINES_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) item
    group by item ->> 'delivery_line_id' having count(*) > 1
  ) then
    raise exception using errcode = '23514', message = 'INVENTORY_RETURN_LINES_DUPLICATE';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception using errcode = '23514', message = 'INVENTORY_IDEMPOTENCY_KEY_INVALID';
  end if;
  v_fingerprint := public.inventory_request_fingerprint(jsonb_build_object(
    'delivery_id', p_delivery_id, 'destination_location_id', p_destination_location_id,
    'source_type', p_source_type, 'source_id', p_source_id, 'lines', p_lines
  ));
  insert into public.inventory_command_requests (
    tenant_id, command_type, idempotency_key, request_fingerprint, created_by
  ) values (v_tenant_id, 'return', p_idempotency_key, v_fingerprint, v_actor_id)
  on conflict (tenant_id, command_type, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    select * into v_command from public.inventory_command_requests command_request
    where command_request.tenant_id = v_tenant_id and command_request.command_type = 'return'
      and command_request.idempotency_key = p_idempotency_key for update;
    if v_command.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23514', message = 'INVENTORY_IDEMPOTENCY_CONFLICT';
    end if;
    return v_command.result;
  end if;

  insert into public.inventory_returns (
    id, tenant_id, delivery_id, branch_id, destination_location_id,
    source_type, source_id, idempotency_key, request_fingerprint, created_by
  ) values (
    v_return_id, v_tenant_id, p_delivery_id, v_delivery.branch_id,
    p_destination_location_id, p_source_type, btrim(p_source_id),
    p_idempotency_key, v_fingerprint, v_actor_id
  );

  for v_item in
    select item.value from jsonb_array_elements(p_lines) item
    order by item.value ->> 'delivery_line_id'
  loop
    begin
      select * into v_line from public.inventory_delivery_lines line
      where line.id = nullif(v_item ->> 'delivery_line_id', '')::uuid
        and line.tenant_id = v_tenant_id and line.delivery_id = p_delivery_id
      for update;
      v_quantity := (v_item ->> 'quantity')::numeric;
    exception when others then
      raise exception using errcode = '23514', message = 'INVENTORY_RETURN_LINE_INVALID';
    end;
    if not found or v_quantity is null or v_quantity <= 0 then
      raise exception using errcode = '23514', message = 'INVENTORY_RETURN_LINE_INVALID';
    end if;
    select coalesce(sum(return_line.quantity), 0) into v_returned
    from public.inventory_return_lines return_line
    where return_line.tenant_id = v_tenant_id
      and return_line.delivery_line_id = v_line.id;
    if v_quantity > v_line.quantity - v_returned then
      raise exception using errcode = '23514', message = 'INVENTORY_OVER_RETURN';
    end if;
    select pp.product_template_id, pp.cost_price, pp.tracking into v_product
    from public.product_products pp
    where pp.id = v_line.product_id and pp.tenant_id = v_tenant_id;
    v_move_id := gen_random_uuid();
    if v_line.tracking_unit_id is not null then
      if v_quantity <> 1 then
        raise exception using errcode = '23514', message = 'INVENTORY_SERIAL_RETURN_INVALID';
      end if;
      perform 1 from public.stock_tracking_units unit
      where unit.id = v_line.tracking_unit_id and unit.tenant_id = v_tenant_id
      for update;
      if not exists (
        select 1 from public.inventory_tracking_unit_states canonical_state
        where canonical_state.tenant_id = v_tenant_id
          and canonical_state.tracking_unit_id = v_line.tracking_unit_id
          and canonical_state.state = 'issued'
      ) then
        raise exception using errcode = '23514', message = 'INVENTORY_TRACKING_STATE_INVALID';
      end if;
    else
      insert into public.stock_quants (
        tenant_id, product_product_id, product_template_id, location_id,
        quantity_on_hand, reserved_quantity
      ) values (
        v_tenant_id, v_line.product_id, v_product.product_template_id,
        p_destination_location_id, 0, 0
      ) on conflict (tenant_id, location_id, product_product_id) do nothing;
      perform 1 from public.stock_quants quant
      where quant.tenant_id = v_tenant_id and quant.location_id = p_destination_location_id
        and quant.product_product_id = v_line.product_id for update;
      update public.stock_quants
      set quantity_on_hand = quantity_on_hand + v_quantity, updated_at = now()
      where tenant_id = v_tenant_id and location_id = p_destination_location_id
        and product_product_id = v_line.product_id;
    end if;
    insert into public.stock_moves (
      id, tenant_id, product_product_id, product_template_id,
      tracking_unit_id, move_type, quantity, unit_cost, unit_price,
      reference_type, reference_id, destination_location_id, created_by, notes
    ) values (
      v_move_id, v_tenant_id, v_line.product_id, v_product.product_template_id,
      v_line.tracking_unit_id, 'return', v_quantity, coalesce(v_product.cost_price, 0), 0,
      'canonical_inventory_return', v_return_id,
      p_destination_location_id, v_actor_id, 'Canonical physical return receipt'
    );
    if v_line.tracking_unit_id is not null then
      update public.inventory_tracking_unit_states
      set state = 'available', current_location_id = p_destination_location_id,
        version = version + 1, updated_by = v_actor_id, updated_at = now()
      where tenant_id = v_tenant_id and tracking_unit_id = v_line.tracking_unit_id
        and state = 'issued';
      update public.stock_tracking_units
      set status = 'in_stock', current_location_id = p_destination_location_id,
        last_move_id = v_move_id, updated_at = now()
      where id = v_line.tracking_unit_id and tenant_id = v_tenant_id;
    end if;
    insert into public.inventory_return_lines (
      tenant_id, return_id, delivery_line_id, product_id,
      tracking_unit_id, quantity, stock_move_id
    ) values (
      v_tenant_id, v_return_id, v_line.id, v_line.product_id,
      v_line.tracking_unit_id, v_quantity, v_move_id
    );
    insert into public.inventory_events (
      tenant_id, event_type, reservation_id, delivery_id, return_id,
      source_type, source_id, product_id, tracking_unit_id, quantity,
      to_location_id, created_by
    ) values (
      v_tenant_id, 'returned', v_delivery.reservation_id, p_delivery_id,
      v_return_id, p_source_type, btrim(p_source_id), v_line.product_id,
      v_line.tracking_unit_id, v_quantity, p_destination_location_id, v_actor_id
    );
  end loop;

  if exists (
    select 1
    from public.inventory_delivery_lines delivery_line
    where delivery_line.delivery_id = p_delivery_id
      and delivery_line.quantity > coalesce((
        select sum(return_line.quantity)
        from public.inventory_return_lines return_line
        where return_line.delivery_line_id = delivery_line.id
      ), 0)
  ) then v_delivery_state := 'partially_returned'; else v_delivery_state := 'returned'; end if;
  update public.inventory_deliveries
  set state = v_delivery_state, updated_at = now()
  where id = p_delivery_id;
  v_result := jsonb_build_object(
    'return_id', v_return_id, 'delivery_id', p_delivery_id,
    'delivery_state', v_delivery_state, 'line_count', jsonb_array_length(p_lines),
    'destination_location_id', p_destination_location_id
  );
  update public.inventory_command_requests set result = v_result, completed_at = now()
  where tenant_id = v_tenant_id and command_type = 'return'
    and idempotency_key = p_idempotency_key;
  return v_result;
end
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'inventory_reservations', 'inventory_reservation_lines',
    'inventory_tracking_unit_states', 'inventory_deliveries',
    'inventory_delivery_lines', 'inventory_returns', 'inventory_return_lines',
    'inventory_command_requests', 'inventory_events'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from public, anon, authenticated', v_table);
  end loop;
end
$$;

grant select on public.inventory_reservations, public.inventory_reservation_lines,
  public.inventory_tracking_unit_states, public.inventory_deliveries,
  public.inventory_delivery_lines, public.inventory_returns,
  public.inventory_return_lines, public.inventory_events to authenticated;

create policy inventory_reservations_read on public.inventory_reservations
for select to authenticated using (
  tenant_id = public.current_tenant_id()
  and public.has_branch_access(branch_id)
  and public.has_stock_location_access(location_id)
  and (public.has_permission('inventory.availability', tenant_id)
    or public.has_permission('inventory.read', tenant_id))
);
create policy inventory_reservation_lines_read on public.inventory_reservation_lines
for select to authenticated using (
  exists (
    select 1 from public.inventory_reservations reservation
    where reservation.id = public.inventory_reservation_lines.reservation_id
      and reservation.tenant_id = public.inventory_reservation_lines.tenant_id
  )
);
create policy inventory_tracking_states_read on public.inventory_tracking_unit_states
for select to authenticated using (
  tenant_id = public.current_tenant_id()
  and current_location_id is not null
  and public.has_stock_location_access(current_location_id)
  and (public.has_permission('inventory.availability', tenant_id)
    or public.has_permission('inventory.read', tenant_id))
);
create policy inventory_deliveries_read on public.inventory_deliveries
for select to authenticated using (
  tenant_id = public.current_tenant_id() and public.has_branch_access(branch_id)
  and public.has_stock_location_access(source_location_id)
  and (public.has_permission('inventory.availability', tenant_id)
    or public.has_permission('inventory.read', tenant_id))
);
create policy inventory_delivery_lines_read on public.inventory_delivery_lines
for select to authenticated using (
  exists (
    select 1 from public.inventory_deliveries delivery
    where delivery.id = public.inventory_delivery_lines.delivery_id
      and delivery.tenant_id = public.inventory_delivery_lines.tenant_id
  )
);
create policy inventory_returns_read on public.inventory_returns
for select to authenticated using (
  tenant_id = public.current_tenant_id() and public.has_branch_access(branch_id)
  and public.has_stock_location_access(destination_location_id)
  and (public.has_permission('inventory.availability', tenant_id)
    or public.has_permission('inventory.read', tenant_id))
);
create policy inventory_return_lines_read on public.inventory_return_lines
for select to authenticated using (
  exists (
    select 1 from public.inventory_returns inventory_return
    where inventory_return.id = public.inventory_return_lines.return_id
      and inventory_return.tenant_id = public.inventory_return_lines.tenant_id
  )
);
create policy inventory_events_read on public.inventory_events
for select to authenticated using (
  tenant_id = public.current_tenant_id()
  and (public.has_permission('inventory.availability', tenant_id)
    or public.has_permission('inventory.read', tenant_id))
  and (
    (from_location_id is not null and public.has_stock_location_access(from_location_id))
    or (to_location_id is not null and public.has_stock_location_access(to_location_id))
  )
);

revoke all on function public.inventory_request_fingerprint(jsonb) from public, anon, authenticated;
revoke all on function public.get_inventory_availability(uuid, uuid, numeric, uuid, uuid) from public, anon;
revoke all on function public.reserve_inventory(uuid, uuid, text, text, jsonb, text) from public, anon;
revoke all on function public.release_inventory_reservation(uuid, text) from public, anon;
revoke all on function public.commit_inventory_delivery(uuid, jsonb, text) from public, anon;
revoke all on function public.receive_inventory_return(uuid, uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.get_inventory_availability(uuid, uuid, numeric, uuid, uuid) to authenticated;
grant execute on function public.reserve_inventory(uuid, uuid, text, text, jsonb, text) to authenticated;
grant execute on function public.release_inventory_reservation(uuid, text) to authenticated;
grant execute on function public.commit_inventory_delivery(uuid, jsonb, text) to authenticated;
grant execute on function public.receive_inventory_return(uuid, uuid, text, text, jsonb, text) to authenticated;

comment on table public.inventory_reservations is
  'Typed Canonical inventory reservation header. source_type/source_id is application-neutral business provenance.';
comment on table public.inventory_reservation_lines is
  'Canonical reservation quantities. Active reserved = reserved - released - delivered.';
comment on table public.inventory_tracking_unit_states is
  'Inventory-only physical state: available -> reserved -> issued -> available on physical return.';
comment on table public.inventory_events is
  'Immutable audit trail for Canonical reserve, release, physical delivery and physical return.';
comment on function public.get_inventory_availability(uuid, uuid, numeric, uuid, uuid) is
  'Business availability read contract. Serial stock uses valid complete sellable units; quantity stock uses on-hand minus legacy and active Canonical reservations.';
comment on function public.reserve_inventory(uuid, uuid, text, text, jsonb, text) is
  'Atomic, idempotent Canonical reservation command. Lines contain product_id, quantity and optional tracking_unit_id.';
comment on function public.release_inventory_reservation(uuid, text) is
  'Atomic release of all undelivered reservation remainder.';
comment on function public.commit_inventory_delivery(uuid, jsonb, text) is
  'Atomic physical issue command. Lines contain reservation_line_id and quantity; supports partial delivery.';
comment on function public.receive_inventory_return(uuid, uuid, text, text, jsonb, text) is
  'Atomic physical return receipt. Lines contain delivery_line_id and quantity; supports partial return.';

commit;
