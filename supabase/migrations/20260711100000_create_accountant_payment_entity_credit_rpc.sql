create or replace function public.create_accountant_payment_entity_credit(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_tenant_id uuid := nullif(payload ->> 'tenant_id', '')::uuid;
  v_branch_id uuid := nullif(payload ->> 'branch_id', '')::uuid;
  v_customer_id uuid := nullif(payload ->> 'customer_id', '')::uuid;
  v_payment_entity_id uuid := nullif(payload ->> 'payment_entity_id', '')::uuid;
  v_created_by uuid := nullif(payload ->> 'created_by', '')::uuid;
  v_amount numeric := nullif(payload ->> 'amount', '')::numeric;
  v_notes text := nullif(trim(coalesce(payload ->> 'notes', '')), '');
  v_attachment jsonb := payload -> 'attachment';
  v_attachment_bucket text := nullif(trim(coalesce(v_attachment ->> 'bucket_name', v_attachment ->> 'bucket', '')), '');
  v_attachment_path text := nullif(trim(coalesce(v_attachment ->> 'file_path', v_attachment ->> 'path', '')), '');
  v_attachment_original_name text := nullif(trim(coalesce(v_attachment ->> 'original_file_name', v_attachment ->> 'name', '')), '');
  v_attachment_mime_type text := nullif(trim(coalesce(v_attachment ->> 'mime_type', v_attachment ->> 'mimeType', '')), '');
  v_attachment_file_size bigint := nullif(coalesce(v_attachment ->> 'file_size', v_attachment ->> 'size', ''), '')::bigint;
  v_company_receivable_account_id uuid;
  v_customer_advance_account_id uuid;
  v_move_id uuid := gen_random_uuid();
  v_move_name text := 'ACC-PAY-' || upper(substr(replace(v_move_id::text, '-', ''), 1, 10));
begin
  if v_tenant_id is null then
    raise exception 'لا توجد شركة نشطة.';
  end if;

  if v_customer_id is null then
    raise exception 'اختر العميل أولاً.';
  end if;

  if v_payment_entity_id is null then
    raise exception 'اختر الجهة أولاً.';
  end if;

  if v_created_by is null then
    raise exception 'تعذر تحديد المستخدم الحالي.';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'اكتب مبلغ صحيح أكبر من صفر.';
  end if;

  if v_attachment_bucket is null or v_attachment_path is null then
    raise exception 'ارفق صورة العملية أولاً.';
  end if;

  if left(v_attachment_path, length(v_tenant_id::text) + 1) <> v_tenant_id::text || '/' then
    raise exception 'لا يمكن ربط صورة من مساحة شركة أخرى.';
  end if;

  if not exists (
    select 1
    from storage.objects so
    where so.bucket_id = v_attachment_bucket
      and so.name = v_attachment_path
  ) then
    raise exception 'ملف صورة العملية غير موجود في التخزين.';
  end if;

  if not exists (
    select 1
    from public.tenant_users tu
    where tu.id = v_created_by
      and tu.tenant_id = v_tenant_id
      and coalesce(tu.is_active, true) = true
  ) then
    raise exception 'المستخدم الحالي غير تابع للشركة النشطة.';
  end if;

  if not exists (
    select 1
    from public.partners p
    where p.id = v_customer_id
      and p.tenant_id = v_tenant_id
      and coalesce(p.active, true) = true
  ) then
    raise exception 'العميل المحدد غير موجود أو غير نشط.';
  end if;

  if not exists (
    select 1
    from public.partners p
    where p.id = v_payment_entity_id
      and p.tenant_id = v_tenant_id
      and coalesce(p.active, true) = true
  ) then
    raise exception 'جهة الدفع المحددة غير موجودة أو غير نشطة.';
  end if;

  if v_branch_id is null then
    select b.id
    into v_branch_id
    from public.branches b
    where b.tenant_id = v_tenant_id
      and coalesce(b.is_active, true) = true
    order by b.created_at nulls last, b.id
    limit 1;
  end if;

  if v_branch_id is not null and not exists (
    select 1
    from public.branches b
    where b.id = v_branch_id
      and b.tenant_id = v_tenant_id
      and coalesce(b.is_active, true) = true
  ) then
    raise exception 'الفرع المحدد غير موجود أو غير نشط.';
  end if;

  select aa.id
  into v_company_receivable_account_id
  from public.account_accounts aa
  where aa.tenant_id = v_tenant_id
    and coalesce(aa.active, true) = true
    and (aa.code = '114002' or aa.name = 'ذمم الشركات والجهات')
  order by case when aa.code = '114002' then 0 else 1 end
  limit 1;

  if v_company_receivable_account_id is null then
    raise exception 'لم يتم العثور على حساب ذمم الشركات والجهات 114002.';
  end if;

  select aa.id
  into v_customer_advance_account_id
  from public.account_accounts aa
  where aa.tenant_id = v_tenant_id
    and coalesce(aa.active, true) = true
    and (aa.code = '212001' or aa.name = 'الدفعات المقدمة من العملاء')
  order by case when aa.code = '212001' then 0 else 1 end
  limit 1;

  if v_customer_advance_account_id is null then
    raise exception 'لم يتم العثور على حساب الدفعات المقدمة من العملاء 212001.';
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
    date,
    created_by
  )
  values (
    v_move_id,
    v_tenant_id,
    v_branch_id,
    v_move_name,
    'payment',
    'posted',
    v_customer_id,
    v_amount,
    v_notes,
    now(),
    v_created_by
  );

  insert into public.account_move_lines (
    tenant_id,
    move_id,
    account_id,
    partner_id,
    label,
    quantity,
    unit_price,
    debit,
    credit,
    created_by
  )
  values
    (
      v_tenant_id,
      v_move_id,
      v_company_receivable_account_id,
      v_payment_entity_id,
      'اعتماد دفعة من جهة - ذمم الشركات والجهات',
      1,
      0,
      v_amount,
      0,
      v_created_by
    ),
    (
      v_tenant_id,
      v_move_id,
      v_customer_advance_account_id,
      v_customer_id,
      'اعتماد دفعة من جهة - الدفعات المقدمة من العملاء',
      1,
      0,
      0,
      v_amount,
      v_created_by
    );

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
    v_created_by
  );

  return jsonb_build_object(
    'move_id', v_move_id,
    'move_name', v_move_name,
    'branch_id', v_branch_id,
    'amount', v_amount
  );
end;
$$;

grant execute on function public.create_accountant_payment_entity_credit(jsonb) to authenticated;
