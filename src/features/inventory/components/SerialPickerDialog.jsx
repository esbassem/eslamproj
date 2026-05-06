import { useEffect, useState } from 'react';
import { Button } from '@/core/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDismissButton,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { inventoryService } from '@/features/inventory/api/inventory.api';

const SERVICE_STOCK_MESSAGE = 'هذا المنتج خدمة ولا يدعم المخزون';
const SERIAL_UNITS_MESSAGE = 'هذا المنتج متتبع بالسيريال ويجب تحديد الوحدات';

export function SerialPickerDialog({ open, onOpenChange, tenantId, product, onSelect }) {
  const [serialUnits, setSerialUnits] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    if (!open || !tenantId || !product?.id) {
      setSerialUnits([]);
      return undefined;
    }

    if (product.productType === 'service') {
      setSerialUnits([]);
      setError(SERVICE_STOCK_MESSAGE);
      return undefined;
    }

    if (product.tracking !== 'serial') {
      setSerialUnits([]);
      setError(SERIAL_UNITS_MESSAGE);
      return undefined;
    }

    setIsLoading(true);
    setError('');

    inventoryService
      .getSerialUnits({ tenantId, productId: product.id, status: 'in_stock' })
      .then((units) => {
        if (!mounted) return;
        setSerialUnits(units);
      })
      .catch((loadError) => {
        if (mounted) setError(loadError.message || 'تعذر تحميل السيريالات.');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [open, product?.id, product?.productType, product?.tracking, tenantId]);

  const handleSelect = (unit) => {
    onSelect?.(unit);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] w-full max-w-2xl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>اختيار IMEI</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-extrabold text-slate-950">{product?.name ?? '-'}</div>
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-slate-100" />)}
            </div>
          ) : serialUnits.length ? (
            <div className="flex flex-wrap gap-2">
              {serialUnits.map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => handleSelect(unit)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-right text-sm font-bold text-slate-700 transition hover:border-[#17324d]/35 hover:bg-slate-50 hover:text-[#17324d]"
                >
                  {unit.trackingNumber}
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
              لا توجد IMEI متاحة لهذا المنتج.
            </div>
          )}
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>إلغاء</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
