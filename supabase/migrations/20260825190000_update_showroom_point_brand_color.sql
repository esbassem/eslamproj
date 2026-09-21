begin;

update public.ir_modules
set
  icon_color = '#E11D48',
  updated_at = now()
where technical_name = 'showroom_point';

commit;
