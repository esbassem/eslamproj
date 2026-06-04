import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, Loader2, PackagePlus, Search } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import {
  Sheet,
  SheetBody,
  SheetContent,
} from '@/core/ui/sheet';
import { inventoryService } from '@/features/inventory/api/inventory.api';
import { posService } from '@/features/pos/api/pos.api';
import { productCategoryAttributeService, productCategoryTrackingIdentifierService } from '@/features/products/api/products.api';

function getProductTitle(product) {
  return product?.displayName || product?.name || 'منتج بدون اسم';
}

function getProductCode(product) {
  return product?.code || product?.barcode || product?.sku || '';
}

function isSerialProduct(product) {
  return product?.tracking === 'serial';
}

function isTrackedProduct(product) {
  return product?.tracking === 'serial' || product?.tracking === 'lot';
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

const LICENSE_STATUS_OPTIONS = [
  { value: 'jawab', label: 'جواب' },
  { value: 'licensed', label: 'مرخص' },
];

function getInitialLicenseDraft() {
  return {
    status: '',
    number: '',
    issuedAt: '',
    expiresAt: '',
    issuingAuthority: '',
    notes: '',
  };
}

function getProductAttributeFields(product) {
  const saleFields = Array.isArray(product?.attributeFields) ? product.attributeFields : [];

  if (saleFields.length) {
    return saleFields.map((field, index) => ({
      key: String(field.key ?? field.attributeId ?? `attribute-${index}`),
      label: String(field.label ?? field.name ?? `خاصية ${index + 1}`),
      values: Array.isArray(field.values) ? field.values : [],
      isRequired: Boolean(field.isRequired) || field.behavior === 'commercial',
      createsVariant: field.createsVariant ?? true,
    }));
  }

  const rawAttributes = Array.isArray(product?.attributesJsonb) ? product.attributesJsonb : [];

  return rawAttributes
    .map((attribute, index) => {
      if (!attribute || typeof attribute !== 'object') return null;

      const key = attribute.id ?? attribute.attributeId ?? attribute.attribute_id ?? attribute.key ?? attribute.name ?? `attribute-${index}`;
      const label = attribute.label ?? attribute.name ?? attribute.attributeName ?? attribute.attribute_name ?? attribute.key ?? `خاصية ${index + 1}`;
      const value = attribute.value ?? attribute.valueName ?? attribute.value_name ?? attribute.selectedValue ?? attribute.selected_value ?? '';

      return {
        key: String(key),
        label: String(label),
        value: typeof value === 'string' ? value : String(value || ''),
        values: [],
        isRequired: false,
        createsVariant: false,
      };
    })
    .filter(Boolean)
    .filter((field) => !field.value.trim());
}

export function QuickStockUnitSheet({ open, onOpenChange, tenantId, userId, initialProductProductId, lockProductSelection = false, registrationMode = 'default', onSaved }) {
  const [products, setProducts] = useState([]);
  const [productsStatus, setProductsStatus] = useState('idle');
  const [productsError, setProductsError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [serialNumber, setSerialNumber] = useState('');
  const [attributeValues, setAttributeValues] = useState({});
  const [identifierDefinitions, setIdentifierDefinitions] = useState([]);
  const [identifierValues, setIdentifierValues] = useState({});
  const [unitAttributeFields, setUnitAttributeFields] = useState([]);
  const [attributeFieldsStatus, setAttributeFieldsStatus] = useState('idle');
  const [license, setLicense] = useState(getInitialLicenseDraft);
  const [chassisPhotoFile, setChassisPhotoFile] = useState(null);
  const [enginePhotoFile, setEnginePhotoFile] = useState(null);
  const [definitionsStatus, setDefinitionsStatus] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [step, setStep] = useState('product');
  const isJawabRegistration = registrationMode === 'jawab';

  const loadProducts = useCallback(async () => {
    if (!tenantId) {
      setProducts([]);
      setProductsStatus('idle');
      return;
    }

    setProductsStatus('loading');
    setProductsError('');

    try {
      const nextProducts = await posService.listSellProducts({ tenantId });
      setProducts(nextProducts.filter((product) => product.productType !== 'service'));
      setProductsStatus('ready');
    } catch (loadError) {
      setProducts([]);
      setProductsStatus('error');
      setProductsError(loadError.message || 'تعذر تحميل المنتجات.');
    }
  }, [tenantId]);

  useEffect(() => {
    if (!open) return;
    loadProducts();
  }, [loadProducts, open]);

  useEffect(() => {
    if (!open || !initialProductProductId || productsStatus !== 'ready' || selectedProduct) {
      return;
    }

    const initialProduct = products.find((product) => product.productProductId === initialProductProductId || product.id === initialProductProductId);
    if (initialProduct) {
      selectProduct(initialProduct);
    }
  }, [initialProductProductId, open, products, productsStatus, selectedProduct]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSelectedProduct(null);
      setQuantity('1');
      setSerialNumber('');
      setAttributeValues({});
      setIdentifierDefinitions([]);
      setIdentifierValues({});
      setUnitAttributeFields([]);
      setAttributeFieldsStatus('idle');
      setLicense(getInitialLicenseDraft());
      setChassisPhotoFile(null);
      setEnginePhotoFile(null);
      setDefinitionsStatus('idle');
      setError('');
      setNotice('');
      setIsSaving(false);
      setStep('product');
    }
  }, [open]);

  useEffect(() => {
    let mounted = true;

    if (!open || !tenantId || !selectedProduct || !isTrackedProduct(selectedProduct)) {
      setIdentifierDefinitions([]);
      setIdentifierValues({});
      setDefinitionsStatus('idle');
      return undefined;
    }

    setDefinitionsStatus('loading');
    setIdentifierDefinitions([]);
    setIdentifierValues({});

    productCategoryTrackingIdentifierService
      .listCategoryIdentifiers({ tenantId, categoryId: selectedProduct.categoryId })
      .then((definitions) => {
        if (!mounted) return;
        setIdentifierDefinitions(definitions || []);
        setIdentifierValues(Object.fromEntries((definitions || []).map((definition) => [definition.identifierTypeId, ''])));
        setDefinitionsStatus('ready');
      })
      .catch((definitionsError) => {
        if (!mounted) return;
        setIdentifierDefinitions([]);
        setDefinitionsStatus('error');
        setError(definitionsError.message || 'تعذر تحميل تعريفات السيريال.');
      });

    return () => {
      mounted = false;
    };
  }, [open, selectedProduct, tenantId]);

  useEffect(() => {
    if (!open || !selectedProduct || !isTrackedProduct(selectedProduct) || !unitAttributeFields.length) {
      return;
    }

    setAttributeValues((current) => {
      const next = { ...current };
      unitAttributeFields.forEach((field) => {
        if (!Object.prototype.hasOwnProperty.call(next, field.key)) {
          next[field.key] = '';
        }
      });
      return next;
    });
  }, [open, selectedProduct, unitAttributeFields]);

  useEffect(() => {
    let mounted = true;

    if (!open || !tenantId || !selectedProduct?.categoryId || !isTrackedProduct(selectedProduct)) {
      setUnitAttributeFields([]);
      setAttributeFieldsStatus('idle');
      return undefined;
    }

    setAttributeFieldsStatus('loading');
    setUnitAttributeFields([]);

    productCategoryAttributeService
      .listCategoryAttributes({ tenantId, categoryId: selectedProduct.categoryId })
      .then((fields) => {
        if (!mounted) return;
        setUnitAttributeFields((fields || []).map((field) => ({
          key: String(field.id),
          attributeId: field.id,
          label: field.name,
          displayType: field.displayType,
          values: Array.isArray(field.values) ? field.values : [],
          isRequired: Boolean(field.isRequired),
          createsVariant: false,
        })));
        setAttributeFieldsStatus('ready');
      })
      .catch((fieldsError) => {
        if (!mounted) return;
        setUnitAttributeFields([]);
        setAttributeFieldsStatus('error');
        setError(fieldsError.message || 'تعذر تحميل خصائص القطعة.');
      });

    return () => {
      mounted = false;
    };
  }, [open, selectedProduct, tenantId]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;

    return products.filter((product) =>
      [getProductTitle(product), getProductCode(product), product.barcode]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [products, search]);

  const selectedAttributeFields = useMemo(() => {
    if (isTrackedProduct(selectedProduct)) {
      return unitAttributeFields;
    }
    return getProductAttributeFields(selectedProduct);
  }, [selectedProduct, unitAttributeFields]);

  const stockAttributeValueIds = useMemo(
    () => {
      const selectedValueIds = selectedAttributeFields
        .map((field) => {
          const draftValue = String(attributeValues[field.key] || '').trim();
          if (!draftValue || !field.values?.length) return null;
          const selectedValue = field.values.find((value) => String(value.id) === draftValue);
          return selectedValue?.id ?? null;
        })
        .filter(Boolean);

      return [...new Set(selectedValueIds)];
    },
    [attributeValues, selectedAttributeFields, selectedProduct],
  );

  const trackingNumber = useMemo(() => {
    if (!isSerialProduct(selectedProduct)) return '';
    const values = identifierDefinitions
      .map((definition) => String(identifierValues[definition.identifierTypeId] || '').trim())
      .filter(Boolean);
    return values.length ? values.join(' - ') : serialNumber.trim();
  }, [identifierDefinitions, identifierValues, selectedProduct, serialNumber]);

  const missingIdentifierDefinition = useMemo(() => {
    if (!identifierDefinitions.length) return null;

    return identifierDefinitions.find((definition) => !String(identifierValues[definition.identifierTypeId] || '').trim()) || null;
  }, [identifierDefinitions, identifierValues]);

  const canSave = useMemo(() => {
    if (step !== 'details' || !tenantId || !selectedProduct || definitionsStatus === 'loading' || attributeFieldsStatus === 'loading' || isSaving) {
      return false;
    }

    if (!isTrackedProduct(selectedProduct)) {
      return false;
    }

    if (isSerialProduct(selectedProduct) && !trackingNumber) {
      return false;
    }

    if (selectedProduct.tracking === 'lot' && !trackingNumber) {
      return false;
    }

    if (missingIdentifierDefinition) {
      return false;
    }

    const missingRequiredAttribute = selectedAttributeFields.some((field) => field.isRequired && !String(attributeValues[field.key] || '').trim());
    if (missingRequiredAttribute) {
      return false;
    }

    if (selectedProduct.requiresLicense) {
      if (!isTrackedProduct(selectedProduct) || !license.status) {
        return false;
      }

      if (!isJawabRegistration && license.status === 'licensed' && (!String(license.number || '').trim() || !license.expiresAt)) {
        return false;
      }
    }

    return true;
  }, [attributeFieldsStatus, attributeValues, definitionsStatus, isJawabRegistration, isSaving, license, missingIdentifierDefinition, selectedAttributeFields, selectedProduct, step, tenantId, trackingNumber]);

  const selectProduct = (product) => {
    const attributes = Object.fromEntries(getProductAttributeFields(product).map((field) => [field.key, '']));
    setSelectedProduct(product);
    setStep('details');
    setQuantity('1');
    setSerialNumber('');
    setAttributeValues(attributes);
    setIdentifierDefinitions([]);
    setIdentifierValues({});
    setUnitAttributeFields([]);
    setAttributeFieldsStatus('idle');
    setLicense(isJawabRegistration ? { ...getInitialLicenseDraft(), status: 'jawab' } : getInitialLicenseDraft());
    setChassisPhotoFile(null);
    setEnginePhotoFile(null);
    setError('');
    setNotice('');
  };

  const updateLicense = (field, value) => {
    setLicense((current) => ({ ...current, [field]: value }));
    setError('');
  };

  const handleSave = async () => {
    if (!tenantId) {
      setError('لا توجد شركة نشطة.');
      return;
    }

    if (!selectedProduct) {
      setError('اختر منتجًا أولاً.');
      return;
    }

    if (isTrackedProduct(selectedProduct) && !trackingNumber) {
      setError('أدخل بيانات السيريال/التتبع للوحدة.');
      return;
    }

    if (missingIdentifierDefinition) {
      setError(`أدخل ${missingIdentifierDefinition.name} قبل تسجيل الوحدة.`);
      return;
    }

    const missingRequiredAttribute = selectedAttributeFields.find((field) => field.isRequired && !String(attributeValues[field.key] || '').trim());
    if (missingRequiredAttribute) {
      setError(`حدد ${missingRequiredAttribute.label} قبل تسجيل الوحدة.`);
      return;
    }

    const effectiveLicense = isJawabRegistration ? { ...license, status: 'jawab' } : license;

    if (selectedProduct.requiresLicense) {
      if (!isSerialProduct(selectedProduct)) {
        setError('هذا المنتج يحتاج ترخيص ويجب تسجيله كقطعة متتبعة.');
        return;
      }

      if (!effectiveLicense.status) {
        setError('اختر حالة الترخيص.');
        return;
      }

      if (effectiveLicense.status === 'licensed' && !String(effectiveLicense.number || '').trim()) {
        setError('أدخل رقم الرخصة عندما تكون الحالة مرخص.');
        return;
      }

      if (effectiveLicense.status === 'licensed' && !effectiveLicense.expiresAt) {
        setError('أدخل تاريخ انتهاء الترخيص عندما تكون الحالة مرخص.');
        return;
      }
    }

    setIsSaving(true);
    setError('');
    setNotice('');

    try {
      const activeProductProductId = selectedProduct.productProductId || selectedProduct.id;
      const productProductId = stockAttributeValueIds.length ? null : activeProductProductId;
      const textAttributeRows = selectedAttributeFields
        .map((field) => {
          const draftValue = String(attributeValues[field.key] || '').trim();
          if (!draftValue || field.values?.length || !isUuid(field.key)) return null;

          return {
            attributeId: field.key,
            valueText: draftValue,
          };
        })
        .filter(Boolean);
      const serialValues = trackingNumber
        ? {
            [trackingNumber]: identifierValues,
          }
        : {};
      const trackingUnitAttributesBySerial =
        isTrackedProduct(selectedProduct) && trackingNumber
          ? {
              [trackingNumber]: selectedAttributeFields
                .map((field) => {
                  const draftValue = String(attributeValues[field.key] || '').trim();
                  if (!draftValue || field.values?.length || !isUuid(field.key)) return null;

                  return {
                    attributeId: field.key,
                    valueText: draftValue,
                  };
                })
                .filter(Boolean),
            }
          : {};

      const result = await inventoryService.addStock({
        tenantId,
        productId: activeProductProductId,
        productProductId,
        attributeValueIds: stockAttributeValueIds,
        textAttributeRows,
        quantity: Number(quantity) || 1,
        serialNumbers: isTrackedProduct(selectedProduct) ? [trackingNumber] : [],
        trackingIdentifierValuesBySerial: serialValues,
        trackingUnitAttributesBySerial,
        userId,
      });

      if (selectedProduct.requiresLicense || isJawabRegistration) {
        const units = result.units || [];
        if (!units.length) {
          throw new Error('تعذر تحديد القطعة الجديدة لحفظ حالة الجواب.');
        }

        await Promise.all(units.map((unit) => inventoryService.saveTrackingUnitLicense({
          tenantId,
          trackingUnitId: unit.id,
          license: effectiveLicense,
          userId,
        })));
      }

      if (isTrackedProduct(selectedProduct) && (chassisPhotoFile || enginePhotoFile)) {
        const units = result.units || [];
        if (!units.length) {
          throw new Error('تعذر تحديد القطعة الجديدة لحفظ صور الشاسيه والموتور.');
        }

        await Promise.all(units.flatMap((unit) => [
          chassisPhotoFile ? inventoryService.saveTrackingUnitAttachment({
            tenantId,
            trackingUnitId: unit.id,
            documentType: 'chassis_photo',
            file: chassisPhotoFile,
            userId,
          }) : null,
          enginePhotoFile ? inventoryService.saveTrackingUnitAttachment({
            tenantId,
            trackingUnitId: unit.id,
            documentType: 'engine_photo',
            file: enginePhotoFile,
            userId,
          }) : null,
        ].filter(Boolean)));
      }

      const successNotice = isTrackedProduct(selectedProduct) ? 'تم تسجيل الوحدة وأصبحت جاهزة للبيع.' : 'تمت إضافة الكمية إلى المخزون.';
      await onSaved?.(result);
      setNotice(successNotice);
      setSelectedProduct(null);
      setQuantity('1');
      setSerialNumber('');
      setAttributeValues({});
      setIdentifierDefinitions([]);
      setIdentifierValues({});
      setLicense(getInitialLicenseDraft());
      setChassisPhotoFile(null);
      setEnginePhotoFile(null);
      setStep('product');
      await loadProducts();
    } catch (saveError) {
      setError(saveError.message || 'تعذر تسجيل الوحدة.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-full border-l border-slate-200 bg-white sm:max-w-[560px]" dir="rtl">
        <SheetBody className="flex min-h-0 flex-col gap-5 bg-white px-6 py-6 text-slate-950">
          <div className="-mx-6 -mt-6 border-b border-slate-200 bg-[#edf2f7] px-6 py-4 shadow-[0_10px_28px_-28px_rgba(15,23,42,0.5)]">
            <p className="text-right text-sm font-black text-slate-950">تسجيل وحدة فعلية</p>
            {step === 'details' && selectedProduct ? (
              <div className="mt-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-black text-slate-950">{getProductTitle(selectedProduct)}</h3>
                  <p className="mt-1 truncate text-xs font-bold text-slate-500">{getProductCode(selectedProduct) || 'بدون كود'}</p>
                  {selectedProduct.requiresLicense && !isJawabRegistration ? (
                    <span className="mt-2 inline-flex rounded-full border border-slate-300 bg-white/70 px-2.5 py-1 text-[10px] font-black text-slate-700">
                      يحتاج ترخيص
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {!lockProductSelection ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProduct(null);
                        setStep('product');
                        setAttributeValues({});
                        setLicense(isJawabRegistration ? { ...getInitialLicenseDraft(), status: 'jawab' } : getInitialLicenseDraft());
                        setError('');
                        setNotice('');
                      }}
                      className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
                    >
                      <ArrowRight className="h-4 w-4" />
                      تغيير
                    </button>
                  ) : null}
                  <Button
                    type="button"
                    onClick={handleSave}
                    disabled={!canSave}
                    className="h-9 rounded-xl bg-slate-950 px-3 text-xs font-black text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        جاري التسجيل
                      </>
                    ) : (
                      <>
                        <PackagePlus className="h-4 w-4" />
                        تسجيل الوحدة
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {step === 'product' ? (
            <div className="-mx-6 -mb-6 flex min-h-0 flex-1 flex-col gap-4 bg-[#edf2f7] px-6 pb-6">
              <div className="relative">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ابحث عن منتج"
                  className="h-11 border-slate-400/20 bg-[#edf2f7]/70 pr-9 font-bold text-slate-950 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.65)] backdrop-blur placeholder:text-slate-500 focus:border-slate-400/35 focus:bg-[#edf2f7]/90"
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-400/15 bg-[#edf2f7]/55 shadow-[0_22px_48px_-42px_rgba(15,23,42,0.7)] backdrop-blur">
                {productsStatus === 'loading' ? (
                  <div className="flex items-center gap-2 px-4 py-5 text-sm font-black text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري تحميل المنتجات
                  </div>
                ) : productsStatus === 'error' ? (
                  <div className="px-4 py-4 text-sm font-black text-red-700">{productsError}</div>
                ) : filteredProducts.length ? (
                  filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => selectProduct(product)}
                      className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-400/15 bg-[#edf2f7]/35 px-4 py-3 text-right text-slate-700 transition last:border-b-0 hover:bg-[#edf2f7]/85 hover:text-slate-950"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black">{getProductTitle(product)}</span>
                        <span className="mt-0.5 block truncate text-xs font-bold text-slate-500">{getProductCode(product) || 'بدون كود'}</span>
                      </span>
                      <span className={`rounded-lg border px-2.5 py-1 text-xs font-black ${product.tracking === 'serial' ? 'border-blue-100 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                        {product.tracking === 'serial' ? 'Serial' : 'كمية'}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-5 text-center text-sm font-black text-slate-400">لا توجد منتجات مطابقة.</div>
                )}
              </div>
            </div>
          ) : null}

          {step === 'details' && selectedProduct ? (
            <div className="space-y-5">
              {selectedAttributeFields.length ? (
                <div className="space-y-3">
                  {attributeFieldsStatus === 'loading' ? (
                    <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-3 text-sm font-black text-blue-700">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جاري تحميل خصائص القطعة
                    </div>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {selectedAttributeFields.map((field) => (
                      <div key={field.key} className="min-w-0">
                        <label className="mb-2 block text-xs font-black text-slate-600">
                          {field.label}
                          {field.isRequired ? <span className="text-red-500"> *</span> : null}
                        </label>

                        {field.values?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {!field.isRequired ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setAttributeValues((current) => ({ ...current, [field.key]: '' }));
                                  setError('');
                                }}
                                className={`rounded-lg border px-3 py-2 text-xs font-black transition ${
                                  !attributeValues[field.key]
                                    ? 'border-slate-950 bg-slate-950 text-white'
                                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950'
                                }`}
                              >
                                بدون اختيار
                              </button>
                            ) : null}
                            {field.values.map((option) => {
                              const optionId = String(option.id);
                              const selected = String(attributeValues[field.key] || '') === optionId;

                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => {
                                    setAttributeValues((current) => ({ ...current, [field.key]: optionId }));
                                    setError('');
                                  }}
                                  className={`rounded-lg border px-3 py-2 text-xs font-black transition ${
                                    selected
                                      ? 'border-slate-950 bg-slate-950 text-white shadow-[0_12px_24px_-18px_rgba(15,23,42,0.9)]'
                                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                                  }`}
                                >
                                  {option.name}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <Input
                            value={attributeValues[field.key] || ''}
                            onChange={(event) => {
                              setAttributeValues((current) => ({ ...current, [field.key]: event.target.value }));
                              setError('');
                            }}
                            placeholder={`حدد ${field.label}`}
                            className="h-10 border-slate-200 bg-white font-bold text-slate-950 placeholder:text-slate-400 focus:border-slate-400"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {!isTrackedProduct(selectedProduct) ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-700">
                  هذا المنتج لا يحتاج تتبع فردي ولا يمكن تسجيل قطعة فريدة له.
                </div>
              ) : (
                <div className="space-y-3">
                  {definitionsStatus === 'loading' ? (
                    <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-3 text-sm font-black text-blue-700">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جاري تحميل حقول التتبع
                    </div>
                  ) : null}

                  {identifierDefinitions.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {identifierDefinitions.map((definition) => (
                        <div key={definition.identifierTypeId}>
                          <label className="mb-2 block text-xs font-black text-slate-600">
                            {definition.name}
                            <span className="text-red-500"> *</span>
                          </label>
                          <Input
                            value={identifierValues[definition.identifierTypeId] || ''}
                            onChange={(event) => {
                              setIdentifierValues((current) => ({
                                ...current,
                                [definition.identifierTypeId]: event.target.value,
                              }));
                              setError('');
                            }}
                            placeholder={definition.name}
                            className="h-11 border-slate-200 bg-white font-bold text-slate-950 placeholder:text-slate-400 focus:border-slate-400"
                            dir="ltr"
                          />
                        </div>
                      ))}
                    </div>
                  ) : definitionsStatus !== 'loading' ? (
                    <div>
                      <label className="mb-2 block text-xs font-black text-slate-600">{selectedProduct.tracking === 'lot' ? 'رقم اللوت' : 'رقم السيريال'}</label>
                      <Input
                        value={serialNumber}
                        onChange={(event) => {
                          setSerialNumber(event.target.value);
                          setError('');
                        }}
                        placeholder={selectedProduct.tracking === 'lot' ? 'Lot Number' : 'Serial / IMEI'}
                        className="h-11 border-slate-200 bg-white font-bold text-slate-950 placeholder:text-slate-400 focus:border-slate-400"
                        dir="ltr"
                      />
                    </div>
                  ) : null}

                  {trackingNumber ? (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left font-mono text-xs font-bold text-slate-600" dir="ltr">
                      {trackingNumber}
                    </div>
                  ) : null}

                  {!isJawabRegistration ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block rounded-xl border border-slate-200 bg-white px-3 py-3">
                        <span className="mb-2 block text-xs font-black text-slate-600">
                          صورة رقم الشاسيه
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(event) => {
                            setChassisPhotoFile(event.target.files?.[0] || null);
                            setError('');
                          }}
                          className="block w-full text-xs font-bold text-slate-500 file:ml-3 file:rounded-lg file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-xs file:font-black file:text-white"
                        />
                        <span className="mt-2 block truncate text-[11px] font-bold text-slate-400">
                          {chassisPhotoFile?.name || 'غير مرفقة'}
                        </span>
                      </label>

                      <label className="block rounded-xl border border-slate-200 bg-white px-3 py-3">
                        <span className="mb-2 block text-xs font-black text-slate-600">
                          صورة رقم الموتور
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(event) => {
                            setEnginePhotoFile(event.target.files?.[0] || null);
                            setError('');
                          }}
                          className="block w-full text-xs font-bold text-slate-500 file:ml-3 file:rounded-lg file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-xs file:font-black file:text-white"
                        />
                        <span className="mt-2 block truncate text-[11px] font-bold text-slate-400">
                          {enginePhotoFile?.name || 'غير مرفقة'}
                        </span>
                      </label>
                    </div>
                  ) : null}
                </div>
              )}

              {selectedProduct.requiresLicense || isJawabRegistration ? (
                <div className="space-y-4 border-t border-slate-200 pt-4">
                  <div className="flex flex-wrap gap-3">
                    {(isJawabRegistration ? LICENSE_STATUS_OPTIONS.filter((option) => option.value === 'jawab') : LICENSE_STATUS_OPTIONS).map((option) => {
                      const active = license.status === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            if (!isJawabRegistration) {
                              updateLicense('status', option.value);
                            }
                          }}
                          disabled={isJawabRegistration}
                          className={`flex h-16 w-24 flex-col items-center justify-center gap-1 rounded-xl border text-center transition ${
                            active
                              ? 'border-slate-900 bg-slate-900 text-white shadow-[0_18px_34px_-26px_rgba(15,23,42,0.85)]'
                              : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                          } disabled:cursor-default`}
                        >
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                              active ? 'border-white/25 bg-white/15 text-white' : 'border-slate-200 bg-slate-50 text-transparent'
                            }`}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </span>
                          <span className="text-sm font-black">{option.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {!isJawabRegistration && license.status === 'licensed' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-xs font-black text-slate-600">رقم الرخصة</span>
                        <Input
                          value={license.number}
                          onChange={(event) => updateLicense('number', event.target.value)}
                          placeholder="رقم الرخصة"
                          className="h-11 border-slate-200 bg-white font-bold text-slate-950 placeholder:text-slate-400 focus:border-slate-400"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-xs font-black text-slate-600">تاريخ انتهاء الترخيص</span>
                        <Input
                          type="date"
                          value={license.expiresAt}
                          onChange={(event) => updateLicense('expiresAt', event.target.value)}
                          className="h-11 border-slate-200 bg-white font-bold text-slate-950 focus:border-slate-400"
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="mb-2 block text-xs font-black text-slate-600">جهة الإصدار</span>
                        <Input
                          value={license.issuingAuthority}
                          onChange={(event) => updateLicense('issuingAuthority', event.target.value)}
                          placeholder="مرور ايه"
                          className="h-11 border-slate-200 bg-white font-bold text-slate-950 placeholder:text-slate-400 focus:border-slate-400"
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">
              {error}
            </div>
          ) : null}

          {notice ? (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {notice}
            </div>
          ) : null}

        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
