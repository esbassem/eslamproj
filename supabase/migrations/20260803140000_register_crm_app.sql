begin;

insert into public.ir_modules (technical_name, name, description, icon, icon_color, route_path, application, technical, installable, is_removable, active, sequence)
values ('crm', 'متابعة العملاء المحتملين', 'تسجيل العملاء المحتملين ومتابعتهم وربطهم بموظفي المبيعات وطلبات التقسيط حتى البيع أو الإلغاء.', 'ContactRound', '#2563EB', '/apps/crm', true, false, true, true, true, 65)
on conflict (technical_name) do update set name = excluded.name, description = excluded.description, icon = excluded.icon, icon_color = excluded.icon_color, route_path = excluded.route_path, application = excluded.application, technical = excluded.technical, installable = excluded.installable, is_removable = excluded.is_removable, active = excluded.active, sequence = excluded.sequence, updated_at = now();

with app_module as (select id from public.ir_modules where technical_name = 'crm'), root_menu as (
  insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
  select id, null, 'العملاء المحتملون', 'crm.root', '/apps/crm', 'ContactRound', 10, true from app_module
  where not exists (select 1 from public.ir_ui_menus m where m.module_id = app_module.id and m.code = 'crm.root') returning id, module_id
), resolved_root as (
  select id, module_id from root_menu union all select m.id, m.module_id from public.ir_ui_menus m join app_module a on a.id = m.module_id where m.code = 'crm.root' limit 1
)
insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
select r.module_id, r.id, v.name, v.code, v.route_path, v.icon, v.sequence, true from (values
 ('الرئيسية', 'crm.home', '/apps/crm', 'LayoutDashboard', 10),
 ('العملاء المحتملون', 'crm.leads', '/apps/crm/leads', 'ContactRound', 20),
 ('متابعات اليوم', 'crm.followups', '/apps/crm/followups', 'CalendarClock', 30),
 ('طلبات التقسيط', 'crm.installments', '/apps/crm/installments', 'WalletCards', 40),
 ('الإعدادات', 'crm.settings', '/apps/crm/settings', 'Settings', 50)
) as v(name, code, route_path, icon, sequence) cross join resolved_root r
where not exists (select 1 from public.ir_ui_menus m where m.module_id = r.module_id and m.code = v.code);

commit;
