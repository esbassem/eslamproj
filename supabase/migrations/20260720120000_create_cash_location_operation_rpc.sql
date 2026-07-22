begin;

create or replace function public.create_cash_location_operation(
  p_tenant_id uuid,
  p_cash_account_id uuid,
  p_counter_account_id uuid,
  p_direction text,
  p_amount numeric,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.tenant_users%rowtype;
  v_cash_account public.account_accounts%rowtype;
  v_counter_account public.account_accounts%rowtype;
  v_custody_parent_group_id uuid;
  v_direction text := lower(btrim(coalesce(p_direction, '')));
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_move_id uuid := gen_random_uuid();
  v_move_name text;
  v_branch_id uuid;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;

  if v_direction not in ('in', 'out') then
    raise exception 'اختر نوع عملية صحيح.';
  end if;

  if v_amount <= 0 then
    raise exception 'مبلغ العملية يجب أن يكون أكبر من صفر.';
  end if;

  if v_notes is null then
    raise exception 'اكتب بيان العملية.';
  end if;

  select tenant_user.*
  into v_user
  from public.tenant_users tenant_user
  where tenant_user.tenant_id = p_tenant_id
    and tenant_user.auth_user_id = auth.uid()
    and coalesce(tenant_user.is_active, true) = true
  order by tenant_user.created_at
  limit 1;

  if v_user.id is null then
    raise exception 'لا تملك صلاحية تسجيل عملية لهذه المؤسسة.';
  end if;

  select account.*
  into v_cash_account
  from public.account_accounts account
  where account.id = p_cash_account_id
    and account.tenant_id = p_tenant_id
    and account.active = true;

  if v_cash_account.id is null then
    raise exception 'الخزنة أو العهدة غير موجودة أو غير نشطة.';
  end if;

  select account.group_id
  into v_custody_parent_group_id
  from public.account_accounts account
  where account.tenant_id = p_tenant_id
    and (account.code::text = '111003' or account.name = 'نقدية لدى الموظفين')
  order by (account.code::text = '111003') desc, account.active desc
  limit 1;

  if v_cash_account.code::text <> '111001'
    and not (
      v_custody_parent_group_id is not null
      and v_cash_account.responsible_user_id is not null
      and v_cash_account.group_id = v_custody_parent_group_id
    )
  then
    raise exception 'الحساب المحدد ليس خزنة رئيسية أو عهدة موظف.';
  end if;

  select account.*
  into v_counter_account
  from public.account_accounts account
  where account.id = p_counter_account_id
    and account.tenant_id = p_tenant_id
    and account.active = true;

  if v_counter_account.id is null then
    raise exception 'الحساب المقابل غير موجود أو غير نشط.';
  end if;

  if v_counter_account.id = v_cash_account.id then
    raise exception 'اختر حسابًا مقابلًا مختلفًا عن الخزنة.';
  end if;

  select branch.id
  into v_branch_id
  from public.branches branch
  where branch.tenant_id = p_tenant_id
    and coalesce(branch.is_active, true) = true
  order by branch.created_at nulls last, branch.id
  limit 1;

  v_move_name := 'CASH-' || upper(substr(replace(v_move_id::text, '-', ''), 1, 12));

  insert into public.account_moves (
    id, tenant_id, branch_id, name, move_type, invoice_date, date,
    amount_total, state, ref, notes, currency_code, created_by
  ) values (
    v_move_id, p_tenant_id, v_branch_id, v_move_name, 'journal', current_date, now(),
    v_amount, 'posted', 'cash_location_manual:' || v_move_id, v_notes, 'EGP', v_user.id
  );

  insert into public.account_move_lines (
    id, tenant_id, move_id, account_id, label, quantity, unit_price,
    debit, credit, line_type, is_reconciled, amount_residual,
    amount_residual_currency, parent_state, currency_code, created_by
  ) values
    (
      gen_random_uuid(), p_tenant_id, v_move_id, v_cash_account.id, v_notes, 1, v_amount,
      case when v_direction = 'in' then v_amount else 0 end,
      case when v_direction = 'out' then v_amount else 0 end,
      'liquidity', true, 0, 0, 'posted', 'EGP', v_user.id
    ),
    (
      gen_random_uuid(), p_tenant_id, v_move_id, v_counter_account.id, v_notes, 1, v_amount,
      case when v_direction = 'out' then v_amount else 0 end,
      case when v_direction = 'in' then v_amount else 0 end,
      'other', true, 0, 0, 'posted', 'EGP', v_user.id
    );

  return jsonb_build_object(
    'id', v_move_id,
    'name', v_move_name,
    'cash_account_id', v_cash_account.id,
    'counter_account_id', v_counter_account.id,
    'direction', v_direction,
    'amount', v_amount
  );
end;
$$;

revoke all on function public.create_cash_location_operation(uuid, uuid, uuid, text, numeric, text) from public;
grant execute on function public.create_cash_location_operation(uuid, uuid, uuid, text, numeric, text) to authenticated;

comment on function public.create_cash_location_operation(uuid, uuid, uuid, text, numeric, text) is
'Posts a balanced manual cash movement for the main treasury or an employee custody account.';

commit;
