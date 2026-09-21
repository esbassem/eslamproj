-- Phase 2D failure-boundary, tenant-scope and CRM contract tests.
-- Dedicated test tenant only; every fixture is rolled back.
begin;

insert into public.showroom_financial_cutovers (
  tenant_id, source_app, source_model, canonical_generation, activation_origin
) values (
  '10b40000-0000-4000-8000-000000000002', 'showroom', 'sale', 2,
  'phase_2d_atomicity_test'
);
insert into public.tenant_modules (tenant_id, module_id, state, enabled_by)
values (
  '10b40000-0000-4000-8000-000000000002',
  (select id from public.ir_modules where technical_name = 'inventory'),
  'installed', '10b40000-0000-4000-8000-000000000003'
);
insert into public.showroom_configs (id, tenant_id, branch_id, name, code)
values (
  '10b40000-0000-4000-8000-000000000120',
  '10b40000-0000-4000-8000-000000000002',
  '10b40000-0000-4000-8000-000000000010',
  'Phase 2D atomicity showroom', 'P2D-ATOMIC'
);
insert into public.product_templates (
  id, tenant_id, name, internal_reference, product_type, tracking, sale_price
) values
  ('10b40000-0000-4000-8000-000000000121',
   '10b40000-0000-4000-8000-000000000002', 'P2D atomic service',
   'P2D-ATOMIC-SVC', 'service', 'none', 2500),
  ('10b40000-0000-4000-8000-000000000122',
   '10b40000-0000-4000-8000-000000000002', 'P2D atomic serial',
   'P2D-ATOMIC-SER', 'goods', 'serial', 2500);
insert into public.product_products (
  id, tenant_id, product_template_id, display_name, sku, tracking, sale_price
) values
  ('10b40000-0000-4000-8000-000000000123',
   '10b40000-0000-4000-8000-000000000002',
   '10b40000-0000-4000-8000-000000000121', 'P2D atomic service',
   'P2D-ATOMIC-SVC', 'none', 2500),
  ('10b40000-0000-4000-8000-000000000124',
   '10b40000-0000-4000-8000-000000000002',
   '10b40000-0000-4000-8000-000000000122', 'P2D atomic serial',
   'P2D-ATOMIC-SER', 'serial', 2500);
update public.product_templates
set default_product_product_id = case id
  when '10b40000-0000-4000-8000-000000000121'::uuid
    then '10b40000-0000-4000-8000-000000000123'::uuid
  else '10b40000-0000-4000-8000-000000000124'::uuid end
where id in (
  '10b40000-0000-4000-8000-000000000121',
  '10b40000-0000-4000-8000-000000000122'
);

create function pg_temp.make_phase2d_service_sale(p_id uuid, p_customer uuid default null)
returns void language plpgsql as $$
begin
  insert into public.showroom_sales (
    id, tenant_id, branch_id, customer_id, sale_date, status,
    showroom_config_id, created_by, notes
  ) values (
    p_id, '10b40000-0000-4000-8000-000000000002',
    '10b40000-0000-4000-8000-000000000010',
    coalesce(p_customer, '10b40000-0000-4000-8000-000000000011'),
    current_date, 'pending_payment',
    '10b40000-0000-4000-8000-000000000120',
    '10b40000-0000-4000-8000-000000000003', 'Phase 2D atomicity fixture'
  );
  insert into public.showroom_sale_lines (
    tenant_id, sale_id, product_product_id, description,
    quantity, unit_price, total
  ) values (
    '10b40000-0000-4000-8000-000000000002', p_id,
    '10b40000-0000-4000-8000-000000000123', 'Atomicity service line',
    1, 2500, 2500
  );
end
$$;

select pg_temp.make_phase2d_service_sale('10b40000-0000-4000-8000-000000000130');
select pg_temp.make_phase2d_service_sale('10b40000-0000-4000-8000-000000000140');
select pg_temp.make_phase2d_service_sale('10b40000-0000-4000-8000-000000000150');
select pg_temp.make_phase2d_service_sale('10b40000-0000-4000-8000-000000000160');
select pg_temp.make_phase2d_service_sale(
  '10b40000-0000-4000-8000-000000000170',
  (select id from public.partners
   where tenant_id <> '10b40000-0000-4000-8000-000000000002'
     and active and customer_rank > 0 order by id limit 1)
);
select pg_temp.make_phase2d_service_sale('10b40000-0000-4000-8000-000000000180');
select pg_temp.make_phase2d_service_sale('10b40000-0000-4000-8000-000000000190');

-- Serial fixture for G, then reused by L to prove the reservation owner wins.
insert into public.showroom_sales (
  id, tenant_id, branch_id, customer_id, sale_date, status,
  showroom_config_id, created_by
) values
  ('10b40000-0000-4000-8000-000000000135',
   '10b40000-0000-4000-8000-000000000002',
   '10b40000-0000-4000-8000-000000000010',
   '10b40000-0000-4000-8000-000000000011', current_date, 'pending_payment',
   '10b40000-0000-4000-8000-000000000120',
   '10b40000-0000-4000-8000-000000000003'),
  ('10b40000-0000-4000-8000-000000000175',
   '10b40000-0000-4000-8000-000000000002',
   '10b40000-0000-4000-8000-000000000010',
   '10b40000-0000-4000-8000-000000000011', current_date, 'pending_payment',
   '10b40000-0000-4000-8000-000000000120',
   '10b40000-0000-4000-8000-000000000003');
insert into public.stock_tracking_units (
  id, tenant_id, tracking_type, tracking_number, status, notes,
  product_product_id, product_template_id
) values (
  '10b40000-0000-4000-8000-000000000136',
  '10b40000-0000-4000-8000-000000000002', 'serial', 'P2D-ATOMIC-UNIT',
  'reserved', 'showroom_sale:10b40000-0000-4000-8000-000000000135',
  '10b40000-0000-4000-8000-000000000124',
  '10b40000-0000-4000-8000-000000000122'
);
insert into public.showroom_sale_lines (
  tenant_id, sale_id, product_product_id, tracking_unit_id,
  description, quantity, unit_price, total
) values
  ('10b40000-0000-4000-8000-000000000002',
   '10b40000-0000-4000-8000-000000000135',
   '10b40000-0000-4000-8000-000000000124',
   '10b40000-0000-4000-8000-000000000136', 'Inventory rollback', 1, 2500, 2500),
  ('10b40000-0000-4000-8000-000000000002',
   '10b40000-0000-4000-8000-000000000175',
   '10b40000-0000-4000-8000-000000000124',
   '10b40000-0000-4000-8000-000000000136', 'Unique-unit conflict', 1, 2500, 2500);

create function pg_temp.fail_phase2d_posting() returns trigger language plpgsql as $$
begin
  if new.source_id = '10b40000-0000-4000-8000-000000000130' then
    raise exception 'PHASE2D_FORCED_POSTING_FAILURE';
  end if;
  return new;
end $$;
create trigger phase2d_force_posting_failure
before insert on public.financial_sale_postings
for each row execute function pg_temp.fail_phase2d_posting();

create function pg_temp.fail_phase2d_inventory() returns trigger language plpgsql as $$
begin
  if new.reference_id = '10b40000-0000-4000-8000-000000000135' then
    raise exception 'PHASE2D_FORCED_INVENTORY_FAILURE';
  end if;
  return new;
end $$;
create trigger phase2d_force_inventory_failure
before insert on public.stock_moves
for each row execute function pg_temp.fail_phase2d_inventory();

select set_config(
  'request.jwt.claim.sub', '10b40000-0000-4000-8000-000000000001', true
);
set local role authenticated;

do $$
begin
  begin
    perform public.complete_showroom_sale(
      '10b40000-0000-4000-8000-000000000130', 0, null, '[]'
    );
    raise exception 'PHASE2D_F_POSTING_FAILURE_ACCEPTED';
  exception when others then
    if sqlerrm = 'PHASE2D_F_POSTING_FAILURE_ACCEPTED'
       or position('PHASE2D_FORCED_POSTING_FAILURE' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.complete_showroom_sale(
      '10b40000-0000-4000-8000-000000000135', 0, null, '[]'
    );
    raise exception 'PHASE2D_G_INVENTORY_FAILURE_ACCEPTED';
  exception when others then
    if sqlerrm = 'PHASE2D_G_INVENTORY_FAILURE_ACCEPTED'
       or position('PHASE2D_FORCED_INVENTORY_FAILURE' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

reset role;
do $$
begin
  if exists (
    select 1 from public.showroom_sales sale
    where sale.id in (
      '10b40000-0000-4000-8000-000000000130',
      '10b40000-0000-4000-8000-000000000135'
    ) and (sale.status <> 'pending_payment' or sale.account_move_id is not null)
  ) or exists (
    select 1 from public.financial_sale_postings posting
    where posting.source_id in (
      '10b40000-0000-4000-8000-000000000130',
      '10b40000-0000-4000-8000-000000000135'
    )
  ) or exists (
    select 1 from public.financial_engine_bindings binding
    where binding.source_app = 'showroom' and binding.source_model = 'sale'
      and binding.source_id in (
        '10b40000-0000-4000-8000-000000000130',
        '10b40000-0000-4000-8000-000000000135'
      )
  ) or (select status from public.stock_tracking_units
        where id = '10b40000-0000-4000-8000-000000000136') <> 'reserved' then
    raise exception 'PHASE2D_F_G_ATOMIC_ROLLBACK_INVALID';
  end if;
end $$;

-- H: a period lock makes the whole business command fail closed.
insert into public.financial_period_locks (
  tenant_id, locked_through_date, active, reason, created_by, updated_by
) values (
  '10b40000-0000-4000-8000-000000000002', current_date, true,
  'Phase 2D rollback lock', '10b40000-0000-4000-8000-000000000003',
  '10b40000-0000-4000-8000-000000000003'
) on conflict (tenant_id) do update
set locked_through_date = excluded.locked_through_date,
    active = true,
    reason = excluded.reason,
    updated_by = excluded.updated_by,
    updated_at = now();
set local role authenticated;
do $$
begin
  begin
    perform public.complete_showroom_sale(
      '10b40000-0000-4000-8000-000000000140', 0, null, '[]'
    );
    raise exception 'PHASE2D_H_CLOSED_PERIOD_ACCEPTED';
  exception when check_violation then
    if sqlerrm <> 'FINANCIAL_PERIOD_CLOSED' then raise; end if;
  end;
end $$;
reset role;
update public.financial_period_locks set active = false
where tenant_id = '10b40000-0000-4000-8000-000000000002';

-- I: remove the AR resolver configuration only inside this outer rollback.
update public.account_functional_accounts
set is_active = false
where tenant_id = '10b40000-0000-4000-8000-000000000002'
  and functional_role = 'customer_receivable';
set local role authenticated;
do $$
begin
  begin
    perform public.complete_showroom_sale(
      '10b40000-0000-4000-8000-000000000150', 0, null, '[]'
    );
    raise exception 'PHASE2D_I_MISSING_CONFIG_ACCEPTED';
  exception when others then
    if sqlerrm = 'PHASE2D_I_MISSING_CONFIG_ACCEPTED' then raise; end if;
  end;
end $$;
reset role;
update public.account_functional_accounts
set is_active = true
where tenant_id = '10b40000-0000-4000-8000-000000000002'
  and functional_role = 'customer_receivable';

-- J and L: tenant/customer mismatch and reservation-owner conflict.
set local role authenticated;
do $$
begin
  begin
    perform public.complete_showroom_sale(
      '10b40000-0000-4000-8000-000000000170', 0, null, '[]'
    );
    raise exception 'PHASE2D_J_CROSS_TENANT_CUSTOMER_ACCEPTED';
  exception when check_violation then
    if sqlerrm <> 'SHOWROOM_CUSTOMER_INVALID_OR_INACTIVE' then raise; end if;
  end;
  begin
    perform public.complete_showroom_sale(
      '10b40000-0000-4000-8000-000000000175', 0, null, '[]'
    );
    raise exception 'PHASE2D_L_UNIQUE_UNIT_CONFLICT_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm <> 'SHOWROOM_TRACKING_UNIT_NOT_RESERVED_FOR_SALE' then raise; end if;
  end;
end $$;
reset role;

-- K: a user with Showroom permission but no user_branch_access is denied.
create temporary table phase2d_unscoped_actor as
select auth_user.id auth_user_id
from auth.users auth_user
where not exists (
  select 1 from public.tenant_users tenant_user
  where tenant_user.auth_user_id = auth_user.id
)
order by auth_user.created_at
limit 1;
do $$ begin
  if not exists (select 1 from phase2d_unscoped_actor) then
    raise exception 'PHASE2D_K_UNASSIGNED_AUTH_FIXTURE_MISSING';
  end if;
end $$;
insert into public.tenant_users (
  id, tenant_id, auth_user_id, full_name, role, is_active
) select
  '10b40000-0000-4000-8000-000000000181',
  '10b40000-0000-4000-8000-000000000002', auth_user_id,
  'Phase 2D unscoped operator', 'staff', true
from phase2d_unscoped_actor;
insert into public.res_groups (id, tenant_id, name, code, category)
values (
  '10b40000-0000-4000-8000-000000000182',
  '10b40000-0000-4000-8000-000000000002',
  'Phase 2D Showroom confirmation', 'phase2d_showroom_confirmation', 'showroom'
);
insert into public.auth_group_permissions (group_id, permission_id)
select '10b40000-0000-4000-8000-000000000182', id
from public.auth_permissions where code = 'showroom_point.access';
insert into public.res_users_groups (tenant_id, user_id, group_id)
values (
  '10b40000-0000-4000-8000-000000000002',
  '10b40000-0000-4000-8000-000000000181',
  '10b40000-0000-4000-8000-000000000182'
);
select set_config('request.jwt.claim.sub', auth_user_id::text, true)
from phase2d_unscoped_actor;
set local role authenticated;
do $$
begin
  begin
    perform public.complete_showroom_sale(
      '10b40000-0000-4000-8000-000000000180', 0, null, '[]'
    );
    raise exception 'PHASE2D_K_BRANCH_SCOPE_ACCEPTED';
  exception when insufficient_privilege then
    if sqlerrm <> 'SHOWROOM_BRANCH_ACCESS_REQUIRED' then raise; end if;
  end;
end $$;
reset role;

-- M: the existing six-argument CRM wrapper shares the same transaction and
-- delegates accounting to the exact four-argument Canonical path.
insert into public.crm_sales_users (tenant_id, user_id, active)
values (
  '10b40000-0000-4000-8000-000000000002',
  '10b40000-0000-4000-8000-000000000003', true
);
select set_config(
  'request.jwt.claim.sub', '10b40000-0000-4000-8000-000000000001', true
);
set local role authenticated;
do $$
declare lead_id uuid; result jsonb;
begin
  lead_id := (public.crm_create_lead(
    '10b40000-0000-4000-8000-000000000002',
    jsonb_build_object(
      'customer_name', 'Phase 2D CRM customer',
      'phone', '01000002190',
      'purchase_type', 'cash',
      'assigned_sales_user_id', '10b40000-0000-4000-8000-000000000003'
    )
  )).id;
  result := public.complete_showroom_sale(
    '10b40000-0000-4000-8000-000000000190', 0, null, '[]', lead_id, null
  );
  if result ->> 'financial_engine' <> 'canonical'
     or not exists (
       select 1 from public.crm_leads lead
       where lead.id = lead_id and lead.status = 'sold'
         and lead.sale_id = '10b40000-0000-4000-8000-000000000190'
     )
     or (select count(*) from public.financial_sale_postings posting
         where posting.source_id = '10b40000-0000-4000-8000-000000000190') <> 1 then
    raise exception 'PHASE2D_M_CRM_CANONICAL_PATH_INVALID';
  end if;
end $$;

reset role;
do $$
begin
  if exists (
    select 1 from public.showroom_sales sale
    where sale.id in (
      '10b40000-0000-4000-8000-000000000130',
      '10b40000-0000-4000-8000-000000000135',
      '10b40000-0000-4000-8000-000000000140',
      '10b40000-0000-4000-8000-000000000150',
      '10b40000-0000-4000-8000-000000000170',
      '10b40000-0000-4000-8000-000000000175',
      '10b40000-0000-4000-8000-000000000180'
    ) and (sale.status <> 'pending_payment' or sale.account_move_id is not null)
  ) then
    raise exception 'PHASE2D_FAILED_SALE_STATE_LEAKED';
  end if;
end $$;

rollback;
