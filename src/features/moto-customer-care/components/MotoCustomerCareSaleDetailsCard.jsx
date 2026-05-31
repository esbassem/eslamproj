import { Card, CardContent, CardHeader, CardTitle } from '@/core/ui/card';
import { MotoCustomerCareStatusBadge } from '@/features/moto-customer-care/components/MotoCustomerCareStatusBadge';

function formatDate(value) {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'full', timeStyle: 'short' }).format(date);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('ar-EG', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function DetailItem({ label, value, valueClassName = '' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-sm font-semibold text-slate-900 ${valueClassName}`}>{value || '--'}</p>
    </div>
  );
}

export function MotoCustomerCareSaleDetailsCard({ sale }) {
  return (
    <div className="space-y-5">
      <Card className="shadow-none motion-safe:hover:translate-y-0">
        <CardHeader className="gap-4 border-b border-slate-100">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">عملية متابعة</p>
              <CardTitle className="mt-2 text-3xl font-black text-slate-950">{sale.customer?.name || 'عميل غير محدد'}</CardTitle>
            </div>
            <MotoCustomerCareStatusBadge status={sale.status} />
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2 xl:grid-cols-4">
          <DetailItem label="العميل" value={sale.customer?.name || 'عميل غير محدد'} />
          <DetailItem label="الهاتف" value={sale.customer?.phone || '--'} />
          <DetailItem label="تاريخ البيع" value={formatDate(sale.saleDate || sale.createdAt)} />
          <DetailItem label="آخر تحديث" value={formatDate(sale.updatedAt || sale.createdAt)} />
          <DetailItem label="إجمالي العملية" value={formatMoney(sale.totalAmount)} />
          <DetailItem label="المدفوع" value={formatMoney(sale.paidAmount)} valueClassName="text-emerald-700" />
          <DetailItem label="المتبقي" value={formatMoney(sale.remainingAmount)} valueClassName="text-red-700" />
          <DetailItem label="رقم الحركة المحاسبية" value={sale.accountMoveId || '--'} />
        </CardContent>
      </Card>

      <Card className="shadow-none motion-safe:hover:translate-y-0">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-slate-900">بيانات العميل</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailItem label="الاسم" value={sale.customer?.name || '--'} />
          <DetailItem label="الهاتف الأساسي" value={sale.customer?.phone1 || sale.customer?.phone || '--'} />
          <DetailItem label="الهاتف الاحتياطي" value={sale.customer?.phone2 || '--'} />
          <DetailItem label="العنوان" value={sale.customer?.address || '--'} />
          <DetailItem label="الرقم القومي" value={sale.customer?.nationalId || '--'} />
          <DetailItem label="الملاحظات" value={sale.notes || 'لا توجد ملاحظات مسجلة.'} />
        </CardContent>
      </Card>
    </div>
  );
}
