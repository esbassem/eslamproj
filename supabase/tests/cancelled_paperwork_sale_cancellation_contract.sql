begin;

do $$
declare
  v_preview text := pg_get_functiondef(
    'public.preview_showroom_sale_cancellation(uuid,uuid)'::regprocedure
  );
  v_cancel text := pg_get_functiondef(
    'public.cancel_showroom_sale(uuid,uuid,text,text)'::regprocedure
  );
begin
  if position(
    'v_row.status = ''cancelled'' and v_row.current_stage = ''cancelled'''
    in v_preview
  ) = 0 then
    raise exception 'TEST_FAILED: preview still blocks consistently cancelled paperwork';
  end if;
  if position('none_already_cancelled' in v_preview) = 0 then
    raise exception 'TEST_FAILED: preview does not classify cancelled paperwork as no-op';
  end if;
  if position(
    'v_request.status = ''cancelled'' and v_request.current_stage = ''cancelled'''
    in v_cancel
  ) = 0 or position('continue' in v_cancel) = 0 then
    raise exception 'TEST_FAILED: cancellation execution does not skip cancelled paperwork';
  end if;
end;
$$;

rollback;
