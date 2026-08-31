begin;

insert into public.auth_permissions (
  code, name, description, resource, action,
  module_code, permission_type, sort_order, active
)
values (
  'financial.transfer.reverse', 'عكس تحويل مالي',
  'عكس الأثر المحاسبي المرحل لتحويل مالي دون تغيير تاريخه التشغيلي.',
  'financial.transfer', 'reverse', 'accountant_app', 'action', 240, true
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  resource = excluded.resource,
  action = excluded.action,
  module_code = excluded.module_code,
  permission_type = excluded.permission_type,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = now();

-- These identifiers are immutable historical references. Keeping restrictive
-- foreign keys to the live partial-reconcile table makes canonical unapply
-- impossible because unapply must remove those live reconciliations.
alter table public.financial_advance_applications
  drop constraint if exists financial_advance_application_advance_partial_reconcile_id_fkey,
  drop constraint if exists financial_advance_application_target_partial_reconcile_id_fkey,
  drop constraint if exists financial_advance_applications_advance_partial_reconcile_id_fkey,
  drop constraint if exists financial_advance_applications_target_partial_reconcile_id_fkey;

create or replace function public.get_financial_reversal_eligibility(
  p_tenant uuid,
  p_domain text,
  p_domain_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  operation_state text;
  transfer_mode text;
  transfer_status text;
  active_allocations bigint := 0;
  active_applications bigint := 0;
  already_reversed boolean := false;
  required_effect_present boolean := false;
  authorized boolean := false;
  blockers jsonb := '[]'::jsonb;
begin
  if public.current_tenant_id() <> p_tenant then
    raise exception using errcode = '42501', message = 'REVERSAL_TENANT_ACCESS_DENIED';
  end if;

  if p_domain = 'payment' then
    select p.accounting_state into operation_state
    from public.financial_payments p
    where p.id = p_domain_id and p.tenant_id = p_tenant;

    select count(*) into active_allocations
    from public.financial_payment_allocations a
    where a.tenant_id = p_tenant and a.payment_id = p_domain_id and a.status = 'active';

    select count(*) into active_applications
    from public.financial_advance_applications a
    where a.tenant_id = p_tenant and a.advance_payment_id = p_domain_id and a.status = 'active';

    required_effect_present := exists (
      select 1 from public.financial_payment_accounting_links l
      join public.account_moves m on m.id = l.account_move_id and m.tenant_id = l.tenant_id
      where l.tenant_id = p_tenant and l.payment_id = p_domain_id
        and l.entry_type = 'posting' and m.state = 'posted'
    );
    authorized := public.has_permission('financial.payment.reverse', p_tenant);

    if operation_state is not null and operation_state <> 'posted' then
      blockers := blockers || '"PAYMENT_ACCOUNTING_NOT_REVERSIBLE"'::jsonb;
    end if;
    if not required_effect_present and operation_state is not null then
      blockers := blockers || '"PAYMENT_POSTING_LINK_MISSING"'::jsonb;
    end if;
    if active_allocations > 0 then
      blockers := blockers || '"PAYMENT_HAS_ACTIVE_ALLOCATIONS"'::jsonb;
    end if;
    if active_applications > 0 then
      blockers := blockers || '"PAYMENT_HAS_ACTIVE_ADVANCE_APPLICATIONS"'::jsonb;
    end if;

  elsif p_domain = 'internal_transfer' then
    select t.accounting_state, t.transfer_mode, t.status
      into operation_state, transfer_mode, transfer_status
    from public.financial_internal_transfers t
    where t.id = p_domain_id and t.tenant_id = p_tenant;

    required_effect_present := case
      when transfer_mode = 'immediate' then exists (
        select 1 from public.financial_internal_transfer_accounting_links l
        join public.account_moves m on m.id = l.account_move_id and m.tenant_id = l.tenant_id
        where l.tenant_id = p_tenant and l.transfer_id = p_domain_id
          and l.entry_type = 'immediate' and m.state = 'posted'
      )
      else exists (
        select 1 from public.financial_internal_transfer_accounting_links l
        join public.account_moves m on m.id = l.account_move_id and m.tenant_id = l.tenant_id
        where l.tenant_id = p_tenant and l.transfer_id = p_domain_id
          and l.entry_type = 'send' and m.state = 'posted'
      )
    end;
    authorized := public.has_permission('financial.transfer.reverse', p_tenant);

    if transfer_status = 'draft' then
      blockers := blockers || '"TRANSFER_HAS_NO_ACCOUNTING_EFFECT"'::jsonb;
    elsif operation_state is not null and operation_state <> 'active' then
      blockers := blockers || '"ACCOUNTING_EFFECT_ALREADY_REVERSED"'::jsonb;
    elsif not required_effect_present and operation_state is not null then
      blockers := blockers || '"TRANSFER_ACCOUNTING_LINK_MISSING"'::jsonb;
    elsif transfer_mode = 'in_transit' and transfer_status in ('received', 'confirmed') and not exists (
      select 1 from public.financial_internal_transfer_accounting_links l
      join public.account_moves m on m.id = l.account_move_id and m.tenant_id = l.tenant_id
      where l.tenant_id = p_tenant and l.transfer_id = p_domain_id
        and l.entry_type = 'receive' and m.state = 'posted'
    ) then
      blockers := blockers || '"TRANSFER_RECEIVE_LINK_MISSING"'::jsonb;
    end if;

  elsif p_domain = 'advance_application' then
    select a.status into operation_state
    from public.financial_advance_applications a
    where a.id = p_domain_id and a.tenant_id = p_tenant;

    required_effect_present := exists (
      select 1 from public.financial_advance_applications a
      join public.account_moves m on m.id = a.reclassification_move_id and m.tenant_id = a.tenant_id
      where a.id = p_domain_id and a.tenant_id = p_tenant and m.state = 'posted'
        and a.advance_partial_reconcile_id is not null
        and a.target_partial_reconcile_id is not null
    );
    authorized := public.has_permission('financial.reconciliation.manage', p_tenant);

    if operation_state is not null and operation_state <> 'active' then
      blockers := blockers || '"ADVANCE_APPLICATION_ALREADY_UNAPPLIED"'::jsonb;
    elsif not required_effect_present and operation_state is not null then
      blockers := blockers || '"ADVANCE_APPLICATION_ACCOUNTING_EFFECT_MISSING"'::jsonb;
    end if;
  else
    raise exception using errcode = '22023', message = 'REVERSAL_DOMAIN_INVALID';
  end if;

  already_reversed := exists (
    select 1 from public.financial_accounting_reversals r
    where r.tenant_id = p_tenant and r.domain_type = p_domain and r.domain_id = p_domain_id
  );

  if operation_state is null then
    blockers := blockers || '"DOMAIN_OPERATION_NOT_FOUND"'::jsonb;
  end if;
  if already_reversed and not (blockers @> '["ACCOUNTING_EFFECT_ALREADY_REVERSED"]'::jsonb) then
    blockers := blockers || '"ACCOUNTING_EFFECT_ALREADY_REVERSED"'::jsonb;
  end if;
  if not authorized then
    blockers := blockers || '"REVERSAL_AUTHORIZATION_DENIED"'::jsonb;
  end if;

  return jsonb_build_object(
    'eligible', jsonb_array_length(blockers) = 0,
    'accounting_state', operation_state,
    'already_reversed', already_reversed,
    'active_allocations', active_allocations,
    'active_advance_applications', active_applications,
    'blockers', blockers,
    'reversal', (
      select to_jsonb(r) from public.financial_accounting_reversals r
      where r.tenant_id = p_tenant and r.domain_type = p_domain and r.domain_id = p_domain_id
    )
  );
end
$$;

create or replace function public.reverse_financial_payment_accounting(p_tenant uuid,p_payment uuid,p_reason text,p_idempotency text,p_reversal_date date default current_date)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare p public.financial_payments%rowtype;existing public.financial_accounting_reversals%rowtype;rid uuid:=gen_random_uuid();fp text;num text;orig uuid;rev uuid;actor uuid:=public.current_tenant_user_id();l record;rl uuid;pid uuid;reason text:=nullif(btrim(p_reason),'');begin
 if reason is null then raise exception using errcode='22023',message='ACCOUNTING_REVERSAL_REASON_REQUIRED';end if;if nullif(btrim(coalesce(p_idempotency,'')),'')is null then raise exception using errcode='22023',message='ACCOUNTING_REVERSAL_IDEMPOTENCY_REQUIRED';end if;
 fp:=encode(extensions.digest(jsonb_build_object('domain','payment','id',p_payment,'reason',reason,'date',p_reversal_date)::text,'sha256'),'hex');perform pg_advisory_xact_lock(hashtextextended('payment_reversal:'||p_tenant||':'||p_payment,0));
 select*into existing from public.financial_accounting_reversals where tenant_id=p_tenant and idempotency_key=btrim(p_idempotency);if found then if existing.request_fingerprint<>fp then raise exception using errcode='23505',message='ACCOUNTING_REVERSAL_IDEMPOTENCY_PAYLOAD_MISMATCH';end if;return jsonb_build_object('reversal_id',existing.id,'reversal_number',existing.reversal_number,'idempotent_replay',true);end if;
 select*into p from public.financial_payments where id=p_payment and tenant_id=p_tenant for update;if not found then raise exception using errcode='P0002',message='FINANCIAL_PAYMENT_NOT_FOUND';end if;
 perform public.assert_financial_authorized(p_tenant,'financial.payment.reverse',null,null,p.branch_id,true);
 if p.accounting_state='reversed'or exists(select 1 from public.financial_accounting_reversals where tenant_id=p_tenant and domain_type='payment'and domain_id=p.id)then raise exception using errcode='23514',message='ACCOUNTING_EFFECT_ALREADY_REVERSED';end if;
 if p.accounting_state<>'posted'then raise exception using errcode='23514',message='PAYMENT_ACCOUNTING_NOT_REVERSIBLE';end if;
 if exists(select 1 from public.financial_payment_allocations where tenant_id=p_tenant and payment_id=p.id and status='active')then raise exception using errcode='23514',message='PAYMENT_HAS_ACTIVE_ALLOCATIONS';end if;if public.financial_advance_has_active_applications(p_tenant,p.id)then raise exception using errcode='23514',message='PAYMENT_HAS_ACTIVE_ADVANCE_APPLICATIONS';end if;
 if p.money_destination_id is not null then perform*from public.resolve_money_destination_for_action(p_tenant,p.money_destination_id,'financial.payment.reverse','confirm',p.branch_id,null);end if;
 select account_move_id into orig from public.financial_payment_accounting_links where tenant_id=p_tenant and payment_id=p.id and entry_type='posting';if orig is null then raise exception using errcode='23514',message='PAYMENT_POSTING_LINK_MISSING';end if;
 num:=public.next_financial_accounting_reversal_number(p_tenant);perform set_config('app.financial_accounting_reversal_contract',rid::text,true);insert into public.financial_accounting_reversals(id,tenant_id,reversal_number,domain_type,domain_id,reason,reversal_date,idempotency_key,request_fingerprint,requested_by,completed_by)values(rid,p_tenant,num,'payment',p.id,reason,p_reversal_date,btrim(p_idempotency),fp,actor,actor);
 rev:=public.create_reversing_account_move(rid,p_tenant,orig,'payment_posting',p_reversal_date,actor);
 for l in select ol.*,ll.reversal_line_id from public.account_move_lines ol join public.account_accounts a on a.id=ol.account_id and a.tenant_id=ol.tenant_id join public.financial_accounting_reversal_line_links ll on ll.original_line_id=ol.id and ll.reversal_id=rid where ol.move_id=orig and a.reconcile and a.open_item_reconcile and ol.amount_residual>0 loop rl:=l.reversal_line_id;if l.debit>0 then pid:=public.reversal_create_partial(rid,p_tenant,l.id,rl,l.amount_residual,actor,'payment_open_item');else pid:=public.reversal_create_partial(rid,p_tenant,rl,l.id,l.amount_residual,actor,'payment_open_item');end if;end loop;
 perform set_config('app.financial_payment_reversal_contract',p.id::text,true);insert into public.financial_payment_accounting_links(tenant_id,payment_id,account_move_id,entry_type,created_by)values(p_tenant,p.id,rev,'reversal',actor);update public.financial_payments set accounting_state='reversed'where id=p.id;
 insert into public.financial_payment_events(tenant_id,payment_id,event_type,from_status,to_status,actor_user_id,reason,metadata)values(p_tenant,p.id,'reversed',p.status,p.status,actor,reason,jsonb_build_object('accounting_only',true,'reversal_id',rid,'reversal_move_id',rev));insert into public.financial_accounting_reversal_events(tenant_id,reversal_id,event_type,actor_user_id,reason,metadata)values(p_tenant,rid,'payment_accounting_reversed',actor,reason,jsonb_build_object('original_move_id',orig,'reversal_move_id',rev));return jsonb_build_object('reversal_id',rid,'reversal_number',num,'reversal_move_id',rev,'idempotent_replay',false);end $$;

-- The full transfer reversal body is replaced below by the canonical Phase 7
-- implementation with only its authorization contract changed from confirm to reverse.
create or replace function public.reverse_internal_transfer_accounting(
  p_tenant uuid, p_transfer uuid, p_reason text, p_idempotency text,
  p_reversal_date date default current_date
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  t public.financial_internal_transfers%rowtype;
  existing public.financial_accounting_reversals%rowtype;
  rid uuid := gen_random_uuid(); fp text; num text;
  actor uuid := public.current_tenant_user_id(); orig uuid; rev uuid;
  result jsonb := '[]'; reason text := nullif(btrim(p_reason), '');
begin
  if reason is null then raise exception using errcode='22023',message='ACCOUNTING_REVERSAL_REASON_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_idempotency,'')),'') is null then raise exception using errcode='22023',message='ACCOUNTING_REVERSAL_IDEMPOTENCY_REQUIRED'; end if;
  fp:=encode(extensions.digest(jsonb_build_object('domain','internal_transfer','id',p_transfer,'reason',reason,'date',p_reversal_date)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('transfer_reversal:'||p_tenant||':'||p_transfer,0));
  select * into existing from public.financial_accounting_reversals where tenant_id=p_tenant and idempotency_key=btrim(p_idempotency);
  if found then
    if existing.request_fingerprint<>fp then raise exception using errcode='23505',message='ACCOUNTING_REVERSAL_IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('reversal_id',existing.id,'reversal_number',existing.reversal_number,'moves',(select coalesce(jsonb_agg(jsonb_build_object('stage',stage,'move_id',reversal_move_id)order by id),'[]')from public.financial_accounting_reversal_move_links where reversal_id=existing.id),'idempotent_replay',true);
  end if;
  select * into t from public.financial_internal_transfers where id=p_transfer and tenant_id=p_tenant for update;
  if not found then raise exception using errcode='P0002',message='INTERNAL_TRANSFER_NOT_FOUND'; end if;
  perform public.assert_financial_authorized(p_tenant,'financial.transfer.reverse',null,null,t.source_branch_id,true);
  perform * from public.resolve_internal_transfer_destination(p_tenant,t.source_destination_id,'financial.transfer.reverse','transfer_from',t.source_branch_id);
  perform * from public.resolve_internal_transfer_destination(p_tenant,t.destination_destination_id,'financial.transfer.reverse','transfer_to',t.destination_branch_id);
  if t.accounting_state<>'active'or exists(select 1 from public.financial_accounting_reversals where tenant_id=p_tenant and domain_type='internal_transfer'and domain_id=t.id)then raise exception using errcode='23514',message='ACCOUNTING_EFFECT_ALREADY_REVERSED'; end if;
  if t.status='draft' then raise exception using errcode='23514',message='TRANSFER_HAS_NO_ACCOUNTING_EFFECT'; end if;
  num:=public.next_financial_accounting_reversal_number(p_tenant);
  perform set_config('app.financial_accounting_reversal_contract',rid::text,true);
  insert into public.financial_accounting_reversals(id,tenant_id,reversal_number,domain_type,domain_id,reason,reversal_date,idempotency_key,request_fingerprint,requested_by,completed_by,metadata)
  values(rid,p_tenant,num,'internal_transfer',t.id,reason,p_reversal_date,btrim(p_idempotency),fp,actor,actor,jsonb_build_object('transfer_mode',t.transfer_mode,'operational_status',t.status));
  if t.transfer_mode='immediate' then
    select account_move_id into orig from public.financial_internal_transfer_accounting_links where tenant_id=p_tenant and transfer_id=t.id and entry_type='immediate';
    if orig is null then raise exception using errcode='23514',message='TRANSFER_ACCOUNTING_LINK_MISSING'; end if;
    rev:=public.create_reversing_account_move(rid,p_tenant,orig,'transfer_immediate',p_reversal_date,actor);
    insert into public.financial_internal_transfer_accounting_links(tenant_id,transfer_id,account_move_id,entry_type,created_by)values(p_tenant,t.id,rev,'reversal_immediate',actor);
    result:=result||jsonb_build_object('stage','reversal_immediate','move_id',rev);
  else
    if t.status in('received','confirmed') then
      select account_move_id into orig from public.financial_internal_transfer_accounting_links where tenant_id=p_tenant and transfer_id=t.id and entry_type='receive';
      if orig is null then raise exception using errcode='23514',message='TRANSFER_RECEIVE_LINK_MISSING'; end if;
      rev:=public.create_reversing_account_move(rid,p_tenant,orig,'transfer_receive',p_reversal_date,actor);
      insert into public.financial_internal_transfer_accounting_links(tenant_id,transfer_id,account_move_id,entry_type,created_by)values(p_tenant,t.id,rev,'reversal_receive',actor);
      result:=result||jsonb_build_object('stage','reversal_receive','move_id',rev);
    end if;
    select account_move_id into orig from public.financial_internal_transfer_accounting_links where tenant_id=p_tenant and transfer_id=t.id and entry_type='send';
    if orig is null then raise exception using errcode='23514',message='TRANSFER_SEND_LINK_MISSING'; end if;
    rev:=public.create_reversing_account_move(rid,p_tenant,orig,'transfer_send',p_reversal_date,actor);
    insert into public.financial_internal_transfer_accounting_links(tenant_id,transfer_id,account_move_id,entry_type,created_by)values(p_tenant,t.id,rev,'reversal_send',actor);
    result:=result||jsonb_build_object('stage','reversal_send','move_id',rev);
  end if;
  perform set_config('app.internal_transfer_reversal_contract',t.id::text,true);
  update public.financial_internal_transfers set accounting_state='reversed',accounting_reversed_by=actor,accounting_reversed_at=now(),accounting_reversal_id=rid where id=t.id;
  insert into public.financial_accounting_reversal_events(tenant_id,reversal_id,event_type,actor_user_id,reason,metadata)values(p_tenant,rid,'transfer_accounting_reversed',actor,reason,jsonb_build_object('moves',result));
  return jsonb_build_object('reversal_id',rid,'reversal_number',num,'moves',result,'idempotent_replay',false);
end
$$;

revoke all on function public.get_financial_reversal_eligibility(uuid,text,uuid) from public, anon;
grant execute on function public.get_financial_reversal_eligibility(uuid,text,uuid) to authenticated;
revoke all on function public.reverse_financial_payment_accounting(uuid,uuid,text,text,date) from public, anon;
grant execute on function public.reverse_financial_payment_accounting(uuid,uuid,text,text,date) to authenticated;
revoke all on function public.reverse_internal_transfer_accounting(uuid,uuid,text,text,date) from public, anon;
grant execute on function public.reverse_internal_transfer_accounting(uuid,uuid,text,text,date) to authenticated;

comment on function public.reverse_internal_transfer_accounting(uuid,uuid,text,text,date) is
  'Canonical transfer accounting reversal. Requires the dedicated financial.transfer.reverse permission plus source/destination resource scope.';

commit;
