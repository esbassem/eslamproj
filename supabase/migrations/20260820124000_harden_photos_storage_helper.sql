begin;

alter function public.can_use_photos_storage(text)
  set search_path = pg_catalog, public;
revoke all on function public.can_use_photos_storage(text) from public, anon;
grant execute on function public.can_use_photos_storage(text) to authenticated;

commit;
