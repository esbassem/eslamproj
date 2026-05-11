import { useEffect, useMemo, useState } from 'react';
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
import {
  productCategoryService,
  productCategoryTrackingIdentifierService,
  productsService,
  productVariantService,
} from '@/features/products/api/products.api';

const SERVICE_STOCK_MESSAGE = 'هذا المنتج خدمة ولا يدعم المخزون';
const SERIAL_UNITS_MESSAGE = 'هذا المنتج متتبع بالسيريال ويجب تحديد الوحدات';

function getIdentifierSlots(definition) {
  const schemaSlots = definition?.inputSchema?.slots ?? definition?.input_schema?.slots ?? definition?.slots ?? [];
  return Array.isArray(schemaSlots) ? schemaSlots : [];
}

function isAllowedIdentifierCharacter(character, type) {
  if (!type) return true;
  if (type === 'numeric') return /^\d$/.test(character);
  if (type === 'english_letter') return /^[A-Za-z]$/.test(character);
  if (type === 'arabic_letter') return /^[\u0621-\u064A]$/.test(character);
  return true;
}

function sanitizeIdentifierValue(definition, value) {
  const slots = getIdentifierSlots(definition);
  const rawCharacters = Array.from(String(value ?? ''));

  if (!slots.length) {
    return String(value ?? '');
  }

  const nextCharacters = [];
  for (const character of rawCharacters) {
    const slot = slots[nextCharacters.length];
    if (!slot) break;
    if (isAllowedIdentifierCharacter(character, slot.type)) {
      nextCharacters.push(character);
    }
  }

  return nextCharacters.join('');
}

function validateIdentifierValueAgainstSchema(definition, value) {
  const slots = getIdentifierSlots(definition);
  if (!slots.length || !value) return true;

  const characters = Array.from(String(value));
  if (characters.length !== slots.length) {
    return `قيمة "${definition.name}" يجب أن تكون ${slots.length} خانة.`;
  }

  const invalidIndex = characters.findIndex((character, index) => !isAllowedIdentifierCharacter(character, slots[index]?.type));
  if (invalidIndex >= 0) {
    return `الخانة ${invalidIndex + 1} في "${definition.name}" لا تطابق نوع الخانة المطلوب.`;
  }

  return true;
}

export function AddStockDialog({ open, onOpenChange, tenantId, userId, products, onSaved }) {
  const [productId, setProductId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [quickCategoryId, setQuickCategoryId] = useState('');
  const [categories, setCategories] = useState([]);
  const [localProducts, setLocalProducts] = useState([]);
  const [quantity, setQuantity] = useState('1');
  const [serialText, setSerialText] = useState('');
  const [trackingIdentifierDefinitions, setTrackingIdentifierDefinitions] = useState([]);
  const [trackingIdentifierValues, setTrackingIdentifierValues] = useState({});
  const [variantContext, setVariantContext] = useState(null);
  const [attributeSelections, setAttributeSelections] = useState({});
  const [error, setError] = useState('');
  const [isLoadingAttributes, setIsLoadingAttributes] = useState(false);
  const [isLoadingTrackingIdentifiers, setIsLoadingTrackingIdentifiers] = useState(false);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  const serialNumbers = useMemo(() => serialText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), [serialText]);
  const duplicateSerialNumbers = useMemo(() => {
    const seen = new Set();
    const duplicates = new Set();

    for (const serial of serialNumbers) {
      if (seen.has(serial)) duplicates.add(serial);
      seen.add(serial);
    }

    return [...duplicates];
  }, [serialNumbers]);
  const isSerial = selectedProduct?.tracking === 'serial';

  useEffect(() => {
    if (!open) return;
    setProductId('');
    setProductSearch('');
    setQuickCategoryId('');
    setLocalProducts([]);
    setQuantity('1');
    setSerialText('');
    setTrackingIdentifierDefinitions([]);
    setTrackingIdentifierValues({});
    setVariantContext(null);
    setAttributeSelections({});
    setError('');
    setIsLoadingAttributes(false);
    setIsLoadingTrackingIdentifiers(false);
  }, [open]);

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
      setAttributeSelections({});
      setIsLoadingAttributes(false);
      return undefined;
    }

    setIsLoadingAttributes(true);
    setVariantContext(null);
    setAttributeSelections({});

    productVariantService
      .getTemplateVariantContext({ tenantId, productTemplateId: selectedProduct?.productTemplateId ?? productId })
      .then((context) => {
        if (!mounted) return;
        setVariantContext(context);
        setAttributeSelections(
          (context.attributes ?? []).reduce((state, attribute) => {
            state[attribute.id] = '';
            return state;
          }, {}),
        );
      })
      .catch((loadError) => {
        if (!mounted) return;
        setVariantContext(null);
        setAttributeSelections({});
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
      setTrackingIdentifierValues({});
      setIsLoadingTrackingIdentifiers(false);
      return undefined;
    }

    setIsLoadingTrackingIdentifiers(true);
    setTrackingIdentifierDefinitions([]);
    setTrackingIdentifierValues({});

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
    if (!serialNumbers.length) {
      setTrackingIdentifierValues({});
      return;
    }

    setTrackingIdentifierValues((current) => {
      const next = {};
      serialNumbers.forEach((serial) => {
        next[serial] = current[serial] ?? {};
      });
      return next;
    });
  }, [serialNumbers]);

  const handleSelectProduct = (product) => {
    setError('');
    setProductId(product.id);
    setProductSearch(product.name);
    setSerialText('');
    setTrackingIdentifierValues({});
    setQuantity('1');
  };

  const handleTrackingIdentifierValueChange = (serial, identifierType, value) => {
    const nextValue = sanitizeIdentifierValue(identifierType, value);

    setTrackingIdentifierValues((current) => ({
      ...current,
      [serial]: {
        ...(current[serial] ?? {}),
        [identifierType.identifierTypeId]: nextValue,
      },
    }));
  };

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

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!productId) {
      setError('اختر المنتج أولًا.');
      return;
    }

    if (isLoadingAttributes || isLoadingTrackingIdentifiers) {
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

    if (duplicateSerialNumbers.length) {
      setError('يوجد IMEI / Serial مكرر داخل الإدخال الحالي.');
      return;
    }

    if (isSerial && trackingIdentifierDefinitions.length) {
      for (const serial of serialNumbers) {
        for (const definition of trackingIdentifierDefinitions) {
          const value = String(trackingIdentifierValues[serial]?.[definition.identifierTypeId] ?? '').trim();
          if (definition.isRequired && !value) {
            setError(`أدخل قيمة "${definition.name}" للوحدة ${serial}.`);
            return;
          }
          const schemaValidation = validateIdentifierValueAgainstSchema(definition, value);
          if (schemaValidation !== true) {
            setError(schemaValidation);
            return;
          }
        }
      }
    }

    const invalidAttributeSelection = (variantContext?.attributes ?? []).find((attribute) => {
      const selectedValueId = attributeSelections[attribute.id];
      if (!selectedValueId) return false;
      return !(attribute.values ?? []).some((value) => value.id === selectedValueId);
    });

    if (invalidAttributeSelection) {
      setError(`قيمة "${invalidAttributeSelection.name}" غير صالحة.`);
      return;
    }

    const missingRequiredAttribute = (variantContext?.attributes ?? []).find(
      (attribute) => attribute.isRequired && !attributeSelections[attribute.id],
    );

    if (missingRequiredAttribute) {
      setError(`اختر قيمة "${missingRequiredAttribute.name}" قبل الحفظ.`);
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      const attributeValueIds = Object.values(attributeSelections).filter(Boolean);
      await inventoryService.addStock({
        tenantId,
        productId,
        attributeValueIds,
        quantity,
        serialNumbers,
        trackingIdentifierValuesBySerial: trackingIdentifierValues,
        userId,
      });
      onOpenChange(false);
      await onSaved?.();
    } catch (submitError) {
      setError(submitError.message || 'تعذر إضافة المخزون.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] w-full max-w-3xl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>إضافة مخزون</SheetTitle>
        </SheetHeader>
        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="grid gap-4 md:grid-cols-2">
            {isLoadingAttributes ? (
              <LoadingAttributesState />
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="inventory-product">المنتج</Label>
                  {productId && selectedProduct ? (
                    <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3">
                      <div className="min-w-0 truncate text-sm font-extrabold text-slate-950">{selectedProduct.name}</div>
                      <button
                        type="button"
                        onClick={() => {
                          setProductId('');
                          setProductSearch('');
                          setVariantContext(null);
                          setAttributeSelections({});
                          setSerialText('');
                          setTrackingIdentifierDefinitions([]);
                          setTrackingIdentifierValues({});
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
                        value={productSearch}
                        onChange={(event) => {
                          setProductSearch(event.target.value);
                          setProductId('');
                          setVariantContext(null);
                          setAttributeSelections({});
                          setTrackingIdentifierDefinitions([]);
                          setTrackingIdentifierValues({});
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
                      {productSearch.trim() && !hasExactProductMatch ? (
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

                {variantContext?.attributes?.length ? (
                  <>
                    {variantContext.attributes.map((attribute) => (
                      <div key={attribute.id} className="space-y-2">
                        <Label htmlFor={`inventory-attribute-${attribute.id}`}>{attribute.name}</Label>
                        <AttributeValuePicker
                          attribute={attribute}
                          value={attributeSelections[attribute.id] ?? ''}
                          onChange={(valueId) => setAttributeSelections((current) => ({ ...current, [attribute.id]: valueId }))}
                        />
                        {attribute.isRequired ? <div className="text-xs font-semibold text-amber-700">هذا الحقل مطلوب.</div> : null}
                      </div>
                    ))}
                  </>
                ) : null}

                {!productId ? null : isSerial ? (
                  <>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="inventory-serials">IMEI / Serial</Label>
                      <textarea
                        id="inventory-serials"
                        value={serialText}
                        onChange={(event) => setSerialText(event.target.value)}
                        placeholder="سطر لكل IMEI"
                        className="min-h-44 w-full rounded-xl border border-border bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      />
                      <div className="text-xs font-semibold text-slate-500">سيتم إضافة {serialNumbers.length} وحدة.</div>
                    </div>

                    {isLoadingTrackingIdentifiers ? (
                      <div className="flex min-h-28 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold text-slate-500 md:col-span-2">
                        جاري تحميل تعريفات التتبع...
                      </div>
                    ) : trackingIdentifierDefinitions.length && serialNumbers.length ? (
                      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 md:col-span-2">
                        <div>
                          <div className="text-sm font-extrabold text-slate-950">تعريفات التتبع</div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">تظهر حسب التصنيف المرتبط بالمنتج.</div>
                        </div>

                        <div className="space-y-4">
                          {serialNumbers.map((serial) => (
                            <div key={serial} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                              <div className="mb-3 text-xs font-extrabold text-slate-600" dir="ltr">{serial}</div>
                              <div className="grid gap-3 md:grid-cols-2">
                                {trackingIdentifierDefinitions.map((definition) => {
                                  const slots = getIdentifierSlots(definition);
                                  return (
                                    <div key={`${serial}-${definition.identifierTypeId}`} className="space-y-2">
                                      <Label htmlFor={`tracking-identifier-${serial}-${definition.identifierTypeId}`}>
                                        {definition.name}
                                        {definition.isRequired ? <span className="text-red-600"> *</span> : null}
                                      </Label>
                                      <Input
                                        id={`tracking-identifier-${serial}-${definition.identifierTypeId}`}
                                        type="text"
                                        inputMode={slots.length > 0 && slots.every((slot) => slot.type === 'numeric') ? 'numeric' : 'text'}
                                        maxLength={slots.length || undefined}
                                        value={trackingIdentifierValues[serial]?.[definition.identifierTypeId] ?? ''}
                                        onChange={(event) => handleTrackingIdentifierValueChange(serial, definition, event.target.value)}
                                        dir={slots.length > 0 ? 'ltr' : 'rtl'}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="inventory-quantity">الكمية</Label>
                    <Input id="inventory-quantity" type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                  </div>
                )}
              </>
            )}

            {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 md:col-span-2">{error}</div> : null}
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={isSubmitting || isLoadingAttributes || isLoadingTrackingIdentifiers || isCreatingProduct}>{isSubmitting ? 'جارٍ الإضافة...' : 'إضافة'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function AttributeValuePicker({ attribute, value, onChange }) {
  if (attribute.behavior === 'commercial' || attribute.displayType === 'buttons' || attribute.displayType === 'radio' || attribute.displayType === 'color') {
    return (
      <div className="flex flex-wrap gap-2">
        {!attribute.isRequired ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              !value ? 'border-[rgb(2,27,76)] bg-[rgb(2,27,76)] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            بدون
          </button>
        ) : null}
        {(attribute.values ?? []).map((item) => {
          const active = value === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                active ? 'border-[rgb(2,27,76)] bg-[rgb(2,27,76)] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {attribute.displayType === 'color' ? (
                <span
                  className={`inline-flex h-4 w-4 rounded-full border ${active ? 'border-white/70' : 'border-slate-300'}`}
                  style={{ backgroundColor: item.colorHex || '#cbd5e1' }}
                />
              ) : null}
              <span>{item.name}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <select
      id={`inventory-attribute-${attribute.id}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
    >
      <option value="">{attribute.isRequired ? 'اختر قيمة' : 'بدون'}</option>
      {(attribute.values ?? []).map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );
}

function LoadingAttributesState() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/80 text-center md:col-span-2">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[rgb(2,27,76)]" />
      <div className="mt-3 text-sm font-extrabold text-slate-950">جارٍ تحميل خصائص المنتج...</div>
    </div>
  );
}
