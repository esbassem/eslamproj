import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDismissButton, SheetFooter, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { inventoryService } from '@/features/inventory/api/inventory.api';
import { posService } from '@/features/pos/api/pos.api';
import { productCategoryAttributeService, productCategoryTrackingIdentifierService } from '@/features/products/api/products.api';
import { createLocalProductSearch, ProductSearchField } from '@/shared/products';

export function CompleteTrackingUnitWizard({ open, onOpenChange, tenantId, unit, onCompleted }) {
  const [context, setContext] = useState(null);
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [definitions, setDefinitions] = useState([]);
  const [fields, setFields] = useState([]);
  const [identifierValues, setIdentifierValues] = useState({});
  const [attributeValues, setAttributeValues] = useState({});
  const [search, setSearch] = useState('');
  const [canComplete, setCanComplete] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !tenantId || !unit?.id) return;
    let mounted = true;
    setStatus('loading');
    setError('');
    Promise.all([
      inventoryService.getTrackingUnitCompletionContext({ tenantId, trackingUnitId: unit.id }),
      inventoryService.canCompleteTrackingUnit({ tenantId }),
      posService.listSellProducts({ tenantId }),
    ]).then(([nextContext, permission, nextProducts]) => {
      if (!mounted) return;
      setContext(nextContext);
      setCanComplete(permission);
      setProducts((nextProducts || []).filter((product) => product.productType !== 'service' && ['serial', 'lot'].includes(product.tracking)));
      setIdentifierValues(Object.fromEntries((nextContext.identifiers || []).map((item) => [item.identifier_type_id, item.is_not_available ? { value: '', isNotAvailable: true } : item.value || ''])));
      setAttributeValues(Object.fromEntries((nextContext.attributes || []).map((item) => [item.attribute_id, item.attribute_value_id || item.value_text || ''])));
      setStatus('ready');
    }).catch((loadError) => {
      if (!mounted) return;
      setStatus('error');
      setError(loadError.message || 'تعذر تحميل بيانات القطعة.');
    });
    return () => { mounted = false; };
  }, [open, tenantId, unit?.id]);

  useEffect(() => {
    if (!selectedProduct || !tenantId) {
      setDefinitions([]);
      setFields([]);
      return;
    }
    Promise.all([
      productCategoryTrackingIdentifierService.listCategoryIdentifiers({ tenantId, categoryId: selectedProduct.categoryId }),
      productCategoryAttributeService.listCategoryAttributes({ tenantId, categoryId: selectedProduct.categoryId }),
    ]).then(([nextDefinitions, nextFields]) => {
      setDefinitions(nextDefinitions || []);
      setFields(nextFields || []);
      setIdentifierValues((current) => ({ ...Object.fromEntries((nextDefinitions || []).map((definition) => [definition.identifierTypeId, ''])), ...current }));
      setAttributeValues((current) => ({ ...Object.fromEntries((nextFields || []).map((field) => [field.id, ''])), ...current }));
    }).catch((loadError) => setError(loadError.message || 'تعذر تحميل متطلبات المنتج.'));
  }, [selectedProduct, tenantId]);

  const searchProducts = useMemo(() => createLocalProductSearch(products), [products]);

  const missingIdentifier = definitions.find((definition) => {
    if (!definition.isRequired) return false;
    const value = identifierValues[definition.identifierTypeId];
    return !(typeof value === 'object' ? value.value || value.isNotAvailable : String(value || '').trim());
  });
  const missingAttribute = fields.find((field) => field.isRequired && !String(attributeValues[field.id] || '').trim());
  const canSubmit = canComplete && selectedProduct && !missingIdentifier && !missingAttribute && status !== 'saving';

  const submit = async () => {
    if (!canSubmit) return;
    setStatus('saving');
    setError('');
    try {
      const result = await inventoryService.completeIncompleteTrackingUnit({
        tenantId,
        trackingUnitId: unit.id,
        productProductId: selectedProduct.productProductId || selectedProduct.id,
        identifierValues: definitions.map((definition) => {
          const raw = identifierValues[definition.identifierTypeId];
          return {
            identifierTypeId: definition.identifierTypeId,
            value: typeof raw === 'object' ? raw.value || '' : raw || '',
            isNotAvailable: typeof raw === 'object' && Boolean(raw.isNotAvailable),
          };
        }),
        attributeValues: fields.map((field) => {
          const raw = String(attributeValues[field.id] || '').trim();
          const selected = field.values?.find((value) => String(value.id) === raw);
          return { attributeId: field.id, attributeValueId: selected?.id || null, valueText: selected ? null : raw || null };
        }).filter((item) => item.attributeValueId || item.valueText),
      });
      await onCompleted?.({ ...result, product: selectedProduct });
      onOpenChange(false);
    } catch (saveError) {
      setStatus('ready');
      setError(saveError.message || 'تعذر استكمال بيانات القطعة.');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-xl" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="pl-16 text-right">
          <SheetTitle>استكمال بيانات القطعة</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          {status === 'loading' ? <div className="flex items-center gap-2 py-8 text-sm font-black text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />جاري تحميل البيانات...</div> : null}
          {context ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-sm font-black text-amber-950"><AlertTriangle className="h-4 w-4" />قطعة غير مكتملة</div>
              <p className="mt-2 font-mono text-xs text-amber-800" dir="ltr">{context.unit.trackingNumber}</p>
              <p className="mt-1 text-xs font-bold text-amber-700">السبب: {context.unit.incompleteReason || 'غير محدد'}</p>
            </div>
          ) : null}
          {!canComplete && status !== 'loading' ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-black text-red-700">لا تملك صلاحية استكمال بيانات القطعة.</div> : null}
          {canComplete && !selectedProduct ? (
            <div className="space-y-3">
              <ProductSearchField searchProducts={searchProducts} search={search} onSearchChange={setSearch} onSelect={setSelectedProduct} placeholder="ابحث عن المنتج الحقيقي" />
            </div>
          ) : null}
          {selectedProduct ? (
            <div className="space-y-4">
              <button type="button" onClick={() => setSelectedProduct(null)} className="text-sm font-black text-blue-700">المنتج: {selectedProduct.displayName || selectedProduct.name} — تغيير</button>
              {definitions.map((definition) => <label key={definition.identifierTypeId} className="block"><span className="mb-1 block text-xs font-black">{definition.name}{definition.isRequired ? ' *' : ''}</span><Input value={typeof identifierValues[definition.identifierTypeId] === 'object' ? identifierValues[definition.identifierTypeId].value || '' : identifierValues[definition.identifierTypeId] || ''} onChange={(event) => setIdentifierValues((current) => ({ ...current, [definition.identifierTypeId]: event.target.value }))} dir="ltr" /></label>)}
              {fields.map((field) => <label key={field.id} className="block"><span className="mb-1 block text-xs font-black">{field.name}{field.isRequired ? ' *' : ''}</span>{field.values?.length ? <select value={attributeValues[field.id] || ''} onChange={(event) => setAttributeValues((current) => ({ ...current, [field.id]: event.target.value }))} className="h-10 w-full rounded-xl border border-slate-200 px-3"><option value="">اختر</option>{field.values.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</select> : <Input value={attributeValues[field.id] || ''} onChange={(event) => setAttributeValues((current) => ({ ...current, [field.id]: event.target.value }))} />}</label>)}
            </div>
          ) : null}
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-black text-red-700">{error}</div> : null}
        </SheetBody>
        <SheetFooter><Button type="button" onClick={submit} disabled={!canSubmit} className="w-full">{status === 'saving' ? 'جاري الاستكمال...' : 'اعتماد استكمال البيانات'}</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
