alter table if exists paperwork_document_moves
  add column if not exists move_direction text,
  add column if not exists source_type text;

update paperwork_document_moves
set
  move_direction = coalesce(
    move_direction,
    case
      when move_type in ('deliver', 'deliver_to_customer', 'lost') then 'out'
      else 'in'
    end
  ),
  source_type = coalesce(
    source_type,
    case move_type
      when 'opening' then 'opening_custody'
      when 'receive' then 'manual'
      when 'return' then 'from_customer'
      when 'deliver' then 'to_processor'
      when 'deliver_to_customer' then 'to_customer'
      when 'lost' then 'lost'
      when 'manual_adjustment' then 'manual'
      when 'manual' then 'manual'
      else 'other'
    end
  )
where move_direction is null
   or source_type is null;

alter table if exists paperwork_document_moves
  alter column move_direction set default 'in',
  alter column source_type set default 'manual',
  alter column move_direction set not null,
  alter column source_type set not null;

alter table if exists paperwork_document_moves
  drop constraint if exists paperwork_document_moves_direction_check,
  add constraint paperwork_document_moves_direction_check
    check (move_direction in ('in', 'out'));

alter table if exists paperwork_document_moves
  drop constraint if exists paperwork_document_moves_source_type_check,
  add constraint paperwork_document_moves_source_type_check
    check (
      source_type in (
        'opening_custody',
        'from_customer',
        'from_supplier',
        'from_processor',
        'purchase',
        'manual',
        'to_customer',
        'to_supplier',
        'to_processor',
        'lost',
        'cancelled',
        'other'
      )
    );

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paperwork_document_moves'
      and column_name = 'move_type'
  ) then
    alter table paperwork_document_moves
      alter column move_type drop not null;

    alter table paperwork_document_moves
      drop constraint if exists paperwork_document_moves_type_check;
  end if;
end $$;
