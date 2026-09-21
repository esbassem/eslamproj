begin;

-- Phase 7B: a return is a new commercial fact. It does not cancel or mutate the
-- original Sale, posting or delivery. A cash refund remains a separate command.
insert into public.auth_permissions (
  code, name, description, resource, action,
  module_code, permission_type, sort_order, active
)
values
  ('sales.return', 'إرجاع مبيعات',
    'تسجيل مرتجع كلي أو جزئي لبيع Canonical تم تسليمه.',
    'sales', 'return', 'sales', 'action', 160, true),
  ('financial.sale.return', 'ترحيل مرتجع مبيعات',
    'إنشاء إشعار دائن Canonical لمرتجع بيع وتسويته على ذمة العميل.',
    'financial.sale', 'return', 'accountant_app', 'action', 165, true),
  ('settlement.refund', 'رد مبلغ للعميل',
    'تنفيذ Money-Out مستقل من رصيد مرتجع قابل للرد.',
    'settlement', 'refund', 'settlement', 'action', 120, true)
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

create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  return_number text not null,
  status text not null default 'completed',
  total_amount numeric(18,2) not null,
  destination_location_id uuid,
  reason text not null,
  sale_version bigint not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint sale_returns_sale_fkey foreign key (sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  constraint sale_returns_destination_location_fkey
    foreign key (destination_location_id, tenant_id)
    references public.stock_locations(id, tenant_id) on delete restrict,
  constraint sale_returns_actor_fkey foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sale_returns_number_unique unique (tenant_id, return_number),
  constraint sale_returns_id_tenant_unique unique (id, tenant_id),
  constraint sale_returns_status_check check (status = 'completed'),
  constraint sale_returns_amount_check check (
    total_amount > 0 and total_amount = round(total_amount, 2)
  ),
  constraint sale_returns_reason_check check (length(btrim(reason)) between 1 and 1000),
  constraint sale_returns_version_check check (sale_version > 0)
);

create table public.sale_return_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_return_id uuid not null,
  sale_id uuid not null,
  sale_line_id uuid not null,
  sale_delivery_line_id uuid,
  tracking_unit_id uuid,
  line_kind text not null,
  quantity numeric(18,4) not null,
  unit_price numeric(18,2) not null,
  return_amount numeric(18,2) not null,
  created_at timestamptz not null default now(),
  constraint sale_return_lines_return_fkey
    foreign key (sale_return_id, tenant_id)
    references public.sale_returns(id, tenant_id) on delete restrict,
  constraint sale_return_lines_sale_line_fkey
    foreign key (sale_line_id, tenant_id, sale_id)
    references public.sale_lines(id, tenant_id, sale_id) on delete restrict,
  constraint sale_return_lines_delivery_line_fkey
    foreign key (sale_delivery_line_id, tenant_id)
    references public.sale_delivery_lines(id, tenant_id) on delete restrict,
  constraint sale_return_lines_tracking_fkey
    foreign key (tracking_unit_id, tenant_id)
    references public.stock_tracking_units(id, tenant_id) on delete restrict,
  constraint sale_return_lines_id_tenant_unique unique (id, tenant_id),
  constraint sale_return_lines_kind_check check (line_kind in ('service', 'serial', 'quantity')),
  constraint sale_return_lines_quantity_check check (
    quantity > 0 and quantity = round(quantity, 4)
  ),
  constraint sale_return_lines_amount_check check (
    unit_price >= 0 and return_amount = round(quantity * unit_price, 2)
  ),
  constraint sale_return_lines_shape_check check (
    (line_kind = 'service' and sale_delivery_line_id is null and tracking_unit_id is null)
    or (line_kind = 'serial' and sale_delivery_line_id is not null
      and tracking_unit_id is not null and quantity = 1)
    or (line_kind = 'quantity' and sale_delivery_line_id is not null
      and tracking_unit_id is null)
  )
);

create unique index sale_return_serial_once
  on public.sale_return_lines (tenant_id, sale_line_id, tracking_unit_id)
  where tracking_unit_id is not null;
create index sale_return_lines_sale_idx
  on public.sale_return_lines (tenant_id, sale_id, sale_line_id);

create table public.sale_return_inventory_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_return_id uuid not null,
  sale_id uuid not null,
  sale_delivery_id uuid not null,
  inventory_return_id uuid not null,
  created_at timestamptz not null default now(),
  constraint sale_return_inventory_return_fkey
    foreign key (sale_return_id, tenant_id)
    references public.sale_returns(id, tenant_id) on delete restrict,
  constraint sale_return_inventory_delivery_fkey
    foreign key (sale_delivery_id, tenant_id, sale_id)
    references public.sale_deliveries(id, tenant_id, sale_id) on delete restrict,
  constraint sale_return_inventory_fact_fkey
    foreign key (inventory_return_id, tenant_id)
    references public.inventory_returns(id, tenant_id) on delete restrict,
  constraint sale_return_inventory_delivery_unique
    unique (tenant_id, sale_return_id, sale_delivery_id),
  constraint sale_return_inventory_fact_unique unique (tenant_id, inventory_return_id)
);

create table public.financial_sale_return_postings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_return_id uuid not null,
  original_sale_posting_id uuid not null,
  account_move_id uuid not null,
  customer_credit_line_id uuid not null,
  amount numeric(18,2) not null,
  ar_applied_amount numeric(18,2) not null,
  refundable_amount numeric(18,2) not null,
  currency_code varchar(3) not null,
  posting_date date not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint financial_sale_returns_return_fkey
    foreign key (sale_return_id, tenant_id)
    references public.sale_returns(id, tenant_id) on delete restrict,
  constraint financial_sale_returns_original_fkey
    foreign key (original_sale_posting_id, tenant_id)
    references public.financial_sale_postings(id, tenant_id) on delete restrict,
  constraint financial_sale_returns_move_fkey foreign key (account_move_id, tenant_id)
    references public.account_moves(id, tenant_id) on delete restrict,
  constraint financial_sale_returns_credit_fkey
    foreign key (customer_credit_line_id, tenant_id)
    references public.account_move_lines(id, tenant_id) on delete restrict,
  constraint financial_sale_returns_actor_fkey foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_sale_returns_return_unique unique (tenant_id, sale_return_id),
  constraint financial_sale_returns_move_unique unique (tenant_id, account_move_id),
  constraint financial_sale_returns_credit_unique unique (tenant_id, customer_credit_line_id),
  constraint financial_sale_returns_key_unique unique (tenant_id, idempotency_key),
  constraint financial_sale_returns_id_tenant_unique unique (id, tenant_id),
  constraint financial_sale_returns_amount_check check (
    amount > 0 and amount = round(amount, 2)
    and ar_applied_amount >= 0 and ar_applied_amount <= amount
    and refundable_amount = round(amount - ar_applied_amount, 2)
  ),
  constraint financial_sale_returns_currency_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint financial_sale_returns_key_check check (length(btrim(idempotency_key)) between 1 and 200),
  constraint financial_sale_returns_fingerprint_check check (request_fingerprint ~ '^[0-9a-f]{64}$')
);

alter table public.sale_returns
  add column financial_sale_return_posting_id uuid,
  add constraint sale_returns_financial_posting_fkey
    foreign key (financial_sale_return_posting_id, tenant_id)
    references public.financial_sale_return_postings(id, tenant_id) on delete restrict;

create table public.sale_refund_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  sale_return_id uuid not null,
  amount numeric(18,2) not null,
  payment_method_id uuid not null,
  money_destination_id uuid not null,
  reference text,
  notes text,
  reason text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  financial_refund_id uuid,
  result jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint sale_refund_commands_sale_fkey foreign key (sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  constraint sale_refund_commands_return_fkey foreign key (sale_return_id, tenant_id)
    references public.sale_returns(id, tenant_id) on delete restrict,
  constraint sale_refund_commands_method_fkey foreign key (payment_method_id, tenant_id)
    references public.financial_payment_methods(id, tenant_id) on delete restrict,
  constraint sale_refund_commands_destination_fkey foreign key (money_destination_id, tenant_id)
    references public.money_destinations(id, tenant_id) on delete restrict,
  constraint sale_refund_commands_refund_fkey foreign key (financial_refund_id, tenant_id)
    references public.financial_refunds(id, tenant_id) on delete restrict,
  constraint sale_refund_commands_actor_fkey foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint sale_refund_commands_unique unique (tenant_id, idempotency_key),
  constraint sale_refund_commands_id_tenant_unique unique (id, tenant_id),
  constraint sale_refund_commands_amount_check check (amount > 0 and amount = round(amount, 2)),
  constraint sale_refund_commands_reason_check check (length(btrim(reason)) between 1 and 1000),
  constraint sale_refund_commands_key_check check (length(btrim(idempotency_key)) between 1 and 200),
  constraint sale_refund_commands_fingerprint_check check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint sale_refund_commands_lifecycle_check check (
    (result is null and financial_refund_id is null and completed_at is null)
    or (result is not null and financial_refund_id is not null and completed_at is not null)
  )
);

alter table public.sales_command_requests
  add column return_sale_id uuid,
  add column return_expected_version bigint,
  add column sale_return_id uuid,
  add constraint sales_command_return_sale_fkey foreign key (return_sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  add constraint sales_command_return_fact_fkey foreign key (sale_return_id, tenant_id)
    references public.sale_returns(id, tenant_id) on delete restrict;

alter table public.sales_command_requests
  drop constraint sales_command_context_check,
  add constraint sales_command_context_check check (
    (command_type = 'confirm' and confirmation_sale_id is not null
      and confirmation_expected_version > 0 and delivery_sale_id is null
      and delivery_expected_version is null and cancellation_sale_id is null
      and cancellation_expected_version is null and return_sale_id is null
      and return_expected_version is null and sale_return_id is null)
    or (command_type = 'deliver' and confirmation_sale_id is null
      and confirmation_expected_version is null and delivery_sale_id is not null
      and delivery_expected_version > 0 and cancellation_sale_id is null
      and cancellation_expected_version is null and return_sale_id is null
      and return_expected_version is null and sale_return_id is null)
    or (command_type = 'cancel' and confirmation_sale_id is null
      and confirmation_expected_version is null and delivery_sale_id is null
      and delivery_expected_version is null and cancellation_sale_id is not null
      and cancellation_expected_version > 0 and return_sale_id is null
      and return_expected_version is null and sale_return_id is null)
    or (command_type = 'return' and confirmation_sale_id is null
      and confirmation_expected_version is null and delivery_sale_id is null
      and delivery_expected_version is null and cancellation_sale_id is null
      and cancellation_expected_version is null and return_sale_id is not null
      and return_expected_version > 0)
    or (command_type not in ('confirm', 'deliver', 'cancel', 'return')
      and confirmation_sale_id is null and confirmation_expected_version is null
      and delivery_sale_id is null and delivery_expected_version is null
      and cancellation_sale_id is null and cancellation_expected_version is null
      and return_sale_id is null and return_expected_version is null
      and sale_return_id is null)
  ),
  drop constraint sales_command_requests_type_check,
  add constraint sales_command_requests_type_check check (
    command_type in ('create', 'update_draft', 'confirm', 'deliver', 'cancel', 'return')
  );

alter table public.sale_events
  drop constraint sale_events_type_check,
  add constraint sale_events_type_check check (event_type in (
    'sale_created', 'sale_draft_updated', 'sale_confirmed', 'sale_cancelled',
    'delivery_requested', 'delivery_linked', 'return_initiated',
    'sale_partially_delivered', 'sale_delivered', 'sale_returned',
    'customer_refund_created'
  ));

create or replace function public.is_trusted_sales_return_context(
  p_tenant_id uuid,
  p_sale_return_id uuid,
  p_inventory_delivery_id uuid default null
)
returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.sales_command_requests command_request
    join public.sale_returns sale_return
      on sale_return.id = command_request.sale_return_id
     and sale_return.tenant_id = command_request.tenant_id
    where command_request.id::text = current_setting('app.canonical_sales_return_command', true)
      and command_request.tenant_id = p_tenant_id
      and command_request.command_type = 'return'
      and command_request.created_by = public.current_tenant_user_id()
      and command_request.result is null and command_request.completed_at is null
      and sale_return.id = p_sale_return_id
      and (p_inventory_delivery_id is null or exists (
        select 1 from public.sale_deliveries delivery
        where delivery.sale_id = sale_return.sale_id
          and delivery.tenant_id = sale_return.tenant_id
          and delivery.inventory_delivery_id = p_inventory_delivery_id
      ))
  )
$$;

-- Inventory still owns stock/state/move validation. The Sales return context
-- delegates only the inventory.return capability; branch/location checks remain.
do $$
declare v_definition text; v_rewritten text;
begin
  select pg_get_functiondef(
    'public.receive_inventory_return(uuid,uuid,text,text,jsonb,text)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    $search$or not public.has_permission('inventory.return', v_tenant_id) then$search$,
    $replacement$or (not public.has_permission('inventory.return', v_tenant_id)
       and not public.is_trusted_sales_return_context(
         v_tenant_id, nullif(split_part(p_source_id, ':', 1), '')::uuid, p_delivery_id
       )) then$replacement$
  );
  if v_rewritten = v_definition then
    raise exception 'SALES_RETURN_INVENTORY_PERMISSION_HOOK_NOT_APPLIED';
  end if;
  execute v_rewritten;
end
$$;

create or replace function public.post_financial_sale_return(
  p_tenant_id uuid,
  p_sale_return_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_return public.sale_returns%rowtype;
  v_sale public.sales%rowtype;
  v_original public.financial_sale_postings%rowtype;
  v_existing public.financial_sale_return_postings%rowtype;
  v_receivable public.account_move_lines%rowtype;
  v_actor uuid := public.current_tenant_user_id();
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_fingerprint text;
  v_posting_id uuid := gen_random_uuid();
  v_move_id uuid := gen_random_uuid();
  v_credit_line_id uuid := gen_random_uuid();
  v_revenue_line_id uuid := gen_random_uuid();
  v_partial_id uuid := gen_random_uuid();
  v_receivable_account uuid;
  v_revenue_account uuid;
  v_journal uuid;
  v_apply numeric(18,2);
  v_credit_remaining numeric(18,2);
begin
  if p_tenant_id is null or p_sale_return_id is null or v_actor is null
     or public.current_tenant_id() is distinct from p_tenant_id then
    raise exception using errcode = '42501', message = 'FINANCIAL_SALE_RETURN_DENIED';
  end if;
  select * into v_return from public.sale_returns item
  where item.id = p_sale_return_id and item.tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'SALE_RETURN_NOT_FOUND'; end if;
  select * into v_sale from public.sales sale
  where sale.id = v_return.sale_id and sale.tenant_id = p_tenant_id;
  if not public.is_trusted_sales_return_context(p_tenant_id, p_sale_return_id)
     and not public.has_permission('financial.sale.return', p_tenant_id) then
    raise exception using errcode = '42501', message = 'FINANCIAL_SALE_RETURN_DENIED';
  end if;
  if not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '42501', message = 'FINANCIAL_SALE_RETURN_SCOPE_DENIED';
  end if;
  if v_key is null or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'FINANCIAL_SALE_RETURN_IDEMPOTENCY_INVALID';
  end if;
  v_fingerprint := public.sales_request_fingerprint(jsonb_build_object(
    'sale_return_id', p_sale_return_id, 'amount', v_return.total_amount
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'financial-sale-return:' || p_tenant_id::text || ':' || p_sale_return_id::text, 0
  ));
  select * into v_existing from public.financial_sale_return_postings posting
  where posting.tenant_id = p_tenant_id and posting.sale_return_id = p_sale_return_id;
  if found then
    if v_existing.idempotency_key <> v_key or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'FINANCIAL_SALE_RETURN_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'financial_return_reference', 'SRT-' || upper(substr(replace(v_existing.id::text, '-', ''), 1, 12)),
      'amount', v_existing.amount, 'ar_applied_amount', v_existing.ar_applied_amount,
      'refundable_amount', v_existing.refundable_amount, 'idempotent_replay', true
    );
  end if;
  select posting.* into v_original
  from public.sale_confirmation_links confirmation
  join public.financial_sale_postings posting
    on posting.id = confirmation.financial_sale_posting_id
   and posting.tenant_id = confirmation.tenant_id
  where confirmation.sale_id = v_sale.id and confirmation.tenant_id = p_tenant_id
    and posting.source_app = 'sales_core' and posting.source_model = 'sale'
    and posting.source_id = v_sale.id::text and posting.state = 'posted';
  if not found then raise exception using errcode = '23514', message = 'SALE_FINANCIAL_RETURN_SOURCE_INVALID'; end if;
  select * into v_receivable from public.account_move_lines line
  where line.id = v_original.receivable_line_id and line.tenant_id = p_tenant_id
    and line.parent_state = 'posted' and line.line_type = 'open_item'
    and line.debit > 0 and line.credit = 0 for update;
  if not found then raise exception using errcode = '23514', message = 'SALE_FINANCIAL_RETURN_SOURCE_INVALID'; end if;
  perform public.assert_financial_posting_date(p_tenant_id, current_date);
  v_receivable_account := public.resolve_functional_account(p_tenant_id, 'customer_receivable', v_sale.branch_id);
  v_revenue_account := public.resolve_functional_account(p_tenant_id, 'sales_revenue', v_sale.branch_id);
  v_journal := public.resolve_financial_journal(p_tenant_id, 'sale', v_sale.branch_id, null);
  if v_receivable.account_id is distinct from v_receivable_account then
    raise exception using errcode = '23514', message = 'SALE_FINANCIAL_RETURN_ACCOUNT_INVALID';
  end if;
  v_apply := least(v_return.total_amount, greatest(v_receivable.amount_residual, 0));
  v_credit_remaining := v_return.total_amount - v_apply;
  insert into public.account_moves (
    id, tenant_id, branch_id, journal_id, name, move_type, partner_id,
    invoice_date, date, amount_total, state, ref, notes, pay_method,
    currency_code, created_by, reversed_move_id
  ) values (
    v_move_id, p_tenant_id, v_sale.branch_id, v_journal,
    'RETURN-' || v_return.return_number, 'refund', v_sale.customer_id,
    current_date, current_date, v_return.total_amount, 'posted',
    'financial_sale_return:' || v_posting_id::text,
    'Canonical partial/full Sale return credit', 'canonical_sale_return',
    v_sale.currency_code, v_actor, v_original.account_move_id
  );
  insert into public.account_move_lines (
    id, tenant_id, move_id, account_id, partner_id, label, quantity, unit_price,
    debit, credit, line_type, is_reconciled, amount_residual,
    amount_residual_currency, parent_state, currency_code, created_by
  ) values
  (v_credit_line_id, p_tenant_id, v_move_id, v_receivable_account, v_sale.customer_id,
    'Customer credit — ' || v_return.return_number, 1, v_return.total_amount,
    0, v_return.total_amount, 'open_item', false,
    v_return.total_amount, v_return.total_amount, 'posted', v_sale.currency_code, v_actor),
  (v_revenue_line_id, p_tenant_id, v_move_id, v_revenue_account, null,
    'Sales return — ' || v_return.return_number, 1, v_return.total_amount,
    v_return.total_amount, 0, 'income', true, 0, 0,
    'posted', v_sale.currency_code, v_actor);
  if v_apply > 0 then
    insert into public.account_partial_reconcile (
      id, tenant_id, debit_move_id, credit_move_id, amount, max_date, created_by
    ) values (
      v_partial_id, p_tenant_id, v_receivable.id, v_credit_line_id,
      v_apply, current_date, v_actor
    );
  end if;
  perform public.accounting_assert_move_balanced(v_move_id);
  insert into public.financial_sale_return_postings (
    id, tenant_id, sale_return_id, original_sale_posting_id, account_move_id,
    customer_credit_line_id, amount, ar_applied_amount, refundable_amount,
    currency_code, posting_date, idempotency_key, request_fingerprint, created_by
  ) values (
    v_posting_id, p_tenant_id, p_sale_return_id, v_original.id, v_move_id,
    v_credit_line_id, v_return.total_amount, v_apply, v_credit_remaining,
    v_sale.currency_code, current_date, v_key, v_fingerprint, v_actor
  );
  return jsonb_build_object(
    'financial_return_reference', 'SRT-' || upper(substr(replace(v_posting_id::text, '-', ''), 1, 12)),
    'amount', v_return.total_amount, 'ar_applied_amount', v_apply,
    'refundable_amount', v_credit_remaining, 'idempotent_replay', false
  );
end
$$;

create or replace function public.get_sale_return_eligibility(p_sale_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_sale public.sales%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_destinations jsonb := '[]'::jsonb;
  v_returns jsonb := '[]'::jsonb;
  v_returnable_count integer := 0;
  v_returned_amount numeric(18,2) := 0;
  v_settled numeric(18,2) := 0;
  v_refundable numeric(18,2) := 0;
  v_outstanding numeric(18,2) := 0;
  v_blockers jsonb := '[]'::jsonb;
begin
  if v_tenant is null or not public.has_permission('sales.access', v_tenant)
     or not public.has_permission('sales.view', v_tenant) then
    raise exception using errcode = '42501', message = 'SALES_RETURN_VIEW_DENIED';
  end if;
  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = v_tenant;
  if not found then raise exception using errcode = 'P0002', message = 'SALE_NOT_FOUND'; end if;
  if not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '42501', message = 'SALE_RETURN_SCOPE_DENIED';
  end if;
  if v_sale.status <> 'confirmed' then v_blockers := v_blockers || '"SALE_NOT_CONFIRMED"'::jsonb; end if;
  if not public.has_permission('sales.return', v_tenant) then
    v_blockers := v_blockers || '"SALES_RETURN_DENIED"'::jsonb;
  end if;

  with line_state as (
    select line.id, line.line_position, line.description, line.quantity,
      line.unit_price, line.tracking_requirement, product.display_name,
      template.product_type,
      coalesce((select sum(delivered.quantity) from public.sale_delivery_lines delivered
        where delivered.sale_line_id = line.id and delivered.tenant_id = line.tenant_id), 0) delivered,
      coalesce((select sum(returned.quantity) from public.sale_return_lines returned
        where returned.sale_line_id = line.id and returned.tenant_id = line.tenant_id), 0) returned
    from public.sale_lines line
    join public.product_products product on product.id = line.product_id and product.tenant_id = line.tenant_id
    join public.product_templates template on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where line.sale_id = p_sale_id and line.tenant_id = v_tenant
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_line_id', state.id, 'position', state.line_position,
    'description', state.description, 'product_name', state.display_name,
    'kind', case when state.product_type = 'service' then 'service'
      when state.tracking_requirement = 'serial' then 'serial' else 'quantity' end,
    'delivered_quantity', case when state.product_type = 'service' then state.quantity else state.delivered end,
    'already_returned_quantity', state.returned,
    'returnable_quantity', greatest((case when state.product_type = 'service' then state.quantity else state.delivered end) - state.returned, 0),
    'unit_price', state.unit_price,
    'returnable_amount', round(greatest((case when state.product_type = 'service' then state.quantity else state.delivered end) - state.returned, 0) * state.unit_price, 2),
    'serialized_units', case when state.tracking_requirement = 'serial' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'tracking_unit_id', delivered.tracking_unit_id,
        'tracking_number', unit.tracking_number,
        'chassis_number', coalesce(chassis.value, unit.tracking_number),
        'engine_number', engine.value
      ) order by coalesce(chassis.value, unit.tracking_number), unit.id)
      from public.sale_delivery_lines delivered
      join public.stock_tracking_units unit on unit.id = delivered.tracking_unit_id and unit.tenant_id = delivered.tenant_id
      left join lateral (select identifier.value from public.stock_tracking_unit_identifiers identifier
        join public.product_tracking_identifier_types kind on kind.id = identifier.identifier_type_id and kind.tenant_id = identifier.tenant_id
        where identifier.tracking_unit_id = unit.id and identifier.tenant_id = unit.tenant_id
          and not identifier.is_not_available and (kind.code || ' ' || kind.name) ~* '(chassis|شاسيه)'
        order by identifier.created_at, identifier.id limit 1) chassis on true
      left join lateral (select identifier.value from public.stock_tracking_unit_identifiers identifier
        join public.product_tracking_identifier_types kind on kind.id = identifier.identifier_type_id and kind.tenant_id = identifier.tenant_id
        where identifier.tracking_unit_id = unit.id and identifier.tenant_id = unit.tenant_id
          and not identifier.is_not_available and (kind.code || ' ' || kind.name) ~* '(engine|motor|موتور|محرك)'
        order by identifier.created_at, identifier.id limit 1) engine on true
      where delivered.sale_line_id = state.id and delivered.tenant_id = v_tenant
        and not exists (select 1 from public.sale_return_lines returned
          where returned.sale_line_id = state.id and returned.tracking_unit_id = delivered.tracking_unit_id
            and returned.tenant_id = v_tenant)
    ), '[]'::jsonb) else '[]'::jsonb end
  ) order by state.line_position), '[]'::jsonb),
  count(*) filter (where greatest((case when state.product_type = 'service' then state.quantity else state.delivered end) - state.returned, 0) > 0)
  into v_lines, v_returnable_count from line_state state;

  select coalesce(jsonb_agg(jsonb_build_object('id', location.id, 'name', location.name)
    order by location.name, location.id), '[]'::jsonb)
  into v_destinations
  from public.stock_locations location
  where location.tenant_id = v_tenant and location.branch_id = v_sale.branch_id
    and location.is_active and public.has_stock_location_access(location.id);

  select coalesce(sum(settlement.amount), 0) into v_settled
  from public.obligation_settlements settlement
  where settlement.tenant_id = v_tenant and settlement.target_type = 'sale'
    and settlement.target_id = p_sale_id::text and settlement.status = 'recorded';
  select coalesce(receivable.amount_residual, 0) into v_outstanding
  from public.sale_confirmation_links confirmation
  join public.financial_sale_postings posting on posting.id = confirmation.financial_sale_posting_id and posting.tenant_id = confirmation.tenant_id
  join public.account_move_lines receivable on receivable.id = posting.receivable_line_id and receivable.tenant_id = posting.tenant_id
  where confirmation.sale_id = p_sale_id and confirmation.tenant_id = v_tenant;
  select coalesce(sum(posting.amount), 0), coalesce(sum(credit.amount_residual), 0)
  into v_returned_amount, v_refundable
  from public.sale_returns sale_return
  join public.financial_sale_return_postings posting on posting.sale_return_id = sale_return.id and posting.tenant_id = sale_return.tenant_id
  join public.account_move_lines credit on credit.id = posting.customer_credit_line_id and credit.tenant_id = posting.tenant_id
  where sale_return.sale_id = p_sale_id and sale_return.tenant_id = v_tenant;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', sale_return.id, 'return_number', sale_return.return_number,
    'created_at', sale_return.created_at, 'reason', sale_return.reason,
    'amount', sale_return.total_amount,
    'refunded_amount', posting.refundable_amount - credit.amount_residual,
    'remaining_refundable_amount', credit.amount_residual,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
      'sale_line_id', returned.sale_line_id, 'description', line.description,
      'quantity', returned.quantity, 'tracking_unit_id', returned.tracking_unit_id,
      'return_amount', returned.return_amount
    ) order by line.line_position, returned.id)
    from public.sale_return_lines returned join public.sale_lines line
      on line.id = returned.sale_line_id and line.tenant_id = returned.tenant_id
    where returned.sale_return_id = sale_return.id), '[]'::jsonb)
  ) order by sale_return.created_at desc, sale_return.id desc), '[]'::jsonb)
  into v_returns
  from public.sale_returns sale_return
  join public.financial_sale_return_postings posting on posting.sale_return_id = sale_return.id and posting.tenant_id = sale_return.tenant_id
  join public.account_move_lines credit on credit.id = posting.customer_credit_line_id and credit.tenant_id = posting.tenant_id
  where sale_return.sale_id = p_sale_id and sale_return.tenant_id = v_tenant;

  if v_returnable_count = 0 then v_blockers := v_blockers || '"SALE_HAS_NO_RETURNABLE_LINES"'::jsonb; end if;
  return jsonb_build_object(
    'sale_id', v_sale.id, 'sale_number', v_sale.sale_number,
    'customer', jsonb_build_object('id', v_sale.customer_id,
      'name', (select name from public.partners where id = v_sale.customer_id and tenant_id = v_tenant)),
    'branch_id', v_sale.branch_id, 'currency_code', v_sale.currency_code,
    'expected_version', v_sale.version,
    'can_return', jsonb_array_length(v_blockers) = 0,
    'blocking_reasons', v_blockers, 'lines', v_lines,
    'destinations', v_destinations,
    'return_status', case when v_returned_amount <= 0 then 'no_return'
      when v_returned_amount >= v_sale.total_amount then 'fully_returned'
      else 'partially_returned' end,
    'financial', jsonb_build_object(
      'sale_amount', v_sale.total_amount, 'settled_amount', v_settled,
      'outstanding_amount', v_outstanding, 'returned_amount', v_returned_amount,
      'refundable_amount', v_refundable, 'currency_code', v_sale.currency_code
    ),
    'returns', v_returns
  );
end
$$;

create or replace function public.return_sale(
  p_sale_id uuid,
  p_expected_version bigint,
  p_return_lines jsonb,
  p_destination_location_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_actor uuid := public.current_tenant_user_id();
  v_sale public.sales%rowtype;
  v_command public.sales_command_requests%rowtype;
  v_command_id uuid := gen_random_uuid();
  v_return_id uuid := gen_random_uuid();
  v_return_number text;
  v_reason text := nullif(btrim(p_reason), '');
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_item jsonb;
  v_line public.sale_lines%rowtype;
  v_template_type text;
  v_line_id uuid;
  v_tracking uuid;
  v_quantity numeric;
  v_normalized jsonb := '[]'::jsonb;
  v_fingerprint text;
  v_claimed integer := 0;
  v_available numeric;
  v_remaining numeric;
  v_delivery_line public.sale_delivery_lines%rowtype;
  v_inventory_lines jsonb;
  v_inventory_result jsonb;
  v_total numeric(18,2) := 0;
  v_financial jsonb;
  v_new_version bigint;
  v_result jsonb;
  v_has_inventory boolean := false;
  v_delivery record;
begin
  if v_tenant is null or v_actor is null or not public.has_permission('sales.access', v_tenant)
     or not public.has_permission('sales.view', v_tenant)
     or not public.has_permission('sales.return', v_tenant) then
    raise exception using errcode = '42501', message = 'SALES_RETURN_DENIED';
  end if;
  if v_reason is null or length(v_reason) > 1000 or v_key is null or length(v_key) > 160 then
    raise exception using errcode = '22023', message = 'SALES_RETURN_INPUT_INVALID';
  end if;
  if jsonb_typeof(p_return_lines) <> 'array' or jsonb_array_length(p_return_lines) = 0
     or jsonb_array_length(p_return_lines) > 200 then
    raise exception using errcode = '22023', message = 'SALE_RETURN_LINES_INVALID';
  end if;
  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = v_tenant for update;
  if not found then raise exception using errcode = 'P0002', message = 'SALE_NOT_FOUND'; end if;
  if not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '42501', message = 'SALE_RETURN_SCOPE_DENIED';
  end if;
  for v_item in select value from jsonb_array_elements(p_return_lines) loop
    if jsonb_typeof(v_item) <> 'object'
       or v_item - array['sale_line_id', 'tracking_unit_id', 'quantity'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'SALE_RETURN_LINE_INVALID';
    end if;
    begin
      v_line_id := nullif(v_item ->> 'sale_line_id', '')::uuid;
      v_tracking := nullif(v_item ->> 'tracking_unit_id', '')::uuid;
      v_quantity := (v_item ->> 'quantity')::numeric;
    exception when others then raise exception using errcode = '22023', message = 'SALE_RETURN_LINE_INVALID'; end;
    if v_line_id is null or v_quantity is null or v_quantity <= 0 or v_quantity <> round(v_quantity, 4) then
      raise exception using errcode = '22023', message = 'SALE_RETURN_LINE_INVALID';
    end if;
    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'sale_line_id', v_line_id, 'tracking_unit_id', v_tracking, 'quantity', v_quantity
    ));
  end loop;
  if exists (select 1 from jsonb_array_elements(v_normalized) item
    group by item ->> 'sale_line_id', coalesce(item ->> 'tracking_unit_id', '') having count(*) > 1) then
    raise exception using errcode = '22023', message = 'SALE_RETURN_LINES_DUPLICATE';
  end if;
  select coalesce(jsonb_agg(item order by item ->> 'sale_line_id', coalesce(item ->> 'tracking_unit_id', '')), '[]'::jsonb)
  into v_normalized from jsonb_array_elements(v_normalized) item;
  v_fingerprint := public.sales_request_fingerprint(jsonb_build_object(
    'sale_id', p_sale_id, 'expected_version', p_expected_version,
    'return_lines', v_normalized, 'destination_location_id', p_destination_location_id,
    'reason', v_reason
  ));
  insert into public.sales_command_requests (
    id, tenant_id, command_type, idempotency_key, request_fingerprint,
    created_by, return_sale_id, return_expected_version
  ) values (
    v_command_id, v_tenant, 'return', v_key, v_fingerprint,
    v_actor, p_sale_id, p_expected_version
  ) on conflict (tenant_id, command_type, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    select * into v_command from public.sales_command_requests request
    where request.tenant_id = v_tenant and request.command_type = 'return'
      and request.idempotency_key = v_key for update;
    if v_command.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'SALES_RETURN_IDEMPOTENCY_CONFLICT';
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

  -- Lock the delivered facts while deriving availability. Services have a
  -- commercial credit only; goods must have an actual delivery fact.
  for v_item in select value from jsonb_array_elements(v_normalized) loop
    v_line_id := (v_item ->> 'sale_line_id')::uuid;
    v_tracking := nullif(v_item ->> 'tracking_unit_id', '')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    select line.* into v_line from public.sale_lines line
    where line.id = v_line_id and line.sale_id = p_sale_id
      and line.tenant_id = v_tenant;
    if not found then raise exception using errcode = '23514', message = 'SALE_RETURN_LINE_NOT_FOUND'; end if;
    select template.product_type into v_template_type
    from public.product_products product
    join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where product.id = v_line.product_id and product.tenant_id = v_tenant;
    if v_template_type = 'service' then
      if v_tracking is not null then raise exception using errcode = '23514', message = 'SALE_RETURN_SERVICE_HAS_NO_INVENTORY'; end if;
      select v_line.quantity - coalesce(sum(returned.quantity), 0) into v_available
      from public.sale_return_lines returned
      where returned.sale_line_id = v_line.id and returned.tenant_id = v_tenant;
    elsif v_line.tracking_requirement = 'serial' then
      if v_tracking is null or v_quantity <> 1 then
        raise exception using errcode = '23514', message = 'SALE_RETURN_SERIAL_INVALID';
      end if;
      select delivered.* into v_delivery_line
      from public.sale_delivery_lines delivered
      where delivered.sale_line_id = v_line.id and delivered.sale_id = p_sale_id
        and delivered.tenant_id = v_tenant and delivered.tracking_unit_id = v_tracking
      for update;
      if not found or exists (select 1 from public.sale_return_lines returned
        where returned.sale_line_id = v_line.id and returned.tracking_unit_id = v_tracking
          and returned.tenant_id = v_tenant) then
        raise exception using errcode = '23514', message = 'SALE_RETURN_SERIAL_NOT_RETURNABLE';
      end if;
      v_available := 1;
      v_has_inventory := true;
    else
      if v_tracking is not null then raise exception using errcode = '23514', message = 'SALE_RETURN_QUANTITY_TRACKING_INVALID'; end if;
      perform 1 from public.sale_delivery_lines delivered
      where delivered.sale_line_id = v_line.id and delivered.sale_id = p_sale_id
        and delivered.tenant_id = v_tenant for update;
      select coalesce(sum(delivered.quantity), 0)
        - coalesce((select sum(returned.quantity) from public.sale_return_lines returned
          where returned.sale_line_id = v_line.id and returned.tenant_id = v_tenant), 0)
      into v_available
      from public.sale_delivery_lines delivered
      where delivered.sale_line_id = v_line.id and delivered.sale_id = p_sale_id
        and delivered.tenant_id = v_tenant;
      v_has_inventory := true;
    end if;
    if v_quantity > coalesce(v_available, 0) then
      raise exception using errcode = '23514', message = 'SALE_RETURN_EXCEEDS_DELIVERED_QUANTITY';
    end if;
    v_total := v_total + round(v_quantity * v_line.unit_price, 2);
  end loop;
  if v_total <= 0 then raise exception using errcode = '23514', message = 'SALE_RETURN_AMOUNT_INVALID'; end if;
  if v_has_inventory and (p_destination_location_id is null or not exists (
    select 1 from public.stock_locations location
    where location.id = p_destination_location_id and location.tenant_id = v_tenant
      and location.branch_id = v_sale.branch_id and location.is_active
      and public.has_stock_location_access(location.id)
  )) then
    raise exception using errcode = '42501', message = 'SALE_RETURN_DESTINATION_DENIED';
  end if;
  if not v_has_inventory and p_destination_location_id is not null then
    raise exception using errcode = '23514', message = 'SALE_RETURN_SERVICE_DESTINATION_NOT_ALLOWED';
  end if;

  v_return_number := 'SRT-' || upper(substr(replace(v_return_id::text, '-', ''), 1, 12));
  insert into public.sale_returns (
    id, tenant_id, sale_id, return_number, total_amount,
    destination_location_id, reason, sale_version, created_by
  ) values (
    v_return_id, v_tenant, p_sale_id, v_return_number, v_total,
    p_destination_location_id, v_reason, p_expected_version + 1, v_actor
  );
  update public.sales_command_requests set sale_return_id = v_return_id
  where id = v_command_id;
  perform set_config('app.canonical_sales_return_command', v_command_id::text, true);

  for v_item in select value from jsonb_array_elements(v_normalized) loop
    v_line_id := (v_item ->> 'sale_line_id')::uuid;
    v_tracking := nullif(v_item ->> 'tracking_unit_id', '')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    select line.* into v_line from public.sale_lines line
    where line.id = v_line_id and line.sale_id = p_sale_id and line.tenant_id = v_tenant;
    select template.product_type into v_template_type
    from public.product_products product join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where product.id = v_line.product_id and product.tenant_id = v_tenant;
    if v_template_type = 'service' then
      insert into public.sale_return_lines (
        tenant_id, sale_return_id, sale_id, sale_line_id, line_kind,
        quantity, unit_price, return_amount
      ) values (
        v_tenant, v_return_id, p_sale_id, v_line.id, 'service',
        v_quantity, v_line.unit_price, round(v_quantity * v_line.unit_price, 2)
      );
    elsif v_line.tracking_requirement = 'serial' then
      select delivered.* into v_delivery_line from public.sale_delivery_lines delivered
      where delivered.sale_line_id = v_line.id and delivered.sale_id = p_sale_id
        and delivered.tenant_id = v_tenant and delivered.tracking_unit_id = v_tracking;
      insert into public.sale_return_lines (
        tenant_id, sale_return_id, sale_id, sale_line_id, sale_delivery_line_id,
        tracking_unit_id, line_kind, quantity, unit_price, return_amount
      ) values (
        v_tenant, v_return_id, p_sale_id, v_line.id, v_delivery_line.id,
        v_tracking, 'serial', 1, v_line.unit_price, v_line.unit_price
      );
    else
      v_remaining := v_quantity;
      for v_delivery_line in
        select delivered.* from public.sale_delivery_lines delivered
        where delivered.sale_line_id = v_line.id and delivered.sale_id = p_sale_id
          and delivered.tenant_id = v_tenant
        order by delivered.created_at, delivered.id
      loop
        select v_delivery_line.quantity - coalesce(sum(returned.quantity), 0)
        into v_available from public.sale_return_lines returned
        where returned.sale_delivery_line_id = v_delivery_line.id
          and returned.tenant_id = v_tenant;
        if v_available > 0 and v_remaining > 0 then
          v_quantity := least(v_available, v_remaining);
          insert into public.sale_return_lines (
            tenant_id, sale_return_id, sale_id, sale_line_id, sale_delivery_line_id,
            line_kind, quantity, unit_price, return_amount
          ) values (
            v_tenant, v_return_id, p_sale_id, v_line.id, v_delivery_line.id,
            'quantity', v_quantity, v_line.unit_price, round(v_quantity * v_line.unit_price, 2)
          );
          v_remaining := v_remaining - v_quantity;
        end if;
      end loop;
      if v_remaining <> 0 then raise exception using errcode = '23514', message = 'SALE_RETURN_DELIVERY_ALLOCATION_FAILED'; end if;
    end if;
  end loop;

  for v_delivery in
    select sale_delivery.id, sale_delivery.inventory_delivery_id
    from public.sale_return_lines returned
    join public.sale_delivery_lines delivery_line
      on delivery_line.id = returned.sale_delivery_line_id and delivery_line.tenant_id = returned.tenant_id
    join public.sale_deliveries sale_delivery
      on sale_delivery.id = delivery_line.sale_delivery_id and sale_delivery.tenant_id = delivery_line.tenant_id
    where returned.sale_return_id = v_return_id and returned.tenant_id = v_tenant
    group by sale_delivery.id, sale_delivery.inventory_delivery_id
  loop
    select jsonb_agg(jsonb_build_object(
      'delivery_line_id', delivery_line.inventory_delivery_line_id,
      'quantity', returned.quantity
    ) order by delivery_line.inventory_delivery_line_id)
    into v_inventory_lines
    from public.sale_return_lines returned
    join public.sale_delivery_lines delivery_line
      on delivery_line.id = returned.sale_delivery_line_id and delivery_line.tenant_id = returned.tenant_id
    where returned.sale_return_id = v_return_id and returned.tenant_id = v_tenant
      and delivery_line.sale_delivery_id = v_delivery.id;
    v_inventory_result := public.receive_inventory_return(
      v_delivery.inventory_delivery_id, p_destination_location_id,
      'sale_return', v_return_id::text || ':' || v_delivery.id::text, v_inventory_lines,
      'sales-return-inventory-' || v_return_id::text || '-' || v_delivery.id::text
    );
    insert into public.sale_return_inventory_links (
      tenant_id, sale_return_id, sale_id, sale_delivery_id, inventory_return_id
    ) values (
      v_tenant, v_return_id, p_sale_id, v_delivery.id,
      (v_inventory_result ->> 'return_id')::uuid
    );
  end loop;

  v_financial := public.post_financial_sale_return(
    v_tenant, v_return_id, 'sales-return-financial-' || v_return_id::text
  );
  update public.sale_returns set financial_sale_return_posting_id = (
    select posting.id from public.financial_sale_return_postings posting
    where posting.sale_return_id = v_return_id and posting.tenant_id = v_tenant
  ) where id = v_return_id and tenant_id = v_tenant;
  update public.sales set version = version + 1, updated_at = now()
  where id = p_sale_id and tenant_id = v_tenant returning version into v_new_version;
  insert into public.sale_events (
    tenant_id, sale_id, event_type, sale_version, actor_id, payload
  ) values (
    v_tenant, p_sale_id, 'sale_returned', v_new_version, v_actor,
    jsonb_build_object('return_number', v_return_number, 'amount', v_total,
      'line_count', (select count(*) from public.sale_return_lines where sale_return_id = v_return_id))
  );
  v_result := jsonb_build_object(
    'sale_id', p_sale_id, 'sale_number', v_sale.sale_number,
    'return_id', v_return_id, 'return_number', v_return_number,
    'return_status', (public.get_sale_return_eligibility(p_sale_id) ->> 'return_status'),
    'amount', v_total, 'ar_applied_amount', v_financial -> 'ar_applied_amount',
    'refundable_amount', v_financial -> 'refundable_amount',
    'version', v_new_version, 'idempotent_replay', false
  );
  update public.sales_command_requests set result = v_result, completed_at = now()
  where id = v_command_id;
  perform set_config('app.canonical_sales_return_command', '', true);
  return v_result;
end
$$;

create or replace function public.get_sale_refund_options(p_sale_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_sale public.sales%rowtype;
  v_credits jsonb;
  v_methods jsonb := '[]'::jsonb;
  v_method record;
  v_destinations jsonb;
  v_can_refund boolean;
begin
  if v_tenant is null or not public.has_permission('sales.access', v_tenant)
     or not public.has_permission('sales.view', v_tenant) then
    raise exception using errcode = '42501', message = 'SALES_REFUND_VIEW_DENIED';
  end if;
  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = v_tenant;
  if not found then raise exception using errcode = 'P0002', message = 'SALE_NOT_FOUND'; end if;
  if not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '42501', message = 'SALE_REFUND_SCOPE_DENIED';
  end if;
  v_can_refund := public.has_permission('settlement.refund', v_tenant)
    and public.has_permission('financial.refund.create', v_tenant)
    and public.has_permission('financial.refund.submit', v_tenant)
    and public.has_permission('financial.refund.confirm', v_tenant)
    and public.has_permission('financial.refund.post', v_tenant);
  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_return_id', sale_return.id, 'return_number', sale_return.return_number,
    'return_amount', posting.amount,
    'refunded_amount', posting.refundable_amount - credit.amount_residual,
    'refundable_amount', credit.amount_residual,
    'currency_code', posting.currency_code
  ) order by sale_return.created_at, sale_return.id) filter (where credit.amount_residual > 0), '[]'::jsonb)
  into v_credits
  from public.sale_returns sale_return
  join public.financial_sale_return_postings posting
    on posting.sale_return_id = sale_return.id and posting.tenant_id = sale_return.tenant_id
  join public.account_move_lines credit
    on credit.id = posting.customer_credit_line_id and credit.tenant_id = posting.tenant_id
  where sale_return.sale_id = p_sale_id and sale_return.tenant_id = v_tenant;
  if v_can_refund then
    for v_method in select method.id, method.name, method.semantic_key, method.method_type,
      method.requires_reference
      from public.financial_payment_methods method
      where method.tenant_id = v_tenant and method.is_active
        and method.settlement_mode = 'direct' and not method.requires_confirmation
        and public.is_financial_payment_method_usable(v_tenant, method.id)
      order by method.name, method.id
    loop
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', allowed.destination_id, 'name', allowed.destination_name,
        'type', allowed.destination_type
      ) order by allowed.destination_name, allowed.destination_id), '[]'::jsonb)
      into v_destinations
      from public.list_allowed_money_destinations(
        v_tenant, 'financial.refund.post', 'pay_out', v_sale.branch_id,
        array(select destination_type from public.financial_payment_method_destination_types
          where method_type = v_method.method_type)
      ) allowed;
      if jsonb_array_length(v_destinations) > 0 then
        v_methods := v_methods || jsonb_build_array(jsonb_build_object(
          'id', v_method.id, 'name', v_method.name,
          'semantic_key', v_method.semantic_key,
          'requires_reference', v_method.requires_reference,
          'destinations', v_destinations
        ));
      end if;
    end loop;
  end if;
  return jsonb_build_object(
    'sale_id', v_sale.id, 'can_refund', v_can_refund
      and jsonb_array_length(v_credits) > 0 and jsonb_array_length(v_methods) > 0,
    'permission_granted', v_can_refund,
    'credits', v_credits, 'methods', v_methods,
    'blocking_reason', case
      when not v_can_refund then 'SALES_REFUND_DENIED'
      when jsonb_array_length(v_credits) = 0 then 'SALE_HAS_NO_REFUNDABLE_CREDIT'
      when jsonb_array_length(v_methods) = 0 then 'SALE_REFUND_DESTINATION_UNAVAILABLE'
      else null end
  );
end
$$;

create or replace function public.refund_sale_return(
  p_sale_return_id uuid,
  p_amount numeric,
  p_payment_method_id uuid,
  p_money_destination_id uuid,
  p_reason text,
  p_reference text,
  p_notes text,
  p_idempotency_key text
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_actor uuid := public.current_tenant_user_id();
  v_return public.sale_returns%rowtype;
  v_sale public.sales%rowtype;
  v_posting public.financial_sale_return_postings%rowtype;
  v_credit public.account_move_lines%rowtype;
  v_existing public.sale_refund_commands%rowtype;
  v_command_id uuid := gen_random_uuid();
  v_amount numeric(18,2) := round(coalesce(p_amount, 0), 2);
  v_reason text := nullif(btrim(p_reason), '');
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_fingerprint text;
  v_created jsonb;
  v_refund_id uuid;
  v_posted jsonb;
  v_version bigint;
  v_result jsonb;
  v_claimed integer := 0;
begin
  if v_tenant is null or v_actor is null
     or not public.has_permission('settlement.refund', v_tenant) then
    raise exception using errcode = '42501', message = 'SALES_REFUND_DENIED';
  end if;
  if v_amount <= 0 or p_amount <> v_amount or v_reason is null
     or length(v_reason) > 1000 or v_key is null or length(v_key) > 160 then
    raise exception using errcode = '22023', message = 'SALES_REFUND_INPUT_INVALID';
  end if;
  select * into v_return from public.sale_returns item
  where item.id = p_sale_return_id and item.tenant_id = v_tenant for update;
  if not found then raise exception using errcode = 'P0002', message = 'SALE_RETURN_NOT_FOUND'; end if;
  select * into v_sale from public.sales sale
  where sale.id = v_return.sale_id and sale.tenant_id = v_tenant for update;
  if not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '42501', message = 'SALE_REFUND_SCOPE_DENIED';
  end if;
  select * into v_posting from public.financial_sale_return_postings posting
  where posting.sale_return_id = v_return.id and posting.tenant_id = v_tenant;
  v_fingerprint := public.sales_request_fingerprint(jsonb_build_object(
    'sale_return_id', p_sale_return_id, 'amount', v_amount,
    'payment_method_id', p_payment_method_id,
    'money_destination_id', p_money_destination_id,
    'reason', v_reason, 'reference', nullif(btrim(coalesce(p_reference, '')), ''),
    'notes', nullif(btrim(coalesce(p_notes, '')), '')
  ));
  insert into public.sale_refund_commands (
    id, tenant_id, sale_id, sale_return_id, amount, payment_method_id,
    money_destination_id, reference, notes, reason, idempotency_key,
    request_fingerprint, created_by
  ) values (
    v_command_id, v_tenant, v_sale.id, v_return.id, v_amount, p_payment_method_id,
    p_money_destination_id, nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), v_reason, v_key, v_fingerprint, v_actor
  ) on conflict (tenant_id, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    select * into v_existing from public.sale_refund_commands command
    where command.tenant_id = v_tenant and command.idempotency_key = v_key for update;
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'SALES_REFUND_IDEMPOTENCY_CONFLICT';
    end if;
    if v_existing.result is null then
      raise exception using errcode = '40001', message = 'SALES_REFUND_IN_PROGRESS';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  select * into v_credit from public.account_move_lines line
  where line.id = v_posting.customer_credit_line_id and line.tenant_id = v_tenant for update;
  if not found or v_amount > v_credit.amount_residual then
    raise exception using errcode = '23514', message = 'SALES_REFUND_EXCEEDS_REFUNDABLE';
  end if;
  v_created := public.create_financial_refund(
    v_tenant, v_credit.id, v_sale.customer_id, v_amount, v_sale.currency_code,
    p_money_destination_id, p_payment_method_id, v_reason,
    'sale-return-refund-' || v_key, v_sale.branch_id, null,
    'sale_return', concat_ws(' | ', nullif(btrim(coalesce(p_reference, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), '')),
    'sales_core', 'sale_return', v_return.id
  );
  v_refund_id := (v_created ->> 'refund_id')::uuid;
  perform public.submit_financial_refund(v_tenant, v_refund_id);
  perform public.confirm_financial_refund(v_tenant, v_refund_id);
  v_posted := public.post_financial_refund(
    v_tenant, v_refund_id, 'sale-return-refund-post-' || v_key
  );
  update public.sales set version = version + 1, updated_at = now()
  where id = v_sale.id and tenant_id = v_tenant returning version into v_version;
  insert into public.sale_events (
    tenant_id, sale_id, event_type, sale_version, actor_id, payload
  ) values (
    v_tenant, v_sale.id, 'customer_refund_created', v_version, v_actor,
    jsonb_build_object('return_number', v_return.return_number,
      'refund_number', v_created -> 'refund_number', 'amount', v_amount)
  );
  v_result := jsonb_build_object(
    'sale_id', v_sale.id, 'sale_return_id', v_return.id,
    'return_number', v_return.return_number,
    'refund_number', v_created -> 'refund_number', 'amount', v_amount,
    'remaining_refundable_amount', v_credit.amount_residual - v_amount,
    'version', v_version, 'status', 'posted', 'idempotent_replay', false
  );
  update public.sale_refund_commands set financial_refund_id = v_refund_id,
    result = v_result, completed_at = now() where id = v_command_id;
  return v_result;
end
$$;

alter table public.sale_returns enable row level security;
alter table public.sale_return_lines enable row level security;
alter table public.sale_return_inventory_links enable row level security;
alter table public.financial_sale_return_postings enable row level security;
alter table public.sale_refund_commands enable row level security;

revoke all on public.sale_returns, public.sale_return_lines,
  public.sale_return_inventory_links, public.financial_sale_return_postings,
  public.sale_refund_commands from public, anon, authenticated;
grant select on public.sale_returns, public.sale_return_lines,
  public.sale_return_inventory_links, public.financial_sale_return_postings,
  public.sale_refund_commands to authenticated;

create policy sale_returns_read on public.sale_returns for select to authenticated using (
  tenant_id = public.current_tenant_id() and public.has_permission('sales.view', tenant_id)
  and exists (select 1 from public.sales sale where sale.id = sale_id
    and sale.tenant_id = tenant_id and public.has_branch_access(sale.branch_id))
);
create policy sale_return_lines_read on public.sale_return_lines for select to authenticated using (
  exists (select 1 from public.sale_returns parent
    where parent.id = sale_return_id and parent.tenant_id = tenant_id)
);
create policy sale_return_inventory_links_read on public.sale_return_inventory_links for select to authenticated using (
  exists (select 1 from public.sale_returns parent
    where parent.id = sale_return_id and parent.tenant_id = tenant_id)
);
create policy financial_sale_return_postings_read on public.financial_sale_return_postings for select to authenticated using (
  tenant_id = public.current_tenant_id()
  and (public.has_permission('sales.view', tenant_id)
    or public.has_permission('financial.audit.view', tenant_id))
);
create policy sale_refund_commands_read on public.sale_refund_commands for select to authenticated using (
  tenant_id = public.current_tenant_id()
  and (public.has_permission('sales.view', tenant_id)
    or public.has_permission('settlement.refund', tenant_id))
  and public.has_branch_access((select sale.branch_id from public.sales sale
    where sale.id = sale_id and sale.tenant_id = tenant_id))
);

revoke all on function public.is_trusted_sales_return_context(uuid,uuid,uuid),
  public.post_financial_sale_return(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_sale_return_eligibility(uuid),
  public.return_sale(uuid,bigint,jsonb,uuid,text,text),
  public.get_sale_refund_options(uuid),
  public.refund_sale_return(uuid,numeric,uuid,uuid,text,text,text,text)
  from public, anon, service_role;
grant execute on function public.get_sale_return_eligibility(uuid),
  public.return_sale(uuid,bigint,jsonb,uuid,text,text),
  public.get_sale_refund_options(uuid),
  public.refund_sale_return(uuid,numeric,uuid,uuid,text,text,text,text)
  to authenticated;

comment on table public.sale_returns is
  'Immutable Canonical Sales commercial return facts; separate from cancellation and cash refund.';
comment on function public.post_financial_sale_return(uuid,uuid,text) is
  'Financial Core adapter: derives Sale AR/revenue/journal, posts only the returned value, applies AR first and leaves excess customer credit.';
comment on function public.return_sale(uuid,bigint,jsonb,uuid,text,text) is
  'Atomic Canonical Sales return: locks delivered facts, calls Inventory return, posts Financial credit, records audit and never cancels the original Sale.';
comment on function public.refund_sale_return(uuid,numeric,uuid,uuid,text,text,text,text) is
  'Separate Money-Out command consuming only a remaining Sale Return customer-credit residual through canonical Financial Refund lifecycle.';

notify pgrst, 'reload schema';

commit;
