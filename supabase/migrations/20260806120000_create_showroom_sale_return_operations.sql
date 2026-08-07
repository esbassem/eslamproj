begin;

alter table public.showroom_sales add column if not exists source_type text, add column if not exists source_sale_id uuid;
alter table public.account_moves add column if not exists reversed_move_id uuid;
alter table public.stock_moves
  add column if not exists tracking_unit_id uuid,
  add column if not exists original_sale_id uuid,
  add column if not exists original_sale_line_id uuid,
  add column if not exists sale_return_operation_id uuid;

create table public.showroom_sale_return_operations(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid, customer_id uuid not null,
  original_sale_id uuid not null, idempotency_key uuid not null, request_payload jsonb not null, operation_type text not null, status text not null default 'draft',
  reason_code text not null, reason text not null, credit_note_move_id uuid, replacement_sale_id uuid,
  replacement_invoice_move_id uuid, total_return_amount numeric not null default 0,
  total_replacement_amount numeric not null default 0, price_difference numeric not null default 0,
  created_by uuid not null, created_at timestamptz not null default now(), completed_at timestamptz,
  cancelled_at timestamptz, cancelled_by uuid,
  constraint showroom_sale_return_operations_tenant_idempotency_key unique(tenant_id,idempotency_key),
  constraint showroom_sale_return_operations_type_chk check(operation_type in('return','exchange','mixed')),
  constraint showroom_sale_return_operations_status_chk check(status in('draft','confirmed','completed','cancelled','failed')),
  constraint showroom_sale_return_operations_reason_chk check(nullif(btrim(reason),'') is not null),
  constraint showroom_sale_return_operations_tenant_fk foreign key(tenant_id) references public.tenants(id) on delete cascade,
  constraint showroom_sale_return_operations_original_sale_fk foreign key(original_sale_id) references public.showroom_sales(id) on delete restrict,
  constraint showroom_sale_return_operations_replacement_sale_fk foreign key(replacement_sale_id) references public.showroom_sales(id) on delete set null,
  constraint showroom_sale_return_operations_credit_note_fk foreign key(credit_note_move_id) references public.account_moves(id) on delete set null,
  constraint showroom_sale_return_operations_replacement_invoice_fk foreign key(replacement_invoice_move_id) references public.account_moves(id) on delete set null,
  constraint showroom_sale_return_operations_created_by_fk foreign key(created_by) references public.tenant_users(id) on delete restrict,
  constraint showroom_sale_return_operations_cancelled_by_fk foreign key(cancelled_by) references public.tenant_users(id) on delete set null
);

create table public.showroom_sale_return_lines(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, return_operation_id uuid not null,
  original_sale_line_id uuid not null, old_tracking_unit_id uuid, quantity numeric not null,
  unit_price numeric not null, return_amount numeric not null, line_action text not null,
  line_note text, new_tracking_unit_id uuid, replacement_sale_line_id uuid,
  replacement_amount numeric not null default 0, price_difference numeric not null default 0,
  inventory_return_move_id uuid, inventory_out_move_id uuid, old_paperwork_request_id uuid,
  new_paperwork_request_id uuid, reservation_active boolean not null default true, created_at timestamptz not null default now(),
  constraint showroom_sale_return_lines_action_chk check(line_action in('return','exchange')),
  constraint showroom_sale_return_lines_quantity_chk check(quantity>0),
  constraint showroom_sale_return_lines_exchange_chk check((line_action='return' and new_tracking_unit_id is null) or (line_action='exchange' and new_tracking_unit_id is not null)),
  constraint showroom_sale_return_lines_tenant_fk foreign key(tenant_id) references public.tenants(id) on delete cascade,
  constraint showroom_sale_return_lines_operation_fk foreign key(return_operation_id) references public.showroom_sale_return_operations(id) on delete cascade,
  constraint showroom_sale_return_lines_original_line_fk foreign key(original_sale_line_id) references public.showroom_sale_lines(id) on delete restrict,
  constraint showroom_sale_return_lines_old_unit_fk foreign key(old_tracking_unit_id) references public.stock_tracking_units(id) on delete restrict,
  constraint showroom_sale_return_lines_new_unit_fk foreign key(new_tracking_unit_id) references public.stock_tracking_units(id) on delete restrict,
  constraint showroom_sale_return_lines_replacement_line_fk foreign key(replacement_sale_line_id) references public.showroom_sale_lines(id) on delete set null,
  constraint showroom_sale_return_lines_return_move_fk foreign key(inventory_return_move_id) references public.stock_moves(id) on delete set null,
  constraint showroom_sale_return_lines_out_move_fk foreign key(inventory_out_move_id) references public.stock_moves(id) on delete set null,
  constraint showroom_sale_return_lines_old_request_fk foreign key(old_paperwork_request_id) references public.paperwork_requests(id) on delete set null,
  constraint showroom_sale_return_lines_new_request_fk foreign key(new_paperwork_request_id) references public.paperwork_requests(id) on delete set null
);

alter table public.showroom_sales add constraint showroom_sales_source_sale_fk foreign key(source_sale_id) references public.showroom_sales(id) on delete set null;
alter table public.account_moves add constraint account_moves_reversed_move_fk foreign key(reversed_move_id) references public.account_moves(id) on delete set null;
alter table public.stock_moves
  add constraint stock_moves_tracking_unit_fk foreign key(tracking_unit_id) references public.stock_tracking_units(id) on delete set null,
  add constraint stock_moves_original_sale_fk foreign key(original_sale_id) references public.showroom_sales(id) on delete set null,
  add constraint stock_moves_original_sale_line_fk foreign key(original_sale_line_id) references public.showroom_sale_lines(id) on delete set null,
  add constraint stock_moves_sale_return_operation_fk foreign key(sale_return_operation_id) references public.showroom_sale_return_operations(id) on delete set null;

create index showroom_sale_return_operations_sale_idx on public.showroom_sale_return_operations(tenant_id,original_sale_id,created_at desc);
create index showroom_sale_return_lines_original_idx on public.showroom_sale_return_lines(tenant_id,original_sale_line_id);
create unique index showroom_sale_return_lines_active_serial_uq on public.showroom_sale_return_lines(tenant_id,old_tracking_unit_id)
  where old_tracking_unit_id is not null and reservation_active;
create unique index showroom_sale_return_lines_active_new_serial_uq on public.showroom_sale_return_lines(tenant_id,new_tracking_unit_id)
  where new_tracking_unit_id is not null and reservation_active;

create or replace function public.sync_showroom_sale_return_line_reservations() returns trigger language plpgsql set search_path='' as $$
begin
  update public.showroom_sale_return_lines set reservation_active=(new.status in('confirmed','completed'))
  where return_operation_id=new.id;
  return new;
end $$;
create trigger showroom_sale_return_operation_sync_reservations after update of status on public.showroom_sale_return_operations
for each row when(old.status is distinct from new.status) execute function public.sync_showroom_sale_return_line_reservations();
revoke all on function public.sync_showroom_sale_return_line_reservations() from public,anon,authenticated;

alter table public.paperwork_requests
  add column if not exists sale_return_operation_id uuid,
  add column if not exists replaced_paperwork_request_id uuid,
  add column if not exists processor_cancellation_blocking_request_id uuid,
  add column if not exists processor_cancellation_requested_at timestamptz,
  add column if not exists processor_cancellation_confirmed_at timestamptz,
  add column if not exists processor_cancellation_confirmed_by uuid,
  add column if not exists processor_cancellation_confirmation_notes text;
alter table public.paperwork_requests
  add constraint paperwork_requests_sale_return_operation_fk foreign key(sale_return_operation_id) references public.showroom_sale_return_operations(id) on delete set null,
  add constraint paperwork_requests_replaced_request_fk foreign key(replaced_paperwork_request_id) references public.paperwork_requests(id) on delete set null,
  add constraint paperwork_requests_processor_blocker_fk foreign key(processor_cancellation_blocking_request_id) references public.paperwork_requests(id) on delete set null,
  add constraint paperwork_requests_processor_cancellation_user_fk foreign key(processor_cancellation_confirmed_by) references public.tenant_users(id) on delete set null;
alter table public.paperwork_requests drop constraint if exists paperwork_requests_current_stage_check;
do $$ declare v_unknown text; begin
  select string_agg(distinct current_stage,', ') into v_unknown from public.paperwork_requests where current_stage is not null and current_stage not in(
    'preparation','owner_confirmation','sent_to_processor','processor_ready','pending_processor_cancellation','received_from_processor','client_notified','delivered','cancelled');
  if v_unknown is not null then raise exception 'مراحل أوراق غير معروفة تمنع تطبيق migration: %',v_unknown; end if;
end $$;
alter table public.paperwork_requests add constraint paperwork_requests_current_stage_check check(current_stage is null or current_stage in(
  'preparation','owner_confirmation','sent_to_processor','processor_ready','pending_processor_cancellation','received_from_processor','client_notified','delivered','cancelled'));
create index paperwork_requests_pending_processor_cancellation_idx on public.paperwork_requests(tenant_id,processor_partner_id,created_at desc)
  where current_stage='pending_processor_cancellation' and status='open';

alter table public.showroom_sale_return_operations enable row level security;
alter table public.showroom_sale_return_lines enable row level security;
create policy showroom_sale_return_operations_owner_select on public.showroom_sale_return_operations for select to authenticated using(public.is_tenant_owner(tenant_id));
create policy showroom_sale_return_lines_owner_select on public.showroom_sale_return_lines for select to authenticated using(public.is_tenant_owner(tenant_id));
revoke all on public.showroom_sale_return_operations,public.showroom_sale_return_lines from public,anon,authenticated;
grant select on public.showroom_sale_return_operations,public.showroom_sale_return_lines to authenticated;
commit;
