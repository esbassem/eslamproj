begin;

insert into public.auth_permissions(code,name,description,resource,action,module_code,permission_type,sort_order,active)
values
 ('financial.period.manage','إدارة إقفال الفترات المالية','إقفال أو فتح فترة الترحيل وتكوين سياسة التاريخ.','financial.period','manage','accountant_app','action',620,true),
 ('financial.destination.negative_balance','إدارة السالب للموارد المالية','السماح الصريح لمورد مالي بتجاوز الرصيد المتاح.','financial.destination','negative_balance','accountant_app','action',621,true)
on conflict(code)do update set name=excluded.name,description=excluded.description,resource=excluded.resource,
 action=excluded.action,module_code=excluded.module_code,permission_type=excluded.permission_type,
 sort_order=excluded.sort_order,active=true,updated_at=now();

alter table public.money_destinations
 add column allow_negative_balance boolean not null default false;

create table public.financial_posting_policies(
 tenant_id uuid primary key references public.tenants(id)on delete cascade,
 allow_future_posting boolean not null default false,
 updated_by uuid not null,
 updated_at timestamptz not null default now(),
 reason text not null,
 foreign key(updated_by,tenant_id)references public.tenant_users(id,tenant_id)on delete restrict,
 check(btrim(reason)<>'')
);

create table public.financial_period_locks(
 tenant_id uuid primary key references public.tenants(id)on delete cascade,
 locked_through_date date not null,
 active boolean not null default true,
 reason text not null,
 created_by uuid not null,
 created_at timestamptz not null default now(),
 updated_by uuid not null,
 updated_at timestamptz not null default now(),
 foreign key(created_by,tenant_id)references public.tenant_users(id,tenant_id)on delete restrict,
 foreign key(updated_by,tenant_id)references public.tenant_users(id,tenant_id)on delete restrict,
 check(btrim(reason)<>'')
);

create table public.financial_policy_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id)on delete cascade,
 event_type text not null check(event_type in('period_locked','period_unlocked','posting_policy_changed','negative_balance_policy_changed')),
 actor_user_id uuid not null,reason text not null,metadata jsonb not null default'{}'::jsonb,created_at timestamptz not null default now(),
 foreign key(actor_user_id,tenant_id)references public.tenant_users(id,tenant_id)on delete restrict,
 check(btrim(reason)<>''),check(jsonb_typeof(metadata)='object')
);

alter table public.financial_posting_policies enable row level security;
alter table public.financial_period_locks enable row level security;
alter table public.financial_policy_events enable row level security;
create policy financial_posting_policies_read on public.financial_posting_policies for select to authenticated using(tenant_id=public.current_tenant_id());
create policy financial_period_locks_read on public.financial_period_locks for select to authenticated using(tenant_id=public.current_tenant_id());
create policy financial_policy_events_read on public.financial_policy_events for select to authenticated using(tenant_id=public.current_tenant_id());
revoke all on public.financial_posting_policies,public.financial_period_locks,public.financial_policy_events from public,anon,authenticated;
grant select on public.financial_posting_policies,public.financial_period_locks,public.financial_policy_events to authenticated;

create or replace function public.guard_financial_policy_write()returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if current_setting('app.financial_policy_contract',true)<>'on'then raise exception using errcode='42501',message='FINANCIAL_POLICY_REQUIRES_CANONICAL_CONTRACT';end if;
 if tg_op='DELETE'then raise exception using errcode='42501',message='FINANCIAL_POLICY_HISTORY_CANNOT_BE_DELETED';end if;
 return new;
end$$;
create trigger financial_posting_policies_guard before insert or update or delete on public.financial_posting_policies for each row execute function public.guard_financial_policy_write();
create trigger financial_period_locks_guard before insert or update or delete on public.financial_period_locks for each row execute function public.guard_financial_policy_write();
create trigger financial_policy_events_guard before insert or update or delete on public.financial_policy_events for each row execute function public.guard_financial_policy_write();

create or replace function public.assert_financial_posting_date(p_tenant uuid,p_date date)returns date
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare locked date;future_allowed boolean:=false;
begin
 if p_tenant is null or p_date is null then raise exception using errcode='22023',message='FINANCIAL_POSTING_DATE_REQUIRED';end if;
 select p.allow_future_posting into future_allowed from public.financial_posting_policies p where p.tenant_id=p_tenant;
 if p_date>current_date and not coalesce(future_allowed,false)then raise exception using errcode='23514',message='FUTURE_FINANCIAL_POSTING_DATE_NOT_ALLOWED';end if;
 select l.locked_through_date into locked from public.financial_period_locks l where l.tenant_id=p_tenant and l.active;
 if locked is not null and p_date<=locked then raise exception using errcode='23514',message='FINANCIAL_PERIOD_CLOSED';end if;
 return p_date;
end$$;

create or replace function public.enforce_canonical_financial_move_date()returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.state='posted'and(new.ref like'financial\_%'escape'\'or new.pay_method in('canonical_payment','canonical_internal_transfer','canonical_advance_application'))then
  perform public.assert_financial_posting_date(new.tenant_id,new.date::date);
 end if;
 return new;
end$$;
create trigger account_moves_financial_posting_policy before insert or update of date,state on public.account_moves
for each row execute function public.enforce_canonical_financial_move_date();

create or replace function public.enforce_money_destination_balance()returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.money_destinations%rowtype;balance numeric;move_ref text;
begin
 if new.parent_state<>'posted'then return new;end if;
 select m.ref into move_ref from public.account_moves m where m.id=new.move_id and m.tenant_id=new.tenant_id;
 if move_ref like'financial_accounting_reversal:%'then return new;end if;
 select*into d from public.money_destinations x where x.tenant_id=new.tenant_id and x.ledger_account_id=new.account_id and x.status='active';
 if not found or d.allow_negative_balance then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('money-destination-balance:'||new.tenant_id||':'||new.account_id,0));
 perform 1 from public.money_destinations x where x.id=d.id for update;
 select coalesce(sum(l.debit-l.credit),0)into balance from public.account_move_lines l
  where l.tenant_id=new.tenant_id and l.account_id=new.account_id and l.parent_state='posted';
 if balance<0 then raise exception using errcode='23514',message='MONEY_DESTINATION_NEGATIVE_BALANCE_NOT_ALLOWED',detail='destination_id='||d.id||', balance='||balance;end if;
 return new;
end$$;
create trigger account_move_lines_money_destination_balance after insert or update of debit,credit,parent_state,account_id on public.account_move_lines
for each row execute function public.enforce_money_destination_balance();

create or replace function public.set_financial_period_lock(p_tenant uuid,p_locked_through date,p_active boolean,p_reason text)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_tenant_user_id();r text:=nullif(btrim(p_reason),'');existing public.financial_period_locks%rowtype;
begin
 if public.current_tenant_id()is distinct from p_tenant or actor is null then raise exception using errcode='42501',message='FINANCIAL_PERIOD_TENANT_ACCESS_DENIED';end if;
 if not public.has_permission('financial.period.manage',p_tenant)then raise exception using errcode='42501',message='FINANCIAL_PERIOD_MANAGE_DENIED';end if;
 if p_locked_through is null or r is null then raise exception using errcode='22023',message='FINANCIAL_PERIOD_DATE_AND_REASON_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('financial-period:'||p_tenant,0));select*into existing from public.financial_period_locks where tenant_id=p_tenant for update;
 if found and existing.locked_through_date=p_locked_through and existing.active=p_active then return jsonb_build_object('tenant_id',p_tenant,'locked_through_date',p_locked_through,'active',p_active,'idempotent_replay',true);end if;
 perform set_config('app.financial_policy_contract','on',true);
 insert into public.financial_period_locks(tenant_id,locked_through_date,active,reason,created_by,updated_by)
 values(p_tenant,p_locked_through,p_active,r,actor,actor)on conflict(tenant_id)do update set locked_through_date=excluded.locked_through_date,active=excluded.active,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
 insert into public.financial_policy_events(tenant_id,event_type,actor_user_id,reason,metadata)values(p_tenant,case when p_active then'period_locked'else'period_unlocked'end,actor,r,jsonb_build_object('locked_through_date',p_locked_through));
 return jsonb_build_object('tenant_id',p_tenant,'locked_through_date',p_locked_through,'active',p_active,'idempotent_replay',false);
end$$;

create or replace function public.configure_financial_posting_policy(p_tenant uuid,p_allow_future boolean,p_reason text)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_tenant_user_id();r text:=nullif(btrim(p_reason),'');
begin
 if public.current_tenant_id()is distinct from p_tenant or actor is null or not public.has_permission('financial.period.manage',p_tenant)then raise exception using errcode='42501',message='FINANCIAL_POLICY_MANAGE_DENIED';end if;
 if r is null then raise exception using errcode='22023',message='FINANCIAL_POLICY_REASON_REQUIRED';end if;
 perform set_config('app.financial_policy_contract','on',true);
 insert into public.financial_posting_policies(tenant_id,allow_future_posting,updated_by,reason)values(p_tenant,coalesce(p_allow_future,false),actor,r)
 on conflict(tenant_id)do update set allow_future_posting=excluded.allow_future_posting,updated_by=excluded.updated_by,updated_at=now(),reason=excluded.reason;
 insert into public.financial_policy_events(tenant_id,event_type,actor_user_id,reason,metadata)values(p_tenant,'posting_policy_changed',actor,r,jsonb_build_object('allow_future_posting',coalesce(p_allow_future,false)));
 return jsonb_build_object('tenant_id',p_tenant,'allow_future_posting',coalesce(p_allow_future,false));
end$$;

create or replace function public.configure_money_destination_negative_balance(p_tenant uuid,p_destination uuid,p_allow boolean,p_reason text)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_tenant_user_id();r text:=nullif(btrim(p_reason),'');d public.money_destinations%rowtype;
begin
 if public.current_tenant_id()is distinct from p_tenant or actor is null or not public.has_permission('financial.destination.negative_balance',p_tenant)then raise exception using errcode='42501',message='NEGATIVE_BALANCE_POLICY_MANAGE_DENIED';end if;
 if r is null then raise exception using errcode='22023',message='NEGATIVE_BALANCE_POLICY_REASON_REQUIRED';end if;
 select*into d from public.money_destinations where id=p_destination and tenant_id=p_tenant for update;if not found then raise exception using errcode='P0002',message='MONEY_DESTINATION_NOT_FOUND';end if;
 update public.money_destinations set allow_negative_balance=coalesce(p_allow,false),updated_at=now()where id=d.id;
 perform set_config('app.financial_policy_contract','on',true);
 insert into public.financial_policy_events(tenant_id,event_type,actor_user_id,reason,metadata)values(p_tenant,'negative_balance_policy_changed',actor,r,jsonb_build_object('destination_id',d.id,'allow_negative_balance',coalesce(p_allow,false)));
 return jsonb_build_object('destination_id',d.id,'allow_negative_balance',coalesce(p_allow,false));
end$$;

revoke all on function public.assert_financial_posting_date(uuid,date)from public,anon,authenticated;
revoke all on function public.set_financial_period_lock(uuid,date,boolean,text),public.configure_financial_posting_policy(uuid,boolean,text),public.configure_money_destination_negative_balance(uuid,uuid,boolean,text)from public,anon;
grant execute on function public.set_financial_period_lock(uuid,date,boolean,text),public.configure_financial_posting_policy(uuid,boolean,text),public.configure_money_destination_negative_balance(uuid,uuid,boolean,text)to authenticated;

commit;
