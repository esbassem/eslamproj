begin;

alter table public.financial_payment_methods
  drop constraint if exists financial_payment_methods_canonical_settlement_mode_check;

alter table public.financial_payment_methods
  add constraint financial_payment_methods_canonical_settlement_mode_check check (
    (method_type in ('cash', 'bank_transfer', 'wallet') and settlement_mode = 'direct')
    or (method_type in ('card', 'other') and settlement_mode in ('direct', 'clearing'))
    or (method_type = 'cheque' and is_active = false)
  );

create or replace function public.validate_financial_payment_method()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.name := btrim(new.name);
  new.semantic_key := lower(btrim(new.semantic_key));
  new.updated_at := now();
  if not exists (
    select 1 from public.financial_payment_method_types definition
    where definition.code = new.method_type and definition.is_active
  ) then
    raise exception using errcode = '23514', message = 'PAYMENT_METHOD_TYPE_INVALID_OR_INACTIVE';
  end if;
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception using errcode = '23514', message = 'PAYMENT_METHOD_TENANT_IMMUTABLE';
    end if;
    if new.semantic_key is distinct from old.semantic_key
       or new.method_type is distinct from old.method_type then
      raise exception using errcode = '23514', message = 'PAYMENT_METHOD_STRUCTURE_IMMUTABLE';
    end if;
    if new.settlement_mode is distinct from old.settlement_mode then
      if not (
        old.method_type in ('card', 'other')
        and old.settlement_mode = 'direct'
        and new.settlement_mode = 'clearing'
        and not exists (
          select 1 from public.financial_payments payment
          where payment.tenant_id = old.tenant_id and payment.payment_method_id = old.id
        )
        and not exists (
          select 1 from public.financial_refunds refund
          where refund.tenant_id = old.tenant_id and refund.payment_method_id = old.id
        )
      ) then
        raise exception using errcode = '23514', message = 'PAYMENT_METHOD_STRUCTURE_IMMUTABLE';
      end if;
    end if;
  end if;
  return new;
end
$$;

comment on function public.validate_financial_payment_method() is
  'Identity and settlement semantics are immutable after financial usage. The existing validated direct-to-clearing configuration path remains available only for unused card/other methods.';

commit;
