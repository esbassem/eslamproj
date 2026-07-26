begin;

create or replace function public.delete_account_move_atomic(
  p_tenant_id uuid,
  p_move_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.tenant_users%rowtype;
  v_move public.account_moves%rowtype;
  v_line_ids uuid[] := '{}'::uuid[];
  v_affected_line_ids uuid[] := '{}'::uuid[];
  v_affected_sale_ids uuid[] := '{}'::uuid[];
  v_deleted_reconciliations integer := 0;
  v_deleted_lines integer := 0;
  v_deleted_legacy_payments integer := 0;
  v_sale record;
  v_paid numeric := 0;
  v_remaining numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;
  if p_tenant_id is null or p_move_id is null then
    raise exception 'تعذر تحديد الشركة أو القيد.';
  end if;

  select tenant_user.* into v_user
  from public.tenant_users tenant_user
  where tenant_user.tenant_id = p_tenant_id
    and tenant_user.auth_user_id = auth.uid()
    and coalesce(tenant_user.is_active, true) = true
  order by tenant_user.created_at
  limit 1;

  if v_user.id is null then
    raise exception 'لا تملك صلاحية الوصول إلى هذه الشركة.';
  end if;

  if coalesce(v_user.role, '') not in ('owner', 'admin', 'accountant')
     and not exists (
       select 1
       from public.res_users_groups membership
       join public.res_groups permission_group
         on permission_group.id = membership.group_id
       where membership.tenant_id = p_tenant_id
         and membership.user_id = v_user.id
         and permission_group.active = true
         and permission_group.code = 'accountant_app_manager'
         and (permission_group.tenant_id is null or permission_group.tenant_id = p_tenant_id)
     ) then
    raise exception 'حذف القيود متاح لمدير المحاسب فقط.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':account_move:' || p_move_id::text, 0));

  select account_move.* into v_move
  from public.account_moves account_move
  where account_move.tenant_id = p_tenant_id
    and account_move.id = p_move_id
  for update;

  if v_move.id is null then
    raise exception 'القيد غير موجود أو تم حذفه مسبقًا.';
  end if;
  if v_move.state <> 'posted' then
    raise exception 'يمكن حذف القيود المرحلة فقط من هذه النافذة.';
  end if;
  if v_move.move_type not in ('payment', 'journal') then
    raise exception 'لا يمكن حذف قيد البيع الأصلي من نافذة عمليات الحساب.';
  end if;
  if v_move.payment_id is not null then
    raise exception 'هذا القيد مرتبط بسجل دفع رسمي ويجب حذفه من شاشة المدفوعات.';
  end if;

  perform 1
  from public.account_move_lines move_line
  where move_line.tenant_id = p_tenant_id
    and move_line.move_id = p_move_id
  for update;

  select coalesce(array_agg(move_line.id), '{}'::uuid[]) into v_line_ids
  from public.account_move_lines move_line
  where move_line.tenant_id = p_tenant_id
    and move_line.move_id = p_move_id;

  if coalesce(array_length(v_line_ids, 1), 0) = 0 then
    raise exception 'القيد لا يحتوي على سطور محاسبية.';
  end if;

  select coalesce(array_agg(distinct linked_line_id), '{}'::uuid[])
  into v_affected_line_ids
  from (
    select reconcile.debit_move_id as linked_line_id
    from public.account_partial_reconcile reconcile
    where reconcile.tenant_id = p_tenant_id
      and reconcile.credit_move_id = any(v_line_ids)
      and not (reconcile.debit_move_id = any(v_line_ids))
    union
    select reconcile.credit_move_id as linked_line_id
    from public.account_partial_reconcile reconcile
    where reconcile.tenant_id = p_tenant_id
      and reconcile.debit_move_id = any(v_line_ids)
      and not (reconcile.credit_move_id = any(v_line_ids))
  ) affected;

  select coalesce(array_agg(distinct sale.id), '{}'::uuid[])
  into v_affected_sale_ids
  from public.showroom_sales sale
  join public.account_moves sale_move
    on sale_move.tenant_id = sale.tenant_id
   and sale_move.move_type = 'sale'
   and sale_move.state = 'posted'
   and (
     sale_move.id = sale.account_move_id
     or sale_move.ref = 'showroom_sale:' || sale.id
   )
  join public.account_move_lines invoice_line
    on invoice_line.tenant_id = sale.tenant_id
   and invoice_line.move_id = sale_move.id
   and invoice_line.debit > 0
  join public.account_partial_reconcile reconcile
    on reconcile.tenant_id = sale.tenant_id
   and reconcile.debit_move_id = invoice_line.id
  where sale.tenant_id = p_tenant_id
    and (
      reconcile.debit_move_id = any(v_line_ids)
      or reconcile.credit_move_id = any(v_line_ids)
    );

  delete from public.account_partial_reconcile reconcile
  where reconcile.tenant_id = p_tenant_id
    and (
      reconcile.debit_move_id = any(v_line_ids)
      or reconcile.credit_move_id = any(v_line_ids)
    );
  get diagnostics v_deleted_reconciliations = row_count;

  if to_regclass('public.showroom_sale_payments') is not null then
    delete from public.showroom_sale_payments legacy_payment
    where legacy_payment.tenant_id = p_tenant_id
      and legacy_payment.account_move_id = p_move_id;
    get diagnostics v_deleted_legacy_payments = row_count;
  end if;

  delete from public.account_move_lines move_line
  where move_line.tenant_id = p_tenant_id
    and move_line.move_id = p_move_id;
  get diagnostics v_deleted_lines = row_count;

  delete from public.account_moves account_move
  where account_move.tenant_id = p_tenant_id
    and account_move.id = p_move_id;

  if not found then
    raise exception 'تعذر حذف رأس القيد.';
  end if;

  if coalesce(array_length(v_affected_line_ids, 1), 0) > 0 then
    update public.account_move_lines affected_line
    set
      amount_residual = case
        when affected_line.debit > 0 then greatest(
          affected_line.debit - coalesce((
            select sum(reconcile.amount)
            from public.account_partial_reconcile reconcile
            where reconcile.tenant_id = p_tenant_id
              and reconcile.debit_move_id = affected_line.id
          ), 0),
          0
        )
        else greatest(
          affected_line.credit - coalesce((
            select sum(reconcile.amount)
            from public.account_partial_reconcile reconcile
            where reconcile.tenant_id = p_tenant_id
              and reconcile.credit_move_id = affected_line.id
          ), 0),
          0
        )
      end,
      amount_residual_currency = case
        when affected_line.debit > 0 then greatest(
          affected_line.debit - coalesce((
            select sum(reconcile.amount)
            from public.account_partial_reconcile reconcile
            where reconcile.tenant_id = p_tenant_id
              and reconcile.debit_move_id = affected_line.id
          ), 0),
          0
        )
        else greatest(
          affected_line.credit - coalesce((
            select sum(reconcile.amount)
            from public.account_partial_reconcile reconcile
            where reconcile.tenant_id = p_tenant_id
              and reconcile.credit_move_id = affected_line.id
          ), 0),
          0
        )
      end,
      is_reconciled = not exists (
        select 1
        from public.account_partial_reconcile reconcile
        where reconcile.tenant_id = p_tenant_id
          and (
            reconcile.debit_move_id = affected_line.id
            or reconcile.credit_move_id = affected_line.id
          )
      ) and coalesce(affected_line.debit, 0) = coalesce(affected_line.credit, 0)
    where affected_line.tenant_id = p_tenant_id
      and affected_line.id = any(v_affected_line_ids);

    update public.account_move_lines affected_line
    set is_reconciled = coalesce(affected_line.amount_residual, 0) = 0
    where affected_line.tenant_id = p_tenant_id
      and affected_line.id = any(v_affected_line_ids);
  end if;

  for v_sale in
    select sale.id, sale.total_amount, sale.account_move_id
    from public.showroom_sales sale
    where sale.tenant_id = p_tenant_id
      and sale.id = any(v_affected_sale_ids)
    for update
  loop
    select round(coalesce(sum(reconcile.amount), 0), 2)
    into v_paid
    from public.account_moves sale_move
    join public.account_move_lines invoice_line
      on invoice_line.tenant_id = sale_move.tenant_id
     and invoice_line.move_id = sale_move.id
     and invoice_line.debit > 0
    join public.account_accounts receivable_account
      on receivable_account.tenant_id = invoice_line.tenant_id
     and receivable_account.id = invoice_line.account_id
     and receivable_account.code = '114001'
    left join public.account_partial_reconcile reconcile
      on reconcile.tenant_id = invoice_line.tenant_id
     and reconcile.debit_move_id = invoice_line.id
    where sale_move.tenant_id = p_tenant_id
      and sale_move.move_type = 'sale'
      and sale_move.state = 'posted'
      and (
        sale_move.id = v_sale.account_move_id
        or sale_move.ref = 'showroom_sale:' || v_sale.id
      );

    v_remaining := round(greatest(coalesce(v_sale.total_amount, 0) - coalesce(v_paid, 0), 0), 2);

    update public.showroom_sales
    set
      paid_amount = coalesce(v_paid, 0),
      remaining_amount = v_remaining,
      updated_at = now()
    where tenant_id = p_tenant_id
      and id = v_sale.id;
  end loop;

  return jsonb_build_object(
    'success', true,
    'move_id', p_move_id,
    'deleted_move_name', v_move.name,
    'deleted_lines', v_deleted_lines,
    'deleted_reconciliations', v_deleted_reconciliations,
    'deleted_legacy_payments', v_deleted_legacy_payments,
    'affected_sales', coalesce(array_length(v_affected_sale_ids, 1), 0)
  );
exception
  when others then
    raise;
end;
$$;

revoke all on function public.delete_account_move_atomic(uuid, uuid) from public, anon;
grant execute on function public.delete_account_move_atomic(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';

commit;
