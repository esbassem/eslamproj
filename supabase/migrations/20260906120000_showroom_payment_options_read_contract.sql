begin;

create or replace function public.list_showroom_sale_payment_options(
  p_sale_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  sale public.showroom_sales%rowtype;
  actor public.tenant_users%rowtype;
  posting public.financial_sale_postings%rowtype;
  receivable public.account_move_lines%rowtype;
  effective_branch_id uuid;
  method record;
  destination record;
  configuration record;
  context_data jsonb;
  capability text;
  destinations jsonb;
  methods jsonb := '[]'::jsonb;
  method_allowed boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if p_sale_id is null then
    raise exception using errcode = '22023', message = 'SHOWROOM_SALE_ID_REQUIRED';
  end if;

  select item.* into sale
  from public.showroom_sales item
  where item.id = p_sale_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'SHOWROOM_SALE_NOT_FOUND';
  end if;

  select member.* into actor
  from public.tenant_users member
  where member.tenant_id = sale.tenant_id
    and member.auth_user_id = auth.uid()
    and member.is_active
  order by member.created_at, member.id
  limit 1;
  if not found or public.current_tenant_id() is distinct from sale.tenant_id then
    raise exception using errcode = '42501', message = 'ACTIVE_TENANT_MEMBERSHIP_REQUIRED';
  end if;
  if not public.has_permission('showroom_point.access', sale.tenant_id) then
    raise exception using errcode = '42501', message = 'SHOWROOM_PAYMENT_PERMISSION_REQUIRED';
  end if;

  select coalesce(sale.branch_id, config.branch_id)
  into effective_branch_id
  from public.showroom_configs config
  where config.id = sale.showroom_config_id
    and config.tenant_id = sale.tenant_id
    and config.is_active;
  if not found then
    raise exception using errcode = '23514', message = 'SHOWROOM_CONFIG_INVALID_OR_INACTIVE';
  end if;
  if effective_branch_id is not null and not public.has_branch_access(effective_branch_id) then
    raise exception using errcode = '42501', message = 'SHOWROOM_BRANCH_ACCESS_REQUIRED';
  end if;
  if sale.status <> 'confirmed' then
    raise exception using errcode = '23514', message = 'SHOWROOM_CANONICAL_PAYMENT_REQUIRES_CONFIRMED_SALE';
  end if;
  if sale.financial_confirmation_generation <= 1 or not exists (
    select 1 from public.showroom_financial_cutovers marker
    where marker.tenant_id = sale.tenant_id
      and marker.source_app = 'showroom'
      and marker.source_model = 'sale'
      and marker.canonical_generation = sale.financial_confirmation_generation
  ) then
    raise exception using errcode = '23514', message = 'SHOWROOM_SALE_NOT_CANONICAL_GENERATION';
  end if;

  select canonical_posting.* into posting
  from public.financial_engine_bindings binding
  join public.financial_sale_postings canonical_posting
    on canonical_posting.id = binding.canonical_sale_posting_id
   and canonical_posting.tenant_id = binding.tenant_id
  where binding.tenant_id = sale.tenant_id
    and binding.source_app = 'showroom'
    and binding.source_model = 'sale'
    and binding.source_id = sale.id::text
    and binding.financial_event_version = 1
    and binding.financial_engine = 'canonical'
    and binding.state = 'posted'
    and canonical_posting.state = 'posted'
    and canonical_posting.source_app = binding.source_app
    and canonical_posting.source_model = binding.source_model
    and canonical_posting.source_id = binding.source_id
    and canonical_posting.event_version = binding.financial_event_version;
  if not found
     or posting.partner_id is distinct from sale.customer_id
     or posting.branch_id is distinct from effective_branch_id
     or posting.account_move_id is distinct from sale.account_move_id
  then
    raise exception using errcode = '23514', message = 'SHOWROOM_CANONICAL_SALE_POSTING_INVALID';
  end if;

  select line.* into receivable
  from public.account_move_lines line
  where line.id = posting.receivable_line_id
    and line.tenant_id = posting.tenant_id;
  if not found
     or receivable.move_id is distinct from posting.account_move_id
     or receivable.partner_id is distinct from sale.customer_id
     or receivable.parent_state <> 'posted'
     or receivable.line_type <> 'open_item'
     or receivable.debit <= 0 or receivable.credit <> 0
     or not public.account_matches_functional_role(
       sale.tenant_id, receivable.account_id,
       'customer_receivable', effective_branch_id
     )
  then
    raise exception using errcode = '23514', message = 'SHOWROOM_CANONICAL_RECEIVABLE_INVALID';
  end if;
  if receivable.amount_residual <= 0 then
    raise exception using errcode = '23514', message = 'SHOWROOM_SALE_ALREADY_PAID';
  end if;

  for method in
    select item.id, item.name, item.semantic_key, item.method_type,
      item.settlement_mode, item.requires_reference
    from public.financial_payment_methods item
    where item.tenant_id = sale.tenant_id
      and item.is_active
      and public.is_financial_payment_method_usable(sale.tenant_id, item.id)
    order by item.name, item.id
  loop
    destinations := '[]'::jsonb;
    method_allowed := false;

    if method.settlement_mode = 'direct' then
      for destination in
        select item.id, item.name, item.destination_type
        from public.money_destinations item
        where item.tenant_id = sale.tenant_id
          and item.status = 'active'
          and (effective_branch_id is null or item.branch_id is null
            or item.branch_id = effective_branch_id)
        order by item.name, item.id
      loop
        context_data := jsonb_build_object(
          'tenant_id', sale.tenant_id,
          'sale_id', sale.id,
          'payment_method_id', method.id,
          'money_destination_id', destination.id,
          'branch_id', effective_branch_id,
          'actor_auth_id', auth.uid(),
          'amount', 1,
          'idempotency_key', 'showroom-payment-options'
        );
        capability := encode(extensions.digest(context_data::text, 'sha256'), 'hex');
        perform set_config('app.showroom_canonical_payment_context', context_data::text, true);
        perform set_config('app.showroom_canonical_payment', capability, true);

        if exists (
          select 1 from public.list_allowed_payment_destinations(
            sale.tenant_id, method.id,
            'financial.payment.create', 'initiate', effective_branch_id
          ) allowed where allowed.destination_id = destination.id
        ) and exists (
          select 1 from public.list_allowed_payment_destinations(
            sale.tenant_id, method.id,
            'financial.payment.submit', 'initiate', effective_branch_id
          ) allowed where allowed.destination_id = destination.id
        ) and exists (
          select 1 from public.list_allowed_payment_destinations(
            sale.tenant_id, method.id,
            'financial.payment.confirm', 'confirm', effective_branch_id
          ) allowed where allowed.destination_id = destination.id
        ) and exists (
          select 1 from public.list_allowed_payment_destinations(
            sale.tenant_id, method.id,
            'financial.payment.post', 'confirm', effective_branch_id
          ) allowed where allowed.destination_id = destination.id
        ) then
          destinations := destinations || jsonb_build_array(jsonb_build_object(
            'id', destination.id,
            'name', destination.name,
            'type', destination.destination_type
          ));
        end if;

        perform set_config('app.showroom_canonical_payment', '', true);
        perform set_config('app.showroom_canonical_payment_context', '', true);
      end loop;
      method_allowed := jsonb_array_length(destinations) > 0;
    elsif method.settlement_mode = 'clearing' then
      for configuration in
        select item.clearing_account_id
        from public.financial_payment_method_settlement_configs item
        join public.account_accounts account
          on account.id = item.clearing_account_id
         and account.tenant_id = item.tenant_id
         and account.active and account.is_posting and account.open_item_reconcile
        join public.account_journals journal
          on journal.id = item.clearing_journal_id
         and journal.tenant_id = item.tenant_id
         and journal.is_active
         and journal.default_account_id = account.id
        where item.tenant_id = sale.tenant_id
          and item.payment_method_id = method.id
          and item.is_active
          and (item.branch_id is null
            or item.branch_id is not distinct from effective_branch_id)
      loop
        context_data := jsonb_build_object(
          'tenant_id', sale.tenant_id,
          'sale_id', sale.id,
          'payment_method_id', method.id,
          'money_destination_id', null,
          'branch_id', effective_branch_id,
          'actor_auth_id', auth.uid(),
          'amount', 1,
          'idempotency_key', 'showroom-payment-options'
        );
        capability := encode(extensions.digest(context_data::text, 'sha256'), 'hex');
        perform set_config('app.showroom_canonical_payment_context', context_data::text, true);
        perform set_config('app.showroom_canonical_payment', capability, true);

        method_allowed := public.is_trusted_showroom_payment_context(
          sale.tenant_id, 'financial.payment.confirm',
          configuration.clearing_account_id, 'reconcile', effective_branch_id
        ) and public.is_trusted_showroom_payment_context(
          sale.tenant_id, 'financial.payment.post',
          configuration.clearing_account_id, 'reconcile', effective_branch_id
        );

        perform set_config('app.showroom_canonical_payment', '', true);
        perform set_config('app.showroom_canonical_payment_context', '', true);
        exit when method_allowed;
      end loop;
    end if;

    if method_allowed then
      methods := methods || jsonb_build_array(jsonb_build_object(
        'id', method.id,
        'name', method.name,
        'code', method.semantic_key,
        'type', method.method_type,
        'requires_reference', method.requires_reference,
        'requires_money_destination', method.settlement_mode = 'direct',
        'money_destinations', destinations
      ));
    end if;
  end loop;

  perform set_config('app.showroom_canonical_payment', '', true);
  perform set_config('app.showroom_canonical_payment_context', '', true);
  return jsonb_build_object(
    'sale_id', sale.id,
    'payment_methods', methods
  );
exception when others then
  perform set_config('app.showroom_canonical_payment', '', true);
  perform set_config('app.showroom_canonical_payment_context', '', true);
  raise;
end
$$;

revoke all on function public.list_showroom_sale_payment_options(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_showroom_sale_payment_options(uuid)
to authenticated;

comment on function public.list_showroom_sale_payment_options(uuid) is
  'Sale-bound, business-safe Showroom payment option reader. It requires active membership, Showroom access and branch scope, and reuses the Canonical payment destination authorization gates without granting general financial permissions or exposing accounting identifiers.';

commit;
