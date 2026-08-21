begin;

do $$
declare
  v_replace text:=pg_get_functiondef('public.create_confirmed_showroom_sale_return(uuid,uuid,jsonb,text,text,uuid)'::regprocedure);
  v_confirm text:=pg_get_functiondef('public.confirm_processor_paperwork_cancellation(uuid,uuid,text)'::regprocedure);
  v_guard text:=pg_get_functiondef('public.guard_paperwork_processor_cancellation()'::regprocedure);
begin
  if position('paperwork_request_cancelled_by_sale_replacement' in v_replace)=0
     or position('paperwork_request_cancelled_by_sale_return' in v_replace)=0 then
    raise exception 'TEST_FAILED: early paperwork cancellation branch is missing';
  end if;
  if position('pending_processor_cancellation' in v_replace)=0
     or position('processor_cancellation_required_by_sale_return' in v_replace)=0
     or position('status=''open''' in v_replace)=0 then
    raise exception 'TEST_FAILED: sent request is not kept open pending processor cancellation';
  end if;
  if position('processor_cancellation_blocking_request_id' in v_replace)=0 then
    raise exception 'TEST_FAILED: replacement request is not linked to its blocking predecessor';
  end if;
  if position('يوجد طلب سابق لدى جهة الإصدار ينتظر تأكيد الإلغاء' in v_guard)=0 then
    raise exception 'TEST_FAILED: same-processor send guard is missing';
  end if;
  if position('pending_processor_cancellation' in v_confirm)=0
     or position('processor_cancellation_confirmed' in v_confirm)=0
     or position('processor_cancellation_confirmed_at' in v_confirm)=0 then
    raise exception 'TEST_FAILED: atomic processor cancellation confirmation is incomplete';
  end if;
  if position('require_paperwork_action(p_tenant_id, ''paperwork.cancel'')' in v_confirm)=0
     or position('is_tenant_owner' in v_confirm)>0
     or position('can_manage_paperwork_requests' in v_confirm)>0 then
    raise exception 'TEST_FAILED: processor cancellation must require paperwork.cancel';
  end if;
  if not exists(
    select 1 from pg_constraint c
    where c.conrelid='public.paperwork_requests'::regclass
      and c.conname='paperwork_requests_current_stage_check'
      and pg_get_constraintdef(c.oid) like '%pending_processor_cancellation%'
  ) then raise exception 'TEST_FAILED: pending stage is not reportable/filterable'; end if;
  if not exists(
    select 1 from pg_trigger
    where tgrelid='public.paperwork_requests'::regclass
      and tgname='paperwork_requests_guard_processor_cancellation' and not tgisinternal
  ) then raise exception 'TEST_FAILED: paperwork transition guard trigger is missing'; end if;
  raise notice 'paperwork sale replacement cancellation contract tests passed';
end $$;

rollback;
