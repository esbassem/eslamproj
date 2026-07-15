begin;

alter table public.partners
  add column if not exists display_config jsonb null;

commit;
