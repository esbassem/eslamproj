import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDismissButton,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';

const PRODUCT_TYPES = {
  goods: 'سلعة',
  service: 'خدمة',
  consumable: 'مستهلك',
};

const TRACKING_TYPES = {
  none: 'بدون تتبع',
  serial: 'Serial / IMEI',
  lot: 'Lot / دفعات',
};

function formatMoney(value) {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function yesNo(value) {
  return value ? 'نعم' : 'لا';
}

function getOperationalState(product) {
  if (product.productType === 'service') {
    return {
      label: 'خدمة / بدون مخزون',
      description: 'هذا المنتج لا يظهر كمخزون فعلي ولا يعتمد على stock_quants أو stock_tracking_units.',
      className: 'border-amber-200 bg-amber-50 text-amber-800',
    };
  }

  if (product.productType === 'consumable') {
    return {
      label: 'مستهلك / مخزون كمي',
      description: 'في المرحلة الحالية يعامل مثل منتج عادي بدون تتبع خاص ويعتمد على stock_quants.',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    };
  }

  if (product.tracking === 'serial') {
    return {
      label: 'منتج بسيريال / يحتاج IMEI',
      description: 'يعتمد عند البيع على الوحدات المتاحة في stock_tracking_units.',
      className: 'border-teal-200 bg-teal-50 text-teal-800',
    };
  }

  if (product.tracking === 'lot') {
    return {
      label: 'منتج بدفعات / دعم لاحق',
      description: 'قيمة التتبع محفوظة على المنتج، لكن مخزون الدفعات غير مفعل بالكامل في التدفقات الحالية.',
      className: 'border-amber-200 bg-amber-50 text-amber-800',
    };
  }

  return {
    label: 'منتج عادي / مخزون كمي',
    description: 'يعتمد على quantity_on_hand داخل stock_quants.',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
}

export function ProductDetailsSheet({ open, onOpenChange, details, isLoading }) {
  const product = details?.product;
  const operationalState = product ? getOperationalState(product) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[94vh] w-full max-w-5xl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>{product?.name || 'تفاصيل المنتج'}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-5">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : !product ? (
            <div className="text-sm text-muted-foreground">لا توجد بيانات.</div>
          ) : (
            <>
              <div className={`rounded-xl border px-4 py-3 ${operationalState.className}`}>
                <div className="font-extrabold">{operationalState.label}</div>
                <div className="mt-1 text-sm font-semibold opacity-90">{operationalState.description}</div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <Info label="الاسم" value={product.name || '-'} />
                <Info label="التصنيف" value={details?.category?.name || '-'} />
                <Info label="المرجع الداخلي" value={product.internalReference || '-'} />
                <Info label="باركود" value={product.barcode || '-'} />
                <Info label="نوع المنتج" value={PRODUCT_TYPES[product.productType] ?? product.productType} />
                <Info label="التتبع" value={TRACKING_TYPES[product.tracking] ?? product.tracking} />
                <Info label="سعر البيع" value={formatMoney(product.salePrice)} />
                <Info label="سعر التكلفة" value={formatMoney(product.costPrice)} />
                <Info label="يباع" value={yesNo(product.canBeSold)} />
                <Info label="يشترى" value={yesNo(product.canBePurchased)} />
                <Info label="الحالة" value={product.isActive ? 'نشط' : 'غير نشط'} />
                <Info label="استخدام POS" value={String(details?.posUsageCount ?? 0)} />
                <Info label="استخدام مخزون" value={String(details?.stockUsageCount ?? 0)} />
                <Info label="استخدام شراء/محاسبة" value={String(details?.accountingUsageCount ?? 0)} />
              </div>

              <Block title="الخصائص">
                {Array.isArray(product.attributesJsonb) && product.attributesJsonb.length ? (
                  <div className="grid gap-2 md:grid-cols-3">
                    {product.attributesJsonb.map((item, index) => (
                      <div key={`${item.attribute_id}-${item.value_id}-${index}`} className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                        <div className="font-bold text-slate-950">{item.attribute_name}</div>
                        <div className="mt-1 text-muted-foreground">{item.value_name}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">لا توجد خصائص محفوظة على تعريف المنتج. القيم الفعلية تُحدد عند إدخال المخزون حسب التصنيف.</div>
                )}
              </Block>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 font-extrabold text-slate-950">{value}</div>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-extrabold text-slate-950">{title}</h3>
      {children}
    </div>
  );
}
