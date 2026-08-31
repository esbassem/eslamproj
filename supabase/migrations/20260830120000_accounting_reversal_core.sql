begin;

create table public.financial_accounting_reversal_sequences(
 tenant_id uuid not null references public.tenants(id) on delete cascade,sequence_year integer not null,next_number bigint not null default 1,updated_at timestamptz not null default now(),primary key(tenant_id,sequence_year),check(next_number>0)
);
create table public.financial_accounting_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete restrict,
 reversal_number text not null,domain_type text not null,domain_id uuid not null,status text not null default'completed',reason text not null,
 reversal_date date not null,idempotency_key text not null,request_fingerprint text not null,requested_by uuid not null,requested_at timestamptz not null default now(),completed_by uuid not null,completed_at timestamptz not null default now(),metadata jsonb not null default'{}',
 foreign key(requested_by,tenant_id)references public.tenant_users(id,tenant_id)on delete restrict,foreign key(completed_by,tenant_id)references public.tenant_users(id,tenant_id)on delete restrict,
 unique(tenant_id,reversal_number),unique(tenant_id,idempotency_key),unique(tenant_id,domain_type,domain_id),unique(id,tenant_id),
 check(domain_type in('payment','internal_transfer','advance_application')),check(status='completed'),check(btrim(reason)<>''),check(reversal_number~'^REV-[0-9]{4}-[0-9]{6,}$'),check(btrim(idempotency_key)<>''),check(request_fingerprint~'^[0-9a-f]{64}$'),check(jsonb_typeof(metadata)='object')
);
create table public.financial_accounting_reversal_move_links(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,reversal_id uuid not null,stage text not null,original_move_id uuid not null,reversal_move_id uuid not null,created_at timestamptz not null default now(),
 foreign key(reversal_id,tenant_id)references public.financial_accounting_reversals(id,tenant_id)on delete restrict,
 foreign key(original_move_id,tenant_id)references public.account_moves(id,tenant_id)on delete restrict,foreign key(reversal_move_id,tenant_id)references public.account_moves(id,tenant_id)on delete restrict,
 unique(tenant_id,original_move_id),unique(tenant_id,reversal_move_id),unique(reversal_id,stage),check(stage in('payment_posting','transfer_immediate','transfer_send','transfer_receive','advance_reclassification'))
);
create table public.financial_accounting_reversal_line_links(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,reversal_id uuid not null,move_link_id uuid not null,original_line_id uuid not null,reversal_line_id uuid not null,created_at timestamptz not null default now(),
 foreign key(reversal_id,tenant_id)references public.financial_accounting_reversals(id,tenant_id)on delete restrict,foreign key(move_link_id)references public.financial_accounting_reversal_move_links(id)on delete restrict,
 foreign key(original_line_id,tenant_id)references public.account_move_lines(id,tenant_id)on delete restrict,foreign key(reversal_line_id,tenant_id)references public.account_move_lines(id,tenant_id)on delete restrict,
 unique(tenant_id,original_line_id),unique(tenant_id,reversal_line_id)
);
create table public.financial_accounting_reversal_reconcile_links(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,reversal_id uuid not null,action text not null,role text not null,partial_reconcile_id uuid not null,amount numeric(18,2)not null,created_at timestamptz not null default now(),
 foreign key(reversal_id,tenant_id)references public.financial_accounting_reversals(id,tenant_id)on delete restrict,
 unique(reversal_id,action,role,partial_reconcile_id),check(action in('created','removed')),check(role in('payment_open_item','advance_source','advance_target','reclassification_cleanup_advance','reclassification_cleanup_target')),check(amount>0)
);
create table public.financial_accounting_reversal_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,reversal_id uuid not null,event_type text not null default'reversal_completed',actor_user_id uuid not null,reason text not null,metadata jsonb not null default'{}',created_at timestamptz not null default now(),
 foreign key(reversal_id,tenant_id)references public.financial_accounting_reversals(id,tenant_id)on delete restrict,foreign key(actor_user_id,tenant_id)references public.tenant_users(id,tenant_id)on delete restrict,
 check(event_type in('payment_accounting_reversed','transfer_accounting_reversed','advance_unapplied')),check(btrim(reason)<>''),check(jsonb_typeof(metadata)='object')
);

create or replace function public.guard_financial_accounting_reversal_audit()returns trigger language plpgsql set search_path=pg_catalog,public as $$declare target_id text;begin
 if tg_op<>'INSERT'then raise exception using errcode='23514',message='ACCOUNTING_REVERSAL_AUDIT_IMMUTABLE';end if;
 if tg_table_name='financial_accounting_reversals'then target_id:=new.id::text;else target_id:=new.reversal_id::text;end if;
 if current_setting('app.financial_accounting_reversal_contract',true)is distinct from target_id then raise exception using errcode='42501',message='ACCOUNTING_REVERSAL_AUDIT_REQUIRES_CONTRACT';end if;return new;end $$;
create trigger financial_accounting_reversals_guard before insert or update or delete on public.financial_accounting_reversals for each row execute function public.guard_financial_accounting_reversal_audit();
create trigger financial_accounting_reversal_moves_guard before insert or update or delete on public.financial_accounting_reversal_move_links for each row execute function public.guard_financial_accounting_reversal_audit();
create trigger financial_accounting_reversal_lines_guard before insert or update or delete on public.financial_accounting_reversal_line_links for each row execute function public.guard_financial_accounting_reversal_audit();
create trigger financial_accounting_reversal_reconciles_guard before insert or update or delete on public.financial_accounting_reversal_reconcile_links for each row execute function public.guard_financial_accounting_reversal_audit();
create trigger financial_accounting_reversal_events_guard before insert or update or delete on public.financial_accounting_reversal_events for each row execute function public.guard_financial_accounting_reversal_audit();

create or replace function public.next_financial_accounting_reversal_number(p_tenant uuid)returns text language plpgsql security definer set search_path=pg_catalog,public as $$declare y int:=extract(year from current_date)::int;n bigint;begin
 insert into public.financial_accounting_reversal_sequences(tenant_id,sequence_year,next_number)values(p_tenant,y,2)on conflict(tenant_id,sequence_year)do update set next_number=public.financial_accounting_reversal_sequences.next_number+1,updated_at=now()returning next_number-1 into n;return'REV-'||y||'-'||lpad(n::text,6,'0');end $$;

create or replace function public.create_reversing_account_move(p_reversal uuid,p_tenant uuid,p_original uuid,p_stage text,p_date date,p_actor uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare o public.account_moves%rowtype;rid uuid:=gen_random_uuid();mlid uuid:=gen_random_uuid();l record;rl uuid;begin
 if current_setting('app.financial_accounting_reversal_contract',true)is distinct from p_reversal::text then raise exception using errcode='42501',message='REVERSING_MOVE_REQUIRES_DOMAIN_CONTRACT';end if;
 select*into o from public.account_moves m where m.id=p_original and m.tenant_id=p_tenant for update;
 if not found or o.state<>'posted'then raise exception using errcode='23514',message='ORIGINAL_POSTED_MOVE_REQUIRED';end if;
 if o.reversed_entry_id is not null or exists(select 1 from public.account_moves m where m.tenant_id=p_tenant and m.reversed_entry_id=o.id)then raise exception using errcode='23514',message='ACCOUNTING_EFFECT_ALREADY_REVERSED';end if;
 if p_date<o.date::date then raise exception using errcode='23514',message='REVERSAL_DATE_BEFORE_ORIGINAL_DATE';end if;
 if not exists(select 1 from public.account_journals j where j.id=o.journal_id and j.tenant_id=p_tenant and j.is_active)then raise exception using errcode='23514',message='ORIGINAL_REVERSAL_JOURNAL_INVALID';end if;
 insert into public.account_moves(id,tenant_id,branch_id,journal_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,notes,pay_method,currency_code,created_by,reversed_entry_id)
 values(rid,p_tenant,o.branch_id,o.journal_id,'REVERSAL-'||upper(left(replace(rid::text,'-',''),12)),o.move_type,o.partner_id,p_date,p_date,o.amount_total,'posted','financial_accounting_reversal:'||p_reversal,'reversal_stage='||p_stage,o.pay_method,o.currency_code,p_actor,o.id);
 insert into public.financial_accounting_reversal_move_links(id,tenant_id,reversal_id,stage,original_move_id,reversal_move_id)values(mlid,p_tenant,p_reversal,p_stage,o.id,rid);
 for l in select*from public.account_move_lines x where x.move_id=o.id and x.tenant_id=p_tenant order by x.id loop
  rl:=gen_random_uuid();insert into public.account_move_lines(id,tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
  values(rl,p_tenant,rid,l.account_id,l.partner_id,'Reversal — '||l.label,coalesce(l.quantity,1),l.unit_price,l.credit,l.debit,l.line_type,case when l.line_type='open_item'then false else true end,case when l.line_type='open_item'then l.debit+l.credit else 0 end,case when l.line_type='open_item'then l.debit+l.credit else 0 end,'posted',l.currency_code,p_actor);
  insert into public.financial_accounting_reversal_line_links(tenant_id,reversal_id,move_link_id,original_line_id,reversal_line_id)values(p_tenant,p_reversal,mlid,l.id,rl);
 end loop;perform public.accounting_assert_move_balanced(rid);return rid;end $$;

create or replace function public.reversal_create_partial(p_reversal uuid,p_tenant uuid,p_debit uuid,p_credit uuid,p_amount numeric,p_actor uuid,p_role text)returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare pid uuid:=gen_random_uuid();d date;begin
 if current_setting('app.financial_accounting_reversal_contract',true)is distinct from p_reversal::text then raise exception using errcode='42501',message='REVERSAL_RECONCILE_REQUIRES_CONTRACT';end if;
 select greatest(dm.date::date,cm.date::date)into d from public.account_move_lines dl join public.account_moves dm on dm.id=dl.move_id join public.account_move_lines cl on cl.id=p_credit join public.account_moves cm on cm.id=cl.move_id where dl.id=p_debit;
 insert into public.account_partial_reconcile(id,tenant_id,debit_move_id,credit_move_id,amount,max_date,created_by)values(pid,p_tenant,p_debit,p_credit,p_amount,d,p_actor);
 insert into public.financial_accounting_reversal_reconcile_links(tenant_id,reversal_id,action,role,partial_reconcile_id,amount)values(p_tenant,p_reversal,'created',p_role,pid,p_amount);return pid;end $$;
create or replace function public.reversal_remove_partial(p_reversal uuid,p_tenant uuid,p_partial uuid,p_role text)returns void language plpgsql security definer set search_path=pg_catalog,public as $$declare a numeric;begin
 if current_setting('app.financial_accounting_reversal_contract',true)is distinct from p_reversal::text then raise exception using errcode='42501',message='REVERSAL_UNRECONCILE_REQUIRES_CONTRACT';end if;
 select amount into a from public.account_partial_reconcile where id=p_partial and tenant_id=p_tenant for update;if not found then raise exception using errcode='23514',message='DEPENDENT_RECONCILIATION_MISSING';end if;
 delete from public.account_partial_reconcile where id=p_partial and tenant_id=p_tenant;insert into public.financial_accounting_reversal_reconcile_links(tenant_id,reversal_id,action,role,partial_reconcile_id,amount)values(p_tenant,p_reversal,'removed',p_role,p_partial,a);end $$;

-- Domain accounting state boundaries.
alter table public.financial_internal_transfers add column accounting_state text not null default'active',add column accounting_reversed_by uuid,add column accounting_reversed_at timestamptz,add column accounting_reversal_id uuid,
 add foreign key(accounting_reversed_by,tenant_id)references public.tenant_users(id,tenant_id)on delete restrict,add foreign key(accounting_reversal_id,tenant_id)references public.financial_accounting_reversals(id,tenant_id)on delete restrict,
 add check(accounting_state in('active','reversed')),add check((accounting_state='active'and accounting_reversed_by is null and accounting_reversed_at is null and accounting_reversal_id is null)or(accounting_state='reversed'and accounting_reversed_by is not null and accounting_reversed_at is not null and accounting_reversal_id is not null));
alter table public.financial_internal_transfer_accounting_links drop constraint financial_internal_transfer_accounting_links_entry_type_check,
 add constraint financial_internal_transfer_accounting_links_entry_type_check check(entry_type in('immediate','send','receive','reversal_immediate','reversal_send','reversal_receive'));
alter table public.financial_advance_applications drop constraint financial_advance_applications_status_check,
 add constraint financial_advance_applications_status_check check(status in('active','unapplied')),
 add column unapplied_by uuid,add column unapplied_at timestamptz,add column unapplication_reason text,add column accounting_reversal_id uuid,add column reversal_reclassification_move_id uuid,
 add foreign key(unapplied_by,tenant_id)references public.tenant_users(id,tenant_id)on delete restrict,add foreign key(accounting_reversal_id,tenant_id)references public.financial_accounting_reversals(id,tenant_id)on delete restrict,add foreign key(reversal_reclassification_move_id,tenant_id)references public.account_moves(id,tenant_id)on delete restrict;

create or replace function public.guard_financial_payment_accounting_state()returns trigger language plpgsql set search_path=pg_catalog,public as $$declare post_id text:=current_setting('app.financial_payment_posting_contract',true);rev_id text:=current_setting('app.financial_payment_reversal_contract',true);begin
 if tg_op='INSERT'then if new.accounting_state<>'unposted'or new.payment_purpose is not null or new.posted_by is not null or new.posted_at is not null then raise exception using errcode='23514',message='FINANCIAL_PAYMENT_MUST_START_UNPOSTED';end if;return new;end if;
 if new.accounting_state is not distinct from old.accounting_state and new.payment_purpose is not distinct from old.payment_purpose and new.posted_by is not distinct from old.posted_by and new.posted_at is not distinct from old.posted_at then return new;end if;
 if old.accounting_state='unposted'and new.accounting_state='posted'and post_id=new.id::text and exists(select 1 from public.financial_payment_accounting_links l join public.account_moves m on m.id=l.account_move_id where l.payment_id=new.id and l.entry_type='posting'and m.state='posted')then return new;end if;
 if old.accounting_state='posted'and new.accounting_state='reversed'and rev_id=new.id::text and exists(select 1 from public.financial_payment_accounting_links l join public.account_moves m on m.id=l.account_move_id where l.payment_id=new.id and l.entry_type='reversal'and m.state='posted')then return new;end if;
 raise exception using errcode='42501',message='FINANCIAL_PAYMENT_ACCOUNTING_STATE_REQUIRES_CANONICAL_CONTRACT';end $$;

create or replace function public.guard_financial_payment_accounting_link()returns trigger language plpgsql set search_path=pg_catalog,public as $$declare post_id text:=current_setting('app.financial_payment_posting_contract',true);rev_id text:=current_setting('app.financial_payment_reversal_contract',true);p public.financial_payments%rowtype;m public.account_moves%rowtype;begin
 if tg_op<>'INSERT'then raise exception using errcode='42501',message='FINANCIAL_PAYMENT_ACCOUNTING_LINK_IMMUTABLE';end if;select*into p from public.financial_payments where id=new.payment_id and tenant_id=new.tenant_id;select*into m from public.account_moves where id=new.account_move_id and tenant_id=new.tenant_id;
 if new.entry_type='posting'and post_id=new.payment_id::text and p.status='confirmed'and p.accounting_state='unposted'and m.state='posted'then perform public.accounting_assert_move_balanced(m.id);return new;end if;
 if new.entry_type='reversal'and rev_id=new.payment_id::text and p.accounting_state='posted'and m.state='posted'then perform public.accounting_assert_move_balanced(m.id);return new;end if;
 raise exception using errcode='42501',message='FINANCIAL_PAYMENT_ACCOUNTING_LINK_REQUIRES_CANONICAL_CONTRACT';end $$;

create or replace function public.guard_financial_advance_application()returns trigger language plpgsql set search_path=pg_catalog,public as $$begin
 if tg_op='DELETE'then raise exception using errcode='23514',message='FINANCIAL_ADVANCE_APPLICATION_IMMUTABLE';end if;
 if tg_op='INSERT'and current_setting('app.financial_advance_application_contract',true)=new.id::text then return new;end if;
 if tg_op='UPDATE'and current_setting('app.financial_advance_unapplication_contract',true)=new.id::text and old.status='active'and new.status='unapplied'
 and(new.id,new.tenant_id,new.advance_payment_id,new.advance_source_line_id,new.target_account_line_id,new.reclassification_move_id,new.amount,new.created_at)is not distinct from(old.id,old.tenant_id,old.advance_payment_id,old.advance_source_line_id,old.target_account_line_id,old.reclassification_move_id,old.amount,old.created_at)then return new;end if;
 raise exception using errcode='42501',message='FINANCIAL_ADVANCE_APPLICATION_REQUIRES_CANONICAL_CONTRACT';end $$;

create or replace function public.get_financial_reversal_eligibility(p_tenant uuid,p_domain text,p_domain_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare alloc bigint:=0;apps bigint:=0;state text;already boolean:=false;blockers jsonb:='[]';r record;begin
 if public.current_tenant_id()<>p_tenant then raise exception using errcode='42501',message='REVERSAL_TENANT_ACCESS_DENIED';end if;
 if p_domain='payment'then select accounting_state into state from public.financial_payments where id=p_domain_id and tenant_id=p_tenant;select count(*)into alloc from public.financial_payment_allocations where tenant_id=p_tenant and payment_id=p_domain_id and status='active';select count(*)into apps from public.financial_advance_applications where tenant_id=p_tenant and advance_payment_id=p_domain_id and status='active';
 elsif p_domain='internal_transfer'then select accounting_state into state from public.financial_internal_transfers where id=p_domain_id and tenant_id=p_tenant;
 elsif p_domain='advance_application'then select status into state from public.financial_advance_applications where id=p_domain_id and tenant_id=p_tenant;else raise exception using errcode='22023',message='REVERSAL_DOMAIN_INVALID';end if;
 already:=exists(select 1 from public.financial_accounting_reversals where tenant_id=p_tenant and domain_type=p_domain and domain_id=p_domain_id);
 if state is null then blockers:=blockers||'"DOMAIN_OPERATION_NOT_FOUND"'::jsonb;end if;if already then blockers:=blockers||'"ACCOUNTING_EFFECT_ALREADY_REVERSED"'::jsonb;end if;if alloc>0 then blockers:=blockers||'"PAYMENT_HAS_ACTIVE_ALLOCATIONS"'::jsonb;end if;if apps>0 then blockers:=blockers||'"PAYMENT_HAS_ACTIVE_ADVANCE_APPLICATIONS"'::jsonb;end if;
 return jsonb_build_object('eligible',jsonb_array_length(blockers)=0 and state in('posted','active'),'accounting_state',state,'already_reversed',already,'active_allocations',alloc,'active_advance_applications',apps,'blockers',blockers,'reversal',(select to_jsonb(x)from public.financial_accounting_reversals x where x.tenant_id=p_tenant and x.domain_type=p_domain and x.domain_id=p_domain_id));end $$;

create or replace function public.reverse_financial_payment_accounting(p_tenant uuid,p_payment uuid,p_reason text,p_idempotency text,p_reversal_date date default current_date)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare p public.financial_payments%rowtype;existing public.financial_accounting_reversals%rowtype;rid uuid:=gen_random_uuid();fp text;num text;orig uuid;rev uuid;actor uuid:=public.current_tenant_user_id();l record;rl uuid;pid uuid;reason text:=nullif(btrim(p_reason),'');begin
 if reason is null then raise exception using errcode='22023',message='ACCOUNTING_REVERSAL_REASON_REQUIRED';end if;if nullif(btrim(coalesce(p_idempotency,'')),'')is null then raise exception using errcode='22023',message='ACCOUNTING_REVERSAL_IDEMPOTENCY_REQUIRED';end if;
 fp:=encode(extensions.digest(jsonb_build_object('domain','payment','id',p_payment,'reason',reason,'date',p_reversal_date)::text,'sha256'),'hex');perform pg_advisory_xact_lock(hashtextextended('payment_reversal:'||p_tenant||':'||p_payment,0));
 select*into existing from public.financial_accounting_reversals where tenant_id=p_tenant and idempotency_key=btrim(p_idempotency);if found then if existing.request_fingerprint<>fp then raise exception using errcode='23505',message='ACCOUNTING_REVERSAL_IDEMPOTENCY_PAYLOAD_MISMATCH';end if;return jsonb_build_object('reversal_id',existing.id,'reversal_number',existing.reversal_number,'idempotent_replay',true);end if;
 select*into p from public.financial_payments where id=p_payment and tenant_id=p_tenant for update;if not found then raise exception using errcode='P0002',message='FINANCIAL_PAYMENT_NOT_FOUND';end if;
 perform public.assert_financial_authorized(p_tenant,'financial.payment.reverse',null,null,p.branch_id,p.accounting_state='posted');if p.accounting_state<>'posted'then raise exception using errcode='23514',message='PAYMENT_ACCOUNTING_NOT_REVERSIBLE';end if;
 if exists(select 1 from public.financial_payment_allocations where tenant_id=p_tenant and payment_id=p.id and status='active')then raise exception using errcode='23514',message='PAYMENT_HAS_ACTIVE_ALLOCATIONS';end if;if public.financial_advance_has_active_applications(p_tenant,p.id)then raise exception using errcode='23514',message='PAYMENT_HAS_ACTIVE_ADVANCE_APPLICATIONS';end if;
 if p.money_destination_id is not null then perform*from public.resolve_money_destination_for_action(p_tenant,p.money_destination_id,'financial.payment.reverse','confirm',p.branch_id,null);end if;
 select account_move_id into orig from public.financial_payment_accounting_links where tenant_id=p_tenant and payment_id=p.id and entry_type='posting';if orig is null then raise exception using errcode='23514',message='PAYMENT_POSTING_LINK_MISSING';end if;
 if exists(select 1 from public.financial_accounting_reversals where tenant_id=p_tenant and domain_type='payment'and domain_id=p.id)then raise exception using errcode='23514',message='ACCOUNTING_EFFECT_ALREADY_REVERSED';end if;
 num:=public.next_financial_accounting_reversal_number(p_tenant);perform set_config('app.financial_accounting_reversal_contract',rid::text,true);insert into public.financial_accounting_reversals(id,tenant_id,reversal_number,domain_type,domain_id,reason,reversal_date,idempotency_key,request_fingerprint,requested_by,completed_by)values(rid,p_tenant,num,'payment',p.id,reason,p_reversal_date,btrim(p_idempotency),fp,actor,actor);
 rev:=public.create_reversing_account_move(rid,p_tenant,orig,'payment_posting',p_reversal_date,actor);
 for l in select ol.*,ll.reversal_line_id from public.account_move_lines ol join public.account_accounts a on a.id=ol.account_id and a.tenant_id=ol.tenant_id join public.financial_accounting_reversal_line_links ll on ll.original_line_id=ol.id and ll.reversal_id=rid where ol.move_id=orig and a.reconcile and a.open_item_reconcile and ol.amount_residual>0 loop
  rl:=l.reversal_line_id;if l.debit>0 then pid:=public.reversal_create_partial(rid,p_tenant,l.id,rl,l.amount_residual,actor,'payment_open_item');else pid:=public.reversal_create_partial(rid,p_tenant,rl,l.id,l.amount_residual,actor,'payment_open_item');end if;end loop;
 perform set_config('app.financial_payment_reversal_contract',p.id::text,true);insert into public.financial_payment_accounting_links(tenant_id,payment_id,account_move_id,entry_type,created_by)values(p_tenant,p.id,rev,'reversal',actor);update public.financial_payments set accounting_state='reversed'where id=p.id;
 insert into public.financial_payment_events(tenant_id,payment_id,event_type,from_status,to_status,actor_user_id,reason,metadata)values(p_tenant,p.id,'reversed',p.status,p.status,actor,reason,jsonb_build_object('accounting_only',true,'reversal_id',rid,'reversal_move_id',rev));
 insert into public.financial_accounting_reversal_events(tenant_id,reversal_id,event_type,actor_user_id,reason,metadata)values(p_tenant,rid,'payment_accounting_reversed',actor,reason,jsonb_build_object('original_move_id',orig,'reversal_move_id',rev));return jsonb_build_object('reversal_id',rid,'reversal_number',num,'reversal_move_id',rev,'idempotent_replay',false);end $$;

commit;
