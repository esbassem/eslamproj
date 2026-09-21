begin;

create table public.financial_advance_applications(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  advance_payment_id uuid not null,
  advance_source_line_id uuid not null,
  target_account_line_id uuid not null,
  reclassification_move_id uuid not null,
  reclassified_advance_line_id uuid not null,
  reclassified_target_line_id uuid not null,
  advance_partial_reconcile_id uuid not null,
  target_partial_reconcile_id uuid not null,
  application_type text not null,
  amount numeric(18,2) not null,
  currency_code varchar(3) not null,
  status text not null default 'active',
  idempotency_key text not null,
  request_fingerprint text not null,
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key(advance_payment_id,tenant_id) references public.financial_payments(id,tenant_id) on delete restrict,
  foreign key(advance_source_line_id,tenant_id) references public.account_move_lines(id,tenant_id) on delete restrict,
  foreign key(target_account_line_id,tenant_id) references public.account_move_lines(id,tenant_id) on delete restrict,
  foreign key(reclassification_move_id,tenant_id) references public.account_moves(id,tenant_id) on delete restrict,
  foreign key(reclassified_advance_line_id,tenant_id) references public.account_move_lines(id,tenant_id) on delete restrict,
  foreign key(reclassified_target_line_id,tenant_id) references public.account_move_lines(id,tenant_id) on delete restrict,
  foreign key(advance_partial_reconcile_id) references public.account_partial_reconcile(id) on delete restrict,
  foreign key(target_partial_reconcile_id) references public.account_partial_reconcile(id) on delete restrict,
  foreign key(created_by,tenant_id) references public.tenant_users(id,tenant_id) on delete restrict,
  unique(tenant_id,idempotency_key),
  unique(tenant_id,reclassification_move_id),
  unique(advance_partial_reconcile_id), unique(target_partial_reconcile_id),
  unique(id,tenant_id),
  check(application_type in ('customer','supplier')),
  check(amount>0), check(currency_code ~ '^[A-Z]{3}$'),
  check(status='active'), check(btrim(idempotency_key)<>''),
  check(request_fingerprint ~ '^[0-9a-f]{64}$')
);
create index financial_advance_applications_payment_idx on public.financial_advance_applications(tenant_id,advance_payment_id,created_at,id);
create index financial_advance_applications_target_idx on public.financial_advance_applications(tenant_id,target_account_line_id,created_at,id);

create table public.financial_advance_application_events(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  application_id uuid not null, event_type text not null,
  actor_user_id uuid not null, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(application_id,tenant_id) references public.financial_advance_applications(id,tenant_id) on delete restrict,
  foreign key(actor_user_id,tenant_id) references public.tenant_users(id,tenant_id) on delete restrict,
  check(event_type='applied'), check(jsonb_typeof(metadata)='object')
);
create index financial_advance_application_events_history_idx on public.financial_advance_application_events(tenant_id,application_id,created_at,id);

create or replace function public.guard_financial_advance_application() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op<>'INSERT' then raise exception using errcode='23514',message='FINANCIAL_ADVANCE_APPLICATION_IMMUTABLE'; end if;
  if current_setting('app.financial_advance_application_contract',true) is distinct from new.id::text then
    raise exception using errcode='42501',message='FINANCIAL_ADVANCE_APPLICATION_REQUIRES_CONTRACT'; end if;
  new.idempotency_key:=btrim(new.idempotency_key);new.notes:=nullif(btrim(new.notes),'');return new;
end $$;
create trigger financial_advance_applications_guard before insert or update or delete on public.financial_advance_applications
for each row execute function public.guard_financial_advance_application();

create or replace function public.guard_financial_advance_application_event() returns trigger
language plpgsql set search_path=pg_catalog,public as $$ begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='FINANCIAL_ADVANCE_APPLICATION_EVENT_IMMUTABLE';end if;
 if current_setting('app.financial_advance_application_contract',true) is distinct from new.application_id::text then
  raise exception using errcode='42501',message='FINANCIAL_ADVANCE_APPLICATION_EVENT_REQUIRES_CONTRACT';end if;return new;end $$;
create trigger financial_advance_application_events_guard before insert or update or delete on public.financial_advance_application_events
for each row execute function public.guard_financial_advance_application_event();

create or replace function public.resolve_financial_advance_source(p_tenant_id uuid,p_payment_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare payment public.financial_payments%rowtype;line public.account_move_lines%rowtype;move public.account_moves%rowtype;
 expected uuid; cnt integer; kind text; target_role text; advance_role text;
begin
 select * into payment from public.financial_payments p where p.id=p_payment_id and p.tenant_id=p_tenant_id;
 if not found then raise exception using errcode='P0002',message='FINANCIAL_PAYMENT_NOT_FOUND';end if;
 if payment.status<>'confirmed' or payment.accounting_state<>'posted' then raise exception using errcode='23514',message='ADVANCE_PAYMENT_NOT_POSTED';end if;
 if payment.payment_purpose='customer_advance' then kind:='customer';advance_role:='customer_advance';target_role:='customer_receivable';
 elsif payment.payment_purpose='supplier_advance' then kind:='supplier';advance_role:='supplier_advance';target_role:='supplier_payable';
 else raise exception using errcode='23514',message='PAYMENT_IS_NOT_CANONICAL_ADVANCE';end if;
 if payment.partner_id is null then raise exception using errcode='23514',message='ADVANCE_PAYMENT_PARTNER_REQUIRED';end if;
 select m.* into move from public.financial_payment_accounting_links l join public.account_moves m on m.id=l.account_move_id and m.tenant_id=l.tenant_id
 where l.tenant_id=p_tenant_id and l.payment_id=p_payment_id and l.entry_type='posting' and m.state='posted';
 if not found then raise exception using errcode='23514',message='ADVANCE_PAYMENT_POSTING_LINK_MISSING';end if;
 expected:=public.resolve_functional_account(p_tenant_id,advance_role,payment.branch_id);
 select count(*),(array_agg(l.id))[1] into cnt,line.id from public.account_move_lines l join public.account_accounts a on a.id=l.account_id and a.tenant_id=l.tenant_id
 where l.tenant_id=p_tenant_id and l.move_id=move.id and l.account_id=expected and l.partner_id=payment.partner_id
 and l.line_type='open_item' and a.reconcile and a.open_item_reconcile
 and ((kind='customer' and l.credit>0 and l.debit=0) or(kind='supplier' and l.debit>0 and l.credit=0));
 if cnt<>1 then raise exception using errcode='23514',message='ADVANCE_SOURCE_OPEN_ITEM_NOT_UNIQUE';end if;
 select * into line from public.account_move_lines l where l.id=line.id;
 return jsonb_build_object('payment_id',payment.id,'payment_number',payment.payment_number,'application_type',kind,
  'advance_role',advance_role,'target_role',target_role,'partner_id',payment.partner_id,'branch_id',payment.branch_id,
  'source_line_id',line.id,'source_account_id',line.account_id,'currency_code',line.currency_code,
  'original_amount',round(line.debit+line.credit,2),'remaining_amount',round(line.amount_residual,2));
end $$;

create or replace function public.list_allocatable_targets_for_advance(
 p_tenant_id uuid,p_advance_payment_id uuid,p_limit integer default 50,p_offset integer default 0
) returns table(target_line_id uuid,move_id uuid,document_reference text,document_date date,branch_id uuid,
 original_amount numeric,residual_amount numeric,currency_code text,total_count bigint)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare source jsonb;target_account uuid;begin
 source:=public.resolve_financial_advance_source(p_tenant_id,p_advance_payment_id);
 target_account:=public.resolve_functional_account(p_tenant_id,source->>'target_role',nullif(source->>'branch_id','')::uuid);
 perform public.assert_financial_authorized(p_tenant_id,'financial.payment.allocate',target_account,'reconcile',nullif(source->>'branch_id','')::uuid,true);
 return query select l.id,m.id,coalesce(m.ref,m.name),m.date::date,m.branch_id,round(l.debit+l.credit,2),round(l.amount_residual,2),l.currency_code,
 count(*) over() from public.account_move_lines l join public.account_moves m on m.id=l.move_id and m.tenant_id=l.tenant_id
 join public.account_accounts a on a.id=l.account_id and a.tenant_id=l.tenant_id
 where l.tenant_id=p_tenant_id and m.state='posted' and l.parent_state='posted' and l.account_id=target_account
 and l.partner_id=(source->>'partner_id')::uuid and a.reconcile and a.open_item_reconcile and l.line_type='open_item'
 and l.amount_residual>0 and not l.is_reconciled and l.currency_code=source->>'currency_code'
 and (((source->>'application_type')='customer' and l.debit>0 and l.credit=0) or((source->>'application_type')='supplier' and l.credit>0 and l.debit=0))
 and public.has_financial_resource_access(p_tenant_id,l.account_id,'reconcile',m.branch_id)
 order by m.date,l.id limit least(greatest(coalesce(p_limit,50),1),100) offset greatest(coalesce(p_offset,0),0);
end $$;

create or replace function public.create_advance_application_move(
 p_application_id uuid,p_tenant_id uuid,p_payment_number text,p_kind text,p_amount numeric,p_currency text,p_partner uuid,
 p_advance_account uuid,p_target_account uuid,p_journal uuid,p_branch uuid,p_actor uuid,
 p_advance_line uuid,p_target_line uuid
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare mid uuid:=gen_random_uuid();begin
 if current_setting('app.financial_advance_application_contract',true) is distinct from p_application_id::text then raise exception using errcode='42501',message='ADVANCE_RECLASSIFICATION_MOVE_REQUIRES_CONTRACT';end if;
 insert into public.account_moves(id,tenant_id,branch_id,journal_id,name,move_type,invoice_date,date,amount_total,state,ref,notes,pay_method,currency_code,created_by)
 values(mid,p_tenant_id,p_branch,p_journal,'ADVANCE-APPLICATION-'||p_payment_number,'journal',current_date,now(),p_amount,'posted','financial_advance_application:'||p_application_id,
 'application_type='||p_kind,'canonical_advance_application',p_currency,p_actor);
 insert into public.account_move_lines(id,tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
 values
 (p_advance_line,p_tenant_id,mid,p_advance_account,p_partner,'Advance reclassification — '||p_payment_number,1,p_amount,case when p_kind='customer' then p_amount else 0 end,case when p_kind='supplier' then p_amount else 0 end,'open_item',false,p_amount,p_amount,'posted',p_currency,p_actor),
 (p_target_line,p_tenant_id,mid,p_target_account,p_partner,'Advance application — '||p_payment_number,1,p_amount,case when p_kind='supplier' then p_amount else 0 end,case when p_kind='customer' then p_amount else 0 end,'open_item',false,p_amount,p_amount,'posted',p_currency,p_actor);
 perform public.accounting_assert_move_balanced(mid);return mid;end $$;

create or replace function public.create_advance_application_partial_reconcile(
 p_application_id uuid,p_partial_id uuid,p_tenant_id uuid,p_debit uuid,p_credit uuid,p_amount numeric,p_actor uuid
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare d date;begin
 if current_setting('app.financial_advance_application_contract',true) is distinct from p_application_id::text then raise exception using errcode='42501',message='ADVANCE_PARTIAL_RECONCILE_REQUIRES_CONTRACT';end if;
 select greatest(dm.date::date,cm.date::date) into d from public.account_move_lines dl join public.account_moves dm on dm.id=dl.move_id
 join public.account_move_lines cl on cl.id=p_credit join public.account_moves cm on cm.id=cl.move_id where dl.id=p_debit;
 insert into public.account_partial_reconcile(id,tenant_id,debit_move_id,credit_move_id,amount,max_date,created_by)
 values(p_partial_id,p_tenant_id,p_debit,p_credit,p_amount,d,p_actor);end $$;

create or replace function public.apply_financial_advance(
 p_tenant_id uuid,p_advance_payment_id uuid,p_target_account_line_id uuid,p_amount numeric,p_idempotency_key text,p_notes text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare source jsonb;payment public.financial_payments%rowtype;target public.account_move_lines%rowtype;target_move public.account_moves%rowtype;
 existing public.financial_advance_applications%rowtype;amount numeric(18,2):=round(p_amount,2);fp text;app_id uuid:=gen_random_uuid();
 advance_account uuid;target_account uuid;journal uuid;actor uuid:=public.current_tenant_user_id();mid uuid;adv_line uuid:=gen_random_uuid();reclass_target uuid:=gen_random_uuid();adv_partial uuid:=gen_random_uuid();target_partial uuid:=gen_random_uuid();kind text;
begin
 if amount is null or amount<=0 then raise exception using errcode='22023',message='ADVANCE_APPLICATION_AMOUNT_MUST_BE_POSITIVE';end if;
 if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception using errcode='22023',message='ADVANCE_APPLICATION_IDEMPOTENCY_KEY_REQUIRED';end if;
 fp:=encode(extensions.digest(jsonb_build_object('payment_id',p_advance_payment_id,'target_line_id',p_target_account_line_id,'amount',amount,'notes',nullif(btrim(p_notes),''))::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('advance_application:'||p_tenant_id::text||':'||p_advance_payment_id::text,0));
 select * into existing from public.financial_advance_applications a where a.tenant_id=p_tenant_id and a.idempotency_key=btrim(p_idempotency_key);
 if found then if existing.request_fingerprint<>fp then raise exception using errcode='23505',message='ADVANCE_APPLICATION_IDEMPOTENCY_PAYLOAD_MISMATCH';end if;
  return jsonb_build_object('application_id',existing.id,'reclassification_move_id',existing.reclassification_move_id,'advance_partial_reconcile_id',existing.advance_partial_reconcile_id,'target_partial_reconcile_id',existing.target_partial_reconcile_id,'status',existing.status,'idempotent_replay',true);end if;
 select * into payment from public.financial_payments p where p.id=p_advance_payment_id and p.tenant_id=p_tenant_id for update;
 if not found then raise exception using errcode='P0002',message='FINANCIAL_PAYMENT_NOT_FOUND';end if;
 source:=public.resolve_financial_advance_source(p_tenant_id,p_advance_payment_id);kind:=source->>'application_type';
 advance_account:=public.resolve_functional_account(p_tenant_id,source->>'advance_role',payment.branch_id);
 select * into target from public.account_move_lines l where l.id=p_target_account_line_id and l.tenant_id=p_tenant_id;
 if not found then raise exception using errcode='P0002',message='ADVANCE_TARGET_OPEN_ITEM_NOT_FOUND';end if;
 select * into target_move from public.account_moves m where m.id=target.move_id and m.tenant_id=p_tenant_id;
 target_account:=public.resolve_functional_account(p_tenant_id,source->>'target_role',target_move.branch_id);
 perform public.assert_financial_authorized(p_tenant_id,'financial.payment.allocate',advance_account,'reconcile',payment.branch_id,true);
 perform public.assert_financial_authorized(p_tenant_id,'financial.payment.allocate',target_account,'reconcile',target_move.branch_id,true);
 perform 1 from public.account_move_lines l where l.id in((source->>'source_line_id')::uuid,target.id) order by l.id for update;
 select * into target from public.account_move_lines l where l.id=p_target_account_line_id;
 source:=public.resolve_financial_advance_source(p_tenant_id,p_advance_payment_id);
 if target_move.state<>'posted' or target.parent_state<>'posted' or target.account_id<>target_account or target.partner_id<>(source->>'partner_id')::uuid
  or target.line_type<>'open_item' or target.amount_residual<=0 or target.is_reconciled
  or not ((kind='customer' and target.debit>0 and target.credit=0)or(kind='supplier' and target.credit>0 and target.debit=0)) then raise exception using errcode='23514',message='ADVANCE_TARGET_OPEN_ITEM_INELIGIBLE';end if;
 if target.currency_code is distinct from source->>'currency_code' then raise exception using errcode='23514',message='ADVANCE_APPLICATION_CURRENCY_MISMATCH';end if;
 if amount>(source->>'remaining_amount')::numeric then raise exception using errcode='23514',message='ADVANCE_APPLICATION_EXCEEDS_AVAILABLE_ADVANCE';end if;
 if amount>target.amount_residual then raise exception using errcode='23514',message='ADVANCE_APPLICATION_EXCEEDS_TARGET_RESIDUAL';end if;
 journal:=public.resolve_financial_journal(p_tenant_id,'general',target_move.branch_id,null);
 perform set_config('app.financial_advance_application_contract',app_id::text,true);
 mid:=public.create_advance_application_move(app_id,p_tenant_id,payment.payment_number,kind,amount,source->>'currency_code',(source->>'partner_id')::uuid,advance_account,target_account,journal,target_move.branch_id,actor,adv_line,reclass_target);
 if kind='customer' then
  perform public.create_advance_application_partial_reconcile(app_id,adv_partial,p_tenant_id,adv_line,(source->>'source_line_id')::uuid,amount,actor);
  perform public.create_advance_application_partial_reconcile(app_id,target_partial,p_tenant_id,target.id,reclass_target,amount,actor);
 else
  perform public.create_advance_application_partial_reconcile(app_id,adv_partial,p_tenant_id,(source->>'source_line_id')::uuid,adv_line,amount,actor);
  perform public.create_advance_application_partial_reconcile(app_id,target_partial,p_tenant_id,reclass_target,target.id,amount,actor);
 end if;
 insert into public.financial_advance_applications(id,tenant_id,advance_payment_id,advance_source_line_id,target_account_line_id,reclassification_move_id,reclassified_advance_line_id,reclassified_target_line_id,advance_partial_reconcile_id,target_partial_reconcile_id,application_type,amount,currency_code,idempotency_key,request_fingerprint,notes,created_by)
 values(app_id,p_tenant_id,p_advance_payment_id,(source->>'source_line_id')::uuid,target.id,mid,adv_line,reclass_target,adv_partial,target_partial,kind,amount,source->>'currency_code',btrim(p_idempotency_key),fp,p_notes,actor);
 insert into public.financial_advance_application_events(tenant_id,application_id,event_type,actor_user_id,metadata) values(p_tenant_id,app_id,'applied',actor,jsonb_build_object('reclassification_move_id',mid,'advance_partial_reconcile_id',adv_partial,'target_partial_reconcile_id',target_partial));
 if (select amount_residual from public.account_move_lines where id=(source->>'source_line_id')::uuid)<>(source->>'remaining_amount')::numeric-amount
 or (select amount_residual from public.account_move_lines where id=target.id)<>target.amount_residual-amount then raise exception using errcode='23514',message='ADVANCE_APPLICATION_RESIDUAL_INTEGRITY_FAILURE';end if;
 return jsonb_build_object('application_id',app_id,'reclassification_move_id',mid,'advance_partial_reconcile_id',adv_partial,'target_partial_reconcile_id',target_partial,'status','active','idempotent_replay',false);
end $$;

create or replace function public.get_financial_advance_application_summary(p_tenant_id uuid,p_advance_payment_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare source jsonb;begin source:=public.resolve_financial_advance_source(p_tenant_id,p_advance_payment_id);
 perform public.assert_financial_authorized(p_tenant_id,'financial.payment.allocate',(source->>'source_account_id')::uuid,'reconcile',nullif(source->>'branch_id','')::uuid,true);
 return source||jsonb_build_object('applied_amount',round((source->>'original_amount')::numeric-(source->>'remaining_amount')::numeric,2),
 'application_state',case when(source->>'remaining_amount')::numeric=0 then'fully_applied' when(source->>'remaining_amount')::numeric=(source->>'original_amount')::numeric then'unapplied' else'partially_applied'end,
 'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.financial_advance_applications a where a.tenant_id=p_tenant_id and a.advance_payment_id=p_advance_payment_id),'[]'::jsonb));end $$;

create or replace function public.unapply_financial_advance(p_tenant_id uuid,p_application_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.financial_advance_applications%rowtype;begin select * into a from public.financial_advance_applications x where x.id=p_application_id and x.tenant_id=p_tenant_id;
 if not found then raise exception using errcode='P0002',message='ADVANCE_APPLICATION_NOT_FOUND';end if;
 perform public.assert_financial_authorized(p_tenant_id,'financial.reconciliation.manage',null,null,null,true);
 raise exception using errcode='0A000',message='ADVANCE_UNAPPLICATION_REQUIRES_ACCOUNTING_REVERSAL_CORE';end $$;

create or replace function public.financial_advance_has_active_applications(p_tenant_id uuid,p_payment_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from public.financial_advance_applications a where a.tenant_id=p_tenant_id and a.advance_payment_id=p_payment_id and a.status='active')$$;

alter table public.financial_advance_applications enable row level security;alter table public.financial_advance_application_events enable row level security;
revoke all on public.financial_advance_applications,public.financial_advance_application_events from public,anon,authenticated;
grant select on public.financial_advance_applications,public.financial_advance_application_events to authenticated;
create policy financial_advance_applications_read on public.financial_advance_applications for select to authenticated using(tenant_id=public.current_tenant_id() and public.has_permission('financial.payment.allocate',tenant_id));
create policy financial_advance_application_events_read on public.financial_advance_application_events for select to authenticated using(tenant_id=public.current_tenant_id() and exists(select 1 from public.financial_advance_applications a where a.id=application_id and a.tenant_id=tenant_id));

revoke all on function public.guard_financial_advance_application(),public.guard_financial_advance_application_event(),public.resolve_financial_advance_source(uuid,uuid),public.create_advance_application_move(uuid,uuid,text,text,numeric,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid),public.create_advance_application_partial_reconcile(uuid,uuid,uuid,uuid,uuid,numeric,uuid),public.financial_advance_has_active_applications(uuid,uuid) from public,anon,authenticated;
revoke all on function public.list_allocatable_targets_for_advance(uuid,uuid,integer,integer),public.apply_financial_advance(uuid,uuid,uuid,numeric,text,text),public.get_financial_advance_application_summary(uuid,uuid),public.unapply_financial_advance(uuid,uuid,text) from public,anon;
grant execute on function public.list_allocatable_targets_for_advance(uuid,uuid,integer,integer),public.apply_financial_advance(uuid,uuid,uuid,numeric,text,text),public.get_financial_advance_application_summary(uuid,uuid),public.unapply_financial_advance(uuid,uuid,text) to authenticated;

comment on table public.financial_advance_applications is 'Canonical immutable business trace from posted advance payment through reclassification move and two same-account partial reconciliations to an eligible AR/AP target.';
comment on function public.unapply_financial_advance(uuid,uuid,text) is 'Fail-closed Phase 6 contract. Posted reclassification cannot be deleted; domain unapplication waits for protected Accounting Reversal Core.';

commit;
