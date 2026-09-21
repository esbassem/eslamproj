begin;

create or replace function public.guard_active_money_destination_dependencies()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_table_name = 'account_accounts' then
    if exists (
      select 1 from public.money_destinations d
      where d.ledger_account_id = old.id and d.tenant_id = old.tenant_id
        and d.activated_at is not null
    ) and (
      not new.active or not new.is_posting
      or new.account_origin <> 'resource'
      or new.canonical_account_type is distinct from old.canonical_account_type
      or new.reporting_category is distinct from old.reporting_category
      or new.normal_balance is distinct from old.normal_balance
      or new.open_item_reconcile is distinct from old.open_item_reconcile
    ) then
      raise exception using errcode = '23514', message = 'ACTIVATED_MONEY_DESTINATION_ACCOUNT_CONFIGURATION_IMMUTABLE';
    end if;
  end if;
  if tg_table_name = 'account_journals' then
    if exists (
      select 1 from public.money_destinations d
      where d.journal_id = old.id and d.tenant_id = old.tenant_id
        and d.activated_at is not null
    ) and (
      not new.is_active or new.type is distinct from old.type
      or new.default_account_id is distinct from old.default_account_id
      or new.branch_id is distinct from old.branch_id
    ) then
      raise exception using errcode = '23514', message = 'ACTIVATED_MONEY_DESTINATION_JOURNAL_CONFIGURATION_IMMUTABLE';
    end if;
  end if;
  return new;
end
$$;

commit;
