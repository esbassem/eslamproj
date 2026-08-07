-- Read-only preflight. Run on a local/test database only.
select tenant_id,code,count(*) as duplicate_count from public.account_accounts
where active and code in('114001','411000') group by tenant_id,code having count(*)<>1;

select current_stage,count(*) from public.paperwork_requests group by current_stage order by current_stage;

select tenant_id,sale_line_id,tracking_unit_id,count(*) as active_requests
from public.paperwork_requests where status<>'cancelled'
group by tenant_id,sale_line_id,tracking_unit_id having count(*)>1;

select tenant_id,id,sale_id,quantity,unit_price,total from public.showroom_sale_lines
where quantity is null or quantity<=0 or unit_price is null or unit_price<0 or total is null or total<0;

select s.tenant_id,s.id as sale_id,s.account_move_id
from public.showroom_sales s
left join public.account_move_lines l on l.tenant_id=s.tenant_id and l.move_id=s.account_move_id and l.debit>0
left join public.account_accounts a on a.id=l.account_id and a.tenant_id=l.tenant_id and a.code='114001'
where s.status='confirmed' group by s.tenant_id,s.id,s.account_move_id having count(a.id)<>1;

select l.tenant_id,l.id as sale_line_id,l.product_product_id
from public.showroom_sale_lines l
join public.product_products p on p.id=l.product_product_id and p.tenant_id=l.tenant_id
join public.product_templates t on t.id=p.product_template_id and t.tenant_id=p.tenant_id
left join public.stock_quants q on q.tenant_id=l.tenant_id and q.product_product_id=l.product_product_id
where t.product_type<>'service' and p.tracking<>'serial' and q.id is null;

select u.tenant_id,u.id,u.status,u.product_product_id,count(l.id) as confirmed_sale_lines
from public.stock_tracking_units u
left join public.showroom_sale_lines l on l.tenant_id=u.tenant_id and l.tracking_unit_id=u.id
left join public.showroom_sales s on s.id=l.sale_id and s.tenant_id=l.tenant_id and s.status='confirmed'
group by u.tenant_id,u.id,u.status,u.product_product_id
having (u.status='sold' and count(s.id)=0) or (u.status='in_stock' and count(s.id)>0);

select sl.tenant_id,sl.sale_id,sl.id as sale_line_id,sl.tracking_unit_id
from public.showroom_sale_lines sl
left join public.stock_moves sm on sm.tenant_id=sl.tenant_id and sm.reference_type='showroom_sale'
  and sm.reference_id=sl.sale_id and sm.product_product_id=sl.product_product_id and sm.move_type='out'
where sm.id is null;
