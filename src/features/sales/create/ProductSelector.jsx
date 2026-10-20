import { useCallback, useState } from 'react';
import { ProductOption, ProductSearchField } from '@/shared/products';
import { salesService } from '@/features/sales/services/sales.service';

const trackingLabel = (product) => product.productType === 'service' ? 'خدمة' : product.tracking === 'serial' ? 'قطعة متسلسلة' : 'منتج كمي';

export function ProductSelector({ tenantId, onSelect, disabled = false }) {
  const [search, setSearch] = useState('');
  const searchProducts = useCallback(({ search: term, page, pageSize }) => (
    salesService.searchSaleProducts({ tenantId, search: term, page, pageSize })
  ), [tenantId]);
  const select = (product) => { onSelect(product); setSearch(''); };
  return <ProductSearchField
    searchProducts={searchProducts}
    search={search}
    onSearchChange={setSearch}
    onSelect={select}
    disabled={disabled}
    minSearchLength={2}
    placeholder="ابحث باسم المنتج أو SKU لإضافة بند"
    emptyMessage="لا يوجد منتج قابل للبيع مطابق."
    renderOption={(product, choose) => <ProductOption key={product.id} product={product} onSelect={choose} meta={`${product.sku || product.code || 'بدون كود'} · ${trackingLabel(product)} · ${Number(product.salePrice || 0).toLocaleString('ar-EG')} EGP`} />}
  />;
}
