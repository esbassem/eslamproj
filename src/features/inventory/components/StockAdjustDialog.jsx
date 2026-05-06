import { useEffect, useState } from 'react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
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

export function StockAdjustDialog({ open, onOpenChange, tenantId, userId, item, onSaved }) {
  const [quantity, setQuantity] = useState('0');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuantity(String(item?.quantity ?? 0));
    setError('');
  }, [item?.quantity, open]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!item?.product?.id) return;

    if (item.product.productType === 'service') {
      setError(SERVICE_STOCK_MESSAGE);
      return;
    }

    if (item.product.tracking === 'serial') {
      setError(SERIAL_UNITS_MESSAGE);
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      await inventoryService.adjustStock({
        tenantId,
        productId: item.product.id,
        productProductId: item.product.id,
        quantity,
        userId,
      });
      onOpenChange(false);
      await onSaved?.();
    } catch (submitError) {
      setError(submitError.message || 'تعذر تسوية المخزون.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] w-full max-w-xl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>تسوية مخزون</SheetTitle>
        </SheetHeader>
        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="space-y-4">
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-extrabold text-slate-950">{item?.product?.displayName || item?.product?.name || '-'}</div>
            {item?.product?.tracking === 'serial' ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {SERIAL_UNITS_MESSAGE}
              </div>
            ) : item?.product?.productType === 'service' ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {SERVICE_STOCK_MESSAGE}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="adjust-quantity">الكمية الجديدة</Label>
                <Input id="adjust-quantity" type="number" min="0" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
              </div>
            )}
            {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={isSubmitting || item?.product?.tracking === 'serial' || item?.product?.productType === 'service'}>{isSubmitting ? 'جارٍ الحفظ...' : 'حفظ التسوية'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
