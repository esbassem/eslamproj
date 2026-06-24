alter table public.paperwork_requests
  add column if not exists document_owner_name text,
  add column if not exists document_owner_national_id text,
  add column if not exists document_owner_status text,
  add column if not exists document_owner_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'paperwork_requests_document_owner_status_check'
      and conrelid = 'public.paperwork_requests'::regclass
  ) then
    alter table public.paperwork_requests
      add constraint paperwork_requests_document_owner_status_check
      check (
        document_owner_status is null
        or document_owner_status in ('confirmed', 'later')
      );
  end if;
end;
$$;
