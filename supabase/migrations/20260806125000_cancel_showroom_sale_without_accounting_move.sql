begin;

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.preview_showroom_sale_cancellation(uuid,uuid)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $old$if v_sale.account_move_id is null then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'code', 'original_move_missing',
      'message', 'الفاتورة المؤكدة لا تحتوي على account_move_id.',
      'details', jsonb_build_object(
        'sale_number', v_sale.sale_number
      )
    ));$old$,
    $new$if v_sale.account_move_id is null then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'no_accounting_move',
      'message', 'الفاتورة لا تحتوي على قيد محاسبي؛ سيتم إلغاؤها دون إنشاء قيد عكسي.'
    ));$new$
  );
  if v_updated = v_definition then
    raise exception 'تعذر تحديث معاينة الفاتورة التي لا تحتوي على قيد محاسبي.';
  end if;

  v_updated := replace(
    v_updated,
    $old$select count(*), (array_agg(account.id order by account.id))[1]
  into v_receivable_account_count, v_receivable_account_id
  from public.account_accounts account$old$,
    $new$if v_sale.account_move_id is not null then
  select count(*), (array_agg(account.id order by account.id))[1]
  into v_receivable_account_count, v_receivable_account_id
  from public.account_accounts account$new$
  );

  v_updated := replace(
    v_updated,
    $old$  select exists (
    select 1
    from public.tenant_modules tenant_module$old$,
    $new$  end if;

  select exists (
    select 1
    from public.tenant_modules tenant_module$new$
  );
  execute v_updated;

  select pg_get_functiondef(
    'public.cancel_showroom_sale(uuid,uuid,text,text)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $old$if v_sale.account_move_id is null then
    raise exception 'الفاتورة المؤكدة لا تحتوي على قيد بيع أصلي.';
  end if;

  select account_move.*$old$,
    $new$if v_sale.account_move_id is null then
    v_reversal_move_id := null;
  end if;

  if v_sale.account_move_id is not null then
  select account_move.*$new$
  );
  if v_updated = v_definition then
    raise exception 'تعذر إنشاء فرع تنفيذ الإلغاء دون قيد محاسبي.';
  end if;

  v_updated := replace(
    v_updated,
    $old$  select exists (
    select 1
    from public.tenant_modules tenant_module$old$,
    $new$  end if;

  select exists (
    select 1
    from public.tenant_modules tenant_module$new$
  );
  execute v_updated;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
