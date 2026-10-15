import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import { Sheet, SheetBody, SheetContent, SheetDismissButton, SheetFooter, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { inventoryService } from '@/features/inventory/api/inventory.api';

export function TransferInventoryDialog({ open, onOpenChange, tenantId, item, onSaved }) {
  const { can, canAccessBranch, canAccessStockLocation, isReady: authorizationReady } = useAuthorization();
  const [locations, setLocations] = useState([]);
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [availability, setAvailability] = useState(null);
  const [selectedUnits, setSelectedUnits] = useState([]);
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [submissionKey, setSubmissionKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const product = item?.product;
  const productId = product?.id;
  const isSerial = product?.tracking === 'serial';
  const source = locations.find((location) => location.id === sourceLocationId);
  const destination = locations.find((location) => location.id === destinationLocationId);
  const destinationOptions = useMemo(() => locations.filter((location) => location.id !== sourceLocationId), [locations, sourceLocationId]);
  const units = availability?.tracking_units ?? [];
  const availableQuantity = Number(availability?.available_quantity ?? 0);

  useEffect(() => {
    let mounted = true;
    if (!open || !tenantId || !authorizationReady || !can('inventory.transfer')) return undefined;
    setLocations([]);
    setSourceLocationId('');
    setDestinationLocationId('');
    setAvailability(null);
    setSelectedUnits([]);
    setQuantity('1');
    setNotes('');
    setError('');
    setSubmissionKey(crypto.randomUUID());
    inventoryService.listReceivingLocations({ tenantId })
      .then((nextLocations) => {
        if (mounted) setLocations(nextLocations.filter((location) => (
          canAccessBranch(location.branchId) && canAccessStockLocation(location.id)
        )));
      })
      .catch((loadError) => { if (mounted) setError(loadError.message || 'تعذر تحميل مواقع المخزون.'); });
    return () => { mounted = false; };
  }, [open, tenantId, authorizationReady, can, canAccessBranch, canAccessStockLocation]);

  useEffect(() => {
    let mounted = true;
    if (!open || !source?.branchId || !productId) {
      setAvailability(null);
      return undefined;
    }
    setLoading(true);
    setError('');
    setSelectedUnits([]);
    inventoryService.getTransferAvailability({ branchId: source.branchId, locationId: source.id, productId })
      .then((result) => { if (mounted) setAvailability(result); })
      .catch((loadError) => { if (mounted) setError(loadError.message || 'تعذر تحميل المخزون القابل للنقل.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [open, productId, source?.branchId, source?.id]);

  const canSubmit = authorizationReady && can('inventory.transfer')
    && source && destination && source.id !== destination.id && !saving && !loading
    && (isSerial ? selectedUnits.length > 0 : Number(quantity) > 0 && Number(quantity) <= availableQuantity);

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (!canAccessBranch(source.branchId) || !canAccessStockLocation(source.id)
      || !canAccessBranch(destination.branchId) || !canAccessStockLocation(destination.id)) {
      setError('المصدر أو الوجهة خارج نطاق صلاحياتك الحالي.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const line = isSerial
        ? { product_id: productId, tracking_unit_ids: selectedUnits }
        : { product_id: productId, quantity: Number(quantity) };
      const result = await inventoryService.transferInventory({
        sourceBranchId: source.branchId,
        sourceLocationId: source.id,
        destinationBranchId: destination.branchId,
        destinationLocationId: destination.id,
        sourceType: 'manual_inventory_transfer',
        sourceId: submissionKey,
        lines: [line],
        notes,
        idempotencyKey: `inventory-transfer:${submissionKey}`,
      });
      onOpenChange(false);
      await onSaved?.(result);
    } catch (submitError) {
      setError(submitError.message || 'تعذر نقل المخزون.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] w-full max-w-2xl" dir="rtl">
        <SheetDismissButton />
        <SheetHeader><SheetTitle>نقل المخزون</SheetTitle></SheetHeader>
        <form className="flex h-full flex-col" onSubmit={submit}>
          <SheetBody className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-extrabold text-slate-950">
              {product?.displayName || product?.name || 'منتج'}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <Label>من موقع</Label>
                <select value={sourceLocationId} onChange={(event) => { setSourceLocationId(event.target.value); setDestinationLocationId(''); }} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold">
                  <option value="">اختر المصدر</option>
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.branchName} — {location.name}</option>)}
                </select>
              </label>
              <label className="block">
                <Label>إلى موقع</Label>
                <select value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold">
                  <option value="">اختر الوجهة</option>
                  {destinationOptions.map((location) => <option key={location.id} value={location.id}>{location.branchName} — {location.name}</option>)}
                </select>
              </label>
            </div>
            {loading ? <div className="flex items-center gap-2 text-sm font-bold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />جاري حساب المتاح</div> : null}
            {sourceLocationId && !loading && isSerial ? (
              <div className="space-y-2">
                <Label>الوحدات المتاحة للنقل</Label>
                {units.length ? units.map((unit) => (
                  <label key={unit.tracking_unit_id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold">
                    <input type="checkbox" checked={selectedUnits.includes(unit.tracking_unit_id)} onChange={(event) => setSelectedUnits((current) => event.target.checked ? [...current, unit.tracking_unit_id] : current.filter((id) => id !== unit.tracking_unit_id))} />
                    <span dir="ltr">{unit.tracking_number}</span>
                  </label>
                )) : <div className="rounded-xl bg-amber-50 px-3 py-3 text-sm font-bold text-amber-800">لا توجد وحدات متاحة في هذا الموقع.</div>}
              </div>
            ) : null}
            {sourceLocationId && !loading && !isSerial ? (
              <label className="block">
                <Label>الكمية — المتاح {availableQuantity}</Label>
                <Input className="mt-2" type="number" min="0.000001" step="any" max={availableQuantity} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
              </label>
            ) : null}
            <label className="block"><Label>ملاحظات</Label><Input className="mt-2" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}
          </SheetBody>
          <SheetFooter>
            <Button type="submit" disabled={!canSubmit} className="gap-2"><ArrowLeftRight className="h-4 w-4" />{saving ? 'جاري النقل' : 'تأكيد النقل'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
