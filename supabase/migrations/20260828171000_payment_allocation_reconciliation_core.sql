begin;

create table public.financial_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  payment_id uuid not null,
  source_account_line_id uuid not null,
  target_account_line_id uuid not null,
  partial_reconcile_id uuid not null,
  amount numeric(18,2) not null,
  status text not null default 'active',
  idempotency_key text not null,
  request_fingerprint text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unallocated_by uuid,
  unallocated_at timestamptz,
  unallocation_reason text,
  constraint financial_payment_allocations_payment_fkey
    foreign key (payment_id, tenant_id)
    references public.financial_payments(id, tenant_id) on delete restrict,
  constraint financial_payment_allocations_source_line_fkey
    foreign key (source_account_line_id, tenant_id)
    references public.account_move_lines(id, tenant_id) on delete restrict,
  constraint financial_payment_allocations_target_line_fkey
    foreign key (target_account_line_id, tenant_id)
    references public.account_move_lines(id, tenant_id) on delete restrict,
  constraint financial_payment_allocations_created_by_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_payment_allocations_unallocated_by_fkey
    foreign key (unallocated_by, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  constraint financial_payment_allocations_tenant_idempotency_key
    unique (tenant_id, idempotency_key),
  constraint financial_payment_allocations_partial_key unique (partial_reconcile_id),
  constraint financial_payment_allocations_amount_check check (amount > 0),
  constraint financial_payment_allocations_distinct_lines_check
    check (source_account_line_id <> target_account_line_id),
  constraint financial_payment_allocations_status_check
    check (status in ('active','unallocated')),
  constraint financial_payment_allocations_idempotency_not_blank
    check (btrim(idempotency_key) <> ''),
  constraint financial_payment_allocations_fingerprint_format_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint financial_payment_allocations_lifecycle_check check (
    (status = 'active' and unallocated_by is null and unallocated_at is null and unallocation_reason is null)
    or
    (status = 'unallocated' and unallocated_by is not null and unallocated_at is not null
      and btrim(unallocation_reason) <> '')
  )
);

create index financial_payment_allocations_payment_history_idx
  on public.financial_payment_allocations (tenant_id, payment_id, created_at, id);
create index financial_payment_allocations_target_idx
  on public.financial_payment_allocations (tenant_id, target_account_line_id, status);
create index financial_payment_allocations_source_active_idx
  on public.financial_payment_allocations (tenant_id, source_account_line_id)
  where status = 'active';

create or replace function public.guard_financial_payment_allocation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  contract_id text := current_setting('app.financial_payment_allocation_contract', true);
begin
  if tg_op = 'DELETE' then
    raise exception using errcode='23514', message='FINANCIAL_PAYMENT_ALLOCATION_DELETE_FORBIDDEN';
  end if;
  if contract_id is distinct from new.id::text then
    raise exception using errcode='42501', message='FINANCIAL_PAYMENT_ALLOCATION_REQUIRES_CONTRACT';
  end if;
  if tg_op = 'INSERT' then
    new.idempotency_key := btrim(new.idempotency_key);
    if new.status <> 'active' then
      raise exception using errcode='23514', message='FINANCIAL_PAYMENT_ALLOCATION_MUST_START_ACTIVE';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
     or new.payment_id is distinct from old.payment_id
     or new.source_account_line_id is distinct from old.source_account_line_id
     or new.target_account_line_id is distinct from old.target_account_line_id
     or new.partial_reconcile_id is distinct from old.partial_reconcile_id
     or new.amount is distinct from old.amount
     or new.idempotency_key is distinct from old.idempotency_key
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or old.status <> 'active' or new.status <> 'unallocated' then
    raise exception using errcode='23514', message='FINANCIAL_PAYMENT_ALLOCATION_IMMUTABLE';
  end if;
  return new;
end
$$;

create trigger financial_payment_allocations_guard
before insert or update or delete on public.financial_payment_allocations
for each row execute function public.guard_financial_payment_allocation();

create or replace function public.resolve_financial_payment_allocation_source(
  p_tenant_id uuid, p_payment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  payment public.financial_payments%rowtype;
  source_line public.account_move_lines%rowtype;
  posting_move public.account_moves%rowtype;
  expected_account_id uuid;
  matching_count integer;
begin
  select * into payment from public.financial_payments item
  where item.id=p_payment_id and item.tenant_id=p_tenant_id;
  if not found then raise exception using errcode='P0002', message='FINANCIAL_PAYMENT_NOT_FOUND'; end if;
  if payment.status <> 'confirmed' or payment.accounting_state <> 'posted' then
    raise exception using errcode='23514', message='FINANCIAL_PAYMENT_NOT_POSTED';
  end if;
  if payment.payment_purpose not in ('inbound_customer_unallocated','outbound_supplier_unallocated') then
    raise exception using errcode='23514', message='PAYMENT_PURPOSE_REQUIRES_FUTURE_RECLASSIFICATION';
  end if;
  if payment.partner_id is null then
    raise exception using errcode='23514', message='ALLOCATABLE_PAYMENT_REQUIRES_PARTNER';
  end if;

  select move.* into posting_move
  from public.financial_payment_accounting_links link
  join public.account_moves move on move.id=link.account_move_id and move.tenant_id=link.tenant_id
  where link.tenant_id=p_tenant_id and link.payment_id=p_payment_id
    and link.entry_type='posting' and move.state='posted';
  if not found then raise exception using errcode='23514', message='POSTED_FINANCIAL_PAYMENT_LINK_MISSING'; end if;

  select public.resolve_functional_account(
    p_tenant_id, purpose.counterpart_functional_role, payment.branch_id
  ) into expected_account_id
  from public.financial_payment_purposes purpose
  where purpose.code=payment.payment_purpose and purpose.is_active;

  select count(*), (array_agg(line.id))[1] into matching_count, source_line.id
  from public.account_move_lines line
  join public.account_accounts account on account.id=line.account_id and account.tenant_id=line.tenant_id
  where line.tenant_id=p_tenant_id and line.move_id=posting_move.id
    and line.account_id=expected_account_id and line.partner_id=payment.partner_id
    and line.line_type='open_item' and account.reconcile and account.open_item_reconcile
    and ((payment.payment_purpose='inbound_customer_unallocated' and line.credit>0 and line.debit=0)
      or (payment.payment_purpose='outbound_supplier_unallocated' and line.debit>0 and line.credit=0));
  if matching_count <> 1 then
    raise exception using errcode='23514', message='PAYMENT_SOURCE_OPEN_ITEM_NOT_UNIQUE';
  end if;
  select * into source_line from public.account_move_lines where id=source_line.id;
  return jsonb_build_object(
    'payment_id',payment.id,'payment_number',payment.payment_number,
    'payment_purpose',payment.payment_purpose,'branch_id',payment.branch_id,
    'partner_id',payment.partner_id,'source_line_id',source_line.id,
    'account_id',source_line.account_id,'currency_code',source_line.currency_code,
    'polarity',case when source_line.debit>0 then 'debit' else 'credit' end,
    'original_amount',round(source_line.debit+source_line.credit,2),
    'residual_amount',round(source_line.amount_residual,2)
  );
end
$$;

create or replace function public.create_payment_allocation_partial_reconcile(
  p_allocation_id uuid, p_partial_id uuid, p_tenant_id uuid,
  p_debit_line_id uuid, p_credit_line_id uuid, p_amount numeric, p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare effective_date date;
begin
  if current_setting('app.financial_payment_allocation_contract', true) is distinct from p_allocation_id::text then
    raise exception using errcode='42501', message='PARTIAL_RECONCILE_REQUIRES_ALLOCATION_CONTRACT';
  end if;
  select greatest(debit_move.date::date,credit_move.date::date) into effective_date
  from public.account_move_lines debit_line
  join public.account_moves debit_move on debit_move.id=debit_line.move_id
  join public.account_move_lines credit_line on credit_line.id=p_credit_line_id
  join public.account_moves credit_move on credit_move.id=credit_line.move_id
  where debit_line.id=p_debit_line_id;
  insert into public.account_partial_reconcile (
    id,tenant_id,debit_move_id,credit_move_id,amount,max_date,created_by
  ) values (
    p_partial_id,p_tenant_id,p_debit_line_id,p_credit_line_id,p_amount,effective_date,p_actor_id
  );
end
$$;

create or replace function public.delete_payment_allocation_partial_reconcile(
  p_allocation_id uuid, p_partial_id uuid, p_tenant_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if current_setting('app.financial_payment_allocation_contract', true) is distinct from p_allocation_id::text then
    raise exception using errcode='42501', message='PARTIAL_UNRECONCILE_REQUIRES_ALLOCATION_CONTRACT';
  end if;
  delete from public.account_partial_reconcile item
  where item.id=p_partial_id and item.tenant_id=p_tenant_id;
  if not found then raise exception using errcode='P0002', message='ALLOCATION_PARTIAL_RECONCILE_NOT_FOUND'; end if;
end
$$;

create or replace function public.get_financial_payment_allocation_summary(
  p_tenant_id uuid, p_payment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare source jsonb; original_amount numeric; residual_amount numeric; allocated_amount numeric; state text;
begin
  source := public.resolve_financial_payment_allocation_source(p_tenant_id,p_payment_id);
  if not (
    public.can_perform_financial_action(p_tenant_id,'financial.payment.allocate',
      (source->>'account_id')::uuid,'reconcile',nullif(source->>'branch_id','')::uuid,true)
    or public.can_perform_financial_action(p_tenant_id,'financial.reconciliation.manage',
      (source->>'account_id')::uuid,'reconcile',nullif(source->>'branch_id','')::uuid,true)
  ) then
    raise exception using errcode='42501', message='FINANCIAL_AUTHORIZATION_DENIED';
  end if;
  select round(line.debit+line.credit,2),round(line.amount_residual,2)
    into original_amount,residual_amount
  from public.account_move_lines line where line.id=(source->>'source_line_id')::uuid;
  allocated_amount := round(original_amount-residual_amount,2);
  state := case when residual_amount=original_amount then 'unallocated'
    when residual_amount=0 then 'fully_allocated' else 'partially_allocated' end;
  return jsonb_build_object(
    'payment_id',p_payment_id,'source_account_line_id',(source->>'source_line_id')::uuid,
    'payment_amount',(select amount from public.financial_payments where id=p_payment_id and tenant_id=p_tenant_id),
    'posted_open_item_amount',original_amount,'original_amount',original_amount,
    'allocated_amount',allocated_amount,'remaining_allocatable_amount',residual_amount,
    'residual_amount',residual_amount,'allocation_state',state,
    'active_allocation_count',(select count(*) from public.financial_payment_allocations item
      where item.tenant_id=p_tenant_id and item.payment_id=p_payment_id and item.status='active'),
    'allocation_history',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',item.id,'target_account_line_id',item.target_account_line_id,
      'partial_reconcile_id',item.partial_reconcile_id,'amount',item.amount,
      'status',item.status,'created_by',item.created_by,'created_at',item.created_at,
      'unallocated_by',item.unallocated_by,'unallocated_at',item.unallocated_at,
      'unallocation_reason',item.unallocation_reason,
      'target_open_item',jsonb_build_object(
        'account_move_id',target_move.id,'move_name',target_move.name,
        'move_type',target_move.move_type,'move_reference',target_move.ref,
        'move_date',target_move.date::date,'due_date',target_line.due_date
      )) order by item.created_at,item.id),'[]'::jsonb)
      from public.financial_payment_allocations item
      join public.account_move_lines target_line on target_line.id=item.target_account_line_id
      join public.account_moves target_move on target_move.id=target_line.move_id
      where item.tenant_id=p_tenant_id and item.payment_id=p_payment_id)
  );
end
$$;

create or replace function public.list_allocatable_open_items_for_payment(
  p_tenant_id uuid, p_payment_id uuid, p_limit integer default 50, p_offset integer default 0
)
returns table (
  account_line_id uuid, account_move_id uuid, move_name text, move_type text,
  move_reference text, move_date date, due_date date, partner_id uuid,
  account_id uuid, currency_code text, original_amount numeric,
  residual_amount numeric, polarity text, total_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare source jsonb; effective_limit integer := least(greatest(coalesce(p_limit,50),1),200);
  effective_offset integer := greatest(coalesce(p_offset,0),0);
begin
  source := public.resolve_financial_payment_allocation_source(p_tenant_id,p_payment_id);
  perform public.assert_financial_authorized(
    p_tenant_id,'financial.payment.allocate',(source->>'account_id')::uuid,'reconcile',
    nullif(source->>'branch_id','')::uuid,true
  );
  return query
  select line.id,move.id,move.name,move.move_type,move.ref,move.date::date,line.due_date,
    line.partner_id,line.account_id,line.currency_code::text,round(line.debit+line.credit,2),
    round(line.amount_residual,2),case when line.debit>0 then 'debit' else 'credit' end,
    count(*) over()
  from public.account_move_lines line
  join public.account_moves move on move.id=line.move_id and move.tenant_id=line.tenant_id
  join public.account_accounts account on account.id=line.account_id and account.tenant_id=line.tenant_id
  where line.tenant_id=p_tenant_id and line.id<>(source->>'source_line_id')::uuid
    and line.account_id=(source->>'account_id')::uuid
    and line.partner_id=(source->>'partner_id')::uuid
    and line.currency_code=(source->>'currency_code')
    and move.state='posted' and line.parent_state='posted'
    and account.reconcile and account.open_item_reconcile
    and line.amount_residual>0 and not line.is_reconciled
    and (((source->>'polarity')='credit' and line.debit>0 and line.credit=0)
      or ((source->>'polarity')='debit' and line.credit>0 and line.debit=0))
    and public.can_perform_financial_action(
      p_tenant_id,'financial.payment.allocate',line.account_id,'reconcile',move.branch_id,true
    )
  order by coalesce(line.due_date,move.date::date),move.date,line.id
  limit effective_limit offset effective_offset;
end
$$;

create or replace function public.allocate_financial_payment(
  p_tenant_id uuid, p_payment_id uuid, p_target_account_line_id uuid,
  p_amount numeric, p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payment public.financial_payments%rowtype; source jsonb;
  source_line public.account_move_lines%rowtype; target_line public.account_move_lines%rowtype;
  source_move public.account_moves%rowtype; target_move public.account_moves%rowtype;
  account public.account_accounts%rowtype; actor_id uuid := public.current_tenant_user_id();
  requested numeric(18,2); fingerprint text; existing public.financial_payment_allocations%rowtype;
  allocation_id uuid := gen_random_uuid(); partial_id uuid := gen_random_uuid(); result jsonb;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key)='' then
    raise exception using errcode='22023', message='ALLOCATION_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  requested := round(p_amount,2);
  if requested is null or requested<=0 or requested<>p_amount then
    raise exception using errcode='22023', message='ALLOCATION_AMOUNT_INVALID';
  end if;
  fingerprint := encode(extensions.digest(
    concat_ws('|',p_payment_id::text,p_target_account_line_id::text,requested::text),'sha256'
  ),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'financial_payment_allocation:'||p_tenant_id::text||':'||btrim(p_idempotency_key),0));
  select * into existing from public.financial_payment_allocations item
  where item.tenant_id=p_tenant_id and item.idempotency_key=btrim(p_idempotency_key);
  if found then
    if existing.request_fingerprint<>fingerprint then
      raise exception using errcode='23505', message='ALLOCATION_IDEMPOTENCY_KEY_PAYLOAD_MISMATCH';
    end if;
    result := public.get_financial_payment_allocation_summary(p_tenant_id,existing.payment_id);
    return result || jsonb_build_object('allocation_id',existing.id,'idempotent_replay',true);
  end if;

  select * into payment from public.financial_payments item
  where item.id=p_payment_id and item.tenant_id=p_tenant_id for update;
  if not found then raise exception using errcode='P0002', message='FINANCIAL_PAYMENT_NOT_FOUND'; end if;
  source := public.resolve_financial_payment_allocation_source(p_tenant_id,p_payment_id);
  perform public.assert_financial_authorized(
    p_tenant_id,'financial.payment.allocate',(source->>'account_id')::uuid,'reconcile',payment.branch_id,true);
  if actor_id is null then raise exception using errcode='42501', message='ACTIVE_TENANT_MEMBERSHIP_REQUIRED'; end if;

  perform 1 from public.account_move_lines line
  where line.id in ((source->>'source_line_id')::uuid,p_target_account_line_id)
  order by line.id for update;
  select * into source_line from public.account_move_lines where id=(source->>'source_line_id')::uuid;
  select * into target_line from public.account_move_lines where id=p_target_account_line_id;
  if target_line.id is null then raise exception using errcode='P0002', message='TARGET_OPEN_ITEM_NOT_FOUND'; end if;
  select * into source_move from public.account_moves where id=source_line.move_id;
  select * into target_move from public.account_moves where id=target_line.move_id;
  select * into account from public.account_accounts where id=source_line.account_id;
  perform public.assert_financial_authorized(
    p_tenant_id,'financial.payment.allocate',target_line.account_id,'reconcile',target_move.branch_id,true);

  if source_line.tenant_id<>p_tenant_id or target_line.tenant_id<>p_tenant_id
     or source_move.tenant_id<>p_tenant_id or target_move.tenant_id<>p_tenant_id then
    raise exception using errcode='23514', message='CROSS_TENANT_ALLOCATION_FORBIDDEN';
  end if;
  if source_line.partner_id is null or source_line.partner_id<>target_line.partner_id then
    raise exception using errcode='23514', message='ALLOCATION_PARTNER_MISMATCH';
  end if;
  if source_line.account_id<>target_line.account_id then
    raise exception using errcode='23514', message='ALLOCATION_ACCOUNT_MISMATCH';
  end if;
  if not account.reconcile or not account.open_item_reconcile then
    raise exception using errcode='23514', message='ACCOUNT_NOT_OPEN_ITEM_RECONCILABLE';
  end if;
  if source_move.state<>'posted' or target_move.state<>'posted'
     or source_line.parent_state<>'posted' or target_line.parent_state<>'posted' then
    raise exception using errcode='23514', message='ALLOCATION_REQUIRES_POSTED_OPEN_ITEMS';
  end if;
  if source_line.currency_code<>target_line.currency_code then
    raise exception using errcode='23514', message='ALLOCATION_CURRENCY_MISMATCH';
  end if;
  if not ((source_line.debit>0 and source_line.credit=0 and target_line.credit>0 and target_line.debit=0)
    or (source_line.credit>0 and source_line.debit=0 and target_line.debit>0 and target_line.credit=0)) then
    raise exception using errcode='23514', message='ALLOCATION_POLARITY_MISMATCH';
  end if;
  if requested>source_line.amount_residual or requested>target_line.amount_residual then
    raise exception using errcode='23514', message='ALLOCATION_EXCEEDS_AVAILABLE_RESIDUAL';
  end if;

  perform set_config('app.financial_payment_allocation_contract',allocation_id::text,true);
  perform public.create_payment_allocation_partial_reconcile(
    allocation_id,partial_id,p_tenant_id,
    case when source_line.debit>0 then source_line.id else target_line.id end,
    case when source_line.credit>0 then source_line.id else target_line.id end,
    requested,actor_id);
  insert into public.financial_payment_allocations (
    id,tenant_id,payment_id,source_account_line_id,target_account_line_id,
    partial_reconcile_id,amount,status,idempotency_key,request_fingerprint,created_by
  ) values (
    allocation_id,p_tenant_id,p_payment_id,source_line.id,target_line.id,
    partial_id,requested,'active',btrim(p_idempotency_key),fingerprint,actor_id);
  if (select amount_residual from public.account_move_lines where id=source_line.id)
       <> round(source_line.amount_residual-requested,2)
     or (select amount_residual from public.account_move_lines where id=target_line.id)
       <> round(target_line.amount_residual-requested,2) then
    raise exception using errcode='23514', message='ALLOCATION_RESIDUAL_INTEGRITY_FAILURE';
  end if;
  perform set_config('app.financial_payment_allocation_contract','',true);
  result := public.get_financial_payment_allocation_summary(p_tenant_id,p_payment_id);
  return result || jsonb_build_object('allocation_id',allocation_id,'partial_reconcile_id',partial_id,'idempotent_replay',false);
end
$$;

create or replace function public.unallocate_financial_payment_allocation(
  p_tenant_id uuid, p_allocation_id uuid, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare allocation public.financial_payment_allocations%rowtype;
  payment public.financial_payments%rowtype; source_line public.account_move_lines%rowtype;
  target_line public.account_move_lines%rowtype; target_move public.account_moves%rowtype;
  actor_id uuid := public.current_tenant_user_id(); result jsonb;
begin
  if p_reason is null or btrim(p_reason)='' then
    raise exception using errcode='22023', message='UNALLOCATION_REASON_REQUIRED';
  end if;
  select * into allocation from public.financial_payment_allocations item
  where item.id=p_allocation_id and item.tenant_id=p_tenant_id for update;
  if not found then raise exception using errcode='P0002', message='FINANCIAL_PAYMENT_ALLOCATION_NOT_FOUND'; end if;
  select * into payment from public.financial_payments item
  where item.id=allocation.payment_id and item.tenant_id=p_tenant_id for update;
  perform 1 from public.account_move_lines line
  where line.id in (allocation.source_account_line_id,allocation.target_account_line_id)
  order by line.id for update;
  select * into source_line from public.account_move_lines where id=allocation.source_account_line_id;
  select * into target_line from public.account_move_lines where id=allocation.target_account_line_id;
  select * into target_move from public.account_moves where id=target_line.move_id;
  perform public.assert_financial_authorized(
    p_tenant_id,'financial.reconciliation.manage',source_line.account_id,'reconcile',payment.branch_id,
    allocation.status='active');
  perform public.assert_financial_authorized(
    p_tenant_id,'financial.reconciliation.manage',target_line.account_id,'reconcile',target_move.branch_id,true);
  if actor_id is null then raise exception using errcode='42501', message='ACTIVE_TENANT_MEMBERSHIP_REQUIRED'; end if;
  if not exists (select 1 from public.account_partial_reconcile item
    where item.id=allocation.partial_reconcile_id and item.tenant_id=p_tenant_id
      and item.amount=allocation.amount
      and item.debit_move_id in (source_line.id,target_line.id)
      and item.credit_move_id in (source_line.id,target_line.id)) then
    raise exception using errcode='23514', message='ALLOCATION_RECONCILIATION_LINK_INVALID';
  end if;
  perform set_config('app.financial_payment_allocation_contract',allocation.id::text,true);
  perform public.delete_payment_allocation_partial_reconcile(allocation.id,allocation.partial_reconcile_id,p_tenant_id);
  update public.financial_payment_allocations set status='unallocated',
    unallocated_by=actor_id,unallocated_at=now(),unallocation_reason=btrim(p_reason)
  where id=allocation.id;
  if (select amount_residual from public.account_move_lines where id=source_line.id)
       <> round(source_line.amount_residual+allocation.amount,2)
     or (select amount_residual from public.account_move_lines where id=target_line.id)
       <> round(target_line.amount_residual+allocation.amount,2) then
    raise exception using errcode='23514', message='UNALLOCATION_RESIDUAL_INTEGRITY_FAILURE';
  end if;
  perform set_config('app.financial_payment_allocation_contract','',true);
  result := public.get_financial_payment_allocation_summary(p_tenant_id,allocation.payment_id);
  return result || jsonb_build_object('allocation_id',allocation.id,'unallocated',true);
end
$$;

alter table public.financial_payment_allocations enable row level security;
revoke all on public.financial_payment_allocations from public,anon,authenticated;
grant select on public.financial_payment_allocations to authenticated;
create policy financial_payment_allocations_read on public.financial_payment_allocations
for select to authenticated using (
  tenant_id=public.current_tenant_id()
  and (public.has_permission('financial.payment.allocate',tenant_id)
    or public.has_permission('financial.reconciliation.manage',tenant_id))
);

revoke all on function public.guard_financial_payment_allocation() from public,anon,authenticated;
revoke all on function public.resolve_financial_payment_allocation_source(uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_payment_allocation_partial_reconcile(uuid,uuid,uuid,uuid,uuid,numeric,uuid) from public,anon,authenticated;
revoke all on function public.delete_payment_allocation_partial_reconcile(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.list_allocatable_open_items_for_payment(uuid,uuid,integer,integer) from public,anon;
revoke all on function public.allocate_financial_payment(uuid,uuid,uuid,numeric,text) from public,anon;
revoke all on function public.unallocate_financial_payment_allocation(uuid,uuid,text) from public,anon;
revoke all on function public.get_financial_payment_allocation_summary(uuid,uuid) from public,anon;
grant execute on function public.list_allocatable_open_items_for_payment(uuid,uuid,integer,integer) to authenticated;
grant execute on function public.allocate_financial_payment(uuid,uuid,uuid,numeric,text) to authenticated;
grant execute on function public.unallocate_financial_payment_allocation(uuid,uuid,text) to authenticated;
grant execute on function public.get_financial_payment_allocation_summary(uuid,uuid) to authenticated;

comment on table public.financial_payment_allocations is
  'Canonical business trace from a posted payment open item to a target ledger open item. Allocation creates no journal entry.';
comment on column public.financial_payment_allocations.partial_reconcile_id is
  'Immutable ledger reconciliation identity retained after unallocation for audit; intentionally no FK because unallocation deletes that ledger link.';
comment on function public.allocate_financial_payment(uuid,uuid,uuid,numeric,text) is
  'Atomic idempotent payment allocation. Source is derived internally; lines lock in UUID order; exact over-residual requests fail.';
comment on function public.unallocate_financial_payment_allocation(uuid,uuid,text) is
  'Authorized atomic removal of the linked partial reconciliation with residual restoration and immutable lifecycle history.';
comment on function public.list_allocatable_open_items_for_payment(uuid,uuid,integer,integer) is
  'Paged app-neutral ledger discovery restricted to same tenant, partner, account, currency, opposite polarity and posted residual.';

commit;
