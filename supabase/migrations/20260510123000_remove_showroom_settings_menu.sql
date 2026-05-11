begin;

update public.ir_ui_menus
set
  active = false,
  updated_at = now()
where code = 'showroom_point.settings';

commit;
