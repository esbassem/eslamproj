begin;

-- Exchange is orchestration over an immutable original Sale, a canonical
-- Return, and an ordinary replacement Sale Draft. It owns no stock or ledger
-- mutations of its own.
insert into public.auth_permissions (
  code, name, description, resource, action,
  module_code, permission_type, sort_order, active
)
values (
  'sales.exchange', 'استبدال المبيعات',
  'بدء استبدال Canonical عبر مرتجع وبيع بديل مستقل.',
  'sales', 'exchange', 'sales', 'action', 170, true
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  resource = excluded.resource,
  action = excluded.action,
  module_code = excluded.module_code,
  permission_type = excluded.permission_type,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = now();

create table public.sale_exchange_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  original_sale_id uuid not null,
  expected_version bigint not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  result jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint sale_exchange_commands_sale_fkey
    foreign key (original_sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  constraint sale_exchange_commands_actor_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sale_exchange_commands_unique unique (tenant_id, idempotency_key),
  constraint sale_exchange_commands_id_tenant_unique unique (id, tenant_id),
  constraint sale_exchange_commands_version_check check (expected_version > 0),
  constraint sale_exchange_commands_key_check
    check (length(btrim(idempotency_key)) between 1 and 160),
  constraint sale_exchange_commands_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint sale_exchange_commands_lifecycle_check check (
    (result is null and completed_at is null)
    or (result is not null and completed_at is not null)
  )
);

create table public.sale_exchanges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  original_sale_id uuid not null,
  sale_return_id uuid,
  replacement_sale_id uuid,
  command_id uuid not null,
  status text not null default 'initiated',
  reason text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sale_exchanges_original_sale_fkey
    foreign key (original_sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  constraint sale_exchanges_return_fkey
    foreign key (sale_return_id, tenant_id)
    references public.sale_returns(id, tenant_id) on delete restrict,
  constraint sale_exchanges_replacement_sale_fkey
    foreign key (replacement_sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  constraint sale_exchanges_command_fkey
    foreign key (command_id, tenant_id)
    references public.sale_exchange_commands(id, tenant_id) on delete restrict,
  constraint sale_exchanges_actor_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sale_exchanges_id_tenant_unique unique (id, tenant_id),
  constraint sale_exchanges_return_unique unique (tenant_id, sale_return_id),
  constraint sale_exchanges_replacement_unique unique (tenant_id, replacement_sale_id),
  constraint sale_exchanges_command_unique unique (tenant_id, command_id),
  constraint sale_exchanges_not_self_check check (
    replacement_sale_id is null or replacement_sale_id <> original_sale_id
  ),
  constraint sale_exchanges_reason_check
    check (length(btrim(reason)) between 1 and 1000),
  constraint sale_exchanges_status_check check (status in (
    'initiated', 'return_completed', 'replacement_draft',
    'replacement_confirmed', 'completed',
    'return_completed_replacement_cancelled'
  )),
  constraint sale_exchanges_lifecycle_check check (
    (status = 'initiated' and sale_return_id is null and replacement_sale_id is null)
    or (status = 'return_completed' and sale_return_id is not null and replacement_sale_id is null)
    or (status not in ('initiated', 'return_completed')
      and sale_return_id is not null and replacement_sale_id is not null)
  )
);

create table public.sale_exchange_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_exchange_id uuid not null,
  line_role text not null,
  original_sale_line_id uuid,
  sale_return_line_id uuid,
  replacement_sale_line_id uuid,
  tracking_unit_id uuid,
  quantity numeric(18,4) not null,
  created_at timestamptz not null default now(),
  constraint sale_exchange_lines_exchange_fkey
    foreign key (sale_exchange_id, tenant_id)
    references public.sale_exchanges(id, tenant_id) on delete restrict,
  constraint sale_exchange_lines_original_line_fkey
    foreign key (original_sale_line_id, tenant_id)
    references public.sale_lines(id, tenant_id) on delete restrict,
  constraint sale_exchange_lines_return_line_fkey
    foreign key (sale_return_line_id, tenant_id)
    references public.sale_return_lines(id, tenant_id) on delete restrict,
  constraint sale_exchange_lines_replacement_line_fkey
    foreign key (replacement_sale_line_id, tenant_id)
    references public.sale_lines(id, tenant_id) on delete restrict,
  constraint sale_exchange_lines_tracking_fkey
    foreign key (tracking_unit_id, tenant_id)
    references public.stock_tracking_units(id, tenant_id) on delete restrict,
  constraint sale_exchange_lines_id_tenant_unique unique (id, tenant_id),
  constraint sale_exchange_lines_quantity_check
    check (quantity > 0 and quantity = round(quantity, 4)),
  constraint sale_exchange_lines_role_check check (line_role in ('returned', 'replacement')),
  constraint sale_exchange_lines_shape_check check (
    (line_role = 'returned' and original_sale_line_id is not null
      and sale_return_line_id is not null and replacement_sale_line_id is null)
    or (line_role = 'replacement' and original_sale_line_id is null
      and sale_return_line_id is null and replacement_sale_line_id is not null
      and tracking_unit_id is null)
  )
);

create index sale_exchanges_original_idx
  on public.sale_exchanges (tenant_id, original_sale_id, created_at desc);
create index sale_exchange_lines_exchange_idx
  on public.sale_exchange_lines (tenant_id, sale_exchange_id, line_role);

-- The previous cancellation hardening accidentally rejected the operational
-- version bumps used by Delivery, Return, Refund and Exchange. Keep every
-- confirmed commercial field immutable and permit only a one-step version bump
-- plus updated_at when the commercial status remains confirmed.
create or replace function public.guard_canonical_sale_header()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if current_user in ('postgres', 'supabase_admin')
       and current_setting('app.canonical_sales_maintenance', true) = 'authorized' then
      return old;
    end if;
    raise exception using errcode = '42501', message = 'CANONICAL_SALE_DELETE_FORBIDDEN';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.sale_number is not null or new.version <> 1
       or new.confirmed_by is not null or new.confirmed_at is not null
       or new.cancelled_by is not null or new.cancelled_at is not null then
      raise exception using errcode = '23514', message = 'CANONICAL_SALE_INITIAL_STATE_INVALID';
    end if;
    return new;
  end if;
  if old.sale_number is not null and new.sale_number is distinct from old.sale_number then
    raise exception using errcode = '23514', message = 'CANONICAL_SALE_NUMBER_IMMUTABLE';
  end if;
  if old.status = 'cancelled' and new is distinct from old then
    raise exception using errcode = '23514', message = 'CANONICAL_SALE_COMMERCIAL_STATE_IMMUTABLE';
  end if;
  if old.status = 'confirmed' and new.status = 'confirmed' then
    if (new.id, new.tenant_id, new.branch_id, new.customer_id, new.sale_number,
        new.effective_sale_date, new.currency_code, new.total_amount, new.notes,
        new.create_idempotency_key, new.create_request_fingerprint,
        new.created_by, new.confirmed_by, new.confirmed_at,
        new.cancelled_by, new.cancelled_at, new.created_at)
       is distinct from
       (old.id, old.tenant_id, old.branch_id, old.customer_id, old.sale_number,
        old.effective_sale_date, old.currency_code, old.total_amount, old.notes,
        old.create_idempotency_key, old.create_request_fingerprint,
        old.created_by, old.confirmed_by, old.confirmed_at,
        old.cancelled_by, old.cancelled_at, old.created_at)
       or new.version <> old.version + 1
       or new.updated_at < old.updated_at then
      raise exception using errcode = '23514', message = 'CANONICAL_SALE_COMMERCIAL_STATE_IMMUTABLE';
    end if;
    return new;
  end if;
  if old.status = 'confirmed' and new.status = 'cancelled' then
    if current_setting('app.canonical_sales_transition', true) is distinct from old.id::text
       or (new.id, new.tenant_id, new.branch_id, new.customer_id, new.sale_number,
           new.effective_sale_date, new.currency_code, new.total_amount, new.notes,
           new.create_idempotency_key, new.create_request_fingerprint,
           new.created_by, new.confirmed_by, new.confirmed_at, new.created_at)
          is distinct from
          (old.id, old.tenant_id, old.branch_id, old.customer_id, old.sale_number,
           old.effective_sale_date, old.currency_code, old.total_amount, old.notes,
           old.create_idempotency_key, old.create_request_fingerprint,
           old.created_by, old.confirmed_by, old.confirmed_at, old.created_at)
       or new.cancelled_by is null or new.cancelled_at is null
       or new.version <> old.version + 1 then
      raise exception using errcode = '23514', message = 'CANONICAL_SALE_COMMERCIAL_STATE_IMMUTABLE';
    end if;
    return new;
  end if;
  if old.status = 'confirmed' then
    raise exception using errcode = '23514', message = 'CANONICAL_SALE_COMMERCIAL_STATE_IMMUTABLE';
  end if;
  if new.status is distinct from old.status then
    if current_setting('app.canonical_sales_transition', true) is distinct from old.id::text
       or not (old.status = 'draft' and new.status in ('confirmed', 'cancelled'))
       or new.version <> old.version + 1 then
      raise exception using errcode = '42501', message = 'CANONICAL_SALE_STATUS_COMMAND_REQUIRED';
    end if;
    if new.status = 'confirmed' and (
      new.sale_number is null or new.confirmed_by is null or new.confirmed_at is null
      or new.cancelled_by is not null or new.cancelled_at is not null
    ) then
      raise exception using errcode = '23514', message = 'CANONICAL_SALE_CONFIRMATION_FIELDS_REQUIRED';
    end if;
    if new.status = 'cancelled' and (new.cancelled_by is null or new.cancelled_at is null) then
      raise exception using errcode = '23514', message = 'CANONICAL_SALE_CANCELLATION_FIELDS_REQUIRED';
    end if;
  elsif old.status = 'draft' and new.sale_number is not null then
    raise exception using errcode = '23514', message = 'DRAFT_SALE_NUMBER_FORBIDDEN';
  end if;
  return new;
end
$$;

alter table public.sale_events
  drop constraint sale_events_type_check,
  add constraint sale_events_type_check check (event_type in (
    'sale_created', 'sale_draft_updated', 'sale_confirmed', 'sale_cancelled',
    'delivery_requested', 'delivery_linked', 'return_initiated',
    'sale_partially_delivered', 'sale_delivered', 'sale_returned',
    'customer_refund_created', 'sale_exchange_started'
  ));

create or replace function public.sale_exchange_derived_status(
  p_tenant_id uuid,
  p_replacement_sale_id uuid
)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when replacement.status = 'draft' then 'replacement_draft'
    when replacement.status = 'cancelled' then 'return_completed_replacement_cancelled'
    when replacement.status = 'confirmed'
      and not exists (
        select 1
        from public.sale_lines line
        join public.product_products product
          on product.id = line.product_id and product.tenant_id = line.tenant_id
        join public.product_templates template
          on template.id = product.product_template_id and template.tenant_id = product.tenant_id
        where line.sale_id = replacement.id and line.tenant_id = replacement.tenant_id
          and template.product_type = 'goods'
          and coalesce((
            select sum(delivered.quantity)
            from public.sale_delivery_lines delivered
            where delivered.sale_line_id = line.id and delivered.tenant_id = line.tenant_id
          ), 0) < line.quantity
      )
      and coalesce((
        select receivable.amount_residual
        from public.sale_confirmation_links confirmation
        join public.financial_sale_postings posting
          on posting.id = confirmation.financial_sale_posting_id
         and posting.tenant_id = confirmation.tenant_id
        join public.account_move_lines receivable
          on receivable.id = posting.receivable_line_id
         and receivable.tenant_id = posting.tenant_id
        where confirmation.sale_id = replacement.id
          and confirmation.tenant_id = replacement.tenant_id
      ), replacement.total_amount) <= 0
      then 'completed'
    when replacement.status = 'confirmed' then 'replacement_confirmed'
    else 'replacement_draft'
  end
  from public.sales replacement
  where replacement.id = p_replacement_sale_id
    and replacement.tenant_id = p_tenant_id
$$;

create or replace function public.get_sale_exchange_eligibility(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_sale public.sales%rowtype;
  v_return jsonb;
  v_exchange_permission boolean;
  v_dependent_permissions boolean;
  v_blockers jsonb := '[]'::jsonb;
begin
  if v_tenant is null or public.current_tenant_user_id() is null
     or not public.has_permission('sales.access', v_tenant)
     or not public.has_permission('sales.view', v_tenant) then
    raise exception using errcode = '42501', message = 'SALES_EXCHANGE_VIEW_DENIED';
  end if;
  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = v_tenant;
  if not found then raise exception using errcode = 'P0002', message = 'SALE_NOT_FOUND'; end if;
  if not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '42501', message = 'SALE_EXCHANGE_SCOPE_DENIED';
  end if;

  v_exchange_permission := public.has_permission('sales.exchange', v_tenant);
  v_dependent_permissions := public.has_permission('sales.return', v_tenant)
    and public.has_permission('sales.create', v_tenant)
    and public.has_permission('sales.update_draft', v_tenant);
  if v_sale.status <> 'confirmed' then
    v_blockers := v_blockers || jsonb_build_array('SALE_NOT_CONFIRMED');
  elsif not v_exchange_permission then
    v_blockers := v_blockers || jsonb_build_array('SALES_EXCHANGE_DENIED');
  elsif not v_dependent_permissions then
    v_blockers := v_blockers || jsonb_build_array('SALE_EXCHANGE_DEPENDENT_PERMISSION_MISSING');
  else
    v_return := public.get_sale_return_eligibility(p_sale_id);
    if not coalesce((v_return ->> 'can_return')::boolean, false) then
      v_blockers := coalesce(v_return -> 'blocking_reasons', '[]'::jsonb);
    end if;
  end if;

  return jsonb_build_object(
    'sale_id', v_sale.id,
    'sale_number', v_sale.sale_number,
    'expected_version', v_sale.version,
    'currency_code', v_sale.currency_code,
    'customer', jsonb_build_object(
      'id', v_sale.customer_id,
      'name', (select customer.name from public.partners customer
        where customer.id = v_sale.customer_id and customer.tenant_id = v_tenant)
    ),
    'branch', jsonb_build_object(
      'id', v_sale.branch_id,
      'name', (select branch.name from public.branches branch
        where branch.id = v_sale.branch_id and branch.tenant_id = v_tenant)
    ),
    'permission_granted', v_exchange_permission,
    'dependent_permissions_granted', v_dependent_permissions,
    'can_exchange', jsonb_array_length(v_blockers) = 0
      and coalesce((v_return ->> 'can_return')::boolean, false),
    'blocking_reasons', v_blockers,
    'return_eligibility', v_return,
    'replacement_locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', location.id, 'name', location.name, 'code', location.code
      ) order by location.name, location.id)
      from public.stock_locations location
      where location.tenant_id = v_tenant and location.branch_id = v_sale.branch_id
        and location.is_active and public.has_stock_location_access(location.id)
    ), '[]'::jsonb),
    'source_exchange', (
      select jsonb_build_object(
        'id', exchange.id,
        'status', public.sale_exchange_derived_status(v_tenant, exchange.replacement_sale_id),
        'original_sale_id', original.id,
        'original_sale_number', original.sale_number,
        'return_number', sale_return.return_number,
        'reason', exchange.reason,
        'created_at', exchange.created_at
      )
      from public.sale_exchanges exchange
      join public.sales original on original.id = exchange.original_sale_id
        and original.tenant_id = exchange.tenant_id
      join public.sale_returns sale_return on sale_return.id = exchange.sale_return_id
        and sale_return.tenant_id = exchange.tenant_id
      where exchange.replacement_sale_id = v_sale.id and exchange.tenant_id = v_tenant
    ),
    'exchanges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', exchange.id,
        'status', public.sale_exchange_derived_status(v_tenant, exchange.replacement_sale_id),
        'reason', exchange.reason,
        'created_at', exchange.created_at,
        'return_id', sale_return.id,
        'return_number', sale_return.return_number,
        'return_amount', sale_return.total_amount,
        'replacement_sale_id', replacement.id,
        'replacement_sale_number', replacement.sale_number,
        'replacement_status', replacement.status,
        'replacement_total', replacement.total_amount,
        'returned_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'description', original_line.description,
            'quantity', exchange_line.quantity,
            'tracking_number', unit.tracking_number,
            'chassis_number', coalesce(chassis.value, unit.tracking_number),
            'engine_number', engine.value
          ) order by original_line.line_position, exchange_line.id)
          from public.sale_exchange_lines exchange_line
          join public.sale_lines original_line
            on original_line.id = exchange_line.original_sale_line_id
           and original_line.tenant_id = exchange_line.tenant_id
          left join public.stock_tracking_units unit
            on unit.id = exchange_line.tracking_unit_id
           and unit.tenant_id = exchange_line.tenant_id
          left join lateral (
            select identifier.value
            from public.stock_tracking_unit_identifiers identifier
            join public.product_tracking_identifier_types kind
              on kind.id = identifier.identifier_type_id
             and kind.tenant_id = identifier.tenant_id
            where identifier.tracking_unit_id = unit.id
              and identifier.tenant_id = unit.tenant_id
              and not identifier.is_not_available
              and (kind.code || ' ' || kind.name) ~* '(chassis|شاسيه)'
            order by identifier.created_at, identifier.id limit 1
          ) chassis on true
          left join lateral (
            select identifier.value
            from public.stock_tracking_unit_identifiers identifier
            join public.product_tracking_identifier_types kind
              on kind.id = identifier.identifier_type_id
             and kind.tenant_id = identifier.tenant_id
            where identifier.tracking_unit_id = unit.id
              and identifier.tenant_id = unit.tenant_id
              and not identifier.is_not_available
              and (kind.code || ' ' || kind.name) ~* '(engine|motor|موتور|محرك)'
            order by identifier.created_at, identifier.id limit 1
          ) engine on true
          where exchange_line.sale_exchange_id = exchange.id
            and exchange_line.tenant_id = exchange.tenant_id
            and exchange_line.line_role = 'returned'
        ), '[]'::jsonb)
      ) order by exchange.created_at desc, exchange.id desc)
      from public.sale_exchanges exchange
      join public.sale_returns sale_return on sale_return.id = exchange.sale_return_id
        and sale_return.tenant_id = exchange.tenant_id
      join public.sales replacement on replacement.id = exchange.replacement_sale_id
        and replacement.tenant_id = exchange.tenant_id
      where exchange.original_sale_id = v_sale.id and exchange.tenant_id = v_tenant
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.start_sale_exchange(
  p_original_sale_id uuid,
  p_expected_version bigint,
  p_return_lines jsonb,
  p_replacement_lines jsonb,
  p_return_destination_location_id uuid,
  p_replacement_location_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_actor uuid := public.current_tenant_user_id();
  v_original public.sales%rowtype;
  v_command public.sale_exchange_commands%rowtype;
  v_command_id uuid := gen_random_uuid();
  v_exchange_id uuid := gen_random_uuid();
  v_reason text := nullif(btrim(p_reason), '');
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_item jsonb;
  v_product record;
  v_product_id uuid;
  v_tracking_unit_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_description text;
  v_position integer := 0;
  v_has_goods boolean := false;
  v_draft_lines jsonb := '[]'::jsonb;
  v_inventory_intents jsonb := '[]'::jsonb;
  v_fingerprint text;
  v_return_result jsonb;
  v_create_result jsonb;
  v_update_result jsonb;
  v_replacement_sale_id uuid;
  v_replacement_total numeric(18,2);
  v_original_version bigint;
  v_result jsonb;
begin
  if v_tenant is null or v_actor is null
     or not public.has_permission('sales.access', v_tenant)
     or not public.has_permission('sales.view', v_tenant)
     or not public.has_permission('sales.exchange', v_tenant) then
    raise exception using errcode = '42501', message = 'SALES_EXCHANGE_DENIED';
  end if;
  if not public.has_permission('sales.return', v_tenant)
     or not public.has_permission('sales.create', v_tenant)
     or not public.has_permission('sales.update_draft', v_tenant) then
    raise exception using errcode = '42501', message = 'SALE_EXCHANGE_DEPENDENT_PERMISSION_MISSING';
  end if;
  if v_reason is null or length(v_reason) > 1000
     or v_key is null or length(v_key) > 160 then
    raise exception using errcode = '22023', message = 'SALE_EXCHANGE_INPUT_INVALID';
  end if;
  if jsonb_typeof(p_return_lines) <> 'array' or jsonb_array_length(p_return_lines) = 0
     or jsonb_array_length(p_return_lines) > 200
     or jsonb_typeof(p_replacement_lines) <> 'array'
     or jsonb_array_length(p_replacement_lines) = 0
     or jsonb_array_length(p_replacement_lines) > 200 then
    raise exception using errcode = '22023', message = 'SALE_EXCHANGE_LINES_INVALID';
  end if;

  select * into v_original from public.sales sale
  where sale.id = p_original_sale_id and sale.tenant_id = v_tenant
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'SALE_NOT_FOUND'; end if;
  if not public.has_branch_access(v_original.branch_id) then
    raise exception using errcode = '42501', message = 'SALE_EXCHANGE_SCOPE_DENIED';
  end if;

  -- Claim/replay before consulting mutable product or location configuration.
  -- A completed request stays replayable if catalog settings later change.
  v_fingerprint := public.sales_request_fingerprint(jsonb_build_object(
    'original_sale_id', p_original_sale_id,
    'expected_version', p_expected_version,
    'return_lines', p_return_lines,
    'replacement_lines', p_replacement_lines,
    'return_destination_location_id', p_return_destination_location_id,
    'replacement_location_id', p_replacement_location_id,
    'reason', v_reason
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'sale_exchange:' || v_tenant::text || ':' || v_key, 0
  ));
  select * into v_command from public.sale_exchange_commands command
  where command.tenant_id = v_tenant and command.idempotency_key = v_key
  for update;
  if found then
    if v_command.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'SALE_EXCHANGE_IDEMPOTENCY_CONFLICT';
    end if;
    if v_command.result is null then
      raise exception using errcode = '40001', message = 'SALES_IDEMPOTENCY_IN_PROGRESS';
    end if;
    return v_command.result || jsonb_build_object('idempotent_replay', true);
  end if;

  for v_item in select value from jsonb_array_elements(p_replacement_lines) loop
    if jsonb_typeof(v_item) <> 'object'
       or v_item - array['product_id', 'description', 'quantity', 'unit_price', 'tracking_unit_id'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'SALE_EXCHANGE_REPLACEMENT_LINE_INVALID';
    end if;
    begin
      v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
      v_tracking_unit_id := nullif(v_item ->> 'tracking_unit_id', '')::uuid;
      v_quantity := (v_item ->> 'quantity')::numeric;
      v_unit_price := (v_item ->> 'unit_price')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'SALE_EXCHANGE_REPLACEMENT_LINE_INVALID';
    end;
    if v_product_id is null or v_quantity is null or v_quantity <= 0
       or v_quantity <> round(v_quantity, 4)
       or v_unit_price is null or v_unit_price < 0
       or v_unit_price <> round(v_unit_price, 2) then
      raise exception using errcode = '22023', message = 'SALE_EXCHANGE_REPLACEMENT_LINE_INVALID';
    end if;
    select product.id, product.display_name, product.tracking,
      product.is_active product_active, template.is_active template_active,
      template.can_be_sold, template.product_type
    into v_product
    from public.product_products product
    join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where product.id = v_product_id and product.tenant_id = v_tenant;
    if not found or not v_product.product_active or not v_product.template_active
       or not v_product.can_be_sold or v_product.tracking = 'lot' then
      raise exception using errcode = '23514', message = 'SALE_EXCHANGE_PRODUCT_NOT_SELLABLE';
    end if;
    v_description := coalesce(nullif(btrim(v_item ->> 'description'), ''), v_product.display_name);
    if length(v_description) > 500 then
      raise exception using errcode = '22023', message = 'SALE_EXCHANGE_REPLACEMENT_LINE_INVALID';
    end if;
    v_position := v_position + 1;
    v_draft_lines := v_draft_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id, 'description', v_description,
      'quantity', v_quantity, 'unit_price', v_unit_price
    ));
    if v_product.product_type = 'service' then
      if v_tracking_unit_id is not null then
        raise exception using errcode = '23514', message = 'SALE_EXCHANGE_SERVICE_HAS_NO_INVENTORY';
      end if;
    else
      v_has_goods := true;
      if v_product.tracking = 'serial' then
        if v_quantity <> 1 or v_tracking_unit_id is null then
          raise exception using errcode = '23514', message = 'SALE_EXCHANGE_SERIAL_SELECTION_REQUIRED';
        end if;
      elsif v_product.tracking = 'none' and v_tracking_unit_id is not null then
        raise exception using errcode = '23514', message = 'SALE_EXCHANGE_QUANTITY_TRACKING_INVALID';
      end if;
      v_inventory_intents := v_inventory_intents || jsonb_build_array(jsonb_build_object(
        'line_position', v_position,
        'location_id', p_replacement_location_id,
        'tracking_unit_id', v_tracking_unit_id,
        'quantity', v_quantity
      ));
    end if;
  end loop;
  if v_has_goods and (p_replacement_location_id is null or not exists (
    select 1 from public.stock_locations location
    where location.id = p_replacement_location_id and location.tenant_id = v_tenant
      and location.branch_id = v_original.branch_id and location.is_active
      and public.has_stock_location_access(location.id)
  )) then
    raise exception using errcode = '42501', message = 'SALE_EXCHANGE_REPLACEMENT_LOCATION_DENIED';
  end if;
  if not v_has_goods and p_replacement_location_id is not null then
    raise exception using errcode = '23514', message = 'SALE_EXCHANGE_SERVICE_LOCATION_NOT_ALLOWED';
  end if;

  if v_original.status <> 'confirmed' then
    raise exception using errcode = '23514', message = 'SALE_NOT_CONFIRMED';
  end if;
  if p_expected_version is null or p_expected_version <> v_original.version then
    raise exception using errcode = '40001', message = 'SALES_VERSION_CONFLICT';
  end if;

  insert into public.sale_exchange_commands (
    id, tenant_id, original_sale_id, expected_version,
    idempotency_key, request_fingerprint, created_by
  ) values (
    v_command_id, v_tenant, p_original_sale_id, p_expected_version,
    v_key, v_fingerprint, v_actor
  );
  insert into public.sale_exchanges (
    id, tenant_id, original_sale_id, command_id, status, reason, created_by
  ) values (
    v_exchange_id, v_tenant, p_original_sale_id, v_command_id,
    'initiated', v_reason, v_actor
  );

  v_return_result := public.return_sale(
    p_original_sale_id, p_expected_version, p_return_lines,
    p_return_destination_location_id, v_reason,
    'exchange-return:' || v_exchange_id::text
  );
  update public.sale_exchanges set
    sale_return_id = (v_return_result ->> 'return_id')::uuid,
    status = 'return_completed', updated_at = now()
  where id = v_exchange_id and tenant_id = v_tenant;

  v_create_result := public.create_sale(
    v_original.branch_id, v_original.customer_id, current_date,
    v_original.currency_code,
    'بيع بديل للاستبدال المرتبط بالبيع ' || coalesce(v_original.sale_number, v_original.id::text),
    'exchange-create:' || v_exchange_id::text
  );
  v_replacement_sale_id := (v_create_result ->> 'sale_id')::uuid;
  v_update_result := public.update_sale_draft(
    v_replacement_sale_id, (v_create_result ->> 'version')::bigint,
    v_original.branch_id, v_original.customer_id, current_date,
    v_original.currency_code,
    'بيع بديل للاستبدال المرتبط بالبيع ' || coalesce(v_original.sale_number, v_original.id::text),
    v_draft_lines, 'exchange-update:' || v_exchange_id::text,
    v_inventory_intents
  );

  update public.sale_exchanges set
    replacement_sale_id = v_replacement_sale_id,
    status = 'replacement_draft', updated_at = now()
  where id = v_exchange_id and tenant_id = v_tenant;

  insert into public.sale_exchange_lines (
    tenant_id, sale_exchange_id, line_role, original_sale_line_id,
    sale_return_line_id, tracking_unit_id, quantity
  )
  select v_tenant, v_exchange_id, 'returned', returned.sale_line_id,
    returned.id, returned.tracking_unit_id, returned.quantity
  from public.sale_return_lines returned
  where returned.sale_return_id = (v_return_result ->> 'return_id')::uuid
    and returned.tenant_id = v_tenant;
  insert into public.sale_exchange_lines (
    tenant_id, sale_exchange_id, line_role, replacement_sale_line_id, quantity
  )
  select v_tenant, v_exchange_id, 'replacement', line.id, line.quantity
  from public.sale_lines line
  where line.sale_id = v_replacement_sale_id and line.tenant_id = v_tenant;

  select total_amount into v_replacement_total from public.sales sale
  where sale.id = v_replacement_sale_id and sale.tenant_id = v_tenant;
  update public.sales set version = version + 1, updated_at = now()
  where id = p_original_sale_id and tenant_id = v_tenant
  returning version into v_original_version;
  insert into public.sale_events (
    tenant_id, sale_id, event_type, sale_version, actor_id, payload
  ) values (
    v_tenant, p_original_sale_id, 'sale_exchange_started', v_original_version, v_actor,
    jsonb_build_object(
      'exchange_id', v_exchange_id,
      'return_number', v_return_result ->> 'return_number',
      'replacement_status', 'draft',
      'returned_amount', (v_return_result ->> 'amount')::numeric,
      'replacement_total', v_replacement_total
    )
  );
  v_result := jsonb_build_object(
    'exchange_id', v_exchange_id,
    'status', 'replacement_draft',
    'original_sale_id', p_original_sale_id,
    'original_sale_number', v_original.sale_number,
    'return_id', v_return_result ->> 'return_id',
    'return_number', v_return_result ->> 'return_number',
    'returned_amount', (v_return_result ->> 'amount')::numeric,
    'customer_credit_amount', (v_return_result ->> 'refundable_amount')::numeric,
    'replacement_sale_id', v_replacement_sale_id,
    'replacement_sale_number', null,
    'replacement_sale_version', (v_update_result ->> 'version')::bigint,
    'replacement_total', v_replacement_total,
    'estimated_difference', round(v_replacement_total - (v_return_result ->> 'amount')::numeric, 2),
    'original_sale_version', v_original_version,
    'idempotent_replay', false
  );
  update public.sale_exchange_commands set result = v_result, completed_at = now()
  where id = v_command_id and tenant_id = v_tenant;
  return v_result;
end
$$;

alter table public.sale_exchange_commands enable row level security;
alter table public.sale_exchanges enable row level security;
alter table public.sale_exchange_lines enable row level security;

revoke all on public.sale_exchange_commands, public.sale_exchanges,
  public.sale_exchange_lines from public, anon, authenticated, service_role;
grant select on public.sale_exchanges, public.sale_exchange_lines to authenticated;

create policy sale_exchanges_read on public.sale_exchanges
for select to authenticated using (
  public.sale_exchanges.tenant_id = public.current_tenant_id()
  and public.has_permission('sales.access', public.sale_exchanges.tenant_id)
  and public.has_permission('sales.view', public.sale_exchanges.tenant_id)
  and exists (
    select 1 from public.sales sale
    where sale.id = public.sale_exchanges.original_sale_id
      and sale.tenant_id = public.sale_exchanges.tenant_id
      and public.has_branch_access(sale.branch_id)
  )
);
create policy sale_exchange_lines_read on public.sale_exchange_lines
for select to authenticated using (
  exists (
    select 1 from public.sale_exchanges exchange
    join public.sales sale on sale.id = exchange.original_sale_id
      and sale.tenant_id = exchange.tenant_id
    where exchange.id = public.sale_exchange_lines.sale_exchange_id
      and exchange.tenant_id = public.sale_exchange_lines.tenant_id
      and exchange.tenant_id = public.current_tenant_id()
      and public.has_permission('sales.access', exchange.tenant_id)
      and public.has_permission('sales.view', exchange.tenant_id)
      and public.has_branch_access(sale.branch_id)
  )
);

revoke all on function public.sale_exchange_derived_status(uuid,uuid),
  public.get_sale_exchange_eligibility(uuid),
  public.start_sale_exchange(uuid,bigint,jsonb,jsonb,uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.get_sale_exchange_eligibility(uuid),
  public.start_sale_exchange(uuid,bigint,jsonb,jsonb,uuid,uuid,text,text)
  to authenticated;

comment on table public.sale_exchanges is
  'Durable relationship between an original Sale, its canonical Return, and an ordinary replacement Sale.';
comment on function public.start_sale_exchange(uuid,bigint,jsonb,jsonb,uuid,uuid,text,text) is
  'Atomically orchestrates existing Return and Sale Draft commands; it performs no direct stock, accounting, settlement or refund mutation.';

commit;
