begin;

-- Canonical Sales Core foundation. It owns commercial draft data only and has
-- no dependency on Showroom, POS, Inventory side effects or Financial posting.

insert into public.auth_permissions (code, name, description, resource, action, active)
values
  ('sales.access', 'دخول المبيعات', 'الوصول إلى عقود المبيعات العامة.', 'sales', 'access', true),
  ('sales.create', 'إنشاء مسودة بيع', 'إنشاء مسودة بيع Canonical.', 'sales', 'create', true),
  ('sales.update_draft', 'تعديل مسودة بيع', 'تعديل البيانات التجارية لمسودة بيع Canonical.', 'sales', 'update_draft', true),
  ('sales.view', 'عرض المبيعات', 'قراءة المبيعات Canonically ضمن نطاق الفروع.', 'sales', 'view', true),
  ('sales.backdate', 'تأريخ المبيعات', 'إنشاء أو تغيير مسودة بيع بتاريخ سابق.', 'sales', 'backdate', true)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  resource = excluded.resource,
  action = excluded.action,
  active = true,
  updated_at = now();

create unique index if not exists partners_id_tenant_unique
  on public.partners (id, tenant_id);
create unique index if not exists product_products_id_tenant_unique
  on public.product_products (id, tenant_id);

create table public.sale_number_sequences (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_year integer not null check (sale_year between 2000 and 9999),
  last_value bigint not null default 0 check (last_value between 0 and 999999999),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, sale_year)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid not null,
  sale_number text,
  effective_sale_date date not null,
  currency_code text not null,
  status text not null default 'draft',
  total_amount numeric(18,2) not null default 0,
  notes text,
  version bigint not null default 1,
  create_idempotency_key text not null,
  create_request_fingerprint text not null,
  created_by uuid not null,
  confirmed_by uuid,
  confirmed_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_branch_fkey
    foreign key (branch_id, tenant_id)
    references public.branches(id, tenant_id) on delete restrict,
  constraint sales_customer_fkey
    foreign key (customer_id, tenant_id)
    references public.partners(id, tenant_id) on delete restrict,
  constraint sales_created_by_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sales_confirmed_by_fkey
    foreign key (confirmed_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sales_cancelled_by_fkey
    foreign key (cancelled_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sales_status_check check (status in ('draft', 'confirmed', 'cancelled')),
  constraint sales_total_check check (total_amount >= 0 and total_amount = round(total_amount, 2)),
  constraint sales_currency_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint sales_number_check check (sale_number is null or sale_number ~ '^SAL-[0-9]{4}-[0-9]{6,9}$'),
  constraint sales_version_check check (version > 0),
  constraint sales_notes_check check (notes is null or length(notes) <= 4000),
  constraint sales_create_idempotency_check
    check (length(btrim(create_idempotency_key)) between 1 and 200),
  constraint sales_create_fingerprint_check
    check (create_request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint sales_confirmed_actor_check check (
    (confirmed_by is null and confirmed_at is null)
    or (confirmed_by is not null and confirmed_at is not null)
  ),
  constraint sales_cancelled_actor_check check (
    (cancelled_by is null and cancelled_at is null)
    or (cancelled_by is not null and cancelled_at is not null)
  ),
  constraint sales_tenant_number_unique unique (tenant_id, sale_number),
  constraint sales_tenant_create_idempotency_unique unique (tenant_id, create_idempotency_key),
  constraint sales_id_tenant_unique unique (id, tenant_id)
);

create table public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  line_position integer not null,
  product_id uuid not null,
  description text not null,
  quantity numeric(18,4) not null,
  unit_price numeric(18,2) not null,
  line_total numeric(18,2) not null,
  tracking_requirement text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sale_lines_sale_fkey
    foreign key (sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  constraint sale_lines_product_fkey
    foreign key (product_id, tenant_id)
    references public.product_products(id, tenant_id) on delete restrict,
  constraint sale_lines_position_check check (line_position > 0),
  constraint sale_lines_quantity_check check (quantity > 0 and quantity = round(quantity, 4)),
  constraint sale_lines_unit_price_check check (unit_price >= 0 and unit_price = round(unit_price, 2)),
  constraint sale_lines_total_check check (
    line_total >= 0 and line_total = round(quantity * unit_price, 2)
  ),
  constraint sale_lines_description_check check (length(btrim(description)) between 1 and 500),
  constraint sale_lines_tracking_check check (tracking_requirement in ('none', 'serial', 'lot')),
  constraint sale_lines_sale_position_unique unique (sale_id, line_position),
  constraint sale_lines_id_tenant_unique unique (id, tenant_id)
);

create table public.sale_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  event_type text not null,
  sale_version bigint not null,
  actor_id uuid not null,
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  constraint sale_events_sale_fkey
    foreign key (sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  constraint sale_events_actor_fkey
    foreign key (actor_id, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sale_events_type_check check (event_type in (
    'sale_created', 'sale_draft_updated', 'sale_confirmed', 'sale_cancelled',
    'delivery_requested', 'delivery_linked', 'return_initiated'
  )),
  constraint sale_events_version_check check (sale_version > 0),
  constraint sale_events_payload_check check (
    jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192
  ),
  constraint sale_events_sale_version_unique unique (tenant_id, sale_id, sale_version)
);

create table public.sales_command_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  command_type text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  result jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint sales_command_requests_actor_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sales_command_requests_type_check
    check (command_type in ('create', 'update_draft')),
  constraint sales_command_requests_key_check
    check (length(btrim(idempotency_key)) between 1 and 200),
  constraint sales_command_requests_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint sales_command_requests_unique
    unique (tenant_id, command_type, idempotency_key)
);

create index sales_tenant_branch_status_date_idx
  on public.sales (tenant_id, branch_id, status, effective_sale_date desc, created_at desc);
create index sales_tenant_customer_date_idx
  on public.sales (tenant_id, customer_id, effective_sale_date desc);
create index sale_lines_sale_idx on public.sale_lines (tenant_id, sale_id, line_position);
create index sale_events_sale_idx on public.sale_events (tenant_id, sale_id, sale_version, occurred_at);

create or replace function public.sales_request_fingerprint(p_payload jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select encode(extensions.digest(coalesce(p_payload, '{}'::jsonb)::text, 'sha256'), 'hex')
$$;

create or replace function public.next_canonical_sale_number(
  p_tenant_id uuid,
  p_effective_sale_date date
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_year integer;
  v_next bigint;
begin
  if current_setting('app.canonical_sales_numbering', true) is distinct from p_tenant_id::text then
    raise exception using errcode = '42501', message = 'SALES_NUMBERING_REQUIRES_CONFIRMATION_COMMAND';
  end if;
  v_year := extract(year from p_effective_sale_date)::integer;
  insert into public.sale_number_sequences (tenant_id, sale_year, last_value)
  values (p_tenant_id, v_year, 1)
  on conflict (tenant_id, sale_year) do update set
    last_value = public.sale_number_sequences.last_value + 1,
    updated_at = now()
  returning last_value into v_next;
  if v_next > 999999999 then
    raise exception using errcode = '22003', message = 'SALES_NUMBER_SEQUENCE_EXHAUSTED';
  end if;
  return 'SAL-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
end
$$;

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
       or new.confirmed_by is not null or new.cancelled_by is not null then
      raise exception using errcode = '23514', message = 'CANONICAL_SALE_INITIAL_STATE_INVALID';
    end if;
    return new;
  end if;
  if old.sale_number is not null and new.sale_number is distinct from old.sale_number then
    raise exception using errcode = '23514', message = 'CANONICAL_SALE_NUMBER_IMMUTABLE';
  end if;
  if old.status in ('confirmed', 'cancelled') and new is distinct from old then
    raise exception using errcode = '23514', message = 'CANONICAL_SALE_COMMERCIAL_STATE_IMMUTABLE';
  end if;
  if new.status is distinct from old.status then
    if current_setting('app.canonical_sales_transition', true) is distinct from old.id::text
       or not (
         (old.status = 'draft' and new.status in ('confirmed', 'cancelled'))
         or (old.status = 'confirmed' and new.status = 'cancelled')
       ) then
      raise exception using errcode = '42501', message = 'CANONICAL_SALE_STATUS_COMMAND_REQUIRED';
    end if;
    if new.status = 'confirmed' and (
      new.sale_number is null or new.confirmed_by is null or new.confirmed_at is null
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

create trigger canonical_sale_header_guard
before insert or update or delete on public.sales
for each row execute function public.guard_canonical_sale_header();

create or replace function public.guard_canonical_sale_line()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_sale_id uuid := case when tg_op = 'DELETE' then old.sale_id else new.sale_id end;
  v_tenant_id uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
begin
  if tg_op = 'DELETE' and current_user in ('postgres', 'supabase_admin')
     and current_setting('app.canonical_sales_maintenance', true) = 'authorized' then
    return old;
  end if;
  if not exists (
    select 1 from public.sales sale
    where sale.id = v_sale_id and sale.tenant_id = v_tenant_id and sale.status = 'draft'
  ) then
    raise exception using errcode = '23514', message = 'SALE_LINES_REQUIRE_DRAFT';
  end if;
  if tg_op = 'UPDATE' and (
    new.sale_id is distinct from old.sale_id or new.tenant_id is distinct from old.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'SALE_LINE_IDENTITY_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger canonical_sale_line_guard
before insert or update or delete on public.sale_lines
for each row execute function public.guard_canonical_sale_line();

create or replace function public.guard_sale_event_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' and current_user in ('postgres', 'supabase_admin')
     and current_setting('app.canonical_sales_maintenance', true) = 'authorized' then
    return old;
  end if;
  raise exception using errcode = '42501', message = 'SALE_EVENT_IMMUTABLE';
end
$$;

create trigger sale_events_immutable
before update or delete on public.sale_events
for each row execute function public.guard_sale_event_immutability();

create or replace function public.create_sale(
  p_branch_id uuid,
  p_customer_id uuid,
  p_effective_sale_date date,
  p_currency_code text,
  p_notes text,
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
  v_date date := coalesce(p_effective_sale_date, current_date);
  v_currency text := upper(btrim(coalesce(p_currency_code, 'EGP')));
  v_notes text := nullif(btrim(p_notes), '');
  v_fingerprint text;
  v_command record;
  v_claimed integer := 0;
  v_sale_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.create', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_CREATE_DENIED';
  end if;
  if not public.has_branch_access(p_branch_id)
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_branch_id and branch.tenant_id = v_tenant_id and branch.is_active
     ) then
    raise exception using errcode = '42501', message = 'SALES_BRANCH_ACCESS_DENIED';
  end if;
  if not exists (
    select 1 from public.partners customer
    where customer.id = p_customer_id and customer.tenant_id = v_tenant_id
      and customer.active and customer.customer_rank > 0
  ) then
    raise exception using errcode = '23514', message = 'SALES_CUSTOMER_INVALID';
  end if;
  if v_date > current_date then
    raise exception using errcode = '23514', message = 'SALES_FUTURE_DATE_DENIED';
  end if;
  if v_date < current_date and not public.has_permission('sales.backdate', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_BACKDATE_DENIED';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '23514', message = 'SALES_CURRENCY_INVALID';
  end if;
  if v_notes is not null and length(v_notes) > 4000 then
    raise exception using errcode = '23514', message = 'SALES_NOTES_TOO_LONG';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception using errcode = '23514', message = 'SALES_IDEMPOTENCY_KEY_INVALID';
  end if;

  v_fingerprint := public.sales_request_fingerprint(jsonb_build_object(
    'branch_id', p_branch_id, 'customer_id', p_customer_id,
    'effective_sale_date', v_date, 'currency_code', v_currency, 'notes', v_notes
  ));
  insert into public.sales_command_requests (
    tenant_id, command_type, idempotency_key, request_fingerprint, created_by
  ) values (v_tenant_id, 'create', btrim(p_idempotency_key), v_fingerprint, v_actor_id)
  on conflict (tenant_id, command_type, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    select * into v_command from public.sales_command_requests command_request
    where command_request.tenant_id = v_tenant_id
      and command_request.command_type = 'create'
      and command_request.idempotency_key = btrim(p_idempotency_key)
    for update;
    if v_command.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23514', message = 'SALES_IDEMPOTENCY_CONFLICT';
    end if;
    if v_command.result is null then
      raise exception using errcode = '40001', message = 'SALES_IDEMPOTENCY_IN_PROGRESS';
    end if;
    return v_command.result;
  end if;

  insert into public.sales (
    id, tenant_id, branch_id, customer_id, effective_sale_date,
    currency_code, status, total_amount, notes, version,
    create_idempotency_key, create_request_fingerprint, created_by
  ) values (
    v_sale_id, v_tenant_id, p_branch_id, p_customer_id, v_date,
    v_currency, 'draft', 0, v_notes, 1,
    btrim(p_idempotency_key), v_fingerprint, v_actor_id
  );
  insert into public.sale_events (
    tenant_id, sale_id, event_type, sale_version, actor_id, payload
  ) values (
    v_tenant_id, v_sale_id, 'sale_created', 1, v_actor_id,
    jsonb_build_object(
      'branch_id', p_branch_id, 'customer_id', p_customer_id,
      'effective_sale_date', v_date, 'currency_code', v_currency
    )
  );
  v_result := jsonb_build_object(
    'sale_id', v_sale_id, 'sale_number', null, 'status', 'draft',
    'version', 1, 'total_amount', 0, 'currency_code', v_currency
  );
  update public.sales_command_requests set result = v_result, completed_at = now()
  where tenant_id = v_tenant_id and command_type = 'create'
    and idempotency_key = btrim(p_idempotency_key);
  return v_result;
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
  v_date date;
  v_currency text;
  v_notes text := nullif(btrim(p_notes), '');
  v_item jsonb;
  v_product record;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_description text;
  v_line_total numeric;
  v_total numeric := 0;
  v_position integer := 0;
  v_normalized_lines jsonb := '[]'::jsonb;
  v_existing_lines jsonb;
  v_fingerprint text;
  v_command record;
  v_claimed integer := 0;
  v_changed boolean;
  v_new_version bigint;
  v_result jsonb;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.update_draft', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_UPDATE_DRAFT_DENIED';
  end if;
  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = v_tenant_id for update;
  if not found then
    raise exception using errcode = '23514', message = 'SALE_NOT_FOUND';
  end if;
  if not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '42501', message = 'SALE_SCOPE_DENIED';
  end if;
  if not public.has_branch_access(p_branch_id)
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_branch_id and branch.tenant_id = v_tenant_id and branch.is_active
     ) then
    raise exception using errcode = '42501', message = 'SALES_BRANCH_ACCESS_DENIED';
  end if;
  if not exists (
    select 1 from public.partners customer
    where customer.id = p_customer_id and customer.tenant_id = v_tenant_id
      and customer.active and customer.customer_rank > 0
  ) then
    raise exception using errcode = '23514', message = 'SALES_CUSTOMER_INVALID';
  end if;
  v_date := coalesce(p_effective_sale_date, v_sale.effective_sale_date);
  v_currency := upper(btrim(coalesce(p_currency_code, v_sale.currency_code)));
  if v_date > current_date then
    raise exception using errcode = '23514', message = 'SALES_FUTURE_DATE_DENIED';
  end if;
  if v_date < current_date and v_date is distinct from v_sale.effective_sale_date
     and not public.has_permission('sales.backdate', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_BACKDATE_DENIED';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '23514', message = 'SALES_CURRENCY_INVALID';
  end if;
  if v_notes is not null and length(v_notes) > 4000 then
    raise exception using errcode = '23514', message = 'SALES_NOTES_TOO_LONG';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception using errcode = '23514', message = 'SALE_LINES_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_lines)
  loop
    v_position := v_position + 1;
    begin
      v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
      v_quantity := (v_item ->> 'quantity')::numeric;
      v_unit_price := round((v_item ->> 'unit_price')::numeric, 2);
    exception when others then
      raise exception using errcode = '23514', message = 'SALE_LINE_INPUT_INVALID';
    end;
    if v_product_id is null or v_quantity is null or v_quantity <= 0
       or v_quantity <> round(v_quantity, 4)
       or v_unit_price is null or v_unit_price < 0 then
      raise exception using errcode = '23514', message = 'SALE_LINE_INPUT_INVALID';
    end if;
    select pp.id, pp.display_name, pp.tracking,
      pp.is_active product_active, pt.is_active template_active,
      pt.can_be_sold, pt.product_type
    into v_product
    from public.product_products pp
    join public.product_templates pt
      on pt.id = pp.product_template_id and pt.tenant_id = pp.tenant_id
    where pp.id = v_product_id and pp.tenant_id = v_tenant_id;
    if not found then
      raise exception using errcode = '23514', message = 'SALE_LINE_PRODUCT_NOT_FOUND';
    end if;
    if not v_product.product_active or not v_product.template_active or not v_product.can_be_sold then
      raise exception using errcode = '23514', message = 'SALE_LINE_PRODUCT_NOT_SELLABLE';
    end if;
    v_description := coalesce(nullif(btrim(v_item ->> 'description'), ''), v_product.display_name);
    if length(v_description) > 500 then
      raise exception using errcode = '23514', message = 'SALE_LINE_DESCRIPTION_TOO_LONG';
    end if;
    v_line_total := round(v_quantity * v_unit_price, 2);
    v_total := v_total + v_line_total;
    v_normalized_lines := v_normalized_lines || jsonb_build_array(jsonb_build_object(
      'line_position', v_position, 'product_id', v_product_id,
      'description', v_description, 'quantity', v_quantity,
      'unit_price', v_unit_price, 'line_total', v_line_total,
      'tracking_requirement', v_product.tracking,
      'product_type', v_product.product_type
    ));
  end loop;
  v_total := round(v_total, 2);
  if v_total > 9999999999999999.99 then
    raise exception using errcode = '22003', message = 'SALE_TOTAL_OUT_OF_RANGE';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception using errcode = '23514', message = 'SALES_IDEMPOTENCY_KEY_INVALID';
  end if;
  v_fingerprint := public.sales_request_fingerprint(jsonb_build_object(
    'sale_id', p_sale_id, 'expected_version', p_expected_version,
    'branch_id', p_branch_id, 'customer_id', p_customer_id,
    'effective_sale_date', v_date, 'currency_code', v_currency,
    'notes', v_notes, 'lines', v_normalized_lines
  ));
  insert into public.sales_command_requests (
    tenant_id, command_type, idempotency_key, request_fingerprint, created_by
  ) values (v_tenant_id, 'update_draft', btrim(p_idempotency_key), v_fingerprint, v_actor_id)
  on conflict (tenant_id, command_type, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    select * into v_command from public.sales_command_requests command_request
    where command_request.tenant_id = v_tenant_id
      and command_request.command_type = 'update_draft'
      and command_request.idempotency_key = btrim(p_idempotency_key)
    for update;
    if v_command.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23514', message = 'SALES_IDEMPOTENCY_CONFLICT';
    end if;
    return v_command.result;
  end if;
  if v_sale.status <> 'draft' then
    raise exception using errcode = '23514', message = 'SALE_NOT_DRAFT';
  end if;
  if p_expected_version is null or p_expected_version <> v_sale.version then
    raise exception using errcode = '40001', message = 'SALES_VERSION_CONFLICT';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_position', line.line_position, 'product_id', line.product_id,
    'description', line.description, 'quantity', line.quantity,
    'unit_price', line.unit_price, 'line_total', line.line_total,
    'tracking_requirement', line.tracking_requirement,
    'product_type', product_template.product_type
  ) order by line.line_position), '[]'::jsonb)
  into v_existing_lines
  from public.sale_lines line
  join public.product_products product on product.id = line.product_id
  join public.product_templates product_template on product_template.id = product.product_template_id
  where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id;
  v_changed := v_sale.branch_id is distinct from p_branch_id
    or v_sale.customer_id is distinct from p_customer_id
    or v_sale.effective_sale_date is distinct from v_date
    or v_sale.currency_code is distinct from v_currency
    or v_sale.notes is distinct from v_notes
    or v_sale.total_amount is distinct from v_total
    or v_existing_lines is distinct from v_normalized_lines;
  if not v_changed then
    v_result := jsonb_build_object(
      'sale_id', p_sale_id, 'status', 'draft', 'version', v_sale.version,
      'total_amount', v_sale.total_amount, 'currency_code', v_sale.currency_code,
      'changed', false
    );
    update public.sales_command_requests set result = v_result, completed_at = now()
    where tenant_id = v_tenant_id and command_type = 'update_draft'
      and idempotency_key = btrim(p_idempotency_key);
    return v_result;
  end if;

  v_new_version := v_sale.version + 1;
  update public.sales set
    branch_id = p_branch_id, customer_id = p_customer_id,
    effective_sale_date = v_date, currency_code = v_currency,
    notes = v_notes, total_amount = v_total, version = v_new_version,
    updated_at = now()
  where id = p_sale_id and tenant_id = v_tenant_id
    and status = 'draft' and version = p_expected_version;
  if not found then
    raise exception using errcode = '40001', message = 'SALES_VERSION_CONFLICT';
  end if;
  delete from public.sale_lines line
  where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id;
  for v_item in select value from jsonb_array_elements(v_normalized_lines)
  loop
    insert into public.sale_lines (
      tenant_id, sale_id, line_position, product_id, description,
      quantity, unit_price, line_total, tracking_requirement
    ) values (
      v_tenant_id, p_sale_id, (v_item ->> 'line_position')::integer,
      (v_item ->> 'product_id')::uuid, v_item ->> 'description',
      (v_item ->> 'quantity')::numeric, (v_item ->> 'unit_price')::numeric,
      (v_item ->> 'line_total')::numeric, v_item ->> 'tracking_requirement'
    );
  end loop;
  insert into public.sale_events (
    tenant_id, sale_id, event_type, sale_version, actor_id, payload
  ) values (
    v_tenant_id, p_sale_id, 'sale_draft_updated', v_new_version, v_actor_id,
    jsonb_build_object(
      'version', v_new_version, 'line_count', jsonb_array_length(v_normalized_lines),
      'total_amount', v_total, 'branch_changed', v_sale.branch_id is distinct from p_branch_id,
      'customer_changed', v_sale.customer_id is distinct from p_customer_id,
      'effective_date_changed', v_sale.effective_sale_date is distinct from v_date
    )
  );
  v_result := jsonb_build_object(
    'sale_id', p_sale_id, 'status', 'draft', 'version', v_new_version,
    'total_amount', v_total, 'currency_code', v_currency, 'changed', true
  );
  update public.sales_command_requests set result = v_result, completed_at = now()
  where tenant_id = v_tenant_id and command_type = 'update_draft'
    and idempotency_key = btrim(p_idempotency_key);
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

create or replace function public.get_sale_readiness(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_sale public.sales%rowtype;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_line_count integer;
begin
  if v_tenant_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.view', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_VIEW_DENIED';
  end if;
  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = v_tenant_id;
  if not found or not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '23514', message = 'SALE_NOT_FOUND';
  end if;
  if v_sale.status <> 'draft' then
    v_blockers := v_blockers || '"SALE_NOT_DRAFT"'::jsonb;
  end if;
  if not exists (
    select 1 from public.branches branch
    where branch.id = v_sale.branch_id and branch.tenant_id = v_tenant_id and branch.is_active
  ) then v_blockers := v_blockers || '"BRANCH_INACTIVE"'::jsonb; end if;
  if not exists (
    select 1 from public.partners customer
    where customer.id = v_sale.customer_id and customer.tenant_id = v_tenant_id
      and customer.active and customer.customer_rank > 0
  ) then v_blockers := v_blockers || '"CUSTOMER_INVALID"'::jsonb; end if;
  select count(*) into v_line_count from public.sale_lines line
  where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id;
  if v_line_count = 0 then
    v_blockers := v_blockers || '"SALE_LINES_REQUIRED"'::jsonb;
  end if;
  if v_sale.total_amount <= 0 then
    v_blockers := v_blockers || '"SALE_TOTAL_MUST_BE_POSITIVE"'::jsonb;
  end if;
  if exists (
    select 1 from public.sale_lines line
    join public.product_products product
      on product.id = line.product_id and product.tenant_id = line.tenant_id
    join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
      and (not product.is_active or not template.is_active or not template.can_be_sold)
  ) then v_blockers := v_blockers || '"SALE_PRODUCT_INVALID"'::jsonb; end if;
  if exists (
    select 1 from public.sale_lines line
    where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
      and line.tracking_requirement = 'lot'
  ) then v_blockers := v_blockers || '"LOT_TRACKING_CONFIRMATION_SUPPORT_REQUIRED"'::jsonb; end if;
  if exists (
    select 1 from public.sale_lines line
    join public.product_products product on product.id = line.product_id
    join public.product_templates template on template.id = product.product_template_id
    where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
      and template.product_type in ('goods', 'consumable')
  ) then
    v_warnings := v_warnings || '"INVENTORY_AVAILABILITY_CHECK_REQUIRED_AT_CONFIRMATION"'::jsonb;
  end if;
  if exists (
    select 1 from public.sale_lines line
    where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
      and line.tracking_requirement = 'serial'
  ) then
    v_warnings := v_warnings || '"SERIAL_SELECTION_REQUIRED_AT_RESERVATION"'::jsonb;
  end if;
  return jsonb_build_object(
    'sale_id', p_sale_id, 'version', v_sale.version,
    'ready', jsonb_array_length(v_blockers) = 0,
    'blocking_reasons', v_blockers, 'warnings', v_warnings,
    'line_count', v_line_count, 'total_amount', v_sale.total_amount
  );
end
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'sale_number_sequences', 'sales', 'sale_lines',
    'sale_events', 'sales_command_requests'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from public, anon, authenticated', v_table);
  end loop;
end
$$;

grant select on public.sales, public.sale_lines, public.sale_events to authenticated;

create policy sales_read on public.sales
for select to authenticated using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('sales.access', tenant_id)
  and public.has_permission('sales.view', tenant_id)
  and public.has_branch_access(branch_id)
);
create policy sale_lines_read on public.sale_lines
for select to authenticated using (
  exists (
    select 1 from public.sales sale
    where sale.id = public.sale_lines.sale_id
      and sale.tenant_id = public.sale_lines.tenant_id
  )
);
create policy sale_events_read on public.sale_events
for select to authenticated using (
  exists (
    select 1 from public.sales sale
    where sale.id = public.sale_events.sale_id
      and sale.tenant_id = public.sale_events.tenant_id
  )
);

revoke all on function public.sales_request_fingerprint(jsonb) from public, anon, authenticated;
revoke all on function public.next_canonical_sale_number(uuid, date) from public, anon, authenticated;
revoke all on function public.create_sale(uuid, uuid, date, text, text, text) from public, anon;
revoke all on function public.update_sale_draft(uuid, bigint, uuid, uuid, date, text, text, jsonb, text) from public, anon;
revoke all on function public.get_sale(uuid) from public, anon;
revoke all on function public.get_sale_readiness(uuid) from public, anon;
grant execute on function public.create_sale(uuid, uuid, date, text, text, text) to authenticated;
grant execute on function public.update_sale_draft(uuid, bigint, uuid, uuid, date, text, text, jsonb, text) to authenticated;
grant execute on function public.get_sale(uuid) to authenticated;
grant execute on function public.get_sale_readiness(uuid) to authenticated;

comment on table public.sales is
  'Canonical commercial sale header. Status is commercial only: draft, confirmed or cancelled.';
comment on table public.sale_lines is
  'Canonical business sale lines. Totals and tracking requirements are derived server-side.';
comment on table public.sale_events is
  'Immutable limited business event trail; not a full row snapshot.';
comment on table public.sale_number_sequences is
  'Tenant/year-safe final sale numbering reserved for the future confirmation command.';
comment on function public.create_sale(uuid, uuid, date, text, text, text) is
  'Creates an empty Canonical draft only. No stock, accounting, receivable or payment side effect.';
comment on function public.update_sale_draft(uuid, bigint, uuid, uuid, date, text, text, jsonb, text) is
  'Full draft replacement with row lock, expected_version and server-authoritative totals.';
comment on function public.get_sale(uuid) is
  'Branch-scoped business-safe Canonical sale DTO.';
comment on function public.get_sale_readiness(uuid) is
  'Read-only commercial readiness. Inventory availability remains a confirmation-time check.';

notify pgrst, 'reload schema';

commit;
