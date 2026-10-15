import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import { useAuthorization } from '@/core/authorization/useAuthorization';
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
import { BulkReceivingGrid } from '@/features/inventory/components/BulkReceivingGrid';
import { createBulkReceivingRow, summarizeBulkRows, validateBulkReceivingRows } from '@/features/inventory/bulkReceiving.model';
import {
  createReceivingInputSignature,
  filterAuthorizedReceivingLocations,
  getPrimaryTrackingIdentifier,
  getOrCreateReceivingAttempt,
  prepareReceivingAttempt,
  resolveReceivingDefaultLocation,
} from '@/features/inventory/receivingUi.model';
import {
  productCategoryService,
  productCategoryTrackingIdentifierService,
  productsService,
  productVariantService,
} from '@/features/products/api/products.api';

const SERVICE_STOCK_MESSAGE = 'هذا المنتج خدمة ولا يدعم المخزون';
const SERIAL_UNITS_MESSAGE = 'هذا المنتج متتبع بالسيريال ويجب تحديد الوحدات';

export function AddStockDialog({ open, onOpenChange, tenantId, userId, products, onSaved }) {
  const {
    can, canAccessBranch, canAccessStockLocation, resourceScope, isReady: authorizationReady,
  } = useAuthorization();
  const canManageCatalog = can('products.manage');
  const [productId, setProductId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [quickCategoryId, setQuickCategoryId] = useState('');
  const [categories, setCategories] = useState([]);
  const [localProducts, setLocalProducts] = useState([]);
  const [quantity, setQuantity] = useState('1');
  const [bulkRows, setBulkRows] = useState([]);
  const [trackingIdentifierDefinitions, setTrackingIdentifierDefinitions] = useState([]);
  const [variantContext, setVariantContext] = useState(null);
  const [documentDefinitions, setDocumentDefinitions] = useState([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [error, setError] = useState('');
  const [isLoadingAttributes, setIsLoadingAttributes] = useState(false);
  const [isLoadingTrackingIdentifiers, setIsLoadingTrackingIdentifiers] = useState(false);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receivingLocations, setReceivingLocations] = useState([]);
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [submissionKey, setSubmissionKey] = useState('');
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const submissionAttemptRef = useRef(null);

  const allProducts = useMemo(() => [...products, ...localProducts], [localProducts, products]);
  const selectedProduct = useMemo(() => allProducts.find((product) => product.id === productId) ?? null, [allProducts, productId]);
  const stockProducts = useMemo(() => allProducts.filter((product) => product.productType !== 'service'), [allProducts]);
  const productSuggestions = useMemo(() => {
    const search = productSearch.trim().toLowerCase();
    if (!search) return stockProducts.slice(0, 8);
    return stockProducts
      .filter((product) => String(product.name ?? '').toLowerCase().includes(search))
      .slice(0, 8);
  }, [productSearch, stockProducts]);
  const hasExactProductMatch = useMemo(() => {
    const search = productSearch.trim().toLowerCase();
    return Boolean(search) && stockProducts.some((product) => String(product.name ?? '').trim().toLowerCase() === search);
  }, [productSearch, stockProducts]);
  const isSerial = selectedProduct?.tracking === 'serial';
  const primaryTrackingIdentifier = useMemo(
    () => getPrimaryTrackingIdentifier(trackingIdentifierDefinitions),
    [trackingIdentifierDefinitions],
  );
  const validatedBulkRows = useMemo(
    () => validateBulkReceivingRows(bulkRows, trackingIdentifierDefinitions, variantContext?.attributes ?? [], documentDefinitions),
    [bulkRows, documentDefinitions, trackingIdentifierDefinitions, variantContext?.attributes],
  );
  const bulkSummary = useMemo(() => summarizeBulkRows(validatedBulkRows), [validatedBulkRows]);
  const serialNumbers = useMemo(() => validatedBulkRows.map((row) => row.trackingNumber), [validatedBulkRows]);
  const trackingIdentifierValues = useMemo(() => Object.fromEntries(validatedBulkRows.map((row) => [row.trackingNumber, row.identities])), [validatedBulkRows]);
  const trackingIdentifierNotAvailable = useMemo(() => Object.fromEntries(validatedBulkRows.map((row) => [row.trackingNumber, row.identityNotAvailable ?? {}])), [validatedBulkRows]);
  const unitAttributeSelections = useMemo(() => Object.fromEntries(validatedBulkRows.map((row) => [row.trackingNumber, row.attributes])), [validatedBulkRows]);
  const unitDocumentFiles = useMemo(() => Object.fromEntries(validatedBulkRows.map((row) => [row.trackingNumber, row.documents])), [validatedBulkRows]);
  const defaultBranchId = resourceScope?.defaultBranchId ?? '';
  const defaultStockLocationId = resourceScope?.defaultStockLocationId ?? '';

  useEffect(() => {
    if (!open) return;
    setProductId('');
    setProductSearch('');
    setQuickCategoryId('');
    setLocalProducts([]);
    setQuantity('1');
    setBulkRows([]);
    setTrackingIdentifierDefinitions([]);
    setVariantContext(null);
    setDocumentDefinitions([]);
    setError('');
    setReceivingLocations([]);
    setDestinationLocationId('');
    setSubmissionKey(crypto.randomUUID());
    setIsReviewOpen(false);
    submissionAttemptRef.current = null;
    setIsLoadingAttributes(false);
    setIsLoadingTrackingIdentifiers(false);
  }, [open]);

  useEffect(() => {
    let mounted = true;
    if (!open || !tenantId || !authorizationReady) return undefined;
    inventoryService.listReceivingLocations({ tenantId })
      .then((locations) => {
        if (!mounted) return;
        const authorizedLocations = filterAuthorizedReceivingLocations(locations, {
          canAccessBranch, canAccessStockLocation,
        });
        setReceivingLocations(authorizedLocations);
        setDestinationLocationId((current) => {
          if (current && authorizedLocations.some((location) => location.id === current)) return current;
          return resolveReceivingDefaultLocation(authorizedLocations, {
            defaultBranchId, defaultStockLocationId,
          });
        });
      })
      .catch((loadError) => {
        if (mounted) setError(loadError.message || 'تعذر تحميل مواقع الاستلام.');
      });
    return () => { mounted = false; };
  }, [authorizationReady, canAccessBranch, canAccessStockLocation, defaultBranchId, defaultStockLocationId, open, tenantId]);

  useEffect(() => {
    let mounted = true;

    if (!open || !tenantId) {
      setCategories([]);
      return undefined;
    }

    productCategoryService
      .listCategories(tenantId)
      .then((nextCategories) => {
        if (!mounted) return;
        setCategories(nextCategories.filter((category) => category.isActive));
      })
      .catch(() => {
        if (!mounted) return;
        setCategories([]);
      });

    return () => {
      mounted = false;
    };
  }, [open, tenantId]);

  useEffect(() => {
    let mounted = true;

    if (!open || !tenantId || !productId) {
      setVariantContext(null);
      setIsLoadingAttributes(false);
      return undefined;
    }

    setIsLoadingAttributes(true);
    setVariantContext(null);

    productVariantService
      .getTemplateVariantContext({ tenantId, productTemplateId: selectedProduct?.productTemplateId ?? productId })
      .then((context) => {
        if (!mounted) return;
        setVariantContext(context);
      })
      .catch((loadError) => {
        if (!mounted) return;
        setVariantContext(null);
        setError(loadError.message || 'تعذر تحميل خواص المنتج.');
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingAttributes(false);
      });

    return () => {
      mounted = false;
    };
  }, [open, productId, selectedProduct?.productTemplateId, tenantId]);

  useEffect(() => {
    let mounted = true;

    if (!open || !tenantId || !selectedProduct?.categoryId || !isSerial) {
      setTrackingIdentifierDefinitions([]);
      setIsLoadingTrackingIdentifiers(false);
      return undefined;
    }

    setIsLoadingTrackingIdentifiers(true);
    setTrackingIdentifierDefinitions([]);

    productCategoryTrackingIdentifierService
      .listCategoryIdentifiers({ tenantId, categoryId: selectedProduct.categoryId })
      .then((definitions) => {
        if (!mounted) return;
        setTrackingIdentifierDefinitions(definitions);
      })
      .catch((loadError) => {
        if (!mounted) return;
        setTrackingIdentifierDefinitions([]);
        setError(loadError.message || 'تعذر تحميل تعريفات التتبع.');
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingTrackingIdentifiers(false);
      });

    return () => {
      mounted = false;
    };
  }, [isSerial, open, selectedProduct?.categoryId, tenantId]);

  useEffect(() => {
    let mounted = true;

    if (!open || !tenantId || !selectedProduct?.categoryId || !isSerial) {
      setDocumentDefinitions([]);
      setIsLoadingDocuments(false);
      return undefined;
    }

    setIsLoadingDocuments(true);
    setDocumentDefinitions([]);
    inventoryService.listCategoryInventoryDocuments({
      tenantId,
      categoryId: selectedProduct.categoryId,
    })
      .then((definitions) => {
        if (mounted) setDocumentDefinitions(definitions);
      })
      .catch((loadError) => {
        if (!mounted) return;
        setDocumentDefinitions([]);
        setError(loadError.message || 'تعذر تحميل متطلبات الصور.');
      })
      .finally(() => {
        if (mounted) setIsLoadingDocuments(false);
      });

    return () => { mounted = false; };
  }, [isSerial, open, selectedProduct?.categoryId, tenantId]);

  const handleSelectProduct = (product) => {
    const hasEnteredData = bulkRows.some((row) => Object.values(row.identities).some(Boolean)
      || Object.values(row.attributes).some(Boolean) || Object.values(row.documents).some(Boolean));
    if (productId && product.id !== productId && hasEnteredData
      && !window.confirm('تغيير المنتج سيمسح الوحدات غير المحفوظة. هل تريد المتابعة؟')) return;
    setError('');
    setProductId(product.id);
    setProductSearch(product.name);
    setBulkRows(product.tracking === 'serial' ? [createBulkReceivingRow()] : []);
    setIsReviewOpen(false);
    submissionAttemptRef.current = null;
    setQuantity('1');
  };

  const rowHasData = (row) => Object.values(row?.identities ?? {}).some(Boolean)
    || Object.values(row?.attributes ?? {}).some(Boolean)
    || Object.values(row?.documents ?? {}).some(Boolean);

  const handleQuickCreateProduct = async () => {
    const name = productSearch.trim();
    const category = categories.find((item) => item.id === quickCategoryId);

    if (!name) {
      setError('اكتب اسم المنتج أولًا.');
      return;
    }

    if (!category) {
      setError('اختر التصنيف قبل إنشاء المنتج.');
      return;
    }

    try {
      setIsCreatingProduct(true);
      setError('');
      const productType = category.defaultProductType || 'goods';
      const createdProduct = await productsService.createProduct({
        tenantId,
        payload: {
          name,
          categoryId: category.id,
          internalReference: '',
          barcode: '',
          productType,
          tracking: productType === 'service' || productType === 'consumable' ? 'none' : (category.defaultTracking || 'none'),
          salePrice: 0,
          costPrice: 0,
          canBeSold: category.defaultCanBeSold ?? true,
          canBePurchased: category.defaultCanBePurchased ?? true,
          isActive: category.defaultIsActive ?? true,
          attributesJsonb: [],
        },
      });

      const createdVariantProduct = {
        ...createdProduct,
        id: createdProduct.defaultProductProductId ?? createdProduct.id,
        productTemplateId: createdProduct.id,
        defaultProductProductId: createdProduct.defaultProductProductId ?? null,
        displayName: createdProduct.name,
        code: createdProduct.internalReference ?? '',
      };

      setLocalProducts((current) => [createdVariantProduct, ...current]);
      handleSelectProduct(createdVariantProduct);
      await onSaved?.();
    } catch (createError) {
      setError(createError.message || 'تعذر إنشاء المنتج السريع.');
    } finally {
      setIsCreatingProduct(false);
    }
  };

  const handleSubmit = async (event, confirmed = false) => {
    event.preventDefault();

    if (!productId) {
      setError('اختر المنتج أولًا.');
      return;
    }

    const destination = receivingLocations.find((location) => location.id === destinationLocationId);
    if (!destination) {
      setError('اختر موقع الاستلام.');
      return;
    }

    if (isLoadingAttributes || isLoadingTrackingIdentifiers || isLoadingDocuments) {
      return;
    }

    if (selectedProduct?.productType === 'service') {
      setError(SERVICE_STOCK_MESSAGE);
      return;
    }

    if (isSerial && !serialNumbers.length) {
      setError(SERIAL_UNITS_MESSAGE);
      return;
    }

    if (!isSerial && (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0)) {
      setError('أدخل كمية صحيحة أكبر من صفر.');
      return;
    }

    if (isSerial && bulkSummary.errors) {
      setError(`راجع بيانات ${bulkSummary.errors} وحدة قبل الحفظ.`);
      return;
    }

    if (!confirmed) {
      setError('');
      setIsReviewOpen(true);
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      const inputSignature = createReceivingInputSignature({
        productId, quantity, destination, serialNumbers, trackingIdentifierValues,
        trackingIdentifierNotAvailable, primaryTrackingIdentifier, unitAttributeSelections, unitDocumentFiles,
      });
      const nextSubmissionKey = submissionAttemptRef.current && submissionAttemptRef.current.inputSignature !== inputSignature
        ? crypto.randomUUID()
        : submissionKey;
      const attempt = await getOrCreateReceivingAttempt({
        currentAttempt: submissionAttemptRef.current,
        inputSignature,
        prepare: () => prepareReceivingAttempt({
          tenantId,
          productId,
          quantity,
          destination,
          serialNumbers,
          isSerial,
          trackingIdentifierDefinitions,
          primaryTrackingIdentifier,
          trackingIdentifierValues,
          trackingIdentifierNotAvailable,
          attributes: variantContext?.attributes ?? [],
          unitAttributeSelections,
          documentDefinitions,
          unitDocumentFiles,
          submissionKey: nextSubmissionKey,
          uploadAttachment: (payload) => inventoryService.uploadReceivingAttachment(payload),
        }),
      });
      submissionAttemptRef.current = attempt;
      if (nextSubmissionKey !== submissionKey) setSubmissionKey(nextSubmissionKey);
      const result = await inventoryService.receiveInventory(attempt.request);
      const incompleteCount = (result?.units ?? []).filter((unit) => unit.documentation?.status === 'INCOMPLETE').length;
      const documentationNotice = incompleteCount || attempt.uploadFailureCount
        ? `تم الاستلام بنجاح، مع ${incompleteCount} وحدة مستنداتها غير مكتملة${attempt.uploadFailureCount ? ` و${attempt.uploadFailureCount} صورة تعذر رفعها` : ''}.`
        : '';
      setIsReviewOpen(false);
      onOpenChange(false);
      await onSaved?.({ ...result, documentationNotice });
    } catch (submitError) {
      setIsReviewOpen(false);
      setError(submitError.message || 'تعذر إضافة المخزون.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="h-full w-full !max-w-[720px]" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="flex-shrink-0 px-5 py-3">
          <SheetTitle className="text-lg">إضافة مخزون</SheetTitle>
        </SheetHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => handleSubmit(event, false)}>
          <SheetBody className="grid content-start gap-3 px-5 py-3 text-[13px] md:grid-cols-[250px_250px_minmax(0,1fr)]">
            <div className="w-full space-y-2">
              <Label htmlFor="inventory-receiving-location">موقع الاستلام</Label>
              <select id="inventory-receiving-location" value={destinationLocationId} onChange={(event) => {
                if (event.target.value !== destinationLocationId && bulkRows.some(rowHasData)
                  && !window.confirm('تغيير موقع الاستلام سيطبق على كل الوحدات غير المحفوظة. هل تريد المتابعة؟')) return;
                setDestinationLocationId(event.target.value);
                submissionAttemptRef.current = null;
              }} className="h-9 w-full rounded-lg border border-border bg-white px-3 text-[13px]">
                <option value="">اختر الموقع</option>
                {receivingLocations.map((location) => <option key={location.id} value={location.id}>{location.branchName} — {location.name}</option>)}
              </select>
            </div>
            {isLoadingAttributes ? (
              <LoadingAttributesState />
            ) : (
              <>
                <div className="w-full space-y-2">
                  <Label htmlFor="inventory-product">المنتج</Label>
                  {productId && selectedProduct ? (
                    <div className="flex h-9 items-center justify-between gap-3 rounded-lg border border-border bg-white px-3">
                      <div className="min-w-0 truncate text-[13px] font-semibold text-slate-950">{selectedProduct.name}</div>
                      <button
                        type="button"
                        onClick={() => {
                          const hasEnteredData = bulkRows.some((row) => Object.values(row.identities).some(Boolean) || Object.values(row.attributes).some(Boolean) || Object.values(row.documents).some(Boolean));
                          if (hasEnteredData && !window.confirm('تغيير المنتج سيمسح الوحدات غير المحفوظة. هل تريد المتابعة؟')) return;
                          setProductId('');
                          setProductSearch('');
                          setVariantContext(null);
                          setBulkRows([]);
                          setTrackingIdentifierDefinitions([]);
                          setError('');
                        }}
                        className="flex-shrink-0 text-xs font-extrabold text-[rgb(2,27,76)] underline-offset-4 hover:underline"
                      >
                        تغيير
                      </button>
                    </div>
                  ) : (
                    <>
                      <Input
                        id="inventory-product"
                        className="h-9 rounded-lg px-3 text-[13px]"
                        value={productSearch}
                        onChange={(event) => {
                          setProductSearch(event.target.value);
                          setProductId('');
                          setVariantContext(null);
                          setBulkRows([]);
                          setTrackingIdentifierDefinitions([]);
                          setError('');
                        }}
                        placeholder="ابحث باسم المنتج"
                      />
                      {productSearch.trim() ? (
                        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                          {productSuggestions.length ? (
                            productSuggestions.map((product) => (
                              <button
                                key={product.id}
                                type="button"
                                onClick={() => handleSelectProduct(product)}
                                className="block w-full border-b border-slate-100 px-3 py-2 text-right text-sm font-semibold text-slate-700 transition last:border-b-0 hover:bg-slate-50 hover:text-slate-950"
                              >
                                {product.name}
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-sm font-semibold text-slate-500">لا توجد نتائج مشابهة.</div>
                          )}
                        </div>
                      ) : null}
                      {canManageCatalog && productSearch.trim() && !hasExactProductMatch ? (
                        <div className="space-y-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-bold text-slate-500">إنشاء منتج سريع</div>
                          <select
                            value={quickCategoryId}
                            onChange={(event) => setQuickCategoryId(event.target.value)}
                            className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                          >
                            <option value="">اختر التصنيف</option>
                            {categories.map((category) => (
                              <option key={category.id} value={category.id}>{category.name}</option>
                            ))}
                          </select>
                          <Button type="button" variant="secondary" onClick={handleQuickCreateProduct} disabled={isCreatingProduct || !quickCategoryId}>
                            {isCreatingProduct ? 'جارٍ الإنشاء...' : `إنشاء "${productSearch.trim()}"`}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                {productId && !isSerial ? <div className="space-y-2">
                  <Label htmlFor="inventory-unit-count">الكمية</Label>
                  <Input id="inventory-unit-count" type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                </div> : null}

                {!productId ? null : isSerial ? (
                  isLoadingTrackingIdentifiers || isLoadingDocuments ? (
                    <div className="flex min-h-28 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold text-slate-500 md:col-span-3">جاري تحميل بيانات الوحدات...</div>
                  ) : <BulkReceivingGrid rows={bulkRows} onRowsChange={(nextRows) => { setBulkRows(nextRows); setQuantity(String(nextRows.length)); setError(''); submissionAttemptRef.current = null; }} identifierDefinitions={trackingIdentifierDefinitions} attributes={variantContext?.attributes ?? []} documentDefinitions={documentDefinitions} />
                ) : null}
              </>
            )}

            {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 md:col-span-3">{error}</div> : null}
          </SheetBody>
          <SheetFooter className="flex-shrink-0 bg-white px-5 py-3">
            <div className="min-w-0 text-xs font-bold text-slate-600">{isSerial && productId ? <span>{bulkSummary.total} وحدة — <span className="text-emerald-700">{bulkSummary.complete} مكتملة</span> — <span className={bulkSummary.errors ? 'text-red-700' : ''}>{bulkSummary.errors} تحتاج مراجعة</span></span> : productId ? <span>الكمية: {quantity}</span> : <span>اختر الموقع والمنتج للبدء</span>}</div>
            <div className="flex flex-shrink-0 gap-2"><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={isSubmitting || isLoadingAttributes || isLoadingTrackingIdentifiers || isLoadingDocuments || isCreatingProduct}>{isSubmitting ? 'جارٍ الإضافة...' : 'مراجعة واستلام'}</Button></div>
          </SheetFooter>
        </form>
        <ReceivingReviewSheet open={isReviewOpen} onOpenChange={setIsReviewOpen} product={selectedProduct} destination={receivingLocations.find((location) => location.id === destinationLocationId)} summary={bulkSummary} isSerial={isSerial} quantity={quantity} isSubmitting={isSubmitting} onConfirm={() => handleSubmit({ preventDefault() {} }, true)} />
      </SheetContent>
    </Sheet>
  );
}

function ReceivingReviewSheet({ open, onOpenChange, product, destination, summary, isSerial, quantity, isSubmitting, onConfirm }) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="max-w-lg" dir="rtl"><SheetDismissButton /><SheetHeader><SheetTitle>مراجعة الاستلام</SheetTitle></SheetHeader><SheetBody className="space-y-4">
    <div className="rounded-xl border bg-slate-50 p-4 text-sm"><div><b>المنتج:</b> {product?.name}</div><div className="mt-2"><b>الموقع:</b> {destination ? `${destination.branchName} — ${destination.name}` : '—'}</div></div>
    {isSerial ? <div className="grid grid-cols-2 gap-3"><ReviewMetric label="إجمالي الوحدات" value={summary.total} /><ReviewMetric label="مكتملة تشغيليًا" value={summary.complete} /><ReviewMetric label="توثيق ناقص غير مانع" value={summary.incompleteDocuments} /><ReviewMetric label="أخطاء مانعة" value={summary.errors} /></div> : <ReviewMetric label="الكمية المستلمة" value={quantity} />}
    {isSerial && summary.incompleteDocuments ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">سيتم الاستلام مع بقاء حالة التوثيق ناقصة للوحدات الموضحة.</div> : null}
  </SheetBody><SheetFooter><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>رجوع</Button><Button type="button" onClick={onConfirm} disabled={isSubmitting || summary.errors > 0}>{isSubmitting ? 'جارٍ الحفظ...' : 'تأكيد الاستلام'}</Button></SheetFooter></SheetContent></Sheet>;
}

function ReviewMetric({ label, value }) { return <div className="rounded-xl border bg-white p-3"><div className="text-xs font-bold text-slate-500">{label}</div><div className="mt-1 text-xl font-black">{value}</div></div>; }

function LoadingAttributesState() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/80 text-center md:col-span-2">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[rgb(2,27,76)]" />
      <div className="mt-3 text-sm font-extrabold text-slate-950">جارٍ تحميل خصائص المنتج...</div>
    </div>
  );
}
