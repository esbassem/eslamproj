begin;

alter table public.ir_modules
  add column if not exists description text;

update public.ir_modules
set description = case technical_name
  when 'products' then 'إدارة المنتجات والتصنيفات والخصائص في مساحة عمل منظمة، مع ربط واضح بالمخزون والمبيعات.'
  when 'inventory' then 'متابعة المخزون، الحركات، والأرقام التسلسلية لتبقى الكميات والعمليات اليومية تحت السيطرة.'
  when 'accounting' then 'تنظيم المدفوعات والجورنالات وقواعد التحصيل ضمن تجربة مالية واضحة وقابلة للتوسع.'
  when 'sales' then 'إدارة الفواتير والعقود ومتابعة دورة البيع من إنشاء المستند حتى التحصيل.'
  when 'pos' then 'نقطة بيع سريعة للفرق التشغيلية، مصممة للبيع اليومي وإدارة الجلسات بسلاسة.'
  when 'partners' then 'تنظيم العملاء والموردين والشركاء التجاريين في قاعدة بيانات موحدة.'
  when 'contracts' then 'متابعة العقود وقيمها ومواعيدها وربطها بتدفقات البيع والتحصيل.'
  when 'team' then 'إدارة أعضاء الفريق والصلاحيات التشغيلية داخل مساحة العمل.'
  when 'settings' then 'تهيئة إعدادات الشركة، نقاط البيع، والحسابات من مكان واحد.'
  when 'showroom_point' then 'واجهة بيع للمعارض تجمع العملاء، المنتجات، والفواتير في تجربة تشغيل مباشرة.'
  else description
end
where description is null;

commit;
