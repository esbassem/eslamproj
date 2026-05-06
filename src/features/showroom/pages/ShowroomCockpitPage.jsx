import { useMemo, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/core/ui/card';
import { Input } from '@/core/ui/input';

const STEP_LABELS = ['المنتج', 'العميل', 'الدفع', 'التأكيد'];

const MOCK_PRODUCTS = [
  { id: 'p1', name: 'سامسونج A55', sku: 'SM-A55', price: 18990, stock: 8 },
  { id: 'p2', name: 'آيفون 14', sku: 'IP-14', price: 42900, stock: 4 },
  { id: 'p3', name: 'ريدمي نوت 13', sku: 'RM-N13', price: 12500, stock: 11 },
  { id: 'p4', name: 'هاتف معرض مستعمل', sku: 'USED-X2', price: 8900, stock: 2 },
  { id: 'p5', name: 'هواوي Nova 12', sku: 'HW-N12', price: 21500, stock: 6 },
];

const MOCK_OPERATIONS = [
  { id: 'OP-2301', customer: 'محمد السيد', amount: 42900, status: 'جاري', time: 'منذ 12 دقيقة' },
  { id: 'OP-2300', customer: 'شركة الأنوار', amount: 12500, status: 'مكتملة', time: 'منذ 28 دقيقة' },
  { id: 'OP-2299', customer: 'أحمد وليد', amount: 18990, status: 'معلقة', time: 'منذ ساعة' },
  { id: 'OP-2298', customer: 'نورهان ممدوح', amount: 8900, status: 'مكتملة', time: 'اليوم 10:20 ص' },
];

function formatMoney(value) {
  return `${Number(value ?? 0).toLocaleString('en-US')} EGP`;
}

function Stepper({ currentStep }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {STEP_LABELS.map((label, index) => {
        const step = index + 1;
        const isDone = step < currentStep;
        const isActive = step === currentStep;

        return (
          <div
            key={label}
            className={`rounded-2xl border px-3 py-2 text-center text-xs font-bold transition ${
              isActive
                ? 'border-slate-300 bg-slate-900 text-white'
                : isDone
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500'
            }`}
          >
            <div className="text-[11px] opacity-80">{step}</div>
            <div className="mt-0.5">{label}</div>
          </div>
        );
      })}
    </div>
  );
}

export function ShowroomCockpitPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [productSearch, setProductSearch] = useState('');
  const [operationSearch, setOperationSearch] = useState('');
  const [selectedProducts, setSelectedProducts] = useState([]);

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return MOCK_PRODUCTS;
    return MOCK_PRODUCTS.filter((item) => item.name.toLowerCase().includes(query) || item.sku.toLowerCase().includes(query));
  }, [productSearch]);

  const filteredOperations = useMemo(() => {
    const query = operationSearch.trim().toLowerCase();
    if (!query) return MOCK_OPERATIONS;
    return MOCK_OPERATIONS.filter((item) => item.customer.toLowerCase().includes(query) || item.id.toLowerCase().includes(query));
  }, [operationSearch]);

  const total = useMemo(() => selectedProducts.reduce((sum, item) => sum + item.price, 0), [selectedProducts]);

  const nextStep = () => setCurrentStep((prev) => Math.min(prev + 1, 4));

  const addProduct = (product) => {
    setSelectedProducts((current) => [...current, product]);
  };

  return (
    <div className="flex w-full flex-col">
      <header className="sticky top-0 z-20 w-full border-b border-slate-200 bg-white px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-slate-500">Showroom Workspace</p>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900">نقطة معرض</h1>
          </div>
          <Badge className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">وضع البيع السريع</Badge>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1400px] px-4 pb-6 pt-4 sm:px-6 lg:px-8">
      <div className="grid min-h-[calc(100vh-10rem)] gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]">
        <Card className="h-full border-slate-200 bg-white">
          <CardHeader className="gap-4 border-b border-slate-100">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg font-extrabold text-slate-900">عملية بيع جديدة</CardTitle>
                <CardDescription className="mt-1 text-sm text-slate-500">ابدأ من المنتج ثم أكمل الخطوات</CardDescription>
              </div>
              <Badge className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Workflow</Badge>
            </div>
            <Stepper currentStep={currentStep} />
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="ابحث عن منتج بالاسم أو SKU"
                className="h-11 rounded-xl border-slate-200 pr-10"
              />
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addProduct(product)}
                className="rounded-xl border border-slate-200 bg-white p-3 text-right transition hover:border-slate-300 hover:bg-slate-50"
              >
                <div className="text-sm font-bold text-slate-900">{product.name}</div>
                <div className="mt-1 text-[11px] font-semibold text-slate-500">{product.sku}</div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">المخزون: {product.stock}</span>
                  <span className="text-sm font-extrabold text-slate-900">{formatMoney(product.price)}</span>
                </div>
              </button>
            ))}
          </CardContent>
          <div className="border-t border-slate-100 p-4">
            <Button onClick={nextStep} className="h-10 rounded-xl bg-slate-900 px-5 font-bold text-white hover:bg-slate-800">
              التالي
              <ArrowLeft className="mr-2 h-4 w-4" />
            </Button>
          </div>
        </Card>

        <Card className="h-full border-slate-200 bg-white">
          <CardHeader className="border-b border-slate-100">
            <div>
              <CardTitle className="text-lg font-extrabold text-slate-900">آخر العمليات</CardTitle>
              <CardDescription className="mt-1">ابحث ثم استكمل عملية سابقة</CardDescription>
            </div>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={operationSearch}
                onChange={(event) => setOperationSearch(event.target.value)}
                placeholder="بحث باسم العميل أو رقم العملية"
                className="h-11 rounded-xl border-slate-200 pr-10"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {filteredOperations.map((operation) => (
              <button
                key={operation.id}
                type="button"
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-right transition hover:border-slate-300 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-900">{operation.customer}</div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">{operation.id} • {operation.time}</div>
                  </div>
                  <Badge className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{operation.status}</Badge>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">اضغط لاستكمال العملية</span>
                  <span className="text-sm font-extrabold text-slate-900">{formatMoney(operation.amount)}</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
