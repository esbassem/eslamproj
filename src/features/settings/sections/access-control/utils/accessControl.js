export const memberName = (member) => member?.fullName || member?.email || member?.phone || 'مستخدم بدون اسم';

export function friendlyAccessError(error, fallback = 'تعذر حفظ التغيير.') {
  if (/[؀-ۿ]/.test(error?.message || '')) return error.message;
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  if (text.includes('foreign key') || text.includes('23503')) return 'لا يمكن تنفيذ التغيير لوجود عناصر مرتبطة به. أزل العناصر التابعة أو غيّر الإعداد الافتراضي أولًا.';
  if (text.includes('duplicate') || text.includes('23505')) return 'هذا الاختيار محفوظ بالفعل.';
  if (text.includes('row-level') || text.includes('42501') || text.includes('permission')) return 'ليس لديك إذن لإدارة وصول هذا المستخدم.';
  if (text.includes('default') || text.includes('p0001') || text.includes('check')) return 'الإعدادات الافتراضية غير متوافقة مع العناصر المسموحة للمستخدم.';
  return fallback;
}

export function validateDefaults(defaults, details) {
  const branches = new Set(details.branchAccess.map((x) => x.branchId));
  const poses = new Map(details.posAccess.map((x) => [x.posId, x.branchId]));
  const stocks = new Map(details.stockAccess.map((x) => [x.stockLocationId, x.branchId]));
  if (defaults.defaultBranchId && !branches.has(defaults.defaultBranchId)) return 'الفرع الافتراضي يجب أن يكون ضمن الفروع المسموحة.';
  if (defaults.defaultPosId && (!poses.has(defaults.defaultPosId) || poses.get(defaults.defaultPosId) !== defaults.defaultBranchId)) return 'نقطة البيع الافتراضية يجب أن تكون مسموحة وداخل الفرع الافتراضي.';
  if (defaults.defaultStockLocationId && (!stocks.has(defaults.defaultStockLocationId) || stocks.get(defaults.defaultStockLocationId) !== defaults.defaultBranchId)) return 'موقع المخزون الافتراضي يجب أن يكون مسموحًا وداخل الفرع الافتراضي.';
  return '';
}
