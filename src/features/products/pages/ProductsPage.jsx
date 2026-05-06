import { PRODUCT_VIEWS, ProductsOverview } from '@/features/products/components/ProductsOverview';

export function ProductsPage() {
  return <ProductsOverview initialView={PRODUCT_VIEWS.products} />;
}
