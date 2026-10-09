-- Keep Inventory action codes stable while presenting them beneath the visible
-- Inventory application (whose canonical application code is `products`).
insert into public.auth_permissions (
  code,
  name,
  description,
  resource,
  action,
  active,
  module_code,
  permission_type,
  sort_order
)
values (
  'inventory.adjust',
  'تسوية المخزون',
  'اعتماد فروق الجرد وترحيل تسويات المخزون.',
  'inventory',
  'adjust',
  true,
  'products',
  'action',
  130
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    resource = excluded.resource,
    action = excluded.action,
    active = true,
    module_code = excluded.module_code,
    permission_type = excluded.permission_type,
    sort_order = excluded.sort_order,
    updated_at = now();

-- Presentation metadata only. RPC permission contracts remain inventory.* and
-- products.access remains the application-access permission.
update public.auth_permissions
set module_code = 'products',
    permission_type = 'action',
    updated_at = now()
where code like 'inventory.%'
  and (module_code is distinct from 'products' or permission_type is distinct from 'action');

create or replace function public.submit_inventory_count(
  p_count_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
#variable_conflict use_variable
declare
  t uuid := public.current_tenant_id();
  a uuid := public.current_tenant_user_id();
  c public.inventory_counts%rowtype;
  result jsonb;
begin
  if t is null
     or a is null
     or not public.inventory_runtime_access_allowed(t)
     or not public.has_permission('inventory.count_submit', t) then
    raise exception using errcode = '42501', message = 'INVENTORY_COUNT_SUBMIT_DENIED';
  end if;

  select * into c
  from public.inventory_counts x
  where x.id = p_count_id
    and x.tenant_id = t
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'INVENTORY_COUNT_SUBMIT_DENIED';
  end if;

  if not public.has_branch_access(c.branch_id)
     or not public.has_stock_location_access(c.location_id) then
    raise exception using errcode = '42501', message = 'INVENTORY_COUNT_SUBMIT_SCOPE_DENIED';
  end if;

  if c.state = 'submitted' then
    return jsonb_build_object('count_id', c.id, 'state', c.state, 'idempotent_replay', true);
  end if;

  if c.state <> 'draft' then
    raise exception using errcode = '23514', message = 'INVENTORY_COUNT_NOT_SUBMITTABLE';
  end if;

  if exists (
    select 1
    from public.inventory_count_snapshots s
    where s.count_id = c.id
      and s.tracking_mode = 'none'
      and not exists (
        select 1
        from public.inventory_count_observations o
        where o.count_id = c.id
          and o.observation_type = 'quantity'
          and o.product_id = s.product_id
      )
  ) then
    raise exception using errcode = '23514', message = 'INVENTORY_COUNT_QUANTITY_OBSERVATION_MISSING';
  end if;

  insert into public.inventory_count_variances (
    tenant_id, count_id, snapshot_id, observation_id, product_id,
    tracking_unit_id, variance_type, expected_quantity, physical_quantity,
    variance_quantity, resolution_state
  )
  select t, c.id, s.id, o.id, s.product_id, null,
         case when o.physical_quantity = s.expected_quantity then 'zero'
              when o.physical_quantity > s.expected_quantity then 'positive'
              else 'negative' end,
         s.expected_quantity, o.physical_quantity,
         o.physical_quantity - s.expected_quantity,
         case when o.physical_quantity = s.expected_quantity then 'no_adjustment' else 'pending' end
  from public.inventory_count_snapshots s
  join public.inventory_count_observations o
    on o.count_id = s.count_id
   and o.product_id = s.product_id
   and o.observation_type = 'quantity'
  where s.count_id = c.id
    and s.tracking_mode = 'none';

  insert into public.inventory_count_variances (
    tenant_id, count_id, snapshot_id, observation_id, product_id,
    tracking_unit_id, variance_type, expected_quantity, physical_quantity,
    variance_quantity, resolution_state
  )
  select t, c.id, s.id, o.id, s.product_id, s.tracking_unit_id,
         case when o.id is null then 'missing' else 'matched' end,
         1, case when o.id is null then 0 else 1 end,
         case when o.id is null then -1 else 0 end,
         case when o.id is null then 'pending' else 'no_adjustment' end
  from public.inventory_count_snapshots s
  left join public.inventory_count_observations o
    on o.count_id = s.count_id
   and o.tracking_unit_id = s.tracking_unit_id
  where s.count_id = c.id
    and s.tracking_mode = 'serial';

  insert into public.inventory_count_variances (
    tenant_id, count_id, observation_id, product_id, tracking_unit_id,
    variance_type, physical_quantity, variance_quantity, observed_state,
    observed_location_id, observed_version, resolution_state
  )
  select t, c.id, o.id, o.product_id, o.tracking_unit_id,
         case when o.tracking_unit_id is null then 'identity_review'
              when st.current_location_id <> c.location_id then 'location_mismatch'
              else 'unexpected' end,
         1, 1, st.state, st.current_location_id, st.version, 'pending'
  from public.inventory_count_observations o
  left join public.inventory_count_snapshots s
    on s.count_id = o.count_id
   and s.tracking_unit_id = o.tracking_unit_id
  left join public.inventory_tracking_unit_states st
    on st.tenant_id = o.tenant_id
   and st.tracking_unit_id = o.tracking_unit_id
  where o.count_id = c.id
    and o.observation_type = 'serial'
    and s.id is null;

  update public.inventory_counts
  set state = 'submitted', submitted_by = a, submitted_at = now()
  where id = c.id;

  result := jsonb_build_object(
    'count_id', c.id,
    'state', 'submitted',
    'variance_count', (select count(*) from public.inventory_count_variances v where v.count_id = c.id)
  );

  insert into public.inventory_command_requests (
    tenant_id, command_type, idempotency_key, request_fingerprint,
    result, created_by, completed_at
  )
  values (
    t, 'count_submit', btrim(p_idempotency_key),
    public.inventory_request_fingerprint(jsonb_build_object('count', c.id)),
    result, a, now()
  )
  on conflict do nothing;

  return result;
end
$function$;

revoke all on function public.submit_inventory_count(uuid, text) from public, anon;
grant execute on function public.submit_inventory_count(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
