begin;

alter table public.financial_payment_method_types
  add column if not exists settings_enabled boolean not null default true;

update public.financial_payment_method_types
set is_active = false,
    settings_enabled = false
where code = 'cheque';

update public.financial_payment_method_types
set settings_enabled = false
where code = 'other';

update public.financial_payment_method_types
set settings_enabled = true
where code in ('cash', 'bank_transfer', 'wallet', 'card');

create table if not exists public.financial_payment_method_creation_requests (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  idempotency_key text not null,
  request_fingerprint text not null,
  payment_method_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, idempotency_key),
  foreign key (payment_method_id, tenant_id)
    references public.financial_payment_methods(id, tenant_id) on delete restrict,
  constraint financial_payment_method_creation_key_not_blank
    check (btrim(idempotency_key) <> ''),
  constraint financial_payment_method_creation_fingerprint_format
    check (request_fingerprint ~ '^[0-9a-f]{64}$')
);

create table if not exists public.financial_payment_method_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  payment_method_id uuid not null,
  event_type text not null,
  from_active boolean,
  to_active boolean,
  actor_user_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (payment_method_id, tenant_id)
    references public.financial_payment_methods(id, tenant_id) on delete restrict,
  foreign key (actor_user_id, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_payment_method_events_type_check
    check (event_type in ('created', 'renamed', 'deactivated', 'reactivated')),
  constraint financial_payment_method_events_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists financial_payment_method_events_method_idx
  on public.financial_payment_method_events (tenant_id, payment_method_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'financial_payment_methods_canonical_settlement_mode_check'
      and conrelid = 'public.financial_payment_methods'::regclass
  ) then
    alter table public.financial_payment_methods
      add constraint financial_payment_methods_canonical_settlement_mode_check check (
        (method_type in ('cash', 'bank_transfer', 'wallet') and settlement_mode = 'direct')
        or (method_type in ('card', 'other') and settlement_mode = 'clearing')
        or (method_type = 'cheque' and is_active = false)
      ) not valid;
  end if;
end
$$;

alter table public.financial_payment_methods
  validate constraint financial_payment_methods_canonical_settlement_mode_check;

create or replace function public.validate_financial_payment_method()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.name := btrim(new.name);
  new.semantic_key := lower(btrim(new.semantic_key));
  new.updated_at := now();
  if not exists (
    select 1 from public.financial_payment_method_types definition
    where definition.code = new.method_type and definition.is_active
  ) then
    raise exception using errcode = '23514', message = 'PAYMENT_METHOD_TYPE_INVALID_OR_INACTIVE';
  end if;
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception using errcode = '23514', message = 'PAYMENT_METHOD_TENANT_IMMUTABLE';
    end if;
    if new.semantic_key is distinct from old.semantic_key
       or new.method_type is distinct from old.method_type
       or new.settlement_mode is distinct from old.settlement_mode then
      raise exception using errcode = '23514', message = 'PAYMENT_METHOD_STRUCTURE_IMMUTABLE';
    end if;
  end if;
  return new;
end
$$;

create or replace function public.is_financial_payment_method_usable(
  p_tenant_id uuid,
  p_payment_method_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.financial_payment_methods method
    where method.id = p_payment_method_id
      and method.tenant_id = p_tenant_id
      and public.current_tenant_id() = p_tenant_id
      and method.is_active
      and (
        (
          method.settlement_mode = 'direct'
          and method.method_type in ('cash', 'bank_transfer', 'wallet')
          and exists (
            select 1
            from public.money_destinations destination
            join public.financial_payment_method_destination_types compatibility
              on compatibility.method_type = method.method_type
             and compatibility.destination_type = destination.destination_type
            join public.account_accounts account
              on account.id = destination.ledger_account_id
             and account.tenant_id = destination.tenant_id
             and account.money_destination_id = destination.id
             and account.active and account.is_posting
            join public.account_journals journal
              on journal.id = destination.journal_id
             and journal.tenant_id = destination.tenant_id
             and journal.money_destination_id = destination.id
             and journal.default_account_id = account.id
             and journal.is_active
            where destination.tenant_id = method.tenant_id
              and destination.status = 'active'
          )
        )
        or (
          method.settlement_mode = 'clearing'
          and method.method_type in ('card', 'other')
          and exists (
            select 1
            from public.financial_payment_method_settlement_configs configuration
            join public.account_accounts account
              on account.id = configuration.clearing_account_id
             and account.tenant_id = configuration.tenant_id
             and account.active and account.is_posting and account.open_item_reconcile
             and account.canonical_account_type in ('current_asset', 'receivable')
             and account.reporting_category = 'other_receivables'
            join public.account_journals journal
              on journal.id = configuration.clearing_journal_id
             and journal.tenant_id = configuration.tenant_id
             and journal.default_account_id = account.id
             and journal.is_active
            where configuration.tenant_id = method.tenant_id
              and configuration.payment_method_id = method.id
              and configuration.is_active
          )
        )
      )
  )
$$;

create or replace function public.list_financial_payment_method_clearing_options(
  p_tenant_id uuid
)
returns table (
  configuration_key text,
  clearing_account_label text,
  clearing_journal_label text,
  settlement_destination_type text,
  settlement_destination_label text,
  branch_id uuid,
  branch_label text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    encode(extensions.digest(
      concat_ws(':', p_tenant_id::text, account.id::text, journal.id::text,
        target.destination_type, coalesce(journal.branch_id::text, 'tenant')), 'sha256'
    ), 'hex') as configuration_key,
    account.name as clearing_account_label,
    journal.name as clearing_journal_label,
    target.destination_type,
    target.destination_label,
    journal.branch_id,
    branch.name as branch_label
  from public.account_accounts account
  join public.account_journals journal
    on journal.tenant_id = account.tenant_id
   and journal.default_account_id = account.id
   and journal.is_active
  left join public.branches branch
    on branch.id = journal.branch_id and branch.tenant_id = journal.tenant_id
  cross join (values ('bank'::text, 'حساب بنكي'::text), ('wallet'::text, 'محفظة'::text))
    target(destination_type, destination_label)
  where account.tenant_id = p_tenant_id
    and public.current_tenant_id() = p_tenant_id
    and public.has_permission('financial.payment_method.manage', p_tenant_id)
    and account.active and account.is_posting and account.open_item_reconcile
    and account.canonical_account_type in ('current_asset', 'receivable')
    and account.reporting_category = 'other_receivables'
    and exists (
      select 1 from public.money_destinations destination
      where destination.tenant_id = p_tenant_id
        and destination.destination_type = target.destination_type
        and destination.status = 'active'
        and (journal.branch_id is null or destination.branch_id is null
          or destination.branch_id = journal.branch_id)
    )
  order by branch.name nulls first, account.name, journal.name, target.destination_type
$$;

create or replace function public.list_financial_payment_methods_for_settings(
  p_tenant_id uuid
)
returns table (
  payment_method_id uuid,
  payment_method_name text,
  method_type text,
  settlement_mode text,
  is_active boolean,
  is_usable boolean,
  configuration_summary text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select method.id, method.name, method.method_type, method.settlement_mode,
    method.is_active,
    public.is_financial_payment_method_usable(method.tenant_id, method.id),
    case
      when method.settlement_mode = 'direct' then concat(
        (select count(*) from public.money_destinations destination
          join public.financial_payment_method_destination_types compatibility
            on compatibility.method_type = method.method_type
           and compatibility.destination_type = destination.destination_type
          where destination.tenant_id = method.tenant_id and destination.status = 'active'),
        ' compatible destinations'
      )
      else coalesce((select account.name || ' — ' || journal.name
        from public.financial_payment_method_settlement_configs configuration
        join public.account_accounts account on account.id = configuration.clearing_account_id
          and account.tenant_id = configuration.tenant_id
        join public.account_journals journal on journal.id = configuration.clearing_journal_id
          and journal.tenant_id = configuration.tenant_id
        where configuration.tenant_id = method.tenant_id
          and configuration.payment_method_id = method.id and configuration.is_active
        limit 1), 'Clearing configuration missing')
    end
  from public.financial_payment_methods method
  where method.tenant_id = p_tenant_id
    and public.current_tenant_id() = p_tenant_id
    and public.has_permission('financial.payment_method.manage', p_tenant_id)
  order by method.name, method.id
$$;

create or replace function public.create_financial_payment_method_for_settings(
  p_tenant_id uuid,
  p_name text,
  p_method_type text,
  p_settlement_mode text,
  p_idempotency_key text,
  p_clearing_configuration_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := public.current_tenant_user_id();
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_type text := lower(btrim(coalesce(p_method_type, '')));
  normalized_mode text := lower(btrim(coalesce(p_settlement_mode, '')));
  normalized_key text := btrim(coalesce(p_idempotency_key, ''));
  fingerprint text;
  semantic_identity text;
  existing_request public.financial_payment_method_creation_requests%rowtype;
  saved_method_id uuid;
  clearing record;
begin
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.payment_method.manage', null, null, null, true
  );
  if normalized_name = '' then
    raise exception using errcode = '22023', message = 'PAYMENT_METHOD_NAME_REQUIRED';
  end if;
  if normalized_key = '' or length(normalized_key) > 200 then
    raise exception using errcode = '22023', message = 'PAYMENT_METHOD_IDEMPOTENCY_KEY_INVALID';
  end if;
  if not exists (
    select 1 from public.financial_payment_method_types definition
    where definition.code = normalized_type and definition.is_active
      and definition.settings_enabled
  ) then
    raise exception using errcode = '23514', message = 'PAYMENT_METHOD_TYPE_NOT_AVAILABLE_IN_SETTINGS';
  end if;
  if (normalized_type in ('cash', 'bank_transfer', 'wallet') and normalized_mode <> 'direct')
     or (normalized_type = 'card' and normalized_mode <> 'clearing') then
    raise exception using errcode = '23514', message = 'PAYMENT_METHOD_SETTLEMENT_MODE_INVALID';
  end if;
  if normalized_mode = 'direct' and nullif(btrim(coalesce(p_clearing_configuration_key, '')), '') is not null then
    raise exception using errcode = '23514', message = 'DIRECT_PAYMENT_METHOD_MUST_NOT_HAVE_CLEARING_CONFIGURATION';
  end if;

  fingerprint := encode(extensions.digest(jsonb_build_object(
    'name', normalized_name,
    'method_type', normalized_type,
    'settlement_mode', normalized_mode,
    'clearing_configuration_key', nullif(btrim(coalesce(p_clearing_configuration_key, '')), '')
  )::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'financial_payment_method_settings_create:' || p_tenant_id::text || ':' || normalized_key, 0
  ));

  select * into existing_request
  from public.financial_payment_method_creation_requests
  where tenant_id = p_tenant_id and idempotency_key = normalized_key;
  if found then
    if existing_request.request_fingerprint <> fingerprint then
      raise exception using errcode = '23505', message = 'PAYMENT_METHOD_IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    return jsonb_build_object(
      'payment_method_id', existing_request.payment_method_id,
      'idempotent_replay', true
    );
  end if;

  if normalized_mode = 'direct' and not exists (
    select 1
    from public.money_destinations destination
    join public.financial_payment_method_destination_types compatibility
      on compatibility.method_type = normalized_type
     and compatibility.destination_type = destination.destination_type
    join public.account_accounts account
      on account.id = destination.ledger_account_id and account.tenant_id = destination.tenant_id
     and account.money_destination_id = destination.id and account.active and account.is_posting
    join public.account_journals journal
      on journal.id = destination.journal_id and journal.tenant_id = destination.tenant_id
     and journal.money_destination_id = destination.id and journal.default_account_id = account.id
     and journal.is_active
    where destination.tenant_id = p_tenant_id and destination.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'PAYMENT_METHOD_COMPATIBLE_DESTINATION_REQUIRED';
  end if;

  if normalized_mode = 'clearing' then
    select account.id clearing_account_id, journal.id clearing_journal_id,
      journal.branch_id, target.destination_type
    into clearing
    from public.account_accounts account
    join public.account_journals journal
      on journal.tenant_id = account.tenant_id
     and journal.default_account_id = account.id and journal.is_active
    cross join (values ('bank'::text), ('wallet'::text)) target(destination_type)
    where account.tenant_id = p_tenant_id
      and account.active and account.is_posting and account.open_item_reconcile
      and account.canonical_account_type in ('current_asset', 'receivable')
      and account.reporting_category = 'other_receivables'
      and encode(extensions.digest(concat_ws(':', p_tenant_id::text, account.id::text,
        journal.id::text, target.destination_type,
        coalesce(journal.branch_id::text, 'tenant')), 'sha256'), 'hex') = p_clearing_configuration_key
      and exists (
        select 1 from public.money_destinations destination
        where destination.tenant_id = p_tenant_id
          and destination.destination_type = target.destination_type
          and destination.status = 'active'
          and (journal.branch_id is null or destination.branch_id is null
            or destination.branch_id = journal.branch_id)
      )
    limit 1;
    if not found then
      raise exception using errcode = '23514', message = 'PAYMENT_METHOD_CLEARING_CONFIGURATION_INVALID';
    end if;
  end if;

  semantic_identity := 'payment_method_' || substr(encode(extensions.digest(
    p_tenant_id::text || ':' || normalized_key, 'sha256'
  ), 'hex'), 1, 40);
  insert into public.financial_payment_methods (
    tenant_id, name, semantic_key, method_type, settlement_mode, is_active,
    requires_reference, requires_confirmation, metadata, created_by
  )
  select p_tenant_id, normalized_name, semantic_identity, definition.code,
    normalized_mode, true, definition.default_requires_reference,
    definition.default_requires_confirmation, '{}'::jsonb, actor_id
  from public.financial_payment_method_types definition
  where definition.code = normalized_type
  returning id into saved_method_id;

  if normalized_mode = 'clearing' then
    insert into public.financial_payment_method_settlement_configs (
      tenant_id, payment_method_id, clearing_account_id, clearing_journal_id,
      fee_account_id, destination_type, branch_id, is_active, created_by
    ) values (
      p_tenant_id, saved_method_id, clearing.clearing_account_id,
      clearing.clearing_journal_id, null, clearing.destination_type,
      clearing.branch_id, true, actor_id
    );
  end if;

  insert into public.financial_payment_method_creation_requests (
    tenant_id, idempotency_key, request_fingerprint, payment_method_id
  ) values (p_tenant_id, normalized_key, fingerprint, saved_method_id);
  insert into public.financial_payment_method_events (
    tenant_id, payment_method_id, event_type, to_active, actor_user_id, metadata
  ) values (
    p_tenant_id, saved_method_id, 'created', true, actor_id,
    jsonb_build_object('method_type', normalized_type, 'settlement_mode', normalized_mode)
  );
  return jsonb_build_object('payment_method_id', saved_method_id, 'idempotent_replay', false);
end
$$;

create or replace function public.rename_financial_payment_method(
  p_tenant_id uuid,
  p_payment_method_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := public.current_tenant_user_id();
  method public.financial_payment_methods%rowtype;
  normalized_name text := btrim(coalesce(p_name, ''));
begin
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.payment_method.manage', null, null, null, true
  );
  if normalized_name = '' then
    raise exception using errcode = '22023', message = 'PAYMENT_METHOD_NAME_REQUIRED';
  end if;
  select * into method from public.financial_payment_methods
  where id = p_payment_method_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PAYMENT_METHOD_NOT_FOUND'; end if;
  update public.financial_payment_methods set name = normalized_name where id = method.id;
  insert into public.financial_payment_method_events (
    tenant_id, payment_method_id, event_type, actor_user_id, metadata
  ) values (
    p_tenant_id, method.id, 'renamed', actor_id,
    jsonb_build_object('old_name', method.name, 'new_name', normalized_name)
  );
  return jsonb_build_object('payment_method_id', method.id, 'name', normalized_name);
end
$$;

create or replace function public.set_financial_payment_method_status(
  p_tenant_id uuid,
  p_payment_method_id uuid,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := public.current_tenant_user_id();
  method public.financial_payment_methods%rowtype;
begin
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.payment_method.manage', null, null, null, true
  );
  if p_is_active is null then
    raise exception using errcode = '22023', message = 'PAYMENT_METHOD_STATUS_REQUIRED';
  end if;
  select * into method from public.financial_payment_methods
  where id = p_payment_method_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PAYMENT_METHOD_NOT_FOUND'; end if;
  if method.is_active = p_is_active then
    return jsonb_build_object('payment_method_id', method.id, 'is_active', method.is_active, 'changed', false);
  end if;
  if p_is_active then
    update public.financial_payment_methods set is_active = true where id = method.id;
    if not public.is_financial_payment_method_usable(p_tenant_id, method.id) then
      raise exception using errcode = '23514', message = 'PAYMENT_METHOD_CONFIGURATION_NOT_USABLE';
    end if;
  else
    update public.financial_payment_methods set is_active = false where id = method.id;
  end if;
  insert into public.financial_payment_method_events (
    tenant_id, payment_method_id, event_type, from_active, to_active,
    actor_user_id, metadata
  ) values (
    p_tenant_id, method.id,
    case when p_is_active then 'reactivated' else 'deactivated' end,
    method.is_active, p_is_active, actor_id, '{}'::jsonb
  );
  return jsonb_build_object('payment_method_id', method.id, 'is_active', p_is_active, 'changed', true);
end
$$;

alter table public.financial_payment_method_creation_requests enable row level security;
alter table public.financial_payment_method_events enable row level security;
revoke all on public.financial_payment_method_creation_requests from public, anon, authenticated;
revoke all on public.financial_payment_method_events from public, anon, authenticated;
grant select on public.financial_payment_method_events to authenticated;

create policy financial_payment_method_events_read
on public.financial_payment_method_events for select to authenticated
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('financial.payment_method.manage', tenant_id)
);

revoke all on function public.is_financial_payment_method_usable(uuid,uuid) from public, anon;
revoke all on function public.list_financial_payment_method_clearing_options(uuid) from public, anon;
revoke all on function public.list_financial_payment_methods_for_settings(uuid) from public, anon;
revoke all on function public.create_financial_payment_method_for_settings(uuid,text,text,text,text,text) from public, anon;
revoke all on function public.rename_financial_payment_method(uuid,uuid,text) from public, anon;
revoke all on function public.set_financial_payment_method_status(uuid,uuid,boolean) from public, anon;
grant execute on function public.is_financial_payment_method_usable(uuid,uuid) to authenticated;
grant execute on function public.list_financial_payment_method_clearing_options(uuid) to authenticated;
grant execute on function public.list_financial_payment_methods_for_settings(uuid) to authenticated;
grant execute on function public.create_financial_payment_method_for_settings(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.rename_financial_payment_method(uuid,uuid,text) to authenticated;
grant execute on function public.set_financial_payment_method_status(uuid,uuid,boolean) to authenticated;

comment on function public.list_financial_payment_method_clearing_options(uuid) is
  'Settings-safe clearing choices. Returns business labels and an opaque configuration key; never account or journal identifiers.';
comment on function public.create_financial_payment_method_for_settings(uuid,text,text,text,text,text) is
  'Atomic idempotent Settings command. Direct methods own no destination; clearing methods resolve an opaque validated configuration key.';
comment on function public.set_financial_payment_method_status(uuid,uuid,boolean) is
  'Non-destructive payment-method lifecycle command; reactivation fails closed unless canonical configuration is usable.';

commit;
