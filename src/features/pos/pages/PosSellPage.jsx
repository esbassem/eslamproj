import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Clock3, Minus, PackageSearch, Plus, ReceiptText, ShoppingCart, Trash2, WalletCards, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import { ROUTES } from '@/core/config/routes.config';
import { useI18n } from '@/core/i18n/useI18n';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetDismissButton,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { posService } from '@/features/pos/api/pos.api';
import { PaymentSheet } from '@/features/pos/components/PaymentSheet';
import { SerialPickerDialog } from '@/features/inventory/components/SerialPickerDialog';
import { inventoryService } from '@/features/inventory/api/inventory.api';
import { productCategoryService, productVariantService } from '@/features/products/api/products.api';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { canSellProduct, isInventoryInstalled } from '@/core/lib/inventoryGuard';

const SERVICE_STOCK_MESSAGE = 'هذا المنتج خدمة ولا يدعم المخزون';
const SERIAL_UNITS_MESSAGE = 'هذا المنتج متتبع بالسيريال ويجب تحديد الوحدات';

function formatMoney(value) {
  return `${Number(value ?? 0).toLocaleString()} EGP`;
}

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function isServiceProduct(product) {
  return product?.productType === 'service';
}

function isSerialProduct(product) {
  return product?.tracking === 'serial';
}

function hasAssignedPrice(value) {
  return Number(value) > 0;
}

function getEffectivePrice(product, priceOverride) {
  return hasAssignedPrice(priceOverride) ? Number(priceOverride) : Number(product?.price ?? 0);
}

function hasVariantDimensions(product) {
  return Boolean(product?.hasVariantDimensions);
}

function CategoryPill({ active, label, count, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-w-max items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 disabled:pointer-events-none disabled:opacity-45 ${
        active
          ? 'border-[#1f4b6e] bg-[#1f4b6e] text-white shadow-[0_12px_28px_-24px_rgba(31,75,110,0.65)]'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-[#1f4b6e]'
      }`}
    >
      <span>{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-[11px] ${active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
    </button>
  );
}

export function PosSellPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { posId, sessionId } = useParams();
  const { tenant, tenantUser } = useWorkspace();
  const [session, setSession] = useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [stockRows, setStockRows] = useState([]);
  const [serialUnitsByProductId, setSerialUnitsByProductId] = useState({});
  const [operations, setOperations] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [cart, setCart] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [serialPickerProduct, setSerialPickerProduct] = useState(null);
  const [priceEditorState, setPriceEditorState] = useState(null);
  const [variantPickerState, setVariantPickerState] = useState(null);
  const [inventoryInstalled, setInventoryInstalled] = useState(null);

  const total = useMemo(() => cart.reduce((sum, line) => sum + line.quantity * line.price, 0), [cart]);
  const stockByProductId = useMemo(() => {
    return new Map(stockRows.map((row) => [row.product.id, row]));
  }, [stockRows]);
  const categoryCounts = useMemo(() => {
    return products.reduce((counts, product) => {
      if (!product.categoryId) return counts;
      counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
      return counts;
    }, new Map());
  }, [products]);
  const visibleProducts = useMemo(() => {
    const filteredProducts =
      selectedCategoryId === 'all' ? products : products.filter((product) => product.categoryId === selectedCategoryId);

    return filteredProducts.flatMap((product) => {
      // When inventory is not installed, show serial products as regular quantity cards
      if (!isSerialProduct(product) || !inventoryInstalled) {
        return [product];
      }

      const serialUnits = serialUnitsByProductId[product.id] ?? [];
      return serialUnits
        .filter((unit) => !cart.some((line) => line.serialUnitId === unit.id))
        .map((unit) => ({
          ...product,
          cardId: `${product.id}:${unit.id}`,
          serialUnit: unit,
          serialNumber: unit.trackingNumber,
        }));
    });
  }, [products, selectedCategoryId, serialUnitsByProductId, cart]);

  const loadProducts = useCallback(async () => {
    if (!tenant?.id) {
      setProducts([]);
      setCategories([]);
      setStockRows([]);
      setSerialUnitsByProductId({});
      return;
    }

    setIsProductsLoading(true);

    try {
      // Determine once per load whether the inventory module is active
      const inventoryActive = inventoryInstalled ?? (await isInventoryInstalled(tenant.id));
      setInventoryInstalled(inventoryActive);

      const [nextProducts, nextCategories] = await Promise.all([
        posService.listSellProducts({ tenantId: tenant.id }),
        productCategoryService.listCategories(tenant.id),
      ]);

      let nextStockRows = [];
      let serialEntries = [];

      if (inventoryActive) {
        nextStockRows = await inventoryService.getStock({ tenantId: tenant.id });
        const serialProducts = nextProducts.filter((product) => isSerialProduct(product));
        serialEntries = await Promise.all(
          serialProducts.map(async (product) => [
            product.id,
            await inventoryService.getSerialUnits({
              tenantId: tenant.id,
              productId: product.id,
              status: 'in_stock',
            }),
          ]),
        );
      }

      setProducts(nextProducts);
      setCategories(nextCategories.filter((category) => category.isActive));
      setStockRows(nextStockRows);
      setSerialUnitsByProductId(Object.fromEntries(serialEntries));
    } catch (error) {
      setPageError(error.message || t('pos.sell.messages.productsLoadError'));
    } finally {
      setIsProductsLoading(false);
    }
  }, [t, tenant?.id, inventoryInstalled]);

  const loadOperations = useCallback(async () => {
    if (!tenant?.id || !sessionId) {
      setOperations([]);
      return;
    }

    try {
      const nextOperations = await posService.listSessionOrders({ tenantId: tenant.id, sessionId });
      setOperations(nextOperations);
    } catch {
      setOperations([]);
    }
  }, [sessionId, tenant?.id]);

  useEffect(() => {
    let mounted = true;

    if (!tenant?.id || !sessionId) {
      setIsLoading(false);
      return undefined;
    }

    setIsLoading(true);
    setPageError('');

    Promise.all([
      posService.getSession({ tenantId: tenant.id, sessionId }),
      posService.listPaymentMethods({ tenantId: tenant.id }),
      isInventoryInstalled(tenant.id),
    ])
      .then(([nextSession, nextPaymentMethods, nextInventoryInstalled]) => {
        setInventoryInstalled(nextInventoryInstalled);
        if (!mounted) {
          return;
        }

        if (!nextSession || nextSession.posConfigId !== posId || nextSession.status !== 'open') {
          setPageError(t('pos.sell.messages.sessionClosed'));
          setSession(nextSession);
          return;
        }

        setSession(nextSession);
        setPaymentMethods(nextPaymentMethods);
      })
      .catch((error) => {
        if (mounted) {
          setPageError(error.message || t('pos.sell.messages.loadError'));
        }
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [posId, sessionId, t, tenant?.id]);

  useEffect(() => {
    const timeout = setTimeout(loadProducts, 180);
    return () => clearTimeout(timeout);
  }, [loadProducts]);

  useEffect(() => {
    const timeout = setTimeout(loadOperations, 180);
    return () => clearTimeout(timeout);
  }, [loadOperations]);

  useEffect(() => {
    if (!pageError && !successMessage) return undefined;

    const timeout = window.setTimeout(() => {
      setPageError('');
      setSuccessMessage('');
    }, 4200);

    return () => window.clearTimeout(timeout);
  }, [pageError, successMessage]);

  const getCartQuantity = (product) => {
    return cart
      .filter(
        (line) =>
          line.productId === product.id &&
          (line.productProductId ?? null) === (product.productProductId ?? product.defaultProductProductId ?? null),
      )
      .reduce((sum, line) => sum + line.quantity, 0);
  };

  const getAvailableQuantity = (product) => {
    if (isServiceProduct(product)) return Number.POSITIVE_INFINITY;
    // When inventory is not installed, treat as unlimited
    if (!inventoryInstalled) return Number.POSITIVE_INFINITY;

    const stockRow = stockByProductId.get(product.id);
    return isSerialProduct(product) ? stockRow?.availableSerials ?? 0 : stockRow?.quantity ?? 0;
  };

  const addServiceProductToCart = (product, priceOverride) => {
    const effectivePrice = getEffectivePrice(product, priceOverride);
    setSuccessMessage('');
    setPageError('');
    setCart((current) => {
      const existingLine = current.find(
        (line) =>
          line.productId === product.id &&
          (line.productProductId ?? null) === (product.productProductId ?? product.defaultProductProductId ?? null) &&
          line.productType === 'service' &&
          Number(line.price) === effectivePrice,
      );

      if (existingLine) {
        return current.map((line) => (line.lineId === existingLine.lineId ? { ...line, quantity: line.quantity + 1 } : line));
      }

      return [
        ...current,
        {
          lineId: `${product.id}:${product.productProductId ?? product.defaultProductProductId ?? 'template'}:service:${effectivePrice}`,
          productId: product.id,
          productTemplateId: product.productTemplateId ?? product.id,
          productProductId: product.productProductId ?? product.id ?? product.defaultProductProductId ?? null,
          productType: product.productType,
          name: product.displayName || product.name,
          displayName: product.displayName || product.name,
          code: product.code,
          price: effectivePrice,
          tracking: product.tracking,
          quantity: 1,
        },
      ];
    });
  };

  const addQuantityProductToCart = (product, priceOverride) => {
    const effectivePrice = getEffectivePrice(product, priceOverride);
    const availableQuantity = getAvailableQuantity(product);
    const currentCartQuantity = getCartQuantity(product);

    const sellCheck = canSellProduct({
      product,
      availableQty: availableQuantity - currentCartQuantity,
      inventoryInstalled: inventoryInstalled ?? false,
    });

    if (!sellCheck.allowed) {
      setPageError(sellCheck.reason || 'لا يوجد مخزون كافٍ لهذا المنتج.');
      return;
    }

    setSuccessMessage('');
    setPageError('');
    setCart((current) => {
      const existingLine = current.find(
        (line) =>
          line.productId === product.id &&
          (line.productProductId ?? null) === (product.productProductId ?? product.defaultProductProductId ?? null) &&
          line.tracking !== 'serial' &&
          Number(line.price) === effectivePrice,
      );

      if (existingLine) {
        return current.map((line) => (line.lineId === existingLine.lineId ? { ...line, quantity: line.quantity + 1 } : line));
      }

      return [
        ...current,
        {
          lineId: `${product.id}:${product.productProductId ?? product.defaultProductProductId ?? 'template'}:qty:${effectivePrice}`,
          productId: product.id,
          productTemplateId: product.productTemplateId ?? product.id,
          productProductId: product.productProductId ?? product.id ?? product.defaultProductProductId ?? null,
          productType: product.productType,
          name: product.displayName || product.name,
          displayName: product.displayName || product.name,
          code: product.code,
          price: effectivePrice,
          tracking: product.tracking,
          quantity: 1,
        },
      ];
    });
  };

  const addSerialProductToCart = (product, priceOverride, serialUnitOverride) => {
    if (isServiceProduct(product)) {
      setPageError(SERVICE_STOCK_MESSAGE);
      return;
    }

    if (getAvailableQuantity(product) <= 0) {
      setPageError('لا توجد IMEI متاحة لهذا المنتج.');
      return;
    }

    if (serialUnitOverride) {
      handleSerialSelected(serialUnitOverride, { ...product, price: getEffectivePrice(product, priceOverride) });
      return;
    }

    setSerialPickerProduct({ ...product, price: getEffectivePrice(product, priceOverride) });
  };

  const requestPriceThenAdd = (product, action, serialUnit) => {
    setPriceEditorState({ product, action, serialUnit });
  };

  const addToCart = (product) => {
    if (hasVariantDimensions(product) && !product.productProductId && !product.serialUnit?.productProductId) {
      openVariantPicker(product);
      return;
    }

    if (!hasAssignedPrice(product.price)) {
      requestPriceThenAdd(product, isSerialProduct(product) ? 'serial' : isServiceProduct(product) ? 'service' : 'quantity', product.serialUnit);
      return;
    }

    if (isServiceProduct(product)) {
      addServiceProductToCart(product);
      return;
    }

    if (isSerialProduct(product)) {
      addSerialProductToCart(product, undefined, product.serialUnit);
      return;
    }

    addQuantityProductToCart(product);
  };

  const openVariantPicker = async (product) => {
    if (!tenant?.id) return;

    try {
      const context = await productVariantService.getTemplateVariantContext({
        tenantId: tenant.id,
        productTemplateId: product.productTemplateId ?? product.id,
      });
      const variantAttributes = (context.attributes ?? []).filter((attribute) => attribute.createsVariant !== false);
      const initialSelections = variantAttributes.reduce((state, attribute) => {
        state[attribute.id] = '';
        return state;
      }, {});

      setVariantPickerState({
        product,
        context: {
          ...context,
          attributes: variantAttributes,
        },
        selections: initialSelections,
        error: '',
        isSubmitting: false,
      });
    } catch (error) {
      setPageError(error.message || 'تعذر تحميل خواص المنتج.');
    }
  };

  const handleVariantSelectionChange = (attributeId, valueId) => {
    setVariantPickerState((current) => (current ? { ...current, selections: { ...current.selections, [attributeId]: valueId } } : current));
  };

  const handleVariantConfirm = async () => {
    if (!tenant?.id || !variantPickerState?.product) return;

    const missingRequiredAttribute = (variantPickerState?.context?.attributes ?? []).find(
      (attribute) => attribute.isRequired && !variantPickerState.selections?.[attribute.id],
    );

    if (missingRequiredAttribute) {
      setVariantPickerState((current) => (current ? { ...current, error: `اختر قيمة "${missingRequiredAttribute.name}" قبل المتابعة.` } : current));
      return;
    }

    try {
      setVariantPickerState((current) => (current ? { ...current, isSubmitting: true, error: '' } : current));
      const attributeValueIds = Object.values(variantPickerState.selections ?? {}).filter(Boolean);
      const variant = await productVariantService.resolveVariant({
        tenantId: tenant.id,
        productTemplateId: variantPickerState.product.productTemplateId ?? variantPickerState.product.id,
        attributeValueIds,
      });

      const resolvedProduct = {
        ...variantPickerState.product,
        productProductId: variant.id,
        name: variant.displayName || variantPickerState.product.displayName || variantPickerState.product.name,
        displayName: variant.displayName || variantPickerState.product.displayName || variantPickerState.product.name,
        code: variant.sku || variantPickerState.product.code,
        barcode: variant.barcode || variantPickerState.product.barcode,
        tracking: variant.tracking || variantPickerState.product.tracking,
        price: hasAssignedPrice(variant.salePrice) ? variant.salePrice : variantPickerState.product.price,
      };

      setVariantPickerState(null);
      addToCart(resolvedProduct);
    } catch (error) {
      setVariantPickerState((current) => (current ? { ...current, isSubmitting: false, error: error.message || 'تعذر تحديد النسخة.' } : current));
    }
  };

  const handlePriceConfirmed = (price) => {
    if (!priceEditorState?.product) return;

    const { product, action, serialUnit } = priceEditorState;
    setPriceEditorState(null);

    if (action === 'service') {
      addServiceProductToCart(product, price);
      return;
    }

    if (action === 'serial') {
      addSerialProductToCart(product, price, serialUnit);
      return;
    }

    addQuantityProductToCart(product, price);
  };

  const handleSerialSelected = (serialUnit, productOverride) => {
    const product = productOverride ?? serialPickerProduct;
    if (!product) return;

    if (cart.some((line) => line.serialUnitId === serialUnit.id)) {
      setPageError('تم اختيار هذا IMEI بالفعل في السلة.');
      return;
    }

    setSuccessMessage('');
    setPageError('');
    setCart((current) => [
      ...current,
      {
        lineId: `${product.id}:${serialUnit.id}`,
        productId: product.id,
        productTemplateId: product.productTemplateId ?? product.id,
        productProductId: product.productProductId ?? product.id ?? product.defaultProductProductId ?? serialUnit.productProductId ?? null,
        productType: product.productType,
        name: product.displayName || product.name,
        displayName: product.displayName || product.name,
        code: product.code,
        price: product.price,
        tracking: product.tracking,
        quantity: 1,
        serialUnitId: serialUnit.id,
        serialNumber: serialUnit.trackingNumber,
      },
    ]);
  };

  const updateQuantity = (lineId, nextQuantity) => {
    setPageError('');
    const targetLine = cart.find((line) => line.lineId === lineId);
    let requestedQuantity = nextQuantity;

    if (targetLine?.tracking !== 'serial' && targetLine?.productType !== 'service') {
      const product = products.find((item) => item.id === targetLine?.productId);
      const availableQuantity = product ? getAvailableQuantity(product) : (inventoryInstalled ? (targetLine?.quantity ?? 0) : Number.POSITIVE_INFINITY);
      requestedQuantity = inventoryInstalled ? Math.min(availableQuantity, Math.max(0, nextQuantity)) : Math.max(0, nextQuantity);

      if (inventoryInstalled && requestedQuantity < nextQuantity) {
        setPageError('لا يوجد مخزون كافٍ لهذه الكمية.');
      }
    }

    setCart((current) =>
      current
        .map((line) => {
          if (line.lineId !== lineId) return line;
          if (line.tracking === 'serial') return { ...line, quantity: Math.min(1, Math.max(0, requestedQuantity)) };
          if (line.productType === 'service') return { ...line, quantity: Math.max(0, nextQuantity) };
          return { ...line, quantity: requestedQuantity };
        })
        .filter((line) => line.quantity > 0),
    );
  };

  const handlePayClick = () => {
    if (!cart.length) {
      setPageError(t('pos.sell.messages.emptyCart'));
      return;
    }

    if (!paymentMethods.length) {
      setPageError(t('pos.sell.messages.noPaymentMethods'));
      return;
    }

    setPageError('');
    setIsPaymentOpen(true);
  };

  const handleConfirmPayment = async ({ paymentMethodId, amount }) => {
    try {
      setIsSubmittingPayment(true);
      setPageError('');

      // Re-check whether inventory is active at the moment of payment
      const inventoryActive = inventoryInstalled ?? (await isInventoryInstalled(tenant.id));

      if (inventoryActive) {
        // Validate quantities against live stock before committing
        const latestStockRows = await inventoryService.getStock({ tenantId: tenant.id });
        const latestStockByProductId = new Map(latestStockRows.map((row) => [row.product.id, row]));
        const requiredQuantityByProductId = cart
          .filter((line) => line.tracking !== 'serial' && line.productType !== 'service')
          .reduce((counts, line) => counts.set(line.productId, (counts.get(line.productId) ?? 0) + line.quantity), new Map());

        for (const [productId, requiredQuantity] of requiredQuantityByProductId.entries()) {
          const stockRow = latestStockByProductId.get(productId);
          // Respect allow_negative_stock flag per product
          const productRecord = products.find((p) => p.id === productId);
          const { allowed } = canSellProduct({
            product: productRecord,
            availableQty: stockRow?.quantity ?? 0,
            inventoryInstalled: true,
          });
          if (!allowed && (stockRow?.quantity ?? 0) < requiredQuantity) {
            throw new Error('لا يوجد مخزون كافٍ لأحد المنتجات في السلة.');
          }
        }

        for (const line of cart.filter((item) => item.tracking === 'serial')) {
          if (!line.serialUnitId) {
            throw new Error(SERIAL_UNITS_MESSAGE);
          }

          const availableSerials = await inventoryService.getSerialUnits({
            tenantId: tenant.id,
            productId: line.productProductId ?? line.productId,
            status: 'in_stock',
          });
          if (!availableSerials.some((unit) => unit.id === line.serialUnitId)) {
            throw new Error('أحد أرقام IMEI المختارة لم يعد متاحًا.');
          }
        }

        // Deduct stock only when inventory module is installed
        for (const line of cart) {
          if (line.productType === 'service') continue;

          if (line.tracking === 'serial') {
            await inventoryService.consumeSerial({
              tenantId: tenant.id,
              productId: line.productProductId ?? line.productId,
              serialUnitId: line.serialUnitId,
              userId: tenantUser?.id,
            });
          } else {
            await inventoryService.consumeStock({
              tenantId: tenant.id,
              productId: line.productProductId ?? line.productId,
              quantity: line.quantity,
              userId: tenantUser?.id,
            });
          }
        }
      }

      await posService.createPaidOrder({
        tenantId: tenant.id,
        sessionId,
        total,
        lines: cart.map((line) => ({ ...line, total: line.quantity * line.price })),
        paymentMethodId,
        amount,
      });

      setCart([]);
      setIsPaymentOpen(false);
      await loadProducts();
      await loadOperations();
      setSuccessMessage(t('pos.sell.messages.paymentSuccess'));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || t('pos.sell.messages.paymentError') };
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const canSell = session?.status === 'open' && session?.posConfigId === posId;
  const notice = pageError
    ? { tone: 'danger', message: pageError }
    : successMessage
      ? { tone: 'success', message: successMessage }
      : null;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef4f8_100%)] text-slate-950" dir="rtl">
      <header className="sticky top-0 z-20 border-b border-slate-800/70 bg-[linear-gradient(135deg,#0f172a_0%,#17324d_58%,#244866_100%)] px-4 pb-8 pt-0 shadow-[0_24px_60px_-36px_rgba(2,8,23,0.7)]">
        <div className="mx-auto flex max-w-[1460px] min-h-[88px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label={t('pos.actions.backToList')}
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:bg-white/16 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20"
            >
              <ArrowRight className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-white">{t('pos.sell.title')}</h1>
              <p className="mt-1 text-sm font-medium text-slate-300">{t('pos.sell.sessionLabel').replace('{session}', sessionId ?? '')}</p>
            </div>
          </div>

          <div />
        </div>
      </header>

      <SaleNotice
        notice={notice}
        onClose={() => {
          setPageError('');
          setSuccessMessage('');
        }}
      />

      <main dir="rtl" className="relative z-40 mx-auto -mt-8 grid w-full max-w-none gap-4 px-4 pb-6 pt-0 xl:-mt-10 xl:grid-cols-[70vw_minmax(0,1fr)]">
        <section
          dir="rtl"
          className="relative w-[70vw] max-w-[70vw] rounded-[34px] border border-slate-300/85 bg-[linear-gradient(180deg,#fbfdff_0%,#eaf2f7_100%)] shadow-[0_24px_60px_-42px_rgba(15,23,42,0.38)]"
        >
          <div className="relative min-h-[calc(100vh-7.5rem)] p-4">
            <div className="min-w-0 rounded-[28px] border border-white/80 bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] xl:pl-[344px]">
              <div className="border-b border-slate-300/80 bg-white/88 px-4 py-3 backdrop-blur">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <CategoryPill
                    active={selectedCategoryId === 'all'}
                    label="الكل"
                    count={products.length}
                    disabled={!canSell}
                    onClick={() => setSelectedCategoryId('all')}
                  />
                  {categories.map((category) => (
                    <CategoryPill
                      key={category.id}
                      active={selectedCategoryId === category.id}
                      label={category.name}
                      count={categoryCounts.get(category.id) ?? 0}
                      disabled={!canSell}
                      onClick={() => setSelectedCategoryId(category.id)}
                    />
                  ))}
                </div>
              </div>

              <div className="p-4">
                <div className="min-w-0">
                  {isLoading || isProductsLoading ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
                      {Array.from({ length: 12 }).map((_, index) => (
                        <div key={index} className="h-36 animate-pulse rounded-[24px] bg-white ring-1 ring-slate-200" />
                      ))}
                    </div>
                  ) : canSell && visibleProducts.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
                      {visibleProducts.map((product) => (
                        <button
                          key={product.cardId ?? product.id}
                          type="button"
                          onClick={() => addToCart(product)}
                          className="group flex min-h-36 flex-col justify-between rounded-[24px] border border-slate-200/85 bg-white p-4 text-right shadow-[0_14px_30px_-30px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 hover:border-[#1f4b6e]/30 hover:bg-white hover:shadow-[0_20px_36px_-26px_rgba(31,75,110,0.26)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="line-clamp-2 text-base font-extrabold leading-6 text-slate-900">{product.displayName || product.name}</div>
                              <div className="mt-2 w-fit rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                                {product.serialNumber || product.code || product.barcode || t('pos.sell.noCode')}
                              </div>
                            </div>
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-[#eaf3f8] text-[#1f4b6e] transition group-hover:bg-[#1f4b6e] group-hover:text-white">
                              <Plus className="h-4 w-4" />
                            </div>
                          </div>

                          <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
                            <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                              {isServiceProduct(product)
                                ? 'خدمة'
                                : product.tracking === 'serial'
                                  ? 'وحدة بسيريال'
                                  : `المتاح ${getAvailableQuantity(product)}`}
                            </span>
                            {hasAssignedPrice(product.price) ? (
                              <span className="text-lg font-extrabold text-[#1f4b6e]">{formatMoney(product.price)}</span>
                            ) : (
                              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200/80">
                                ستحدد السعر
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : canSell ? (
                    <div className="flex min-h-80 flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-white px-6 text-center">
                      <PackageSearch className="h-11 w-11 text-slate-400" />
                      <h2 className="mt-4 text-xl font-extrabold">{t('pos.sell.emptyProductsTitle')}</h2>
                      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t('pos.sell.emptyProductsDescription')}</p>
                    </div>
                  ) : (
                    <div className="flex min-h-80 flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-white px-6 text-center">
                      <ShoppingCart className="h-11 w-11 text-slate-400" />
                      <h2 className="mt-4 text-xl font-extrabold">{t('pos.sell.closedTitle')}</h2>
                      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t('pos.sell.closedDescription')}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <aside
              dir="rtl"
              className="mt-4 flex min-h-[28rem] flex-col rounded-[28px] border border-slate-300/90 bg-white shadow-[0_26px_54px_-32px_rgba(15,23,42,0.42)] ring-1 ring-white/85 xl:absolute xl:bottom-4 xl:left-4 xl:top-4 xl:mt-0 xl:w-[324px]"
            >
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {cart.length ? (
                  <div className="space-y-2.5">
                    {cart.map((line) => (
                      <div
                        key={line.lineId ?? line.productId}
                        className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[0_16px_32px_-28px_rgba(15,23,42,0.42)]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="line-clamp-2 text-sm font-bold leading-5 text-slate-900">{line.displayName || line.name}</div>
                            <div className="mt-1 text-xs font-medium text-slate-500">
                              {hasAssignedPrice(line.price) ? (
                                formatMoney(line.price)
                              ) : (
                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200/80">
                                  ستحدد السعر
                                </span>
                              )}
                            </div>
                            {line.serialNumber ? (
                              <div className="mt-1 truncate font-mono text-[11px] font-semibold text-slate-500" dir="ltr">
                                {line.serialNumber}
                              </div>
                            ) : null}
                          </div>
                          {hasAssignedPrice(line.price) ? (
                            <div className="flex-shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                              {formatMoney(line.quantity * line.price)}
                            </div>
                          ) : (
                            <div className="flex-shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200/80">
                              السعر يحدد الآن
                            </div>
                          )}
                        </div>

                        {line.tracking === 'serial' ? (
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600">وحدة بسيريال</div>
                            <button
                              type="button"
                              onClick={() => updateQuantity(line.lineId, 0)}
                              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                              aria-label="حذف المنتج"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="mt-3 grid grid-cols-[36px_minmax(0,1fr)_36px] items-center gap-2">
                            <button
                              type="button"
                              onClick={() => updateQuantity(line.lineId, line.quantity - 1)}
                              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <div className="rounded-xl bg-[#1f4b6e] px-3 py-2 text-center text-sm font-extrabold text-white">{line.quantity}</div>
                            <button
                              type="button"
                              onClick={() => updateQuantity(line.lineId, line.quantity + 1)}
                              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-60 flex-col items-center justify-center px-4 text-center">
                    <ReceiptText className="h-8 w-8 text-slate-300" />
                    <div className="mt-3 max-w-52 text-sm font-medium leading-6 text-slate-500">{t('pos.sell.cart.empty')}</div>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-300/80 bg-slate-100 p-3">
                <button
                  type="button"
                  disabled={!canSell || !cart.length}
                  onClick={handlePayClick}
                  className="flex h-14 w-full items-center justify-between gap-3 rounded-[22px] bg-[#1f9d73] px-4 text-white shadow-[0_20px_38px_-28px_rgba(31,157,115,0.5)] transition hover:bg-[#188261] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-100 disabled:pointer-events-none disabled:opacity-45"
                >
                  <span className="flex items-center gap-2 text-sm font-extrabold">
                    <WalletCards className="h-4 w-4" />
                    {t('pos.sell.pay')}
                  </span>
                  <span className="rounded-full bg-white/16 px-3 py-1 text-sm font-extrabold" dir="ltr">
                    {formatMoney(total)}
                  </span>
                </button>
              </div>
            </aside>
          </div>
        </section>

        <aside dir="rtl" className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_18px_45px_-38px_rgba(15,23,42,0.35)] xl:sticky xl:top-24 xl:h-[calc(100vh-7.5rem)]">
          <div className="flex h-full flex-col">
            <div className="border-b border-slate-100 bg-[#fbfcfd] px-4 py-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#eef4f8] text-[#1f4b6e] ring-1 ring-[#1f4b6e]/10">
                  <Clock3 className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">{t('pos.sell.operations.title')}</h2>
                  <p className="mt-1 text-xs font-medium text-slate-500">{t('pos.sell.operations.description')}</p>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-white">
              {operations.length ? (
                operations.map((operation, index) => (
                  <div key={operation.id} className="border-b border-slate-100 p-4 transition hover:bg-slate-50/80 last:border-b-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-extrabold text-slate-900">
                          {t('pos.sell.operations.order')} #{operations.length - index}
                        </div>
                        <div className="mt-1 text-xs font-medium text-slate-500">{formatDateTime(operation.createdAt)}</div>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                        {operation.status === 'partially_paid' ? t('pos.sell.operations.partial') : t('pos.sell.operations.paid')}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                      <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                        <span className="block">{t('pos.sell.operations.lines')}</span>
                        <span className="mt-1 block text-sm font-extrabold text-slate-900">{operation.lineCount}</span>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                        <span className="block">{t('pos.sell.operations.total')}</span>
                        <span className="mt-1 block text-sm font-extrabold text-[#1f4b6e]">{formatMoney(operation.total)}</span>
                      </div>
                    </div>
                    {operation.paymentMethodName ? (
                      <div className="mt-2 text-xs font-medium text-slate-500">{operation.paymentMethodName}</div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="flex min-h-full flex-col items-center justify-center px-4 text-center">
                  <ReceiptText className="h-9 w-9 text-slate-300" />
                  <div className="mt-3 max-w-52 text-sm font-medium leading-6 text-muted-foreground">{t('pos.sell.operations.empty')}</div>
                </div>
              )}
            </div>
          </div>
        </aside>
      </main>

      <PaymentSheet
        open={isPaymentOpen}
        onOpenChange={setIsPaymentOpen}
        total={total}
        paymentMethods={paymentMethods}
        onSubmit={handleConfirmPayment}
        isSubmitting={isSubmittingPayment}
      />
      <SerialPickerDialog
        open={Boolean(serialPickerProduct)}
        onOpenChange={(open) => {
          if (!open) setSerialPickerProduct(null);
        }}
        tenantId={tenant?.id}
        product={serialPickerProduct}
        onSelect={handleSerialSelected}
      />
      <PriceEntrySheet
        open={Boolean(priceEditorState)}
        product={priceEditorState?.product}
        onOpenChange={(open) => {
          if (!open) setPriceEditorState(null);
        }}
        onConfirm={handlePriceConfirmed}
      />
      <VariantPickerSheet
        open={Boolean(variantPickerState)}
        product={variantPickerState?.product}
        context={variantPickerState?.context}
        selections={variantPickerState?.selections ?? {}}
        error={variantPickerState?.error}
        isSubmitting={variantPickerState?.isSubmitting}
        onOpenChange={(open) => {
          if (!open) setVariantPickerState(null);
        }}
        onSelectionChange={handleVariantSelectionChange}
        onConfirm={handleVariantConfirm}
      />
    </div>
  );
}

function SaleNotice({ notice, onClose }) {
  if (!notice?.message) return null;

  const classes =
    notice.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-red-200 bg-red-50 text-red-800';

  return (
    <div className="fixed left-4 right-4 top-20 z-50 mx-auto max-w-xl pointer-events-none">
      <div className={`pointer-events-auto flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-semibold shadow-[0_18px_50px_-30px_rgba(15,23,42,0.55)] ${classes}`}>
        <div className="leading-6">{notice.message}</div>
        <button
          type="button"
          onClick={onClose}
          className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md opacity-70 transition hover:bg-white/70 hover:opacity-100"
          aria-label="إغلاق الإشعار"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function PriceEntrySheet({ open, product, onOpenChange, onConfirm }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const priceInputRef = useRef(null);
  const serialNumber = product?.serialNumber || product?.serialUnit?.trackingNumber || '';
  const productName = product?.displayName || product?.name || '-';

  useEffect(() => {
    if (!open) return;
    setValue('');
    setError('');

    const frame = window.requestAnimationFrame(() => {
      priceInputRef.current?.focus();
      priceInputRef.current?.select?.();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, product?.id]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const numericPrice = Number(value);

    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError('أدخل سعر بيع صحيحًا أكبر من صفر.');
      return;
    }

    setError('');
    onConfirm?.(numericPrice);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto h-[60vh] max-h-[60vh] w-full max-w-2xl overflow-hidden p-0" dir="rtl">
        <SheetHeader className="bg-[#1f4b6e] px-7 py-7 text-white">
          <div className="flex items-start justify-between gap-3">
            <SheetTitle className="text-2xl text-white">{productName}</SheetTitle>
            <Button type="submit" form="pos-price-entry-form" className="shrink-0 bg-white text-[#1f4b6e] hover:bg-white/90">
              تأكيد السعر
            </Button>
          </div>
          {serialNumber ? (
            <SheetDescription className="font-mono text-sm font-semibold text-white/75" dir="ltr">
              {serialNumber}
            </SheetDescription>
          ) : null}
        </SheetHeader>

        <form id="pos-price-entry-form" className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="space-y-5 px-7 py-7">
            <div className="space-y-2">
              <Label htmlFor="pos-inline-price" className="text-base">
                السعر
              </Label>
              <Input
                ref={priceInputRef}
                id="pos-inline-price"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                dir="ltr"
                className="h-16 text-right text-3xl font-extrabold"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="0.00"
              />
            </div>

            {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
          </SheetBody>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function VariantPickerSheet({
  open,
  product,
  context,
  selections,
  error,
  isSubmitting,
  onOpenChange,
  onSelectionChange,
  onConfirm,
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] w-full max-w-3xl" dir="rtl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>تحديد خواص المنتج</SheetTitle>
          <SheetDescription>اختر القيم التي تحدد النسخة التي ستباع الآن.</SheetDescription>
        </SheetHeader>

        <div className="flex h-full flex-col">
          <SheetBody className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-bold text-slate-500">المنتج</div>
              <div className="mt-1 text-base font-extrabold text-slate-950">{product?.name ?? '-'}</div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {(context?.attributes ?? []).map((attribute) => (
                <div key={attribute.id} className="space-y-2">
                  <Label htmlFor={`pos-variant-${attribute.id}`}>{attribute.name}</Label>
                  <AttributeValuePicker
                    attribute={attribute}
                    value={selections[attribute.id] ?? ''}
                    onChange={(valueId) => onSelectionChange(attribute.id, valueId)}
                  />
                  {attribute.isRequired ? <div className="text-xs font-semibold text-amber-700">هذا الحقل مطلوب.</div> : null}
                </div>
              ))}
            </div>

            {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button type="button" disabled={isSubmitting} onClick={onConfirm}>
              {isSubmitting ? 'جارٍ التحديد...' : 'متابعة'}
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AttributeValuePicker({ attribute, value, onChange }) {
  if (attribute.displayType === 'buttons' || attribute.displayType === 'radio' || attribute.displayType === 'color') {
    return (
      <div className="flex flex-wrap gap-2">
        {!attribute.isRequired ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              !value ? 'border-[#1f4b6e] bg-[#1f4b6e] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
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
                active ? 'border-[#1f4b6e] bg-[#1f4b6e] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
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
      id={`pos-variant-${attribute.id}`}
      className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
      value={value}
      onChange={(event) => onChange(event.target.value)}
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
