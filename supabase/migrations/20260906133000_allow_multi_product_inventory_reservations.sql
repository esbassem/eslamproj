begin;

alter table public.inventory_reservation_lines
  drop constraint inventory_reservation_lines_reservation_tracking_unique,
  add constraint inventory_reservation_lines_reservation_tracking_unique
    unique nulls not distinct (reservation_id, product_id, tracking_unit_id);

commit;
