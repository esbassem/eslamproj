begin;

create temporary table engine_binding_before as
select
  (select count(*) from public.account_moves) as moves,
  (select count(*) from public.account_move_lines) as lines,
  (select count(*) from public.account_partial_reconcile) as partials,
  (select count(*) from public.financial_payments) as payments;

create temporary table engine_binding_open_item_before as
select
  sale.id as sale_id,
  sale.status,
  sale.total_amount,
  sale.account_move_id,
  line.id as line_id,
  line.amount_residual,
  line.amount_residual_currency,
  line.is_reconciled
from public.showroom_sales sale
join public.account_moves move
  on move.id = sale.account_move_id and move.tenant_id = sale.tenant_id
join public.account_move_lines line
  on line.move_id = move.id and line.tenant_id = move.tenant_id
where move.state = 'posted'
  and move.move_type = 'sale'
  and line.debit > 0
  and line.amount_residual > 0
order by sale.id, line.id
limit 1;

create temporary table engine_binding_context as
select
  owner.tenant_id,
  owner.id as owner_id,
  owner.auth_user_id as owner_auth,
  source_sale.id as historical_sale_id,
  source_sale.account_move_id as historical_move_id,
  source_sale.customer_id,
  source_sale.branch_id,
  source_sale.showroom_config_id,
  source_line.product_product_id,
  foreign_tenant.id as foreign_tenant_id
from public.tenant_users owner
join lateral (
  select sale.*
  from public.showroom_sales sale
  where sale.tenant_id = owner.tenant_id
    and sale.account_move_id is not null
    and exists (
      select 1 from public.account_moves move
      where move.id = sale.account_move_id
        and move.tenant_id = sale.tenant_id
        and move.state = 'posted'
        and move.move_type = 'sale'
        and move.partner_id is not distinct from sale.customer_id
        and move.amount_total is not distinct from sale.total_amount
    )
  order by sale.id
  limit 1
) source_sale on true
join lateral (
  select line.*
  from public.showroom_sale_lines line
  join public.product_products product
    on product.id = line.product_product_id
   and product.tenant_id = line.tenant_id
  where line.tenant_id = source_sale.tenant_id
    and product.tracking <> 'serial'
  order by line.id
  limit 1
) source_line on true
join lateral (
  select tenant.id
  from public.tenants tenant
  where tenant.id <> owner.tenant_id
  order by tenant.id
  limit 1
) foreign_tenant on true
where owner.role = 'owner'
  and owner.is_active
  and owner.auth_user_id is not null
order by owner.tenant_id
limit 1;

do $$
begin
  if not exists (select 1 from engine_binding_context) then
    raise exception 'FINANCIAL_ENGINE_BINDING_FIXTURE_UNAVAILABLE';
  end if;
  if not exists (select 1 from engine_binding_open_item_before) then
    raise exception 'OPEN_LEGACY_SHOWROOM_SALE_FIXTURE_UNAVAILABLE';
  end if;
end
$$;

create temporary table engine_binding_resources (
  canonical_owned_sale_id uuid,
  legacy_confirmation_sale_id uuid,
  invalid_legacy_sale_id uuid
);

create function pg_temp.make_engine_binding_sale(p_amount numeric)
returns uuid
language plpgsql
as $$
declare
  context engine_binding_context%rowtype;
  sale_id uuid := gen_random_uuid();
begin
  select * into context from engine_binding_context;
  insert into public.showroom_sales (
    id, tenant_id, branch_id, customer_id, sale_date,
    status, total_amount, created_by, showroom_config_id
  ) values (
    sale_id, context.tenant_id, context.branch_id, context.customer_id,
    current_date, 'pending_payment', p_amount, context.owner_id,
    context.showroom_config_id
  );
  insert into public.showroom_sale_lines (
    tenant_id, sale_id, product_product_id, description,
    quantity, unit_price, total
  ) values (
    context.tenant_id, sale_id, context.product_product_id,
    'Financial engine binding rollback fixture', 1, p_amount, p_amount
  );
  return sale_id;
end
$$;

do $$
declare
  context engine_binding_context%rowtype;
  historical_binding public.financial_engine_bindings%rowtype;
  replay jsonb;
  first_acquisition jsonb;
  second_acquisition jsonb;
  before_counts engine_binding_before%rowtype;
  canonical_owned_sale_id uuid;
  invalid_legacy_sale_id uuid;
  blocked boolean := false;
begin
  select * into context from engine_binding_context;
  select * into before_counts from engine_binding_before;

  if exists (
    select 1
    from public.showroom_sales sale
    join public.account_moves move
      on move.id = sale.account_move_id
     and move.tenant_id = sale.tenant_id
     and move.state = 'posted'
     and move.move_type = 'sale'
     and move.partner_id is not distinct from sale.customer_id
     and move.amount_total is not distinct from sale.total_amount
    left join public.financial_engine_bindings binding
      on binding.tenant_id = sale.tenant_id
     and binding.source_app = 'showroom'
     and binding.source_model = 'sale'
     and binding.source_id = sale.id::text
     and binding.financial_event_version = 1
     and binding.financial_engine = 'legacy'
     and binding.state = 'posted'
     and binding.legacy_move_id = sale.account_move_id
    where binding.id is null
  ) then
    raise exception 'VALID_HISTORICAL_LEGACY_SALE_NOT_BOUND';
  end if;

  select * into historical_binding
  from public.financial_engine_bindings binding
  where binding.tenant_id = context.tenant_id
    and binding.source_app = 'showroom'
    and binding.source_model = 'sale'
    and binding.source_id = context.historical_sale_id::text
    and binding.financial_event_version = 1;
  if historical_binding.financial_engine <> 'legacy'
     or historical_binding.legacy_move_id <> context.historical_move_id
     or historical_binding.canonical_sale_posting_id is not null then
    raise exception 'HISTORICAL_LEGACY_BINDING_INVALID';
  end if;

  replay := public.bind_showroom_sale_to_legacy_engine(
    context.tenant_id, context.historical_sale_id,
    'runtime_replay_test', null
  );
  if not (replay ->> 'idempotent_replay')::boolean
     or (replay ->> 'legacy_move_id')::uuid <> context.historical_move_id then
    raise exception 'LEGACY_BINDING_REPLAY_NOT_IDEMPOTENT: %', replay;
  end if;

  begin
    perform public.acquire_financial_engine_binding(
      context.tenant_id, 'showroom', 'sale',
      context.historical_sale_id::text, 1, 'canonical',
      'runtime_conflict_test', null
    );
  exception when sqlstate '55000' then
    blocked := sqlerrm = 'FINANCIAL_ENGINE_CONFLICT_LEGACY_OWNED';
  end;
  if not blocked then raise exception 'CANONICAL_ACQUIRED_LEGACY_SALE'; end if;

  first_acquisition := public.acquire_financial_engine_binding(
    context.tenant_id, 'binding_test', 'control_event',
    'same-engine-replay', 1, 'canonical', 'runtime_test', null
  );
  second_acquisition := public.acquire_financial_engine_binding(
    context.tenant_id, 'binding_test', 'control_event',
    'same-engine-replay', 1, 'canonical', 'runtime_test', null
  );
  if (first_acquisition ->> 'binding_id') is distinct from
       (second_acquisition ->> 'binding_id')
     or (second_acquisition ->> 'idempotent_replay')::boolean is not true
     or (select count(*) from public.financial_engine_bindings binding
         where binding.tenant_id = context.tenant_id
           and binding.source_app = 'binding_test'
           and binding.source_model = 'control_event'
           and binding.source_id = 'same-engine-replay'
           and binding.financial_event_version = 1) <> 1 then
    raise exception 'SAME_ENGINE_ACQUISITION_NOT_IDEMPOTENT';
  end if;
  if (select count(*) from public.account_moves) <> before_counts.moves
     or (select count(*) from public.account_move_lines) <> before_counts.lines
     or (select count(*) from public.account_partial_reconcile) <> before_counts.partials
     or (select count(*) from public.financial_payments) <> before_counts.payments then
    raise exception 'BINDING_ACQUISITION_CREATED_FINANCIAL_DATA';
  end if;

  blocked := false;
  begin
    perform public.acquire_financial_engine_binding(
      context.foreign_tenant_id, 'binding_test', 'cross_tenant',
      'forbidden', 1, 'legacy', 'runtime_test', context.owner_id
    );
  exception when check_violation then
    blocked := sqlerrm = 'FINANCIAL_ENGINE_ACTOR_TENANT_MISMATCH';
  end;
  if not blocked then raise exception 'CROSS_TENANT_BINDING_ACCEPTED'; end if;

  blocked := false;
  perform set_config(
    'app.financial_engine_binding_contract', historical_binding.id::text, true
  );
  begin
    update public.financial_engine_bindings
    set financial_engine = 'canonical'
    where id = historical_binding.id;
  exception when sqlstate '55000' then
    blocked := sqlerrm = 'FINANCIAL_ENGINE_BINDING_OWNERSHIP_IMMUTABLE';
  end;
  perform set_config('app.financial_engine_binding_contract', '', true);
  if not blocked then raise exception 'BINDING_ENGINE_MUTATION_ACCEPTED'; end if;

  blocked := false;
  begin
    delete from public.financial_engine_bindings
    where id = historical_binding.id;
  exception when sqlstate '55000' then
    blocked := sqlerrm = 'FINANCIAL_ENGINE_BINDING_DELETE_FORBIDDEN';
  end;
  if not blocked then raise exception 'BINDING_DELETION_ACCEPTED'; end if;

  invalid_legacy_sale_id := pg_temp.make_engine_binding_sale(4321.09);
  update public.showroom_sales
  set account_move_id = context.historical_move_id
  where id = invalid_legacy_sale_id;
  blocked := false;
  begin
    perform public.bind_showroom_sale_to_legacy_engine(
      context.tenant_id, invalid_legacy_sale_id,
      'runtime_invalid_link_test', null
    );
  exception when check_violation then
    blocked := sqlerrm = 'SHOWROOM_LEGACY_ACCOUNT_MOVE_RELATIONSHIP_INVALID';
  end;
  if not blocked then raise exception 'INVALID_LEGACY_MOVE_RELATIONSHIP_ACCEPTED'; end if;

  canonical_owned_sale_id := pg_temp.make_engine_binding_sale(5432.10);
  perform public.acquire_financial_engine_binding(
    context.tenant_id, 'showroom', 'sale', canonical_owned_sale_id::text,
    1, 'canonical', 'runtime_canonical_owner_test', null
  );
  insert into engine_binding_resources (
    canonical_owned_sale_id, invalid_legacy_sale_id
  ) values (canonical_owned_sale_id, invalid_legacy_sale_id);
end
$$;

grant select on engine_binding_context, engine_binding_resources to authenticated;
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from engine_binding_context;
set local role authenticated;

do $$
declare
  resources engine_binding_resources%rowtype;
  context engine_binding_context%rowtype;
  blocked boolean := false;
begin
  select * into resources from engine_binding_resources;
  select * into context from engine_binding_context;
  begin
    perform public.complete_showroom_sale(
      resources.canonical_owned_sale_id, 0, null, '[]'::jsonb
    );
  exception when sqlstate '55000' then
    blocked := sqlerrm = 'FINANCIAL_ENGINE_CONFLICT_CANONICAL_OWNED';
  end;
  if not blocked then raise exception 'LEGACY_WRITER_ACCEPTED_CANONICAL_SALE'; end if;

  blocked := false;
  begin
    perform public.cancel_showroom_sale(
      context.tenant_id, resources.canonical_owned_sale_id,
      'engine binding guard test', 'guard-test-preview'
    );
  exception when sqlstate '55000' then
    blocked := sqlerrm = 'FINANCIAL_ENGINE_CONFLICT_CANONICAL_OWNED';
  end;
  if not blocked then raise exception 'LEGACY_CANCELLATION_ACCEPTED_CANONICAL_SALE'; end if;

  blocked := false;
  begin
    perform public.create_confirmed_showroom_sale_return(
      context.tenant_id, resources.canonical_owned_sale_id,
      '[]'::jsonb, 'other', 'engine binding guard test', gen_random_uuid()
    );
  exception when sqlstate '55000' then
    blocked := sqlerrm = 'FINANCIAL_ENGINE_CONFLICT_CANONICAL_OWNED';
  end;
  if not blocked then raise exception 'LEGACY_RETURN_ACCEPTED_CANONICAL_SALE'; end if;

  blocked := false;
  begin
    insert into public.financial_engine_bindings (
      tenant_id, source_app, source_model, source_id,
      financial_event_version, financial_engine, acquisition_origin,
      actor_origin, acquired_by
    ) select tenant_id, 'binding_test', 'direct_mutation', gen_random_uuid()::text,
      1, 'legacy', 'unauthorized_test', 'tenant_user', owner_id
    from engine_binding_context;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'AUTHENTICATED_DIRECT_BINDING_INSERT_ACCEPTED'; end if;

  blocked := false;
  begin
    update public.financial_engine_bindings
    set updated_at = clock_timestamp();
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'AUTHENTICATED_DIRECT_BINDING_UPDATE_ACCEPTED'; end if;
end
$$;

set local role postgres;
do $$
declare
  v_legacy_confirmation_sale_id uuid;
begin
  v_legacy_confirmation_sale_id := pg_temp.make_engine_binding_sale(6543.21);
  update engine_binding_resources
  set legacy_confirmation_sale_id = v_legacy_confirmation_sale_id;
end
$$;

select set_config('request.jwt.claim.sub', owner_auth::text, true)
from engine_binding_context;
set local role authenticated;

do $$
declare
  resources engine_binding_resources%rowtype;
  context engine_binding_context%rowtype;
  result jsonb;
begin
  select * into resources from engine_binding_resources;
  select * into context from engine_binding_context;
  result := public.complete_showroom_sale(
    resources.legacy_confirmation_sale_id, 0, null, '[]'::jsonb
  );
  if (result ->> 'already_completed')::boolean
     or result ->> 'status' <> 'confirmed' then
    raise exception 'LEGACY_CONFIRMATION_REGRESSION: %', result;
  end if;
end
$$;

set local role postgres;
do $$
declare
  before_counts engine_binding_before%rowtype;
begin
  select * into before_counts from engine_binding_before;
  if exists (
    select 1
    from engine_binding_open_item_before snapshot
    left join public.showroom_sales sale on sale.id = snapshot.sale_id
    left join public.account_move_lines line on line.id = snapshot.line_id
    where sale.id is null
       or line.id is null
       or sale.status is distinct from snapshot.status
       or sale.total_amount is distinct from snapshot.total_amount
       or sale.account_move_id is distinct from snapshot.account_move_id
       or line.amount_residual is distinct from snapshot.amount_residual
       or line.amount_residual_currency is distinct from snapshot.amount_residual_currency
       or line.is_reconciled is distinct from snapshot.is_reconciled
  ) then
    raise exception 'HISTORICAL_OPEN_LEGACY_SALE_CHANGED';
  end if;
  if not exists (
    select 1
    from engine_binding_resources resources
    join public.showroom_sales sale
      on sale.id = resources.legacy_confirmation_sale_id
    join public.financial_engine_bindings binding
      on binding.tenant_id = sale.tenant_id
     and binding.source_app = 'showroom'
     and binding.source_model = 'sale'
     and binding.source_id = sale.id::text
     and binding.financial_event_version = 1
     and binding.financial_engine = 'legacy'
     and binding.state = 'posted'
     and binding.legacy_move_id = sale.account_move_id
    where sale.status = 'confirmed'
  ) then
    raise exception 'LEGACY_CONFIRMATION_BINDING_MISSING';
  end if;
  if (select count(*) from public.account_moves) <> before_counts.moves + 1
     or (select count(*) from public.account_move_lines) <> before_counts.lines + 2
     or (select count(*) from public.account_partial_reconcile) <> before_counts.partials
     or (select count(*) from public.financial_payments) <> before_counts.payments then
    raise exception 'LEGACY_CONFIRMATION_LEDGER_CARDINALITY_REGRESSION';
  end if;
  if exists (
    select 1
    from public.account_moves move
    join public.account_move_lines line
      on line.move_id = move.id and line.tenant_id = move.tenant_id
    where move.state = 'posted'
    group by move.id
    having round(sum(line.debit - line.credit), 2) <> 0
  ) then
    raise exception 'UNBALANCED_POSTED_MOVE_AFTER_BINDING_TEST';
  end if;
  raise notice 'FINANCIAL_ENGINE_BINDING_RUNTIME_PASSED';
end
$$;

rollback;
