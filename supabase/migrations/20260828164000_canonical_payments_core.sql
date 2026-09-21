begin;

create table public.financial_payment_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sequence_year integer not null,
  next_number bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, sequence_year),
  constraint financial_payment_sequences_year_check check (sequence_year between 2000 and 9999),
  constraint financial_payment_sequences_next_check check (next_number > 0)
);

create table public.financial_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  payment_number text not null,
  direction text not null,
  amount numeric(18,2) not null,
  currency_code varchar(3) not null default 'EGP',
  payment_method_id uuid not null,
  money_destination_id uuid,
  partner_id uuid references public.partners(id) on delete restrict,
  branch_id uuid,
  status text not null default 'draft',
  reference_number text,
  notes text,
  source_app text,
  source_model text,
  source_id text,
  idempotency_key text not null,
  request_fingerprint text not null,
  created_by uuid not null,
  submitted_by uuid,
  submitted_at timestamptz,
  confirmed_by uuid,
  confirmed_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  reversed_by uuid,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_payments_method_fkey
    foreign key (payment_method_id, tenant_id)
    references public.financial_payment_methods(id, tenant_id) on delete restrict,
  constraint financial_payments_destination_fkey
    foreign key (money_destination_id, tenant_id)
    references public.money_destinations(id, tenant_id) on delete restrict,
  constraint financial_payments_branch_fkey
    foreign key (branch_id, tenant_id)
    references public.branches(id, tenant_id) on delete restrict,
  constraint financial_payments_created_by_fkey
    foreign key (created_by, tenant_id) references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_payments_submitted_by_fkey
    foreign key (submitted_by, tenant_id) references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_payments_confirmed_by_fkey
    foreign key (confirmed_by, tenant_id) references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_payments_rejected_by_fkey
    foreign key (rejected_by, tenant_id) references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_payments_reversed_by_fkey
    foreign key (reversed_by, tenant_id) references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_payments_tenant_number_key unique (tenant_id, payment_number),
  constraint financial_payments_tenant_idempotency_key unique (tenant_id, idempotency_key),
  constraint financial_payments_id_tenant_key unique (id, tenant_id),
  constraint financial_payments_direction_check check (direction in ('inbound', 'outbound')),
  constraint financial_payments_amount_check check (amount > 0),
  constraint financial_payments_currency_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint financial_payments_status_check
    check (status in ('draft', 'submitted', 'confirmed', 'rejected', 'reversed')),
  constraint financial_payments_number_format_check
    check (payment_number ~ '^PAY-[0-9]{4}-[0-9]{6,}$'),
  constraint financial_payments_idempotency_not_blank check (btrim(idempotency_key) <> ''),
  constraint financial_payments_fingerprint_format_check check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint financial_payments_source_context_check check (
    (source_app is null and source_model is null and source_id is null)
    or (source_app is not null and source_model is not null and source_id is not null
      and source_app ~ '^[a-z][a-z0-9_]*$'
      and source_model ~ '^[a-z][a-z0-9_]*$'
      and btrim(source_id) <> '')
  ),
  constraint financial_payments_lifecycle_consistency_check check (
    (status = 'draft' and submitted_at is null and confirmed_at is null and rejected_at is null and reversed_at is null)
    or (status = 'submitted' and submitted_at is not null and confirmed_at is null and rejected_at is null and reversed_at is null)
    or (status = 'confirmed' and submitted_at is not null and confirmed_at is not null and rejected_at is null and reversed_at is null)
    or (status = 'rejected' and submitted_at is not null and rejected_at is not null and confirmed_at is null and reversed_at is null and btrim(rejection_reason) <> '')
    or (status = 'reversed' and submitted_at is not null and confirmed_at is not null and reversed_at is not null and rejected_at is null and btrim(reversal_reason) <> '')
  )
);

create index financial_payments_query_idx on public.financial_payments
  (tenant_id, created_at desc, id desc);
create index financial_payments_status_idx on public.financial_payments
  (tenant_id, status, direction, created_at desc);
create index financial_payments_method_idx on public.financial_payments
  (tenant_id, payment_method_id, created_at desc);
create index financial_payments_destination_idx on public.financial_payments
  (tenant_id, money_destination_id, created_at desc) where money_destination_id is not null;
create index financial_payments_partner_idx on public.financial_payments
  (tenant_id, partner_id, created_at desc) where partner_id is not null;
create index financial_payments_branch_idx on public.financial_payments
  (tenant_id, branch_id, created_at desc) where branch_id is not null;
create index financial_payments_source_idx on public.financial_payments
  (tenant_id, source_app, source_model, source_id) where source_app is not null;

create table public.financial_payment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  payment_id uuid not null,
  event_type text not null,
  from_status text,
  to_status text not null,
  actor_user_id uuid not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint financial_payment_events_payment_fkey
    foreign key (payment_id, tenant_id)
    references public.financial_payments(id, tenant_id) on delete restrict,
  constraint financial_payment_events_actor_fkey
    foreign key (actor_user_id, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_payment_events_type_check
    check (event_type in ('created', 'submitted', 'confirmed', 'rejected', 'reversed')),
  constraint financial_payment_events_from_status_check
    check (from_status is null or from_status in ('draft', 'submitted', 'confirmed')),
  constraint financial_payment_events_to_status_check
    check (to_status in ('draft', 'submitted', 'confirmed', 'rejected', 'reversed')),
  constraint financial_payment_events_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index financial_payment_events_history_idx
  on public.financial_payment_events (tenant_id, payment_id, created_at, id);

create or replace function public.guard_financial_payment_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '23514', message = 'FINANCIAL_PAYMENT_DELETE_FORBIDDEN';
  end if;
  new.reference_number := nullif(btrim(new.reference_number), '');
  new.notes := nullif(btrim(new.notes), '');
  new.source_app := nullif(lower(btrim(new.source_app)), '');
  new.source_model := nullif(lower(btrim(new.source_model)), '');
  new.source_id := nullif(btrim(new.source_id), '');
  new.idempotency_key := btrim(new.idempotency_key);
  new.currency_code := upper(btrim(new.currency_code));
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id
       or new.payment_number is distinct from old.payment_number
       or new.idempotency_key is distinct from old.idempotency_key
       or new.request_fingerprint is distinct from old.request_fingerprint
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception using errcode = '23514', message = 'FINANCIAL_PAYMENT_IDENTITY_IMMUTABLE';
    end if;
    if old.status in ('confirmed', 'reversed') and (
      new.direction is distinct from old.direction or new.amount is distinct from old.amount
      or new.currency_code is distinct from old.currency_code
      or new.payment_method_id is distinct from old.payment_method_id
      or new.money_destination_id is distinct from old.money_destination_id
      or new.partner_id is distinct from old.partner_id
      or new.branch_id is distinct from old.branch_id
      or new.reference_number is distinct from old.reference_number
      or new.source_app is distinct from old.source_app
      or new.source_model is distinct from old.source_model
      or new.source_id is distinct from old.source_id
    ) then
      raise exception using errcode = '23514', message = 'CONFIRMED_FINANCIAL_PAYMENT_IMMUTABLE';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'draft' and new.status = 'submitted')
      or (old.status = 'submitted' and new.status in ('confirmed', 'rejected'))
      or (old.status = 'confirmed' and new.status = 'reversed')
    ) then
      raise exception using errcode = '23514', message = 'FINANCIAL_PAYMENT_STATE_TRANSITION_INVALID';
    end if;
  end if;
  if new.partner_id is not null and not exists (
    select 1 from public.partners partner
    where partner.id = new.partner_id and partner.tenant_id = new.tenant_id and partner.active
  ) then
    raise exception using errcode = '23514', message = 'FINANCIAL_PAYMENT_PARTNER_INVALID_OR_INACTIVE';
  end if;
  return new;
end
$$;

create trigger financial_payments_mutation_guard
before insert or update or delete on public.financial_payments
for each row execute function public.guard_financial_payment_mutation();

create or replace function public.guard_financial_payment_event_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception using errcode = '23514', message = 'FINANCIAL_PAYMENT_EVENT_IMMUTABLE';
end
$$;

create trigger financial_payment_events_immutable_guard
before update or delete on public.financial_payment_events
for each row execute function public.guard_financial_payment_event_mutation();

create or replace function public.next_financial_payment_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare current_year integer := extract(year from current_date)::integer; allocated bigint;
begin
  insert into public.financial_payment_sequences (tenant_id, sequence_year, next_number)
  values (p_tenant_id, current_year, 2)
  on conflict (tenant_id, sequence_year) do update
    set next_number = public.financial_payment_sequences.next_number + 1, updated_at = now()
  returning next_number - 1 into allocated;
  return 'PAY-' || current_year::text || '-' || lpad(allocated::text, 6, '0');
end
$$;

create or replace function public.financial_payment_request_fingerprint(
  p_direction text, p_amount numeric, p_currency_code text,
  p_payment_method_id uuid, p_money_destination_id uuid, p_partner_id uuid,
  p_branch_id uuid, p_reference_number text, p_notes text,
  p_source_app text, p_source_model text, p_source_id text
)
returns text
language sql immutable
set search_path = pg_catalog, public
as $$
  select encode(extensions.digest(jsonb_build_object(
    'direction', lower(btrim(p_direction)), 'amount', round(p_amount, 2),
    'currency_code', upper(btrim(coalesce(p_currency_code, 'EGP'))),
    'payment_method_id', p_payment_method_id, 'money_destination_id', p_money_destination_id,
    'partner_id', p_partner_id, 'branch_id', p_branch_id,
    'reference_number', nullif(btrim(p_reference_number), ''),
    'notes', nullif(btrim(p_notes), ''),
    'source_app', nullif(lower(btrim(p_source_app)), ''),
    'source_model', nullif(lower(btrim(p_source_model)), ''),
    'source_id', nullif(btrim(p_source_id), '')
  )::text, 'sha256'), 'hex')
$$;

create or replace function public.create_financial_payment(
  p_tenant_id uuid, p_direction text, p_amount numeric,
  p_payment_method_id uuid, p_idempotency_key text,
  p_money_destination_id uuid default null, p_currency_code text default 'EGP',
  p_partner_id uuid default null, p_branch_id uuid default null,
  p_reference_number text default null, p_notes text default null,
  p_source_app text default null, p_source_model text default null, p_source_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  method public.financial_payment_methods%rowtype;
  existing public.financial_payments%rowtype;
  actor_id uuid := public.current_tenant_user_id();
  selected_destination uuid := p_money_destination_id;
  selection jsonb;
  fingerprint text;
  payment_id uuid;
  payment_number text;
  has_direct_destination boolean;
begin
  perform public.assert_financial_authorized(p_tenant_id, 'financial.payment.create', null, null, p_branch_id, true);
  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception using errcode = '22023', message = 'FINANCIAL_PAYMENT_AMOUNT_MUST_BE_POSITIVE';
  end if;
  if lower(btrim(coalesce(p_direction, ''))) not in ('inbound', 'outbound') then
    raise exception using errcode = '22023', message = 'FINANCIAL_PAYMENT_DIRECTION_INVALID';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception using errcode = '22023', message = 'FINANCIAL_PAYMENT_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('financial_payment:' || p_tenant_id::text || ':' || btrim(p_idempotency_key), 0));
  fingerprint := public.financial_payment_request_fingerprint(
    p_direction, p_amount, p_currency_code, p_payment_method_id, p_money_destination_id,
    p_partner_id, p_branch_id, p_reference_number, p_notes, p_source_app, p_source_model, p_source_id
  );
  select * into existing from public.financial_payments payment
  where payment.tenant_id = p_tenant_id and payment.idempotency_key = btrim(p_idempotency_key);
  if found then
    if existing.request_fingerprint <> fingerprint then
      raise exception using errcode = '23505', message = 'FINANCIAL_PAYMENT_IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    return jsonb_build_object('payment_id', existing.id, 'payment_number', existing.payment_number,
      'status', existing.status, 'money_destination_id', existing.money_destination_id, 'idempotent_replay', true);
  end if;

  select * into method from public.financial_payment_methods candidate
  where candidate.id = p_payment_method_id and candidate.tenant_id = p_tenant_id and candidate.is_active;
  if not found then raise exception using errcode = '23514', message = 'PAYMENT_METHOD_INVALID_OR_INACTIVE'; end if;
  if method.requires_reference and nullif(btrim(coalesce(p_reference_number, '')), '') is null then
    raise exception using errcode = '23514', message = 'PAYMENT_METHOD_REFERENCE_REQUIRED';
  end if;
  select exists (select 1 from public.financial_payment_method_destination_types compatibility
    where compatibility.method_type = method.method_type) into has_direct_destination;

  if has_direct_destination then
    selection := public.get_payment_method_destination_selection(
      p_tenant_id, method.id, 'financial.payment.create', 'initiate', p_branch_id
    );
    if selected_destination is null then
      if (selection->>'allowed_count')::integer = 0 then
        raise exception using errcode = '42501', message = 'NO_ALLOWED_PAYMENT_DESTINATION';
      elsif (selection->>'allowed_count')::integer = 1 then
        selected_destination := (selection->>'auto_selected_destination_id')::uuid;
      else
        raise exception using errcode = '22023', message = 'PAYMENT_DESTINATION_SELECTION_REQUIRED';
      end if;
    elsif not exists (
      select 1 from public.list_allowed_payment_destinations(
        p_tenant_id, method.id, 'financial.payment.create', 'initiate', p_branch_id
      ) allowed where allowed.destination_id = selected_destination
    ) then
      raise exception using errcode = '42501', message = 'PAYMENT_DESTINATION_NOT_ALLOWED';
    end if;
  elsif selected_destination is not null then
    raise exception using errcode = '23514', message = 'PAYMENT_METHOD_DIRECT_DESTINATION_UNSUPPORTED';
  end if;

  payment_number := public.next_financial_payment_number(p_tenant_id);
  insert into public.financial_payments (
    tenant_id, payment_number, direction, amount, currency_code,
    payment_method_id, money_destination_id, partner_id, branch_id,
    reference_number, notes, source_app, source_model, source_id,
    idempotency_key, request_fingerprint, created_by
  ) values (
    p_tenant_id, payment_number, lower(btrim(p_direction)), round(p_amount, 2),
    upper(btrim(coalesce(p_currency_code, 'EGP'))), method.id, selected_destination,
    p_partner_id, p_branch_id, p_reference_number, p_notes,
    p_source_app, p_source_model, p_source_id,
    btrim(p_idempotency_key), fingerprint, actor_id
  ) returning id into payment_id;
  insert into public.financial_payment_events (
    tenant_id, payment_id, event_type, from_status, to_status, actor_user_id, metadata
  ) values (p_tenant_id, payment_id, 'created', null, 'draft', actor_id,
    jsonb_build_object('source_app', nullif(lower(btrim(p_source_app)), '')));
  return jsonb_build_object('payment_id', payment_id, 'payment_number', payment_number,
    'status', 'draft', 'money_destination_id', selected_destination, 'idempotent_replay', false);
end
$$;

create or replace function public.submit_financial_payment(p_tenant_id uuid, p_payment_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare payment public.financial_payments%rowtype; method public.financial_payment_methods%rowtype;
  actor_id uuid := public.current_tenant_user_id(); can_auto_confirm boolean := false;
  has_direct_destination boolean;
begin
  perform public.assert_financial_authorized(p_tenant_id, 'financial.payment.submit', null, null, null, true);
  select * into payment from public.financial_payments item
  where item.id = p_payment_id and item.tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode='P0002', message='FINANCIAL_PAYMENT_NOT_FOUND'; end if;
  if payment.status <> 'draft' then raise exception using errcode='23514', message='FINANCIAL_PAYMENT_SUBMIT_STATE_INVALID'; end if;
  select * into method from public.financial_payment_methods item
  where item.id=payment.payment_method_id and item.tenant_id=p_tenant_id and item.is_active;
  if not found then raise exception using errcode='23514', message='PAYMENT_METHOD_INVALID_OR_INACTIVE'; end if;
  if method.requires_reference and payment.reference_number is null then
    raise exception using errcode='23514', message='PAYMENT_METHOD_REFERENCE_REQUIRED';
  end if;
  select exists(select 1 from public.financial_payment_method_destination_types c where c.method_type=method.method_type)
  into has_direct_destination;
  if has_direct_destination and (payment.money_destination_id is null or not exists (
    select 1 from public.list_allowed_payment_destinations(
      p_tenant_id, method.id, 'financial.payment.submit', 'initiate', payment.branch_id
    ) allowed where allowed.destination_id=payment.money_destination_id
  )) then raise exception using errcode='42501', message='PAYMENT_DESTINATION_NOT_ALLOWED'; end if;

  update public.financial_payments set status='submitted', submitted_by=actor_id, submitted_at=now()
  where id=payment.id;
  insert into public.financial_payment_events(tenant_id,payment_id,event_type,from_status,to_status,actor_user_id)
  values(p_tenant_id,payment.id,'submitted','draft','submitted',actor_id);

  can_auto_confirm := not method.requires_confirmation and has_direct_destination
    and public.has_permission('financial.payment.confirm', p_tenant_id)
    and exists(select 1 from public.list_allowed_payment_destinations(
      p_tenant_id, method.id, 'financial.payment.confirm', 'confirm', payment.branch_id
    ) allowed where allowed.destination_id=payment.money_destination_id);
  if can_auto_confirm then
    update public.financial_payments set status='confirmed', confirmed_by=actor_id, confirmed_at=now()
    where id=payment.id;
    insert into public.financial_payment_events(tenant_id,payment_id,event_type,from_status,to_status,actor_user_id,metadata)
    values(p_tenant_id,payment.id,'confirmed','submitted','confirmed',actor_id,jsonb_build_object('automatic',true));
    return jsonb_build_object('payment_id',payment.id,'status','confirmed','auto_confirmed',true);
  end if;
  return jsonb_build_object('payment_id',payment.id,'status','submitted','auto_confirmed',false,
    'confirmation_required',method.requires_confirmation,'direct_settlement_supported',has_direct_destination);
end
$$;

create or replace function public.confirm_financial_payment(p_tenant_id uuid, p_payment_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare payment public.financial_payments%rowtype; method public.financial_payment_methods%rowtype;
  actor_id uuid := public.current_tenant_user_id();
begin
  select * into payment from public.financial_payments item
  where item.id=p_payment_id and item.tenant_id=p_tenant_id for update;
  if not found then raise exception using errcode='P0002', message='FINANCIAL_PAYMENT_NOT_FOUND'; end if;
  perform public.assert_financial_authorized(p_tenant_id,'financial.payment.confirm',null,null,payment.branch_id,payment.status='submitted');
  if payment.status <> 'submitted' then raise exception using errcode='23514', message='FINANCIAL_PAYMENT_CONFIRM_STATE_INVALID'; end if;
  select * into method from public.financial_payment_methods item
  where item.id=payment.payment_method_id and item.tenant_id=p_tenant_id and item.is_active;
  if not found then raise exception using errcode='23514', message='PAYMENT_METHOD_INVALID_OR_INACTIVE'; end if;
  if method.requires_reference and payment.reference_number is null then raise exception using errcode='23514', message='PAYMENT_METHOD_REFERENCE_REQUIRED'; end if;
  if payment.money_destination_id is null or not exists (
    select 1 from public.list_allowed_payment_destinations(
      p_tenant_id,method.id,'financial.payment.confirm','confirm',payment.branch_id
    ) allowed where allowed.destination_id=payment.money_destination_id
  ) then raise exception using errcode='42501', message='PAYMENT_METHOD_REQUIRES_UNAVAILABLE_SETTLEMENT_OR_DESTINATION'; end if;
  update public.financial_payments set status='confirmed',confirmed_by=actor_id,confirmed_at=now() where id=payment.id;
  insert into public.financial_payment_events(tenant_id,payment_id,event_type,from_status,to_status,actor_user_id)
  values(p_tenant_id,payment.id,'confirmed','submitted','confirmed',actor_id);
  return jsonb_build_object('payment_id',payment.id,'status','confirmed');
end
$$;

create or replace function public.reject_financial_payment(p_tenant_id uuid,p_payment_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare payment public.financial_payments%rowtype; actor_id uuid:=public.current_tenant_user_id(); reason text:=nullif(btrim(p_reason),'');
begin
  select * into payment from public.financial_payments item where item.id=p_payment_id and item.tenant_id=p_tenant_id for update;
  if not found then raise exception using errcode='P0002',message='FINANCIAL_PAYMENT_NOT_FOUND'; end if;
  perform public.assert_financial_authorized(p_tenant_id,'financial.payment.reject',null,null,payment.branch_id,payment.status='submitted');
  if payment.status<>'submitted' then raise exception using errcode='23514',message='FINANCIAL_PAYMENT_REJECT_STATE_INVALID'; end if;
  if reason is null then raise exception using errcode='22023',message='FINANCIAL_PAYMENT_REJECTION_REASON_REQUIRED'; end if;
  update public.financial_payments set status='rejected',rejected_by=actor_id,rejected_at=now(),rejection_reason=reason where id=payment.id;
  insert into public.financial_payment_events(tenant_id,payment_id,event_type,from_status,to_status,actor_user_id,reason)
  values(p_tenant_id,payment.id,'rejected','submitted','rejected',actor_id,reason);
  return jsonb_build_object('payment_id',payment.id,'status','rejected');
end
$$;

create or replace function public.reverse_financial_payment(p_tenant_id uuid,p_payment_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare payment public.financial_payments%rowtype; actor_id uuid:=public.current_tenant_user_id(); reason text:=nullif(btrim(p_reason),'');
begin
  select * into payment from public.financial_payments item where item.id=p_payment_id and item.tenant_id=p_tenant_id for update;
  if not found then raise exception using errcode='P0002',message='FINANCIAL_PAYMENT_NOT_FOUND'; end if;
  perform public.assert_financial_authorized(p_tenant_id,'financial.payment.reverse',null,null,payment.branch_id,payment.status='confirmed');
  if payment.status<>'confirmed' then raise exception using errcode='23514',message='FINANCIAL_PAYMENT_REVERSE_STATE_INVALID'; end if;
  if reason is null then raise exception using errcode='22023',message='FINANCIAL_PAYMENT_REVERSAL_REASON_REQUIRED'; end if;
  update public.financial_payments set status='reversed',reversed_by=actor_id,reversed_at=now(),reversal_reason=reason where id=payment.id;
  insert into public.financial_payment_events(tenant_id,payment_id,event_type,from_status,to_status,actor_user_id,reason)
  values(p_tenant_id,payment.id,'reversed','confirmed','reversed',actor_id,reason);
  return jsonb_build_object('payment_id',payment.id,'status','reversed','ledger_effect',false);
end
$$;

create or replace function public.get_financial_payment(p_tenant_id uuid,p_payment_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('payment',to_jsonb(payment),'events',coalesce((
    select jsonb_agg(to_jsonb(event) order by event.created_at,event.id)
    from public.financial_payment_events event where event.payment_id=payment.id and event.tenant_id=payment.tenant_id
  ),'[]'::jsonb))
  from public.financial_payments payment
  where payment.id=p_payment_id and payment.tenant_id=p_tenant_id
    and public.current_tenant_id()=p_tenant_id
    and (public.has_permission('financial.payment.create',p_tenant_id)
      or public.has_permission('financial.payment.submit',p_tenant_id)
      or public.has_permission('financial.payment.confirm',p_tenant_id)
      or public.has_permission('financial.payment.reject',p_tenant_id)
      or public.has_permission('financial.payment.reverse',p_tenant_id))
$$;

create or replace function public.list_financial_payments(
  p_tenant_id uuid,p_status text default null,p_direction text default null,
  p_payment_method_id uuid default null,p_money_destination_id uuid default null,
  p_partner_id uuid default null,p_branch_id uuid default null,
  p_source_app text default null,p_source_model text default null,p_source_id text default null,
  p_payment_number text default null,p_created_from timestamptz default null,p_created_to timestamptz default null,
  p_created_by uuid default null,p_limit integer default 50,p_offset integer default 0
)
returns setof public.financial_payments
language sql stable security definer set search_path=pg_catalog,public as $$
  select payment.* from public.financial_payments payment
  where payment.tenant_id=p_tenant_id and public.current_tenant_id()=p_tenant_id
    and (public.has_permission('financial.payment.create',p_tenant_id)
      or public.has_permission('financial.payment.submit',p_tenant_id)
      or public.has_permission('financial.payment.confirm',p_tenant_id)
      or public.has_permission('financial.payment.reject',p_tenant_id)
      or public.has_permission('financial.payment.reverse',p_tenant_id))
    and (p_status is null or payment.status=p_status)
    and (p_direction is null or payment.direction=p_direction)
    and (p_payment_method_id is null or payment.payment_method_id=p_payment_method_id)
    and (p_money_destination_id is null or payment.money_destination_id=p_money_destination_id)
    and (p_partner_id is null or payment.partner_id=p_partner_id)
    and (p_branch_id is null or payment.branch_id=p_branch_id)
    and (p_source_app is null or payment.source_app=p_source_app)
    and (p_source_model is null or payment.source_model=p_source_model)
    and (p_source_id is null or payment.source_id=p_source_id)
    and (p_payment_number is null or payment.payment_number=p_payment_number)
    and (p_created_from is null or payment.created_at>=p_created_from)
    and (p_created_to is null or payment.created_at<p_created_to)
    and (p_created_by is null or payment.created_by=p_created_by)
  order by payment.created_at desc,payment.id desc
  limit least(greatest(coalesce(p_limit,50),1),100) offset greatest(coalesce(p_offset,0),0)
$$;

alter table public.financial_payment_sequences enable row level security;
alter table public.financial_payments enable row level security;
alter table public.financial_payment_events enable row level security;
revoke all on public.financial_payment_sequences from public,anon,authenticated;
revoke all on public.financial_payments from public,anon,authenticated;
revoke all on public.financial_payment_events from public,anon,authenticated;
grant select on public.financial_payments to authenticated;
grant select on public.financial_payment_events to authenticated;

create policy financial_payments_read on public.financial_payments for select to authenticated using (
  tenant_id=public.current_tenant_id() and (
    public.has_permission('financial.payment.create',tenant_id)
    or public.has_permission('financial.payment.submit',tenant_id)
    or public.has_permission('financial.payment.confirm',tenant_id)
    or public.has_permission('financial.payment.reject',tenant_id)
    or public.has_permission('financial.payment.reverse',tenant_id)
  )
);
create policy financial_payment_events_read on public.financial_payment_events for select to authenticated using (
  financial_payment_events.tenant_id=public.current_tenant_id() and exists(
    select 1 from public.financial_payments payment
    where payment.id=financial_payment_events.payment_id
      and payment.tenant_id=financial_payment_events.tenant_id
  )
);

revoke all on function public.next_financial_payment_number(uuid) from public,anon,authenticated;
revoke all on function public.financial_payment_request_fingerprint(text,numeric,text,uuid,uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.create_financial_payment(uuid,text,numeric,uuid,text,uuid,text,uuid,uuid,text,text,text,text,text) from public,anon;
revoke all on function public.submit_financial_payment(uuid,uuid) from public,anon;
revoke all on function public.confirm_financial_payment(uuid,uuid) from public,anon;
revoke all on function public.reject_financial_payment(uuid,uuid,text) from public,anon;
revoke all on function public.reverse_financial_payment(uuid,uuid,text) from public,anon;
revoke all on function public.get_financial_payment(uuid,uuid) from public,anon;
revoke all on function public.list_financial_payments(uuid,text,text,uuid,uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz,uuid,integer,integer) from public,anon;
grant execute on function public.create_financial_payment(uuid,text,numeric,uuid,text,uuid,text,uuid,uuid,text,text,text,text,text) to authenticated;
grant execute on function public.submit_financial_payment(uuid,uuid) to authenticated;
grant execute on function public.confirm_financial_payment(uuid,uuid) to authenticated;
grant execute on function public.reject_financial_payment(uuid,uuid,text) to authenticated;
grant execute on function public.reverse_financial_payment(uuid,uuid,text) to authenticated;
grant execute on function public.get_financial_payment(uuid,uuid) to authenticated;
grant execute on function public.list_financial_payments(uuid,text,text,uuid,uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz,uuid,integer,integer) to authenticated;

comment on table public.financial_payments is
  'Phase 4B canonical payment lifecycle. Confirmation records an operational financial fact only; it deliberately creates no ledger move, allocation or reconciliation.';
comment on column public.financial_payments.source_id is
  'Opaque structured source identifier paired with source_app and source_model; it is not a foreign key to an operational application.';
comment on function public.reverse_financial_payment(uuid,uuid,text) is
  'Phase 4B lifecycle reversal only. No refund, cash movement or accounting reversal is created.';

commit;
