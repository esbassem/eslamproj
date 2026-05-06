import { PRODUCT_VIEWS, ProductsOverview } from '@/features/products/components/ProductsOverview';

export function ProductAttributeValuesPage() {
  return <ProductsOverview initialView={PRODUCT_VIEWS.values} />;
}
