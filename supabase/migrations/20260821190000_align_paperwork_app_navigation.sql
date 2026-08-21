begin;

with paperwork_app as (
  select id
  from public.ir_modules
  where technical_name = 'paperwork'
  limit 1
)
update public.ir_ui_menus menu
set parent_id = null,
    name = item.name,
    route_path = item.route_path,
    icon = item.icon,
    sequence = item.sequence,
    active = true,
    updated_at = now()
from paperwork_app app
join (values
  ('paperwork.root', 'الرئيسية', '/apps/paperwork', 'Home', 10),
  ('paperwork.requests', 'الطلبات', '/apps/paperwork/requests', 'ClipboardList', 20),
  ('paperwork.vault', 'الخزنة', '/apps/paperwork/vault', 'Archive', 40),
  ('paperwork.documents', 'المستندات', '/apps/paperwork/documents', 'Files', 50)
) item(code, name, route_path, icon, sequence) on true
where menu.module_id = app.id
  and menu.code = item.code;

insert into public.ir_ui_menus (
  module_id, parent_id, name, code, route_path, icon, sequence, active
)
select app.id, null, 'عند الجهات', 'paperwork.processors',
       '/apps/paperwork/processors', 'Building2', 30, true
from public.ir_modules app
where app.technical_name = 'paperwork'
  and not exists (
    select 1
    from public.ir_ui_menus menu
    where menu.module_id = app.id
      and menu.code = 'paperwork.processors'
  );

update public.ir_ui_menus menu
set parent_id = null,
    name = 'عند الجهات',
    route_path = '/apps/paperwork/processors',
    icon = 'Building2',
    sequence = 30,
    active = true,
    updated_at = now()
from public.ir_modules app
where app.technical_name = 'paperwork'
  and menu.module_id = app.id
  and menu.code = 'paperwork.processors';

commit;
