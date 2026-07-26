begin;

create or replace function public.create_accountant_payment_entity_credit(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid := nullif(payload ->> 'tenant_id', '')::uuid;
  v_branch_id uuid := nullif(payload ->> 'branch_id', '')::uuid;
  v_customer_id uuid := nullif(payload ->> 'customer_id', '')::uuid;
  v_payment_entity_id uuid := nullif(payload ->> 'payment_entity_id', '')::uuid;
  v_amount numeric := round(coalesce(nullif(payload ->> 'amount', '')::numeric, 0), 2);
  v_notes text := nullif(btrim(coalesce(payload ->> 'notes', '')), '');
  v_attachment jsonb := payload -> 'attachment';
  v_attachment_bucket text := nullif(btrim(coalesce(v_attachment ->> 'bucket_name', v_attachment ->> 'bucket', '')), '');
  v_attachment_path text := nullif(btrim(coalesce(v_attachment ->> 'file_path', v_attachment ->> 'path', '')), '');
  v_attachment_original_name text := nullif(btrim(coalesce(v_attachment ->> 'original_file_name', v_attachment ->> 'name', '')), '');
  v_attachment_mime_type text := nullif(btrim(coalesce(v_attachment ->> 'mime_type', v_attachment ->> 'mimeType', '')), '');
  v_attachment_file_size bigint := nullif(coalesce(v_attachment ->> 'file_size', v_attachment ->> 'size', ''), '')::bigint;
  v_user public.tenant_users%rowtype;
  v_customer public.partners%rowtype;
  v_payment_entity public.partners%rowtype;
  v_customer_receivable_account public.account_accounts%rowtype;
  v_entity_receivable_account public.account_accounts%rowtype;
  v_move_id uuid := gen_random_uuid();
  v_entity_receivable_line_id uuid := gen_random_uuid();
  v_open_credit_line_id uuid := gen_random_uuid();
  v_move_name text := 'ACC-PAY-' || upper(substr(replace(v_move_id::text, '-', ''), 1, 10));
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_line_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;

  if v_tenant_id is null then
    raise exception 'لا توجد شركة نشطة.';
  end if;

  select tenant_user.*
  into v_user
  from public.tenant_users tenant_user
  where tenant_user.tenant_id = v_tenant_id
    and tenant_user.auth_user_id = auth.uid()
    and coalesce(tenant_user.is_active, true) = true
  order by tenant_user.created_at, tenant_user.id
  limit 1;

  if v_user.id is null then
    raise exception 'لا تملك صلاحية تسجيل اعتماد داخل هذه الشركة.';
  end if;

  if v_customer_id is null then
    raise exception 'اختر العميل أولاً.';
  end if;

  select partner.*
  into v_customer
  from public.partners partner
  where partner.id = v_customer_id
    and partner.tenant_id = v_tenant_id
    and coalesce(partner.active, true) = true;

  if v_customer.id is null then
    raise exception 'العميل المحدد غير موجود أو غير نشط داخل الشركة.';
  end if;

  if v_payment_entity_id is null then
    raise exception 'اختر الجهة أولاً.';
  end if;

  select partner.*
  into v_payment_entity
  from public.partners partner
  where partner.id = v_payment_entity_id
    and partner.tenant_id = v_tenant_id
    and coalesce(partner.active, true) = true;

  if v_payment_entity.id is null then
    raise exception 'جهة الدفع المحددة غير موجودة أو غير نشطة داخل الشركة.';
  end if;

  if v_customer.id = v_payment_entity.id then
    raise exception 'يجب أن تكون جهة الدفع مختلفة عن العميل.';
  end if;

  if v_amount <= 0 then
    raise exception 'اكتب مبلغ صحيح أكبر من صفر.';
  end if;

  if v_branch_id is null then
    select branch.id
    into v_branch_id
    from public.branches branch
    where branch.tenant_id = v_tenant_id
      and coalesce(branch.is_active, true) = true
    order by branch.created_at nulls last, branch.id
    limit 1;
  elsif not exists (
    select 1
    from public.branches branch
    where branch.id = v_branch_id
      and branch.tenant_id = v_tenant_id
      and coalesce(branch.is_active, true) = true
  ) then
    raise exception 'الفرع المحدد غير موجود أو غير نشط داخل الشركة.';
  end if;

  select account.*
  into v_customer_receivable_account
  from public.account_accounts account
  where account.tenant_id = v_tenant_id
    and account.code = '114001'
    and coalesce(account.active, true) = true;

  if v_customer_receivable_account.id is null then
    raise exception 'حساب ذمم العملاء 114001 غير موجود أو غير نشط داخل الشركة.';
  end if;

  if not coalesce(v_customer_receivable_account.reconcile, false) then
    raise exception 'حساب ذمم العملاء 114001 غير مهيأ للمصالحة.';
  end if;

  select account.*
  into v_entity_receivable_account
  from public.account_accounts account
  where account.tenant_id = v_tenant_id
    and account.code = '114002'
    and coalesce(account.active, true) = true;

  if v_entity_receivable_account.id is null then
    raise exception 'حساب ذمم الشركات والجهات 114002 غير موجود أو غير نشط داخل الشركة.';
  end if;

  if v_attachment_bucket is null or v_attachment_path is null then
    raise exception 'ارفق صورة العملية أولاً.';
  end if;

  if left(v_attachment_path, length(v_tenant_id::text) + 1) <> v_tenant_id::text || '/' then
    raise exception 'لا يمكن ربط صورة من مساحة شركة أخرى.';
  end if;

  if not exists (
    select 1
    from storage.objects stored_object
    where stored_object.bucket_id = v_attachment_bucket
      and stored_object.name = v_attachment_path
  ) then
    raise exception 'ملف صورة العملية غير موجود في التخزين.';
  end if;

  insert into public.account_moves (
    id,
    tenant_id,
    branch_id,
    name,
    move_type,
    state,
    partner_id,
    amount_total,
    notes,
    pay_method,
    date,
    currency_code,
    created_by
  )
  values (
    v_move_id,
    v_tenant_id,
    v_branch_id,
    v_move_name,
    'payment',
    'posted',
    v_customer.id,
    v_amount,
    v_notes,
    'payment_entity_credit',
    now(),
    'EGP',
    v_user.id
  );

  insert into public.account_move_lines (
    id,
    tenant_id,
    move_id,
    account_id,
    partner_id,
    source_entity_id,
    label,
    quantity,
    unit_price,
    debit,
    credit,
    line_type,
    is_reconciled,
    amount_residual,
    amount_residual_currency,
    parent_state,
    currency_code,
    created_by
  )
  values
    (
      v_entity_receivable_line_id,
      v_tenant_id,
      v_move_id,
      v_entity_receivable_account.id,
      v_payment_entity.id,
      null,
      'اعتماد دفعة من جهة - ذمم الشركات والجهات',
      1,
      v_amount,
      v_amount,
      0,
      'receivable',
      false,
      v_amount,
      v_amount,
      'posted',
      'EGP',
      v_user.id
    ),
    (
      v_open_credit_line_id,
      v_tenant_id,
      v_move_id,
      v_customer_receivable_account.id,
      v_customer.id,
      v_payment_entity.id,
      'اعتماد دفعة من جهة - رصيد مفتوح للعميل',
      1,
      v_amount,
      0,
      v_amount,
      'receivable',
      false,
      v_amount,
      v_amount,
      'posted',
      'EGP',
      v_user.id
    );

  select
    count(*),
    round(coalesce(sum(move_line.debit), 0), 2),
    round(coalesce(sum(move_line.credit), 0), 2)
  into v_line_count, v_total_debit, v_total_credit
  from public.account_move_lines move_line
  where move_line.tenant_id = v_tenant_id
    and move_line.move_id = v_move_id;

  if v_line_count <> 2
    or v_total_debit <> v_amount
    or v_total_credit <> v_amount
    or v_total_debit <> v_total_credit
  then
    raise exception 'القيد الناتج غير متوازن، لم يتم تسجيل الاعتماد.';
  end if;

  if not exists (
    select 1
    from public.account_move_lines move_line
    where move_line.id = v_entity_receivable_line_id
      and move_line.tenant_id = v_tenant_id
      and move_line.account_id = v_entity_receivable_account.id
      and move_line.partner_id = v_payment_entity.id
      and move_line.source_entity_id is null
      and move_line.debit = v_amount
      and move_line.credit = 0
  ) or not exists (
    select 1
    from public.account_move_lines move_line
    where move_line.id = v_open_credit_line_id
      and move_line.tenant_id = v_tenant_id
      and move_line.account_id = v_customer_receivable_account.id
      and move_line.partner_id = v_customer.id
      and move_line.source_entity_id = v_payment_entity.id
      and move_line.debit = 0
      and move_line.credit = v_amount
  ) then
    raise exception 'تعذر التحقق من أطراف اعتماد الجهة، لم يتم تسجيل الاعتماد.';
  end if;

  insert into public.ir_attachments (
    tenant_id,
    bucket_name,
    file_path,
    document_type,
    related_model,
    related_id,
    original_file_name,
    mime_type,
    file_size,
    is_active,
    created_by
  )
  values (
    v_tenant_id,
    v_attachment_bucket,
    v_attachment_path,
    'accountant_payment_entity_credit',
    'account_moves',
    v_move_id,
    v_attachment_original_name,
    v_attachment_mime_type,
    v_attachment_file_size,
    true,
    v_user.id
  );

  return jsonb_build_object(
    'move_id', v_move_id,
    'move_name', v_move_name,
    'branch_id', v_branch_id,
    'entity_receivable_line_id', v_entity_receivable_line_id,
    'open_credit_line_id', v_open_credit_line_id,
    'customer_id', v_customer.id,
    'payment_entity_id', v_payment_entity.id,
    'amount', v_amount
  );
end;
$$;

revoke all on function public.create_accountant_payment_entity_credit(jsonb) from public, anon;
grant execute on function public.create_accountant_payment_entity_credit(jsonb) to authenticated;

comment on function public.create_accountant_payment_entity_credit(jsonb) is
  'Creates a posted payment-entity receivable debit on 114002 and an independent customer open credit on 114001.';

notify pgrst, 'reload schema';

commit;
