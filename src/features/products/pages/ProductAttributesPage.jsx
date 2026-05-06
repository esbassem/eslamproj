import { PRODUCT_VIEWS, ProductsOverview } from '@/features/products/components/ProductsOverview';

export function ProductAttributesPage() {
  return <ProductsOverview initialView={PRODUCT_VIEWS.attributes} />;
}
