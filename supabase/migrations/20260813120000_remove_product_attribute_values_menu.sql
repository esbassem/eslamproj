-- Attribute values are now managed inside the attributes page.
-- Keep the underlying value records; only retire the duplicate navigation item.
update public.ir_ui_menus
set active = false,
    updated_at = now()
where code = 'products.attribute_values'
   or route_path = '/app/products/attribute-values';
