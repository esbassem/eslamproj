begin;

insert into public.auth_permissions (
  code, name, description, resource, action,
  module_code, permission_type, sort_order, active
)
values (
  'financial.payment.post', 'ترحيل الدفعات محاسبيًا',
  'إنشاء القيد المتوازن لدفعة مؤكدة وفق غرض محاسبي معتمد.',
  'financial.payment', 'post', 'accountant_app', 'action', 125, true
)
on conflict (code) do update set
  name = excluded.name, description = excluded.description,
  resource = excluded.resource, action = excluded.action,
  module_code = excluded.module_code, permission_type = excluded.permission_type,
  sort_order = excluded.sort_order, active = true, updated_at = now();

create table public.financial_payment_purposes (
  code text primary key,
  name text not null,
  direction text not null,
  partner_role text not null,
  counterpart_functional_role text not null
    references public.account_functional_role_definitions(functional_role) on delete restrict,
  destination_side text not null,
  counterpart_side text not null,
  requires_partner boolean not null default true,
  creates_open_item boolean not null default true,
  requires_future_allocation boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint financial_payment_purposes_code_format_check
    check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint financial_payment_purposes_name_not_blank check (btrim(name) <> ''),
  constraint financial_payment_purposes_direction_check check (direction in ('inbound','outbound')),
  constraint financial_payment_purposes_partner_role_check check (partner_role in ('customer','supplier')),
  constraint financial_payment_purposes_sides_check check (
    destination_side in ('debit','credit')
    and counterpart_side in ('debit','credit')
    and destination_side <> counterpart_side
  )
);

insert into public.financial_payment_purposes (
  code, name, direction, partner_role, counterpart_functional_role,
  destination_side, counterpart_side
)
values
  ('inbound_customer_unallocated', 'Unallocated Customer Receipt',
    'inbound', 'customer', 'customer_receivable', 'debit', 'credit'),
  ('customer_advance', 'Customer Advance',
    'inbound', 'customer', 'customer_advance', 'debit', 'credit'),
  ('outbound_supplier_unallocated', 'Unallocated Supplier Payment',
    'outbound', 'supplier', 'supplier_payable', 'credit', 'debit'),
  ('supplier_advance', 'Supplier Advance',
    'outbound', 'supplier', 'supplier_advance', 'credit', 'debit');

alter table public.financial_payments
  add column payment_purpose text references public.financial_payment_purposes(code) on delete restrict,
  add column posted_by uuid,
  add column posted_at timestamptz,
  add constraint financial_payments_posted_by_fkey
    foreign key (posted_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  add constraint financial_payments_accounting_metadata_check check (
    (accounting_state = 'unposted'
      and payment_purpose is null and posted_by is null and posted_at is null)
    or (accounting_state in ('posted','reversed')
      and payment_purpose is not null and posted_by is not null and posted_at is not null)
  );

create index financial_payments_purpose_idx
  on public.financial_payments (tenant_id, payment_purpose, accounting_state, created_at desc)
  where payment_purpose is not null;

alter table public.financial_payment_events
  drop constraint financial_payment_events_type_check,
  add constraint financial_payment_events_type_check
    check (event_type in ('created','submitted','confirmed','rejected','reversed','posted'));

create or replace function public.guard_financial_payment_accounting_state()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  contract_payment_id text := current_setting('app.financial_payment_posting_contract', true);
begin
  if tg_op = 'INSERT' then
    if new.accounting_state <> 'unposted'
       or new.payment_purpose is not null
       or new.posted_by is not null or new.posted_at is not null then
      raise exception using errcode = '23514', message = 'FINANCIAL_PAYMENT_MUST_START_UNPOSTED';
    end if;
    return new;
  end if;

  if new.accounting_state is not distinct from old.accounting_state
     and new.payment_purpose is not distinct from old.payment_purpose
     and new.posted_by is not distinct from old.posted_by
     and new.posted_at is not distinct from old.posted_at then
    return new;
  end if;

  if old.accounting_state = 'unposted' and new.accounting_state = 'posted'
     and contract_payment_id = new.id::text
     and old.payment_purpose is null and new.payment_purpose is not null
     and old.posted_by is null and new.posted_by is not null
     and old.posted_at is null and new.posted_at is not null
     and exists (
       select 1 from public.financial_payment_accounting_links link
       join public.account_moves move
         on move.id = link.account_move_id and move.tenant_id = link.tenant_id
       where link.payment_id = new.id and link.tenant_id = new.tenant_id
         and link.entry_type = 'posting' and move.state = 'posted'
     ) then
    return new;
  end if;

  raise exception using errcode = '42501',
    message = 'FINANCIAL_PAYMENT_ACCOUNTING_STATE_REQUIRES_POSTING_CONTRACT';
end
$$;

drop trigger financial_payments_accounting_boundary_guard on public.financial_payments;
create trigger financial_payments_accounting_boundary_guard
before insert or update of accounting_state, payment_purpose, posted_by, posted_at
on public.financial_payments
for each row execute function public.guard_financial_payment_accounting_state();

create or replace function public.guard_financial_payment_accounting_link()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  contract_payment_id text := current_setting('app.financial_payment_posting_contract', true);
  payment public.financial_payments%rowtype;
  move public.account_moves%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '42501',
      message = 'FINANCIAL_PAYMENT_ACCOUNTING_LINK_IMMUTABLE';
  end if;
  select * into payment from public.financial_payments item
  where item.id = new.payment_id and item.tenant_id = new.tenant_id;
  select * into move from public.account_moves item
  where item.id = new.account_move_id and item.tenant_id = new.tenant_id;
  if contract_payment_id is distinct from new.payment_id::text
     or new.entry_type <> 'posting'
     or payment.status <> 'confirmed' or payment.accounting_state <> 'unposted'
     or move.state <> 'posted' then
    raise exception using errcode = '42501',
      message = 'FINANCIAL_PAYMENT_ACCOUNTING_LINK_REQUIRES_POSTING_CONTRACT';
  end if;
  perform public.accounting_assert_move_balanced(move.id);
  return new;
end
$$;

create or replace function public.create_financial_payment_posting_move(
  p_tenant_id uuid, p_payment_id uuid, p_payment_number text,
  p_direction text, p_amount numeric, p_currency_code text,
  p_partner_id uuid, p_purpose text, p_destination_name text,
  p_destination_account_id uuid, p_counterpart_account_id uuid,
  p_journal_id uuid, p_branch_id uuid, p_actor_id uuid,
  p_destination_side text, p_counterpart_side text,
  p_source_app text, p_source_model text, p_source_id text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  move_id uuid := gen_random_uuid();
  destination_line_id uuid := gen_random_uuid();
  counterpart_line_id uuid := gen_random_uuid();
  trace_notes text;
begin
  if current_setting('app.financial_payment_posting_contract', true) is distinct from p_payment_id::text then
    raise exception using errcode = '42501', message = 'PAYMENT_MOVE_CONSTRUCTION_REQUIRES_POSTING_CONTRACT';
  end if;
  if p_destination_side = p_counterpart_side
     or p_destination_side not in ('debit','credit')
     or p_counterpart_side not in ('debit','credit') then
    raise exception using errcode = '23514', message = 'PAYMENT_POSTING_SIDES_INVALID';
  end if;
  if not exists (
    select 1 from public.account_accounts account
    where account.id = p_destination_account_id and account.tenant_id = p_tenant_id
      and account.active and account.is_posting and account.account_origin = 'resource'
  ) or not exists (
    select 1 from public.account_accounts account
    where account.id = p_counterpart_account_id and account.tenant_id = p_tenant_id
      and account.active and account.is_posting and account.open_item_reconcile
  ) or not exists (
    select 1 from public.account_journals journal
    where journal.id = p_journal_id and journal.tenant_id = p_tenant_id
      and journal.is_active and journal.default_account_id = p_destination_account_id
  ) then
    raise exception using errcode = '23514', message = 'PAYMENT_POSTING_ACCOUNT_OR_JOURNAL_INVALID';
  end if;

  trace_notes := concat_ws(' | ', 'purpose=' || p_purpose,
    case when p_source_app is not null then
      'source=' || p_source_app || '/' || p_source_model || '/' || p_source_id end);
  insert into public.account_moves (
    id, tenant_id, branch_id, journal_id, name, move_type, partner_id,
    invoice_date, date, amount_total, state, ref, notes,
    pay_method, currency_code, created_by
  ) values (
    move_id, p_tenant_id, p_branch_id, p_journal_id,
    'PAYMENT-' || p_payment_number, case when p_direction = 'inbound' then 'cash_in' else 'cash_out' end,
    p_partner_id, current_date, now(), round(p_amount,2), 'posted',
    'financial_payment:' || p_payment_id, trace_notes,
    'canonical_payment', p_currency_code, p_actor_id
  );
  insert into public.account_move_lines (
    id, tenant_id, move_id, account_id, partner_id, label, quantity,
    unit_price, debit, credit, line_type, is_reconciled,
    amount_residual, amount_residual_currency, parent_state,
    currency_code, created_by
  ) values
    (destination_line_id, p_tenant_id, move_id, p_destination_account_id, null,
      p_destination_name || ' — ' || p_payment_number, 1, p_amount,
      case when p_destination_side='debit' then p_amount else 0 end,
      case when p_destination_side='credit' then p_amount else 0 end,
      'liquidity', true, 0, 0, 'posted', p_currency_code, p_actor_id),
    (counterpart_line_id, p_tenant_id, move_id, p_counterpart_account_id, p_partner_id,
      p_purpose || ' — ' || p_payment_number, 1, p_amount,
      case when p_counterpart_side='debit' then p_amount else 0 end,
      case when p_counterpart_side='credit' then p_amount else 0 end,
      'open_item', false, p_amount, p_amount, 'posted', p_currency_code, p_actor_id);
  perform public.accounting_assert_move_balanced(move_id);
  return move_id;
end
$$;

create or replace function public.post_financial_payment(
  p_tenant_id uuid, p_payment_id uuid, p_payment_purpose text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payment public.financial_payments%rowtype;
  purpose public.financial_payment_purposes%rowtype;
  method public.financial_payment_methods%rowtype;
  destination record;
  counterpart_account_id uuid;
  actor_id uuid := public.current_tenant_user_id();
  move_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'financial_payment_post:' || p_tenant_id::text || ':' || p_payment_id::text, 0
  ));
  select * into payment from public.financial_payments item
  where item.id = p_payment_id and item.tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode='P0002', message='FINANCIAL_PAYMENT_NOT_FOUND'; end if;
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.payment.post', null, null,
    payment.branch_id, payment.status = 'confirmed'
  );

  if payment.accounting_state = 'posted' then
    if payment.payment_purpose is distinct from p_payment_purpose then
      raise exception using errcode='23514', message='FINANCIAL_PAYMENT_ALREADY_POSTED_WITH_DIFFERENT_PURPOSE';
    end if;
    select link.account_move_id into move_id
    from public.financial_payment_accounting_links link
    where link.tenant_id=p_tenant_id and link.payment_id=payment.id and link.entry_type='posting';
    if move_id is null then raise exception using errcode='23514', message='POSTED_FINANCIAL_PAYMENT_LINK_MISSING'; end if;
    return jsonb_build_object('payment_id',payment.id,'payment_number',payment.payment_number,
      'accounting_state','posted','payment_purpose',payment.payment_purpose,
      'account_move_id',move_id,'idempotent_replay',true);
  end if;
  if payment.status <> 'confirmed' or payment.accounting_state <> 'unposted' then
    raise exception using errcode='23514', message='FINANCIAL_PAYMENT_NOT_POSTABLE';
  end if;

  select * into purpose from public.financial_payment_purposes definition
  where definition.code=p_payment_purpose and definition.is_active;
  if not found then raise exception using errcode='22023', message='FINANCIAL_PAYMENT_PURPOSE_INVALID_OR_INACTIVE'; end if;
  if purpose.direction <> payment.direction then
    raise exception using errcode='23514', message='FINANCIAL_PAYMENT_PURPOSE_DIRECTION_MISMATCH';
  end if;
  if purpose.requires_partner and payment.partner_id is null then
    raise exception using errcode='23514', message='FINANCIAL_PAYMENT_PURPOSE_REQUIRES_PARTNER';
  end if;
  if not exists (
    select 1 from public.partners partner where partner.id=payment.partner_id
      and partner.tenant_id=p_tenant_id and partner.active
      and ((purpose.partner_role='customer' and partner.customer_rank>0)
        or (purpose.partner_role='supplier' and partner.supplier_rank>0))
  ) then raise exception using errcode='23514', message='FINANCIAL_PAYMENT_PARTNER_ROLE_MISMATCH'; end if;

  select * into method from public.financial_payment_methods item
  where item.id=payment.payment_method_id and item.tenant_id=p_tenant_id and item.is_active;
  if not found then raise exception using errcode='23514', message='PAYMENT_METHOD_INVALID_OR_INACTIVE'; end if;
  if payment.money_destination_id is null then
    raise exception using errcode='23514', message='POSTABLE_FINANCIAL_PAYMENT_REQUIRES_DESTINATION';
  end if;
  select * into destination from public.resolve_money_destination_for_action(
    p_tenant_id, payment.money_destination_id,
    'financial.payment.post', 'confirm', payment.branch_id,
    array(select compatibility.destination_type
      from public.financial_payment_method_destination_types compatibility
      where compatibility.method_type=method.method_type)
  );
  counterpart_account_id := public.resolve_functional_account(
    p_tenant_id, purpose.counterpart_functional_role, payment.branch_id
  );

  perform set_config('app.financial_payment_posting_contract', payment.id::text, true);
  move_id := public.create_financial_payment_posting_move(
    p_tenant_id, payment.id, payment.payment_number, payment.direction,
    payment.amount, payment.currency_code, payment.partner_id, purpose.code,
    destination.destination_name, destination.ledger_account_id,
    counterpart_account_id, destination.journal_id, payment.branch_id,
    actor_id, purpose.destination_side, purpose.counterpart_side,
    payment.source_app, payment.source_model, payment.source_id
  );
  insert into public.financial_payment_accounting_links (
    tenant_id,payment_id,account_move_id,entry_type,created_by
  ) values (p_tenant_id,payment.id,move_id,'posting',actor_id);
  update public.financial_payments
  set accounting_state='posted', payment_purpose=purpose.code,
      posted_by=actor_id, posted_at=now()
  where id=payment.id and tenant_id=p_tenant_id;
  insert into public.financial_payment_events (
    tenant_id,payment_id,event_type,from_status,to_status,
    actor_user_id,metadata
  ) values (
    p_tenant_id,payment.id,'posted','confirmed','confirmed',actor_id,
    jsonb_build_object('account_move_id',move_id,'payment_purpose',purpose.code,
      'accounting_state','posted','allocation_state','unallocated')
  );
  perform set_config('app.financial_payment_posting_contract', '', true);
  return jsonb_build_object('payment_id',payment.id,'payment_number',payment.payment_number,
    'accounting_state','posted','payment_purpose',purpose.code,
    'account_move_id',move_id,'allocation_state','unallocated',
    'idempotent_replay',false);
end
$$;

alter table public.financial_payment_purposes enable row level security;
revoke all on public.financial_payment_purposes from public,anon,authenticated;
grant select on public.financial_payment_purposes to authenticated;
create policy financial_payment_purposes_read
on public.financial_payment_purposes for select to authenticated using (is_active);

revoke all on function public.create_financial_payment_posting_move(uuid,uuid,text,text,numeric,text,uuid,text,text,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.post_financial_payment(uuid,uuid,text) from public,anon;
grant execute on function public.post_financial_payment(uuid,uuid,text) to authenticated;

comment on table public.financial_payment_purposes is
  'Canonical accounting intent registry. Purpose is independent from source_app, payment method and destination.';
comment on function public.post_financial_payment(uuid,uuid,text) is
  'The only Phase 4C1 boundary that atomically posts a confirmed payment, creates one balanced move and link, and leaves its open item unallocated.';
comment on function public.create_financial_payment_posting_move(uuid,uuid,text,text,numeric,text,uuid,text,text,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text) is
  'Internal Phase 0-compliant two-line posted move constructor; unavailable to application roles and callable only inside the payment posting contract.';
comment on column public.financial_payments.payment_purpose is
  'Immutable semantic accounting intent assigned only by successful posting; it is not source application context.';

commit;
