begin;

insert into public.auth_permissions(
  code,name,description,resource,action,module_code,permission_type,sort_order,active
) values
  ('financial.refund.reverse','عكس الأثر المحاسبي للرد','إنشاء عكس محاسبي مستقل لرد مالي مرحل.','financial.refund','reverse','accountant_app','action',174,true),
  ('financial.settlement.reverse','عكس الأثر المحاسبي للتسوية','إنشاء عكس محاسبي مستقل لتسوية مزود مرحلة.','financial.settlement','reverse','accountant_app','action',184,true)
on conflict(code) do update set name=excluded.name,description=excluded.description,
  resource=excluded.resource,action=excluded.action,module_code=excluded.module_code,
  permission_type=excluded.permission_type,sort_order=excluded.sort_order,
  active=true,updated_at=now();

alter table public.financial_accounting_reversals
  drop constraint financial_accounting_reversals_domain_type_check,
  add constraint financial_accounting_reversals_domain_type_check
    check(domain_type in('payment','internal_transfer','advance_application','refund','settlement'));
alter table public.financial_accounting_reversal_move_links
  drop constraint financial_accounting_reversal_move_links_stage_check,
  add constraint financial_accounting_reversal_move_links_stage_check
    check(stage in('payment_posting','transfer_immediate','transfer_send','transfer_receive',
      'advance_reclassification','refund_posting','settlement_posting'));
alter table public.financial_accounting_reversal_reconcile_links
  drop constraint financial_accounting_reversal_reconcile_links_role_check,
  add constraint financial_accounting_reversal_reconcile_links_role_check
    check(role in('payment_open_item','advance_source','advance_target',
      'reclassification_cleanup_advance','reclassification_cleanup_target',
      'refund_source','refund_cleanup','settlement_source','settlement_cleanup'));
alter table public.financial_accounting_reversal_events
  drop constraint financial_accounting_reversal_events_event_type_check,
  add constraint financial_accounting_reversal_events_event_type_check
    check(event_type in('payment_accounting_reversed','transfer_accounting_reversed',
      'advance_unapplied','refund_accounting_reversed','settlement_accounting_reversed'));

-- Preserve the immutable settlement-to-partial audit identifier after the
-- protected reversal helper removes the live reconciliation row.
alter table public.financial_settlement_item_reconcile_links
  drop constraint financial_settlement_item_reconcile_l_partial_reconcile_id_fkey;

create or replace function public.guard_financial_refund()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='DELETE' then raise exception using errcode='23514',message='FINANCIAL_REFUND_IMMUTABLE';end if;
  if tg_op='INSERT'and current_setting('app.financial_refund_contract',true)=new.id::text then return new;end if;
  if tg_op='UPDATE'and current_setting('app.financial_refund_contract',true)=old.id::text then
    if old.accounting_state<>'posted'then return new;end if;
    if old.accounting_state='posted'and new.accounting_state='reversed'
       and (to_jsonb(new)-'accounting_state'-'updated_at')
         is not distinct from(to_jsonb(old)-'accounting_state'-'updated_at')then return new;end if;
  end if;
  raise exception using errcode='42501',message='FINANCIAL_REFUND_REQUIRES_CANONICAL_CONTRACT';
end $$;

create or replace function public.guard_financial_settlement_immutable()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='42501',message='FINANCIAL_SETTLEMENT_IMMUTABLE';
  end if;
  if old.accounting_state='posted' and new.accounting_state='reversed'
     and current_setting('app.financial_settlement_reversal_contract',true)=old.id::text
     and (to_jsonb(new)-'accounting_state'-'updated_at')
       is not distinct from(to_jsonb(old)-'accounting_state'-'updated_at') then return new;
  end if;
  if old.accounting_state='posted' then
    raise exception using errcode='42501',message='FINANCIAL_SETTLEMENT_IMMUTABLE';
  end if;
  return new;
end $$;

create or replace function public.resolve_financial_refund_reversal_context(
  p_tenant uuid,p_refund uuid,p_reversal_date date
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare r public.financial_refunds%rowtype;l public.financial_refund_accounting_links%rowtype;
  m public.account_moves%rowtype;partial public.account_partial_reconcile%rowtype;
  refund_line uuid;liquidity_line uuid;liquidity_account uuid;access_type text;
begin
  if public.current_tenant_id() is distinct from p_tenant then
    raise exception using errcode='42501',message='REFUND_REVERSAL_TENANT_ACCESS_DENIED';
  end if;
  select*into r from public.financial_refunds where id=p_refund and tenant_id=p_tenant;
  if not found then raise exception using errcode='P0002',message='FINANCIAL_REFUND_NOT_FOUND';end if;
  perform public.assert_financial_authorized(p_tenant,'financial.refund.reverse',null,null,r.branch_id,
    r.status='confirmed'and r.accounting_state='posted');
  select*into l from public.financial_refund_accounting_links
    where tenant_id=p_tenant and refund_id=r.id and entry_type='posting';
  if not found then raise exception using errcode='23514',message='REFUND_POSTING_LINK_INVALID';end if;
  select*into m from public.account_moves where id=l.account_move_id and tenant_id=p_tenant;
  if not found or m.state<>'posted'or m.ref is distinct from'financial_refund:'||r.id then
    raise exception using errcode='23514',message='REFUND_ORIGINAL_MOVE_INVALID';end if;
  if p_reversal_date is null or p_reversal_date<m.date::date then
    raise exception using errcode='23514',message='REVERSAL_DATE_BEFORE_ORIGINAL_DATE';end if;
  select*into partial from public.account_partial_reconcile
    where id=l.source_partial_reconcile_id and tenant_id=p_tenant;
  if not found or partial.amount<>r.amount then
    raise exception using errcode='23514',message='REFUND_SOURCE_RECONCILIATION_INVALID';end if;
  select line.id into refund_line from public.account_move_lines line
    where line.tenant_id=p_tenant and line.move_id=m.id and line.line_type='open_item'
      and line.partner_id=r.partner_id and line.account_id=(select account_id from public.account_move_lines where id=r.source_account_line_id)
      and line.id in(partial.debit_move_id,partial.credit_move_id);
  if refund_line is null or r.source_account_line_id not in(partial.debit_move_id,partial.credit_move_id)
     or (select count(*)from public.account_partial_reconcile p where p.tenant_id=p_tenant
       and refund_line in(p.debit_move_id,p.credit_move_id))<>1 then
    raise exception using errcode='23514',message='REFUND_RECONCILIATION_DEPENDENCY_CONFLICT';end if;
  select line.id,line.account_id into liquidity_line,liquidity_account
    from public.account_move_lines line where line.tenant_id=p_tenant and line.move_id=m.id
      and line.line_type='liquidity' limit 1;
  if liquidity_line is null then raise exception using errcode='23514',message='REFUND_LIQUIDITY_LINE_INVALID';end if;
  access_type:=case when r.direction='outbound'then'confirm'else'pay_out'end;
  perform public.assert_financial_authorized(p_tenant,'financial.refund.reverse',liquidity_account,access_type,r.branch_id,true);
  perform public.assert_financial_authorized(p_tenant,'financial.refund.reverse',
    (select account_id from public.account_move_lines where id=r.source_account_line_id),'reconcile',r.branch_id,true);
  if exists(select 1 from public.financial_accounting_reversals reversal
    where reversal.tenant_id=p_tenant and reversal.domain_type='refund'and reversal.domain_id=r.id)then
    raise exception using errcode='23514',message='ACCOUNTING_EFFECT_ALREADY_REVERSED';end if;
  return jsonb_build_object('refund_id',r.id,'original_move_id',m.id,
    'source_partial_id',partial.id,'refund_open_line_id',refund_line,
    'liquidity_line_id',liquidity_line,'amount',r.amount,'branch_id',r.branch_id);
end $$;

create or replace function public.resolve_financial_settlement_reversal_context(
  p_tenant uuid,p_settlement uuid,p_reversal_date date
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare s public.financial_settlements%rowtype;l public.financial_settlement_accounting_links%rowtype;
  m public.account_moves%rowtype;item public.financial_settlement_items%rowtype;
  link public.financial_settlement_item_reconcile_links%rowtype;partial public.account_partial_reconcile%rowtype;
  clearing_line uuid;clearing_account uuid;liquidity_account uuid;validated numeric:=0;
begin
  if public.current_tenant_id() is distinct from p_tenant then
    raise exception using errcode='42501',message='SETTLEMENT_REVERSAL_TENANT_ACCESS_DENIED';end if;
  select*into s from public.financial_settlements where id=p_settlement and tenant_id=p_tenant;
  if not found then raise exception using errcode='P0002',message='FINANCIAL_SETTLEMENT_NOT_FOUND';end if;
  perform public.assert_financial_authorized(p_tenant,'financial.settlement.reverse',null,null,s.branch_id,
    s.status='confirmed'and s.accounting_state='posted');
  select*into l from public.financial_settlement_accounting_links where tenant_id=p_tenant and settlement_id=s.id;
  if not found then raise exception using errcode='23514',message='SETTLEMENT_POSTING_LINK_INVALID';end if;
  select*into m from public.account_moves where id=l.account_move_id and tenant_id=p_tenant;
  if not found or m.state<>'posted'or m.ref is distinct from'financial_settlement:'||s.id then
    raise exception using errcode='23514',message='SETTLEMENT_ORIGINAL_MOVE_INVALID';end if;
  if p_reversal_date is null or p_reversal_date<m.date::date then
    raise exception using errcode='23514',message='REVERSAL_DATE_BEFORE_ORIGINAL_DATE';end if;
  select line.id,line.account_id into clearing_line,clearing_account from public.account_move_lines line
    where line.tenant_id=p_tenant and line.move_id=m.id and line.line_type='open_item'
      and line.credit=s.gross_amount limit 1;
  select line.account_id into liquidity_account from public.account_move_lines line
    where line.tenant_id=p_tenant and line.move_id=m.id and line.line_type='liquidity' limit 1;
  if clearing_line is null or liquidity_account is null then
    raise exception using errcode='23514',message='SETTLEMENT_ORIGINAL_LINES_INVALID';end if;
  perform public.assert_financial_authorized(p_tenant,'financial.settlement.reverse',clearing_account,'reconcile',s.branch_id,true);
  perform public.assert_financial_authorized(p_tenant,'financial.settlement.reverse',liquidity_account,'pay_out',s.branch_id,true);
  for item in select*from public.financial_settlement_items where tenant_id=p_tenant and settlement_id=s.id order by source_clearing_line_id loop
    select*into link from public.financial_settlement_item_reconcile_links
      where tenant_id=p_tenant and settlement_item_id=item.id;
    select*into partial from public.account_partial_reconcile
      where tenant_id=p_tenant and id=link.partial_reconcile_id;
    if link.id is null or partial.id is null or link.settlement_clearing_line_id<>clearing_line
       or partial.debit_move_id<>item.source_clearing_line_id
       or partial.credit_move_id<>clearing_line or partial.amount<>item.gross_amount then
      raise exception using errcode='23514',message='SETTLEMENT_ITEM_RECONCILIATION_INVALID';end if;
    validated:=validated+item.gross_amount;
  end loop;
  if validated<>s.gross_amount or (select count(*)from public.account_partial_reconcile p
      where p.tenant_id=p_tenant and clearing_line in(p.debit_move_id,p.credit_move_id))
      <>(select count(*)from public.financial_settlement_items i where i.tenant_id=p_tenant and i.settlement_id=s.id)then
    raise exception using errcode='23514',message='SETTLEMENT_RECONCILIATION_DEPENDENCY_CONFLICT';end if;
  if exists(select 1 from public.financial_accounting_reversals reversal
    where reversal.tenant_id=p_tenant and reversal.domain_type='settlement'and reversal.domain_id=s.id)then
    raise exception using errcode='23514',message='ACCOUNTING_EFFECT_ALREADY_REVERSED';end if;
  return jsonb_build_object('settlement_id',s.id,'original_move_id',m.id,
    'settlement_clearing_line_id',clearing_line,'clearing_account_id',clearing_account,
    'liquidity_account_id',liquidity_account,'gross_amount',s.gross_amount,
    'fees_amount',s.fees_amount,'net_amount',s.net_amount,'branch_id',s.branch_id);
end $$;

create or replace function public.get_financial_refund_reversal_eligibility(
  p_tenant uuid,p_refund uuid,p_reversal_date date default current_date
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare context jsonb;
begin
  if public.current_tenant_id() is distinct from p_tenant then raise exception using errcode='42501',message='REFUND_REVERSAL_TENANT_ACCESS_DENIED';end if;
  begin context:=public.resolve_financial_refund_reversal_context(p_tenant,p_refund,p_reversal_date);
  exception when others then return jsonb_build_object('eligible',false,'blockers',jsonb_build_array(sqlerrm));end;
  return context||jsonb_build_object('eligible',true,'blockers','[]'::jsonb,'eligible_at',statement_timestamp());
end $$;

create or replace function public.get_financial_settlement_reversal_eligibility(
  p_tenant uuid,p_settlement uuid,p_reversal_date date default current_date
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare context jsonb;
begin
  if public.current_tenant_id() is distinct from p_tenant then raise exception using errcode='42501',message='SETTLEMENT_REVERSAL_TENANT_ACCESS_DENIED';end if;
  begin context:=public.resolve_financial_settlement_reversal_context(p_tenant,p_settlement,p_reversal_date);
  exception when others then return jsonb_build_object('eligible',false,'blockers',jsonb_build_array(sqlerrm));end;
  return context||jsonb_build_object('eligible',true,'blockers','[]'::jsonb,'eligible_at',statement_timestamp());
end $$;

create or replace function public.reverse_financial_refund_accounting(
  p_tenant uuid,p_refund uuid,p_reason text,p_idempotency text,p_reversal_date date default current_date
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.financial_refunds%rowtype;existing public.financial_accounting_reversals%rowtype;
  context jsonb;rid uuid:=gen_random_uuid();fp text;num text;actor uuid:=public.current_tenant_user_id();
  reversal_move uuid;original_open uuid;reversal_open uuid;partial_id uuid;reason text:=nullif(btrim(p_reason),'');
begin
  if reason is null or nullif(btrim(coalesce(p_idempotency,'')),'')is null then raise exception using errcode='22023',message='REVERSAL_REASON_AND_IDEMPOTENCY_REQUIRED';end if;
  fp:=encode(extensions.digest(jsonb_build_object('domain','refund','id',p_refund,'reason',reason,'date',p_reversal_date)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('accounting_reversal:refund:'||p_tenant||':'||p_refund,0));
  select*into existing from public.financial_accounting_reversals where tenant_id=p_tenant and idempotency_key=btrim(p_idempotency);
  if found then if existing.domain_type<>'refund'or existing.domain_id<>p_refund or existing.request_fingerprint<>fp then raise exception using errcode='23505',message='REVERSAL_IDEMPOTENCY_PAYLOAD_MISMATCH';end if;
    return jsonb_build_object('reversal_id',existing.id,'reversal_number',existing.reversal_number,'reversal_move_id',(select reversal_move_id from public.financial_accounting_reversal_move_links where reversal_id=existing.id and stage='refund_posting'),'idempotent_replay',true);end if;
  select*into r from public.financial_refunds where id=p_refund and tenant_id=p_tenant for update;
  context:=public.resolve_financial_refund_reversal_context(p_tenant,p_refund,p_reversal_date);
  num:=public.next_financial_accounting_reversal_number(p_tenant);perform set_config('app.financial_accounting_reversal_contract',rid::text,true);
  insert into public.financial_accounting_reversals(id,tenant_id,reversal_number,domain_type,domain_id,reason,reversal_date,idempotency_key,request_fingerprint,requested_by,completed_by,metadata)
  values(rid,p_tenant,num,'refund',r.id,reason,p_reversal_date,btrim(p_idempotency),fp,actor,actor,jsonb_build_object('original_move_id',context->>'original_move_id','source_partial_id',context->>'source_partial_id'));
  perform public.reversal_remove_partial(rid,p_tenant,(context->>'source_partial_id')::uuid,'refund_source');
  reversal_move:=public.create_reversing_account_move(rid,p_tenant,(context->>'original_move_id')::uuid,'refund_posting',p_reversal_date,actor);
  original_open:=(context->>'refund_open_line_id')::uuid;
  select line_link.reversal_line_id into reversal_open from public.financial_accounting_reversal_line_links line_link where line_link.reversal_id=rid and line_link.original_line_id=original_open;
  if (select debit from public.account_move_lines where id=original_open)>0 then
    partial_id:=public.reversal_create_partial(rid,p_tenant,original_open,reversal_open,r.amount,actor,'refund_cleanup');
  else partial_id:=public.reversal_create_partial(rid,p_tenant,reversal_open,original_open,r.amount,actor,'refund_cleanup');end if;
  perform set_config('app.financial_refund_contract',r.id::text,true);
  update public.financial_refunds set accounting_state='reversed',updated_at=now()where id=r.id;
  insert into public.financial_refund_events(tenant_id,refund_id,event_type,from_status,to_status,actor_user_id,reason,metadata)
  values(p_tenant,r.id,'accounting_reversed',r.status,r.status,actor,reason,jsonb_build_object('reversal_id',rid,'original_move_id',context->>'original_move_id','reversal_move_id',reversal_move,'cleanup_partial_id',partial_id));
  perform set_config('app.financial_accounting_reversal_contract',rid::text,true);
  insert into public.financial_accounting_reversal_events(tenant_id,reversal_id,event_type,actor_user_id,reason,metadata)
  values(p_tenant,rid,'refund_accounting_reversed',actor,reason,jsonb_build_object('domain_id',r.id,'original_move_id',context->>'original_move_id','reversal_move_id',reversal_move));
  return jsonb_build_object('reversal_id',rid,'reversal_number',num,'reversal_move_id',reversal_move,'accounting_state','reversed','idempotent_replay',false);
end $$;

create or replace function public.reverse_financial_settlement_accounting(
  p_tenant uuid,p_settlement uuid,p_reason text,p_idempotency text,p_reversal_date date default current_date
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.financial_settlements%rowtype;existing public.financial_accounting_reversals%rowtype;
  context jsonb;rid uuid:=gen_random_uuid();fp text;num text;actor uuid:=public.current_tenant_user_id();
  reversal_move uuid;original_clear uuid;reversal_clear uuid;item public.financial_settlement_items%rowtype;
  link public.financial_settlement_item_reconcile_links%rowtype;cleanup uuid;reason text:=nullif(btrim(p_reason),'');
begin
  if reason is null or nullif(btrim(coalesce(p_idempotency,'')),'')is null then raise exception using errcode='22023',message='REVERSAL_REASON_AND_IDEMPOTENCY_REQUIRED';end if;
  fp:=encode(extensions.digest(jsonb_build_object('domain','settlement','id',p_settlement,'reason',reason,'date',p_reversal_date)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('accounting_reversal:settlement:'||p_tenant||':'||p_settlement,0));
  select*into existing from public.financial_accounting_reversals where tenant_id=p_tenant and idempotency_key=btrim(p_idempotency);
  if found then if existing.domain_type<>'settlement'or existing.domain_id<>p_settlement or existing.request_fingerprint<>fp then raise exception using errcode='23505',message='REVERSAL_IDEMPOTENCY_PAYLOAD_MISMATCH';end if;
    return jsonb_build_object('reversal_id',existing.id,'reversal_number',existing.reversal_number,'reversal_move_id',(select reversal_move_id from public.financial_accounting_reversal_move_links where reversal_id=existing.id and stage='settlement_posting'),'idempotent_replay',true);end if;
  select*into s from public.financial_settlements where id=p_settlement and tenant_id=p_tenant for update;
  context:=public.resolve_financial_settlement_reversal_context(p_tenant,p_settlement,p_reversal_date);
  num:=public.next_financial_accounting_reversal_number(p_tenant);perform set_config('app.financial_accounting_reversal_contract',rid::text,true);
  insert into public.financial_accounting_reversals(id,tenant_id,reversal_number,domain_type,domain_id,reason,reversal_date,idempotency_key,request_fingerprint,requested_by,completed_by,metadata)
  values(rid,p_tenant,num,'settlement',s.id,reason,p_reversal_date,btrim(p_idempotency),fp,actor,actor,jsonb_build_object('original_move_id',context->>'original_move_id','gross',s.gross_amount,'fees',s.fees_amount,'net',s.net_amount));
  for item in select*from public.financial_settlement_items where tenant_id=p_tenant and settlement_id=s.id order by source_clearing_line_id loop
    select*into link from public.financial_settlement_item_reconcile_links where tenant_id=p_tenant and settlement_item_id=item.id;
    perform public.reversal_remove_partial(rid,p_tenant,link.partial_reconcile_id,'settlement_source');
  end loop;
  reversal_move:=public.create_reversing_account_move(rid,p_tenant,(context->>'original_move_id')::uuid,'settlement_posting',p_reversal_date,actor);
  original_clear:=(context->>'settlement_clearing_line_id')::uuid;
  select line_link.reversal_line_id into reversal_clear from public.financial_accounting_reversal_line_links line_link where line_link.reversal_id=rid and line_link.original_line_id=original_clear;
  cleanup:=public.reversal_create_partial(rid,p_tenant,reversal_clear,original_clear,s.gross_amount,actor,'settlement_cleanup');
  perform set_config('app.financial_settlement_reversal_contract',s.id::text,true);
  update public.financial_settlements set accounting_state='reversed',updated_at=now()where id=s.id;
  insert into public.financial_settlement_events(tenant_id,settlement_id,event_type,from_status,to_status,actor_user_id,metadata)
  values(p_tenant,s.id,'accounting_reversed',s.status,s.status,actor,jsonb_build_object('reversal_id',rid,'original_move_id',context->>'original_move_id','reversal_move_id',reversal_move,'cleanup_partial_id',cleanup));
  perform set_config('app.financial_accounting_reversal_contract',rid::text,true);
  insert into public.financial_accounting_reversal_events(tenant_id,reversal_id,event_type,actor_user_id,reason,metadata)
  values(p_tenant,rid,'settlement_accounting_reversed',actor,reason,jsonb_build_object('domain_id',s.id,'original_move_id',context->>'original_move_id','reversal_move_id',reversal_move));
  return jsonb_build_object('reversal_id',rid,'reversal_number',num,'reversal_move_id',reversal_move,'accounting_state','reversed','idempotent_replay',false);
end $$;

revoke all on function public.resolve_financial_refund_reversal_context(uuid,uuid,date),
  public.resolve_financial_settlement_reversal_context(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.get_financial_refund_reversal_eligibility(uuid,uuid,date),
  public.get_financial_settlement_reversal_eligibility(uuid,uuid,date),
  public.reverse_financial_refund_accounting(uuid,uuid,text,text,date),
  public.reverse_financial_settlement_accounting(uuid,uuid,text,text,date) from public,anon;
grant execute on function public.get_financial_refund_reversal_eligibility(uuid,uuid,date),
  public.get_financial_settlement_reversal_eligibility(uuid,uuid,date),
  public.reverse_financial_refund_accounting(uuid,uuid,text,text,date),
  public.reverse_financial_settlement_accounting(uuid,uuid,text,text,date) to authenticated;

comment on function public.reverse_financial_refund_accounting(uuid,uuid,text,text,date) is
  'Canonically removes the explicit refund reconciliation, creates an exact inverse of the posted refund move, cleans the refund/reversal open-item pair, and restores the source residual.';
comment on function public.reverse_financial_settlement_accounting(uuid,uuid,text,text,date) is
  'Canonically removes only this settlement item reconciliations, creates an exact inverse of the original posted settlement move, and restores each clearing source residual.';

commit;
