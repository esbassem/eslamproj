begin;

insert into public.auth_permissions (code, name, description, resource, action, active)
values (
  'sales.confirm', 'تأكيد المبيعات',
  'تأكيد عقد بيع Canonical وحجز مخزونه وترحيله ماليًا.',
  'sales', 'confirm', true
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  resource = excluded.resource,
  action = excluded.action,
  active = true,
  updated_at = now();

alter table public.sales_command_requests
  add column confirmation_sale_id uuid,
  add column confirmation_expected_version bigint,
  add constraint sales_command_confirmation_sale_fkey
    foreign key (confirmation_sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  add constraint sales_command_confirmation_context_check check (
    (command_type = 'confirm'
      and confirmation_sale_id is not null
      and confirmation_expected_version is not null
      and confirmation_expected_version > 0)
    or
    (command_type <> 'confirm'
      and confirmation_sale_id is null
      and confirmation_expected_version is null)
  );

alter table public.sales_command_requests
  drop constraint sales_command_requests_type_check,
  add constraint sales_command_requests_type_check
    check (command_type in ('create', 'update_draft', 'confirm'));

create unique index sale_lines_confirmation_identity
  on public.sale_lines (id, tenant_id, sale_id);

create table public.sale_inventory_selections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  sale_line_id uuid not null,
  location_id uuid not null,
  selection_type text not null,
  tracking_unit_id uuid,
  quantity numeric(18,4) not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint sale_inventory_selections_sale_fkey
    foreign key (sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  constraint sale_inventory_selections_line_fkey
    foreign key (sale_line_id, tenant_id, sale_id)
    references public.sale_lines(id, tenant_id, sale_id) on delete restrict,
  constraint sale_inventory_selections_location_fkey
    foreign key (location_id, tenant_id)
    references public.stock_locations(id, tenant_id) on delete restrict,
  constraint sale_inventory_selections_tracking_fkey
    foreign key (tracking_unit_id, tenant_id)
    references public.stock_tracking_units(id, tenant_id) on delete restrict,
  constraint sale_inventory_selections_actor_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sale_inventory_selections_type_check
    check (selection_type in ('serial', 'quantity')),
  constraint sale_inventory_selections_quantity_check
    check (quantity > 0 and quantity = round(quantity, 4)),
  constraint sale_inventory_selections_shape_check check (
    (selection_type = 'serial' and tracking_unit_id is not null and quantity = 1)
    or (selection_type = 'quantity' and tracking_unit_id is null)
  ),
  constraint sale_inventory_selections_line_unit_unique
    unique nulls not distinct (sale_id, sale_line_id, tracking_unit_id),
  constraint sale_inventory_selections_id_tenant_unique unique (id, tenant_id)
);

create index sale_inventory_selections_sale_idx
  on public.sale_inventory_selections (tenant_id, sale_id, sale_line_id);

create table public.sale_confirmation_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  inventory_reservation_id uuid,
  financial_sale_posting_id uuid not null,
  financial_engine_binding_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint sale_confirmation_links_sale_fkey
    foreign key (sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  constraint sale_confirmation_links_reservation_fkey
    foreign key (inventory_reservation_id, tenant_id)
    references public.inventory_reservations(id, tenant_id) on delete restrict,
  constraint sale_confirmation_links_posting_fkey
    foreign key (financial_sale_posting_id, tenant_id)
    references public.financial_sale_postings(id, tenant_id) on delete restrict,
  constraint sale_confirmation_links_binding_fkey
    foreign key (financial_engine_binding_id, tenant_id)
    references public.financial_engine_bindings(id, tenant_id) on delete restrict,
  constraint sale_confirmation_links_actor_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sale_confirmation_links_sale_unique unique (tenant_id, sale_id),
  constraint sale_confirmation_links_reservation_unique unique (tenant_id, inventory_reservation_id),
  constraint sale_confirmation_links_posting_unique unique (tenant_id, financial_sale_posting_id),
  constraint sale_confirmation_links_binding_unique unique (tenant_id, financial_engine_binding_id)
);

create or replace function public.is_trusted_sales_confirmation_context(
  p_tenant_id uuid,
  p_source_type text default null,
  p_source_id text default null,
  p_event_version integer default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.sales_command_requests command_request
    join public.sales sale
      on sale.id = command_request.confirmation_sale_id
     and sale.tenant_id = command_request.tenant_id
    where command_request.id::text =
      current_setting('app.canonical_sales_confirmation_command', true)
      and command_request.tenant_id = p_tenant_id
      and command_request.command_type = 'confirm'
      and command_request.result is null
      and command_request.created_by = public.current_tenant_user_id()
      and command_request.confirmation_expected_version = sale.version
      and sale.status = 'draft'
      and (p_source_type is null or (
        lower(btrim(p_source_type)) in ('sale', 'sales_core')
        and p_source_id = sale.id::text
      ))
      and (p_event_version is null or p_event_version = sale.version + 1)
  )
$$;

-- Extend only the authorization boundary of the existing Inventory contracts.
-- Their validation, locking, idempotency and mutation logic remains unchanged.
do $$
declare v_definition text; v_rewritten text;
begin
  select pg_get_functiondef(
    'public.get_inventory_availability(uuid,uuid,numeric,uuid,uuid)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'  if v_tenant_id is null\n     or not (public.has_permission(''inventory.availability'', v_tenant_id)\n       or public.has_permission(''inventory.read'', v_tenant_id)) then',
    E'  if v_tenant_id is null\n     or (not (public.has_permission(''inventory.availability'', v_tenant_id)\n       or public.has_permission(''inventory.read'', v_tenant_id))\n       and not public.is_trusted_sales_confirmation_context(v_tenant_id)) then'
  );
  if v_rewritten = v_definition then
    raise exception 'SALES_CONFIRMATION_INVENTORY_AVAILABILITY_HOOK_NOT_APPLIED';
  end if;
  execute v_rewritten;

  select pg_get_functiondef(
    'public.reserve_inventory(uuid,uuid,text,text,jsonb,text)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'  if v_tenant_id is null or v_actor_id is null\n     or not public.has_permission(''inventory.reserve'', v_tenant_id) then',
    E'  if v_tenant_id is null or v_actor_id is null\n     or (not public.has_permission(''inventory.reserve'', v_tenant_id)\n       and not public.is_trusted_sales_confirmation_context(\n         v_tenant_id, p_source_type, p_source_id\n       )) then'
  );
  if v_rewritten = v_definition then
    raise exception 'SALES_CONFIRMATION_INVENTORY_RESERVATION_HOOK_NOT_APPLIED';
  end if;
  execute v_rewritten;
end
$$;

-- Extend the existing Financial contract with the same in-flight command
-- capability. A caller-controlled GUC alone is insufficient: the private check
-- also requires the matching unresolved command row, actor, Sale and version.
do $$
declare v_definition text; v_rewritten text;
begin
  select pg_get_functiondef(
    'public.post_financial_sale_unbound_impl(uuid,text,text,text,integer,text,text,uuid,numeric,text,date,uuid,text)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'  if not public.is_trusted_showroom_sale_posting_context(\n    p_tenant_id, normalized_source_app, normalized_source_model,\n    normalized_source_id, p_event_version\n  ) then',
    E'  if not public.is_trusted_showroom_sale_posting_context(\n    p_tenant_id, normalized_source_app, normalized_source_model,\n    normalized_source_id, p_event_version\n  ) and not public.is_trusted_sales_confirmation_context(\n    p_tenant_id, normalized_source_app, normalized_source_id, p_event_version\n  ) then'
  );
  if v_rewritten = v_definition then
    raise exception 'SALES_CONFIRMATION_FINANCIAL_POST_HOOK_NOT_APPLIED';
  end if;
  execute v_rewritten;

  select pg_get_functiondef(
    'public.get_financial_sale_posting(uuid,uuid)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'  if not public.is_trusted_showroom_sale_posting_context(\n    posting.tenant_id, posting.source_app, posting.source_model,\n    posting.source_id, posting.event_version\n  ) then',
    E'  if not public.is_trusted_showroom_sale_posting_context(\n    posting.tenant_id, posting.source_app, posting.source_model,\n    posting.source_id, posting.event_version\n  ) and not public.is_trusted_sales_confirmation_context(\n    posting.tenant_id, posting.source_app, posting.source_id, posting.event_version\n  ) then'
  );
  if v_rewritten = v_definition then
    raise exception 'SALES_CONFIRMATION_FINANCIAL_READBACK_HOOK_NOT_APPLIED';
  end if;
  execute v_rewritten;
end
$$;

create or replace function public.guard_sale_confirmation_artifact()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_sale public.sales%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_posting public.financial_sale_postings%rowtype;
  v_binding public.financial_engine_bindings%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '42501', message = 'SALE_CONFIRMATION_ARTIFACT_IMMUTABLE';
  end if;
  if current_setting('app.canonical_sales_confirmation_write', true)
      is distinct from new.sale_id::text then
    raise exception using errcode = '42501', message = 'SALE_CONFIRMATION_COMMAND_REQUIRED';
  end if;
  select * into v_sale from public.sales sale
  where sale.id = new.sale_id and sale.tenant_id = new.tenant_id;
  if not found then
    raise exception using errcode = '23514', message = 'SALE_CONFIRMATION_SALE_INVALID';
  end if;

  if tg_table_name = 'sale_inventory_selections' then
    if not exists (
      select 1
      from public.sale_lines line
      join public.product_products product
        on product.id = line.product_id and product.tenant_id = line.tenant_id
      where line.id = new.sale_line_id
        and line.sale_id = new.sale_id
        and line.tenant_id = new.tenant_id
        and (
          (new.selection_type = 'serial'
            and product.tracking = 'serial'
            and new.tracking_unit_id is not null)
          or (new.selection_type = 'quantity'
            and product.tracking = 'none'
            and new.tracking_unit_id is null)
        )
    ) then
      raise exception using errcode = '23514', message = 'SALE_INVENTORY_SELECTION_INVALID';
    end if;
    return new;
  end if;

  if new.inventory_reservation_id is not null then
    select * into v_reservation from public.inventory_reservations reservation
    where reservation.id = new.inventory_reservation_id
      and reservation.tenant_id = new.tenant_id;
    if not found or v_reservation.source_type <> 'sale'
       or v_reservation.source_id <> new.sale_id::text
       or v_reservation.branch_id <> v_sale.branch_id
       or v_reservation.state <> 'active' then
      raise exception using errcode = '23514', message = 'SALE_CONFIRMATION_RESERVATION_LINK_INVALID';
    end if;
  elsif exists (
    select 1 from public.sale_inventory_selections selection
    where selection.sale_id = new.sale_id and selection.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'SALE_CONFIRMATION_RESERVATION_REQUIRED';
  end if;

  select * into v_posting from public.financial_sale_postings posting
  where posting.id = new.financial_sale_posting_id
    and posting.tenant_id = new.tenant_id;
  if not found or v_posting.source_app <> 'sales_core'
     or v_posting.source_model <> 'sale'
     or v_posting.source_id <> new.sale_id::text
     or v_posting.event_version <> v_sale.version + 1
     or v_posting.partner_id <> v_sale.customer_id
     or v_posting.branch_id is distinct from v_sale.branch_id
     or v_posting.amount <> v_sale.total_amount
     or v_posting.currency_code <> v_sale.currency_code
     or v_posting.posting_date <> v_sale.effective_sale_date
     or v_posting.state <> 'posted' then
    raise exception using errcode = '23514', message = 'SALE_CONFIRMATION_FINANCIAL_LINK_INVALID';
  end if;

  select * into v_binding from public.financial_engine_bindings binding
  where binding.id = new.financial_engine_binding_id
    and binding.tenant_id = new.tenant_id;
  if not found or v_binding.source_app <> 'sales_core'
     or v_binding.source_model <> 'sale'
     or v_binding.source_id <> new.sale_id::text
     or v_binding.financial_event_version <> v_sale.version + 1
     or v_binding.financial_engine <> 'canonical'
     or v_binding.state <> 'posted'
     or v_binding.canonical_sale_posting_id <> new.financial_sale_posting_id then
    raise exception using errcode = '23514', message = 'SALE_CONFIRMATION_ENGINE_LINK_INVALID';
  end if;
  return new;
end
$$;

create trigger sale_inventory_selections_guard
before insert or update or delete on public.sale_inventory_selections
for each row execute function public.guard_sale_confirmation_artifact();
create trigger sale_confirmation_links_guard
before insert or update or delete on public.sale_confirmation_links
for each row execute function public.guard_sale_confirmation_artifact();

create or replace function public.confirm_sale(
  p_sale_id uuid,
  p_expected_version bigint,
  p_inventory_selections jsonb,
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
  v_line record;
  v_item jsonb;
  v_line_id uuid;
  v_location_id uuid;
  v_item_location_id uuid;
  v_tracking_unit_id uuid;
  v_quantity numeric;
  v_selection_count integer;
  v_selection_quantity numeric;
  v_normalized_selections jsonb := '[]'::jsonb;
  v_inventory_lines jsonb := '[]'::jsonb;
  v_availability jsonb;
  v_fingerprint text;
  v_business_fingerprint text;
  v_command public.sales_command_requests%rowtype;
  v_command_id uuid := gen_random_uuid();
  v_claimed integer := 0;
  v_new_version bigint;
  v_sale_number text;
  v_reservation jsonb;
  v_reservation_id uuid;
  v_posting jsonb;
  v_posting_id uuid;
  v_binding_id uuid;
  v_link_id uuid := gen_random_uuid();
  v_result jsonb;
  v_server_total numeric(18,2);
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.confirm', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_CONFIRM_DENIED';
  end if;
  if p_idempotency_key is null
     or length(btrim(p_idempotency_key)) not between 1 and 160 then
    raise exception using errcode = '23514', message = 'SALES_CONFIRM_IDEMPOTENCY_KEY_INVALID';
  end if;
  if jsonb_typeof(p_inventory_selections) <> 'array'
     or jsonb_array_length(p_inventory_selections) > 200 then
    raise exception using errcode = '23514', message = 'SALE_INVENTORY_SELECTIONS_INVALID';
  end if;

  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = v_tenant_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'SALE_NOT_FOUND';
  end if;
  if not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '42501', message = 'SALE_SCOPE_DENIED';
  end if;

  for v_item in
    select item.value from jsonb_array_elements(p_inventory_selections) item
  loop
    begin
      v_line_id := nullif(v_item ->> 'sale_line_id', '')::uuid;
      v_item_location_id := nullif(v_item ->> 'location_id', '')::uuid;
      v_tracking_unit_id := nullif(v_item ->> 'tracking_unit_id', '')::uuid;
      v_quantity := (v_item ->> 'quantity')::numeric;
    exception when others then
      raise exception using errcode = '23514', message = 'SALE_INVENTORY_SELECTION_INVALID';
    end;
    if v_line_id is null or v_item_location_id is null
       or v_quantity is null or v_quantity <= 0
       or v_quantity <> round(v_quantity, 4) then
      raise exception using errcode = '23514', message = 'SALE_INVENTORY_SELECTION_INVALID';
    end if;
    if v_location_id is null then
      v_location_id := v_item_location_id;
    elsif v_location_id <> v_item_location_id then
      raise exception using errcode = '23514', message = 'SALE_MULTIPLE_RESERVATION_LOCATIONS_NOT_SUPPORTED';
    end if;
    v_normalized_selections := v_normalized_selections || jsonb_build_array(
      jsonb_build_object(
        'sale_line_id', v_line_id,
        'location_id', v_item_location_id,
        'tracking_unit_id', v_tracking_unit_id,
        'quantity', v_quantity
      )
    );
  end loop;
  select coalesce(jsonb_agg(item order by item ->> 'sale_line_id',
    coalesce(item ->> 'tracking_unit_id', '')), '[]'::jsonb)
  into v_normalized_selections
  from jsonb_array_elements(v_normalized_selections) item;

  v_fingerprint := public.sales_request_fingerprint(jsonb_build_object(
    'sale_id', p_sale_id,
    'expected_version', p_expected_version,
    'inventory_selections', v_normalized_selections
  ));
  insert into public.sales_command_requests (
    id, tenant_id, command_type, idempotency_key, request_fingerprint,
    created_by, confirmation_sale_id, confirmation_expected_version
  ) values (
    v_command_id, v_tenant_id, 'confirm', btrim(p_idempotency_key),
    v_fingerprint, v_actor_id, p_sale_id, p_expected_version
  ) on conflict (tenant_id, command_type, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    select * into v_command from public.sales_command_requests command_request
    where command_request.tenant_id = v_tenant_id
      and command_request.command_type = 'confirm'
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

  if v_sale.status <> 'draft' then
    raise exception using errcode = '23514', message = 'SALE_NOT_DRAFT';
  end if;
  if p_expected_version is null or p_expected_version <> v_sale.version then
    raise exception using errcode = '40001', message = 'SALES_VERSION_CONFLICT';
  end if;
  if not exists (
    select 1 from public.branches branch
    where branch.id = v_sale.branch_id and branch.tenant_id = v_tenant_id
      and branch.is_active
  ) then
    raise exception using errcode = '23514', message = 'SALES_BRANCH_INVALID';
  end if;
  if not exists (
    select 1 from public.partners customer
    where customer.id = v_sale.customer_id and customer.tenant_id = v_tenant_id
      and customer.active and customer.customer_rank > 0
  ) then
    raise exception using errcode = '23514', message = 'SALES_CUSTOMER_INVALID';
  end if;
  select round(coalesce(sum(round(line.quantity * line.unit_price, 2)), 0), 2)
  into v_server_total from public.sale_lines line
  where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id;
  if v_server_total <= 0 or v_server_total <> v_sale.total_amount
     or not exists (
       select 1 from public.sale_lines line
       where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
     ) then
    raise exception using errcode = '23514', message = 'SALE_COMMERCIAL_READINESS_FAILED';
  end if;
  if exists (
    select 1
    from public.sale_lines line
    join public.product_products product
      on product.id = line.product_id and product.tenant_id = line.tenant_id
    join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
      and (not product.is_active or not template.is_active or not template.can_be_sold)
  ) then
    raise exception using errcode = '23514', message = 'SALE_PRODUCT_INVALID';
  end if;

  if v_location_id is not null and (
    not public.has_stock_location_access(v_location_id)
    or not exists (
      select 1 from public.stock_locations location
      where location.id = v_location_id and location.tenant_id = v_tenant_id
        and location.branch_id = v_sale.branch_id and location.is_active
    )
  ) then
    raise exception using errcode = '42501', message = 'SALE_INVENTORY_LOCATION_DENIED';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_normalized_selections) item
    group by item ->> 'sale_line_id', coalesce(item ->> 'tracking_unit_id', '')
    having count(*) > 1
  ) then
    raise exception using errcode = '23514', message = 'SALE_INVENTORY_SELECTION_DUPLICATE';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_normalized_selections) item
    where not exists (
      select 1 from public.sale_lines line
      where line.id = (item ->> 'sale_line_id')::uuid
        and line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
    )
  ) then
    raise exception using errcode = '23514', message = 'SALE_INVENTORY_SELECTION_LINE_INVALID';
  end if;

  for v_line in
    select line.*, product.tracking, template.product_type
    from public.sale_lines line
    join public.product_products product
      on product.id = line.product_id and product.tenant_id = line.tenant_id
    join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
    order by line.line_position
  loop
    select count(*), coalesce(sum((item ->> 'quantity')::numeric), 0)
    into v_selection_count, v_selection_quantity
    from jsonb_array_elements(v_normalized_selections) item
    where (item ->> 'sale_line_id')::uuid = v_line.id;

    if v_line.product_type = 'service' then
      if v_selection_count <> 0 then
        raise exception using errcode = '23514', message = 'SALE_SERVICE_SELECTION_NOT_ALLOWED';
      end if;
    elsif v_line.product_type <> 'goods' then
      raise exception using errcode = '23514', message = 'SALE_INVENTORY_PRODUCT_TYPE_UNSUPPORTED';
    elsif v_line.tracking = 'lot' then
      raise exception using errcode = '23514', message = 'SALE_LOT_TRACKING_NOT_SUPPORTED';
    elsif v_line.tracking = 'serial' then
      if v_line.quantity <> trunc(v_line.quantity)
         or v_selection_count <> v_line.quantity
         or v_selection_quantity <> v_line.quantity
         or exists (
           select 1 from jsonb_array_elements(v_normalized_selections) item
           where (item ->> 'sale_line_id')::uuid = v_line.id
             and ((item ->> 'tracking_unit_id') is null
               or (item ->> 'quantity')::numeric <> 1)
         ) then
        raise exception using errcode = '23514', message = 'SALE_SERIAL_SELECTION_INCOMPLETE';
      end if;
    elsif v_line.tracking = 'none' then
      if v_selection_count <> 1 or v_selection_quantity <> v_line.quantity
         or exists (
           select 1 from jsonb_array_elements(v_normalized_selections) item
           where (item ->> 'sale_line_id')::uuid = v_line.id
             and (item ->> 'tracking_unit_id') is not null
         ) then
        raise exception using errcode = '23514', message = 'SALE_QUANTITY_SELECTION_INCOMPLETE';
      end if;
    else
      raise exception using errcode = '23514', message = 'SALE_TRACKING_REQUIREMENT_UNSUPPORTED';
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', reservation_input.product_id,
    'tracking_unit_id', reservation_input.tracking_unit_id,
    'quantity', reservation_input.quantity
  ) order by reservation_input.product_id, reservation_input.tracking_unit_id nulls first), '[]'::jsonb)
  into v_inventory_lines
  from (
    select line.product_id,
      nullif(item ->> 'tracking_unit_id', '')::uuid tracking_unit_id,
      sum((item ->> 'quantity')::numeric) quantity
    from jsonb_array_elements(v_normalized_selections) item
    join public.sale_lines line
      on line.id = (item ->> 'sale_line_id')::uuid
     and line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
    group by line.product_id, nullif(item ->> 'tracking_unit_id', '')::uuid
  ) reservation_input;

  perform set_config('app.canonical_sales_confirmation_command', v_command_id::text, true);
  for v_item in select item.value from jsonb_array_elements(v_inventory_lines) item
  loop
    v_availability := public.get_inventory_availability(
      v_sale.branch_id,
      (v_item ->> 'product_id')::uuid,
      (v_item ->> 'quantity')::numeric,
      v_location_id,
      nullif(v_item ->> 'tracking_unit_id', '')::uuid
    );
    if not coalesce((v_availability ->> 'is_available')::boolean, false) then
      raise exception using errcode = '23514',
        message = 'SALE_INVENTORY_UNAVAILABLE:' || (v_availability -> 'blockers')::text;
    end if;
  end loop;

  v_new_version := v_sale.version + 1;
  perform set_config('app.canonical_sales_numbering', v_tenant_id::text, true);
  v_sale_number := public.next_canonical_sale_number(
    v_tenant_id, v_sale.effective_sale_date
  );
  perform set_config('app.canonical_sales_numbering', '', true);

  if jsonb_array_length(v_inventory_lines) > 0 then
    v_reservation := public.reserve_inventory(
      v_sale.branch_id, v_location_id, 'sale', v_sale.id::text,
      v_inventory_lines,
      'sale-confirm-reserve-' || encode(extensions.digest(
        v_tenant_id::text || ':' || btrim(p_idempotency_key), 'sha256'
      ), 'hex')
    );
    v_reservation_id := (v_reservation ->> 'reservation_id')::uuid;
  end if;

  v_business_fingerprint := public.sales_request_fingerprint(jsonb_build_object(
    'sale_id', v_sale.id,
    'tenant_id', v_tenant_id,
    'branch_id', v_sale.branch_id,
    'customer_id', v_sale.customer_id,
    'effective_sale_date', v_sale.effective_sale_date,
    'currency_code', v_sale.currency_code,
    'sale_number', v_sale_number,
    'total_amount', v_sale.total_amount,
    'lines', (
      select jsonb_agg(jsonb_build_object(
        'line_id', line.id, 'product_id', line.product_id,
        'quantity', line.quantity, 'unit_price', line.unit_price,
        'line_total', line.line_total
      ) order by line.line_position)
      from public.sale_lines line
      where line.sale_id = v_sale.id and line.tenant_id = v_tenant_id
    )
  ));
  v_posting := public.post_financial_sale(
    v_tenant_id, 'sales_core', 'sale', v_sale.id::text, v_new_version::integer,
    'sale-confirm-post-' || encode(extensions.digest(
      v_tenant_id::text || ':' || btrim(p_idempotency_key), 'sha256'
    ), 'hex'),
    v_business_fingerprint, v_sale.customer_id, v_sale.total_amount,
    v_sale.currency_code, v_sale.effective_sale_date, v_sale.branch_id,
    v_sale_number
  );
  v_posting_id := (v_posting ->> 'posting_id')::uuid;
  select binding.id into v_binding_id
  from public.financial_engine_bindings binding
  where binding.tenant_id = v_tenant_id
    and binding.source_app = 'sales_core'
    and binding.source_model = 'sale'
    and binding.source_id = v_sale.id::text
    and binding.financial_event_version = v_new_version
    and binding.financial_engine = 'canonical'
    and binding.state = 'posted'
    and binding.canonical_sale_posting_id = v_posting_id;
  if v_binding_id is null then
    raise exception using errcode = '23514', message = 'SALE_FINANCIAL_BINDING_MISSING';
  end if;

  perform set_config('app.canonical_sales_confirmation_write', v_sale.id::text, true);
  insert into public.sale_inventory_selections (
    tenant_id, sale_id, sale_line_id, location_id, selection_type,
    tracking_unit_id, quantity, created_by
  )
  select v_tenant_id, v_sale.id,
    (item ->> 'sale_line_id')::uuid,
    (item ->> 'location_id')::uuid,
    case when (item ->> 'tracking_unit_id') is null then 'quantity' else 'serial' end,
    nullif(item ->> 'tracking_unit_id', '')::uuid,
    (item ->> 'quantity')::numeric, v_actor_id
  from jsonb_array_elements(v_normalized_selections) item;

  insert into public.sale_confirmation_links (
    id, tenant_id, sale_id, inventory_reservation_id,
    financial_sale_posting_id, financial_engine_binding_id, created_by
  ) values (
    v_link_id, v_tenant_id, v_sale.id, v_reservation_id,
    v_posting_id, v_binding_id, v_actor_id
  );
  perform set_config('app.canonical_sales_confirmation_write', '', true);

  perform set_config('app.canonical_sales_transition', v_sale.id::text, true);
  update public.sales set
    status = 'confirmed', sale_number = v_sale_number,
    confirmed_by = v_actor_id, confirmed_at = now(),
    version = v_new_version, updated_at = now()
  where id = v_sale.id and tenant_id = v_tenant_id
    and status = 'draft' and version = p_expected_version;
  if not found then
    raise exception using errcode = '40001', message = 'SALES_VERSION_CONFLICT';
  end if;
  perform set_config('app.canonical_sales_transition', '', true);

  insert into public.sale_events (
    tenant_id, sale_id, event_type, sale_version, actor_id, payload
  ) values (
    v_tenant_id, v_sale.id, 'sale_confirmed', v_new_version, v_actor_id,
    jsonb_build_object(
      'sale_number', v_sale_number,
      'total_amount', v_sale.total_amount,
      'currency_code', v_sale.currency_code,
      'branch_id', v_sale.branch_id,
      'inventory_required', v_reservation_id is not null
    )
  );

  v_result := jsonb_build_object(
    'sale_id', v_sale.id,
    'sale_number', v_sale_number,
    'status', 'confirmed',
    'version', v_new_version,
    'total_amount', v_sale.total_amount,
    'currency_code', v_sale.currency_code,
    'inventory', jsonb_build_object(
      'state', case when v_reservation_id is null then 'not_required' else 'reserved' end,
      'location_id', v_location_id,
      'selection_count', jsonb_array_length(v_normalized_selections)
    ),
    'financial', jsonb_build_object(
      'state', v_posting ->> 'accounting_state',
      'original_amount', (v_posting ->> 'original_amount')::numeric,
      'current_receivable', (v_posting ->> 'current_residual')::numeric
    ),
    'idempotent_replay', false
  );
  update public.sales_command_requests set
    result = v_result, completed_at = now()
  where id = v_command_id and tenant_id = v_tenant_id;
  perform set_config('app.canonical_sales_confirmation_command', '', true);
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
  if v_tenant_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.view', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_VIEW_DENIED';
  end if;
  select sale.*, branch.name branch_name, customer.name customer_name,
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
    'state', case when link.inventory_reservation_id is null then 'not_required'
      else reservation.state end,
    'location', case when location.id is null then null else
      jsonb_build_object('id', location.id, 'name', location.name) end,
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
    v_inventory := jsonb_build_object(
      'state', 'not_reserved', 'location', null,
      'selection_count', 0, 'reserved_quantity', 0
    );
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
    'customer', jsonb_build_object('id', v_sale.customer_id, 'name', v_sale.customer_name),
    'effective_sale_date', v_sale.effective_sale_date,
    'currency_code', v_sale.currency_code, 'status', v_sale.status,
    'total_amount', v_sale.total_amount, 'notes', v_sale.notes,
    'version', v_sale.version, 'created_at', v_sale.created_at,
    'updated_at', v_sale.updated_at,
    'created_by', jsonb_build_object('id', v_sale.created_by, 'name', v_sale.created_by_name),
    'confirmed_at', v_sale.confirmed_at, 'confirmed_by_name', v_sale.confirmed_by_name,
    'cancelled_at', v_sale.cancelled_at, 'cancelled_by_name', v_sale.cancelled_by_name,
    'inventory', v_inventory,
    'financial', v_financial,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', line.id, 'position', line.line_position,
        'product_id', line.product_id, 'product_name', product.display_name,
        'description', line.description, 'quantity', line.quantity,
        'unit_price', line.unit_price, 'line_total', line.line_total,
        'tracking_requirement', line.tracking_requirement
      ) order by line.line_position)
      from public.sale_lines line
      join public.product_products product
        on product.id = line.product_id and product.tenant_id = line.tenant_id
      where line.sale_id = v_sale.id and line.tenant_id = v_tenant_id
    ), '[]'::jsonb)
  );
end
$$;

alter table public.sale_inventory_selections enable row level security;
alter table public.sale_confirmation_links enable row level security;
revoke all on public.sale_inventory_selections, public.sale_confirmation_links
  from public, anon, authenticated, service_role;
grant select on public.sale_inventory_selections, public.sale_confirmation_links
  to authenticated;

create policy sale_inventory_selections_read on public.sale_inventory_selections
for select to authenticated using (
  exists (
    select 1 from public.sales sale
    where sale.id = public.sale_inventory_selections.sale_id
      and sale.tenant_id = public.sale_inventory_selections.tenant_id
  )
);
create policy sale_confirmation_links_read on public.sale_confirmation_links
for select to authenticated using (
  exists (
    select 1 from public.sales sale
    where sale.id = public.sale_confirmation_links.sale_id
      and sale.tenant_id = public.sale_confirmation_links.tenant_id
  )
);

revoke all on function public.is_trusted_sales_confirmation_context(uuid, text, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.guard_sale_confirmation_artifact()
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_sale(uuid, bigint, jsonb, text)
  from public, anon, service_role;
grant execute on function public.confirm_sale(uuid, bigint, jsonb, text)
  to authenticated;

comment on table public.sale_inventory_selections is
  'Immutable business-safe stock selections captured by Canonical Sale confirmation; never stock quant identifiers.';
comment on table public.sale_confirmation_links is
  'Typed immutable provenance linking one Canonical Sale confirmation to Inventory reservation and Financial posting contracts.';
comment on function public.confirm_sale(uuid, bigint, jsonb, text) is
  'Atomic draft-to-confirmed orchestration: typed Inventory reservation, final numbering and Canonical Financial Sale Posting. No payment or delivery.';
comment on function public.is_trusted_sales_confirmation_context(uuid, text, text, integer) is
  'Private capability validated against an unresolved actor-bound Sales confirmation command; a caller-controlled setting alone never authorizes a Core operation.';

notify pgrst, 'reload schema';

commit;
