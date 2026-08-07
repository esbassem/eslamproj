begin;

do $migration$
declare
  v_preview_definition text;
  v_cancel_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef(
    'public.preview_showroom_sale_cancellation(uuid,uuid)'::regprocedure
  ) into v_preview_definition;

  v_updated_definition := replace(
    v_preview_definition,
    $old$if v_row.current_stage = 'preparation' then$old$,
    $new$if v_row.status = 'cancelled' and v_row.current_stage = 'cancelled' then
      v_paperwork_requests := v_paperwork_requests || jsonb_build_array(jsonb_build_object(
        'request_id', v_row.id,
        'status', v_row.status,
        'current_stage', v_row.current_stage,
        'action_if_cancelled', 'none_already_cancelled',
        'blocker', false,
        'blocker_reason', null
      ));
    elsif v_row.current_stage = 'preparation' then$new$
  );

  if v_updated_definition = v_preview_definition then
    raise exception 'تعذر تحديث قاعدة طلبات الأوراق في معاينة إلغاء الفاتورة.';
  end if;

  v_updated_definition := replace(
    v_updated_definition,
    $old$then 'طلب الأوراق ملغي مسبقًا ويحتاج مراجعة اتساق يدوية.'$old$,
    $new$then 'حالة طلب الأوراق غير متسقة: المرحلة ملغاة لكن حالة الطلب ليست ملغاة.'$new$
  );
  execute v_updated_definition;

  select pg_get_functiondef(
    'public.cancel_showroom_sale(uuid,uuid,text,text)'::regprocedure
  ) into v_cancel_definition;

  v_updated_definition := replace(
    v_cancel_definition,
    $old$if v_request.current_stage <> 'preparation' then
      raise exception 'طلب الأوراق تجاوز مرحلة preparation.';
    end if;$old$,
    $new$if v_request.status = 'cancelled' and v_request.current_stage = 'cancelled' then
      continue;
    end if;
    if v_request.current_stage <> 'preparation' then
      raise exception 'طلب الأوراق تجاوز مرحلة preparation.';
    end if;$new$
  );

  if v_updated_definition = v_cancel_definition then
    raise exception 'تعذر تحديث قاعدة طلبات الأوراق في تنفيذ إلغاء الفاتورة.';
  end if;
  execute v_updated_definition;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
