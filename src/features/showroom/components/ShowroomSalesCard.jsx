import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Minus, PackageSearch, Plus, PlusCircle, Search, Trash2, User, UserPlus } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDismissButton, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { PartnerFormSheet } from '@/features/contacts/components/PartnerFormSheet';
import { partnersService } from '@/features/contacts/services/partners.service';
import { posService } from '@/features/pos/api/pos.api';
import { productAttributeService, productCategoryAttributeService, productCategoryService, productCategoryTrackingIdentifierService, productsService } from '@/features/products/api/products.api';
import { ProductFormSheet } from '@/features/products/components/ProductFormSheet';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { showroomService } from '@/features/showroom/services/showroom.service';
import { EmployeeCashDestinationNotice, useEmployeeCashDestination } from '@/features/showroom/components/EmployeeCashDestinationNotice';

const NEW_CUSTOMER_INITIAL_VALUES = {
  isCustomer: true,
  isSupplier: false,
};

const PAYMENT_TYPES = {
  CASH: 'cash',
  FINANCING: 'financing',
};

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

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG')} EGP`;
}

function getPartnerAvatarConfig(partner) {
  const displayConfig = partner?.displayConfig ?? partner?.display_config ?? null;
  const avatar = displayConfig?.avatar && typeof displayConfig.avatar === 'object' ? displayConfig.avatar : {};
  const text = String(avatar.text || partner?.name || '-').trim().slice(0, 1) || '-';
  const shape = avatar.shape === 'rounded' ? 'rounded' : 'circle';

  return {
    text,
    bg: typeof avatar.bg === 'string' && avatar.bg.trim() ? avatar.bg : '#0F172A',
    color: typeof avatar.color === 'string' && avatar.color.trim() ? avatar.color : '#FFFFFF',
    shape,
  };
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

function validateIdentifierValue(definition, value) {
  const safeValue = String(value ?? '').trim();
  const slots = getIdentifierSlots(definition);

  if (definition.isRequired && !safeValue && !(definition.allowNotAvailable && definition.isNotAvailable)) {
    return `أدخل قيمة "${definition.name}".`;
  }

  if (!safeValue) return true;

  if (slots.length && Array.from(safeValue).length !== slots.length) {
    return `قيمة "${definition.name}" يجب أن تكون ${slots.length} خانة.`;
  }

  const invalidIndex = Array.from(safeValue).findIndex((character, index) => !isAllowedIdentifierCharacter(character, slots[index]?.type));
  if (invalidIndex >= 0) {
    return `الخانة ${invalidIndex + 1} في "${definition.name}" لا تطابق نوع الخانة المطلوب.`;
  }

  return true;
}

function isEmptyIdentifierFetchError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('json object requested') || message.includes('multiple (or no) rows returned');
}

export function ShowroomSalesCard({ onSaleCreated, onSalePending, onPendingSaleDelete, resumeSale, onResumeHandled, showroomConfig }) {
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
  const [productCategories, setProductCategories] = useState([]);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [isProductCategoriesLoading, setIsProductCategoriesLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [isProductCreateSheetOpen, setIsProductCreateSheetOpen] = useState(false);
  const [isProductSubmitting, setIsProductSubmitting] = useState(false);
  const [cart, setCart] = useState([]);
  const [message, setMessage] = useState('');
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [pendingProduct, setPendingProduct] = useState(null);
  const [productDraft, setProductDraft] = useState({ price: '', trackingIdentifiers: {}, trackingIdentifierNotAvailable: {}, attributes: {}, license: getInitialLicenseDraft() });
  const [productSheetStep, setProductSheetStep] = useState(1);
  const [isLicenseFieldsLoading, setIsLicenseFieldsLoading] = useState(false);
  const licenseFieldsTimeoutRef = useRef(null);
  const [trackingIdentifierDefinitions, setTrackingIdentifierDefinitions] = useState([]);
  const [isTrackingIdentifiersLoading, setIsTrackingIdentifiersLoading] = useState(false);
  const [productSheetError, setProductSheetError] = useState('');
  const [openAttributeKey, setOpenAttributeKey] = useState('');
  const [paymentType, setPaymentType] = useState(PAYMENT_TYPES.CASH);
  const [paidAmount, setPaidAmount] = useState('');
  const [financers, setFinancers] = useState([]);
  const [isFinancersLoading, setIsFinancersLoading] = useState(false);
  const [financersError, setFinancersError] = useState('');
  const [financierPartnerId, setFinancierPartnerId] = useState('');
  const [financedAmount, setFinancedAmount] = useState('');
  const [approvalReference, setApprovalReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [contractNote, setContractNote] = useState('');
  const [isCompleting, setIsCompleting] = useState(false);
  const [isCreatingPendingSale, setIsCreatingPendingSale] = useState(false);
  const [isDeletingPendingSale, setIsDeletingPendingSale] = useState(false);
  const [pendingSaleId, setPendingSaleId] = useState('');
  const [advanceBalances, setAdvanceBalances] = useState([]);
  const [advanceAllocations, setAdvanceAllocations] = useState({});
  const [advancePaymentNotes, setAdvancePaymentNotes] = useState({});
  const [isAdvanceBalancesLoading, setIsAdvanceBalancesLoading] = useState(false);
  const [advanceBalancesError, setAdvanceBalancesError] = useState('');
  const [isAdvanceBalancesSheetOpen, setIsAdvanceBalancesSheetOpen] = useState(false);
  const [isCashPaymentSheetOpen, setIsCashPaymentSheetOpen] = useState(false);
  const [cashDraftAmount, setCashDraftAmount] = useState('');
  const [cashDraftNote, setCashDraftNote] = useState('');
  const {
    destination: cashDestination,
    isLoading: isCashDestinationLoading,
    error: cashDestinationError,
  } = useEmployeeCashDestination(isCashPaymentSheetOpen);

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
    if (!resumeSale?.id || resumeSale.status !== 'pending_payment') return;
    const resumedCustomer = resumeSale.customer || (resumeSale.customer_id ? {
      id: resumeSale.customer_id,
      name: resumeSale.customer_name || 'العميل',
    } : null);
    const resumedCart = (Array.isArray(resumeSale.lines) ? resumeSale.lines : []).map((line) => ({
      ...line,
      id: line.id,
      productProductId: line.productProductId || line.product_product_id,
      product_product_id: line.product_product_id || line.productProductId,
      name: line.name || line.displayName || line.description || 'منتج',
      displayName: line.displayName || line.name || line.description || 'منتج',
      price: Number(line.price ?? line.unit_price ?? 0),
      quantity: Number(line.quantity || 1),
    }));

    setSelectedCustomer(resumedCustomer);
    setCustomerName(resumedCustomer?.name || '');
    setCart(resumedCart);
    setPendingSaleId(resumeSale.id);
    setPaidAmount('');
    setPaymentNotes('');
    setAdvanceAllocations({});
    setAdvancePaymentNotes({});
    setMessage('');
    setStep(3);
    onResumeHandled?.();
  }, [onResumeHandled, resumeSale]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => () => {
    if (licenseFieldsTimeoutRef.current) {
      window.clearTimeout(licenseFieldsTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    if (step !== 3 || !tenant?.id || !selectedCustomer?.id) {
      setAdvanceBalancesError('');
      return undefined;
    }

    setIsAdvanceBalancesLoading(true);
    setAdvanceBalancesError('');

    showroomService
      .getCustomerAdvanceBalances({ tenantId: tenant.id, customerId: selectedCustomer.id })
      .then((data) => {
        if (!mounted) return;
        setAdvanceBalances(data);
      })
      .catch((error) => {
        if (!mounted) return;
        setAdvanceBalances([]);
        setAdvanceBalancesError(error.message || 'تعذر تحميل الدفعات المسبقة.');
      })
      .finally(() => {
        if (mounted) setIsAdvanceBalancesLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [step, selectedCustomer?.id, tenant?.id]);

  useEffect(() => {
    let mounted = true;

    if (!tenant?.id) {
      setProductCategories([]);
      setIsProductCategoriesLoading(false);
      return undefined;
    }

    setIsProductCategoriesLoading(true);

    Promise.all([
      productCategoryService.listCategories(tenant.id),
      productAttributeService.listAttributes(tenant.id),
      productCategoryAttributeService.listLinks(tenant.id),
    ])
      .then(([categories, attributes, links]) => {
        if (!mounted) return;

        const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]));
        const normalizedLinks = [...links].sort((left, right) => {
          const orderDiff = (left.displayOrder ?? 0) - (right.displayOrder ?? 0);
          if (orderDiff !== 0) return orderDiff;
          return String(attributesById.get(left.attributeId)?.name ?? '').localeCompare(
            String(attributesById.get(right.attributeId)?.name ?? ''),
          );
        });

        const linksByCategoryId = normalizedLinks.reduce((map, link) => {
          const current = map.get(link.categoryId) ?? [];
          current.push({
            ...link,
            attribute: attributesById.get(link.attributeId) ?? null,
            attributeName: attributesById.get(link.attributeId)?.name ?? '',
          });
          map.set(link.categoryId, current);
          return map;
        }, new Map());

        const enrichedCategories = categories.map((category) => ({
          ...category,
          attributeLinks: linksByCategoryId.get(category.id) ?? [],
        }));

        setProductCategories(enrichedCategories);
      })
      .catch(() => {
        if (!mounted) return;
        setProductCategories([]);
      })
      .finally(() => {
        if (!mounted) return;
        setIsProductCategoriesLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [tenant?.id]);

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) => `${product.name} ${product.displayName ?? ''} ${product.code} ${product.barcode ?? ''}`.toLowerCase().includes(query));
  }, [productSearch, products]);

  const hasExactProductMatch = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return false;

    return products.some((product) => {
      const terms = [product.name, product.displayName, product.templateName, product.code, product.barcode]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase());
      return terms.includes(query);
    });
  }, [productSearch, products]);

  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);
  const advanceAmount = Object.values(advanceAllocations).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const paymentAmount = (Number(paidAmount) || 0) + advanceAmount;
  const hasPaidAmount = paidAmount !== '' || advanceAmount > 0;
  const remainingAmount = Math.max(total - paymentAmount, 0);
  const hasNoRemainingAmount = hasPaidAmount && remainingAmount <= 0;
  const hasIncompleteAdvanceNotes = advanceBalances.some((balance) => (
    (Number(advanceAllocations[balance.paymentEntityId]) || 0) > 0
    && !String(advancePaymentNotes[balance.paymentEntityId] || '').trim()
  ));
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
          trackingIdentifierNotAvailable: Object.fromEntries((definitions ?? []).map((definition) => [definition.identifierTypeId, current.trackingIdentifierNotAvailable?.[definition.identifierTypeId] ?? false])),
        }));
      })
      .catch((error) => {
        if (!mounted) return;
        setTrackingIdentifierDefinitions([]);
        if (!isEmptyIdentifierFetchError(error)) {
          setProductSheetError(error.message || 'تعذر تحميل تعريفات التتبع.');
        }
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
      price: '',
      serialNumber: '',
      trackingIdentifiers: {},
      trackingIdentifierNotAvailable: {},
      ownershipTransferName: '',
      attributes,
      license: getInitialLicenseDraft(),
    });
    setProductSheetStep(1);
    setIsLicenseFieldsLoading(false);
    if (licenseFieldsTimeoutRef.current) {
      window.clearTimeout(licenseFieldsTimeoutRef.current);
      licenseFieldsTimeoutRef.current = null;
    }
    setTrackingIdentifierDefinitions([]);
    setIsTrackingIdentifiersLoading(false);
    setProductSheetError('');
    setOpenAttributeKey('');
    setMessage('');
    setProductSheetOpen(true);
  };

  const closeCreateProductSheet = (open) => {
    setIsProductCreateSheetOpen(open);
  };

  const handleProductCreate = async (payload) => {
    if (!tenant?.id) {
      return { error: 'لا توجد شركة نشطة.' };
    }

    setIsProductSubmitting(true);

    try {
      const createdProduct = await productsService.createProduct({ tenantId: tenant.id, payload });
      const nextProducts = await posService.listSellProducts({ tenantId: tenant.id });
      const createdProductId = createdProduct.defaultProductProductId || createdProduct.id;
      const sellableProduct =
        nextProducts.find((product) => product.id === createdProductId)
        ?? nextProducts.find((product) => product.productTemplateId === createdProduct.id)
        ?? null;

      setProducts(nextProducts);
      setProductSearch(createdProduct.name);
      setIsProductCreateSheetOpen(false);

      if (sellableProduct) {
        openProductSheet(sellableProduct);
      }
      return null;
    } catch (error) {
      return { error: error.message || 'تعذر حفظ المنتج.' };
    } finally {
      setIsProductSubmitting(false);
    }
  };

  const closeProductSheet = (open) => {
    setProductSheetOpen(open);
    if (!open) {
      setPendingProduct(null);
      setProductDraft({ price: '', serialNumber: '', trackingIdentifiers: {}, trackingIdentifierNotAvailable: {}, ownershipTransferName: '', attributes: {}, license: getInitialLicenseDraft() });
      setProductSheetStep(1);
      setIsLicenseFieldsLoading(false);
      if (licenseFieldsTimeoutRef.current) {
        window.clearTimeout(licenseFieldsTimeoutRef.current);
        licenseFieldsTimeoutRef.current = null;
      }
      setTrackingIdentifierDefinitions([]);
      setIsTrackingIdentifiersLoading(false);
      setProductSheetError('');
      setOpenAttributeKey('');
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

  const handleTrackingIdentifierNotAvailableChange = (definition, checked) => {
    setProductDraft((current) => ({
      ...current,
      trackingIdentifierNotAvailable: {
        ...(current.trackingIdentifierNotAvailable ?? {}),
        [definition.identifierTypeId]: checked,
      },
      trackingIdentifiers: checked
        ? {
            ...(current.trackingIdentifiers ?? {}),
            [definition.identifierTypeId]: '',
          }
        : (current.trackingIdentifiers ?? {}),
    }));
    setProductSheetError('');
  };

  const handleLicenseChange = (field) => (event) => {
    setProductDraft((current) => ({
      ...current,
      license: {
        ...(current.license ?? getInitialLicenseDraft()),
        [field]: event.target.value,
      },
    }));
    setProductSheetError('');
  };

  const handleLicenseStatusSelect = (status) => {
    if (licenseFieldsTimeoutRef.current) {
      window.clearTimeout(licenseFieldsTimeoutRef.current);
    }

    setProductDraft((current) => ({
      ...current,
      license: {
        ...(current.license ?? getInitialLicenseDraft()),
        status,
      },
    }));
    setProductSheetError('');
    setIsLicenseFieldsLoading(true);
    licenseFieldsTimeoutRef.current = window.setTimeout(() => {
      setIsLicenseFieldsLoading(false);
      licenseFieldsTimeoutRef.current = null;
    }, 380);
  };

  const buildProductSelection = ({ includeLicense = false, validatePrice = true } = {}) => {
    if (!pendingProduct) return;

    const price = validatePrice ? Number(productDraft.price) : Number(productDraft.price || pendingProduct.price || 0);
    if (validatePrice && (!Number.isFinite(price) || price < 0)) {
      setProductSheetError('أدخل سعرًا صحيحًا للمنتج.');
      return null;
    }

    if (isTrackingIdentifiersLoading) {
      setProductSheetError('انتظر حتى يتم تحميل تعريفات التتبع.');
      return null;
    }

    if (pendingProduct.tracking === 'serial') {
      for (const definition of trackingIdentifierDefinitions) {
        const value = String(productDraft.trackingIdentifiers?.[definition.identifierTypeId] ?? '').trim();
        const isNotAvailable = Boolean(productDraft.trackingIdentifierNotAvailable?.[definition.identifierTypeId]);
        const validation = validateIdentifierValue({ ...definition, isNotAvailable }, value);
        if (validation !== true) {
          setProductSheetError(validation);
          return null;
        }
      }
    }

    const missingRequiredAttribute = pendingAttributeFields.find((field) => field.isRequired && !String(productDraft.attributes[field.key] || '').trim());
    if (missingRequiredAttribute) {
      setProductSheetError(`حدد ${missingRequiredAttribute.label} قبل إضافة المنتج.`);
      return null;
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
        isNotAvailable: Boolean(productDraft.trackingIdentifierNotAvailable?.[definition.identifierTypeId]),
      }))
      .filter((identifier) => identifier.value || identifier.isNotAvailable);
    const fallbackSerialNumber = pendingProduct.tracking === 'serial' && !trackingIdentifiers.length
      ? String(productDraft.serialNumber ?? '').trim()
      : '';

    let license = null;
    if (includeLicense && pendingProduct.requiresLicense) {
      if (isLicenseFieldsLoading) {
        setProductSheetError('انتظر حتى يتم تجهيز حقول الترخيص.');
        return null;
      }

      const draftLicense = productDraft.license ?? getInitialLicenseDraft();
      license = {
        status: draftLicense.status || '',
        number: String(draftLicense.number ?? '').trim(),
        issuedAt: draftLicense.issuedAt || null,
        expiresAt: draftLicense.expiresAt || null,
        issuingAuthority: String(draftLicense.issuingAuthority ?? '').trim(),
        notes: String(draftLicense.notes ?? '').trim(),
      };

      if (!license.status) {
        setProductSheetError('اختر حالة الترخيص.');
        return null;
      }

      if (license.status === 'licensed' && !license.number) {
        setProductSheetError('أدخل رقم الترخيص عندما تكون الحالة "مرخص".');
        return null;
      }

      if (license.status === 'licensed' && !license.expiresAt) {
        setProductSheetError('أدخل تاريخ انتهاء الترخيص عندما تكون الحالة "مرخص".');
        return null;
      }
    }

    return {
      ...pendingProduct,
      name: getProductTitle(pendingProduct),
      code: getProductCode(pendingProduct),
      price,
      serialNumber: trackingIdentifiers.length
        ? trackingIdentifiers.map((identifier) => identifier.value).filter(Boolean).join(' - ')
        : fallbackSerialNumber,
      trackingIdentifiers,
      ownershipTransferName: '',
      configuredAttributes,
      license,
      lineId: `${pendingProduct.id}-${Date.now()}`,
    };
  };

  const confirmProductSelection = () => {
    const isLicenseProduct = Boolean(pendingProduct?.requiresLicense);
    const selection = buildProductSelection({
      includeLicense: isLicenseProduct,
      validatePrice: !isLicenseProduct || productSheetStep === 2,
    });
    if (!selection) return;

    if (isLicenseProduct && productSheetStep === 1) {
      setProductSheetError('');
      setProductSheetStep(2);
      return;
    }

    addProduct(selection);
    closeProductSheet(false);
  };

  const renderLicenseFields = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {LICENSE_STATUS_OPTIONS.map((option) => {
          const active = (productDraft.license?.status ?? '') === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleLicenseStatusSelect(option.value)}
              className={`flex h-20 w-24 flex-col items-center justify-center gap-1.5 rounded-xl border text-center transition ${
                active
                  ? 'border-slate-900 bg-slate-900 text-white shadow-[0_18px_34px_-26px_rgba(15,23,42,0.85)]'
                  : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                  active ? 'border-white/25 bg-white/15 text-white' : 'border-slate-200 bg-slate-50 text-transparent'
                }`}
              >
                <Check className="h-4 w-4" />
              </span>
              <span className="text-sm font-black">{option.label}</span>
            </button>
          );
        })}
      </div>

      {isLicenseFieldsLoading ? (
        <div className="flex h-28 w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50/70 text-sm font-black text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="mr-2">جاري تجهيز الحقول...</span>
        </div>
      ) : productDraft.license?.status === 'licensed' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2.5 block text-xs font-black uppercase tracking-wide text-slate-500">رقم الرخصة</span>
            <Input
              value={productDraft.license?.number ?? ''}
              onChange={handleLicenseChange('number')}
              placeholder="رقم الرخصة"
              className="h-11 rounded-lg border-slate-300 bg-white text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-300/50"
            />
          </label>

          <label className="block">
            <span className="mb-2.5 block text-xs font-black uppercase tracking-wide text-slate-500">تاريخ انتهاء الترخيص</span>
            <Input
              type="date"
              value={productDraft.license?.expiresAt ?? ''}
              onChange={handleLicenseChange('expiresAt')}
              className="h-11 rounded-lg border-slate-300 bg-white text-sm font-bold text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-300/50"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-2.5 block text-xs font-black uppercase tracking-wide text-slate-500">جهة الإصدار</span>
            <Input
              value={productDraft.license?.issuingAuthority ?? ''}
              onChange={handleLicenseChange('issuingAuthority')}
              placeholder="مرور ايه"
              className="h-11 rounded-lg border-slate-300 bg-white text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-300/50"
            />
          </label>
        </div>
      ) : null}
    </div>
  );

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
      setPaymentType(PAYMENT_TYPES.CASH);
      setFinancierPartnerId('');
      setFinancedAmount('');
      setApprovalReference('');
      setPaymentNotes('');
      setContractNote('');
    }
    setStep((current) => Math.min(current + 1, 2));
  };

  const back = () => {
    setMessage('');
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

  const updateFinancedAmount = (value) => {
    if (value === '') {
      setFinancedAmount('');
      return;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    setFinancedAmount(String(Math.min(Math.max(numericValue, 0), total)));
  };

  const reset = () => {
    setStep(0);
    setCustomerName('');
    setSelectedCustomer(null);
    setProductSearch('');
    setCart([]);
    setMessage('');
    setPaymentType(PAYMENT_TYPES.CASH);
    setPaidAmount('');
    setFinancierPartnerId('');
    setFinancedAmount('');
    setApprovalReference('');
    setPaymentNotes('');
    setContractNote('');
    setAdvanceBalances([]);
    setAdvanceAllocations({});
    setAdvancePaymentNotes({});
    setIsAdvanceBalancesSheetOpen(false);
    setIsCashPaymentSheetOpen(false);
    setCashDraftAmount('');
    setCashDraftNote('');
    setPendingSaleId('');
  };

  const openPaymentStep = async () => {
    if (!customer || !cart.length || isCreatingPendingSale) return;
    setMessage('');
    setIsCreatingPendingSale(true);
    try {
      const result = await onSalePending?.({
        pendingSaleId: pendingSaleId || null,
        customer,
        items: cart,
        totalAmount: total,
      });
      if (result?.ok === false) {
        setMessage(result.error || 'تعذر إنشاء الفاتورة المعلقة.');
        return;
      }
      if (result?.sale?.id) setPendingSaleId(result.sale.id);
      setStep(3);
    } catch (error) {
      setMessage(error.message || 'تعذر إنشاء الفاتورة المعلقة.');
    } finally {
      setIsCreatingPendingSale(false);
    }
  };

  const complete = async () => {
    if (!customer || !cart.length || isCompleting) return;
    const cash = Number(paidAmount) || 0;
    const allocations = advanceBalances
      .map((balance) => ({
        paymentEntityId: balance.paymentEntityId,
        amount: Number(advanceAllocations[balance.paymentEntityId]) || 0,
        note: String(advancePaymentNotes[balance.paymentEntityId] || '').trim(),
      }))
      .filter((allocation) => allocation.amount > 0);
    const paid = cash + allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    setMessage('');

    if (paid > total) {
      setMessage('إجمالي الدفع أكبر من قيمة الفاتورة.');
      return;
    }

    if (cash > 0 && !paymentNotes.trim()) {
      setMessage('اكتب ملاحظة للدفعة النقدية قبل إتمام البيع.');
      return;
    }

    if (allocations.some((allocation) => !allocation.note)) {
      setMessage('اكتب ملاحظة لكل دفعة مستخدمة من رصيد العميل.');
      return;
    }

    setIsCompleting(true);

    try {
      const result = await onSaleCreated?.({
        customer,
        pendingSaleId: pendingSaleId || null,
        items: cart,
        totalAmount: total,
        paidAmount: paid,
        cashAmount: cash,
        cashNote: paymentNotes.trim(),
        advanceAllocations: allocations,
        contractNote: contractNote.trim(),
        paymentType,
        paymentMethodId: paymentType,
        financierPartnerId: paymentType === PAYMENT_TYPES.FINANCING ? financierPartnerId : null,
        approvalReference: paymentType === PAYMENT_TYPES.FINANCING ? approvalReference.trim() : '',
        paymentNotes: paymentType === PAYMENT_TYPES.FINANCING ? paymentNotes.trim() : '',
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

  const deletePendingSale = async () => {
    if (!pendingSaleId || isDeletingPendingSale || isCompleting) return;
    if (!window.confirm('سيتم حذف الفاتورة المعلقة وكل بياناتها نهائيًا. هل أنت متأكد؟')) return;
    setMessage('');
    setIsDeletingPendingSale(true);
    try {
      const result = await onPendingSaleDelete?.(pendingSaleId);
      if (result?.ok === false) {
        setMessage(result.error || 'تعذر حذف الفاتورة المعلقة.');
        return;
      }
      reset();
    } catch (error) {
      setMessage(error.message || 'تعذر حذف الفاتورة المعلقة.');
    } finally {
      setIsDeletingPendingSale(false);
    }
  };

  return (
    <section className="flex h-[min(620px,calc(100vh-9rem))] flex-col bg-white text-[#173653]">
      <header className="border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">Showroom POS</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">عملية بيع</h1>
            <p className="mt-1 text-xs font-black text-[#668097]">
              {showroomConfig?.name || 'كل نقاط المعرض'}
            </p>
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
                    className="h-[52px] rounded-xl border border-slate-200 bg-white px-5 pr-11 text-base font-bold text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:ring-slate-200"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setIsCustomerSheetOpen(true)}
                  className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200"
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
                <div className="mt-4 rounded-xl border border-[#e6c8cf] bg-[#fcf6f7] px-5 py-4 text-sm font-bold text-[#8e6f76]">
                  جاري تحميل العملاء...
                </div>
              ) : customers.length > 0 ? (
                <div className="mt-4 max-h-[260px] overflow-y-auto rounded-xl border border-[#e6c8cf] bg-white shadow-[0_18px_34px_-30px_rgba(78,24,35,0.28)]">
                  {customers.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => selectCustomer(result)}
                      className={`grid w-full grid-cols-[1fr_auto] items-center gap-4 border-b border-[#f1dde1] px-4 py-3 text-right transition last:border-b-0 hover:bg-[#fcf6f7] ${
                        selectedCustomer?.id === result.id ? 'bg-slate-100 text-slate-900' : 'text-slate-900'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-black">{result.name}</span>
                          {selectedCustomer?.id === result.id ? (
                            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black text-white">مختار</span>
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
                          selectedCustomer?.id === result.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50 text-transparent'
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

                <div className="flex min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-slate-50" dir="rtl">
                  <div className="relative border-b border-slate-200 bg-slate-50">
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
                      <div className="m-4 rounded-xl border border-[#e6c8cf] bg-[#fcf6f7] px-5 py-4 text-sm font-bold text-[#8e6f76]">
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
                            className="grid w-full grid-cols-[1fr_auto] items-center gap-4 border-b border-slate-200 px-4 py-3 text-right transition last:border-b-0 hover:bg-white"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-black text-[#173653]">{getProductTitle(product)}</span>
                              <span className="mt-0.5 block truncate text-xs font-bold text-[#8aa0b3]">{productCode}</span>
                              {product.tracking === 'serial' ? <span className="mt-1 block text-[11px] font-black text-[#668097]">سيتم إدخال تعريفات التتبع عند البيع</span> : null}
                            </span>
                            <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-black text-white">{formatMoney(product.price)}</span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="m-4 rounded-2xl border border-dashed border-[#e6c8cf] bg-[#fcf6f7] px-5 py-7 text-center shadow-[0_22px_50px_-36px_rgba(78,24,35,0.35)]">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#edd5da] bg-white text-[#9b3645] shadow-sm">
                          <PackageSearch className="h-6 w-6" />
                        </div>
                        <p className="mt-4 text-sm font-black text-[#6f4e56]">لا توجد منتجات مطابقة.</p>
                        <p className="mt-2 text-xs font-bold leading-6 text-[#9a7a82]">
                          {productSearch.trim() ? `يمكنك إضافة "${productSearch.trim()}" مباشرة ثم متابعة البيع.` : 'أضف منتجًا جديدًا ثم ارجع لإكمال عملية البيع.'}
                        </p>
                        <Button
                          type="button"
                          onClick={() => setIsProductCreateSheetOpen(true)}
                          disabled={isProductCategoriesLoading}
                          className="mt-5 h-11 rounded-xl bg-[#7f2d3b] px-5 font-black text-white shadow-[0_18px_30px_-18px_rgba(91,24,37,0.8)] hover:bg-[#69232f] disabled:cursor-not-allowed disabled:bg-[#c79aa3]"
                        >
                          <PlusCircle className="h-4 w-4" />
                          {productSearch.trim() && !hasExactProductMatch ? `إضافة المنتج "${productSearch.trim()}"` : 'إضافة منتج جديد'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <SaleReviewStep
              customer={customer}
              cart={cart}
              total={total}
            />
          )}

          {step === 3 && (
            <div className="flex h-full w-full items-start justify-center px-6 py-7" dir="rtl">
              <div className="w-full max-w-[900px]">
                <div className="grid gap-8 border-b border-slate-200 pb-7 lg:grid-cols-[0.8fr_1.2fr]">
                  <section className="flex flex-col justify-center">
                    <p className="text-xs font-black text-slate-400">إجمالي الفاتورة</p>
                    <p className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{formatMoney(total)}</p>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-xs font-black text-slate-400">طرق الدفع المتاحة</p>
                      {isAdvanceBalancesLoading ? <span className="text-[11px] font-bold text-slate-400">جار التحميل...</span> : null}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button type="button" onClick={() => {
                        setCashDraftAmount(paidAmount);
                        setCashDraftNote(paymentNotes);
                        setIsCashPaymentSheetOpen(true);
                      }} className={`flex min-h-16 items-center gap-3 border px-3 py-2 text-right transition ${Number(paidAmount) > 0 ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-slate-400'}`}>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white"><Banknote className="h-4 w-4" /></span>
                        <span className="text-sm font-black text-slate-800">تحصيل نقدي</span>
                      </button>
                      {!isAdvanceBalancesLoading && !advanceBalancesError ? advanceBalances.map((balance) => {
                        const avatar = getPartnerAvatarConfig({ name: balance.paymentEntityName, displayConfig: balance.displayConfig });
                        const selectedAmount = Number(advanceAllocations[balance.paymentEntityId]) || 0;
                        return (
                          <button key={balance.paymentEntityId} type="button" onClick={() => setIsAdvanceBalancesSheetOpen(true)} className={`flex min-h-16 items-center gap-3 border px-3 py-2 text-right transition focus:outline-none ${selectedAmount > 0 ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-slate-400'}`}>
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center text-xs font-black ${avatar.shape === 'circle' ? 'rounded-full' : 'rounded-lg'}`} style={{ backgroundColor: avatar.bg, color: avatar.color }}>{avatar.text}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-black text-slate-800">{balance.paymentEntityName}</span>
                              <span className="mt-1 block truncate text-[11px] font-bold text-slate-400">متاح {formatMoney(balance.availableAmount)}</span>
                            </span>
                            {selectedAmount > 0 ? <span className="text-xs font-black text-emerald-700">{formatMoney(selectedAmount)}</span> : null}
                          </button>
                        );
                      }) : null}
                    </div>
                    {advanceBalancesError ? <p className="mt-2 text-xs font-black text-red-600">{advanceBalancesError}</p> : null}
                  </section>
                </div>

                <section className="pt-5">
                  <div className="space-y-2">
                    {advanceBalances.filter((balance) => (Number(advanceAllocations[balance.paymentEntityId]) || 0) > 0).map((balance) => {
                      const avatar = getPartnerAvatarConfig({ name: balance.paymentEntityName, displayConfig: balance.displayConfig });
                      const amount = Number(advanceAllocations[balance.paymentEntityId]) || 0;
                      return (
                        <div key={balance.paymentEntityId} className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center text-[10px] font-black ${avatar.shape === 'circle' ? 'rounded-full' : 'rounded-md'}`} style={{ backgroundColor: avatar.bg, color: avatar.color }}>{avatar.text}</span>
                          <span className="shrink-0 truncate text-xs font-black text-slate-700">{balance.paymentEntityName}</span>
                          {advancePaymentNotes[balance.paymentEntityId] ? <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-400">{advancePaymentNotes[balance.paymentEntityId]}</span> : <span className="flex-1" />}
                          <span className="whitespace-nowrap text-xs font-black text-emerald-600">{formatMoney(amount)}</span>
                          <button type="button" onClick={() => { setAdvanceAllocations((current) => ({ ...current, [balance.paymentEntityId]: '' })); setAdvancePaymentNotes((current) => ({ ...current, [balance.paymentEntityId]: '' })); }} className="flex h-7 w-7 shrink-0 items-center justify-center text-slate-400 transition hover:bg-red-50 hover:text-red-600" aria-label={`حذف دفعة ${balance.paymentEntityName}`} title="حذف الدفعة"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      );
                    })}
                    {(Number(paidAmount) || 0) > 0 ? (
                      <div className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div className="flex items-center gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white"><Banknote className="h-3.5 w-3.5" /></span>
                          <span className="shrink-0 text-xs font-black text-slate-700">تحصيل نقدي</span>
                          {paymentNotes ? <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-400">{paymentNotes}</span> : <span className="flex-1" />}
                          <span className="whitespace-nowrap text-xs font-black text-emerald-600">{formatMoney(Number(paidAmount))}</span>
                          <button type="button" onClick={() => { setPaidAmount(''); setPaymentNotes(''); setCashDraftAmount(''); setCashDraftNote(''); }} className="flex h-7 w-7 shrink-0 items-center justify-center text-slate-400 transition hover:bg-red-50 hover:text-red-600" aria-label="حذف الدفعة النقدية" title="حذف الدفعة"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    ) : null}
                    {paymentAmount <= 0 ? <p className="py-2 text-xs font-bold text-slate-400">لم تتم إضافة أي عملية دفع بعد</p> : null}
                  </div>
                </section>

                <div className="mt-7 flex items-end justify-between gap-4 border-t-2 border-slate-950 pt-5">
                  <div>
                    <p className="text-xs font-black text-slate-400">المتبقي على العميل</p>
                    <p className="mt-2 text-xs font-bold text-slate-400">{hasNoRemainingAmount ? 'تم سداد المبلغ بالكامل' : 'يظل مستحقًا بعد إتمام البيع'}</p>
                  </div>
                  <p className={`text-3xl font-black tracking-tight ${hasNoRemainingAmount ? 'text-emerald-600' : 'text-[#9b3645]'}`}>{formatMoney(remainingAmount)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex gap-2">
            {step === 3 && pendingSaleId ? (
              <Button variant="secondary" onClick={deletePendingSale} disabled={isDeletingPendingSale || isCompleting} className="h-11 rounded-xl border-red-200 bg-white px-4 font-black text-red-600 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
                {isDeletingPendingSale ? 'جار الحذف...' : 'حذف الفاتورة'}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={reset} disabled={isCompleting || isDeletingPendingSale} className="h-11 rounded-xl border-slate-200 bg-white px-5 font-black text-slate-800 hover:bg-slate-50">
              مسح
            </Button>
            {step > 0 && (
              <Button variant="secondary" onClick={back} disabled={isCompleting} className="h-11 rounded-xl border-slate-200 bg-white px-5 font-black text-slate-800 hover:bg-slate-50">
                <ChevronRight className="h-4 w-4" />
                السابق
              </Button>
            )}
            {step < 2 ? (
              <Button onClick={next} className="h-11 rounded-xl bg-slate-900 px-7 font-black text-white shadow-[0_16px_24px_-18px_rgba(15,23,42,0.78)] hover:bg-slate-800">
                التالي
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : step === 2 ? (
              <Button onClick={openPaymentStep} disabled={isCreatingPendingSale} className="h-11 rounded-xl bg-slate-900 px-7 font-black text-white shadow-[0_16px_24px_-18px_rgba(15,23,42,0.78)] hover:bg-slate-800">
                {isCreatingPendingSale ? 'جار إنشاء الفاتورة...' : 'الدفع'}
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={complete} disabled={isCompleting} className="h-11 rounded-xl bg-slate-900 px-7 font-black text-white shadow-[0_16px_24px_-18px_rgba(15,23,42,0.78)] hover:bg-slate-800">
                {isCompleting ? 'جار الحفظ...' : 'إتمام'}
              </Button>
            )}
          </div>
        </div>
      </footer>

      <Sheet open={isCashPaymentSheetOpen} onOpenChange={setIsCashPaymentSheetOpen}>
        <SheetContent side="right" className="w-full max-w-md border-l-0 bg-white p-0" dir="rtl">
          <SheetHeader className="border-b border-slate-200 px-5 py-5 text-right">
            <div className="flex items-center justify-between gap-3">
              <div>
                <SheetTitle className="text-xl font-black text-slate-950">دفع نقدي</SheetTitle>
                <p className="mt-1 text-xs font-bold text-slate-500">سجل المبلغ المستلم من العميل</p>
              </div>
              <SheetDismissButton />
            </div>
          </SheetHeader>
          <SheetBody className="px-5 py-6">
            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-xs font-black text-slate-600">المبلغ</span>
                <Input type="number" inputMode="decimal" min="0" max={Math.max(total - advanceAmount, 0)} step="0.01" value={cashDraftAmount} onChange={(event) => {
                  const value = event.target.value;
                  setCashDraftAmount(value === '' ? '' : String(Math.min(Math.max(Number(value) || 0, 0), Math.max(total - advanceAmount, 0))));
                }} placeholder="0" className="h-14 rounded-xl border-slate-300 text-xl font-black text-slate-950" autoFocus />
                <span className="mt-2 block text-xs font-bold text-slate-400">الحد الأقصى {formatMoney(Math.max(total - advanceAmount, 0))}</span>
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-black text-slate-600">ملاحظة الدفع <span className="text-red-600">*</span></span>
                <Input required value={cashDraftNote} onChange={(event) => setCashDraftNote(event.target.value)} placeholder="مثال: دفعة نقدية من العميل" className="h-12 rounded-xl border-slate-300 text-sm font-bold" />
              </label>
              <EmployeeCashDestinationNotice
                destination={cashDestination}
                isLoading={isCashDestinationLoading}
                error={cashDestinationError}
              />
            </div>
          </SheetBody>
          <div className="mt-auto flex gap-3 border-t border-slate-200 px-5 py-4">
            <Button type="button" onClick={() => {
              setPaidAmount(cashDraftAmount);
              setPaymentNotes(cashDraftNote.trim());
              setIsCashPaymentSheetOpen(false);
            }} disabled={(Number(cashDraftAmount) || 0) <= 0 || !cashDraftNote.trim() || isCashDestinationLoading || Boolean(cashDestinationError) || !cashDestination?.accountId} className="h-11 flex-1 rounded-xl bg-slate-950 font-black text-white hover:bg-slate-800">تأكيد الدفع</Button>
            {Number(paidAmount) > 0 ? <Button type="button" variant="secondary" onClick={() => {
              setPaidAmount('');
              setPaymentNotes('');
              setCashDraftAmount('');
              setCashDraftNote('');
              setIsCashPaymentSheetOpen(false);
            }} className="h-11 rounded-xl font-black text-red-600">حذف</Button> : null}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={isAdvanceBalancesSheetOpen} onOpenChange={setIsAdvanceBalancesSheetOpen}>
        <SheetContent side="right" className="w-full max-w-md border-l-0 bg-[#fffafb] p-0" dir="rtl">
          <SheetHeader className="border-b border-[#e6c8cf] bg-white px-5 py-5 text-right">
            <div className="flex items-center justify-between gap-3">
              <div>
                <SheetTitle className="text-xl font-black text-[#4d1f28]">رصيد العميل</SheetTitle>
                <p className="mt-1 text-xs font-bold text-[#8e6f76]">اختر المبلغ المستخدم من كل جهة</p>
              </div>
              <SheetDismissButton />
            </div>
          </SheetHeader>
          <SheetBody className="space-y-3 px-5 py-5">
            {advanceBalances.map((balance) => {
              const avatar = getPartnerAvatarConfig({ name: balance.paymentEntityName, displayConfig: balance.displayConfig });
              const allocated = advanceAllocations[balance.paymentEntityId] ?? '';
              const maxForEntity = Math.min(balance.availableAmount, Math.max(total - (Number(paidAmount) || 0) - advanceAmount + (Number(allocated) || 0), 0));
              return (
                <div key={balance.paymentEntityId} className="rounded-2xl border border-[#ead9dd] bg-white p-4">
                  <div className="mb-3 flex min-w-0 items-center gap-3">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center text-sm font-black ${avatar.shape === 'circle' ? 'rounded-full' : 'rounded-xl'}`} style={{ backgroundColor: avatar.bg, color: avatar.color }}>{avatar.text}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-[#4d1f28]">{balance.paymentEntityName}</p>
                      <p className="mt-0.5 text-xs font-bold text-emerald-700">الرصيد المتاح: {formatMoney(balance.availableAmount)}</p>
                    </div>
                  </div>
                  <label className="block text-xs font-black text-[#668097]">
                    <span className="mb-2 block">المبلغ المستخدم</span>
                    <Input type="number" min="0" max={maxForEntity} step="0.01" value={allocated} placeholder="0" onChange={(event) => {
                      const value = event.target.value;
                      const safeValue = value === '' ? '' : String(Math.min(Math.max(Number(value) || 0, 0), maxForEntity));
                      setAdvanceAllocations((current) => ({ ...current, [balance.paymentEntityId]: safeValue }));
                    }} className="h-12 rounded-xl border-[#e6c8cf] text-lg font-black text-[#4d1f28]" />
                  </label>
                  <label className="mt-3 block text-xs font-black text-[#668097]">
                    <span className="mb-2 block">ملاحظة الدفع <span className="text-red-600">*</span></span>
                    <Input required={Number(allocated) > 0} value={advancePaymentNotes[balance.paymentEntityId] || ''} onChange={(event) => setAdvancePaymentNotes((current) => ({ ...current, [balance.paymentEntityId]: event.target.value }))} placeholder="ملاحظة الدفعة" className="h-11 rounded-xl border-[#e6c8cf] text-sm font-bold text-[#4d1f28]" />
                  </label>
                </div>
              );
            })}
            <div className="sticky bottom-0 rounded-2xl bg-slate-950 p-4 text-white shadow-lg">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-slate-300">إجمالي المستخدم</span>
                <span className="text-lg font-black">{formatMoney(advanceAmount)}</span>
              </div>
              <Button type="button" disabled={hasIncompleteAdvanceNotes} onClick={() => setIsAdvanceBalancesSheetOpen(false)} className="mt-3 h-11 w-full rounded-xl bg-white font-black text-slate-950 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">تأكيد</Button>
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Sheet open={productSheetOpen} onOpenChange={closeProductSheet}>
        <SheetContent side="bottom" className="mx-auto max-h-[96vh] min-h-[68vh] w-full max-w-[680px] rounded-t-[28px] border-0 bg-white shadow-none" dir="rtl">
          <SheetHeader className="rounded-t-[28px] border-b border-white/15 bg-gradient-to-l from-slate-900 via-slate-800 to-slate-700 px-5 py-6 text-right sm:px-7">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-xl font-black tracking-tight text-white">{getProductTitle(pendingProduct)}</SheetTitle>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold text-white/75">{getProductCode(pendingProduct)}</p>
                  {pendingProduct?.requiresLicense ? (
                    <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-black text-white">
                      يحتاج ترخيص
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {pendingProduct?.requiresLicense && productSheetStep === 2 ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setProductSheetError('');
                      setProductSheetStep(1);
                    }}
                    className="h-10 rounded-lg border-white/20 bg-white/10 px-4 font-black text-white hover:bg-white/20"
                  >
                    السابق
                  </Button>
                ) : null}
                <Button onClick={confirmProductSelection} className="h-10 rounded-lg bg-white px-6 font-black text-slate-900 shadow-[0_8px_16px_-12px_rgba(15,23,42,0.5)] hover:bg-slate-100">
                  {pendingProduct?.requiresLicense && productSheetStep === 1 ? 'التالي' : 'إضافة'}
                </Button>
              </div>
            </div>
          </SheetHeader>

          <SheetBody className="space-y-0 bg-transparent px-0 pb-0 pt-0">
            <div className="bg-white px-0 pb-3 pt-0 shadow-none">
              {productSheetError ? (
                <div className="rounded-none border-none border-red-200 bg-red-50 px-5 py-3 text-sm font-bold text-red-700 mb-4 sm:px-7">
                  {productSheetError}
                </div>
              ) : null}

              {productSheetStep === 1 ? (
                <>
              <div className="rounded-none border-0 bg-transparent p-0 px-5 sm:px-7">
              {!pendingProduct?.requiresLicense ? (
                <div className="grid gap-4">
                  <label className="block">
                    <span className="mb-2.5 block text-xs font-black uppercase tracking-wide text-slate-500">سعر البيع</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={productDraft.price}
                      onChange={(event) => {
                        setProductDraft((current) => ({ ...current, price: event.target.value }));
                        setProductSheetError('');
                      }}
                      className="h-11 w-full md:max-w-[240px] rounded-lg border-slate-300 bg-white px-3.5 text-sm font-black text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-300/50"
                    />
                    <span className="mt-2 block text-[10px] font-semibold text-slate-400">
                      السعر المقترح: {formatMoney(Number(pendingProduct?.price ?? 0))}
                    </span>
                  </label>

                </div>
              ) : null}

              {pendingAttributeFields.length ? (
                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {pendingAttributeFields.map((field) => (
                      <div key={field.key} className="min-w-0">
                        {field.values?.length ? (
                          <AttributeSelectCard
                            field={field}
                            value={productDraft.attributes[field.key] || ''}
                            isOpen={openAttributeKey === field.key}
                            onToggle={() => setOpenAttributeKey((current) => (current === field.key ? '' : field.key))}
                            onSelect={(nextValue) => {
                              setProductDraft((current) => ({
                                ...current,
                                attributes: {
                                  ...current.attributes,
                                  [field.key]: nextValue,
                                },
                              }));
                              setProductSheetError('');
                              setOpenAttributeKey('');
                            }}
                          />
                        ) : (
                          <label className="block">
                            <span className="mb-2.5 block text-xs font-semibold text-slate-600">
                              {field.label}
                              {field.isRequired ? <span className="text-red-500"> *</span> : null}
                            </span>
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
                              className="h-11 rounded-lg border-slate-300 bg-white text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-300/50"
                            />
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              </div>

            <div className="space-y-4 px-5 py-4 sm:px-7">
            {pendingProduct?.tracking === 'serial' ? (
              isTrackingIdentifiersLoading ? (
                <div className="px-0 py-1 text-sm font-bold text-slate-600">
                  جاري تحميل تعريفات التتبع...
                </div>
              ) : trackingIdentifierDefinitions.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                    {trackingIdentifierDefinitions.map((definition) => {
                      const slots = getIdentifierSlots(definition);
                      const isNotAvailable = Boolean(productDraft.trackingIdentifierNotAvailable?.[definition.identifierTypeId]);
                      return (
                        <label key={definition.identifierTypeId} className="block">
                          <span className="mb-2.5 flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
                            <span>
                              {definition.name}
                              {definition.isRequired ? <span className="text-red-500"> *</span> : null}
                            </span>
                            {definition.allowNotAvailable ? (
                              <span className="flex items-center gap-1.5 text-slate-500">
                                <input
                                  type="checkbox"
                                  checked={isNotAvailable}
                                  onChange={(event) => handleTrackingIdentifierNotAvailableChange(definition, event.target.checked)}
                                />
                                لا يوجد
                              </span>
                            ) : null}
                          </span>
                          <Input
                            value={productDraft.trackingIdentifiers?.[definition.identifierTypeId] ?? ''}
                            inputMode={
                              slots.length > 0 && slots.every((slot) => slot.type === 'numeric')
                                ? 'numeric'
                                : 'text'
                            }
                            maxLength={slots.length || undefined}
                            onChange={(event) => handleTrackingIdentifierChange(definition, event.target.value)}
                            placeholder={slots.length ? `${slots.length} خانة` : definition.code || definition.name}
                            disabled={isNotAvailable}
                            dir={slots.length > 0 ? 'ltr' : 'rtl'}
                            className="h-11 rounded-lg border-slate-300 bg-white text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-300/50"
                          />
                        </label>
                      );
                    })}
                </div>
              ) : (
                <div className="px-0 py-1 text-sm font-bold text-slate-600">
                  هذا المنتج غير محدد له تتبع.
                </div>
              )
            ) : null}

            {!pendingAttributeFields.length && pendingProduct?.tracking !== 'serial' ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-4 text-sm font-bold text-slate-500">
                لا توجد خصائص إضافية مطلوبة لهذا المنتج.
              </div>
            ) : null}

            {pendingProduct?.requiresLicense ? (
              <div className="border-t border-slate-100 pt-2">
                {renderLicenseFields()}
              </div>
            ) : null}
            </div>
                </>
              ) : (
                <div className="space-y-4 px-5 pb-4 pt-0 sm:px-7">
                  <div className="grid gap-4">
                    <label className="block">
                      <span className="mb-2.5 block text-xs font-black uppercase tracking-wide text-slate-500">سعر البيع</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={productDraft.price}
                        onChange={(event) => {
                          setProductDraft((current) => ({ ...current, price: event.target.value }));
                          setProductSheetError('');
                        }}
                        className="h-11 w-full md:max-w-[240px] rounded-lg border-slate-300 bg-white px-3.5 text-sm font-black text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-300/50"
                      />
                      <span className="mt-2 block text-[10px] font-semibold text-slate-400">
                        السعر المقترح: {formatMoney(Number(pendingProduct?.price ?? 0))}
                      </span>
                    </label>

                  </div>
                </div>
              )}
            </div>
          </SheetBody>


        </SheetContent>
      </Sheet>

      <ProductFormSheet
        open={isProductCreateSheetOpen}
        onOpenChange={closeCreateProductSheet}
        product={null}
        categories={productCategories}
        onSubmit={handleProductCreate}
        isSubmitting={isProductSubmitting}
        side="right"
      />

      <PartnerFormSheet
        open={isCustomerSheetOpen}
        onOpenChange={setIsCustomerSheetOpen}
        initialValues={NEW_CUSTOMER_INITIAL_VALUES}
        onSubmit={createCustomer}
        isSubmitting={isCustomerSubmitting}
        side="right"
        hideTypeFields
        hideCompanyFields
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

function SaleReviewStep({ customer, cart, total, paidAmount, remainingAmount, paymentMethod, contractNote }) {
  const showPaymentSummary = paidAmount !== undefined || remainingAmount !== undefined || Boolean(paymentMethod?.trim());

  return (
    <div className="mx-auto w-full max-w-[680px] space-y-3" dir="rtl">
      <p className="text-right text-xs font-black text-red-600">مراجعة الفاتورة قبل الدفع</p>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid gap-3 px-4 py-3 text-sm font-bold text-slate-700 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-black text-slate-400">الاسم</p>
            <p className="mt-1 text-slate-950">{customer?.name || '--'}</p>
          </div>
          <div>
            <p className="text-[11px] font-black text-slate-400">الهاتف</p>
            <p className="mt-1 font-mono text-slate-950" dir="ltr">{customer?.phone || customer?.phone1 || '--'}</p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="divide-y divide-slate-100">
          {cart.map((item) => (
            <div key={item.lineId || item.id} className="flex items-start gap-3 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-black text-white">
                {item.quantity}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-slate-950">{item.name}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">{item.code}</p>
                <LineMeta item={item} className="mt-1 text-slate-500" />
              </div>
              <div className="shrink-0 text-left" dir="ltr">
                <p className="font-mono text-sm font-black text-slate-950">{formatMoney(item.price * item.quantity)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
          <ReviewAmount label="الإجمالي" value={total} />
          {showPaymentSummary ? (
            <>
              <ReviewAmount label="المدفوع" value={paidAmount} note={paymentMethod?.trim() || 'غير محددة'} />
              <ReviewAmount label="المتبقي" value={remainingAmount} tone={remainingAmount > 0 ? 'danger' : 'success'} />
            </>
          ) : null}
        </div>
        {contractNote?.trim() ? (
          <div className="border-t border-slate-100 px-4 py-3">
            <p className="text-[11px] font-black text-slate-400">ملاحظة العقد</p>
            <p className="mt-1 text-sm font-bold leading-6 text-slate-700">{contractNote.trim()}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ReviewAmount({ label, value, tone = 'default', note = '' }) {
  const toneClass = tone === 'danger'
    ? 'text-red-600'
    : tone === 'success'
      ? 'text-emerald-600'
      : 'text-slate-950';

  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-black text-slate-400">{label}</p>
      <p className={`mt-1 font-mono text-sm font-black ${toneClass}`}>{formatMoney(value)}</p>
      {note ? <p className="mt-1 text-[11px] font-bold text-slate-400">{note}</p> : null}
    </div>
  );
}

function AttributeSelectCard({ field, value, isOpen, onToggle, onSelect }) {
  const selectedValue = field.values.find((option) => option.id === value);
  const displayValue = selectedValue?.name || (field.isRequired ? 'اختر القيمة' : 'بدون اختيار');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`group w-full rounded-xl border bg-white px-3.5 py-3 text-right shadow-sm transition focus:outline-none focus:ring-4 ${
          isOpen
            ? 'border-slate-700 ring-slate-200'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 focus:border-slate-500 focus:ring-slate-200'
        }`}
        aria-expanded={isOpen}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[11px] font-black text-slate-400">
              {field.label}
              {field.isRequired ? <span className="text-red-500"> *</span> : null}
            </span>
            <span className={`mt-1 block truncate text-sm font-black ${selectedValue ? 'text-slate-950' : 'text-slate-400'}`}>
              {displayValue}
            </span>
          </span>
          <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition ${isOpen ? 'rotate-180 bg-slate-900 text-white' : 'group-hover:bg-white'}`}>
            <ChevronDown className="h-4 w-4" />
          </span>
        </span>
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_22px_45px_-24px_rgba(15,23,42,0.7)]">
          {!field.isRequired ? (
            <button
              type="button"
              onClick={() => onSelect('')}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-right text-xs font-black transition ${
                !value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <span>بدون {field.label}</span>
              {!value ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ) : null}
          {field.values.map((option) => {
            const selected = option.id === value;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelect(option.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-right text-xs font-black transition ${
                  selected ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="truncate">{option.name}</span>
                {selected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SelectedProductsPanel({ cart, onUpdateQuantity, customer }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white px-5 py-4" dir="rtl">
      {/* Customer card */}
      {customer && (
        <div className="mb-4 flex shrink-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white">
            <User className="h-5 w-5 text-slate-700" strokeWidth={2} />
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
              className="rounded-xl bg-slate-900 p-3 text-white shadow-[0_18px_34px_-24px_rgba(15,23,42,0.58)]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/18 text-sm font-black text-white ring-1 ring-white/24">
                  {item.quantity}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-white">{item.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-slate-900">{formatMoney(item.price * item.quantity)}</span>
                    <span className="text-[11px] font-bold text-white/70">{item.code}</span>
                  </div>
                  <LineMeta item={item} className="mt-2 text-white/75" />
                </div>
                <LineControls item={item} onUpdateQuantity={onUpdateQuantity} compact tone="light" />
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-[#e6c8cf] bg-[#fcf6f7] px-4 py-8 text-center text-xs font-bold leading-5 text-[#8e6f76]">
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
  const licenseText = item.license?.number ? `ترخيص: ${item.license.number}` : item.license ? 'يحتاج ترخيص' : '';

  if (!item.serialNumber && !trackingText && !attributesText && !item.ownershipTransferName && !licenseText) return null;

  return (
    <div className={`space-y-0.5 text-[11px] font-bold leading-5 ${className}`}>
      {trackingText ? <p className="truncate">{trackingText}</p> : item.serialNumber ? <p className="truncate">السيريال: {item.serialNumber}</p> : null}
      {licenseText ? <p className="truncate">{licenseText}</p> : null}
      {item.ownershipTransferName ? (
        <p className="inline-flex max-w-full items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-black text-red-700 ring-1 ring-red-100">
          <span className="shrink-0">نقل الملكية إلى:</span>
          <span className="mr-1 truncate">{item.ownershipTransferName}</span>
        </p>
      ) : null}
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
            isLight ? 'border-white bg-white text-slate-900 hover:bg-white/90' : 'border-[#b8e0cf] bg-[#ecfbf4] text-[#167450] hover:bg-[#dff7ec]'
          }`}
          aria-label="زيادة الكمية"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
