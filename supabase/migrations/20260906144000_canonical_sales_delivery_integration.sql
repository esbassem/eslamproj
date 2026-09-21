begin;

insert into public.auth_permissions (code, name, description, resource, action, active)
values (
  'sales.deliver', 'تسليم المبيعات',
  'تنفيذ التسليم الفيزيائي لعقد بيع Canonical مؤكد.',
  'sales', 'deliver', true
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  resource = excluded.resource,
  action = excluded.action,
  active = true,
  updated_at = now();

alter table public.sales_command_requests
  add column delivery_sale_id uuid,
  add column delivery_expected_version bigint,
  add constraint sales_command_delivery_sale_fkey
    foreign key (delivery_sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict;

alter table public.sales_command_requests
  drop constraint sales_command_confirmation_context_check,
  add constraint sales_command_context_check check (
    (command_type = 'confirm'
      and confirmation_sale_id is not null
      and confirmation_expected_version is not null
      and confirmation_expected_version > 0
      and delivery_sale_id is null
      and delivery_expected_version is null)
    or
    (command_type = 'deliver'
      and confirmation_sale_id is null
      and confirmation_expected_version is null
      and delivery_sale_id is not null
      and delivery_expected_version is not null
      and delivery_expected_version > 0)
    or
    (command_type not in ('confirm', 'deliver')
      and confirmation_sale_id is null
      and confirmation_expected_version is null
      and delivery_sale_id is null
      and delivery_expected_version is null)
  ),
  drop constraint sales_command_requests_type_check,
  add constraint sales_command_requests_type_check
    check (command_type in ('create', 'update_draft', 'confirm', 'deliver'));

alter table public.sale_events
  drop constraint sale_events_type_check,
  add constraint sale_events_type_check check (event_type in (
    'sale_created', 'sale_draft_updated', 'sale_confirmed', 'sale_cancelled',
    'delivery_requested', 'delivery_linked', 'return_initiated',
    'sale_partially_delivered', 'sale_delivered'
  ));

create unique index sale_confirmation_links_id_tenant_unique
  on public.sale_confirmation_links (id, tenant_id);

create table public.sale_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  confirmation_link_id uuid not null,
  inventory_reservation_id uuid not null,
  inventory_delivery_id uuid not null,
  fulfillment_status text not null,
  sale_version bigint not null,
  delivered_by uuid not null,
  delivered_at timestamptz not null default now(),
  constraint sale_deliveries_sale_fkey
    foreign key (sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  constraint sale_deliveries_confirmation_fkey
    foreign key (confirmation_link_id, tenant_id)
    references public.sale_confirmation_links(id, tenant_id) on delete restrict,
  constraint sale_deliveries_reservation_fkey
    foreign key (inventory_reservation_id, tenant_id)
    references public.inventory_reservations(id, tenant_id) on delete restrict,
  constraint sale_deliveries_inventory_delivery_fkey
    foreign key (inventory_delivery_id, tenant_id)
    references public.inventory_deliveries(id, tenant_id) on delete restrict,
  constraint sale_deliveries_actor_fkey
    foreign key (delivered_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sale_deliveries_status_check
    check (fulfillment_status in ('partially_delivered', 'delivered')),
  constraint sale_deliveries_version_check check (sale_version > 0),
  constraint sale_deliveries_id_tenant_sale_unique
    unique (id, tenant_id, sale_id),
  constraint sale_deliveries_inventory_delivery_unique
    unique (tenant_id, inventory_delivery_id),
  constraint sale_deliveries_sale_version_unique
    unique (tenant_id, sale_id, sale_version)
);

create table public.sale_delivery_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  sale_delivery_id uuid not null,
  sale_line_id uuid not null,
  inventory_delivery_line_id uuid not null,
  tracking_unit_id uuid,
  quantity numeric(18,4) not null,
  created_at timestamptz not null default now(),
  constraint sale_delivery_lines_delivery_fkey
    foreign key (sale_delivery_id, tenant_id, sale_id)
    references public.sale_deliveries(id, tenant_id, sale_id) on delete restrict,
  constraint sale_delivery_lines_sale_line_fkey
    foreign key (sale_line_id, tenant_id, sale_id)
    references public.sale_lines(id, tenant_id, sale_id) on delete restrict,
  constraint sale_delivery_lines_inventory_line_fkey
    foreign key (inventory_delivery_line_id, tenant_id)
    references public.inventory_delivery_lines(id, tenant_id) on delete restrict,
  constraint sale_delivery_lines_tracking_fkey
    foreign key (tracking_unit_id, tenant_id)
    references public.stock_tracking_units(id, tenant_id) on delete restrict,
  constraint sale_delivery_lines_quantity_check
    check (quantity > 0 and quantity = round(quantity, 4)),
  constraint sale_delivery_lines_tracking_quantity_check
    check (tracking_unit_id is null or quantity = 1),
  constraint sale_delivery_lines_identity_unique
    unique nulls not distinct (sale_delivery_id, sale_line_id, tracking_unit_id),
  constraint sale_delivery_lines_id_tenant_unique unique (id, tenant_id)
);

create index sale_deliveries_sale_idx
  on public.sale_deliveries (tenant_id, sale_id, sale_version);
create index sale_delivery_lines_sale_line_idx
  on public.sale_delivery_lines (tenant_id, sale_id, sale_line_id);

create or replace function public.is_trusted_sales_delivery_context(
  p_tenant_id uuid,
  p_reservation_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_command_id uuid;
begin
  begin
    v_command_id := nullif(
      current_setting('app.canonical_sales_delivery_command', true), ''
    )::uuid;
  exception when others then
    return false;
  end;
  return v_command_id is not null
    and p_tenant_id = public.current_tenant_id()
    and exists (
      select 1
      from public.sales_command_requests command_request
      join public.sales sale
        on sale.id = command_request.delivery_sale_id
       and sale.tenant_id = command_request.tenant_id
      join public.sale_confirmation_links confirmation
        on confirmation.sale_id = sale.id
       and confirmation.tenant_id = sale.tenant_id
      where command_request.id = v_command_id
        and command_request.tenant_id = p_tenant_id
        and command_request.command_type = 'deliver'
        and command_request.created_by = public.current_tenant_user_id()
        and command_request.result is null
        and command_request.completed_at is null
        and command_request.delivery_expected_version = sale.version
        and confirmation.inventory_reservation_id = p_reservation_id
    );
end
$$;

-- Preserve Inventory Core ownership while allowing only an unresolved,
-- actor-bound Sales delivery command to invoke its delivery contract.
do $$
declare v_definition text; v_rewritten text;
begin
  select pg_get_functiondef(
    'public.commit_inventory_delivery(uuid,jsonb,text)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'  if v_tenant_id is null or v_actor_id is null\n     or not public.has_permission(''inventory.deliver'', v_tenant_id) then',
    E'  if v_tenant_id is null or v_actor_id is null\n     or (not public.has_permission(''inventory.deliver'', v_tenant_id)\n       and not public.is_trusted_sales_delivery_context(v_tenant_id, p_reservation_id)) then'
  );
  if v_rewritten = v_definition then
    raise exception 'SALES_DELIVERY_INVENTORY_AUTHORIZATION_NOT_APPLIED';
  end if;
  execute v_rewritten;
end
$$;

create or replace function public.guard_sale_delivery_artifact()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare v_sale_id uuid;
begin
  if current_user in ('postgres', 'supabase_admin')
     and current_setting('app.canonical_sales_maintenance', true) = 'authorized' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'INSERT' then
    raise exception using errcode = '42501', message = 'SALE_DELIVERY_ARTIFACT_IMMUTABLE';
  end if;
  v_sale_id := case when tg_table_name = 'sale_deliveries'
    then new.sale_id else new.sale_id end;
  if current_setting('app.canonical_sales_delivery_write', true)
       is distinct from v_sale_id::text then
    raise exception using errcode = '42501', message = 'SALE_DELIVERY_COMMAND_REQUIRED';
  end if;
  if tg_table_name = 'sale_deliveries' then
    if not public.is_trusted_sales_delivery_context(new.tenant_id, new.inventory_reservation_id)
       or not exists (
         select 1 from public.sale_confirmation_links confirmation
         where confirmation.id = new.confirmation_link_id
           and confirmation.tenant_id = new.tenant_id
           and confirmation.sale_id = new.sale_id
           and confirmation.inventory_reservation_id = new.inventory_reservation_id
       )
       or not exists (
         select 1 from public.inventory_deliveries delivery
         where delivery.id = new.inventory_delivery_id
           and delivery.tenant_id = new.tenant_id
           and delivery.reservation_id = new.inventory_reservation_id
           and delivery.source_type = 'sale'
           and delivery.source_id = new.sale_id::text
       ) then
      raise exception using errcode = '23514', message = 'SALE_DELIVERY_LINK_INVALID';
    end if;
  elsif not exists (
    select 1
    from public.sale_deliveries delivery
    join public.inventory_delivery_lines inventory_line
      on inventory_line.id = new.inventory_delivery_line_id
     and inventory_line.tenant_id = new.tenant_id
    where delivery.id = new.sale_delivery_id
      and delivery.tenant_id = new.tenant_id
      and delivery.sale_id = new.sale_id
      and inventory_line.delivery_id = delivery.inventory_delivery_id
      and inventory_line.quantity >= new.quantity
      and inventory_line.tracking_unit_id is not distinct from new.tracking_unit_id
  ) then
    raise exception using errcode = '23514', message = 'SALE_DELIVERY_LINE_LINK_INVALID';
  end if;
  return new;
end
$$;

create trigger sale_deliveries_guard
before insert or update or delete on public.sale_deliveries
for each row execute function public.guard_sale_delivery_artifact();
create trigger sale_delivery_lines_guard
before insert or update or delete on public.sale_delivery_lines
for each row execute function public.guard_sale_delivery_artifact();

create or replace function public.sale_delivery_snapshot(
  p_tenant_id uuid,
  p_sale_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sale public.sales%rowtype;
  v_confirmation public.sale_confirmation_links%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_location record;
  v_required numeric := 0;
  v_delivered numeric := 0;
  v_reservation_delivered numeric := 0;
  v_blockers jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_status text := 'unreserved';
begin
  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into v_confirmation from public.sale_confirmation_links confirmation
  where confirmation.sale_id = p_sale_id and confirmation.tenant_id = p_tenant_id;
  if found and v_confirmation.inventory_reservation_id is not null then
    select * into v_reservation from public.inventory_reservations reservation
    where reservation.id = v_confirmation.inventory_reservation_id
      and reservation.tenant_id = p_tenant_id;
    if found then
      select location.id, location.name into v_location
      from public.stock_locations location
      where location.id = v_reservation.location_id
        and location.tenant_id = p_tenant_id;
    end if;
  end if;

  select coalesce(sum(selection.quantity), 0) into v_required
  from public.sale_inventory_selections selection
  where selection.sale_id = p_sale_id and selection.tenant_id = p_tenant_id;
  select coalesce(sum(line.quantity), 0) into v_delivered
  from public.sale_delivery_lines line
  where line.sale_id = p_sale_id and line.tenant_id = p_tenant_id;
  if v_reservation.id is not null then
    select coalesce(sum(line.delivered_quantity), 0) into v_reservation_delivered
    from public.inventory_reservation_lines line
    where line.reservation_id = v_reservation.id and line.tenant_id = p_tenant_id;
  end if;

  if v_sale.status <> 'confirmed' then
    v_blockers := v_blockers || '"SALE_NOT_CONFIRMED"'::jsonb;
  end if;
  if v_confirmation.id is null or not exists (
    select 1
    from public.financial_sale_postings posting
    join public.financial_engine_bindings binding
      on binding.id = v_confirmation.financial_engine_binding_id
     and binding.tenant_id = posting.tenant_id
     and binding.canonical_sale_posting_id = posting.id
    where posting.id = v_confirmation.financial_sale_posting_id
      and posting.tenant_id = p_tenant_id
      and posting.source_app = 'sales_core'
      and posting.source_model = 'sale'
      and posting.source_id = p_sale_id::text
      and posting.state = 'posted'
      and binding.financial_engine = 'canonical'
      and binding.state = 'posted'
  ) then
    v_blockers := v_blockers || '"SALE_CONFIRMATION_LINK_INVALID"'::jsonb;
  end if;
  if v_required = 0 then
    v_status := 'not_required';
    v_blockers := v_blockers || '"SALE_DELIVERY_NOT_REQUIRED"'::jsonb;
  elsif v_reservation.id is null then
    v_blockers := v_blockers || '"SALE_INVENTORY_RESERVATION_MISSING"'::jsonb;
  else
    if v_reservation.source_type <> 'sale'
       or v_reservation.source_id <> p_sale_id::text
       or v_reservation.branch_id <> v_sale.branch_id
       or v_reservation.state not in ('active', 'partially_delivered', 'delivered')
       or v_location.id is null then
      v_blockers := v_blockers || '"SALE_INVENTORY_RESERVATION_INVALID"'::jsonb;
    end if;
    if exists (
      with selections as (
        select line.product_id, selection.tracking_unit_id,
          sum(selection.quantity) quantity
        from public.sale_inventory_selections selection
        join public.sale_lines line
          on line.id = selection.sale_line_id
         and line.sale_id = selection.sale_id
         and line.tenant_id = selection.tenant_id
        where selection.sale_id = p_sale_id and selection.tenant_id = p_tenant_id
        group by line.product_id, selection.tracking_unit_id
      ), reservations as (
        select line.product_id, line.tracking_unit_id,
          line.reserved_quantity, line.released_quantity, line.delivered_quantity
        from public.inventory_reservation_lines line
        where line.reservation_id = v_reservation.id and line.tenant_id = p_tenant_id
      )
      select 1 from selections selection
      full join reservations reservation
        on reservation.product_id = selection.product_id
       and reservation.tracking_unit_id is not distinct from selection.tracking_unit_id
      where selection.product_id is null or reservation.product_id is null
         or selection.quantity <> reservation.reserved_quantity
         or reservation.released_quantity <> 0
    ) or exists (
      select 1
      from public.inventory_delivery_lines inventory_line
      join public.inventory_deliveries inventory_delivery
        on inventory_delivery.id = inventory_line.delivery_id
       and inventory_delivery.tenant_id = inventory_line.tenant_id
      left join lateral (
        select coalesce(sum(sales_line.quantity), 0) quantity
        from public.sale_delivery_lines sales_line
        where sales_line.inventory_delivery_line_id = inventory_line.id
          and sales_line.tenant_id = inventory_line.tenant_id
      ) sales_allocation on true
      where inventory_delivery.reservation_id = v_reservation.id
        and inventory_delivery.tenant_id = p_tenant_id
        and sales_allocation.quantity <> inventory_line.quantity
    ) or v_delivered <> v_reservation_delivered or v_delivered > v_required then
      v_blockers := v_blockers || '"SALE_FULFILLMENT_STATE_INCONSISTENT"'::jsonb;
    end if;
    if v_delivered = 0 then v_status := 'reserved';
    elsif v_delivered < v_required then v_status := 'partially_delivered';
    elsif v_delivered = v_required then v_status := 'delivered';
    else v_status := 'inconsistent'; end if;
    if v_delivered = v_required and v_required > 0 then
      v_blockers := v_blockers || '"SALE_ALREADY_DELIVERED"'::jsonb;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_line_id', line.id,
    'product_id', line.product_id,
    'product_name', product.display_name,
    'tracking_requirement', line.tracking_requirement,
    'ordered_quantity', line.quantity,
    'delivered_quantity', coalesce(delivered.quantity, 0),
    'remaining_quantity', line.quantity - coalesce(delivered.quantity, 0),
    'tracking_units', case when line.tracking_requirement = 'serial' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'tracking_unit_id', selection.tracking_unit_id,
        'tracking_number', unit.tracking_number,
        'state', canonical_state.state,
        'deliverable', coalesce(delivered_unit.quantity, 0) = 0
          and canonical_state.state = 'reserved'
      ) order by unit.tracking_number)
      from public.sale_inventory_selections selection
      join public.stock_tracking_units unit
        on unit.id = selection.tracking_unit_id and unit.tenant_id = selection.tenant_id
      join public.inventory_tracking_unit_states canonical_state
        on canonical_state.tracking_unit_id = selection.tracking_unit_id
       and canonical_state.tenant_id = selection.tenant_id
      left join lateral (
        select sum(delivery_line.quantity) quantity
        from public.sale_delivery_lines delivery_line
        where delivery_line.sale_id = p_sale_id
          and delivery_line.sale_line_id = line.id
          and delivery_line.tracking_unit_id = selection.tracking_unit_id
          and delivery_line.tenant_id = p_tenant_id
      ) delivered_unit on true
      where selection.sale_id = p_sale_id
        and selection.sale_line_id = line.id
        and selection.tenant_id = p_tenant_id
    ), '[]'::jsonb) else '[]'::jsonb end
  ) order by line.line_position), '[]'::jsonb) into v_lines
  from public.sale_lines line
  join public.product_products product
    on product.id = line.product_id and product.tenant_id = line.tenant_id
  join public.product_templates template
    on template.id = product.product_template_id and template.tenant_id = product.tenant_id
  left join lateral (
    select sum(delivery_line.quantity) quantity
    from public.sale_delivery_lines delivery_line
    where delivery_line.sale_id = p_sale_id
      and delivery_line.sale_line_id = line.id
      and delivery_line.tenant_id = p_tenant_id
  ) delivered on true
  where line.sale_id = p_sale_id and line.tenant_id = p_tenant_id
    and template.product_type = 'goods';

  return jsonb_build_object(
    'found', true,
    'sale_id', v_sale.id,
    'sale_number', v_sale.sale_number,
    'commercial_status', v_sale.status,
    'version', v_sale.version,
    'eligible', jsonb_array_length(v_blockers) = 0,
    'fulfillment_status', v_status,
    'required_quantity', v_required,
    'delivered_quantity', v_delivered,
    'remaining_quantity', greatest(v_required - v_delivered, 0),
    'location', case when v_location.id is null then null else
      jsonb_build_object('id', v_location.id, 'name', v_location.name) end,
    'deliverable_lines', v_lines,
    'blocking_reasons', v_blockers,
    'reservation_id', v_reservation.id,
    'confirmation_link_id', v_confirmation.id
  );
end
$$;

create or replace function public.get_sale_delivery_eligibility(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id uuid := public.current_tenant_user_id();
  v_sale public.sales%rowtype;
  v_snapshot jsonb;
  v_reservation_id uuid;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.deliver', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_DELIVERY_DENIED';
  end if;
  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = v_tenant_id;
  if not found then
    raise exception using errcode = '23514', message = 'SALE_NOT_FOUND';
  end if;
  if not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '42501', message = 'SALE_DELIVERY_SCOPE_DENIED';
  end if;
  v_snapshot := public.sale_delivery_snapshot(v_tenant_id, p_sale_id);
  v_reservation_id := nullif(v_snapshot ->> 'reservation_id', '')::uuid;
  if v_reservation_id is not null and not exists (
    select 1 from public.inventory_reservations reservation
    where reservation.id = v_reservation_id and reservation.tenant_id = v_tenant_id
      and public.has_stock_location_access(reservation.location_id)
  ) then
    raise exception using errcode = '42501', message = 'SALE_DELIVERY_SCOPE_DENIED';
  end if;
  return v_snapshot - 'reservation_id' - 'confirmation_link_id' - 'found';
end
$$;

create or replace function public.deliver_sale(
  p_sale_id uuid,
  p_expected_version bigint,
  p_delivery_lines jsonb,
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
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_line_id uuid;
  v_tracking_unit_id uuid;
  v_quantity numeric;
  v_normalized jsonb := '[]'::jsonb;
  v_fingerprint text;
  v_command public.sales_command_requests%rowtype;
  v_command_id uuid := gen_random_uuid();
  v_claimed integer := 0;
  v_snapshot jsonb;
  v_reservation_id uuid;
  v_confirmation_id uuid;
  v_inventory_lines jsonb;
  v_inventory_result jsonb;
  v_inventory_delivery_id uuid;
  v_new_version bigint;
  v_fulfillment_status text;
  v_sale_delivery_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.deliver', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_DELIVERY_DENIED';
  end if;
  if p_idempotency_key is null
     or length(btrim(p_idempotency_key)) not between 1 and 160 then
    raise exception using errcode = '23514', message = 'SALES_DELIVERY_IDEMPOTENCY_KEY_INVALID';
  end if;
  if jsonb_typeof(p_delivery_lines) <> 'array'
     or jsonb_array_length(p_delivery_lines) = 0
     or jsonb_array_length(p_delivery_lines) > 200 then
    raise exception using errcode = '23514', message = 'SALE_DELIVERY_LINES_INVALID';
  end if;

  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = v_tenant_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'SALE_NOT_FOUND';
  end if;
  if not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '42501', message = 'SALE_DELIVERY_SCOPE_DENIED';
  end if;

  for v_item in select item.value from jsonb_array_elements(p_delivery_lines) item
  loop
    if jsonb_typeof(v_item) <> 'object'
       or v_item - array['sale_line_id', 'tracking_unit_id', 'quantity'] <> '{}'::jsonb then
      raise exception using errcode = '23514', message = 'SALE_DELIVERY_LINE_INVALID';
    end if;
    begin
      v_line_id := nullif(v_item ->> 'sale_line_id', '')::uuid;
      v_tracking_unit_id := nullif(v_item ->> 'tracking_unit_id', '')::uuid;
      v_quantity := (v_item ->> 'quantity')::numeric;
    exception when others then
      raise exception using errcode = '23514', message = 'SALE_DELIVERY_LINE_INVALID';
    end;
    if v_line_id is null or v_quantity is null or v_quantity <= 0
       or v_quantity <> round(v_quantity, 4) then
      raise exception using errcode = '23514', message = 'SALE_DELIVERY_LINE_INVALID';
    end if;
    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'sale_line_id', v_line_id,
      'tracking_unit_id', v_tracking_unit_id,
      'quantity', v_quantity
    ));
  end loop;
  select coalesce(jsonb_agg(item order by item ->> 'sale_line_id',
    coalesce(item ->> 'tracking_unit_id', '')), '[]'::jsonb)
  into v_normalized from jsonb_array_elements(v_normalized) item;
  if exists (
    select 1 from jsonb_array_elements(v_normalized) item
    group by item ->> 'sale_line_id', coalesce(item ->> 'tracking_unit_id', '')
    having count(*) > 1
  ) then
    raise exception using errcode = '23514', message = 'SALE_DELIVERY_LINES_DUPLICATE';
  end if;

  v_fingerprint := public.sales_request_fingerprint(jsonb_build_object(
    'sale_id', p_sale_id,
    'expected_version', p_expected_version,
    'delivery_lines', v_normalized
  ));
  insert into public.sales_command_requests (
    id, tenant_id, command_type, idempotency_key, request_fingerprint,
    created_by, delivery_sale_id, delivery_expected_version
  ) values (
    v_command_id, v_tenant_id, 'deliver', btrim(p_idempotency_key),
    v_fingerprint, v_actor_id, p_sale_id, p_expected_version
  ) on conflict (tenant_id, command_type, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    select * into v_command from public.sales_command_requests command_request
    where command_request.tenant_id = v_tenant_id
      and command_request.command_type = 'deliver'
      and command_request.idempotency_key = btrim(p_idempotency_key)
    for update;
    if v_command.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23514', message = 'SALES_IDEMPOTENCY_CONFLICT';
    end if;
    if v_command.result is null then
      raise exception using errcode = '40001', message = 'SALES_IDEMPOTENCY_IN_PROGRESS';
    end if;
    return v_command.result || jsonb_build_object('idempotent_replay', true);
  end if;

  if v_sale.status <> 'confirmed' then
    raise exception using errcode = '23514', message = 'SALE_NOT_CONFIRMED';
  end if;
  if p_expected_version is null or p_expected_version <> v_sale.version then
    raise exception using errcode = '40001', message = 'SALES_VERSION_CONFLICT';
  end if;
  v_snapshot := public.sale_delivery_snapshot(v_tenant_id, p_sale_id);
  if not coalesce((v_snapshot ->> 'eligible')::boolean, false) then
    raise exception using errcode = '23514',
      message = 'SALE_DELIVERY_NOT_ELIGIBLE:' || (v_snapshot -> 'blocking_reasons')::text;
  end if;
  v_reservation_id := (v_snapshot ->> 'reservation_id')::uuid;
  v_confirmation_id := (v_snapshot ->> 'confirmation_link_id')::uuid;
  if not exists (
    select 1 from public.inventory_reservations reservation
    where reservation.id = v_reservation_id and reservation.tenant_id = v_tenant_id
      and public.has_stock_location_access(reservation.location_id)
  ) then
    raise exception using errcode = '42501', message = 'SALE_DELIVERY_SCOPE_DENIED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_normalized) item
    left join public.sale_lines line
      on line.id = (item ->> 'sale_line_id')::uuid
     and line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
    left join public.product_products product
      on product.id = line.product_id and product.tenant_id = line.tenant_id
    left join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where line.id is null or template.product_type <> 'goods'
       or (line.tracking_requirement = 'serial' and (
         nullif(item ->> 'tracking_unit_id', '') is null
         or (item ->> 'quantity')::numeric <> 1
         or not exists (
           select 1 from public.sale_inventory_selections selection
           where selection.sale_id = p_sale_id
             and selection.sale_line_id = line.id
             and selection.tenant_id = v_tenant_id
             and selection.tracking_unit_id = (item ->> 'tracking_unit_id')::uuid
             and selection.quantity = 1
         )
         or exists (
           select 1 from public.sale_delivery_lines delivered
           where delivered.sale_id = p_sale_id
             and delivered.sale_line_id = line.id
             and delivered.tenant_id = v_tenant_id
             and delivered.tracking_unit_id = (item ->> 'tracking_unit_id')::uuid
         )
       ))
       or (line.tracking_requirement = 'none' and (
         nullif(item ->> 'tracking_unit_id', '') is not null
         or (item ->> 'quantity')::numeric >
           coalesce((select sum(selection.quantity)
             from public.sale_inventory_selections selection
             where selection.sale_id = p_sale_id
               and selection.sale_line_id = line.id
               and selection.tenant_id = v_tenant_id), 0)
           - coalesce((select sum(delivered.quantity)
             from public.sale_delivery_lines delivered
             where delivered.sale_id = p_sale_id
               and delivered.sale_line_id = line.id
               and delivered.tenant_id = v_tenant_id), 0)
       ))
       or line.tracking_requirement not in ('none', 'serial')
  ) then
    raise exception using errcode = '23514', message = 'SALE_DELIVERY_LINE_NOT_DELIVERABLE';
  end if;

  select jsonb_agg(jsonb_build_object(
    'reservation_line_id', mapped.reservation_line_id,
    'quantity', mapped.quantity
  ) order by mapped.reservation_line_id) into v_inventory_lines
  from (
    select reservation_line.id reservation_line_id,
      sum((item ->> 'quantity')::numeric) quantity
    from jsonb_array_elements(v_normalized) item
    join public.sale_lines sale_line
      on sale_line.id = (item ->> 'sale_line_id')::uuid
     and sale_line.sale_id = p_sale_id and sale_line.tenant_id = v_tenant_id
    join public.inventory_reservation_lines reservation_line
      on reservation_line.reservation_id = v_reservation_id
     and reservation_line.tenant_id = v_tenant_id
     and reservation_line.product_id = sale_line.product_id
     and reservation_line.tracking_unit_id is not distinct from
       nullif(item ->> 'tracking_unit_id', '')::uuid
    group by reservation_line.id
  ) mapped;
  if v_inventory_lines is null
     or (select sum((item ->> 'quantity')::numeric)
         from jsonb_array_elements(v_inventory_lines) item)
        <> (select sum((item ->> 'quantity')::numeric)
            from jsonb_array_elements(v_normalized) item) then
    raise exception using errcode = '23514', message = 'SALE_DELIVERY_RESERVATION_MAPPING_INVALID';
  end if;

  perform set_config('app.canonical_sales_delivery_command', v_command_id::text, true);
  v_inventory_result := public.commit_inventory_delivery(
    v_reservation_id,
    v_inventory_lines,
    'sale-deliver-' || encode(extensions.digest(
      v_tenant_id::text || ':' || btrim(p_idempotency_key), 'sha256'
    ), 'hex')
  );
  v_inventory_delivery_id := (v_inventory_result ->> 'delivery_id')::uuid;
  v_fulfillment_status := v_inventory_result ->> 'reservation_state';
  if v_fulfillment_status not in ('partially_delivered', 'delivered') then
    raise exception using errcode = '23514', message = 'SALE_DELIVERY_INVENTORY_STATE_INVALID';
  end if;

  v_new_version := v_sale.version + 1;
  perform set_config('app.canonical_sales_delivery_write', v_sale.id::text, true);
  insert into public.sale_deliveries (
    id, tenant_id, sale_id, confirmation_link_id, inventory_reservation_id,
    inventory_delivery_id, fulfillment_status, sale_version, delivered_by
  ) values (
    v_sale_delivery_id, v_tenant_id, v_sale.id, v_confirmation_id,
    v_reservation_id, v_inventory_delivery_id, v_fulfillment_status,
    v_new_version, v_actor_id
  );
  insert into public.sale_delivery_lines (
    tenant_id, sale_id, sale_delivery_id, sale_line_id,
    inventory_delivery_line_id, tracking_unit_id, quantity
  )
  select v_tenant_id, v_sale.id, v_sale_delivery_id,
    (item ->> 'sale_line_id')::uuid,
    inventory_line.id,
    nullif(item ->> 'tracking_unit_id', '')::uuid,
    (item ->> 'quantity')::numeric
  from jsonb_array_elements(v_normalized) item
  join public.sale_lines sale_line
    on sale_line.id = (item ->> 'sale_line_id')::uuid
   and sale_line.sale_id = v_sale.id and sale_line.tenant_id = v_tenant_id
  join public.inventory_reservation_lines reservation_line
    on reservation_line.reservation_id = v_reservation_id
   and reservation_line.tenant_id = v_tenant_id
   and reservation_line.product_id = sale_line.product_id
   and reservation_line.tracking_unit_id is not distinct from
     nullif(item ->> 'tracking_unit_id', '')::uuid
  join public.inventory_delivery_lines inventory_line
    on inventory_line.delivery_id = v_inventory_delivery_id
   and inventory_line.tenant_id = v_tenant_id
   and inventory_line.reservation_line_id = reservation_line.id;
  perform set_config('app.canonical_sales_delivery_write', '', true);

  update public.sales set version = v_new_version, updated_at = now()
  where id = v_sale.id and tenant_id = v_tenant_id
    and status = 'confirmed' and version = p_expected_version;
  if not found then
    raise exception using errcode = '40001', message = 'SALES_VERSION_CONFLICT';
  end if;
  insert into public.sale_events (
    tenant_id, sale_id, event_type, sale_version, actor_id, payload
  ) values (
    v_tenant_id, v_sale.id,
    case when v_fulfillment_status = 'delivered'
      then 'sale_delivered' else 'sale_partially_delivered' end,
    v_new_version, v_actor_id,
    jsonb_build_object(
      'sale_number', v_sale.sale_number,
      'branch_id', v_sale.branch_id,
      'delivered_quantity', (select sum((item ->> 'quantity')::numeric)
        from jsonb_array_elements(v_normalized) item),
      'fulfillment_status', v_fulfillment_status
    )
  );

  v_snapshot := public.sale_delivery_snapshot(v_tenant_id, p_sale_id);
  if v_snapshot ->> 'fulfillment_status' <> v_fulfillment_status
     or (v_snapshot -> 'blocking_reasons') ? 'SALE_FULFILLMENT_STATE_INCONSISTENT' then
    raise exception using errcode = '23514', message = 'SALE_DELIVERY_FINAL_STATE_INVALID';
  end if;
  v_result := jsonb_build_object(
    'sale_id', v_sale.id,
    'sale_number', v_sale.sale_number,
    'commercial_status', 'confirmed',
    'version', v_new_version,
    'fulfillment_status', v_fulfillment_status,
    'delivered_quantity', v_snapshot -> 'delivered_quantity',
    'remaining_quantity', v_snapshot -> 'remaining_quantity',
    'delivery_lines', v_normalized,
    'idempotent_replay', false
  );
  update public.sales_command_requests set result = v_result, completed_at = now()
  where id = v_command_id and tenant_id = v_tenant_id;
  perform set_config('app.canonical_sales_delivery_command', '', true);
  return v_result;
end
$$;

alter table public.sale_deliveries enable row level security;
alter table public.sale_delivery_lines enable row level security;
revoke all on public.sale_deliveries, public.sale_delivery_lines
  from public, anon, authenticated, service_role;

revoke all on function public.is_trusted_sales_delivery_context(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sale_delivery_snapshot(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.guard_sale_delivery_artifact()
  from public, anon, authenticated, service_role;
revoke all on function public.get_sale_delivery_eligibility(uuid)
  from public, anon, service_role;
grant execute on function public.get_sale_delivery_eligibility(uuid)
  to authenticated;
revoke all on function public.deliver_sale(uuid, bigint, jsonb, text)
  from public, anon, service_role;
grant execute on function public.deliver_sale(uuid, bigint, jsonb, text)
  to authenticated;

comment on table public.sale_deliveries is
  'Immutable typed links from Canonical Sales fulfillment transitions to Inventory Core deliveries.';
comment on table public.sale_delivery_lines is
  'Business allocation of Inventory delivery quantities/serials back to immutable Canonical Sale lines.';
comment on function public.get_sale_delivery_eligibility(uuid) is
  'Business-safe server-side delivery eligibility and derived fulfillment read model; exposes no Inventory implementation identifiers.';
comment on function public.deliver_sale(uuid, bigint, jsonb, text) is
  'Atomic Canonical Sales delivery orchestration over Inventory Core. Supports safe partial/full delivery; creates no financial effects.';
comment on function public.is_trusted_sales_delivery_context(uuid, uuid) is
  'Private unresolved-command capability allowing Sales delivery to invoke Inventory Core without granting general Inventory delivery permission.';

notify pgrst, 'reload schema';

commit;
