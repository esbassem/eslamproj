begin;

-- Identity: authenticated callers may create their onboarding row and update
-- profile fields only. Security fields remain service-role/owner-RPC concerns.
revoke all privileges on table public.tenant_users from anon, authenticated;
grant select, insert on table public.tenant_users to authenticated;
grant update (full_name, phone, email) on table public.tenant_users to authenticated;

-- Authorization catalog is immutable to browser clients.
revoke all privileges on table public.auth_permissions from anon, authenticated;
revoke all privileges on table public.auth_group_permissions from anon, authenticated;
revoke all privileges on table public.res_groups from anon, authenticated;
revoke all privileges on table public.ir_model_access from anon, authenticated;
revoke all privileges on table public.ir_modules from anon, authenticated;
revoke all privileges on table public.ir_module_dependencies from anon, authenticated;
revoke all privileges on table public.ir_ui_menus from anon, authenticated;
revoke all privileges on table public.ir_ui_menu_groups from anon, authenticated;

grant select on table public.auth_permissions, public.auth_group_permissions,
  public.res_groups, public.ir_model_access, public.ir_modules,
  public.ir_module_dependencies, public.ir_ui_menus, public.ir_ui_menu_groups
to authenticated;

-- These are the only two browser-managed authorization surfaces retained for
-- backwards compatibility, both protected by owner-only RLS writes.
revoke all privileges on table public.res_users_groups from anon, authenticated;
grant select, insert, delete on table public.res_users_groups to authenticated;

revoke all privileges on table public.tenant_modules from anon, authenticated;
grant select, insert, update, delete on table public.tenant_modules to authenticated;

commit;
