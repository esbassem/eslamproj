begin;

create or replace function public.record_previous_paperwork_document_delivery(
  p_tenant_id uuid,
  p_document_id uuid,
  p_delivered_at timestamptz,
  p_reason text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_user_id uuid;
  v_document public.paperwork_documents%rowtype;
  v_latest_move public.paperwork_document_moves%rowtype;
  v_move public.paperwork_document_moves%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_now timestamptz := clock_timestamp();
  v_move_notes text;
begin
  perform public.require_paperwork_access(p_tenant_id);

  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;
  if p_tenant_id is null or p_document_id is null then
    raise exception 'تعذر تحديد الشركة أو المستند.';
  end if;
  if p_delivered_at is null then
    raise exception 'تاريخ ووقت التسليم إلزامي.';
  end if;
  if p_delivered_at > v_now then
    raise exception 'لا يمكن أن يكون تاريخ التسليم في المستقبل.';
  end if;
  if v_reason is null or v_reason not in (
    'delivered_before_system_use',
    'delivery_not_recorded',
    'owner_confirmed_previous_delivery',
    'other'
  ) then
    raise exception 'سبب التسجيل المتأخر غير صالح.';
  end if;
  if v_reason = 'other' and v_notes is null then
    raise exception 'الملاحظات إلزامية عند اختيار سبب آخر.';
  end if;

  select tenant_user.id into v_tenant_user_id
  from public.tenant_users tenant_user
  where tenant_user.tenant_id = p_tenant_id
    and tenant_user.auth_user_id = auth.uid()
    and tenant_user.is_active = true
  order by tenant_user.created_at, tenant_user.id
  limit 1;

  if v_tenant_user_id is null then
    raise exception 'لا تملك صلاحية الوصول إلى هذه الشركة.';
  end if;
  if not public.is_tenant_owner(p_tenant_id) then
    raise exception 'تسجيل الصرف السابق متاح لمالك الشركة فقط.';
  end if;

  select document.* into v_document
  from public.paperwork_documents document
  where document.tenant_id = p_tenant_id and document.id = p_document_id
  for update;

  if v_document.id is null then
    raise exception 'المستند غير موجود داخل هذه الشركة.';
  end if;
  if v_document.status <> 'in_custody' then
    raise exception 'المستند لم يعد موجودًا في العهدة أو تم تسجيل خروجه بالفعل.';
  end if;

  select movement.* into v_latest_move
  from public.paperwork_document_moves movement
  where movement.tenant_id = p_tenant_id and movement.document_id = v_document.id
  order by movement.moved_at desc, movement.created_at desc, movement.id desc
  limit 1
  for update;

  if v_latest_move.id is null or v_latest_move.move_direction <> 'in' then
    raise exception 'المستند لم يعد موجودًا في العهدة أو تم تسجيل خروجه بالفعل.';
  end if;
  if p_delivered_at < v_latest_move.moved_at then
    raise exception 'تاريخ التسليم لا يمكن أن يسبق آخر دخول للمستند إلى العهدة.';
  end if;

  v_move_notes := 'retrospective_reason=' || v_reason;
  if v_notes is not null then
    v_move_notes := v_move_notes || chr(10) || 'retrospective_notes=' || v_notes;
  end if;

  insert into public.paperwork_document_moves (
    tenant_id, document_id, move_direction, source_type,
    from_user_id, from_location, to_partner_id, to_location,
    moved_at, notes, created_by
  ) values (
    p_tenant_id, v_document.id, 'out', 'retrospective_delivery',
    v_latest_move.to_user_id,
    coalesce(nullif(v_latest_move.to_location, ''), 'vault'),
    v_document.owner_partner_id, 'customer',
    p_delivered_at, v_move_notes, v_tenant_user_id
  )
  returning * into v_move;

  update public.paperwork_documents
  set status = 'delivered', updated_at = v_now
  where id = v_document.id and tenant_id = p_tenant_id;

  if v_document.paperwork_request_id is not null then
    update public.paperwork_requests request
    set current_stage = 'delivered', status = 'done',
        stage_entered_at = v_move.moved_at, closed_at = v_move.moved_at,
        updated_at = greatest(request.updated_at, v_now)
    where request.tenant_id = p_tenant_id
      and request.id = v_document.paperwork_request_id
      and request.status = 'open';

    if found then
      insert into public.paperwork_request_events(
        tenant_id, request_id, event_type, old_stage, new_stage,
        old_status, new_status, notes, created_by, created_at
      ) values (
        p_tenant_id, v_document.paperwork_request_id, 'delivered_to_customer',
        'received_from_processor', 'delivered', 'open', 'done',
        'تم إغلاق الطلب تلقائيًا عند تسجيل تسليم المستند السابق للعميل.',
        v_tenant_user_id, v_move.moved_at
      );
    end if;
  end if;

  return jsonb_build_object(
    'document_id', v_document.id,
    'status', 'delivered',
    'move_id', v_move.id,
    'delivered_at', v_move.moved_at,
    'recorded_at', v_move.created_at,
    'recorded_by', v_move.created_by,
    'reason', v_reason,
    'notes', v_notes
  );
end;
$$;



create temporary table expected_paperwork_delivery_repair(
  request_id uuid primary key,document_id uuid unique not null,out_move_id uuid unique not null,tracking_unit_id uuid not null
) on commit drop;
insert into expected_paperwork_delivery_repair values
    ('8ae91aeb-447a-4b1c-9b0c-d55655043e2d'::uuid,'c584e5e8-ee6f-457f-ae71-9341c452eec5'::uuid,'55c4bc4d-9592-4bec-9401-86e17a272799'::uuid,'37c6fe24-b728-44e0-af22-95129c9689d4'::uuid),
    ('9587f484-63d1-46f1-9953-c568567a37a1'::uuid,'77b5c2fe-2de1-4f85-b85f-4aa60abf16a3'::uuid,'0d4d10bc-9c73-4b26-bd09-a21dca01a23d'::uuid,'4f10e221-2e9c-4842-8471-8cc922657921'::uuid),
    ('27836d4c-20a6-49fc-8a39-96daed24c3a6'::uuid,'bc30a45b-a4c6-496c-bd77-676f6d9590c4'::uuid,'3512d8cf-dfc6-4492-b03b-7693e31eff41'::uuid,'64806f5e-6876-4bb1-8e48-d71dd0796eba'::uuid),
    ('d67a2e4f-f315-422d-b50a-00060f75f6fd'::uuid,'d7020574-8cf0-402f-9d40-20a943d3f45c'::uuid,'371c66c3-f31e-41ed-bbe3-ad9fd3072956'::uuid,'1c5397d0-ff1c-4929-b8ed-07f9842adabd'::uuid),
    ('e6dd2885-2fe0-4600-8cb9-c9c69e5f4ac4'::uuid,'52c1ef9d-aa96-49c1-850d-8b444b6c1fdd'::uuid,'baa31caf-3cda-45bd-a89e-246ba304ee2f'::uuid,'38f91d71-f9b0-4ea4-aaf4-a20dbbfd6a5e'::uuid),
    ('2880735a-8399-4f2c-9b28-c5985c77e6dc'::uuid,'0bfa9638-23ad-44c5-8b6a-6ad0ab853d88'::uuid,'87f1d056-5721-45ac-9ae1-a4c34429b636'::uuid,'38d2894b-12be-459c-89da-9ddc88bde29e'::uuid),
    ('ecd059a9-a2b8-4e97-a359-c92cee72bbec'::uuid,'5533e7e6-a995-4001-a388-ac1de6f5676b'::uuid,'14dfc28e-74b0-47e4-b20a-70a5823ae5b0'::uuid,'253eda0a-a6a0-4035-8e6b-a71e11fdf09a'::uuid),
    ('16efc3a2-31b0-4b39-bde9-f641ced11f6e'::uuid,'9896f0ac-4120-4c7b-b9f4-85127f8e8bd3'::uuid,'12b3cddb-43c0-4758-a425-c26c7624b560'::uuid,'01b46271-fff8-4c7c-8c5b-21f95170774f'::uuid);

do $$ declare invalid_count int; begin
  select count(*) into invalid_count from expected_paperwork_delivery_repair expected
  left join public.paperwork_requests request on request.id=expected.request_id
  left join public.paperwork_documents document on document.id=expected.document_id and document.paperwork_request_id=request.id
  left join public.paperwork_document_moves move on move.id=expected.out_move_id and move.document_id=document.id
  where request.status is distinct from 'open' or request.current_stage is distinct from 'received_from_processor'
    or request.closed_at is not null or request.tracking_unit_id is distinct from expected.tracking_unit_id
    or document.status is distinct from 'delivered' or document.tracking_unit_id is distinct from expected.tracking_unit_id
    or move.move_direction is distinct from 'out' or move.source_type is distinct from 'retrospective_delivery'
    or move.to_location is distinct from 'customer'
    or exists(select 1 from public.paperwork_document_moves newer where newer.document_id=document.id
      and (newer.moved_at,newer.created_at,newer.id)>(move.moved_at,move.created_at,move.id));
  if invalid_count<>0 then raise exception 'Paperwork delivery repair precondition changed for % cases',invalid_count; end if;
end $$;

with evidence as (
  select expected.request_id,request.tenant_id,request.current_stage old_stage,request.status old_status,
    expected.document_id,expected.out_move_id,move.moved_at,move.created_by
  from expected_paperwork_delivery_repair expected
  join public.paperwork_requests request on request.id=expected.request_id
  join public.paperwork_document_moves move on move.id=expected.out_move_id
), updated as (
  update public.paperwork_requests request set current_stage='delivered',status='done',
    stage_entered_at=evidence.moved_at,closed_at=evidence.moved_at,
    updated_at=greatest(request.updated_at,evidence.moved_at)
  from evidence where request.id=evidence.request_id
  returning request.id
)
insert into public.paperwork_request_events(
  tenant_id,request_id,event_type,old_stage,new_stage,old_status,new_status,notes,created_by,created_at
)
select evidence.tenant_id,evidence.request_id,'delivered_to_customer',evidence.old_stage,'delivered',
  evidence.old_status,'done','تم تصحيح حالة الطلب بناءً على حركة تسليم المستند السابقة الموثقة.',
  evidence.created_by,evidence.moved_at
from evidence
where not exists(select 1 from public.paperwork_request_events event
  where event.request_id=evidence.request_id and event.event_type='delivered_to_customer');

do $$ begin
  if exists(select 1 from expected_paperwork_delivery_repair expected
    join public.paperwork_requests request on request.id=expected.request_id
    where request.status<>'done' or request.current_stage<>'delivered' or request.closed_at is null) then
    raise exception 'Paperwork delivery repair postcondition failed';
  end if;
  if exists(select 1 from public.paperwork_requests request join public.paperwork_documents document
    on document.tenant_id=request.tenant_id and document.paperwork_request_id=request.id
    where request.status='open' and document.status='delivered') then
    raise exception 'Open requests with delivered documents remain after repair';
  end if;
end $$;

revoke all on function public.record_previous_paperwork_document_delivery(uuid,uuid,timestamptz,text,text) from public,anon;
grant execute on function public.record_previous_paperwork_document_delivery(uuid,uuid,timestamptz,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
