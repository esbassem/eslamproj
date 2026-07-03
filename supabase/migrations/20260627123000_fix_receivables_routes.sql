begin;

update public.ir_modules
set
  route_path = '/app/receivables',
  icon_color = '#1558A6',
  updated_at = now()
where technical_name = 'receivables';

update public.ir_ui_menus
set
  route_path = '/app/receivables',
  updated_at = now()
where code = 'receivables.all';

update public.ir_ui_menus
set
  route_path = '/app/receivables/installments',
  updated_at = now()
where code = 'receivables.installments';

commit;
