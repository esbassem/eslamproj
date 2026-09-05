begin;

-- The marker is deployment-owned truth.  Existing rows are stamped generation
-- 1 before any tenant is activated; only subsequently inserted pending sales
-- can receive the active canonical generation.
create table public.showroom_financial_cutovers (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  source_app text not null,
  source_model text not null,
  canonical_generation integer not null,
  activation_origin text not null,
  activated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, source_app, source_model),
  constraint showroom_financial_cutovers_source_check
    check (source_app = 'showroom' and source_model = 'sale'),
  constraint showroom_financial_cutovers_generation_check
    check (canonical_generation >= 2),
  constraint showroom_financial_cutovers_origin_check
    check (activation_origin ~ '^[a-z][a-z0-9_]{2,99}$')
);

alter table public.showroom_financial_cutovers enable row level security;
alter table public.showroom_financial_cutovers force row level security;
revoke all on table public.showroom_financial_cutovers
  from public, anon, authenticated, service_role;

create or replace function public.guard_showroom_financial_cutover_marker()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null
     and current_setting('app.showroom_financial_cutover_maintenance', true)
       = 'authorized' then
    return old;
  end if;
  raise exception using errcode = '55000',
    message = 'SHOWROOM_FINANCIAL_CUTOVER_MARKER_IMMUTABLE';
end
$$;

-- A transaction-local capability lets the trusted Showroom command reuse the
-- exact Canonical Sale Posting contract without granting Showroom users the
-- generic financial.sale.post_operational permission.  It is declared before
-- that reused body so same-migration function validation can resolve it.
create or replace function public.is_trusted_showroom_sale_posting_context(
  p_tenant_id uuid,
  p_source_app text,
  p_source_model text,
  p_source_id text,
  p_event_version integer
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select current_setting('app.showroom_canonical_confirmation', true)
    = encode(extensions.digest(jsonb_build_object(
        'tenant_id', p_tenant_id,
        'source_app', lower(btrim(p_source_app)),
        'source_model', lower(btrim(p_source_model)),
        'source_id', btrim(p_source_id),
        'event_version', p_event_version
      )::text, 'sha256'), 'hex')
    and lower(btrim(p_source_app)) = 'showroom'
    and lower(btrim(p_source_model)) = 'sale'
$$;

create or replace function public.post_financial_sale_unbound_impl(
  p_tenant_id uuid,
  p_source_app text,
  p_source_model text,
  p_source_id text,
  p_event_version integer,
  p_idempotency_key text,
  p_source_business_fingerprint text,
  p_partner_id uuid,
  p_amount numeric,
  p_currency_code text,
  p_posting_date date,
  p_branch_id uuid,
  p_commercial_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_source_app text := lower(btrim(p_source_app));
  normalized_source_model text := lower(btrim(p_source_model));
  normalized_source_id text := btrim(p_source_id);
  normalized_idempotency_key text := btrim(p_idempotency_key);
  normalized_business_fingerprint text := lower(btrim(p_source_business_fingerprint));
  normalized_currency text := upper(btrim(p_currency_code));
  normalized_reference text := btrim(p_commercial_reference);
  normalized_amount numeric(18,2) := round(p_amount, 2);
  actor_id uuid;
  fingerprint text;
  existing public.financial_sale_postings%rowtype;
  posting_id uuid := gen_random_uuid();
  receivable_account_id uuid;
  revenue_account_id uuid;
  journal_id uuid;
  ledger_result jsonb;
  result jsonb;
begin
  if p_tenant_id is null or p_partner_id is null or p_posting_date is null then
    raise exception using errcode = '22023',
      message = 'FINANCIAL_SALE_REQUIRED_CONTEXT_MISSING';
  end if;
  if normalized_source_app is null
     or normalized_source_app !~ '^[a-z][a-z0-9_]*$'
     or normalized_source_model is null
     or normalized_source_model !~ '^[a-z][a-z0-9_]*$'
     or normalized_source_id is null
     or normalized_source_id = ''
     or length(normalized_source_id) > 200
  then
    raise exception using errcode = '22023',
      message = 'FINANCIAL_SALE_SOURCE_IDENTITY_INVALID';
  end if;
  if p_event_version is null or p_event_version <= 0 then
    raise exception using errcode = '22023',
      message = 'FINANCIAL_SALE_EVENT_VERSION_INVALID';
  end if;
  if normalized_idempotency_key is null
     or normalized_idempotency_key = ''
     or length(normalized_idempotency_key) > 200 then
    raise exception using errcode = '22023',
      message = 'FINANCIAL_SALE_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if normalized_business_fingerprint is null
     or normalized_business_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023',
      message = 'FINANCIAL_SALE_BUSINESS_FINGERPRINT_INVALID';
  end if;
  if p_amount is null or normalized_amount <= 0 or normalized_amount <> p_amount then
    raise exception using errcode = '22023',
      message = 'FINANCIAL_SALE_AMOUNT_INVALID';
  end if;
  if normalized_currency is null or normalized_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023',
      message = 'FINANCIAL_SALE_CURRENCY_INVALID';
  end if;
  if normalized_reference is null
     or normalized_reference = ''
     or length(normalized_reference) > 200 then
    raise exception using errcode = '22023',
      message = 'FINANCIAL_SALE_REFERENCE_INVALID';
  end if;

  if not public.is_trusted_showroom_sale_posting_context(
    p_tenant_id, normalized_source_app, normalized_source_model,
    normalized_source_id, p_event_version
  ) then
    perform public.assert_financial_authorized(
      p_tenant_id, 'financial.sale.post_operational',
      null, null, p_branch_id, true
    );
  end if;
  actor_id := public.current_tenant_user_id();
  if actor_id is null then
    raise exception using errcode = '42501',
      message = 'ACTIVE_TENANT_MEMBERSHIP_REQUIRED';
  end if;
  fingerprint := public.financial_sale_posting_request_fingerprint(
    p_tenant_id, normalized_source_app, normalized_source_model,
    normalized_source_id, p_event_version, normalized_business_fingerprint,
    p_partner_id, normalized_amount, normalized_currency,
    p_posting_date, p_branch_id, normalized_reference
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'financial_sale_posting:key:' || p_tenant_id::text || ':' || normalized_idempotency_key,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'financial_sale_posting:source:' || p_tenant_id::text || ':' ||
    normalized_source_app || ':' || normalized_source_model || ':' ||
    normalized_source_id || ':' || p_event_version::text,
    0
  ));

  select * into existing
  from public.financial_sale_postings item
  where item.tenant_id = p_tenant_id
    and item.idempotency_key = normalized_idempotency_key;
  if found then
    if existing.request_fingerprint <> fingerprint then
      raise exception using errcode = '23505',
        message = 'FINANCIAL_SALE_IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    result := public.get_financial_sale_posting(p_tenant_id, existing.id);
    return result || jsonb_build_object(
      'idempotent_replay', true,
      'replay_basis', 'idempotency_key'
    );
  end if;

  select * into existing
  from public.financial_sale_postings item
  where item.tenant_id = p_tenant_id
    and item.source_app = normalized_source_app
    and item.source_model = normalized_source_model
    and item.source_id = normalized_source_id
    and item.event_version = p_event_version;
  if found then
    if existing.request_fingerprint <> fingerprint then
      raise exception using errcode = '23505',
        message = 'FINANCIAL_SALE_SOURCE_EVENT_PAYLOAD_MISMATCH';
    end if;
    result := public.get_financial_sale_posting(p_tenant_id, existing.id);
    return result || jsonb_build_object(
      'idempotent_replay', true,
      'replay_basis', 'source_event'
    );
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.branches branch
    where branch.id = p_branch_id
      and branch.tenant_id = p_tenant_id
      and branch.is_active
  ) then
    raise exception using errcode = '23514',
      message = 'FINANCIAL_SALE_BRANCH_INVALID_OR_INACTIVE';
  end if;
  if not exists (
    select 1 from public.partners partner
    where partner.id = p_partner_id
      and partner.tenant_id = p_tenant_id
      and partner.active
      and partner.customer_rank > 0
  ) then
    raise exception using errcode = '23514',
      message = 'FINANCIAL_SALE_CUSTOMER_INVALID_OR_INACTIVE';
  end if;
  perform public.assert_financial_posting_date(p_tenant_id, p_posting_date);

  receivable_account_id := public.resolve_functional_account(
    p_tenant_id, 'customer_receivable', p_branch_id
  );
  revenue_account_id := public.resolve_functional_account(
    p_tenant_id, 'sales_revenue', p_branch_id
  );
  journal_id := public.resolve_financial_journal(
    p_tenant_id, 'sale', p_branch_id, null
  );

  perform set_config('app.financial_sale_posting_contract', posting_id::text, true);
  ledger_result := public.create_financial_sale_posting_move(
    posting_id, p_tenant_id, p_partner_id, normalized_amount,
    normalized_currency, p_posting_date, p_branch_id, normalized_reference,
    receivable_account_id, revenue_account_id, journal_id, actor_id
  );

  insert into public.financial_sale_postings (
    id, tenant_id, source_app, source_model, source_id, event_version,
    idempotency_key, request_fingerprint, source_business_fingerprint,
    state, account_move_id, receivable_line_id, partner_id, branch_id,
    amount, currency_code, posting_date, commercial_reference,
    created_by, posted_by
  ) values (
    posting_id, p_tenant_id, normalized_source_app, normalized_source_model,
    normalized_source_id, p_event_version, normalized_idempotency_key,
    fingerprint, normalized_business_fingerprint, 'posted',
    (ledger_result->>'account_move_id')::uuid,
    (ledger_result->>'receivable_line_id')::uuid,
    p_partner_id, p_branch_id, normalized_amount, normalized_currency,
    p_posting_date, normalized_reference, actor_id, actor_id
  );
  perform set_config('app.financial_sale_posting_contract', '', true);

  result := public.get_financial_sale_posting(p_tenant_id, posting_id);
  return result || jsonb_build_object(
    'idempotent_replay', false,
    'replay_basis', null
  );
end
$$;

create trigger showroom_financial_cutovers_immutable
before update or delete on public.showroom_financial_cutovers
for each row execute function public.guard_showroom_financial_cutover_marker();

alter table public.showroom_sales
  add column financial_confirmation_generation integer not null default 1;

alter table public.showroom_sales
  add constraint showroom_sales_financial_confirmation_generation_check
  check (financial_confirmation_generation > 0);

create or replace function public.assign_showroom_financial_confirmation_generation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  active_generation integer;
begin
  if tg_op = 'UPDATE' then
    if new.financial_confirmation_generation is distinct from
       old.financial_confirmation_generation then
      raise exception using errcode = '55000',
        message = 'SHOWROOM_FINANCIAL_CONFIRMATION_GENERATION_IMMUTABLE';
    end if;
    return new;
  end if;

  -- Return/replacement functions create already-confirmed sales and retain the
  -- Legacy generation until their own cutover phase.
  if new.status = 'pending_payment' then
    select marker.canonical_generation
    into active_generation
    from public.showroom_financial_cutovers marker
    where marker.tenant_id = new.tenant_id
      and marker.source_app = 'showroom'
      and marker.source_model = 'sale';
  end if;

  new.financial_confirmation_generation := coalesce(active_generation, 1);
  return new;
end
$$;

create trigger trg_assign_showroom_financial_confirmation_generation
before insert or update of financial_confirmation_generation
on public.showroom_sales
for each row execute function public.assign_showroom_financial_confirmation_generation();

revoke all on function public.guard_showroom_financial_cutover_marker()
  from public, anon, authenticated, service_role;
revoke all on function public.assign_showroom_financial_confirmation_generation()
  from public, anon, authenticated, service_role;
revoke all on function public.is_trusted_showroom_sale_posting_context(
  uuid, text, text, text, integer
) from public, anon, authenticated, service_role;

create or replace function public.get_financial_sale_posting(
  p_tenant_id uuid,
  p_posting_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  posting public.financial_sale_postings%rowtype;
  current_residual numeric;
begin
  select * into posting
  from public.financial_sale_postings item
  where item.id = p_posting_id
    and item.tenant_id = p_tenant_id;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'FINANCIAL_SALE_POSTING_NOT_FOUND';
  end if;
  if not public.is_trusted_showroom_sale_posting_context(
    posting.tenant_id, posting.source_app, posting.source_model,
    posting.source_id, posting.event_version
  ) then
    perform public.assert_financial_authorized(
      p_tenant_id, 'financial.sale.post_operational',
      null, null, posting.branch_id, true
    );
  end if;
  select line.amount_residual into current_residual
  from public.account_move_lines line
  where line.id = posting.receivable_line_id
    and line.tenant_id = posting.tenant_id;
  if not found then
    raise exception using errcode = '23514',
      message = 'FINANCIAL_SALE_POSTING_RECEIVABLE_MISSING';
  end if;
  return jsonb_build_object(
    'posting_id', posting.id,
    'account_move_id', posting.account_move_id,
    'receivable_line_id', posting.receivable_line_id,
    'partner_id', posting.partner_id,
    'original_amount', posting.amount,
    'current_residual', current_residual,
    'currency_code', posting.currency_code,
    'posting_date', posting.posting_date,
    'source_app', posting.source_app,
    'source_model', posting.source_model,
    'source_id', posting.source_id,
    'event_version', posting.event_version,
    'commercial_reference', posting.commercial_reference,
    'accounting_state', posting.state
  );
end
$$;

create or replace function public.get_showroom_legacy_confirmation_result(
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
  sale public.showroom_sales%rowtype;
  receivable_line public.account_move_lines%rowtype;
  paid_amount numeric(18,2) := 0;
  remaining_amount numeric(18,2) := 0;
begin
  select * into sale
  from public.showroom_sales item
  where item.id = p_sale_id
    and item.tenant_id = p_tenant_id;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'SHOWROOM_SALE_NOT_FOUND';
  end if;

  select line.* into receivable_line
  from public.account_move_lines line
  where line.tenant_id = sale.tenant_id
    and line.move_id = sale.account_move_id
    and line.debit > 0
    and public.account_matches_functional_role(
      line.tenant_id, line.account_id, 'customer_receivable', null
    )
  order by line.debit desc, line.id
  limit 1;

  if receivable_line.id is not null then
    select round(coalesce(sum(partial.amount), 0), 2)
    into paid_amount
    from public.account_partial_reconcile partial
    where partial.tenant_id = sale.tenant_id
      and partial.debit_move_id = receivable_line.id;
    remaining_amount := round(greatest(receivable_line.debit - paid_amount, 0), 2);
  else
    remaining_amount := round(coalesce(sale.total_amount, 0), 2);
  end if;

  return jsonb_build_object(
    'success', true,
    'already_completed', sale.status = 'confirmed',
    'sale_id', sale.id,
    'sale_number', sale.sale_number,
    'sale_account_move_id', sale.account_move_id,
    'cash_move_id', null,
    'open_credit_allocations', '[]'::jsonb,
    'total_amount', sale.total_amount,
    'accounting_paid_amount', paid_amount,
    'accounting_remaining_amount', remaining_amount,
    'status', sale.status,
    'financial_engine', 'legacy'
  );
end
$$;

create or replace function public.complete_showroom_sale_canonical_engine_impl(
  p_sale_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  sale public.showroom_sales%rowtype;
  actor_id uuid;
  effective_branch_id uuid;
  line_count integer;
  v_total_amount numeric(18,2);
  inventory_active boolean := false;
  business_fingerprint text;
  capability text;
  posting jsonb;
  sale_line record;
  tracking_unit public.stock_tracking_units%rowtype;
  quant public.stock_quants%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select item.* into sale
  from public.showroom_sales item
  where item.id = p_sale_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SHOWROOM_SALE_NOT_FOUND';
  end if;

  select tenant_user.id into actor_id
  from public.tenant_users tenant_user
  where tenant_user.tenant_id = sale.tenant_id
    and tenant_user.auth_user_id = auth.uid()
    and tenant_user.is_active
  order by tenant_user.created_at, tenant_user.id
  limit 1;
  if actor_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_TENANT_MEMBERSHIP_REQUIRED';
  end if;
  if not public.has_permission('showroom_point.access', sale.tenant_id) then
    raise exception using errcode = '42501', message = 'SHOWROOM_CONFIRMATION_PERMISSION_REQUIRED';
  end if;
  if not exists (
    select 1 from public.showroom_financial_cutovers marker
    where marker.tenant_id = sale.tenant_id
      and marker.source_app = 'showroom'
      and marker.source_model = 'sale'
      and marker.canonical_generation = sale.financial_confirmation_generation
  ) then
    raise exception using errcode = '55000', message = 'SHOWROOM_CANONICAL_GENERATION_NOT_ACTIVE';
  end if;
  if sale.status not in ('pending_payment', 'confirmed') then
    raise exception using errcode = '55000', message = 'SHOWROOM_SALE_NOT_CONFIRMABLE';
  end if;
  if sale.customer_id is null or not exists (
    select 1 from public.partners customer
    where customer.id = sale.customer_id
      and customer.tenant_id = sale.tenant_id
      and customer.active
      and customer.customer_rank > 0
  ) then
    raise exception using errcode = '23514', message = 'SHOWROOM_CUSTOMER_INVALID_OR_INACTIVE';
  end if;

  select coalesce(sale.branch_id, config.branch_id)
  into effective_branch_id
  from public.showroom_configs config
  where config.id = sale.showroom_config_id
    and config.tenant_id = sale.tenant_id
    and config.is_active;
  if not found then
    raise exception using errcode = '23514', message = 'SHOWROOM_CONFIG_INVALID_OR_INACTIVE';
  end if;
  if effective_branch_id is not null then
    if not exists (
      select 1 from public.branches branch
      where branch.id = effective_branch_id
        and branch.tenant_id = sale.tenant_id
        and branch.is_active
    ) then
      raise exception using errcode = '23514', message = 'SHOWROOM_BRANCH_INVALID_OR_INACTIVE';
    end if;
    if not public.has_branch_access(effective_branch_id) then
      raise exception using errcode = '42501', message = 'SHOWROOM_BRANCH_ACCESS_REQUIRED';
    end if;
  end if;

  perform item.id
  from public.showroom_sale_lines item
  where item.tenant_id = sale.tenant_id and item.sale_id = sale.id
  order by item.id
  for update;

  select round(coalesce(sum(item.total), 0), 2), count(*)
  into v_total_amount, line_count
  from public.showroom_sale_lines item
  where item.tenant_id = sale.tenant_id and item.sale_id = sale.id;
  if line_count = 0 or v_total_amount <= 0 then
    raise exception using errcode = '23514', message = 'SHOWROOM_SALE_LINES_INVALID';
  end if;
  if exists (
    select 1
    from public.showroom_sale_lines item
    left join public.product_products product
      on product.id = item.product_product_id and product.tenant_id = item.tenant_id
    left join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = item.tenant_id
    where item.tenant_id = sale.tenant_id and item.sale_id = sale.id
      and (product.id is null or not product.is_active
        or template.id is null or not template.is_active)
  ) then
    raise exception using errcode = '23514', message = 'SHOWROOM_SALE_PRODUCT_INVALID_OR_INACTIVE';
  end if;

  if sale.status = 'pending_payment' then
    if sale.account_move_id is not null then
      raise exception using errcode = '55000', message = 'SHOWROOM_SALE_ALREADY_HAS_ACCOUNT_MOVE';
    end if;

    perform unit.id
    from public.showroom_sale_lines item
    join public.product_products product
      on product.id = item.product_product_id and product.tenant_id = item.tenant_id
    join public.stock_tracking_units unit
      on unit.id = item.tracking_unit_id and unit.tenant_id = item.tenant_id
    where item.tenant_id = sale.tenant_id and item.sale_id = sale.id
      and product.tracking = 'serial'
    order by unit.id
    for update of unit;

    if exists (
      select 1
      from public.showroom_sale_lines item
      join public.product_products product
        on product.id = item.product_product_id and product.tenant_id = item.tenant_id
      left join public.stock_tracking_units unit
        on unit.id = item.tracking_unit_id and unit.tenant_id = item.tenant_id
      where item.tenant_id = sale.tenant_id and item.sale_id = sale.id
        and product.tracking = 'serial'
        and (unit.id is null or unit.status <> 'reserved'
          or unit.notes <> 'showroom_sale:' || sale.id::text)
    ) then
      raise exception using errcode = '55000', message = 'SHOWROOM_TRACKING_UNIT_NOT_RESERVED_FOR_SALE';
    end if;

    perform stock_quant.id
    from public.showroom_sale_lines item
    join public.product_products product
      on product.id = item.product_product_id and product.tenant_id = item.tenant_id
    join public.stock_quants stock_quant
      on stock_quant.tenant_id = item.tenant_id
     and stock_quant.product_product_id = item.product_product_id
    where item.tenant_id = sale.tenant_id and item.sale_id = sale.id
      and product.tracking <> 'serial'
    order by stock_quant.id
    for update of stock_quant;

    update public.showroom_sales
    set total_amount = v_total_amount,
        status = 'confirmed',
        updated_at = now()
    where id = sale.id
    returning * into sale;
  elsif sale.account_move_id is null then
    raise exception using errcode = '55000', message = 'SHOWROOM_CONFIRMED_SALE_ACCOUNT_MOVE_MISSING';
  end if;

  select encode(extensions.digest(jsonb_build_object(
    'sale_id', sale.id,
    'tenant_id', sale.tenant_id,
    'customer_id', sale.customer_id,
    'branch_id', effective_branch_id,
    'sale_date', sale.sale_date,
    'sale_number', sale.sale_number,
    'total_amount', v_total_amount,
    'lines', (
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'product_product_id', item.product_product_id,
        'tracking_unit_id', item.tracking_unit_id,
        'quantity', item.quantity,
        'unit_price', item.unit_price,
        'total', item.total
      ) order by item.id)
      from public.showroom_sale_lines item
      where item.tenant_id = sale.tenant_id and item.sale_id = sale.id
    )
  )::text, 'sha256'), 'hex')
  into business_fingerprint;

  capability := encode(extensions.digest(jsonb_build_object(
    'tenant_id', sale.tenant_id,
    'source_app', 'showroom',
    'source_model', 'sale',
    'source_id', sale.id::text,
    'event_version', 1
  )::text, 'sha256'), 'hex');
  perform set_config('app.showroom_canonical_confirmation', capability, true);
  posting := public.post_financial_sale(
    sale.tenant_id, 'showroom', 'sale', sale.id::text, 1,
    'showroom:sale:' || sale.id::text || ':v1', business_fingerprint,
    sale.customer_id, v_total_amount, 'EGP', sale.sale_date,
    effective_branch_id, sale.sale_number
  );
  perform set_config('app.showroom_canonical_confirmation', '', true);

  if sale.status = 'confirmed' and sale.account_move_id is null then
    select exists (
      select 1
      from public.tenant_modules tenant_module
      join public.ir_modules module on module.id = tenant_module.module_id
      where tenant_module.tenant_id = sale.tenant_id
        and tenant_module.state = 'installed'
        and module.technical_name = 'inventory'
    ) into inventory_active;

    for sale_line in
      select item.*, product.tracking, product.product_template_id,
        template.product_type
      from public.showroom_sale_lines item
      join public.product_products product
        on product.id = item.product_product_id and product.tenant_id = item.tenant_id
      join public.product_templates template
        on template.id = product.product_template_id and template.tenant_id = item.tenant_id
      where item.tenant_id = sale.tenant_id and item.sale_id = sale.id
      order by item.id
    loop
      if sale_line.tracking = 'serial' then
        select * into tracking_unit
        from public.stock_tracking_units unit
        where unit.id = sale_line.tracking_unit_id
          and unit.tenant_id = sale.tenant_id;
        update public.stock_tracking_units
        set status = 'sold', updated_at = now()
        where id = tracking_unit.id;
      end if;
      if inventory_active and sale_line.product_type <> 'service' then
        insert into public.stock_moves (
          tenant_id, product_product_id, product_template_id, tracking_unit_id,
          move_type, quantity, unit_price, reference_type, reference_id,
          notes, created_by
        ) values (
          sale.tenant_id, sale_line.product_product_id,
          sale_line.product_template_id, sale_line.tracking_unit_id,
          'out', sale_line.quantity, sale_line.unit_price, 'showroom_sale',
          sale.id, 'showroom_sale:' || sale.id::text, actor_id
        );
        if sale_line.tracking <> 'serial' then
          select * into quant
          from public.stock_quants stock_quant
          where stock_quant.tenant_id = sale.tenant_id
            and stock_quant.product_product_id = sale_line.product_product_id
          order by stock_quant.id
          limit 1;
          if quant.id is null then
            insert into public.stock_quants (
              tenant_id, product_product_id, product_template_id, quantity_on_hand
            ) values (
              sale.tenant_id, sale_line.product_product_id,
              sale_line.product_template_id, -sale_line.quantity
            );
          else
            update public.stock_quants
            set quantity_on_hand = quantity_on_hand - sale_line.quantity,
                updated_at = now()
            where id = quant.id;
          end if;
        end if;
      end if;
    end loop;

    update public.showroom_sales
    set account_move_id = (posting ->> 'account_move_id')::uuid,
        updated_at = now()
    where id = sale.id
    returning * into sale;
  elsif sale.account_move_id is distinct from (posting ->> 'account_move_id')::uuid then
    raise exception using errcode = '23505', message = 'SHOWROOM_CANONICAL_POSTING_MOVE_MISMATCH';
  end if;

  return jsonb_build_object(
    'success', true,
    'already_completed', coalesce((posting ->> 'idempotent_replay')::boolean, false),
    'sale_id', sale.id,
    'sale_number', sale.sale_number,
    'sale_account_move_id', (posting ->> 'account_move_id')::uuid,
    'cash_move_id', null,
    'open_credit_allocations', '[]'::jsonb,
    'total_amount', v_total_amount,
    'accounting_paid_amount', 0,
    'accounting_remaining_amount', (posting ->> 'current_residual')::numeric,
    'status', 'confirmed',
    'financial_engine', 'canonical',
    'financial_posting_state', posting ->> 'accounting_state',
    'financial_posting_id', (posting ->> 'posting_id')::uuid
  );
end
$$;

create or replace function public.complete_showroom_sale(
  p_sale_id uuid,
  p_cash_amount numeric default 0,
  p_cash_note text default null,
  p_open_credit_allocations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  sale public.showroom_sales%rowtype;
  actor_id uuid;
  result jsonb;
begin
  select item.* into sale
  from public.showroom_sales item
  where item.id = p_sale_id
  for update;
  if not found then
    return public.complete_showroom_sale_legacy_engine_impl(
      p_sale_id, p_cash_amount, p_cash_note, p_open_credit_allocations
    );
  end if;

  if sale.financial_confirmation_generation > 1 then
    if not exists (
      select 1 from public.showroom_financial_cutovers marker
      where marker.tenant_id = sale.tenant_id
        and marker.source_app = 'showroom'
        and marker.source_model = 'sale'
        and marker.canonical_generation = sale.financial_confirmation_generation
    ) then
      raise exception using errcode = '55000', message = 'SHOWROOM_CANONICAL_GENERATION_NOT_ACTIVE';
    end if;
    if coalesce(p_cash_amount, 0) <> 0
       or nullif(btrim(coalesce(p_cash_note, '')), '') is not null
       or p_open_credit_allocations is null
       or jsonb_typeof(p_open_credit_allocations) <> 'array'
       or jsonb_array_length(p_open_credit_allocations) <> 0 then
      raise exception using errcode = '0A000',
        message = 'CANONICAL_SHOWROOM_PAYMENT_DEFERRED_CONFIRM_WITH_ZERO_PAYMENT';
    end if;
    return public.complete_showroom_sale_canonical_engine_impl(p_sale_id);
  end if;

  select tenant_user.id into actor_id
  from public.tenant_users tenant_user
  where tenant_user.tenant_id = sale.tenant_id
    and tenant_user.auth_user_id = auth.uid()
    and tenant_user.is_active
  order by tenant_user.created_at, tenant_user.id
  limit 1;

  if sale.status = 'confirmed' and sale.account_move_id is not null then
    perform public.acquire_financial_engine_binding(
      sale.tenant_id, 'showroom', 'sale', sale.id::text, 1,
      'legacy', 'showroom_complete_sale', actor_id
    );
    return public.get_showroom_legacy_confirmation_result(sale.tenant_id, sale.id);
  end if;

  perform public.acquire_financial_engine_binding(
    sale.tenant_id, 'showroom', 'sale', sale.id::text, 1,
    'legacy', 'showroom_complete_sale', actor_id
  );
  result := public.complete_showroom_sale_legacy_engine_impl(
    p_sale_id, p_cash_amount, p_cash_note, p_open_credit_allocations
  );
  perform public.bind_showroom_sale_to_legacy_engine(
    sale.tenant_id, sale.id, 'showroom_complete_sale', actor_id
  );
  return result || jsonb_build_object('financial_engine', 'legacy');
end
$$;

-- Activate only tenants whose currently active Showroom branches can resolve
-- every dependency required by a fully-unpaid Canonical Sale Posting.
do $$
declare
  candidate record;
  config record;
  ready boolean;
begin
  for candidate in
    select distinct showroom_config.tenant_id
    from public.showroom_configs showroom_config
    where showroom_config.is_active
      and exists (
        select 1
        from public.tenant_chart_template_installations installation
        join public.canonical_chart_templates template
          on template.id = installation.template_id
        where installation.tenant_id = showroom_config.tenant_id
          and installation.status = 'installed'
          and template.status = 'active'
      )
  loop
    ready := true;
    begin
      for config in
        select distinct showroom_config.branch_id
        from public.showroom_configs showroom_config
        where showroom_config.tenant_id = candidate.tenant_id
          and showroom_config.is_active
      loop
        perform public.resolve_functional_account(
          candidate.tenant_id, 'customer_receivable', config.branch_id
        );
        perform public.resolve_functional_account(
          candidate.tenant_id, 'sales_revenue', config.branch_id
        );
        perform public.resolve_financial_journal(
          candidate.tenant_id, 'sale', config.branch_id, null
        );
      end loop;
    exception when others then
      ready := false;
    end;
    if ready then
      insert into public.showroom_financial_cutovers (
        tenant_id, source_app, source_model, canonical_generation,
        activation_origin
      ) values (
        candidate.tenant_id, 'showroom', 'sale', 2,
        'phase_2d_readiness_verified'
      ) on conflict (tenant_id, source_app, source_model) do nothing;
    end if;
  end loop;
end
$$;

revoke all on function public.get_showroom_legacy_confirmation_result(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_showroom_sale_canonical_engine_impl(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_showroom_sale_legacy_engine_impl(
  uuid, numeric, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.complete_showroom_sale(
  uuid, numeric, text, jsonb
) from public, anon, service_role;
grant execute on function public.complete_showroom_sale(
  uuid, numeric, text, jsonb
) to authenticated;

comment on table public.showroom_financial_cutovers is
'Backend-authoritative generation marker for new Showroom sale confirmation cutovers.';
comment on column public.showroom_sales.financial_confirmation_generation is
'Immutable confirmation engine generation. Existing and in-flight rows are generation 1.';
comment on function public.complete_showroom_sale_canonical_engine_impl(uuid) is
'Internal atomic Showroom confirmation command: commercial state, Canonical Sale Posting and inventory.';

notify pgrst, 'reload schema';

commit;
