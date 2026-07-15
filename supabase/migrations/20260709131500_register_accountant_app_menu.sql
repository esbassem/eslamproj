insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
select module.id, null, 'المحاسب', 'accountant_app.root', '/apps/accountant', 'Receipt', 10, true
from public.ir_modules module
where module.technical_name = 'accountant_app'
  and not exists (
    select 1
    from public.ir_ui_menus menu
    where menu.module_id = module.id
      and menu.code = 'accountant_app.root'
  );

insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
select module.id, parent.id, 'التحصيلات والتوريدات', 'accountant_app.payments', '/apps/accountant/payments', 'Receipt', 10, true
from public.ir_modules module
join public.ir_ui_menus parent
  on parent.module_id = module.id
  and parent.code = 'accountant_app.root'
where module.technical_name = 'accountant_app'
  and not exists (
    select 1
    from public.ir_ui_menus menu
    where menu.module_id = module.id
      and menu.code = 'accountant_app.payments'
  );
