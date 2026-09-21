begin;

alter table public.financial_accounting_reversals drop constraint financial_accounting_reversals_domain_type_check;
alter table public.financial_accounting_reversals add constraint financial_accounting_reversals_domain_type_check
  check (domain_type in ('payment','internal_transfer','advance_application','refund','settlement','sale_posting','legacy_move_repair'));
alter table public.financial_accounting_reversal_move_links drop constraint financial_accounting_reversal_move_links_stage_check;
alter table public.financial_accounting_reversal_move_links add constraint financial_accounting_reversal_move_links_stage_check
  check (stage in ('payment_posting','transfer_immediate','transfer_send','transfer_receive','advance_reclassification','refund_posting','settlement_posting','sale_posting','legacy_missing_journal'));
alter table public.financial_accounting_reversal_reconcile_links drop constraint financial_accounting_reversal_reconcile_links_role_check;
alter table public.financial_accounting_reversal_reconcile_links add constraint financial_accounting_reversal_reconcile_links_role_check
  check (role in ('payment_open_item','advance_source','advance_target','reclassification_cleanup_advance','reclassification_cleanup_target','refund_source','refund_cleanup','settlement_source','settlement_cleanup','sale_receivable','legacy_receivable_cleanup'));
alter table public.financial_accounting_reversal_events drop constraint financial_accounting_reversal_events_event_type_check;
alter table public.financial_accounting_reversal_events add constraint financial_accounting_reversal_events_event_type_check
  check (event_type in ('payment_accounting_reversed','transfer_accounting_reversed','advance_unapplied','refund_accounting_reversed','settlement_accounting_reversed','sale_posting_reversed','legacy_move_repaired'));

create function pg_temp.reverse_legacy_missing_journal_move(
  p_reversal uuid,p_tenant uuid,p_original uuid,p_repair_journal uuid,p_date date,p_actor uuid
) returns uuid language plpgsql set search_path=pg_catalog,public as $$
declare
  o public.account_moves%rowtype;
  v_move_id uuid := gen_random_uuid();
  v_move_link_id uuid := gen_random_uuid();
  l record;
  v_line_id uuid;
begin
  if current_setting('app.legacy_missing_journal_repair',true) is distinct from p_reversal::text
     or current_setting('app.financial_accounting_reversal_contract',true) is distinct from p_reversal::text then
    raise exception using errcode='42501',message='LEGACY_MISSING_JOURNAL_REPAIR_CONTEXT_REQUIRED';
  end if;
  select * into o from public.account_moves where id=p_original and tenant_id=p_tenant for update;
  if not found or o.state<>'posted' or o.journal_id is not null then
    raise exception using errcode='23514',message='LEGACY_MALFORMED_POSTED_MOVE_REQUIRED';
  end if;
  if p_original<>'c09713d3-2da3-4f66-ba38-780dea3ae8df'::uuid then
    raise exception using errcode='23514',message='LEGACY_REPAIR_MOVE_NOT_ALLOWLISTED';
  end if;
  if not exists(select 1 from public.account_journals j where j.id=p_repair_journal and j.tenant_id=p_tenant
    and j.is_active and j.type='general' and j.code='GEN') then
    raise exception using errcode='23514',message='CANONICAL_GENERAL_JOURNAL_REQUIRED';
  end if;
  if (select count(*) from public.account_journals j where j.tenant_id=p_tenant and j.is_active and j.type='general')<>1 then
    raise exception using errcode='23514',message='CANONICAL_GENERAL_JOURNAL_NOT_UNIQUE';
  end if;
  if exists(select 1 from public.account_moves m where m.tenant_id=p_tenant and m.reversed_entry_id=o.id) then
    raise exception using errcode='23514',message='ACCOUNTING_EFFECT_ALREADY_REVERSED';
  end if;

  insert into public.account_moves(id,tenant_id,branch_id,journal_id,name,move_type,partner_id,invoice_date,date,
    amount_total,state,ref,notes,pay_method,currency_code,created_by,reversed_entry_id)
  values(v_move_id,p_tenant,o.branch_id,p_repair_journal,'LEGACY-REPAIR-'||upper(left(replace(v_move_id::text,'-',''),12)),
    'journal',o.partner_id,p_date,p_date,o.amount_total,'posted','financial_accounting_reversal:'||p_reversal,
    'LEGACY_MISSING_ORIGINAL_JOURNAL; original_move='||o.id::text,o.pay_method,o.currency_code,p_actor,o.id);
  insert into public.financial_accounting_reversal_move_links(id,tenant_id,reversal_id,stage,original_move_id,reversal_move_id)
  values(v_move_link_id,p_tenant,p_reversal,'legacy_missing_journal',o.id,v_move_id);

  for l in select * from public.account_move_lines where move_id=o.id and tenant_id=p_tenant order by id loop
    v_line_id:=gen_random_uuid();
    insert into public.account_move_lines(id,tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,
      line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
    values(v_line_id,p_tenant,v_move_id,l.account_id,l.partner_id,'Legacy repair reversal — '||l.label,
      coalesce(l.quantity,1),l.unit_price,l.credit,l.debit,l.line_type,
      case when l.line_type='open_item' then false else true end,
      case when l.line_type='open_item' then l.debit+l.credit else 0 end,
      case when l.line_type='open_item' then l.debit+l.credit else 0 end,'posted',l.currency_code,p_actor);
    insert into public.financial_accounting_reversal_line_links(tenant_id,reversal_id,move_link_id,original_line_id,reversal_line_id)
    values(p_tenant,p_reversal,v_move_link_id,l.id,v_line_id);
  end loop;
  perform public.accounting_assert_move_balanced(v_move_id);
  return v_move_id;
end $$;

do $$
declare
  v_sale_id constant uuid := '43c00089-d7dd-4119-b0e7-cd89c1d97343';
  v_original_id constant uuid := 'c09713d3-2da3-4f66-ba38-780dea3ae8df';
  v_original_ar constant uuid := 'c290939c-38f6-44f5-8056-a80e06e6a5cd';
  v_credit_exception_ar constant uuid := '51bcc530-1f84-4054-996b-57e3e51077bf';
  v_key constant text := 'legacy-repair:test-sale-reversal:43c00089-d7dd-4119-b0e7-cd89c1d97343';
  o public.account_moves%rowtype; e public.financial_accounting_reversals%rowtype;
  j uuid; actor uuid; rid uuid:=gen_random_uuid(); num text; rev_move uuid; rev_ar uuid; partial uuid; fp text; replay boolean:=false;
  bm bigint:=(select count(*) from public.account_moves); bl bigint:=(select count(*) from public.account_move_lines);
  br bigint:=(select count(*) from public.account_partial_reconcile); bp bigint:=(select count(*) from public.financial_payments);
  bs bigint:=(select count(*) from public.stock_moves); bir bigint:=(select count(*) from public.inventory_reservations);
  bth text:=(select md5(string_agg(id::text||':'||status,',' order by id)) from public.stock_tracking_units);
  bcredit numeric:=(select amount_residual from public.account_move_lines where id=v_credit_exception_ar);
begin
  select * into o from public.account_moves where id=v_original_id for update;
  if not found or o.state<>'posted' or o.journal_id is not null or o.amount_total<>50000
     or o.reversed_entry_id is not null or o.reversed_move_id is not null
     or (select sum(debit) from public.account_move_lines where move_id=v_original_id)<>50000
     or (select sum(credit) from public.account_move_lines where move_id=v_original_id)<>50000
     or (select count(*) from public.account_move_lines l join public.account_accounts a on a.id=l.account_id and a.tenant_id=l.tenant_id where l.id=v_original_ar and a.code='114001' and l.debit=50000)<>1
     or (select count(*) from public.account_move_lines l join public.account_accounts a on a.id=l.account_id and a.tenant_id=l.tenant_id where l.move_id=v_original_id and a.code='411000' and l.credit=50000)<>1
     or exists(select 1 from public.sales where id=v_sale_id)
  then raise exception 'LEGACY_TEST_SALE_PREFLIGHT_FAILED'; end if;
  select id into j from public.account_journals where tenant_id=o.tenant_id and is_active and type='general';
  if j is null or (select count(*) from public.account_journals where tenant_id=o.tenant_id and is_active and type='general')<>1
     or (select code from public.account_journals where id=j)<>'GEN' then raise exception 'CANONICAL_GENERAL_JOURNAL_NOT_UNIQUE'; end if;
  select id into actor from public.tenant_users where tenant_id=o.tenant_id and is_active and role='owner';
  if actor is null or (select count(*) from public.tenant_users where tenant_id=o.tenant_id and is_active and role='owner')<>1 then
    raise exception 'LEGACY_TEST_SALE_MAINTENANCE_ACTOR_NOT_UNIQUE';
  end if;
  fp:=encode(extensions.digest(jsonb_build_object('original_move_id',v_original_id,'repair_journal_id',j,
    'reason','LEGACY_MISSING_ORIGINAL_JOURNAL','amount',50000)::text,'sha256'),'hex');
  select * into e from public.financial_accounting_reversals where tenant_id=o.tenant_id and idempotency_key=v_key;
  if found then
    replay:=true;
    if e.domain_type<>'legacy_move_repair' or e.domain_id<>v_original_id or e.request_fingerprint<>fp then
      raise exception 'LEGACY_TEST_SALE_REPAIR_REPLAY_MISMATCH'; end if;
  else
    if (select amount_residual from public.account_move_lines where id=v_original_ar)<>50000
       or exists(select 1 from public.account_partial_reconcile where debit_move_id=v_original_ar or credit_move_id=v_original_ar) then
      raise exception 'LEGACY_TEST_SALE_OPEN_AR_PREFLIGHT_FAILED';
    end if;
    perform public.assert_financial_posting_date(o.tenant_id,current_date);
    num:=public.next_financial_accounting_reversal_number(o.tenant_id);
    perform set_config('app.financial_accounting_reversal_contract',rid::text,true);
    perform set_config('app.legacy_missing_journal_repair',rid::text,true);
    insert into public.financial_accounting_reversals(id,tenant_id,reversal_number,domain_type,domain_id,reason,reversal_date,
      idempotency_key,request_fingerprint,requested_by,completed_by,metadata)
    values(rid,o.tenant_id,num,'legacy_move_repair',v_original_id,'LEGACY_MISSING_ORIGINAL_JOURNAL',current_date,
      v_key,fp,actor,actor,jsonb_build_object('legacy_sale_id',v_sale_id,'disposition','TEST_LEGACY_RECORD_EXCLUDED_FROM_CANONICAL',
      'original_journal_id',null,'repair_journal_id',j,'maintenance_actor_basis','SOLE_ACTIVE_TENANT_OWNER'));
    rev_move:=pg_temp.reverse_legacy_missing_journal_move(rid,o.tenant_id,v_original_id,j,current_date,actor);
    select ll.reversal_line_id into rev_ar from public.financial_accounting_reversal_line_links ll
    where ll.reversal_id=rid and ll.original_line_id=v_original_ar;
    if rev_ar is null or (select credit from public.account_move_lines where id=rev_ar)<>50000 then
      raise exception 'LEGACY_TEST_SALE_REVERSAL_AR_INVALID'; end if;
    partial:=public.reversal_create_partial(rid,o.tenant_id,v_original_ar,rev_ar,50000,actor,'legacy_receivable_cleanup');
    insert into public.financial_accounting_reversal_events(tenant_id,reversal_id,event_type,actor_user_id,reason,metadata)
    values(o.tenant_id,rid,'legacy_move_repaired',actor,'LEGACY_MISSING_ORIGINAL_JOURNAL',
      jsonb_build_object('legacy_sale_id',v_sale_id,'original_move_id',v_original_id,'reversal_move_id',rev_move,
      'partial_reconcile_id',partial,'disposition','TEST_LEGACY_RECORD_EXCLUDED_FROM_CANONICAL'));
    perform set_config('app.legacy_missing_journal_repair','',true);
    perform set_config('app.financial_accounting_reversal_contract','',true);
  end if;

  if (select amount_residual from public.account_move_lines where id=v_original_ar)<>0
     or (select count(*) from public.account_moves where tenant_id=o.tenant_id and reversed_entry_id=v_original_id)<>1
     or (select count(*) from public.financial_accounting_reversal_reconcile_links l join public.financial_accounting_reversals r on r.id=l.reversal_id and r.tenant_id=l.tenant_id where r.idempotency_key=v_key and l.role='legacy_receivable_cleanup')<>1
     or exists(select 1 from public.sales where id=v_sale_id)
     or (select amount_residual from public.account_move_lines where id=v_credit_exception_ar)<>bcredit
     or bp<>(select count(*) from public.financial_payments) or bs<>(select count(*) from public.stock_moves)
     or bir<>(select count(*) from public.inventory_reservations)
     or bth is distinct from (select md5(string_agg(id::text||':'||status,',' order by id)) from public.stock_tracking_units)
     or (select coalesce(sum(debit),0) from public.account_move_lines where parent_state='posted')<>(select coalesce(sum(credit),0) from public.account_move_lines where parent_state='posted')
  then raise exception 'LEGACY_TEST_SALE_REPAIR_POSTFLIGHT_FAILED'; end if;
  if not replay and (bm+1<>(select count(*) from public.account_moves) or bl+2<>(select count(*) from public.account_move_lines) or br+1<>(select count(*) from public.account_partial_reconcile)) then
    raise exception 'LEGACY_TEST_SALE_REPAIR_CARDINALITY_FAILED'; end if;
end $$;

commit;
