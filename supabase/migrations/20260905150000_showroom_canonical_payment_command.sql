begin;

-- The generic Financial Core commands remain permissioned for accounting users.
-- This transaction-local capability lets one narrow Showroom business command
-- reuse those commands without granting the caller general accounting rights.
create or replace function public.is_trusted_showroom_payment_context(
  p_tenant_id uuid,
  p_permission_code text,
  p_account_id uuid default null,
  p_access_type text default null,
  p_branch_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  raw_context text := current_setting('app.showroom_canonical_payment_context', true);
  capability text := current_setting('app.showroom_canonical_payment', true);
  context_data jsonb;
  context_tenant_id uuid;
  context_sale_id uuid;
  context_method_id uuid;
  context_destination_id uuid;
  context_branch_id uuid;
  context_actor_auth_id uuid;
  receivable_account_id uuid;
  effective_branch_id uuid;
begin
  if raw_context is null or raw_context = '' or capability is null or capability = '' then
    return false;
  end if;
  begin
    context_data := raw_context::jsonb;
    context_tenant_id := (context_data ->> 'tenant_id')::uuid;
    context_sale_id := (context_data ->> 'sale_id')::uuid;
    context_method_id := (context_data ->> 'payment_method_id')::uuid;
    context_destination_id := nullif(context_data ->> 'money_destination_id', '')::uuid;
    context_branch_id := nullif(context_data ->> 'branch_id', '')::uuid;
    context_actor_auth_id := (context_data ->> 'actor_auth_id')::uuid;
  exception when others then
    return false;
  end;

  if capability <> encode(extensions.digest(context_data::text, 'sha256'), 'hex')
     or context_tenant_id is distinct from p_tenant_id
     or context_actor_auth_id is distinct from auth.uid()
     or public.current_tenant_id() is distinct from p_tenant_id
     or p_permission_code not in (
       'financial.payment.create', 'financial.payment.submit',
       'financial.payment.confirm', 'financial.payment.post',
       'financial.payment.allocate'
     )
     or not public.has_permission('showroom_point.access', p_tenant_id)
  then
    return false;
  end if;

  select coalesce(sale.branch_id, config.branch_id), line.account_id
  into effective_branch_id, receivable_account_id
  from public.showroom_sales sale
  join public.showroom_configs config
    on config.id = sale.showroom_config_id
   and config.tenant_id = sale.tenant_id
   and config.is_active
  join public.financial_engine_bindings binding
    on binding.tenant_id = sale.tenant_id
   and binding.source_app = 'showroom'
   and binding.source_model = 'sale'
   and binding.source_id = sale.id::text
   and binding.financial_event_version = 1
   and binding.financial_engine = 'canonical'
   and binding.state = 'posted'
  join public.financial_sale_postings posting
    on posting.id = binding.canonical_sale_posting_id
   and posting.tenant_id = binding.tenant_id
   and posting.state = 'posted'
   and posting.source_app = binding.source_app
   and posting.source_model = binding.source_model
   and posting.source_id = binding.source_id
   and posting.event_version = binding.financial_event_version
  join public.account_move_lines line
    on line.id = posting.receivable_line_id
   and line.tenant_id = posting.tenant_id
   and line.parent_state = 'posted'
   and line.line_type = 'open_item'
   and line.debit > 0 and line.credit = 0
   and line.partner_id = posting.partner_id
  where sale.id = context_sale_id
    and sale.tenant_id = context_tenant_id
    and sale.status = 'confirmed'
    and sale.financial_confirmation_generation > 1
    and sale.customer_id = posting.partner_id
    and sale.account_move_id = posting.account_move_id
    and posting.branch_id is not distinct from coalesce(sale.branch_id, config.branch_id)
    and exists (
      select 1 from public.showroom_financial_cutovers marker
      where marker.tenant_id = sale.tenant_id
        and marker.source_app = 'showroom'
        and marker.source_model = 'sale'
        and marker.canonical_generation = sale.financial_confirmation_generation
    );
  if not found
     or context_branch_id is distinct from effective_branch_id
     or (effective_branch_id is not null and not public.has_branch_access(effective_branch_id))
  then
    return false;
  end if;

  if p_account_id is null and p_access_type is null then
    return p_branch_id is null or p_branch_id is not distinct from effective_branch_id;
  end if;

  if p_permission_code = 'financial.payment.allocate' then
    return p_account_id = receivable_account_id
      and p_access_type = 'reconcile'
      and (p_branch_id is null or p_branch_id is not distinct from effective_branch_id);
  end if;

  if exists (
    select 1
    from public.financial_payment_methods method
    join public.financial_payment_method_destination_types compatibility
      on compatibility.method_type = method.method_type
    join public.money_destinations destination
      on destination.id = context_destination_id
     and destination.tenant_id = method.tenant_id
     and destination.destination_type = compatibility.destination_type
     and destination.status = 'active'
     and destination.ledger_account_id = p_account_id
    where method.id = context_method_id
      and method.tenant_id = context_tenant_id
      and method.is_active
      and method.settlement_mode = 'direct'
      and (effective_branch_id is null or destination.branch_id is null
        or destination.branch_id = effective_branch_id)
      and (destination.branch_id is null or public.has_branch_access(destination.branch_id))
      and (
        (p_permission_code in ('financial.payment.create', 'financial.payment.submit')
          and p_access_type = 'initiate')
        or (p_permission_code in ('financial.payment.confirm', 'financial.payment.post')
          and p_access_type = 'confirm')
      )
      and (p_branch_id is null or p_branch_id = effective_branch_id
        or (effective_branch_id is null and p_branch_id = destination.branch_id))
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.financial_payment_methods method
    join public.financial_payment_method_settlement_configs configuration
      on configuration.payment_method_id = method.id
     and configuration.tenant_id = method.tenant_id
     and configuration.is_active
     and configuration.clearing_account_id = p_account_id
    where method.id = context_method_id
      and method.tenant_id = context_tenant_id
      and method.is_active
      and method.settlement_mode = 'clearing'
      and context_destination_id is null
      and p_permission_code in ('financial.payment.confirm', 'financial.payment.post')
      and p_access_type = 'reconcile'
      and (configuration.branch_id is null
        or configuration.branch_id is not distinct from effective_branch_id)
      and (p_branch_id is null or p_branch_id is not distinct from effective_branch_id)
  );
end
$$;

revoke all on function public.is_trusted_showroom_payment_context(
  uuid, text, uuid, text, uuid
) from public, anon, authenticated, service_role;

-- Extend only the canonical authorization gate. Ordinary calls retain the
-- original permission/resource rules; the alternative is transaction-local,
-- Showroom-only, sale-bound, action-whitelisted, and resource-bound above.
create or replace function public.can_perform_financial_action(
  p_tenant_id uuid,
  p_permission_code text,
  p_account_id uuid default null,
  p_access_type text default null,
  p_branch_id uuid default null,
  p_state_transition_valid boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(p_state_transition_valid, false)
    and p_permission_code like 'financial.%'
    and (
      (
        public.current_tenant_id() = p_tenant_id
        and public.has_permission(p_permission_code, p_tenant_id)
        and (p_branch_id is null or public.has_branch_access(p_branch_id))
        and (
          (p_account_id is null and p_access_type is null)
          or (
            p_account_id is not null and p_access_type is not null
            and public.has_financial_resource_access(
              p_tenant_id, p_account_id, p_access_type, p_branch_id
            )
          )
        )
      )
      or public.is_trusted_showroom_payment_context(
        p_tenant_id, p_permission_code, p_account_id,
        p_access_type, p_branch_id
      )
    )
$$;

create or replace function public.collect_showroom_sale_payment(
  p_sale_id uuid,
  p_amount numeric,
  p_payment_method_id uuid,
  p_idempotency_key text,
  p_money_destination_id uuid default null,
  p_reference_number text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  sale public.showroom_sales%rowtype;
  actor public.tenant_users%rowtype;
  posting public.financial_sale_postings%rowtype;
  receivable public.account_move_lines%rowtype;
  method public.financial_payment_methods%rowtype;
  destination public.money_destinations%rowtype;
  effective_branch_id uuid;
  requested_amount numeric(18,2) := round(p_amount, 2);
  normalized_key text := nullif(btrim(p_idempotency_key), '');
  payment_key text;
  allocation_key text;
  expected_fingerprint text;
  existing_payment public.financial_payments%rowtype;
  existing_allocation public.financial_payment_allocations%rowtype;
  context_data jsonb;
  capability text;
  create_result jsonb;
  submit_result jsonb;
  post_result jsonb;
  allocation_result jsonb;
  payment_id uuid;
  remaining_amount numeric(18,2);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if p_sale_id is null or p_payment_method_id is null then
    raise exception using errcode = '22023', message = 'SHOWROOM_PAYMENT_REQUIRED_CONTEXT_MISSING';
  end if;
  if p_amount is null or requested_amount <= 0 or requested_amount <> p_amount then
    raise exception using errcode = '22023', message = 'SHOWROOM_PAYMENT_AMOUNT_INVALID';
  end if;
  if normalized_key is null or length(normalized_key) > 100 then
    raise exception using errcode = '22023', message = 'SHOWROOM_PAYMENT_IDEMPOTENCY_KEY_INVALID';
  end if;

  select item.* into sale
  from public.showroom_sales item
  where item.id = p_sale_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SHOWROOM_SALE_NOT_FOUND';
  end if;

  select member.* into actor
  from public.tenant_users member
  where member.tenant_id = sale.tenant_id
    and member.auth_user_id = auth.uid()
    and member.is_active
  order by member.created_at, member.id
  limit 1;
  if not found or public.current_tenant_id() is distinct from sale.tenant_id then
    raise exception using errcode = '42501', message = 'ACTIVE_TENANT_MEMBERSHIP_REQUIRED';
  end if;
  if not public.has_permission('showroom_point.access', sale.tenant_id) then
    raise exception using errcode = '42501', message = 'SHOWROOM_PAYMENT_PERMISSION_REQUIRED';
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
  if effective_branch_id is not null and not public.has_branch_access(effective_branch_id) then
    raise exception using errcode = '42501', message = 'SHOWROOM_BRANCH_ACCESS_REQUIRED';
  end if;
  if sale.status <> 'confirmed' then
    raise exception using errcode = '23514', message = 'SHOWROOM_CANONICAL_PAYMENT_REQUIRES_CONFIRMED_SALE';
  end if;
  if sale.financial_confirmation_generation <= 1 or not exists (
    select 1 from public.showroom_financial_cutovers marker
    where marker.tenant_id = sale.tenant_id
      and marker.source_app = 'showroom'
      and marker.source_model = 'sale'
      and marker.canonical_generation = sale.financial_confirmation_generation
  ) then
    raise exception using errcode = '23514', message = 'SHOWROOM_SALE_NOT_CANONICAL_GENERATION';
  end if;

  select canonical_posting.* into posting
  from public.financial_engine_bindings binding
  join public.financial_sale_postings canonical_posting
    on canonical_posting.id = binding.canonical_sale_posting_id
   and canonical_posting.tenant_id = binding.tenant_id
  where binding.tenant_id = sale.tenant_id
    and binding.source_app = 'showroom'
    and binding.source_model = 'sale'
    and binding.source_id = sale.id::text
    and binding.financial_event_version = 1
    and binding.financial_engine = 'canonical'
    and binding.state = 'posted'
    and canonical_posting.state = 'posted'
    and canonical_posting.source_app = binding.source_app
    and canonical_posting.source_model = binding.source_model
    and canonical_posting.source_id = binding.source_id
    and canonical_posting.event_version = binding.financial_event_version;
  if not found
     or posting.partner_id is distinct from sale.customer_id
     or posting.branch_id is distinct from effective_branch_id
     or posting.account_move_id is distinct from sale.account_move_id
  then
    raise exception using errcode = '23514', message = 'SHOWROOM_CANONICAL_SALE_POSTING_INVALID';
  end if;

  select line.* into receivable
  from public.account_move_lines line
  where line.id = posting.receivable_line_id
    and line.tenant_id = posting.tenant_id
  for update;
  if not found
     or receivable.move_id is distinct from posting.account_move_id
     or receivable.partner_id is distinct from sale.customer_id
     or receivable.parent_state <> 'posted'
     or receivable.line_type <> 'open_item'
     or receivable.debit <= 0 or receivable.credit <> 0
     or not public.account_matches_functional_role(
       sale.tenant_id, receivable.account_id,
       'customer_receivable', effective_branch_id
     )
  then
    raise exception using errcode = '23514', message = 'SHOWROOM_CANONICAL_RECEIVABLE_INVALID';
  end if;

  payment_key := 'showroom:sale:' || sale.id::text || ':payment:' || normalized_key;
  allocation_key := payment_key || ':allocation';
  perform pg_advisory_xact_lock(hashtextextended(
    'showroom_canonical_payment:' || sale.tenant_id::text || ':' || payment_key, 0
  ));
  expected_fingerprint := public.financial_payment_request_fingerprint(
    'inbound', requested_amount, posting.currency_code,
    p_payment_method_id, p_money_destination_id, sale.customer_id,
    effective_branch_id, p_reference_number, p_notes,
    'showroom', 'sale', sale.id::text
  );

  select item.* into existing_payment
  from public.financial_payments item
  where item.tenant_id = sale.tenant_id
    and item.idempotency_key = payment_key
  for update;
  if found then
    if existing_payment.request_fingerprint <> expected_fingerprint then
      raise exception using errcode = '23505', message = 'SHOWROOM_PAYMENT_IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    select item.* into existing_allocation
    from public.financial_payment_allocations item
    where item.tenant_id = sale.tenant_id
      and item.payment_id = existing_payment.id
      and item.idempotency_key = allocation_key
      and item.status = 'active';
    if existing_payment.status <> 'confirmed'
       or existing_payment.accounting_state <> 'posted'
       or existing_payment.payment_purpose <> 'inbound_customer_unallocated'
       or existing_payment.source_app <> 'showroom'
       or existing_payment.source_model <> 'sale'
       or existing_payment.source_id <> sale.id::text
       or existing_allocation.id is null
       or existing_allocation.target_account_line_id <> posting.receivable_line_id
       or existing_allocation.amount <> requested_amount
    then
      raise exception using errcode = '55000', message = 'SHOWROOM_PAYMENT_IDEMPOTENT_STATE_INCOMPLETE';
    end if;
    return jsonb_build_object(
      'success', true, 'idempotent_replay', true,
      'sale_id', sale.id, 'payment_id', existing_payment.id,
      'payment_number', existing_payment.payment_number,
      'allocation_id', existing_allocation.id,
      'amount', existing_payment.amount,
      'currency_code', existing_payment.currency_code,
      'remaining_amount', receivable.amount_residual,
      'payment_status', existing_payment.status,
      'accounting_state', existing_payment.accounting_state
    );
  end if;

  if receivable.amount_residual <= 0 then
    raise exception using errcode = '23514', message = 'SHOWROOM_SALE_ALREADY_PAID';
  end if;
  if requested_amount > receivable.amount_residual then
    raise exception using errcode = '23514', message = 'SHOWROOM_PAYMENT_EXCEEDS_SALE_RESIDUAL';
  end if;

  select item.* into method
  from public.financial_payment_methods item
  where item.id = p_payment_method_id
    and item.tenant_id = sale.tenant_id
    and item.is_active;
  if not found then
    raise exception using errcode = '23514', message = 'PAYMENT_METHOD_INVALID_OR_INACTIVE';
  end if;
  if method.settlement_mode = 'direct' then
    if p_money_destination_id is null then
      raise exception using errcode = '22023', message = 'SHOWROOM_PAYMENT_DESTINATION_REQUIRED';
    end if;
    select item.* into destination
    from public.money_destinations item
    join public.financial_payment_method_destination_types compatibility
      on compatibility.method_type = method.method_type
     and compatibility.destination_type = item.destination_type
    join public.account_accounts account
      on account.id = item.ledger_account_id
     and account.tenant_id = item.tenant_id
     and account.money_destination_id = item.id
     and account.account_origin = 'resource'
     and account.active and account.is_posting
    join public.account_journals journal
      on journal.id = item.journal_id
     and journal.tenant_id = item.tenant_id
     and journal.money_destination_id = item.id
     and journal.journal_origin = 'resource'
     and journal.default_account_id = account.id
     and journal.is_active
    where item.id = p_money_destination_id
      and item.tenant_id = sale.tenant_id
      and item.status = 'active'
      and (effective_branch_id is null or item.branch_id is null
        or item.branch_id = effective_branch_id);
    if not found then
      raise exception using errcode = '23514', message = 'SHOWROOM_PAYMENT_DESTINATION_METHOD_INVALID';
    end if;
    if destination.branch_id is not null and not public.has_branch_access(destination.branch_id) then
      raise exception using errcode = '42501', message = 'SHOWROOM_PAYMENT_DESTINATION_BRANCH_ACCESS_REQUIRED';
    end if;
  elsif method.settlement_mode = 'clearing' then
    if p_money_destination_id is not null then
      raise exception using errcode = '23514', message = 'CLEARING_PAYMENT_MUST_NOT_HAVE_DIRECT_DESTINATION';
    end if;
    if not exists (
      select 1
      from public.financial_payment_method_settlement_configs configuration
      join public.account_accounts account
        on account.id = configuration.clearing_account_id
       and account.tenant_id = configuration.tenant_id
       and account.active and account.is_posting and account.open_item_reconcile
      join public.account_journals journal
        on journal.id = configuration.clearing_journal_id
       and journal.tenant_id = configuration.tenant_id
       and journal.is_active
       and journal.default_account_id = account.id
      where configuration.tenant_id = sale.tenant_id
        and configuration.payment_method_id = method.id
        and configuration.is_active
        and (configuration.branch_id is null
          or configuration.branch_id is not distinct from effective_branch_id)
    ) then
      raise exception using errcode = '23514', message = 'PAYMENT_CLEARING_CONFIGURATION_UNAVAILABLE';
    end if;
  else
    raise exception using errcode = '23514', message = 'PAYMENT_SETTLEMENT_MODE_INVALID';
  end if;

  context_data := jsonb_build_object(
    'tenant_id', sale.tenant_id,
    'sale_id', sale.id,
    'payment_method_id', method.id,
    'money_destination_id', p_money_destination_id,
    'branch_id', effective_branch_id,
    'actor_auth_id', auth.uid(),
    'amount', requested_amount,
    'idempotency_key', normalized_key
  );
  capability := encode(extensions.digest(context_data::text, 'sha256'), 'hex');
  perform set_config('app.showroom_canonical_payment_context', context_data::text, true);
  perform set_config('app.showroom_canonical_payment', capability, true);

  create_result := public.create_financial_payment(
    sale.tenant_id, 'inbound', requested_amount, method.id, payment_key,
    p_money_destination_id, posting.currency_code, sale.customer_id,
    effective_branch_id, p_reference_number, p_notes,
    'showroom', 'sale', sale.id::text
  );
  payment_id := (create_result ->> 'payment_id')::uuid;
  submit_result := public.submit_financial_payment(sale.tenant_id, payment_id);
  if submit_result ->> 'status' = 'submitted' then
    perform public.confirm_financial_payment(sale.tenant_id, payment_id);
  elsif submit_result ->> 'status' <> 'confirmed' then
    raise exception using errcode = '55000', message = 'SHOWROOM_PAYMENT_CONFIRMATION_INCOMPLETE';
  end if;
  post_result := public.post_financial_payment(
    sale.tenant_id, payment_id, 'inbound_customer_unallocated'
  );
  allocation_result := public.allocate_financial_payment(
    sale.tenant_id, payment_id, posting.receivable_line_id,
    requested_amount, allocation_key
  );

  perform set_config('app.showroom_canonical_payment', '', true);
  perform set_config('app.showroom_canonical_payment_context', '', true);
  select line.amount_residual into remaining_amount
  from public.account_move_lines line
  where line.id = posting.receivable_line_id
    and line.tenant_id = posting.tenant_id;

  return jsonb_build_object(
    'success', true, 'idempotent_replay', false,
    'sale_id', sale.id, 'payment_id', payment_id,
    'payment_number', create_result ->> 'payment_number',
    'allocation_id', allocation_result ->> 'allocation_id',
    'amount', requested_amount, 'currency_code', posting.currency_code,
    'remaining_amount', remaining_amount,
    'payment_status', 'confirmed', 'accounting_state', 'posted',
    'settlement_mode', post_result ->> 'settlement_mode'
  );
exception when others then
  perform set_config('app.showroom_canonical_payment', '', true);
  perform set_config('app.showroom_canonical_payment_context', '', true);
  raise;
end
$$;

revoke all on function public.collect_showroom_sale_payment(
  uuid, numeric, uuid, text, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.collect_showroom_sale_payment(
  uuid, numeric, uuid, text, uuid, text, text
) to authenticated;

comment on function public.collect_showroom_sale_payment(
  uuid, numeric, uuid, text, uuid, text, text
) is
  'Atomic Showroom command for a Canonical confirmed sale: derives tenant/customer/branch/AR, then creates, submits, confirms, posts and allocates one Canonical inbound payment.';
comment on function public.is_trusted_showroom_payment_context(
  uuid, text, uuid, text, uuid
) is
  'Internal transaction-local authorization for the Showroom payment command; limited to its Canonical sale, selected settlement resource and payment action whitelist.';
comment on function public.can_perform_financial_action(
  uuid, text, uuid, text, uuid, boolean
) is
  'Canonical financial authorization. Ordinary callers require action, branch and resource grants; the narrow Showroom payment command may reuse payment primitives only through its sale-bound transaction-local capability.';

commit;
