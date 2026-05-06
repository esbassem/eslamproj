import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Minus, Plus, Search, Trash2, User, UserPlus } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDismissButton, SheetFooter, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { PartnerFormSheet } from '@/features/contacts/components/PartnerFormSheet';
import { partnersService } from '@/features/contacts/services/partners.service';
import { posService } from '@/features/pos/api/pos.api';
import { productCategoryTrackingIdentifierService } from '@/features/products/api/products.api';
import { ShowroomContractPreview } from '@/features/showroom/components/ShowroomContractPreview';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const STEPS = ['العميل', 'المنتجات', 'الدفع', 'العقد'];

const NEW_CUSTOMER_INITIAL_VALUES = {
  isCustomer: true,
  isSupplier: false,
};

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG')} EGP`;
}

function getProductTitle(product) {
  return product?.displayName || product?.name || product?.description || 'منتج';
}

function getProductCode(product) {
  return product?.code || product?.barcode || 'بدون كود';
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
      };
    })
    .filter(Boolean)
    .filter((field) => !field.value.trim());
}

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
    return definition.dataType === 'numeric'
      ? String(value ?? '').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
      : String(value ?? '');
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

function validateIdentifierValue(definition, value) {
  const safeValue = String(value ?? '').trim();
  const slots = getIdentifierSlots(definition);

  if (definition.isRequired && !safeValue) {
    return `أدخل قيمة "${definition.name}".`;
  }

  if (!safeValue) return true;

  if (!slots.length && definition.dataType === 'numeric' && !/^\d+(\.\d+)?$/.test(safeValue)) {
    return `قيمة "${definition.name}" يجب أن تكون رقمية.`;
  }

  if (slots.length && Array.from(safeValue).length !== slots.length) {
    return `قيمة "${definition.name}" يجب أن تكون ${slots.length} خانة.`;
  }

  const invalidIndex = Array.from(safeValue).findIndex((character, index) => !isAllowedIdentifierCharacter(character, slots[index]?.type));
  if (invalidIndex >= 0) {
    return `الخانة ${invalidIndex + 1} في "${definition.name}" لا تطابق نوع الخانة المطلوب.`;
  }

  return true;
}

export function ShowroomSalesCard({ onSaleCreated }) {
  const { tenant } = useWorkspace();
  const [step, setStep] = useState(0);
  const [customerName, setCustomerName] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [isCustomersLoading, setIsCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState('');
  const [isCustomerSheetOpen, setIsCustomerSheetOpen] = useState(false);
  const [isCustomerSubmitting, setIsCustomerSubmitting] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [cart, setCart] = useState([]);
  const [message, setMessage] = useState('');
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [pendingProduct, setPendingProduct] = useState(null);
  const [productDraft, setProductDraft] = useState({ price: '', trackingIdentifiers: {}, attributes: {} });
  const [trackingIdentifierDefinitions, setTrackingIdentifierDefinitions] = useState([]);
  const [isTrackingIdentifiersLoading, setIsTrackingIdentifiersLoading] = useState(false);
  const [productSheetError, setProductSheetError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [contractNote, setContractNote] = useState('');
  const [isContractSheetOpen, setIsContractSheetOpen] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const loadCustomers = useCallback(async () => {
    if (!tenant?.id) {
      setCustomers([]);
      setIsCustomersLoading(false);
      return;
    }

    setIsCustomersLoading(true);
    setCustomersError('');

    try {
      const data = await partnersService.getPartners({
        tenantId: tenant.id,
        filterType: 'customer',
        search: customerName,
        status: 'active',
      });
      setCustomers(data);
    } catch (error) {
      setCustomersError(error.message || 'تعذر تحميل العملاء.');
    } finally {
      setIsCustomersLoading(false);
    }
  }, [tenant?.id, customerName]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadCustomers();
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [loadCustomers]);

  const loadProducts = useCallback(async () => {
    if (!tenant?.id) {
      setProducts([]);
      setIsProductsLoading(false);
      return;
    }

    setIsProductsLoading(true);
    setProductsError('');

    try {
      const nextProducts = await posService.listSellProducts({ tenantId: tenant.id });
      setProducts(nextProducts);
    } catch (error) {
      setProducts([]);
      setProductsError(error.message || 'تعذر تحميل المنتجات.');
    } finally {
      setIsProductsLoading(false);
    }
  }, [tenant?.id]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) => `${product.name} ${product.displayName ?? ''} ${product.code} ${product.barcode ?? ''}`.toLowerCase().includes(query));
  }, [productSearch, products]);

  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);
  const hasPaidAmount = paidAmount !== '';
  const remainingAmount = Math.max(total - (Number(paidAmount) || 0), 0);
  const hasNoRemainingAmount = hasPaidAmount && remainingAmount <= 0;
  const customer = selectedCustomer;
  const pendingAttributeFields = useMemo(() => getProductAttributeFields(pendingProduct), [pendingProduct]);

  useEffect(() => {
    let mounted = true;

    if (!productSheetOpen || !tenant?.id || !pendingProduct?.categoryId || pendingProduct?.tracking !== 'serial') {
      setTrackingIdentifierDefinitions([]);
      setIsTrackingIdentifiersLoading(false);
      return undefined;
    }

    setIsTrackingIdentifiersLoading(true);
    setTrackingIdentifierDefinitions([]);

    productCategoryTrackingIdentifierService
      .listCategoryIdentifiers({ tenantId: tenant.id, categoryId: pendingProduct.categoryId })
      .then((definitions) => {
        if (!mounted) return;
        setTrackingIdentifierDefinitions(definitions);
        setProductDraft((current) => ({
          ...current,
          trackingIdentifiers: Object.fromEntries((definitions ?? []).map((definition) => [definition.identifierTypeId, current.trackingIdentifiers?.[definition.identifierTypeId] ?? ''])),
        }));
      })
      .catch((error) => {
        if (!mounted) return;
        setTrackingIdentifierDefinitions([]);
        setProductSheetError(error.message || 'تعذر تحميل تعريفات التتبع.');
      })
      .finally(() => {
        if (!mounted) return;
        setIsTrackingIdentifiersLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [pendingProduct?.categoryId, pendingProduct?.tracking, productSheetOpen, tenant?.id]);

  const selectCustomer = (nextCustomer) => {
    setSelectedCustomer(nextCustomer);
    setCustomerName(nextCustomer.name);
    setMessage('');
  };

  const createCustomer = async (payload) => {
    if (!tenant?.id) {
      return { ok: false, error: 'لا توجد شركة نشطة.' };
    }

    try {
      setIsCustomerSubmitting(true);
      const createdCustomer = await partnersService.createPartner({
        tenantId: tenant.id,
        ...payload,
        isCustomer: true,
        customerRank: 1,
        isSupplier: Boolean(payload.isSupplier),
        supplierRank: payload.isSupplier ? 1 : 0,
      });
      setCustomers((current) => [createdCustomer, ...current.filter((item) => item.id !== createdCustomer.id)]);
      selectCustomer(createdCustomer);
      setIsCustomerSheetOpen(false);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'تعذر إضافة العميل.' };
    } finally {
      setIsCustomerSubmitting(false);
    }
  };

  const addProduct = (product) => {
    setCart((current) => {
      const productLineId = product.lineId || product.id;
      const existing = current.find((item) => (item.lineId || item.id) === productLineId);
      if (existing) {
        return current.map((item) => ((item.lineId || item.id) === productLineId ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...current, { ...product, lineId: productLineId, quantity: 1 }];
    });
    setMessage('');
  };

  const updateQuantity = (lineId, nextQuantity) => {
    if (nextQuantity <= 0) {
      setCart((current) => current.filter((item) => (item.lineId || item.id) !== lineId));
      return;
    }
    setCart((current) => current.map((item) => ((item.lineId || item.id) === lineId ? { ...item, quantity: nextQuantity } : item)));
  };

  const openProductSheet = (product) => {
    const attributes = Object.fromEntries(getProductAttributeFields(product).map((field) => [field.key, '']));

    setPendingProduct(product);
    setProductDraft({
      price: String(product.price ?? 0),
      trackingIdentifiers: {},
      ownershipTransferName: '',
      attributes,
    });
    setTrackingIdentifierDefinitions([]);
    setIsTrackingIdentifiersLoading(false);
    setProductSheetError('');
    setMessage('');
    setProductSheetOpen(true);
  };

  const closeProductSheet = (open) => {
    setProductSheetOpen(open);
    if (!open) {
      setPendingProduct(null);
      setProductDraft({ price: '', trackingIdentifiers: {}, ownershipTransferName: '', attributes: {} });
      setTrackingIdentifierDefinitions([]);
      setIsTrackingIdentifiersLoading(false);
      setProductSheetError('');
    }
  };

  const handleTrackingIdentifierChange = (definition, value) => {
    const nextValue = sanitizeIdentifierValue(definition, value);
    setProductDraft((current) => ({
      ...current,
      trackingIdentifiers: {
        ...(current.trackingIdentifiers ?? {}),
        [definition.identifierTypeId]: nextValue,
      },
    }));
    setProductSheetError('');
  };

  const confirmProductSelection = () => {
    if (!pendingProduct) return;

    const price = Number(productDraft.price);
    if (!Number.isFinite(price) || price < 0) {
      setProductSheetError('أدخل سعرًا صحيحًا للمنتج.');
      return;
    }

    if (isTrackingIdentifiersLoading) {
      setProductSheetError('انتظر حتى يتم تحميل تعريفات التتبع.');
      return;
    }

    if (pendingProduct.tracking === 'serial') {
      for (const definition of trackingIdentifierDefinitions) {
        const value = String(productDraft.trackingIdentifiers?.[definition.identifierTypeId] ?? '').trim();
        const validation = validateIdentifierValue(definition, value);
        if (validation !== true) {
          setProductSheetError(validation);
          return;
        }
      }
    }

    const missingRequiredAttribute = pendingAttributeFields.find((field) => field.isRequired && !String(productDraft.attributes[field.key] || '').trim());
    if (missingRequiredAttribute) {
      setProductSheetError(`حدد ${missingRequiredAttribute.label} قبل إضافة المنتج.`);
      return;
    }

    const configuredAttributes = pendingAttributeFields
      .map((field) => {
        const draftValue = String(productDraft.attributes[field.key] || '').trim();
        const selectedValue = field.values?.find((value) => value.id === draftValue);

        return {
          key: field.key,
          attributeId: field.key,
          label: field.label,
          value: selectedValue?.name || draftValue,
          valueId: selectedValue?.id ?? null,
          createsVariant: field.createsVariant ?? true,
        };
      })
      .filter((field) => field.value);
    const trackingIdentifiers = trackingIdentifierDefinitions
      .map((definition) => ({
        identifierTypeId: definition.identifierTypeId,
        label: definition.name,
        code: definition.code,
        value: String(productDraft.trackingIdentifiers?.[definition.identifierTypeId] ?? '').trim(),
      }))
      .filter((identifier) => identifier.value);

    addProduct({
      ...pendingProduct,
      name: getProductTitle(pendingProduct),
      code: getProductCode(pendingProduct),
      price,
      serialNumber: trackingIdentifiers.map((identifier) => identifier.value).join(' - '),
      trackingIdentifiers,
      ownershipTransferName: productDraft.ownershipTransferName.trim(),
      configuredAttributes,
      lineId: `${pendingProduct.id}-${Date.now()}`,
    });
    closeProductSheet(false);
  };

  const next = () => {
    if (step === 0 && !selectedCustomer) {
      setMessage('اختر عميلًا مسجلًا أولًا أو أضف عميلًا جديدًا.');
      return;
    }
    if (step === 1 && !cart.length) {
      setMessage('أضف منتجًا واحدًا على الأقل.');
      return;
    }
    setMessage('');
    if (step === 1) {
      setPaidAmount('');
      setPaymentMethod('');
      setContractNote('');
    }
    setStep((current) => Math.min(current + 1, 2));
  };

  const back = () => {
    setMessage('');
    if (step === 3) {
      setIsContractSheetOpen(false);
      setStep(2);
      return;
    }
    setStep((current) => Math.max(current - 1, 0));
  };

  const updatePaidAmount = (value) => {
    if (value === '') {
      setPaidAmount('');
      return;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    setPaidAmount(String(Math.min(Math.max(numericValue, 0), total)));
  };

  const reset = () => {
    setStep(0);
    setCustomerName('');
    setSelectedCustomer(null);
    setProductSearch('');
    setCart([]);
    setMessage('');
    setPaymentMethod('');
    setPaidAmount('');
    setContractNote('');
    setIsContractSheetOpen(false);
  };

  const openContractPreview = () => {
    if (!customer || !cart.length) return;
    setMessage('');
    setStep(3);
    setIsContractSheetOpen(true);
  };

  const complete = async () => {
    if (!customer || !cart.length || isCompleting) return;
    const paid = Number(paidAmount) || 0;
    setMessage('');
    setIsCompleting(true);

    try {
      const result = await onSaleCreated?.({
        customer,
        items: cart,
        totalAmount: total,
        paidAmount: paid,
        contractNote: contractNote.trim(),
        paymentMethodId: paymentMethod.trim(),
      });

      if (result?.ok === false) {
        setMessage(result.error || 'تعذر حفظ عملية البيع.');
        return;
      }

      reset();
    } catch (error) {
      setMessage(error.message || 'تعذر حفظ عملية البيع.');
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <section className="flex h-[min(620px,calc(100vh-9rem))] flex-col bg-white text-[#173653]">
      <header className="border-b border-[#c5ddef] bg-[#edf5fc] px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-wide text-[#2f86cf]">Showroom POS</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">عملية بيع</h1>
          </div>
        </div>
      </header>

      {message && (
        <div className="mx-5 mt-4 rounded-xl border border-[#c5ddef] bg-[#eef6fc] px-4 py-3 text-sm font-black text-[#173653] sm:mx-7">
          {message}
        </div>
      )}

      <div className={`flex-1 bg-white ${step === 1 ? 'overflow-hidden' : 'overflow-y-auto px-5 py-4 sm:px-7'}`}>
        <div className={`mx-auto w-full ${step === 1 ? 'h-full max-w-none' : 'max-w-[620px]'}`}>
          {step === 0 && (
            <div className="mx-auto w-full max-w-[520px]">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#668097]" />
                  <Input
                    value={customerName}
                    onChange={(event) => {
                      setCustomerName(event.target.value);
                      setSelectedCustomer(null);
                      setMessage('');
                    }}
                    placeholder="ابحث عن عميل"
                    className="h-[52px] rounded-xl border border-[#c5ddef] bg-[#f7fbff] px-5 pr-11 text-base font-bold text-[#173653] placeholder:text-[#668097] focus:border-[#2f86cf] focus:ring-[#d8ecfb]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setIsCustomerSheetOpen(true)}
                  className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-[#c5ddef] bg-white text-[#2f86cf] transition hover:bg-[#eef6fc] focus:outline-none focus:ring-4 focus:ring-[#d8ecfb]"
                  aria-label="إضافة عميل جديد"
                  title="إضافة عميل جديد"
                >
                  <UserPlus className="h-5 w-5" />
                </button>
              </div>

              {customersError ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                  {customersError}
                </div>
              ) : null}

              {isCustomersLoading ? (
                <div className="mt-4 rounded-xl border border-[#c5ddef] bg-[#f7fbff] px-5 py-4 text-sm font-bold text-[#668097]">
                  جاري تحميل العملاء...
                </div>
              ) : customers.length > 0 ? (
                <div className="mt-4 max-h-[260px] overflow-y-auto rounded-xl border border-[#c5ddef] bg-white shadow-[0_18px_34px_-30px_rgba(23,54,83,0.45)]">
                  {customers.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => selectCustomer(result)}
                      className={`grid w-full grid-cols-[1fr_auto] items-center gap-4 border-b border-[#e3edf6] px-4 py-3 text-right transition last:border-b-0 hover:bg-[#f7fbff] ${
                        selectedCustomer?.id === result.id ? 'bg-[#eef6fc] text-[#173653]' : 'text-[#173653]'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-black">{result.name}</span>
                          {selectedCustomer?.id === result.id ? (
                            <span className="rounded-full bg-[#2f86cf] px-2 py-0.5 text-[10px] font-black text-white">مختار</span>
                          ) : null}
                        </span>
                        <span className="mt-1 grid grid-cols-[76px_1fr] gap-2 text-xs font-bold text-[#668097]">
                          <span className="text-[#8aa0b3]">الهاتف</span>
                          <span className="truncate">{result.phone || 'بدون رقم هاتف'}</span>
                        </span>
                        {result.notes ? (
                          <span className="mt-1 grid grid-cols-[76px_1fr] gap-2 text-[11px] font-bold text-[#8aa0b3]">
                            <span>ملاحظة</span>
                            <span className="truncate">{result.notes}</span>
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                          selectedCustomer?.id === result.id ? 'border-[#2f86cf] bg-[#2f86cf] text-white' : 'border-[#d8e8f5] bg-[#f7fbff] text-transparent'
                        }`}
                      >
                        <Check className="h-4 w-4" />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-[#c5ddef] bg-[#f7fbff] px-5 py-4 text-sm font-bold text-[#668097]">
                  لا يوجد عملاء مطابقون.
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="h-full w-full">
              <div className="grid h-full md:grid-cols-[1fr_300px]" dir="ltr">
                <SelectedProductsPanel cart={cart} onUpdateQuantity={updateQuantity} customer={customer} />

                <div className="flex min-h-0 flex-col overflow-hidden border-l border-[#c5ddef] bg-[#f7fbff]" dir="rtl">
                  <div className="relative border-b border-[#c5ddef] bg-[#f7fbff]">
                    <Search className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#668097]" />
                    <Input
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      placeholder="بحث عن منتج"
                      className="h-12 w-full rounded-none border-0 bg-transparent px-4 pr-10 text-sm font-bold text-[#173653] placeholder:text-[#668097] focus:ring-0"
                    />
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {isProductsLoading ? (
                      <div className="m-4 rounded-xl border border-[#c5ddef] bg-[#f7fbff] px-5 py-4 text-sm font-bold text-[#668097]">
                        جاري تحميل المنتجات...
                      </div>
                    ) : productsError ? (
                      <div className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                        {productsError}
                      </div>
                    ) : filteredProducts.length ? (
                      filteredProducts.map((product) => {
                        const productCode = getProductCode(product);
                        return (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => openProductSheet(product)}
                            className="grid w-full grid-cols-[1fr_auto] items-center gap-4 border-b border-[#cfe0ee] px-4 py-3 text-right transition last:border-b-0 hover:bg-[#f7fbff]"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-black text-[#173653]">{getProductTitle(product)}</span>
                              <span className="mt-0.5 block truncate text-xs font-bold text-[#8aa0b3]">{productCode}</span>
                              {product.tracking === 'serial' ? <span className="mt-1 block text-[11px] font-black text-[#668097]">سيتم إدخال تعريفات التتبع عند البيع</span> : null}
                            </span>
                            <span className="rounded-lg bg-[#eef6fc] px-3 py-1.5 text-sm font-black text-[#2f86cf]">{formatMoney(product.price)}</span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="m-4 rounded-xl border border-dashed border-[#c5ddef] bg-[#f7fbff] px-5 py-6 text-center text-sm font-bold text-[#668097]">
                        لا توجد منتجات مطابقة.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex h-full w-full items-start justify-center p-6" dir="rtl">
              <div className="w-full space-y-5">

                {/* Total sentence */}
                <p className="text-right text-base font-bold text-[#668097]">
                  الآن إجمالي المطلوب من العميل{' '}
                  <span className="font-black text-[#173653]">{formatMoney(total)}</span>
                </p>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-black text-[#668097]">المدفوع الآن</label>
                    <Input
                      type="number"
                      min="0"
                      max={total}
                      step="0.01"
                      value={paidAmount}
                      onChange={(e) => updatePaidAmount(e.target.value)}
                      className="h-14 rounded-2xl border-2 border-[#c5ddef] bg-white text-xl font-black text-[#173653] focus:border-[#2f86cf] focus:ring-[#d8ecfb]"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-black text-[#668097]">طريقة الدفع</label>
                    <Input
                      value={paymentMethod}
                      onChange={(event) => setPaymentMethod(event.target.value)}
                      className="h-14 rounded-2xl border-2 border-[#c5ddef] bg-white text-base font-black text-[#173653] focus:border-[#2f86cf] focus:ring-[#d8ecfb]"
                    />
                  </div>
                </div>

                <div className={hasPaidAmount ? '' : 'opacity-45'}>
                  <label className={`mb-2 block text-xs font-black ${hasPaidAmount ? 'text-[#668097]' : 'text-[#8aa0b3]'}`}>
                    متبقي{' '}
                    <span className={hasNoRemainingAmount ? 'text-emerald-600' : hasPaidAmount ? 'text-red-500' : 'text-[#8aa0b3]'}>
                      {hasNoRemainingAmount ? 'لا يوجد متبقي' : formatMoney(remainingAmount)}
                    </span>
                  </label>
                  <Input
                    disabled={!hasPaidAmount || hasNoRemainingAmount}
                    placeholder={hasNoRemainingAmount ? 'لا يوجد متبقي' : 'ملاحظة دفع المتبقي'}
                    className="h-14 rounded-2xl border-2 border-[#c5ddef] bg-white text-xl font-black text-[#173653] disabled:cursor-not-allowed disabled:bg-[#f7fbff] disabled:text-[#8aa0b3] focus:border-[#2f86cf] focus:ring-[#d8ecfb]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-black text-[#668097]">ملاحظة إضافية للعقد</label>
                  <Input
                    value={contractNote}
                    onChange={(event) => setContractNote(event.target.value)}
                    placeholder="ستظهر هذه الملاحظة داخل العقد"
                    className="h-12 rounded-2xl border border-[#c5ddef] bg-white text-sm font-bold text-[#173653] placeholder:text-[#8aa0b3] focus:border-[#2f86cf] focus:ring-[#d8ecfb]"
                  />
                </div>

              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-[#c5ddef] bg-[#edf5fc] px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset} disabled={isCompleting} className="h-11 rounded-xl border-[#c5ddef] bg-white px-5 font-black text-[#173653] hover:bg-[#eef6fc]">
              مسح
            </Button>
            {step > 0 && (
              <Button variant="secondary" onClick={back} disabled={isCompleting} className="h-11 rounded-xl border-[#c5ddef] bg-white px-5 font-black text-[#173653] hover:bg-[#eef6fc]">
                <ChevronRight className="h-4 w-4" />
                السابق
              </Button>
            )}
            {step < 2 ? (
              <Button onClick={next} className="h-11 rounded-xl bg-[#2f86cf] px-7 font-black text-white shadow-[0_16px_24px_-18px_rgba(47,134,207,0.95)] hover:bg-[#2878bb]">
                التالي
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : step === 2 ? (
              <Button onClick={openContractPreview} className="h-11 rounded-xl bg-[#2f86cf] px-7 font-black text-white shadow-[0_16px_24px_-18px_rgba(47,134,207,0.95)] hover:bg-[#2878bb]">
                عرض العقد
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={complete} disabled={isCompleting} className="h-11 rounded-xl bg-[#2f86cf] px-7 font-black text-white shadow-[0_16px_24px_-18px_rgba(47,134,207,0.95)] hover:bg-[#2878bb]">
                {isCompleting ? 'جار الحفظ...' : 'إتمام'}
              </Button>
            )}
          </div>
        </div>
      </footer>

      <Sheet open={productSheetOpen} onOpenChange={closeProductSheet}>
        <SheetContent side="bottom" className="mx-auto max-h-[98vh] min-h-[70vh] w-full max-w-2xl rounded-t-[26px] border-0" dir="rtl">
          <SheetHeader className="rounded-t-[26px] bg-[#2f86cf] px-5 py-5 text-right sm:px-7">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-xl font-black tracking-tight text-white">{getProductTitle(pendingProduct)}</SheetTitle>
                <p className="mt-0.5 text-xs font-bold text-white/70">{getProductCode(pendingProduct)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button onClick={confirmProductSelection} className="h-9 rounded-xl bg-white px-5 font-black text-[#2f86cf] hover:bg-white/90">
                  إضافة
                </Button>
              </div>
            </div>
          </SheetHeader>

          <SheetBody className="space-y-4 px-5 py-5 sm:px-7">
            {productSheetError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                {productSheetError}
              </div>
            ) : null}

            <div className="grid gap-4">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#173653]">سعر البيع</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={productDraft.price}
                  onChange={(event) => {
                    setProductDraft((current) => ({ ...current, price: event.target.value }));
                    setProductSheetError('');
                  }}
                  className="h-12 rounded-xl border-[#c5ddef] bg-[#f7fbff] text-base font-black text-[#173653] focus:border-[#2f86cf] focus:ring-[#d8ecfb]"
                />
              </label>
            </div>

            {pendingProduct?.tracking === 'serial' ? (
              <div className="space-y-3 rounded-2xl border border-[#c5ddef] bg-[#f7fbff] p-4">
                <div>
                  <p className="text-sm font-black text-[#173653]">تعريفات التتبع</p>
                  <p className="mt-1 text-xs font-bold text-[#668097]">تظهر حسب تعريفات تصنيف المنتج.</p>
                </div>

                {isTrackingIdentifiersLoading ? (
                  <div className="rounded-xl border border-[#c5ddef] bg-white px-4 py-3 text-sm font-bold text-[#668097]">
                    جاري تحميل تعريفات التتبع...
                  </div>
                ) : trackingIdentifierDefinitions.length ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {trackingIdentifierDefinitions.map((definition) => {
                      const slots = getIdentifierSlots(definition);
                      return (
                        <label key={definition.identifierTypeId} className="block">
                          <span className="mb-2 block text-xs font-black text-[#668097]">
                            {definition.name}
                            {definition.isRequired ? <span className="text-red-500"> *</span> : null}
                          </span>
                          <Input
                            value={productDraft.trackingIdentifiers?.[definition.identifierTypeId] ?? ''}
                            inputMode={
                              definition.dataType === 'numeric' || (slots.length > 0 && slots.every((slot) => slot.type === 'numeric'))
                                ? 'numeric'
                                : 'text'
                            }
                            maxLength={slots.length || undefined}
                            onChange={(event) => handleTrackingIdentifierChange(definition, event.target.value)}
                            placeholder={slots.length ? `${slots.length} خانة` : definition.code || definition.name}
                            dir={definition.dataType === 'numeric' || slots.length > 0 ? 'ltr' : 'rtl'}
                            className="h-12 rounded-xl border-[#c5ddef] bg-white text-base font-bold text-[#173653] placeholder:text-[#8aa0b3] focus:border-[#2f86cf] focus:ring-[#d8ecfb]"
                          />
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[#c5ddef] bg-white px-4 py-4 text-sm font-bold text-[#668097]">
                    لا توجد تعريفات تتبع مرتبطة بتصنيف هذا المنتج.
                  </div>
                )}
              </div>
            ) : null}

            {pendingProduct?.requiresOwnershipTransfer ? (
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#173653]">اسم المالك الجديد (نقل الملكية)</span>
                <Input
                  value={productDraft.ownershipTransferName}
                  onChange={(event) => {
                    setProductDraft((current) => ({ ...current, ownershipTransferName: event.target.value }));
                    setProductSheetError('');
                  }}
                  placeholder="اكتب اسم المالك الجديد"
                  className="h-12 rounded-xl border-[#c5ddef] bg-[#f7fbff] text-base font-bold text-[#173653] placeholder:text-[#8aa0b3] focus:border-[#2f86cf] focus:ring-[#d8ecfb]"
                />
              </label>
            ) : null}

            {pendingAttributeFields.length ? (
              <div className="space-y-3">
                {pendingAttributeFields.map((field) => (
                  <label key={field.key} className="block">
                    <span className="mb-2 block text-xs font-black text-[#668097]">
                      {field.label}
                      {field.isRequired ? <span className="text-red-500"> *</span> : null}
                    </span>
                    {field.values?.length ? (
                      <select
                        value={productDraft.attributes[field.key] || ''}
                        onChange={(event) => {
                          setProductDraft((current) => ({
                            ...current,
                            attributes: {
                              ...current.attributes,
                              [field.key]: event.target.value,
                            },
                          }));
                          setProductSheetError('');
                        }}
                        className="h-11 w-full rounded-xl border border-[#c5ddef] bg-white px-3 text-sm font-bold text-[#173653] outline-none transition focus:border-[#2f86cf] focus:ring-4 focus:ring-[#d8ecfb]"
                      >
                        <option value="">اختر {field.label}</option>
                        {field.values.map((value) => (
                          <option key={value.id} value={value.id}>
                            {value.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        value={productDraft.attributes[field.key] || ''}
                        onChange={(event) => {
                          setProductDraft((current) => ({
                            ...current,
                            attributes: {
                              ...current.attributes,
                              [field.key]: event.target.value,
                            },
                          }));
                          setProductSheetError('');
                        }}
                        placeholder={`حدد ${field.label}`}
                        className="h-11 rounded-xl border-[#c5ddef] bg-white text-sm font-bold text-[#173653] placeholder:text-[#8aa0b3] focus:border-[#2f86cf] focus:ring-[#d8ecfb]"
                      />
                    )}
                  </label>
                ))}
              </div>
            ) : pendingProduct?.tracking !== 'serial' ? (
              <div className="rounded-xl border border-dashed border-[#c5ddef] bg-[#f7fbff] px-4 py-4 text-sm font-bold text-[#668097]">
                لا توجد خصائص إضافية مطلوبة لهذا المنتج.
              </div>
            ) : null}
          </SheetBody>


        </SheetContent>
      </Sheet>

      <Sheet
        open={isContractSheetOpen}
        onOpenChange={(open) => {
          setIsContractSheetOpen(open);
          if (!open && step === 3) setStep(2);
        }}
      >
        <SheetContent side="right" className="w-full max-w-[760px] border-l border-slate-200 bg-slate-100" dir="rtl">
          <SheetHeader className="border-b border-slate-200 bg-white px-5 py-4 text-right">
            <SheetDismissButton />
            <SheetTitle className="text-lg font-black text-slate-900">معاينة العقد</SheetTitle>
            <p className="text-xs font-bold text-slate-500">راجع بيانات العقد قبل إتمام عملية البيع.</p>
          </SheetHeader>
          <SheetBody className="bg-slate-100 px-4 py-4">
            <ShowroomContractPreview
              companyName={tenant?.name}
              customer={customer}
              items={cart}
              totalAmount={total}
              paidAmount={Number(paidAmount) || 0}
              remainingAmount={remainingAmount}
              paymentMethod={paymentMethod}
              notes={contractNote}
            />
          </SheetBody>
          <SheetFooter className="justify-end border-t border-slate-200 bg-white px-5 py-4">
            <Button variant="secondary" onClick={back} disabled={isCompleting} className="h-11 rounded-xl border-[#c5ddef] bg-white px-5 font-black text-[#173653] hover:bg-[#eef6fc]">
              <ChevronRight className="h-4 w-4" />
              رجوع للدفع
            </Button>
            <Button onClick={complete} disabled={isCompleting} className="h-11 rounded-xl bg-[#2f86cf] px-7 font-black text-white shadow-[0_16px_24px_-18px_rgba(47,134,207,0.95)] hover:bg-[#2878bb]">
              {isCompleting ? 'جار الحفظ...' : 'إتمام'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <PartnerFormSheet
        open={isCustomerSheetOpen}
        onOpenChange={setIsCustomerSheetOpen}
        initialValues={NEW_CUSTOMER_INITIAL_VALUES}
        onSubmit={createCustomer}
        isSubmitting={isCustomerSubmitting}
        side="right"
        hideTypeFields
        hideAccountingFields
        hideFooterNote
        hideCancelButton
        accentHeader
        hideDismissButton
        inlineSubmit
      />
    </section>
  );
}

function SelectedProductsPanel({ cart, onUpdateQuantity, customer }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white px-5 py-4" dir="rtl">
      {/* Customer card */}
      {customer && (
        <div className="mb-4 flex shrink-0 items-center gap-3 rounded-xl border border-[#c5ddef] bg-[#f7fbff] px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#edf5fc]">
            <User className="h-5 w-5 text-[#2f86cf]" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black text-[#173653]">{customer.name}</p>
            {customer.phone && <p className="text-xs font-bold text-[#668097]">{customer.phone}</p>}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {cart.length ? (
          cart.map((item) => (
            <div
              key={item.lineId || item.id}
              className="rounded-xl bg-[#2f86cf] p-3 text-white shadow-[0_18px_34px_-24px_rgba(47,134,207,0.85)]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/18 text-sm font-black text-white ring-1 ring-white/24">
                  {item.quantity}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-white">{item.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-[#2f86cf]">{formatMoney(item.price * item.quantity)}</span>
                    <span className="text-[11px] font-bold text-white/70">{item.code}</span>
                  </div>
                  <LineMeta item={item} className="mt-2 text-white/75" />
                </div>
                <LineControls item={item} onUpdateQuantity={onUpdateQuantity} compact tone="light" />
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-[#c5ddef] bg-[#f7fbff] px-4 py-8 text-center text-xs font-bold leading-5 text-[#668097]">
            اختر منتجًا من القائمة ليظهر هنا.
          </div>
        )}
      </div>
    </div>
  );
}

function LineMeta({ item, className = '' }) {
  const attributesText = item.configuredAttributes?.length ? item.configuredAttributes.map((attribute) => `${attribute.label}: ${attribute.value}`).join(' - ') : '';
  const trackingText = item.trackingIdentifiers?.length ? item.trackingIdentifiers.map((identifier) => `${identifier.label}: ${identifier.value}`).join(' - ') : '';

  if (!item.serialNumber && !trackingText && !attributesText && !item.ownershipTransferName) return null;

  return (
    <div className={`space-y-0.5 text-[11px] font-bold leading-5 ${className}`}>
      {trackingText ? <p className="truncate">{trackingText}</p> : item.serialNumber ? <p className="truncate">السيريال: {item.serialNumber}</p> : null}
      {item.ownershipTransferName ? <p className="truncate">نقل الملكية إلى: {item.ownershipTransferName}</p> : null}
      {attributesText ? <p className="truncate">{attributesText}</p> : null}
    </div>
  );
}

function LineControls({ item, onUpdateQuantity, compact = false, tone = 'default' }) {
  const isLight = tone === 'light';
  const lineId = item.lineId || item.id;
  const isSerial = item.tracking === 'serial';

  return (
    <div className={`flex items-center ${compact ? 'gap-1' : 'gap-2'}`}>
      <button
        type="button"
        onClick={() => onUpdateQuantity(lineId, item.quantity - 1)}
        className={`${compact ? 'h-8 w-8 rounded-lg' : 'h-9 w-9 rounded-xl'} flex items-center justify-center border transition ${
          isLight ? 'border-white/20 bg-white/14 text-white hover:bg-white/22' : 'border-[#f0c9c9] bg-[#fff5f5] text-[#b43b3b] hover:bg-[#ffe9e9]'
        }`}
        aria-label="تقليل الكمية"
      >
        {item.quantity === 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
      </button>
      {!compact && <span className="w-8 text-center text-sm font-black">{item.quantity}</span>}
      {!isSerial && (
        <button
          type="button"
          onClick={() => onUpdateQuantity(lineId, item.quantity + 1)}
          className={`${compact ? 'h-8 w-8 rounded-lg' : 'h-9 w-9 rounded-xl'} flex items-center justify-center border transition ${
            isLight ? 'border-white bg-white text-[#2f86cf] hover:bg-white/90' : 'border-[#b8e0cf] bg-[#ecfbf4] text-[#167450] hover:bg-[#dff7ec]'
          }`}
          aria-label="زيادة الكمية"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
