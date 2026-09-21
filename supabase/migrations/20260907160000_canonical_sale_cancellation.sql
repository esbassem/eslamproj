begin;

insert into public.auth_permissions (code, name, description, resource, action, active)
values
  ('sales.cancel', 'إلغاء المبيعات', 'إلغاء بيع Canonical مؤكد قبل التسليم أو التحصيل.', 'sales', 'cancel', true),
  ('financial.sale.reverse', 'عكس أثر بيع مالي', 'عكس ترحيل بيع Canonical غير مسدد مع الاحتفاظ بالقيد الأصلي.', 'financial_sale', 'reverse', true)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  resource = excluded.resource,
  action = excluded.action,
  active = true,
  updated_at = now();

-- Extend the existing immutable reversal audit with the generic Sale Posting domain.
alter table public.financial_accounting_reversals
  drop constraint financial_accounting_reversals_domain_type_check,
  add constraint financial_accounting_reversals_domain_type_check
    check (domain_type in (
      'payment', 'internal_transfer', 'advance_application',
      'refund', 'settlement', 'sale_posting'
    ));

alter table public.financial_accounting_reversal_move_links
  drop constraint financial_accounting_reversal_move_links_stage_check,
  add constraint financial_accounting_reversal_move_links_stage_check check (stage in (
    'payment_posting', 'transfer_immediate', 'transfer_send', 'transfer_receive',
    'advance_reclassification', 'refund_posting', 'settlement_posting',
    'sale_posting'
  ));

alter table public.financial_accounting_reversal_reconcile_links
  drop constraint financial_accounting_reversal_reconcile_links_role_check,
  add constraint financial_accounting_reversal_reconcile_links_role_check check (role in (
    'payment_open_item', 'advance_source', 'advance_target',
    'reclassification_cleanup_advance', 'reclassification_cleanup_target',
    'refund_source', 'refund_cleanup', 'settlement_source', 'settlement_cleanup',
    'sale_receivable'
  ));

alter table public.financial_accounting_reversal_events
  drop constraint financial_accounting_reversal_events_event_type_check,
  add constraint financial_accounting_reversal_events_event_type_check check (event_type in (
    'payment_accounting_reversed', 'transfer_accounting_reversed',
    'advance_unapplied', 'refund_accounting_reversed',
    'settlement_accounting_reversed', 'sale_posting_reversed'
  ));

alter table public.sales_command_requests
  add column cancellation_sale_id uuid,
  add column cancellation_expected_version bigint,
  add constraint sales_command_cancellation_sale_fkey
    foreign key (cancellation_sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict;

alter table public.sales_command_requests
  drop constraint sales_command_context_check,
  add constraint sales_command_context_check check (
    (command_type = 'confirm'
      and confirmation_sale_id is not null
      and confirmation_expected_version is not null
      and confirmation_expected_version > 0
      and delivery_sale_id is null
      and delivery_expected_version is null
      and cancellation_sale_id is null
      and cancellation_expected_version is null)
    or
    (command_type = 'deliver'
      and confirmation_sale_id is null
      and confirmation_expected_version is null
      and delivery_sale_id is not null
      and delivery_expected_version is not null
      and delivery_expected_version > 0
      and cancellation_sale_id is null
      and cancellation_expected_version is null)
    or
    (command_type = 'cancel'
      and confirmation_sale_id is null
      and confirmation_expected_version is null
      and delivery_sale_id is null
      and delivery_expected_version is null
      and cancellation_sale_id is not null
      and cancellation_expected_version is not null
      and cancellation_expected_version > 0)
    or
    (command_type not in ('confirm', 'deliver', 'cancel')
      and confirmation_sale_id is null
      and confirmation_expected_version is null
      and delivery_sale_id is null
      and delivery_expected_version is null
      and cancellation_sale_id is null
      and cancellation_expected_version is null)
  ),
  drop constraint sales_command_requests_type_check,
  add constraint sales_command_requests_type_check
    check (command_type in ('create', 'update_draft', 'confirm', 'deliver', 'cancel'));

create or replace function public.is_trusted_sales_cancellation_context(
  p_tenant_id uuid,
  p_sale_id uuid default null,
  p_financial_sale_posting_id uuid default null,
  p_inventory_reservation_id uuid default null
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
      on sale.id = command_request.cancellation_sale_id
     and sale.tenant_id = command_request.tenant_id
    join public.sale_confirmation_links confirmation
      on confirmation.sale_id = sale.id
     and confirmation.tenant_id = sale.tenant_id
    where command_request.id::text =
      current_setting('app.canonical_sales_cancellation_command', true)
      and command_request.tenant_id = p_tenant_id
      and command_request.command_type = 'cancel'
      and command_request.created_by = public.current_tenant_user_id()
      and command_request.result is null
      and command_request.completed_at is null
      and command_request.cancellation_expected_version = sale.version
      and sale.status = 'confirmed'
      and (p_sale_id is null or sale.id = p_sale_id)
      and (p_financial_sale_posting_id is null
        or confirmation.financial_sale_posting_id = p_financial_sale_posting_id)
      and (p_inventory_reservation_id is null
        or confirmation.inventory_reservation_id = p_inventory_reservation_id)
  )
$$;

-- Reuse Inventory Core's release command. Only its authorization boundary is
-- extended for a matching unresolved cancellation command; all state, scope,
-- quantity and tracking-unit invariants remain owned by Inventory Core.
do $$
declare v_definition text; v_rewritten text;
begin
  select pg_get_functiondef(
    'public.release_inventory_reservation(uuid,text)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'  if v_tenant_id is null or v_actor_id is null\n     or not public.has_permission(''inventory.release'', v_tenant_id) then',
    E'  if v_tenant_id is null or v_actor_id is null\n     or (not public.has_permission(''inventory.release'', v_tenant_id)\n       and not public.is_trusted_sales_cancellation_context(\n         v_tenant_id, null, null, p_reservation_id\n       )) then'
  );
  if v_rewritten = v_definition then
    raise exception 'SALES_CANCELLATION_INVENTORY_RELEASE_AUTHORIZATION_HOOK_NOT_APPLIED';
  end if;
  v_definition := v_rewritten;
  v_rewritten := replace(
    v_definition,
    E'  if not public.has_branch_access(v_reservation.branch_id)\n     or not public.has_stock_location_access(v_reservation.location_id) then',
    E'  if not public.has_branch_access(v_reservation.branch_id)\n     or (not public.has_stock_location_access(v_reservation.location_id)\n       and not public.is_trusted_sales_cancellation_context(\n         v_tenant_id, null, null, p_reservation_id\n       )) then'
  );
  if v_rewritten = v_definition then
    raise exception 'SALES_CANCELLATION_INVENTORY_RELEASE_SCOPE_HOOK_NOT_APPLIED';
  end if;
  execute v_rewritten;
end
$$;

create or replace function public.reverse_financial_sale(
  p_tenant_id uuid,
  p_financial_sale_posting_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_reversal_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_posting public.financial_sale_postings%rowtype;
  v_existing public.financial_accounting_reversals%rowtype;
  v_actor_id uuid := public.current_tenant_user_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_fingerprint text;
  v_reversal_id uuid := gen_random_uuid();
  v_reversal_number text;
  v_reversal_move_id uuid;
  v_reversal_receivable_line_id uuid;
  v_residual numeric(18,2);
  v_result jsonb;
begin
  if p_tenant_id is null or p_financial_sale_posting_id is null or v_actor_id is null
     or public.current_tenant_id() is distinct from p_tenant_id then
    raise exception using errcode = '42501', message = 'FINANCIAL_SALE_REVERSAL_DENIED';
  end if;
  if v_reason is null or length(v_reason) > 1000 then
    raise exception using errcode = '22023', message = 'FINANCIAL_SALE_REVERSAL_REASON_INVALID';
  end if;
  if v_key is null or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'FINANCIAL_SALE_REVERSAL_IDEMPOTENCY_INVALID';
  end if;
  if p_reversal_date is null then
    raise exception using errcode = '22023', message = 'FINANCIAL_SALE_REVERSAL_DATE_REQUIRED';
  end if;

  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'domain', 'sale_posting',
    'posting_id', p_financial_sale_posting_id,
    'reason', v_reason,
    'reversal_date', p_reversal_date
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'financial_sale_reversal:' || p_tenant_id::text || ':' || p_financial_sale_posting_id::text,
    0
  ));

  select * into v_existing
  from public.financial_accounting_reversals reversal
  where reversal.tenant_id = p_tenant_id and reversal.idempotency_key = v_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505',
        message = 'FINANCIAL_SALE_REVERSAL_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'reversal_number', v_existing.reversal_number,
      'status', 'reversed',
      'idempotent_replay', true
    );
  end if;

  select * into v_posting
  from public.financial_sale_postings posting
  where posting.id = p_financial_sale_posting_id
    and posting.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'FINANCIAL_SALE_POSTING_NOT_FOUND';
  end if;

  if not public.is_trusted_sales_cancellation_context(
    p_tenant_id, null, v_posting.id, null
  ) then
    perform public.assert_financial_authorized(
      p_tenant_id, 'financial.sale.reverse', null, null, v_posting.branch_id, true
    );
  end if;
  if v_posting.state <> 'posted' then
    raise exception using errcode = '23514', message = 'FINANCIAL_SALE_POSTING_NOT_REVERSIBLE';
  end if;
  if exists (
    select 1 from public.financial_accounting_reversals reversal
    where reversal.tenant_id = p_tenant_id
      and reversal.domain_type = 'sale_posting'
      and reversal.domain_id = v_posting.id
  ) then
    raise exception using errcode = '23514', message = 'FINANCIAL_SALE_POSTING_ALREADY_REVERSED';
  end if;
  select receivable.amount_residual into v_residual
  from public.account_move_lines receivable
  where receivable.id = v_posting.receivable_line_id
    and receivable.tenant_id = p_tenant_id
    and receivable.move_id = v_posting.account_move_id
    and receivable.parent_state = 'posted'
    and receivable.line_type = 'open_item'
    and receivable.debit = v_posting.amount
    and receivable.credit = 0
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'FINANCIAL_SALE_RECEIVABLE_INVALID';
  end if;
  if v_residual <> v_posting.amount then
    raise exception using errcode = '23514', message = 'FINANCIAL_SALE_HAS_SETTLEMENT';
  end if;

  perform public.assert_financial_posting_date(p_tenant_id, p_reversal_date);
  v_reversal_number := public.next_financial_accounting_reversal_number(p_tenant_id);
  perform set_config('app.financial_accounting_reversal_contract', v_reversal_id::text, true);
  insert into public.financial_accounting_reversals (
    id, tenant_id, reversal_number, domain_type, domain_id, reason,
    reversal_date, idempotency_key, request_fingerprint,
    requested_by, completed_by, metadata
  ) values (
    v_reversal_id, p_tenant_id, v_reversal_number, 'sale_posting', v_posting.id,
    v_reason, p_reversal_date, v_key, v_fingerprint,
    v_actor_id, v_actor_id,
    jsonb_build_object(
      'source_app', v_posting.source_app,
      'source_model', v_posting.source_model,
      'source_id', v_posting.source_id,
      'commercial_reference', v_posting.commercial_reference
    )
  );

  v_reversal_move_id := public.create_reversing_account_move(
    v_reversal_id, p_tenant_id, v_posting.account_move_id,
    'sale_posting', p_reversal_date, v_actor_id
  );
  select line_link.reversal_line_id into v_reversal_receivable_line_id
  from public.financial_accounting_reversal_line_links line_link
  where line_link.reversal_id = v_reversal_id
    and line_link.original_line_id = v_posting.receivable_line_id;
  if v_reversal_receivable_line_id is null then
    raise exception using errcode = '23514', message = 'FINANCIAL_SALE_REVERSAL_RECEIVABLE_MISSING';
  end if;
  perform public.reversal_create_partial(
    v_reversal_id, p_tenant_id,
    v_posting.receivable_line_id, v_reversal_receivable_line_id,
    v_posting.amount, v_actor_id, 'sale_receivable'
  );
  insert into public.financial_accounting_reversal_events (
    tenant_id, reversal_id, event_type, actor_user_id, reason, metadata
  ) values (
    p_tenant_id, v_reversal_id, 'sale_posting_reversed',
    v_actor_id, v_reason,
    jsonb_build_object(
      'reversal_number', v_reversal_number,
      'commercial_reference', v_posting.commercial_reference,
      'amount', v_posting.amount,
      'currency_code', v_posting.currency_code
    )
  );
  perform set_config('app.financial_accounting_reversal_contract', '', true);

  v_result := jsonb_build_object(
    'reversal_number', v_reversal_number,
    'status', 'reversed',
    'amount', v_posting.amount,
    'currency_code', v_posting.currency_code,
    'idempotent_replay', false
  );
  return v_result;
end
$$;

-- The original guard accidentally rejected every mutation of a confirmed Sale
-- before reaching its declared confirmed -> cancelled transition. Preserve all
-- immutable commercial facts while allowing only that command-owned transition.
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
  if old.status = 'cancelled' and new is distinct from old then
    raise exception using errcode = '23514', message = 'CANONICAL_SALE_COMMERCIAL_STATE_IMMUTABLE';
  end if;
  if old.status = 'confirmed' and new is distinct from old then
    if current_setting('app.canonical_sales_transition', true) is distinct from old.id::text
       or new.status <> 'cancelled'
       or (new.id, new.tenant_id, new.branch_id, new.customer_id, new.sale_number,
           new.effective_sale_date, new.currency_code, new.total_amount, new.notes,
           new.created_by, new.confirmed_by, new.confirmed_at, new.created_at)
          is distinct from
          (old.id, old.tenant_id, old.branch_id, old.customer_id, old.sale_number,
           old.effective_sale_date, old.currency_code, old.total_amount, old.notes,
           old.created_by, old.confirmed_by, old.confirmed_at, old.created_at)
       or new.cancelled_by is null or new.cancelled_at is null
       or new.version <> old.version + 1 then
      raise exception using errcode = '23514', message = 'CANONICAL_SALE_COMMERCIAL_STATE_IMMUTABLE';
    end if;
    return new;
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

create or replace function public.get_sale_cancellation_eligibility(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_sale public.sales%rowtype;
  v_confirmation public.sale_confirmation_links%rowtype;
  v_posting public.financial_sale_postings%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_receivable_residual numeric(18,2);
  v_has_delivery boolean := false;
  v_has_settlement boolean := false;
  v_financial_available boolean := false;
  v_inventory_available boolean := false;
  v_blocker text;
  v_cancel_event public.sale_events%rowtype;
  v_canceller_name text;
begin
  if v_tenant_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not (
       public.has_permission('sales.view', v_tenant_id)
       or public.has_permission('sales.cancel', v_tenant_id)
     ) then
    raise exception using errcode = '42501', message = 'SALES_CANCELLATION_VIEW_DENIED';
  end if;
  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = v_tenant_id;
  if not found or not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = 'P0002', message = 'SALE_NOT_FOUND';
  end if;

  select * into v_confirmation
  from public.sale_confirmation_links confirmation
  where confirmation.sale_id = v_sale.id and confirmation.tenant_id = v_tenant_id;
  if found then
    select * into v_posting from public.financial_sale_postings posting
    where posting.id = v_confirmation.financial_sale_posting_id
      and posting.tenant_id = v_tenant_id;
    if v_posting.id is not null then
      select receivable.amount_residual into v_receivable_residual
      from public.account_move_lines receivable
      where receivable.id = v_posting.receivable_line_id
        and receivable.tenant_id = v_tenant_id
        and receivable.parent_state = 'posted'
        and receivable.line_type = 'open_item';
      v_financial_available := v_posting.state = 'posted'
        and v_receivable_residual = v_posting.amount
        and exists (
          select 1 from public.account_moves move
          where move.id = v_posting.account_move_id
            and move.tenant_id = v_tenant_id and move.state = 'posted'
            and move.reversed_entry_id is null
        )
        and not exists (
          select 1 from public.financial_accounting_reversals reversal
          where reversal.tenant_id = v_tenant_id
            and reversal.domain_type = 'sale_posting'
            and reversal.domain_id = v_posting.id
        );
    end if;
    if v_confirmation.inventory_reservation_id is null then
      v_inventory_available := true;
    else
      select * into v_reservation from public.inventory_reservations reservation
      where reservation.id = v_confirmation.inventory_reservation_id
        and reservation.tenant_id = v_tenant_id;
      v_inventory_available := v_reservation.state = 'active';
    end if;
  end if;

  v_has_delivery := exists (
    select 1 from public.sale_delivery_lines delivery_line
    where delivery_line.sale_id = v_sale.id
      and delivery_line.tenant_id = v_tenant_id
      and delivery_line.quantity > 0
  ) or exists (
    select 1 from public.inventory_reservation_lines reservation_line
    where reservation_line.reservation_id = v_confirmation.inventory_reservation_id
      and reservation_line.tenant_id = v_tenant_id
      and reservation_line.delivered_quantity > 0
  );
  v_has_settlement := coalesce(v_posting.amount - v_receivable_residual, 0) > 0
    or exists (
      select 1 from public.obligation_settlements settlement
      where settlement.tenant_id = v_tenant_id
        and settlement.target_type = 'sale'
        and settlement.target_id = v_sale.id::text
    );

  if v_sale.status = 'cancelled' then
    v_blocker := 'SALE_ALREADY_CANCELLED';
  elsif v_sale.status <> 'confirmed' then
    v_blocker := 'SALE_NOT_CONFIRMED';
  elsif v_has_delivery then
    v_blocker := 'SALE_HAS_DELIVERY';
  elsif v_has_settlement then
    v_blocker := 'SALE_HAS_SETTLEMENT';
  elsif v_confirmation.id is null or v_posting.id is null then
    v_blocker := 'SALE_CANONICAL_CONFIRMATION_INVALID';
  elsif not v_financial_available then
    v_blocker := 'SALE_FINANCIAL_REVERSAL_UNAVAILABLE';
  elsif not v_inventory_available then
    v_blocker := 'SALE_INVENTORY_RELEASE_UNAVAILABLE';
  end if;

  select * into v_cancel_event from public.sale_events event
  where event.sale_id = v_sale.id and event.tenant_id = v_tenant_id
    and event.event_type = 'sale_cancelled'
  order by event.sale_version desc limit 1;
  if v_sale.cancelled_by is not null then
    select actor.full_name into v_canceller_name from public.tenant_users actor
    where actor.id = v_sale.cancelled_by and actor.tenant_id = v_tenant_id;
  end if;

  return jsonb_build_object(
    'sale_id', v_sale.id,
    'can_cancel', v_blocker is null,
    'has_delivery', v_has_delivery,
    'has_settlement', v_has_settlement,
    'financial_reversal_available', v_financial_available,
    'inventory_release_available', v_inventory_available,
    'reason_if_blocked', v_blocker,
    'cancellation', case when v_sale.status = 'cancelled' then jsonb_build_object(
      'reason', v_cancel_event.payload ->> 'reason',
      'cancelled_at', v_sale.cancelled_at,
      'cancelled_by', jsonb_build_object('name', v_canceller_name),
      'financial_reversal_reference', v_cancel_event.payload ->> 'financial_reversal_reference',
      'inventory_release_state', v_cancel_event.payload ->> 'inventory_release_state'
    ) else null end
  );
end
$$;

create or replace function public.cancel_sale(
  p_sale_id uuid,
  p_expected_version bigint,
  p_reason text,
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
  v_confirmation public.sale_confirmation_links%rowtype;
  v_posting public.financial_sale_postings%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_fingerprint text;
  v_command public.sales_command_requests%rowtype;
  v_command_id uuid := gen_random_uuid();
  v_claimed integer := 0;
  v_eligibility jsonb;
  v_financial_result jsonb;
  v_inventory_result jsonb;
  v_new_version bigint;
  v_result jsonb;
begin
  if v_tenant_id is null or v_actor_id is null
     or not public.has_permission('sales.access', v_tenant_id)
     or not public.has_permission('sales.cancel', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SALES_CANCEL_DENIED';
  end if;
  if p_sale_id is null or p_expected_version is null or p_expected_version <= 0 then
    raise exception using errcode = '22023', message = 'SALES_CANCELLATION_INPUT_INVALID';
  end if;
  if v_reason is null or length(v_reason) > 1000 then
    raise exception using errcode = '22023', message = 'SALES_CANCELLATION_REASON_INVALID';
  end if;
  if v_key is null or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'SALES_CANCELLATION_IDEMPOTENCY_INVALID';
  end if;

  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = v_tenant_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SALE_NOT_FOUND';
  end if;
  if not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = '42501', message = 'SALE_SCOPE_DENIED';
  end if;

  v_fingerprint := public.sales_request_fingerprint(jsonb_build_object(
    'sale_id', p_sale_id,
    'expected_version', p_expected_version,
    'reason', v_reason
  ));
  insert into public.sales_command_requests (
    id, tenant_id, command_type, idempotency_key, request_fingerprint,
    created_by, cancellation_sale_id, cancellation_expected_version
  ) values (
    v_command_id, v_tenant_id, 'cancel', v_key, v_fingerprint,
    v_actor_id, p_sale_id, p_expected_version
  ) on conflict (tenant_id, command_type, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    select * into v_command from public.sales_command_requests command_request
    where command_request.tenant_id = v_tenant_id
      and command_request.command_type = 'cancel'
      and command_request.idempotency_key = v_key
    for update;
    if v_command.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'SALES_CANCELLATION_IDEMPOTENCY_CONFLICT';
    end if;
    if v_command.result is null then
      raise exception using errcode = '40001', message = 'SALES_IDEMPOTENCY_IN_PROGRESS';
    end if;
    return v_command.result || jsonb_build_object('idempotent_replay', true);
  end if;

  if v_sale.status = 'cancelled' then
    raise exception using errcode = '23514', message = 'SALE_ALREADY_CANCELLED';
  end if;
  if v_sale.status <> 'confirmed' then
    raise exception using errcode = '23514', message = 'SALE_NOT_CONFIRMED';
  end if;
  if v_sale.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'SALES_VERSION_CONFLICT';
  end if;

  v_eligibility := public.get_sale_cancellation_eligibility(v_sale.id);
  if not coalesce((v_eligibility ->> 'can_cancel')::boolean, false) then
    case v_eligibility ->> 'reason_if_blocked'
      when 'SALE_HAS_DELIVERY' then
        raise exception using errcode = '23514', message = 'SALE_CANCELLATION_HAS_DELIVERY';
      when 'SALE_HAS_SETTLEMENT' then
        raise exception using errcode = '23514', message = 'SALE_CANCELLATION_HAS_SETTLEMENT';
      when 'SALE_FINANCIAL_REVERSAL_UNAVAILABLE' then
        raise exception using errcode = '23514', message = 'SALE_FINANCIAL_REVERSAL_UNAVAILABLE';
      when 'SALE_INVENTORY_RELEASE_UNAVAILABLE' then
        raise exception using errcode = '23514', message = 'SALE_INVENTORY_RELEASE_UNAVAILABLE';
      else
        raise exception using errcode = '23514', message = coalesce(
          v_eligibility ->> 'reason_if_blocked', 'SALE_CANCELLATION_NOT_ELIGIBLE'
        );
    end case;
  end if;

  select * into strict v_confirmation
  from public.sale_confirmation_links confirmation
  where confirmation.sale_id = v_sale.id and confirmation.tenant_id = v_tenant_id;
  select * into strict v_posting
  from public.financial_sale_postings posting
  where posting.id = v_confirmation.financial_sale_posting_id
    and posting.tenant_id = v_tenant_id;

  perform set_config('app.canonical_sales_cancellation_command', v_command_id::text, true);
  v_financial_result := public.reverse_financial_sale(
    v_tenant_id,
    v_posting.id,
    v_reason,
    'sale-cancel-reverse-' || encode(extensions.digest(
      v_tenant_id::text || ':' || v_key, 'sha256'
    ), 'hex'),
    current_date
  );

  if v_confirmation.inventory_reservation_id is not null then
    v_inventory_result := public.release_inventory_reservation(
      v_confirmation.inventory_reservation_id,
      'sale-cancel-release-' || encode(extensions.digest(
        v_tenant_id::text || ':' || v_key, 'sha256'
      ), 'hex')
    );
  else
    v_inventory_result := jsonb_build_object('state', 'not_required');
  end if;

  v_new_version := v_sale.version + 1;
  perform set_config('app.canonical_sales_transition', v_sale.id::text, true);
  update public.sales set
    status = 'cancelled',
    cancelled_by = v_actor_id,
    cancelled_at = now(),
    version = v_new_version,
    updated_at = now()
  where id = v_sale.id and tenant_id = v_tenant_id
    and status = 'confirmed' and version = p_expected_version;
  if not found then
    raise exception using errcode = '40001', message = 'SALES_VERSION_CONFLICT';
  end if;
  perform set_config('app.canonical_sales_transition', '', true);

  insert into public.sale_events (
    tenant_id, sale_id, event_type, sale_version, actor_id, payload
  ) values (
    v_tenant_id, v_sale.id, 'sale_cancelled', v_new_version, v_actor_id,
    jsonb_build_object(
      'reason', v_reason,
      'previous_status', 'confirmed',
      'financial_reversal_reference', v_financial_result ->> 'reversal_number',
      'inventory_release_state', v_inventory_result ->> 'state'
    )
  );

  v_result := jsonb_build_object(
    'sale_id', v_sale.id,
    'sale_number', v_sale.sale_number,
    'status', 'cancelled',
    'version', v_new_version,
    'cancelled_at', (select cancelled_at from public.sales where id = v_sale.id),
    'financial_reversal_reference', v_financial_result ->> 'reversal_number',
    'inventory_release_state', v_inventory_result ->> 'state',
    'idempotent_replay', false
  );
  update public.sales_command_requests set result = v_result, completed_at = now()
  where id = v_command_id and tenant_id = v_tenant_id;
  perform set_config('app.canonical_sales_cancellation_command', '', true);
  return v_result;
end
$$;

revoke all on function public.is_trusted_sales_cancellation_context(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reverse_financial_sale(uuid,uuid,text,text,date)
  from public, anon, service_role;
grant execute on function public.reverse_financial_sale(uuid,uuid,text,text,date)
  to authenticated;
revoke all on function public.get_sale_cancellation_eligibility(uuid)
  from public, anon, service_role;
grant execute on function public.get_sale_cancellation_eligibility(uuid)
  to authenticated;
revoke all on function public.cancel_sale(uuid,bigint,text,text)
  from public, anon, service_role;
grant execute on function public.cancel_sale(uuid,bigint,text,text)
  to authenticated;

comment on function public.reverse_financial_sale(uuid,uuid,text,text,date) is
  'Generic Financial Core reversal of an unpaid Canonical Sale Posting. It preserves the original move, creates a full inverse and reconciles the receivable to zero.';
comment on function public.get_sale_cancellation_eligibility(uuid) is
  'Business-safe Canonical Sale cancellation readiness including delivery, settlement, financial and inventory blockers.';
comment on function public.cancel_sale(uuid,bigint,text,text) is
  'Atomic confirmed Sale cancellation: reverse financial posting, release undelivered reservation, transition status and append immutable business event.';

notify pgrst, 'reload schema';

commit;
