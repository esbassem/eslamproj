begin;

-- Forward-only paperwork workflow migration built against the live 2026-08-14 schema.
-- Historical request events are intentionally preserved unchanged.

do $$
declare
  v_unknown_stages text;
  v_unknown_statuses text;
begin
  select string_agg(distinct current_stage, ', ' order by current_stage)
  into v_unknown_stages
  from public.paperwork_requests
  where current_stage not in (
    'preparation', 'owner_confirmation', 'sent_to_processor', 'processor_ready',
    'received_from_processor', 'client_notified', 'delivered',
    'pending_processor_cancellation', 'cancelled'
  );

  if v_unknown_stages is not null then
    raise exception 'Unknown paperwork stages prevent migration: %', v_unknown_stages;
  end if;

  select string_agg(distinct status, ', ' order by status)
  into v_unknown_statuses
  from public.paperwork_requests
  where status not in ('open', 'deferred', 'blocked', 'done', 'cancelled');

  if v_unknown_statuses is not null then
    raise exception 'Unknown paperwork statuses prevent migration: %', v_unknown_statuses;
  end if;
end;
$$;

create table if not exists public.paperwork_workflow_migration_audit (
  id uuid primary key default gen_random_uuid(),
  migration_key text not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null references public.paperwork_requests(id) on delete cascade,
  old_stage text,
  old_status text,
  new_stage text,
  new_status text,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (migration_key, request_id, reason)
);

alter table public.paperwork_workflow_migration_audit enable row level security;
revoke all on public.paperwork_workflow_migration_audit from public, anon, authenticated;

alter table public.paperwork_requests
  add column if not exists processor_ready_at timestamptz,
  add column if not exists processor_ready_by uuid,
  add column if not exists processor_ready_notes text,
  add column if not exists customer_notified_at timestamptz,
  add column if not exists customer_notified_by uuid,
  add column if not exists customer_notification_channel text,
  add column if not exists customer_notification_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.paperwork_requests'::regclass
      and conname = 'paperwork_requests_processor_ready_by_fkey'
  ) then
    alter table public.paperwork_requests
      add constraint paperwork_requests_processor_ready_by_fkey
      foreign key (processor_ready_by) references public.tenant_users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.paperwork_requests'::regclass
      and conname = 'paperwork_requests_customer_notified_by_fkey'
  ) then
    alter table public.paperwork_requests
      add constraint paperwork_requests_customer_notified_by_fkey
      foreign key (customer_notified_by) references public.tenant_users(id) on delete set null;
  end if;
end;
$$;

alter table public.paperwork_requests
  drop constraint if exists paperwork_requests_customer_notification_channel_check;

alter table public.paperwork_requests
  add constraint paperwork_requests_customer_notification_channel_check
  check (
    customer_notification_channel is null
    or customer_notification_channel in ('phone', 'whatsapp', 'sms', 'in_person', 'other', 'unknown')
  );

alter table public.paperwork_request_events
  drop constraint if exists paperwork_request_events_event_type_check;

alter table public.paperwork_request_events
  add constraint paperwork_request_events_event_type_check
  check (event_type in (
    'created', 'stage_changed', 'assigned', 'supplier_selected',
    'sent_to_supplier', 'sent_to_processor', 'supplier_finished',
    'processor_marked_ready', 'received_from_supplier',
    'client_notified', 'customer_notified', 'delivered_to_customer',
    'blocked', 'unblocked', 'deferred', 'done', 'cancelled', 'note',
    'processor_cancellation_required_by_sale_return',
    'processor_cancellation_confirmed',
    'paperwork_request_cancelled_by_sale_replacement',
    'paperwork_request_cancelled_by_sale_return',
    'created_from_sale_return_exchange'
  ));

create or replace function public.send_paperwork_request_to_processor(
  p_tenant_id uuid,
  p_request_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.tenant_users%rowtype;
  v_request public.paperwork_requests%rowtype;
  v_blocker public.paperwork_requests%rowtype;
  v_now timestamptz := clock_timestamp();
  v_event_id uuid;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_has_owner_card boolean := false;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولًا.'; end if;
  if p_tenant_id is null or p_request_id is null then raise exception 'بيانات طلب الأوراق غير مكتملة.'; end if;

  select * into v_user
  from public.tenant_users
  where tenant_id = p_tenant_id and auth_user_id = auth.uid() and is_active = true
  order by created_at, id limit 1;
  if v_user.id is null then raise exception 'لا تملك صلاحية الوصول إلى هذه الشركة.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':send-paperwork:' || p_request_id::text, 0));
  select * into v_request from public.paperwork_requests
  where tenant_id = p_tenant_id and id = p_request_id for update;

  if v_request.id is null then raise exception 'طلب الأوراق غير موجود.'; end if;
  if v_request.status <> 'open' then raise exception 'لا يمكن إرسال طلب غير مفتوح.'; end if;
  if v_request.current_stage = 'sent_to_processor' then
    return jsonb_build_object('request_id', v_request.id, 'current_stage', v_request.current_stage,
      'status', v_request.status, 'updated_at', v_request.updated_at, 'idempotent', true);
  end if;
  if v_request.current_stage <> 'preparation' then raise exception 'الطلب ليس في مرحلة التجهيز.'; end if;
  if v_request.processor_partner_id is null then raise exception 'يجب تحديد جهة إصدار الأوراق.'; end if;
  if v_request.blocked_reason is not null then raise exception '%', v_request.blocked_reason; end if;

  select exists(
    select 1 from public.ir_attachments a
    where a.tenant_id = p_tenant_id
      and a.related_model = 'paperwork_requests'
      and a.related_id = p_request_id
      and a.document_type = 'document_owner_id_card'
      and coalesce(a.is_active, true)
  ) into v_has_owner_card;

  if v_request.document_owner_status = 'confirmed'
     and (nullif(btrim(coalesce(v_request.document_owner_name, '')), '') is null
          and v_request.document_owner_partner_id is null) then
    raise exception 'بيانات صاحب الورق غير مكتملة.';
  end if;
  if v_request.document_owner_status = 'confirmed' and not v_has_owner_card then
    raise exception 'ارفق صورة بطاقة صاحب الورق أولًا.';
  end if;

  if exists (
    select 1 from public.paperwork_documents d
    where d.tenant_id = p_tenant_id and d.paperwork_request_id = p_request_id
      and d.status <> 'cancelled'
  ) then
    raise exception 'لا يمكن إرسال طلب مرتبط بمستند مادي موجود بالفعل.';
  end if;

  if v_request.processor_cancellation_blocking_request_id is not null then
    select * into v_blocker from public.paperwork_requests
    where tenant_id = p_tenant_id and id = v_request.processor_cancellation_blocking_request_id;
    if v_blocker.id is not null
       and v_blocker.processor_partner_id is not distinct from v_request.processor_partner_id
       and not (v_blocker.status = 'cancelled' and v_blocker.current_stage = 'cancelled') then
      raise exception 'يوجد طلب سابق لدى جهة الإصدار ينتظر تأكيد الإلغاء.';
    end if;
  end if;

  update public.paperwork_requests
  set current_stage = 'sent_to_processor', stage_entered_at = v_now, updated_at = v_now
  where id = v_request.id;

  insert into public.paperwork_request_events(
    tenant_id, request_id, event_type, old_stage, new_stage,
    old_status, new_status, notes, created_by
  ) values (
    p_tenant_id, v_request.id, 'sent_to_processor', 'preparation', 'sent_to_processor',
    v_request.status, v_request.status,
    concat_ws(chr(10), 'تم إرسال طلب الأوراق إلى جهة الإصدار.', v_notes), v_user.id
  ) returning id into v_event_id;

  return jsonb_build_object('request_id', v_request.id, 'event_id', v_event_id,
    'current_stage', 'sent_to_processor', 'status', v_request.status,
    'updated_at', v_now, 'idempotent', false);
end;
$$;

revoke all on function public.send_paperwork_request_to_processor(uuid, uuid, text) from public, anon;
grant execute on function public.send_paperwork_request_to_processor(uuid, uuid, text) to authenticated;

create or replace function public.mark_paperwork_processor_ready(
  p_tenant_id uuid,
  p_request_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.tenant_users%rowtype;
  v_request public.paperwork_requests%rowtype;
  v_now timestamptz := clock_timestamp();
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_event_id uuid;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولًا.'; end if;
  select * into v_user from public.tenant_users
  where tenant_id = p_tenant_id and auth_user_id = auth.uid() and is_active = true
  order by created_at, id limit 1;
  if v_user.id is null then raise exception 'لا تملك صلاحية الوصول إلى هذه الشركة.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':paperwork-ready:' || p_request_id::text, 0));
  select * into v_request from public.paperwork_requests
  where tenant_id = p_tenant_id and id = p_request_id for update;
  if v_request.id is null then raise exception 'طلب الأوراق غير موجود.'; end if;
  if v_request.status <> 'open' or v_request.current_stage <> 'sent_to_processor' then
    raise exception 'لا يمكن تسجيل الجاهزية إلا لطلب مفتوح موجود لدى الجهة.';
  end if;
  if exists(select 1 from public.paperwork_documents d
    where d.tenant_id = p_tenant_id and d.paperwork_request_id = p_request_id and d.status <> 'cancelled') then
    raise exception 'تم استلام مستند مادي لهذا الطلب بالفعل.';
  end if;

  if v_request.processor_ready_at is not null then
    return jsonb_build_object('request_id', v_request.id, 'current_stage', v_request.current_stage,
      'processor_ready_at', v_request.processor_ready_at,
      'processor_ready_by', v_request.processor_ready_by,
      'processor_ready_notes', v_request.processor_ready_notes,
      'idempotent', true);
  end if;

  update public.paperwork_requests set processor_ready_at = v_now,
    processor_ready_by = v_user.id, processor_ready_notes = v_notes, updated_at = v_now
  where id = v_request.id;

  insert into public.paperwork_request_events(
    tenant_id, request_id, event_type, old_stage, new_stage,
    old_status, new_status, notes, created_by
  ) values (
    p_tenant_id, v_request.id, 'processor_marked_ready', v_request.current_stage,
    v_request.current_stage, v_request.status, v_request.status,
    concat_ws(chr(10), 'أبلغت جهة الإصدار أن الورق جاهز للاستلام.', v_notes), v_user.id
  ) returning id into v_event_id;

  return jsonb_build_object('request_id', v_request.id, 'event_id', v_event_id,
    'current_stage', v_request.current_stage, 'processor_ready_at', v_now,
    'processor_ready_by', v_user.id, 'processor_ready_notes', v_notes, 'idempotent', false);
end;
$$;

revoke all on function public.mark_paperwork_processor_ready(uuid, uuid, text) from public, anon;
grant execute on function public.mark_paperwork_processor_ready(uuid, uuid, text) to authenticated;

create or replace function public.notify_paperwork_customer(
  p_tenant_id uuid,
  p_request_id uuid,
  p_channel text default 'unknown',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.tenant_users%rowtype;
  v_request public.paperwork_requests%rowtype;
  v_now timestamptz := clock_timestamp();
  v_channel text := coalesce(nullif(lower(btrim(coalesce(p_channel, ''))), ''), 'unknown');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_event_id uuid;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولًا.'; end if;
  if v_channel not in ('phone', 'whatsapp', 'sms', 'in_person', 'other', 'unknown') then
    raise exception 'طريقة إبلاغ العميل غير صالحة.';
  end if;
  select * into v_user from public.tenant_users
  where tenant_id = p_tenant_id and auth_user_id = auth.uid() and is_active = true
  order by created_at, id limit 1;
  if v_user.id is null then raise exception 'لا تملك صلاحية الوصول إلى هذه الشركة.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':notify-paperwork:' || p_request_id::text, 0));
  select * into v_request from public.paperwork_requests
  where tenant_id = p_tenant_id and id = p_request_id for update;
  if v_request.id is null then raise exception 'طلب الأوراق غير موجود.'; end if;
  if v_request.status <> 'open' or v_request.current_stage <> 'received_from_processor' then
    raise exception 'لا يمكن تسجيل إبلاغ العميل قبل وجود الورق في الخزنة.';
  end if;

  if v_request.customer_notified_at is not null then
    return jsonb_build_object('request_id', v_request.id, 'current_stage', v_request.current_stage,
      'customer_notified_at', v_request.customer_notified_at,
      'customer_notified_by', v_request.customer_notified_by,
      'customer_notification_channel', v_request.customer_notification_channel,
      'customer_notification_notes', v_request.customer_notification_notes,
      'idempotent', true);
  end if;

  update public.paperwork_requests set customer_notified_at = v_now,
    customer_notified_by = v_user.id, customer_notification_channel = v_channel,
    customer_notification_notes = v_notes, updated_at = v_now
  where id = v_request.id;

  insert into public.paperwork_request_events(
    tenant_id, request_id, event_type, old_stage, new_stage,
    old_status, new_status, notes, created_by
  ) values (
    p_tenant_id, v_request.id, 'customer_notified', v_request.current_stage,
    v_request.current_stage, v_request.status, v_request.status,
    concat_ws(chr(10), 'تم تسجيل إبلاغ العميل بوصول الأوراق.',
      'channel=' || v_channel, v_notes), v_user.id
  ) returning id into v_event_id;

  return jsonb_build_object('request_id', v_request.id, 'event_id', v_event_id,
    'current_stage', v_request.current_stage, 'customer_notified_at', v_now,
    'customer_notified_by', v_user.id, 'customer_notification_channel', v_channel,
    'customer_notification_notes', v_notes, 'idempotent', false);
end;
$$;

revoke all on function public.notify_paperwork_customer(uuid, uuid, text, text) from public, anon;
grant execute on function public.notify_paperwork_customer(uuid, uuid, text, text) to authenticated;

drop function if exists public.notify_paperwork_customer(uuid, uuid);

create or replace function public.receive_paperwork_request_from_processor(
  p_tenant_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.tenant_users%rowtype;
  v_request public.paperwork_requests%rowtype;
  v_document public.paperwork_documents%rowtype;
  v_now timestamptz := clock_timestamp();
  v_sale_id uuid;
  v_owner_name text;
  v_event_id uuid;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولًا.'; end if;
  select * into v_user from public.tenant_users
  where tenant_id = p_tenant_id and auth_user_id = auth.uid() and is_active = true
  order by created_at, id limit 1;
  if v_user.id is null then raise exception 'لا تملك صلاحية الوصول إلى هذه الشركة.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':receive-paperwork:' || p_request_id::text, 0));
  select * into v_request from public.paperwork_requests
  where tenant_id = p_tenant_id and id = p_request_id for update;
  if v_request.id is null then raise exception 'طلب الأوراق غير موجود.'; end if;

  if v_request.current_stage in ('received_from_processor', 'delivered') then
    select * into v_document from public.paperwork_documents
    where tenant_id = p_tenant_id and paperwork_request_id = p_request_id and status <> 'cancelled'
    order by created_at, id limit 1;
    if v_document.id is null then raise exception 'مرحلة الطلب لا تتوافق مع المستند المادي.'; end if;
    return jsonb_build_object('request_id', v_request.id, 'document_id', v_document.id,
      'sale_id', v_document.sale_id, 'current_stage', v_request.current_stage,
      'updated_at', v_request.updated_at, 'idempotent', true);
  end if;

  if v_request.status <> 'open' or v_request.current_stage <> 'sent_to_processor' then
    raise exception 'لا يمكن استلام طلب غير مفتوح أو غير موجود لدى الجهة.';
  end if;
  if v_request.customer_id is null then raise exception 'الطلب لا يحتوي على عميل مرتبط.'; end if;
  v_owner_name := nullif(btrim(coalesce(v_request.document_owner_name, '')), '');
  if v_owner_name is null then raise exception 'اسم صاحب الجواب غير مسجل في الطلب.'; end if;

  select * into v_document from public.paperwork_documents
  where tenant_id = p_tenant_id and paperwork_request_id = p_request_id and status <> 'cancelled'
  order by created_at, id limit 1 for update;
  if v_document.id is not null then raise exception 'يوجد مستند مادي مرتبط بهذا الطلب بالفعل.'; end if;

  v_sale_id := v_request.sale_id;
  if v_sale_id is null and v_request.sale_line_id is not null then
    select sale_id into v_sale_id from public.showroom_sale_lines
    where tenant_id = p_tenant_id and id = v_request.sale_line_id;
  end if;

  insert into public.paperwork_documents(
    tenant_id, branch_id, paperwork_request_id, sale_id, tracking_unit_id,
    owner_partner_id, document_owner_name, source_type, document_type,
    document_title, status, notes, created_by
  ) values (
    p_tenant_id, v_request.branch_id, v_request.id, v_sale_id, v_request.tracking_unit_id,
    v_request.customer_id, v_owner_name, 'paperwork_request', 'jawab',
    'جواب', 'in_custody', 'تم استلام الأوراق من الجهة وإيداعها بالخزنة.', v_user.id
  ) returning * into v_document;

  insert into public.paperwork_document_moves(
    tenant_id, document_id, move_direction, source_type, from_partner_id,
    to_user_id, to_location, moved_at, notes, created_by
  ) values (
    p_tenant_id, v_document.id, 'in', 'from_processor', v_request.processor_partner_id,
    v_user.id, 'vault', v_now, 'تم استلام الأوراق من الجهة وإيداعها بالخزنة.', v_user.id
  );

  update public.paperwork_requests set current_stage = 'received_from_processor',
    stage_entered_at = v_now, sale_id = coalesce(sale_id, v_sale_id), updated_at = v_now
  where id = v_request.id;

  insert into public.paperwork_request_events(
    tenant_id, request_id, event_type, old_stage, new_stage,
    old_status, new_status, notes, created_by
  ) values (
    p_tenant_id, v_request.id, 'received_from_supplier', 'sent_to_processor',
    'received_from_processor', v_request.status, v_request.status,
    'تم استلام الأوراق من الجهة وإيداعها بالخزنة.', v_user.id
  ) returning id into v_event_id;

  return jsonb_build_object('request_id', v_request.id, 'document_id', v_document.id,
    'event_id', v_event_id, 'sale_id', v_document.sale_id,
    'current_stage', 'received_from_processor', 'updated_at', v_now, 'idempotent', false);
end;
$$;

revoke all on function public.receive_paperwork_request_from_processor(uuid, uuid) from public, anon;
grant execute on function public.receive_paperwork_request_from_processor(uuid, uuid) to authenticated;

create or replace function public.deliver_paperwork_to_customer(
  p_tenant_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.tenant_users%rowtype;
  v_request public.paperwork_requests%rowtype;
  v_document public.paperwork_documents%rowtype;
  v_latest_move public.paperwork_document_moves%rowtype;
  v_sale public.showroom_sales%rowtype;
  v_remaining numeric := 0;
  v_now timestamptz := clock_timestamp();
  v_move_id uuid;
  v_event_id uuid;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولًا.'; end if;
  select * into v_user from public.tenant_users
  where tenant_id = p_tenant_id and auth_user_id = auth.uid() and is_active = true
  order by created_at, id limit 1;
  if v_user.id is null then raise exception 'لا تملك صلاحية الوصول إلى هذه الشركة.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':deliver-paperwork:' || p_request_id::text, 0));
  select * into v_request from public.paperwork_requests
  where tenant_id = p_tenant_id and id = p_request_id for update;
  if v_request.id is null then raise exception 'طلب الأوراق غير موجود.'; end if;

  if v_request.current_stage = 'delivered' and v_request.status = 'done' then
    select * into v_document from public.paperwork_documents
    where tenant_id = p_tenant_id and paperwork_request_id = p_request_id and status = 'delivered'
    order by updated_at desc, id limit 1;
    return jsonb_build_object('request_id', v_request.id, 'document_id', v_document.id,
      'current_stage', 'delivered', 'status', 'done',
      'updated_at', v_request.updated_at, 'idempotent', true);
  end if;

  if v_request.current_stage <> 'received_from_processor' or v_request.status <> 'open' then
    raise exception 'لا يمكن تسليم طلب غير مفتوح أو غير موجود في الخزنة.';
  end if;

  select * into v_document from public.paperwork_documents
  where tenant_id = p_tenant_id and paperwork_request_id = p_request_id and status = 'in_custody'
  order by created_at, id limit 1 for update;
  if v_document.id is null then raise exception 'لا توجد ورقة في الخزنة مرتبطة بهذا الطلب.'; end if;
  if exists(select 1 from public.paperwork_documents
    where tenant_id = p_tenant_id and paperwork_request_id = p_request_id
      and status = 'in_custody' and id <> v_document.id) then
    raise exception 'يوجد أكثر من مستند داخل الخزنة مرتبط بالطلب.';
  end if;

  select * into v_latest_move from public.paperwork_document_moves
  where tenant_id = p_tenant_id and document_id = v_document.id
  order by moved_at desc, created_at desc, id desc limit 1 for update;
  if v_latest_move.id is null or v_latest_move.move_direction <> 'in' then
    raise exception 'آخر حركة للمستند لا تثبت وجوده داخل الخزنة.';
  end if;

  if v_request.sale_id is not null then
    select * into v_sale from public.showroom_sales
    where tenant_id = p_tenant_id and id = v_request.sale_id for update;
    if v_sale.id is null then raise exception 'الفاتورة المرتبطة بطلب الأوراق غير موجودة.'; end if;

    with sale_move as (
      select am.id from public.account_moves am
      where am.tenant_id = p_tenant_id and am.move_type = 'sale' and am.state = 'posted'
        and (am.id = v_sale.account_move_id or am.ref = 'showroom_sale:' || v_sale.id)
      order by case when am.id = v_sale.account_move_id then 0 else 1 end, am.created_at limit 1
    ), invoice_lines as (
      select aml.id, aml.debit from public.account_move_lines aml
      join sale_move sm on sm.id = aml.move_id
      join public.account_accounts aa on aa.id = aml.account_id
        and aa.tenant_id = aml.tenant_id and aa.code = '114001'
      where aml.tenant_id = p_tenant_id and aml.debit > 0
    ), balances as (
      select l.id, l.debit, coalesce(sum(r.amount), 0) paid
      from invoice_lines l left join public.account_partial_reconcile r
        on r.tenant_id = p_tenant_id and r.debit_move_id = l.id
      group by l.id, l.debit
    )
    select round(greatest(coalesce(sum(debit - paid), v_sale.total_amount, 0), 0), 2)
    into v_remaining from balances;

    if v_remaining > 0 and not coalesce(v_request.delivery_override, false) then
      raise exception 'لا يمكن تسليم الأوراق. المتبقي على الفاتورة: % جنيه.',
        trim(to_char(v_remaining, 'FM999G999G999G990D00'));
    end if;
    if v_remaining > 0 and coalesce(v_request.delivery_override, false)
       and (v_request.delivery_override_by is null or v_request.delivery_override_at is null
            or nullif(btrim(coalesce(v_request.delivery_override_reason, '')), '') is null) then
      raise exception 'بيانات استثناء المديونية غير مكتملة.';
    end if;
  end if;

  insert into public.paperwork_document_moves(
    tenant_id, document_id, move_direction, source_type,
    from_user_id, from_location, to_partner_id, to_location,
    moved_at, notes, created_by
  ) values (
    p_tenant_id, v_document.id, 'out', 'to_customer',
    coalesce(v_latest_move.to_user_id, v_user.id),
    coalesce(nullif(v_latest_move.to_location, ''), 'vault'),
    coalesce(v_request.customer_id, v_document.owner_partner_id), 'customer',
    v_now, 'تم تسليم الأوراق للعميل وإخراجها من الخزنة.', v_user.id
  ) returning id into v_move_id;

  update public.paperwork_documents set status = 'delivered',
    release_authorization_consumed_at = case
      when release_authorized_at is not null and release_authorization_consumed_at is null then v_now
      else release_authorization_consumed_at end,
    updated_at = v_now
  where id = v_document.id;

  update public.paperwork_requests set current_stage = 'delivered', status = 'done',
    stage_entered_at = v_now, closed_at = v_now, updated_at = v_now
  where id = v_request.id;

  insert into public.paperwork_request_events(
    tenant_id, request_id, event_type, old_stage, new_stage,
    old_status, new_status, notes, created_by
  ) values (
    p_tenant_id, v_request.id, 'delivered_to_customer', 'received_from_processor',
    'delivered', 'open', 'done',
    concat_ws(chr(10), 'تم تسليم الأوراق للعميل وإخراجها من الخزنة.',
      case when v_remaining > 0 then 'تم التسليم باستخدام استثناء مديونية معتمد.' end), v_user.id
  ) returning id into v_event_id;

  return jsonb_build_object('request_id', v_request.id, 'document_id', v_document.id,
    'document_move_id', v_move_id, 'event_id', v_event_id,
    'current_stage', 'delivered', 'status', 'done', 'updated_at', v_now,
    'idempotent', false);
end;
$$;

revoke all on function public.deliver_paperwork_to_customer(uuid, uuid) from public, anon;
grant execute on function public.deliver_paperwork_to_customer(uuid, uuid) to authenticated;

-- Backfill notification metadata from structural history, never from Arabic text alone.
with candidate as (
  select distinct on (r.id)
    r.id request_id, e.created_at notified_at, e.created_by notified_by, e.notes
  from public.paperwork_requests r
  join public.paperwork_request_events e
    on e.tenant_id = r.tenant_id and e.request_id = r.id
  where r.current_stage = 'client_notified'
    and e.old_stage = 'received_from_processor'
    and e.new_stage = 'client_notified'
  order by r.id, e.created_at desc, e.id desc
)
update public.paperwork_requests r
set customer_notified_at = coalesce(r.customer_notified_at, c.notified_at),
    customer_notified_by = coalesce(r.customer_notified_by, c.notified_by),
    customer_notification_channel = coalesce(r.customer_notification_channel, 'unknown'),
    customer_notification_notes = coalesce(r.customer_notification_notes, c.notes)
from candidate c where r.id = c.request_id;

-- Correct requests whose linked physical document already has a trusted out movement.
with repair as (
  select distinct on (r.id)
    r.id request_id, r.tenant_id, r.current_stage old_stage, r.status old_status,
    d.id document_id, m.id move_id, m.moved_at delivered_at
  from public.paperwork_requests r
  join public.paperwork_documents d
    on d.tenant_id = r.tenant_id and d.paperwork_request_id = r.id and d.status = 'delivered'
  join public.paperwork_document_moves m
    on m.tenant_id = d.tenant_id and m.document_id = d.id and m.move_direction = 'out'
  where r.status = 'open' and r.current_stage in ('received_from_processor', 'client_notified')
  order by r.id, m.moved_at desc, m.created_at desc, m.id desc
), audited as (
  insert into public.paperwork_workflow_migration_audit(
    migration_key, tenant_id, request_id, old_stage, old_status,
    new_stage, new_status, reason, evidence
  )
  select '20260814130000', tenant_id, request_id, old_stage, old_status,
    'delivered', 'done', 'physical_document_already_delivered',
    jsonb_build_object('document_id', document_id, 'out_move_id', move_id, 'delivered_at', delivered_at)
  from repair on conflict do nothing returning request_id
), updated as (
  update public.paperwork_requests r set current_stage = 'delivered', status = 'done',
    stage_entered_at = x.delivered_at, closed_at = x.delivered_at, updated_at = greatest(r.updated_at, x.delivered_at)
  from repair x where r.id = x.request_id returning r.id, r.tenant_id
)
insert into public.paperwork_request_events(
  tenant_id, request_id, event_type, old_stage, new_stage,
  old_status, new_status, notes, created_by, created_at
)
select x.tenant_id, x.request_id, 'delivered_to_customer', x.old_stage, 'delivered',
  x.old_status, 'done',
  'تم تصحيح حالة الطلب لتتوافق مع حركة تسليم المستند المسجلة سابقًا.', null, x.delivered_at
from repair x
where not exists (
  select 1 from public.paperwork_request_events e
  where e.request_id = x.request_id and e.event_type = 'delivered_to_customer'
    and e.created_at = x.delivered_at
);

-- Audit and map the three retired stages. Historical events remain unchanged.
insert into public.paperwork_workflow_migration_audit(
  migration_key, tenant_id, request_id, old_stage, old_status,
  new_stage, new_status, reason, evidence
)
select '20260814130000', tenant_id, id, current_stage, status,
  case current_stage
    when 'owner_confirmation' then 'preparation'
    when 'processor_ready' then 'sent_to_processor'
    when 'client_notified' then 'received_from_processor'
  end,
  status, 'retired_legacy_stage', '{}'::jsonb
from public.paperwork_requests
where current_stage in ('owner_confirmation', 'processor_ready', 'client_notified')
on conflict do nothing;

with ready_event as (
  select distinct on (r.id) r.id request_id, e.created_at, e.created_by, e.notes
  from public.paperwork_requests r
  left join public.paperwork_request_events e
    on e.tenant_id = r.tenant_id and e.request_id = r.id
    and (e.new_stage = 'processor_ready' or e.event_type = 'supplier_finished')
  where r.current_stage = 'processor_ready'
  order by r.id, e.created_at desc nulls last, e.id desc nulls last
)
update public.paperwork_requests r set
  processor_ready_at = coalesce(r.processor_ready_at, e.created_at),
  processor_ready_by = coalesce(r.processor_ready_by, e.created_by),
  processor_ready_notes = coalesce(r.processor_ready_notes, e.notes)
from ready_event e where r.id = e.request_id;

update public.paperwork_requests set current_stage = 'preparation', updated_at = now()
where current_stage = 'owner_confirmation';

update public.paperwork_requests set current_stage = 'sent_to_processor', updated_at = now()
where current_stage = 'processor_ready';

update public.paperwork_requests set current_stage = 'received_from_processor', updated_at = now()
where current_stage = 'client_notified';

-- Rewrite live remote functions defensively so cancellation/return/manual legacy paths
-- no longer operate on retired stage codes or the invalid delivered_to_customer status.
do $$
declare
  v_function record;
  v_definition text;
begin
  for v_function in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%current_stage%'
      and p.proname not in (
        'send_paperwork_request_to_processor', 'mark_paperwork_processor_ready',
        'notify_paperwork_customer', 'receive_paperwork_request_from_processor',
        'deliver_paperwork_to_customer'
      )
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    v_definition := replace(v_definition, '''owner_confirmation''', '''preparation''');
    v_definition := replace(v_definition, '''processor_ready''', '''sent_to_processor''');
    v_definition := replace(v_definition, '''client_notified''', '''received_from_processor''');
    v_definition := replace(v_definition, '''delivered_to_customer''', '''delivered''');
    execute v_definition;
  end loop;
end;
$$;

do $$
declare v_remaining integer;
begin
  select count(*) into v_remaining from public.paperwork_requests
  where current_stage in ('owner_confirmation', 'processor_ready', 'client_notified');
  if v_remaining <> 0 then raise exception 'Retired paperwork stages remain: %', v_remaining; end if;
end;
$$;

alter table public.paperwork_requests drop constraint if exists paperwork_requests_current_stage_check;
alter table public.paperwork_requests add constraint paperwork_requests_current_stage_check
check (current_stage in (
  'preparation', 'sent_to_processor', 'received_from_processor', 'delivered',
  'pending_processor_cancellation', 'cancelled'
));

create index if not exists paperwork_requests_processor_ready_queue_idx
  on public.paperwork_requests(tenant_id, processor_ready_at, created_at)
  where current_stage = 'sent_to_processor' and status = 'open';

create index if not exists paperwork_requests_customer_notification_queue_idx
  on public.paperwork_requests(tenant_id, customer_notified_at, created_at)
  where current_stage = 'received_from_processor' and status = 'open';

notify pgrst, 'reload schema';
commit;
