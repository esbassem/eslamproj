begin;

-- Supabase's default privileges grant service_role access to newly created
-- objects. Sale Posting is an authenticated-user contract; its internal move
-- primitive and provenance table must not expose a service-role bypass.
revoke all on table public.financial_sale_postings
  from public, anon, authenticated, service_role;
grant select on table public.financial_sale_postings to authenticated;

revoke all on function public.financial_sale_posting_request_fingerprint(
  uuid, text, text, text, integer, text, uuid, numeric, text, date, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.guard_financial_sale_posting()
  from public, anon, authenticated, service_role;
revoke all on function public.create_financial_sale_posting_move(
  uuid, uuid, uuid, numeric, text, date, uuid, text, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.get_financial_sale_posting(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.get_financial_sale_posting(uuid, uuid)
  to authenticated;
grant execute on function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) to authenticated;

commit;
