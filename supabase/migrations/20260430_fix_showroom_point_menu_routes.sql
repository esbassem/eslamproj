-- Fix showroom_point menu routes to use proper /app/showroom_point/ prefix
-- The original routes used /showroom-point which is not handled by the AppRouter

UPDATE public.ir_ui_menus
SET route_path = '/app/showroom_point',
    updated_at = now()
WHERE code = 'showroom_point.list';

UPDATE public.ir_ui_menus
SET route_path = '/app/showroom_point/new',
    updated_at = now()
WHERE code = 'showroom_point.create';

UPDATE public.ir_ui_menus
SET route_path = '/app/showroom_point/customers',
    updated_at = now()
WHERE code = 'showroom_point.customers';

UPDATE public.ir_ui_menus
SET route_path = '/app/showroom_point/settings',
    updated_at = now()
WHERE code = 'showroom_point.settings';
