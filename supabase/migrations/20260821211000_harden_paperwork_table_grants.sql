begin;

revoke all on table public.paperwork_requests from public, anon, authenticated;
revoke all on table public.paperwork_request_events from public, anon, authenticated;
revoke all on table public.paperwork_documents from public, anon, authenticated;
revoke all on table public.paperwork_document_moves from public, anon, authenticated;

grant select on table public.paperwork_requests to authenticated;
grant select on table public.paperwork_request_events to authenticated;
grant select on table public.paperwork_documents to authenticated;
grant select on table public.paperwork_document_moves to authenticated;

notify pgrst, 'reload schema';
commit;
