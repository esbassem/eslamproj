begin;

create or replace function public.record_previous_customer_paperwork_delivery_bulk(
  p_tenant_id uuid,
  p_request_ids uuid[],
  p_reason text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sorted_ids uuid[];
  v_request_id uuid;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if p_tenant_id is null then
    raise exception 'تعذر تحديد الشركة.';
  end if;
  if p_request_ids is null or cardinality(p_request_ids) = 0 then
    raise exception 'حدد طلبًا واحدًا على الأقل.';
  end if;
  if cardinality(p_request_ids) > 100 then
    raise exception 'لا يمكن تنفيذ الإجراء على أكثر من 100 طلب في المرة الواحدة.';
  end if;
  if exists (select 1 from unnest(p_request_ids) as selected(request_id) where selected.request_id is null) then
    raise exception 'قائمة الطلبات تحتوي على قيمة غير صالحة.';
  end if;

  select array_agg(request_id order by request_id)
  into v_sorted_ids
  from (
    select distinct selected.request_id
    from unnest(p_request_ids) as selected(request_id)
  ) unique_requests;

  if cardinality(v_sorted_ids) <> cardinality(p_request_ids) then
    raise exception 'قائمة الطلبات تحتوي على طلب مكرر.';
  end if;

  foreach v_request_id in array v_sorted_ids loop
    v_result := public.record_previous_customer_paperwork_delivery(
      p_tenant_id,
      v_request_id,
      p_reason,
      p_notes
    );
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object(
    'count', cardinality(v_sorted_ids),
    'request_ids', to_jsonb(v_sorted_ids),
    'results', v_results
  );
end;
$$;

revoke all on function public.record_previous_customer_paperwork_delivery_bulk(uuid, uuid[], text, text) from public, anon;
grant execute on function public.record_previous_customer_paperwork_delivery_bulk(uuid, uuid[], text, text) to authenticated;

comment on function public.record_previous_customer_paperwork_delivery_bulk(uuid, uuid[], text, text) is
'Atomically records previous customer delivery for multiple paperwork requests; any failure rolls back the entire batch.';

notify pgrst, 'reload schema';

commit;
