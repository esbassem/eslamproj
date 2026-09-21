begin;

insert into public.auth_permissions (
  code, name, description, resource, action,
  module_code, permission_type, sort_order, active
)
values (
  'financial.sale.post_operational',
  'ترحيل مبيعات تشغيلية',
  'ترحيل واقعة بيع تجارية مؤكدة عبر عقد المبيعات المالي المخصص.',
  'financial.sale',
  'post_operational',
  'accountant_app',
  'action',
  90,
  true
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    resource = excluded.resource,
    action = excluded.action,
    module_code = excluded.module_code,
    permission_type = excluded.permission_type,
    sort_order = excluded.sort_order,
    active = true,
    updated_at = now();

create table public.financial_sale_postings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  source_app text not null,
  source_model text not null,
  source_id text not null,
  event_version integer not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  source_business_fingerprint text not null,
  state text not null default 'posted',
  account_move_id uuid not null,
  receivable_line_id uuid not null,
  partner_id uuid not null,
  branch_id uuid,
  amount numeric(18,2) not null,
  currency_code varchar(3) not null,
  posting_date date not null,
  commercial_reference text not null,
  created_by uuid not null,
  posted_by uuid not null,
  created_at timestamptz not null default now(),
  posted_at timestamptz not null default now(),
  constraint financial_sale_postings_move_fkey
    foreign key (account_move_id, tenant_id)
    references public.account_moves(id, tenant_id) on delete restrict,
  constraint financial_sale_postings_receivable_line_fkey
    foreign key (receivable_line_id, tenant_id)
    references public.account_move_lines(id, tenant_id) on delete restrict,
  constraint financial_sale_postings_partner_fkey
    foreign key (partner_id, tenant_id)
    references public.partners(id, tenant_id) on delete restrict,
  constraint financial_sale_postings_branch_fkey
    foreign key (branch_id, tenant_id)
    references public.branches(id, tenant_id) on delete restrict,
  constraint financial_sale_postings_created_by_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_sale_postings_posted_by_fkey
    foreign key (posted_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_sale_postings_tenant_idempotency_key
    unique (tenant_id, idempotency_key),
  constraint financial_sale_postings_source_event_key
    unique (tenant_id, source_app, source_model, source_id, event_version),
  constraint financial_sale_postings_move_key
    unique (tenant_id, account_move_id),
  constraint financial_sale_postings_receivable_line_key
    unique (tenant_id, receivable_line_id),
  constraint financial_sale_postings_id_tenant_key unique (id, tenant_id),
  constraint financial_sale_postings_source_app_format_check
    check (source_app ~ '^[a-z][a-z0-9_]*$'),
  constraint financial_sale_postings_source_model_format_check
    check (source_model ~ '^[a-z][a-z0-9_]*$'),
  constraint financial_sale_postings_source_id_check
    check (btrim(source_id) <> '' and length(source_id) <= 200),
  constraint financial_sale_postings_event_version_check check (event_version > 0),
  constraint financial_sale_postings_idempotency_key_check
    check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 200),
  constraint financial_sale_postings_request_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint financial_sale_postings_business_fingerprint_check
    check (source_business_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint financial_sale_postings_state_check check (state in ('posted', 'reversed')),
  constraint financial_sale_postings_amount_check
    check (amount > 0 and amount = round(amount, 2)),
  constraint financial_sale_postings_currency_check
    check (currency_code ~ '^[A-Z]{3}$'),
  constraint financial_sale_postings_reference_check
    check (btrim(commercial_reference) <> '' and length(commercial_reference) <= 200)
);

create index financial_sale_postings_source_idx
  on public.financial_sale_postings
  (tenant_id, source_app, source_model, source_id, event_version desc);
create index financial_sale_postings_partner_idx
  on public.financial_sale_postings (tenant_id, partner_id, posting_date desc);
create index financial_sale_postings_branch_idx
  on public.financial_sale_postings (tenant_id, branch_id, posting_date desc)
  where branch_id is not null;

create or replace function public.financial_sale_posting_request_fingerprint(
  p_tenant_id uuid,
  p_source_app text,
  p_source_model text,
  p_source_id text,
  p_event_version integer,
  p_source_business_fingerprint text,
  p_partner_id uuid,
  p_amount numeric,
  p_currency_code text,
  p_posting_date date,
  p_branch_id uuid,
  p_commercial_reference text
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select encode(extensions.digest(jsonb_build_object(
    'tenant_id', p_tenant_id,
    'source_app', lower(btrim(p_source_app)),
    'source_model', lower(btrim(p_source_model)),
    'source_id', btrim(p_source_id),
    'event_version', p_event_version,
    'source_business_fingerprint', lower(btrim(p_source_business_fingerprint)),
    'partner_id', p_partner_id,
    'amount', round(p_amount, 2),
    'currency_code', upper(btrim(p_currency_code)),
    'posting_date', p_posting_date,
    'branch_id', p_branch_id,
    'commercial_reference', btrim(p_commercial_reference)
  )::text, 'sha256'), 'hex')
$$;

create or replace function public.guard_financial_sale_posting()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  receivable_line public.account_move_lines%rowtype;
  posting_move public.account_moves%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000',
      message = 'FINANCIAL_SALE_POSTING_DELETE_FORBIDDEN';
  end if;
  if tg_op = 'UPDATE' then
    raise exception using errcode = '55000',
      message = 'FINANCIAL_SALE_POSTING_IMMUTABLE';
  end if;
  if current_setting('app.financial_sale_posting_contract', true)
      is distinct from new.id::text then
    raise exception using errcode = '42501',
      message = 'FINANCIAL_SALE_POSTING_REQUIRES_CANONICAL_CONTRACT';
  end if;
  if new.state <> 'posted' or new.created_by <> new.posted_by then
    raise exception using errcode = '23514',
      message = 'FINANCIAL_SALE_POSTING_STATE_INVALID';
  end if;

  select * into posting_move
  from public.account_moves move
  where move.id = new.account_move_id
    and move.tenant_id = new.tenant_id;
  select * into receivable_line
  from public.account_move_lines line
  where line.id = new.receivable_line_id
    and line.tenant_id = new.tenant_id;

  if posting_move.id is null
     or posting_move.state <> 'posted'
     or posting_move.move_type <> 'sale'
     or posting_move.partner_id is distinct from new.partner_id
     or posting_move.branch_id is distinct from new.branch_id
     or posting_move.currency_code is distinct from new.currency_code
     or posting_move.amount_total is distinct from new.amount
     or posting_move.date::date is distinct from new.posting_date
     or posting_move.ref is distinct from 'financial_sale_posting:' || new.id::text
     or receivable_line.id is null
     or receivable_line.move_id <> posting_move.id
     or receivable_line.partner_id is distinct from new.partner_id
     or receivable_line.currency_code is distinct from new.currency_code
     or receivable_line.parent_state <> 'posted'
     or receivable_line.line_type <> 'open_item'
     or receivable_line.debit <> new.amount
     or receivable_line.credit <> 0
  then
    raise exception using errcode = '23514',
      message = 'FINANCIAL_SALE_POSTING_LEDGER_LINK_INVALID';
  end if;
  return new;
end
$$;

create trigger financial_sale_postings_guard
before insert or update or delete on public.financial_sale_postings
for each row execute function public.guard_financial_sale_posting();

create or replace function public.create_financial_sale_posting_move(
  p_posting_id uuid,
  p_tenant_id uuid,
  p_partner_id uuid,
  p_amount numeric,
  p_currency_code text,
  p_posting_date date,
  p_branch_id uuid,
  p_commercial_reference text,
  p_receivable_account_id uuid,
  p_revenue_account_id uuid,
  p_journal_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  move_id uuid := gen_random_uuid();
  receivable_line_id uuid := gen_random_uuid();
  revenue_line_id uuid := gen_random_uuid();
begin
  if current_setting('app.financial_sale_posting_contract', true)
      is distinct from p_posting_id::text then
    raise exception using errcode = '42501',
      message = 'SALE_MOVE_CONSTRUCTION_REQUIRES_POSTING_CONTRACT';
  end if;
  perform public.assert_financial_posting_date(p_tenant_id, p_posting_date);
  if p_receivable_account_id is distinct from public.resolve_functional_account(
       p_tenant_id, 'customer_receivable', p_branch_id
     )
     or p_revenue_account_id is distinct from public.resolve_functional_account(
       p_tenant_id, 'sales_revenue', p_branch_id
     )
     or p_journal_id is distinct from public.resolve_financial_journal(
       p_tenant_id, 'sale', p_branch_id, null
     )
  then
    raise exception using errcode = '23514',
      message = 'SALE_POSTING_ACCOUNT_OR_JOURNAL_INVALID';
  end if;
  if p_receivable_account_id = p_revenue_account_id then
    raise exception using errcode = '23514',
      message = 'SALE_POSTING_ACCOUNTS_MUST_BE_DISTINCT';
  end if;

  insert into public.account_moves (
    id, tenant_id, branch_id, journal_id, name, move_type, partner_id,
    invoice_date, date, amount_total, state, ref, notes, pay_method,
    currency_code, created_by
  ) values (
    move_id, p_tenant_id, p_branch_id, p_journal_id,
    'SALE-' || p_commercial_reference, 'sale', p_partner_id,
    p_posting_date, p_posting_date, p_amount, 'posted',
    'financial_sale_posting:' || p_posting_id::text,
    'Canonical operational sale posting', 'canonical_sale_posting',
    p_currency_code, p_actor_id
  );

  insert into public.account_move_lines (
    id, tenant_id, move_id, account_id, partner_id, label,
    quantity, unit_price, debit, credit, line_type, due_date,
    is_reconciled, amount_residual, amount_residual_currency,
    parent_state, currency_code, created_by
  ) values
  (
    receivable_line_id, p_tenant_id, move_id, p_receivable_account_id,
    p_partner_id, 'Customer receivable — ' || p_commercial_reference,
    1, p_amount, p_amount, 0, 'open_item', p_posting_date,
    false, p_amount, p_amount, 'posted', p_currency_code, p_actor_id
  ),
  (
    revenue_line_id, p_tenant_id, move_id, p_revenue_account_id,
    null, 'Sales revenue — ' || p_commercial_reference,
    1, p_amount, 0, p_amount, 'income', null,
    true, 0, 0, 'posted', p_currency_code, p_actor_id
  );

  perform public.accounting_assert_move_balanced(move_id);
  return jsonb_build_object(
    'account_move_id', move_id,
    'receivable_line_id', receivable_line_id,
    'revenue_line_id', revenue_line_id
  );
end
$$;

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
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.sale.post_operational',
    null, null, posting.branch_id, true
  );
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

create or replace function public.post_financial_sale(
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

  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.sale.post_operational',
    null, null, p_branch_id, true
  );
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

alter table public.financial_sale_postings enable row level security;
revoke all on table public.financial_sale_postings
  from public, anon, authenticated, service_role;
grant select on table public.financial_sale_postings to authenticated;

create policy financial_sale_postings_read
on public.financial_sale_postings
for select to authenticated
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('financial.sale.post_operational', tenant_id)
  and (branch_id is null or public.has_branch_access(branch_id))
);

revoke all on function public.financial_sale_posting_request_fingerprint(
  uuid, text, text, text, integer, text, uuid, numeric, text, date, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.guard_financial_sale_posting()
  from public, anon, authenticated, service_role;
revoke all on function public.create_financial_sale_posting_move(
  uuid, uuid, uuid, numeric, text, date, uuid, text, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.get_financial_sale_posting(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.get_financial_sale_posting(uuid, uuid)
  to authenticated;
grant execute on function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) to authenticated;

comment on table public.financial_sale_postings is
  'Financial Core provenance and control link for immutable operational-sale postings. The ledger remains the accounting source of truth.';
comment on function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) is
  'Generic canonical business-event boundary for an unpaid commercial sale. Resolves accounts and journal server-side and creates no payment, allocation, or reconciliation.';
comment on function public.create_financial_sale_posting_move(
  uuid, uuid, uuid, numeric, text, date, uuid, text, uuid, uuid, uuid, uuid
) is
  'Internal protected ledger primitive for canonical Sale Posting. Not callable by application roles.';

commit;
