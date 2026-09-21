begin;

-- Generic obligation settlement is intentionally distinct from
-- financial_settlements, which models provider clearing batches.
insert into public.auth_permissions (
  code, name, description, resource, action,
  module_code, permission_type, sort_order, active
)
values
  ('settlement.view', 'عرض خيارات التسوية',
    'قراءة الالتزام المالي وخيارات تسويته ضمن النطاق التشغيلي.',
    'settlement', 'view', 'settlement', 'action', 100, true),
  ('settlement.collect', 'تحصيل التزام مالي',
    'تنفيذ تحصيل مالي Canonical على التزام أعمال محدد.',
    'settlement', 'collect', 'settlement', 'action', 110, true)
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

create table public.settlement_mechanisms (
  code text primary key,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint settlement_mechanisms_code_check
    check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint settlement_mechanisms_name_check check (btrim(name) <> '')
);

insert into public.settlement_mechanisms (code, name)
values ('money_payment', 'Money payment');

create table public.obligation_settlement_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  target_type text not null,
  target_id text not null,
  mechanism text not null references public.settlement_mechanisms(code) on delete restrict,
  amount numeric(18,2) not null,
  payment_method_id uuid,
  money_destination_id uuid,
  reference_number text,
  notes text,
  idempotency_key text not null,
  request_fingerprint text not null,
  status text not null default 'processing',
  result jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint obligation_settlement_commands_method_fkey
    foreign key (payment_method_id, tenant_id)
    references public.financial_payment_methods(id, tenant_id) on delete restrict,
  constraint obligation_settlement_commands_destination_fkey
    foreign key (money_destination_id, tenant_id)
    references public.money_destinations(id, tenant_id) on delete restrict,
  constraint obligation_settlement_commands_actor_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint obligation_settlement_commands_tenant_key
    unique (tenant_id, idempotency_key),
  constraint obligation_settlement_commands_id_tenant_key unique (id, tenant_id),
  constraint obligation_settlement_commands_target_type_check
    check (target_type ~ '^[a-z][a-z0-9_]*$'),
  constraint obligation_settlement_commands_target_id_check
    check (length(btrim(target_id)) between 1 and 200),
  constraint obligation_settlement_commands_amount_check
    check (amount > 0 and amount = round(amount, 2)),
  constraint obligation_settlement_commands_key_check
    check (length(btrim(idempotency_key)) between 1 and 200),
  constraint obligation_settlement_commands_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint obligation_settlement_commands_status_check
    check (status in ('processing', 'completed')),
  constraint obligation_settlement_commands_lifecycle_check check (
    (status = 'processing' and result is null and completed_at is null)
    or (status = 'completed' and result is not null and completed_at is not null)
  ),
  constraint obligation_settlement_commands_result_check
    check (result is null or jsonb_typeof(result) = 'object'),
  constraint obligation_settlement_commands_money_shape_check check (
    mechanism <> 'money_payment' or payment_method_id is not null
  )
);

create table public.obligation_settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  command_id uuid not null,
  target_type text not null,
  target_id text not null,
  business_reference text not null,
  party_id uuid not null,
  branch_id uuid,
  currency_code varchar(3) not null,
  amount numeric(18,2) not null,
  outstanding_before numeric(18,2) not null,
  outstanding_after numeric(18,2) not null,
  status text not null default 'recorded',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint obligation_settlements_command_fkey
    foreign key (command_id, tenant_id)
    references public.obligation_settlement_commands(id, tenant_id) on delete restrict,
  constraint obligation_settlements_party_fkey
    foreign key (party_id, tenant_id)
    references public.partners(id, tenant_id) on delete restrict,
  constraint obligation_settlements_branch_fkey
    foreign key (branch_id, tenant_id)
    references public.branches(id, tenant_id) on delete restrict,
  constraint obligation_settlements_actor_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint obligation_settlements_command_unique unique (tenant_id, command_id),
  constraint obligation_settlements_id_tenant_key unique (id, tenant_id),
  constraint obligation_settlements_target_type_check
    check (target_type ~ '^[a-z][a-z0-9_]*$'),
  constraint obligation_settlements_target_id_check
    check (length(btrim(target_id)) between 1 and 200),
  constraint obligation_settlements_reference_check
    check (length(btrim(business_reference)) between 1 and 200),
  constraint obligation_settlements_currency_check
    check (currency_code ~ '^[A-Z]{3}$'),
  constraint obligation_settlements_amount_check check (
    amount > 0 and amount = round(amount, 2)
    and outstanding_before >= amount
    and outstanding_after = round(outstanding_before - amount, 2)
  ),
  constraint obligation_settlements_status_check check (status = 'recorded')
);

create unique index financial_payment_allocations_id_tenant_key
  on public.financial_payment_allocations (id, tenant_id);

create table public.obligation_settlement_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  settlement_id uuid not null,
  component_position integer not null,
  mechanism text not null references public.settlement_mechanisms(code) on delete restrict,
  amount numeric(18,2) not null,
  payment_method_id uuid,
  money_destination_id uuid,
  payment_id uuid,
  payment_allocation_id uuid,
  status text not null default 'recorded',
  created_at timestamptz not null default now(),
  constraint obligation_settlement_components_settlement_fkey
    foreign key (settlement_id, tenant_id)
    references public.obligation_settlements(id, tenant_id) on delete restrict,
  constraint obligation_settlement_components_method_fkey
    foreign key (payment_method_id, tenant_id)
    references public.financial_payment_methods(id, tenant_id) on delete restrict,
  constraint obligation_settlement_components_destination_fkey
    foreign key (money_destination_id, tenant_id)
    references public.money_destinations(id, tenant_id) on delete restrict,
  constraint obligation_settlement_components_payment_fkey
    foreign key (payment_id, tenant_id)
    references public.financial_payments(id, tenant_id) on delete restrict,
  constraint obligation_settlement_components_allocation_fkey
    foreign key (payment_allocation_id, tenant_id)
    references public.financial_payment_allocations(id, tenant_id) on delete restrict,
  constraint obligation_settlement_components_position_unique
    unique (tenant_id, settlement_id, component_position),
  constraint obligation_settlement_components_payment_unique
    unique (tenant_id, payment_id),
  constraint obligation_settlement_components_allocation_unique
    unique (tenant_id, payment_allocation_id),
  constraint obligation_settlement_components_position_check
    check (component_position > 0),
  constraint obligation_settlement_components_amount_check
    check (amount > 0 and amount = round(amount, 2)),
  constraint obligation_settlement_components_status_check check (status = 'recorded'),
  constraint obligation_settlement_components_money_shape_check check (
    mechanism <> 'money_payment'
    or (payment_method_id is not null and payment_id is not null
      and payment_allocation_id is not null)
  )
);

create table public.obligation_settlement_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  settlement_id uuid not null,
  event_type text not null,
  actor_id uuid not null,
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  constraint obligation_settlement_events_settlement_fkey
    foreign key (settlement_id, tenant_id)
    references public.obligation_settlements(id, tenant_id) on delete restrict,
  constraint obligation_settlement_events_actor_fkey
    foreign key (actor_id, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint obligation_settlement_events_type_check
    check (event_type = 'obligation_settled'),
  constraint obligation_settlement_events_payload_check check (
    jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192
  )
);

create index obligation_settlements_target_idx
  on public.obligation_settlements
  (tenant_id, target_type, target_id, created_at, id);
create index obligation_settlement_events_history_idx
  on public.obligation_settlement_events
  (tenant_id, settlement_id, occurred_at, id);

create or replace function public.settlement_request_fingerprint(p_payload jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select encode(extensions.digest(coalesce(p_payload, '{}'::jsonb)::text, 'sha256'), 'hex')
$$;

create or replace function public.resolve_settlement_target(
  p_tenant_id uuid,
  p_target_type text,
  p_target_id text
)
returns table (
  target_type text,
  target_id text,
  business_reference text,
  target_status text,
  party_id uuid,
  party_name text,
  branch_id uuid,
  branch_name text,
  currency_code text,
  original_amount numeric,
  outstanding_amount numeric,
  obligation_account_line_id uuid,
  obligation_account_id uuid,
  posting_date date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sale_id uuid;
begin
  if lower(btrim(coalesce(p_target_type, ''))) <> 'sale' then
    raise exception using errcode = '22023', message = 'SETTLEMENT_TARGET_TYPE_UNSUPPORTED';
  end if;
  begin
    v_sale_id := btrim(p_target_id)::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'SETTLEMENT_TARGET_ID_INVALID';
  end;

  return query
  select
    'sale'::text,
    sale.id::text,
    sale.sale_number,
    sale.status,
    sale.customer_id,
    customer.name,
    sale.branch_id,
    branch.name,
    posting.currency_code::text,
    posting.amount,
    receivable.amount_residual,
    receivable.id,
    receivable.account_id,
    posting.posting_date
  from public.sales sale
  join public.branches branch
    on branch.id = sale.branch_id
   and branch.tenant_id = sale.tenant_id
   and branch.is_active
  join public.partners customer
    on customer.id = sale.customer_id
   and customer.tenant_id = sale.tenant_id
   and customer.active
   and customer.customer_rank > 0
  join public.sale_confirmation_links confirmation
    on confirmation.sale_id = sale.id
   and confirmation.tenant_id = sale.tenant_id
  join public.financial_sale_postings posting
    on posting.id = confirmation.financial_sale_posting_id
   and posting.tenant_id = confirmation.tenant_id
  join public.financial_engine_bindings binding
    on binding.id = confirmation.financial_engine_binding_id
   and binding.tenant_id = confirmation.tenant_id
  join public.account_moves posting_move
    on posting_move.id = posting.account_move_id
   and posting_move.tenant_id = posting.tenant_id
  join public.account_move_lines receivable
    on receivable.id = posting.receivable_line_id
   and receivable.tenant_id = posting.tenant_id
  where sale.id = v_sale_id
    and sale.tenant_id = p_tenant_id
    and sale.status = 'confirmed'
    and sale.sale_number is not null
    and posting.source_app = 'sales_core'
    and posting.source_model = 'sale'
    and posting.source_id = sale.id::text
    and posting.event_version = sale.version
    and posting.partner_id = sale.customer_id
    and posting.branch_id is not distinct from sale.branch_id
    and posting.amount = sale.total_amount
    and posting.currency_code = sale.currency_code
    and posting.state = 'posted'
    and binding.source_app = posting.source_app
    and binding.source_model = posting.source_model
    and binding.source_id = posting.source_id
    and binding.financial_event_version = posting.event_version
    and binding.financial_engine = 'canonical'
    and binding.state = 'posted'
    and binding.canonical_sale_posting_id = posting.id
    and binding.legacy_move_id is null
    and posting_move.state = 'posted'
    and posting_move.branch_id is not distinct from sale.branch_id
    and receivable.move_id = posting.account_move_id
    and receivable.partner_id = sale.customer_id
    and receivable.parent_state = 'posted'
    and receivable.line_type = 'open_item'
    and receivable.debit = posting.amount
    and receivable.credit = 0
    and receivable.amount_residual between 0 and posting.amount
    and receivable.amount_residual_currency = receivable.amount_residual
    and receivable.currency_code = posting.currency_code
    and public.account_matches_functional_role(
      sale.tenant_id, receivable.account_id,
      'customer_receivable', sale.branch_id
    );

  if not found then
    if exists (
      select 1 from public.sales sale
      where sale.id = v_sale_id and sale.tenant_id = p_tenant_id
        and sale.status <> 'confirmed'
    ) then
      raise exception using errcode = '23514', message = 'SETTLEMENT_TARGET_NOT_CONFIRMED';
    end if;
    if exists (
      select 1 from public.sales sale
      where sale.id = v_sale_id and sale.tenant_id = p_tenant_id
    ) then
      raise exception using errcode = '23514', message = 'SETTLEMENT_CANONICAL_OBLIGATION_INVALID';
    end if;
    raise exception using errcode = 'P0002', message = 'SETTLEMENT_TARGET_NOT_FOUND';
  end if;
end
$$;

create or replace function public.guard_obligation_settlement_command()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'SETTLEMENT_COMMAND_DELETE_FORBIDDEN';
  end if;
  if current_setting('app.canonical_settlement_command', true)
      is distinct from coalesce(new.id, old.id)::text then
    raise exception using errcode = '42501', message = 'SETTLEMENT_COMMAND_INTERNAL_CONTROL_REQUIRED';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'processing' or new.result is not null or new.completed_at is not null then
      raise exception using errcode = '23514', message = 'SETTLEMENT_COMMAND_INITIAL_STATE_INVALID';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id
     or new.mechanism is distinct from old.mechanism
     or new.amount is distinct from old.amount
     or new.payment_method_id is distinct from old.payment_method_id
     or new.money_destination_id is distinct from old.money_destination_id
     or new.reference_number is distinct from old.reference_number
     or new.notes is distinct from old.notes
     or new.idempotency_key is distinct from old.idempotency_key
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or old.status <> 'processing'
     or new.status <> 'completed'
     or new.result is null
     or new.completed_at is null then
    raise exception using errcode = '23514', message = 'SETTLEMENT_COMMAND_MUTATION_INVALID';
  end if;
  return new;
end
$$;

create trigger obligation_settlement_commands_guard
before insert or update or delete on public.obligation_settlement_commands
for each row execute function public.guard_obligation_settlement_command();

create or replace function public.guard_obligation_settlement_fact()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_command_id uuid;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '42501', message = 'OBLIGATION_SETTLEMENT_FACT_IMMUTABLE';
  end if;
  if tg_table_name = 'obligation_settlements' then
    v_command_id := new.command_id;
  else
    select settlement.command_id into v_command_id
    from public.obligation_settlements settlement
    where settlement.id = new.settlement_id
      and settlement.tenant_id = new.tenant_id;
  end if;
  if v_command_id is null
     or current_setting('app.canonical_settlement_command', true)
        is distinct from v_command_id::text then
    raise exception using errcode = '42501', message = 'OBLIGATION_SETTLEMENT_COMMAND_REQUIRED';
  end if;
  return new;
end
$$;

create trigger obligation_settlements_guard
before insert or update or delete on public.obligation_settlements
for each row execute function public.guard_obligation_settlement_fact();
create trigger obligation_settlement_components_guard
before insert or update or delete on public.obligation_settlement_components
for each row execute function public.guard_obligation_settlement_fact();
create trigger obligation_settlement_events_guard
before insert or update or delete on public.obligation_settlement_events
for each row execute function public.guard_obligation_settlement_fact();

create or replace function public.is_trusted_settlement_context(
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
  v_command public.obligation_settlement_commands%rowtype;
  v_target record;
  v_method public.financial_payment_methods%rowtype;
begin
  begin
    select command.* into v_command
    from public.obligation_settlement_commands command
    where command.id = current_setting('app.canonical_settlement_command', true)::uuid
      and command.tenant_id = p_tenant_id
      and command.status = 'processing'
      and command.result is null
      and command.created_by = public.current_tenant_user_id()
      and command.mechanism = 'money_payment';
  exception when others then
    return false;
  end;
  if not found
     or auth.uid() is null
     or public.current_tenant_id() is distinct from p_tenant_id
     or not public.has_permission('settlement.collect', p_tenant_id)
     or p_permission_code not in (
       'financial.payment.create', 'financial.payment.submit',
       'financial.payment.confirm', 'financial.payment.post',
       'financial.payment.allocate'
     ) then
    return false;
  end if;

  begin
    select * into v_target from public.resolve_settlement_target(
      p_tenant_id, v_command.target_type, v_command.target_id
    );
  exception when others then
    return false;
  end;
  if v_target.branch_id is not null
     and not public.has_branch_access(v_target.branch_id) then
    return false;
  end if;
  if p_branch_id is not null and p_branch_id is distinct from v_target.branch_id then
    return false;
  end if;

  if p_account_id is null and p_access_type is null then
    return true;
  end if;
  if p_permission_code = 'financial.payment.allocate' then
    return p_account_id = v_target.obligation_account_id
      and p_access_type = 'reconcile';
  end if;

  select method.* into v_method
  from public.financial_payment_methods method
  where method.id = v_command.payment_method_id
    and method.tenant_id = p_tenant_id
    and method.is_active;
  if not found then
    return false;
  end if;

  if v_method.settlement_mode = 'direct' then
    return exists (
      select 1
      from public.money_destinations destination
      join public.financial_payment_method_destination_types compatibility
        on compatibility.method_type = v_method.method_type
       and compatibility.destination_type = destination.destination_type
      join public.account_accounts account
        on account.id = destination.ledger_account_id
       and account.tenant_id = destination.tenant_id
       and account.money_destination_id = destination.id
       and account.account_origin = 'resource'
       and account.active and account.is_posting
      join public.account_journals journal
        on journal.id = destination.journal_id
       and journal.tenant_id = destination.tenant_id
       and journal.money_destination_id = destination.id
       and journal.journal_origin = 'resource'
       and journal.default_account_id = account.id
       and journal.is_active
      where destination.id = v_command.money_destination_id
        and destination.tenant_id = p_tenant_id
        and destination.status = 'active'
        and destination.ledger_account_id = p_account_id
        and (v_target.branch_id is null or destination.branch_id is null
          or destination.branch_id = v_target.branch_id)
        and public.has_money_destination_access(
          p_tenant_id, destination.id, 'initiate', v_target.branch_id
        )
        and (
          (p_permission_code in ('financial.payment.create', 'financial.payment.submit')
            and p_access_type = 'initiate')
          or (p_permission_code in ('financial.payment.confirm', 'financial.payment.post')
            and p_access_type = 'confirm')
        )
    );
  end if;

  return v_method.settlement_mode = 'clearing'
    and v_command.money_destination_id is null
    and p_permission_code in ('financial.payment.confirm', 'financial.payment.post')
    and p_access_type = 'reconcile'
    and exists (
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
      where configuration.tenant_id = p_tenant_id
        and configuration.payment_method_id = v_method.id
        and configuration.is_active
        and configuration.clearing_account_id = p_account_id
        and (configuration.branch_id is null
          or configuration.branch_id is not distinct from v_target.branch_id)
    );
end
$$;

-- Keep the ordinary Financial permission path and the transitional Showroom
-- adapter unchanged; add only the command-bound generic Settlement capability.
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
      or public.is_trusted_settlement_context(
        p_tenant_id, p_permission_code, p_account_id,
        p_access_type, p_branch_id
      )
    )
$$;

create or replace function public.get_settlement_options(
  p_target_type text,
  p_target_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_target record;
  v_sale record;
  v_method record;
  v_destination record;
  v_methods jsonb := '[]'::jsonb;
  v_destinations jsonb;
  v_can_collect boolean;
  v_reasons jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or v_tenant_id is null
     or public.current_tenant_user_id() is null then
    raise exception using errcode = '42501', message = 'ACTIVE_TENANT_MEMBERSHIP_REQUIRED';
  end if;
  if not public.has_permission('settlement.view', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SETTLEMENT_VIEW_DENIED';
  end if;
  if lower(btrim(coalesce(p_target_type, ''))) <> 'sale' then
    raise exception using errcode = '22023', message = 'SETTLEMENT_TARGET_TYPE_UNSUPPORTED';
  end if;

  begin
    select sale.id, sale.sale_number, sale.status, sale.customer_id,
      customer.name customer_name, sale.branch_id, branch.name branch_name,
      sale.currency_code, sale.total_amount
    into v_sale
    from public.sales sale
    join public.partners customer
      on customer.id = sale.customer_id and customer.tenant_id = sale.tenant_id
    join public.branches branch
      on branch.id = sale.branch_id and branch.tenant_id = sale.tenant_id
    where sale.id = btrim(p_target_id)::uuid
      and sale.tenant_id = v_tenant_id;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'SETTLEMENT_TARGET_ID_INVALID';
  end;
  if not found or not public.has_branch_access(v_sale.branch_id) then
    raise exception using errcode = 'P0002', message = 'SETTLEMENT_TARGET_NOT_FOUND';
  end if;

  if v_sale.status <> 'confirmed' then
    return jsonb_build_object(
      'target', jsonb_build_object('type', 'sale', 'id', v_sale.id,
        'reference', v_sale.sale_number, 'status', v_sale.status),
      'party', jsonb_build_object('type', 'customer', 'id', v_sale.customer_id,
        'name', v_sale.customer_name),
      'branch', jsonb_build_object('id', v_sale.branch_id, 'name', v_sale.branch_name),
      'currency_code', v_sale.currency_code,
      'original_obligation', v_sale.total_amount,
      'outstanding_amount', null,
      'settleable_amount', 0,
      'can_settle', false,
      'reason_codes', jsonb_build_array('TARGET_NOT_CONFIRMED'),
      'settlement_mechanisms', '[]'::jsonb
    );
  end if;

  select * into v_target from public.resolve_settlement_target(
    v_tenant_id, 'sale', v_sale.id::text
  );
  v_can_collect := public.has_permission('settlement.collect', v_tenant_id)
    and v_target.outstanding_amount > 0;
  if v_target.outstanding_amount <= 0 then
    v_reasons := v_reasons || jsonb_build_array('OBLIGATION_ALREADY_SETTLED');
  elsif not public.has_permission('settlement.collect', v_tenant_id) then
    v_reasons := v_reasons || jsonb_build_array('SETTLEMENT_COLLECT_PERMISSION_REQUIRED');
  end if;

  if v_can_collect then
    for v_method in
      select method.id, method.name, method.semantic_key, method.method_type,
        method.settlement_mode, method.requires_reference
      from public.financial_payment_methods method
      where method.tenant_id = v_tenant_id
        and method.is_active
        and public.is_financial_payment_method_usable(v_tenant_id, method.id)
      order by method.name, method.id
    loop
      v_destinations := '[]'::jsonb;
      if v_method.settlement_mode = 'direct' then
        for v_destination in
          select destination.id, destination.name, destination.destination_type,
            destination.responsible_user_id = public.current_tenant_user_id() is_own_custody
          from public.money_destinations destination
          join public.financial_payment_method_destination_types compatibility
            on compatibility.method_type = v_method.method_type
           and compatibility.destination_type = destination.destination_type
          join public.account_accounts account
            on account.id = destination.ledger_account_id
           and account.tenant_id = destination.tenant_id
           and account.money_destination_id = destination.id
           and account.account_origin = 'resource'
           and account.active and account.is_posting
          join public.account_journals journal
            on journal.id = destination.journal_id
           and journal.tenant_id = destination.tenant_id
           and journal.money_destination_id = destination.id
           and journal.journal_origin = 'resource'
           and journal.default_account_id = account.id
           and journal.is_active
          where destination.tenant_id = v_tenant_id
            and destination.status = 'active'
            and (v_target.branch_id is null or destination.branch_id is null
              or destination.branch_id = v_target.branch_id)
            and public.has_money_destination_access(
              v_tenant_id, destination.id, 'initiate', v_target.branch_id
            )
          order by
            (destination.responsible_user_id = public.current_tenant_user_id()) desc,
            destination.name, destination.id
        loop
          v_destinations := v_destinations || jsonb_build_array(jsonb_build_object(
            'id', v_destination.id,
            'name', v_destination.name,
            'type', v_destination.destination_type,
            'is_own_custody', v_destination.is_own_custody
          ));
        end loop;
        if jsonb_array_length(v_destinations) > 0 then
          v_methods := v_methods || jsonb_build_array(jsonb_build_object(
            'id', v_method.id, 'name', v_method.name,
            'code', v_method.semantic_key, 'type', v_method.method_type,
            'requires_reference', v_method.requires_reference,
            'requires_money_destination', true,
            'money_destinations', v_destinations
          ));
        end if;
      elsif v_method.settlement_mode = 'clearing' and exists (
        select 1
        from public.financial_payment_method_settlement_configs configuration
        join public.account_accounts account
          on account.id = configuration.clearing_account_id
         and account.tenant_id = configuration.tenant_id
         and account.active and account.is_posting and account.open_item_reconcile
        join public.account_journals journal
          on journal.id = configuration.clearing_journal_id
         and journal.tenant_id = configuration.tenant_id
         and journal.is_active and journal.default_account_id = account.id
        where configuration.tenant_id = v_tenant_id
          and configuration.payment_method_id = v_method.id
          and configuration.is_active
          and (configuration.branch_id is null
            or configuration.branch_id is not distinct from v_target.branch_id)
      ) then
        v_methods := v_methods || jsonb_build_array(jsonb_build_object(
          'id', v_method.id, 'name', v_method.name,
          'code', v_method.semantic_key, 'type', v_method.method_type,
          'requires_reference', v_method.requires_reference,
          'requires_money_destination', false,
          'money_destinations', '[]'::jsonb
        ));
      end if;
    end loop;
    if jsonb_array_length(v_methods) = 0 then
      v_can_collect := false;
      v_reasons := v_reasons || jsonb_build_array('NO_ALLOWED_MONEY_PAYMENT_OPTION');
    end if;
  end if;

  return jsonb_build_object(
    'target', jsonb_build_object('type', v_target.target_type,
      'id', v_target.target_id, 'reference', v_target.business_reference,
      'status', v_target.target_status),
    'party', jsonb_build_object('type', 'customer', 'id', v_target.party_id,
      'name', v_target.party_name),
    'branch', jsonb_build_object('id', v_target.branch_id, 'name', v_target.branch_name),
    'currency_code', v_target.currency_code,
    'original_obligation', v_target.original_amount,
    'outstanding_amount', v_target.outstanding_amount,
    'settleable_amount', case when v_can_collect then v_target.outstanding_amount else 0 end,
    'can_settle', v_can_collect,
    'reason_codes', v_reasons,
    'settlement_mechanisms', case when v_can_collect then jsonb_build_array(
      jsonb_build_object('code', 'money_payment', 'payment_methods', v_methods)
    ) else '[]'::jsonb end
  );
end
$$;

create or replace function public.settle_obligation(
  p_target_type text,
  p_target_id text,
  p_mechanism text,
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
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id uuid := public.current_tenant_user_id();
  v_target_type text := lower(btrim(coalesce(p_target_type, '')));
  v_target_id text := btrim(coalesce(p_target_id, ''));
  v_mechanism text := lower(btrim(coalesce(p_mechanism, '')));
  v_amount numeric(18,2) := round(p_amount, 2);
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_reference text := nullif(btrim(p_reference_number), '');
  v_notes text := nullif(btrim(p_notes), '');
  v_fingerprint text;
  v_command_id uuid := gen_random_uuid();
  v_command public.obligation_settlement_commands%rowtype;
  v_target record;
  v_method public.financial_payment_methods%rowtype;
  v_destination public.money_destinations%rowtype;
  v_payment_key text;
  v_allocation_key text;
  v_create_result jsonb;
  v_submit_result jsonb;
  v_allocation_result jsonb;
  v_payment public.financial_payments%rowtype;
  v_allocation public.financial_payment_allocations%rowtype;
  v_settlement_id uuid := gen_random_uuid();
  v_residual_after numeric(18,2);
  v_result jsonb;
begin
  if auth.uid() is null or v_tenant_id is null or v_actor_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_TENANT_MEMBERSHIP_REQUIRED';
  end if;
  if not public.has_permission('settlement.collect', v_tenant_id) then
    raise exception using errcode = '42501', message = 'SETTLEMENT_COLLECT_DENIED';
  end if;
  if v_target_type !~ '^[a-z][a-z0-9_]*$'
     or length(v_target_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'SETTLEMENT_TARGET_INVALID';
  end if;
  if v_mechanism <> 'money_payment'
     or not exists (
       select 1 from public.settlement_mechanisms mechanism
       where mechanism.code = v_mechanism and mechanism.is_active
     ) then
    raise exception using errcode = '22023', message = 'SETTLEMENT_MECHANISM_UNSUPPORTED';
  end if;
  if p_amount is null or v_amount <= 0 or v_amount <> p_amount then
    raise exception using errcode = '22023', message = 'SETTLEMENT_AMOUNT_INVALID';
  end if;
  if p_payment_method_id is null then
    raise exception using errcode = '22023', message = 'SETTLEMENT_PAYMENT_METHOD_REQUIRED';
  end if;
  if v_key is null or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'SETTLEMENT_IDEMPOTENCY_KEY_INVALID';
  end if;
  if length(coalesce(v_reference, '')) > 500 or length(coalesce(v_notes, '')) > 4000 then
    raise exception using errcode = '22023', message = 'SETTLEMENT_TEXT_TOO_LONG';
  end if;

  v_fingerprint := public.settlement_request_fingerprint(jsonb_build_object(
    'target_type', v_target_type,
    'target_id', v_target_id,
    'mechanism', v_mechanism,
    'amount', v_amount,
    'payment_method_id', p_payment_method_id,
    'money_destination_id', p_money_destination_id,
    'reference_number', v_reference,
    'notes', v_notes
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'obligation_settlement_command:' || v_tenant_id::text || ':' || v_key, 0
  ));
  select command.* into v_command
  from public.obligation_settlement_commands command
  where command.tenant_id = v_tenant_id
    and command.idempotency_key = v_key
  for update;
  if found and v_command.request_fingerprint <> v_fingerprint then
    raise exception using errcode = '23505', message = 'SETTLEMENT_IDEMPOTENCY_PAYLOAD_MISMATCH';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'obligation_settlement_target:' || v_tenant_id::text || ':'
      || v_target_type || ':' || v_target_id, 0
  ));
  select * into v_target from public.resolve_settlement_target(
    v_tenant_id, v_target_type, v_target_id
  );
  if not public.has_branch_access(v_target.branch_id) then
    raise exception using errcode = '42501', message = 'SETTLEMENT_BRANCH_ACCESS_DENIED';
  end if;

  if v_command.id is not null then
    if v_command.status <> 'completed' or v_command.result is null then
      raise exception using errcode = '55000', message = 'SETTLEMENT_IDEMPOTENT_STATE_INCOMPLETE';
    end if;
    select payment.* into v_payment
    from public.obligation_settlements settlement
    join public.obligation_settlement_components component
      on component.settlement_id = settlement.id
     and component.tenant_id = settlement.tenant_id
     and component.component_position = 1
    join public.financial_payments payment
      on payment.id = component.payment_id and payment.tenant_id = component.tenant_id
    where settlement.command_id = v_command.id
      and settlement.tenant_id = v_tenant_id
      and settlement.target_type = v_target_type
      and settlement.target_id = v_target_id
      and settlement.amount = v_amount
      and settlement.status = 'recorded';
    if not found or v_payment.status <> 'confirmed'
       or v_payment.accounting_state <> 'posted'
       or v_payment.payment_purpose <> 'inbound_customer_unallocated' then
      raise exception using errcode = '55000', message = 'SETTLEMENT_IDEMPOTENT_STATE_INCOMPLETE';
    end if;
    select allocation.* into v_allocation
    from public.obligation_settlements settlement
    join public.obligation_settlement_components component
      on component.settlement_id = settlement.id
     and component.tenant_id = settlement.tenant_id
     and component.component_position = 1
    join public.financial_payment_allocations allocation
      on allocation.id = component.payment_allocation_id
     and allocation.tenant_id = component.tenant_id
    where settlement.command_id = v_command.id
      and settlement.tenant_id = v_tenant_id;
    if not found or v_allocation.status <> 'active'
       or v_allocation.amount <> v_amount
       or v_allocation.target_account_line_id <> v_target.obligation_account_line_id then
      raise exception using errcode = '55000', message = 'SETTLEMENT_IDEMPOTENT_STATE_INCOMPLETE';
    end if;
    return v_command.result || jsonb_build_object('idempotent_replay', true);
  end if;

  if v_target.outstanding_amount <= 0 then
    raise exception using errcode = '23514', message = 'OBLIGATION_ALREADY_SETTLED';
  end if;
  if v_amount > v_target.outstanding_amount then
    raise exception using errcode = '23514', message = 'SETTLEMENT_EXCEEDS_OUTSTANDING';
  end if;

  select method.* into v_method
  from public.financial_payment_methods method
  where method.id = p_payment_method_id
    and method.tenant_id = v_tenant_id
    and method.is_active
    and public.is_financial_payment_method_usable(v_tenant_id, method.id);
  if not found then
    raise exception using errcode = '23514', message = 'PAYMENT_METHOD_INVALID_OR_INACTIVE';
  end if;
  if v_method.requires_reference and v_reference is null then
    raise exception using errcode = '23514', message = 'PAYMENT_METHOD_REFERENCE_REQUIRED';
  end if;

  if v_method.settlement_mode = 'direct' then
    if p_money_destination_id is null then
      raise exception using errcode = '22023', message = 'SETTLEMENT_MONEY_DESTINATION_REQUIRED';
    end if;
    select destination.* into v_destination
    from public.money_destinations destination
    join public.financial_payment_method_destination_types compatibility
      on compatibility.method_type = v_method.method_type
     and compatibility.destination_type = destination.destination_type
    join public.account_accounts account
      on account.id = destination.ledger_account_id
     and account.tenant_id = destination.tenant_id
     and account.money_destination_id = destination.id
     and account.account_origin = 'resource'
     and account.active and account.is_posting
    join public.account_journals journal
      on journal.id = destination.journal_id
     and journal.tenant_id = destination.tenant_id
     and journal.money_destination_id = destination.id
     and journal.journal_origin = 'resource'
     and journal.default_account_id = account.id
     and journal.is_active
    where destination.id = p_money_destination_id
      and destination.tenant_id = v_tenant_id
      and destination.status = 'active'
      and (v_target.branch_id is null or destination.branch_id is null
        or destination.branch_id = v_target.branch_id)
      and public.has_money_destination_access(
        v_tenant_id, destination.id, 'initiate', v_target.branch_id
      );
    if not found then
      raise exception using errcode = '42501', message = 'SETTLEMENT_DESTINATION_NOT_ALLOWED';
    end if;
  elsif v_method.settlement_mode = 'clearing' then
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
       and journal.is_active and journal.default_account_id = account.id
      where configuration.tenant_id = v_tenant_id
        and configuration.payment_method_id = v_method.id
        and configuration.is_active
        and (configuration.branch_id is null
          or configuration.branch_id is not distinct from v_target.branch_id)
    ) then
      raise exception using errcode = '23514', message = 'PAYMENT_CLEARING_CONFIGURATION_UNAVAILABLE';
    end if;
  else
    raise exception using errcode = '23514', message = 'PAYMENT_SETTLEMENT_MODE_INVALID';
  end if;

  perform set_config('app.canonical_settlement_command', v_command_id::text, true);
  insert into public.obligation_settlement_commands (
    id, tenant_id, target_type, target_id, mechanism, amount,
    payment_method_id, money_destination_id, reference_number, notes,
    idempotency_key, request_fingerprint, created_by
  ) values (
    v_command_id, v_tenant_id, v_target_type, v_target_id, v_mechanism, v_amount,
    p_payment_method_id, p_money_destination_id, v_reference, v_notes,
    v_key, v_fingerprint, v_actor_id
  );

  v_payment_key := 'settlement:' || v_command_id::text || ':payment';
  v_allocation_key := 'settlement:' || v_command_id::text || ':allocation';
  v_create_result := public.create_financial_payment(
    v_tenant_id, 'inbound', v_amount, p_payment_method_id, v_payment_key,
    p_money_destination_id, v_target.currency_code, v_target.party_id,
    v_target.branch_id, v_reference, v_notes,
    'settlement', v_target_type, v_target_id
  );
  select payment.* into v_payment
  from public.financial_payments payment
  where payment.id = (v_create_result ->> 'payment_id')::uuid
    and payment.tenant_id = v_tenant_id;

  v_submit_result := public.submit_financial_payment(v_tenant_id, v_payment.id);
  if v_submit_result ->> 'status' = 'submitted' then
    perform public.confirm_financial_payment(v_tenant_id, v_payment.id);
  elsif v_submit_result ->> 'status' <> 'confirmed' then
    raise exception using errcode = '55000', message = 'SETTLEMENT_PAYMENT_CONFIRMATION_INCOMPLETE';
  end if;
  perform public.post_financial_payment(
    v_tenant_id, v_payment.id, 'inbound_customer_unallocated'
  );
  v_allocation_result := public.allocate_financial_payment(
    v_tenant_id, v_payment.id, v_target.obligation_account_line_id,
    v_amount, v_allocation_key
  );
  select allocation.* into v_allocation
  from public.financial_payment_allocations allocation
  where allocation.id = (v_allocation_result ->> 'allocation_id')::uuid
    and allocation.tenant_id = v_tenant_id;
  select line.amount_residual into v_residual_after
  from public.account_move_lines line
  where line.id = v_target.obligation_account_line_id
    and line.tenant_id = v_tenant_id;
  if v_residual_after <> round(v_target.outstanding_amount - v_amount, 2) then
    raise exception using errcode = '23514', message = 'SETTLEMENT_RESIDUAL_INTEGRITY_FAILURE';
  end if;

  insert into public.obligation_settlements (
    id, tenant_id, command_id, target_type, target_id, business_reference,
    party_id, branch_id, currency_code, amount,
    outstanding_before, outstanding_after, created_by
  ) values (
    v_settlement_id, v_tenant_id, v_command_id, v_target_type, v_target_id,
    v_target.business_reference, v_target.party_id, v_target.branch_id,
    v_target.currency_code, v_amount,
    v_target.outstanding_amount, v_residual_after, v_actor_id
  );
  insert into public.obligation_settlement_components (
    tenant_id, settlement_id, component_position, mechanism, amount,
    payment_method_id, money_destination_id, payment_id, payment_allocation_id
  ) values (
    v_tenant_id, v_settlement_id, 1, v_mechanism, v_amount,
    p_payment_method_id, p_money_destination_id, v_payment.id, v_allocation.id
  );
  insert into public.obligation_settlement_events (
    tenant_id, settlement_id, event_type, actor_id, payload
  ) values (
    v_tenant_id, v_settlement_id, 'obligation_settled', v_actor_id,
    jsonb_build_object(
      'target', jsonb_build_object('type', v_target_type, 'id', v_target_id,
        'reference', v_target.business_reference),
      'amount', v_amount,
      'currency_code', v_target.currency_code,
      'mechanism', v_mechanism,
      'reference_number', v_reference,
      'resulting_outstanding', v_residual_after
    )
  );

  select payment.* into v_payment
  from public.financial_payments payment
  where payment.id = v_payment.id and payment.tenant_id = v_tenant_id;
  v_result := jsonb_build_object(
    'success', true,
    'settlement_id', v_settlement_id,
    'target', jsonb_build_object('type', v_target_type, 'id', v_target_id,
      'reference', v_target.business_reference),
    'mechanism', v_mechanism,
    'amount', v_amount,
    'currency_code', v_target.currency_code,
    'outstanding_before', v_target.outstanding_amount,
    'outstanding_after', v_residual_after,
    'payment', jsonb_build_object(
      'number', v_payment.payment_number,
      'status', v_payment.status,
      'accounting_state', v_payment.accounting_state,
      'payment_method_id', p_payment_method_id,
      'money_destination_id', p_money_destination_id
    ),
    'idempotent_replay', false
  );
  update public.obligation_settlement_commands command set
    status = 'completed', result = v_result, completed_at = now()
  where command.id = v_command_id and command.tenant_id = v_tenant_id;
  perform set_config('app.canonical_settlement_command', '', true);
  return v_result;
exception when others then
  perform set_config('app.canonical_settlement_command', '', true);
  raise;
end
$$;

alter table public.settlement_mechanisms enable row level security;
alter table public.obligation_settlement_commands enable row level security;
alter table public.obligation_settlements enable row level security;
alter table public.obligation_settlement_components enable row level security;
alter table public.obligation_settlement_events enable row level security;

revoke all on table public.settlement_mechanisms,
  public.obligation_settlement_commands,
  public.obligation_settlements,
  public.obligation_settlement_components,
  public.obligation_settlement_events
from public, anon, authenticated, service_role;

revoke all on function public.settlement_request_fingerprint(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_settlement_target(uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.guard_obligation_settlement_command()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_obligation_settlement_fact()
  from public, anon, authenticated, service_role;
revoke all on function public.is_trusted_settlement_context(uuid,text,uuid,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_settlement_options(text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.settle_obligation(text,text,text,numeric,uuid,text,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_settlement_options(text,text) to authenticated;
grant execute on function public.settle_obligation(text,text,text,numeric,uuid,text,uuid,text,text)
  to authenticated;

comment on table public.obligation_settlements is
  'Generic immutable business settlement facts. Provider clearing batches remain in financial_settlements.';
comment on table public.obligation_settlement_components is
  'Mechanism components make future split settlements additive; Phase 5A records exactly one money_payment component per command.';
comment on function public.get_settlement_options(text,text) is
  'Business-safe generic settlement option reader. It exposes no account, journal, move, move-line or reconciliation identifiers.';
comment on function public.settle_obligation(text,text,text,numeric,uuid,text,uuid,text,text) is
  'Atomic idempotent generic obligation settlement command. Phase 5A supports one money_payment and internally reuses create, submit, confirm, post and allocate.';

commit;
