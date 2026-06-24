alter table public.paperwork_requests
  add column if not exists current_stage text,
  add column if not exists tracking_photos_ignored boolean not null default false,
  add column if not exists tracking_photos_ignore_reason text;

alter table public.paperwork_request_events
  add column if not exists old_stage text,
  add column if not exists new_stage text;

create or replace function public.link_vault_paperwork_request(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sale_id uuid,
  p_sale_line_id uuid,
  p_tracking_unit_id uuid,
  p_customer_id uuid,
  p_confirmation_note text default ''
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_tenant_user_id uuid;
  v_existing_request_id uuid;
  v_document_id uuid;
  v_request_id uuid;
  v_request_notes text;
  v_event_notes text;
begin
  if p_sale_line_id is null then
    raise exception 'تعذر تحديد سطر المنتج المطلوب.';
  end if;

  if p_tracking_unit_id is null then
    raise exception 'تعذر تحديد القطعة الفريدة المرتبطة بالورق.';
  end if;

  select tu.id
  into v_current_tenant_user_id
  from public.tenant_users tu
  where tu.tenant_id = p_tenant_id
    and tu.auth_user_id = auth.uid()
    and tu.is_active = true
  limit 1;

  if v_current_tenant_user_id is null then
    raise exception 'تعذر تحديد مستخدم الشركة الحالي.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_sale_line_id::text, 0));

  select pr.id
  into v_existing_request_id
  from public.paperwork_requests pr
  where pr.tenant_id = p_tenant_id
    and pr.sale_line_id = p_sale_line_id
  order by pr.created_at asc
  limit 1;

  if v_existing_request_id is not null then
    return query select v_existing_request_id;
    return;
  end if;

  select pd.id
  into v_document_id
  from public.paperwork_documents pd
  where pd.tenant_id = p_tenant_id
    and pd.tracking_unit_id = p_tracking_unit_id
    and pd.status = 'in_custody'
  order by
    case when pd.paperwork_request_id is null then 0 else 1 end,
    pd.updated_at desc nulls last,
    pd.created_at desc nulls last
  limit 1
  for update;

  if v_document_id is null then
    raise exception 'لا يوجد ورق مسجل بالخزنة لهذا المنتج.';
  end if;

  v_request_notes := concat_ws(
    E'\n\n',
    'تمت تسوية بيع قديم: الورق موجود بالفعل في الخزنة وتم ربطه بهذا الطلب.',
    nullif(trim(coalesce(p_confirmation_note, '')), '')
  );

  v_event_notes := concat_ws(
    E'\n\n',
    'تم تحديد حالة الورق: الورق موجود بالفعل في الخزنة وتم ربط الطلب بالمستند الموجود.',
    nullif(trim(coalesce(p_confirmation_note, '')), '')
  );

  insert into public.paperwork_requests (
    tenant_id,
    branch_id,
    request_source,
    request_type,
    sale_id,
    sale_line_id,
    tracking_unit_id,
    customer_id,
    document_owner_partner_id,
    current_stage,
    stage_entered_at,
    status,
    closed_at,
    notes,
    created_by
  )
  values (
    p_tenant_id,
    p_branch_id,
    'sale',
    'new_document',
    p_sale_id,
    p_sale_line_id,
    p_tracking_unit_id,
    p_customer_id,
    p_customer_id,
    'received_from_processor',
    now(),
    'open',
    null,
    v_request_notes,
    v_current_tenant_user_id
  )
  returning paperwork_requests.id into v_request_id;

  update public.paperwork_documents
  set paperwork_request_id = v_request_id
  where tenant_id = p_tenant_id
    and id = v_document_id;

  insert into public.paperwork_request_events (
    tenant_id,
    request_id,
    event_type,
    new_stage,
    new_status,
    notes,
    created_by
  )
  values (
    p_tenant_id,
    v_request_id,
    'received_from_supplier',
    'received_from_processor',
    'open',
    v_event_notes,
    v_current_tenant_user_id
  );

  return query select v_request_id;
end;
$$;

create or replace function public.create_legacy_delivered_paperwork_request(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sale_id uuid,
  p_sale_line_id uuid default null,
  p_tracking_unit_id uuid default null,
  p_customer_id uuid default null,
  p_confirmation_note text default ''
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_tenant_user_id uuid;
  v_request_id uuid;
  v_event_notes text;
begin
  select tu.id
  into v_current_tenant_user_id
  from public.tenant_users tu
  where tu.tenant_id = p_tenant_id
    and tu.auth_user_id = auth.uid()
    and tu.is_active = true
  limit 1;

  if v_current_tenant_user_id is null then
    raise exception 'تعذر تحديد مستخدم الشركة الحالي.';
  end if;

  v_event_notes := concat_ws(
    E'\n\n',
    'تم تسجيل حالة بيع قديم: الأوراق تم تسليمها للعميل بالفعل قبل نظام تتبع الأوراق.',
    nullif(trim(coalesce(p_confirmation_note, '')), '')
  );

  insert into public.paperwork_requests (
    tenant_id,
    branch_id,
    request_source,
    request_type,
    sale_id,
    sale_line_id,
    tracking_unit_id,
    customer_id,
    document_owner_partner_id,
    current_stage,
    status,
    closed_at,
    created_by,
    notes
  )
  values (
    p_tenant_id,
    p_branch_id,
    'sale',
    'new_document',
    p_sale_id,
    p_sale_line_id,
    p_tracking_unit_id,
    p_customer_id,
    p_customer_id,
    'delivered',
    'done',
    now(),
    v_current_tenant_user_id,
    'Legacy sale: papers were already delivered to customer before paperwork tracking system.'
  )
  returning paperwork_requests.id into v_request_id;

  insert into public.paperwork_request_events (
    tenant_id,
    request_id,
    event_type,
    new_status,
    new_stage,
    created_by,
    notes
  )
  values (
    p_tenant_id,
    v_request_id,
    'done',
    'done',
    'delivered',
    v_current_tenant_user_id,
    v_event_notes
  );

  return query select v_request_id;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'paperwork_requests_current_stage_check'
      and conrelid = 'public.paperwork_requests'::regclass
  ) then
    alter table public.paperwork_requests
      add constraint paperwork_requests_current_stage_check
      check (
        current_stage is null
        or current_stage in (
          'preparation',
          'owner_confirmation',
          'sent_to_processor',
          'processor_ready',
          'received_from_processor',
          'client_notified',
          'delivered',
          'cancelled'
        )
      );
  end if;
end;
$$;

alter table public.paperwork_requests
  drop constraint if exists paperwork_requests_unique_sale_line;

drop index if exists public.paperwork_requests_unique_sale_line;
drop index if exists public.uq_paperwork_requests_sale_line_active;

create unique index uq_paperwork_requests_sale_line_active
  on public.paperwork_requests (tenant_id, sale_line_id)
  where sale_line_id is not null
    and status <> 'cancelled';

drop function if exists public.confirm_sale_paperwork_request(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  boolean,
  boolean,
  text
);

create or replace function public.confirm_sale_paperwork_request(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sale_id uuid,
  p_sale_line_id uuid,
  p_tracking_unit_id uuid,
  p_customer_id uuid,
  p_document_owner_status text,
  p_document_owner_name text default null,
  p_document_owner_national_id text default null,
  p_document_owner_note text default null,
  p_owner_attachment jsonb default null,
  p_tracking_photos_ignored boolean default false,
  p_tracking_photos_ignore_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_request public.paperwork_requests;
  v_created boolean := false;
  v_owner_status text := lower(trim(coalesce(p_document_owner_status, '')));
  v_owner_name text := nullif(trim(coalesce(p_document_owner_name, '')), '');
  v_owner_national_id text := nullif(trim(coalesce(p_document_owner_national_id, '')), '');
  v_owner_note text := nullif(trim(coalesce(p_document_owner_note, '')), '');
  v_ignore_reason text := nullif(trim(coalesce(p_tracking_photos_ignore_reason, '')), '');
  v_attachment_bucket text;
  v_attachment_path text;
  v_attachment_document_type text;
  v_attachment_original_name text;
  v_attachment_mime_type text;
  v_attachment_file_size bigint;
  v_has_owner_attachment boolean := false;
begin
  if p_tenant_id is null or p_sale_id is null or p_sale_line_id is null then
    raise exception 'تعذر تحديد الشركة أو الفاتورة أو المنتج.';
  end if;

  if v_owner_status not in ('confirmed', 'later') then
    raise exception 'حالة صاحب الورق غير صحيحة.';
  end if;

  if v_owner_status = 'confirmed' and v_owner_name is null then
    raise exception 'اكتب اسم صاحب الورق أولاً.';
  end if;

  if p_tracking_photos_ignored and v_ignore_reason is null then
    raise exception 'اكتب سبب تجاهل صور الشاسيه والموتور.';
  end if;

  if not p_tracking_photos_ignored then
    v_ignore_reason := null;
  end if;

  select tu.id
  into v_user_id
  from public.tenant_users tu
  where tu.tenant_id = p_tenant_id
    and tu.auth_user_id = auth.uid()
    and tu.is_active = true
  limit 1;

  if v_user_id is null then
    raise exception 'Current user is not an active tenant user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_sale_line_id::text, 0));

  select pr.*
  into v_request
  from public.paperwork_requests pr
  where pr.tenant_id = p_tenant_id
    and pr.sale_line_id = p_sale_line_id
  order by pr.created_at asc
  limit 1
  for update;

  if v_request.id is null then
    insert into public.paperwork_requests (
      tenant_id,
      branch_id,
      request_source,
      request_type,
      sale_id,
      sale_line_id,
      tracking_unit_id,
      customer_id,
      current_stage,
      status,
      closed_at,
      priority,
      notes,
      created_by
    )
    values (
      p_tenant_id,
      p_branch_id,
      'sale',
      'new_document',
      p_sale_id,
      p_sale_line_id,
      p_tracking_unit_id,
      p_customer_id,
      'preparation',
      'open',
      null,
      'normal',
      'تم إنشاء طلب الأوراق من إجراءات البيع.',
      v_user_id
    )
    returning *
    into v_request;

    v_created := true;
  end if;

  if p_owner_attachment is not null then
    v_attachment_bucket := nullif(trim(coalesce(p_owner_attachment ->> 'bucket_name', '')), '');
    v_attachment_path := nullif(trim(coalesce(p_owner_attachment ->> 'file_path', '')), '');
    v_attachment_document_type := coalesce(
      nullif(trim(coalesce(p_owner_attachment ->> 'document_type', '')), ''),
      'document_owner_id_card'
    );
    v_attachment_original_name := nullif(trim(coalesce(p_owner_attachment ->> 'original_file_name', '')), '');
    v_attachment_mime_type := nullif(trim(coalesce(p_owner_attachment ->> 'mime_type', '')), '');
    v_attachment_file_size := nullif(p_owner_attachment ->> 'file_size', '')::bigint;

    if v_attachment_bucket is null or v_attachment_path is null then
      raise exception 'بيانات صورة بطاقة صاحب الورق غير مكتملة.';
    end if;

    if v_attachment_document_type <> 'document_owner_id_card' then
      raise exception 'نوع مرفق بطاقة صاحب الورق غير صحيح.';
    end if;

    if left(v_attachment_path, length(p_tenant_id::text) + 1) <> p_tenant_id::text || '/' then
      raise exception 'لا يمكن ربط صورة من مساحة شركة أخرى.';
    end if;

    if not exists (
      select 1
      from storage.objects so
      where so.bucket_id = v_attachment_bucket
        and so.name = v_attachment_path
    ) then
      raise exception 'ملف صورة بطاقة صاحب الورق غير موجود في التخزين.';
    end if;

    v_has_owner_attachment := true;
  else
    select exists (
      select 1
      from public.ir_attachments ia
      where ia.tenant_id = p_tenant_id
        and ia.related_model = 'paperwork_requests'
        and ia.related_id = v_request.id
        and ia.document_type = 'document_owner_id_card'
        and coalesce(ia.is_active, true) = true
    )
    into v_has_owner_attachment;
  end if;

  if v_owner_status = 'confirmed' and not v_has_owner_attachment then
    raise exception 'ارفق صورة بطاقة صاحب الورق أولاً.';
  end if;

  update public.paperwork_requests
  set current_stage = 'preparation',
      status = 'open',
      closed_at = null,
      document_owner_status = v_owner_status,
      document_owner_name = case when v_owner_status = 'later' then null else v_owner_name end,
      document_owner_national_id = case when v_owner_status = 'later' then null else v_owner_national_id end,
      document_owner_note = case
        when v_owner_status = 'later' then 'صاحب الورق غير محدد بعد'
        else v_owner_note
      end,
      tracking_photos_ignored = p_tracking_photos_ignored,
      tracking_photos_ignore_reason = v_ignore_reason,
      updated_at = now()
  where id = v_request.id
  returning *
  into v_request;

  if p_owner_attachment is not null then
    update public.ir_attachments
    set is_active = false
    where tenant_id = p_tenant_id
      and related_model = 'paperwork_requests'
      and related_id = v_request.id
      and document_type = 'document_owner_id_card'
      and coalesce(is_active, true) = true;

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
      p_tenant_id,
      v_attachment_bucket,
      v_attachment_path,
      v_attachment_document_type,
      'paperwork_requests',
      v_request.id,
      v_attachment_original_name,
      v_attachment_mime_type,
      v_attachment_file_size,
      true,
      v_user_id
    );
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'current_stage', v_request.current_stage,
    'status', v_request.status,
    'document_owner_status', v_request.document_owner_status,
    'document_owner_name', v_request.document_owner_name,
    'document_owner_national_id', v_request.document_owner_national_id,
    'document_owner_note', v_request.document_owner_note,
    'tracking_photos_ignored', v_request.tracking_photos_ignored,
    'tracking_photos_ignore_reason', v_request.tracking_photos_ignore_reason,
    'created', v_created
  );
end;
$$;

grant execute on function public.confirm_sale_paperwork_request(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  boolean,
  text
) to authenticated;
