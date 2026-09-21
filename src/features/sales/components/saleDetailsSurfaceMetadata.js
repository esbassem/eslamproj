const createdAtFormatter = new Intl.DateTimeFormat('ar-EG', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatCreatedAt(value) {
  if (!value) return 'غير متاح';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'غير متاح' : createdAtFormatter.format(date);
}

export function createSaleDetailsSurfaceMetadata(sale) {
  const saleNumber = String(sale?.saleNumber || '').trim();
  const creatorName = String(sale?.createdBy?.name || '').trim() || 'غير محدد';

  return {
    title: saleNumber ? `فاتورة بيع رقم ${saleNumber}` : 'فاتورة بيع — مسودة',
    description: `تاريخ الإنشاء: ${formatCreatedAt(sale?.createdAt)} · أنشأها: ${creatorName}`,
  };
}
