begin;

alter table public.account_move_lines
  add column if not exists source_entity_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.account_move_lines'::regclass
      and conname = 'account_move_lines_source_entity_tenant_fkey'
  ) then
    alter table public.account_move_lines
      add constraint account_move_lines_source_entity_tenant_fkey
      foreign key (source_entity_id, tenant_id)
      references public.partners (id, tenant_id)
      on update cascade
      on delete restrict;
  end if;
end;
$$;

create index if not exists idx_account_move_lines_source_entity_tenant
  on public.account_move_lines (source_entity_id, tenant_id);

create index if not exists idx_account_move_lines_open_entity_credits
  on public.account_move_lines (
    tenant_id,
    account_id,
    partner_id,
    source_entity_id,
    created_at
  )
  where source_entity_id is not null
    and credit > 0;

comment on column public.account_move_lines.source_entity_id is
  'Explicit source payment entity for customer open-credit journal items; tenant isolation is enforced by a composite foreign key.';

commit;
