begin;

-- Keep confirmed commercial facts immutable while leaving the explicitly
-- command-gated confirmed -> cancelled transition available to a future phase.
create or replace function public.guard_canonical_sale_header()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if current_user in ('postgres', 'supabase_admin')
       and current_setting('app.canonical_sales_maintenance', true) = 'authorized' then
      return old;
    end if;
    raise exception using errcode = '42501', message = 'CANONICAL_SALE_DELETE_FORBIDDEN';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.sale_number is not null or new.version <> 1
       or new.confirmed_by is not null or new.confirmed_at is not null
       or new.cancelled_by is not null or new.cancelled_at is not null then
      raise exception using errcode = '23514', message = 'CANONICAL_SALE_INITIAL_STATE_INVALID';
    end if;
    return new;
  end if;
  if old.sale_number is not null and new.sale_number is distinct from old.sale_number then
    raise exception using errcode = '23514', message = 'CANONICAL_SALE_NUMBER_IMMUTABLE';
  end if;
  if old.status = 'cancelled' and new is distinct from old then
    raise exception using errcode = '23514', message = 'CANONICAL_SALE_COMMERCIAL_STATE_IMMUTABLE';
  end if;
  if old.status = 'confirmed' and (
    new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.branch_id is distinct from old.branch_id
    or new.customer_id is distinct from old.customer_id
    or new.sale_number is distinct from old.sale_number
    or new.effective_sale_date is distinct from old.effective_sale_date
    or new.currency_code is distinct from old.currency_code
    or new.total_amount is distinct from old.total_amount
    or new.notes is distinct from old.notes
    or new.create_idempotency_key is distinct from old.create_idempotency_key
    or new.create_request_fingerprint is distinct from old.create_request_fingerprint
    or new.created_by is distinct from old.created_by
    or new.confirmed_by is distinct from old.confirmed_by
    or new.confirmed_at is distinct from old.confirmed_at
    or new.created_at is distinct from old.created_at
    or new.status not in ('confirmed', 'cancelled')
    or (
      new.status = 'confirmed'
      and (
        new.cancelled_by is distinct from old.cancelled_by
        or new.cancelled_at is distinct from old.cancelled_at
      )
    )
  ) then
    raise exception using errcode = '23514', message = 'CANONICAL_SALE_COMMERCIAL_STATE_IMMUTABLE';
  end if;
  if new.status is distinct from old.status then
    if current_setting('app.canonical_sales_transition', true) is distinct from old.id::text
       or not (
         (old.status = 'draft' and new.status in ('confirmed', 'cancelled'))
         or (old.status = 'confirmed' and new.status = 'cancelled')
       ) then
      raise exception using errcode = '42501', message = 'CANONICAL_SALE_STATUS_COMMAND_REQUIRED';
    end if;
    if new.version <> old.version + 1 then
      raise exception using errcode = '23514', message = 'CANONICAL_SALE_TRANSITION_VERSION_INVALID';
    end if;
    if new.status = 'confirmed' and (
      new.sale_number is null or new.confirmed_by is null or new.confirmed_at is null
      or new.cancelled_by is not null or new.cancelled_at is not null
    ) then
      raise exception using errcode = '23514', message = 'CANONICAL_SALE_CONFIRMATION_FIELDS_REQUIRED';
    end if;
    if new.status = 'cancelled' and (new.cancelled_by is null or new.cancelled_at is null) then
      raise exception using errcode = '23514', message = 'CANONICAL_SALE_CANCELLATION_FIELDS_REQUIRED';
    end if;
  elsif old.status = 'draft' and new.sale_number is not null then
    raise exception using errcode = '23514', message = 'DRAFT_SALE_NUMBER_FORBIDDEN';
  end if;
  return new;
end
$$;

commit;
