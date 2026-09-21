begin;

create table public.financial_engine_bindings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  source_app text not null,
  source_model text not null,
  source_id text not null,
  financial_event_version integer not null,
  financial_engine text not null,
  state text not null default 'acquired',
  canonical_sale_posting_id uuid,
  legacy_move_id uuid,
  acquisition_origin text not null,
  actor_origin text not null,
  acquired_by uuid,
  acquired_at timestamptz not null default clock_timestamp(),
  bound_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint financial_engine_bindings_source_event_key
    unique (tenant_id, source_app, source_model, source_id, financial_event_version),
  constraint financial_engine_bindings_id_tenant_key unique (id, tenant_id),
  constraint financial_engine_bindings_canonical_posting_fkey
    foreign key (canonical_sale_posting_id, tenant_id)
    references public.financial_sale_postings(id, tenant_id) on delete restrict,
  constraint financial_engine_bindings_legacy_move_fkey
    foreign key (legacy_move_id, tenant_id)
    references public.account_moves(id, tenant_id) on delete restrict,
  constraint financial_engine_bindings_acquired_by_fkey
    foreign key (acquired_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_engine_bindings_source_app_check
    check (source_app ~ '^[a-z][a-z0-9_]*$'),
  constraint financial_engine_bindings_source_model_check
    check (source_model ~ '^[a-z][a-z0-9_]*$'),
  constraint financial_engine_bindings_source_id_check
    check (btrim(source_id) <> '' and length(source_id) <= 200),
  constraint financial_engine_bindings_event_version_check
    check (financial_event_version > 0),
  constraint financial_engine_bindings_engine_check
    check (financial_engine in ('legacy', 'canonical')),
  constraint financial_engine_bindings_state_check
    check (state in ('acquired', 'posted')),
  constraint financial_engine_bindings_origin_check
    check (acquisition_origin ~ '^[a-z][a-z0-9_]{2,99}$'),
  constraint financial_engine_bindings_actor_origin_check
    check (actor_origin in ('tenant_user', 'system')),
  constraint financial_engine_bindings_actor_consistency_check
    check (
      (actor_origin = 'tenant_user' and acquired_by is not null)
      or (actor_origin = 'system' and acquired_by is null)
    ),
  constraint financial_engine_bindings_link_state_check
    check (
      (state = 'acquired'
        and canonical_sale_posting_id is null
        and legacy_move_id is null
        and bound_at is null)
      or
      (state = 'posted' and bound_at is not null and (
        (financial_engine = 'canonical'
          and canonical_sale_posting_id is not null
          and legacy_move_id is null)
        or
        (financial_engine = 'legacy'
          and legacy_move_id is not null
          and canonical_sale_posting_id is null)
      ))
    )
);

create unique index financial_engine_bindings_canonical_posting_key
  on public.financial_engine_bindings (tenant_id, canonical_sale_posting_id)
  where canonical_sale_posting_id is not null;

create unique index financial_engine_bindings_legacy_move_key
  on public.financial_engine_bindings (tenant_id, legacy_move_id)
  where legacy_move_id is not null;

create or replace function public.guard_financial_engine_binding()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  canonical_posting public.financial_sale_postings%rowtype;
  legacy_move public.account_moves%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000',
      message = 'FINANCIAL_ENGINE_BINDING_DELETE_FORBIDDEN';
  end if;

  if current_setting('app.financial_engine_binding_contract', true)
      is distinct from coalesce(new.id, old.id)::text then
    raise exception using errcode = '42501',
      message = 'FINANCIAL_ENGINE_BINDING_INTERNAL_CONTROL_REQUIRED';
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id
       or new.source_app is distinct from old.source_app
       or new.source_model is distinct from old.source_model
       or new.source_id is distinct from old.source_id
       or new.financial_event_version is distinct from old.financial_event_version
       or new.financial_engine is distinct from old.financial_engine
       or new.acquisition_origin is distinct from old.acquisition_origin
       or new.actor_origin is distinct from old.actor_origin
       or new.acquired_by is distinct from old.acquired_by
       or new.acquired_at is distinct from old.acquired_at
       or new.created_at is distinct from old.created_at
    then
      raise exception using errcode = '55000',
        message = 'FINANCIAL_ENGINE_BINDING_OWNERSHIP_IMMUTABLE';
    end if;
    if old.state <> 'acquired' or new.state <> 'posted' then
      raise exception using errcode = '55000',
        message = 'FINANCIAL_ENGINE_BINDING_STATE_TRANSITION_INVALID';
    end if;
  end if;

  if new.state = 'posted' and new.financial_engine = 'canonical' then
    select * into canonical_posting
    from public.financial_sale_postings posting
    where posting.id = new.canonical_sale_posting_id
      and posting.tenant_id = new.tenant_id;
    if not found
       or canonical_posting.source_app is distinct from new.source_app
       or canonical_posting.source_model is distinct from new.source_model
       or canonical_posting.source_id is distinct from new.source_id
       or canonical_posting.event_version is distinct from new.financial_event_version
    then
      raise exception using errcode = '23514',
        message = 'FINANCIAL_ENGINE_CANONICAL_LINK_INVALID';
    end if;
  elsif new.state = 'posted' and new.financial_engine = 'legacy' then
    select * into legacy_move
    from public.account_moves move
    where move.id = new.legacy_move_id
      and move.tenant_id = new.tenant_id;
    if not found or legacy_move.state <> 'posted' then
      raise exception using errcode = '23514',
        message = 'FINANCIAL_ENGINE_LEGACY_LINK_INVALID';
    end if;
  end if;

  return new;
end
$$;

create trigger financial_engine_bindings_guard
before insert or update or delete on public.financial_engine_bindings
for each row execute function public.guard_financial_engine_binding();

create or replace function public.acquire_financial_engine_binding(
  p_tenant_id uuid,
  p_source_app text,
  p_source_model text,
  p_source_id text,
  p_financial_event_version integer,
  p_financial_engine text,
  p_acquisition_origin text,
  p_acquired_by uuid default null
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
  normalized_engine text := lower(btrim(p_financial_engine));
  normalized_origin text := lower(btrim(p_acquisition_origin));
  binding public.financial_engine_bindings%rowtype;
  binding_id uuid := gen_random_uuid();
begin
  if p_tenant_id is null
     or normalized_source_app is null
     or normalized_source_app !~ '^[a-z][a-z0-9_]*$'
     or normalized_source_model is null
     or normalized_source_model !~ '^[a-z][a-z0-9_]*$'
     or normalized_source_id is null
     or normalized_source_id = ''
     or length(normalized_source_id) > 200
     or p_financial_event_version is null
     or p_financial_event_version <= 0
  then
    raise exception using errcode = '22023',
      message = 'FINANCIAL_ENGINE_SOURCE_IDENTITY_INVALID';
  end if;
  if normalized_engine not in ('legacy', 'canonical') then
    raise exception using errcode = '22023',
      message = 'FINANCIAL_ENGINE_INVALID';
  end if;
  if normalized_origin is null
     or normalized_origin !~ '^[a-z][a-z0-9_]{2,99}$' then
    raise exception using errcode = '22023',
      message = 'FINANCIAL_ENGINE_ACQUISITION_ORIGIN_INVALID';
  end if;
  if p_acquired_by is not null and not exists (
    select 1 from public.tenant_users tenant_user
    where tenant_user.id = p_acquired_by
      and tenant_user.tenant_id = p_tenant_id
  ) then
    raise exception using errcode = '23514',
      message = 'FINANCIAL_ENGINE_ACTOR_TENANT_MISMATCH';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'financial_engine_binding:source:' || p_tenant_id::text || ':' ||
    normalized_source_app || ':' || normalized_source_model || ':' ||
    normalized_source_id || ':' || p_financial_event_version::text,
    0
  ));

  select * into binding
  from public.financial_engine_bindings item
  where item.tenant_id = p_tenant_id
    and item.source_app = normalized_source_app
    and item.source_model = normalized_source_model
    and item.source_id = normalized_source_id
    and item.financial_event_version = p_financial_event_version
  for update;

  if found then
    if binding.financial_engine <> normalized_engine then
      if binding.financial_engine = 'legacy' then
        raise exception using errcode = '55000',
          message = 'FINANCIAL_ENGINE_CONFLICT_LEGACY_OWNED';
      end if;
      raise exception using errcode = '55000',
        message = 'FINANCIAL_ENGINE_CONFLICT_CANONICAL_OWNED';
    end if;
    return jsonb_build_object(
      'binding_id', binding.id,
      'financial_engine', binding.financial_engine,
      'state', binding.state,
      'idempotent_replay', true
    );
  end if;

  perform set_config('app.financial_engine_binding_contract', binding_id::text, true);
  insert into public.financial_engine_bindings (
    id, tenant_id, source_app, source_model, source_id,
    financial_event_version, financial_engine, state,
    acquisition_origin, actor_origin, acquired_by
  ) values (
    binding_id, p_tenant_id, normalized_source_app, normalized_source_model,
    normalized_source_id, p_financial_event_version, normalized_engine,
    'acquired', normalized_origin,
    case when p_acquired_by is null then 'system' else 'tenant_user' end,
    p_acquired_by
  );
  perform set_config('app.financial_engine_binding_contract', '', true);

  return jsonb_build_object(
    'binding_id', binding_id,
    'financial_engine', normalized_engine,
    'state', 'acquired',
    'idempotent_replay', false
  );
end
$$;

create or replace function public.finalize_financial_engine_binding(
  p_binding_id uuid,
  p_financial_engine text,
  p_financial_link_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_engine text := lower(btrim(p_financial_engine));
  binding public.financial_engine_bindings%rowtype;
begin
  if p_binding_id is null or p_financial_link_id is null then
    raise exception using errcode = '22023',
      message = 'FINANCIAL_ENGINE_FINALIZATION_CONTEXT_MISSING';
  end if;

  select * into binding
  from public.financial_engine_bindings item
  where item.id = p_binding_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'FINANCIAL_ENGINE_BINDING_NOT_FOUND';
  end if;
  if binding.financial_engine <> normalized_engine then
    raise exception using errcode = '55000',
      message = 'FINANCIAL_ENGINE_FINALIZATION_ENGINE_MISMATCH';
  end if;
  if binding.state = 'posted' then
    if (normalized_engine = 'canonical'
          and binding.canonical_sale_posting_id = p_financial_link_id)
       or (normalized_engine = 'legacy'
          and binding.legacy_move_id = p_financial_link_id)
    then
      return jsonb_build_object(
        'binding_id', binding.id,
        'financial_engine', binding.financial_engine,
        'state', binding.state,
        'idempotent_replay', true
      );
    end if;
    raise exception using errcode = '55000',
      message = 'FINANCIAL_ENGINE_FINALIZATION_LINK_MISMATCH';
  end if;

  perform set_config('app.financial_engine_binding_contract', binding.id::text, true);
  update public.financial_engine_bindings
  set state = 'posted',
      canonical_sale_posting_id = case when normalized_engine = 'canonical'
        then p_financial_link_id else null end,
      legacy_move_id = case when normalized_engine = 'legacy'
        then p_financial_link_id else null end,
      bound_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = binding.id;
  perform set_config('app.financial_engine_binding_contract', '', true);

  return jsonb_build_object(
    'binding_id', binding.id,
    'financial_engine', normalized_engine,
    'state', 'posted',
    'idempotent_replay', false
  );
end
$$;

create or replace function public.bind_showroom_sale_to_legacy_engine(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_acquisition_origin text,
  p_acquired_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  sale public.showroom_sales%rowtype;
  legacy_move public.account_moves%rowtype;
  acquisition jsonb;
begin
  select * into sale
  from public.showroom_sales item
  where item.id = p_sale_id
    and item.tenant_id = p_tenant_id;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'SHOWROOM_SALE_NOT_FOUND_FOR_ENGINE_BINDING';
  end if;
  if sale.account_move_id is null then
    raise exception using errcode = '23514',
      message = 'SHOWROOM_LEGACY_ACCOUNT_MOVE_REQUIRED';
  end if;

  select * into legacy_move
  from public.account_moves move
  where move.id = sale.account_move_id
    and move.tenant_id = sale.tenant_id;
  if not found
     or legacy_move.state <> 'posted'
     or legacy_move.move_type <> 'sale'
     or legacy_move.partner_id is distinct from sale.customer_id
     or legacy_move.amount_total is distinct from sale.total_amount
  then
    raise exception using errcode = '23514',
      message = 'SHOWROOM_LEGACY_ACCOUNT_MOVE_RELATIONSHIP_INVALID';
  end if;

  acquisition := public.acquire_financial_engine_binding(
    sale.tenant_id, 'showroom', 'sale', sale.id::text, 1, 'legacy',
    p_acquisition_origin, p_acquired_by
  );
  perform public.finalize_financial_engine_binding(
    (acquisition ->> 'binding_id')::uuid, 'legacy', legacy_move.id
  );
  return acquisition || jsonb_build_object(
    'state', 'posted',
    'legacy_move_id', legacy_move.id
  );
end
$$;

create or replace function public.assert_showroom_sale_not_canonical(
  p_tenant_id uuid,
  p_sale_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  binding_engine text;
begin
  if p_tenant_id is null or p_sale_id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'financial_engine_binding:source:' || p_tenant_id::text ||
    ':showroom:sale:' || p_sale_id::text || ':1',
    0
  ));
  select item.financial_engine into binding_engine
  from public.financial_engine_bindings item
  where item.tenant_id = p_tenant_id
    and item.source_app = 'showroom'
    and item.source_model = 'sale'
    and item.source_id = p_sale_id::text
    and item.financial_event_version = 1;
  if binding_engine = 'canonical' then
    raise exception using errcode = '55000',
      message = 'FINANCIAL_ENGINE_CONFLICT_CANONICAL_OWNED';
  end if;
end
$$;

-- Preserve any pre-existing canonical postings as canonical ownership.
do $$
declare
  posting public.financial_sale_postings%rowtype;
  acquisition jsonb;
begin
  for posting in
    select * from public.financial_sale_postings order by tenant_id, id
  loop
    acquisition := public.acquire_financial_engine_binding(
      posting.tenant_id, posting.source_app, posting.source_model,
      posting.source_id, posting.event_version, 'canonical',
      'canonical_posting_backfill', null
    );
    perform public.finalize_financial_engine_binding(
      (acquisition ->> 'binding_id')::uuid, 'canonical', posting.id
    );
  end loop;
end
$$;

-- Evidence-only Showroom backfill. Unlinked or inconsistent sales stay unbound.
do $$
declare
  sale record;
begin
  for sale in
    select item.tenant_id, item.id
    from public.showroom_sales item
    join public.account_moves move
      on move.id = item.account_move_id
     and move.tenant_id = item.tenant_id
     and move.state = 'posted'
     and move.move_type = 'sale'
     and move.partner_id is not distinct from item.customer_id
     and move.amount_total is not distinct from item.total_amount
    order by item.tenant_id, item.id
  loop
    perform public.bind_showroom_sale_to_legacy_engine(
      sale.tenant_id, sale.id, 'showroom_legacy_backfill', null
    );
  end loop;
end
$$;

alter function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) rename to post_financial_sale_unbound_impl;

revoke all on function public.post_financial_sale_unbound_impl(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) from public, anon, authenticated, service_role;

create function public.post_financial_sale(
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
  acquisition jsonb;
  result jsonb;
  actor_id uuid := public.current_tenant_user_id();
begin
  acquisition := public.acquire_financial_engine_binding(
    p_tenant_id, p_source_app, p_source_model, p_source_id,
    p_event_version, 'canonical', 'canonical_sale_posting', actor_id
  );
  result := public.post_financial_sale_unbound_impl(
    p_tenant_id, p_source_app, p_source_model, p_source_id,
    p_event_version, p_idempotency_key, p_source_business_fingerprint,
    p_partner_id, p_amount, p_currency_code, p_posting_date,
    p_branch_id, p_commercial_reference
  );
  perform public.finalize_financial_engine_binding(
    (acquisition ->> 'binding_id')::uuid,
    'canonical', (result ->> 'posting_id')::uuid
  );
  return result;
end
$$;

alter function public.complete_showroom_sale(uuid, numeric, text, jsonb)
  rename to complete_showroom_sale_legacy_engine_impl;

revoke all on function public.complete_showroom_sale_legacy_engine_impl(
  uuid, numeric, text, jsonb
) from public, anon, authenticated, service_role;

create function public.complete_showroom_sale(
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
  sale_tenant_id uuid;
  actor_id uuid;
  acquisition jsonb;
  result jsonb;
begin
  select sale.tenant_id into sale_tenant_id
  from public.showroom_sales sale
  where sale.id = p_sale_id;
  if sale_tenant_id is null then
    return public.complete_showroom_sale_legacy_engine_impl(
      p_sale_id, p_cash_amount, p_cash_note, p_open_credit_allocations
    );
  end if;
  select tenant_user.id into actor_id
  from public.tenant_users tenant_user
  where tenant_user.tenant_id = sale_tenant_id
    and tenant_user.auth_user_id = auth.uid()
    and coalesce(tenant_user.is_active, true)
  order by tenant_user.created_at, tenant_user.id
  limit 1;

  acquisition := public.acquire_financial_engine_binding(
    sale_tenant_id, 'showroom', 'sale', p_sale_id::text, 1,
    'legacy', 'showroom_complete_sale', actor_id
  );
  result := public.complete_showroom_sale_legacy_engine_impl(
    p_sale_id, p_cash_amount, p_cash_note, p_open_credit_allocations
  );
  perform public.bind_showroom_sale_to_legacy_engine(
    sale_tenant_id, p_sale_id, 'showroom_complete_sale', actor_id
  );
  return result;
end
$$;

alter function public.cancel_showroom_sale(uuid, uuid, text, text)
  rename to cancel_showroom_sale_legacy_engine_impl;

revoke all on function public.cancel_showroom_sale_legacy_engine_impl(
  uuid, uuid, text, text
) from public, anon, authenticated, service_role;

create function public.cancel_showroom_sale(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_reason text,
  p_preview_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.assert_showroom_sale_not_canonical(p_tenant_id, p_sale_id);
  return public.cancel_showroom_sale_legacy_engine_impl(
    p_tenant_id, p_sale_id, p_reason, p_preview_version
  );
end
$$;

alter function public.create_confirmed_showroom_sale_return(
  uuid, uuid, jsonb, text, text, uuid
) rename to create_confirmed_showroom_sale_return_legacy_engine_impl;

revoke all on function public.create_confirmed_showroom_sale_return_legacy_engine_impl(
  uuid, uuid, jsonb, text, text, uuid
) from public, anon, authenticated, service_role;

create function public.create_confirmed_showroom_sale_return(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_lines jsonb,
  p_reason_code text,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  replacement_sale_id uuid;
  actor_id uuid;
begin
  perform public.assert_showroom_sale_not_canonical(p_tenant_id, p_sale_id);
  result := public.create_confirmed_showroom_sale_return_legacy_engine_impl(
    p_tenant_id, p_sale_id, p_lines, p_reason_code, p_reason,
    p_idempotency_key
  );
  replacement_sale_id := nullif(result ->> 'replacement_sale_id', '')::uuid;
  if replacement_sale_id is not null then
    select tenant_user.id into actor_id
    from public.tenant_users tenant_user
    where tenant_user.tenant_id = p_tenant_id
      and tenant_user.auth_user_id = auth.uid()
      and coalesce(tenant_user.is_active, true)
    order by tenant_user.created_at, tenant_user.id
    limit 1;
    perform public.bind_showroom_sale_to_legacy_engine(
      p_tenant_id, replacement_sale_id, 'showroom_legacy_return', actor_id
    );
  end if;
  return result;
end
$$;

alter table public.financial_engine_bindings enable row level security;
alter table public.financial_engine_bindings force row level security;
revoke all on table public.financial_engine_bindings
  from public, anon, authenticated, service_role;

revoke all on function public.guard_financial_engine_binding()
  from public, anon, authenticated, service_role;
revoke all on function public.acquire_financial_engine_binding(
  uuid, text, text, text, integer, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.finalize_financial_engine_binding(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.bind_showroom_sale_to_legacy_engine(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.assert_showroom_sale_not_canonical(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) to authenticated;

revoke all on function public.complete_showroom_sale(uuid, numeric, text, jsonb)
  from public, anon;
grant execute on function public.complete_showroom_sale(uuid, numeric, text, jsonb)
  to authenticated, service_role;
revoke all on function public.cancel_showroom_sale(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.cancel_showroom_sale(uuid, uuid, text, text)
  to authenticated, service_role;
revoke all on function public.create_confirmed_showroom_sale_return(
  uuid, uuid, jsonb, text, text, uuid
) from public, anon;
grant execute on function public.create_confirmed_showroom_sale_return(
  uuid, uuid, jsonb, text, text, uuid
) to authenticated, service_role;

comment on table public.financial_engine_bindings is
  'Immutable control/provenance ownership for one financial engine per business source event. Contains no accounting amounts or debit/credit data.';
comment on function public.acquire_financial_engine_binding(
  uuid, text, text, text, integer, text, text, uuid
) is
  'Internal atomic financial-engine acquisition primitive. Same-engine calls replay; conflicting engines fail closed.';
comment on function public.complete_showroom_sale(uuid, numeric, text, jsonb) is
  'Current Legacy Showroom confirmation path, protected by atomic sale-posting engine ownership.';
comment on function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) is
  'Generic canonical Sale Posting boundary with atomic financial-engine acquisition and immutable posting linkage.';

notify pgrst, 'reload schema';

commit;
