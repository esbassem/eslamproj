begin;

-- Phase 5: canonical, app-neutral movement of company-owned liquidity.
insert into public.account_functional_role_definitions (
  functional_role,resolution_kind,expected_semantic_key,allowed_canonical_types,
  allowed_reporting_categories,requires_open_item_reconcile,description
) values (
  'cash_in_transit','functional','cash_in_transit',array['liquidity'],
  array['cash_and_cash_equivalents'],false,
  'Company cash physically dispatched between controlled resources but not yet received. This is not suspense.'
) on conflict (functional_role) do nothing;

-- Publish a new immutable chart version. Existing installations and legacy charts
-- are deliberately not mutated; they may configure the role explicitly at cutover.
insert into public.canonical_chart_templates(template_key,version,name,description,status)
select template_key,3,'General Trading — Canonical Chart v3',
  'Adds required Cash In Transit for canonical two-step internal transfers.','draft'
from public.canonical_chart_templates where template_key='general_trading' and version=2;

insert into public.canonical_chart_template_groups(
  template_id,group_key,parent_group_key,name,suggested_code_prefix,sort_order,required
)
select target.id,item.group_key,item.parent_group_key,item.name,item.suggested_code_prefix,item.sort_order,item.required
from public.canonical_chart_template_groups item
join public.canonical_chart_templates source on source.id=item.template_id and source.template_key='general_trading' and source.version=2
join public.canonical_chart_templates target on target.template_key='general_trading' and target.version=3;

insert into public.canonical_chart_template_accounts(
  template_id,template_account_key,group_key,name,suggested_code,canonical_account_type,
  statement_section,reporting_category,normal_balance,pnl_category,open_item_reconcile,
  statement_reconcile,provisioning_policy,feature_key,functional_role,sort_order
)
select target.id,item.template_account_key,item.group_key,item.name,item.suggested_code,item.canonical_account_type,
  item.statement_section,item.reporting_category,item.normal_balance,item.pnl_category,item.open_item_reconcile,
  item.statement_reconcile,item.provisioning_policy,item.feature_key,item.functional_role,item.sort_order
from public.canonical_chart_template_accounts item
join public.canonical_chart_templates source on source.id=item.template_id and source.template_key='general_trading' and source.version=2
join public.canonical_chart_templates target on target.template_key='general_trading' and target.version=3;

insert into public.canonical_chart_template_accounts(
  template_id,template_account_key,group_key,name,suggested_code,canonical_account_type,
  statement_section,reporting_category,normal_balance,open_item_reconcile,
  statement_reconcile,provisioning_policy,functional_role,sort_order
)
select id,'cash_in_transit','liquidity_resources','Cash In Transit','111600','liquidity',
  'balance_sheet','cash_and_cash_equivalents','debit',false,false,'required','cash_in_transit',735
from public.canonical_chart_templates where template_key='general_trading' and version=3;

update public.canonical_chart_templates set status='retired'
where template_key='general_trading' and version=2 and status='active';
update public.canonical_chart_templates set status='active'
where template_key='general_trading' and version=3 and status='draft';

create table public.financial_internal_transfer_sequences(
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sequence_year integer not null,
  next_number bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key(tenant_id,sequence_year),
  check(sequence_year between 2000 and 9999), check(next_number>0)
);

create table public.financial_internal_transfers(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  transfer_number text not null,
  source_destination_id uuid not null,
  destination_destination_id uuid not null,
  amount numeric(18,2) not null,
  currency_code varchar(3) not null default 'EGP',
  source_branch_id uuid,
  destination_branch_id uuid,
  transfer_mode text not null,
  status text not null default 'draft',
  reference_number text,
  notes text,
  idempotency_key text not null,
  request_fingerprint text not null,
  created_by uuid not null,
  sent_by uuid, sent_at timestamptz,
  received_by uuid, received_at timestamptz,
  confirmed_by uuid, confirmed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(source_destination_id,tenant_id) references public.money_destinations(id,tenant_id) on delete restrict,
  foreign key(destination_destination_id,tenant_id) references public.money_destinations(id,tenant_id) on delete restrict,
  foreign key(source_branch_id,tenant_id) references public.branches(id,tenant_id) on delete restrict,
  foreign key(destination_branch_id,tenant_id) references public.branches(id,tenant_id) on delete restrict,
  foreign key(created_by,tenant_id) references public.tenant_users(id,tenant_id) on delete restrict,
  foreign key(sent_by,tenant_id) references public.tenant_users(id,tenant_id) on delete restrict,
  foreign key(received_by,tenant_id) references public.tenant_users(id,tenant_id) on delete restrict,
  foreign key(confirmed_by,tenant_id) references public.tenant_users(id,tenant_id) on delete restrict,
  unique(tenant_id,transfer_number), unique(tenant_id,idempotency_key), unique(id,tenant_id),
  check(amount>0), check(source_destination_id<>destination_destination_id),
  check(currency_code ~ '^[A-Z]{3}$'), check(transfer_mode in ('immediate','in_transit')),
  check(status in ('draft','sent','received','confirmed')),
  check(transfer_number ~ '^TRF-[0-9]{4}-[0-9]{6,}$'),
  check(btrim(idempotency_key)<>''), check(request_fingerprint ~ '^[0-9a-f]{64}$'),
  check(
    (status='draft' and sent_at is null and received_at is null and confirmed_at is null) or
    (transfer_mode='in_transit' and status='sent' and sent_at is not null and received_at is null and confirmed_at is null) or
    (transfer_mode='in_transit' and status='received' and sent_at is not null and received_at is not null and confirmed_at is null) or
    (transfer_mode='in_transit' and status='confirmed' and sent_at is not null and received_at is not null and confirmed_at is not null) or
    (transfer_mode='immediate' and status='confirmed' and sent_at is null and received_at is null and confirmed_at is not null)
  )
);
create index financial_internal_transfers_query_idx on public.financial_internal_transfers(tenant_id,created_at desc,id desc);
create index financial_internal_transfers_status_idx on public.financial_internal_transfers(tenant_id,status,transfer_mode,created_at desc);
create index financial_internal_transfers_source_idx on public.financial_internal_transfers(tenant_id,source_destination_id,created_at desc);
create index financial_internal_transfers_destination_idx on public.financial_internal_transfers(tenant_id,destination_destination_id,created_at desc);

create table public.financial_internal_transfer_accounting_links(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  transfer_id uuid not null, account_move_id uuid not null, entry_type text not null,
  created_by uuid not null, created_at timestamptz not null default now(),
  foreign key(transfer_id,tenant_id) references public.financial_internal_transfers(id,tenant_id) on delete restrict,
  foreign key(account_move_id,tenant_id) references public.account_moves(id,tenant_id) on delete restrict,
  foreign key(created_by,tenant_id) references public.tenant_users(id,tenant_id) on delete restrict,
  unique(tenant_id,transfer_id,entry_type), unique(tenant_id,account_move_id),
  check(entry_type in ('immediate','send','receive'))
);

create table public.financial_internal_transfer_events(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, transfer_id uuid not null,
  event_type text not null, from_status text, to_status text not null, actor_user_id uuid not null,
  idempotency_key text not null, request_fingerprint text not null,
  reason text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  foreign key(transfer_id,tenant_id) references public.financial_internal_transfers(id,tenant_id) on delete restrict,
  foreign key(actor_user_id,tenant_id) references public.tenant_users(id,tenant_id) on delete restrict,
  unique(tenant_id,transfer_id,event_type), unique(tenant_id,idempotency_key),
  check(event_type in ('created','sent','received','confirmed')),
  check(to_status in ('draft','sent','received','confirmed')),
  check(from_status is null or from_status in ('draft','sent','received')),
  check(btrim(idempotency_key)<>''), check(request_fingerprint ~ '^[0-9a-f]{64}$'), check(jsonb_typeof(metadata)='object')
);
create index financial_internal_transfer_events_history_idx on public.financial_internal_transfer_events(tenant_id,transfer_id,created_at,id);

create or replace function public.guard_internal_transfer_mutation() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='DELETE' then raise exception using errcode='23514',message='INTERNAL_TRANSFER_DELETE_FORBIDDEN'; end if;
  new.currency_code:=upper(btrim(new.currency_code)); new.reference_number:=nullif(btrim(new.reference_number),'');
  new.notes:=nullif(btrim(new.notes),''); new.updated_at:=now();
  if tg_op='UPDATE' then
    if new.tenant_id is distinct from old.tenant_id or new.transfer_number is distinct from old.transfer_number
      or new.idempotency_key is distinct from old.idempotency_key or new.request_fingerprint is distinct from old.request_fingerprint
      or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception using errcode='23514',message='INTERNAL_TRANSFER_IDENTITY_IMMUTABLE'; end if;
    if old.status<>'draft' and (new.source_destination_id is distinct from old.source_destination_id
      or new.destination_destination_id is distinct from old.destination_destination_id or new.amount is distinct from old.amount
      or new.currency_code is distinct from old.currency_code or new.transfer_mode is distinct from old.transfer_mode
      or new.source_branch_id is distinct from old.source_branch_id or new.destination_branch_id is distinct from old.destination_branch_id) then
      raise exception using errcode='23514',message='ACCOUNTED_INTERNAL_TRANSFER_IMMUTABLE'; end if;
    if new.status is distinct from old.status and not ((old.status='draft' and new.transfer_mode='immediate' and new.status='confirmed')
      or (old.status='draft' and new.transfer_mode='in_transit' and new.status='sent')
      or (old.status='sent' and new.transfer_mode='in_transit' and new.status='received')
      or (old.status='received' and new.transfer_mode='in_transit' and new.status='confirmed')) then
      raise exception using errcode='23514',message='INTERNAL_TRANSFER_STATE_TRANSITION_INVALID'; end if;
  end if; return new;
end $$;
create trigger financial_internal_transfers_guard before insert or update or delete on public.financial_internal_transfers
for each row execute function public.guard_internal_transfer_mutation();

create or replace function public.guard_internal_transfer_append_only() returns trigger
language plpgsql set search_path=pg_catalog,public as $$ begin
  if tg_op<>'INSERT' then raise exception using errcode='23514',message='INTERNAL_TRANSFER_AUDIT_IMMUTABLE'; end if;
  return new; end $$;
create trigger financial_internal_transfer_links_guard before update or delete on public.financial_internal_transfer_accounting_links
for each row execute function public.guard_internal_transfer_append_only();
create trigger financial_internal_transfer_events_guard before update or delete on public.financial_internal_transfer_events
for each row execute function public.guard_internal_transfer_append_only();

create or replace function public.next_internal_transfer_number(p_tenant_id uuid) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare y integer:=extract(year from current_date)::integer; n bigint; begin
  insert into public.financial_internal_transfer_sequences(tenant_id,sequence_year,next_number) values(p_tenant_id,y,2)
  on conflict(tenant_id,sequence_year) do update set next_number=public.financial_internal_transfer_sequences.next_number+1,updated_at=now()
  returning next_number-1 into n; return 'TRF-'||y::text||'-'||lpad(n::text,6,'0'); end $$;

create or replace function public.internal_transfer_fingerprint(p_payload jsonb) returns text
language sql immutable set search_path=pg_catalog,public as $$ select encode(extensions.digest(p_payload::text,'sha256'),'hex') $$;

create or replace function public.resolve_internal_transfer_destination(
  p_tenant_id uuid,p_destination_id uuid,p_permission text,p_access text,p_branch_id uuid
) returns table(destination_id uuid,destination_name text,destination_type text,branch_id uuid,ledger_account_id uuid,journal_id uuid)
language plpgsql stable security definer set search_path=pg_catalog,public as $$ begin
  perform public.assert_financial_authorized(p_tenant_id,p_permission,p_destination_id,p_access,p_branch_id,true);
  return query select d.id,d.name,d.destination_type,d.branch_id,d.ledger_account_id,d.journal_id
  from public.money_destinations d join public.account_accounts a on a.id=d.ledger_account_id and a.tenant_id=d.tenant_id
  join public.account_journals j on j.id=d.journal_id and j.tenant_id=d.tenant_id
  where d.id=p_destination_id and d.tenant_id=p_tenant_id and d.status='active'
    and (p_branch_id is null or d.branch_id is null or d.branch_id=p_branch_id)
    and a.active and a.is_posting and a.account_origin='resource' and a.normal_balance='debit'
    and not a.open_item_reconcile and j.is_active and j.default_account_id=a.id
    and public.has_financial_resource_access(p_tenant_id,a.id,p_access,coalesce(p_branch_id,d.branch_id));
  if not found then raise exception using errcode='42501',message='INTERNAL_TRANSFER_DESTINATION_NOT_ALLOWED'; end if;
end $$;

create or replace function public.create_internal_transfer(
 p_tenant_id uuid,p_source_destination_id uuid,p_destination_destination_id uuid,p_amount numeric,
 p_transfer_mode text,p_idempotency_key text,p_currency_code text default 'EGP',p_source_branch_id uuid default null,
 p_destination_branch_id uuid default null,p_reference_number text default null,p_notes text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_tenant_user_id(); existing public.financial_internal_transfers%rowtype;
 fp text; tid uuid; num text; src record; dst record; payload jsonb; begin
  if round(coalesce(p_amount,0),2)<=0 then raise exception using errcode='22023',message='INTERNAL_TRANSFER_AMOUNT_MUST_BE_POSITIVE'; end if;
  if p_source_destination_id=p_destination_destination_id then raise exception using errcode='23514',message='INTERNAL_TRANSFER_SAME_DESTINATION_FORBIDDEN'; end if;
  if lower(btrim(coalesce(p_transfer_mode,''))) not in ('immediate','in_transit') then raise exception using errcode='22023',message='INTERNAL_TRANSFER_MODE_INVALID'; end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception using errcode='22023',message='INTERNAL_TRANSFER_IDEMPOTENCY_KEY_REQUIRED'; end if;
  payload:=jsonb_build_object('amount',round(p_amount,2),'currency',upper(btrim(coalesce(p_currency_code,'EGP'))),'mode',lower(btrim(p_transfer_mode)),
    'source',p_source_destination_id,'destination',p_destination_destination_id,'source_branch',p_source_branch_id,'destination_branch',p_destination_branch_id,
    'reference',nullif(btrim(p_reference_number),''),'notes',nullif(btrim(p_notes),'')); fp:=public.internal_transfer_fingerprint(payload);
  perform pg_advisory_xact_lock(hashtextextended('internal_transfer:create:'||p_tenant_id::text||':'||btrim(p_idempotency_key),0));
  select * into existing from public.financial_internal_transfers t where t.tenant_id=p_tenant_id and t.idempotency_key=btrim(p_idempotency_key);
  if found then if existing.request_fingerprint<>fp then raise exception using errcode='23505',message='INTERNAL_TRANSFER_IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('transfer_id',existing.id,'transfer_number',existing.transfer_number,'status',existing.status,'idempotent_replay',true); end if;
  select * into src from public.resolve_internal_transfer_destination(p_tenant_id,p_source_destination_id,'financial.transfer.create','transfer_from',p_source_branch_id);
  select * into dst from public.resolve_internal_transfer_destination(p_tenant_id,p_destination_destination_id,'financial.transfer.create','transfer_to',p_destination_branch_id);
  if coalesce(p_source_branch_id,src.branch_id) is distinct from src.branch_id or coalesce(p_destination_branch_id,dst.branch_id) is distinct from dst.branch_id then
    raise exception using errcode='23514',message='INTERNAL_TRANSFER_BRANCH_MISMATCH'; end if;
  num:=public.next_internal_transfer_number(p_tenant_id);
  insert into public.financial_internal_transfers(tenant_id,transfer_number,source_destination_id,destination_destination_id,amount,currency_code,
    source_branch_id,destination_branch_id,transfer_mode,idempotency_key,request_fingerprint,reference_number,notes,created_by)
  values(p_tenant_id,num,p_source_destination_id,p_destination_destination_id,round(p_amount,2),upper(btrim(coalesce(p_currency_code,'EGP'))),
    src.branch_id,dst.branch_id,lower(btrim(p_transfer_mode)),btrim(p_idempotency_key),fp,p_reference_number,p_notes,actor) returning id into tid;
  insert into public.financial_internal_transfer_events(tenant_id,transfer_id,event_type,from_status,to_status,actor_user_id,idempotency_key,request_fingerprint,metadata)
  values(p_tenant_id,tid,'created',null,'draft',actor,btrim(p_idempotency_key),fp,payload);
  return jsonb_build_object('transfer_id',tid,'transfer_number',num,'status','draft','idempotent_replay',false); end $$;

create or replace function public.create_internal_transfer_move(
 p_tenant_id uuid,p_transfer_id uuid,p_transfer_number text,p_entry_type text,p_amount numeric,p_currency text,
 p_debit_account uuid,p_credit_account uuid,p_journal uuid,p_branch uuid,p_actor uuid
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare mid uuid:=gen_random_uuid(); begin
  if current_setting('app.internal_transfer_contract',true) is distinct from p_transfer_id::text then raise exception using errcode='42501',message='TRANSFER_MOVE_REQUIRES_CONTRACT'; end if;
  if p_debit_account=p_credit_account then raise exception using errcode='23514',message='TRANSFER_ACCOUNTS_MUST_DIFFER'; end if;
  insert into public.account_moves(id,tenant_id,branch_id,journal_id,name,move_type,invoice_date,date,amount_total,state,ref,notes,pay_method,currency_code,created_by)
  values(mid,p_tenant_id,p_branch,p_journal,'TRANSFER-'||p_transfer_number||'-'||upper(p_entry_type),'entry',current_date,now(),round(p_amount,2),'posted',
    'financial_internal_transfer:'||p_transfer_id,'entry_type='||p_entry_type,'canonical_internal_transfer',p_currency,p_actor);
  insert into public.account_move_lines(tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
  values(p_tenant_id,mid,p_debit_account,p_transfer_number||' — debit',1,p_amount,p_amount,0,'liquidity',true,0,0,'posted',p_currency,p_actor),
        (p_tenant_id,mid,p_credit_account,p_transfer_number||' — credit',1,p_amount,0,p_amount,'liquidity',true,0,0,'posted',p_currency,p_actor);
  perform public.accounting_assert_move_balanced(mid); return mid; end $$;

create or replace function public.transition_internal_transfer(p_tenant_id uuid,p_transfer_id uuid,p_action text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare t public.financial_internal_transfers%rowtype; actor uuid:=public.current_tenant_user_id(); fp text; event public.financial_internal_transfer_events%rowtype;
 src record; dst record; transit uuid; mid uuid; next_status text; entry text; permission text; access text; branch uuid; begin
  if lower(p_action) not in ('send','receive','confirm') then raise exception using errcode='22023',message='INTERNAL_TRANSFER_ACTION_INVALID'; end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception using errcode='22023',message='INTERNAL_TRANSFER_IDEMPOTENCY_KEY_REQUIRED'; end if;
  fp:=public.internal_transfer_fingerprint(jsonb_build_object('transfer_id',p_transfer_id,'action',lower(p_action)));
  perform pg_advisory_xact_lock(hashtextextended('internal_transfer:transition:'||p_tenant_id::text||':'||p_transfer_id::text,0));
  select * into t from public.financial_internal_transfers x where x.id=p_transfer_id and x.tenant_id=p_tenant_id for update;
  if not found then raise exception using errcode='P0002',message='INTERNAL_TRANSFER_NOT_FOUND'; end if;
  select * into event from public.financial_internal_transfer_events e where e.tenant_id=p_tenant_id and e.idempotency_key=btrim(p_idempotency_key);
  if found then if event.transfer_id<>p_transfer_id or event.event_type<>lower(p_action) or event.request_fingerprint<>fp then raise exception using errcode='23505',message='INTERNAL_TRANSFER_IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    select account_move_id into mid from public.financial_internal_transfer_accounting_links l where l.tenant_id=p_tenant_id and l.transfer_id=p_transfer_id and l.entry_type=case when p_action='confirm' and t.transfer_mode='immediate' then 'immediate' else p_action end;
    return jsonb_build_object('transfer_id',t.id,'status',t.status,'account_move_id',mid,'idempotent_replay',true); end if;
  if p_action='send' then permission:='financial.transfer.send'; access:='transfer_from'; branch:=t.source_branch_id; next_status:='sent'; entry:='send';
    if t.transfer_mode<>'in_transit' or t.status<>'draft' then raise exception using errcode='23514',message='INTERNAL_TRANSFER_SEND_STATE_INVALID'; end if;
  elsif p_action='receive' then permission:='financial.transfer.receive'; access:='transfer_to'; branch:=t.destination_branch_id; next_status:='received'; entry:='receive';
    if t.transfer_mode<>'in_transit' or t.status<>'sent' then raise exception using errcode='23514',message='INTERNAL_TRANSFER_RECEIVE_STATE_INVALID'; end if;
  else permission:='financial.transfer.confirm'; access:='transfer_to'; branch:=t.destination_branch_id; next_status:='confirmed'; entry:='immediate';
    if not ((t.transfer_mode='immediate' and t.status='draft') or (t.transfer_mode='in_transit' and t.status='received')) then raise exception using errcode='23514',message='INTERNAL_TRANSFER_CONFIRM_STATE_INVALID'; end if;
  end if;
  perform 1 from public.money_destinations d where d.tenant_id=p_tenant_id
    and d.id in (t.source_destination_id,t.destination_destination_id) order by d.id for update;
  select * into src from public.resolve_internal_transfer_destination(p_tenant_id,t.source_destination_id,permission,'transfer_from',t.source_branch_id);
  select * into dst from public.resolve_internal_transfer_destination(p_tenant_id,t.destination_destination_id,permission,'transfer_to',t.destination_branch_id);
  perform set_config('app.internal_transfer_contract',t.id::text,true);
  if t.transfer_mode='immediate' then
    mid:=public.create_internal_transfer_move(p_tenant_id,t.id,t.transfer_number,'immediate',t.amount,t.currency_code,dst.ledger_account_id,src.ledger_account_id,src.journal_id,t.source_branch_id,actor);
  elsif p_action in ('send','receive') then
    transit:=public.resolve_functional_account(p_tenant_id,'cash_in_transit',null);
    if p_action='send' then mid:=public.create_internal_transfer_move(p_tenant_id,t.id,t.transfer_number,'send',t.amount,t.currency_code,transit,src.ledger_account_id,src.journal_id,t.source_branch_id,actor);
    else mid:=public.create_internal_transfer_move(p_tenant_id,t.id,t.transfer_number,'receive',t.amount,t.currency_code,dst.ledger_account_id,transit,dst.journal_id,t.destination_branch_id,actor); end if;
  end if;
  if mid is not null then insert into public.financial_internal_transfer_accounting_links(tenant_id,transfer_id,account_move_id,entry_type,created_by)
    values(p_tenant_id,t.id,mid,entry,actor); end if;
  if p_action='send' then update public.financial_internal_transfers set status='sent',sent_by=actor,sent_at=now() where id=t.id;
  elsif p_action='receive' then update public.financial_internal_transfers set status='received',received_by=actor,received_at=now() where id=t.id;
  else update public.financial_internal_transfers set status='confirmed',confirmed_by=actor,confirmed_at=now() where id=t.id; end if;
  insert into public.financial_internal_transfer_events(tenant_id,transfer_id,event_type,from_status,to_status,actor_user_id,idempotency_key,request_fingerprint,metadata)
  values(p_tenant_id,t.id,lower(p_action),t.status,next_status,actor,btrim(p_idempotency_key),fp,jsonb_build_object('account_move_id',mid,'ledger_effect',mid is not null));
  return jsonb_build_object('transfer_id',t.id,'status',next_status,'account_move_id',mid,'idempotent_replay',false); end $$;

create or replace function public.send_internal_transfer(uuid,uuid,text) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.transition_internal_transfer($1,$2,'send',$3) $$;
create or replace function public.receive_internal_transfer(uuid,uuid,text) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.transition_internal_transfer($1,$2,'receive',$3) $$;
create or replace function public.confirm_internal_transfer(uuid,uuid,text) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.transition_internal_transfer($1,$2,'confirm',$3) $$;

create or replace function public.get_internal_transfer(p_tenant_id uuid,p_transfer_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('transfer',to_jsonb(t),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.financial_internal_transfer_events e where e.transfer_id=t.id and e.tenant_id=t.tenant_id),'[]'),
 'accounting_links',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at,l.id) from public.financial_internal_transfer_accounting_links l where l.transfer_id=t.id and l.tenant_id=t.tenant_id),'[]'))
 from public.financial_internal_transfers t where t.id=p_transfer_id and t.tenant_id=p_tenant_id and public.current_tenant_id()=p_tenant_id
 and (public.has_permission('financial.transfer.create',p_tenant_id) or public.has_permission('financial.transfer.send',p_tenant_id) or public.has_permission('financial.transfer.receive',p_tenant_id) or public.has_permission('financial.transfer.confirm',p_tenant_id)) $$;

create or replace function public.list_internal_transfers(p_tenant_id uuid,p_status text default null,p_mode text default null,p_limit integer default 50,p_offset integer default 0)
returns setof public.financial_internal_transfers language sql stable security definer set search_path=pg_catalog,public as $$
 select t.* from public.financial_internal_transfers t where t.tenant_id=p_tenant_id and public.current_tenant_id()=p_tenant_id
 and (public.has_permission('financial.transfer.create',p_tenant_id) or public.has_permission('financial.transfer.send',p_tenant_id) or public.has_permission('financial.transfer.receive',p_tenant_id) or public.has_permission('financial.transfer.confirm',p_tenant_id))
 and (p_status is null or t.status=p_status) and (p_mode is null or t.transfer_mode=p_mode)
 order by t.created_at desc,t.id desc limit least(greatest(coalesce(p_limit,50),1),100) offset greatest(coalesce(p_offset,0),0) $$;

alter table public.financial_internal_transfer_sequences enable row level security;
alter table public.financial_internal_transfers enable row level security;
alter table public.financial_internal_transfer_accounting_links enable row level security;
alter table public.financial_internal_transfer_events enable row level security;
revoke all on public.financial_internal_transfer_sequences,public.financial_internal_transfers,public.financial_internal_transfer_accounting_links,public.financial_internal_transfer_events from public,anon,authenticated;
grant select on public.financial_internal_transfers,public.financial_internal_transfer_accounting_links,public.financial_internal_transfer_events to authenticated;
create policy financial_internal_transfers_read on public.financial_internal_transfers for select to authenticated using(tenant_id=public.current_tenant_id() and (public.has_permission('financial.transfer.create',tenant_id) or public.has_permission('financial.transfer.send',tenant_id) or public.has_permission('financial.transfer.receive',tenant_id) or public.has_permission('financial.transfer.confirm',tenant_id)));
create policy financial_internal_transfer_links_read on public.financial_internal_transfer_accounting_links for select to authenticated using(tenant_id=public.current_tenant_id() and exists(select 1 from public.financial_internal_transfers t where t.id=transfer_id and t.tenant_id=tenant_id));
create policy financial_internal_transfer_events_read on public.financial_internal_transfer_events for select to authenticated using(tenant_id=public.current_tenant_id() and exists(select 1 from public.financial_internal_transfers t where t.id=transfer_id and t.tenant_id=tenant_id));

revoke all on function public.next_internal_transfer_number(uuid),public.internal_transfer_fingerprint(jsonb),public.resolve_internal_transfer_destination(uuid,uuid,text,text,uuid),public.create_internal_transfer_move(uuid,uuid,text,text,numeric,text,uuid,uuid,uuid,uuid,uuid),public.transition_internal_transfer(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.create_internal_transfer(uuid,uuid,uuid,numeric,text,text,text,uuid,uuid,text,text),public.send_internal_transfer(uuid,uuid,text),public.receive_internal_transfer(uuid,uuid,text),public.confirm_internal_transfer(uuid,uuid,text),public.get_internal_transfer(uuid,uuid),public.list_internal_transfers(uuid,text,text,integer,integer) from public,anon;
grant execute on function public.create_internal_transfer(uuid,uuid,uuid,numeric,text,text,text,uuid,uuid,text,text),public.send_internal_transfer(uuid,uuid,text),public.receive_internal_transfer(uuid,uuid,text),public.confirm_internal_transfer(uuid,uuid,text),public.get_internal_transfer(uuid,uuid),public.list_internal_transfers(uuid,text,text,integer,integer) to authenticated;

comment on table public.financial_internal_transfers is 'Canonical Phase 5 company-liquidity transfer. No partner, payment, revenue, expense, allocation or reconciliation semantics.';
comment on function public.transition_internal_transfer(uuid,uuid,text,text) is 'Atomic lifecycle engine: locks transfer, validates both scoped resources, posts balanced move(s), links, transitions and appends an idempotent event.';
comment on column public.financial_internal_transfers.transfer_mode is 'immediate posts destination Dr/source Cr on confirm; in_transit posts transit Dr/source Cr on send and destination Dr/transit Cr on receive.';

commit;
