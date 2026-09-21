begin;

-- Final safety gate: the retirement is intentionally coupled to the audited
-- production baseline. Any drift aborts before the first destructive statement.
do $$
begin
  if (select count(*) from public.sales) <> 218
     or (select count(*) from public.sale_lines) <> 218
     or (select count(*) from public.sales where is_historical) <> 218
     or (select count(*) from public.sale_historical_sources) <> 218
     or (select count(*) from public.sale_line_historical_sources) <> 218
     or (select count(*) from public.paperwork_requests) <> 205
     or (select count(*) from public.paperwork_requests where sale_id is not null) <> 203
     or (select count(*) from public.paperwork_legacy_sale_sources) <> 2
     or (select count(*) from public.paperwork_documents) <> 59
     or (select count(*) from public.paperwork_documents where sale_id is not null) <> 35
     or (select count(*) from public.account_moves) <> 466
     or (select count(*) from public.account_move_lines) <> 932
     or (select count(*) from public.financial_payments) <> 11
     or (select count(*) from public.account_partial_reconcile) <> 223
     or (select count(*) from public.stock_moves) <> 139
     or (select count(*) from public.inventory_reservations where state = 'active') <> 0
     or (select count(*) from public.crm_leads) <> 1 then
    raise exception 'SHOWROOM_RETIREMENT_BASELINE_DRIFT';
  end if;

  if exists (
    select 1 from public.account_moves move
    join lateral (
      select coalesce(sum(line.debit), 0) debit, coalesce(sum(line.credit), 0) credit
      from public.account_move_lines line where line.move_id = move.id
    ) totals on true
    where totals.debit <> totals.credit
  ) then
    raise exception 'SHOWROOM_RETIREMENT_UNBALANCED_LEDGER';
  end if;

  if (select amount_residual from public.account_move_lines
      where id = '51bcc530-1f84-4054-996b-57e3e51077bf'::uuid) <> 40000 then
    raise exception 'SHOWROOM_RETIREMENT_UNAPPLIED_CREDIT_DRIFT';
  end if;

  if (select count(*) from public.stock_moves where reference_type = 'showroom_sale') <> 63 then
    raise exception 'SHOWROOM_RETIREMENT_INVENTORY_EVIDENCE_DRIFT';
  end if;

  if exists (select 1 from public.stock_moves where original_sale_id is not null)
     or exists (select 1 from public.stock_moves where original_sale_line_id is not null)
     or exists (select 1 from public.stock_moves where sale_return_operation_id is not null)
     or exists (select 1 from public.paperwork_requests where sale_return_operation_id is not null) then
    raise exception 'SHOWROOM_RETIREMENT_EXTERNAL_FK_DATA_REMAINS';
  end if;
end
$$;

-- Lock every legacy write surface in the same transaction that removes it.
lock table public.showroom_configs,
  public.showroom_financial_cutovers,
  public.showroom_sale_cancellation_reconciliations,
  public.showroom_sale_cancellations,
  public.showroom_sale_lines,
  public.showroom_sale_number_sequences,
  public.showroom_sale_return_lines,
  public.showroom_sale_return_operations,
  public.showroom_sales in access exclusive mode;

-- Remove the transitional Showroom capabilities from generic Financial Core
-- functions while preserving ordinary authorization and Canonical Sales paths.
do $$
declare v_definition text; v_rewritten text;
begin
  select pg_get_functiondef(
    'public.can_perform_financial_action(uuid,text,uuid,text,uuid,boolean)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(v_definition,
    E'      or public.is_trusted_showroom_payment_context(\n        p_tenant_id, p_permission_code, p_account_id,\n        p_access_type, p_branch_id\n      )\n', '');
  if v_rewritten = v_definition then
    raise exception 'SHOWROOM_PAYMENT_CAPABILITY_DETACH_NOT_APPLIED';
  end if;
  execute v_rewritten;

  select pg_get_functiondef(
    'public.post_financial_sale_unbound_impl(uuid,text,text,text,integer,text,text,uuid,numeric,text,date,uuid,text)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(v_definition,
    E'  if not public.is_trusted_showroom_sale_posting_context(\n    p_tenant_id, normalized_source_app, normalized_source_model,\n    normalized_source_id, p_event_version\n  ) and not public.is_trusted_sales_confirmation_context(',
    E'  if not public.is_trusted_sales_confirmation_context(');
  if v_rewritten = v_definition then
    raise exception 'SHOWROOM_POSTING_CAPABILITY_DETACH_NOT_APPLIED';
  end if;
  execute v_rewritten;

  select pg_get_functiondef(
    'public.get_financial_sale_posting(uuid,uuid)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(v_definition,
    E'  if not public.is_trusted_showroom_sale_posting_context(\n    posting.tenant_id, posting.source_app, posting.source_model,\n    posting.source_id, posting.event_version\n  ) and not public.is_trusted_sales_confirmation_context(',
    E'  if not public.is_trusted_sales_confirmation_context(');
  if v_rewritten = v_definition then
    raise exception 'SHOWROOM_POSTING_READ_CAPABILITY_DETACH_NOT_APPLIED';
  end if;
  execute v_rewritten;
end
$$;

-- External legacy-only columns are empty by the gate above.
alter table public.paperwork_requests
  drop constraint paperwork_requests_sale_return_operation_fk,
  drop column sale_return_operation_id;
alter table public.stock_moves
  drop constraint stock_moves_original_sale_fk,
  drop constraint stock_moves_original_sale_line_fk,
  drop constraint stock_moves_sale_return_operation_fk,
  drop column original_sale_id,
  drop column original_sale_line_id,
  drop column sale_return_operation_id;

-- Explicit trigger and policy inventory; table drops below do not hide these.
drop trigger trg_assign_showroom_financial_confirmation_generation on public.showroom_sales;
drop trigger trg_assign_showroom_sale_number on public.showroom_sales;
drop trigger trg_showroom_sale_cancellations_set_updated_at on public.showroom_sale_cancellations;
drop trigger showroom_financial_cutovers_immutable on public.showroom_financial_cutovers;
drop trigger showroom_sale_return_operation_sync_reservations on public.showroom_sale_return_operations;

drop policy phase1_tenant_member_all on public.showroom_configs;
drop policy phase1_tenant_member_all on public.showroom_sale_lines;
drop policy phase1_tenant_member_all on public.showroom_sale_number_sequences;
drop policy phase1_tenant_member_all on public.showroom_sales;
drop policy showroom_sale_return_lines_owner_select on public.showroom_sale_return_lines;
drop policy showroom_sale_return_operations_owner_select on public.showroom_sale_return_operations;

-- Public callers first, then private implementations and leaf helpers.
drop function public.cancel_showroom_sale(uuid,uuid,text,text);
drop function public.collect_showroom_sale_payment(uuid,numeric,uuid,text,uuid,text,text);
drop function public.complete_showroom_sale(uuid,numeric,text,jsonb);
drop function public.create_confirmed_showroom_sale_return(uuid,uuid,jsonb,text,text,uuid);
drop function public.delete_pending_showroom_sale(uuid);
drop function public.list_showroom_sale_payment_options(uuid);
drop function public.pay_showroom_sale_accounting(uuid,numeric,text,text);
drop function public.preview_confirmed_showroom_sale_return(uuid,uuid,jsonb);
drop function public.preview_showroom_sale_cancellation(uuid,uuid);
drop function public.settle_showroom_sale_balance(uuid,numeric,text,uuid,text);
drop function public.settle_showroom_sale_balance_to_destination(uuid,numeric,uuid,text);
drop function public.settle_showroom_sale_with_advance_credit(uuid,uuid,numeric,text);
drop function public.settle_showroom_sale_with_open_credits(uuid,uuid,jsonb);
drop function public.complete_showroom_sale_canonical_engine_impl(uuid);
drop function public.complete_showroom_sale_legacy_engine_impl(uuid,numeric,text,jsonb);
drop function public.cancel_showroom_sale_legacy_engine_impl(uuid,uuid,text,text);
drop function public.create_confirmed_showroom_sale_return_legacy_engine_impl(uuid,uuid,jsonb,text,text,uuid);
drop function public.bind_showroom_sale_to_legacy_engine(uuid,uuid,text,uuid);
drop function public.get_showroom_legacy_confirmation_result(uuid,uuid);
drop function public.assert_showroom_sale_not_canonical(uuid,uuid);
drop function public.migrate_old_showroom_sale_payments();
drop function public.migrate_old_showroom_sales_invoice_moves();
drop function public.is_trusted_showroom_payment_context(uuid,text,uuid,text,uuid);
drop function public.is_trusted_showroom_sale_posting_context(uuid,text,text,text,integer);
drop function public.assign_showroom_financial_confirmation_generation();
drop function public.assign_showroom_sale_number();
drop function public.guard_showroom_financial_cutover_marker();
drop function public.sync_showroom_sale_return_line_reservations();

-- Dependent-first explicit table removal. No CASCADE is used.
drop table public.showroom_sale_cancellation_reconciliations;
drop table public.showroom_sale_return_lines;
drop table public.showroom_sale_return_operations;
drop table public.showroom_sale_cancellations;
drop table public.showroom_financial_cutovers;
drop table public.showroom_sale_number_sequences;
drop table public.showroom_sale_lines;
drop table public.showroom_sales;
drop table public.showroom_configs;

-- Remove module-owned metadata in FK-safe order.
delete from public.ir_ui_menu_groups link
where link.menu_id in (select id from public.ir_ui_menus where module_id in
  (select id from public.ir_modules where technical_name = 'showroom_point'))
   or link.group_id in (select id from public.res_groups where module_id in
  (select id from public.ir_modules where technical_name = 'showroom_point'));
delete from public.res_users_groups link where link.group_id in
  (select id from public.res_groups where module_id in
    (select id from public.ir_modules where technical_name = 'showroom_point'));
delete from public.auth_group_permissions link
where link.group_id in (select id from public.res_groups where module_id in
  (select id from public.ir_modules where technical_name = 'showroom_point'))
   or link.permission_id in (select id from public.auth_permissions
     where code = 'showroom_point.access' or module_code = 'showroom_point');
delete from public.ir_model_access access where access.module_id in
  (select id from public.ir_modules where technical_name = 'showroom_point')
  or access.group_id in (select id from public.res_groups where module_id in
    (select id from public.ir_modules where technical_name = 'showroom_point'));
delete from public.ir_ui_menus where module_id in
  (select id from public.ir_modules where technical_name = 'showroom_point');
delete from public.tenant_modules where module_id in
  (select id from public.ir_modules where technical_name = 'showroom_point');
delete from public.ir_module_dependencies where module_id in
  (select id from public.ir_modules where technical_name = 'showroom_point')
  or depends_on_module_id in
  (select id from public.ir_modules where technical_name = 'showroom_point');
delete from public.res_groups where module_id in
  (select id from public.ir_modules where technical_name = 'showroom_point');
delete from public.auth_permissions
where code = 'showroom_point.access' or module_code = 'showroom_point';
delete from public.ir_modules where technical_name = 'showroom_point';

commit;
